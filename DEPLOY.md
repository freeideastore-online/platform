# FreeIdeaStore Deploy

FreeIdeaStore is hosted on Cloudflare Workers with Worker Assets and D1. The Worker code supports optional R2 for longer idea bodies and rendered-page cache objects once the Cloudflare token has R2 permissions.

## Live

https://freeideastore.online

## Cloudflare Resources

- Worker: `freeideastore`
- MCP Worker: `freeideastore-mcp`
- D1: `freeideastore`
- D1 database ID: `6c8cefe4-f170-45fd-9979-ebef9068e1aa`
- Optional R2 bucket: `freeideastore-ideas`

## Commands

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm db:migrate:local
pnpm --filter @fis/worker exec wrangler d1 migrations apply freeideastore --remote
pnpm --filter @fis/worker exec wrangler deploy
pnpm --filter @fis/mcp exec wrangler deploy
```

Wrangler reads `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` from the environment. If those are set (e.g. via shell profile or CI secrets), no Doppler wrapper is needed.

Legacy Doppler path (no longer active — the `pas` project was removed from the workspace):

```bash
# doppler run --project pas --config prd -- pnpm --filter @fis/worker exec wrangler deploy
```

R2 is live as of 2026-07-30. The `freeideastore-ideas` bucket exists and `IDEA_BUCKET` is bound in `packages/worker/wrangler.toml`:

```toml
[[r2_buckets]]
binding = "IDEA_BUCKET"
bucket_name = "freeideastore-ideas"
```

Canonical idea bodies are written there so a document is not limited to what fits in a D1 column value. `ideaBody()` prefers `body_key` and falls back to `body_md`, so rows written before the binding existed keep rendering, and a failed R2 write still stores the body inline rather than losing it.

Because bodies are no longer readable from SQL, `has_publication` is evaluated from the `body_words` and `chapter_count` columns added in migration `0010`, maintained on every canonical write. Deploying a worker that reads those columns requires the migration to be applied first.

The note that previously lived here — that the Cloudflare token lacked R2 permissions — is obsolete; the token can create and write buckets.

## Cost Model

Free ideas use the cheap path by default:

- D1 for metadata, listing, reactions, comments, reputation, and promotion state.
- Optional R2 for longer markdown bodies and rendered page cache objects.
- Worker rendering for `/ideas/:id/`, with bounded list queries on the homepage.
- Zensical-generated static assets only for the platform documentation under `/docs/`.

Do not create one Git repository, one Zensical project, or one generated static file tree for every free idea. Free idea publications are rendered dynamically from canonical Markdown. Heavier ProIdeaStore diligence artifacts can use a separate Pro workflow later.

## Custom Domain

`freeideastore.online` is the canonical public domain for the FreeIdeaStore Worker.
`mcp.freeideastore.online` is the canonical public domain for the FreeIdeaStore MCP Worker.

Wrangler config:

```toml
[[routes]]
pattern = "freeideastore.online"
zone_name = "freeideastore.online"
custom_domain = true
```

MCP Wrangler config:

```toml
[[routes]]
pattern = "mcp.freeideastore.online"
zone_name = "freeideastore.online"
custom_domain = true
```

The `workers.dev` URL may still exist as a fallback, but product links, sitemap, robots, MCP defaults, and Playwright E2E tests use `https://freeideastore.online`.

## Doppler

Doppler is no longer required. The `pas` project that held the Cloudflare token was removed from the workspace. Deployment credentials are provided via environment variables (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`) set in shell profiles or CI secrets.
