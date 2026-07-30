# Architecture

FreeIdeaStore is intentionally cheap to host.

## Storage Model

- D1 stores idea metadata, profiles, comments, contributions, and reactions.
- R2 can store larger idea bodies.
- Static assets hold platform docs and skills. Idea pages and publication chapters are rendered dynamically from D1/R2-backed canonical idea documents.
- Cloudflare Workers serve the public site and API.
- A separate MCP Worker exposes agent tools.
- Zensical builds the platform documentation from `platform-docs/` into `store/docs/`.

## One Page Versus Publication

Dynamic idea pages come from D1 and optional R2 body content. Multi-page publications use the same source document: the Worker splits canonical Markdown headings into chapter URLs and renders them on demand.

This lets the free store scale to many lightweight ideas while still supporting deeper publication-style work for ideas that earn it.

Agents and consoles update the canonical idea document as Markdown. The Worker owns the HTML rendering path for both the main idea page and chapter pages.

## Site Navigation

Every surface shares one header: brand on the left, site nav, theme toggle, and a hamburger button.

Below each page's mobile breakpoint the nav collapses into a drawer that opens under the sticky header. The button is hidden on desktop, where the nav stays inline. The drawer closes on link click, outside click, `Escape`, and on resize back to desktop, and carries `aria-expanded` / `aria-controls`.

`packages/worker/src/site-nav.ts` is the single source: `NAV_TOGGLE` (markup), `navCss(breakpoint)` (styles, parameterized so each page keeps its own breakpoint), and `NAV_SCRIPT` (behavior). All Worker-rendered pages import it.

The hand-written pages in `store/` (`index.html`, `about/`, `skills/`) cannot import TypeScript, so they carry inline copies marked with a comment pointing back at the module. **Changing the drawer means updating those three files too.**

Account state (avatar or "Sign in") sits *outside* the nav on the console and profile pages, so it stays visible on mobile rather than disappearing into the drawer.

## Search

`/search` and `GET /api/search?q=…` cover idea documents and research entries. Without it a deep corpus is unusable: nothing could answer "which ideas mention ETIM" or "where did we record the Matrixify correction".

The index is an FTS5 virtual table populated on write, not derived from a content table, because canonical bodies live in R2 and are invisible to SQL. Document sections are re-indexed on every canonical write and dropped when an idea is removed; research entries are indexed as they arrive, with the claim weighted above the prose.

Tokenizer is `porter unicode61`. Stemming matches plurals and inflections in both directions — `supplier`/`suppliers`, `infer`/`inferring` — which is what prose search needs. Prefix wildcards are deliberately not used with it: porter stems the query as well as the content, so a prefix on a stemmed term matches unpredictably.

User input is never passed to FTS5 raw. Terms are extracted and individually quoted, so punctuation that FTS5 treats as syntax (`OR`, `-`, parentheses) is searched for rather than executed, and a multi-word query is an AND of terms.

Ranking starts at bm25 and then demotes what the record has moved past: a superseded research entry stays findable but does not outrank the correction that replaced it, and low-confidence entries are nudged down.

## Why Not One Repository Per Free Idea

Free ideas can be numerous and low quality. A repo per idea would add operational cost and hit platform limits. The free store should keep raw ideas in shared storage and reserve heavier publishing workflows for mature ideas.
