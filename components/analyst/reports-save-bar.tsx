'use client';

// The drawer's slim save bar (F9): Save report, Update report, or "Saved · v2" with Open as page. It sits under the open
// dashboard's chips and is driven by `saveBarState`, which wraps the server's own `suggestSave` rule. These are user clicks
// only: the model has no tool that saves, and nothing here runs without a click. Errors show inline, including a stale version.
import {useEffect, useState, useTransition} from 'react';
import Link from 'next/link';
import {Check} from 'lucide-react';
import {cn} from '@/lib/utils';
import type {ReportSpec} from '@/src/chat/report-types';
import {saveReport, updateReport} from '@/src/reports-actions';
import type {SavedReportRef} from '@/src/reports-suggest';
import {friendlySaveError, pinDatesFor, reportHref, saveBarState} from './reports-helpers';

const ACTION =
  'inline-flex h-10 items-center rounded-full bg-primary px-3.5 text-[12px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50 md:h-8 md:px-3';

export function ReportSaveBar({
  report,
  saved,
  busy,
  prompt,
  onSaved,
  onNavigate,
}: {
  report: ReportSpec;
  saved: SavedReportRef | null;
  /** The chat is still answering: saving now would store a half-finished recipe. */
  busy: boolean;
  /** The last user message, stored as the version's source prompt. */
  prompt: string | null;
  onSaved: (ref: SavedReportRef) => void;
  /** Called when "Open as page" is followed, so the drawer can step aside. */
  onNavigate?: () => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // null = follow the saved version (an update keeps fixed dates when the saved one had them).
  const [pinChoice, setPinChoice] = useState<boolean | null>(null);

  // An error belongs to the draft it came from.
  useEffect(() => setError(null), [report, saved]);

  const state = saveBarState(report, saved, {pending, busy, error});
  if (state.kind === 'none') return null;
  const pinDates = pinChoice ?? pinDatesFor(saved, report);

  const run = () => {
    setError(null);
    start(async () => {
      const res = state.kind === 'update' && saved ? await updateReport({id: saved.id, expectedVersion: saved.version, spec: report, prompt, pinDates}) : await saveReport({spec: report, prompt, pinDates});
      if (!res.ok) {
        setError(friendlySaveError(res.error));
        return;
      }
      setPinChoice(null);
      onSaved({id: res.id, version: res.version, spec: report});
    });
  };

  return (
    <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px]" aria-label="Save this dashboard">
      {state.kind === 'saved' && saved ? (
        <>
          <span className="inline-flex items-center gap-1 text-foreground">
            <Check className="size-3.5 text-primary" aria-hidden />
            Saved · v{saved.version}
          </span>
          <Link href={reportHref(saved.id)} onClick={onNavigate} className="inline-flex h-10 items-center text-primary underline-offset-2 hover:underline md:h-8">
            Open as page
          </Link>
        </>
      ) : (
        <>
          <button type="button" onClick={run} disabled={state.disabled} className={cn(ACTION)}>
            {state.pending ? 'Saving…' : state.kind === 'update' ? 'Update report' : 'Save report'}
          </button>
          <label className="inline-flex h-10 cursor-pointer items-center gap-1.5 text-muted-foreground md:h-8" title="Keep these exact dates instead of re-resolving the range each time">
            <input type="checkbox" checked={pinDates} disabled={state.disabled} onChange={(e) => setPinChoice(e.target.checked)} className="size-4 accent-[var(--primary)]" />
            Pin dates
          </label>
        </>
      )}
      {state.error && (
        <span role="alert" className="basis-full text-destructive">
          {state.error}
        </span>
      )}
    </div>
  );
}
