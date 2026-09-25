import {ImageResponse} from 'next/og';

// PWA manifest icons, generated at request time from the Coop brand mark (the same
// forest-green tile + cream "c" arc as app/icon.svg) so we need no binary raster
// tooling. `/pwa-icon/192`, `/pwa-icon/512`, and `?maskable=1` for the maskable
// variant. Referenced from app/manifest.ts. Drawn with native satori elements (a
// green <div> + inline <svg> glyph) rather than an <img> data URI, which satori
// renders unreliably (the same failure that broke the iOS home-screen icon).

export async function GET(req: Request, props: {params: Promise<{size: string}>}) {
  const params = await props.params;
  const size = Math.min(1024, Math.max(48, Number(params.size) || 192));
  const maskable = new URL(req.url).searchParams.has('maskable');
  // Maskable icons must fill the whole square (the OS applies its own mask) with
  // the glyph pulled into the ~80% safe zone; "any" keeps a rounded tile.
  const radius = maskable ? 0 : Math.round(size * 0.18);
  const glyph = Math.round(size * (maskable ? 0.5 : 0.62));
  return new ImageResponse(
    (
      <div
        style={{
          display: 'flex',
          width: '100%',
          height: '100%',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#3F6E56',
          borderRadius: radius,
        }}
      >
        <svg width={glyph} height={glyph} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M21 10.4 A8 8 0 1 0 21 21.6" stroke="#F7F5EF" strokeWidth="3.6" strokeLinecap="round" />
        </svg>
      </div>
    ),
    {width: size, height: size},
  );
}
