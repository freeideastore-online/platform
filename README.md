# FreeIdeaStore Platform

FreeIdeaStore is the public idea lab in the Open Frontier store ecosystem.

It is where raw ideas are submitted, critiqued, researched, supported, pivoted, parked, trashed, and matured into ProIdeaStore candidates.

## Current Scope

- Cloudflare Worker in `packages/worker`.
- Worker Assets serving the UI from `store/`.
- D1-backed collaboration API for ideas, profiles, contributions, and reactions.
- Seed data in `packages/worker/migrations/0001_collaboration.sql`.

## Local Preview

```bash
pnpm install
pnpm db:migrate:local
pnpm dev
```

Live Worker:

https://freeideastore.serge-the-dev.workers.dev

## Product Principle

Ideas are not the product. The contributors are the product: their critiques, evidence, pivots, prototypes, and judgment create visible reputation.

## API

- `GET /api/health`
- `GET /api/ideas`
- `POST /api/ideas`
- `GET /api/ideas/:id/contributions`
- `POST /api/ideas/:id/contributions`
- `POST /api/ideas/:id/reactions`
- `GET /api/profiles`

