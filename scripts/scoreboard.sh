#!/usr/bin/env bash
# One-command scoreboard: incremental build, then test-serializer + test-error-handler
# (+ the hard-case corpus scoreboard when scripts/hard-scoreboard.js exists).
#
# Usage: scripts/scoreboard.sh [--fast] [--skip-build] [--no-hard] [--filter <substr>]
#   --fast        run test-serializer with --fast (one flag permutation per test, ~3x quicker)
#   --skip-build  do not rebuild lib/
#   --no-hard     skip the hard-case corpus
#   --filter s    only serializer tests whose path contains s
# Full logs go to $SCOREBOARD_LOGS (default /tmp/opencode/scoreboard-logs).
# Exit code is non-zero if any suite failed.

set -u
cd "$(dirname "$0")/.."

FAST=""
BUILD=1
HARD=1
FILTER=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --fast) FAST="--fast" ;;
    --skip-build) BUILD=0 ;;
    --no-hard) HARD=0 ;;
    --filter) FILTER="$2"; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

LOGS="${SCOREBOARD_LOGS:-/tmp/opencode/scoreboard-logs}"
mkdir -p "$LOGS"
STATUS=0

now() { date +%s; }

if [[ $BUILD == 1 ]]; then
  t=$(now)
  # @babel/cli has no incremental mode, but rebuilding all of src/ takes ~5s.
  if ! node_modules/.bin/babel src --out-dir lib --source-maps > "$LOGS/build.log" 2>&1; then
    echo "build:            FAILED (see $LOGS/build.log)"
    tail -20 "$LOGS/build.log"
    exit 1
  fi
  echo "build:            ok ($(( $(now) - t ))s)"
fi

t=$(now)
SER_ARGS=(--stack_trace_limit=200 --stack_size=10000 scripts/test-runner.js)
[[ -n $FAST ]] && SER_ARGS+=("$FAST")
[[ -n $FILTER ]] && SER_ARGS+=(--filter "$FILTER")
node_modules/.bin/babel-node "${SER_ARGS[@]}" > "$LOGS/serializer.log" 2>&1
rc=$?
[[ $rc != 0 ]] && STATUS=1
passed=$(grep -E '^Passed:' "$LOGS/serializer.log" | tail -1)
echo "test-serializer:  ${passed:-CRASHED (no summary, exit $rc)} ($(( $(now) - t ))s)${FAST:+ [fast]}"
if grep -q "Summary of failed tests:" "$LOGS/serializer.log"; then
  sed -n '/Summary of failed tests:/,/^Passed:/p' "$LOGS/serializer.log" | grep -v -E '^(Summary|Passed)' \
    | sed -E 's/ \([0-9]+ bytes\)$//' | sort | uniq -c | sed 's/^/    /'
fi

t=$(now)
node_modules/.bin/babel-node scripts/test-error-handler.js > "$LOGS/error-handler.log" 2>&1
rc=$?
[[ $rc != 0 ]] && STATUS=1
passed=$(grep -E '^Passed:' "$LOGS/error-handler.log" | tail -1)
echo "test-error-handler: ${passed:-CRASHED (no summary, exit $rc)} ($(( $(now) - t ))s)"

# --- hard-case corpus hook (owned by agent 0B) ---
if [[ $HARD == 1 ]]; then
  if [[ -f scripts/hard-scoreboard.js ]]; then
    t=$(now)
    node scripts/hard-scoreboard.js --prepack lib/prepack-node.js > "$LOGS/hard.log" 2>&1
    rc=$?
    echo "hard corpus:      (exit $rc, $(( $(now) - t ))s, full log $LOGS/hard.log)"
    tail -25 "$LOGS/hard.log" | sed 's/^/    /'
  else
    echo "hard corpus:      HOOK - scripts/hard-scoreboard.js not present yet"
  fi
fi

exit $STATUS
