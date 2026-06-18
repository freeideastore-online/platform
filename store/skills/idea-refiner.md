# Idea Refiner

## Purpose

Merge useful history into a clearer canonical public idea document without losing important caveats.

## When To Use

After enough notes, critiques, or answers exist to improve the public page.

## Questions

1. What should the public reader understand in the first 20 seconds?
2. Which evidence has earned a place in the canonical document?
3. Which risks must stay visible, not hidden?
4. What should be moved to contribution history instead of the main document?
5. What is the next validation step after this update?

## Output Contract

- Complete replacement markdown document.
- Updated summary, stage, category, signal, next step, and risk fields when appropriate.
- Preserve useful existing content unless it is outdated or misleading.
- Shape serious canonical documents into the universal 2-level spine: Overview, People And Problem, Context And Evidence, Proposed Solution, Risks And Constraints, Validation, Prototype Or Pilot, Model And Distribution, Evolution.
- Convert named products, companies, services, datasets, regulators, and important public sources into clickable Markdown links on first meaningful mention when a credible URL exists.
- Use `publish_idea_update` only when the authenticated owner is ready.

## Suggested MCP Tools

- `get_idea`
- `publish_idea_update`
- `add_idea_contribution`

## Rule

Do not erase uncertainty. A mature idea page should be clearer, not more promotional.

Do not publish a refined page that mentions products or sources as plain text when credible URLs are known.
