# Demo Video Plan (target 2:45, hard max 2:59)

Rules: < 3:00, public on YouTube, shows the project working on its platform, no copyrighted music, no
third-party trademarks without permission, English.

> **Rewritten 2026-10-09.** The previous draft had the presenter sliding a *confidence dial* (does not
> exist — the threshold is a deployment setting) and an agent-action beat built on overdue invoices (no
> invoices table). It also opened by clicking **Sync**, which is a *planned* nav item and is not selectable.
> Every shot below is something that runs today; §"Do not claim" lists what must stay off camera until it
> does.

| Time | Shot | Voiceover (draft) |
|---|---|---|
| 0:00–0:15 | A merchant's PayPal activity list → the ledger screen, already booked | "If you sell through PayPal, your books are a weekend chore — fees, refunds, holds and payouts don't map cleanly onto accounting. Payback.ai is an AI back office that does it for you, through PayPal." |
| 0:15–0:40 | Ledger grid: one sale shown as **gross, PayPal fee, net cash** lines; the reconcile tile below it | "It reads every PayPal transaction and posts real double-entry books. The fee is split to its own account. And the ledger is checked against PayPal's own balance — the pending bucket tells you exactly what is waiting on you rather than hiding the difference." |
| 0:40–1:15 | **Review queue.** Open the item flagged `possible_injection:0.966`. Show: *why* it stopped, the untrusted subject line, and the full probability spread | "The agent doesn't guess. Below its confidence threshold, it stops — and it shows you everything: the reason code, the probability on every account it considered, and the payment text marked *untrusted*, because a buyer wrote it." |
| 1:15–1:35 | Approve that item with an account override → the entry posts; ledger and tie-out update | "You decide. Override the account if you disagree, and your name goes on the entry." |
| 1:35–2:10 | **The agent refuses.** It proposes the refund the injected text demanded → `blocked`, rule `refund_over_hard_cap`. Then a legitimate vendor payout over its limit → queued → approve → **PayPal payout executes** | "This one is the point. The payment told the agent to refund five thousand dollars. It proposed the refund — and its own policy refused it. No model output can override a hard cap. For a real vendor bill it proposes a payout, stops because it's over its limit, and waits. I approve, and PayPal pays." |
| 2:10–2:35 | **Audit trail**: the story, the chain, **Chain intact** | "And every one of those steps is on a hash-chained trail — the agent's postings, my approvals, the PayPal call. Change any row and the chain fails to verify. That's what makes this auditable rather than just automated." |
| 2:35–2:45 | Managerial dashboard: contribution by product line, AR aging; title card | "The agent does the bookkeeping. The audit trail is what makes a controller willing to let it." |

**Recording notes.** The agent runs on an hourly cron, so the ledger is already populated when you start —
do **not** look for a Sync button (it is a *planned* nav item and is deliberately not selectable). If you
want to show ingestion, `POST /api/sync` in a terminal is honest and shows the endpoint.

Known-good values to check the recording against (live, 2026-10-09):

- injection order `87M6127029325142K` — `possible_injection:0.966`, account `4100`/`4000` spread on screen
- refund proposal → `{"outcome":"blocked","policy_rule":"refund_over_hard_cap"}`
- payout `$2,500` → `{"outcome":"review","policy_rule":"payout_over_autonomous_limit"}`
- after approval → `{"outcome":"executed","paypal_ref":"PKMU7VDGVCP8Q"}`
- `GET /api/audit/verify` → `{"ok":true}`

## Do not claim on camera (not built)

- **An autonomy dial.** The threshold is `AUTO_POST_THRESHOLD`, a deployment setting. Do not say "slide the
  dial", and do not point at anything as one. The honest line is that limits are deterministic and a human
  approves above them.
- **The Controller agent / "month-end close in minutes".** Neither exists; `/api/close` is a contract stub.
- **`GET /api/confidence/sweep`** and the precision/review-rate numbers it would produce.
- **Invoice reminders and dispute triage.** The clients and the approval route exist, but nothing has
  executed them; only a refund and a payout have. Say "refunds and payouts".
- **"Calibrated probabilities."** The distributions are shown; calibration is not measured. Say "the
  probability it assigned", not "calibrated".
- Anything on a **Sync** or **Agent actions** screen — both are labelled *planned* and are disabled.

Production notes: 1080p screen capture, captions burned-in, no music (or licensed royalty-free with proof in
`submission/assets.md`), no external logos; show PayPal sandbox pages as product footage only.
After upload, record duration in `submission/video.json` → `{ "youtube_url": "...", "duration_seconds": 165,
"visibility": "public" }`.
