import type {DigestArchiveRow} from './types';

// Resolve which week (archive row) is selected from the `?week=<window_from>` URL
// param. Falls back to the first (newest) row. Pure — shared by the server pages.
export function pickIndex(digests: DigestArchiveRow[], week?: string): number {
  if (!week) return 0;
  const i = digests.findIndex((d) => d.window_from === week);
  return i >= 0 ? i : 0;
}
