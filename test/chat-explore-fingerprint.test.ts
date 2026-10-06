import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';
import {fingerprintStatement, shapeOf} from '../src/chat/explore/fingerprint';
import {validateExploreSql} from '../src/chat/explore/parse';
import {WRITE_CALL_EXCEPTIONS, writeCallsIn} from './support/chat-arch-scan';

// Spec 4.5 and 8: the audit fingerprint is the shape without literals; the literals hash is separate, truncated and one-way.
// Neither contains SQL text, a literal or a row.

const fp = async (sql: string) => {
  const r = await validateExploreSql(sql);
  if (!r.ok) throw new Error(`expected a valid statement: ${r.code}`);
  return r;
};
const Q = (name: string, n: number) => `select o.id, count(*) as orders_count from coop_explore_orders o where o.status = 'completed' and o.pet_type = '${name}' group by 1 limit ${n}`;

describe('EXP-02 fingerprint (audit)', () => {
  it('is 16 hex and the literals hash is 12 hex', async () => {
    const a = await fp(Q('dog', 5));
    expect(a.fingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(a.literalsHash).toMatch(/^[0-9a-f]{12}$/);
  });

  it('the same shape with different literals has the same fingerprint and a different literals hash', async () => {
    const a = await fp(Q('dog', 5));
    const b = await fp(Q('cat', 50));
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.literalsHash).not.toBe(b.literalsHash);
    // and the same literals hash again for the very same text
    expect((await fp(Q('dog', 5))).literalsHash).toBe(a.literalsHash);
  });

  it('a different shape changes the fingerprint (another column, another table, another function)', async () => {
    const base = (await fp(Q('dog', 5))).fingerprint;
    expect((await fp("select o.id, count(*) as orders_count from coop_explore_orders o where o.status = 'completed' and o.payment_method = 'dog' group by 1 limit 5")).fingerprint).not.toBe(base);
    expect((await fp("select o.id, sum(o.total) as total_php from coop_explore_orders o where o.status = 'completed' and o.pet_type = 'dog' group by 1 limit 5")).fingerprint).not.toBe(base);
    expect((await fp("select e.event_id, count(*) as events_count from coop_explore_events e where e.status = 'completed' and e.name = 'dog' group by 1 limit 5")).fingerprint).not.toBe(base);
  });

  it('whitespace, comments and keyword case do not matter (it hashes the parse tree, not the text)', async () => {
    const a = await fp('select o.id from coop_explore_orders o where o.status = \'completed\'');
    const b = await fp("SELECT   o.id\n FROM coop_explore_orders o /* hello */ WHERE o.status = 'completed' -- tail");
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.literalsHash).toBe(b.literalsHash);
  });

  it('never carries SQL text or a literal: the output is only hex', async () => {
    const r = await fp("select o.id from coop_explore_orders o where o.customer_handle = 'Maria Santos'");
    for (const field of [r.fingerprint, r.literalsHash]) {
      expect(field).toMatch(/^[0-9a-f]+$/);
      expect(field).not.toMatch(/maria|santos/i);
    }
    expect(JSON.stringify({fingerprint: r.fingerprint, literalsHash: r.literalsHash})).not.toMatch(/Maria|Santos|customer_handle/);
  });

  it('shapeOf replaces every A_Const with ? and drops every location; it collects the constants in order', () => {
    const ast = {SelectStmt: {where: {A_Const: {ival: {ival: 7}, location: 3}}, list: [{A_Const: {sval: {sval: 'x'}, location: 9}}], location: 1}};
    const {shape, constants} = shapeOf(ast);
    expect(shape).toEqual({SelectStmt: {where: '?', list: ['?']}});
    expect(constants).toEqual([{ival: {ival: 7}}, {sval: {sval: 'x'}}]);
    expect(fingerprintStatement(ast).literalCount).toBe(2);
  });

  it('a query with no literals has a stable literals hash (the hash of an empty list)', async () => {
    const a = await fp('select o.id from coop_explore_orders o');
    const b = await fp('select o.id from coop_explore_orders o;');
    expect(a.literalsHash).toBe(b.literalsHash);
  });
});

describe('EXP-02 the pinned .update( exception (lesson fix-the-gate-not-the-code)', () => {
  it('fingerprint.ts is a named exception for exactly the method update', () => {
    const e = WRITE_CALL_EXCEPTIONS.filter((x) => x.file === 'src/chat/explore/fingerprint.ts');
    expect(e).toEqual([expect.objectContaining({method: 'update'})]);
    expect(e[0].why.length).toBeGreaterThan(10);
  });
  it('the real file uses the hashing call, and is allowed to', () => {
    const src = readFileSync('src/chat/explore/fingerprint.ts', 'utf8');
    expect(src).toMatch(/createHash\('sha256'\)\.update\(/);
    expect(writeCallsIn({'src/chat/explore/fingerprint.ts': src})).toEqual([]);
  });
  it('the same hashing call in any other file under src/chat is still flagged', () => {
    const call = "const h = createHash('sha256').update(s).digest('hex');";
    expect(writeCallsIn({'src/chat/explore/parse.ts': call})).toHaveLength(1);
    expect(writeCallsIn({'src/chat/explore/executor.ts': call})).toHaveLength(1);
    expect(writeCallsIn({'src/chat/audit.ts': call})).toHaveLength(1);
  });
  it('another write method in fingerprint.ts is still flagged', () => {
    expect(writeCallsIn({'src/chat/explore/fingerprint.ts': "await db.from('t').insert({a: 1});"})).toHaveLength(1);
    expect(writeCallsIn({'src/chat/explore/fingerprint.ts': "await db.from('t').delete().eq('id', 1);"})).toHaveLength(1);
  });
  it('only fingerprint.ts under src/chat/explore calls .update( at all', () => {
    for (const f of ['parse.ts', 'types.ts', 'views.ts', 'limits.ts']) {
      expect(readFileSync(`src/chat/explore/${f}`, 'utf8').replace(/\/\/.*$/gm, '')).not.toMatch(/\.update\(/);
    }
  });
});
