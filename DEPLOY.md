# FreeIdeaStore Deploy

FreeIdeaStore is hosted on Cloudflare Workers with Worker Assets and D1.

## Live

https://freeideastore.serge-the-dev.workers.dev

## Cloudflare Resources

- Worker: `freeideastore`
- D1: `freeideastore`
- D1 database ID: `6c8cefe4-f170-45fd-9979-ebef9068e1aa`

## Commands

```bash
pnpm install
pnpm typecheck
pnpm db:migrate:local
doppler run --project pas --config prd -- pnpm db:migrate:prod
doppler run --project pas --config prd -- pnpm --filter @fis/worker exec wrangler deploy
```

## Custom Domain

`freeideastore.online` is not currently a Cloudflare zone in the account used for deployment, so the Worker is live on `workers.dev`.

When the zone exists:

1. Add route blocks back to `packages/worker/wrangler.toml`.
2. Update canonical links and sitemap to `https://freeideastore.online/`.
3. Deploy with Wrangler.

## Doppler

The Doppler workspace is currently at the 10-project limit, so there is no dedicated `fis` project yet. Deployment currently uses the existing Cloudflare credentials from the `pas` Doppler project.

