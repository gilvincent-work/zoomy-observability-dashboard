import {createHmac} from 'node:crypto';

// Layer 5: mints the short-lived HS256 token PostgREST accepts for the
// database role `coop_chat_ro` (see scripts/spikes/readonly-role.mjs). Pure:
// node:crypto only, no logging. The secret is never echoed in an error.

export const CHAT_RO_ROLE = 'coop_chat_ro';
export const MIN_SECRET_LENGTH = 32;
export const DEFAULT_TTL_SECONDS = 300;
export const MAX_TTL_SECONDS = 900;

export interface MintChatReadJwtOptions {
  secret: string;
  /** Injectable clock for tests: a Date or epoch milliseconds. */
  now?: Date | number;
  ttlSeconds?: number;
}

const b64url = (value: object): string => Buffer.from(JSON.stringify(value)).toString('base64url');

export function mintChatReadJwt(opts: MintChatReadJwtOptions): string {
  const {secret} = opts;
  if (typeof secret !== 'string' || secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`chat read JWT secret must be at least ${MIN_SECRET_LENGTH} characters`);
  }
  const ttl = opts.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  if (!Number.isFinite(ttl) || ttl <= 0 || ttl > MAX_TTL_SECONDS) {
    throw new Error(`chat read JWT ttlSeconds must be between 1 and ${MAX_TTL_SECONDS}`);
  }
  const nowMs = opts.now instanceof Date ? opts.now.getTime() : (opts.now ?? Date.now());
  const iat = Math.floor(nowMs / 1000);
  const header = b64url({alg: 'HS256', typ: 'JWT'});
  const payload = b64url({role: CHAT_RO_ROLE, iss: 'supabase', iat, exp: iat + Math.floor(ttl), sub: 'ask-coop'});
  // node:crypto Hmac.update, not a database call: pinned in WRITE_CALL_EXCEPTIONS (test/support/chat-arch-scan.ts).
  const signature = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}
