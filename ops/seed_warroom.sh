#!/usr/bin/env bash
# Seed the Payback.ai war-room board with G1 cards from docs/13-build-plan.md
set -uo pipefail
H="$HOME/.local/bin/hermes"
REPO="/home/joseph/Hackathons/paypal-hackathon"
declare -A ID

add() {
  local key="$1" title="$2" asg="$3" st="${4:-ready}" id extra=()
  [ "$st" = blocked ] && extra+=( --initial-status blocked )
  id=$(printf '%s' "${BODY}" | $H kanban create "$title" \
        --assignee "$asg" --created-by "war-room" --idempotency-key "$key" \
        --body-file - --json --workspace "dir:${REPO}" --max-runtime 30m "${extra[@]}" \
        | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
  ID[$key]="$id"
  printf '  %-10s -> task %s  (%s, %s)\n' "$key" "$id" "$asg" "$st"
}

echo "== creating cards =="

BODY="$(cat <<'EOF'
Lane L1 (PayPal and Actions). Before starting, read docs/13-build-plan.md section 1 (L1) and section 4 (T-L1-001), plus CLAUDE.md.

Owned paths: src/paypal.ts, src/pipeline.ts, src/policy.ts, src/actions.ts, src/routes/sync.ts, src/routes/webhooks.ts, src/routes/review.ts, src/routes/actions.ts.
Do NOT touch other lanes' files: src/index.ts, src/env.ts, wrangler.jsonc (INT); src/ledger.ts, money.ts (L3); src/clef.ts (L2); apps/web (L4).

Task: implement the PayPal client path for the sandbox — OAuth token, Transaction Search, and Balances.

Definition of done: unit tests build the request and parse the response against fixtures in test/fixtures/paypal/; the live sandbox call is wired for when credentials land.
Blocker: the live verification needs PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET in apps/worker/.dev.vars (Joseph). Write and unit-test the code path now.

Rules: work in the shared repo dir, run `npx vitest run` from apps/worker, do NOT git commit, leave changes for review. Report: files touched, commands run, evidence path, and anything blocked.
EOF
)"
add T-L1-001 "L1: PayPal client — OAuth, Transaction Search, Balances" payback-l1 ready

BODY="$(cat <<'EOF'
Lane L1 (PayPal and Actions). Read docs/13-build-plan.md section 1 (L1) and section 4 (T-L1-002).

Task: seed script v0 that creates sandbox activity — orders captured, a refund, invoices sent/paid/overdue, a payout, a dispute — appending every created id to docs/sandbox-activity.md.

Definition of done: scripts/seed-sandbox.* runs against the sandbox and logs ids; docs/sandbox-activity.md updated.
Blocked on: T-L1-001 parent and PayPal sandbox credentials.
EOF
)"
add T-L1-002 "L1: Seed script v0 (sandbox data + ids log)" payback-l1 blocked

BODY="$(cat <<'EOF'
Lane L1 (PayPal and Actions). Read docs/13-build-plan.md section 1 (L1) and section 4 (T-L1-003).

Task: webhook endpoint — verify the PayPal signature before any side effect, dedupe on event_id with INSERT OR IGNORE into webhook_events, enqueue the event.

Definition of done: a replayed webhook adds no second row; verify-webhook-signature is called first.
Blocked on: a public workers.dev URL (deploy, T-INT-005) — webhooks cannot reach wrangler dev.
EOF
)"
add T-L1-003 "L1: Webhook verify + dedupe + enqueue" payback-l1 blocked

BODY="$(cat <<'EOF'
Lane L2 (Decisions and Evals). Read docs/13-build-plan.md section 1 (L2) and section 4 (T-L2-001).

Task: Clef spike — call the Clef decision model and record one scrubbed real response to docs/clef-response-sample.json; correct src/clef.ts types if the real schema differs from the current blog-derived types.

Definition of done: docs/clef-response-sample.json holds a real response; clef.ts types match it.
Blocked on: Cloudflare auth (wrangler login or CLOUDFLARE_API_TOKEN) and enabling Workers AI, so the AI binding works.
EOF
)"
add T-L2-001 "L2: Clef spike — record real response" payback-l2 blocked

BODY="$(cat <<'EOF'
Lane L2 (Decisions and Evals). Read docs/13-build-plan.md section 1 (L2) and section 4 (T-L2-002).

Task: introduce src/decision-provider.ts — one interface with three implementations: clef (live Workers AI binding), fixture (recorded JSON), fallback-llm. decideTransaction and decideAction route through the active provider; any error routes the txn to review, never throws.

Definition of done: provider selection is configurable; a test drives the fixture provider end to end and asserts a blocked/failed decision lands in the review queue.
Blocked on: nothing — build against the fixture provider now; the live clef provider is used once T-L2-001 lands.
EOF
)"
add T-L2-002 "L2: DecisionProvider abstraction (clef/fixture/fallback-llm)" payback-l2 ready

BODY="$(cat <<'EOF'
Lane L3 (Ledger and Reports). Read docs/13-build-plan.md section 1 (L3) and section 4 (T-L3-002).

Task: implement postEntry and reverseEntry. postEntry(env, { transactionId, accountOverride?, decisionId, approver }) posts a human-corrected/approved journal entry so L1's approval route never writes ledger SQL. reverseEntry reverses by linking reverses_entry_id; the ledger is append-only (reversals, never updates).

Definition of done: signature frozen as above; a test posts an entry then a reversal and asserts the balances net to zero and no row was mutated.

Rules: run `npx vitest run` from apps/worker, do NOT git commit, leave changes for review.
EOF
)"
add T-L3-002 "L3: postEntry + reverseEntry (append-only)" payback-l3 ready

BODY="$(cat <<'EOF'
Lane L4 (Dashboard). Read docs/13-build-plan.md section 1 (L4) and section 4 (T-L4-001). Note the contract decision in docs/decisions.md: fixtures live in packages/contracts/fixtures/.

Task: scaffold the apps/web dashboard and render the ledger grid against packages/contracts fixtures — group by account, pinned totals, drill-through to source transaction.

Definition of done: the app builds and renders the ledger grid from fixtures; no live API dependency yet.
Blocked on: nothing — fixtures exist now.
Rules: do NOT git commit; leave changes for review.
EOF
)"
add T-L4-001 "L4: Dashboard scaffold + ledger grid on fixtures" payback-l4 ready

BODY="$(cat <<'EOF'
Lane L5 (Proof and Submission). Read docs/13-build-plan.md section 1 (L5) and section 4 (T-L5-001), plus the demo-submission skill.

Task: build the claims ledger at submission/claims.md — every README/Devpost claim maps to an evidence path (file:line or evals/out/*.json); remove or schedule any claim with no backing.

Definition of done: submission/claims.md lists each claim with its evidence path; unbacked claims flagged.
Blocked on: nothing.
EOF
)"
add T-L5-001 "L5: Claims ledger with evidence paths" payback-l5 ready

BODY="$(cat <<'EOF'
Lane INT (Integrator). Read docs/13-build-plan.md section 1 (INT).

Task: deploy the worker to a *.workers.dev URL so webhooks have a public endpoint, then record the URL in docs/status.md.

Definition of done: `npx wrangler deploy` succeeds; the URL answers GET /api/health; docs/status.md updated.
Blocked on: Joseph — Cloudflare auth (`wrangler login` or a mode-600 CLOUDFLARE_API_TOKEN on the VPS), D1 database `payback` created, Workers AI enabled.
EOF
)"
add T-INT-005 "INT: Deploy worker to workers.dev" payback-int blocked

echo "== linking dependencies =="
$H kanban link "${ID[T-L1-001]}" "${ID[T-L1-002]}" && echo "  T-L1-002 depends on T-L1-001"
$H kanban link "${ID[T-L1-002]}" "${ID[T-L1-003]}" && echo "  T-L1-003 depends on T-L1-002"

echo "== board state =="
$H kanban list 2>&1
