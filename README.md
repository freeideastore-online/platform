# FreeIdeaStore Platform

FreeIdeaStore is the public idea lab in the Open Frontier store ecosystem.

It is where raw ideas are submitted, critiqued, researched, supported, pivoted, parked, trashed, and matured into ProIdeaStore candidates.

## Current Scope

- Cloudflare Worker in `packages/worker`.
- Worker Assets serving the UI from `store/`.
- D1-backed collaboration API for ideas, profiles, contributions, and reactions.
- Independent idea book source in `idea-books/:slug/`, with a separate `zensical.toml` and `docs/` folder per idea. Built book websites are served from `store/ideas/:slug/`.
- Seed data in `packages/worker/migrations/0001_collaboration.sql`.

## Local Preview

```bash
pnpm install
pnpm docs:build
pnpm db:migrate:local
pnpm dev
```

Live Worker:

https://freeideastore.serge-the-dev.workers.dev

## Product Principle

Ideas are not the product. The contributors are the product: their critiques, evidence, pivots, prototypes, and judgment create visible reputation.

## Idea Books

The storefront shows snippet previews. Each idea links to a hosted book website under `/ideas/:slug/`. The book home contains a table of contents, and each chapter has its own URL for brainstorming, research, design notes, prototype plans, validation steps, risks, and contribution prompts.

The common chapter spine makes ideas comparable across the store. Idea-specific appendix chapters can be added when a project needs extra depth, such as compliance, valuation models, trust and safety, or prototype architecture.

The current build uses `pnpm docs:build` so the Worker can host books immediately. Each idea has its own `zensical.toml`, matching the intended future flow: idea source -> Zensical build -> hosted book artifact.

## API

- `GET /api/health`
- `GET /api/ideas`
- `POST /api/ideas`
- `GET /api/ideas/:id/contributions`
- `POST /api/ideas/:id/contributions`
- `POST /api/ideas/:id/reactions`
- `GET /api/profiles`
