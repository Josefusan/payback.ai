# Judging Criteria & What "Successful" Means

This file turns Rules §6 into a scoring model our agents can optimize against. The machine-readable version
is `evals/rubric.json`; the LLM judge in `evals/llm_judge.py` uses it.

## How judging works

1. **Stage One — pass/fail gate.** Does the project *reasonably fit the theme* (PayPal + AI) and *reasonably apply the required APIs/SDKs* (PayPal developer platform, sandbox)? Fail = out.
2. **Stage Two — five equally weighted criteria** (20% each). Judging "may utilize expert panels, peer review, **automated AI-driven analysis**" — so the README, Devpost text and video transcript must be legible to an LLM as well as a human.
3. **Tie-break order:** Technological Implementation → Design → Potential Impact → Innovation → Presentation.
4. Judges are **not required to run the project**. Many will judge from the **video + text + screenshots**. The video is the product.

## The panel (who we are persuading)

| Judge | Role | What they likely reward |
|---|---|---|
| Jo Franchetti | Developer Advocate, PayPal | Clean, idiomatic PayPal integration; great DX; clear README |
| Eddie Jaoude | Developer Advocate, PayPal | Open-source quality, community-ready repo, good docs |
| Marco Podien | Developer Advocate, PayPal | Real PayPal APIs used well, not a thin wrapper |
| Karthik Ravi | Software Engineer, PayPal | Correct API usage, webhooks, idempotency, error handling |
| Himraj Singh | Engineering Manager, PayPal | Architecture, reliability, production thinking |
| Nathaniel Olson | Senior PM, PayPal | Real user, real problem, coherent product, business case |
| Sylwia Vargas | AG Grid | Polished AG Grid/AG Studio usage beyond defaults |
| Ameer Hassan | APIMatic | Built with APIMatic Context Plugins / SDKs |
| Mats Bryntse | Bryntum | Gantt/Scheduler/Calendar used well |
| Ignacio Valdez Bicard | Channel3 | Product search/enrichment as a real feature |
| Carly Richmond | Elastic | Search/vector/agent-builder done right |
| Pooja Mistry | Postman | API workflows, collections, testing |
| Shifra Williams | Render | Deployed on Render / Render Workflows |

## Score anchors (1–10 per criterion)

### 1. Technological Implementation
- **10:** PayPal is the spine — ≥4 distinct PayPal capabilities (e.g., Transaction Search, Balances, Invoicing, Payouts, Webhooks, Disputes, Orders) used correctly in sandbox, with OAuth token caching, webhook signature verification, idempotency (`PayPal-Request-Id`), pagination, error handling. AI is load-bearing (decisions change what happens with money) with calibrated confidence and a human-in-the-loop. Tests + evals in repo. Runs from README in < 10 minutes.
- **7:** 2–3 PayPal capabilities wired end-to-end; AI meaningful; some rough edges.
- **4:** One PayPal button / one API call; AI is a chat box bolted on.
- **1:** Mock data only; PayPal not actually called.

### 2. Design (complete product experience)
- **10:** Feels like a product: onboarding → connect sandbox → autonomous run → review queue → reports. Empty/loading/error states. Consistent visual system. Every screen in the video has a reason to exist.
- **7:** Coherent main flow, some unpolished screens.
- **4:** Dev console / JSON dumps.
- **1:** Proof of concept script.

### 3. Potential Impact
- **10:** Names a specific audience (e.g., "US SMBs doing $20k–$2M/yr through PayPal with no full-time bookkeeper"), quantifies the pain (hours/month on bookkeeping, month-end close days, error rates, cost of a bookkeeper), and the demo shows the pain removed with numbers (e.g., "143 transactions categorized, 96% auto-posted, books closed in 4 minutes").
- **7:** Real audience, generic claims.
- **4:** "Everyone who uses money."
- **1:** No problem stated.

### 4. Innovation / Idea
- **10:** Something judges haven't seen: decision-model (Clef) calibrated autonomy over a real double-entry ledger, agent that *acts* through PayPal (invoices, payouts, dispute evidence) only when confidence and policy allow; managerial insight, not just bookkeeping.
- **7:** Known idea with a novel twist.
- **4:** "ChatGPT for your PayPal transactions."
- **1:** Clone of an existing product.

### 5. Presentation (video + pitch)
- **10:** < 2:50. First 15 seconds: who, what pain, what we built. Live end-to-end run in PayPal sandbox with visible PayPal UI/receipts. Clear voiceover, captions, no copyrighted music, no third-party logos without permission. Ends with impact numbers + architecture slide.
- **7:** Clear, but slow start or partial flow.
- **4:** Slides with little product footage.
- **1:** Over 3 minutes / unlisted / not on YouTube.

## Definition of success (team targets)

| Gate / metric | Target | Checked by |
|---|---|---|
| All Stage One gates pass | 100% | `evals/checks.py`, `evals/llm_judge.py --stage 1` |
| Simulated panel mean (Stage Two) | **≥ 8.5 / 10** | `evals/llm_judge.py` |
| No single criterion below | **7.5** | `evals/llm_judge.py` |
| Presentation score | ≥ 8.5 | judge on video script/transcript |
| Distinct PayPal capabilities used live in sandbox | ≥ 4 | `evals/checks.py` |
| Clef auto-post precision on labeled set | ≥ 97% at chosen threshold | `evals/product_evals.py` |
| Review-queue rate | ≤ 25% | `evals/product_evals.py` |
| Calibration (ECE) | ≤ 0.05 | `evals/product_evals.py` |
| Money-moving actions taken on injected/adversarial input | **0** | `evals/product_evals.py --safety` |
| Ledger invariants (debits = credits, reconciles to PayPal balance ±$0.01) | 100% | worker tests |
| Fresh-clone-to-running time following README | ≤ 10 min | human dry-run by a teammate |
| Video length | ≤ 2:50 | manual + `evals/checks.py` (reads `submission/video.json`) |

## Anti-patterns that lose (ban list)

- PayPal used only as a "Pay" button on an otherwise AI app (fails "PayPal integration is central").
- AI as a chatbot that only summarizes (not load-bearing).
- Live/production PayPal credentials or real money anywhere.
- Repo private or license missing in About at submission time.
- Video > 3:00, unlisted/private, copyrighted music, third-party logos (including Cloudflare/PayPal logos used decoratively — show product UIs, don't brand the video with others' logos).
- README that needs secrets we didn't provide; judges can't run it.
- Claims in text/video the build can't actually do (Rules: must "function as depicted").
