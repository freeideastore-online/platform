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

The current Doppler Cloudflare token can deploy Workers and run D1 migrations, but does not have R2 bucket permissions. Until that token is expanded, leave the `IDEA_BUCKET` binding out of `packages/worker/wrangler.toml`; the Worker stores free idea bodies in D1. After R2 is available, add:

```toml
[[r2_buckets]]
binding = "IDEA_BUCKET"
bucket_name = "freeideastore-ideas"
```

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
