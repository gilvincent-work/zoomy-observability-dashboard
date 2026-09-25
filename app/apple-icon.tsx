import {ImageResponse} from 'next/og';

// iOS home-screen icon. iOS ignores the web manifest for A2HS and reads this
// <link rel="apple-touch-icon"> (Next wires it up automatically). When this route
// fails to render, iOS falls back to a white tile with the first letter of the
// title (the plain "C" bug). Satori (next/og) renders <img>-embedded SVG data
// URIs unreliably, so we draw the brand tile with native elements instead: a
// forest-green fill + the cream "c" arc as an inline <svg>. iOS rounds the corners
// itself, so we fill the square edge-to-edge. Brand: #3F6E56 / #F7F5EF.
export const size = {width: 180, height: 180};
export const contentType = 'image/png';

export default function AppleIcon() {
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
        }}
      >
        <svg width="112" height="112" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M21 10.4 A8 8 0 1 0 21 21.6" stroke="#F7F5EF" strokeWidth="3.6" strokeLinecap="round" />
        </svg>
      </div>
    ),
    size,
  );
}
