import Link from 'next/link';
import {FileBarChart, Lock, Pin, Users} from 'lucide-react';
import type {ReportListItem} from '@/src/reports-types';
import {formatReportTime, reportHref} from './reports-helpers';

const CHIP = 'inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-[11px] text-foreground';

function ReportCard({report}: {report: ReportListItem}) {
  const updated = formatReportTime(report.updated_at);
  return (
    <li>
      <Link
        href={reportHref(report.id)}
        className="flex h-full min-h-28 flex-col gap-2.5 rounded-2xl border border-border bg-card p-4 transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <span className="flex items-start gap-2">
          <h2 className="min-w-0 flex-1 break-words text-[15px] font-semibold leading-snug text-foreground">{report.title}</h2>
          {report.pinned && (
            <span className="mt-0.5 inline-flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
              <Pin className="size-3.5" aria-hidden />
              Pinned
            </span>
          )}
        </span>
        <span className="flex flex-wrap items-center gap-1.5">
          <span className={CHIP}>
            {report.visibility === 'private' ? <Lock className="size-3" aria-hidden /> : <Users className="size-3" aria-hidden />}
            {report.visibility === 'private' ? 'Only me' : 'Team'}
          </span>
          <span className={`${CHIP} tabular-nums`}>Version {report.current_version}</span>
        </span>
        <span className="mt-auto space-y-0.5 text-[12px] text-muted-foreground">
          <span className="block truncate">{report.mine ? 'By you' : `By ${report.owner_email}`}</span>
          {updated && <span className="block">Updated {updated}</span>}
        </span>
      </Link>
    </li>
  );
}

/** The /reports gallery body: pinned first, then most recent, in the order the server returns them. */
export function ReportsGallery({reports}: {reports: ReportListItem[]}) {
  return (
    <div className="mx-auto max-w-5xl px-4 py-6 md:px-10 md:py-10">
      <div className="mb-6">
        <h1 className="font-serif text-[1.65rem] font-normal leading-tight text-foreground md:text-[2rem]">Reports</h1>
        <p className="mt-1 text-sm text-muted-foreground">Dashboards saved from Coop. Opening one re-runs it on live data.</p>
      </div>
      {reports.length === 0 ? (
        <div className="flex flex-col items-start gap-3 rounded-2xl border border-dashed border-border bg-card p-5 md:p-6">
          <span className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <FileBarChart className="size-[18px]" aria-hidden />
          </span>
          <p className="text-sm text-foreground">No reports yet. Ask Coop for a dashboard, then Save it.</p>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {reports.map((r) => (
            <ReportCard key={r.id} report={r} />
          ))}
        </ul>
      )}
    </div>
  );
}
