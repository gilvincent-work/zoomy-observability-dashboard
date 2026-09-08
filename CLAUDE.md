# zoomy-observability-dashboard

Coop / BrandOS dashboard (Next.js App Router, Google sign-in). Reads the Supabase archive written by `zoomy-observability` and the POS `pos_*` tables: overview, business health (QRR), channel compare, repricer, product controls, offline sales, and the "Chat with coop" assistant.

Workspace-wide conventions (Supabase/MCP targets, deployments, environments, design skills) live in the parent `../CLAUDE.md` — read it too. **All UI work here must use the design skills** (`emil-design-eng`, `impeccable`, `design-taste-frontend`) per the workspace guidance.

# Changelog

- **`CHANGELOG.md`** (repo root) is the running history of notable dashboard changes. **For any question about history, "what changed", when/why a feature or decision landed, or to log new work, read and update `CHANGELOG.md`** (the git log holds the finer-grained history). Add new entries at the top under the current date and capture the decision, not just the change. POS-side history lives in `../zoomy-pos/CHANGELOG.md`.

# Context Gathering (do this first)

- **A prebuilt knowledge graph lives in `graphify-out/`.** Before reading files broadly to answer a question about the codebase (architecture, "which page renders channel compare", "where does the repricer table get its data", "how does the chat route build its prompt", "what masks PII"), use it instead of grepping and reading whole files. This saves tokens. What's in the folder:
  - `graph.json` — the graph data. Query it with `graphify query "<question>"`; also `graphify explain "<symbol>"` and `graphify path "<A>" "<B>"`. It returns nodes, edges, and `source_location`s so you can jump straight to the right file/line.
  - `GRAPH_REPORT.md` — god nodes, community labels (e.g. Business Health Page, Repricer Page, Coop Chat UI, Digest Types, Google Auth), surprising connections, and known integrity notes.
  - `graph.html` — interactive graph, open in a browser.
- **Rebuild when code drifts:** `graphify . --update` re-extracts only changed files. Do this after substantial edits so the graph stays accurate; a stale graph is worse than none for a specific claim.
- Use the graph to *locate*, then read the actual file to *act*. Don't quote the graph as ground truth for code you're about to change without confirming against the source.
