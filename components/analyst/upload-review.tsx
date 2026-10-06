'use client';

import {useMemo, useState} from 'react';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {ArrowLeft, CheckCircle2, ExternalLink, FileText, Loader2, Maximize2, X} from 'lucide-react';
import type {ExtractionRecord, UploadRow} from '@/src/goldline-data';
import type {ExtractedRow} from '@/src/goldline-extract-run';
import {commitReview} from '@/app/uploads/actions';
import {Card, CardContent, CardHeader, CardTitle} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import {cn} from '@/lib/utils';

// Review workbench for one scanned inventory page. Shows the staged Claude Vision
// read, pre-filled and editable; low-confidence rows are flagged so the reviewer
// fixes the exceptions, confirms the header (store + period), and commits to
// gl_inventory. A sales CSV has no extraction, so it renders a status summary.

const LOW = 0.6; // below this a row is flagged for human eyes.
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
}: {
  company: string;
  canEdit: boolean;
  upload: UploadRow;
  extraction: ExtractionRecord | null;
  /** Same-origin proxy path to the stored scan (streams the private file), or null. */
  scanUrl?: string | null;
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
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{kind: 'ok' | 'err'; text: string} | null>(null);

  const flaggedCount = useMemo(() => rows.filter((r) => (r.confidence ?? 1) < LOW).length, [rows]);
  const docConfidence = extraction?.docConfidence ?? null;
  const visible = useMemo(
    () => rows.map((r, i) => ({r, i})).filter(({r}) => showAll || (r.confidence ?? 1) < LOW),
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
        <div className="flex items-center gap-2 rounded-md bg-emerald-500/15 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="size-4" /> This upload is committed.
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
              <CardTitle>Document</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-muted-foreground">Store code</span>
                  <input
                    value={storeCode}
                    onChange={(e) => setStoreCode(e.target.value)}
                    disabled={committed || !canEdit}
                    className="h-8 w-28 rounded-md border border-border bg-background px-2 text-sm"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-muted-foreground">Period start</span>
                  <input
                    type="date"
                    value={periodStart ?? ''}
                    onChange={(e) => setPeriodStart(e.target.value)}
                    disabled={committed || !canEdit}
                    className="h-8 rounded-md border border-border bg-background px-2 text-sm"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-muted-foreground">Period end</span>
                  <input
                    type="date"
                    value={periodEnd ?? ''}
                    onChange={(e) => setPeriodEnd(e.target.value)}
                    disabled={committed || !canEdit}
                    className="h-8 rounded-md border border-border bg-background px-2 text-sm"
                  />
                </label>
              </div>

              {/* Confidence summary */}
              {docConfidence !== null && (
                <div className="flex flex-col gap-1">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Document confidence</span>
                    <span className="tabular-nums">{Math.round(docConfidence * 100)}%</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn('h-full rounded-full', docConfidence < LOW ? 'bg-amber-500' : 'bg-emerald-500')}
                      style={{width: `${Math.round(Math.max(0, Math.min(1, docConfidence)) * 100)}%`}}
                    />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
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
                        const low = (r.confidence ?? 1) < LOW;
                        return (
                          <tr key={`${r.item_code}-${i}`} className={cn('border-b border-border/60', low && 'bg-amber-500/5')}>
                            <td className="py-1.5 pr-3 font-mono text-xs">
                              {r.item_code}
                              {r.alt && <span className="ml-1 text-[10px] text-amber-700 dark:text-amber-400">alt {r.alt}</span>}
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
                            <td className="py-1.5 pl-3 text-xs tabular-nums">
                              <span className={cn(low ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground')}>
                                {Math.round((r.confidence ?? 1) * 100)}%
                              </span>
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
