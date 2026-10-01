import {notFound, redirect} from 'next/navigation';
import {ReportBlocks} from '@/components/analyst/reports-blocks';
import {ReportHeader} from '@/components/analyst/reports-header';
import {ReportsNotice} from '@/components/analyst/reports-notice';
import {noticeFor, parseVersionParam, statusLine, toDrawerSpec} from '@/components/analyst/reports-helpers';
import {getChatMetricData} from '@/src/chat/server';
import type {MetricData} from '@/src/chat/result-types';
import {getReport} from '@/src/reports-data';
import {runReport} from '@/src/reports-run';
import {reportsViewerEmail} from '@/src/reports-session';

export const dynamic = 'force-dynamic';
export const metadata = {title: 'Report · Coop'};

/** The data a saved report is re-run on. A failure (production before the read-only role, a missing secret) is a state, not a crash. */
async function loadData(): Promise<MetricData | null> {
  try {
    return await getChatMetricData();
  } catch {
    return null;
  }
}

// F9 report page: the latest version, or `?v=N` read-only. Opening a report re-runs its recipe on live data with ZERO model
// calls. Hidden and missing reports are the same 404.
export default async function ReportPage(props: {params: Promise<{id: string}>; searchParams: Promise<{v?: string | string[]}>}) {
  const [{id}, query] = await Promise.all([props.params, props.searchParams]);
  const viewer = await reportsViewerEmail();
  if (!viewer) redirect(`/signin?callbackUrl=${encodeURIComponent(`/reports/${id}`)}`);

  const result = await getReport(id, viewer, parseVersionParam(query.v));
  if (result.status === 'not_found') notFound();
  if (result.status === 'deleted') return <ReportsNotice title="This report was deleted" body="Its link no longer shows any data." linkLabel="Back to reports" />;
  if (result.status !== 'ok') {
    const notice = noticeFor(result.status, result.status === 'error' ? result.message : undefined);
    return <ReportsNotice title={notice.title} body={notice.body} linkLabel="Back to reports" />;
  }

  const {detail} = result;
  const {report, viewing} = detail;
  const data = await loadData();
  const now = new Date();
  const run = data ? runReport(viewing.spec, data, now) : null;
  const ran = run && run.ok ? run : null;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 md:px-10 md:py-10">
      <ReportHeader
        id={report.id}
        title={report.title}
        ownerEmail={report.owner_email}
        isOwner={detail.isOwner}
        canEdit={detail.canEdit}
        visibility={report.visibility}
        pinned={report.pinned}
        currentVersion={report.current_version}
        latestVersion={detail.latestVersion}
        viewingVersion={viewing.version}
        isLatest={detail.isLatest}
        versions={detail.versions}
        status={ran ? {mode: ran.mode, text: statusLine(ran, now)} : null}
        scope={ran ? ran.filtersLabel : null}
        askSpec={detail.isLatest ? toDrawerSpec(viewing.spec) : null}
        storedSpec={viewing.spec}
      />
      {ran ? (
        <ReportBlocks blocks={ran.blocks} />
      ) : (
        <div role="status" className="rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">
          {run && !run.ok ? `This report can't be shown: ${run.error}` : "Live data isn't available right now. Try again in a moment."}
        </div>
      )}
    </div>
  );
}
