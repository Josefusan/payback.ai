# Boundary ladder — extracted from the source image

Source label: "Where this sits". Preserve these words when citing the ladder. Do not promote clean architecture or DDD to their own level.

## Level 0. No boundary

- What it looks like: Raw SQL against any table from anywhere. Zevar i today.
- Who it suits: Prototypes only

## Level 1. Data-access layer per table

- What it looks like: One module owns `global_leads` SQL; callers use functions. The plan.
- Who it suits: Floor for any production app

## Level 2. Modular monolith (domain modules)

- What it looks like: Code grouped into domains (Leads, Campaigns, Senders, Safety). Each domain owns its tables, and other domains may only call its public interface, never its tables. Still one codebase, one database, one deploy per unit.
- Who it suits: The gold standard for a single team at Zevar i's size. Shopify runs this way at very large scale.

## Level 3. Microservices, database per service

- What it looks like: Each domain is a separate service with its own database, talking over the network.
- Who it suits: Many independent teams. Too much for Zevar i: every join becomes a network call and every transaction becomes a distributed one.

## Not a separate rung

Clean/hexagonal architecture and DDD aren't separate rungs. They describe how to build level 2 well, and the lead module is a hexagonal "port" in their terms.

## Three changes to adopt the gold standard, not just the floor

1. Group modules by domain, not by table. The plan says "a boundary per hot table." `campaigns` and `campaign_targets` (438 sites combined) belong in one Campaigns module, and lead identity, dedupe and research belong in one Leads module. Splitting per table recreates the cross-module join problem one level up.
2. Enforce the boundary with one mechanical rule. Boundaries that are only a convention erode within months. The usual check is a single lint/CI rule: "the string `global_leads` may only appear inside `packages/leads/`." That conflicts slightly with the plan's rule of no new gates, but it's a net reduction. One rule about where SQL may live replaces most of the ~2,200 identifier pins that exist only because SQL can live anywhere.
3. Make schema changes expand/contract behind the module. Add the new column, write both, switch reads, then drop the old one, each step inside the module and one release apart. This is the standard zero-downtime migration pattern. With a boundary in place, each step touches one file, so the 389/383-style breakages mostly can't happen.
