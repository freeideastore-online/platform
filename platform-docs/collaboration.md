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
