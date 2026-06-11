---
title: Prototype Plan
summary: A lightweight wellbeing app concept focused on slowing down, reflection, and daily reset behavior.
---

# Prototype Plan

- Keep the current app minimal.
- Add local analytics for return visits.
- Ask five users what moment made them open it.
- Remove features that do not support a fast reset.

Current technical notes:

- app subdomain: slowdown.freeappstore.online;
- dev command: pnpm install && pnpm dev;
- build command: pnpm build;
- deploy path: git push origin main with Cloudflare Pages auto-deploy;
- local-first storage works without backend configuration;
- optional Firebase sync can be enabled with VITE_FIREBASE_* values.

Next prototype improvements:

- capture the opening context in one tap;
- record whether the recommended practice was completed;
- ask whether the user feels more settled after the practice;
- add a simple "what helped recently" view;
- keep all data export/delete controls obvious.
