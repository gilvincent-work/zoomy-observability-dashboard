import {getDataContext} from '@/src/active-context';
import {signedUploadUrl} from '@/src/goldline-data';

// Same-origin proxy for a stored upload, so the review page can embed the scan in an
// <iframe> (the app CSP sets object-src 'none', which blocks <object>; frame-src is
// open). Company-scoped via getDataContext → signedUploadUrl (ownership re-checked),
// so one tenant can't fetch another's file. The signed URL never reaches the browser.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, {params}: {params: Promise<{id: string}>}): Promise<Response> {
  const {id} = await params;
  const ctx = await getDataContext();
  if (!ctx || !ctx.companyId) return new Response('Not authorized.', {status: 403});

  const url = await signedUploadUrl(ctx.companyId, id);
  if (!url) return new Response('Not found.', {status: 404});

  const upstream = await fetch(url);
  if (!upstream.ok) return new Response('Could not load the file.', {status: 502});
  // Buffer the bytes (not a passthrough stream): more reliable for an <iframe> PDF
  // embed, and lets us set an accurate content-length.
  const buf = await upstream.arrayBuffer();

  return new Response(buf, {
    status: 200,
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': 'inline',
      'content-length': String(buf.byteLength),
      // Same-origin embedding only; the URL is behind auth + company scope.
      'x-frame-options': 'SAMEORIGIN',
      'cache-control': 'private, max-age=0, must-revalidate',
    },
  });
}
