// Every worked example the model is shown must pass the real validator (spec 6.6), or the prompt would teach SQL the gate refuses.
import {describe, expect, it} from 'vitest';
import {EXPLORE_EXAMPLES} from '../src/chat/explore/examples';
import {validateExploreSql} from '../src/chat/explore/parse';

describe('EXP-02 the worked examples pass the real validator', () => {
  it('EXP-02 there are 18 examples', () => {
    expect(EXPLORE_EXAMPLES).toHaveLength(18);
  });
  it.each(EXPLORE_EXAMPLES.map((e) => [e.id, e.sql]))('EXP-02 %s is accepted', async (_id, sql) => {
    const v = await validateExploreSql(sql);
    expect(v.ok, v.ok ? '' : `${v.code}`).toBe(true);
  });
});
