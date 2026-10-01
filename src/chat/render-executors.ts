// F7 + F8: the three render tools. Each binds the request to a stored result (bind.ts), emits the blocks to the stream and
// returns only a compact summary to the model: block ids and what was chosen, never the data. With a report open (F8) a
// render call may re-bind ANY block of it (`block: 'bN'`), `source` may be a result id or a block id, and every
// successful call is recorded into the report spec, which is then emitted. Pure, no server-only.
import {bindBlock, type RenderTool} from './bind';
import type {ChatBlock, ChosenView} from './block-types';
import {filtersOf, queryOf, sameFilters} from './report-spec';
import {REPORT_FULL, type ReportSession} from './report-session';
import {REPORT_MAX_BLOCKS, type ReportBlockSpec, type ReportQuery} from './report-types';
import type {ToolExecutors} from './tools';
import type {ChatToolContext} from './stream-types';

const TOOLS: readonly RenderTool[] = ['render_kpi', 'render_chart', 'render_table'];
const BLOCK_ID = /^b[1-9][0-9]{0,2}$/;
const MAX_Y = 8;

const summary = (c: ChosenView) => ({form: c.form, orientation: c.orientation, reason: c.reason, adjustments: c.adjustments});
const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x !== '') : []);

/** The recipe of one emitted block: the query it came from and the view the tool call asked for. */
function specOf(tool: RenderTool, input: Record<string, unknown>, block: ChatBlock, query: ReportQuery): ReportBlockSpec {
  if (block.kind === 'kpi') return {id: block.id, kind: 'kpi', query, view: {value: String(input.value), label: block.label, format: block.format}};
  if (block.kind === 'table') {
    const wanted = tool === 'render_table' ? strings(input.columns) : [];
    return {id: block.id, kind: 'table', query, view: {columns: wanted.length ? wanted : ['auto'], title: block.title}};
  }
  const kind = typeof input.kind === 'string' ? input.kind : 'auto';
  const orientation = input.orientation === 'vertical' || input.orientation === 'horizontal' ? input.orientation : 'auto';
  const x = typeof input.x === 'string' && input.x !== '' ? input.x : 'auto';
  const y = strings(input.y).slice(0, MAX_Y);
  return {id: block.id, kind: 'chart', query, view: {kind, orientation, mode: kind === 'auto' ? 'auto' : 'user', x, y: y.length ? y : ['auto'], title: block.title}};
}

export function createRenderExecutors(ctx: ChatToolContext, session: ReportSession): Pick<ToolExecutors, RenderTool> {
  const run = (tool: RenderTool) => async (input: unknown): Promise<unknown> => {
    const rec = isRecord(input) ? input : {};
    const target = rec.block;
    const reuse = typeof target === 'string' && target !== 'new' && target !== '' ? target : null;
    const ids = session.ids();
    if (reuse !== null && !session.has(reuse)) {
      return {error: `Unknown block '${reuse}'. Use "new"${ids.length ? ` or one of: ${ids.join(', ')}` : ' (no blocks have been drawn yet)'}.`};
    }
    // A block id as `source` must name a block that is still on the dashboard (a removed block's result is gone).
    const source = typeof rec.source === 'string' ? rec.source : '';
    if (BLOCK_ID.test(source) && !session.has(source)) {
      return {error: `Unknown result '${source}'. ${ids.length ? `Blocks on the dashboard: ${ids.join(', ')}.` : 'There are no blocks yet.'} Use a query_metric result id or a block id.`};
    }
    const request = session.requestOf(source);
    // Criterion 10: every block shares the dashboard's filters. A source asked with other filters must not slip in.
    if (request && session.size() > 0 && !sameFilters(filtersOf(request), session.filters())) {
      return {error: `Result '${source}' was asked with different filters than the dashboard. Do not mix scopes: call set_report_filters to change the filters of every block, then query again with the dashboard's filters.`};
    }

    let pending = reuse;
    let n = session.counter();
    const nextId = (): string => {
      if (pending !== null) {
        const id = pending;
        pending = null;
        return id;
      }
      n += 1;
      return `b${n}`;
    };
    const out = bindBlock(tool, input, session.store, nextId);
    if ('error' in out) return {error: out.error};
    const added = out.blocks.length - (reuse !== null ? 1 : 0);
    if (session.size() + added > REPORT_MAX_BLOCKS) return {error: REPORT_FULL};

    if (request) {
      if (session.size() === 0) session.adoptFilters(filtersOf(request));
      const query = queryOf(request);
      for (const block of out.blocks) {
        session.record(specOf(tool, rec, block, query));
        session.alias(block.id, source);
      }
    }
    for (const block of out.blocks) ctx.emitBlock?.(block);
    ctx.emitReport?.(session.snapshot());
    const blockIds = out.blocks.map((b) => b.id);
    const [first, ...rest] = out.chosen;
    return {
      ok: true,
      block: blockIds[0],
      ...(blockIds.length > 1 ? {blocks: blockIds} : {}),
      ...(first ? {chosen: summary(first)} : {}),
      ...(rest.length ? {also: rest.map(summary)} : {}),
    };
  };

  return Object.fromEntries(TOOLS.map((t) => [t, run(t)])) as Pick<ToolExecutors, RenderTool>;
}
