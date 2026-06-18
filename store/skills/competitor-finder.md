# Competitor Finder

## Purpose

Find existing products, services, substitutes, and manual workarounds before the idea is treated as novel.

## When To Use

After an idea is drafted and before serious refinement, promotion, or prototype planning.

## Questions

1. What exact user job does this idea claim to solve?
2. What would the user search for if they wanted this today?
3. Which direct competitors already sell the same promise?
4. Which indirect substitutes solve the problem differently?
5. Which local, manual, or offline workaround is most common?
6. What competitor weakness creates a possible wedge?
7. Which sources prove each competitor exists?

## Output Contract

- Direct competitor list where each named product or company is a Markdown link to its official page when a credible URL is available.
- Indirect substitute or workaround list with source URLs when available.
- Comparison notes: customer, pricing/model, channel, geography, and key weakness.
- One evidence contribution body summarizing what already exists.
- One refinement or pivot recommendation if the idea is not differentiated.

## Suggested MCP Tools

- `get_idea`
- `add_idea_contribution`
- `propose_idea_refinement`

## Rule

This skill is a playbook, not a search engine. The agent must use its own web/source tools to find current competitors, then write source-backed findings back to FreeIdeaStore.

All named products, companies, services, datasets, regulators, and important public sources must be clickable Markdown links on first meaningful mention when a credible URL exists. Do not leave product names as plain text with detached URLs elsewhere.
