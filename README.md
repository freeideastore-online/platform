# FreeIdeaStore Platform

FreeIdeaStore is the public idea lab in the Open Frontier store ecosystem.

It is where raw ideas are submitted, critiqued, researched, supported, pivoted, parked, trashed, and matured into ProIdeaStore candidates.

## Current Scope

- Cloudflare Worker in `packages/worker`.
- Worker Assets serving the UI from `store/`.
- D1-backed collaboration API for ideas, profiles, contributions, and reactions.
- Cheap dynamic idea pages at `/ideas/:id/`, backed by D1 metadata and optional R2 idea bodies/render cache.
- GitHub/Google sign-in through the shared FreeAppStore auth service.
- Account-owned profile workspace at `/profile/` with “My ideas” and “My recent contributions”.
- Seed data in `packages/worker/migrations/0001_collaboration.sql`.

## Local Preview

```bash
pnpm install
pnpm db:migrate:local
pnpm dev
```

Live Worker:

https://freeideastore.online

MCP Worker:

https://mcp.freeideastore.online/mcp

Fallback while DNS is propagating:

https://freeideastore-mcp.serge-the-dev.workers.dev/mcp

## Product Principle

Ideas are not the product. The contributors are the product: their critiques, evidence, pivots, prototypes, and judgment create visible reputation.

## Idea Growth Infrastructure

The platform is designed as a refinery, not a post-and-forget board.

- `ideas` hold the canonical public page and current maturity fields.
- `contributions` hold evidence, critique, pivots, prototype notes, refinements, and kill signals without rewriting the canonical idea.
- `reactions` hold support, trash, and pivot signals.
- `profiles` connect every creation and contribution to a real signed-in account when available.
- `/profile/` is the owner workspace: users can see all ideas created under their account and recent work attached to their reputation.
- `/contributors/:handle/` is the public reputation surface.
- `/api/me/ideas` and `/api/me/activity` are account-scoped APIs for console, MCP, and future notification/dashboard features.
- `/skills/` publishes the idea playbooks used by humans and MCP agents.

FreeIdeaStore should grow ideas by preserving history. Refinement proposals should be captured as contributions first. When the owner or their authenticated agent is ready to make the public document better, they can publish a complete replacement markdown document into the canonical idea body.

## Cheap Free Ideas

FreeIdeaStore is optimized for very large idea volume. It should not create a repository, Zensical project, or generated file tree for every raw idea.

Default storage:

- D1 stores the searchable/indexed fields: title, summary, stage, category, signal, next step, risk, contributor and reaction counts.
- R2 can store longer idea markdown bodies and rendered HTML cache objects.
- The Worker renders `/ideas/:id/` and `/ideas/:id/:chapter/` pages from canonical idea markdown, and only fetches bounded result sets for the homepage.
- Pro graduation marks an idea as a candidate and produces a dossier draft payload.

This keeps ordinary free ideas cheap and prevents the repo from filling with millions of generated files.

## Pro Graduation

Promising ideas move to ProIdeaStore when they deserve diligence. The Pro path is where full books, research packets, prototype notes, pitch decks, and investment/build readiness work belong.

FreeIdeaStore no longer uses per-idea GitHub docs, Zensical projects, generated static idea-book assets, or static fallback pages for free ideas. ProIdeaStore can still export heavier diligence packs later, but the free store publishes books from shared platform storage.

Create a cheap free idea through the API:

```bash
curl -X POST https://freeideastore.online/api/ideas \
  -H 'content-type: application/json' \
  -H 'x-idea-handle: serge' \
  -d '{"title":"New Idea","summary":"One sentence summary with enough context.","category":"platform","stage":"raw"}'
```

MCP provisioning follows the same cheap path through `packages/mcp`:

- `free_idea_template` returns the one-page free idea template.
- `list_idea_skills`, `get_idea_skill`, and `apply_idea_skill` expose the published interviewing, critique, competitor-finding, research, refinement, pivot, and Pro assessment playbooks.
- `get_idea` reads an existing idea body, metadata, and optional contribution history.
- `create_free_idea` creates a D1/R2-backed idea page.
- `derive_idea` forks a new idea from an existing one, seeded with the parent body and linked back to the source (open to anyone; you own the fork).
- `add_idea_contribution` records evidence, risk, pivot, prototype, refinement, or kill-signal notes.
- `propose_idea_refinement` records a structured section-level refinement proposal without overwriting the canonical body.
- `publish_idea_update` replaces the authenticated owner's canonical public idea document after refinement.
- `react_to_idea` adds a support, trash, or pivot signal.
- `promote_to_pro_candidate` marks an authenticated owner's idea for ProIdeaStore review and returns a dossier draft.
- `dynamic_idea_book_template` returns the canonical Markdown heading spine used by dynamic idea publications.
- `dry_run_dynamic_idea_book` previews the canonical Markdown body and dynamic chapter URLs without writing files.

The MCP Worker does not need a GitHub token for ordinary free idea creation. Browser OAuth is the expected path for true user-session actions. Comments, reactions, contributions, canonical document updates, deletion, and Pro promotion require authentication; canonical updates, deletion, and Pro promotion require the idea owner. MCP clients send Markdown for idea bodies; the FreeIdeaStore Worker renders HTML and chapter pages at request time.

Connect from an MCP client:

```bash
npx mcp-remote https://mcp.freeideastore.online/mcp
```

If the custom MCP hostname has not propagated in a resolver yet, use:

```bash
npx mcp-remote https://freeideastore-mcp.serge-the-dev.workers.dev/mcp
```

Claude/Codex user flow:

1. Connect the MCP client to `https://mcp.freeideastore.online/mcp`.
2. Complete the browser sign-in opened by the MCP OAuth flow.
3. Ask the agent to call `create_free_idea` with a useful summary and starting markdown.
4. Share the returned `https://freeideastore.online/ideas/:id/` URL.
5. Ask the agent to call `get_idea` before every major edit.
6. Use `add_idea_contribution` or `propose_idea_refinement` for history, evidence, risks, and alternate directions.
7. Use `publish_idea_update` when the owner wants the public document to become more complete.
8. Use `promote_to_pro_candidate` only when the idea deserves ProIdeaStore diligence.

## API

- `GET /api/health`
- `GET /api/session`
- `GET /api/me/ideas`
- `GET /api/me/activity`
- `GET /api/ideas?stage=all&limit=60`
- `POST /api/ideas`
- `GET /api/ideas/:id`
- `PATCH /api/ideas/:id`
- `POST /api/ideas/:id/derive`
- `POST /api/ideas/:id/promote`
- `GET /api/ideas/:id/contributions`
- `POST /api/ideas/:id/contributions`
- `POST /api/ideas/:id/reactions`
- `GET /api/profiles`
