// list_tables and describe_table (spec 2.3), and the live relation rule the production validator uses. They read LIVE from
// information_schema AS the read-only login, so only granted tables and columns appear (information_schema shows a relation or column
// only when the user holds a privilege on it), merged with the runtime catalog's notes (catalog.json, never sent whole). Fixed SQL
// written by code: the only input is a table name that must be a plain identifier and open. Pure apart from the injected runQuery.
import {catalogTable} from '../catalog';
import {closedReason, closedRelationMessage, relationRule, type RelationKind} from './access';
import type {RunQuery} from './executor';
import {createExploreValidator, validateExploreSql, wrapCursor, type ExploreValidator} from './parse';
import {isSecretColumn} from './secret-names';
import {EXPLORE_ERROR_MESSAGES} from './types';

export const LIST_TABLES_SQL = "select t.table_name, t.table_type from information_schema.tables t where t.table_schema = 'public' order by t.table_name";
export const describeTableSql = (table: string): string =>
  'select c.column_name, c.data_type, c.is_nullable, t.table_type from information_schema.columns c join information_schema.tables t ' +
  `on t.table_schema = c.table_schema and t.table_name = c.table_name where c.table_schema = 'public' and c.table_name = '${table}' order by c.ordinal_position`;
export const SCHEMA_CALLS_PER_QUESTION = 8;
const NAME_RE = /^[a-z_][a-z0-9_]{0,62}$/;
const OPTS = {timeoutMs: 3000, maxRows: 500};
const RELATION_ERROR = {error: `E_RELATION: ${EXPLORE_ERROR_MESSAGES.E_RELATION}`};
const ABOUT_MAX = 160;

export interface SchemaTools {
  list_tables: (input: unknown) => Promise<unknown>;
  describe_table: (input: unknown) => Promise<unknown>;
}

/** BASE TABLE is a table; anything else (VIEW, FOREIGN) is held to the view allowlist. Materialized views are not in information_schema. */
const kindOf = (tableType: unknown): RelationKind => (tableType === 'BASE TABLE' ? 'table' : 'view');

/** Every relation the login can see and Ask Coop may read: closed names and views off the allowlist are dropped. */
export async function listOpenTables(runQuery: RunQuery): Promise<{name: string; kind: RelationKind}[]> {
  const r = await runQuery(wrapCursor(LIST_TABLES_SQL), OPTS);
  const all = r.rows.map((row) => ({name: String(row[0]), kind: kindOf(row[1])}));
  const allowed = relationRule(new Map(all.map((t) => [t.name, t.kind])));
  return all.filter((t) => allowed(t.name));
}

/** The first sentence of a catalog note, capped: list_tables stays one short line per table. */
const firstSentence = (s: string): string => {
  const m = /^.*?[.!?](?=\s|$)/.exec(s);
  const one = m ? m[0] : s;
  return one.length > ABOUT_MAX ? `${one.slice(0, ABOUT_MAX - 1)}…` : one;
};

export function createSchemaTools(runQuery: RunQuery): SchemaTools {
  let calls = 0;
  const over = (): {error: string} | null =>
    ++calls > SCHEMA_CALLS_PER_QUESTION ? {error: `E_CALLS: At most ${SCHEMA_CALLS_PER_QUESTION} list_tables or describe_table calls per question.`} : null;
  return {
    list_tables: async (input) => {
      const stop = over();
      if (stop) return stop;
      const domain = (input as {domain?: unknown} | null)?.domain;
      try {
        const tables = (await listOpenTables(runQuery))
          .map((t) => {
            const c = catalogTable(t.name);
            return {table: t.name, kind: t.kind, domain: c?.domain ?? null, ...(c?.about ? {about: firstSentence(c.about)} : {}), ...(c?.prefer ? {prefer: c.prefer} : {})};
          })
          .filter((t) => domain === 'all' || t.domain === domain);
        return {tables, note: 'Every listed table is readable with run_query. Call describe_table for its columns. domain null = not in the data catalog yet.'};
      } catch {
        return {error: 'E_UNAVAILABLE: The table list could not be read right now.'};
      }
    },
    describe_table: async (input) => {
      const stop = over();
      if (stop) return stop;
      const table = (input as {table?: unknown} | null)?.table;
      if (typeof table !== 'string' || !NAME_RE.test(table)) return RELATION_ERROR;
      const reason = closedReason(table); // from the name rule, not the catalog: a closed name is never sent to the database
      if (reason) return {error: closedRelationMessage(table, reason)};
      try {
        const r = await runQuery(wrapCursor(describeTableSql(table)), OPTS);
        if (r.rows.length === 0 || !relationRule(new Map([[table, kindOf(r.rows[0][3])]]))(table)) return RELATION_ERROR;
        const columns = r.rows
          .map((row) => ({name: String(row[0]), type: String(row[1]), nullable: row[2] === 'YES'}))
          .filter((c) => !isSecretColumn(table, c.name));
        if (columns.length === 0) return RELATION_ERROR;
        const c = catalogTable(table);
        return {table, about: c?.about ?? null, ...(c?.prefer ? {prefer: c.prefer} : {}), ...(c?.columns ? {catalog_columns: c.columns} : {}), columns};
      } catch {
        return {error: 'E_UNAVAILABLE: The table could not be described right now.'};
      }
    },
  };
}

/**
 * The production validator: the parser's relation rule with the LIVE kinds the login sees (a view must be allowlisted, a name the login
 * cannot see is refused before the database is asked). Read once per question; when the read fails, the static rule applies (every
 * open name) and the database stays the lock. A failed read is retried on the next call.
 */
export function createLiveValidator(runQuery: RunQuery): ExploreValidator {
  let live: Promise<ExploreValidator> | null = null;
  const load = (): Promise<ExploreValidator> =>
    (live ??= runQuery(wrapCursor(LIST_TABLES_SQL), OPTS)
      .then((r) => createExploreValidator({relationAllowed: relationRule(new Map(r.rows.map((row) => [String(row[0]), kindOf(row[1])])))}))
      .catch(() => {
        live = null;
        return validateExploreSql;
      }));
  return async (sql, limits) => (await load())(sql, limits);
}
