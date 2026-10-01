import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe, expect, it, vi} from 'vitest';
import {REPORT_MAX_BLOCKS, REPORT_MAX_BYTES} from '../src/chat/report-types';
import {REPORT_TABLES} from '../src/reports-client';

vi.mock('server-only', () => ({}));

// GAP-07 (a): the contract of supabase/coop_reports.sql, asserted on the SQL TEXT (comments ignored), because no test touches a real
// database for the reports tables (the primary-key race, the 23505 mapping and RLS are proven only on test/support/fake-reports-db.ts
// until the local-integration test exists). This test cannot prove Postgres behaviour; it pins the DDL the fake DB models and the
// code assumes, and it ties the DDL's limits to the constants in src/.

const root = join(__dirname, '..');
const raw = readFileSync(join(root, 'supabase', 'coop_reports.sql'), 'utf8');
const sql = raw.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ').toLowerCase();
const statements = sql.split(';').map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
const norm = (s: string): string => s.replace(/\s+/g, ' ');

const create = (table: string): string => {
  const s = statements.find((x) => x.startsWith(`create table if not exists public.${table} `));
  if (!s) throw new Error(`no create table for ${table}`);
  return s;
};
/** The column names of a create-table statement (the constraint line is not a column). */
function columnsOf(statement: string): string[] {
  const body = statement.slice(statement.indexOf('(') + 1, statement.lastIndexOf(')'));
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of body) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      parts.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  parts.push(cur.trim());
  return parts.filter((p) => !p.startsWith('primary key')).map((p) => p.split(' ')[0]);
}

const reports = create('coop_reports');
const versions = create('coop_report_versions');

describe('coop_reports.sql: the two tables', () => {
  it('creates exactly the two tables the app\'s guarded client allows, and nothing else (no function, view, trigger, policy, grant)', () => {
    const creates = statements.filter((s) => /^create /.test(s));
    expect(creates.filter((s) => s.startsWith('create table'))).toHaveLength(2);
    expect(REPORT_TABLES).toEqual(['coop_reports', 'coop_report_versions']);
    for (const t of REPORT_TABLES) expect(sql).toContain(`public.${t}`);
    expect(sql).not.toMatch(/create (or replace )?(function|view|trigger|policy|role|extension|type)/);
    expect(sql).not.toMatch(/\bgrant\b/);
    expect(sql).not.toMatch(/\bdrop\b|\btruncate\b|\bdelete from\b/);
  });

  it('is idempotent: every create says "if not exists" and every statement can run twice', () => {
    for (const s of statements.filter((x) => /^create (table|index)/.test(x))) expect(s, s.slice(0, 60)).toMatch(/^create (table|index) if not exists /);
    // the rest are alter ... enable row level security and revoke, both safe to repeat
    const others = statements.filter((x) => !/^create /.test(x));
    for (const s of others) expect(s, s).toMatch(/^(alter table public\.\w+ enable row level security|revoke all on public\.\w+ from anon, authenticated)$/);
  });

  it('coop_reports: owner, a 1 to 120 character title, team or private visibility (default team), pinned flag, version counter, soft delete', () => {
    expect(columnsOf(reports)).toEqual(['id', 'owner_email', 'title', 'visibility', 'pinned', 'current_version', 'deleted_at', 'created_at', 'updated_at']);
    expect(reports).toMatch(/id uuid primary key default gen_random_uuid\(\)/);
    expect(reports).toMatch(/owner_email text not null/);
    expect(reports).toMatch(/title text not null check \(char_length\(title\) between 1 and 120\)/);
    expect(reports).toMatch(/visibility text not null default 'team' check \(visibility in \('team', 'private'\)\)/);
    expect(reports).toMatch(/pinned boolean not null default false/);
    expect(reports).toMatch(/current_version int not null default 1/);
    expect(reports).toMatch(/deleted_at timestamptz(,| \))/); // nullable: a live report has none
    expect(reports).not.toMatch(/deleted_at timestamptz not null/);
  });

  it('coop_report_versions: composite primary key (report_id, version) is the arbiter between two racing writers', () => {
    expect(columnsOf(versions)).toEqual(['report_id', 'version', 'spec_version', 'spec', 'source_prompt', 'created_by', 'created_at']);
    expect(versions).toMatch(/primary key \(report_id, version\)/);
    expect(versions).toMatch(/report_id uuid not null references public\.coop_reports \(id\) on delete cascade/);
    expect(versions).toMatch(/version int not null,/);
    expect(versions).toMatch(/spec jsonb not null/);
    expect(versions).toMatch(/created_by text not null/);
    expect(versions).not.toMatch(/\bserial\b|\bidentity\b|generated/); // the writer supplies N+1; nothing in the database counts for it
  });

  it('the size and prompt limits in the DDL equal the constants the app enforces first', () => {
    expect(REPORT_MAX_BYTES).toBe(32768);
    expect(versions).toContain(`check (pg_column_size(spec) < ${REPORT_MAX_BYTES})`);
    expect(versions).toMatch(/source_prompt text check \(char_length\(source_prompt\) <= 2000\)/);
    const actions = readFileSync(join(root, 'src', 'reports-actions.ts'), 'utf8');
    expect(actions).toMatch(/const MAX_PROMPT = 2000;/);
    expect(REPORT_MAX_BLOCKS).toBe(12); // the 12-block cap lives in code (validateSpec), never in SQL
    expect(sql).not.toMatch(/blocks/);
  });

  it('the list index serves the gallery order (live first, pinned first, newest first)', () => {
    const idx = statements.find((s) => s.startsWith('create index'));
    expect(idx).toBe('create index if not exists coop_reports_list_idx on public.coop_reports (deleted_at, pinned desc, updated_at desc)');
  });
});

describe('coop_reports.sql: nobody but the service role can read or write', () => {
  it('row level security is enabled on BOTH tables and there is no policy anywhere', () => {
    for (const t of REPORT_TABLES) expect(statements).toContain(`alter table public.${t} enable row level security`);
    expect(sql).not.toMatch(/create policy|alter policy/);
    expect(sql).not.toMatch(/force row level security|disable row level security/);
  });

  it('every default Supabase grant is revoked from anon and authenticated, for both tables', () => {
    for (const t of REPORT_TABLES) expect(statements).toContain(`revoke all on public.${t} from anon, authenticated`);
    expect(sql).not.toMatch(/to anon|to authenticated|to public|to postgres/);
  });

  it('RLS is switched on before the grants are revoked (no window where the tables are open): both come after the creates', () => {
    const at = (s: string) => statements.findIndex((x) => x === s);
    const lastCreate = Math.max(...statements.map((s, i) => (/^create /.test(s) ? i : -1)));
    expect(at('alter table public.coop_reports enable row level security')).toBeGreaterThan(lastCreate);
    expect(at('alter table public.coop_report_versions enable row level security')).toBeGreaterThan(lastCreate);
  });

  it('the header documents the verify queries a person runs after applying it, and says it is applied by hand', () => {
    expect(raw).toMatch(/Applied BY HAND/);
    expect(raw).toMatch(/relrowsecurity/);
    expect(raw).toMatch(/pg_policies/);
    expect(raw).toMatch(/role_table_grants/);
  });
});

describe('coop_reports.sql vs the columns the app reads and patches', () => {
  const listed = (src: string, name: string): string[] => {
    const m = new RegExp(`const ${name} = '([^']+)'`).exec(src);
    if (!m) throw new Error(`${name} not found`);
    return m[1].split(',');
  };
  const data = readFileSync(join(root, 'src', 'reports-data.ts'), 'utf8');
  const actions = readFileSync(join(root, 'src', 'reports-actions.ts'), 'utf8');
  const client = readFileSync(join(root, 'src', 'reports-client.ts'), 'utf8');

  it('every column a reader selects exists on the table it selects from', () => {
    const rep = columnsOf(reports);
    const ver = columnsOf(versions);
    for (const c of listed(data, 'REPORT_COLUMNS')) expect(rep, c).toContain(c);
    for (const c of listed(actions, 'ROW_COLUMNS')) expect(rep, c).toContain(c);
    for (const c of listed(data, 'VERSION_META_COLUMNS')) expect(ver, c).toContain(c);
    for (const c of listed(data, 'VERSION_COLUMNS')) expect(ver, c).toContain(c);
  });

  it('every column the guarded client lets a PATCH set exists on coop_reports, and owner_email, id and created_at are not among them', () => {
    const m = /PATCHABLE_COLUMNS[^=]*= new Set\(\[([^\]]+)\]\)/.exec(client);
    expect(m).not.toBeNull();
    const cols = (m?.[1] ?? '').split(',').map((c) => c.trim().replace(/'/g, ''));
    expect(cols.length).toBeGreaterThan(0);
    for (const c of cols) expect(columnsOf(reports), c).toContain(c);
    for (const never of ['owner_email', 'id', 'created_at']) expect(cols).not.toContain(never);
  });
});
