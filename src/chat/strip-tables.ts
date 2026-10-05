// Explore turns: the app draws the chart + table twin itself, so a GFM table the model typed on top of it only repeats the rows.
// Deterministic and pure: removes pipe tables outside code fences, keeps the prose around them, collapses the blank lines left behind.
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
// a GFM delimiter row: cells of dashes with optional alignment colons, at least one pipe (so a bare `---` rule is not a table)
const DELIMITER = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const isDelimiter = (l: string): boolean => l.includes('|') && DELIMITER.test(l);

export function stripMarkdownTables(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];
  let fence: string | null = null;
  let removed = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const f = FENCE.exec(line);
    if (f) {
      if (fence === null) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
      out.push(line);
      continue;
    }
    if (fence === null && line.includes('|') && i + 1 < lines.length && isDelimiter(lines[i + 1])) {
      i += 1; // the delimiter row
      while (i + 1 < lines.length && lines[i + 1].trim() !== '' && lines[i + 1].includes('|')) i += 1;
      removed = true;
      continue;
    }
    out.push(line);
  }
  if (!removed) return text;
  return out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '').replace(/\n+$/, (m) => (text.endsWith('\n') ? '\n' : ''));
}
