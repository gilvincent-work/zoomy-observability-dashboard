#!/usr/bin/env bash
# LOCAL ONLY. Removes exactly what up.sh created: containers coop-local-db and coop-local-rest, the network coop-local
# and the proxy process. Each is removed only if it carries the label coop-local=1 (so a name clash with another
# project is never touched). There is no volume, so down = clean slate. .local-env is kept (delete it by hand to rotate secrets).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LABEL='coop-local=1'

for c in coop-local-rest coop-local-db; do
  if docker inspect "$c" >/dev/null 2>&1; then
    if [ "$(docker inspect -f '{{ index .Config.Labels "coop-local" }}' "$c")" = "1" ]; then
      docker rm -f "$c" >/dev/null && echo "removed container $c"
    else
      echo "REFUSING to remove $c: it does not carry the label $LABEL" >&2
    fi
  fi
done
if docker network inspect coop-local >/dev/null 2>&1; then
  if [ "$(docker network inspect -f '{{ index .Labels "coop-local" }}' coop-local)" = "1" ]; then
    docker network rm coop-local >/dev/null && echo "removed network coop-local"
  else
    echo "REFUSING to remove network coop-local: it does not carry the label $LABEL" >&2
  fi
fi
PIDF="$HERE/.proxy.pid"
if [ -f "$PIDF" ]; then
  pid="$(cat "$PIDF")"
  if [ -n "$pid" ] && ps -p "$pid" -o command= 2>/dev/null | grep -q 'local-supabase/proxy.mjs'; then
    kill "$pid" && echo "stopped proxy (pid $pid)"
  fi
  rm -f "$PIDF"
fi
