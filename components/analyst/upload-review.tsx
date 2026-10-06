'use client';

import {useMemo, useRef, useState} from 'react';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {ArrowLeft, ArrowRight, CheckCircle2, ExternalLink, FileText, Loader2, Maximize2, X} from 'lucide-react';
import type {ExtractionRecord, UploadRow} from '@/src/goldline-data';
import type {ExtractedRow} from '@/src/goldline-extract-run';
import {commitReview} from '@/app/uploads/actions';
import {Card, CardContent, CardHeader, CardTitle} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import {cn} from '@/lib/utils';
import {DocumentConfidence} from '@/components/analyst/document-confidence';
import {bandOf, LOW_BELOW, rowConfidence, toneText, type Band} from '@/src/review-confidence';

const BAND_TONE: Record<Band, string> = {high: 'var(--status-good)', medium: 'var(--status-warn)', low: 'var(--status-crit)'};

// Review workbench for one scanned inventory page. Shows the staged Claude Vision
// read, pre-filled and editable; low-confidence rows are flagged so the reviewer
// fixes the exceptions, confirms the header (store + period), and commits to
// gl_inventory. A sales CSV has no extraction, so it renders a status summary.

const LOW = LOW_BELOW; // below this a row is flagged for human eyes (shared with the confidence summary).
const COLS = [
  {key: 'stockroom', label: 'Stock'},
  {key: 'drawer', label: 'Drawer'},
  {key: 'selling_area', label: 'Selling'},
  {key: 'delivery', label: 'Delivery'},
  {key: 'ending_on_hand', label: 'Ending'},
] as const;

type EditRow = ExtractedRow;

function toIntOrNull(s: string): number | null {
  const t = s.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

export function UploadReview({
  company,
  canEdit,
  upload,
  extraction,
  scanUrl,
  productNames = {},
  inventoryHref = null,
}: {
  company: string;
  canEdit: boolean;
  upload: UploadRow;
  extraction: ExtractionRecord | null;
  /** Same-origin proxy path to the stored scan (streams the private file), or null. */
  scanUrl?: string | null;
  /** item_code → printed product name (from the page manifest), for the rows table. */
  productNames?: Record<string, string>;
  /** Inventory page for the store + period this scan was committed to, once committed. */
  inventoryHref?: string | null;
}) {
  const router = useRouter();
  const committed = upload.status === 'committed' || extraction?.status === 'confirmed';
  const [lightboxOpen, setLightboxOpen] = useState(false);

  const head = extraction?.data;
  const [rows, setRows] = useState<EditRow[]>(() => (head?.rows ?? []).map((r) => ({...r})));
  const [storeCode, setStoreCode] = useState(head?.store_code ?? '');
  const [periodStart, setPeriodStart] = useState(head?.period_start ?? '');
  const [periodEnd, setPeriodEnd] = useState(head?.period_end ?? '');
  const [showAll, setShowAll] = useState(false);
  const rowsRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{kind: 'ok' | 'err'; text: string} | null>(null);

  const flaggedCount = useMemo(() => rows.filter((r) => rowConfidence(r.confidence) < LOW).length, [rows]);
  const docConfidence = extraction?.docConfidence ?? null;
  const visible = useMemo(
    () => rows.map((r, i) => ({r, i})).filter(({r}) => showAll || rowConfidence(r.confidence) < LOW),
    [rows, showAll],
  );

  function updateCell(index: number, key: (typeof COLS)[number]['key'], raw: string) {
    setRows((prev) => {
      const next = [...prev];
      next[index] = {...next[index], [key]: toIntOrNull(raw)};
      return next;
    });
  }

  async function commit() {
    setBusy(true);
    setNotice(null);
    const res = await commitReview({
      company,
      uploadId: upload.id,
      storeCode,
      periodStart,
      periodEnd,
      consultant: head?.consultant ?? null,
      rows: rows.map((r) => ({
        item_code: r.item_code,
        stockroom: r.stockroom,
        drawer: r.drawer,
        selling_area: r.selling_area,
        delivery: r.delivery,
        ending_on_hand: r.ending_on_hand,
      })),
    });
    setBusy(false);
    if (res.ok) {
      setNotice({kind: 'ok', text: `Committed ${res.committed} inventory rows.`});
      router.refresh();
    } else {
      setNotice({kind: 'err', text: res.error});
    }
  }

  // Two-column only when there's a scan to show beside the workbench (inventory PDF).
  const twoCol = Boolean(scanUrl && extraction);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-6">
      <div className="flex flex-col gap-1">
        <Link href="/uploads" className="inline-flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" /> Back to uploads
        </Link>
        <h1 className="font-heading text-xl font-semibold tracking-tight break-all">{upload.filename}</h1>
      </div>

      {committed && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-emerald-500/15 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400">
          <span className="inline-flex items-center gap-2">
            <CheckCircle2 className="size-4" /> This upload is committed.
          </span>
          {inventoryHref && (
            <Link href={inventoryHref} className="inline-flex items-center gap-1 font-medium underline-offset-4 hover:underline">
              View in Inventory <ArrowRight className="size-3.5" />
            </Link>
          )}
        </div>
      )}

      <div className={cn('flex flex-col gap-5', twoCol && 'lg:flex-row lg:items-start')}>
        {/* Left: compact scan preview, sticky; click to enlarge. ~28% on desktop. */}
        {scanUrl && (
          <div className="lg:sticky lg:top-4 lg:w-[28%] lg:shrink-0">
            <Card>
              <CardHeader className="gap-0">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="inline-flex items-center gap-2 text-sm">
                    <FileText className="size-3.5 text-muted-foreground" /> Scan
                  </CardTitle>
                  <a href={scanUrl} target="_blank" rel="noopener noreferrer">
                    <Button variant="ghost" size="xs">
                      <ExternalLink className="size-3.5" /> Open
                    </Button>
                  </a>
                </div>
              </CardHeader>
              <CardContent>
                {/* Click the thumbnail to enlarge. The iframe is pointer-events-none so the
                    click lands on the button overlay, not the embedded PDF viewer. */}
                <button
                  type="button"
                  onClick={() => setLightboxOpen(true)}
                  className="group relative block w-full overflow-hidden rounded-md border border-border bg-muted"
                  aria-label="Enlarge scan"
                >
                  <iframe
                    src={scanUrl}
                    title="Scanned inventory form"
                    tabIndex={-1}
                    className="pointer-events-none h-[360px] w-full"
                  />
                  <span className="absolute inset-0 flex items-end justify-center bg-gradient-to-t from-black/40 to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100">
                    <span className="inline-flex items-center gap-1 rounded-md bg-background/90 px-2 py-1 text-xs font-medium text-foreground">
                      <Maximize2 className="size-3" /> Click to enlarge
                    </span>
                  </span>
                </button>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Right: the review content (~72% when two-column). */}
        <div className="flex min-w-0 flex-1 flex-col gap-5">

      {/* CSV / no-extraction summary */}
      {!extraction && (
        <Card>
          <CardHeader>
            <CardTitle>{upload.kind === 'pos_csv' ? 'Sales CSV' : 'Upload'}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <p className="text-muted-foreground">
              {upload.kind === 'pos_csv'
                ? 'Sales files commit directly to the sales table — there is nothing to review here.'
                : 'No extraction is staged for this file.'}
            </p>
            <p>
              Status: <span className="font-medium">{upload.status}</span>
            </p>
            {upload.reject_reason && <p className="text-destructive">{upload.reject_reason}</p>}
          </CardContent>
        </Card>
      )}

      {/* PDF review workbench */}
      {extraction && (
        <>
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <CardTitle>Document</CardTitle>
                {extraction.page ? (
                  <span className="text-xs text-muted-foreground">Inventory form · page {extraction.page} of 5</span>
                ) : null}
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <DocumentConfidence
                docConfidence={docConfidence}
                rowConfidences={rows.map((r) => r.confidence)}
                onReviewFlagged={() => {
                  setShowAll(false);
                  rowsRef.current?.scrollIntoView({behavior: 'smooth', block: 'start'});
                  rowsRef.current?.focus({preventScroll: true});
                }}
              />

              <fieldset className="flex flex-col gap-2">
                <legend className="mb-2 text-xs font-medium text-muted-foreground">Which store and period is this count for?</legend>
                <div className="flex flex-wrap items-end gap-3">
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium">Store code</span>
                    <input
                      value={storeCode}
                      onChange={(e) => setStoreCode(e.target.value)}
                      disabled={committed || !canEdit}
                      placeholder="e.g. 1"
                      className="h-9 rounded-md border border-border bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 disabled:opacity-60 w-28"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium">Period start</span>
                    <input
                      type="date"
                      value={periodStart ?? ''}
                      onChange={(e) => setPeriodStart(e.target.value)}
                      disabled={committed || !canEdit}
                      className="h-9 rounded-md border border-border bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 disabled:opacity-60"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium">Period end</span>
                    <input
                      type="date"
                      value={periodEnd ?? ''}
                      min={periodStart || undefined}
                      onChange={(e) => setPeriodEnd(e.target.value)}
                      disabled={committed || !canEdit}
                      className="h-9 rounded-md border border-border bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 disabled:opacity-60"
                    />
                  </label>
                </div>
                {(extraction.page ?? 1) > 1 && !committed && (
                  <p className="text-xs text-muted-foreground">
                    Pages 2–5 don&apos;t print the store or period. Use the same ones as this store&apos;s page 1 so all pages land in
                    one Inventory count.
                  </p>
                )}
              </fieldset>
            </CardContent>
          </Card>

          <Card ref={rowsRef} tabIndex={-1} className="scroll-mt-4 outline-none">
            <CardHeader className="gap-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <CardTitle>
                  Rows{' '}
                  <span className="text-sm font-normal text-muted-foreground tabular-nums">
                    ({flaggedCount} flagged of {rows.length})
                  </span>
                </CardTitle>
                <div className="inline-flex overflow-hidden rounded-md border border-border text-xs">
                  <button
                    type="button"
                    onClick={() => setShowAll(false)}
                    className={cn('px-2.5 py-1', !showAll ? 'bg-primary text-primary-foreground' : 'hover:bg-muted')}
                  >
                    Flagged {flaggedCount}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowAll(true)}
                    className={cn('px-2.5 py-1', showAll ? 'bg-primary text-primary-foreground' : 'hover:bg-muted')}
                  >
                    All {rows.length}
                  </button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {visible.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  {rows.length === 0 ? 'No rows were extracted.' : 'Nothing flagged — switch to “All” to see every row.'}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs text-muted-foreground">
                        <th className="py-2 pr-3 font-medium">Item</th>
                        {COLS.map((c) => (
                          <th key={c.key} className="py-2 pr-3 text-right font-medium">
                            {c.label}
                          </th>
                        ))}
                        <th className="py-2 pl-3 font-medium">Conf.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map(({r, i}) => {
                        const low = rowConfidence(r.confidence) < LOW;
                        return (
                          <tr key={`${r.item_code}-${i}`} className={cn('border-b border-border/60', low && 'bg-amber-500/5')}>
                            <td className="py-1.5 pr-3">
                              <span className="font-mono text-xs">{r.item_code}</span>
                              {productNames[r.item_code] && (
                                <span className="block max-w-[14rem] truncate text-xs text-muted-foreground">
                                  {productNames[r.item_code]}
                                </span>
                              )}
                              {r.alt && <span className="block text-[10px] text-amber-700 dark:text-amber-400">alt {r.alt}</span>}
                            </td>
                            {COLS.map((c) => (
                              <td key={c.key} className="py-1.5 pr-3 text-right">
                                <input
                                  inputMode="numeric"
                                  value={r[c.key] ?? ''}
                                  disabled={committed || !canEdit}
                                  onChange={(e) => updateCell(i, c.key, e.target.value)}
                                  className={cn(
                                    'h-7 w-16 rounded-md border bg-background px-1.5 text-right text-sm tabular-nums',
                                    low ? 'border-amber-500/60' : 'border-border',
                                  )}
                                />
                              </td>
                            ))}
                            <td className="py-1.5 pl-3 text-right text-xs tabular-nums">
                              {(() => {
                                // Same three bands + colors as the confidence summary above.
                                const c = rowConfidence(r.confidence);
                                const tone = BAND_TONE[bandOf(c)];
                                return (
                                  <span
                                    className="inline-flex min-w-11 justify-center rounded-full px-1.5 py-0.5 font-medium"
                                    style={{color: toneText(tone), background: `color-mix(in oklab, ${tone} 14%, transparent)`}}
                                  >
                                    {Math.round(c * 100)}%
                                  </span>
                                );
                              })()}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Commit bar */}
          {!committed && canEdit && (
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={commit} disabled={busy || rows.length === 0}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                {busy ? 'Committing…' : 'Commit to inventory'}
              </Button>
              {notice && (
                <span className={cn('text-xs', notice.kind === 'ok' ? 'text-emerald-700 dark:text-emerald-400' : 'text-destructive')}>
                  {notice.text}
                </span>
              )}
            </div>
          )}
          {committed && notice && (
            <span className="text-xs text-emerald-700 dark:text-emerald-400">{notice.text}</span>
          )}
        </>
      )}
        </div>
      </div>

      {/* Enlarged scan — full-screen lightbox. Escape / click backdrop / × to close. */}
      {scanUrl && lightboxOpen && (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-black/70 p-4 sm:p-8"
          role="dialog"
          aria-modal="true"
          aria-label="Scanned file"
          onKeyDown={(e) => {
            if (e.key === 'Escape') setLightboxOpen(false);
          }}
        >
          <div className="mb-2 flex items-center justify-end gap-2">
            <a href={scanUrl} target="_blank" rel="noopener noreferrer">
              <Button variant="secondary" size="sm">
                <ExternalLink className="size-3.5" /> Open in new tab
              </Button>
            </a>
            <Button variant="secondary" size="sm" autoFocus onClick={() => setLightboxOpen(false)}>
              <X className="size-4" /> Close
            </Button>
          </div>
          <iframe src={scanUrl} title="Scanned inventory form (enlarged)" className="min-h-0 w-full flex-1 rounded-md bg-white" />
          <button
            type="button"
            aria-label="Close"
            onClick={() => setLightboxOpen(false)}
            className="absolute inset-0 -z-10 cursor-default"
          />
        </div>
      )}
    </div>
  );
}
