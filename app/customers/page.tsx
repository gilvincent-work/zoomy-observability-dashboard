import {redirect} from 'next/navigation';

/** The Customers hub opens on the website CRM; the source switcher in the top
 * bar moves between that, the booth leads and the Lazada contacts. */
export default function Page() {
  redirect('/customers/website-crm');
}
