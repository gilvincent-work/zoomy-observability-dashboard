import type {DigestDocument, TimeBasis} from '../src/types';

const BASIS_LABEL: Record<TimeBasis, string> = {
  window: 'this week',
  recurring: 'weekly trend',
  allTime: 'all-time',
};

export function DigestView({digest, emailedAt}: {digest: DigestDocument; emailedAt: string | null}) {
  return (
    <article className="digest">
      <header className="digest__head">
        <h2>{digest.window.label}</h2>
        {digest.degraded && <span className="badge badge--warn">no data</span>}
        {emailedAt && <span className="badge badge--ok">emailed</span>}
      </header>

      <p className="digest__headline">{digest.headline}</p>

      {digest.figures.length > 0 && (
        <section className="digest__section">
          <h3>By the numbers</h3>
          <ul className="figures">
            {digest.figures.map((f, i) => (
              <li key={i}>
                {f.label}: <strong>{f.value}</strong>{' '}
                <span className="basis">({BASIS_LABEL[f.timeBasis] ?? f.timeBasis})</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {digest.themes.length > 0 && (
        <section className="digest__section">
          <h3>Demand themes</h3>
          <ul className="themes">
            {digest.themes.map((t, i) => (
              <li key={i}>
                <strong>{t.displayName}</strong> — <q>{t.quote}</q>{' '}
                <span className="cid">({t.conversationId})</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {digest.recommendations.length > 0 && (
        <section className="digest__section">
          <h3>Recommended actions</h3>
          <ul className="recs">
            {digest.recommendations.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
