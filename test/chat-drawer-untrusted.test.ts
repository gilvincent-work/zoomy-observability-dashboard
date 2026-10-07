// Train 4 drawer wiring, without a browser or an export: the drawer's own `loadMessages` is cut out of the source, transpiled and run
// (the file cannot be imported in node: it uses the @/ alias and React). The untrusted flag survives a reload only when it is exactly
// true, and the drawer feeds it to the markdown renderer's known-hosts-only mode.
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {describe, expect, it} from 'vitest';
import {sanitizeBlocks} from '../components/analyst/chat-blocks-format';

const src = readFileSync('components/analyst/coop-chat.tsx', 'utf8');
const start = src.indexOf('function loadMessages(');
const end = src.indexOf('\n}\n', start) + 3;
const js = ts.transpileModule(src.slice(start, end), {compilerOptions: {target: ts.ScriptTarget.ES2022}}).outputText;
const loadMessages = new Function('sanitizeBlocks', `${js}\nreturn loadMessages;`)(sanitizeBlocks) as (raw: string) => Record<string, unknown>[];
const load = (m: Record<string, unknown>) => loadMessages(JSON.stringify([{role: 'assistant', content: 'hi', ...m}]))[0];

describe('loadMessages keeps untrusted: true and drops anything else', () => {
  it('found the real function', () => expect(start).toBeGreaterThan(0));
  it('keeps exactly true', () => expect(load({untrusted: true})).toMatchObject({untrusted: true}));
  it.each([['false', false], ['string', 'true'], ['one', 1], ['null', null], ['object', {}]])('drops %s', (_n, v) => expect('untrusted' in load({untrusted: v})).toBe(false));
  it('an absent flag stays absent', () => expect('untrusted' in load({})).toBe(false));
});

describe('the drawer passes the flag to the renderer', () => {
  it('knownHostsOnly is driven by m.untrusted', () => expect(src).toMatch(/knownHostsOnly=\{m\.untrusted === true \|\|/));
  it('the flag is not sent back to the server with the history', () => expect(src).toMatch(/blocks: _blocks, untrusted: _untrusted, \.\.\.rest/));
});
