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

Chapters are earned by content weight, not by heading count. A document is published as chapter pages only when all three hold (`PUBLICATION_POLICY` in `packages/worker/src/markdown.ts`):

- at least 2000 words in total,
- at least 3 chapters,
- at least 300 words per chapter on average.

Below any of those bars the idea renders as a single page with an in-page table of contents, and chapter deep links `302` to the matching heading anchor.

This gate exists because splitting on `##` alone produced chapters that were not worth a page. Across all 11 published ideas, mean words per chapter ran 38-185, no chapter filled a laptop viewport, and the idea page — which renders the whole body inline — already showed 103% of the combined chapter content. Pagination was navigation wrapped around content the reader could already scroll, and it made the argument harder to critique by spreading it across page loads.

An idea crosses the threshold by getting deeper, which usually means promoting research out of contributions and into the canonical document.

Content before the first `##` is a lead-in, not a chapter. It renders on the idea page and does not get its own URL or a slot in the chapter sequence.

## Publishing Model

The store shows a snippet and links into dynamic chapter pages. The FreeIdeaStore Worker reads the canonical Markdown idea document from platform storage, splits `##` headings into chapter URLs, and keeps `###` headings as sub-sections inside the chapter.

FreeIdeaStore does not create per-idea GitHub docs, Zensical projects, generated static publication assets, or fallback static pages for free ideas.

Agents should write Markdown through MCP tools such as `create_free_idea`, `add_idea_contribution`, `propose_idea_refinement`, and `publish_idea_update`. They should not upload pre-rendered HTML for publications.

## Zensical Boundary

Zensical is the standard generator for the platform documentation at `/docs/`. Free idea publications intentionally do not use one Zensical instance per idea because that would create too many generated files and too much publishing overhead.
