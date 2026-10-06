import type {ExploreErrorCode} from '../../src/chat/explore/types';
export interface ExploreCorpusRow {
  id: string;
  category: string;
  sql: string;
  gen?: string;
  expect: ExploreErrorCode | 'ok';
  db: 'MUST' | 'BOUNDED' | 'PARSER' | 'OK' | 'n/a';
  runtime?: string;
}
export const GENERATORS: Record<string, () => string>;
export const EXPLORE_NEGATIVE_CORPUS: ExploreCorpusRow[];
export const EXPLORE_EXTRA_CORPUS: ExploreCorpusRow[];
export const EXPLORE_POSITIVE_CORPUS: ExploreCorpusRow[];
