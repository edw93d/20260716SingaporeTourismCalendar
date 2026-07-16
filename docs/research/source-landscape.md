# Source landscape: what else should feed the SG tourism/MICE demand calendar?

Research for issue #4. Investigated 2026-07-16. All findings verified against primary
sources (the source's own DNS, `robots.txt`, sitemaps, and served HTML) rather than
secondary write-ups. Where a search engine and a primary source disagreed, the primary
source won — see TIH and the cruise terminals below, where that mattered.

Method note: everything below was probed with plain HTTP GETs of public pages,
`robots.txt` and sitemaps. No `robots.txt`-disallowed URL was fetched. Where a source
disallows the machine-readable format, that is recorded as a constraint, not routed
around.

---

## Headline: the highest-value hypothesis is dead

**STB's Tourism Information & Services Hub (TIH) no longer exists.** The ticket hoped an
official licensed events API would sidestep the scraping question entirely. It would
have — but it was decommissioned on **31 July 2025**, roughly a year before this
research.

Evidence, in order of authority:

1. **DNS.** `tih.stb.gov.sg` and `tih-dev.stb.gov.sg` return **no A record** — the
   resolver returns only the `stb.gov.sg` SOA, i.e. the hostnames are gone. By contrast
   `www.stb.gov.sg` resolves normally (`65.8.76.118`), so this is not a network or
   sandbox artefact.
   ```
   $ dig +noall +answer +authority tih.stb.gov.sg A @1.1.1.1
   stb.gov.sg.  900  IN  SOA  gccin3psicnsp01.sgnet.gov.sg. root.pridns.gov.sg. ...
   $ curl https://tih.stb.gov.sg/
   curl: (6) Could not resolve host: tih.stb.gov.sg
   ```
2. **STB's own FAQ shortlink is dead.** The sunset notice pointed to
   `https://go.gov.sg/tihfaq2025`, which now returns **HTTP 404** ("Go.gov.sg: Page not
   found"). The retirement took its own documentation with it.
3. **Corroboration** (secondary, consistent with 1 and 2): TIH was discontinued
   31 July 2025; 30 May 2025 was the last day to edit content; **all TIH API keys were
   disabled from 31 July 2025**. Only media assets survive, migrated to the Singapore
   Tourism Photos and Videos platform.

> **Trap for future agents.** Google/Bing still index `tih-dev.stb.gov.sg` API reference
> pages (Open Data Service API, Content User API, "Get Events By Resource Id"), and LLM
> search summaries will confidently describe TIH's events API in the present tense. That
> index is stale by ~12 months. The endpoints do not resolve. Do not plan against them.

**Consequence for the project:** there is **no official STB events feed** to build on.
Every candidate below is a scrape. The scraping question the ticket hoped to sidestep is
unavoidable, which raises the stakes on the anti-bot work already flagged as unspecified
in the map.

### Is there an STB replacement?

- **data.gov.sg** carries STB datasets, but they are **statistical, not event listings** —
  tourist attractions, annual tourism receipts, international visitor arrivals, visitor
  survey profiles. All backward-looking aggregates. **Useless for a forward demand
  calendar** (and out of scope anyway: the map fixes "existence + timing only", no
  magnitude).
- **visitsingapore.com** is STB's own consumer + MICE surface and is the closest thing to
  a successor. It is a scrape, not a feed. See rank #2.

---

## Cruise: question answered, plus a live breakage warning

**Yes — MBCCS and SCC HarbourFront are the only two cruise terminals.** Confirmed from
the **Maritime and Port Authority** (the regulator, i.e. the authority that owns this
fact):

> "There are two cruise terminals in Singapore, each with two berths. Singapore Cruise
> Centre Pte Ltd operates the International Passenger Terminal at HarbourFront Centre and
> SATS-Creuers Cruise Services Pte Ltd operates the Marina Bay Cruise Centre Singapore."
> — <https://www.mpa.gov.sg/port-marine-ops/operations/port-infrastructure/terminals>

So the seed list has **complete cruise-terminal coverage**. No gap.

There are additionally **three ferry terminals**, all operated by SCC: Regional Ferry
Terminal (HarbourFront), Tanah Merah, and Pasir Panjang (offshore industrial islands
only). Ferries are regional passenger traffic — Batam/Bintan/Karimun/Desaru — not cruise
calls. **Recommend excluding**: Pasir Panjang is industrial, and the Batam/Bintan ferry
flow is high-frequency commuter/leisure traffic whose demand shape is nothing like a ship
disgorging 6,000 passengers on one morning. It would swamp the calendar with noise. Worth
a one-line decision to rule out rather than leaving implicit.

### ⚠️ SCC HarbourFront relocated two days ago (15 July 2026)

SCC's own site currently states:

> "HarbourFront Passenger Terminal has relocated. ... **Last day on 14 July 2026**"
> "The NEW Singapore Cruise Centre (HarbourFront) is now located at **5 HarbourFront
> Avenue, Singapore 099549**" — services "Commencing 15 July 2026".

This initially looked like a terminal closure — and MPA's page (stamped "Last Updated on
15 Jul 2026") still describes two cruise terminals, which appeared to contradict it. It
is **not** a closure: it is a **relocation and rebrand** of the same terminal into a new
building. Both sources are correct and MPA's count still holds.

But it means **a seed source physically moved house yesterday**. Its URL structure,
page templates and terminal naming are in flux *right now*. Two implications:

- Do not treat SCC page structure observed this week as stable; re-verify before
  hardening a scraper against it.
- This is a good natural argument for the map's breakage-detection requirement — a source
  changing shape underneath you is not hypothetical here, it is happening during the
  research.

(Longer-term context, lower confidence: SCC HarbourFront has been reported as slated to
eventually merge into an expanded MBCCS to free up the Greater Southern Waterfront. The
15 July move may be a step in that. Worth a watching brief; it would eventually collapse
two seed sources into one.)

---

## Ranked shortlist — coverage gained per unit of effort

Effort is judged on: does the data arrive in the initial HTML (cheap), or does it need
JS rendering / internal-API reverse-engineering (expensive), or is the origin actively
hostile (most expensive)?

### 1. Singapore EXPO — **build this next**

- **Covers:** Singapore's largest exhibition venue (operator: Constellar). ~**77 distinct
  events** currently listed, spanning exactly the MICE + concert mix the audience plans
  around: ATxEnterprise 2026, World Aquaculture Singapore 2026, APAC Food & Beverage
  Expo, Asia Pacific Furniture Fair, plus concerts/tours.
- **Structure:** AEM site. Real server-rendered pages at
  `/what-s-on/events-expo/<slug>`; listing at `/what-s-on`. Data **is in the initial
  HTML** — no JS needed. No JSON-LD, so dates come from HTML extraction.
- **Terms/robots:** **no `robots.txt`** (404 → nothing disallowed).
- **Overlap:** ~zero with the seed four. Suntec is the only other conference venue and is
  a different hall.
- **Verdict:** **highest coverage-per-effort by a distance.** Largest single uncovered
  venue, cheapest extraction, no robots restriction. If only one source is added, this.

### 2. VisitSingapore (STB) — best authority-per-effort

- **Covers:** two useful surfaces:
  - `/mice/en/event-listing/<slug>` — **47 pages**, curated business events (Sea Asia,
    OSEA Offshore Energy Week, inter airport South East Asia, Commodity Trading Week
    APAC, Future China Global Forum…). **This is STB's own MICE calendar** and the
    nearest surviving relative of TIH.
  - `/whats-happening/all-happenings/` — **20 pages**, but mostly *evergreen* anchors
    (Singapore Art Week, F1 season, Food Festival, CNY, Deepavali, Hungry Ghost). Low
    volume, and these are the events a professional already knows about.
- **Structure:** server-rendered; discoverable via published sitemaps
  (`/sitemap.xml`, `/mice/en/sitemap.xml`).
- **Terms/robots:** permissive for HTML. **But `robots.txt` disallows `/api.*`,
  `/*json$`, `/web-services/`, `/mice-web-services/`** — i.e. the machine-readable paths
  are explicitly off-limits. HTML scraping only.
- **Overlap:** low with seeds; some with EXPO/Suntec (a show is listed by both STB and its
  venue) — acceptable, the map accepts labelled duplicates in v1.
- **Verdict:** modest volume, but authoritative and cheap. Take the **MICE listing**;
  the `whats-happening` half is near-worthless for this audience.

### 3. Sentosa

- **Covers:** island-wide events. Sitemap exposes **676 URLs**, many under
  `/en/things-to-do/events/<slug>`.
- **Terms/robots:** permissive (`User-agent: *` with sitemap, nothing disallowed).
- **Caveat:** heavily weighted to **evergreen attraction programming** ("Animal Spotlight
  – Corals", "ASICS Running Club", waterpark tie-ins) rather than discrete demand spikes.
  High row-count, low signal-per-row. Needs filtering or it dilutes the calendar.
- **Verdict:** cheap and permissive, but **weakest signal quality** of the top tier.

### 4. Resorts World Sentosa

- **Covers:** RWS venues incl. arena/theatre programming. `/en/events`. Sitemap is large
  (**3,114 URLs**).
- **Structure:** **JS-rendered** — a 513 KB page whose extracted text is nav and footer
  only. No JSON-LD. Needs headless rendering or internal-API discovery.
- **Terms/robots:** permissive (`User-agent: *`, sitemap published).
- **Verdict:** genuine coverage, meaningfully more effort. Do after 1–2.

### 5. SISTIC — the real ticketing gap, but not cheap

- **Covers:** the ticket is right that SISTIC is *the* obvious gap beside Ticketmaster —
  it is the dominant SG ticketing platform (theatre, concerts, sport) and carries
  inventory Ticketmaster SG does not.
- **Structure:** **Next.js SPA and unfriendly to extraction.** No JSON-LD, **no
  `robots.txt`** (404), **no `sitemap.xml`** (404) — so no cheap URL discovery.
  A backing API exists at **`api.sistic.com.sg`** (a Spring Boot service — it returns
  Spring's default JSON error shape), but no public path was found and it is
  undocumented; it is an internal API, not a product.
- **Terms:** `/terms-and-conditions` is itself client-rendered — only 593 chars of text
  in the HTML — so **the terms could not be read without JS**. Licensing posture is
  therefore **unresolved**, and that is a real risk: an undocumented internal API plus
  unread terms is the worst combination for a public product.
- **Verdict:** **high value, high effort, unresolved legal posture.** Do not start here.
  Before any build: render and actually read the T&Cs. Flagged for #2/#3.

### 6. Marina Bay Sands Expo & Convention Centre — high value, actively hostile

- **Covers:** a top-tier MICE venue; real gap.
- **Blocker:** MBS **actively rejects non-browser clients**. Every request — across
  retries, HTTP/2 and forced HTTP/1.1, with a full desktop Chrome UA — dies at
  ~**0.05 s** with `HTTP/2 stream 1 was not closed cleanly: INTERNAL_ERROR`. Failing that
  fast, before any content, is a TLS/H2-fingerprint rejection at the edge, not an outage.
  **`robots.txt` itself is unreachable** — so its stated crawling policy could not even
  be read.
- **Verdict:** **worst coverage-per-effort despite high coverage value.** This is the
  source that will decide the anti-bot strategy the map lists as unspecified. Do not
  attempt casually; treat as its own spike. Note the terms are unread because they are
  unreachable — an unresolved-legal flag, same as SISTIC.

---

## Findings that affect sources we already have

These fall outside the ticket's question but are load-bearing and were found en route.

- **Suntec (seed source) is a Squarespace site**, and its `robots.txt` is the **stock
  Squarespace template** (`# Squarespace Robots Txt`). Two consequences:
  - Squarespace natively exposes `?format=ical` and `?format=json`. A ready-made iCal
    feed on a seed source would be a gift given v1's iCal output target.
  - **But `robots.txt` disallows exactly those**: `Disallow:/*?format=ical`,
    `Disallow:/*?format=json`, plus `format=json-pretty`, `page-context`, `main-content`.
    Critically, `User-agent: *` sits at **line 32 of a single 30-agent group** (AI2Bot …
    ClaudeBot … `*`), so **the disallows bind every crawler, not just AI bots**. The
    HTML event pages remain allowed.
  - Judgement: this is a **default template, not a deliberate stance by Suntec** — nobody
    at Suntec chose to block iCal. That makes it a **plausible ask**: Suntec is a
    partner-friendly venue and the polite move is to *ask them* for the iCal feed rather
    than either scraping HTML or quietly ignoring their robots. **Cheapest possible win
    in the whole landscape if they say yes.** Recommend a human sends an email before
    anyone writes a Suntec HTML parser.
- **MBCCS (seed source) is not as easy as SCC.** `robots.txt` is maximally permissive
  (`User-agent: * / Allow: /`), but the schedule at
  `/cruise-information?tab=cruise-schedule` is **JS/param-driven** — it defaults to a
  4-day window, rendered "There are no scheduled cruises", and injected date params did
  not change the served HTML. Data is not in the initial HTML; needs API discovery or
  headless.
- **SCC (seed source) is the easy one.** `/schedule/cruise/` is a **server-rendered
  table** with forward-looking calls already visible (Villa Vie Odyssey 30 Jul, Island Sky
  8 Aug, Ginga Maru 21 Aug, Star Voyager through Sep 2026), carrying ship, line, from,
  next port, arrival and departure timestamps — a clean fit for existence + timing.
  `/schedule/ferries/` is the same shape for ferries (recommended out of scope above).

---

## Recommended build order

1. **Ask Suntec for the iCal feed** (human email; zero code; possibly removes a scraper).
2. **Singapore EXPO** — largest uncovered venue, cheapest extraction, no robots limits.
3. **VisitSingapore MICE listing** — authoritative, cheap, 47 events; skip
   `whats-happening`.
4. **Sentosa** — only if the evergreen noise can be filtered.
5. **RWS** — accepts the JS-rendering cost.
6. **SISTIC** — read the T&Cs first. High value, unresolved posture.
7. **MBS** — its own spike; will set the anti-bot strategy.

**Ruled out:** TIH (dead), data.gov.sg STB datasets (statistical/backward-looking),
ferry terminals (wrong demand shape), additional cruise terminals (none exist).

## Open questions for #2/#3 and the map

- **The anti-bot decision can no longer be deferred.** With TIH gone, every source is a
  scrape, and the two highest-value remaining venues (MBS, SISTIC) are the two most
  defended. The map lists anti-bot as "cannot be specified until we know which sources
  actually defend" — this research is that answer: **MBS defends hard, SISTIC defends
  softly (SPA, no sitemap), everything else is open.**
- **Two sources' terms are unread because they are unreachable/JS-gated** (MBS, SISTIC).
  A public product should not scrape either until a human has read them.
- **Suntec robots vs. iCal** needs a human decision, not an engineering one.
- **SCC's relocation** may presage a merge into MBCCS. Watching brief.

## Sources

Primary (fetched directly, 2026-07-16):

- MPA, Terminals — <https://www.mpa.gov.sg/port-marine-ops/operations/port-infrastructure/terminals>
- Singapore Cruise Centre — <https://singaporecruise.com.sg/>,
  `/schedule/cruise/`, `/terminal/harbourfront-passenger-terminal/`,
  `/terminal/singapore-cruise-centre-harbourfront/`
- MBCCS — <https://mbccs.com.sg/>, `/cruise-information?tab=cruise-schedule`,
  `/robots.txt`
- Singapore EXPO — <https://www.singaporeexpo.com.sg/>, `/what-s-on`,
  `/what-s-on/events-expo/<slug>`
- VisitSingapore — `/robots.txt`, `/sitemap.xml`, `/mice/en/sitemap.xml`
- Suntec — <https://www.suntecsingapore.com/robots.txt>
- SISTIC — <https://www.sistic.com.sg/>, `/events`, `/terms-and-conditions`,
  `https://api.sistic.com.sg/`
- RWS — <https://www.rwsentosa.com/robots.txt>, `/sitemap.xml`, `/en/events`
- Sentosa — <https://www.sentosa.com.sg/robots.txt>, `/sitemap.xml`
- MBS — <https://www.marinabaysands.com/> (unreachable; rejection is itself the finding)
- data.gov.sg — `https://api-production.data.gov.sg/v2/public/api/datasets`
- DNS — `dig`/`nslookup` against `1.1.1.1` and `8.8.8.8` for `tih.stb.gov.sg`,
  `tih-dev.stb.gov.sg`, `www.stb.gov.sg`
- go.gov.sg — <https://go.gov.sg/tihfaq2025> (404)

Secondary (used only to corroborate the TIH sunset date, which DNS and the dead
shortlink independently support):

- Singapore Government Developer Portal, TIH overview (now 404) —
  <https://www.developer.tech.gov.sg/products/categories/data-and-apis/tourism-information-and-services-hub/overview>
- Search-surfaced TIH sunset notices citing 31 July 2025 and API-key disablement.
