'use client';

// The report page's header and actions (F9). Title, Live/Pinned badge, visibility, owner, version dropdown, and for people
// who may edit: Pin, Rename, "Ask Coop about this report", and a menu (Only me / Team, Delete: owner only). Viewing an old
// version adds a read-only banner with Restore. Every action is a server action called from a click inside a transition;
// a failure shows inline, a success refreshes or navigates. No model call happens on this page.
import {useState, useTransition} from 'react';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {ArrowLeft, CalendarDays, Check, Lock, MoreHorizontal, Pencil, Pin, PinOff, Radio, Sparkles, Trash2, Users, X} from 'lucide-react';
import {cn} from '@/lib/utils';
import {buttonVariants} from '@/components/ui/button';
import {deleteReport, renameReport, restoreVersion, setPinned, setVisibility} from '@/src/reports-actions';
import type {ReportVersionMeta, ReportVisibility} from '@/src/reports-types';
import type {ReportSpec} from '@/src/chat/report-types';
import {useCoopChat} from './coop-chat';
import {Menu, MENU_ITEM} from './reports-menu';
import {ReportVersionMenu} from './reports-version-menu';
import {reportHref} from './reports-helpers';

export interface ReportHeaderProps {
  id: string;
  title: string;
  ownerEmail: string;
  isOwner: boolean;
  canEdit: boolean;
  visibility: ReportVisibility;
  /** Pinned to the top of the gallery. */
  pinned: boolean;
  /** The server's current version: what an action must send as `expectedVersion`. */
  currentVersion: number;
  latestVersion: number;
  viewingVersion: number;
  isLatest: boolean;
  versions: ReportVersionMeta[];
  /** From the run: Live or Pinned dates, with the text to show. Null when the report could not be run. */
  status: {mode: 'live' | 'pinned'; text: string} | null;
  /** Plain-words scope: range, pet, event, channel. */
  scope: string | null;
  /** The latest version as a drawer draft, or null when it cannot be opened in chat (old version, unreadable recipe). */
  askSpec: ReportSpec | null;
  /** The viewed version's spec as stored, kept as the drawer's saved reference so Update works. */
  storedSpec: unknown;
}

type Outcome = {ok: true} | {ok: false; error: string};

const CHIP = 'inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-[12px] text-foreground';
const BTN = cn(buttonVariants({variant: 'outline'}), 'h-10 gap-1.5 px-3 text-[13px]');

export function ReportHeader(p: ReportHeaderProps) {
  const router = useRouter();
  const {openReport} = useCoopChat();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [draftTitle, setDraftTitle] = useState(p.title);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  /** Run one action in a transition; show its error inline, run `then` on success. */
  const act = (fn: () => Promise<Outcome>, then: () => void) => {
    setError(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) {
        setError(res.error);
        return;
      }
      then();
    });
  };

  const submitRename = () => {
    const title = draftTitle.trim();
    if (!title || title === p.title) {
      setRenaming(false);
      return;
    }
    act(
      () => renameReport({id: p.id, title}),
      () => {
        setRenaming(false);
        router.refresh();
      },
    );
  };

  return (
    <header className="mb-6 space-y-3">
      <Link href="/reports" className="inline-flex h-10 items-center gap-1.5 rounded-lg text-[13px] text-muted-foreground transition-colors hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden />
        Reports
      </Link>

      {renaming ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submitRename();
          }}
          className="flex flex-wrap items-center gap-2"
        >
          <input
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && (setRenaming(false), setDraftTitle(p.title))}
            maxLength={120}
            autoFocus
            aria-label="Report title"
            className="h-11 min-w-0 flex-1 rounded-lg border border-border bg-card px-3 font-serif text-xl text-foreground outline-none transition-colors focus:border-primary/50 md:text-2xl"
          />
          <button type="submit" disabled={pending || !draftTitle.trim()} className={cn(buttonVariants(), 'h-10 gap-1.5 px-3 text-[13px]')}>
            <Check className="size-4" aria-hidden />
            Save title
          </button>
          <button
            type="button"
            onClick={() => {
              setRenaming(false);
              setDraftTitle(p.title);
            }}
            className={BTN}
          >
            Cancel
          </button>
        </form>
      ) : (
        <h1 className="break-words font-serif text-[1.65rem] font-normal leading-tight text-foreground md:text-[2rem]">{p.title}</h1>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        {p.status && (
          <span className={CHIP}>
            {p.status.mode === 'live' ? <Radio className="size-3.5 text-primary" aria-hidden /> : <CalendarDays className="size-3.5 text-muted-foreground" aria-hidden />}
            {p.status.text}
          </span>
        )}
        <span className={CHIP}>
          {p.visibility === 'private' ? <Lock className="size-3.5 text-muted-foreground" aria-hidden /> : <Users className="size-3.5 text-muted-foreground" aria-hidden />}
          {p.visibility === 'private' ? 'Only me' : 'Team'}
        </span>
        {p.pinned && (
          <span className={CHIP}>
            <Pin className="size-3.5 text-muted-foreground" aria-hidden />
            Pinned to top
          </span>
        )}
        <span className="min-w-0 truncate px-1 text-[12px] text-muted-foreground">{p.isOwner ? 'Owned by you' : `Owned by ${p.ownerEmail}`}</span>
      </div>
      {p.scope && <p className="text-[12px] text-muted-foreground">{p.scope}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <ReportVersionMenu id={p.id} versions={p.versions} viewing={p.viewingVersion} latest={p.latestVersion} />
        {p.canEdit && (
          <>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                act(
                  () => setPinned({id: p.id, pinned: !p.pinned}),
                  () => router.refresh(),
                )
              }
              className={BTN}
            >
              {p.pinned ? <PinOff className="size-4" aria-hidden /> : <Pin className="size-4" aria-hidden />}
              {p.pinned ? 'Unpin' : 'Pin'}
            </button>
            <button
              type="button"
              disabled={pending || renaming}
              onClick={() => {
                setDraftTitle(p.title);
                setRenaming(true);
              }}
              className={BTN}
            >
              <Pencil className="size-4" aria-hidden />
              Rename
            </button>
          </>
        )}
        {p.askSpec && (
          <button
            type="button"
            onClick={() => p.askSpec && openReport(p.askSpec, p.canEdit ? {id: p.id, version: p.latestVersion, spec: p.storedSpec} : null)}
            className={cn(buttonVariants(), 'h-10 gap-1.5 px-3 text-[13px]')}
          >
            <Sparkles className="size-4" aria-hidden />
            Ask Coop about this report
          </button>
        )}
        {p.isOwner && (
          <Menu label="More actions" align="right" triggerClassName="w-10 justify-center px-0" trigger={<MoreHorizontal className="size-4" aria-hidden />}>
            {(close) => (
              <>
                <div className="px-3 pb-1 pt-1.5 text-[11px] text-muted-foreground">Who can see this</div>
                {(['private', 'team'] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    role="menuitemradio"
                    aria-checked={p.visibility === v}
                    disabled={pending}
                    onClick={() => {
                      close();
                      if (p.visibility === v) return;
                      act(
                        () => setVisibility({id: p.id, visibility: v}),
                        () => router.refresh(),
                      );
                    }}
                    className={MENU_ITEM}
                  >
                    <span className="size-4 shrink-0">{p.visibility === v && <Check className="size-4 text-primary" aria-hidden />}</span>
                    {v === 'private' ? 'Only me' : 'Team'}
                  </button>
                ))}
                <div className="my-1 border-t border-border" />
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    close();
                    setConfirmingDelete(true);
                  }}
                  className={cn(MENU_ITEM, 'text-destructive')}
                >
                  <Trash2 className="size-4" aria-hidden />
                  Delete report
                </button>
              </>
            )}
          </Menu>
        )}
      </div>

      {confirmingDelete && (
        <div
          role="alertdialog"
          aria-label="Confirm delete"
          className="flex flex-wrap items-center gap-2 rounded-xl border border-[color-mix(in_oklab,var(--status-crit)_35%,transparent)] bg-[color-mix(in_oklab,var(--status-crit)_8%,transparent)] px-3 py-2.5 text-[13px] text-foreground"
        >
          <span className="min-w-0 flex-1 basis-56">Delete this report for everyone? It leaves the gallery and its link will say it was deleted.</span>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              act(
                () => deleteReport({id: p.id}),
                () => router.replace('/reports'),
              )
            }
            className={cn(buttonVariants({variant: 'destructive'}), 'h-10 gap-1.5 px-3 text-[13px]')}
          >
            <Trash2 className="size-4" aria-hidden />
            {pending ? 'Deleting…' : 'Delete report'}
          </button>
          <button type="button" disabled={pending} onClick={() => setConfirmingDelete(false)} className={BTN}>
            <X className="size-4" aria-hidden />
            Keep it
          </button>
        </div>
      )}

      {!p.isLatest && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-2 rounded-xl border border-[color-mix(in_oklab,var(--status-warn)_40%,transparent)] bg-[var(--amber-bg)] px-3 py-2.5 text-[13px] text-foreground"
        >
          <span className="min-w-0 flex-1 basis-56">
            You are viewing version {p.viewingVersion} of {p.latestVersion}. Restore makes a new version.
          </span>
          {p.canEdit && (
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                act(
                  () => restoreVersion({id: p.id, version: p.viewingVersion, expectedVersion: p.currentVersion}),
                  () => {
                    router.replace(reportHref(p.id));
                    router.refresh();
                  },
                )
              }
              className={cn(buttonVariants(), 'h-10 px-3 text-[13px]')}
            >
              {pending ? 'Restoring…' : 'Restore this version'}
            </button>
          )}
          <Link href={reportHref(p.id)} className={BTN}>
            Back to latest
          </Link>
        </div>
      )}

      {error && (
        <p role="alert" className="text-[13px] text-destructive">
          {error}
        </p>
      )}
    </header>
  );
}
