#!/usr/bin/env node
// Import a spin-the-wheel CSV export (zoomyforpets.com/admin/spin-wheel → Export)
// into public.spin_wheel_leads on the Coop archive project.
//
//   node scripts/import-spin-leads.mjs ~/Downloads/spin-the-wheel-leads.csv
//   node scripts/import-spin-leads.mjs <file> --dry
//
// Needs SUPABASE_URL_ARCHIVE / SUPABASE_SERVICE_ROLE_KEY_ARCHIVE (.env.local is
// read automatically). Upserts on (email, collected_at), so re-running the same
// export changes nothing. The CSV is contact data — keep it out of the repo.
import {readFileSync} from 'node:fs';
import {createClient} from '@supabase/supabase-js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * "Sep 20, 2026, 9:32 PM" (Manila, no zone in the export) → ISO instant. The
 * +08:00 is applied explicitly rather than trusting the machine's local zone.
 */
export function parsePhTimestamp(raw) {
  const m = /^([A-Za-z]{3})\s+(\d{1,2}),\s*(\d{4}),\s*(\d{1,2}):(\d{2})\s*(AM|PM)$/.exec(String(raw).trim());
  if (!m) return null;
  const month = MONTHS.indexOf(m[1]);
  if (month < 0) return null;
  let hour = Number(m[4]) % 12;
  if (m[6] === 'PM') hour += 12;
  const p = (n) => String(n).padStart(2, '0');
  return `${m[3]}-${p(month + 1)}-${p(Number(m[2]))}T${p(hour)}:${m[5]}:00+08:00`;
}

/** Split one CSV line, honouring "quoted, fields" and "" escapes. */
function splitRow(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else quoted = false;
      } else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/**
 * Parse the export into table rows. Rows with no email or an unreadable
 * collection stamp are dropped; the mobile column keeps Sheets' leading
 * apostrophe on "'+639…", so that is stripped.
 */
export function parseSpinLeadsCsv(csv) {
  const rows = [];
  for (const line of csv.split(/\r?\n/).filter((l) => l.trim()).slice(1)) {
    const [email, mobile, prize, campaign, collected, consent] = splitRow(line).map((c) => c.trim());
    const collected_at = collected ? parsePhTimestamp(collected) : null;
    if (!email || !collected_at) continue;
    rows.push({
      email,
      mobile: mobile ? mobile.replace(/^'/, '') : null,
      prize: prize || 'Unknown',
      campaign: campaign || null,
      collected_at,
      consent_at: consent ? parsePhTimestamp(consent) : null,
    });
  }
  return rows;
}

async function main() {
  const [file, ...flags] = process.argv.slice(2);
  if (!file) {
    console.error('usage: node scripts/import-spin-leads.mjs <export.csv> [--dry]');
    process.exit(1);
  }
  const rows = parseSpinLeadsCsv(readFileSync(file, 'utf8'));
  const skipped = readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => l.trim()).length - 1 - rows.length;
  console.log(`parsed ${rows.length} leads${skipped ? ` (skipped ${skipped} unusable row(s))` : ''}`);

  if (flags.includes('--dry')) {
    console.log(rows.slice(0, 3));
    return;
  }

  const url = process.env.SUPABASE_URL_ARCHIVE;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY_ARCHIVE;
  if (!url || !key) throw new Error('SUPABASE_URL_ARCHIVE / SUPABASE_SERVICE_ROLE_KEY_ARCHIVE not set');

  const supabase = createClient(url, key, {auth: {persistSession: false}});
  const {error, count} = await supabase
    .from('spin_wheel_leads')
    .upsert(rows, {onConflict: 'email,collected_at', ignoreDuplicates: false, count: 'exact'});
  if (error) throw new Error(`spin_wheel_leads upsert failed: ${error.message}`);
  console.log(`upserted ${count ?? rows.length} rows into spin_wheel_leads`);
}

// Importable for tests; only runs the import when executed directly.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
