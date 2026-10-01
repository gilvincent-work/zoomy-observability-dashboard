import type {ChatReadMode} from './relations';
import {MIN_SECRET_LENGTH, mintChatReadJwt} from './mint-jwt';

// Pure config for the chat read client (no supabase-js, no server-only), so it
// can be unit tested. In ro_role mode it NEVER reads the service-role key.

export interface ChatReadConfig {
  url: string;
  /** guarded_service: the service-role key. ro_role: a freshly minted JWT. */
  key: string;
  mode: ChatReadMode;
  /** ro_role only: optional project anon/publishable key for the apikey header. */
  apikey?: string;
}

export interface BuildChatReadConfigOptions {
  mode: ChatReadMode;
  env: Record<string, string | undefined>;
  now?: Date | number;
}

function required(env: BuildChatReadConfigOptions['env'], name: string): string {
  const value = env[name];
  if (!value) throw new Error(`chat read client: ${name} is not set`);
  return value;
}

export function buildChatReadConfig({mode, env, now}: BuildChatReadConfigOptions): ChatReadConfig {
  const url = required(env, 'SUPABASE_URL_ARCHIVE');
  if (mode === 'guarded_service') {
    return {url, key: required(env, 'SUPABASE_SERVICE_ROLE_KEY_ARCHIVE'), mode};
  }
  const secret = required(env, 'CHAT_RO_JWT_SECRET');
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`chat read client: CHAT_RO_JWT_SECRET must be at least ${MIN_SECRET_LENGTH} characters`);
  }
  const apikey = env.CHAT_RO_APIKEY || undefined;
  return {url, key: mintChatReadJwt({secret, now}), mode, ...(apikey ? {apikey} : {})};
}
