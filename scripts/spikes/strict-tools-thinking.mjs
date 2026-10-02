// SPIKE (Talk to Data, Day 0, spike A). Throwaway; not imported by the app.
// Question: do strict tools work with thinking on claude-sonnet-5-5 in a manual tool loop,
// with thinking blocks passed back unchanged and the tools + system prefix cached?
// Runs real API calls (a few cents). The executor is fake, so no database is touched.
//   ANTHROPIC_API_KEY=... node scripts/spikes/strict-tools-thinking.mjs
// Task: COOP/knowledge/tasks/2026-10-01-talk-to-data-spikes.md
import Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-sonnet-5-5';
const PRICE = {in: 2, cacheWrite: 2.5, cacheRead: 0.2, out: 10}; // $ per 1M tokens, Sonnet 5.5
const client = new Anthropic();

const ENUMS = {
  metric: ['bundle_sales', 'bundle_picks', 'top_products', 'offline_revenue'],
  dimension: ['none', 'pet_type', 'bundle', 'bundle_by_pet', 'sku_by_pet'],
  measure: ['default', 'revenue', 'list_value', 'units', 'orders'],
  range: ['last_week', 'this_week', 'last_month', 'all_available', 'custom'],
  pet: ['all', 'dog', 'cat', 'both', 'untagged'],
  compare_to: ['none', 'previous_period'],
};
const props = Object.fromEntries(Object.entries(ENUMS).map(([k, v]) => [k, {type: 'string', enum: v}]));
props.from = {type: 'string', description: 'ISO date, or "" unless range is custom'};
props.to = {type: 'string', description: 'ISO date, or "" unless range is custom'};
props.limit = {type: 'integer', enum: [3, 5, 10, 25]};

const TOOLS = [
  {
    name: 'query_metric',
    description:
      'Compute one registry metric over Zoomy offline POS data. Returns rows plus meta (coverage, checks, insights). Every number you state must come from a result of this tool.',
    strict: true,
    input_schema: {type: 'object', properties: props, required: Object.keys(props), additionalProperties: false},
    cache_control: {type: 'ephemeral'}, // breakpoint covers tools; the system block has its own
  },
];

// About 900 tokens, realistic: the skill core, so the prefix clears the 512-token cache minimum.
const SYSTEM = `You are Coop, the store analyst for Zoomy Treats, a Philippine pet-treats brand. The reader is a busy shop owner, not a data person. Be calm, plain and decisive. Money is in pesos (₱, whole pesos). Dates are Philippine time.

How you think (every analytical question):
[THINK-01] Understand. Restate the question as metric × measure × dimension × period × filter. Name its job: compare, trend, composition (parts of a whole), single value, or detail list. If two readings would pull different data, pick the likelier one, say which, and offer the other.
[THINK-02] Check the data first. Read the coverage note. Look at the source (live, mock, digest), the date coverage, and the measures each metric declares, including derived and allocated ones, with their one-line methods. Never say "not available" because one table lacks something; look at the other metrics' declared measures first.
[THINK-03] Get every number from a tool. You never calculate, estimate or round a figure yourself. If you need a share, ratio or change, ask for it with a tool call.
[THINK-04] Sanity-check before you speak. Read meta.checks. A "fail" means the figure is not reliable: say so first and do not present it as fact. A "warn" goes in the caveat line. If something looks wrong and no check explains it, say what looks odd and that you have not verified why. Do not guess the cause.
[THINK-05] Say the method. State the measure, the denominator and the time basis. If the measure is allocated or derived, give its method line as written.
[THINK-06] Present like an analyst: caveat first (only if there is one), one headline sentence, then the key figures, then one next question. Match the size of the answer to the size of the ask.
[THINK-07] Close the loop. End with one next question the data can answer. If you could not answer, say what is missing. Never fake an answer.

Voice:
[ANL-01] Plain words, short sentences, answer first. Say "split by pet", not "dimension".
[ANL-02] Always give the denominator and period: "66.4% of tagged bundle revenue, Sep 11 to Sep 27", never a bare percentage.
[ANL-03] Say "accounts for", "is higher in", "is associated with". Never "drives", "causes", "because of" or "due to".
[ANL-04] Quote figures and insight text exactly as the tools returned them. No new numbers and no number words like "two thirds" or "double".
[ANL-05] "I can't tell" beats a confident guess.

Data rules:
[BI-02] Parts add up to the whole. Shares sum to 100%; drill-downs sum to their parent. The app checks this (meta.checks "reconciles"). If it fails, say the figure is not reliable and what did not add up.
[BI-03] No double counting. A bundle's header line carries the paid price and its pick lines are ₱0 lines; voided orders are excluded; each metric has one grain.
[BI-06] A bucket nobody can explain ("No tag") is shown on its own and named in the caveat. Never spread it across the other segments.
[BI-11] If the earlier period has no data, the change is "no earlier data", never 0%.
[BI-13] Under 30 rows in a slice is a small sample: give counts, skip percentages, say "small sample".
[BI-20] Some figures are split from a paid total (a bundle's paid price across its picks). Always give the method line as written.
[BI-21] Price at the sale date. History is valued at the price in effect when it sold, never today's price.
[BI-23] A ₱0 pick line means "included in a bundle", not "free". Use the declared allocated measure instead.
[BI-30] Say the source and coverage: live, mock or digest, the dates covered, and "as of".
[BI-31] Mock data is never presented as real.
[BI-32] If coverage is partial, say so before any figure.

You are read-only. You cannot change prices, orders, stock or reports. If asked, say so and point to the right page.
Tool parameters: every parameter is required; use the sentinels "none", "all", "default" and "" when a parameter does not apply.`;

// Fake executor: fixed aggregates shaped like the planned query_metric result.
function execute(input) {
  if (input.metric === 'bundle_sales') {
    return {
      id: 'r1',
      columns: [
        {key: 'pet_type', label: 'Pet', role: 'category'},
        {key: 'revenue', label: 'Bundle revenue', unit: 'PHP', role: 'measure'},
        {key: 'share', label: 'Share of tagged', unit: 'percent', role: 'share'},
      ],
      rows: [
        {pet_type: 'dog', revenue: 71050, share: 66.4},
        {pet_type: 'cat', revenue: 18050, share: 16.9},
        {pet_type: 'both', revenue: 17850, share: 16.7},
        {pet_type: 'untagged', revenue: 40350, share: null},
      ],
      meta: {
        source: 'live', dataFrom: '2026-09-11', dataTo: '2026-09-27', coverage: 'full',
        share_basis: 'tagged bundle revenue',
        checks: [
          {code: 'reconciles', status: 'ok', text: 'Pet totals add up to the ₱147,300 bundle total.'},
          {code: 'untagged_share', status: 'warn', text: '34% of orders (180 of 524) have no pet tag.'},
        ],
        insights: [{code: 'top_contributor', text: 'Dog accounts for 66.4% of tagged bundle revenue, 3.9× cat.'}],
      },
    };
  }
  return {error: `not supported in this spike: ${input.metric}`};
}

function validate(input) {
  const errs = [];
  const want = Object.keys(props).sort().join(',');
  const got = Object.keys(input).sort().join(',');
  if (want !== got) errs.push(`keys ${got}`);
  for (const [k, v] of Object.entries(ENUMS)) if (!v.includes(input[k])) errs.push(`${k}=${input[k]}`);
  if (![3, 5, 10, 25].includes(input.limit)) errs.push(`limit=${input.limit}`);
  return errs;
}

const cost = (u) =>
  ((u.input_tokens ?? 0) * PRICE.in +
    (u.cache_creation_input_tokens ?? 0) * PRICE.cacheWrite +
    (u.cache_read_input_tokens ?? 0) * PRICE.cacheRead +
    (u.output_tokens ?? 0) * PRICE.out) / 1e6;

async function run(label, thinking) {
  const messages = [{role: 'user', content: 'How do bundle sales split between dog and cat buyers, Sep 11 to 27?'}];
  const steps = [];
  const t0 = Date.now();
  for (let step = 1; step <= 6; step++) {
    const s0 = Date.now();
    let res;
    try {
      res = await client.messages.create({
        model: MODEL,
        max_tokens: 4000,
        thinking,
        tools: TOOLS,
        tool_choice: {type: 'auto'},
        system: [{type: 'text', text: SYSTEM, cache_control: {type: 'ephemeral'}}],
        messages,
      });
    } catch (e) {
      return {label, ok: false, error: `${e.constructor.name} ${e.status ?? ''}: ${String(e.message).slice(0, 300)}`, steps};
    }
    const types = res.content.map((b) => b.type);
    const toolUses = res.content.filter((b) => b.type === 'tool_use');
    steps.push({
      step, ms: Date.now() - s0, stop: res.stop_reason, types,
      usage: {
        in: res.usage.input_tokens, out: res.usage.output_tokens,
        cacheWrite: res.usage.cache_creation_input_tokens, cacheRead: res.usage.cache_read_input_tokens,
      },
      cost: cost(res.usage),
      toolInputs: toolUses.map((t) => ({input: t.input, invalid: validate(t.input)})),
    });
    if (res.stop_reason === 'refusal') return {label, ok: false, error: `refusal ${res.stop_details?.category}`, steps};
    if (res.stop_reason !== 'tool_use') {
      const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
      return {label, ok: res.stop_reason === 'end_turn', steps, totalMs: Date.now() - t0, finalText: text};
    }
    messages.push({role: 'assistant', content: res.content}); // unchanged: thinking blocks included
    messages.push({
      role: 'user',
      content: toolUses.map((t) => ({type: 'tool_result', tool_use_id: t.id, content: JSON.stringify(execute(t.input))})),
    });
  }
  return {label, ok: false, error: 'step cap reached', steps};
}

const results = [];
for (const [label, thinking] of [
  ['adaptive', {type: 'adaptive'}],
  ['between_tools', {type: 'between_tools'}],
  ['adaptive-repeat', {type: 'adaptive'}],
]) {
  results.push(await run(label, thinking));
}

for (const r of results) {
  const total = r.steps.reduce((a, s) => a + s.cost, 0);
  console.log(`\n=== ${r.label}: ${r.ok ? 'PASS' : 'FAIL'}${r.error ? ' — ' + r.error : ''}  total ${r.totalMs ?? '-'} ms  ~$${total.toFixed(4)}`);
  for (const s of r.steps) {
    console.log(`  step ${s.step}: ${s.stop} ${s.ms}ms [${s.types.join(',')}] in=${s.usage.in} out=${s.usage.out} cacheW=${s.usage.cacheWrite} cacheR=${s.usage.cacheRead}`);
    for (const t of s.toolInputs) console.log(`    tool input ${JSON.stringify(t.input)} ${t.invalid.length ? 'INVALID ' + t.invalid.join(';') : 'valid'}`);
  }
  if (r.finalText) console.log(`  final: ${r.finalText.slice(0, 600).replace(/\n/g, ' ')}`);
}
const checks = {
  strictInputsValid: results.every((r) => r.steps.every((s) => s.toolInputs.every((t) => !t.invalid.length))),
  allEndTurn: results.every((r) => r.ok),
  thinkingPassedBack: results.every((r) => r.steps.length >= 2),
  cacheHitWithinLoop: results.filter((r) => r.label !== 'between_tools').every((r) => r.steps.slice(1).some((s) => s.usage.cacheRead > 0)),
  cacheHitAcrossRequests: (results[2].steps[0]?.usage.cacheRead ?? 0) > 0,
};
console.log('\nCHECKS', JSON.stringify(checks));
