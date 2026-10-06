import {describe, expect, it} from 'vitest';
import {trailingRepeat} from '../src/chat/degenerate';

describe('trailingRepeat', () => {
  it('flags a runaway tag', () => expect(trailingRepeat(`ok ${'<br> '.repeat(30)}`)).not.toBeNull());
  it('ignores a long horizontal rule or dashed table row', () => {
    expect(trailingRepeat('-'.repeat(60))).toBeNull();
    expect(trailingRepeat(`|${'---|'.repeat(25)}`)).toBeNull();
  });
  it('ignores normal prose', () => expect(trailingRepeat('Revenue was 117,639 for September.')).toBeNull());
});
