'use strict';
// LOCAL ONLY safety net. Preloaded into `next dev` by scripts/local-supabase/dev.sh (NODE_OPTIONS=--require ...).
// Makes fetch, http(s).request/get and raw socket connects THROW for any hosted Supabase host, so a mis-set environment
// can never reach a hosted project (production included) from a local run. It logs one line per block, host only.
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');

const {isBlockedHost, hostOf} = require('./block-remote-match.cjs');

function refuse(host) {
  console.error(`[block-remote] blocked a request to hosted Supabase host ${String(host).toLowerCase()}`);
  return new Error(`block-remote: refusing to reach a hosted Supabase project (${String(host).toLowerCase()}) from a local run`);
}

function install() {
  if (typeof globalThis.fetch === 'function') {
    const realFetch = globalThis.fetch;
    globalThis.fetch = function blockedFetch(input, init) {
      const host = hostOf(input);
      if (isBlockedHost(host)) return Promise.reject(refuse(host));
      return realFetch.call(this, input, init);
    };
  }
  for (const mod of [http, https]) {
    for (const fn of ['request', 'get']) {
      const real = mod[fn];
      mod[fn] = function blockedRequest(first, ...rest) {
        // (url|options[, options][, callback]): the host may be in either of the first two arguments.
        const second = rest[0] && typeof rest[0] === 'object' ? rest[0] : null;
        for (const host of [hostOf(first), second ? hostOf(second) : '']) {
          if (isBlockedHost(host)) throw refuse(host);
        }
        return real.call(this, first, ...rest);
      };
    }
  }
  // Last line of defence: any socket connect (tls.connect, undici, a library with its own agent).
  const realConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function blockedConnect(...args) {
    const opts = args[0];
    const host = opts && typeof opts === 'object' ? opts.host || opts.hostname || '' : typeof args[1] === 'string' ? args[1] : '';
    if (isBlockedHost(host)) {
      const err = refuse(host);
      process.nextTick(() => this.destroy(err));
      return this;
    }
    return realConnect.apply(this, args);
  };
}

if (!globalThis.__coopBlockRemoteInstalled) {
  globalThis.__coopBlockRemoteInstalled = true;
  install();
}

