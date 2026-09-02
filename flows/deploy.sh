#!/bin/zsh
# Deploy flows to Railway and don't come back until it's actually serving.
# Handles the platform's stuck-INITIALIZING episodes: pushes, polls to a terminal
# state, retries a failed/stalled deploy up to 3 times, then health-checks prod.
#   ./deploy.sh            # deploy + verify
set -e
cd "$(dirname "$0")"

node --check src/server.js
for f in src/flows/*.js src/services/*.js; do node --check "$f"; done
echo "syntax ok"

status_of() {
  railway deployment list --service flows --json 2>/dev/null | python3 -c "
import json,sys
try: ds=json.load(sys.stdin)
except Exception: print('UNKNOWN'); sys.exit()
d=[x for x in ds if x.get('id','').startswith('$1')]
print(d[0]['status'] if d else 'NOT-FOUND')"
}

for attempt in 1 2 3; do
  ID=$(railway up --service flows --detach 2>&1 | grep -o "id=[a-f0-9-]*" | head -1 | cut -c4-11)
  echo "attempt $attempt: pushed ${ID:-<no id>} at $(date -u +%H:%M:%S)Z"
  [ -z "$ID" ] && { sleep 90; continue; }
  waited=0
  while true; do
    sleep 25; waited=$((waited+25))
    ST=$(status_of "$ID")
    case "$ST" in
      SUCCESS) echo "deploy $ID SUCCESS (${waited}s)"; break 2 ;;
      FAILED|CRASHED|REMOVED) echo "deploy $ID $ST — retrying"; sleep 45; break ;;
      *) [ $waited -ge 720 ] && { echo "deploy $ID stalled ${waited}s (Railway incident?) — retrying"; break; } ;;
    esac
  done
done
ST=$(status_of "$ID"); [ "$ST" = "SUCCESS" ] || { echo "GAVE UP after 3 attempts — check status.railway.com"; exit 1; }

sleep 15
CODE=$(curl -s -o /dev/null -w "%{http_code}" https://flows.munadim.com/health)
[ "$CODE" = "200" ] && echo "live: health 200 ✅" || { echo "health returned $CODE ❌"; exit 1; }
