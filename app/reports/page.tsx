import {redirect} from 'next/navigation';
import {ReportsGallery} from '@/components/analyst/reports-gallery';
import {ReportsNotice} from '@/components/analyst/reports-notice';
import {noticeFor} from '@/components/analyst/reports-helpers';
import {listReports} from '@/src/reports-data';
import {reportsViewerEmail} from '@/src/reports-session';

export const dynamic = 'force-dynamic';
export const metadata = {title: 'Reports · Coop'};

// F9 gallery. Reads only: no model call. Access rules (team vs private) are applied inside listReports for this viewer.
export default async function ReportsPage() {
  const viewer = await reportsViewerEmail();
  if (!viewer) redirect('/signin?callbackUrl=%2Freports');
  const result = await listReports(viewer);
  if (result.status === 'ok') return <ReportsGallery reports={result.reports} />;
  const notice = noticeFor(result.status, result.status === 'error' ? result.message : undefined);
  return <ReportsNotice title={notice.title} body={notice.body} />;
}
