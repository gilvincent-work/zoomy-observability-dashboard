import Link from 'next/link';
import {FileBarChart} from 'lucide-react';

/** A calm full-width message for the Reports pages: not set up, demo mode, deleted, data unavailable, a read error. */
export function ReportsNotice({title, body, href = '/reports', linkLabel}: {title: string; body: string; href?: string; linkLabel?: string}) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 md:px-10 md:py-16">
      <div className="flex flex-col items-start gap-3 rounded-2xl border border-border bg-card p-5 md:p-6">
        <span className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <FileBarChart className="size-[18px]" aria-hidden />
        </span>
        <h1 className="font-serif text-2xl font-normal leading-tight text-foreground">{title}</h1>
        <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">{body}</p>
        {linkLabel && (
          <Link href={href} className="inline-flex h-10 items-center rounded-lg border border-border bg-background px-4 text-[13px] font-medium text-foreground transition-colors hover:bg-muted">
            {linkLabel}
          </Link>
        )}
      </div>
    </div>
  );
}
