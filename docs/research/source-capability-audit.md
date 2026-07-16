# Source capability audit: what the seed sources actually expose

Resolves [#2](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/2). Answers challenges #1, #4, #5 of the original brief.

**Method.** Every claim below was established by fetching the live source with `curl` (browser UA, a handful of requests per host) on **2026-07-16** and reading the returned bytes — markup, response headers, JS bundles, `robots.txt`, and terms pages. Nothing here is inferred from secondary write-ups. Where a claim could not be established without a credential or an API key, it is marked **UNVERIFIED** rather than guessed.

**Ethics note.** No anti-bot measure was defeated, and no `robots.txt` directive was violated. One live credential was discovered in a public bundle (see MBCCS); it is described but deliberately **not reproduced** in this file.

---

## Summary

| Source | Public API | Structured data | Rendering | Anti-bot | **End times?** |
|---|---|---|---|---|---|
| **Suntec** | No (Squarespace JSON/iCal endpoints exist but are `robots.txt`-disallowed) | No schema.org `Event`; **Google Calendar export links carry UTC start+end** | **Server-rendered**, 154 events in 1 request | **None observed** | **Yes — 154/154** |
| **Ticketmaster SG** | Discovery API exists — **no SG market coverage** | None | Server-rendered listing | **Yes** — bot-block on detail pages + ToU bans robots | **No — date only** |
| **MBCCS** | Undocumented JSON API, **Basic-auth gated** | `__NEXT_DATA__` empty (client-fetched) | **JS-hydrated** | None on web tier; API 401s unauthenticated | **Yes** (`unberthingDateTime`) |
| **Singapore Cruise Centre** | No | Yoast JSON-LD (`WebPage` only, no `Event`) | **Server-rendered HTML table** | Imperva WAF present but **passive** | **Yes** (departure column) |

**Headline: end times exist on three of four sources.** The manual Excel's start/end assumption survives — except at Ticketmaster, which publishes dates with no times at all. That is the one place the schema assumption breaks, and it breaks hard.

**Second headline: the Ticketmaster seed URL is the wrong URL.** `ticketmaster.sg/venues` is a venue *directory*. It contains no events and no dates whatsoever.

---

## 1. Suntec — `https://www.suntecsingapore.com/visit-events`

The best source of the four by a wide margin. Recommend building this scraper first.

### API
No public/documented API. The site is **Squarespace** (`server: Squarespace` response header; `Static.SQUARESPACE_CONTEXT` in page). Squarespace's stock `?format=json` and `?format=ical` endpoints exist, and each event links its own `?format=ical`, e.g. `/visit-events/bni-vision1472026?format=ical`.

**These are unusable:** `https://www.suntecsingapore.com/robots.txt` disallows them for every agent:
```
Disallow:/*?format=json
Disallow:/*?format=ical
```
A crawler honouring `robots.txt` cannot use the iCal or JSON endpoints. **This does not matter** — see below.

Note on AI crawlers: the `robots.txt` lists `ClaudeBot`, `GPTBot`, `anthropic-ai` etc., but they are stacked as consecutive `User-agent:` lines terminating in `User-agent: *` and sharing the `*` group's rules. There is **no `Disallow: /`** — Squarespace's AI-blocking toggle is *not* enabled. AI agents are allowed under the same rules as anyone else.

### Structured data
JSON-LD is present but useless for events — only `WebSite`, `Organization`, and `LocalBusiness`. **No schema.org `Event` markup.**

**The find that matters:** every event renders a Google Calendar export link whose `dates` parameter carries a full **UTC start/end interval**:
```
http://www.google.com/calendar/event?action=TEMPLATE
  &text=Cellar%20Fiesta%202026%20
  &dates=20260717T040000Z/20260718T140000Z
  &location=1%20Raffles%20Boulevard%20Suntec%20City%2C%20Level%204%2C%20Hall%20404%2C%20Singapore
```
**154 of 154 events** carry a well-formed `\d{8}T\d{6}Z/\d{8}T\d{6}Z` interval. This delivers unambiguous UTC start+end **and** a richer location string, from the ordinary page, without touching the disallowed iCal endpoint.

This matters because the visible `<time>` tags are a trap — their `datetime` attribute is **date-only**, with the clock time only in the text node:
```html
<time class="event-time-localized-start" datetime="2026-07-14">07:30</time>
<time class="event-time-localized-end"   datetime="2026-07-14">11:30</time>
```
Parsing `datetime` alone silently loses the time. **Parse the Google Calendar link, not the `<time>` tags.**

Site timezone is `"timeZone":"Asia/Singapore"` (from `SQUARESPACE_CONTEXT`).

### Rendering
**Fully server-rendered.** One request to `/visit-events` returned 2.4 MB containing **154 `<article class="eventlist-event">`** — 124 upcoming, 30 past — spanning **2026-06-28 → 2026-09-29** (~3 months forward). No headless browser needed. No pagination links present; the whole window is in one response.

### Anti-bot
**None observed.** Plain `curl` with a browser UA returned HTTP 200 and full content. No Cloudflare, no challenge, no CAPTCHA. Only a `crumb` cookie (Squarespace CSRF, irrelevant to reads).

### Fields
| Field | Present | Format |
|---|---|---|
| name | **154/154** | `<h1 class="eventlist-title">` text |
| start | **154/154** | UTC via gcal `dates` |
| **end** | **154/154** | UTC via gcal `dates` |
| location | **154/154** | gcal `location` param — **13 distinct values**, hall-level (`…Level 4, Hall 403-404, Singapore`) |
| description | **13/154 (~8%)** | `<div class="eventlist-description">`; the div exists on all 154 but is empty/trivial on 141 |

**Description is sparse — ~8% populated.** The Excel schema carries description; for Suntec it will be blank most of the time. This is a source-data fact, not a scraper defect.

---

## 2. Ticketmaster SG — `https://ticketmaster.sg/venues`

The problem child: legally hostile, technically defended, and missing the one field the schema needs.

### The seed URL contains no events
`/venues` is a **venue directory**. It renders 27 venue names (Apex @ EXPO, National Stadium, Singapore Indoor Stadium, … including Suntec itself) linking to `/venues/<slug>`. **No dates, no times, no events.** Events live at `/activity` and `/activity/detail/<id>`.

### API — Discovery does *not* cover Singapore
Checked against the primary doc, `https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/`:

- **`SG (Singapore)` does appear** in the *Supported Country Codes* ISO enum.
- **But the enum is not coverage.** The doc's own *Event Coverage* prose: *"With over 230K+ events available in the API, coverage spans different countries, including United States, Canada, Mexico, Australia, New Zealand, United Kingdom, Ireland, other European countries, and more."* — **Asia is not mentioned.**
- **Decisively:** the *Supported Markets* list contains market IDs only for **USA, Canada, Europe** (UK/IE/DE/NL/SE/ES/TR), **Australia & New Zealand**, and **Mexico**. **There is no Singapore market. No Asian market of any kind except Turkey.**
- Terms: default quota **5000 calls/day, 5 requests/second**; deep paging capped at `size * page < 1000`.

**UNVERIFIED:** whether `events.json?countryCode=SG` returns a non-empty set. Confirming needs an API key, which I did not register for. The structural evidence above says it will be empty or near-empty.

Corroborating: `ticketmaster.sg` runs a **Yii PHP** stack (`_csrf`, `TIXPUISID` cookies, `server: Apache`, assets on `static.ticketmaster.sg`) — entirely unlike Ticketmaster's global Discovery-backed platform. Its `sitemap.xml` was *"created with Free Online Sitemap Generator www.xml-sitemaps.com"* and every `lastmod` is **2020-07-24**. This is a separately-run local property whose inventory plausibly never reaches Discovery. Operator per the ToU is **Ticketmaster-Singapore Pte. Ltd.**

### Structured data
**None.** Zero `application/ld+json` blocks on `/venues`, `/activity`, or venue pages.

### Rendering
Listing pages are **server-rendered** — `/activity` returned 83 KB of readable event HTML to plain `curl`.

### Anti-bot — confirmed, with evidence
Event **detail** pages block non-browser clients:
```
GET https://ticketmaster.sg/activity/detail/26sg_lijian
→ HTTP/2 401
   content-type: application/json
   tm-bl: 1
   esid: hOq3DQtX-1jcHXMZPDcZNdxw5wllgyEwj-g5Ux7-yEsIJ73F92xASnNKnh1WDh91jVGOTc2zW-1VKJMZ
   {"response":"identify"}
```
`tm-bl` reads as a bot-block flag; `{"response":"identify"}` is a device-identification challenge. Reproduced with a warmed cookie jar and a `Referer` — **still 401**. Listing (`/activity`) and venue (`/venues/apex-expo`) pages returned 200; the defence is scoped to detail pages. **Not probed further, and no attempt made to circumvent.**

**The Terms of Use prohibit scraping outright** (`https://ticketmaster.sg/terms-of-use`):

> *"You agree that you will not use any robot, spider, other automatic device, or manual process to monitor or copy our web pages or the content contained thereon or for any other unauthorised purpose without our prior express written permission."*

> *"…unauthorised use of any robot, spider or other automated device on the site, will be investigated and appropriate legal action will be taken, including without limitation civil, criminal and injunctive redress."*

Governed by Singapore law. Unlike the other three sources, this is an **explicit contractual prohibition backed by a working technical block**.

### Fields — no times at all
`/activity` publishes **dates only**:
```
17 Jul 2026 (Fri.)                        “万物安生时”李健世界巡回演唱会
24 Jul 2026 (Fri.) ~ 26 Jul 2026 (Sun.)   EXO PLANET #6 - EXhOrizon in SINGAPORE
24 Jul 2026 (Fri.)                        [CANCELLED] Mo Gilligan …
```
| Field | Present | Notes |
|---|---|---|
| name | Yes | includes `[CANCELLED]` status inline |
| start | **Date only** | `DD MMM YYYY` — **no clock time** |
| **end** | **Absent** | the `~` range is the *run* of a multi-performance engagement, not a start–end interval |
| location | **Not on listing** | only on detail pages, which are blocked |
| description | No | |

**The `~` range is a trap.** `24 Jul ~ 26 Jul` for EXO means three separate performances, not one 3-day event. Treating it as start/end would fabricate a 72-hour event. Real per-performance times exist only on the blocked detail pages.

---

## 3. Marina Bay Cruise Centre — `https://mbccs.com.sg/cruise-information?tab=cruise-schedule`

### Rendering — JS-hydrated
**Next.js.** `__NEXT_DATA__` carries `"pageProps": {}` with `"__N_SSP": true` — **no data server-rendered**. The initial HTML renders only the shell and the empty state, verbatim:
> *"Vessel  Pier Number  Arrival  Departure  There are no scheduled cruises."*

Scraping the HTML yields nothing. This source needs **either a headless browser or the API**.

### API — undocumented, and gated by a leaked credential
The page chunk `/_next/static/chunks/pages/cruise-information-b363620c68123976.js` calls:
```
GET https://api.mbccs.com.sg/sats-webfront-api/v1/cruise/schedule
    ?vesselId=&startDate=&endDate=&size=20&page=1
```
Sibling endpoints: `/cruise/vessel-config`, `/cruise/lines`, `/cruise/destinations`. Response is `{ Code, Message, Data: { …, totalPageCount } }`.

Unauthenticated it returns:
```
HTTP/2 401  {"Code":400,"Message":"Missing Authorization Header!","Data":null}
```

**Security finding.** `/_next/static/chunks/pages/_app-3a77ce959b375f70.js` contains a hardcoded **HTTP Basic username and password**, shipped to every visitor's browser, used as the fallback when no bearer token is present:
```js
a.baseURL = " https://api.mbccs.com.sg/sats-webfront-api/v1",
n ? a.headers.Authorization = "Bearer " + n
  : a.auth = { username: "«REDACTED»", password: "«REDACTED»" }
```
**The literal values are deliberately not reproduced here.** They are static, shared, operator-owned credentials — not ours.

**This is not a viable ingest strategy, and shouldn't be treated as one.** Three reasons: (1) authenticating with someone else's leaked credential is plausibly unauthorised access under the Singapore Computer Misuse Act, whatever the client-side exposure implies; (2) it is one rotation away from breaking with no notice; (3) MBCCS's ToU vests all content IP in SCCS and forbids reproducing, publishing, or distributing it. **Recommend contacting SCCS for API access, or driving the page with a headless browser and reading the rendered table.** Worth reporting the credential exposure to them at the same time.

### Structured data
None — no JSON-LD, `__NEXT_DATA__` empty by design.

### Anti-bot
None observed on the web tier — CloudFront (`x-amz-cf-pop: SIN2-P8`), HTTP 200, no challenge. The API's 401 is an auth gate, not a bot defence.

### Fields
From the table renderer in `/_next/static/chunks/785-3db43c83b69db27a.js`:

| API field | Maps to | Format |
|---|---|---|
| `vesselName` | name | string; `"-"` fallback when null |
| `berthingDateTime` | **start** | parsed `Asia/Singapore`; displayed `dd MMM yyyy hh:mm a` |
| `unberthingDateTime` | **end** | same — **end times exist** |
| `berthNo` | location | pier number; venue itself is implicitly MBCCS |
| `id` | source key | |

**No description field.** Default view window is narrow — the page loads `16 Jul 2026 (Today) → 20 Jul 2026`, but `startDate`/`endDate` are caller-supplied, so the window is ours to choose.

---

## 4. Singapore Cruise Centre — `https://singaporecruise.com.sg/schedule/cruise/`

The easiest source after Suntec. Plain server-rendered HTML with both ends of the interval.

### API
None. **WordPress 6.9.4** (`<meta name="generator">`). Two `admin-ajax.php` references exist but both belong to a **`location-weather` plugin** (`splw_ajax_object`, `sp_location_weather`) — they are the live weather widget, **not the schedule**. The schedule is not AJAX-loaded.

### Structured data
Yoast JSON-LD `@graph` present, but only `WebPage` / `WebSite` / `Organization`. **No schema.org `Event`.**

### Rendering
**Fully server-rendered.** The initial HTML contains one `<table>` with **17 `<tr>`** (1 header + **16 sailings**), no JS required:

| ARRIVAL | DEPARTURE | CRUISE SHIP / CRUISE LINE | FROM | NEXT |
|---|---|---|---|---|
| Thu, 30 Jul 2026  0800 | Fri, 31 Jul 2026  0900 | ODYSSEY / VILLA VIE RESIDENCES | Thailand | Vung Tau |
| Sat, 8 Aug 2026  1200 | Sat, 8 Aug 2026  1800 | ISLAND SKY / NOBLE CALEDONIA | Andorra | Kuching, Sarawak |
| Fri, 21 Aug 2026  1000 | Wed, 26 Aug 2026  1000 | GINGA MARU / JAPAN AGENCY OF MARITIME EDUCATION… | Tokyo | Tokyo |

Default window spans **30 Jul → 28 Sep 2026** (~3 months). A `<form method="get">` with `name="date"` and `data-maxmonth="3"` offers a date-range filter; **its parameter format was not determined** — `?date=01/09/2026 - 30/11/2026` returned 200 but rendered no table. The unfiltered default view is sufficient and is what a scraper should use.

### Anti-bot
**Imperva/Incapsula WAF is present** — hard evidence in the response headers:
```
x-cdn: Imperva
x-iinfo: 50-76184711-76184717 NNNY CT(2 3 0) RT(...) q(0 0 0 -1) r(0 6) U12
set-cookie: visid_incap_3134597=…; incap_ses_740_3134597=…
```
**But it is passive.** Plain `curl` with a browser UA returned **HTTP 200 with full content on every request**, including a filtered one. No challenge page, no CAPTCHA, no JS interstitial. Imperva is configured permissively today — **but it is a live switch the operator can flip at any time**, and it is the most likely of the four to start defending. `robots.txt` (Yoast-generated) is `Disallow:` — i.e. **everything allowed**. `terms-conditions/` contains **no robot/scraping/automation clause**.

### Fields
| Field | Present | Format |
|---|---|---|
| name | Yes | ship + line concatenated in one cell — `ODYSSEY  VILLA VIE RESIDENCES`; **needs splitting, delimiter is whitespace only** |
| start | Yes | `Thu, 30 Jul 2026  0800` — `EEE, d MMM yyyy  HHmm`, local SGT, **no timezone marker** |
| **end** | **Yes** | departure column, same format |
| location | Implicit | the terminal itself; `FROM`/`NEXT` give previous/next port |
| description | **No** | but `FROM` → `NEXT` is a natural synthesised description |

---

## What this changes downstream

1. **Build Suntec first.** Server-rendered, undefended, 154 events per request, 100% end-time coverage, hall-level location. It validates the scraper interface at near-zero cost.
2. **Ticketmaster needs a decision, not a scraper.** It is the only source that is *both* contractually forbidden (ToU bans robots; legal action threatened) *and* technically blocked (`tm-bl: 1`), *and* the only one lacking end times — and its seed URL has no events. Discovery API, the sanctioned route, has **no SG market**. Options: (a) drop Ticketmaster from v1; (b) register a Discovery key and empirically confirm `countryCode=SG` coverage before committing; (c) seek written permission. **Recommend (b) as a cheap next step, then (a) if it comes back empty.** This should be its own ticket.
3. **The end-time assumption holds 3/4.** Suntec, MBCCS, and SCC all publish true end times. Only Ticketmaster is date-only — and its `~` ranges must **not** be mapped to start/end. If Ticketmaster stays in scope, the domain model needs an explicit "start-only / all-day" event shape, which affects the iCal serializer (`VEVENT` with `DTSTART;VALUE=DATE` and no `DTEND`).
4. **Description is effectively optional.** Populated on ~8% of Suntec events; absent from MBCCS and SCC entirely. The Excel schema carries it, but three of four sources barely do. Treat as nullable; don't design around it.
5. **Anti-bot mitigation is a smaller problem than feared** (the map lists this as unspecified). Three of four sources mount **no effective defence today**. Suntec has none; MBCCS has none on the web tier; SCC has Imperva but passive. Ticketmaster is the sole real defender — and the case for scraping it is already lost on the terms, not the technology. **A polite `curl`-equivalent HTTP client with a browser UA and a per-host rate limit covers Suntec and SCC today.** MBCCS is the only source needing a headless browser (or an access conversation).
6. **Only MBCCS needs a browser.** Budget for headless in the stack decision, but scope it to one scraper — not the default execution model.
7. **Report the MBCCS credential exposure to SCCS.** Separately from ingest: their production API Basic-auth credentials are in a public JS bundle. Doing this alongside an API access request is the clean path, and it makes the access conversation an easy one to open.

## Open questions

- **Does Discovery return SG events?** Needs an API key. Structural evidence says no.
- **MBCCS access.** Is there a sanctioned route to `sats-webfront-api`? Requires contacting SCCS (who operate both MBCCS and Singapore Cruise Centre — MBCCS's ToU vests content IP in SCCS, so one conversation may cover both).
- **SCC `?date=` parameter format** — undetermined; not needed, the default ~3-month view suffices.
- **Calendar span.** Suntec and SCC both publish ~3 months forward. If the calendar must reach further, **no source supports it** — this constrains the map's open "calendar span" question.
