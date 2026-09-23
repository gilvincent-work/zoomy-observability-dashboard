import {getSpinLeads} from '@/src/spin-leads';
import {LeadCapture} from '@/components/analyst/lead-capture';

export const dynamic = 'force-dynamic';

/**
 * Every spin-the-wheel lead ever collected, across events — the booth's contact
 * list. The per-event slice of the same data stays on the event page, where it
 * is read against that event's orders; here there is no single event to divide
 * by, so the "leads per order" stat reads as '—'.
 */
export default async function Page() {
  const leads = await getSpinLeads();
  return (
    <div className="space-y-6 p-6 md:p-10">
      <header>
        <h1 className="font-serif text-3xl font-normal tracking-tight">Event lead contacts</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Emails and mobile numbers given in person at the booth, in exchange for a spin. Market to
          them on that basis only, and honour an unsubscribe on either channel.
        </p>
      </header>
      <LeadCapture leads={leads} orders={0} />
    </div>
  );
}
