# Decisions log

| Date | Decision | Why |
|---|---|---|
| 2026-10-05 | Stack: TypeScript on Cloudflare Workers (Hono, D1, Queues), Clef via Workers AI binding | Clef is native to Workers AI; one runtime |
| 2026-10-05 | Repo private until submission week, then public; MIT license | Protect idea; rules require public + OSS license at submission |
| 2026-10-05 | Sponsor target: AG Grid (fallback APIMatic) | Largest sponsor pool, 5 winners, natural fit for a ledger |
| 2026-10-05 | Product name "Payback.ai" (chosen by Mises) | Team brand for the entry |
| 2026-10-05 | Env/bindings change process: `src/env.ts` + `wrangler.jsonc` are INT-only; a lane files an INT task, INT lands env.ts + wrangler.jsonc + `.dev.vars.example` in one commit (T-INT-003) | Parallel lanes never edit the same file |
| 2026-10-05 | Contract fixtures live in `packages/contracts/fixtures/*.json` with `fixtures.ts` index, not `test/fixtures/http/` (T-INT-002) | Shared by worker tests and `apps/web`; sits beside `api.ts` |
| 2026-10-05 | Confidence-dial endpoints follow `feature-confidence-dial` skill: `GET /api/confidence/sweep`, `GET\|PUT /api/settings/auto_post_threshold` (replaces `/api/settings/threshold` in plan v1.0.0) | Skill is the detailed build spec |
| 2026-10-05 | G0 boot check uses `wrangler dev --local` (`npm run dev:local`); plain `wrangler dev` needs `CLOUDFLARE_API_TOKEN` for the remote AI binding | VPS is non-interactive; Cloudflare login is a human step |
| 2026-10-06 | Declare `DECISION_PROVIDER` ("clef"\|"fixture"\|"fallback-llm", default/prod "clef") and `FALLBACK_LLM_MODEL` (`@cf/meta/llama-3.1-8b-instruct`) in `Env` + `wrangler.jsonc` + `.dev.vars.example` (card t_0729c9c8, per the T-INT-003 process; from L2 T-L2-002) | `decision-provider.ts` already reads both defensively; declaring them makes provider selection configurable without code changes. Precedence: explicit arg → in-process config → `env.DECISION_PROVIDER` → "clef" |
