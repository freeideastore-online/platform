# FreeIdeaStore Deploy

FreeIdeaStore is hosted on Cloudflare Workers with Worker Assets and D1. The Worker code supports optional R2 for longer idea bodies and rendered-page cache objects once the Cloudflare token has R2 permissions.

## Live

https://freeideastore.online

## Cloudflare Resources

- Worker: `freeideastore`
- D1: `freeideastore`
- D1 database ID: `6c8cefe4-f170-45fd-9979-ebef9068e1aa`
- Optional R2 bucket: `freeideastore-ideas`

## Commands

```bash
pnpm install
pnpm typecheck
pnpm db:migrate:local
doppler run --project pas --config prd -- pnpm --filter @fis/worker exec wrangler r2 bucket create freeideastore-ideas
doppler run --project pas --config prd -- pnpm db:migrate:prod
doppler run --project pas --config prd -- pnpm --filter @fis/worker exec wrangler deploy
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

Do not create one Git repository or one generated static file tree for every free idea. Full Zensical/book-style artifacts are reserved for promoted ProIdeaStore opportunities.

## Custom Domain

`freeideastore.online` is the canonical public domain for the FreeIdeaStore Worker.

Wrangler config:

```toml
[[routes]]
pattern = "freeideastore.online"
zone_name = "freeideastore.online"
custom_domain = true
```

The `workers.dev` URL may still exist as a fallback, but product links, sitemap, robots, MCP defaults, and Playwright E2E tests use `https://freeideastore.online`.

## Doppler

The Doppler workspace is currently at the 10-project limit, so there is no dedicated `fis` project yet. Deployment currently uses the existing Cloudflare credentials from the `pas` Doppler project.
