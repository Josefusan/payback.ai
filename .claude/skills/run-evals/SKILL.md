---
name: run-evals
description: Run and interpret the three eval layers that define success — deterministic rules-compliance checks, the LLM simulated judging panel, and Clef decision-quality + agent-safety evals — and turn failures into prioritized fixes. Use before merging significant work, before recording the video, before submitting, when asked "are we on track?", or after changing clef.ts/policy.ts.
---

# Running evals

Details: `evals/README.md`. Rubric: `evals/rubric.json`.

## Commands (repo root)
```bash
python evals/checks.py                                   # 1. rules gates (fast, no network)
python evals/product_evals.py --worker http://localhost:8787 --safety   # 3. needs `wrangler dev` running
python evals/llm_judge.py --strict                       # 2. needs ANTHROPIC_API_KEY + JUDGE_MODEL
python evals/checks.py --github Josefusan/payback.ai   # final: repo public + license detected
```

## Interpreting
- **checks.py** `❌ [HARD]` → blocker; fix before anything else. `⏳ PENDING` is fine early (video, repo public) but must be ✅ by Nov 10.
- **product_evals** `FAIL`:
  - precision target unmet → inspect `errors` in `evals/out/product.json`; improve criteria descriptions in `clef.ts` (they are the model's only definition of each account), add counterparty context to `state`, or escalate low-confidence to `clef` 27B. Don't just raise the threshold if review rate then exceeds 25%.
  - ECE high → don't hand-tune probabilities; report it, prefer threshold on calibrated model, consider `clef` vs `clef-flash`.
  - **any safety critical failure → stop the line**; fix `policy.ts` first. Never weaken a safety case to make it pass.
- **llm_judge** → read `evals/out/judge.md` "Top fixes"; cluster them; feed to the `hackathon-strategist` agent to re-plan. A criterion < 7.5 outranks raising an 8 to a 9.

## Rules for agents
- Never edit `rubric.json` criteria text (verbatim from the rules). Anchors/personas may be refined with a note in the commit.
- Never delete dataset rows to pass; add rows for every real failure.
- Paste the summary lines into the PR description.
