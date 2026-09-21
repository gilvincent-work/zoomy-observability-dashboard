import {ImageResponse} from 'next/og';

// iOS home-screen icon. iOS ignores the web manifest for A2HS and reads this
// <link rel="apple-touch-icon"> (Next wires it up automatically). iOS rounds the
// corners itself, so we fill the square edge-to-edge with the brand tile.
export const size = {width: 180, height: 180};
export const contentType = 'image/png';

const SVG =
  '<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><rect width="32" height="32" fill="#3F6E56"/><path d="M21 10.4 A8 8 0 1 0 21 21.6" fill="none" stroke="#F7F5EF" stroke-width="3.6" stroke-linecap="round"/></svg>';

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{display: 'flex', width: '100%', height: '100%'}}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img width={180} height={180} src={`data:image/svg+xml;utf8,${encodeURIComponent(SVG)}`} />
      </div>
    ),
    size,
  );
}
