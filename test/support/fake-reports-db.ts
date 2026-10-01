// In-memory stand-in for the two report tables, implementing the slice of the supabase-js builder the reports modules use
// (select / insert / update, eq / is / order / limit, maybeSingle) with REAL semantics where the tests depend on them:
// an update applies its filters atomically when it executes (so `current_version = N` is a true optimistic check), the
// composite primary key and the column checks of supabase/coop_reports.sql are enforced, and a call log lets a test
// prove the database was never touched. Synthetic only. No network.
import type {DbError, DbResult, DbRow, DbValue, ReportsTable, ReportsWriteClient, RowsBuilder} from '../../src/reports-client';

type Op = 'select' | 'insert' | 'update';
type Filter = {col: string; kind: 'eq' | 'is'; value: DbValue | null};

export interface FakeCall {
  table: ReportsTable;
  op: Op;
  filters: Filter[];
  values?: DbRow;
}

const MISSING: DbError = {code: 'PGRST205', message: "Could not find the table 'public.coop_reports' in the schema cache"};

export class FakeReportsDb {
  tables: Record<ReportsTable, DbRow[]> = {coop_reports: [], coop_report_versions: []};
  calls: FakeCall[] = [];
  /** Every table answers like a database where coop_reports.sql was never applied. */
  missing = false;
  /** Make the next matching call fail with a generic error. */
  private failures: {table: ReportsTable; op: Op}[] = [];
  private clock = 0;
  private ids = 0;

  failNext(table: ReportsTable, op: Op): void {
    this.failures.push({table, op});
  }

  /** The time of the Nth write: strictly increasing so "most recently updated" is deterministic. */
  private tick(): string {
    this.clock += 1;
    return new Date(Date.UTC(2026, 9, 1, 0, 0, this.clock)).toISOString();
  }

  seedReport(over: Partial<DbRow> = {}): DbRow {
    this.ids += 1;
    const at = this.tick();
    const row: DbRow = {
      id: `00000000-0000-4000-8000-${String(this.ids).padStart(12, '0')}`,
      owner_email: 'a@zoomy.test',
      title: 'Bundle sales',
      visibility: 'team',
      pinned: false,
      current_version: 1,
      deleted_at: null,
      created_at: at,
      updated_at: at,
      ...over,
    };
    this.tables.coop_reports.push(row);
    return row;
  }

  seedVersion(report: DbRow, version: number, spec: unknown, over: Partial<DbRow> = {}): DbRow {
    const row: DbRow = {report_id: report.id, version, spec_version: 1, spec, source_prompt: null, created_by: String(report.owner_email), created_at: this.tick(), ...over};
    this.tables.coop_report_versions.push(row);
    return row;
  }

  versionsOf(id: unknown): DbRow[] {
    return this.tables.coop_report_versions.filter((v) => v.report_id === id).sort((a, b) => Number(a.version) - Number(b.version));
  }

  reportById(id: unknown): DbRow | undefined {
    return this.tables.coop_reports.find((r) => r.id === id);
  }

  client(): ReportsWriteClient {
    return {from: (table) => ({select: (cols) => this.builder(table, 'select', undefined, cols), insert: (v) => this.builder(table, 'insert', v), update: (v) => this.builder(table, 'update', v)})};
  }

  private builder(table: ReportsTable, op: Op, values?: DbRow, columns?: string): RowsBuilder {
    const filters: Filter[] = [];
    const order: {col: string; asc: boolean}[] = [];
    let limit = Infinity;
    let returning = op === 'select';
    let cols = columns;
    const self: RowsBuilder = {
      eq: (col, value) => (filters.push({col, kind: 'eq', value}), self),
      is: (col, value) => (filters.push({col, kind: 'is', value}), self),
      order: (col, o) => (order.push({col, asc: o?.ascending !== false}), self),
      limit: (n) => ((limit = n), self),
      select: (c) => ((returning = true), (cols = c ?? cols), self),
      maybeSingle: () => run().then((r) => (r.error ? {data: null, error: r.error} : r.data && r.data.length > 1 ? {data: null, error: {message: 'multiple rows'}} : {data: r.data?.[0] ?? null, error: null})),
      then: (resolve, reject) => run().then(resolve, reject),
    };
    const run = async (): Promise<DbResult<DbRow[]>> => {
      await Promise.resolve(); // a real network hop: concurrent callers interleave here, then each executes atomically
      this.calls.push({table, op, filters: [...filters], values});
      if (this.missing) return {data: null, error: MISSING};
      const fi = this.failures.findIndex((f) => f.table === table && f.op === op);
      if (fi >= 0) {
        this.failures.splice(fi, 1);
        return {data: null, error: {message: 'boom'}};
      }
      const matches = (r: DbRow) => filters.every((f) => (f.kind === 'is' ? (r[f.col] ?? null) === f.value : r[f.col] === f.value));
      const project = (r: DbRow): DbRow => (cols && cols !== '*' ? Object.fromEntries(cols.split(',').map((c) => [c.trim(), r[c.trim()]])) : {...r});
      if (op === 'select') {
        const rows = this.tables[table].filter(matches);
        if (order.length) rows.sort((a, b) => order.reduce((acc, o) => acc || cmp(a[o.col], b[o.col]) * (o.asc ? 1 : -1), 0));
        return {data: rows.slice(0, limit).map(project), error: null};
      }
      if (op === 'insert') return this.insert(table, values as DbRow, returning ? project : null);
      const hit = this.tables[table].filter(matches);
      const bad = this.checkRow(table, hit.length ? {...hit[0], ...values} : null);
      if (bad) return {data: null, error: bad};
      for (const r of hit) Object.assign(r, values);
      return {data: returning ? hit.map(project) : [], error: null};
    };
    return self;
  }

  private checkRow(table: ReportsTable, row: DbRow | null): DbError | null {
    if (!row) return null;
    if (table === 'coop_reports') {
      const t = String(row.title ?? '');
      if (t.length < 1 || t.length > 120) return {code: '23514', message: 'coop_reports_title_check'};
      if (row.visibility !== 'team' && row.visibility !== 'private') return {code: '23514', message: 'coop_reports_visibility_check'};
    } else {
      if (JSON.stringify(row.spec ?? null).length >= 32768) return {code: '23514', message: 'coop_report_versions_spec_check'};
      if (typeof row.source_prompt === 'string' && row.source_prompt.length > 2000) return {code: '23514', message: 'coop_report_versions_source_prompt_check'};
    }
    return null;
  }

  private insert(table: ReportsTable, values: DbRow, project: ((r: DbRow) => DbRow) | null): DbResult<DbRow[]> {
    const at = this.tick();
    let row: DbRow;
    if (table === 'coop_reports') {
      this.ids += 1;
      row = {id: `00000000-0000-4000-8000-${String(this.ids).padStart(12, '0')}`, visibility: 'team', pinned: false, current_version: 1, deleted_at: null, created_at: at, updated_at: at, ...values};
      if (typeof row.owner_email !== 'string') return {data: null, error: {code: '23502', message: 'owner_email is null'}};
    } else {
      row = {spec_version: 1, source_prompt: null, created_at: at, ...values};
      if (!this.reportById(row.report_id)) return {data: null, error: {code: '23503', message: 'foreign key violation'}};
      if (this.tables.coop_report_versions.some((v) => v.report_id === row.report_id && v.version === row.version)) return {data: null, error: {code: '23505', message: 'duplicate key value violates unique constraint'}};
    }
    const bad = this.checkRow(table, row);
    if (bad) return {data: null, error: bad};
    this.tables[table].push(row);
    return {data: project ? [project(row)] : [], error: null};
  }
}

function cmp(a: unknown, b: unknown): number {
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}
