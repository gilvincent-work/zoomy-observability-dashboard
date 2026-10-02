// F9: what the drawer offers next, decided by the SERVER side's pure rule (the model can never save; design § 5b "Write
// path": the server emits `suggest_save` on its own). Pure, no I/O.
//   'save'   the draft has at least one block and is not saved yet
//   'update' the draft is a saved report whose recipe now differs from the saved version
//   null     nothing to offer: no blocks, or nothing changed
// Compared: filters (not the Pin dates flag) and blocks. Not compared: the title, because rename creates no version, and
// key order, because stored jsonb does not keep it.
import type {ReportSpec} from './chat/report-types';

export type SaveSuggestion = 'save' | 'update' | null;

export interface SavedReportRef {
  id: string;
  version: number;
  /** The saved version's spec as stored (raw jsonb). */
  spec: unknown;
}

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

/** JSON with object keys sorted, so two recipes that differ only in key order compare equal. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (isRecord(v)) {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

function recipeKey(spec: unknown): string {
  const s = isRecord(spec) ? spec : {};
  const {pinned: _pinned, ...filters} = isRecord(s.filters) ? s.filters : ({} as Record<string, unknown>);
  void _pinned;
  return canonical({filters, blocks: Array.isArray(s.blocks) ? s.blocks : []});
}

export function suggestSave(spec: ReportSpec | null, saved: SavedReportRef | null): SaveSuggestion {
  if (!spec || spec.blocks.length === 0) return null;
  if (!saved) return 'save';
  return recipeKey(spec) === recipeKey(saved.spec) ? null : 'update';
}
