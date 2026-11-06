#!/usr/bin/env bash
# The public demo's auto-update (docs/public-demo.md), run by cubefarm-demo-update.timer every 5 minutes.
#
# When main has a newer commit whose CI run passed, and there is memory to spare, it builds the newest such commit in a release
# folder of its own (/opt/cubefarm-demo-releases/<sha>), points `current` at it, restarts cubefarm-demo and checks
# its health. A failed build never touches the running demo; a failed health check points `current` back and
# restarts the previous release. Either way the sha is marked failed and never retried. The decisions are in
# demoUpdateSteps.mjs, installed next to this file (tested in scripts/demoUpdateSteps.test.ts).
#
# Never touches the live office (/root/Projects/keelfarm, cubefarm.service, ports 4317/5317, /root/.cubefarm).
set -Eeuo pipefail

REPO=7empes7s/keelfarm
REL=/opt/cubefarm-demo-releases    # /opt/cubefarm-demo -> $REL/current -> <sha>
MIRROR=$REL/keelfarm.git
UNIT=cubefarm-demo
URL=http://127.0.0.1:4400
STATE=${STATE_DIRECTORY:-/var/lib/cubefarm-demo-update}
KEEP=3
STEPS="$(dirname "$(readlink -f "$0")")/demoUpdateSteps.mjs"
export PATH=/opt/node22/bin:$PATH
# The repo is private: the host's GitHub token (the one keel-deploy uses), read at run time, never printed.
GH_TOKEN="${GH_TOKEN:-$(grep -m1 '^GH_TOKEN=' /etc/keel/gh.env | cut -d= -f2-)}"
export GH_TOKEN

mkdir -p "$STATE/failed"
exec 9>"$STATE/lock"
flock -n 9 || exit 0   # a run is already in progress

log() { echo "$*"; }   # stdout goes to the journal
trap 'log "ERROR: line $LINENO exited $? (unexpected)"' ERR
status() {  # result sha message: the small status file the office can read
  node "$STEPS" status "$1" "$2" "$3" > "$STATE/status.json.tmp" && mv -f "$STATE/status.json.tmp" "$STATE/status.json"
}
# Log a wait or skip once per (sha, reason), so idle ticks stay quiet.
note_once() {
  [ "$(cat "$STATE/last-note" 2>/dev/null)" = "$1:$2" ] && return 0
  echo "$1:$2" > "$STATE/last-note"
  log "$3"
  status "$4" "$1" "$3"
}
# git over https with the token from the environment; the helper expands it, so it is never on a command line.
gitm() { git -c credential.helper= -c 'credential.helper=!f() { echo username=x-access-token; echo "password=$GH_TOKEN"; }; f' --git-dir="$MIRROR" "$@"; }

if [ ! -L "$REL/current" ]; then
  log "ERROR: $REL/current is missing; do the one-time setup in docs/public-demo.md"
  exit 1
fi
[ -d "$MIRROR" ] || gitm init -q --bare
gitm fetch -q "https://github.com/$REPO" +refs/heads/main:refs/heads/main
HEAD_SHA=$(gitm rev-parse refs/heads/main)
CURRENT=$(readlink "$REL/current")
[ "$HEAD_SHA" = "$CURRENT" ] && exit 0

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
# main's commits after the running one, newest first, and CI's latest runs on main.
gitm rev-list --max-count=50 "$HEAD_SHA" "^$CURRENT" > "$TMP/newer.txt"
curl -sf -m 30 -o "$TMP/runs.json" -H @- -H 'Accept: application/vnd.github+json' \
  "https://api.github.com/repos/$REPO/actions/workflows/ci.yml/runs?branch=main&per_page=50" \
  <<< "Authorization: Bearer $GH_TOKEN" || true
IFS=$'\t' read -r ACTION KEY TARGET MSG < <(node "$STEPS" decide "$CURRENT" "$TMP/newer.txt" "$TMP/runs.json" "$STATE/failed" /proc/meminfo)
case "$ACTION" in
  idle) exit 0 ;;
  wait) note_once "$TARGET" "$KEY" "$MSG" waiting; exit 0 ;;
  skip) note_once "$TARGET" "$KEY" "$MSG" skipped; exit 0 ;;
  update) ;;
  *) log "ERROR: no decision for ${HEAD_SHA:0:7}"; exit 1 ;;
esac

log "$MSG"
rm -f "$STATE/last-note"
NEW=$REL/$TARGET
BUILD_LOG=$STATE/build-$TARGET.log
fail() {  # reason: before the switch, so the running demo was never touched
  touch "$STATE/failed/$TARGET"
  rm -rf "$NEW"
  log "FAILED ${TARGET:0:7}: $1; the demo stays on ${CURRENT:0:7} (rm $STATE/failed/$TARGET to retry)"
  status failed "$TARGET" "$1"
  exit 1
}
switch_to() { ln -sfn "$1" "$REL/current.next" && mv -Tf "$REL/current.next" "$REL/current"; }
healthy() {
  for _ in $(seq 1 20); do
    sleep 3
    local root_code state_code
    root_code=$(curl -s -m 5 -o "$TMP/root.html" -w '%{http_code}' "$URL/" || true)
    state_code=$(curl -s -m 5 -o "$TMP/state.json" -w '%{http_code}' "$URL/api/state" || true)
    PROBLEM=$(node "$STEPS" health "$root_code" "$TMP/root.html" "$state_code" "$TMP/state.json") && return 0
  done
  return 1
}

rm -rf "$NEW"   # a half-built folder from an interrupted run
{
  git clone -q --no-checkout "$MIRROR" "$NEW" &&
  git -C "$NEW" checkout -q --detach "$TARGET" &&
  cd "$NEW" &&
  nice -n 19 ionice -c3 npm ci --no-audit --no-fund --loglevel=error &&
  nice -n 19 ionice -c3 npm run build
} > "$BUILD_LOG" 2>&1 || fail "build failed (log: $BUILD_LOG)"
cd /

switch_to "$TARGET"
PROBLEM="restart failed"
if systemctl restart "$UNIT" && healthy; then
  status updated "$TARGET" "$MSG"
  log "updated ${TARGET:0:7}: health ok"
  node "$STEPS" prune "$REL" "$KEEP" "$TARGET" "$CURRENT" | while read -r old; do
    rm -rf "${REL:?}/$old" "$STATE/build-$old.log"
  done
  exit 0
fi

touch "$STATE/failed/$TARGET"
log "ROLLBACK ${TARGET:0:7} -> ${CURRENT:0:7}: health check failed ($PROBLEM)"
switch_to "$CURRENT"
if systemctl restart "$UNIT" && healthy; then
  log "rollback ok: the demo is ${CURRENT:0:7}"
  status rolled-back "$TARGET" "health check failed ($PROBLEM); back on ${CURRENT:0:7}"
else
  log "CRITICAL: rollback to ${CURRENT:0:7} failed too ($PROBLEM); the demo needs a look"
  status critical "$TARGET" "rollback to ${CURRENT:0:7} failed ($PROBLEM)"
fi
rm -rf "$NEW"
exit 1
