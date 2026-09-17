import {redirect} from 'next/navigation';

// Products merged into Inventory (feat/inventory-revamp). This route redirects in
// so old links, bookmarks, and any lingering references keep working (D9).
export default function Page() {
  redirect('/inventory');
}
