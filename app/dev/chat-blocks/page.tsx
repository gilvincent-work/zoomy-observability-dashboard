// DEV-ONLY preview of every Ask Coop block variant on synthetic data. 404 in production.
import {notFound} from 'next/navigation';
import {ChatBlocksPreview} from './preview';

export default function Page() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <ChatBlocksPreview />;
}
