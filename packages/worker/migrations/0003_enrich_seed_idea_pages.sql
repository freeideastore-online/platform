-- Enrich seed FreeIdeaStore idea pages from the preserved idea-book source.

UPDATE ideas
SET body_md = '## Snapshot

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
- Find legal guidance on financial advice boundaries in Australia.',
    body_key = '',
    render_key = '',
    updated_at = CURRENT_TIMESTAMP
WHERE id = 'asx-filings-analyst';

UPDATE ideas
SET body_md = '## Snapshot

FreeIdeaStore should make product judgment visible. People earn reputation for useful critiques, evidence, pivots, prototypes, and kill signals. The main product is not the raw idea. The main product is the visible history of who made it better.

## Brainstorming Log

- App stores reveal builders after something ships.
- Idea stores can reveal judgment earlier.
- A contributor who repeatedly improves ideas is valuable to founders, investors, and product teams.

## Problem And Customer

Good early-stage contributors are hard to identify. Profiles usually show finished work, not the thinking that shaped it. This system creates a public trail of useful thinking.

## Research Notes

- Badges must reward quality, not volume.
- AI-generated noise is a serious risk.
- The system should make it easier to invite real builders into ProAppStore, ProGameStore, or ProIdeaStore work.

## Design Sketch

Contribution types:

- Risk found.
- Customer sharpened.
- Evidence added.
- Pivot proposed.
- Prototype started.
- Kill reason accepted.
- Pro graduation support.

## Prototype Plan

- Add contribution types to each idea.
- Let reviewers mark a contribution as useful.
- Show contributor badges on profiles.
- Track which contributors helped ideas graduate.

## Validation Plan

The system works if outside people can inspect a profile and quickly understand what kind of thinker or builder the person is.

## Open Questions

- Who judges contribution quality?
- How do we prevent spam and badge farming?
- Should reputation decay, specialize, or transfer across stores?

## Contribution Prompts

- Define the first badge set.
- Design anti-spam rules.
- Propose a review workflow.
- Sketch a contributor profile page.',
    body_key = '',
    render_key = '',
    updated_at = CURRENT_TIMESTAMP
WHERE id = 'idea-reputation-system';

UPDATE ideas
SET body_md = '## Snapshot

A focused community tool for volleyball parents. The first version should help with schedules, team messages, carpool coordination, photos, payments, volunteer jobs, and local club updates without becoming a generic social network.

## Brainstorming Log

- The broad "sports community" idea is too wide.
- Parents have repeated weekly coordination pain.
- Clubs already have fragmented channels: group chats, spreadsheets, emails, and social posts.
- The product wins if it removes admin work for one team before expanding.

## Problem And Customer

The first customer is a parent manager or coach who needs one reliable place for team logistics. The second customer is a club coordinator who wants fewer missed messages and less manual chasing.

## Research Notes

- Trust and adoption matter more than fancy features.
- The best wedge may be team availability and event coordination.
- Clubs may introduce the product if it saves volunteers time.

## Design Sketch

The prototype should open directly into the team hub:

- Upcoming matches and training.
- RSVP status.
- Carpool offers and requests.
- Volunteer roster.
- Team notices.
- Club announcements.

## Prototype Plan

- Build one mobile-friendly team page.
- Add RSVP, carpool, and notices.
- Pilot with one local team for three weeks.
- Measure weekly active parents and messages avoided.

## Validation Plan

The idea is promising if a parent manager keeps using it after the first week and asks to invite more families.

## Open Questions

- Should clubs or parents be the buyer?
- What permissions are needed for child photos and team data?
- Which existing tools are teams already using?

## Contribution Prompts

- Interview parent managers.
- Sketch the team hub information architecture.
- List privacy and permission requirements.
- Find one team willing to pilot.',
    body_key = '',
    render_key = '',
    updated_at = CURRENT_TIMESTAMP
WHERE id = 'parent-volleyball-community';

UPDATE ideas
SET body_md = '## Snapshot

The valuable artifact may not be the idea. It may be the complete opportunity packet: research, market context, prototype, validation, risks, team needs, pitch narrative, and next build plan.

## Brainstorming Log

- Raw ideas are abundant.
- Refined opportunities are scarce.
- ProIdeaStore can sell or broker serious dossiers only if the research quality is high.
- Contributor history should remain attached so people who improved the idea can be recognized or recruited.

## Problem And Customer

Investors, operators, and builders often see vague ideas. They need a clear opportunity with enough work done to decide whether to fund, build, partner, or pass.

## Research Notes

- A pro dossier needs stronger evidence than a free idea page.
- The format should be repeatable across industries.
- Prototype evidence is more persuasive than opinion.

## Design Sketch

A dossier should include:

- Problem and customer.
- Market and competitors.
- Evidence collected.
- Prototype or demo.
- Business model.
- Risks and objections.
- Build plan.
- Pitch deck.
- Contributor history.

## Prototype Plan

- Choose one FreeIdeaStore idea.
- Build the dossier manually.
- Create a simple pitch deck and prototype.
- Show it to three builders and two investors.
- Track whether anyone asks for access, introduction, or build support.

## Validation Plan

The idea is worth building if people are willing to spend meaningful time reviewing the dossier and can name the missing pieces clearly.

## Open Questions

- Which dossiers can be public, private, or paid?
- What rights does a contributor have when their work improves a pro opportunity?
- How should ProIdeaStore price access or engagement?

## Contribution Prompts

- Draft the first dossier template.
- Pick the first candidate idea.
- Define quality gates for graduation.
- Sketch the pitch deck outline.',
    body_key = '',
    render_key = '',
    updated_at = CURRENT_TIMESTAMP
WHERE id = 'proidea-dossier-builder';

UPDATE ideas
SET body_md = '## Snapshot

Parents need reliable transport options for young children, especially when work schedules and school hours do not match. This idea explores whether a trusted local directory and coordination layer could reduce stress without pretending the operational risk is small.

## Brainstorming Log

- The need is real, but trust is the product.
- A marketplace may be too risky as the first version.
- A safer starting point could be information, comparison, checklists, and school-approved options.

## Problem And Customer

The first customer is a parent of a primary-school child who needs after-school pickup help, bus alternatives, or shared transport coordination.

Schools, councils, and existing transport providers are important stakeholders.

## Research Notes

- Liability, child safety, identity verification, and local regulation are major constraints.
- Parents may prefer known families over unknown providers.
- Schools may resist endorsing private transport unless compliance is clear.

## Design Sketch

Start with a trusted options page per school area:

- Public transport routes.
- Walking school bus groups.
- Licensed providers.
- Parent coordination requests.
- Safety checklist.
- School-specific notes.

## Prototype Plan

- Pick one suburb and one school catchment.
- Create a manually researched transport options page.
- Interview 15 parents and 5 administrators.
- Test whether parents ask for coordination features.

## Validation Plan

The idea continues only if parents say the directory is useful and schools confirm that the compliance path is realistic.

## Open Questions

- Can this work without becoming a regulated transport marketplace?
- Who verifies providers?
- What data can be public without creating safety issues?

## Contribution Prompts

- Research local rules and insurance requirements.
- Interview school administrators.
- Map existing transport alternatives.
- Design a trust and verification checklist.',
    body_key = '',
    render_key = '',
    updated_at = CURRENT_TIMESTAMP
WHERE id = 'school-transport-options';

UPDATE ideas
SET body_md = '## Snapshot

A lightweight reset app already exists. The open question is whether people return to it when life becomes noisy, or whether it is only interesting once.

## Brainstorming Log

- The product should not compete with large meditation platforms.
- The useful wedge is an immediate personal reset: pause, name the pressure, choose the next small action.
- Retention matters more than feature count.

## Problem And Customer

The customer is someone who feels overloaded and wants a simple reset ritual without a large wellbeing program.

## Research Notes

- The market is crowded.
- A tiny product can still work if it is fast and specific.
- Monetization is uncertain unless the app becomes part of a broader personal operating system.

## Design Sketch

The core flow:

1. Choose current state.
2. Take a short guided pause.
3. Write one sentence.
4. Pick one next action.
5. Review streaks and patterns lightly.

## Prototype Plan

- Keep the current app minimal.
- Add local analytics for return visits.
- Ask five users what moment made them open it.
- Remove features that do not support a fast reset.

## Validation Plan

The app is worth continuing if users return three or more times in a week without being pushed.

## Open Questions

- Is this a standalone app or a feature inside a bigger personal tool?
- What reminder style is helpful rather than annoying?
- Can the value be explained in one sentence?

## Contribution Prompts

- Test the app for seven days.
- Propose a sharper onboarding flow.
- Find comparable small wellbeing tools.
- Suggest retention metrics that do not reward unhealthy checking.',
    body_key = '',
    render_key = '',
    updated_at = CURRENT_TIMESTAMP
WHERE id = 'slowdown-personal-reset';
