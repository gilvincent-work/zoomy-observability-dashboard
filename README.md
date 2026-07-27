# zoomy-digest-dashboard

Reader dashboard for Zoomy's weekly store-ops digests. Renders the archived
`DigestDocument`s that the `zoomy-observability` batch job writes to Supabase.

**Separate app on purpose.** `zoomy-observability` is a Node batch job (no UI);
this is a Next.js app deployed on Vercel. The only thing they share is the
`digest_archive` table and the `DigestDocument` shape. This app is a **reader** —
no synthesis, no retrieval, no writes.

## Security boundary (load-bearing)

Reads use the Supabase **anon key + a row-level-security read policy** on
`digest_archive`. The **service-role key must never be used here** — it bypasses
RLS and belongs only to the server-side batch job. See
`knowledge/best-practices/vercel-react-dashboard.md` in the daVinci knowledge base.

## Run

```bash
npm install
npm run dev        # http://localhost:3000
```

With no `NEXT_PUBLIC_SUPABASE_*` env set, the app renders **built-in mock
digests** (one normal, one degraded) so it runs with no database. Set the env
(see `.env.example`) to read live archives once the `digest_archive` table and
its anon RLS policy exist.

```bash
npm run build      # production build
npm run typecheck  # tsc --noEmit
```

## Status

Scaffold: list view rendering `DigestDocument`s (themes with quotes, figures with
explicit time basis, recommendations, degraded state). Not yet wired to a live
Supabase project (that + auth are open decisions). Auth is TODO before exposing
real data.
