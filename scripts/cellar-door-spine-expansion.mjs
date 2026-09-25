#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";

const DEFAULT_IDEA =
  "cellar-door-cycling-a-roving-support-van-for-wine-country-weeken";
const DEFAULT_BASE = "https://freeideastore.online";
const FLOOR_WORDS = 500;

const SPINE_TITLES = [
  "Overview",
  "People And Problem",
  "Context And Evidence",
  "Proposed Solution",
  "Risks And Constraints",
  "Model And Distribution",
  "Validation",
  "Prototype Or Pilot",
  "Evolution",
];

const REPLACEMENTS = new Map(
  Object.entries({
    Overview: `## Overview

### Snapshot

A weekend product for **couples and small groups of 2-5** who book a short-let in
an Australian wine region for a single night, usually Friday-Saturday or
Saturday-Sunday. Before they arrive, bikes, mostly e-bikes, are delivered to the
place they are staying. They get a loop route past a cluster of cellar doors, ride
it self-guided at their own pace, and a shared support van circulates the route
all day: collecting wine purchases, carrying gear, and retrieving anyone who is
tired, rained on, mechanically stuck, or no longer safe to ride.

The product is not a tour bus with pedals added. It is also not the multi-day
luggage-transfer holiday that the first version imagined. It is a local weekend
service for people who already chose the region and now want the pleasant part of
wine-country cycling without the logistics that make the day brittle.

### Current thesis

The roving shared van is the whole business. Bike hire, mapped loops, cellar-door
recommendations and accommodation pickup are all proven parts of the market. The
thing the research did not find, across roughly 90 operators and 12 countries, is a
vehicle that is simultaneously **shared across unrelated self-guided groups**,
**continuously circulating**, and **responsible for getting bottles and stranded
riders back to the guest's own accommodation**.

That claim is deliberately narrower than the original. The audit found that each
individual element already exists. On-demand phone-dispatched rescue appears at six
operators. Dedicated vans shadow guided groups. Shared shuttles run to timetables.
Wine collection exists in Niagara and New Zealand. The wedge is the intersection:
support good enough to feel guided, but pooled enough to be sold to independent
small groups at a day-product price.

### How to read this book

The spine is the readable path. The research chapters are the evidence base and
should be treated as the control surface for decisions. Start with the **Audit And
Corrections** and **Cross-file consistency audit** chapters before relying on any
number. Then use **Route Survey** for the launch-region question, **Financial Model
And P&L** for economics, **Precedent Hunt** and **International Synthesis** for the
existence claim, and **Distribution And Take Rates** for channels.

The strongest positive finding is that the customer pain is real and nearby:
people want cellar-door autonomy without nominating a driver. The strongest
negative finding is that the product only works if route geometry, van response,
insurance and capacity all line up at once. The project is therefore not ready for
capex. It is ready for a tightly measured pilot that tries to disprove the van
assumption before buying a fleet.

### Why this changed from the original framing

The idea was first written up as multi-day touring with daily luggage transfer
between accommodations. That collapses for the actual customer. A group doing one
night from Melbourne or Adelaide drives to the region with bags in the car and
does not change accommodation. Daily bag transfer has near-zero value to them. What
they cannot solve themselves is getting several bikes to the valley, making a safe
loop work after tastings, carrying purchases, and having a bail-out that does not
turn into an expensive private rescue. The van and the bikes are the product; the
luggage was a red herring.
`,

    "People And Problem": `## People And Problem

### First user

The first user is a couple or friend group of 2-5 adults, staying one weekend
night in an Airbnb, cottage, guesthouse or similar short-let in an Australian wine
region. They are within driving radius of Melbourne or Adelaide, old enough to be
there for the wine, and buying a nice weekend rather than an athletic achievement.
They do not need a cycling holiday brand to persuade them to travel; they are
already in the region. The job is to turn the Saturday into something freer than a
bus tour and less risky than improvising.

That user definition matters because it trims away attractive but wrong products.
They do not need hotel-to-hotel luggage transfer. They probably do not want a
seven-day itinerary. They may not even identify as cyclists. They need confidence
that the bikes will fit, the route will be pleasant, the purchases will get home,
and there is a graceful way to stop if weather, fatigue, alcohol, a flat tyre or a
flat battery changes the day.

### The problem moment

The problem happens on Saturday morning in the rental house. There are cellar
doors within reach, but reach is the wrong unit: somebody has to drive, or the
group has to surrender the day to a fixed tour. The nominated driver solution is
socially unfair. The bus tour solves safety but removes autonomy. Hire bikes alone
create a new burden: collecting the bikes, choosing roads, carrying wine, and
deciding what happens if one person wants to stop.

The research makes this problem sharper rather than broader. The **Route Survey**
chapter shows that the obvious region is not automatically the right one. Yarra
Valley has demand and cellar doors, but local cyclist evidence makes road comfort a
serious concern. Clare and Barossa have stronger trail infrastructure, but different
market and van-capacity trade-offs. The customer problem is therefore not "wine
tourists need bikes"; it is "small groups need a wine loop where support is part of
the product, because the wrong road or the wrong extraction delay ruins the whole
day."

### Current workarounds

- **Nominated driver** -- one person's weekend is made worse so everyone else can
  taste.
- **Guided bus or minibus tour** -- solves the driving and bottle logistics, but
  turns the day into someone else's route and pace.
- **Guided cycling tour** -- already exists. Yarra Valley X runs guided e-bike
  winery tours with accommodation pickup at $195pp Saturday and higher for a
  Friday twilight option. Tour de Vines has a Yarra day-bike product from $159pp,
  with e-bike pricing that the audit flags as inconsistent across same-operator
  sources.
- **Bike hire and improvisation** -- leaves the customer holding the hard parts:
  route choice, wine carriage, mechanicals, weather and safe extraction.

### Urgency and frequency

This is seasonal and repeatable rather than urgent. The same guest might only do
it once or twice a year, but the region refills with short-stay visitors every
weekend. That is the useful demand shape: the product does not need high repeat by
one household if short-let hosts, regional tourism bodies and cellar-door
itineraries keep presenting it to new small groups at the point of decision.
`,

    "Proposed Solution": `## Proposed Solution

### Core promise

*Ride between cellar doors at your own pace. We deliver the bikes to your door,
collect the wine you buy, and keep a support van on the loop so stopping does not
become a crisis.*

Do not market the old "twenty minutes away all day" line yet. The support research
does not justify it. Across about 45 support operators, no self-guided operator was
found publishing a response-time commitment for on-route rescue. The two published
numbers found anywhere are much looser: Discover France says mechanical support
aims to get riders back on the road within an hour, and ADFC Pannenhilfe works to
a 120-minute rescue window with a national member base behind it. The pilot has to
earn any stronger promise.

### User workflow

1. The group books a weekend slot, gives the address of the short-let, and chooses
   bike sizes.
2. Bikes, helmets, locks, chargers, route notes and the support number are delivered
   Friday evening or Saturday morning.
3. The group rides the loop at its own pace, with cellar-door stops chosen from a
   short recommended list rather than a mandatory itinerary.
4. When they buy wine, the cellar door or rider tags the purchase for collection.
   The van sweeps purchases and returns them to the accommodation by evening.
5. If a rider is tired, wet, mechanically stuck, dealing with a flat battery, or no
   longer safe to ride, they call the van. The product promise is that stopping is
   allowed and planned for.
6. Bikes are collected after the ride window or on Sunday morning.

### Smallest useful version

The smallest version is one region, one short loop, one operating weekend, one
hired or owned van, one trained driver, a partner-supplied or borrowed e-bike fleet,
a published support protocol, and a spreadsheet. It should charge real money and
avoid custom software. A WhatsApp number is sufficient if it lets the operator time
every request, note every pickup, and see whether the van can keep circulating.

The strongest design evidence comes from the **The Case Against** and **Precedent
Hunt** chapters. The case against says the broad tour-business version is too
exposed to insurance, seasonality and capex. The wedge that survives is narrower:
a route-specific operating product where the van is a shared resource. The
precedent scan says the market already accepts phone support, scheduled shuttles,
wine sweeps and guided vans, but has not combined them in this exact way.

That makes the product specification quite strict: sell less geography, fewer
promises, and a more dependable stop button.

### Out of scope

Accommodation booking stays out of scope. Guests book their own stay; this avoids
turning Airbnb hosts into a formal resale channel before the core service is
proved. Guiding, meals, multi-day touring, luggage transfer, a full app, winery
commission schemes and broad regional coverage are also out. Each adds complexity
before the decisive question is answered: can one van reliably support several
independent groups on one short wine loop?
`,

    "Risks And Constraints": `## Risks And Constraints

### Route safety is the first constraint

The route is the product's hard boundary. The idea only works where a novice
e-bike rider can move between enough cellar doors without being pushed onto fast,
hostile roads after tastings. The **Route Survey** chapter makes this sharper than
the original Yarra Valley instinct. Yarra has the brand, the Melbourne market and
existing guided operators, but local cyclist evidence makes the winery-to-winery
road environment uncomfortable. The safer Warburton Rail Trail does not solve the
same cellar-door-density problem.

South Australia looks more promising, but not automatically easy. Barossa has the
market and a 40 km sealed cycling and walking path, yet off-trail winery access can
turn the van from backup into a shuttle. Clare's Riesling Trail may give the van a
cleaner operating corridor, but with a smaller market and different weekend-demand
shape. That means the launch decision cannot be made from tourism brand strength.
It has to be made from ride-and-drive timing, safe stopping points, mobile coverage,
cellar-door density and how often the van can pass a stranded rider.

### Insurance and alcohol can kill it

Insurance is not paperwork at the end. The **Financial Model And P&L** chapter
could not price the exact liability cover from public sources, and the insurance
section treats that as a major hole rather than an assumption to hand-wave away.
The product combines self-guided e-bike hire, alcohol-adjacent riding, support
vehicle extraction, wine carriage, possible passenger movement, and a duty-of-care
story that changes once the operator promises rescue.

The legal position also changes by state. The draft has a Victorian cycling-under-
the-influence note, but the route evidence now points toward South Australia as a
serious candidate. South Australian cycling, passenger-transport, e-bike compliance
and liability rules therefore need primary-source verification before any paid
ride. A region can pass the demand test and still fail if the operating protocol
cannot be insured or explained plainly to riders.

### Capacity failure is the service failure

The most likely bad day is not one flat tyre. It is rain, fatigue or poor route
choice creating several calls at once. The **8. Capacity** chapter shows why this
matters economically: the model needs enough riders per van day to clear fixed
costs, but those same riders create extraction demand. A van that can collect wine
and recover one tired rider feels like a support layer. A van that leaves three
groups waiting in weather becomes the bottleneck everyone remembers.

This is why the product should publish a measured promise rather than the old
"twenty minutes away all day" line. The support-operator research found no
self-guided wine-cycling operator promising that kind of response window. A
promise can be earned only after the pilot records median response, worst-case
response, loading time, dead spots, and the second-van trigger.

### Capital and seasonality

The capex risk is ordinary but real. A meaningful e-bike fleet costs money, needs
storage, charging, maintenance, theft control, safety checks and replacement
planning. Partnering with an existing fleet is the asset-light wedge, but it must
still produce reliable bike quality and availability on peak weekends. Owning the
fleet may win later, but only after utilisation is measured.

Seasonality makes every fixed cost heavier. The sellable weekend count is finite,
weather can wipe out the exact day customers booked, and winter idle capacity is
not free. The project should therefore avoid broad launch commitments, custom
software, multi-region inventory and permanent fleet purchases until one route has
proved it can sell, operate and recover cleanly.

### Kill signals

- No route can combine safe riding, enough cellar doors, and a van circuit that
  clears the measured response threshold.
- Insurance is unavailable, excludes the support behaviour, or costs more per
  rider than the gross margin can carry.
- Paid demand is absent at a price that can plausibly reach the 14.3 riders/day
  break-even case.
- Wet-weather or fatigue calls routinely stack beyond one van's capacity.
- The only workable version becomes a private guided tour, eliminating the shared
  support wedge.
`,

    "Model And Distribution": `## Model And Distribution

### Unit economics -- the roving van

The old simple model said: fixed cost about $755 per operating day, variable cost
about $25 per rider, CAC about $40 per rider, and a $189 ticket producing roughly
$124 of contribution. On that arithmetic, break-even was about 6.1 riders per day.

The **Financial Model And P&L** chapter supersedes that. Rebuilt from published
Australian rates, the same concept lands at **14.3 riders/day break-even**,
**peak funding of about $240k**, and a major unresolved insurance hole. The draft's
largest errors were not heroic optimism; they were omissions. GST reduced apparent
revenue, fixed costs were missing, driver rates changed materially under the
Passenger Vehicle Transportation Award, season length fell from 70 assumed days to
about 66 operating days, and liability insurance could not be priced from a public
source.

The practical consequence is that this cannot be judged by revenue per booking
alone. It is a utilisation business. A van day, driver day, bike fleet, storage,
maintenance regime, booking stack and insurance layer all have to be paid for
whether six people ride or eighteen. One van at mature load may be a decent
owner-operator business. It is not obviously a venture-scale company unless more
vans, more regions, or a second revenue line work without breaking the support
promise.

### Capacity is the economic hinge

The **8. Capacity** chapter is the bridge between the model and the product. On a
short 33 km loop, a continuously circulating van may pass any point often enough to
serve six to eight groups on a normal day. On a longer e-bike-enabled 60 km loop,
the same van can no longer clear the 14.3-rider break-even threshold. A wet
Saturday creates the real failure mode: many riders request extraction at once,
and a crew van cannot move all people and bikes in one trip.

This is why route selection is not an operating detail. Clare's Riesling Trail does
some of the van's job for free by putting many cellar doors near a safer corridor.
Barossa has a larger market but may consume van capacity by requiring off-trail
access hops. The launch region must be chosen by van duty cycle, not by brand
recognition.

### Channels and price shape

Short-let hosts and regional accommodation are the highest-intent channel because
the guest is already in the region and deciding what Saturday is. Airbnb
Experiences is aligned with that moment and has the clearest published take rate
found: 20%. Other OTAs can be expensive and operationally rigid. GetYourGuide's
supplier rules, for example, make a "we only run if six people book" policy
dangerous because cancellation and no-show thresholds are extremely low.

The distribution research points toward pricing the vehicle, not pretending empty
seats have no cost. Published shared-cost precedents, from bike transfer services
to shuttle products, often use minimum charges, group discounts or vehicle-like
price floors. That suggests a cleaner offer: a small group buys a supported van
window, with the per-person price falling as the group fills it. It is less like a
marketplace seat and more like making the shared-van economics visible.

### Second revenue line

The original winery-referral idea is not supported. No operator in the 12-country
scan disclosed cellar-door commission, referral fees or funded support. The better
funding analogues are destination levies, accommodation-linked transport subsidies
and cyclist-ready accreditation schemes. In Australian terms, that means the first
partnership conversation should be with hosts, accommodation groups, councils and
regional tourism bodies, not with wineries asked to write cheques per rider.
`,

    Validation: `## Validation

### Riskiest assumption

The riskiest assumption is that one van can support several independent groups in a
day without the experience degrading into long waits, unsafe decisions or refunds.
If the van can only serve two groups, the price rises toward a private guided tour
and the wedge disappears. If it can serve six to eight groups on a short loop, the
shared-support model becomes plausible.

The international research does not validate this assumption. It validates pieces
around it. Guided operators put vans behind single groups. Self-guided operators
provide phone numbers. Shared shuttles run on schedules. Wine sweeps happen late in
the day. ADFC proves rescue can be specified, but at a 120-minute window and a
national membership scale. None of that proves that a local wine-region van can
keep a 20-35 minute response shape while serving unrelated groups who stop
unpredictably.

### Cheapest test that proves it

Do not build anything first. Ride the loop and drive the loop on the same Saturday.
One person rides at a realistic cellar-door pace, including tasting stops, toilet
stops, photo stops, indecision and battery checks. One person drives continuously
and logs circuit time, loading time, parking friction, dead mobile spots, safe
stopping points and how long it would take to reach each cellar door or trail
segment.

Then simulate demand. Generate six random support requests across the day: one
flat, one tired rider, one wine pickup, one battery issue, one weather bail-out,
and one "we are done early" call. Time what the van would actually do, including
the return leg with bikes and people aboard. The output is not a vibe; it is a
table of request time, arrival time, total delay, missed wine pickups, and whether
the van ever stops circulating.

- **Pass:** median response under 20 minutes and no credible worst-case above 35
  minutes with six simulated groups.
- **Weak pass:** median response under 35 minutes, suggesting the product is
  viable only with a softer promise, a lower cap, or faster second-van trigger.
- **Fail:** the loop cannot be driven continuously, extractions stack up, mobile
  coverage fails at decision points, or riders must use unsafe roads to make the
  itinerary work.

### Second test -- demand

The demand test must ask for money. A landing page with real dates, a named route,
a real price, clear weather and extraction rules, and a $50 refundable deposit is
enough. Ten paid deposits before buying bikes is a better signal than surveys or
host enthusiasm. Split the page if needed: per-person pricing versus a vehicle or
small-group price floor. The **Distribution And Take Rates** chapter makes the
pricing question part of validation, not a later packaging decision.

### Third test -- insurability and permission

Insurance is not admin in this idea. It is a kill risk. Before any paid ride, get
one written broker response for self-guided, alcohol-adjacent e-bike hire with
support-vehicle extraction and wine carriage. For South Australia, verify the
cycling-under-the-influence and passenger-transport exposure from primary sources,
not summaries. A route that passes the van test but fails insurance or permission
is not a launch route.
`,

    "Prototype Or Pilot": `## Prototype Or Pilot

### Pilot shape

Run one paid pilot weekend on one loop with one support van, one trained driver,
and no custom software. The best current candidate is a short trail-led South
Australian loop rather than the obvious Yarra Valley version, but the pilot should
only be scheduled after the ride-and-drive validation test chooses the route. The
pilot is not a marketing launch. It is an instrumented operating day designed to
find out whether the shared van is real.

Keep the numbers small enough to recover manually and large enough to stress the
model: about ten riders across three or four unrelated groups is a reasonable first
paid load. That is below the mature break-even target, deliberately. The pilot is
trying to price and time the support promise, not prove annual profit in one day.
If ten riders already break the van, the 18-rider mature case is fantasy. If ten
riders are easy, the next test can move toward the 14.3 riders/day break-even line
identified in the **Financial Model And P&L** chapter.

### What must be real

The van response must be real. Wine collection must be real. Payment must be real.
The route must be real enough that a novice e-bike rider can follow it without
being pushed onto roads the product would later disown. The bikes must be safe,
legal EPAC-compliant stock for the state being tested, with helmets, locks,
chargers, spare tubes, basic tools and a pre-ride safety check.

The operating protocol must also be real. Riders need to know what happens for
mechanicals, weather, intoxication, injury, flat batteries, abandoned bikes, late
returns and bottle pickup. The research suggests copying the clarity of ADFC and
Hoodoo rather than promising magic: publish what is included, what costs extra, and
what happens when the operator's equipment fails versus when the rider simply wants
to stop.

### What can be faked

The booking flow can be a form. Dispatch can be WhatsApp. Routing can be a PDF, a
GPX file and a laminated card. The brand can be plain. The bike fleet can be
partner-supplied, borrowed or hired for the day if the supplier quality is known.
The back office can be a spreadsheet that records rider names, bike numbers,
cellar-door stops, purchases, support requests, arrival times and resolution.

Do not fake the hard parts. A fake app teaches almost nothing. A fake van response
teaches the wrong thing. A free friends-and-family ride may be useful for rehearsal,
but it does not test demand. At least one pilot must have strangers or weak-tie
customers paying a price close enough to the intended offer that their behaviour
means something.

### Kill, continue, or narrow

Kill the idea if no safe loop can produce acceptable response times, if insurance
is unavailable, or if paid demand is absent at a price that can plausibly reach
break-even. Continue if the van logs show reliable circulation and support requests
remain sparse. Narrow if the route works only as a per-vehicle premium product or
only with an accommodation partner funding the empty seats. That is still useful
learning: it turns a vague wine-cycling idea into a specific operating model.
`,

    Evolution: `## Evolution

### Open questions

1. **Which loop?** Barossa's trail network and market are attractive, but the
   **Route Survey** and **Financial Model** chapters warn that off-trail access can
   turn the van from backup into the product's main transport layer. Clare's
   Riesling Trail may be less famous, but its route geometry may let the van wait,
   circulate and rescue rather than constantly shuttle.
2. **What response promise can be published?** The old 20-minute line is a target,
   not an earned claim. The pilot has to measure median and worst-case response
   times before the promise appears in sales copy.
3. **Will anyone fund the support layer?** The scan found no winery commission
   precedent. The live options are accommodation referral, destination support,
   per-head levies, cyclist-ready accreditation, or pricing the van directly to the
   group.
4. **What is the legal boundary in South Australia?** Cycling under the influence,
   passenger transport, e-bike compliance and liability wording all need primary
   source verification before launch.
5. **Own the fleet or partner?** The **Two structural alternatives** chapter gives a
   decision rule. Partnering wins if the bike-day rate stays below the crossover;
   owning may win at mature utilisation but adds maintenance, storage, theft,
   battery, charging and legal exposure.

### Next decisions

- [ ] Read the **Audit And Corrections** and **Cross-file consistency audit**
      chapters before using any number from this book.
- [ ] Choose two candidate loops and run the ride-and-drive timing test on both.
- [ ] Get one written insurance response for self-guided alcohol-adjacent e-bike
      hire with support-vehicle extraction.
- [ ] Verify South Australian cycling-under-the-influence and passenger-transport
      exposure from primary sources.
- [ ] Ask five accommodation hosts, not only cellar doors, whether they would
      promote or package the service.
- [ ] Run a deposit test with real dates and a real cancellation policy before any
      fleet capex.

### How this could grow

The first growth path is not more regions. It is a better operating cell: tighter
route, clearer rescue rules, reliable bottle logistics, measured response times,
and pricing that makes empty seats visible. Once one loop works, copy the operating
standard to another region only if the route geometry also works. The research is
full of small single-region cycling businesses that disappeared; expanding before
the model is measured would repeat the pattern the book already documents.

The more interesting evolution is a regional support layer rather than a tour
company: cyclist-ready hosts, signed cellar-door pickup points, battery swaps,
route cards, a shared rescue standard, and a van that can switch to wet-weather
driving or evening transfers. That keeps the thesis intact while giving the van
more than one job. The decision to take this toward ProIdeaStore should wait until
the pilot has real response logs, paid demand, insurance terms and a route that can
clear the 14.3 riders/day economic threshold without making the day feel unsafe.

If those facts do not arrive, the right evolution is a smaller service, not a louder
one: a host-referred bike-and-rescue day on one proven trail, with no claim to be a
regional network.
`,
  }),
);

function parseArgs(argv) {
  const options = { idea: DEFAULT_IDEA, base: DEFAULT_BASE, mode: "check" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--idea") options.idea = requiredValue(argv, ++i, arg);
    else if (arg === "--base") options.base = requiredValue(argv, ++i, arg);
    else if (arg === "--body") options.bodyPath = requiredValue(argv, ++i, arg);
    else if (arg === "--write") {
      options.mode = "write";
      options.write = requiredValue(argv, ++i, arg);
    } else if (arg === "--check") options.mode = "check";
    else usage(`unknown argument: ${arg}`);
  }
  return options;
}

function requiredValue(argv, index, arg) {
  const value = argv[index];
  if (!value || value.startsWith("--")) usage(`${arg} requires a value`);
  return value;
}

function usage(message) {
  if (message) console.error(message);
  console.error(
    "Usage: node scripts/cellar-door-spine-expansion.mjs [--check] [--write OUTPUT.md] [--body BODY.md] [--idea ID] [--base URL]",
  );
  process.exit(2);
}

async function fetchJson(options, apiPath, search = {}) {
  const url = new URL(apiPath, options.base);
  for (const [key, value] of Object.entries(search)) url.searchParams.set(key, value);
  const response = await fetch(url);
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`GET ${url} returned non-JSON: ${text.slice(0, 120)}`);
  }
  if (!response.ok) {
    throw new Error(`GET ${url} failed: HTTP ${response.status} ${data.error || ""}`.trim());
  }
  return data;
}

async function bodyFor(options) {
  if (options.bodyPath) return readFile(options.bodyPath, "utf8");
  const data = await fetchJson(options, `/api/ideas/${options.idea}`, { body: "full" });
  if (!data.body || typeof data.body !== "string") {
    throw new Error("idea API returned no markdown body");
  }
  return data.body;
}

function words(text) {
  return (text.match(/[\p{L}\p{N}]+(?:[’'][\p{L}\p{N}]+)?/gu) || []).length;
}

function sections(body) {
  const lines = body.split(/\r?\n/);
  const heads = [];
  for (const [index, line] of lines.entries()) {
    const match = line.match(/^##\s+(.+)/);
    if (match) heads.push({ line: index, title: match[1].trim() });
  }
  return heads.map((head, index) => {
    const end = index + 1 < heads.length ? heads[index + 1].line : lines.length;
    const markdown = lines.slice(head.line, end).join("\n").trimEnd() + "\n";
    return {
      title: head.title,
      markdown,
      words: words(markdown),
      start: head.line,
      end,
    };
  });
}

function spineCounts(body) {
  const byTitle = new Map(sections(body).map((section) => [section.title, section]));
  return SPINE_TITLES.map((title) => {
    const section = byTitle.get(title);
    return {
      title,
      words: section?.words || 0,
      status: !section ? "missing" : section.words < FLOOR_WORDS ? "below_floor" : "ok",
    };
  });
}

function replaceSection(body, title, replacement) {
  const all = sections(body);
  const section = all.find((entry) => entry.title === title);
  if (!section) throw new Error(`missing chapter: ${title}`);
  return `${body.slice(0, lineOffset(body, section.start))}${replacement.trimEnd()}\n\n${body.slice(
    lineOffset(body, section.end),
  ).replace(/^\n+/, "")}`;
}

function lineOffset(body, lineNumber) {
  if (lineNumber === 0) return 0;
  let seen = 0;
  let offset = 0;
  while (seen < lineNumber) {
    const next = body.indexOf("\n", offset);
    if (next === -1) return body.length;
    offset = next + 1;
    seen += 1;
  }
  return offset;
}

function transform(body) {
  let next = body;
  for (const [title, replacement] of REPLACEMENTS) {
    next = replaceSection(next, title, replacement);
  }
  return next;
}

function summary(body) {
  const counts = spineCounts(body);
  return {
    floor_words: FLOOR_WORDS,
    spine_chapters: counts,
    below_floor: counts.filter((entry) => entry.status !== "ok"),
  };
}

const options = parseArgs(process.argv.slice(2));
const before = await bodyFor(options);

if (options.mode === "write") {
  const after = transform(before);
  const beforeSummary = summary(before);
  const afterSummary = summary(after);
  await writeFile(options.write, after);
  console.log(
    JSON.stringify(
      {
        mode: "write",
        wrote: options.write,
        source: options.bodyPath || `${options.base}/api/ideas/${options.idea}?body=full`,
        before: beforeSummary,
        after: afterSummary,
        ok: afterSummary.below_floor.length === 0,
      },
      null,
      2,
    ),
  );
  if (afterSummary.below_floor.length) process.exit(1);
} else {
  const current = summary(before);
  console.log(
    JSON.stringify(
      {
        mode: "check",
        source: options.bodyPath || `${options.base}/api/ideas/${options.idea}?body=full`,
        ...current,
        ok: current.below_floor.length === 0,
      },
      null,
      2,
    ),
  );
  if (current.below_floor.length) process.exit(1);
}
