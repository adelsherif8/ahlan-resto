#!/bin/zsh
# THE HALF OF THE DAY NOBODY TESTS. Runs the Munadim fixtures against PRODUCTION at
# 03:00 Cairo (launchd, see tools/launchd/com.munadim.night-run.plist), appends to
# test-runs.log like every other run, and pushes an ntfy alert on any failure so the
# founder reads it with his coffee. A laptop asleep at 03:00 runs it on wake.
#
#   ./tools/night-run.sh            # what launchd runs
#   ./tools/night-run.sh --install  # write + load the launchd job (once per Mac)
set -u
cd "$(dirname "$0")/.."
export PATH=/opt/homebrew/bin:$PATH
export $(grep -E '^(OPS_TOKEN|NTFY_TOPIC)=' .env | xargs)
BASE=${NIGHT_BASE:-https://flows.munadim.com}
LOG=/tmp/munadim-night-run.log

if [[ "${1:-}" == "--install" ]]; then
  PL=~/Library/LaunchAgents/com.munadim.night-run.plist
  cat > "$PL" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.munadim.night-run</string>
  <key>ProgramArguments</key><array><string>/bin/zsh</string><string>$(pwd)/tools/night-run.sh</string></array>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>3</integer><key>Minute</key><integer>0</integer></dict>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict></plist>
EOF
  launchctl unload "$PL" 2>/dev/null; launchctl load "$PL" && echo "installed: runs daily at 03:00 local → $LOG"
  exit 0
fi

fail=0
for f in convos-reel6.json convos-munadim5.json; do
  node convo-test.mjs "$BASE" munadim "$f" > "/tmp/night-$f.log" 2>&1 || fail=1
  tail -1 "/tmp/night-$f.log"
done
node persona-test.mjs "$BASE" munadim personas-munadim.json > /tmp/night-personas.log 2>&1 || fail=1
grep -E "^PERSONAS" /tmp/night-personas.log

if [[ $fail -ne 0 && -n "${NTFY_TOPIC:-}" ]]; then
  body=$(grep -hE "^   ❌|FORBIDDEN —|NO REPLY|^  ❌" /tmp/night-*.log | head -12)
  curl -s -X POST "https://ntfy.sh/$NTFY_TOPIC" -H "Title: Munadim night run FAILED" -H "Priority: high" -H "Tags: rotating_light" -d "$body" > /dev/null
fi
echo "night run $(date -u +%FT%TZ) → $([[ $fail -eq 0 ]] && echo PASS || echo FAIL)"
exit $fail
