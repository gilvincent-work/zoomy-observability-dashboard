// F8: the three tools that edit the open dashboard without drawing anything new: set_report_filters, remove_block,
// set_report_title. The model passes enums, a block id from the outline and a short title, never a number. Each
// successful call updates the session, emits the re-bound blocks (same ids: the drawer replaces them in place) and
// then the report. Pure: the session and `data` are injected.
import {plainText} from './bind';
import {CHANNELS, PETS, RANGES} from './report-spec';
import type {FilterPatch, ReportSession} from './report-session';
import type {ChatToolContext} from './stream-types';
import type {MetricData} from './result-types';
import type {ToolExecutors} from './tools';

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const list = (xs: readonly string[]): string => xs.join(', ');

const NO_REPORT = 'There is no dashboard open yet, so there is nothing to change. Query the data and draw it first.';

function realDay(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const ms = Date.parse(`${v}T00:00:00Z`);
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === v;
}

/** 'keep' leaves a field unchanged. Returns the patch, or {error} in plain words listing the allowed values. */
function parseFilters(input: unknown): {patch: FilterPatch} | {error: string} {
  if (!isRecord(input)) return {error: 'The request must be an object with the fields in the tool schema.'};
  const patch: FilterPatch = {};
  const {range, from, to, pet, event, channel} = input;
  if (range !== 'keep') {
    if (typeof range !== 'string' || !(RANGES as readonly string[]).includes(range)) return {error: `range is not allowed. Allowed values: keep, ${list(RANGES)}.`};
    patch.range = range as FilterPatch['range'];
    if (range === 'custom') {
      if (!realDay(from) || !realDay(to)) return {error: 'range custom needs from and to as real YYYY-MM-DD dates (Philippine time).'};
      patch.from = from;
      patch.to = to;
    }
  }
  if (pet !== 'keep') {
    if (typeof pet !== 'string' || !(PETS as readonly string[]).includes(pet)) return {error: `pet is not allowed. Allowed values: keep, ${list(PETS)}.`};
    patch.pet = pet as FilterPatch['pet'];
  }
  if (channel !== 'keep') {
    if (typeof channel !== 'string' || !(CHANNELS as readonly string[]).includes(channel)) return {error: `channel is not allowed. Allowed values: keep, ${list(CHANNELS)}.`};
    patch.channel = channel as FilterPatch['channel'];
  }
  if (event !== 'keep') {
    const name = plainText(event);
    if (name === '') return {error: 'event must be "keep", "all" or an event name.'};
    patch.event = name;
  }
  if (Object.keys(patch).length === 0) return {error: 'Nothing to change: every field was "keep".'};
  return {patch};
}

export function createReportExecutors(ctx: ChatToolContext, session: ReportSession, data: () => Promise<MetricData>): Pick<ToolExecutors, 'set_report_filters' | 'remove_block' | 'set_report_title'> {
  const validIds = (): string => (session.ids().length ? `Blocks on the dashboard: ${session.ids().join(', ')}.` : 'The dashboard has no blocks.');

  return {
    set_report_filters: async (input) => {
      const loaded = await data();
      if (session.size() === 0) return {error: NO_REPORT};
      const parsed = parseFilters(input);
      if ('error' in parsed) return {error: parsed.error};
      const out = session.setFilters(parsed.patch, loaded, ctx.now);
      if (!out.ok) return {error: out.error};
      for (const block of out.blocks) ctx.emitBlock?.(block);
      ctx.emitReport?.(session.snapshot());
      const f = session.filters();
      return {ok: true, filters: {range: f.range, from: f.from, to: f.to, pet: f.pet, event: f.event, channel: f.channel}, blocks: out.coverage};
    },
    remove_block: async (input) => {
      const id = isRecord(input) && typeof input.block === 'string' ? input.block : '';
      if (!session.has(id)) return {error: `Unknown block '${id.slice(0, 20)}'. ${validIds()}`};
      session.remove(id);
      ctx.emitReport?.(session.snapshot());
      return {ok: true, removed: id, blocks: session.ids()};
    },
    set_report_title: async (input) => {
      const title = isRecord(input) ? plainText(input.title) : '';
      if (title === '') return {error: 'Give the dashboard a short plain title.'};
      session.setTitle(title);
      ctx.emitReport?.(session.snapshot());
      return {ok: true};
    },
  };
}
