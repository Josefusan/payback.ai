# Evals — "are we winning, and are we allowed to?"

Four layers, all stdlib Python 3.10+ (no installs). Run from the repo root. Reports land in `evals/out/` (gitignored).

| Layer | Script | Question it answers | Gate |
|---|---|---|---|
| 1. Rules compliance (deterministic) | `python evals/checks.py [--github OWNER/REPO]` | Do we meet every hard requirement in Official Rules §4? (license, README sections, PayPal + AI in code, sandbox-only, no secrets, video < 3:00 public, repo public, created in period) | 0 hard failures |
| 2. Simulated judging panel (LLM-as-judge) | `python evals/llm_judge.py [--stage 1] [--strict]` | Would 5 judge personas pass Stage One and score Stage Two ≥ targets? What are the top fixes? | Stage 1 all pass; mean ≥ 8.5; each ≥ 7.5; Presentation ≥ 8.5 |
| 3. Product evals | `python evals/product_evals.py --worker http://localhost:8787 --safety` | Is Clef classification precise & calibrated at our auto-post threshold? Does the agent refuse unsafe money movement? | precision ≥ 97%, review ≤ 25%, ECE ≤ 0.05, review-recall ≥ 0.9, **0 critical safety failures** |
| 4. Production architecture | `python evals/architecture_audit.py` | Where does the system sit on the boundary ladder (0-3), and does it score ≥ 12/15 on each of the six engineering pillars? | ladder ≥ level 1 with the level-2 gap tracked; no pillar < 9 at submit. Process: `docs/14-production-audit.md` |

Rubric: `evals/rubric.json` (criteria text is verbatim from Rules §6; anchors and personas are ours).
Datasets: `dataset_transactions.jsonl` (30 labeled PayPal transactions for a fictional design studio — extend to 200+ with real sandbox data), `dataset_safety.jsonl` (10 adversarial/edge action proposals).

## Env
```
ANTHROPIC_API_KEY=...        # for llm_judge.py (shell env only, never commit)
JUDGE_MODEL=claude-sonnet-4-5 # any current Claude model id
```

## Cadence
- Every PR: `checks.py` (CI-able, fast).
- Daily from Week 2: `product_evals.py --worker ... --safety` against `wrangler dev`.
- Weekly + before recording the video + before submitting: `llm_judge.py --strict`.
- Gates G1/G4/G5: `python evals/architecture_audit.py` (production architecture audit → `docs/audit.md`, process `docs/14-production-audit.md`).
- Final (Nov 10): all three green, plus `checks.py --github Josefusan/payback.ai` after flipping the repo public.

## Notes
- `product_evals.py --selftest` only validates metric code with synthetic predictions (it intentionally reports the synthetic set as miscalibrated).
- The judge is told plans/TODOs earn no credit and unbacked claims are negative — so fix the product, not the prose.
- Add a labeled example whenever a real decision is wrong (`errors` in `out/product.json`) — the dataset is our regression suite.
