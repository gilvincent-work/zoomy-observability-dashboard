// Route glue for Explore (spec 10.5): decide access fail-closed, build the executor, the coverage line and the tool list. The only module
// outside src/chat/explore/ that imports client.ts. Nothing here runs unless resolveExploreAccess says `enabled`.
import 'server-only';
import {logExploreEvent, type AuditSink} from './audit';
import {createRunQuery} from './explore/client';
import {loadCoverageLine, loadLeadFacts} from './explore/coverage';
import {createExploreExecutor, type ExploreExecutor, type RunQuery} from './explore/executor';
import {resolveExploreAccess} from './explore/config';
import {validateExploreSql} from './explore/parse';
import {exploreDayCounter} from './explore/rate';
import type {ExploreEnv} from './explore/types';
import type {MetricResult} from './result-types';

export interface ExploreSetup {
  executor: ExploreExecutor;
  coverageLine: () => Promise<string | null>;
}

let offLogged = false;

/** null = Explore is off for this request (the tool is not sent, the prompt block is not added). Never throws. */
export function setupExplore(args: {env: ExploreEnv; email: string | null; now: Date; user: string | null; store: {set(id: string, r: MetricResult): void}; sink?: AuditSink; runQuery?: RunQuery}): ExploreSetup | null {
  try {
    const access = resolveExploreAccess(args.env, args.email);
    if (!access.enabled) {
      if (!offLogged) {
        offLogged = true;
        logExploreEvent('chat_explore_off', {reason: access.reason}, args.sink);
      }
      return null;
    }
    const runQuery = args.runQuery ?? createRunQuery(access);
    const {limits} = access;
    const executor = createExploreExecutor({
      runQuery, validate: validateExploreSql, limits, now: args.now, user: args.user, store: args.store, sink: args.sink,
      leadFacts: () => loadLeadFacts({runQuery, validate: validateExploreSql, limits, sink: args.sink}),
      dayGate: () => exploreDayCounter(args.user, limits.maxPerUserDay, args.now),
    });
    return {executor, coverageLine: () => loadCoverageLine({runQuery, validate: validateExploreSql, limits, sink: args.sink})};
  } catch {
    return null; // fail closed
  }
}
