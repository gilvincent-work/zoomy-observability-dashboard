import type {DigestArchiveRow} from './types';

// Built-in fixtures so the dashboard runs with no database. One healthy digest,
// one degraded ("no data") — to exercise both UI states.
export const MOCK_DIGESTS: DigestArchiveRow[] = [
  {
    window_from: '2026-07-20T00:00:00.000Z',
    window_to: '2026-07-27T00:00:00.000Z',
    created_at: '2026-07-27T01:00:00.000Z',
    emailed_at: null,
    digest: {
      window: {label: 'week of Jul 20–27', from: '2026-07-20T00:00:00.000Z', to: '2026-07-27T00:00:00.000Z'},
      degraded: false,
      headline: 'Joint pain led the conversation this week, while grain-free senior options remain an unmet all-time gap.',
      figures: [
        {label: 'Conversations this week', value: 42, timeBasis: 'window'},
        {label: 'Joint pain mentions', value: 9, timeBasis: 'recurring'},
        {label: 'Grain-free senior food asks', value: 6, timeBasis: 'allTime'},
      ],
      themes: [
        {theme: 'joints', displayName: 'Joint pain', quote: 'his hips are achy and he seems stiff on the stairs', conversationId: 'demo-1'},
        {theme: 'digestion', displayName: 'Grain-free / digestion', quote: 'do you have anything grain-free for a senior dog?', conversationId: 'demo-2'},
      ],
      recommendations: [
        'Stock grain-free senior food — 6 all-time asks and a live grain-free query this week.',
        'Feature joint-supplement chews; joint pain is this week’s top theme.',
      ],
    },
  },
  {
    window_from: '2026-07-13T00:00:00.000Z',
    window_to: '2026-07-20T00:00:00.000Z',
    created_at: '2026-07-20T01:00:00.000Z',
    emailed_at: '2026-07-20T01:05:00.000Z',
    digest: {
      window: {label: 'week of Jul 13–20', from: '2026-07-13T00:00:00.000Z', to: '2026-07-20T00:00:00.000Z'},
      degraded: true,
      headline: 'no data — check the job',
      figures: [],
      themes: [],
      recommendations: [],
    },
  },
];
