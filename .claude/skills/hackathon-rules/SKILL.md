---
name: hackathon-rules
description: Official rules of the PayPal AI Hackathon (Devpost, Oct 1–Nov 12 2026) as enforceable constraints. Use before any design decision, before adding a dependency/third-party asset, before writing README/Devpost/video content, and whenever someone asks "is this allowed?" or "does this qualify?".
---

# PayPal AI Hackathon — rules as constraints

Full text: `docs/01-official-rules.md` (read it when a question isn't answered here). If the live page
https://paypalaihackathon.devpost.com/rules differs, the live page wins; the Official Rules beat every other hackathon page.

## Hard requirements (violating any = disqualification or Stage-One fail)
| ID | Requirement | How we comply |
|---|---|---|
| R1 | Integrates the **PayPal developer platform using the sandbox** | All PayPal calls → `api-m.sandbox.paypal.com`; `PAYPAL_ENV=sandbox` enforced |
| R2 | Integrates **an AI tool/model/platform**, and **PayPal is central** | Clef decisions on every PayPal transaction; agent acts via PayPal APIs |
| R3 | Built new, or significantly updated after **Oct 1 2026 9:00am PT** | Repo created Oct 2026; README "Built during the Submission Period" section |
| R4 | Installs and runs consistently; **functions as depicted** in video/text | Never show or claim a feature that the build can't do live |
| R5 | Text description of features/functionality | `submission/devpost-description.md` |
| R6 | **Functional demo**: README setup/run instructions OR hosted URL (we do both). Mockups/static prototypes don't count | `README.md#run-it`, hosted on Workers |
| R7 | **Public GitHub repo**, all source/assets/instructions, **open-source license detectable in About** | MIT `LICENSE` at root; flip to public before submitting |
| R8 | **Video < 3:00**, shows it working on its platform, **public on YouTube**, no 3rd-party trademarks/copyrighted music without permission | `docs/11-demo-video-plan.md`; `submission/video.json` |
| R9 | Test access free & unrestricted **until Dec 15 2026**; private site → credentials in testing instructions; include sandbox login details/keys needed | Hosted demo w/ demo login; README "Testing" section; sandbox-only creds |
| R10 | English (or translations) | All English |
| R11 | Original work, solely owned, no IP violations; OSS allowed if licenses followed and we build on top | Track third-party code/assets in `submission/assets.md` |
| R12 | Third-party SDK/API/data used per their terms | Use official SDKs; respect trial licenses (AG Studio, Bryntum) |
| R13 | No financial/preferential support from PayPal or Devpost for the project | Attest in submission notes |
| R14 | No viruses/malware/harmful code | Security review agent; no obfuscated code |
| R15 | No edits after deadline (Nov 12 12:00pm PT) | Internal deadline Nov 10 6pm PT |

## Eligibility (check per teammate)
Age of majority; not resident in Brazil, Quebec, Russia, Crimea, Cuba, Iran, North Korea or other OFAC-comprehensively-sanctioned places; not employed by/affiliated with PayPal, Devpost, a judge, or anyone running the hackathon (incl. immediate family/household). Team/Org must name one eligible **Representative**.

## Prizes (what we can win)
Max = **1 Grand + 1 Sponsor** OR **1 Honorable Mention + 1 Sponsor**. Sponsor prize eligibility = "uses any [sponsor] tools" (+ sponsor's stated criteria). Our targets: see `docs/03-prizes-and-strategy.md`.

## Judging
Stage One pass/fail (fits theme + applies required APIs/SDKs). Stage Two: five equal criteria — Technological Implementation, Design, Potential Impact, Innovation/Idea, Presentation; tie-break in that order. Judging may be AI-assisted; judges may not run the code. → load skill `hackathon-success`.

## Decision procedure when unsure
1. Find the governing clause in `docs/01-official-rules.md`; quote it.
2. If still ambiguous: the rules require a **written clarification request before the deadline** → draft a question for the PayPal Discord (https://discord.gg/sJ2G6DyvSK) / support@devpost.com and flag it to the human team. Do not guess on anything that risks disqualification.
3. Record the answer in `docs/rulings.md` with date and source.
