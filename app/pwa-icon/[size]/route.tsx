import {ImageResponse} from 'next/og';

// PWA manifest icons, generated at request time from the Coop brand mark (the same
// forest-green tile + cream "c" arc as app/icon.svg) so we need no binary raster
// tooling. `/pwa-icon/192`, `/pwa-icon/512`, and `?maskable=1` for the maskable
// variant. Referenced from app/manifest.ts.

function tile(maskable: boolean): string {
  // Maskable icons must fill the whole square (the OS applies its own mask), with
  // the glyph pulled into the ~80% safe zone; "any" keeps the rounded tile.
  const rx = maskable ? 0 : 6;
  const open = maskable ? '<g transform="translate(3.4 3.4) scale(0.785)">' : '<g>';
  return `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><rect width="32" height="32" rx="${rx}" fill="#3F6E56"/>${open}<path d="M21 10.4 A8 8 0 1 0 21 21.6" fill="none" stroke="#F7F5EF" stroke-width="3.6" stroke-linecap="round"/></g></svg>`;
}

export async function GET(req: Request, props: {params: Promise<{size: string}>}) {
  const params = await props.params;
  const size = Math.min(1024, Math.max(48, Number(params.size) || 192));
  const maskable = new URL(req.url).searchParams.has('maskable');
  const svg = tile(maskable);
  return new ImageResponse(
    (
      <div style={{display: 'flex', width: '100%', height: '100%'}}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img width={size} height={size} src={`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`} />
      </div>
    ),
    {width: size, height: size},
  );
}
