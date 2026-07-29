// PII masking, applied SERVER-SIDE (in the Server Component) before any digest
// reaches the browser. digest.customers.outreach carries customer *names* (the
// heavier PII — emails — lives only in the archive's `bundle` column, which the
// dashboard never selects). There is no auth in front of this app yet, so we
// abbreviate names to first-name + last-initial so a full name is never shipped
// to the client. Remove/relax this once real authentication gates the dashboard.
//
// Pure and side-effect-free, so it is safe to import from either server or
// client code — but it is CALLED on the server (page.tsx) so unmasked names
// never enter the RSC payload.
import type {DigestArchiveRow, DigestDocument} from './types';

/** "Karen Martinez" -> "Karen M." · "TEST VINCE" -> "TEST V." · single token unchanged. */
export function maskName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? '';
  const last = parts[parts.length - 1];
  return `${parts[0]} ${last[0].toUpperCase()}.`;
}

/** Return a copy of the digest with customer outreach names masked. */
export function maskDigestPII(digest: DigestDocument): DigestDocument {
  if (!digest.customers?.outreach?.length) return digest;
  return {
    ...digest,
    customers: {
      ...digest.customers,
      outreach: digest.customers.outreach.map((o) => ({...o, name: maskName(o.name)})),
    },
  };
}

/** Mask every row's digest (map over the archive list). */
export function maskRows(rows: DigestArchiveRow[]): DigestArchiveRow[] {
  return rows.map((r) => ({...r, digest: maskDigestPII(r.digest)}));
}
