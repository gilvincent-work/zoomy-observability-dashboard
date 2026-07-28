# zoomy-digest-dashboard

Reader dashboard for Zoomy's weekly store-ops digests. Renders the archived
`DigestDocument`s that the `zoomy-observability` batch job writes to Supabase.

**Separate app on purpose.** `zoomy-observability` is a Node batch job (no UI);
this is a Next.js app deployed on Vercel. The only thing they share is the
`digest_archive` table and the `DigestDocument` shape. This app is a **reader** —
no synthesis, no retrieval, no writes.

## Security boundary (load-bearing)

`digest_archive` is **not anon-readable** — its `bundle` column holds verbatim
customer quotes — so the dashboard reads it **server-side** (a Server Component)
with the observability project's **service-role key**, selecting only the
rendered `digest` (never `bundle`). The key lives in **server-only** env vars
(`SUPABASE_*_ARCHIVE`, no `NEXT_PUBLIC_`); `src/data.ts` starts with
`import 'server-only'` so the build fails if it's ever pulled into a client
component. The key never reaches the browser. See
`knowledge/best-practices/vercel-react-dashboard.md`.

## Run

```bash
npm install
npm run dev        # http://localhost:3000
```

With no `SUPABASE_*_ARCHIVE` env set, the app renders **built-in mock digests**
(one normal, one degraded) so it runs with no database. Set the env (see
`.env.example`) to read live archives once the `digest_archive` table exists in
the observability project (server-side service-role read; no anon policy).

```bash
npm run build      # production build
npm run typecheck  # tsc --noEmit
```

## Status

Scaffold: list view rendering `DigestDocument`s (themes with quotes, figures with
explicit time basis, recommendations, degraded state). Not yet wired to a live
Supabase project (that + auth are open decisions). Auth is TODO before exposing
real data.
