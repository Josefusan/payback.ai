# Submission Checklist (Rules §4) — every box must be checked

Deadline: **Thu Nov 12, 2026, 12:00 pm PT** (PST after Nov 1 → 20:00 UTC → 2:00 pm Mexico City → 2:00 pm Nashville CST). **Internal deadline: Tue Nov 10, 6:00 pm PT.** Proof of sending ≠ proof of receipt.

## Devpost form
- [ ] Registered via "Join Hackathon" (every teammate joins the Devpost project)
- [ ] Entrant type chosen; Representative named
- [ ] Project name + tagline
- [ ] **Text description**: problem, audience, features, how it works, what's new during the Submission Period
- [ ] **Tools section**: every tool used and *how* (PayPal APIs list, Cloudflare Workers AI / Clef, LLM, AG Grid/AG Studio, APIMatic Context Plugin, etc.)
- [ ] **Functional demo**: hosted demo URL **and** README setup instructions (do both)
- [ ] If hosted demo has login: credentials in testing instructions
- [ ] **GitHub URL** (public)
- [ ] **YouTube URL** (public, < 3:00)
- [ ] Sponsor prize opt-ins selected (AG Grid; APIMatic)
- [ ] Screenshots / gallery images (no third-party logos)
- [ ] Submitted (not just draft) — screenshot the confirmation

## Repository
- [ ] Public before submit (switch Settings → Danger Zone → Change visibility)
- [ ] `LICENSE` (MIT) at root; GitHub shows it in **About**
- [ ] README: overview, problem/audience, features, architecture diagram, **tools used + how**, setup in ≤ 10 min, sandbox test accounts/credentials guidance, demo URL, video link, "built during the Submission Period" note, license
- [ ] All source, assets, migrations, seed data committed; nothing needed lives only on a laptop
- [ ] No secrets committed (`python evals/checks.py` passes secret scan); `.env.example` complete
- [ ] Only sandbox endpoints (`api-m.sandbox.paypal.com`)
- [ ] Hosted demo stays up free and unrestricted until **Dec 15, 2026**

## Video
- [ ] < 3:00 (target 2:45)
- [ ] Shows the project running on its intended platform (web app in browser), end-to-end, PayPal sandbox visible
- [ ] No copyrighted music (use none or royalty-free with license), no third-party trademarks without permission
- [ ] English voiceover/captions
- [ ] Public on YouTube

## Evals (must be green)
- [ ] `python evals/checks.py` → all hard gates pass
- [ ] `python evals/llm_judge.py` → Stage 1 all pass; Stage 2 mean ≥ 8.5, min ≥ 7.5
- [ ] `python evals/product_evals.py` → precision/ECE/safety targets met
