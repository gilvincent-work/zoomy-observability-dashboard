// LOCAL ONLY. Runs scripts/explore-golden-reference.sql against the local Docker database (as the superuser, through `docker exec`) and
// returns / writes the expected figures as JSON: { <ref key>: [ {col: value}, ... ] }. The figures come from the fictional fixture at run time;
// nothing is typed or committed (the output file test/support/.explore-golden-expected.json is gitignored).
//   set -a; . scripts/local-supabase/.local-env; set +a; node scripts/explore-golden-expected.mjs
import {execSync} from 'node:child_process'
import {readFileSync, writeFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {assertLocalPostgres} from './local-only.mjs'

const SQL_FILE = new URL('./explore-golden-reference.sql', import.meta.url)
const OUT_FILE = new URL('../test/support/.explore-golden-expected.json', import.meta.url)

/** The `-- @ref key` blocks of the reference file: [{key, sql}]. */
export function parseReferenceSql(text) {
  const out = []
  let cur = null
  for (const line of text.split('\n')) {
    const m = /^-- @ref (\S+)\s*$/.exec(line)
    if (m) {
      cur = {key: m[1], sql: ''}
      out.push(cur)
    } else if (cur && !/^--/.test(line)) {
      cur.sql += line + '\n'
    }
  }
  return out.map((b) => ({key: b.key, sql: b.sql.trim().replace(/;$/, '')})).filter((b) => b.sql)
}

/** Compute every reference. Refuses anything but the local stack (guard first), and only ever sends a SELECT through `docker exec`. */
export function computeExpected(env = process.env) {
  assertLocalPostgres(env.EXPLORE_DATABASE_URL)
  const psql = env.SB_PSQL_CMD
  if (!psql || !/^docker exec -i coop-local-db /.test(psql)) throw new Error('set SB_PSQL_CMD to the local container psql command (docker exec -i coop-local-db psql ...)')
  const result = {}
  for (const {key, sql} of parseReferenceSql(readFileSync(SQL_FILE, 'utf8'))) {
    if (!/^\s*(select|with)\b/i.test(sql)) throw new Error(`reference ${key} is not a SELECT`)
    const wrapped = `select coalesce(json_agg(t), '[]'::json) from (${sql}) t`
    const out = execSync(`${psql} -t -A 2>&1`, {input: wrapped, encoding: 'utf8', maxBuffer: 1 << 24}).trim()
    try {
      result[key] = JSON.parse(out)
    } catch {
      throw new Error(`reference ${key} failed: ${out.slice(0, 200)}`)
    }
  }
  return result
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const expected = computeExpected()
  writeFileSync(OUT_FILE, JSON.stringify(expected, null, 2) + '\n')
  console.log(`wrote ${Object.keys(expected).length} references to test/support/.explore-golden-expected.json`)
}
