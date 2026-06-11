-- Publish the richer meetup research notes into the live FreeIdeaStore idea pages.

UPDATE ideas
SET
  summary = 'Public reports, valuation screens, source-backed weekly watchlist.',
  preview = 'A citation-first ASX research assistant that reads public filings and builds a weekly undervaluation watchlist.',
  signal = 'Validate with 10 to 20 Australian retail investors using a manual weekly report.',
  body_md = '## Snapshot

A public-source research assistant for Australian listed companies. It reads ASX announcements, annual reports, half-year reports, investor presentations, quarterly activity reports, and company-published financial statements, then produces a weekly watchlist of companies that may deserve investor attention.

The product should be positioned as research support, not financial advice. It should not tell people what to buy.

The strongest version is a public-source, citation-first ASX research assistant that reads company reports and ASX announcements, explains valuation signals transparently, and creates a weekly research watchlist.

## Core Concept

The weekly output should help answer:

- What changed this week?
- Which ASX companies look cheap relative to their fundamentals?
- Which companies look cheap but may be value traps?
- What public source supports each claim?
- What should a human research before considering an investment?

The useful product is source-backed attention: what changed, why it matters, what looks cheap, what looks risky, and what must be checked by a human.

## Existing Competitors

Versions of this already exist in Australia. A plain undervalued-stock screener is not novel.

Competitors and substitutes include:

- Simply Wall St for ASX screeners, fair value estimates, company reports, and portfolio tools.
- Morningstar Australia for stock research, fair value analysis, ratings, and undervalued stock lists.
- Market Index for ASX stock screeners, valuation filters, scans, and company data.
- Stock Doctor for ASX research, financial health ratings, quantitative analysis, and portfolio tools.
- Intelligent Investor for ASX research, recommendations, weekly reviews, and buy or hold views.
- Investing.com AU for broad screener filters across valuation, dividends, growth, risk, and technicals.

Because of this, another generic cheap-stocks list is weak. The gap is trustworthy explanation, source tracing, and workflow.

## Differentiation

A differentiated app should focus on:

- reading ASX announcements and company reports;
- extracting financial facts from source documents;
- linking every important claim back to a source;
- explaining why a company appeared on the watchlist;
- showing the counterargument and risk flags;
- tracking what changed since the last report;
- helping the user save, dismiss, tag, and annotate companies.

This is more defensible than ranking companies by P/E or black-box fair value output.

## MVP Scope

Start narrow:

- cover ASX 200 or ASX 300 only;
- ingest public ASX announcements and company reports;
- track basic price and valuation data from a licensed or user-provided source;
- produce one weekly watchlist;
- include citations for every important claim;
- show both bullish and bearish reasons;
- let users save, dismiss, tag, and write notes on stocks.

Do not start with:

- real-time trading signals;
- buy or sell recommendations;
- full portfolio management;
- complex AI forecasts;
- every ASX-listed microcap.

## Weekly Watchlist Design

Each company should include:

- valuation signal: P/E, forward P/E, EV/EBITDA, price/book, dividend yield, free cash flow yield;
- quality signal: ROE, ROIC, debt/equity, interest cover, margin trend;
- growth signal: revenue growth, EPS growth, guidance changes;
- market signal: three-month and six-month performance, drawdown, volume;
- risk flags: low liquidity, negative earnings, high debt, cash burn, capital raises, commodity exposure, customer concentration;
- source links: ASX announcements, annual reports, half-year reports, investor presentations.

## Scoring Approach

Use deterministic scoring first. AI should explain the results, not invent them.

Suggested score ingredients:

- add points if valuation is cheap relative to sector peers;
- add points if free cash flow yield is strong;
- add points if debt is manageable;
- add points if margins or earnings are stable or improving;
- subtract points if revenue is declining sharply;
- subtract points if liquidity is poor;
- subtract points if earnings are negative and cash burn is high.

The app must avoid treating cheap as automatically good.

## Data And Licensing

Data access is a major constraint. ASX real-time and delayed market data can have licensing requirements if redistributed. For an MVP, avoid becoming a market-data vendor.

Practical options:

- use user-provided CSVs;
- use a licensed market-data API;
- focus on end-of-day data;
- focus the unique value on public reports, announcements, and source-backed explanations.

## Main Risks

- Existing competitors already cover generic screening.
- Market data licensing can become expensive or restrictive.
- Investment tools require high trust.
- The product can drift into regulated financial advice if it gives personalized buy recommendations.
- Users may not pay unless the output saves real time or produces clearly better research.
- AI hallucination risk is serious if financial claims are not source-backed.

## Validation Plan

1. Manually create a weekly ASX watchlist for four weeks using public reports and basic financial data.
2. Share it with 10 to 20 Australian retail investors.
3. Ask whether they would pay, what they distrust, and what saved them time.
4. Measure whether users come back the next week.
5. Only build software after confirming that the weekly research workflow is valuable.

Strong signals:

- users ask for the next report;
- users forward it to others;
- users say it saved research time;
- users are willing to pay before the full app exists.

## Simple Explanation

Apps like this already exist in Australia, so making another simple cheap-stocks list is probably not special. A better helper would read company reports and ASX news, then say: this company might be interesting, here are the numbers, here is where they came from, and here are the things to be careful about. It should be a smart homework helper for stocks, not a robot telling people what to buy.

## How To Help

- Add examples of excellent ASX company reports.
- Map Australian competitors and newsletters.
- Define a transparent conservative valuation score.
- Find guidance on financial advice boundaries in Australia.
- Test one manual report with real Australian retail investors.',
  body_key = '',
  render_key = '',
  next_step = 'Validate with 10 to 20 Australian retail investors using a manual weekly report.',
  risk = 'Market data licensing, trust, AI hallucination, and accidental financial advice.',
  updated_at = CURRENT_TIMESTAMP
WHERE id = 'asx-filings-analyst';

UPDATE ideas
SET
  summary = 'A lightweight local family-circle idea for a Saturday volleyball and playground ritual.',
  preview = 'Parents play volleyball while kids play nearby; the product opportunity is family memory, private photos, birthdays, and warm attendance appreciation.',
  signal = 'Run BAND or Spond for six to eight Saturdays before building anything custom.',
  body_md = '## Snapshot

A weekly Saturday meetup where parents play volleyball while kids play nearby can become a lightweight local community circle. The app idea is to help people get acquainted, remember families, share photos privately, track birthdays, and appreciate regular attendance.

The valuable thing is not just volleyball scheduling. The valuable thing is the recurring local ritual: parents have an easy reason to meet, kids have a familiar play environment, and newcomers can join without needing an existing friendship group.

Verdict: promising community behavior, but not yet a custom app. Test existing tools first.

## Original Situation

A group of parents meet around a playground and volleyball area. Some parents already know each other, but many do not. New people join casually.

The group wants to:

- keep basic member information;
- share photos within the trusted circle;
- remember birthdays of parents and children;
- get reminders for birthdays and weekly meetups;
- recognize people who come regularly, such as three Saturdays in a row;
- keep the activity informal, friendly, and family-oriented.

## Existing Apps To Try

BAND is the best immediate choice. It fits casual parent community use because it supports private groups, posts, albums, calendar events, RSVP-style coordination, reminders, and birthdays or special occasions.

Spond is best if the group becomes more sport-focused. It is stronger for recurring sports sessions, RSVP tracking, attendance history, payments, roles, and parent or guardian workflows.

Stack Team App is a structured club option with events, RSVP, attendance tracking, galleries, access groups, and parent/child member handling.

Klubraum is a privacy-first club/community option with calendar, chat, attendance, and member management.

TeamSnap, InstaTeam, sportsYou, TeamReach, and GroupMe cover parts of the workflow, but each is either more formal, more sports-oriented, or too light for birthdays and family memory.

## Why WhatsApp Is Not Enough

WhatsApp is useful for quick chat, but weak for this idea because:

- birthdays are not stored as structured group data;
- photos disappear into chat history;
- albums are not organized around events or families;
- attendance history is not tracked;
- repeated participation cannot easily be recognized;
- new members cannot quickly understand who is who;
- child photo consent is hard to manage.

## Real Product Gap

Most existing apps can do events, chat, and photos. The unmet gap is more specific:

- family profiles instead of individual-only profiles;
- parent and child birthdays in one safe place;
- child photo consent and private sharing rules;
- memory of who attended regularly;
- warm appreciation for repeated participation;
- lightweight onboarding for new families;
- a friendly local-circle feeling, not a formal sports team.

The possible app is not another group chat. It is a family-aware local community memory tool.

## Manual MVP

Do not build a full app first.

Run the group for six to eight Saturdays using BAND or Spond.

Use BAND if the group is mainly social and family/community oriented. Use Spond if volleyball becomes the main identity and attendance tracking matters most.

Manual setup:

- private group;
- QR code invite at the park;
- recurring Saturday event;
- RSVP or check-in;
- monthly photo albums;
- family profiles;
- birthday list for parents and children;
- clear photo consent rule;
- manual appreciation posts for regular attendance.

## Validation Plan

Test 1: run with existing tools for eight Saturdays.

Success threshold:

- 25 or more families join;
- at least 60 percent of regulars RSVP or check in;
- photos are shared more than once;
- birthday reminders are used or appreciated;
- new families continue returning.

Test 2: interview 10 parents.

Ask:

- What would you miss if the group app disappeared?
- Do you remember more families because of it?
- Are birthday reminders useful or awkward?
- Are you comfortable with shared child photos?
- Would you invite another family?
- What feels clumsy in the current app?

Strong signal: parents say the app helps them remember people, feel included, and trust the group.

Weak signal: parents only use it for basic chat or ignore it.

## Privacy And Safety

This idea involves children, so privacy matters.

Important rules:

- group should be invite-only or approval-only;
- child photos should not be public;
- families should choose whether their children can appear in shared photos;
- birthday data should avoid full birth years unless necessary;
- members should be able to remove photos or leave the circle;
- admins should have clear rules for who can join.

Recommended birthday format:

- parent: name plus day/month;
- child: first name plus day/month plus optional age range;
- avoid storing exact full date of birth unless there is a strong reason.

## Business Assessment

Promising as a community ritual, weak as a standalone app business until demand is proven.

Strongest case:

- informal family communities are common;
- parents often want local friendships but need low-pressure ways to meet;
- existing sports apps feel too formal;
- chat apps are poor at memory, birthdays, and consent;
- a weekly recurring habit could create retention.

Biggest risks:

- existing apps are good enough;
- parents may resist another app;
- willingness to pay may be low;
- privacy expectations around kids photos are high;
- group organizers may not want admin responsibility.

## How To Help

- Set up the Saturday group in BAND and document what works.
- Compare the same workflow in Spond.
- Interview 10 parents after a few weeks.
- Write the photo consent and child data rules.
- Find another informal family group with the same problem.',
  body_key = '',
  render_key = '',
  next_step = 'Run BAND or Spond for six to eight Saturdays and measure family participation.',
  risk = 'Existing apps may be good enough, privacy expectations around children are high, and willingness to pay may be low.',
  updated_at = CURRENT_TIMESTAMP
WHERE id = 'parent-volleyball-community';

UPDATE ideas
SET
  summary = 'Safe school transport options for Australian children aged 5 to 10.',
  preview = 'A trusted guide to school-run transport, child-focused rideshare, scheduled child taxis, and nanny pickup options.',
  signal = 'Build one suburb-specific verified guide before considering a marketplace.',
  body_md = '## Snapshot

Parents need reliable transport options for young children, especially when work schedules and school hours do not match. For children aged 5 to 10 in Australia, there does not appear to be a universal on-demand "Uber for primary-school kids" available everywhere.

The most relevant options are school-run transport platforms, child-focused rideshare services, scheduled child taxi services, and verified nanny or babysitter pickup services.

The product idea is not to casually copy rideshare. The safer wedge is a verified local guide, comparison, booking-assistance, and coordination layer that helps parents understand what is actually available in their suburb and what safety constraints apply.

## Best-Fit Options

StudentRide can be relevant when the school already runs a StudentRide-managed bus or transport service. It is not a direct parent-booked rideshare app for any family. Access depends on whether the school has a StudentRide route or is willing to set one up. The ACC Marsden Park StudentRide page explicitly references primary-school students and says primary students must be met face-to-face at the bus stop by a parent, caregiver, guardian, or secondary-school sibling.

Shebah is probably the closest fit for younger children needing rides outside a school bus route. It is an Australian rideshare service with women drivers. Public material says drivers have Police Checks and Working with Children Checks, unaccompanied minors can be transported, and child seats or booster seats can be requested. Availability may vary by area, so recurring pre-booked rides are more realistic than last-minute demand.

Kabs4Kids is a scheduled child/student ride service listed for Sydney and Melbourne. The App Store listing says rides must be booked in advance, parents can track the ride, and drivers are police checked and Working With Children certified. Caveat: the public app listing appears old, so availability should be verified directly before relying on it.

Kiddo is not a transport company, but it can be used to book verified babysitters or nannies for school pickup and drop-off. This may fit families that need collection, supervision, and handover, not just transport.

## Not A Fit

Uber for Teens is not relevant for children aged 5 to 10. It is for teenagers aged 13 to 17.

Uber standard policy says riders under 18 must be accompanied by an adult unless the ride is through Uber for Teens.

## Child Seat And Safety

For children aged 5 to 10, child restraint rules matter.

Raising Children Network notes that in most Australian states and territories, rideshares follow private-car child-restraint rules. In general, children under 7 need an appropriate child restraint. Rules can differ by state, territory, taxi, rideshare, and vehicle type.

## Practical Recommendation

For children aged 5 to 10:

1. Check whether the school already uses StudentRide or another managed bus service.
2. If the school does not have transport, check Shebah availability for recurring pre-booked child rides.
3. If in Sydney or Melbourne, verify whether Kabs4Kids is currently active in the relevant suburb.
4. If supervision is needed before or after the ride, use a nanny or babysitter pickup service such as Kiddo.
5. Do not use standard Uber for unaccompanied children aged 5 to 10.

## Product Direction

Start with a trusted options page per school area:

- public transport routes;
- walking school bus groups;
- licensed providers;
- parent coordination requests;
- safety checklist;
- school-specific notes;
- minimum child age;
- adult handover requirement;
- driver checks;
- Working With Children Check status;
- child-seat handling;
- booking model;
- tracking and visibility;
- geographic coverage;
- direct source links;
- verify-before-use warnings when information may be stale.

Do not prototype a live driver marketplace yet.

## Validation Plan

1. Pick one suburb and one common commute pattern.
2. Build the best possible public guide for that exact context.
3. Show it to 10 parents with children aged 5 to 10.
4. Ask which option they would actually call, which they distrust, and what information is missing.
5. Ask schools or after-school programs whether parents ask them for this information.

Strong signals:

- parents bookmark the guide;
- parents send it to another parent;
- schools say they receive this question repeatedly;
- parents ask for a suburb-specific version;
- a provider or school is willing to keep information updated.

## Sources Captured

- https://studentride.com.au/
- https://studentride.com.au/accmarsdenpark/
- https://www.shebah.com.au/ride
- https://apps.apple.com/au/app/kabs4kids/id1443022898
- https://kiddoapp.com.au/
- https://www.uber.com/au/en/newsroom/uber-for-teens-au-expansion/
- https://help.uber.com/driving-and-delivering/article/uber-rider-age-requirements?nodeId=01d2210c-4feb-4688-9f6e-c0acf6f7053a
- https://raisingchildren.net.au/babies/safety/car-safety/child-car-seats-taxis-rideshare-buses

## How To Help

- Verify StudentRide-style school transport pages for specific schools.
- Confirm Shebah availability for recurring child rides in target suburbs.
- Check whether Kabs4Kids is currently operating in Sydney and Melbourne suburbs.
- Document nanny/babysitter pickup options and their supervision model.
- Add source-backed child-seat, handover, and under-18 ride policy notes.',
  body_key = '',
  render_key = '',
  next_step = 'Build one suburb-specific verified guide and test it with parents.',
  risk = 'Child safety, liability, stale provider data, and compliance make a marketplace risky.',
  updated_at = CURRENT_TIMESTAMP
WHERE id = 'school-transport-options';

UPDATE ideas
SET
  summary = 'A lightweight local-first wellbeing app for one short emotional reset.',
  preview = 'Slowdown recommends one short practice from mood, energy, mental speed, and tension.',
  signal = 'Validate repeat use with five to ten users in real stressful moments.',
  body_md = '## Snapshot

Slowdown already exists as a small FreeAppStore app at slowdown.freeappstore.online. It recommends one short practice from a mood, energy, mental speed, and tension check-in.

The open question is whether people return to it when life becomes noisy, or whether it is only interesting once.

Current product boundaries:

- free and lightweight;
- local-first by default;
- optional Firebase sync when configured;
- no tracking;
- wellbeing only;
- no diagnostic, treatment, or crisis-service claims.

## Core Concept

The product should not compete with large meditation platforms. The useful wedge is an immediate personal reset: pause, name the pressure, choose the next small action.

Likely usage moments:

- before replying to a stressful message;
- after a busy meeting;
- when mental speed feels too high;
- when energy is low but the day is not over;
- before sleep when thoughts are still racing;
- when the user needs one next action, not a course.

## Architecture

This is a connected local-first app. It works without backend configuration using browser storage, and can sync saved resets through Firebase when VITE_FIREBASE_* values are configured.

Browser-side background agents score safety, recent patterns, and the best short practice.

The app is MIT-licensed and intended to be free.

## Design Sketch

The core flow:

1. Choose current state.
2. Take a short guided pause.
3. Write one sentence.
4. Pick one next action.
5. Review streaks and patterns lightly.

The check-in inputs should stay simple:

- mood;
- energy;
- mental speed;
- tension.

The recommendation should return:

- one short practice;
- why this practice fits the current state;
- a tiny next action;
- optional save or discard.

## Prototype Notes

Current technical notes:

- app subdomain: slowdown.freeappstore.online;
- dev command: pnpm install && pnpm dev;
- build command: pnpm build;
- deploy path: git push origin main with Cloudflare Pages auto-deploy;
- local-first storage works without backend configuration;
- optional Firebase sync can be enabled with VITE_FIREBASE_* values.

Next prototype improvements:

- capture the opening context in one tap;
- record whether the recommended practice was completed;
- ask whether the user feels more settled after the practice;
- add a simple what-helped-recently view;
- keep data export and delete controls obvious.

## Validation Plan

The app is worth continuing if users return three or more times in a week without being pushed.

Validation should focus on behavior, not vanity metrics:

- users open the app in real stressful moments;
- users complete the recommended practice;
- users report feeling more settled afterward;
- users remember the app exists when they need it again;
- users do not feel judged by streaks or reminders.

Ask five to ten users:

- What moment made you open it?
- Was the recommended practice the right size?
- Did the check-in ask too much?
- Did the saved history help or feel unnecessary?
- What would make you return next time?

Kill or pivot if users only try it once out of curiosity.

## Open Questions

- Is this a standalone app or a feature inside a bigger personal tool?
- What reminder style is helpful rather than annoying?
- Should saved resets sync by default, or should the app remain local-first unless the user opts in?
- What safety language is needed when users indicate distress?
- How should the app handle crisis-adjacent input without making clinical claims?
- Can patterns be shown without implying diagnosis?

## How To Help

- Test the app for seven days.
- Review wording for accidental medical or therapy claims.
- Suggest safe short practices that fit mood, energy, mental speed, and tension states.
- Test offline/local-first behavior.
- Test optional Firebase sync without making sync feel required.
- Propose retention metrics that do not reward unhealthy checking.',
  body_key = '',
  render_key = '',
  next_step = 'Validate repeat use with five to ten users in real stressful moments.',
  risk = 'Crowded wellbeing market, weak repeat use, and accidental medical or crisis claims.',
  updated_at = CURRENT_TIMESTAMP
WHERE id = 'slowdown-personal-reset';
