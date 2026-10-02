// Spike B runner. LOCAL THROWAWAY STACK ONLY.
// Env: SB_URL (http://127.0.0.1:54321), SB_ANON, SB_JWT_SECRET  (from `supabase status`; local dev values)
// Optional: SB_PSQL_CMD (e.g. "docker exec -i supabase_db_x psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c") used for the revoke step.
import { createHmac } from 'node:crypto'
import { execSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'
import { assertLocalSupabase } from '../local-only.mjs'

const URL_ = process.env.SB_URL, ANON = process.env.SB_ANON, SECRET = process.env.SB_JWT_SECRET
if (!URL_ || !ANON || !SECRET) throw new Error('set SB_URL, SB_ANON, SB_JWT_SECRET')
assertLocalSupabase(URL_)

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const mint = (claims, secret = SECRET) => {
  const h = b64({ alg: 'HS256', typ: 'JWT' }), p = b64(claims)
  return `${h}.${p}.${createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url')}`
}
const now = Math.floor(Date.now() / 1000)
const claims = (role, exp = now + 300) => ({ role, iss: 'supabase', exp, sub: 'spike' })
const JWT = mint(claims('coop_chat_ro'))

const results = []
const rec = (id, name, pass, detail) => { results.push({ id, name, pass }); console.log(`${pass ? 'PASS' : 'FAIL'} ${id} ${name} :: ${detail}`) }
const info = (id, text) => console.log(`INFO ${id} :: ${text}`)

async function raw(method, path, { auth, apikey, body } = {}) {
  const headers = { 'Content-Type': 'application/json', Prefer: 'return=representation' }
  if (auth) headers.Authorization = `Bearer ${auth}`
  if (apikey) headers.apikey = apikey
  const r = await fetch(`${URL_}/rest/v1/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined })
  const t = await r.text(); let j; try { j = JSON.parse(t) } catch { j = t }
  return { status: r.status, body: j }
}
const short = (r) => `${r.status} ${JSON.stringify(r.body).slice(0, 140)}`
const H = { auth: JWT, apikey: ANON }

// supabase-js leg
const sb = createClient(URL_, ANON, { global: { headers: { Authorization: `Bearer ${JWT}` } }, auth: { persistSession: false, autoRefreshToken: false } })

// a
{ const { data, error, status } = await sb.from('coop_chat_orders').select('*')
  rec('a-js', 'supabase-js select view', !error && data?.length > 0, `status=${status} rows=${data?.length} cols=${data?.[0] && Object.keys(data[0])} err=${error?.message}`)
  const r = await raw('GET', 'coop_chat_orders?select=*', H)
  rec('a-raw', 'raw GET view', r.status === 200 && r.body.length > 0 && !('customer_handle' in r.body[0]), short(r)) }
// b
{ const { data, error, status } = await sb.from('pos_orders').select('*')
  rec('b-js', 'supabase-js select base table denied', !!error || !data?.length, `status=${status} err=${error?.message} rows=${data?.length}`)
  const r = await raw('GET', 'pos_orders?select=*', H)
  rec('b-raw', 'raw GET base table denied', r.status >= 400, short(r))
  const v = await raw('GET', 'coop_chat_orders?select=customer_handle', H)
  rec('b-col', 'hidden column not selectable via view', v.status >= 400, short(v)) }
// c
{ const p = await raw('POST', 'coop_chat_orders', { ...H, body: { total: 1, pet_type: 'x' } })
  rec('c-post', 'POST view refused', p.status >= 400, short(p))
  const u = await raw('PATCH', 'coop_chat_orders?id=eq.1', { ...H, body: { total: 0 } })
  rec('c-patch', 'PATCH view refused', u.status >= 400, short(u))
  const d = await raw('DELETE', 'coop_chat_orders?id=eq.1', H)
  rec('c-delete', 'DELETE view refused', d.status >= 400, short(d))
  const { error } = await sb.from('coop_chat_orders').insert({ total: 1 })
  rec('c-js', 'supabase-js insert refused', !!error, error?.message) }
// d / e
let d1 = await raw('POST', 'rpc/fake_write_rpc', { ...H, body: {} })
const d1ok = d1.status < 300
info('d-before', `rpc before revoke -> ${short(d1)}`)
if (d1ok) console.log('FINDING d: write RPC EXECUTABLE by coop_chat_ro via default EXECUTE-to-PUBLIC (risk confirmed)')
const ro = JSON.stringify(d1.body).toLowerCase().includes('read-only')
console.log(`FINDING e: default_transaction_read_only under PostgREST: ${ro ? 'IN EFFECT (read-only transaction error)' : d1ok ? 'NOT in effect (write succeeded)' : 'inconclusive (' + short(d1) + ')'}`)
const psql = process.env.SB_PSQL_CMD
if (psql) {
  for (const q of ['revoke execute on function public.fake_write_rpc() from public', 'revoke execute on function public.fake_write_rpc() from anon, authenticated'])
    execSync(`${psql} "${q}"`, { stdio: 'pipe' })
  execSync(`${psql} "notify pgrst, 'reload schema'"`, { stdio: 'pipe' })
  await new Promise((r) => setTimeout(r, 1500))
  const d2 = await raw('POST', 'rpc/fake_write_rpc', { ...H, body: {} })
  rec('d-after', 'rpc denied after revoke', d2.status >= 400, short(d2))
}
// f
{ const A = (await raw('GET', 'coop_chat_orders?select=id&limit=1', { auth: JWT, apikey: ANON }))
  const B = (await raw('GET', 'coop_chat_orders?select=id&limit=1', { auth: JWT, apikey: JWT }))
  const C = (await raw('GET', 'coop_chat_orders?select=id&limit=1', { auth: JWT }))
  const D = (await raw('GET', 'coop_chat_orders?select=id&limit=1', { apikey: JWT }))
  info('f', `(i) JWT bearer + anon apikey -> ${short(A)}`)
  info('f', `(ii) JWT as both -> ${short(B)}`)
  info('f', `(iii) JWT bearer, no apikey -> ${short(C)}`)
  info('f', `(iv) JWT only in apikey, no bearer -> ${short(D)}`)
  rec('f', 'header combo (i) works', A.status === 200, `ii=${B.status} iii=${C.status} iv=${D.status}`) }
// g
{ const bad = await raw('GET', 'coop_chat_orders?select=id', { auth: mint(claims('nonexistent_role')), apikey: ANON })
  rec('g-role', 'unknown role rejected', bad.status >= 400, short(bad))
  const exp = await raw('GET', 'coop_chat_orders?select=id', { auth: mint(claims('coop_chat_ro', now - 600)), apikey: ANON })
  rec('g-exp', 'expired JWT rejected', exp.status >= 400, short(exp))
  const sig = await raw('GET', 'coop_chat_orders?select=id', { auth: mint(claims('coop_chat_ro'), 'wrong-secret-wrong-secret-wrong-secret'), apikey: ANON })
  rec('g-sig', 'wrong-signature JWT rejected', sig.status >= 400, short(sig)) }

console.log(`\n${results.filter((r) => r.pass).length}/${results.length} PASS`)
