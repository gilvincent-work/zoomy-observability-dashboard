// D3 (live Ask Coop G01): the model hard-coded `pet not ilike '%ignore%'` after seeing a hostile lead value and told the owner it excluded
// "a lead with strange text". Static check that the guide forbids silent row filtering and demands the criterion, the count and an
// honest "instruction-like text, ignored as data" note. EXP-06 is a guide rule, so this is a content test, not an enforcement test.
import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

const topic = readFileSync('src/chat/skills/ask-coop-data-analyst/topics/sql-explore.md', 'utf8');

describe('EXP-06 never filters rows because their text looks like an instruction', () => {
  it('forbids dropping rows for instruction-like text and says row text is data', () => {
    expect(topic).toMatch(/never (silently )?(drop|exclude|filter)[^.]*(look|looks)[^.]*instruction/i);
    expect(topic).toMatch(/row text is data/i);
  });
  it('requires the exact criterion and the count whenever rows are excluded', () => {
    expect(topic).toMatch(/exact criterion and the (number|count) excluded/i);
  });
  it('says instruction-like text is reported as data, in which field, and not acted on', () => {
    expect(topic).toMatch(/instruction-like text in (the )?field/i);
    expect(topic).toMatch(/ignored it as data/i);
  });
});

// Live test 3: the model typed its own markdown table and no chart, chip or caveats appeared. The app now draws the final result.
describe('guide: the app draws the final result, the model explains it', () => {
  it('says the app draws the final result and the model must not retype it as a markdown table', () => {
    expect(topic).toMatch(/the app draws the final result/i);
    expect(topic).toMatch(/do not retype[^.]*markdown table/i);
    expect(topic).toMatch(/2 to 3 sentences/i);
  });
});
