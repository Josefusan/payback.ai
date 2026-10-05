# Status — updated 2026-10-05 (G0 green → G1)

## Done this gate
- T-INT-004: build plan + kickoff prompt (evidence: docs/13-build-plan.md)
- T-INT-001: index.ts mounts only; routes in per-lane modules (evidence: apps/worker/src/index.ts, apps/worker/src/routes/)
- T-INT-003: Env/wrangler.jsonc INT-only change process (evidence: apps/worker/src/env.ts, docs/decisions.md)
- T-INT-002: HTTP contract v0, 18 fixtures, coverage test (evidence: packages/contracts/api.ts, apps/worker/src/contracts.test.ts)
- G0 exit checks: `python3 evals/dod.py --gate G0` → PASS (evidence: evals/out/dod.json)

## Next (gate G1 · 2026-10-11)
- T-L2-001: L2 — Clef spike, real response → docs/clef-response-sample.json — acceptance: file holds a scrubbed live response
- T-L1-001: L1 — OAuth + Transaction Search + Balances against sandbox — acceptance: dod not encoded yet
- T-L1-002: L1 — seed script v0, ids appended to docs/sandbox-activity.md
- Deploy worker to *.workers.dev (webhooks need a public URL)
- T-L4-001: L4 — AG Studio scaffold + ledger grid on packages/contracts/fixtures (unblocked now)

## Blockers
- T-L2-001 + deploy blocked on Cloudflare auth — unblock by Joseph: `wrangler login` locally or put a `CLOUDFLARE_API_TOKEN` in a mode-600 file on the VPS; create D1 `payback`; enable Workers AI
- T-L1-001 blocked on PayPal sandbox app creds — unblock by Joseph: create sandbox app (Transaction search, Invoicing, Payouts), write `PAYPAL_CLIENT_ID`/`PAYPAL_CLIENT_SECRET` to apps/worker/.dev.vars (gitignored)
- Q1 entrant type pending — default: individual until decided (needed before G6)

## Eval snapshot
checks: not run this gate · product: not run (no Clef access yet) · judge: not run · unit: 38/38 · dod G0: PASS
