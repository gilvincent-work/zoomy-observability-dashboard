// Database error mapping for Explore (spec 3.4). Pure. The raw database message is never returned or logged: only a SQLSTATE comes in,
// only a code from EXPLORE_ERROR_MESSAGES goes out.
import type {ExploreErrorCode} from './types';

/** Thrown by client.ts (and fakes). Carries a code only. */
export class ExploreDbError extends Error {
  readonly code: ExploreErrorCode;
  /** The driver/SQLSTATE code the error came from (e.g. 28P01), kept ONLY so the health probe can tell auth from network. Never text. */
  readonly sqlstate?: string;
  constructor(code: ExploreErrorCode, sqlstate?: string) {
    super(code);
    this.name = 'ExploreDbError';
    this.code = code;
    if (typeof sqlstate === 'string' && /^[A-Za-z0-9_]{1,40}$/.test(sqlstate)) this.sqlstate = sqlstate;
  }
}

const CONNECTION_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'ETIMEDOUT', 'CONNECT_TIMEOUT', 'CONNECTION_CLOSED', 'CONNECTION_DESTROYED', 'CONNECTION_ENDED', 'CONNECTION_CONNECT_TIMEOUT', 'CONNECTION_REFUSED', '53300', '53400', '57P01', '57P02', '57P03', '28P01', '28000']);

export function mapDbError(sqlstate: unknown): ExploreErrorCode {
  const c = typeof sqlstate === 'string' ? sqlstate : '';
  if (c === '57014') return 'E_TIMEOUT';
  if (c === '42501' || c === '25006') return 'E_DB_DENIED';
  if (c === '42P01') return 'E_RELATION';
  if (c === '42703') return 'E_COLUMN';
  if (c === '42803') return 'E_GROUPING';
  if (c === '42702') return 'E_AMBIGUOUS';
  if (c === '42883' || c === '42804' || c === '42846' || c === '42725') return 'E_TYPE';
  if (c === '22012') return 'E_DIV_ZERO';
  if (c.startsWith('22')) return 'E_DATA';
  if (CONNECTION_CODES.has(c) || c.startsWith('08')) return 'E_UNAVAILABLE';
  return 'E_DB_OTHER';
}
