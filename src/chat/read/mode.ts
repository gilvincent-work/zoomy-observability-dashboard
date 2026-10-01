import {CHAT_READ_MODES, type ChatReadMode} from './relations';

// Fail-closed read mode. In production only CHAT_READ_MODE=ro_role is accepted
// (database-enforced read-only role). Elsewhere the default is guarded_service
// (layers 1-4 on a service-role client) and the caller is handed a loud warning.

export interface ChatReadEnv {
  NODE_ENV?: string;
  CHAT_READ_MODE?: string;
}

export type ChatReadability =
  | {ok: true; mode: ChatReadMode; warning?: string}
  | {ok: false; status: 503; message: string};

export function resolveChatReadMode(env: ChatReadEnv): ChatReadMode {
  const raw = env.CHAT_READ_MODE?.trim();
  if (raw && !(CHAT_READ_MODES as readonly string[]).includes(raw)) {
    throw new Error(`CHAT_READ_MODE=${raw} is not a known mode`);
  }
  if (env.NODE_ENV === 'production') {
    if (raw !== 'ro_role') throw new Error('production requires CHAT_READ_MODE=ro_role');
    return 'ro_role';
  }
  return (raw as ChatReadMode | undefined) ?? 'guarded_service';
}

export function assertChatReadable(env: ChatReadEnv): ChatReadability {
  try {
    const mode = resolveChatReadMode(env);
    return mode === 'guarded_service'
      ? {ok: true, mode, warning: 'CHAT_READ_MODE is guarded_service: read-only is enforced in code only, not by the database. Not for production.'}
      : {ok: true, mode};
  } catch (e) {
    return {ok: false, status: 503, message: `Ask Coop is unavailable: ${(e as Error).message}`};
  }
}
