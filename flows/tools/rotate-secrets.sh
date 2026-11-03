#!/bin/zsh
# Rotate secrets on Railway from a local file — never from the chat or the shell history.
#
#   1. put the NEW values in flows/.env.new  (NAME=value, one per line, only what you rotate)
#   2. ./tools/rotate-secrets.sh            (add --dry-run to see the plan without changing anything)
#
# For each variable: sets it on the Railway service(s) that use it, updates flows/.env,
# then shreds .env.new. Railway redeploys on a variable change; the script waits for the
# flows /health to come back ok. See docs/SECRETS-ROTATION-2026-11.md for who mints what.
set -euo pipefail
cd "$(dirname "$0")/.."
NEW=".env.new"; ENVF=".env"
DRY=0; [[ "${1:-}" == "--dry-run" ]] && DRY=1
[[ -f "$NEW" ]] || { echo "no $NEW — write NAME=value lines there first"; exit 1; }
[[ -f "$ENVF" ]] || { echo "no $ENVF"; exit 1; }

# which Railway service(s) hold each variable; OPS_TOKEN is mirrored as FLOWS_OPS_TOKEN on api
typeset -A WHERE
WHERE=(
  OPS_TOKEN "flows"            JWT_SECRET "api"
  ENCRYPTION_KEY "flows api"   SUPABASE_AHLAN_SERVICE_KEY "flows api"
  WA_VERIFY_TOKEN "flows"      NTFY_TOPIC "flows"
  OPENAI_API_KEY "flows"       WA_TOKEN "flows"
  WA_APP_SECRET "flows"        IG_TOKEN "flows"
  LINKEDIN_HOOK_URL "flows"
)

typeset -a FLOWS_SET API_SET
while IFS= read -r line || [[ -n "$line" ]]; do
  [[ -z "$line" || "$line" == \#* ]] && continue
  name="${line%%=*}"; value="${line#*=}"
  [[ -n "${WHERE[$name]:-}" ]] || { echo "skip $name: not a rotatable variable (see docs)"; continue; }
  [[ -n "$value" ]] || { echo "skip $name: empty value"; continue; }
  for svc in ${=WHERE[$name]}; do
    if [[ "$svc" == "flows" ]]; then FLOWS_SET+=("$name=$value"); else API_SET+=("$name=$value"); fi
  done
  [[ "$name" == "OPS_TOKEN" ]] && API_SET+=("FLOWS_OPS_TOKEN=$value")
  # local .env: replace the line or append — the value never echoes
  if grep -q "^$name=" "$ENVF"; then
    (( DRY )) || python3 - "$ENVF" "$name" "$value" <<'PY'
import sys; p,n,v=sys.argv[1:]; L=open(p).read().split("\n")
open(p,"w").write("\n".join((f"{n}={v}" if l.startswith(n+"=") else l) for l in L))
PY
  else
    (( DRY )) || printf '%s=%s\n' "$name" "$value" >> "$ENVF"
  fi
  extra=""; [[ "$name" == "OPS_TOKEN" ]] && extra=" (+ FLOWS_OPS_TOKEN on api)"
  echo "plan: $name → ${WHERE[$name]}$extra"
done < "$NEW"

run() { if (( DRY )); then echo "would: railway variables --service $1 --set <${#@}-1 vars>"; else railway variables --service "$1" "${@:2}" >/dev/null && echo "set on $1"; fi; }
if (( ${#FLOWS_SET[@]} )); then args=(); for kv in "${FLOWS_SET[@]}"; do args+=(--set "$kv"); done; run flows "${args[@]}"; fi
if (( ${#API_SET[@]} ));   then args=(); for kv in "${API_SET[@]}";   do args+=(--set "$kv"); done; run api   "${args[@]}"; fi

if (( DRY )); then echo "dry run — $NEW kept, nothing changed"; exit 0; fi
rm -P "$NEW" 2>/dev/null || rm -f "$NEW"
echo "waiting for flows to redeploy…"
for i in $(seq 1 40); do
  sleep 15
  if curl -sf --max-time 10 https://flows-production-e528.up.railway.app/health | grep -q '"ok":true'; then echo "flows healthy"; exit 0; fi
done
echo "flows not healthy after 10 min — check: railway logs --service flows"; exit 2
