'use client';

import {useMemo, useRef, useState, useTransition} from 'react';
import {useRouter} from 'next/navigation';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileSpreadsheet,
  FileText,
  Loader2,
  Search,
  Trash2,
  Upload,
  XCircle,
} from 'lucide-react';
import {deleteUploadAction} from '@/app/uploads/actions';
import type {UploadKind, UploadRow, UploadStatus} from '@/src/goldline-data';
import {Card, CardContent, CardHeader, CardTitle} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import {Pagination} from '@/components/analyst/pagination';
import {cn} from '@/lib/utils';

// The Uploads inbox for one company: drop a POS .csv or a scanned inventory .pdf,
// then triage the file list. CSVs commit straight to gl_sales; PDFs go to Claude
// Vision and land in a review queue — selecting one opens its review page. Search,
// status/type filters, and pagination all run client-side over the company's list.

const PAGE_SIZE = 8;

type StatusFilter = 'all' | UploadStatus;
type KindFilter = 'all' | UploadKind;

const STATUS_META: Record<UploadStatus, {label: string; cls: string; Icon: typeof Clock}> = {
  processing: {label: 'Processing', cls: 'text-muted-foreground bg-muted', Icon: Loader2},
  needs_review: {label: 'Needs review', cls: 'text-amber-700 bg-amber-500/15 dark:text-amber-400', Icon: AlertTriangle},
  committed: {label: 'Committed', cls: 'text-emerald-700 bg-emerald-500/15 dark:text-emerald-400', Icon: CheckCircle2},
  failed: {label: 'Failed', cls: 'text-destructive bg-destructive/10', Icon: XCircle},
  rejected: {label: 'Rejected', cls: 'text-destructive bg-destructive/10', Icon: XCircle},
};

function StatusPill({status}: {status: UploadStatus}) {
  const m = STATUS_META[status] ?? STATUS_META.processing;
  const {Icon} = m;
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', m.cls)}>
      <Icon className={cn('size-3', status === 'processing' && 'animate-spin')} />
      {m.label}
    </span>
  );
}

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'});
}

function extOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot).toLowerCase();
}

export function UploadsView({
  company,
  canEdit,
  configured,
  uploads,
}: {
  company: string;
  canEdit: boolean;
  configured: boolean;
  uploads: UploadRow[];
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{kind: 'ok' | 'err'; text: string} | null>(null);

  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [page, setPage] = useState(1);

  // Delete: a confirm step (which row), and a pending transition.
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [deleting, startDelete] = useTransition();

  function remove(id: string) {
    setConfirmId(null);
    startDelete(async () => {
      const res = await deleteUploadAction({company, uploadId: id});
      if (res.ok) router.refresh();
      else setNotice({kind: 'err', text: res.error});
    });
  }

  const isCsv = file ? extOf(file.name) === '.csv' : false;
  const needsPeriod = isCsv;
  const canSubmit =
    canEdit && configured && !!file && !busy && (!needsPeriod || (!!periodStart && !!periodEnd));

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return uploads.filter((u) => {
      if (statusFilter !== 'all' && u.status !== statusFilter) return false;
      if (kindFilter !== 'all' && u.kind !== kindFilter) return false;
      if (q && !u.filename.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [uploads, query, statusFilter, kindFilter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  async function submit() {
    if (!file || !canSubmit) return;
    setBusy(true);
    setNotice(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      if (needsPeriod) {
        fd.append('period_start', periodStart);
        fd.append('period_end', periodEnd);
      }
      const res = await fetch(`/api/goldline/upload?company=${encodeURIComponent(company)}`, {
        method: 'POST',
        body: fd,
      });
      const data = (await res.json().catch(() => ({}))) as {
        uploadId?: string;
        status?: string;
        error?: string;
        rowsCommitted?: number;
      };
      if (!res.ok) {
        setNotice({kind: 'err', text: data.error ?? `Upload failed (${res.status}).`});
        return;
      }
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';
      if (data.status === 'needs_review' && data.uploadId) {
        router.push(`/uploads/${data.uploadId}`);
        return;
      }
      setNotice({
        kind: 'ok',
        text:
          data.status === 'committed'
            ? `Committed ${data.rowsCommitted ?? 0} sales rows.`
            : 'Uploaded.',
      });
      router.refresh();
    } catch (e) {
      setNotice({kind: 'err', text: e instanceof Error ? e.message : 'Upload failed.'});
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-xl font-semibold tracking-tight">Uploads</h1>
        <p className="text-sm text-muted-foreground">
          Drop a POS sales <span className="font-medium">.csv</span> or a scanned inventory{' '}
          <span className="font-medium">.pdf</span>. Sales commit directly; scanned forms go to review.
        </p>
      </header>

      {/* Upload card */}
      <Card>
        <CardHeader>
          <CardTitle>New upload</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {!configured && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
              Uploads aren&apos;t configured for this environment yet.
            </p>
          )}
          {!canEdit && (
            <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
              Your role can view uploads but not add them.
            </p>
          )}

          <label
            className={cn(
              'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border px-4 py-8 text-center transition-colors hover:border-primary/60 hover:bg-muted/40',
              (!canEdit || !configured) && 'pointer-events-none opacity-50',
            )}
          >
            <Upload className="size-6 text-muted-foreground" />
            <span className="text-sm font-medium">
              {file ? file.name : 'Choose a .csv or .pdf file'}
            </span>
            <span className="text-xs text-muted-foreground">
              {file ? `${(file.size / 1024).toFixed(0)} KB` : 'CSV (sales) or PDF (scanned inventory), up to 25 MB'}
            </span>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.pdf"
              className="hidden"
              disabled={!canEdit || !configured}
              onChange={(e) => {
                setNotice(null);
                setFile(e.target.files?.[0] ?? null);
              }}
            />
          </label>

          {needsPeriod && (
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium text-muted-foreground">Period start</span>
                <input
                  type="date"
                  value={periodStart}
                  onChange={(e) => setPeriodStart(e.target.value)}
                  className="h-8 rounded-md border border-border bg-background px-2 text-sm"
                />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium text-muted-foreground">Period end</span>
                <input
                  type="date"
                  value={periodEnd}
                  onChange={(e) => setPeriodEnd(e.target.value)}
                  className="h-8 rounded-md border border-border bg-background px-2 text-sm"
                />
              </div>
              <span className="text-xs text-muted-foreground">A sales CSV needs the period it covers.</span>
            </div>
          )}

          <div className="flex items-center gap-3">
            <Button onClick={submit} disabled={!canSubmit}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
              {busy ? 'Uploading…' : 'Upload'}
            </Button>
            {notice && (
              <span className={cn('text-xs', notice.kind === 'ok' ? 'text-emerald-700 dark:text-emerald-400' : 'text-destructive')}>
                {notice.text}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* File list */}
      <Card>
        <CardHeader className="gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle>Files</CardTitle>
            <span className="text-xs text-muted-foreground tabular-nums">
              {filtered.length} of {uploads.length}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(1);
                }}
                placeholder="Search file name…"
                className="h-8 w-56 rounded-md border border-border bg-background pr-2 pl-7 text-sm"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value as StatusFilter);
                setPage(1);
              }}
              className="h-8 rounded-md border border-border bg-background px-2 text-sm"
            >
              <option value="all">All statuses</option>
              <option value="needs_review">Needs review</option>
              <option value="committed">Committed</option>
              <option value="processing">Processing</option>
              <option value="failed">Failed</option>
              <option value="rejected">Rejected</option>
            </select>
            <select
              value={kindFilter}
              onChange={(e) => {
                setKindFilter(e.target.value as KindFilter);
                setPage(1);
              }}
              className="h-8 rounded-md border border-border bg-background px-2 text-sm"
            >
              <option value="all">All types</option>
              <option value="pos_csv">Sales CSV</option>
              <option value="inventory_pdf">Inventory PDF</option>
            </select>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {pageRows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No files match.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">File</th>
                    <th className="py-2 pr-3 font-medium">Type</th>
                    <th className="py-2 pr-3 font-medium">Status</th>
                    <th className="py-2 pr-3 font-medium">Uploaded</th>
                    <th className="py-2 pr-3 font-medium">By</th>
                    {canEdit && <th className="py-2 font-medium sr-only">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((u) => {
                    const Icon = u.kind === 'pos_csv' ? FileSpreadsheet : FileText;
                    return (
                      <tr
                        key={u.id}
                        tabIndex={0}
                        role="button"
                        onClick={() => router.push(`/uploads/${u.id}`)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            router.push(`/uploads/${u.id}`);
                          }
                        }}
                        className="cursor-pointer border-b border-border/60 outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted/50"
                      >
                        <td className="max-w-[18rem] truncate py-2.5 pr-3">
                          <span className="inline-flex items-center gap-2">
                            <Icon className="size-4 shrink-0 text-muted-foreground" />
                            <span className="truncate">{u.filename}</span>
                          </span>
                          {u.reject_reason && (
                            <span className="mt-0.5 block truncate text-xs text-destructive">{u.reject_reason}</span>
                          )}
                        </td>
                        <td className="py-2.5 pr-3 text-xs text-muted-foreground">
                          {u.kind === 'pos_csv' ? 'Sales CSV' : 'Inventory PDF'}
                        </td>
                        <td className="py-2.5 pr-3">
                          <StatusPill status={u.status} />
                        </td>
                        <td className="py-2.5 pr-3 text-xs text-muted-foreground tabular-nums">{fmtWhen(u.created_at)}</td>
                        <td className="max-w-[12rem] truncate py-2.5 pr-3 text-xs text-muted-foreground">{u.uploaded_by ?? '—'}</td>
                        {canEdit && (
                          <td className="py-2.5 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                            {confirmId === u.id ? (
                              <span className="inline-flex items-center gap-1">
                                <Button
                                  variant="ghost"
                                  size="xs"
                                  className="text-destructive hover:text-destructive"
                                  disabled={deleting}
                                  onClick={() => remove(u.id)}
                                >
                                  {deleting ? <Loader2 className="size-3.5 animate-spin" /> : 'Confirm'}
                                </Button>
                                <Button variant="ghost" size="xs" disabled={deleting} onClick={() => setConfirmId(null)}>
                                  Cancel
                                </Button>
                              </span>
                            ) : (
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label={`Delete ${u.filename}`}
                                className="text-muted-foreground hover:text-destructive"
                                onClick={() => setConfirmId(u.id)}
                              >
                                <Trash2 className="size-3.5" />
                              </Button>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <Pagination page={safePage} pageCount={pageCount} onPage={setPage} className="pt-1" />
        </CardContent>
      </Card>
    </div>
  );
}
