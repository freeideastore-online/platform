# Publications

A publication is a multi-page workspace for an idea that has enough signal to justify deeper research, design, prototype, validation, and open-question pages.

## Why Publications Exist

Some ideas need more than one page. A serious idea can have separate pages for research, design, prototype, validation, and open questions. This makes the work inspectable without turning the store listing into a giant document.

## Universal Two-Level Spine

Use this spine for serious idea publications across products, services, communities, tools, content products, marketplaces, local businesses, AI agents, and startups.

1. Overview
   - Snapshot
   - Current thesis
   - Status
   - Why this deserves attention
2. People And Problem
   - First user or buyer
   - Problem moment
   - Current workaround
   - Urgency or frequency
3. Context And Evidence
   - Existing alternatives
   - Competitors or substitutes
   - Source trail
   - Unknowns
4. Proposed Solution
   - Core promise
   - User workflow
   - Smallest useful version
   - Out of scope
5. Risks And Constraints
   - Trust and safety
   - Legal or regulatory constraints
   - Operational or technical constraints
   - Kill signals
6. Validation
   - Riskiest assumption
   - Cheapest test
   - Success threshold
   - Pivot or trash criteria
7. Prototype Or Pilot
   - Demo or pilot
   - Required resources
   - Manual or fakeable parts
   - Must be real
8. Model And Distribution
   - Sustainability model
   - Pricing or funding hypothesis
   - Channels
   - Partnerships
9. Evolution
   - Open questions
   - Contribution prompts
   - Next decisions
   - ProIdeaStore readiness

## Should Every Idea Use This Spine?

No. Free ideas should be cheap. Raw ideas can use only the sections that are honest. Use the full spine when the idea has enough signal to justify deeper work. ProIdeaStore candidates should usually have a complete or nearly complete publication.

## Lifecycle Stages

- Raw: a rough prompt or early concept.
- Shaping: the user, problem, and smallest version are being clarified.
- Researching: competitors, substitutes, sources, constraints, and evidence are being gathered.
- Validating: the riskiest assumption is being tested with real behavior.
- Prototyping: a demo, pilot, manual service, or testable artifact is being built.
- Launched: something usable exists in public, private, or pilot form.
- Pivot: the original shape is changing because a sharper wedge or blocker emerged.
- Parked: the idea is intentionally paused, weak, blocked, or waiting for new evidence.

## When An Idea Gets Chapter Pages

Chapters are earned by content weight, not by heading count. A document is published as chapter pages only when both hold (`PUBLICATION_POLICY` in `packages/worker/src/markdown.ts`):

- at least 3 chapters,
- at least 300 words per chapter on average.

A total-word gate was part of this and has been dropped. At 3 chapters averaging 300 words it was already implied, and it was the half that stopped mattering as documents grew: the idea that first motivated the policy now clears 3,168 words but averages 226 words per chapter. The per-chapter floor is what decides whether a chapter deserves a URL.

Below any of those bars the idea renders as a single page with an in-page table of contents, and chapter deep links `302` to the matching heading anchor.

This gate exists because splitting on `##` alone produced chapters that were not worth a page. Across all 11 published ideas, mean words per chapter ran 38-185, no chapter filled a laptop viewport, and the idea page — which at the time inlined the whole body — already showed 103% of the combined chapter content. Pagination was navigation wrapped around content the reader could already scroll, and it made the argument harder to critique by spreading it across page loads.

An idea crosses the threshold by getting deeper, which usually means promoting research out of contributions and into the canonical document.

## The Chapter Heading Contract

**`#` and `##` both create sibling chapters. `###` does not.**

`sectionRanges()` in `packages/worker/src/markdown.ts` is the single place this rule lives. Chapter listing, section editing and the idea page's lead-in all build on it, so nothing may re-derive "where a chapter starts" with a regex of its own.

The single exception is a `#` that is the very first thing in the document — before any other heading and before any non-blank content — whose slug equals the slug of the idea's own title. That one is the document title, already rendered as the page's `<h1>`, and it is skipped. **Every other `#` becomes a chapter, a peer of every `##`**, including:

- a leading `#` whose text differs from the idea's title,
- a `#` that repeats the title but appears later in the document,
- a leading `#` in a document with no title to compare against.

Two published documents have exactly the first case, and their first chapter *is* that `#`. Any change that stops a non-title `#` being a chapter is a URL-breaking migration for them, not a no-op.

The heading level is read and then discarded: `headingTag()` renders `#` and `##` identically as `<h2>`, and `ideaChapters()` re-emits every chapter as `## Title` whatever level it was written at. That is why `read_idea_section` on a `#`-headed chapter hands back a `##` heading.

The line is trimmed before matching, so **leading whitespace does not protect a heading**: `  ## Heading` and a tab-indented heading are both chapters. Nothing here is fence-aware either — a `## Heading` line inside a fenced code block splits the chapter.

Depth below chapter level belongs in `###` and deeper, which render as in-page anchors rather than URLs. All of this is pinned by tests in `packages/worker/src/markdown.test.ts` under `the chapter heading contract`.

### Writing A Whole File As One Chapter

Because both `#` and `##` split, feeding a research file straight into `patch_idea_section` shatters it: a migration that intended 15 chapters produced 74, and one 1,351-word file became nine chapters. Demoting only the `##` headings — the workaround four separate agents converged on — is wrong by half, since every `#` still splits.

The section-write tools (`add_idea_section`, `patch_idea_section`, `append_to_idea_section`) take `demote_headings: true` for this. It shifts every heading in `content` uniformly, by whatever the **shallowest** heading present requires:

| Shallowest heading in `content` | Shift | Result |
| --- | --- | --- |
| `#` | two levels | `#`→`###`, `##`→`####`, `###`→`#####` |
| `##` | one level | `##`→`###`, `###`→`####` |
| `###` or deeper | none | returned untouched |

The uniform shift keeps the source document's own hierarchy intact. Nothing is pushed past `######`, the deepest heading CommonMark has. The flag is a no-op on content that was already safe, so a bulk migration can set it unconditionally.

Demotion moves exactly the lines `sectionRanges()` would split on — indented headings and headings inside fenced code blocks included. Leaving those behind would leave the chapter split, so the "one chapter" guarantee would not be one.

`markdownHeadings()`, which builds a chapter's in-page table of contents, matches `#{1,6}` for this reason: it has to span every level a demotion can produce, or a demoted file renders correctly and silently loses its navigation. Matching what the renderer emits is also the only range that cannot drift out of agreement with it — `headingTag()` renders and anchors every heading level.

## What The Idea Page Itself Renders

A **single-page** idea renders its whole body inline, with an in-page table of contents.

A **paginated** idea does not. The chapters have their own URLs, so re-rendering them on the index would publish every chapter twice and make the landing page grow without bound as the document deepens — render cost, not storage, is the real ceiling on how large a document can get. The index shows the **lead-in** instead: everything before the first chapter heading, which is where a document's framing lives.

Most documents have no lead-in. `defaultIdeaBody()` and the canonical nine-section spine both open directly on `## Snapshot`, so a template-built document's lead-in is empty. In that case the idea page renders a **chapter summary list** — each chapter's title, linked, with the excerpt already computed for the sidebar — so the landing page always carries readable, indexable prose rather than a summary line and a list of bare titles.

Content before the first `##` is a lead-in, not a chapter. It renders on the idea page and does not get its own URL or a slot in the chapter sequence. Both the lead-in and the chapter list come from the same parser (`sectionRanges()` in `packages/worker/src/markdown.ts`); nothing may re-derive "where the first chapter starts" with a regex of its own, or a heading the two disagree about gets published twice.

## The Research Record Is Paged

Research entries are inlined into the idea page, so the whole record cannot be rendered on every load — one idea already carries 42 entries totalling ~79KB.

The record is paged 20 at a time. Pager links are plain URLs (`?research=2#research`, `?research=all#research`), so a long record is navigable and linkable without JavaScript and each page is crawlable. The section states what it is showing (`Showing 20 of 42 entries`) rather than implying completeness.

`GET /api/ideas/:id/contributions` stays unpaged by default so existing callers keep working; pass `limit` (and optionally `offset`) to page, and the response then carries `total`.

Search links straight to `#contribution-<id>`, which may be on a later page. When the targeted entry is not present the page falls through once to the unpaged view so the anchor resolves; the `research=all` guard stops that looping when the entry is genuinely gone.

## Publishing Model

The store shows a snippet and links into dynamic chapter pages. The FreeIdeaStore Worker reads the canonical Markdown idea document from platform storage, splits `#` and `##` headings into chapter URLs (see The Chapter Heading Contract above), and keeps `###` and deeper as sub-sections inside the chapter.

FreeIdeaStore does not create per-idea GitHub docs, Zensical projects, generated static publication assets, or fallback static pages for free ideas.

Agents should write Markdown through MCP tools such as `create_free_idea`, `add_idea_contribution`, `propose_idea_refinement`, and `publish_idea_update`. They should not upload pre-rendered HTML for publications.

## Zensical Boundary

Zensical is the standard generator for the platform documentation at `/docs/`. Free idea publications intentionally do not use one Zensical instance per idea because that would create too many generated files and too much publishing overhead.
