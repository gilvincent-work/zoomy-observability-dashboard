// LOCAL INTEGRATION (skipped unless pointed at the throwaway local stack built by `scripts/local-supabase/up.sh --explore`):
//   set -a; . scripts/local-supabase/.local-env; set +a; npx vitest run test/chat-explore-probe.integration.test.ts
// The health probe against the real `postgres` driver and the real role coop_explore_ro, over loopback only.
import {describe, expect, it, vi} from 'vitest';
vi.mock('server-only', () => ({}));
import {createRunQuery} from '../src/chat/explore/client';
import {DEFAULT_EXPLORE_LIMITS} from '../src/chat/explore/limits';
import {probeExplore} from '../src/chat/explore/probe';
import {assertLocalPostgres} from './support/local-only';

const URL_ = process.env.EXPLORE_DATABASE_URL;
const PSQL = process.env.SB_PSQL_CMD;
if (URL_) assertLocalPostgres(URL_); // loopback guard first: a set but non-local URL fails the file loudly
const local = !!URL_ && !!PSQL && /^docker exec -i coop-local-db /.test(PSQL);
const runFor = (url: string) => createRunQuery({enabled: true, limits: DEFAULT_EXPLORE_LIMITS, databaseUrl: url});

describe.skipIf(!local)('health probe against the real driver and role (local Postgres only)', () => {
  it('ok as coop_explore_ro, read only on', async () => {
    expect(await probeExplore(runFor(URL_!))).toMatchObject({ok: true, role: 'coop_explore_ro', readOnly: 'on'});
  });
  it('a wrong password is auth_failed and a closed port is connection_refused', async () => {
    const bad = new URL(URL_!);
    bad.password = 'not-the-password';
    expect(await probeExplore(runFor(bad.toString()))).toEqual({ok: false, code: 'auth_failed'});
    const dead = new URL(URL_!);
    dead.port = '1';
    expect(await probeExplore(runFor(dead.toString()))).toEqual({ok: false, code: 'connection_refused'});
  });
  it('a missing view (Explore SQL not applied) is undefined_table', async () => {
    const run = runFor(URL_!);
    expect(await probeExplore((s, o) => run(s.replace('coop_explore_orders', 'coop_explore_not_applied'), o))).toEqual({ok: false, code: 'undefined_table'});
  });
});
