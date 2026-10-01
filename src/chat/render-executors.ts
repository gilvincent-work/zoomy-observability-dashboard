// F7: the three render tools. Each binds the request to a stored result (bind.ts), emits the blocks to the stream and
// returns only a compact summary to the model: block ids and what was chosen, never the data. Pure, no server-only.
import {bindBlock, type RenderTool, type ResultStore} from './bind';
import type {ChosenView} from './block-types';
import type {ToolExecutors} from './tools';
import type {ChatToolContext} from './stream-types';

const TOOLS: readonly RenderTool[] = ['render_kpi', 'render_chart', 'render_table'];

const summary = (c: ChosenView) => ({form: c.form, orientation: c.orientation, reason: c.reason, adjustments: c.adjustments});

export function createRenderExecutors(ctx: ChatToolContext, store: ResultStore): Pick<ToolExecutors, RenderTool> {
  let counter = 0;
  const known: string[] = []; // block ids created in this turn, in order

  const run = (tool: RenderTool) => async (input: unknown): Promise<unknown> => {
    const target = input !== null && typeof input === 'object' && !Array.isArray(input) ? (input as {block?: unknown}).block : undefined;
    const reuse = typeof target === 'string' && target !== 'new' && target !== '' ? target : null;
    if (reuse !== null && !known.includes(reuse)) {
      return {error: `Unknown block '${reuse}'. Use "new"${known.length ? ` or one of: ${known.join(', ')}` : ' (no blocks have been drawn yet)'}.`};
    }
    // The first block reuses the id being replaced; any further block from the same call gets a new one.
    let pending = reuse;
    const nextId = (): string => {
      if (pending !== null) {
        const id = pending;
        pending = null;
        return id;
      }
      counter += 1;
      const id = `b${counter}`;
      known.push(id);
      return id;
    };
    const out = bindBlock(tool, input, store, nextId);
    if ('error' in out) return {error: out.error};
    for (const block of out.blocks) ctx.emitBlock?.(block);
    const ids = out.blocks.map((b) => b.id);
    const [first, ...rest] = out.chosen;
    return {
      ok: true,
      block: ids[0],
      ...(ids.length > 1 ? {blocks: ids} : {}),
      ...(first ? {chosen: summary(first)} : {}),
      ...(rest.length ? {also: rest.map(summary)} : {}),
    };
  };

  return Object.fromEntries(TOOLS.map((t) => [t, run(t)])) as Pick<ToolExecutors, RenderTool>;
}
