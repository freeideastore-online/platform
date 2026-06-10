# FreeIdeaStore Platform

FreeIdeaStore is the public idea lab in the Open Frontier store ecosystem.

It is where raw ideas are submitted, critiqued, researched, supported, pivoted, parked, trashed, and matured into ProIdeaStore candidates.

## Current Scope

- Cloudflare Worker in `packages/worker`.
- Worker Assets serving the UI from `store/`.
- D1-backed collaboration API for ideas, profiles, contributions, and reactions.
- Cheap dynamic idea pages at `/ideas/:id/`, backed by D1 metadata and optional R2 idea bodies/render cache.
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

## Cheap Free Ideas

FreeIdeaStore is optimized for very large idea volume. It should not create a repository, Zensical project, or generated file tree for every raw idea.

Default storage:

- D1 stores the searchable/indexed fields: title, summary, stage, category, signal, next step, risk, contributor and reaction counts.
- R2 can store longer idea markdown bodies and rendered HTML cache objects.
- The Worker renders `/ideas/:id/` pages and only fetches bounded result sets for the homepage.
- Pro graduation marks an idea as a candidate and produces a dossier draft payload.

This keeps ordinary free ideas cheap and prevents the repo from filling with millions of generated files.

## Pro Graduation

Promising ideas move to ProIdeaStore when they deserve diligence. The Pro path is where full books, research packets, prototype notes, pitch decks, and investment/build readiness work belong.

The old `idea-books/:slug/` source tree remains as a reference/export shape for promoted ideas only. It is not the default creation path for FreeIdeaStore.

Create a cheap free idea through the API:

```bash
curl -X POST https://freeideastore.serge-the-dev.workers.dev/api/ideas \
  -H 'content-type: application/json' \
  -H 'x-idea-handle: serge' \
  -d '{"title":"New Idea","summary":"One sentence summary with enough context.","category":"platform","stage":"raw"}'
```

MCP provisioning follows the same cheap path through `packages/mcp`:

- `free_idea_template` returns the one-page free idea template.
- `create_free_idea` creates a D1/R2-backed idea page.
- `promote_to_pro_candidate` marks an idea for ProIdeaStore review and returns a dossier draft.
- `proidea_book_template` and `dry_run_proidea_book_export` are for promoted ideas only.

The MCP Worker does not need a GitHub token for ordinary free idea creation.

## API

- `GET /api/health`
- `GET /api/ideas?stage=all&limit=60`
- `POST /api/ideas`
- `GET /api/ideas/:id`
- `POST /api/ideas/:id/promote`
- `GET /api/ideas/:id/contributions`
- `POST /api/ideas/:id/contributions`
- `POST /api/ideas/:id/reactions`
- `GET /api/profiles`
