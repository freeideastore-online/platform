UPDATE ideas
SET
  summary = 'A local-first personal reset app for one stressful moment, not a meditation library.',
  preview = 'Slowdown is a built FreeAppStore prototype that recommends one tiny practice from mood, energy, mental speed, and tension.',
  signal = 'Validate whether five to ten people return in real stressful moments three or more times in seven days.',
  body_md = '## Snapshot

Slowdown already exists as a small built app at [slowdown.freeappstore.online](https://slowdown.freeappstore.online/). It is a local-first personal reset tool: the user checks mood, energy, mental speed, and body tension, then receives one short practice instead of searching through a content library.

The strongest thesis is not "another meditation app". The sharper wedge is one immediate reset at the moment of friction: before replying to a stressful message, after a meeting, when thoughts are racing, when energy drops, or when the user needs one next action.

Current product boundaries from the local project notes:

- free and lightweight;
- MIT-licensed;
- local-first by default;
- optional Firebase sync when configured;
- no tracking as a product principle;
- browser-side recommendation logic;
- wellbeing only;
- no diagnosis, treatment, therapy, or crisis-service claims.

The idea is active because there is already a prototype. The open question is retention: will people remember and use it when life is noisy, or only try it once because it is interesting?

## Current Product

The live app is a PWA-style single-page app. The page at [slowdown.freeappstore.online](https://slowdown.freeappstore.online/) loads a bundled frontend with a web manifest and app icons.

The local project note says the app works without backend configuration using browser storage, and can sync saved resets through Firebase when `VITE_FIREBASE_*` values are configured.

Core inputs:

- mood;
- energy;
- mental speed;
- body tension.

Current recommendation model:

- browser-side rule-based agents score safety, recent patterns, and practice fit;
- the app chooses one practice and a small action cue;
- saved resets can build a lightweight trend view;
- local storage is the default persistence path;
- sign-in/sync should remain optional rather than required.

Current safety language in the app is directionally correct: Slowdown is a wellbeing tool, not a medical device or crisis service. That boundary must stay prominent if the idea grows.

## User Moments

The product should serve short, real moments where a full course, journal, or meditation library is too heavy.

High-fit moments:

- before replying to a charged message;
- after a stressful meeting;
- after school pickup, commute, or family conflict;
- when mental speed feels high and attention is scattered;
- when energy is low but the day is not over;
- before sleep when thoughts are still looping;
- before opening a distracting app or doomscrolling;
- when the user needs one concrete next action, not a long self-improvement session.

Low-fit moments:

- acute crisis or immediate danger;
- diagnosis or treatment of mental health conditions;
- long-term therapy replacement;
- social community support;
- content-heavy meditation learning;
- clinical symptom tracking.

This keeps the product small enough to be believable.

## Competitors

Slowdown is entering a crowded wellbeing market, but it does not need to beat the largest apps directly. The comparison should be by job-to-be-done.

**[Headspace](https://www.headspace.com/)** is a major mental health and meditation platform with guided meditations, sleep resources, coaching, and broader mental health positioning. It is stronger for structured content, brand trust, and ongoing programs. Slowdown can only win by being much lighter and more immediate.

**[Calm](https://www.calm.com/)** is a large meditation and sleep app with sleep stories, soundscapes, meditation, breathing, and relaxation content. It is stronger for polished content and bedtime routines. Slowdown should not compete on content volume.

**[Medito](https://meditofoundation.org/medito-app)** is a free nonprofit meditation app with guided meditations, sleep stories, courses, breathing exercises, no ads, no paywalls, and no account needed. It is the hardest comparison for "free mindfulness". Slowdown needs a different wedge: instant recommendation from current state, not a library of free sessions.

**[Finch](https://finchcare.com/)** is gamified self-care. It makes daily self-care feel rewarding through a pet and goals. It is stronger for habit loops and emotional attachment. Slowdown should avoid building a game unless retention research shows playfulness is needed.

**[Balance](https://themindcompany.com/apps/balance)** positions itself as personalized meditation that adapts to the user. It is closer to Slowdown on personalization, but still lives in the meditation-program category. Slowdown should be shorter, lower-pressure, and more local-first.

**[one sec](https://one-sec.app/)** is not a meditation app; it adds friction before distracting app use. It matters because it proves a tiny pause can be a valuable product behavior. Slowdown could learn from one sec''s timing: the best reset may happen before the user does the thing they will regret.

**[Beyond Now](https://www.lifeline.org.au/get-help/support-toolkit/tools-and-apps/beyond-now-safety-planning)** is a crisis/safety-planning tool from Lifeline. It is not a direct competitor and Slowdown must not pretend to serve the same need. It is an important boundary reference: if a user appears crisis-adjacent, Slowdown should point to appropriate local crisis services rather than continue as if a short reset is enough.

## Differentiation

The differentiation should be simple:

- one reset, not a library;
- one minute to a few minutes, not a program;
- local-first data, not account-first onboarding;
- state-based recommendation, not search;
- low-pressure history, not streak guilt;
- safety boundary, not therapy claims;
- free public app, not subscription-first wellness content.

The product should feel like a pocket brake pedal. Open it, name the state, do one tiny thing, leave.

The strongest possible product promise:

"When your brain is moving too fast, Slowdown picks the next useful minute."

Do not promise:

- reduced anxiety as a clinical outcome;
- treatment;
- diagnosis;
- crisis support;
- permanent behavior change without evidence.

## Australia Safety And Compliance

Slowdown should stay clearly in the general wellbeing lane unless the team chooses to pursue a formal digital mental health path.

Useful Australian references:

- the Australian Government describes digital mental health services as an important part of support and points to the [National Safety and Quality Digital Mental Health Standards](https://www.health.gov.au/our-work/digital-mental-health-services);
- the Australian Commission says the [Digital Mental Health Standards](https://www.safetyandquality.gov.au/national-standards/national-safety-and-quality-digital-mental-health-standards) aim to improve quality and protect users from harm;
- [Medicare Mental Health](https://www.medicarementalhealth.gov.au/safety-and-quality-digital-mental-health) explains the standards in user-facing language;
- the [TGA digital mental health device rules](https://www.tga.gov.au/resources/guidance/understanding-digital-mental-health-device-rules) help providers understand when a digital mental health product may have regulatory obligations;
- [eMHPrac](https://www.emhprac.org.au/resource/australian-digital-mental-health-a-directory-for-health-practitioners/) maintains a practitioner-oriented directory of Australian evidence-based digital mental health services and resources.

Practical safety implications:

- keep intended use as general wellbeing and self-reflection;
- avoid symptom scoring that looks diagnostic;
- avoid claims about treating anxiety, depression, insomnia, trauma, or panic;
- keep crisis language visible and plain;
- if high-risk language is detected, stop normal recommendation flow and show local emergency/crisis options;
- make privacy, export, and delete controls obvious;
- avoid dark-pattern streaks that shame users into returning.

## Product Direction

The next product version should sharpen the existing prototype rather than expand it into a full wellness platform.

Keep:

- four inputs: mood, energy, mental speed, tension;
- one recommended practice;
- short steps;
- local-first saved resets;
- optional sync only when user explicitly wants it;
- simple trend view.

Add:

- "what made you open this?" one-tap context chips;
- completion signal: done, skipped, too much, not right;
- after-signal: more settled, same, worse;
- a "use without saving" path;
- data export/delete controls;
- short explanation of why the practice was selected;
- crisis boundary screen for concerning input;
- optional app-trigger integrations later, inspired by friction tools such as [one sec](https://one-sec.app/).

Do not add yet:

- social feed;
- therapist marketplace;
- long course library;
- paid subscription;
- AI chat therapist;
- medical claims;
- aggressive reminders.

## Practice Library

The practice library should be tiny and explicit. The app source already contains practices for different mood, energy, speed, and tension states.

Useful practice categories:

- breath and exhale reset for high speed or high tension;
- grounding for activated or anxious states;
- gentle movement for low energy and heaviness;
- body downshift for exhausted high-tension states;
- focus narrowing for scattered attention;
- one-need naming for decision fatigue;
- active discharge for high energy and agitation;
- pleasant-detail noticing for steady or bright mood;
- shutdown ritual before sleep or after overload.

Each practice should have:

- minutes required;
- intensity level;
- best-fit state;
- three or fewer steps;
- one safety cue;
- one "stop if this feels wrong" escape hatch.

The most important UX rule: the user should not have to browse practices while stressed.

## Data And Privacy

Slowdown collects sensitive-feeling personal state data even if it is not clinical data. Treat it seriously.

Best default:

- store on device first;
- do not require login;
- do not sync unless the user opts in;
- do not run third-party product analytics on personal state fields;
- make delete/export easy;
- explain what is stored in plain language.

Optional sync can be valuable for multi-device continuity, but it creates more responsibility. If Firebase sync is enabled, the app should document:

- what is synced;
- who can access it;
- whether data is encrypted in transit and at rest;
- how account deletion works;
- how to disable sync;
- what remains local.

For FreeIdeaStore validation, the privacy promise is part of the product, not a footnote.

## Validation Plan

The current validation target is correct: five to ten users in real stressful moments. The test should run for seven days, not as a one-time demo.

Recruit:

- busy parents;
- founders or builders;
- students during assessment pressure;
- people with stressful communication-heavy jobs;
- people who already tried meditation apps but do not use them consistently.

Test protocol:

1. Give each tester the app link.
2. Ask them to use it only when a real reset would help.
3. Do not send daily nagging reminders.
4. Ask for a short end-of-day note only if they used it.
5. Interview them after seven days.

Measure:

- first-use completion rate;
- number of real-moment opens per user;
- three-plus uses in seven days;
- practice completion;
- "more settled" after-signal;
- skipped/too-much/not-right signals;
- whether users remember it without being pushed;
- whether saved history feels useful or unnecessary.

Pass signal:

- at least half of testers use it three or more times in seven days;
- most completed sessions are under three minutes;
- at least 60% of completed sessions report "more settled";
- two or more testers say they would keep it on their phone.

Kill or pivot signal:

- users only try it once;
- users prefer opening [Headspace](https://www.headspace.com/), [Calm](https://www.calm.com/), or [Medito](https://meditofoundation.org/medito-app);
- the check-in feels heavier than the reset;
- users want human support or therapy, not a tiny tool;
- safety language becomes too hard to keep simple.

## Business Model

For FreeIdeaStore, Slowdown should stay free while the product risk is being tested.

Possible future models if retention is real:

- free public app with optional sponsor/supporter model;
- inclusion in FreeAppStore as a high-quality example app;
- ProAppStore version for teams, with private deployment and admin-safe analytics;
- workplace wellbeing micro-tool, sold carefully without medical claims;
- paid custom variants for schools, teams, or communities only after safety review.

Avoid subscription too early. The market already has polished subscription products. Slowdown''s advantage is trust, speed, and simplicity.

## Research Trail

Sources and pages checked:

- [Slowdown live app](https://slowdown.freeappstore.online/);
- local project note: `/Users/serge/dev/meetup/slowdown/CLAUDE.md`;
- [Headspace](https://www.headspace.com/);
- [Calm](https://www.calm.com/);
- [Medito app](https://meditofoundation.org/medito-app);
- [Finch](https://finchcare.com/);
- [Balance](https://themindcompany.com/apps/balance);
- [one sec](https://one-sec.app/);
- [Beyond Now by Lifeline](https://www.lifeline.org.au/get-help/support-toolkit/tools-and-apps/beyond-now-safety-planning);
- [Australian Government digital mental health services](https://www.health.gov.au/our-work/digital-mental-health-services);
- [National Safety and Quality Digital Mental Health Standards](https://www.safetyandquality.gov.au/national-standards/national-safety-and-quality-digital-mental-health-standards);
- [Medicare Mental Health safety and quality page](https://www.medicarementalhealth.gov.au/safety-and-quality-digital-mental-health);
- [TGA digital mental health device rules](https://www.tga.gov.au/resources/guidance/understanding-digital-mental-health-device-rules);
- [eMHPrac Australian Digital Mental Health Directory](https://www.emhprac.org.au/resource/australian-digital-mental-health-a-directory-for-health-practitioners/).

The local Slowdown docs page at `/Users/serge/dev/meetup/slowdown/docs/index.md` currently contains parent-volleyball research, so it was not used as Slowdown evidence.

## Open Questions

- Which exact opening moments create repeat use?
- Is the phrase "personal reset" clearer than "wellbeing" or "mindfulness"?
- Should Slowdown integrate with app-opening friction later, or stay manually opened?
- Does history help users, or does it make the product feel like tracking?
- Should optional sync exist at all for such sensitive data?
- What safety wording is enough without making the app feel clinical?
- Which three practices produce the highest "more settled" signal?
- Can the app be useful without reminders?
- Should there be a no-save mode on the first screen?

## How To Help

- Use [Slowdown](https://slowdown.freeappstore.online/) for seven days in real reset moments.
- Add competitor notes for lightweight reset apps, not generic meditation apps.
- Review the app for accidental medical, therapy, or crisis claims.
- Suggest one short practice with safe wording and a clear stop condition.
- Test offline behavior and local-first persistence.
- Test optional Firebase sync only if the privacy wording is clear.
- Propose a sharper validation metric that does not reward compulsive checking.
- Find Australian wellbeing/digital mental health references that clarify safe positioning.',
  body_key = '',
  render_key = '',
  next_step = 'Run a seven-day real-moment retention test with five to ten users and measure three-plus uses, completion, and post-reset usefulness.',
  risk = 'Crowded wellbeing market, weak repeat use, sensitive mood data, and accidental medical or crisis-service claims.',
  updated_at = CURRENT_TIMESTAMP
WHERE id = 'slowdown-personal-reset';
