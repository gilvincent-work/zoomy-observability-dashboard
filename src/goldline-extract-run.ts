import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import {
  buildSystemPrompt,
  buildManifestPrompt,
  EXTRACTION_SCHEMA,
  EXTRACT_MODEL,
} from './goldline-extract';

// The live Claude Vision call for one scanned inventory page. Server-only; reads
// ANTHROPIC_API_KEY from the env (never the browser). The hard, reusable parts —
// the prompt, manifest, and schema — are in goldline-extract.ts and unit-tested;
// this thin wrapper is exercised end-to-end by the upload route and smoke-tested
// on Staging once the key is set.

export type ExtractedRow = {
  item_code: string;
  stockroom: number | null;
  drawer: number | null;
  selling_area: number | null;
  delivery: number | null;
  ending_on_hand: number | null;
  confidence: number;
  alt?: string | null;
};

export type ExtractedPage = {
  store_code: string;
  store_name?: string;
  period_start?: string | null;
  period_end?: string | null;
  consultant?: string | null;
  rows: ExtractedRow[];
};

/** True when extraction is configured; lets callers disable the PDF path cleanly. */
export function extractionConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/**
 * Read ONE scanned inventory page with Claude Vision against the fixed template.
 * Throws on: no key, a page with no manifest, no text/invalid JSON, or an `{error}`
 * response (page_mismatch / unreadable). The caller marks the upload failed and
 * surfaces the reason to the reviewer.
 */
export async function extractInventoryPage(pdfBase64: string, page: number): Promise<ExtractedPage> {
  if (!extractionConfigured()) throw new Error('ANTHROPIC_API_KEY is not set');
  const system = buildSystemPrompt();
  const manifest = buildManifestPrompt(page); // throws if this page has no manifest yet

  const client = new Anthropic();
  const params = {
    model: EXTRACT_MODEL,
    max_tokens: 8000,
    system,
    // Structured output — the first text block is valid JSON matching the schema.
    output_config: {format: {type: 'json_schema', schema: EXTRACTION_SCHEMA}},
    // Pure extraction: no need for extended thinking.
    thinking: {type: 'disabled'},
    messages: [
      {
        role: 'user',
        content: [
          {type: 'document', source: {type: 'base64', media_type: 'application/pdf', data: pdfBase64}},
          {type: 'text', text: manifest},
        ],
      },
    ],
  };

  // Cast through unknown: output_config/thinking are newer params and the exact SDK
  // type surface varies by version; the wire shape above follows the current docs.
  const res = (await client.messages.create(
    params as unknown as Parameters<typeof client.messages.create>[0],
  )) as {content?: Array<{type: string; text?: string}>};

  const text = res.content?.find((b) => b.type === 'text' && typeof b.text === 'string')?.text;
  if (!text) throw new Error('Extraction returned no text content');

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Extraction did not return valid JSON');
  }
  if (parsed && typeof parsed === 'object' && 'error' in parsed) {
    throw new Error(`Extraction declined: ${String((parsed as {error: unknown}).error)}`);
  }
  return parsed as ExtractedPage;
}
