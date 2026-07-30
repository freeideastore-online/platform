# Idea Pages

An idea page is the cheap public surface for an idea.

## One Page By Default

Most free ideas should start as one page because many will be playful, weak, duplicated, or not worth operational overhead.

One page is enough when:

- The idea is raw.
- There is no research yet.
- The audience only needs a quick snapshot.
- The next action is a simple comment, reaction, or validation question.

## What Appears On An Idea Page

- Canonical idea body.
- Stage, category, and pro-candidate signal.
- Reaction counts.
- Comments.
- Contribution count.
- Next step and risk.
- Links to dynamic publication chapters when the canonical Markdown has headings.

## Markdown Support

Idea bodies are CommonMark, rendered by `markdown-it` in the Worker. Headings, paragraphs, lists, emphasis (`*italic*` and `**bold**`), inline `code`, fenced code blocks, blockquotes, tables, horizontal rules, strikethrough, links, and images all render.

Two deliberate deviations from strict CommonMark:

- **A single newline is a line break.** Idea bodies were originally written under a renderer where every line became its own paragraph. Strict CommonMark would merge those into run-on paragraphs, so `breaks: true` keeps the authored line structure.
- **Headings collapse.** `#` and `##` both render as `<h2>`, anything deeper as `<h3>`. Heading ids come from `slug()` on the raw heading text, and `markdownHeadings()` derives the table of contents the same way — the two must stay in agreement or in-page anchors break.

Untrusted-input rules, since bodies are written by agents and contributors:

- **Raw HTML is escaped, not rendered** (`html: false`). Pasting `<script>` into an idea body puts visible text on the page, never markup.
- **Only `http(s)` links render.** `javascript:` and `data:` URLs are left as plain text.
- **Images must be `https`**; anything else degrades to its alt text.

## Sources Are Registered, Not Just Linked

Every http(s) link in a canonical document or a research entry is registered as a source, so an idea page can answer what it rests on.

- **Deduped by normalised URL.** The same page cited as `?utm_source=…`, with a `#fragment`, or with a different host case is one source. Normalisation is deliberately conservative — it does not touch path case or meaningful query strings, because guessing there would merge genuinely different pages.
- **Citations record where.** A source lists the document sections that cite it and how many research entries do, and `/api/sources/:id` answers the reverse: every idea citing it.
- **Document links are re-indexed on every canonical write**, so a link removed from the document stops being listed. Contribution citations are not: a research entry is a historical record and keeps its sources.
- **A nightly job checks link health**, least-recently-checked first. A source that fails is marked unreachable on the page. Otherwise a citation that 404s still reads as evidence.

## When To Update The Canonical Page

Use comments and contributions for discussion. Use a canonical page update only when the owner wants to merge stronger wording, evidence, or decisions into the public document.
