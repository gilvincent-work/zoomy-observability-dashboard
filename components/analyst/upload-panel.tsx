'use client';

import {useEffect, useRef, useState} from 'react';
import {Check, CloudUpload, Loader2, RotateCcw, X} from 'lucide-react';
import {kindOfFile, progressFor, stepStates, type Phase, type UploadKindGuess} from '@/src/upload-progress';
import {FileTypeBadge} from '@/components/analyst/file-type-badge';
import {Card, CardContent} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import {cn} from '@/lib/utils';

// The Uploads screen's "add a file" panel. Pick or drop ONE file (.csv sales export or
// .pdf inventory scan), confirm what will happen, upload. While it runs it shows a
// step tracker and a progress bar driven by the server's real milestones (streamed
// as NDJSON from /api/goldline/upload) plus true upload bytes — see
// src/upload-progress.ts for the honesty rule. A scan lands on its review page; a
// sales CSV reports back through onDone.

const MAX_BYTES = 25 * 1024 * 1024;

type StageEvent =
  | {type: 'stage'; stage: 'stored' | 'parsing' | 'detecting' | 'saving'}
  | {type: 'stage'; stage: 'reading'; page: number; items: number};
type Result = {httpStatus: number; uploadId?: string; status?: string; error?: string; errors?: string[]; rowsCommitted?: number};

const fmtSize = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const fmtElapsed = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function UploadPanel({
  company,
  canEdit,
  configured,
  onDone,
  onOpenReview,
}: {
  company: string;
  canEdit: boolean;
  configured: boolean;
  onDone: (r: {kind: 'ok' | 'err'; text: string}) => void;
  onOpenReview: (uploadId: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState<UploadKindGuess | null>(null);
  const [dragging, setDragging] = useState(false);
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [error, setError] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<Phase>('uploading');
  const [uploadFrac, setUploadFrac] = useState(0);
  const [phaseAt, setPhaseAt] = useState(0);
  const [startedAt, setStartedAt] = useState(0);
  const [now, setNow] = useState(0);
  const [reading, setReading] = useState<{page: number; items: number} | null>(null);

  const disabled = !canEdit || !configured;

  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(t);
  }, [busy]);

  function choose(f: File | null | undefined) {
    setError(null);
    if (!f) return;
    const k = kindOfFile(f.name);
    if (!k) return setError(`“${f.name}” isn’t a .csv or .pdf. Upload a POS sales export (.csv) or an inventory scan (.pdf).`);
    if (f.size === 0) return setError(`“${f.name}” is empty.`);
    if (f.size > MAX_BYTES) return setError(`“${f.name}” is ${fmtSize(f.size)} — the limit is 25 MB.`);
    setFile(f);
    setKind(k);
  }

  function clear() {
    setFile(null);
    setKind(null);
    setError(null);
    setPeriodStart('');
    setPeriodEnd('');
    if (inputRef.current) inputRef.current.value = '';
  }

  const needsPeriod = kind === 'csv';
  const periodBad = needsPeriod && periodStart && periodEnd && periodStart > periodEnd;
  const canSend = !disabled && !!file && !busy && (!needsPeriod || (!!periodStart && !!periodEnd && !periodBad));

  function enter(p: Phase) {
    setPhase(p);
    setPhaseAt(Date.now());
  }

  function send(fd: FormData): Promise<Result> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      let seen = 0;
      let result: Result | null = null;
      const flush = () => {
        const text = xhr.responseText;
        let nl: number;
        while ((nl = text.indexOf('\n', seen)) >= 0) {
          const line = text.slice(seen, nl).trim();
          seen = nl + 1;
          if (!line) continue;
          try {
            const ev = JSON.parse(line) as StageEvent | (Result & {type: 'result'});
            if (ev.type === 'result') result = ev;
            else if (ev.type === 'stage') {
              if (ev.stage === 'reading') setReading({page: ev.page, items: ev.items});
              enter(ev.stage);
            }
          } catch {
            /* partial line — wait for the rest */
          }
        }
      };
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) setUploadFrac(e.loaded / e.total);
      };
      xhr.upload.onload = () => setUploadFrac(1);
      xhr.onprogress = flush;
      xhr.onload = () => {
        flush();
        if (result) return resolve(result);
        try {
          resolve({httpStatus: xhr.status, ...(JSON.parse(xhr.responseText) as Omit<Result, 'httpStatus'>)});
        } catch {
          reject(new Error(`Upload failed (${xhr.status}). Please try again.`));
        }
      };
      xhr.onerror = () => reject(new Error('Network error — check your connection and try again.'));
      xhr.open('POST', `/api/goldline/upload?company=${encodeURIComponent(company)}`);
      xhr.setRequestHeader('Accept', 'application/x-ndjson');
      xhr.send(fd);
    });
  }

  async function submit() {
    if (!file || !kind || !canSend) return;
    const fd = new FormData();
    fd.append('file', file);
    if (needsPeriod) {
      fd.append('period_start', periodStart);
      fd.append('period_end', periodEnd);
    }
    setError(null);
    setReading(null);
    setUploadFrac(0);
    setBusy(true);
    setStartedAt(Date.now());
    setNow(Date.now());
    enter('uploading');
    try {
      const res = await send(fd);
      if (res.status === 'needs_review' && res.uploadId) {
        enter('done');
        onOpenReview(res.uploadId);
        return; // navigating away; keep the finished state on screen meanwhile
      }
      if (res.status === 'committed') {
        enter('done');
        onDone({kind: 'ok', text: `Saved ${res.rowsCommitted ?? 0} sales rows from ${file.name}.`});
        setBusy(false);
        clear();
        return;
      }
      setBusy(false);
      // Shown inline with "Try again"; the list refresh picks up the failed/rejected row.
      setError(res.error ?? res.errors?.[0] ?? `Upload failed (${res.httpStatus}).`);
      onDone({kind: 'err', text: ''});
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : 'Upload failed.');
    }
  }

  const pct = kind ? progressFor(kind, phase, uploadFrac, now - phaseAt) : 0;
  const steps = kind ? stepStates(kind, phase) : [];
  const status =
    phase === 'uploading'
      ? `Uploading ${file ? fmtSize(file.size) : ''} — ${Math.round(uploadFrac * 100)}%`
      : phase === 'stored' || phase === 'detecting'
        ? 'Finding which form page this is…'
        : phase === 'parsing'
          ? 'Reading the sales rows…'
          : phase === 'reading'
            ? `Reading page ${reading?.page ?? ''} — ${reading?.items ?? 0} items. This usually takes 30–60 seconds.`
            : phase === 'saving'
              ? kind === 'pdf'
                ? 'Saving the reading for your review…'
                : 'Saving sales…'
              : kind === 'pdf'
                ? 'Done — opening the review…'
                : 'Done.';

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-heading text-base font-semibold">Add a file</h2>
          <span className="text-xs text-muted-foreground">One file at a time · up to 25 MB</span>
        </div>

        {!configured && (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">Uploads aren&apos;t configured for this environment yet.</p>
        )}
        {configured && !canEdit && (
          <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">Your role can view uploads but not add them.</p>
        )}

        <input
          ref={inputRef}
          type="file"
          accept=".csv,.pdf,text/csv,application/pdf"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          disabled={disabled}
          onChange={(e) => choose(e.target.files?.[0])}
        />

        {!file ? (
          <div
            role="button"
            tabIndex={disabled ? -1 : 0}
            aria-disabled={disabled}
            aria-label="Choose a file to upload, or drop one here"
            onClick={() => !disabled && inputRef.current?.click()}
            onKeyDown={(e) => {
              if (!disabled && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault();
                inputRef.current?.click();
              }
            }}
            onDragEnter={(e) => {
              e.preventDefault();
              if (!disabled) setDragging(true);
            }}
            onDragOver={(e) => e.preventDefault()}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              if (!disabled) choose(e.dataTransfer.files?.[0]);
            }}
            className={cn(
              'group flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-6 py-10 text-center outline-none transition-[background-color,border-color] duration-150 ease-out focus-visible:ring-3 focus-visible:ring-ring/40',
              dragging ? 'border-primary bg-primary/5' : 'border-border hover:border-foreground/30 hover:bg-muted/40',
              disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
            )}
          >
            <span
              className={cn(
                'flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground transition-transform duration-200 ease-out',
                dragging && 'scale-110 bg-primary/15 text-primary',
              )}
            >
              <CloudUpload className="size-5" aria-hidden />
            </span>
            <span className="text-sm">
              <span className="font-medium">{dragging ? 'Drop to add it' : 'Drop a file here'}</span>
              {!dragging && (
                <>
                  <span className="text-muted-foreground"> or </span>
                  <span className="font-medium text-primary underline-offset-4 group-hover:underline">browse</span>
                </>
              )}
            </span>
            <span className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <FileTypeBadge filename="x.csv" /> POS sales export
              </span>
              <span className="inline-flex items-center gap-1.5">
                <FileTypeBadge filename="x.pdf" /> Inventory form scan
              </span>
            </span>
          </div>
        ) : (
          <div className="flex flex-col gap-4 rounded-xl border border-border p-4">
            <div className="flex items-center gap-3">
              <FileTypeBadge filename={file.name} className="h-7 min-w-11 text-[11px]" />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium" title={file.name}>
                  {file.name}
                </span>
                <span className="text-xs text-muted-foreground">
                  {fmtSize(file.size)} ·{' '}
                  {kind === 'pdf' ? 'Read automatically, then you review it before it counts' : 'Saved straight to sales for the period below'}
                </span>
              </div>
              {!busy && (
                <Button variant="ghost" size="icon-sm" aria-label="Remove file" onClick={clear}>
                  <X className="size-4" />
                </Button>
              )}
            </div>

            {needsPeriod && !busy && (
              <fieldset className="flex flex-wrap items-end gap-3">
                <legend className="mb-1.5 text-xs font-medium">Which period does this export cover?</legend>
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">From</span>
                  <input
                    type="date"
                    value={periodStart}
                    onChange={(e) => setPeriodStart(e.target.value)}
                    className="h-8 rounded-md border border-border bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">To</span>
                  <input
                    type="date"
                    value={periodEnd}
                    min={periodStart || undefined}
                    onChange={(e) => setPeriodEnd(e.target.value)}
                    className="h-8 rounded-md border border-border bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
                  />
                </label>
                {periodBad && <span className="text-xs text-destructive">“To” must be on or after “From”.</span>}
              </fieldset>
            )}

            {busy && kind && (
              <div className="flex flex-col gap-3">
                <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs" aria-label="Upload steps">
                  {steps.map((s, i) => (
                    <li key={s.key} className="flex items-center gap-2">
                      <span
                        className={cn(
                          'inline-flex items-center gap-1.5',
                          s.state === 'pending' ? 'text-muted-foreground' : 'font-medium text-foreground',
                        )}
                        aria-current={s.state === 'active' ? 'step' : undefined}
                      >
                        <span
                          className={cn(
                            'flex size-4 items-center justify-center rounded-full',
                            s.state === 'done' && 'bg-primary text-primary-foreground',
                            s.state === 'active' && 'text-primary',
                            s.state === 'pending' && 'border border-border',
                          )}
                        >
                          {s.state === 'done' ? (
                            <Check className="size-3" strokeWidth={3} />
                          ) : s.state === 'active' ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : null}
                        </span>
                        {s.label}
                      </span>
                      {i < steps.length - 1 && <span className="h-px w-4 bg-border" aria-hidden />}
                    </li>
                  ))}
                </ol>
                <div
                  role="progressbar"
                  aria-label="Upload progress"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(pct)}
                  aria-valuetext={status}
                  className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
                >
                  <div
                    className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out motion-reduce:transition-none"
                    style={{width: `${pct}%`}}
                  />
                </div>
                <div className="flex items-baseline justify-between gap-3 text-xs">
                  <span className="text-muted-foreground" aria-live="polite">
                    {status}
                  </span>
                  <span className="shrink-0 font-mono tabular-nums text-muted-foreground">{fmtElapsed(now - startedAt)}</span>
                </div>
              </div>
            )}

            {!busy && (
              <div className="flex flex-wrap items-center justify-end gap-2">
                {error && (
                  <Button variant="ghost" onClick={() => inputRef.current?.click()}>
                    Choose another file
                  </Button>
                )}
                <Button onClick={submit} disabled={!canSend}>
                  {error ? <RotateCcw className="size-4" /> : <CloudUpload className="size-4" />}
                  {error ? 'Try again' : kind === 'pdf' ? 'Upload and read scan' : 'Upload sales'}
                </Button>
              </div>
            )}
          </div>
        )}

        {error && (
          <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
