---
name: demo-submission
description: Produce the Devpost submission package — text description, "tools used and how", testing instructions, README polish, demo video script/recording checklist (< 3:00, public YouTube, no copyrighted music/trademarks), screenshots, and the final submit sequence. Use when writing anything a judge will read or watch, or when preparing to submit.
---

# Demo & submission

Requirements: `docs/04-submission-checklist.md` · Video plan: `docs/11-demo-video-plan.md` · Rules: skill `hackathon-rules`.

## Files we own
- `submission/devpost-description.md` — paste-ready Devpost text (sections below)
- `submission/video.json` — `{youtube_url, duration_seconds, visibility, no_copyrighted_music, no_third_party_trademarks, shows_working_project}`
- `submission/video-transcript.md` — final narration (the LLM judge reads this as "the video")
- `submission/assets.md` — every third-party asset/font/icon/music with license + proof

## Devpost description template
1. **Inspiration** — the owner's pain in one paragraph, specific audience.
2. **What it does** — the end-to-end loop in 5 bullets, each tied to a PayPal capability.
3. **How we built it** — architecture diagram; **Tools used and how** table: PayPal (each API + what for), Cloudflare Workers AI **Clef** (what decisions), LLM (what prose), AG Studio/AG Grid (which widgets/agents), APIMatic Context Plugin (built the PayPal integration), Cloudflare D1/Queues/Workflows.
4. **Built during the Submission Period** — repo created Oct 2026; list of what was built.
5. **Challenges** — honest (sandbox Transaction Search lag, calibration).
6. **Accomplishments** — eval numbers (precision, review rate, safety 0 failures), close time.
7. **What we learned** / **What's next**.
8. **Testing instructions** — hosted URL + demo login, OR README steps; sandbox buyer account email/password *for the sandbox only* (sandbox accounts are fake test identities — never real credentials); note "available free until Dec 15, 2026".

## Writing rules
- Every claim must be demonstrable in the build or video (Rules: functions as depicted). Numbers come from `evals/out/*.json` or measured runs.
- Name the audience concretely; quantify the pain with a cited source or our own measurement.
- Lead with the outcome, not the stack.
- English; short sentences; skimmable headings (an AI may pre-screen).
- No third-party logos in the video/gallery; product UIs in footage are fine.

## Video checklist
Target 2:45 · 1080p · captions · no music or licensed royalty-free (record license) · live sandbox run end-to-end · show PayPal sandbox evidence (invoice/payout/transaction) · end on impact numbers + architecture · upload **Public** on YouTube · fill `submission/video.json` · run `python evals/checks.py`.

## Final submit sequence (Nov 10, internal deadline 6pm PT)
1. All evals green (skill `run-evals`).
2. Make repo **public**; confirm license in About; `python evals/checks.py --github Josefusan/payback.ai`.
3. Fresh-clone run-through by a teammate who didn't build it.
4. Devpost: fill all fields, select AG Grid (+ APIMatic) sponsor prizes, add teammates, **Submit** (not just save draft); screenshot confirmation.
5. Freeze: after Nov 12 12:00pm PT, no submission edits. Keep the hosted demo alive until Dec 15.
