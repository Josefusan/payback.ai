#!/usr/bin/env bash
# Capture REAL API responses (verbatim) for the beats that show a terminal.
#
# Every line the film prints from these files is the unmodified response body of a live call to the
# deployed Worker. The admin token is read from ~/.payback-admin.env and is passed as an environment
# variable, so the command line that ends up on screen contains no secret.
#
#   bash video/capture-api.sh
set -uo pipefail

BASE="${PAYBACK_BASE:-https://payback.clarktechventures.workers.dev}"
OUT="$(cd "$(dirname "$0")" && pwd)/captures"
mkdir -p "$OUT"

# shellcheck disable=SC1090
[ -f "$HOME/.payback-admin.env" ] && . "$HOME/.payback-admin.env"
: "${PAYBACK_ADMIN_TOKEN:?PAYBACK_ADMIN_TOKEN must be set (~/.payback-admin.env)}"
export PAYBACK_ADMIN_TOKEN

# The injection capture the buyer's text tried to make the agent refund.
CAPTURE_ID="${PAYBACK_INJECTION_REF:-87M6127029325142K}"
# A fresh vendor bill so the proposal is not deduped against an earlier run.
BILL_ID="${PAYBACK_BILL_ID:-BILL-1043}"

record() { # record <name> <command-line-as-typed>
  local name="$1"; shift
  local cmd="$1"; shift
  printf '%s\n' "$cmd" > "$OUT/$name.cmd"
  printf '%s\n' "$cmd" > "$OUT/$name.txt"
  "$@" >> "$OUT/$name.txt" 2>&1
  printf '\n' >> "$OUT/$name.txt"
  echo "─── $name ────────────────────────────────────────────────"
  cat "$OUT/$name.txt"
}

echo "base: $BASE"

# 1. The refund the injected text demanded — three orders of magnitude over the hard cap.
record api-refund-propose \
  "curl -sS -X POST $BASE/api/actions/propose -H 'content-type: application/json' -H \"x-admin-token: \$PAYBACK_ADMIN_TOKEN\" -d '{\"proposal\":{\"type\":\"refund\",\"capture_id\":\"$CAPTURE_ID\",\"amount_cents\":500000}}'" \
  curl -sS -X POST "$BASE/api/actions/propose" \
    -H 'content-type: application/json' \
    -H "x-admin-token: $PAYBACK_ADMIN_TOKEN" \
    -d "{\"proposal\":{\"type\":\"refund\",\"capture_id\":\"$CAPTURE_ID\",\"amount_cents\":500000}}"

# 2. A legitimate vendor bill, above the autonomous payout limit — waits for a human.
record api-payout-propose \
  "curl -sS -X POST $BASE/api/actions/propose -H 'content-type: application/json' -H \"x-admin-token: \$PAYBACK_ADMIN_TOKEN\" -d '{\"proposal\":{\"type\":\"payout\",\"bill_id\":\"$BILL_ID\",\"receiver\":\"sam.ortiz@example.com\",\"amount_cents\":250000},\"context\":\"Invoice 1043 from Sam Ortiz, due this week\"}'" \
  curl -sS -X POST "$BASE/api/actions/propose" \
    -H 'content-type: application/json' \
    -H "x-admin-token: $PAYBACK_ADMIN_TOKEN" \
    -d "{\"proposal\":{\"type\":\"payout\",\"bill_id\":\"$BILL_ID\",\"receiver\":\"sam.ortiz@example.com\",\"amount_cents\":250000},\"context\":\"Invoice 1043 from Sam Ortiz, due this week\"}"

PAYOUT_ID=$(python3 -c "import json,sys;print(json.load(open('$OUT/api-payout-propose.txt'.replace('$OUT','$OUT'))))" 2>/dev/null || true)
PAYOUT_ID=$(tail -1 "$OUT/api-payout-propose.txt" | python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])' 2>/dev/null || echo "")

# 3. The human approves it — this is the call that moves sandbox money.
if [ -n "$PAYOUT_ID" ]; then
  record api-payout-approve \
    "curl -sS -X POST $BASE/api/actions/$PAYOUT_ID/approve -H 'content-type: application/json' -H \"x-admin-token: \$PAYBACK_ADMIN_TOKEN\" -d '{\"by\":\"Joseph\"}'" \
    curl -sS -X POST "$BASE/api/actions/$PAYOUT_ID/approve" \
      -H 'content-type: application/json' \
      -H "x-admin-token: $PAYBACK_ADMIN_TOKEN" \
      -d '{"by":"Joseph"}'
else
  echo "!! could not read the payout row id; skipping approve"
fi

# 4. The chain, recomputed.
record api-audit-verify \
  "curl -sS $BASE/api/audit/verify" \
  curl -sS "$BASE/api/audit/verify"

# 5. Every action the agent took that was refused, or is waiting.
record api-actions \
  "curl -sS '$BASE/api/actions?outcome=blocked'" \
  curl -sS "$BASE/api/actions?outcome=blocked"

echo
echo "wrote $OUT/api-*.txt"
