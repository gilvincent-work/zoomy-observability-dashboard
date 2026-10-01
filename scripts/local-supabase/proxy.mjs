// LOCAL ONLY. A dependency-free reverse proxy: supabase-js calls <url>/rest/v1/<table>, PostgREST serves /<table>.
// This strips the /rest/v1 prefix and forwards method, headers and body (streamed) to PostgREST on 127.0.0.1.
// It binds 127.0.0.1 only and refuses any request whose Host header is not a loopback name (DNS-rebinding guard),
// any path outside /rest/v1, and a non-loopback upstream. Env: PROXY_PORT (54420), UPSTREAM_PORT (54423).
import http from 'node:http';

const LOOPBACK = new Set(['127.0.0.1', 'localhost']);
const PREFIX = '/rest/v1';
const port = Number(process.env.PROXY_PORT ?? 54420);
const upstreamPort = Number(process.env.UPSTREAM_PORT ?? 54423);
const upstreamHost = '127.0.0.1';

/** Host header (any port) is a loopback name. */
export const hostAllowed = (hostHeader) => {
  if (typeof hostHeader !== 'string') return false;
  return LOOPBACK.has(hostHeader.replace(/:\d+$/, '').toLowerCase());
};

/** The upstream path for a request path, or null when it is not under /rest/v1. */
export const upstreamPath = (url) => {
  if (typeof url !== 'string') return null;
  if (url !== PREFIX && !url.startsWith(`${PREFIX}/`) && !url.startsWith(`${PREFIX}?`)) return null;
  const rest = url.slice(PREFIX.length);
  return rest === '' || rest.startsWith('?') ? `/${rest}` : rest;
};

export function createProxy() {
  return http.createServer((req, res) => {
    if (!hostAllowed(req.headers.host)) {
      res.writeHead(403, {'content-type': 'text/plain'}).end('local proxy: Host header must be 127.0.0.1 or localhost\n');
      return;
    }
    const path = upstreamPath(req.url);
    if (path === null) {
      res.writeHead(404, {'content-type': 'text/plain'}).end('local proxy: only /rest/v1/* is served\n');
      return;
    }
    const up = http.request(
      {host: upstreamHost, port: upstreamPort, method: req.method, path, headers: {...req.headers, host: `${upstreamHost}:${upstreamPort}`}},
      (r) => {
        res.writeHead(r.statusCode ?? 502, r.headers);
        r.pipe(res);
      },
    );
    up.on('error', () => {
      if (!res.headersSent) res.writeHead(502, {'content-type': 'text/plain'});
      res.end('local proxy: PostgREST is not reachable\n');
    });
    req.pipe(up);
  });
}

// Only listen when run directly (the unit test imports the helpers).
if (import.meta.url === new URL(process.argv[1] ?? '', 'file:').href) {
  createProxy().listen(port, '127.0.0.1', () => console.log(`coop-local proxy on http://127.0.0.1:${port} -> PostgREST ${upstreamHost}:${upstreamPort}`));
}
