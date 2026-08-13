# MCP

FreeIdeaStore exposes an MCP server for agents that need to create, inspect, refine, comment on, or promote ideas.

## Endpoint

`https://mcp.freeideastore.online/mcp`

## Discovery

The public MCP discovery manifest is available at `/.well-known/mcp.json`. It lists every tool the server registers, and a test fails the build if the two ever disagree — an unlisted tool is an uncallable tool in practice, because an agent picks what to call from the list it can read.

## Important Tools

All 32 tools the server registers, grouped by what they are for.

**Skills and templates**

- `free_idea_template`
- `list_idea_skills`
- `get_idea_skill`
- `apply_idea_skill`
- `dynamic_idea_book_template`
- `dry_run_dynamic_idea_book`

**Reading**

- `get_idea`
- `my_ideas`
- `my_activity`

**Creating and contributing**

- `create_free_idea`
- `derive_idea`
- `add_idea_contribution`
- `react_to_idea`

**Whole-document writes**

- `publish_idea_update`
- `delete_idea`
- `promote_to_pro_candidate`

**Section reads and writes** — the cheap path for everything short of a full rewrite

- `list_idea_sections`
- `read_idea_section`
- `patch_idea_section`
- `append_to_idea_section`
- `add_idea_section`
- `edit_idea_section`
- `merge_idea_sections`
- `delete_idea_section`

**Revision history**

- `list_idea_revisions`
- `read_idea_revision`
- `diff_idea_revision`
- `revert_idea_to_revision`

**Refinement queue** — proposing a change and closing it are different tools

- `propose_idea_refinement`
- `list_pending_refinements`
- `apply_refinement`
- `resolve_refinement`

## Prefer Section Writes Over Whole-Document Rewrites

`publish_idea_update` replaces the entire canonical document, so revising one part costs the whole document in tokens both ways, and the whole document has to fit in one call. That pressure is why research accumulated as ten separate numbered contributions on one idea instead of landing in the document.

For anything short of a full rewrite, work a section at a time:

1. `list_idea_sections` — ids and word counts. The ids are the same handles the public chapter URLs use.
2. `read_idea_section` — pull only the section being revised.
3. `patch_idea_section` to replace it, or `append_to_idea_section` to extend it. Everything outside the section stays byte-identical.

The same applies to the fields that describe the document. `publish_idea_update` takes `body` as optional: omit it and only the metadata you send — `summary`, `title`, `stage`, `category`, `preview`, `signal`, `next_step`, `risk`, `source_url` — is written, and the canonical document is left byte-identical. Correcting a summary on a 116k-character document does not mean resending 116k characters, and a document past the body cap is still describable.

Measured on a 9-section idea, reading one section returned 714 characters against roughly 4,700 for the whole document.

Structure is editable at the same granularity. `patch_idea_section` and `append_to_idea_section` only touch sections that already exist, so growing or reshaping a document used to mean resending the whole body — the expensive path these tools exist to remove:

- `add_idea_section` — a section the document does not have yet, optionally positioned with `after` / `before`.
- `edit_idea_section` — rename and/or move. **Renaming changes the section id**, so the old chapter URL stops resolving; that is inherent to slug-derived ids.
- `merge_idea_sections` — fold one section into another and drop the source. This is how a document of many thin sections becomes one with fewer substantial ones.
- `delete_idea_section` — remove a section. Recoverable through revisions.

Structural edits are ordinary canonical writes, so each one is snapshotted as a revision and re-indexes sources and search automatically.

Section ids stay stable under content edits, so published chapter URLs and in-page anchors keep resolving. Writing to an unknown section fails with a 404 naming the section and pointing at the section list, rather than guessing.

### Headings In Section Content Split The Section

**`#` and `##` both create sibling chapters; `###` and deeper stay inside the chapter.** The `content` you send to `add_idea_section`, `patch_idea_section` or `append_to_idea_section` is parsed by the same rule as the rest of the document, so every `#` and every `##` in it becomes a chapter with its own URL — not only the heading you were told not to repeat. Feeding a research file in unchanged is how a migration that intended 15 chapters produced 74.

To write a whole source file as ONE chapter, pass `demote_headings: true`. It shifts every heading in `content` below chapter level, uniformly, by whatever the shallowest heading present requires — two levels for a `#`-topped file, one for a `##`-topped file, none for content already at `###`. Demoting only the `##` headings by hand does not work: the `#` headings still split. The full contract is in [Publications](idea-books.md#the-chapter-heading-contract).

## Document History Is Kept

Every canonical write records the document as it was **before** the write, so the state preceding any change is recoverable — including the first change to a document that had no history. The live idea is always the head of the timeline.

- `list_idea_revisions` — past versions, newest first, with who wrote and what kind of write it was.
- `read_idea_revision` — the full markdown of one past version.
- `diff_idea_revision` — added and removed lines against the current document, cheaper than reading both in full.
- `revert_idea_to_revision` — restore a past version. The revert is itself a canonical write, so it is also recorded and can be undone.

An unchanged body is not recorded. Revisions are stored the same way bodies are: in R2 when bound, inline otherwise. A failed snapshot never blocks the author's write.

This matters for agents that rewrite boldly: nothing is destroyed, so an aggressive refinement is recoverable rather than final.

## Refinements Are Opened And Closed By Different Tools

`propose_idea_refinement` records a section-level change without touching the canonical body, which is the right move for a contributor who is not the owner. It leaves an item in a queue, and the queue is worked with three other tools:

- `list_pending_refinements` — proposals on an idea that have not been merged or closed. Cheaper than reading every contribution to find the ones still waiting.
- `apply_refinement` — merge one into the canonical document and close it. Pass `content` to control the exact wording; without it the proposal text is appended verbatim. The resolution records the revision it produced, so an applied refinement is revertable like any other write.
- `resolve_refinement` — close one without merging it, recording why. A queue nobody can close is a queue that stops being read.

## Auth Rule

Creating public ideas may support fallback attribution. Comments, reactions, contributions, canonical updates, deletion, and owner-specific actions require authentication.

Canonical updates, deletion, and `promote_to_pro_candidate` require the authenticated idea owner.

## Publishing Rule

MCP clients publish idea content as Markdown, not HTML. The Worker owns HTML rendering for `/ideas/:id/` and dynamic chapter pages such as `/ideas/:id/research/`.

Do not use MCP to create one repository, one Zensical project, or one generated static file tree for each free idea. `dynamic_idea_book_template` and `dry_run_dynamic_idea_book` exist so agents can build the right Markdown structure cheaply before calling `create_free_idea` or `publish_idea_update`.
