'use client';

import {useEffect, useState, useTransition} from 'react';
import {Boxes, Check, Pencil, Trash2} from 'lucide-react';
import type {PosBundleRow} from '@/src/pos-types';
import type {ActionResult} from '@/src/pos-actions';
import {
  deleteBundleAction,
  renameBundleAction,
  repriceBundleAction,
  setBundleActiveAction,
  setBundleEmojiAction,
} from '@/src/pos-actions';
import {formatPeso} from '@/src/pos-format';
import {Card, CardContent} from '@/components/ui/card';
import {cn} from '@/lib/utils';
import {Eyebrow} from './sections';
import {EmojiPicker} from './emoji-picker';

/**
 * Coop's view of the POS bundles (pos_bundles). Bundles are created on the POS
 * (the Buy-Any-N builder), so this co-edits rather than creates: emoji, listed,
 * name, price, and delete. Every edit writes to pos_bundles and the POS mirrors
 * it on the next catalog pull, so all devices converge.
 */
export function BundleControls({bundles}: {bundles: PosBundleRow[]}) {
  // Mirror the server data locally so edits can apply optimistically, then
  // reconcile. The page's shared Refresh button (in ProductControls) triggers
  // a plain router.refresh(), which lands here as a new `bundles` prop — this
  // effect re-syncs to it, same pattern as ProductControls.
  const [rows, setRows] = useState(bundles);
  useEffect(() => setRows(bundles), [bundles]);
  const [status, setStatus] = useState<Record<string, {saved?: boolean; error?: string}>>({});
  const [isPending, startTransition] = useTransition();

  function flash(id: string) {
    setStatus((s) => ({...s, [id]: {saved: true}}));
    setTimeout(() => setStatus((s) => ({...s, [id]: {}})), 1500);
  }

  function mutate(id: string, patch: Partial<PosBundleRow>, action: () => Promise<ActionResult>) {
    const prev = rows;
    setRows((rs) => rs.map((r) => (r.bundle_id === id ? {...r, ...patch} : r)));
    setStatus((s) => ({...s, [id]: {}}));
    startTransition(async () => {
      const res = await action();
      if (!res.ok) {
        setRows(prev);
        setStatus((s) => ({...s, [id]: {error: res.error}}));
      } else {
        flash(id);
      }
    });
  }

  function remove(id: string, name: string) {
    if (!window.confirm(`Delete bundle “${name}”? This removes it from the POS too.`)) return;
    const prev = rows;
    setRows((rs) => rs.filter((r) => r.bundle_id !== id));
    startTransition(async () => {
      const res = await deleteBundleAction(id);
      if (!res.ok) {
        setRows(prev);
        setStatus((s) => ({...s, [id]: {error: res.error}}));
      }
    });
  }

  const summary = (b: PosBundleRow) =>
    b.bundle_type === 'pick'
      ? `Buy any ${b.pick_count ?? 0} · ${(b.line_categories ?? []).join(', ') || 'any line'}`
      : `${b.items.length} item${b.items.length !== 1 ? 's' : ''}: ${b.items.map((i) => `${i.name}×${i.qty}`).join(', ') || '—'}`;

  return (
    <div className="mx-auto mt-8 max-w-6xl px-6 md:px-10">
      <div className="mb-4">
        <Eyebrow icon={Boxes}>Bundles</Eyebrow>
        <p className="text-sm text-muted-foreground">
          {rows.length} bundle{rows.length !== 1 ? 's' : ''} synced from the POS. Edit the emoji, price, name, or listing;
          create new bundles in the POS. Edits sync back to every device.
        </p>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-2.5 text-center font-medium">Emoji</th>
                  <th className="px-4 py-2.5 font-medium">Bundle</th>
                  <th className="px-4 py-2.5 font-medium">Type</th>
                  <th className="px-4 py-2.5 text-right font-medium">Price</th>
                  <th className="px-4 py-2.5 text-right font-medium">Listed</th>
                  <th className="px-4 py-2.5 text-right font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-sm text-muted-foreground">
                      No bundles yet. Create one in the POS.
                    </td>
                  </tr>
                ) : (
                  rows.map((b) => (
                    <BundleRow
                      key={b.bundle_id}
                      row={b}
                      saved={status[b.bundle_id]?.saved}
                      error={status[b.bundle_id]?.error}
                      summary={summary(b)}
                      onSetEmoji={(emoji) => emoji && mutate(b.bundle_id, {emoji}, () => setBundleEmojiAction(b.bundle_id, emoji))}
                      onRename={(name) => mutate(b.bundle_id, {name}, () => renameBundleAction(b.bundle_id, name))}
                      onReprice={(price) => {
                        const n = Number(price);
                        mutate(b.bundle_id, Number.isFinite(n) && n > 0 ? {price: n} : {}, () => repriceBundleAction(b.bundle_id, price));
                      }}
                      onToggle={(active) => mutate(b.bundle_id, {active}, () => setBundleActiveAction(b.bundle_id, active))}
                      onDelete={() => remove(b.bundle_id, b.name)}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
      {isPending && <span className="sr-only">Saving…</span>}
    </div>
  );
}

type EditField = 'name' | 'price' | null;

function BundleRow({
  row,
  saved,
  error,
  summary,
  onSetEmoji,
  onRename,
  onReprice,
  onToggle,
  onDelete,
}: {
  row: PosBundleRow;
  saved?: boolean;
  error?: string;
  summary: string;
  onSetEmoji: (emoji: string) => void;
  onRename: (name: string) => void;
  onReprice: (price: string) => void;
  onToggle: (active: boolean) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState<EditField>(null);
  const [draft, setDraft] = useState('');

  function begin(field: EditField, current: string) {
    setEditing(field);
    setDraft(current);
  }
  function save() {
    const v = draft.trim();
    if (editing === 'name' && v) onRename(v);
    else if (editing === 'price' && v) onReprice(v);
    setEditing(null);
  }

  return (
    <tr className={cn('border-b last:border-0', !row.active && 'opacity-55')}>
      <td className="px-4 py-2.5 text-center">
        <EmojiPicker value={row.emoji ?? ''} onCommit={onSetEmoji} ariaLabel={`Edit emoji for ${row.name}`} />
      </td>
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-2">
          {editing === 'name' ? (
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={save}
              onKeyDown={(e) => e.key === 'Enter' && save()}
              className="h-7 w-48 rounded-md border bg-background px-2 text-sm outline-none focus-visible:border-ring"
            />
          ) : (
            <button type="button" className="group flex items-center gap-1.5 text-left hover:text-primary" onClick={() => begin('name', row.name)}>
              <span className="font-medium">{row.name}</span>
              <Pencil className="size-3 opacity-0 transition-opacity group-hover:opacity-60" />
            </button>
          )}
          {saved && (
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
              <Check className="size-3" /> Saved
            </span>
          )}
          {error && <span className="text-[11px] text-destructive">{error}</span>}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{summary}</p>
      </td>
      <td className="px-4 py-2.5">
        <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
          {row.bundle_type === 'pick' ? 'Buy Any N' : 'Fixed'}
        </span>
      </td>
      <td className="px-4 py-2.5 text-right tabular-nums">
        {editing === 'price' ? (
          <input
            autoFocus
            inputMode="decimal"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => e.key === 'Enter' && save()}
            className="h-7 w-24 rounded-md border bg-background px-2 text-right text-sm outline-none focus-visible:border-ring"
          />
        ) : (
          <button type="button" className="group inline-flex items-center gap-1.5 hover:text-primary" onClick={() => begin('price', String(row.price))}>
            <span>{formatPeso(row.price)}</span>
            <Pencil className="size-3 opacity-0 transition-opacity group-hover:opacity-60" />
          </button>
        )}
      </td>
      <td className="px-4 py-2.5">
        <div className="flex justify-end">
          <button
            type="button"
            role="switch"
            aria-checked={row.active}
            aria-label={row.active ? `Unlist ${row.name}` : `List ${row.name}`}
            onClick={() => onToggle(!row.active)}
            className={cn('relative h-5 w-9 shrink-0 rounded-full border transition-colors', row.active ? 'border-primary bg-primary' : 'border-border bg-muted')}
          >
            <span className={cn('absolute top-1/2 size-4 -translate-y-1/2 rounded-full bg-white shadow-sm transition-[left]', row.active ? 'left-[calc(100%-1.125rem)]' : 'left-0.5')} />
          </button>
        </div>
      </td>
      <td className="px-4 py-2.5 text-right">
        <button
          type="button"
          onClick={onDelete}
          aria-label={`Delete ${row.name}`}
          className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="size-4" />
        </button>
      </td>
    </tr>
  );
}
