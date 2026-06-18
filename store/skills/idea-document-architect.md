# Idea Document Architect

## Purpose

Turn the user's first prompt or short interview answers into a coherent generic FreeIdeaStore public idea document.

## When To Use

Before `create_free_idea`, after the agent has enough context to produce a useful first page without inventing facts.

## Target First Document

The first public idea page should be short, readable, and complete enough for strangers to help.

1. Overview: snapshot, current thesis, status, and why it deserves attention.
2. People And Problem: first user or buyer, problem moment, current workaround, and urgency or frequency.
3. Context And Evidence: existing alternatives, competitors or substitutes, source trail, and unknowns.
4. Proposed Solution: core promise, user workflow, smallest useful version, and out of scope.
5. Risks And Constraints: trust and safety, legal or regulatory constraints, operational or technical constraints, and kill signals.
6. Validation: riskiest assumption, cheapest test, success threshold, and pivot or trash criteria.
7. Prototype Or Pilot: demo or pilot, required resources, manual or fakeable parts, and what must be real.
8. Model And Distribution: sustainability model, pricing or funding hypothesis, channels, and partnerships.
9. Evolution: open questions, contribution prompts, next decisions, and ProIdeaStore readiness.

Use these as `##` top-level sections. Use the listed items as `###` sub-sections when the idea has enough substance. For a raw first page, keep empty sections out rather than pretending evidence exists.

## Output Contract

- `title`: short, specific, and not hype-heavy.
- `summary`: one paragraph for cards and listings.
- `stage`: usually `raw`, unless evidence already exists.
- `category`: one useful category tag.
- `signal`: one sentence describing why it deserves attention.
- `next_step`: one cheap action.
- `risk`: one visible risk.
- `body`: markdown using the universal 2-level spine when the idea has enough substance, with named products, companies, services, datasets, regulators, and important public sources linked when credible URLs are known.

## Suggested MCP Tools

- `create_free_idea`
- `add_idea_contribution`

## Rule

The first document is not a pitch deck. It is a public working page that makes the idea easy to critique, improve, or trash.

If a product, service, company, dataset, regulator, or public source is mentioned, make its first meaningful mention a clickable Markdown link when a credible URL exists.
