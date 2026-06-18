# Idea Flow Orchestrator

## Purpose

Choose the right next skill and publishing action for an idea based on how much the user has provided.

## When To Use

At the start of an agent session, after a user asks to create, improve, research, pivot, or promote an idea.

## Flow

1. Classify the input as raw sentence, answered intake, existing idea update, research request, critique request, validation request, prototype request, pivot request, or pro-candidate request.
2. If the input is a raw sentence, use Idea Interviewer and ask only the minimum missing questions.
3. If enough context exists, use Idea Document Architect before `create_free_idea`.
4. If the idea already exists, read it with `get_idea` before changing anything.
5. For serious canonical updates, shape the document into the universal 2-level spine.
6. Add uncertain work as contributions. Publish canonical changes only with owner approval.
7. Keep the next step cheap, concrete, and visible.

## Minimum First-Prompt Questions

Ask at most four questions before the first publish unless safety or legality is unclear:

1. Who is the first specific user?
2. Where or when does the problem happen?
3. What is the smallest version worth testing?
4. What is the biggest risk or reason this could fail?

## Output Contract

- Recommended next skill.
- Whether to ask questions, create a new idea, add a contribution, or publish an owner-approved update.
- Missing fields that block a coherent public page.
- A short tool plan using available FIS MCP tools.

## Suggested MCP Tools

- `list_idea_skills`
- `get_idea_skill`
- `apply_idea_skill`
- `get_idea`
- `create_free_idea`
- `add_idea_contribution`
- `publish_idea_update`

## Rule

Do not let the agent wander. Every session should end with one of: created idea, added contribution, published owner-approved refinement, or named blocker.

Before publishing or updating an idea, check that named products, companies, services, datasets, regulators, and important public sources are clickable Markdown links when credible URLs are known.
