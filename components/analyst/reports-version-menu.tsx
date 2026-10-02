'use client';

// The version dropdown on a report page: number, time, who and the prompt for each saved version. Choosing one navigates
// to ?v=N (the latest is the plain URL). Read-only: nothing here writes.
import Link from 'next/link';
import {Check, ChevronDown, History} from 'lucide-react';
import type {ReportVersionMeta} from '@/src/reports-types';
import {cn} from '@/lib/utils';
import {Menu, MENU_ITEM} from './reports-menu';
import {reportHref, versionSummary, versionTitle} from './reports-helpers';

export function ReportVersionMenu({id, versions, viewing, latest}: {id: string; versions: ReportVersionMeta[]; viewing: number; latest: number}) {
  return (
    <Menu
      label="Versions"
      panelClassName="w-80 max-h-[min(24rem,70vh)] overflow-y-auto"
      trigger={
        <>
          <History className="size-4 text-muted-foreground" aria-hidden />
          <span className="tabular-nums">{versionTitle(viewing, latest)}</span>
          <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden />
        </>
      }
    >
      {(close) => (
        <ul>
          {versions.map((v) => {
            const current = v.version === viewing;
            return (
              <li key={v.version}>
                <Link
                  href={reportHref(id, v.version === latest ? undefined : v.version)}
                  role="menuitem"
                  aria-current={current ? 'true' : undefined}
                  onClick={close}
                  className={cn(MENU_ITEM, 'items-start', current && 'bg-muted/60')}
                >
                  <span className="mt-0.5 size-4 shrink-0">{current && <Check className="size-4 text-primary" aria-hidden />}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium tabular-nums">{versionTitle(v.version, latest)}</span>
                    <span className="block truncate text-[12px] text-muted-foreground">{versionSummary(v)}</span>
                    {v.source_prompt && <span className="mt-0.5 line-clamp-2 block text-[12px] text-muted-foreground">{v.source_prompt}</span>}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Menu>
  );
}
