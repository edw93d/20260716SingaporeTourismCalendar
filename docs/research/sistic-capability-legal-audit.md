# SISTIC: capability + legal audit

Resolves [#131](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/131) on map
[#112](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/112).

**Method.** Every claim below was established on **05 Aug 2026** by fetching the live source and
reading the returned bytes — markup, response headers, JS bundles, `robots.txt`, terms pages and JSON
responses. Scripted fetches used `curl` with a browser User-Agent and `--http1.1`, rate-limited to
one request per second. Where a scripted client could not render a page, a **real Chrome instance**
was driven at it instead — the [#113 MBS precedent](v2-source-acquisition.md), which #131 directed be
applied here rather than inheriting #4's conclusion. Nothing here is inferred from secondary
write-ups. Anything not settled is in **Not established** rather than guessed.

**Ethics note.** No anti-bot measure was defeated, no `robots.txt` directive was violated (there is
no `robots.txt`), and **no account, login, paywall or credential was used — none exists** (§9).
~24 requests total to `cms.sistic.com.sg`, ~10 to `www.sistic.com.sg`, rate-limited throughout.

**Conformance with ADR-0021, which landed the same day as this audit.** The ADR postdates the method
doc this audit followed, so it was checked against explicitly in §11 rather than assumed. Two of its
rules were tested live rather than argued: **SISTIC serves an honestly-identified reader** (§2.1) and
**nothing here is behind an authentication wall** (§4.2). One correction it forces on this document
is recorded in §10.

---

## Summary

| Item | Finding |
|---|---|
| **Listing URL** | `https://www.sistic.com.sg/events` — client-rendered, **zero events in the raw HTML** |
| **API / feed** | **YES.** `GET https://cms.sistic.com.sg/sistic/docroot/api/events?client=1&first=N&limit=30` → clean JSON, 200, **no login and no token** |
| **`robots.txt`** | **HTTP 404** — no file exists (confirms #4) |
| **ToS verdict** | Access ban is **qualified**; republication ban is **unqualified and names scraping** |
| **Rendering** | Listing SPA (Next.js); **detail pages browser-only** |
| **Anti-bot** | Cloudflare, **passive** — plain `curl` gets HTTP 200 |
| **Volume** | **373 records**, 367 live/future, **284 discrete events** |
| **Horizon** | Bulk to **Jul 2027**; outliers to Dec 2030 |
| **Identity** | **Stable numeric `id` *and* stable `alias` slug — 373/373 unique on both** |
| **Overlap** | **12%** sit at venues v2 reaches first-hand. **88% are unique to SISTIC.** |
| **Route** | **`api`** — the first on the entire list |

---

## Three headlines

### 1. `api: 0` is broken. SISTIC is the first real API on the list.

#113's first headline was *"The API hypothesis in #113 does not survive contact — the score is
`api: 0`… there is no licensed feed to buy and no API to call."* That held across twenty sources.
It does not hold at twenty-one.

SISTIC's own SPA calls a JSON endpoint that answers **unauthenticated, over plain HTTP, with no
browser**, returning every field a calendar record needs. The full catalogue is **13 requests**. This
is not a scrape with a parser to maintain — it is the shape #113 went looking for and did not find.

One qualification: it is **undocumented**, so it carries no stability promise. It is nearer Changi's
AppSync-key-in-markup (#25) than a published developer API — except that here, unlike Changi,
**nothing needs to be lifted from the bundle at all** (§9).

### 2. The real prize is Esplanade — a major venue on no source list at all.

The overlap test that decided ADR-0020 was run again here, and SISTIC passes it more clearly than
EventsEye did. Only **45 of 367 live rows (12%)** sit at a venue v2 reaches first-hand — against
EventsEye's 14%. **88% are unavailable anywhere else on the list.**

And the residue is not a long tail of noise. **94 rows (26% of everything live) are at Esplanade
venues**, plus **46 at Victoria Concert Hall / Victoria Theatre**. Esplanade is Singapore's principal
performing-arts centre and it is **not on the v2 source list, first-hand or second-hand**. SISTIC is
currently the only route to it.

That reframes the source. SISTIC was added to the list as a *ticketing platform*, on the theory that
ticketed coverage was missing. What it actually delivers is **arts and performance coverage** — 144
Concert, 33 Theatre, 13 Dance, 12 Musical, 9 Orchestra — a genre the calendar has almost none of,
because every source audited so far is a convention centre, a cruise terminal or a trade-show
aggregator.

### 3. The terms split cleanly, and the split favours reading over publishing.

#131 asked for access and republication to be reported separately, because #113 found they are
usually distinct clauses. At SISTIC they are distinct **and they differ in strength**:

- The **access** ban is *qualified* — it forbids robots *"which may interfere with the proper
  operation of this Site"*. A rate-limited nightly read plausibly falls outside it. **No source
  audited so far has a qualified access clause**; MBS, Constellar, Eventbrite and Ticketmaster all
  ban automation flatly.
- The **republication** ban is *unqualified*, names *spidering* and *scraping* explicitly, and also
  names *linking*. Our feeds would breach it.

So SISTIC is the mirror image of the usual pattern. Per #123 this is not our decision to make — the
clause is reported precisely below and the ruling belongs there.

---

## 1. Terms

**There is no page at `/terms`.** SISTIC publishes four policy documents, all linked from the footer:

| Document | URL | Status |
|---|---|---|
| Terms and Conditions of Ticket Sales | `/terms-and-conditions` | Read — **no automation clause** |
| **Conditions of Access** | **`/conditions-of-access`** | Read — **this is the operative document** |
| Privacy Policy | `/privacy-policy` | Not read (not relevant) |
| Cookie Policy | `/cookie-policy` | Not read (not relevant) |

**#4's "unread, not benign" is now read.** Both documents are JS-gated exactly as #4 reported — a
plain GET of `/conditions-of-access` returns HTTP 200 and 53,874 bytes of which **586 bytes are
visible text, all of it nav and footer chrome**. A real Chrome instance rendered the full document
**on the first attempt**, no challenge, no retry. This is the MBS finding repeating precisely:
*a JS-gated policy page is not an unknowable policy page.*

`Conditions of Access` is dated **Last Updated: 30 January 2020**.

### 1a. Access clauses

The ban sits in the unnumbered preamble, and **it carries a qualifier**:

> *"SISTIC forbids the use of any robot, spider, automatic device, manual process, software or
> routine **which may interfere with the proper operation of this Site** or any transactions being
> conducted on this Site."*

⚠️ **The emphasis is the whole finding.** Read naturally, the relative clause limits the ban: what is
forbidden is automation *that interferes*, not automation as such. Compare the flat prohibitions
elsewhere on the list — MBS bans *"page-scrape", "robot", "spider"* outright; Constellar §4.8(d) bans
*"any robot, spider, scraper or other automated means to access our Sites"* outright.

Two honest caveats against leaning on this too hard: it is a **preamble, not a numbered clause**, and
*"may interfere"* is drafted broadly enough that a defendant does not get to be the judge of its own
politeness. But it is materially weaker than any comparable clause audited so far, and — unlike
Suntec's *"automated queries of any sort"*, whose qualifier (`shall include but not limited to`)
*expands* the ban — this qualifier **narrows** it.

Grepping the rendered document for *robot*, *spider*, *scrape*, *crawl*, *automat*, *data mining*
and *extract* finds no other access clause. **No mention of crawling, data mining or extraction
anywhere.**

### 1b. Republication / caching clauses

Three, and these are not qualified.

**§4.1 — commercial *or other* purposes:**

> *"You may not reproduce, modify, adapt, translate, publish, display, communicate, transmit,
> broadcast, podcast, webcast, distribute, sell, trade or exploit for any commercial or other
> purposes, any portion of, or any access to this Site or any Content or Features."*

⚠️ **Note the drafting: *"commercial or other purposes"*.** This is *not* a non-commercial carve-out
of the Suntec / SCC / TTGmice kind. It bars republication for **any** purpose. That matters for
#123's *"whether non-commercial is a live constraint"* bullet: **at SISTIC, staying non-commercial
buys nothing.**

**§4.2 — the operative clause for a calendar, and it names our method:**

> *"…you agree not to reproduce, display or otherwise provide access to the Content on another
> website or server, for example through framing, mirroring, **linking, spidering, scraping** or any
> other technological means (including any technology available in the future), **without the prior
> written permission of SISTIC**."*

This is the clause a public calendar breaches. It is curable — *"without the prior written
permission"* — which puts it in the same class as Constellar §3.1.

**§5.1 — the storage clause:**

> *"No part of this Site or of any Content or Features contained in it may be reproduced, adapted,
> communicated, transmitted or distributed in any manner or by any means, **stored in an information
> retrieval system** or otherwise used or dealt with in any way, without the prior written permission
> of SISTIC."*

⚠️ *"Stored in an information retrieval system"* is **the same wording as Changi/CAG** (#25). Our
store is one. As on Constellar, **a permission email that asks only about scraping is insufficient**
— it must name automated access, **storage**, and **republication in a public feed**.

`Content` is defined in §2.1 to expressly include *"event information, promoter and venue
information"* — so there is no argument that the clauses reach only the site's design and not its
listings.

### 1c. Ticket-sales T&C — nothing here

`/terms-and-conditions` (Last Updated 16 September 2021) is 28 clauses about ticket sales, refunds,
admission and COVID-era declarations. Grepped for the same seven keywords: **no automation clause,
no scraping clause, no data-reuse clause.** It binds Ticket Holders, which we are not. Recorded so
the next reader does not have to check.

---

## 2. `robots.txt`

**`https://www.sistic.com.sg/robots.txt` → HTTP 404**, serving 50,928 bytes of the site's Next.js
404 page rather than a file. `/sitemap.xml` → **HTTP 404** likewise.

**#4's finding confirmed, unchanged.** As #131 required this be stated: **the absence of a file is
the absence of directives, not the presence of permission.** SISTIC has published no
machine-readable crawl policy at all, so the `Conditions of Access` document is the only instrument
that speaks — the opposite of the Constellar situation, where `robots.txt` says yes and the contract
says no.

---

## 3. Rendering

**The listing is client-rendered.** A plain GET of `https://www.sistic.com.sg/events` returns
**HTTP 200, 56,526 bytes** — and contains:

- **zero** ISO dates,
- **zero** `DD Mon YYYY` strings,
- **one** `/events/…` link, and it is a pagination stub (`/events/page-501f6570a8579753`).

`x-powered-by: Next.js`. The App Router RSC payload (13 `__next_f.push` calls) carries page chrome
only. **#4's SPA finding is confirmed** — but see §4, because it stopped being the relevant fact.

**Detail pages are also client-rendered, and this one is browser-only.** `/events/rahim0826` returns
52,164 bytes to `curl` — against 52,036 for a known 404 page, i.e. **the shell and nothing else**.
The `<head>` *is* server-rendered (correct `<title>`, `og:*`, `description`), so metadata is
scriptable; the body is not. Retried with a full browser header set **and a warmed cookie jar**
(`nonce`, `__cf_bm`, `_cfuvid` from a prior homepage GET): **byte-identical, 52,164**. So this is not
a cookie or header artifact.

In Chrome the same URL renders fully, and carries data the listing API does not:

> `Thu, 20 Aug 2026, 8pm` · `Duration 90 minutes (Approximately)` · `Esplanade Recital Studio` ·
> `The Esplanade Co Ltd`

⚠️ **This is where SISTIC's start times live, and they cost a browser per event.** See §7.

---

## 4. API — the finding that changes the route

The SPA declares its own backend in the public JS bundle
(`/_next/static/chunks/7294-40c5fa43b45d22e8.js`), decompiled here from the minified source:

```js
// module 75183 — the axios instance
axios.create({
  baseURL: "https://cms.sistic.com.sg",
  timeout: 3e4,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store, no-cache" }
})

// module 96428 — the call
async getEventsData(e) {
  return (await a.A.get("/sistic/docroot/api/events", {
    params: e,
    headers: { Authorization: "<a static token, hardcoded in the public bundle — see §9>" }
  })).data
}
```

⚠️ **The token value is deliberately not reproduced here, per ADR-0021 §7.** It is also, as §9
establishes, **not required** — so no adapter ever needs it.

**This is the #25 Changi pattern exactly**, and #131 anticipated it: the SPA declares its own
endpoint and key in shipped markup, which makes the source *cheaper* than an HTML scrape rather than
harder.

**Verified live.** `GET https://cms.sistic.com.sg/sistic/docroot/api/events?client=1&first=0&limit=30`
→ **HTTP 200**, `application/json`, ~16 KB:

```json
{ "first": 0, "limit": 30, "total_records": 373, "data": [ … ] }
```

Record shape, verbatim from the response:

```json
{
  "id": "160944",
  "title": "Esplanade Presents | A Date With Friends …",
  "min_price": "40", "max_price": null,
  "alias": "rahim0826",
  "start_date": "Thu, 20 Aug 2026",
  "end_date": "Thu, 20 Aug 2026",
  "event_date": "Thu, 20 Aug 2026",
  "venue_name": "Esplanade Recital Studio",
  "primary_genre": "Theatre",
  "currency": "S$", "currency_code": "SGD",
  "stixLite": false, "tag_name": null, "tag_colour": null,
  "thumb_image": "/sites/default/files/…", "culture_pass": false,
  "price": "S$40"
}
```

**Parameters, established by probing:**

| Param | Behaviour |
|---|---|
| `client` | **Required.** Omitting it → HTTP 400 `{"message":"Invalid client parameter. Only letters and numbers are allowed."}`. Value `1` (`CLIENT_ID=1` in the bundle). |
| `limit` | **Capped at 30.** `limit=100`/`200`/`500`/`1000` all → HTTP 422 `{"message":"limit must not be greater than 30."}` |
| `first` | Offset. `first=360` returns the final 13 records. |

**Full catalogue = 13 requests** (`first=0,30,…,360`). All 13 returned HTTP 200; 373 records
retrieved, 373 unique ids.

Sibling endpoints declared in the same bundle, **not exercised** — listed so a future adapter knows
they exist: `/sistic/docroot/api/events/search`, `/sistic/docroot/api/get-solr-search-results`,
`/sistic/docroot/api/search-featured`, `/sistic/docroot/genres`, `/sistic/docroot/get-metatags`,
`/sistic/docroot/api/side-panel`, `/sistic/docroot/api/homepage/recommender`.

⚠️ The bundle shows `get-solr-search-results` being called with `limit:"1000"` and
`sort_type:"date", sort_order:"ASC", index:"global"` — so **a 1000-row page may be available on that
endpoint** even though `/api/events` caps at 30. Untested; see Not established.

---

## 5. Anti-bot

**Cloudflare, passive.** `Server: cloudflare`, `cf-cache-status: DYNAMIC`, `CF-RAY: …-SIN`.

Every request in this audit — HTML, JS chunks, JSON API — returned **HTTP 200 to a plain `curl`
with a browser User-Agent, on the first attempt, with no challenge, no interstitial and no cookie
gate**. Response times ~0.09 s. The only cookies set are `__cf_bm`, `_cfuvid` and a CSP `nonce`.

Using #113's distinction: this is **passive Cloudflare (like The Kallang, The Star, bigevent.io)**,
categorically not a live challenge (Ticketmaster's `{"response":"identify"}`) and not a silent drop
(MBS's Akamai). **Nothing was defeated, because nothing challenged.**

---

## 6. Volume & horizon

Counted from all 373 records, against a reference date of **05 Aug 2026**.

| Measure | Count |
|---|---|
| Total records returned | **373** |
| Already ended (`end_date` < today) | 6 |
| **Live or future** | **367** |
| Starting strictly in the future | 280 |
| **Discrete events** (span ≤ 31 days) | **284** |
| Standing runs / attractions (span > 31 days) | 83 |
| Distinct venues | **123** |

**Horizon.** Discrete events by end month:

| | Aug 26 | Sep | Oct | Nov | Dec | Jan 27 | Feb | Mar | Apr | May | Jun | Jul 27 | Dec 30 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| events | 102 | 68 | 42 | 29 | 11 | 6 | 2 | 7 | 6 | 6 | 1 | 2 | 2 |

**The honest reading is ~11 months, not 4 years.** The bulk sits Aug–Dec 2026; a real but thin tail
reaches **Jul 2027**; the Dec 2030 rows are standing attractions (SkyPark Observation Deck, ArtScience
Museum, an LKCNHM membership), not events. Longest genuine future event: **FOO FIGHTERS, ending
25 Jan 2028** — and that one is not in Singapore (§8).

**Against ADR-0020's reason 2 (second-hand sources reach further than venues do): SISTIC supports
it, moderately.** It beats MBS's own directory (**3 days**) by two orders of magnitude and beats
Suntec (~3 months), The Star (Dec 2026) and RWS (Jan 2027). It does **not** approach EventsEye
(May 2028), TTGmice or Changi Exhibition Centre (Feb 2028). #131 flagged SISTIC as the untested case
for ticketed events: **tested, and the answer is "further than venues, short of the trade-show
aggregators."**

**Density is the stronger result.** 284 discrete events is more than any other single source audited
— Suntec's 131 is the nearest — and unlike Suntec they are spread over 123 venues.

---

## 7. Identity — the best `sourceKey` on the list

ADR-0004 wants a stable per-event id. SISTIC supplies **two**, and both are perfect on this sample:

| Field | Uniqueness | Notes |
|---|---|---|
| `id` | **373 / 373** | Opaque numeric string, e.g. `"160944"`. Present on every record. |
| `alias` | **373 / 373** | Human-readable slug, e.g. `rahim0826`, `lite_adaf2026`, `SOT2634-2` |

`alias` **is** the detail-page URL path (`/events/<alias>`), so it doubles as the canonical link — no
URL construction or lookup needed. Recommend `id` for `sourceKey` (opaque ids are less likely to be
edited than slugs) with `alias` retained for the link.

⚠️ **Field-quality hazards, all found in the data:**

1. **`event_date` is a lossy display string — do not parse it.** For a run starting in 2025 it
   renders `"Mon, 01 Sep - Mon, 31 Aug 2026"`, dropping the *start* year and appearing to run
   backwards. `start_date` and `end_date` are unambiguous and complete (373/373 parsed cleanly as
   `%a, %d %b %Y`). This looked like a data-integrity bug on first read and is not one — it is a
   presentation field.
2. **No times anywhere in the API.** Every date is day-granularity. Times exist only on detail pages
   (§3), which need a browser.
3. **Titles carry raw control characters** — e.g. `"Sampan Rides\r\n"`. Trim.
4. **Sparse fields:** `max_price` 240/373, `price` 235/367 live, `tag_name` 3/373.
5. **`venue_name` is free text, not an identifier** — `"Drama Centre Theatre, National Library 100
   Victoria St, #03-01, Singap…"` runs address into name. Venue matching for #115/#129 dedup will be
   fuzzy.

---

## 8. Overlap — 12%, and the residue is the point

The ADR-0020 test, re-run. Classifying all **367 live rows** by whether `venue_name` names a venue
v2 reaches first-hand:

| First-hand source | Rows |
|---|---|
| Marina Bay Sands (incl. Shoppes, SkyPark, ArtScience) | 16 |
| The Star | 8 |
| The Kallang / National Stadium / Indoor Stadium | 8 |
| RWS | 5 |
| Suntec | 4 |
| Sentosa | 4 |
| **Total overlapping** | **45 of 367 = 12%** |
| **Unique to SISTIC** | **322 = 88%** |

**This is a coverage source, not a duplicate generator** — and by a slightly clearer margin than
EventsEye (14%), the source that decided ADR-0020. Singapore EXPO and Changi Exhibition Centre
returned **zero** rows: SISTIC does not sell trade shows, which is exactly why it does not collide
with the sources v2 already has.

**Where the 88% actually is:**

| Venue cluster | Rows | On the v2 source list? |
|---|---|---|
| **Esplanade** (Concert Hall 36, Recital Studio 20, Theatre 13, Singtel Waterfront 8, White Room 5, Annexe 5, …) | **94 (26%)** | **No** |
| **Victoria Concert Hall / Victoria Theatre** | **46 (13%)** | **No** |
| Long tail — Capitol, Drama Centre, Mediacorp, UCC, SCCC, studios | ~180 | No |

Genre mix of the 367: Concert 144, Course/Workshop 63, Theatre 33, Lifestyle 23, Seminar 14,
Dance 13, Musical 12, Film 12, Comedy 9, Orchestra 9, MICE 3.

⚠️ **A location filter is mandatory, and #131 did not anticipate this.** SISTIC lists events it
ticket-sells that are **not in Singapore**: `Indonesia Arena Senayan, Jakarta`; `Plenary Hall, Kuala
Lumpur`; `FOO FIGHTERS | TAKE COVER TOUR (AUSTRALIA & NEW ZEALAND)`; `Summer Sonic 2026`. **Seven
rows carry `venue_name: "Various Venues"`** and cannot be located from the listing payload at all.
Small — under 3% — but a Jakarta concert in a Singapore tourism calendar is a visible error, and
`Various Venues` rows need either a detail-page lookup or a default-reject.

---

## 9. The `Authorization` token is decorative — the endpoint is simply open

SISTIC's bundle sends a static `Authorization` token, hardcoded and served to every anonymous
visitor in `/_next/static/chunks/7294-40c5fa43b45d22e8.js`. The value is **not recorded in this
repository, per ADR-0021 §7**.

**It does not need to be, because the server does not check it.** Tested three ways against
`/sistic/docroot/api/events?client=1&first=0&limit=5`:

| Request | Result |
|---|---|
| With the bundle's token | HTTP 200, 2,663 bytes |
| **With no `Authorization` header at all** | **HTTP 200, 2,663 bytes** |
| **With `Authorization: notarealtokenatall`** | **HTTP 200, 2,663 bytes** |

Byte-identical. The header is unvalidated; the endpoint is open to any anonymous caller.

**This resolves the question rather than raising it, and it resolves it the good way:**

- **ADR-0021 §4.2 (authentication wall) is not engaged.** There is no login, no account, no
  credential, no paywall — nothing authenticates, so there is nothing to climb. The Computer Misuse
  Act exposure §4.2 is written about does not arise. This is *tested*, not argued.
- **ADR-0021 §7's disclosure hand-off does not apply.** §7 governs *"the credential exposed in a
  source's own public bundle"* — the MBCCS case, where a real Basic-auth credential gates a real
  API. Here nothing is gated, so nothing has been exposed. **SISTIC is not a second instance of the
  MBCCS pattern**, and should not be reported to #123 as one.
- **The adapter sends no `Authorization` header**, which is the cleanest available position: we
  make a plainly anonymous request to a plainly open endpoint.

⚠️ **An earlier draft of this document, and the first comment posted to #131, got this wrong** —
they recorded the token as required, reproduced its value in breach of ADR-0021 §7, and handed #123 a
*"does politeness permit using a bundled token?"* question. The value has since been scrubbed from
this repository, the #131 thread and the #112 map body. **That question does not arise at SISTIC.**
It may still arise at Changi (#25), whose AppSync key was never tested for whether it is actually
enforced — **that is now worth one request**, and is the only part of the original concern that
survives.

---

## 10. Route recommendation

**Route: `api`** — with the terms question handed to #123 per #131's instruction.

| | |
|---|---|
| **Acquisition** | 13 plain HTTPS GETs to `cms.sistic.com.sg`, JSON in, no browser, no parser |
| **Cost** | Lowest of any source audited. No HTML parsing at all. |
| **Yield** | 284 discrete events, 123 venues, 88% unavailable elsewhere |
| **Blocked?** | Not technically — nothing challenges. **Contractually yes on republication** (§4.2, §5.1); **arguably not on access** (qualified preamble) |
| **Under ADR-0021** | **No hard stop is engaged** — see §11 |

**If SISTIC is adopted, the permission email must ask for three things, not one** — automated
**access**, **storage** in a retrieval system (§5.1), and **republication in a public feed** (§4.2).
§4.1's *"commercial or other purposes"* means asking for non-commercial use only would **not** cure
it. All three clauses are prefaced *"without the prior written permission of SISTIC"*, so all three
are curable — SISTIC is a **fully curable** case, unlike Constellar §4.8 which has no carve-out.

**Adapter shape: API-only. There is only one lawful shape, and ADR-0021 decided it.**

An earlier draft offered two, and treated the second as a product trade-off. It is not one:

1. **API-only** — 13 requests, all-day records, **no start times**. Cheapest adapter on the list, and
   the only permitted one.
2. ~~**API + browser detail pass**~~ — would add start times, durations and organisers at **~284
   browser page loads per run**. ⚠️ **Barred outright by ADR-0021 §2.2**, which allows *"one page
   load per host per run, and no crawling — navigate to the known listing URL, never follow links."*
   284 loads following 284 links from a listing is precisely the crawl that rule names. It is also
   the one behaviour in this audit that could make SISTIC's *"may interfere with the proper
   operation of this Site"* qualifier actually bite. **Not a risk to weigh — a rule already made.**

**So SISTIC's start times are unavailable**, unless the detail endpoint in *Not established* is
found, in which case they cost nothing. That is what makes finding it the highest-value follow-up
here rather than a curiosity.

Consequence for #121: **ADR-0005's browser-adapter count is unchanged at two.** SISTIC is a plain
HTTP source.

⚠️ **Owed once `docs/123-reading-sources-that-forbid-it` merges: a row in `docs/source-register.md`.**
That file did not exist on `main` when this branch was cut, so a row is not added here — writing one
against a file this branch does not carry would conflict on merge. The row's contents are §1a, §1b
and §2 above. Permission status should read **`not-asked`**, not `not-barred`: SISTIC bars
republication and storage explicitly, so the register's *"asking manufactures a refusal risk out of
nothing"* carve-out does not apply.

---

## 11. ADR-0021 conformance — every hard stop, tested

ADR-0021 landed on 05 Aug 2026, the same day as this audit and after the method doc it followed. Its
five hard stops (§4) and its politeness obligations (§2) are checked here explicitly rather than
assumed. **SISTIC engages none of the five.**

| ADR-0021 §4 hard stop | SISTIC | Basis |
|---|---|---|
| 1. `robots.txt` `Disallow` on our path | **Not engaged** | No `robots.txt` exists (404). ADR-0021 §3's corollary is explicit: *"Absence is permission."* Same posture as EventsEye and The Star. |
| 2. Authentication wall | **Not engaged** | **Tested** — the endpoint answers with no `Authorization` header (§9). Nothing authenticates. |
| 3. Explicit refusal received | **Not engaged** | None sent, none received. |
| 4. Active technical block aimed at us | **Not engaged** | Cloudflare passive; HTTP 200 first attempt every time (§5). Nothing resembling Ticketmaster's `401 {"response":"identify"}`. |
| 5. Impersonation | **Not engaged** | **Tested** — see below. |

### §2.1 *Identify*: SISTIC serves an honestly-identified reader

The #135 matrix, re-run here. Each User-Agent against both the listing page and the API:

| User-Agent | `/events` | API |
|---|---|---|
| `Mozilla/5.0 (compatible; sg-tourism-calendar/0.1)` | **200** / 56,526 | **200** / 2,663 |
| `Mozilla/5.0 (compatible; sg-tourism-calendar/0.1; +edw93d/20260716SingaporeTourismCalendar)` | **200** / 56,526 | **200** / 2,663 |
| `sg-tourism-calendar/0.1 (+https://github.com/edw93d/…)` — the bare form **MBS refuses** | **200** / 56,526 | **200** / 2,663 |
| Chrome's own string | 200 / 56,526 | 200 / 2,663 |

**Byte-identical across all four.** SISTIC does not filter on User-Agent shape, honesty, or the
presence of a resolvable URL — so ADR-0021 §2.1 **costs nothing here**, and none of §135's unresolved
tension about whether a scheme-less `owner/repo` path discharges *linking* arises. The adapter can
send the fullest, most honest form including a live repository URL.

⚠️ **This audit's own scripted fetches used a Chrome User-Agent**, following
`docs/research/v2-source-acquisition.md`'s method, which predates ADR-0021 §2.1. Recorded plainly
rather than quietly corrected. It changed nothing — the honest strings return byte-identical
responses — but the method doc now conflicts with the ADR and **should be amended before the next
source audit**, or the next one will repeat it against a host where it does matter.

### §2.2 *Rate*: satisfied comfortably

13 requests to `cms.sistic.com.sg` for the full catalogue, rate-limited to 1/s throughout this audit.
No `429`, no `Retry-After`, no `X-RateLimit-*`. No `Crawl-delay` to honour (no `robots.txt`). The
browser-route clause of §2.2 is what rules out adapter shape 2 — see §10.

### §5 *Private use*: does not clear the access clause, may clear the rest

ADR-0021 §5 holds the repository private and v2 does not republish, which switches off reuse clauses
that pair *non-commercial* with *personal* or *internal*. ⚠️ **At SISTIC it clears less than usual.**
§4.1 bars reuse *"for any commercial **or other** purposes"* — drafted without the personal-use
carve-out the clearing argument needs. §5.1's storage bar is likewise unqualified. And per the
register's standing warning, no access clause is ever cleared by private use anyway.

**Verdict for the register: `not-asked`, not cleared.** Whether §4.1's *"or other purposes"* survives
a private-use reading is a legal question this audit does not answer and should not.

---

## Not established

- **Whether `get-solr-search-results` accepts `limit=1000`.** The bundle calls it that way
  (`{first:0, limit:"1000", sort_type:"date", sort_order:"ASC", index:"global", client:1}`), which
  would collapse the catalogue to **one** request. Not exercised — `/api/events` already answered and
  a second endpoint did not need probing to settle the route.
- **Whether an endpoint serves detail-page content** (times, duration, organiser). Chrome made **no
  SISTIC XHR** on a detail page — only Google and TikTok analytics — so the body is delivered with the
  document by a path a scripted client does not receive. The mechanism was not identified. **If one
  exists, shape 2 above becomes as cheap as shape 1**, and it is the single highest-value follow-up
  in this document.
- **`total_records` stability and update cadence.** ⚠️ One data point, unplanned: `total_records` was
  **373** at the start of this audit and **374** roughly 40 minutes later. So the catalogue is live
  and changes intraday — but a single increment is not a cadence, and nothing is established about
  daily churn, whether past events are pruned (6 ended rows were still present, so pruning is at best
  lazy), or whether `id` survives an event being edited. **All counts in this document are from the
  373-record snapshot** and are internally consistent.
- **Rate limits.** No `429`, no `Retry-After`, no `X-RateLimit-*` headers at 1 req/s across 18
  requests. Nothing established about the ceiling.
- **Whether SISTIC's listing is complete for its own venues.** SISTIC carries only what it
  ticket-sells, so its Esplanade rows are a subset of Esplanade's programme. ✅ **Ruled 05 Aug 2026
  (Ed): that subset is the wanted one — see §12.** What remains unestablished is the *size* of the
  gap, which now matters only for completeness, not for the route.
- **The 7 `Various Venues` rows.** Not resolved to locations.
- **Coverage of `stixLite` / `culture_pass` flags.** Present on every record, meaning not
  investigated.

---

## 12. ⚖️ Esplanade does not become a first-hand source — ruled 05 Aug 2026

§8 left this open as the largest gap in the audit. **Ed ruled it the same day, and the ruling stands
on the free/ticketed line, not the arts/MICE line.**

> *"Nobody travels to Singapore for small free art exhibitions (this is targeted at the domestic
> Singapore market). However, people do buy tickets and travel for a big concert."*

**Esplanade is not added to the source list.** Its own programme is dominated by free public
programming aimed at residents — Concourse exhibitions, tours, talks — which carries no
demand-landing signal for a hotelier. Adding it first-hand would import that noise. SISTIC lists only
what it **ticket-sells**, so it already delivers the demand-relevant subset. **The 94 Esplanade rows
are a point in SISTIC's favour, not a gap in it**, and §8's coverage argument is unchanged.

⚠️ **This is not a ruling that arts events are out of scope, and it must not be read as one.**
`CONTEXT.md` defines `VenueEvent` as *"A conference, an exhibition, a concert, a consumer festival"*
and expressly rejects the name `MiceEvent` because consumer events belong. The test is **demand
landing**, not event category. Read the other way — arts as such being irrelevant — this ruling would
delete 144 Concert, 33 Theatre, 13 Dance, 12 Musical and 9 Orchestra rows and leave SISTIC with the
**3** rows carrying the `MICE` genre. That reading was put to Ed and rejected.

### The relevance call is the admin's, and SISTIC is the source that proves why

> *"That is why I still need to have an admin who can manually check if the scraped event is relevant
> or not to tourism/MICE demand."* — Ed, 05 Aug 2026

Free-vs-ticketed is a **judgement about demand**, not a property any source publishes, so no scraper
rule settles it. This is the map's human-in-the-loop moderation premise arriving as a concrete case,
and **SISTIC is the source where the admin's call does the most work** — 284 discrete events, more
than any other, spread across 123 venues of wildly varying pull.

**But SISTIC hands the admin two machine-readable pre-filters that cut the load before a human sees
anything** — worth handing to **#116** / **#120** as screen-design input:

1. **`min_price` absence ≈ the domestic-market tail.** 37 of 367 live rows carry no `min_price`, and
   they are *precisely* the class Ed described: `Esplanade Tour`, `Travel Sketching Workshop`,
   `DuringMyTime.SG`, `Happy Sing Along (Zhongyuan Special)`, `Therukoothu 101`, and the free
   *A Date With Friends* talk/film/workshop side-events. A default-reject on price-less rows removes
   ~10% of the queue and is right far more often than not.
2. **`min_price` magnitude is a demand proxy.** Median **S$48**; **40 rows ≥ S$100**; **17 ≥ S$150**.
   Sorting the moderation queue by `min_price` descending puts the touring stadium acts — the ones
   people actually fly in for — at the top, and the S$15 community recitals at the bottom.

Neither is a rule the pipeline should apply silently — both are **defaults for a human to override**,
which is exactly the shape #116's moderation states are for.

---

## Amendment to `v2-source-acquisition.md`

`docs/research/v2-source-acquisition.md` on `research/v2-source-acquisition` carries the 20-source
table and the `api: 0` headline. If SISTIC is accepted this file should be added as row 21:

| # | Source | Listing URL | API / feed? | ToS + robots verdict | Rendering | Anti-bot | Volume & horizon | **Route** |
|---|---|---|---|---|---|---|---|---|
| 21 | **SISTIC** | `sistic.com.sg/events` | **YES — `cms.sistic.com.sg/sistic/docroot/api/events`, genuinely unauthenticated JSON (tested: answers with no `Authorization` header)** | **No `robots.txt` (404)**; Conditions of Access: access ban **qualified** by interference, republication ban **unqualified**, names scraping + storage | **Client-rendered**, but the API makes it moot; **detail pages browser-only** | Cloudflare, **passive** | **284 discrete events / 367 live**, to **Jul 2027** | **api** 🚩 (terms → #123) |

and the first headline amended: **the score is `api: 1`.**
