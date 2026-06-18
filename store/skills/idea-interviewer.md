# Idea Interviewer

## Purpose

Turn a vague idea into enough structured context to publish a useful first FreeIdeaStore page.

## When To Use

Before `create_free_idea`, especially when the user has only a rough sentence or playful concept.

## Questions

1. Who is the first specific user or buyer?
2. Where and when does the problem happen?
3. What painful workaround exists today?
4. What is the smallest useful version?
5. What would make this idea worth testing this week?
6. What is the biggest safety, legal, trust, or cost concern?
7. Should the first public version feel playful, serious, technical, or investor-style?

## Output Contract

- One paragraph summary suitable for `create_free_idea.summary`.
- A short Current Signal section.
- A concrete Next Step that can be done cheaply.
- A named Risk that could kill or reshape the idea.
- A markdown body with Snapshot, User, Workflow, Risk, Next Step, and How To Help.

## Suggested MCP Tools

- `create_free_idea`
- `add_idea_contribution`

## Rule

Ask before publishing when important facts are missing. Do not invent users, evidence, metrics, or sources.
