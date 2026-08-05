> ✅ **Current.** Nothing supersedes it. [#28](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/28)
> ruled on it ([ADR-0019](../adr/0019-arrivals-summary-is-an-all-day-record.md)) and
> [#126](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/126) — open — builds the
> adapter directly from it: the three silent traps, the read-the-key-at-runtime rule and the ~72-hour
> retention window are all cited there by reference to this document. Its legal reading is the one
> section that has moved on: the Conditions of Use analysis in §7 is now carried, with a verdict, as
> the Changi/CAG row of [`docs/source-register.md`](../source-register.md) under
> [ADR-0021](../adr/0021-reading-sources-that-forbid-it.md).

# Changi arrivals: scrapable, by what route, and at what volume

Research for [#25](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/25). Feeds the ruling on [#28](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/28).

**Method.** Every claim below was established on **04 Aug 2026** (probes run 11:23–11:45 SGT) by fetching the live source with `curl`/`python3 urllib` and reading the returned bytes — the arrivals page markup, its JS bundle, the GraphQL endpoint it declares, `robots.txt`, and the Conditions of Use page. ~90 requests total across two hosts. Nothing here is inferred from a secondary write-up. Where a claim could not be established, it is in **Not established** rather than guessed.

**Ethics note.** No anti-bot measure was defeated and no `robots.txt` directive was violated. The page declares an AWS AppSync API key in its own public markup; consistent with how [`source-capability-audit.md`](https://github.com/edw93d/20260716SingaporeTourismCalendar/blob/research/source-capability-audit/docs/research/source-capability-audit.md) handled the MBCCS credential, the key is **described and located but deliberately not reproduced in this file**. An adapter must read it from the live page at runtime, not hardcode it.

---

## Verdict

| Dataset | Scrapable? | Route | Range established |
|---|---|---|---|
| **Forward — scheduled inbound flights** | **Yes** | **`json-api`** | **today → 2027-08-02 (D+363)**. A week ahead is trivially covered. |
| **Backward — landed inbound flights** | **Yes, but on a ~72-hour leash** | **`json-api`** | full days at **D-1 and D-2 only**; D-3 partial, **D-4 and earlier return nothing** |

**No headless browser is needed for either.** The arrivals page is a client-rendered shell, but it declares — in plain markup — the exact GraphQL endpoint, API key, and query the browser would run. Calling that endpoint directly with `curl` returns the full flight list as JSON. **This is not a second Playwright adapter.** It is an HTTP JSON client, cheaper than the existing `http-scrape` adapters because there is no HTML parsing at all.

**Origin country is published directly.** No airport→country mapping table is needed. See [Fields](#5-fields-published-per-flight).

**Volume: ~498 passenger arrivals/day → ~182,000 raw flight rows/year, versus 365 daily-rollup rows/year.** The three-orders-of-magnitude gap #28 asks about is real: 182k vs 365.

**Legal: this is the finding that should worry the owner.** `robots.txt` does not block the flight paths, and the Conditions of Use contain **no** robot/spider/crawl/scrape/data-mining clause — but they do contain a blanket licence restriction limiting use to *"your own personal and non-commercial use"* and forbidding you to *"copy, reproduce, display, distribute, publish, transmit … store in any information retrieval system"* without written permission. A public tourism calendar republishing this data is squarely inside what that sentence forbids. See [Legal posture](#7-legal-posture).

---

## 1. Rendering: client-rendered shell

A plain `GET` of the seed URL returns **HTTP 200, 204,862 bytes** — and **zero flight rows**.

```
$ curl -sS -A "<browser UA>" https://www.changiairport.com/en/fly/flight-information/arrivals.html
HTTP 200  content-length: 204862  server: Apache
x-dispatcher: dispatcher3apsoutheast1-b86   (Adobe Experience Manager)
via: 1.1 …cloudfront.net (CloudFront)
```

Counts over those raw bytes: flight-number-shaped tokens (`[A-Z]{2}[0-9]{3,4}`) — **0**. The string `Landed` — **0**. `flightNumber` — **0**. `__NEXT_DATA__` — **0**. There is no inline JSON payload and no server-rendered table.

The component is an AEM block that renders nothing server-side:

```html
<div class="flightlisting …">
  <section data-component="flightlisting" data-props="{ … }">
  </section>
</div>
```

**Conclusion: server-rendered — no. Client-rendered — yes.** But see §2: the shell hands you everything you need to skip the browser entirely.

Source: `https://www.changiairport.com/en/fly/flight-information/arrivals.html` (fetched 04 Aug 2026).

---

## 2. The data endpoint — declared in the page's own markup

The `data-props` attribute on that empty `<section>` contains, in clear text:

```json
{
  "appSyncApiKey": "da2-…",              // 26-char AWS AppSync key, present verbatim in the page
  "appSyncApiEndpoint": "https://ca-appsync.lz.changiairport.com/graphql",
  "type": "passenger",
  "direction": "arr",
  …
}
```

The client bundle `https://www.changiairport.com/etc.clientlibs/changiairport/clientlibs/clientlib-site.min.672c5f1772cd0fd573e9ec96c6dc92c1.js` (4.6 MB) POSTs to that endpoint with exactly two headers:

```js
{ url: appSyncApiEndpoint, method: "post", data: { query },
  headers: { "Content-Type": "application/json", "x-api-key": appSyncApiKey } }
```

**Auth model, verified:**

| Request | Result |
|---|---|
| POST with `x-api-key` | **HTTP 200**, full JSON |
| POST **without** `x-api-key` | **HTTP 401** |

So: **no login, no cookies, no session, no CSRF token, no Referer requirement.** One static header, whose value the site publishes itself. Response headers show `x-amzn-appsync-tokensconsumed: 1` and CloudFront (`x-amz-cf-pop: SIN3-P2`) — a standard AWS AppSync GraphQL API behind CloudFront.

**A working unauthenticated-in-practice JSON endpoint. This is the finding that changes the cost of the source.**

---

## 3. The query

Reconstructed verbatim from the bundle's `flightListingQueries` template. The operation is `getFlights`, and **every argument is a string**, including numeric ones:

```graphql
query {
  getFlights(
    direction: "ARR"                 # "ARR" | "DEP"
    scheduled_date: "2026-08-11"     # YYYY-MM-DD — see §4, it is a CURSOR not a filter
    page_size: "1000"
    terminal: "t1"                   # optional
    prev: "true"                     # optional — scan backwards from the anchor
    next_token: "…"                  # optional — pagination cursor
    load_freighter: "true"           # optional — cargo listing; omit for passenger
  ) {
    next_token
    flights {
      flight_number master_flight_number slave_flights
      airline airline_details { code name logo_url }
      airport airport_details { code name country_code lat lng }
      origin_dep_country origin_dep_date origin_dep_time origin_dep_terminal
      via via_airport_details { code name country_code } origin_via_country
      scheduled_date scheduled_time
      estimated_timestamp actual_timestamp display_timestamp last_updated_timestamp
      flight_status status_mapping { listing_status_en status_text_color show_gate }
      terminal display_belt display_gate current_gate check_in_row
      aircraft_type nature flight_type
      firstbag_timestamp lastbag_timestamp offblock_timestamp
    }
  }
}
```

The page's own date picker writes `?date=YYYY-MM-DD` and `?terminal=` into the browser URL and reads them back with `new URLSearchParams(window.location.search).get("date")` — so the ticket's seeded `?date=` param is real, but it is **consumed client-side only** and maps to the API's `scheduled_date`. Fetching `arrivals.html?date=2026-08-11` over HTTP still returns the empty shell (HTTP 200, no rows).

---

## 4. The date parameter — range, and a trap

### It is a cursor, not a filter

`scheduled_date` positions a scan in a date-ordered store; it does **not** constrain results to that date. Two observed consequences:

- A page requested for `2026-08-05` reliably **spills over into `2026-08-06`** once the day is exhausted.
- A request for a date **before retention** (e.g. `2025-08-04`) returns rows dated `2026-01-24`, `2026-06-13`, `2026-07-13`… — i.e. *the next available records*, not an empty set.

The site's own JS does the same thing an adapter must: it discards every row whose `scheduled_date` differs from the requested date. **An adapter that trusts the parameter will silently ingest the wrong days.** This is the single biggest correctness pitfall in the source.

### Forward horizon — 363 days

Full days confirmed at D+1, D+3, D+7, D+10, D+14, D+21, D+30, D+60, D+90, D+120, D+150, D+180, D+240. Binary search on the boundary:

| Requested date | Rows for that date |
|---|---|
| 2027-07-31 (D+361) | present |
| **2027-08-02 (D+363)** | **present — last day with data** |
| **2027-08-03 (D+364)** | **0 — first empty day** |

Sample full-day counts far out: **2026-12-25 → 495 arrivals**, **2027-02-14 → 502 arrivals**. Forward data is the *published schedule*, complete and evenly distributed across the clock (first row 00:05 every time).

**A week ahead is not a stretch for this source; it is 2% of what it serves.**

### Backward horizon — roughly 72 hours, then nothing

Measured on 04 Aug 2026 at ~11:30 SGT, requesting each past date with `page_size:"1000"` and counting only rows whose `scheduled_date` matches:

| Date | Offset | Rows | Earliest row |
|---|---|---|---|
| 2026-08-03 | D-1 | **501** (all `Landed`) | 00:05 |
| 2026-08-02 | D-2 | **504** | 00:05 |
| 2026-08-01 | D-3 | **19** | **13:55** — day truncated |
| 2026-07-31 | D-4 | **0** | — |
| 2026-07-30 | D-5 | **0** | — |
| 2026-07-21 | D-14 | **0** | — |

The truncation point on D-3 (13:55) is ~69.5 hours before the probe. **The store keeps a rolling window of roughly 72 hours.** It is not a fixed calendar cutoff; it slides.

**Implication for the landed feature: it can be built, but only as an incremental harvester.** You must fetch each day within ~2 days of it happening and persist the result yourself. There is **no backfill** — a scraper that is down for three days loses those days permanently, and there is no way to recover them from this source.

### Today is special — anchored at "now"

For the current date, the forward scan starts at the current clock time, not 00:00. On 04 Aug 2026 at 11:23 SGT:

- `scheduled_date:"2026-08-04"` → 344 rows, **11:00 → 23:55**
- `scheduled_date:"2026-08-04", prev:"true"` → 144 rows, **10:55 → 00:05** (descending)
- Together: **488 rows** = the full day

**Today requires two queries, one of them with `prev:"true"`.** Past and future dates do not (they start at 00:05).

---

## 5. Fields published per flight

Real record, verbatim from the endpoint (04 Aug 2026):

```json
{
  "flight_number": "HU747",
  "master_flight_number": "HU747",
  "slave_flights": null,
  "airline": "HU",
  "airline_details": { "code": "HU", "name": "Hainan Airlines" },
  "airport": "HAK",
  "airport_details": { "code": "HAK", "name": "Haikou", "country_code": "CN",
                       "lat": "19.93490028", "lng": "110.4589996" },
  "origin_dep_country": "CN",
  "origin_dep_date": "2026-08-04",
  "origin_dep_time": "07:35",
  "origin_dep_terminal": "2",
  "origin_via_country": null,
  "via": null,
  "scheduled_date": "2026-08-04",
  "scheduled_time": "11:00",
  "estimated_timestamp": "2026-08-04 10:28",
  "actual_timestamp": "2026-08-04 10:28",
  "display_timestamp": "2026-08-04 10:28",
  "last_updated_timestamp": "2026-08-04T11:01:22.00000",
  "flight_status": "Landed",
  "status_mapping": { "listing_status_en": "Landed 10:28", "status_text_color": "Black" },
  "terminal": "4",
  "display_belt": "2",
  "aircraft_type": "B738",
  "nature": "J",
  "flight_type": "M",
  "direction": "ARR"
}
```

### Origin country IS published — no mapping table needed

This is the direct answer to #25's first question, and it goes the owner's way. **Two independent country fields ship per flight:**

- `origin_dep_country` — ISO-3166 alpha-2, e.g. `"CN"`
- `airport_details.country_code` — the same code, derived from the airport

On a 501-row day (2026-08-03): `origin_dep_country` null on **3 rows**; `airport_details` null on **1 row**. Where both are present they **never disagreed** (0 mismatches). So `origin_dep_country` with `airport_details.country_code` as fallback covers ~99.8% of rows, and the residual is a handful per day.

**No static airport→country table is needed, and no such dependency enters the project.** For reference, across 7 sampled days there were **170 distinct origin airports** and **49 distinct countries** — that table would not have been small.

`via` / `origin_via_country` are populated on **18 of 501** rows (~3.6%) — e.g. `LAX` via `NRT`, `HRB` via `SZX`. Useful for one-stop routes; still not passenger provenance (see the caveat below).

### Status vocabulary

Observed values of `flight_status`, across 3,489 rows over 7 days:

| Value | Count | Meaning |
|---|---|---|
| `null` | 1,999 | future days — status not yet assigned |
| `Landed` | 1,002 | past days |
| `Scheduled` | 484 | D+1 |
| `Cancelled` | 3 | |
| `Confirmed` | 1 | |

`status_mapping.listing_status_en` is the human string the site renders (`"Landed 10:28"`). **Delayed** was observed on an out-of-window record. `flight_status` being `null` for anything beyond ~D+1 is important: **the forward feature cannot filter on status; it must treat every forward row as scheduled.**

### Codeshares are already collapsed

`flight_type` was `"M"` (master) on **959/959** rows. Codeshare partners appear as an array on the master:

```json
"slave_flights": ["QR5499","FY7329","HY7597","WY5616","AY6736","SQ5609"]
```

**The listing does not double-count codeshares** — 955/959 rows had `master_flight_number == flight_number`. No dedup work is required; a naive count is already the aircraft count, not the marketing-flight count.

### Freighters are excluded by default

`nature` was `J` on 3,471/3,489 rows (`G` on 17, `W` on 1 — all scheduled passenger carriers: Scoot, SIA, China Southern, Shenzhen Airlines). Cargo flights (`nature: "F"`, e.g. SF Airlines, FedEx, Qatar Cargo) appear **only** when `load_freighter:"true"` is passed. **The passenger query is already the right query** for a tourism proxy.

### The proxy's validity limit — unchanged by any of this

`origin_dep_country` is where the **aircraft** departed, not where the **passengers** started. A Frankfurt–Singapore flight full of connecting Europeans reports `DE`. Changi is a hub; a large share of its inbound load is one-stop. **The endpoint publishes country cleanly, which removes the mapping objection — it does not make flight count a passenger count, and it does not make departure airport a tourist origin.** An A380 and a turboprop each count 1. Both limits are #28's to weigh, not this note's.

---

## 6. Pagination and volume

**Pagination** is opaque-cursor: the response carries `next_token` (base64 of a DynamoDB-style key: `{"flight_number":"TR431","scheduled_date_dir":"2026-08-04#ARR", …}`); pass it back as `next_token:"…"` to continue.

**Page size** is a string argument. The site itself uses `page_size:"20"`. Observed behaviour:

| Requested | Returned |
|---|---|
| `"100"` | 100 |
| `"500"` | 500 |
| `"1000"` | **563** — capped by a server-side response-size limit |

So `page_size:"1000"` is safe and self-limiting; **a full day is 1–2 requests**, versus 25 at the site's own page size.

**Daily volume** — full-day arrival counts, counting only rows matching the requested `scheduled_date`:

| Date | Arrivals |
|---|---|
| 2026-08-02 | 504 |
| 2026-08-03 | 501 |
| 2026-08-04 (today, both scans) | 488 |
| 2026-08-05 | 485 |
| 2026-08-08 | 507 |
| 2026-08-11 | 495 |
| 2026-12-25 | 495 |
| 2027-02-14 | 502 |

**Mean ≈ 497 passenger arrivals/day.** Remarkably flat — the spread across a Tuesday, a Saturday, Christmas Day and Valentine's Day six months out is under 5%.

**The two numbers #28 asked for:**

| Storage shape | Rows/year |
|---|---|
| **Raw flight rows** | **~181,000** (497 × 365) |
| **Daily rollup** (one record per day) | **365** |
| *(Middle option)* country × day | **~15,300** (~42 countries/day × 365) |

Note the ticket's "even at ~1,000 arrivals/day" estimate is ~2× high — 1,000 is arrivals **plus** departures. It does not change the order of magnitude: **~181k vs 365 is still three orders of magnitude.**

Distinct countries per day: **41–43**. Top origins on 2026-08-05: CN 73, MY 64, ID 62, TH 37, AU 36, IN 30 — the shape the owner's mock-up ("*most number of flights: 10 flights from china…*") assumed, at roughly 7× the magnitude.

---

## 7. Legal posture

### robots.txt — does not block the flight paths

`https://www.changiairport.com/robots.txt`, quoted in full:

```
User-agent: *
Disallow: /en/prog/
Disallow: /au/en/prog/
Disallow: /cn/en/prog/
Disallow: /in/en/prog/
Disallow: /bin/

Sitemap: https://www.changiairport.com/sitemap-index.xml
```

**Five `Disallow` rules, one group, no AI-specific agents, no crawl-delay.** `/en/fly/flight-information/` is not covered. `/bin/` is disallowed — that is AEM's servlet path, and the only `/bin/` URLs in the arrivals page are `ciam/login.data` and `ciam/logout.data`, which are irrelevant here. **The GraphQL endpoint is on a different host** (`ca-appsync.lz.changiairport.com`), which serves **no `robots.txt` at all** (HTTP 404 with an AppSync error body) — so no directive applies to it either. **Verified: nothing in `robots.txt` prohibits fetching the arrivals page or the API.**

### Conditions of Use — no anti-robot clause, but a hard licence restriction

Source: `https://www.changiairport.com/en/by-laws-and-conditions-of-use.html` (fetched 04 Aug 2026; the footer's only terms link).

Grep over the full extracted text for `robot`, `spider`, `scrape`, `scraping`, `crawl`, `automat`, `data mining`, `harvest`, `systematic`:

> **Verified absence.** Not one of those terms appears anywhere in the document. Unlike Ticketmaster SG (see the source-capability audit), **Changi does not ban robots by name.**

The only hit for `extract` is about the Max Chatbot's source code, not data. But the operative clause is this, quoted verbatim under the heading **"Restrictions on access and use"**:

> "You may download one copy of the material on this Changi Airport Group Website, but only on a single computer and only for your own personal and non-commercial use, provided that 1. All copies must bear the relevant copyright, trademark and/or other proprietary notice located on this Changi Airport Group Website; and 2. **You shall not modify, reformat, copy, reproduce, display, distribute, publish, transmit, post, upload, licence, create derivative works from, hyperlink, store in any information retrieval system, transfer in any manner or sell any of the material, without written permission from Changi Airport Group.**"

And:

> "Changi Airport Group reserves the right to deny anyone at anytime access to this—or any other—Changi Airport Group Website or Max Chatbot without notice or need to assign any reason whatsoever."

Also present, and relevant to the proxy's reliability, the page-level disclaimer on the arrivals page itself:

> "Every effort has been made to ensure the information provided is correct. The dates, times and other details shown in the tables may, from time to time, be changed without notification. CAG and/or its agents, employees or contractors are not responsible for any incorrect information…"

**Assessment.** The absence of an anti-robot clause means **fetching** is not itself prohibited by the terms. But the restriction is drafted around **use**, and it is unusually broad: *personal and non-commercial*, no *reproduce*, no *display*, no *distribute*, no *publish*, no *derivative works*, and explicitly no *store in any information retrieval system* — which is a literal description of a scraper's database. A calendar that republishes daily arrival counts to tourism professionals is **display, distribution, publication, derivative work, and storage in an information retrieval system**, and is plausibly commercial. This is materially stricter than any of the four seed sources audited under #2, and #3's facts-only conditional-go does not extend to it.

**This does not decide anything — but #28 should not treat Changi as legally equivalent to the seed sources. It is not.** A derived aggregate statistic ("140 flights landed, most from China") is a weaker target for that clause than a verbatim flight table, and CAG grants written permission on request for other things (film/photo, tours), so **asking is a live option**. Both are judgement calls above this note's pay grade.

---

## 8. Anti-bot

**Passive. Nothing observed.**

| Probe | Result |
|---|---|
| Plain `curl`, browser UA, arrivals page | **HTTP 200**, full 205 KB shell |
| Plain `curl`, **no** UA header, `?date=…` | **HTTP 200** |
| 15 rapid consecutive GraphQL POSTs | **15 × HTTP 200**, no throttle, no delay |
| ~90 requests over ~20 minutes across both hosts | no challenge, no 403, no CAPTCHA, no silent drop |

Infrastructure is CloudFront in front of AEM Dispatcher (web tier) and CloudFront in front of AWS AppSync (data tier). **No Cloudflare, no Imperva, no Akamai, no JS challenge.** The API key is the only gate, and it is published in the page.

**Not established:** whether AppSync enforces a per-key rate limit or quota at higher volume. `x-amzn-appsync-tokensconsumed: 1` per request implies metering exists. A daily harvester needs ~2 requests/day; this is a non-issue at the volume this project would generate.

---

## 9. Is there a sanctioned route instead?

**Effectively no.** Three checks:

### Changi's own developer portal — exists, publishes nothing publicly

`https://developer.changiairport.com/` is a real Apigee developer portal (`siteid: changiairport-developer`), with a nav of Home / Get Started / **APIs** / Sign Up. Its public API catalogue endpoint returns:

```
GET /portals/api/sites/changiairport-developer/liveportal/apis  → HTTP 200
{"apiDocs": [], "apiProducts": [], "apiCategoryList": []}
```

**Verified: zero API products are exposed to an anonymous visitor.** The authenticated catalogue (`/apidocs`) returns HTTP 401 without a bearer token. Whether a flight-information API exists behind sign-up is **not established** — settling it requires creating an account, which was not done.

### data.gov.sg / CAAS — monthly totals, no country, no day

The live CAAS dataset is **Air Traffic Movements** (`d_744e62bfb1c524508bce0a64a2488243`, managed by Civil Aviation Authority of Singapore):

- Granularity: **by Month**. Columns: `Year`, `Month`, `Aircraft_Arrival`, `Aircraft_Departure`, `Passenger_Arrival`, `Passenger_Departures`, `Passenger_Transit`, cargo and airmail totals.
- Coverage **2015-01-01 → 2026-06-30**; last updated 31 Jul 2026 — i.e. **a ~1-month reporting lag**.
- **No origin country or region dimension at all.**

Two datasets that *did* carry geography — *Total Air Passenger Arrivals by Region* (`d_552887b6…`) and *Total Air Passenger Departures by Country* (`d_63376918…`) — now return `DATASET_DOES_NOT_EXIST` from the data.gov.sg v2 metadata API. **They have been unpublished.**

**#4's finding about data.gov.sg holds here too, and for the same reason.** #25 was right that a backward-looking feature might rescue the objection — but it doesn't, because the blocker is not direction of time, it is **granularity**. A monthly national total, one month late, with no country breakdown, cannot produce *"140 flights landed, most from China"* on any given day. It is a useful **sanity check** on the scraped numbers (does our monthly sum of arrivals track CAAS's `Aircraft_Arrival`?) and nothing more.

### Commercial aviation APIs

AirLabs, FlightLabs, Aviation Edge and similar all sell SIN arrival/departure feeds with historical depth. **These are paid, licensed, and would solve the ~72-hour retention problem outright.** Pricing and terms **not established** — no vendor page was priced during this research. If the landed-history feature survives #28 and the retention window is the blocker, this is where to look next.

---

## How to scrape it

Concrete steps. Both datasets use the **same endpoint and the same query** — they differ only in which dates you ask for and which fields you read.

**1. Read the key from the live page, do not hardcode it.**

```
GET https://www.changiairport.com/en/fly/flight-information/arrivals.html
```
Parse `data-props` off `<section data-component="flightlisting">`, HTML-unescape it, `JSON.parse` it, take `appSyncApiKey` and `appSyncApiEndpoint`. It is an AWS AppSync key and **will be rotated eventually** — reading it per-run costs one request and makes the adapter self-healing. Cache it for the run; refetch on the first 401.

**2. Call the endpoint.**

```
POST https://ca-appsync.lz.changiairport.com/graphql
Content-Type: application/json
x-api-key: <from step 1>

{"query": "query { getFlights(direction: \"ARR\", scheduled_date: \"2026-08-11\", page_size: \"1000\") { next_token flights { flight_number airline_details { code name } airport airport_details { code name country_code } origin_dep_country via origin_via_country scheduled_date scheduled_time estimated_timestamp actual_timestamp flight_status status_mapping { listing_status_en } terminal display_belt aircraft_type nature } } }"}
```

Note: **all arguments are strings**, including `page_size`. Omit `load_freighter` — that excludes cargo, which is what you want.

**3. Page until the day is done.**

Loop: keep the response's `next_token`, pass it back as `next_token:"…"`. Stop when `next_token` is null, when a page is empty, **or as soon as any row has `scheduled_date > your date`** — the store is date-ordered, so that row proves the day is exhausted. At `page_size:"1000"` this is 1–2 iterations per day.

**4. Filter client-side. Always.**

```
rows = [f for f in flights if f["scheduled_date"] == requested_date]
```
`scheduled_date` is a **scan cursor, not a filter**. Skipping this silently ingests neighbouring days, and for out-of-retention dates it ingests arbitrary unrelated dates. The site's own JS does exactly this filter.

**5. Special-case today.** For the current date, run the query twice — once plain (returns *now → 23:55*) and once with `prev:"true"` (returns *now → 00:05*, descending). Union and dedupe on `flight_number` + `scheduled_time`. Past and future dates need one scan.

**6. Read these fields.**

| Want | Field | Fallback |
|---|---|---|
| origin country | `origin_dep_country` (ISO-2) | `airport_details.country_code` |
| origin airport | `airport` / `airport_details.name` | — |
| scheduled time | `scheduled_date` + `scheduled_time` (`"HH:mm"`, **SGT, no offset**) | — |
| actual landing | `actual_timestamp` (`"YYYY-MM-DD HH:mm"`, **SGT, no offset**) | `display_timestamp` |
| status | `flight_status` (`Landed`/`Scheduled`/`Cancelled`/`Delayed`/`Confirmed`/**null**) | `status_mapping.listing_status_en` |
| airline | `airline_details.name` | `airline` (IATA-2) |
| terminal / belt | `terminal`, `display_belt` | — |

**7. Cadence.**

- **Forward (scheduled):** one run per day covers D+0…D+7 in ~8–16 requests. Data exists to D+363, so any horizon is affordable.
- **Backward (landed):** **must run at least every 48 hours.** Ask for D-1 (complete and fully `Landed`). Retention is a rolling ~72 hours with no backfill — **a missed window is data lost forever.**

### Pitfalls

1. **`scheduled_date` is a cursor, not a filter.** The #1 correctness bug. Filter client-side.
2. **No backfill, ~72-hour retention.** The landed feature is only as complete as your uptime. Design for gaps; there is no repair path from this source.
3. **Today is anchored at "now"** — needs the second `prev:"true"` scan or you lose the morning.
4. **All GraphQL args are strings.** `page_size: 1000` (unquoted) is a schema error.
5. **`page_size:"1000"` returns ~563**, not 1000 — a server-side response-size cap. Always follow `next_token`; never assume one page is the whole day.
6. **All times are SGT with no timezone marker.** `"2026-08-04 10:28"`. ADR-0003 requires UTC instants — attach `Asia/Singapore` (UTC+8, no DST) at parse time. Silently treating them as UTC shifts every record 8 hours.
7. **`flight_status` is `null` beyond ~D+1.** The forward feature cannot filter on status.
8. **The API key rotates.** Read it from the page; treat 401 as "refetch the key", not "source is down".
9. **Sparse nulls:** `origin_dep_country` null on ~0.6% of rows, `airport_details` on ~0.2%. Do not assume presence.
10. **Do not confuse `estimated_timestamp` with `actual_timestamp`.** Before landing they differ; after landing both settle to the actual. For a landed rollup use `actual_timestamp` and require `flight_status == "Landed"`.

---

## Not established

- **Whether the CAG developer portal offers a flight API behind sign-up.** The anonymous catalogue is verifiably empty; `/apidocs` returns 401. **Settled by:** creating an account at `https://developer.changiairport.com/accounts/create` and re-reading the catalogue. Not done — account creation was out of scope for a read-only audit.
- **Whether the AppSync API key is rate-limited or quota'd.** 15 rapid requests and ~90 total drew no throttle, and `x-amzn-appsync-tokensconsumed: 1` shows metering exists. **Settled by:** a sustained load test — which would be discourteous and is unnecessary at ~2 requests/day.
- **The exact retention boundary in hours.** Established as *between 48 and 72 hours* (full day at D-2, truncated at 13:55 on D-3, empty at D-4), from a single probe at one clock time. Whether it is a fixed 72-hour TTL or a nightly job is **not established**. **Settled by:** repeating the D-3 probe at several times of day over a week and watching where the truncation point sits.
- **Why a handful of out-of-window records survive** (a request for 2025-08-04 surfaced rows dated 2026-01-24 and 2026-06-13; 2026-07-28 returned 2 stragglers on one probe and 0 on another). Probably long-delayed or diverted flights left in the store. **Not** a usable history: they are individual rows, not days. **Settled by:** dumping every row the store will yield from an early cursor and checking their statuses.
- **Whether `page_size` above 1000 is accepted** or where the response-size cap sits precisely. 1000 → 563 rows was the only over-cap probe.
- **Pricing and licence terms of commercial aviation APIs** (AirLabs, FlightLabs, Aviation Edge) as an alternative for landed history. Not priced.
- **Whether CAG would grant written permission** for republication under the Conditions of Use. They operate a written-permission process for filming and tours; no equivalent data channel was found. **Settled by:** asking.
- **Departure-side coverage.** `direction:"DEP"` is the same query and presumably behaves identically, but was **not** probed — this research was scoped to arrivals.
