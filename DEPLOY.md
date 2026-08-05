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

## CI Is The Deploy Path

`.github/workflows/deploy-worker.yml` and `deploy-mcp.yml` run on push to `main` (path-filtered) and on `workflow_dispatch`. Each one installs, runs `pnpm test`, runs `pnpm typecheck`, applies D1 migrations `--remote`, then deploys. That ordering matters: a worker that reads a column added by a migration must not ship before the migration runs.

Prefer CI over a local `wrangler deploy`. Both work, but only CI cannot skip the test gate, and deploying locally while CI also deploys means two paths racing on the same worker.

```bash
gh workflow run "Deploy Worker" --repo freeideastore-online/platform --ref main
gh workflow run "Deploy MCP"    --repo freeideastore-online/platform --ref main
gh run list --repo freeideastore-online/platform --limit 4
```

Use `workflow_dispatch` rather than re-running an old run: a re-run replays that run's commit, so it will not pick up anything merged since.

### Secrets CI needs

Both workflows map org secrets onto the names wrangler expects:

```yaml
env:
  CLOUDFLARE_API_TOKEN: ${{ secrets.CF_API_TOKEN }}
  CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CF_ACCOUNT_ID }}
```

`CF_API_TOKEN` and `CF_ACCOUNT_ID` are **GitHub org secrets on `freeideastore-online`**, managed from `~/dev/ops` (`ops put fis CF_API_TOKEN`). The Cloudflare token is named `fis-prd` and needs:

| Scope | Level | Why |
|---|---|---|
| Workers Scripts — Edit | Account | deploys both workers, incl. the MCP Durable Object and the cron trigger |
| D1 — Edit | Account | `wrangler d1 migrations apply --remote` |
| Workers R2 Storage — Edit | Account | the `IDEA_BUCKET` binding |
| Account Settings — Read | Account | account resolution |
| Workers Routes — Edit | Zone `freeideastore.online` | both workers use `custom_domain = true` |

Do not add IP filtering: GitHub Actions runners have dynamic addresses.

**If a run fails with "necessary to set a CLOUDFLARE_API_TOKEN":** the secret is missing or empty — the env var is being set to an unresolved `secrets.CF_API_TOKEN`. An invalid token and an absent one look identical here. Re-place it from `~/dev/ops`:

```bash
cd ~/dev/ops && ./bin/ops push fis CF_API_TOKEN gh freeideastore-online/platform
```

FIS holds these at **repo** level (`freeideastore-online/platform`), not org level — one repo in the org deploys, and a repo secret needs only `repo` scope. Use `gh <owner/repo>` for that; `gh-org <org>` is the org-level form.

To check rather than guess, `./bin/ops verify fis` reports whether the secret GitHub actually holds matches what `inventory.yaml` claims. That needs `admin:org` on the active `gh` account (granted 2026-08-05); a `403` on `gh secret list --org` means a missing token scope, not a missing secret.

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
