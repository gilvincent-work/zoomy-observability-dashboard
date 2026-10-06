// Degenerate-output guard: a model stuck in a loop ("<br> <br> ...") burns tokens until max_tokens. Pure and incremental:
// only the tail of the answer is looked at, so calling it on every text delta stays cheap.
const MAX_UNIT = 12;
const MIN_REPEATS = 20;

/** If the text ends in one unit (1-12 chars with a letter, digit or angle bracket) repeated >= 20 times in a row, the run's start index and the unit's length. */
export function trailingRepeat(text: string): {start: number; unit: number} | null {
  const tail = text.slice(-MAX_UNIT * MIN_REPEATS);
  const base = text.length - tail.length;
  for (let k = 1; k <= MAX_UNIT; k++) {
    if (tail.length < k * MIN_REPEATS) break;
    const unit = tail.slice(-k);
    if (!/[\p{L}\p{N}<>]/u.test(unit)) continue; // rules (-----), table rows of dashes and padding are not a loop
    let i = tail.length - k;
    let reps = 1;
    while (i - k >= 0 && tail.startsWith(unit, i - k)) {
      i -= k;
      reps += 1;
    }
    if (reps >= MIN_REPEATS) return {start: base + i, unit: k};
  }
  return null;
}
