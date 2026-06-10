---
title: ASX Filings Analyst
summary: A weekly public-data research assistant that reads ASX reports and flags companies that may deserve attention.
stage: researched
category: finance
---

# ASX Filings Analyst

## Snapshot

A research screener for Australian public companies. It reads public ASX announcements, annual reports, half-year reports, investor presentations, and company updates, then produces a weekly watchlist of stocks that may be undervalued.

This is not financial advice and should not tell people to buy. The useful product is source-backed attention: what changed, why it matters, what looks cheap, and what must be checked by a human.

## Brainstorming Log

- The original question was whether an app could analyze public Australian market information and suggest undervalued stocks each week.
- The strongest version is not a magic stock picker. It is a disciplined evidence collector.
- A good weekly output should explain the valuation signal, the business quality signal, the risk signal, and the exact public source used.

## Problem And Customer

Retail investors do not have time to read every ASX announcement. They want a small set of companies worth investigating, with links back to filings and a clear explanation of uncertainty.

The first customer is a careful DIY investor who already reads reports but wants help narrowing the field.

## Research Notes

- Public sources include ASX announcements, company annual reports, quarterly activity reports, investor presentations, and governance disclosures.
- Inputs should be traceable and timestamped.
- The app must separate factual extraction from interpretation.
- Market data licensing, delayed pricing, and financial advice rules are the main risk areas.

## Design Sketch

The first workflow is simple:

1. Ingest public filings and reports.
2. Extract revenue, margins, debt, cash flow, management commentary, and guidance changes.
3. Compare valuation ranges against sector peers.
4. Generate a weekly watchlist with citations.
5. Let human reviewers mark useful, weak, or risky signals.

## Prototype Plan

- Start with a manual weekly report covering 20 ASX companies.
- Use public filings only.
- Score each company on valuation, balance sheet, growth, quality, and uncertainty.
- Publish a source-linked watchlist page.
- Ask 10 Australian retail investors whether it saves research time.

## Validation Plan

Success is not "did it pick winners." Success is whether users return weekly, trust the citations, and find companies they would not have noticed otherwise.

## Open Questions

- Which public market data can be used without licensing problems?
- Should this be a consumer product, a research newsletter, or a tool for investment clubs?
- How should disclaimers, suitability, and advice boundaries be handled?

## Contribution Prompts

- Add examples of excellent ASX company reports.
- Map competitors and newsletters already serving Australian retail investors.
- Define a valuation score that is transparent and conservative.
- Find legal guidance on financial advice boundaries in Australia.
