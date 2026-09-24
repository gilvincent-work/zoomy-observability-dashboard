import {redirect} from 'next/navigation';

/** The Customers hub lands on the merged list; the source switcher in the top
 * bar moves to a single list. */
export default function Page() {
  redirect('/customers/all');
}
