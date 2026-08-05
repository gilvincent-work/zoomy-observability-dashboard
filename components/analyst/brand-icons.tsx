import type {CSSProperties} from 'react';

type IconProps = {className?: string; style?: CSSProperties};

/** Shopee mark (simple-icons glyph). Solid, colored via `color` (defaults to Shopee orange). */
export function ShopeeIcon({className, style}: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      style={{color: '#EE4D2D', ...style}}
      fill="currentColor"
      aria-hidden
      role="img"
    >
      <path d="M15.9414 17.9633c.229-1.879-.981-3.077-4.1758-4.0969-1.548-.528-2.277-1.22-2.26-2.1719.065-1.056 1.048-1.825 2.352-1.85a5.2898 5.2898 0 0 1 2.8838.89c.116.072.197.06.263-.039.09-.145.315-.494.39-.62.051-.081.061-.187-.068-.281-.185-.1369-.704-.4149-.983-.5319a6.4697 6.4697 0 0 0-2.5118-.514c-1.909.008-3.4129 1.215-3.5389 2.826-.082 1.1629.494 2.1078 1.73 2.8278.262.152 1.6799.716 2.2438.892 1.774.552 2.695 1.5419 2.478 2.6969-.197 1.047-1.299 1.7239-2.818 1.7439-1.2039-.046-2.2878-.537-3.1278-1.19l-.141-.11c-.104-.08-.218-.075-.287.03-.05.077-.376.547-.458.67-.077.108-.035.168.045.234.35.293.817.613 1.134.775a6.7097 6.7097 0 0 0 2.8289.727 4.9048 4.9048 0 0 0 2.0759-.354c1.095-.465 1.8029-1.394 1.9449-2.554zM11.9986 1.4009c-2.068 0-3.7539 1.95-3.8329 4.3899h7.6657c-.08-2.44-1.765-4.3899-3.8328-4.3899zm7.8516 22.5981-.08.001-15.7843-.002c-1.074-.04-1.863-.91-1.971-1.991l-.01-.195L1.298 6.2858a.459.459 0 0 1 .45-.494h4.9748C6.8448 2.568 9.1607 0 11.9996 0c2.8388 0 5.1537 2.5689 5.2757 5.7898h4.9678a.459.459 0 0 1 .458.483l-.773 15.5883-.007.131c-.094 1.094-.979 1.9769-2.0709 2.0059z" />
    </svg>
  );
}

/** Lazada mark — the folded-heart icon with its signature warm gradient. */
export function LazadaIcon({className, style}: IconProps) {
  return (
    <svg viewBox="0 0 132 110" className={className} style={style} aria-hidden role="img">
      <defs>
        <linearGradient id="lz-a" gradientUnits="userSpaceOnUse" x1="-.001" x2="66.758" y1=".5" y2="-.017">
          <stop offset="0" stopColor="#ffb900" />
          <stop offset=".338" stopColor="#f38000" />
          <stop offset=".567" stopColor="#f83c72" />
          <stop offset=".78" stopColor="#fc1cbe" />
          <stop offset=".93" stopColor="#fe08ed" />
          <stop offset="1" stopColor="#f0f" />
        </linearGradient>
        <linearGradient id="lz-b" gradientUnits="userSpaceOnUse" x1="18.754" x2="86.818" y1="49.006" y2="11.32">
          <stop offset="0" stopColor="#ee0a3f" />
          <stop offset="1" stopColor="#ee0a3f" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="lz-c" gradientUnits="userSpaceOnUse" x1="41.793" x2="75.037" y1="39.349" y2="12.569">
          <stop offset="0" stopColor="#ed6600" />
          <stop offset="1" stopColor="#f98200" />
        </linearGradient>
      </defs>
      <path
        d="M33.737 54.716c-.479.003-.95-.12-1.366-.355-3.565-2.063-29.967-18.617-30.964-19.122A2.39 2.39 0 0 1 .04 33.327v-23.22A2.513 2.513 0 0 1 1.175 7.95l.19-.109C3.92 6.256 12.47 1.038 13.823.287A2.05 2.05 0 0 1 14.847 0c.338.004.67.088.97.246 0 0 11.964 7.799 13.795 8.495a9.438 9.438 0 0 0 4.097.86 9.178 9.178 0 0 0 4.59-1.12C40.087 7.54 51.52.288 51.642.288c.288-.174.62-.264.956-.26.361.002.715.101 1.024.287 1.557.86 12.156 7.348 12.607 7.635a2.458 2.458 0 0 1 1.188 2.131V33.3a2.363 2.363 0 0 1-1.365 1.912c-.997.546-27.317 17.1-30.95 19.122a2.732 2.732 0 0 1-1.366.382"
        fill="url(#lz-a)"
        transform="translate(-.049) scale(1.96487)"
      />
      <path
        d="M33.6 54.716h.137c.478.003.95-.12 1.365-.355 3.565-2.063 29.954-18.617 30.95-19.122a2.363 2.363 0 0 0 1.366-1.912v-23.22a2.484 2.484 0 0 0-.259-1.133L33.6 27.399z"
        fill="url(#lz-b)"
        transform="translate(-.049) scale(1.96487)"
      />
      <path
        d="M33.6 54.716h.137c.478.003.95-.12 1.365-.355 3.565-2.063 29.954-18.617 30.95-19.122a2.363 2.363 0 0 0 1.366-1.912v-23.22a2.484 2.484 0 0 0-.259-1.133L33.6 27.399z"
        fill="url(#lz-c)"
        transform="matrix(-1.94394 0 0 1.94394 131.058 .502)"
      />
    </svg>
  );
}
