import {permanentRedirect} from 'next/navigation';

/** Moved under the Customers hub. Kept so older links and bookmarks still land. */
export default function Page() {
  permanentRedirect('/customers/website-crm');
}
