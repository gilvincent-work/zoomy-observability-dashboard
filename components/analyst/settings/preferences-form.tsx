'use client';

import {useState} from 'react';
import {Bell, CalendarClock, Check, RotateCcw, SlidersHorizontal, Sparkles, User} from 'lucide-react';
import {CATEGORY_ORDER, parseRecipients, type Cadence, type Focus} from '@/src/preferences';
import {Card, CardContent} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import {cn} from '@/lib/utils';
import {CATEGORY_ICON, CATEGORY_LABEL, Eyebrow} from '../sections';
import {usePreferences} from './use-preferences';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const FOCUS_OPTS: {value: Focus; label: string}[] = [
  {value: 'mute', label: 'Mute'},
  {value: 'normal', label: 'Normal'},
  {value: 'emphasize', label: 'Emphasize'},
];

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: {value: T; label: string}[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-md border p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={cn(
            'rounded px-2.5 py-1 text-xs font-medium transition-colors',
            value === o.value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({checked, onChange, label}: {checked: boolean; onChange: (v: boolean) => void; label: string}) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="inline-flex items-center gap-2">
      <span className={cn('relative h-5 w-9 rounded-full transition-colors', checked ? 'bg-primary' : 'bg-muted')}>
        <span
          className={cn(
            'absolute top-0.5 size-4 rounded-full bg-background shadow transition-transform',
            checked ? 'translate-x-4' : 'translate-x-0.5',
          )}
        />
      </span>
      <span className="text-sm">{label}</span>
    </button>
  );
}

const numberInput =
  'w-20 rounded-md border bg-background px-2 py-1 text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring';
const selectInput = 'rounded-md border bg-background px-2 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring';

export function PreferencesForm() {
  const {prefs, update, reset, justSaved} = usePreferences();
  const [recipientText, setRecipientText] = useState<string | null>(null); // local edit buffer

  return (
    <div className="space-y-8">
      {/* Account (mock) */}
      <section>
        <Eyebrow icon={User}>Account</Eyebrow>
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <div className="text-sm font-medium">owner@zoomy.example</div>
              <div className="text-xs text-muted-foreground">Single-owner account · mock</div>
            </div>
            <Button variant="outline" size="sm" disabled>
              Sign out
            </Button>
          </CardContent>
        </Card>
        <p className="mt-1.5 text-xs text-muted-foreground">Real sign-in / account lands with the auth gate (backlog).</p>
      </section>

      {/* Content focus */}
      <section>
        <Eyebrow icon={Sparkles}>Content focus</Eyebrow>
        <Card>
          <CardContent className="divide-y p-0">
            {CATEGORY_ORDER.map((cat) => {
              const Icon = CATEGORY_ICON[cat];
              return (
                <div key={cat} className="flex items-center justify-between gap-3 p-4">
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <Icon className="size-4 text-muted-foreground" />
                    {CATEGORY_LABEL[cat]}
                  </span>
                  <Segmented
                    value={prefs.contentFocus[cat]}
                    options={FOCUS_OPTS}
                    onChange={(v) => update((p) => ({...p, contentFocus: {...p.contentFocus, [cat]: v}}))}
                  />
                </div>
              );
            })}
          </CardContent>
        </Card>
        <p className="mt-1.5 text-xs text-muted-foreground">
          Emphasize or mute what the digest leads with. Takes full effect once real synthesis reads it.
        </p>
      </section>

      {/* Delivery */}
      <section>
        <Eyebrow icon={CalendarClock}>Delivery</Eyebrow>
        <Card>
          <CardContent className="space-y-4 p-4">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <label className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Cadence</span>
                <Segmented<Cadence>
                  value={prefs.delivery.cadence}
                  options={[
                    {value: 'weekly', label: 'Weekly'},
                    {value: 'biweekly', label: 'Biweekly'},
                  ]}
                  onChange={(v) => update((p) => ({...p, delivery: {...p.delivery, cadence: v}}))}
                />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Send on</span>
                <select
                  className={selectInput}
                  value={prefs.delivery.day}
                  onChange={(e) => update((p) => ({...p, delivery: {...p.delivery, day: e.target.value}}))}
                >
                  {DAYS.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">at</span>
                <input
                  type="time"
                  className={selectInput}
                  value={prefs.delivery.time}
                  onChange={(e) => update((p) => ({...p, delivery: {...p.delivery, time: e.target.value}}))}
                />
              </label>
            </div>
            <div>
              <div className="mb-1 text-sm text-muted-foreground">Recipients</div>
              <input
                className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="comma-separated emails"
                value={recipientText ?? prefs.delivery.recipients.join(', ')}
                onChange={(e) => setRecipientText(e.target.value)}
                onBlur={() => {
                  if (recipientText != null) {
                    update((p) => ({...p, delivery: {...p.delivery, recipients: parseRecipients(recipientText)}}));
                    setRecipientText(null);
                  }
                }}
              />
              <div className="mt-2 flex flex-wrap gap-1.5">
                {prefs.delivery.recipients.map((r) => (
                  <span key={r} className="rounded-full bg-muted px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
                    {r}
                  </span>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* Alert thresholds */}
      <section>
        <Eyebrow icon={SlidersHorizontal}>Alert thresholds</Eyebrow>
        <Card>
          <CardContent className="space-y-3 p-4">
            <ThresholdRow
              label="Stock-out ETA warning"
              suffix="days or fewer"
              value={prefs.thresholds.stockoutDays}
              onChange={(n) => update((p) => ({...p, thresholds: {...p.thresholds, stockoutDays: n}}))}
            />
            <ThresholdRow
              label="Churn alert"
              suffix="% or higher"
              value={prefs.thresholds.churnPct}
              onChange={(n) => update((p) => ({...p, thresholds: {...p.thresholds, churnPct: n}}))}
            />
            <ThresholdRow
              label="Revenue-drop alert"
              suffix="% WoW or worse"
              value={prefs.thresholds.revenueDropPct}
              onChange={(n) => update((p) => ({...p, thresholds: {...p.thresholds, revenueDropPct: n}}))}
            />
          </CardContent>
        </Card>
      </section>

      {/* Notification channels */}
      <section>
        <Eyebrow icon={Bell}>Notification channels</Eyebrow>
        <Card>
          <CardContent className="flex flex-wrap items-center gap-6 p-4">
            <Toggle
              checked={prefs.channels.email}
              onChange={(v) => update((p) => ({...p, channels: {...p.channels, email: v}}))}
              label="Email"
            />
            <Toggle
              checked={prefs.channels.slack}
              onChange={(v) => update((p) => ({...p, channels: {...p.channels, slack: v}}))}
              label="Slack (coming soon)"
            />
          </CardContent>
        </Card>
      </section>

      {/* footer */}
      <div className="flex items-center justify-between border-t pt-4">
        <span
          className={cn(
            'inline-flex items-center gap-1.5 text-xs transition-opacity',
            justSaved ? 'text-primary opacity-100' : 'opacity-0',
          )}
          aria-live="polite"
        >
          <Check className="size-3.5" /> Saved to your browser (mock)
        </span>
        <Button variant="ghost" size="sm" onClick={reset} className="gap-1.5">
          <RotateCcw className="size-3.5" /> Reset to defaults
        </Button>
      </div>
    </div>
  );
}

function ThresholdRow({
  label,
  suffix,
  value,
  onChange,
}: {
  label: string;
  suffix: string;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-sm">{label}</span>
      <span className="flex items-center gap-2 text-sm text-muted-foreground">
        <input
          type="number"
          min={0}
          className={numberInput}
          value={value}
          onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
        />
        {suffix}
      </span>
    </div>
  );
}
