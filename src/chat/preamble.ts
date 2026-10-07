// F4: the per-turn coverage block and the static catalog for the cached system prompt. Pure.
import {buildCoverage, phtDate} from './coverage';
import {METRICS, METRIC_IDS} from './metrics-registry';
import type {MetricData} from './result-types';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const FULL_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const shortDate = (key: string): string => `${Number(key.slice(8, 10))} ${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;

function longToday(now: Date): string {
  const pht = new Date(now.getTime() + 8 * 3600_000);
  return `${WEEKDAYS[pht.getUTCDay()]}, ${pht.getUTCDate()} ${FULL_MONTHS[pht.getUTCMonth()]} ${pht.getUTCFullYear()}`;
}

const NOT_AVAILABLE_BASE = 'Not available: Traffic (sample data only), Meta ads (not connected), Shopee/Lazada/Website sales (weekly digest only). Pet type and event ARE available (pet_mix, event_rollup): run once per event or pet.';
const NOT_AVAILABLE_NO_EXPLORE = 'Contact details (email, phone, instagram) are not exposed by the metrics. Questions no metric covers cannot be answered.';
const EXPLORE_AVAILABLE = 'For questions no metric covers (contacts, leads, stock, voided orders, hours), use run_query on the Explore views.';
const notAvailable = (explore: boolean): string => `${NOT_AVAILABLE_BASE} ${explore ? EXPLORE_AVAILABLE : NOT_AVAILABLE_NO_EXPLORE}`;

/** Per-turn context when the live-data path is unavailable: today's date and an honest "not available" (no data, no figures). */
export function buildDegradedPreamble(now: Date): string {
  return `[context] Today is ${longToday(now)} (Philippine time; ${phtDate(now)}). Live offline POS data is not available right now. ${notAvailable(false)}`;
}

/** `outline` is the figure-free text of the open report (F8), or '' / absent when none is open. It rides in the per-turn preamble only, never in the cached system or tools. */
export function buildPreamble(data: MetricData, now: Date, outline?: string, exploreCoverage?: string | null, opts: {explore?: boolean; page?: string | null} = {}): string {
  const c = buildCoverage(data);
  const head = `[context] Today is ${longToday(now)} (Philippine time; ${phtDate(now)}).`;
  let cover: string;
  if (c.orders === 0 || c.dataFrom === null || c.dataTo === null) {
    cover = 'There is no order data yet.';
  } else {
    const share = c.untaggedShare === null ? '' : `; ${Math.round(c.untaggedShare)}% have no pet tag`;
    const lead = c.source === 'mock' ? 'The data is sample data, not real sales, and covers' : 'Offline POS data is live and covers';
    cover = `${lead} ${shortDate(c.dataFrom)} to ${shortDate(c.dataTo)} (${c.orders} completed orders${share}).`;
  }
  const base = `${head} ${cover} ${notAvailable(opts.explore === true)} If a question is outside this range, say what the data covers.`;
  const withPage = opts.page ? `${base}\n${opts.page}` : base;
  const withCoverage = exploreCoverage ? `${withPage}\n${exploreCoverage}` : withPage;
  return outline ? `${withCoverage}\n${outline}` : withCoverage;
}

const TOOL_RULES =
  'Tool rules: every tool parameter is required. Use "none", "all" or "default" when a parameter does not apply, and "" for from and to. ' +
  'Pass dates only when range is "custom" (YYYY-MM-DD, Philippine time). Never pass keys that are not in the schema. ' +
  'Every number in an answer must come from a tool result.';

export function buildStaticCatalog(): string {
  const lines: string[] = ['Metric catalog (the only numbers you can query):'];
  for (const id of METRIC_IDS) {
    const m = METRICS[id];
    lines.push(`- ${m.id}: ${m.label}. ${m.description}`);
    lines.push(`  dimensions: ${m.dimensions.map((d) => d.key).join(', ')} (default ${m.defaultDimension})`);
    for (const x of m.measures) lines.push(`  measure ${x.key} [${x.kind}]: ${x.method}`);
    lines.push(`  default measure ${m.defaultMeasure}; pet filter ${m.supportsPet ? 'yes' : 'no'}, event filter ${m.supportsEvent ? 'yes' : 'no'}, compare ${m.supportsCompare ? 'yes' : 'no'}`);
  }
  lines.push(TOOL_RULES);
  return lines.join('\n');
}
