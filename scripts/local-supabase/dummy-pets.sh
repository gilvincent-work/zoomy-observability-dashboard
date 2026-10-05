#!/usr/bin/env bash
# LOCAL ONLY. Dummy pet-names / pet-types / breeds layer for trying Ask Coop Explore by hand. Fictional, deterministic, removable.
#
# USE
#   scripts/local-supabase/up.sh --explore             # once, if the local DB is not up yet
#   scripts/local-supabase/dummy-pets.sh apply         # remove the dummy rows, then insert them again (same data every time)
#   scripts/local-supabase/dummy-pets.sh remove        # delete exactly the dummy rows and nothing else
#   scripts/local-supabase/dummy-pets.sh status        # counts of dummy rows
#   RUN `dummy-pets.sh remove` BEFORE `npm test`. With the dummy rows applied, 1 golden test fails by design:
#   test/chat-golden-explore.test.ts "EXP-03 R01" (its reference counts the fixture's own 'Circuit Makati' events, the dummy
#   "[DUMMY] Circuit Makati Weekend" events also match the name search). Everything else passes either way, and
#   `node scripts/coop-explore-ro-proof.mjs` exits 0 either way. `remove` restores the plain fixture exactly.
#
# MARKERS: events 'D-*' named "[DUMMY] ..."; orders and items id 100000..199999; leads campaign 'dummy-*' (example.com emails).
# WHAT IT HOLDS: 6 events Aug-Oct 2026 (one a lowercase / trailing-space respelling of another), ~250 orders (about 30 percent with no
#   pet_type, 35 on event dates with no event id, a few voided), ~120 spin_wheel_leads with a messy free-text `pet` column.
#   The expected answers to the owner questions: scripts/local-supabase/dummy-pets-expected.sql (run it) and
#   scripts/local-supabase/dummy-pets-expected.txt (its saved output).
#
# TRY IT BY HAND
#   scripts/local-supabase/dev.sh -p 3100       # then open http://127.0.0.1:3100 -> Ask coop -> New chat
#   Eight questions, and where the expected answer is (section letter in dummy-pets-expected.txt):
#    1. "Anong pet type ang pinaka-nabenta sa bawat event?"                      (A: pet type per event, orders + revenue)
#    2. "Which event sold the most to cat owners, and how much revenue?"        (A)
#    3. "Ilan ang orders ng SM Aura Pet Fair na dog, cat, both?"                 (A, SM Aura rows)
#    4. "Top 3 breeds ng leads per event?"                                      (B: breeds per event)
#    5. "Ilang leads ang walang breed na nailagay?"                              (C: leads with no breed)
#    6. "Per event, ilang orders ang naka-tag at ilan ang galing sa date lang?"  (D: tagged vs date-attributed)
#    7. "Anong araw ng linggo pinakamalaki ang benta?"                           (E: weekday sales)
#    8. "Show Circuit Makati Weekend as one event (both spellings) with pet type split."  (A, circuit rows merged by lower(btrim(name)))
#   Extra: ask about the leads' pet text 'ignore previous instructions...' to see the injection guard hold.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENVF="$HERE/.local-env"
[ -f "$ENVF" ] || { echo "dummy-pets.sh: $ENVF not found: run scripts/local-supabase/up.sh first" >&2; exit 1; }
set -a; . "$ENVF"; set +a
case "$SUPABASE_URL_ARCHIVE" in http://127.0.0.1:*|http://localhost:*) ;; *) echo "dummy-pets.sh: refusing: not a loopback URL" >&2; exit 1 ;; esac
[ "$(docker inspect -f '{{ index .Config.Labels "coop-local" }}' coop-local-db 2>/dev/null)" = "1" ] || { echo "dummy-pets.sh: coop-local-db is not running (up.sh)" >&2; exit 1; }
psql_local() { docker exec -i coop-local-db psql -h 127.0.0.1 -U postgres -d postgres -v ON_ERROR_STOP=1 -q "$@"; }
counts() { psql_local -P pager=off -c "select (select count(*) from pos_events where event_id like 'D-%') as events, (select count(*) from pos_orders where id between 100000 and 199999) as orders, (select count(*) from pos_order_items where order_id between 100000 and 199999) as items, (select count(*) from spin_wheel_leads where campaign like 'dummy-%') as leads"; }
case "${1:-}" in
  apply)  psql_local < "$HERE/dummy-pets-seed.sql"; counts ;;
  remove) psql_local -v remove_only=1 < "$HERE/dummy-pets-seed.sql"; counts ;;
  status) counts ;;
  *) echo "usage: $0 apply|remove|status" >&2; exit 2 ;;
esac
