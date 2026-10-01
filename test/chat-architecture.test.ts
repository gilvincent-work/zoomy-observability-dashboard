import {describe, expect, it} from 'vitest';
import {
  LEGACY_ALLOWED_IMPORTS,
  LEGACY_ROUTE,
  WRITE_CALL_EXCEPTIONS,
  buildClosure,
  extractImports,
  forbiddenInClosure,
  loadRealTree,
  strip,
  supabaseImporters,
  writeCallsIn,
  type FileMap,
} from './support/chat-arch-scan';

describe('real tree', () => {
  const {files, entries} = loadRealTree(process.cwd());
  const closure = buildClosure(entries, files);

  it('chat closure contains no actions, use-server, pos-data, data, crm or reports-write modules', () => {
    expect(forbiddenInClosure(closure, files)).toEqual([]);
  });

  it('only src/chat/read/client.ts imports @supabase/supabase-js under src/chat', () => {
    const importers = supabaseImporters(files);
    expect(importers.filter((f) => f !== 'src/chat/read/client.ts')).toEqual([]);
  });

  it('src/chat has no write-method calls', () => {
    expect(writeCallsIn(files)).toEqual([]);
  });

  it('the legacy exception is exactly the old digest import and is not traversed', () => {
    expect(closure.legacyHits).toEqual(['src/data.ts']);
    expect(closure.files.has('src/data.ts')).toBe(false);
  });
});

describe('LEGACY_ALLOWED_IMPORTS', () => {
  it('has exactly one entry so it can only shrink deliberately', () => {
    expect(LEGACY_ALLOWED_IMPORTS).toEqual(['src/data.ts']);
  });
});

describe('scanner rules fire on planted violations', () => {
  const base: FileMap = {
    'src/chat/ok.ts': "import {x} from './util';\nexport const y = x;",
    'src/chat/util.ts': 'export const x = 1;',
    'src/pos-data.ts': "export const posClient = () => null;",
    'src/data.ts': 'export const getDigests = () => [];',
    'src/foo-actions.ts': "'use server';\nexport async function save() {}",
    'src/crm-x.ts': 'export const c = 1;',
    'src/plain.ts': "'use server'\nexport const p = 1;",
    [LEGACY_ROUTE]: "import {getDigests} from '@/src/data';\nimport {x} from '@/src/chat/ok';",
  };
  const run = (extra: FileMap, entries = ['src/chat/ok.ts', ...Object.keys(extra).filter((f) => f.startsWith('src/chat/'))]) => {
    const files = {...base, ...extra};
    return {files, closure: buildClosure(entries, files)};
  };

  it('clean baseline passes', () => {
    const {files, closure} = run({});
    expect(forbiddenInClosure(closure, files)).toEqual([]);
    expect(writeCallsIn(files)).toEqual([]);
  });

  it('planted import of src/pos-data.ts fails', () => {
    const {files, closure} = run({'src/chat/bad.ts': "import {posClient} from '@/src/pos-data';"});
    expect(forbiddenInClosure(closure, files).join()).toContain('src/pos-data.ts');
  });

  it('planted transitive import of an actions file fails', () => {
    const {files, closure} = run({
      'src/chat/bad.ts': "import {h} from './helper';",
      'src/chat/helper.ts': "export {save as h} from '../foo-actions';",
    });
    expect(forbiddenInClosure(closure, files).join()).toContain('src/foo-actions.ts');
  });

  it('planted dynamic import and crm module fail', () => {
    const {files, closure} = run({'src/chat/bad.ts': "export const f = () => import('../crm-x');"});
    expect(forbiddenInClosure(closure, files).join()).toContain('src/crm-x.ts');
  });

  it("planted 'use server' file (not named -actions) fails", () => {
    const {files, closure} = run({'src/chat/bad.ts': "import {p} from '../plain';"});
    expect(forbiddenInClosure(closure, files).join()).toContain("'use server' directive");
  });

  it('a type-only import is ignored', () => {
    const {files, closure} = run({'src/chat/t.ts': "import type {posClient} from '@/src/pos-data';"});
    expect(forbiddenInClosure(closure, files)).toEqual([]);
  });

  it('planted second supabase-js importer is reported, the allowed one is not a violation', () => {
    const files: FileMap = {
      'src/chat/read/client.ts': "import {createClient} from '@supabase/supabase-js';",
      'src/chat/other.ts': "import {createClient} from '@supabase/supabase-js';",
      'src/chat/types-only.ts': "import type {SupabaseClient} from '@supabase/supabase-js';",
    };
    expect(supabaseImporters(files)).toEqual(['src/chat/other.ts', 'src/chat/read/client.ts']);
  });

  it.each(['.insert(', '.update(', '.upsert(', '.delete(', '.rpc('])('planted %s call fails', (call) => {
    expect(writeCallsIn({'src/chat/bad.ts': `const r = await db.from('t')${call}{a: 1});`})).toHaveLength(1);
  });

  it('write-call words inside comments and strings are ignored, and test files are skipped', () => {
    const files: FileMap = {
      'src/chat/doc.ts': "// never call db.insert(x)\n/* .rpc( */\nconst s = 'x.update(y)';\nconst t = `.delete(`;",
      'src/chat/a.test.ts': 'db.insert(1);',
    };
    expect(writeCallsIn(files)).toEqual([]);
  });

  it('the crypto update exception covers exactly one file and one method', () => {
    expect(WRITE_CALL_EXCEPTIONS.map((e) => `${e.file}:${e.method}`)).toEqual(['src/chat/read/mint-jwt.ts:update']);
    // same call, allowed file: ignored
    expect(writeCallsIn({'src/chat/read/mint-jwt.ts': "const sig = createHmac('sha256', k).update(data).digest();"})).toEqual([]);
    // same call, any other file: still flagged
    expect(writeCallsIn({'src/chat/other.ts': "const sig = createHmac('sha256', k).update(data).digest();"})).toHaveLength(1);
    // another write method, allowed file: still flagged
    expect(writeCallsIn({'src/chat/read/mint-jwt.ts': "await db.from('t').insert({a: 1});"})).toHaveLength(1);
    expect(writeCallsIn({'src/chat/read/mint-jwt.ts': "await db.from('t').delete().eq('id', 1);"})).toHaveLength(1);
  });

  it('the legacy allowance applies only to the route and is not traversed', () => {
    const {closure} = run({}, [LEGACY_ROUTE]);
    expect(closure.legacyHits).toEqual(['src/data.ts']);
    expect(closure.files.has('src/data.ts')).toBe(false);
    const {files, closure: c2} = run({'src/chat/bad.ts': "import {getDigests} from '@/src/data';"});
    expect(forbiddenInClosure(c2, files).join()).toContain('src/data.ts');
  });

  it('extractImports and strip basics', () => {
    expect(extractImports("import a from 'x';\nimport 'y';\nexport * from './z';\nimport type {T} from 't';")).toEqual(['x', 'y', './z']);
    expect(strip("a('//x') // c", true)).not.toContain('c');
  });
});
