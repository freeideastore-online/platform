# Collaboration

FreeIdeaStore should feel alive without becoming noisy.

## Registered User Actions

Registered users can:

- Comment on ideas.
- React with support, trash, or pivot.
- Add evidence, risks, pivots, prototypes, and refinement notes.
- Own ideas.
- Delete their own ideas through soft deletion.

## Public Actions

Signed-out visitors can:

- Browse ideas.
- Read comments.
- Read skills and docs.
- Open public idea publications.

## What Makes Collaboration Useful

Good collaboration names a stronger customer, adds evidence, identifies a kill risk, suggests a cheaper test, or helps turn the idea into a prototype.

## What Should Come Next

- Follow ideas.
- Activity feeds.
- Mentions.
- Moderation/reporting.
- Contributor badges.
- Threaded replies.
- Notifications.
- Requests for specific help on each idea.

## Research Entries Carry Provenance

A contribution's prose `body` is still the narrative, but the parts that need to be queried, cited and corrected are typed fields:

- **`claim`** — the assertion in one line. It becomes the entry headline and can be cited on its own.
- **`source_url`** and **`accessed_at`** — what backs the claim, and when it was checked. Research decays; record when it was true.
- **`provenance`** — `extracted`, `derived`, `inferred`, `human-asserted`, or `confirmed`. This decides how the entry is displayed: an inferred claim must not read like a confirmed one.
- **`confidence`** — `low`, `medium`, `high`.
- **`supersedes`** — the id of the entry this one corrects.

All are optional; a plain comment supplies none of them.

**Corrections supersede rather than pile up.** When an entry supersedes another, the older one stays readable and is marked as corrected, with a link to the entry that replaced it. The record should show what was believed and what replaced it, not present two contradictory claims as equal peers.

Values outside the vocabulary are rejected, a `source_url` must be `http(s)`, `accessed_at` must be `YYYY-MM-DD`, and `supersedes` must reference an existing entry on the same idea — an unresolvable link would silently orphan the correction.

## Refinements Are A Queue, Not A Comment

`propose_idea_refinement` deliberately does not touch the canonical document. Without somewhere to track that decision, proposals simply accumulated: the gapfill idea carried four unpublished refinements while holding 2.8x more research outside the document than in it.

A refinement now has queue state — open, `applied`, `rejected`, or `superseded` — and names its target section as a field rather than in prose.

`section` is a **real section id** from `list_idea_sections`, validated when the proposal is recorded. It used to be a fixed vocabulary of document aspects (`design`, `prototype`, `signal`…), which mostly did not correspond to any section the document actually had — on one idea only 1 of 5 queued proposals named a section that existed, so the rest could never have been applied. Validating at propose time means a proposal that cannot be applied is never accepted. Proposals may still omit the section entirely and be routed at apply time.

- `list_pending_refinements` — what is waiting, with the target section and the extracted proposal text.
- `apply_refinement` — merge it into the target section and close it. Pass `content` to control the exact wording; without it the proposal text is appended verbatim, which is at least honestly what the proposer wrote. `mode` chooses append (default) or replace.
- `resolve_refinement` — close without merging, recording why. A reason is required.

The idea page shows an **Awaiting merge** count in the Signals rail, and each proposal carries an *awaiting merge* or resolved badge. An invisible queue never drains.

Two rules keep the record trustworthy. Applying goes through `apply_refinement` only, so a merge is always tied to the revision it produced — `resolve_refinement` rejects `applied` for that reason. And a refinement can only be resolved once; a second attempt returns 409 rather than double-applying.
