# test/fixtures/clef — recorded decision responses (owner: L2)

Replay fixtures for the `fixture` DecisionProvider (T-L2-002). `transactions.json` keys are PayPal
`transaction_event_code`s; `actions.json` keys are action `type`s. Values are recorded Clef
answers in the shape documented in `.claude/skills/cloudflare-clef/SKILL.md`.

These are hand-recorded to the documented schema. T-L2-001 (Clef spike) replaces the source with a real
scrubbed response in `docs/clef-response-sample.json`; keep the shapes identical so replay stays honest.

Never used by production (`DECISION_PROVIDER` defaults to `clef`); replay only for tests and eval runs.
