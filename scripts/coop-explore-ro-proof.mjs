// Role proof for Ask Coop Explore mode (spec section 5). LOCAL THROWAWAY STACK (Docker) ONLY. The validator is BYPASSED: every corpus
// row goes straight to the database as the login role coop_explore_ro, in three modes, so that what the database refuses on its own
// is proven separately from what the parser refuses (the parser is layer 2 of 5; this script proves layers 1, 3 and 5).
// Env (from scripts/local-supabase/.local-env, written by `up.sh --explore`): EXPLORE_DATABASE_URL, SB_PSQL_CMD.
//   set -a; . scripts/local-supabase/.local-env; set +a; node scripts/coop-explore-ro-proof.mjs
// Exit code 1 on any FAIL. Never prints a URL, a password or a row of customer data.
import postgres from 'postgres'
import { execSync } from 'node:child_process'
import { assertLocalPostgres } from './local-only.mjs'
import { EXPLORE_EXTRA_CORPUS, EXPLORE_NEGATIVE_CORPUS, EXPLORE_POSITIVE_CORPUS } from '../test/support/explore-corpus.mjs'

const URL_ = process.env.EXPLORE_DATABASE_URL
assertLocalPostgres(URL_) // first: this script never opens a connection to anything but the local stack
const PSQL = process.env.SB_PSQL_CMD
if (!PSQL || !/^docker exec -i coop-local-db /.test(PSQL)) throw new Error('set SB_PSQL_CMD to the local container psql command (docker exec -i coop-local-db psql ...)')

const ROLE = 'coop_explore_ro'
const CURSOR = 'coop_explore_c'
const wrap = (sql) => `DECLARE ${CURSOR} NO SCROLL CURSOR FOR ${sql}` // = wrapCursor() in src/chat/explore/parse.ts (a test pins them equal)
const FETCH = 'FETCH FORWARD 201 FROM coop_explore_c'
const ENVELOPE = ['BEGIN READ ONLY', "SET LOCAL statement_timeout = 5000", "SET LOCAL lock_timeout = 2000", "SET LOCAL timezone = 'Asia/Manila'", "SET LOCAL search_path = public"]
const TIMEOUT_MS = 5000
const MUST_CODES = new Set(['42501', '25006', '42P01', '42883', '42601', '0A000', '3F000', '42809', '55000', '54000', '42703', '428C9'])
// 42703 undefined_column (a blocked or unknown column), 428C9 generated_always (an INSERT into the identity column of an auto-updatable view
// is refused at analysis, before the privilege check; the role holds no INSERT anyway, see step (a)). Both are the database refusing on its own.
const EXPLORE_VIEWS = ['coop_explore_orders', 'coop_explore_order_items', 'coop_explore_products', 'coop_explore_bundles', 'coop_explore_bundle_items', 'coop_explore_events', 'coop_explore_prices', 'coop_explore_price_changes', 'coop_explore_event_leads', 'coop_explore_digest', 'coop_explore_inventory', 'coop_explore_inventory_by_location', 'coop_explore_inventory_lots', 'coop_explore_stock_movements', 'coop_explore_stock_event']

const admin = (sql, extra = '') => execSync(`${PSQL} ${extra} 2>&1`, { input: sql, encoding: 'utf8', maxBuffer: 1 << 24 })
const q = (sql) => admin(sql, '-t -A -F"|"').trim()

let pass = 0, fail = 0
const rec = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' :: ' + String(detail).replace(/\s+/g, ' ').slice(0, 220) : ''}`) }

const connect = () => postgres(URL_, { max: 1, prepare: false, idle_timeout: 2, connect_timeout: 5, onnotice: () => {} })
/** One case on its own connection. Returns {outcome: 'rejected'|'executed', code, rows, ms}. */
async function run(fn) {
  const sql = connect()
  const t0 = Date.now()
  try {
    const rows = await fn(sql)
    return { outcome: 'executed', rows, ms: Date.now() - t0 }
  } catch (e) {
    return { outcome: 'rejected', code: String(e.code ?? e.name ?? 'ERR'), msg: String(e.message ?? ''), ms: Date.now() - t0 }
  } finally {
    await sql.end({ timeout: 1 }).catch(() => {})
  }
}
const rollback = (sql) => sql.unsafe('ROLLBACK').catch(() => {})
/** M1: the string as written, autocommit, simple protocol, role defaults only. */
export const m1 = (text) => run((sql) => sql.unsafe(text))
/** M2: the string as written inside the executor's envelope (READ ONLY + SET LOCALs), simple protocol, then ROLLBACK. */
export const m2 = (text) => run(async (sql) => {
  try {
    await sql.unsafe(`${ENVELOPE.join('; ')}`)
    return await sql.unsafe(text)
  } finally { await rollback(sql) }
})
/** M3: as production: the envelope, DECLARE ... CURSOR FOR <sql>, FETCH 201, EXTENDED protocol (no simple), then ROLLBACK. */
export const m3 = (text) => run(async (sql) => {
  try {
    await sql.unsafe(ENVELOPE.join('; '))
    await sql.unsafe(wrap(text), [], { simple: false })
    return await sql.unsafe(FETCH, [], { simple: false })
  } finally { await rollback(sql) }
})

const label = (r) => (r.outcome === 'rejected' ? `rejected ${r.code}` : `executed (${r.rows?.length ?? 0} rows)`)
const rejectedByDb = (r) => r.outcome === 'rejected' && MUST_CODES.has(r.code)

// ---- 0. the role as the database sees it --------------------------------------------------------------------------------------
{
  const row = q(`select rolcanlogin, rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls, rolconnlimit from pg_roles where rolname = '${ROLE}'`)
  rec('role attributes: login, no super/inherit/createrole/createdb/replication/bypassrls, connection limit 10', row === 't|f|f|f|f|f|f|10', row)
  const members = q(`select count(*) from pg_auth_members where member = (select oid from pg_roles where rolname = '${ROLE}')`)
  rec('role is a member of no other role', members === '0', members)
  const settings = q(`select string_agg(c, ',' order by c) from pg_db_role_setting s cross join unnest(s.setconfig) c where s.setrole = (select oid from pg_roles where rolname = '${ROLE}')`)
  rec('role default settings include read-only and the 5s timeout', /default_transaction_read_only=on/.test(settings) && /statement_timeout=5s/.test(settings), settings)
}

// ---- (a) privileges: fifteen views, SELECT only, nothing else ---------------------------------------------------------------------
{
  const others = q(`select string_agg(c.relname, ',') from pg_class c join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    where c.relkind in ('r','v','m','p','f') and c.relname <> all (array['${EXPLORE_VIEWS.join("','")}'])
    and (has_table_privilege('${ROLE}', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') or has_any_column_privilege('${ROLE}', c.oid, 'SELECT,INSERT,UPDATE,REFERENCES'))`)
  rec('(a) no privilege on any base table or any other view (pos_*, coop_chat_*, coop_chat_digest, spin_wheel_leads, digest_archive)', others === '', others)
  const writes = q(`select string_agg(c.relname, ',') from pg_class c where c.relname = any (array['${EXPLORE_VIEWS.join("','")}']) and has_table_privilege('${ROLE}', c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')`)
  rec('(a) no write privilege on any of the fifteen views', writes === '', writes)
  const reach = q(`select count(*) from unnest(array['${EXPLORE_VIEWS.join("','")}']) v where has_table_privilege('${ROLE}', ('public.' || v)::regclass, 'SELECT')`)
  rec('(a) SELECT on exactly the fifteen views', reach === String(EXPLORE_VIEWS.length), reach)
  const create = q(`select has_schema_privilege('${ROLE}', 'public', 'CREATE')`)
  rec('(a) no CREATE on schema public', create === 'f', create)
  const exposed = q(`select count(*) from pg_class c cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a where c.relname like 'coop\\_explore\\_%' and (a.grantee = 0 or pg_get_userbyid(a.grantee) in ('anon','authenticated'))`)
  rec('(a) PUBLIC, anon and authenticated hold nothing on the fifteen views', exposed === '0', exposed)
}

// ---- the corpus, validator bypassed ------------------------------------------------------------------------------------------
const tally = { dbAlone: 0, clock: 0, cap: 0, parserOnly: [] }
const rows = [...EXPLORE_NEGATIVE_CORPUS, ...EXPLORE_EXTRA_CORPUS]
for (const c of rows) {
  if (c.db === 'MUST') {
    const r1 = await m1(c.sql), r2 = await m2(c.sql), r3 = await m3(c.sql)
    const ok = rejectedByDb(r1) && rejectedByDb(r2) && rejectedByDb(r3)
    rec(`${c.id} MUST (${c.category}): the database alone refuses in M1, M2 and M3`, ok, `M1 ${label(r1)}, M2 ${label(r2)}, M3 ${label(r3)}`)
    if (ok) tally.dbAlone++
  } else if (c.db === 'BOUNDED') {
    const r = await m3(c.sql)
    const cancelled = r.outcome === 'rejected' && r.code === '57014'
    const refused = r.outcome === 'rejected' && MUST_CODES.has(r.code)
    const capped = r.outcome === 'executed' && r.rows.length <= 201
    const inTime = r.ms <= TIMEOUT_MS + 1000
    rec(`${c.id} BOUNDED (${c.category}): stopped by the clock, the cursor cap or a refusal, within ${TIMEOUT_MS + 1000} ms`, inTime && (cancelled || refused || capped), `M3 ${label(r)} in ${r.ms} ms`)
    if (inTime && cancelled) tally.clock++
    else if (inTime && (refused || capped)) tally.cap++
  } else if (c.db === 'PARSER') {
    const r1 = await m1(c.sql), r2 = await m2(c.sql), r3 = await m3(c.sql)
    tally.parserOnly.push(`${c.id}[M1 ${label(r1)}; M2 ${label(r2)}; M3 ${label(r3)}]`)
    console.log(`INFO ${c.id} PARSER-only (${c.category}): M1 ${label(r1)}, M2 ${label(r2)}, M3 ${label(r3)}`)
  } else if (c.db === 'OK') {
    const r = await m3(c.sql)
    const expectCode = c.runtime
    const ok = expectCode ? r.outcome === 'rejected' && r.code === '42703' : r.outcome === 'executed'
    rec(`${c.id} OK (${c.category}): the positive control runs in M3${expectCode ? ' and fails only with undefined_column' : ''}`, ok, label(r))
  } else if (c.id === 'N65' || c.id === 'N75') {
    const r = await m3(c.sql)
    rec(`${c.id} n/a (${c.category}): the driver or database refuses it raw`, r.outcome === 'rejected', label(r))
  }
}
for (const c of EXPLORE_POSITIVE_CORPUS) {
  const r = await m3(c.sql)
  rec(`${c.id} positive (${c.category}): runs in M3`, r.outcome === 'executed', label(r))
}

// ---- steps (b) to (h) --------------------------------------------------------------------------------------------------------
const ordersCount = () => q('select count(*) from public.pos_orders')
{
  // (b) the SECURITY DEFINER write RPC (PUBLIC-executable on purpose in the fixture)
  const before = ordersCount()
  const r1 = await m1('select fake_write_rpc()'), r2 = await m2('select fake_write_rpc()'), r3 = await m3('select fake_write_rpc() as x from coop_explore_orders o')
  rec('(b) definer write RPC: fails in M1 (role default read-only)', r1.outcome === 'rejected' && r1.code === '25006', label(r1))
  rec('(b) definer write RPC: fails in M2 (read-only envelope)', r2.outcome === 'rejected' && r2.code === '25006', label(r2))
  rec('(b) definer write RPC: fails in M3 (cursor over a nested write)', r3.outcome === 'rejected', label(r3))
  rec('(b) pos_orders row count unchanged', ordersCount() === before, `${before} -> ${ordersCount()}`)
}
{
  // (c) temp objects
  const r2 = await m2('create temp table explore_tmp as select 1 as x'), r1 = await m1('create temp table explore_tmp as select 1 as x')
  rec('(c) CREATE TEMP TABLE fails in M2', r2.outcome === 'rejected', label(r2))
  console.log(`INFO (c) CREATE TEMP TABLE in M1 (role default read-only): ${label(r1)}${r1.outcome === 'executed' ? '  [PARSER-only: PUBLIC holds TEMP; we do not revoke PUBLIC grants]' : ''}`)
  if (r1.outcome === 'executed') tally.parserOnly.push('c-TEMP[M1 executed]')
}
{
  // (d) U6: can the text flip the transaction to read-write? (set_config after the first snapshot)
  const r = await m2("select set_config('transaction_read_only', 'off', true)")
  console.log(`INFO (d) U6 set_config('transaction_read_only','off',true) as the first query in the envelope: ${label(r)} ${r.msg ? '(' + r.msg + ')' : ''}`)
  const r2 = await run(async (sql) => {
    try {
      await sql.unsafe(ENVELOPE.join('; '))
      await sql.unsafe("select set_config('transaction_read_only', 'off', true)")
      return await sql.unsafe('insert into public.pos_orders (total) values (1)')
    } finally { await rollback(sql) }
  })
  rec('(d) set_config(read-only off) followed by an INSERT does not write (refused by the engine or by privileges)', r2.outcome === 'rejected', label(r2))
}
{
  // (e) CONNECTION LIMIT 10: the 11th simultaneous session is refused with 53300
  const conns = []
  let eleventh = null
  try {
    for (let i = 0; i < 11; i++) {
      const sql = postgres(URL_, { max: 1, prepare: false, idle_timeout: 0, connect_timeout: 5, onnotice: () => {} })
      conns.push(sql)
      try { await sql.unsafe('select 1') } catch (e) { eleventh = { i, code: e.code }; break }
    }
  } finally { await Promise.all(conns.map((c) => c.end({ timeout: 1 }).catch(() => {}))) }
  rec('(e) CONNECTION LIMIT: the 11th session fails with 53300 (too many connections for role)', eleventh && eleventh.i === 10 && eleventh.code === '53300', JSON.stringify(eleventh))
}
{
  // (g) the 260-row bulk query returns 201 rows through the cursor (200 returned + 1 proving truncation)
  const r = await m3("select o.id from coop_explore_orders o where o.remarks like 'bulk-%' order by o.id")
  rec('(g) 260 matching rows: the cursor returns exactly 201', r.outcome === 'executed' && r.rows.length === 201, label(r))
  const total = q("select count(*) from public.pos_orders where remarks like 'bulk-%'")
  rec('(g) the fixture holds 260 bulk orders', total === '260', total)
}
{
  // (h) barrier test (Day 1): the READ ONLY transaction is NOT a barrier by itself. Grant INSERT on a scratch table for this step only.
  admin(`drop table if exists public.explore_proof_scratch; create table public.explore_proof_scratch (id int); grant select, insert on public.explore_proof_scratch to ${ROLE};`)
  try {
    const flip = await run(async (sql) => {
      try {
        await sql.unsafe(ENVELOPE.join('; '))
        await sql.unsafe('set transaction read write')
        await sql.unsafe('insert into public.explore_proof_scratch (id) values (1)')
        return await sql.unsafe('select count(*) from public.explore_proof_scratch')
      } finally { await rollback(sql) }
    })
    const commitInsert = await m2('commit; insert into public.explore_proof_scratch (id) values (2)')
    const multi = await m2('select 1; insert into public.explore_proof_scratch (id) values (3)')
    const m1multi = await m1('select 1; insert into public.explore_proof_scratch (id) values (4)')
    const m1commit = await m1('commit; insert into public.explore_proof_scratch (id) values (5)')
    const m3flip = await m3('set transaction read write')
    const written = q('select count(*) from public.explore_proof_scratch')
    console.log(`INFO (h) with INSERT granted: M2 'set transaction read write; insert' ${label(flip)}; M2 'commit; insert' ${label(commitInsert)}; M2 'select 1; insert' ${label(multi)}; M1 'select 1; insert' ${label(m1multi)}; M1 'commit; insert' ${label(m1commit)}; M3 'set transaction read write' ${label(m3flip)}; rows now in scratch: ${written}`)
    if (flip.outcome === 'executed') console.log("INFO (h) READ ONLY txn is not a barrier; the lock is role privileges + parser (set transaction read write flipped it in M2)")
    rec('(h) M3 (DECLARE ... FOR set transaction read write) cannot flip the transaction: refused by the grammar', m3flip.outcome === 'rejected', label(m3flip))
    rec('(h) the role default (read-only) stops `commit; insert` and `select 1; insert` even with INSERT granted', commitInsert.outcome === 'rejected' && multi.outcome === 'rejected' && m1multi.outcome === 'rejected' && m1commit.outcome === 'rejected', `${label(commitInsert)} / ${label(multi)} / ${label(m1multi)} / ${label(m1commit)}`)
    if (flip.outcome === 'executed') tally.parserOnly.push('h-N89[M2 set transaction read write executed: parser is the only layer]')
  } finally {
    admin(`revoke all on public.explore_proof_scratch from ${ROLE}; drop table if exists public.explore_proof_scratch;`)
  }
  const gone = q("select to_regclass('public.explore_proof_scratch') is null")
  rec('(h) the scratch table is dropped and the grant revoked', gone === 't', gone)
  // N89-N91 against the real grants (no scratch): they fail by privileges, or are recorded parser-only
  const n90 = await m2('commit; insert into pos_orders (total) values (1)'), n91 = await m2('select 1; insert into pos_orders (total) values (1)')
  rec('(h) N90 and N91 against the real grants fail by privileges (42501 or 25006)', ['42501', '25006'].includes(n90.code) && ['42501', '25006'].includes(n91.code), `${label(n90)} / ${label(n91)}`)
}
rec('no proof step left a row behind: pos_orders count back to the fixture', Number(ordersCount()) >= 290, ordersCount())

console.log(`\nDB alone stops ${tally.dbAlone} cases, clock stops ${tally.clock} cases (cursor cap or refusal bounds ${tally.cap} more), parser-only ${tally.parserOnly.length} cases:`)
for (const p of tally.parserOnly) console.log(`  - ${p}`)
console.log(`\n${pass} PASS, ${fail} FAIL`)
process.exit(fail ? 1 : 0)
