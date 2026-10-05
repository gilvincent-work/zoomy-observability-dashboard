import {spawnSync} from 'node:child_process';
import {chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';

// GAP-01 (OD6): scripts/local-supabase/dev.sh is the first of two lines of defence between a local E2E run and PRODUCTION (the .env
// project). It was untested. Here a COPY of the script runs inside a throw-away tree (its own ROOT, a fake .env, a fake .local-env)
// with a stub `npm` first on PATH that only records the environment it was started with. The real script is never run against the
// real repo, no `next dev` starts, no .env is read, nothing touches a network (the only URLs are invented strings; the script only
// parses them). The child gets a minimal environment, so no variable of the caller leaks into it or into the assertions.

const REAL = join(process.cwd(), 'scripts', 'local-supabase');
const HOSTED = 'https://fakeprojectref.supabase.co';
const LOCAL = 'http://127.0.0.1:54420';

const base = mkdtempSync(join(tmpdir(), 'dev-sh-test-'));
afterAll(() => rmSync(base, {recursive: true, force: true}));

interface Tree {
  root: string;
  dir: string;
  bin: string;
  marker: string;
}
let n = 0;
/** A fresh ROOT with the real script and preload copied in, a stub npm, and whatever .env / .local-env the case needs. */
function tree(o: {dotEnv?: string; dotEnvLocal?: string; localEnv?: string | null}): Tree {
  const root = join(base, `t${++n}`);
  const dir = join(root, 'scripts', 'local-supabase');
  const bin = join(root, 'bin');
  mkdirSync(dir, {recursive: true});
  mkdirSync(bin);
  for (const f of ['dev.sh', 'block-remote.cjs', 'block-remote-match.cjs']) copyFileSync(join(REAL, f), join(dir, f));
  if (o.dotEnv !== undefined) writeFileSync(join(root, '.env'), o.dotEnv);
  if (o.dotEnvLocal !== undefined) writeFileSync(join(root, '.env.local'), o.dotEnvLocal);
  if (o.localEnv !== null) writeFileSync(join(dir, '.local-env'), o.localEnv ?? `SUPABASE_URL_ARCHIVE=${LOCAL}\nSUPABASE_SERVICE_ROLE_KEY_ARCHIVE=local-fake-key\n`);
  const marker = join(root, 'npm-ran.txt');
  // The stub: prove npm was reached (and with what arguments), and dump the environment it would have started `next dev` with.
  writeFileSync(join(bin, 'npm'), `#!/bin/sh\n{ echo "ARGS=$*"; echo "CWD=$(pwd -P)"; env; } > "${marker}"\n`);
  chmodSync(join(bin, 'npm'), 0o755);
  return {root, dir, bin, marker};
}

interface Ran {
  status: number | null;
  stdout: string;
  stderr: string;
  /** NAME -> value of what the stub npm saw; empty when it never ran. */
  env: Record<string, string>;
  args: string;
  ranNpm: boolean;
}
function run(t: Tree, args: string[] = [], extraEnv: Record<string, string> = {}): Ran {
  const r = spawnSync('bash', [join(t.dir, 'dev.sh'), ...args], {
    encoding: 'utf8', timeout: 20_000,
    // PATH: the stub first, then the directory of the node binary running the tests (the script calls `node`), then the system basics.
    env: {PATH: `${t.bin}:${dirname(process.execPath)}:/usr/bin:/bin`, HOME: t.root, ...extraEnv} as unknown as NodeJS.ProcessEnv,
  });
  const ranNpm = existsSync(t.marker);
  const env: Record<string, string> = {};
  let argsLine = '';
  if (ranNpm) {
    for (const line of readFileSync(t.marker, 'utf8').split('\n')) {
      const i = line.indexOf('=');
      if (i <= 0) continue;
      if (line.startsWith('ARGS=')) argsLine = line.slice(5);
      else env[line.slice(0, i)] = line.slice(i + 1);
    }
  }
  return {status: r.status, stdout: r.stdout, stderr: r.stderr, env, args: argsLine, ranNpm};
}

const HOSTED_ENV = [
  `SUPABASE_URL_ARCHIVE=${HOSTED}`,
  'SUPABASE_SERVICE_ROLE_KEY_ARCHIVE=hosted-fake-key',
  `NEXT_PUBLIC_SUPABASE_URL=${HOSTED}`,
  'export SUPABASE_SERVICE_ROLE_KEY=hosted-fake-service-key',
  `SUPABASE_URL=${HOSTED}`,
  `DATABASE_URL=postgres://u:p@db.fakeprojectref.supabase.co:5432/postgres`,
  'POSTGRES_URL=postgres://u:p@aws-0-fake.pooler.supabase.com:6543/postgres',
  'PGHOST=db.fakeprojectref.supabase.co',
  'CRM_API_URL=https://crm.example.test',
  'CRM_API_READ_TOKEN=crm-fake-token',
  'ANTHROPIC_API_KEY=anthropic-fake-key',
  '# SUPABASE_COMMENTED=https://commented.supabase.co',
  '',
].join('\n');

describe('dev.sh: the safe path', () => {
  let t: Tree;
  let r: Ran;
  beforeAll(() => {
    t = tree({dotEnv: HOSTED_ENV});
    r = run(t, ['-p', '3100']);
  });

  it('exits 0 and starts `npm run dev` from the repo root with the extra arguments', () => {
    expect(r.status, r.stderr).toBe(0);
    expect(r.ranNpm).toBe(true);
    expect(r.args).toBe('run dev -- -p 3100');
  });

  it('blanks EVERY SUPABASE / DATABASE_URL / POSTGRES / PGHOST name declared in .env (with or without `export`)', () => {
    for (const name of ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_URL', 'DATABASE_URL', 'POSTGRES_URL', 'PGHOST']) {
      expect(r.env[name], name).toBe('');
    }
  });

  it('the local .local-env values win over the blanks for the archive variables', () => {
    expect(r.env.SUPABASE_URL_ARCHIVE).toBe(LOCAL);
    expect(r.env.SUPABASE_SERVICE_ROLE_KEY_ARCHIVE).toBe('local-fake-key');
  });

  it('sets COOP_REQUIRE_LOCAL_DB=1 and DEV_AUTH_BYPASS=true, and preloads block-remote.cjs from the script directory', () => {
    expect(r.env.COOP_REQUIRE_LOCAL_DB).toBe('1');
    expect(r.env.DEV_AUTH_BYPASS).toBe('true');
    expect(r.env.NODE_OPTIONS).toContain(`--require ${t.dir}/block-remote.cjs`);
  });

  it('keeps the run off the hosted CRM, and does not touch variables that are not Supabase-looking', () => {
    expect(r.env.CRM_API_URL).toBe('');
    expect(r.env.CRM_API_READ_TOKEN).toBe('');
    expect(r.env.ANTHROPIC_API_KEY, 'not declared as a Supabase name, so it is not the script\'s business').toBeUndefined();
  });

  it('no hosted value reaches the child or the output: only the local URL is ever printed', () => {
    expect(JSON.stringify(r.env)).not.toMatch(/supabase\.co|supabase\.com|hosted-fake/);
    expect(r.stdout + r.stderr).not.toMatch(/supabase\.co|supabase\.com|hosted-fake/);
    expect(r.stdout).toContain(`local Supabase at ${LOCAL}`);
  });

  it('runs npm in the repo root, not in the script directory', () => {
    expect(readFileSync(t.marker, 'utf8')).toMatch(new RegExp(`CWD=.*${t.root.split('/').pop()}\\n`));
  });
});

describe('dev.sh: .env.local, the caller\'s environment and the NODE_OPTIONS it extends', () => {
  it('blanks names declared only in .env.local', () => {
    const r = run(tree({dotEnv: 'FOO=1\n', dotEnvLocal: `SUPABASE_JWT_SECRET=hosted-fake-jwt\nexport DATABASE_URL=postgres://x\n`}));
    expect(r.status).toBe(0);
    expect(r.env.SUPABASE_JWT_SECRET).toBe('');
    expect(r.env.DATABASE_URL).toBe('');
  });

  it('a hosted value the caller exported under a name .env also declares is blanked, and the local value replaces the archive ones', () => {
    const r = run(tree({dotEnv: HOSTED_ENV}), [], {SUPABASE_URL_ARCHIVE: HOSTED, SUPABASE_URL: HOSTED, DATABASE_URL: 'postgres://caller-fake'});
    expect(r.status).toBe(0);
    expect(r.env.SUPABASE_URL_ARCHIVE).toBe(LOCAL);
    expect(r.env.SUPABASE_URL).toBe('');
    expect(r.env.DATABASE_URL).toBe('');
  });

  it('keeps an existing NODE_OPTIONS after the preload', () => {
    const t = tree({dotEnv: HOSTED_ENV});
    const r = run(t, [], {NODE_OPTIONS: '--max-old-space-size=1024'});
    expect(r.env.NODE_OPTIONS).toBe(`--require ${t.dir}/block-remote.cjs --max-old-space-size=1024`);
  });

  it('works with no .env at all', () => {
    const r = run(tree({}));
    expect(r.status).toBe(0);
    expect(r.env.COOP_REQUIRE_LOCAL_DB).toBe('1');
  });

  // KNOWN BLIND SPOT (documented, not endorsed): the blanking is by NAME PATTERN. A hosted URL under a name outside the pattern is
  // passed through. The app reads none of these names, and the block-remote preload still refuses the hosted host, but a new
  // variable name for a database would need the pattern extended. If the script is changed to blank it, flip this test.
  it('names outside the pattern are not blanked (blind spot: block-remote is the second line)', () => {
    const r = run(tree({dotEnv: `DB_URL=${HOSTED}\nSUPABASE_URL_ARCHIVE=${HOSTED}\n`}));
    expect(r.status).toBe(0);
    expect(r.env.DB_URL).toBeUndefined(); // not exported by the script, so it reaches the child only if the caller exported it
    const leaked = run(tree({dotEnv: `DB_URL=${HOSTED}\n`}), [], {DB_URL: HOSTED});
    expect(leaked.env.DB_URL).toBe(HOSTED);
  });
});

describe('dev.sh: it refuses, and never starts npm', () => {
  it.each([
    ['a hosted Supabase URL', 'https://fakeprojectref.supabase.co'],
    ['a hosted pooler URL', 'https://aws-0-fake.pooler.supabase.com:6543'],
    ['a private network address', 'http://10.0.0.5:54420'],
    ['a look-alike host that starts with 127.0.0.1', 'http://127.0.0.1.evil.example:54420'],
    ['a look-alike host that starts with localhost', 'http://localhost.evil.example:80'],
    ['user-info that hides the real host behind a loopback prefix', 'http://127.0.0.1:80@fakeprojectref.supabase.co/'],
    ['https on loopback (not the local stack)', 'https://127.0.0.1:54420'],
    ['an empty value', ''],
    ['no scheme', '127.0.0.1:54420'],
  ])('%s: exit 1, "refusing", npm never runs', (_name, url) => {
    const t = tree({dotEnv: HOSTED_ENV, localEnv: `SUPABASE_URL_ARCHIVE=${url}\nSUPABASE_SERVICE_ROLE_KEY_ARCHIVE=k\n`});
    const r = run(t);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/refusing/);
    expect(r.ranNpm).toBe(false);
    expect(r.stderr + r.stdout).not.toContain(url || '\u0000'); // the refusal never echoes the URL
  });

  it('a .local-env that does not define the archive URL leaves it blanked by .env, which is refused (it can never fall back to the hosted value)', () => {
    const r = run(tree({dotEnv: `SUPABASE_URL_ARCHIVE=${HOSTED}\n`, localEnv: 'SOMETHING_ELSE=1\n'}));
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/refusing/);
    expect(r.ranNpm).toBe(false);
  });

  it('a missing .local-env says to run up.sh first and exits 1', () => {
    const r = run(tree({dotEnv: HOSTED_ENV, localEnv: null}));
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/up\.sh/);
    expect(r.ranNpm).toBe(false);
  });

  it('accepts localhost as well as 127.0.0.1', () => {
    const r = run(tree({localEnv: 'SUPABASE_URL_ARCHIVE=http://localhost:54420\nSUPABASE_SERVICE_ROLE_KEY_ARCHIVE=k\n'}));
    expect(r.status, r.stderr).toBe(0);
    expect(r.env.SUPABASE_URL_ARCHIVE).toBe('http://localhost:54420');
  });
});

describe('dev.sh: the script itself', () => {
  const src = readFileSync(join(REAL, 'dev.sh'), 'utf8');

  it('never sources or reads .env, only lists the NAMES in it', () => {
    expect(src).not.toMatch(/(?:source|\.)\s+["']?\$?\{?ROOT\}?\/\.env/);
    expect(src).not.toMatch(/\bcat\b[^\n]*\.env/);
    expect(src).toMatch(/grep -oE/);
    expect(src).toMatch(/set -euo pipefail/);
  });

  it('every guard is exported before npm runs: the order is blank, local values, loopback check, then the guards, then exec', () => {
    const at = (s: string) => src.indexOf(s);
    expect(at('export "$name="')).toBeGreaterThan(-1);
    expect(at('. "$ENVF"')).toBeGreaterThan(at('export "$name="'));
    expect(at('refusing: SUPABASE_URL_ARCHIVE is not a loopback URL')).toBeGreaterThan(at('. "$ENVF"'));
    expect(at('export COOP_REQUIRE_LOCAL_DB=1')).toBeGreaterThan(at('refusing: host is not loopback'));
    expect(at('exec npm run dev')).toBeGreaterThan(at('export NODE_OPTIONS='));
  });
});

// Explore mode opens a real Postgres connection. dev.sh refuses unless EXPLORE_DATABASE_URL is loopback (same rule as
// resolveExploreAccess and assertLocalPostgres: host read from the text after the FIRST '@', no host lists, no hosted names).
describe('dev.sh: EXPLORE_DATABASE_URL must be loopback too', () => {
  const LOCAL_EXPLORE = 'postgres://coop_explore_ro:pw@127.0.0.1:54421/postgres';
  const withExplore = (url: string) => tree({dotEnv: HOSTED_ENV, localEnv: `SUPABASE_URL_ARCHIVE=${LOCAL}\nSUPABASE_SERVICE_ROLE_KEY_ARCHIVE=k\nEXPLORE_DATABASE_URL=${url}\n`});

  it('passes a loopback postgres URL through to the child, and prints nothing of it', () => {
    for (const url of [LOCAL_EXPLORE, 'postgresql://coop_explore_ro:pw@localhost:54421/postgres', 'postgres://coop_explore_ro:pw@127.0.0.1/postgres?sslmode=disable']) {
      const r = run(withExplore(url));
      expect(r.status, `${url}: ${r.stderr}`).toBe(0);
      expect(r.env.EXPLORE_DATABASE_URL).toBe(url);
      expect(r.stdout + r.stderr).not.toContain('pw@');
    }
  });

  it('a hosted EXPLORE_DATABASE_URL in .env is blanked and replaced by the local one', () => {
    const t = tree({dotEnv: `${HOSTED_ENV}EXPLORE_DATABASE_URL=postgres://coop_explore_ro.fakeprojectref:hosted-fake@aws-0-fake.pooler.supabase.com:6543/postgres\n`,
      localEnv: `SUPABASE_URL_ARCHIVE=${LOCAL}\nSUPABASE_SERVICE_ROLE_KEY_ARCHIVE=k\nEXPLORE_DATABASE_URL=${LOCAL_EXPLORE}\n`});
    const r = run(t);
    expect(r.status, r.stderr).toBe(0);
    expect(r.env.EXPLORE_DATABASE_URL).toBe(LOCAL_EXPLORE);
    expect(JSON.stringify(r.env)).not.toMatch(/supabase\.com|hosted-fake/);
  });

  it('a hosted EXPLORE_DATABASE_URL in .env with no local replacement is blanked, so Explore has no database at all', () => {
    const t = tree({dotEnv: 'EXPLORE_DATABASE_URL=postgres://coop_explore_ro.fakeprojectref:hosted-fake@aws-0-fake.pooler.supabase.com:6543/postgres\n'});
    const r = run(t);
    expect(r.status, r.stderr).toBe(0);
    expect(r.env.EXPLORE_DATABASE_URL).toBe('');
  });

  it.each([
    ['the Supabase pooler', 'postgres://coop_explore_ro.fakeprojectref:pw@aws-0-fake.pooler.supabase.com:6543/postgres'],
    ['a hosted database', 'postgres://coop_explore_ro:pw@db.fakeprojectref.supabase.co:5432/postgres'],
    ['a private address', 'postgres://coop_explore_ro:pw@10.0.0.5:5432/postgres'],
    ['a look-alike host', 'postgres://coop_explore_ro:pw@127.0.0.1.evil.example/postgres'],
    ['an @-trick whose last host is loopback', 'postgres://coop_explore_ro:pw@evil.example@127.0.0.1/postgres'],
    ['a host list', 'postgres://coop_explore_ro:pw@127.0.0.1,evil.example/postgres'],
    ['an http URL', 'http://127.0.0.1:54421/postgres'],
  ])('%s: exit 1, "refusing", npm never runs, the URL is never echoed', (_name, url) => {
    const r = run(withExplore(url));
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/refusing: EXPLORE_DATABASE_URL/);
    expect(r.ranNpm).toBe(false);
    expect(r.stderr + r.stdout).not.toMatch(/pw@|supabase\.com|evil\.example/);
  });
});
