import {getDigests, usingMock} from '../src/data';
import {DigestView} from './DigestView';

export const dynamic = 'force-dynamic'; // always reflect the latest archive when live

export default async function Page() {
  const rows = await getDigests();
  return (
    <main className="wrap">
      {usingMock() && (
        <div className="notice">
          Showing mock digests — set <code>NEXT_PUBLIC_SUPABASE_URL</code> and{' '}
          <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to read live archives.
        </div>
      )}
      {rows.length === 0 ? (
        <p className="empty">No digests archived yet.</p>
      ) : (
        <div className="list">
          {rows.map((row) => (
            <DigestView key={row.window_from} digest={row.digest} emailedAt={row.emailed_at} />
          ))}
        </div>
      )}
    </main>
  );
}
