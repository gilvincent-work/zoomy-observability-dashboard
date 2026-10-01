// Response headers for every route (next.config.mjs `headers()`). A deliberately SMALL Content-Security-Policy: only the
// directives below, so nothing the app already does (inline scripts and styles Next emits, Google sign-in, the service worker,
// Recharts) can break. `default-src` / `script-src` are NOT set on purpose; tightening them needs nonces (see
// node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md) and is a separate piece of work.
//  - img-src: the app renders no remote image (no <img>, no next/image, no avatar: `session.user.image` is passed to the shell
//    but never drawn; icons are inline SVG or same-origin). So only same-origin, data: and blob: are allowed. This is the second
//    wall behind chat-markdown.tsx dropping markdown images: a model-written image URL would be blocked here too.
//  - object-src 'none': no plugins. base-uri 'self': no <base> hijack. frame-ancestors 'none': never framed (clickjacking).
export const CSP_DIRECTIVES = ["img-src 'self' data: blob:", "object-src 'none'", "base-uri 'self'", "frame-ancestors 'none'"];

export const CSP_VALUE = CSP_DIRECTIVES.join('; ');

export const securityHeaders = [{key: 'Content-Security-Policy', value: CSP_VALUE}];

/** The shape next.config.mjs `headers()` returns: the same headers on every path. */
export const headerRules = () => [{source: '/:path*', headers: securityHeaders}];
