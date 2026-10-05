// Defaults and hard ceilings for the Explore knobs (spec 3.6). An env value can only move a knob inside its ceiling; an invalid or
// out-of-range value falls back to the default and never throws. Pure data.
import type {ExploreLimits} from './types';

export const DEFAULT_EXPLORE_LIMITS: Readonly<ExploreLimits> = Object.freeze({
  maxRows: 200,
  maxCols: 12,
  maxBytes: 65536,
  timeoutMs: 5000,
  maxSqlChars: 2000,
  maxCallsPerQuestion: 5,
  maxPerUserDay: 60,
  modelRows: 50,
  maxRelations: 8,
  maxDepth: 20,
});

export const EXPLORE_LIMIT_CEILINGS: Readonly<ExploreLimits> = Object.freeze({
  maxRows: 500,
  maxCols: 24,
  maxBytes: 262144,
  timeoutMs: 10000,
  maxSqlChars: 4000,
  maxCallsPerQuestion: 8,
  maxPerUserDay: 200,
  modelRows: 200,
  maxRelations: 12,
  maxDepth: 30,
});

/** Env variable for each knob. */
export const EXPLORE_LIMIT_ENV: Readonly<Record<keyof ExploreLimits, string>> = Object.freeze({
  maxRows: 'EXPLORE_MAX_ROWS',
  maxCols: 'EXPLORE_MAX_COLS',
  maxBytes: 'EXPLORE_MAX_BYTES',
  timeoutMs: 'EXPLORE_TIMEOUT_MS',
  maxSqlChars: 'EXPLORE_MAX_SQL_CHARS',
  maxCallsPerQuestion: 'EXPLORE_MAX_CALLS_PER_QUESTION',
  maxPerUserDay: 'EXPLORE_MAX_PER_USER_DAY',
  modelRows: 'EXPLORE_MODEL_ROWS',
  maxRelations: 'EXPLORE_MAX_RELATIONS',
  maxDepth: 'EXPLORE_MAX_DEPTH',
});
