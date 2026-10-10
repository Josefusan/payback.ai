# Demo Video Plan (target 2:52, hard max 2:59)

Rules: < 3:00, public on YouTube, shows the project working on its platform, no copyrighted music, no
third-party trademarks without permission, English.

> **Rewritten 2026-10-09.** The previous draft had the presenter sliding a *confidence dial* (at the time it
> did not exist — the threshold was a deployment setting) and an agent-action beat built on overdue invoices
> (no invoices table). It also opened by clicking **Sync**, which is a *planned* nav item and is not
> selectable. Every shot below is something that runs today; §"Do not claim" lists what must stay off camera
> until it does.
>
> **Updated 2026-10-11.** The dial now exists, so the 2026-10-09 note above is superseded on that one point:
> the autonomy dial is built (`GET|PUT /api/settings/auto_post_threshold`, `GET /api/confidence/sweep`,
> `migrations/0004_settings.sql`) and sits on the managerial screen, and turning it writes a `setting` row to
> the hash-chained audit log. Two beats are added below — the dial, and budget-vs-actual variance — and the
> timeline is compressed to stay under 3:00.

| Time | Shot | Voiceover (draft) |
|---|---|---|
| 0:00–0:12 | A merchant's PayPal activity list → the ledger screen, already booked | "If you sell through PayPal, your books are a weekend chore — fees, refunds, holds and payouts don't map cleanly onto accounting. Payback.ai is an AI back office that does it for you, through PayPal." |
| 0:12–0:35 | Ledger grid: one sale shown as **gross, PayPal fee, net cash** lines; the reconcile tile below it | "It reads every PayPal transaction and posts real double-entry books. The fee is split to its own account. And the ledger is checked against PayPal's own balance — the pending bucket tells you exactly what is waiting on you rather than hiding the difference." |
| 0:35–1:05 | **Review queue.** Open the item flagged `possible_injection:0.966`. Show: *why* it stopped, the untrusted subject line, and the full probability spread | "The agent doesn't guess. Below its confidence threshold, it stops — and it shows you everything: the reason code, the probability on every account it considered, and the payment text marked *untrusted*, because a buyer wrote it." |
| 1:05–1:22 | Approve that item with an account override → the entry posts; ledger and tie-out update | "You decide. Override the account if you disagree, and your name goes on the entry." |
| 1:22–1:50 | **The agent refuses.** It proposes the refund the injected text demanded → `blocked`, rule `refund_over_hard_cap`. Then a legitimate vendor payout over its limit → queued → approve → **PayPal payout executes** | "This one is the point. The payment told the agent to refund five thousand dollars. It proposed the refund — and its own policy refused it. No model output can override a hard cap. For a real vendor bill it proposes a payout, stops because it's over its limit, and waits. I approve, and PayPal pays." |
| 1:50–2:10 | **Audit trail**: the story, the chain, **Chain intact** | "And every one of those steps is on a hash-chained trail — the agent's postings, my approvals, the PayPal call. Change any row and the chain fails to verify. That's what makes this auditable rather than just automated." |
| 2:10–2:34 | **Managerial dashboard — budget vs actual**: plan against booked for the month, variance in dollars and percent, a favourable/adverse flag, above AR aging and P&L by product line | "For the owner, this is the report they actually open: what the month earned against what was planned, with variance in dollars and percent and a favourable or adverse flag — plus AR aging and margin by product line. All of it is the ledger's own SQL; no model produces a number on this screen." |
| 2:34–2:52 | **Autonomy dial**: drag the threshold, read the confidence sweep (auto-posted, precision when auto, sent to a human, **judged transactions**), click *Set threshold* → the change appears as a `setting` row in the audit chain | "And the one control that decides how much the agent may do alone. I move the auto-post threshold and read what it would change — how many transactions would post without a human, and the precision over the ones a reviewer has actually judged, with the sample size shown, because a small sample is not evidence. Setting it writes the change to the audit chain." |
| 2:52–2:59 | Title card | "Payback.ai — the agent does the bookkeeping; the audit trail is what makes a controller let it." |

**Recording notes.** The agent runs on an hourly cron, so the ledger is already populated when you start —
do **not** look for a Sync button (it is a *planned* nav item and is deliberately not selectable). If you
want to show ingestion, `POST /api/sync` in a terminal is honest and shows the endpoint. The dial and the
review-approve beat need the **admin token**, so enter it in the dial's token field (or set it once) before
recording — see "Known-good values".

Known-good values to check the recording against (live, 2026-10-09; dial and budget added 2026-10-11):

- injection order `87M6127029325142K` — `possible_injection:0.966`, account `4100`/`4000` spread on screen
- refund proposal → `{"outcome":"blocked","policy_rule":"refund_over_hard_cap"}`
- payout `$2,500` → `{"outcome":"review","policy_rule":"payout_over_autonomous_limit"}`
- after approval → `{"outcome":"executed","paypal_ref":"PKMU7VDGVCP8Q"}`
- `GET /api/audit/verify` → `{"ok":true}`
- `GET /api/settings/auto_post_threshold` → `{"key":"auto_post_threshold","value":0.9,"updated_by":"deploy default","updated_at":""}` until it has been turned; range `[0.80, 0.99]`, step `0.01`, out-of-range clamped
- `GET /api/confidence/sweep` → 20 points from `0.80` to `0.99`, each with `coverage`, `auto_precision`, `review_rate`, `n_labeled`
- `GET /api/reports/budget-variance` (no `period` → the current UTC month) and `?period=2026-10` → rows with `budget_cents`, `actual_cents`, `variance_cents`, `variance_pct`, `favourable`; seeded in `migrations/0005_budgets.sql`

## Do not claim on camera (not built)

- **The Controller agent / "month-end close in minutes".** Neither exists; `/api/close` is a contract stub.
- **Invoice reminders and dispute triage.** The clients and the approval route exist, but nothing has
  executed them; only a refund and a payout have. Say "refunds and payouts".
- **"Calibrated probabilities."** The distributions are shown; calibration is not measured (the product
  eval's ECE is ~0.20, well above its 0.05 ceiling). Say "the probability it assigned", not "calibrated".
- Anything on a **Sync** or **Agent actions** screen — both are labelled *planned* and are disabled.

Production notes: 1080p screen capture, captions burned-in, no music (or licensed royalty-free with proof in
`submission/assets.md`), no external logos; show PayPal sandbox pages as product footage only.
After upload, record duration in `submission/video.json` → `{ "youtube_url": "...", "duration_seconds": 172,
"visibility": "public" }`.
