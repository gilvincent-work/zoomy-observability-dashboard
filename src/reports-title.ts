// Pure helper for the Save action (kept out of the 'use server' file, which may export only async functions).
import {plainText} from './chat/bind';

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * A title for a draft that has none (the model did not name the dashboard): the first block title or tile label, else the question
 * that produced it, else "Untitled report". Plain text, at most the title limit. Saving never fails just because the title is blank.
 */
export function fallbackTitle(draft: Record<string, unknown> | null, prompt: unknown): string {
  const blocks = Array.isArray(draft?.blocks) ? (draft.blocks as unknown[]) : [];
  for (const b of blocks) {
    const view = isRecord(b) && isRecord(b.view) ? b.view : null;
    const t = plainText(view?.title) || plainText(view?.label);
    if (t !== '') return t;
  }
  const asked = plainText(typeof prompt === 'string' ? prompt.split(/[.?!\n]/)[0] : '').slice(0, 80).trim();
  return asked || 'Untitled report';
}
