// Shared by the Explore end-to-end and injection tests: a scripted model, the real parser and executor, a fake driver. No network.
import {createReportSession} from '../../src/chat/report-session';
import {runChatLoop} from '../../src/chat/loop';
import {exploreTools} from '../../src/chat/tool-defs';
import {createExecutors} from '../../src/chat/tool-executors';
import {createExploreExecutor, type RunQuery} from '../../src/chat/explore/executor';
import type {LeadFacts} from '../../src/chat/explore/basis';
import {validateExploreSql} from '../../src/chat/explore/parse';
import {DEFAULT_EXPLORE_LIMITS} from '../../src/chat/explore/limits';
import type {ChatBlock} from '../../src/chat/block-types';
import type {ChatStreamEvent} from '../../src/chat/stream-types';
import {FakeModel, sink} from './fake-model';

export function harness(runQuery: RunQuery, script: ConstructorParameters<typeof FakeModel>[0], question = 'Anong pet ang pinaka-nabenta?', extra: {leadFacts?: LeadFacts} = {}) {
  const session = createReportSession();
  const s = sink();
  const blocks: ChatBlock[] = [];
  const events: ChatStreamEvent[] = [];
  const explore = createExploreExecutor({runQuery, validate: validateExploreSql, limits: DEFAULT_EXPLORE_LIMITS, now: new Date('2026-10-05T00:00:00Z'), user: 'dev@localhost', store: session.store, sink: s, ...(extra.leadFacts ? {leadFacts: async () => extra.leadFacts as LeadFacts} : {})});
  const model = new FakeModel(script);
  const executors = createExecutors({data: async () => { throw new Error('registry data must not load'); }, now: new Date('2026-10-05T00:00:00Z'), user: 'dev@localhost', emitBlock: (b) => { blocks.push(b); events.push({t: 'block', block: b}); }, report: session, explore});
  const go = () => runChatLoop({
    client: model, model: 'fake', maxTokens: 100, effort: 'medium', system: [{type: 'text', text: 'S'}], tools: exploreTools(),
    messages: [{role: 'user', content: question}], preamble: '[context] Today is Monday.', executors,
    emit: (e) => events.push(e), user: 'dev@localhost', sink: s, exploreGap: explore.gap,
  });
  return {go, blocks, events, s, model, session};
}


export const text = (events: ChatStreamEvent[]) => events.filter((e) => e.t === 'text').map((e) => (e as {d: string}).d).join('');
