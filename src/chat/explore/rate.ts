// Per-user daily allowance for Explore calls (spec 10.5). In memory, best effort per server instance (UNVERIFIED on multi-instance Vercel, U9);
// the real cost cap is the Anthropic workspace spend limit. The day is the Manila calendar day.
const manilaDay = (now: Date): string => new Date(now.getTime() + 8 * 3600_000).toISOString().slice(0, 10);

export function createDayCounter(): (user: string | null, max: number, now?: Date) => boolean {
  const counts = new Map<string, number>();
  return (user, max, now = new Date()) => {
    const day = manilaDay(now);
    for (const k of counts.keys()) if (!k.startsWith(`${day}|`)) counts.delete(k); // yesterday's entries
    const key = `${day}|${user ?? 'anonymous'}`;
    const n = (counts.get(key) ?? 0) + 1;
    counts.set(key, n);
    return n <= max;
  };
}
export const exploreDayCounter = createDayCounter();
