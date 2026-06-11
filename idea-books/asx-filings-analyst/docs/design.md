---
title: Design Sketch
summary: A weekly public-data research assistant that reads ASX reports and flags companies that may deserve attention.
---

# Design Sketch

The first workflow is simple:

1. Ingest public filings and reports.
2. Extract revenue, margins, debt, cash flow, management commentary, and guidance changes.
3. Compare valuation ranges against sector peers.
4. Generate a weekly watchlist with citations.
5. Let human reviewers mark useful, weak, or risky signals.

The weekly page should show each company with:

- valuation signal: P/E, forward P/E, EV/EBITDA, price/book, dividend yield, free cash flow yield;
- quality signal: ROE, ROIC, debt/equity, interest cover, margin trend;
- growth signal: revenue growth, EPS growth, guidance changes;
- market signal: three-month and six-month performance, drawdown, volume;
- risk flags: low liquidity, negative earnings, high debt, cash burn, capital raises, commodity exposure, customer concentration;
- source links: ASX announcements, annual reports, half-year reports, investor presentations.

Scoring should be deterministic first. AI can explain the results, but it should not invent them.

Suggested score ingredients:

- add points for valuation discount versus sector peers;
- add points for strong free cash flow yield;
- add points for manageable debt;
- add points for stable or improving margins;
- subtract points for sharp revenue decline;
- subtract points for poor liquidity;
- subtract points for negative earnings plus high cash burn.

The interface should never treat "cheap" as automatically "good".
