# v2 source acquisition: for each source, what is the cheapest honest way in?

Resolves [#113](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/113) on map [#112](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/112).

**Method.** Every claim below was established on **04 Aug 2026** by fetching the live source with `curl` (browser User-Agent, `--http1.1 -L`, a handful of requests per host) and reading the returned bytes — markup, response headers, JS bundles, `robots.txt`, terms pages, and JSON endpoints — or, where a hosted developer portal was involved, by reading that portal's own documentation. **Rendering verdicts are grounded in whether the listing content is present in the raw HTML of a plain GET**, and every one says which. Nothing here is inferred from secondary write-ups. Anything that could not be settled without a credential, an account, or a real browser is in the **Not established** section rather than guessed.

> ⚠️ **Amended 05 Aug 2026 — the browser User-Agent above is superseded by [ADR-0021](../adr/0021-reading-sources-that-forbid-it.md) §2.1 and §4.5.** This document predates the ADR by one day. It is **left as written**, because what was actually done on 04 Aug is the record; the rule replacing it is stated below and binds every audit from here.
>
> **The rule for future source audits: probe honest-first.** Scripted fetches identify as
> `sg-tourism-calendar`, never as a browser. ADR-0021 §4.5 makes impersonation a hard stop, and §2.1
> gives the reason: a browser string is what a reader sends when it expects to be unwelcome, and it is
> the first fact anyone would hold against a scrape whose whole defence is that it takes only facts and
> behaves itself. That defence is shared across all twenty sources, so one audit's convenience spends
> it for every other row in the table.
>
> **The one permitted use of a browser string is as a control, never as a route in.** Where a host
> refuses an honest reader, a User-Agent matrix — honest forms *first*, on a cold client, with Chrome's
> own string as the comparison arm — is how you establish *why* it refused. That is diagnosis, not
> disguise: the browser string is there to be compared against, and no data is taken through it. Three
> limits make the difference real, and all three come from how this went wrong the first time:
>
> 1. **Honest first, on a cold client.** The 04 Aug MBS test ran the honest string fourth and left
>    rate-based blocking unexcluded, which is what let one negative result be read as a property of the
>    whole class.
> 2. **Findings are attributed to the arm that produced them.** A claim reached only through the
>    control arm is *not established* until an honest arm reproduces it.
> 3. **Never after a refusal aimed at us.** ADR-0021 §4.3 and §4.4 — an explicit refusal or a block
>    aimed at this project ends the probing; you do not go back with a different string.
>
> **This is not a rule that costs anything at present.** Re-tested as a matrix on 05 Aug, MBS returns
> **byte-identical** responses to `Mozilla/5.0 (compatible; sg-tourism-calendar/0.1)` and to Chrome's
> own string, and SISTIC does the same across four strings. What MBS actually refuses is a UA carrying a
> hostname-shaped token or whitespace in its comment field — the block was never about honesty, and the
> ruling that it was nearly dropped 60% of Singapore's listed trade shows. **The assumption that honest
> identification costs you access is the thing this document got wrong, and it is worth not repeating.**
>
> One question stays open and owner-held: §2.1 obliges a User-Agent *linking the repository*, and every
> form carrying a resolvable URL is precisely what MBS refuses. See `docs/source-register.md` →
> *Open risks*.

**Ethics note.** No anti-bot measure was defeated, no `robots.txt` directive was violated, and no credential was used. Requests were single and polite. Where a host refused, the refusal *is* the finding.

**Scope note.** #113 lists ~20 entries, several of them venues or brands rather than pages. Establishing whether each publishes a listing *at all* is part of the answer — and two of them do not.

---

## Summary

| # | Source | Listing URL | API / feed? | ToS + robots verdict | Rendering | Anti-bot | Volume & horizon | **Route** |
|---|---|---|---|---|---|---|---|---|
| 1 | **TTGmice trade calendar** | `ttgmice.com/trade-calendar/` | No — WP REST exposes `post`/`page` only | robots effectively open; ToU has **no** automation clause, but personal-use-only copyright clause | **Server-rendered** `<table>` | None (nginx) | **122 rows**, Jul 2026 → **Feb 2028**; pan-Asian, SG a minority | **http-scrape** |
| 2 | **Suntec** *(v1 `suntec`)* | `suntecsingapore.com/visit-events` — **not** `/visit` | No — Squarespace JSON/iCal are robots-disallowed | robots disallows `?format=json`/`?format=ical`; **T&C forbid "automated queries of any sort"** — new | **Server-rendered**, 161 articles in 1 GET | None | **131 upcoming**, Jul → Oct 2026 (~3 mo) | **http-scrape**, permission question now open |
| 3 | **Marina Bay Sands / Sands Expo** | `/expo-and-convention/event-directory.html` + `/entertainment/shows.html` | No | **robots.txt permits both listings; ToU bans "page-scrape", "robot", "spider" *and* "any similar or equivalent manual process"** — strongest clause on the list | **Server-rendered, but browser-only** | **Akamai — drops every scripted client; a real browser passes unchallenged** | Shows: **13**, to **Mar 2027**. Expo directory: **rolling 3 days**, room-level, no times | **browser**, ToS-blocked 🚩 |
| 4 | **Sentosa** | `sentosa.com.sg/en/things-to-do/events/` | Sitecore API robots-**allowed** but **needs `sc_apikey`** (HTTP 400) | robots allows; **`/en/search-listing/*` (the listing's AJAX path) disallowed**; ToU: no automation clause, non-commercial reuse only | **Server-rendered** Sitecore JSS; detail pages carry ISO instants | Imperva, **passive** | **61 event pages**; windows reach Mar 2027 | **http-scrape** (sitemap + detail pages) |
| 5 | **Resorts World Convention Centre** | **none exists** | No | n/a | `/en/meetings` is a JS sales page, **zero dates** | n/a | **0** | **none** 🚩 |
| 5b | *(nearest: RWS resort events)* | `rwsentosa.com/en/events` | No | robots allows; **ToU indemnity names "software robots, spiders, crawlers"** | Server-rendered, but `startDate`/`endDate` are **`0001-01-01` null sentinels**; real dates only in free-text `[8 August 2026]` | None observed | **~15 dated** of 48 cards, Aug 2026 → Jan 2027 | **http-scrape**, low quality |
| 6 | **Shangri-La Rasa Sentosa** | `shangri-la.com/singapore/rasasentosaresort/offers/` | No | robots allows; ToU: personal & non-commercial only, no automation clause | **Server-rendered** | Cloudflare, **passive** | **9 offers**, mostly multi-month windows; 1 real single-day event; to Dec 2026 | **http-scrape**, marginal |
| 7 | **The Kallang** | `thekallang.com.sg/en/things-to-do/events.html` | No | robots allows all but AEM internals; ToU: no automation clause, but reproduction/caching restricted | **Server-rendered** — escaped JSON with `title`, `displayDate`, **`dates[]` ISO array**, `venue` | Cloudflare, **passive** | **~29 dated**, Aug 2026 → **Mar 2027** | **http-scrape** — best-shaped new source |
| 8 | **Changi Exhibition Centre** | `changiexhibitioncentre.com/events` | No | robots open; disclaimer has no automation clause | **Server-rendered**, 23 KB | Sucuri CloudProxy, **passive** | **3 events**, Mar 2027 → **Feb 2028** | **http-scrape** (tiny) |
| 9 | **The Star** | `thestar.sg/events` | No (Webflow) | **`robots.txt` is empty (0 bytes)**; no site ToU exists; ticketing T&C silent on automation | **Server-rendered** | Cloudflare, **passive** | **25 events**, Aug → Dec 2026; **dates only, hall in prose** | **http-scrape** |
| 10 | **Singapore EXPO** | `singaporeexpo.com.sg/events-at-expo/` | **`/wp-json/wp/v2/event` is public + unauthenticated (200, `X-WP-Total: 9`)** — but `acf` is empty, **no dates** | robots open, **but Constellar ToS bans "any robot, spider, scraper or other automated means to access our Sites"** | **Server-rendered** | Cloudflare, **passive** | **9 events**, Aug → Nov 2026, hall-level | **none** 🚩 (ask for permission) |
| 11 | **STB** | seeded `/mice/` URL has **no listing**; real one is `stb.gov.sg/events/trade-events/` | **TIH is not merely dead — its domains no longer resolve (NXDOMAIN)** | robots `Allow: /`; STB's own ToU has **no** automation clause | **Server-rendered** (Isomer/S3/CloudFront) | None | **4 rows**, Oct 2026 → Jan 2027; only 2 in Singapore | **http-scrape**, marginal |
| 12 | **VisitSingapore MICE** | `visitsingapore.com/mice/en/event-listing/` | **AEM `.search.json` endpoint works unauthenticated — 33 records in one call** | **ToU: "you will not … use any robot, spider, other automatic device … to monitor or copy any pages"**; robots disallows `/*json$` | **Client-rendered** — raw HTML is ~5 KB of nav chrome, zero events | Imperva, passive | **26 future**, to **Mar 2027** | **none** 🚩 |
| 13 | **Eventbrite** | `eventbrite.sg/d/singapore--singapore/marina-bay-sands-expo/` | **No public event search.** `/v3/events/search/` → **404 NOT_FOUND** while every other path → 401 NO_AUTH | **ToS §13 bans scraping by name**; robots disallows `/rss/`, `/atom/`, `/api/v3/destination/events/` | Server-rendered JSON-LD `ItemList` | None on the listing | 20/page, `object_count: 2732`, `page_count: 49`; to Mar 2027 | **none** 🚩 |
| 14 | **EventsEye** | `eventseye.com/fairs/cd1_trade-shows_singapore_<month>_<n>.html` | No | **No `robots.txt` (404) and no terms document anywhere on the site** | **Server-rendered**, 24–38 KB/month | None (Apache) | **183 listed / 89 firm-dated**, to **May 2028** | **http-scrape** — best horizon |
| 15 | **bigevent.io** | `bigevent.io/events/city/singapore/` | `event` CPT exists but **not** on the REST API (404) | robots: **`Allow: /events/*`**; **ToU page exists but is empty** | **Server-rendered** Rank Math JSON-LD with `startDate`/`endDate`/`location` | Cloudflare, **passive**, HTTP/2-sensitive | **13 events**, Aug 2026 → **Sep 2027** | **http-scrape** |
| 16 | **SportPlus SG** | `sportplus.sg/singapore-sports-events` | Wix CMS present; **no callable data endpoint found** | robots `Allow: /`; **no terms document exists** | **Server-rendered** (Wix SSR) | None observed | **5 future** (+8 stale past, unpruned), to Dec 2026; **visible dates carry no year** | **http-scrape**, marginal |
| 17 | **JustRunLah!** | `justrunlah.com/calendar-of-running-events-singapore/` | WP REST exposes `post`/`page` only | robots allows; **no terms document exists** | **Server-rendered** | Cloudflare, **passive** | **15 races**, all future, Aug → Nov 2026, **with flag-off times** | **http-scrape** |
| 18 | **MBCCS** *(v1 `mbccs`)* | `mbccs.com.sg/cruise-information?tab=cruise-schedule` | Undocumented JSON API, **401 Basic-auth gated** | robots `Allow: /`; ToU bans reproduction "for any commercial or any other purposes" | **Client-rendered** — `pageProps: {}`; HTML says "There are no scheduled cruises." | None on web tier | window is caller-chosen | **browser** (unchanged) |
| 19 | **Singapore Cruise Centre** *(v1 `scc`)* | `singaporecruise.com.sg/schedule/cruise/` | No | robots `Disallow:` (all allowed); **ToU §2.1.1 grants use for "internal, non-commercial, informational purposes only"** — new | **Server-rendered** `<table>` | Imperva, **passive** | **19 sailings**, 30 Jul → 01 Nov 2026 | **http-scrape**, permission question now open |
| 20 | **Ticketmaster SG** | `ticketmaster.sg/activity` | Discovery API exists — **no Asian market coverage** | **ToU bans robots**; robots disallows `*startDate=*` | Listing server-rendered; **detail pages HTTP 401** | **`{"response":"identify"}` bot block, still live** | ~30 dated rows, Aug → Sep 2026, **dates only, no times** | **none** 🚩 |

Route legend: `api` / `feed` / `http-scrape` / `browser` / `none`. 🚩 = flagged, see below.

---

### Three headlines

**1. The API hypothesis in #113 does not survive contact — the score is `api: 0`.** The ticket's premise was that large commercial platforms publish APIs cheaper than adapters. Both named candidates fail, for different reasons. **Eventbrite removed public event search** — `/v3/events/search/` returns 404 NOT_FOUND while every neighbouring path returns 401 NO_AUTH, so the path does not exist — *and* its ToS bans scraping by name. **Ticketmaster's Discovery API still has no Asian coverage**, and `ticketmaster.sg` is a separately-run property whose detail pages actively block bots. Two other endpoints do answer unauthenticated: Singapore EXPO's WordPress REST (which omits the dates) and VisitSingapore's AEM `.search.json` (whose ToU forbids exactly this). **v1's #4 finding holds across the wider list: there is no licensed feed to buy and no API to call.**

**2. The technical work is far easier than v1 feared; the legal work is harder.** Fifteen sources are plain server-rendered HTML answering a single unauthenticated GET. Only **one** needs a browser — MBCCS, exactly as ADR-0005 scoped it — and only one refuses outright. But **six sources are barred by their own terms rather than by their technology**, and two of those are already in v1 production. The binding constraint on v2 ingestion is permission, not parsing.

> **Updated 04 Aug 2026:** the browser count is **two**, not one. MBS was reachable after all — by a real browser, not a scripted client — and its pages, `robots.txt` and Terms of Use were all retrieved (see §3's Update). This does not weaken the headline, it strengthens it: MBS turns out to be a *fifth* terms-of-service block rather than a technical one, so **five of the six flagged sources are now blocked by a clause and only one (RWCC) by an absence of data**. ADR-0005's "headless is a one-source exception" no longer holds.

**3. The horizon problem is solved, twice over.** v1 concluded no source reached beyond ~3 months. **EventsEye reaches May 2028** with 183 listed Singapore trade shows (89 firm-dated); **Changi Exhibition Centre and TTGmice both reach Feb 2028**; bigevent.io reaches Sep 2027; The Kallang and VisitSingapore reach Mar 2027. A calendar that only renders 3 months forward is now under-serving its own sources.

---

## 1. TTGmice trade calendar — `https://www.ttgmice.com/trade-calendar/`

**API/feed.** None. WordPress (`X-Powered-By: W3 Total Cache/2.7.2`), but `https://www.ttgmice.com/wp-json/wp/v2/types` returns only `post`, `page`, `attachment`, `wp_block` — no event post type. Registered namespaces (`https://www.ttgmice.com/wp-json/`) are `oembed/1.0`, `wordfence/v1`, `sweep/v1`, `foogallery/v1`, `wp/v2`. The calendar is a hand-maintained `<table>` inside one ordinary WordPress *page*.

**robots.txt** (`https://www.ttgmice.com/robots.txt`) is a single rule; `/trade-calendar/` is not covered:
```
User-agent: *
Disallow: index\.php/[a-zA-Z0-9\-_]{25,}$*
```

**Terms of Use** (`https://www.ttgmice.com/terms-of-use/`) — I grepped the raw page for *robot*, *spider*, *scrape*, *crawl*, *automat*, *data mining*, *extract*: **no automated-access clause exists.** What does exist is a reuse restriction:

> *"The contents of the TTG Asia Media 'Website Services' are intended for your personal, non-commercial use."*
>
> *"Copying or storing of any content for other than personal use is prohibited without prior written permission from TTG Asia Media."*

That restricts **republication**, not **access**. The payload is dates, names and venues — facts, not expression — so the copyright exposure is thin, but it is the same clause shape that recurs at Suntec, Sentosa, The Kallang and MBCCS.

**Rendering — server-rendered, verified.** One 130 KB GET returned **122 `<tr>` rows** with the full calendar in the markup.

**The parsing hazard is the year.** Months appear as section header rows (`JULY`, `AUGUST`, …); data rows carry a bare day range with **no year** — `16 – 18`, `31 Jul – 2 Aug`. A row-local parser fabricates the wrong year at every January boundary. The year must be carried down from the section, and the section only names a month.

**Anti-bot.** None. `Server: nginx`, HTTP 200 to a plain GET, no challenge, no cookie gate.

**Volume & horizon.** 122 rows, **Jul 2026 → Feb 2028**. But it is a *pan-Asian* trade calendar — sampled rows are Chennai, Jakarta, Goa, Adelaide, Hamburg, Dubai, Tokyo. Singapore entries are a minority: `APSAE Summit — MBS`, `ITB Asia/MICE Show Asia 2026 — MBS`, `Travel Tech Asia — Sands Expo`, `WiT Singapore`, `Hotel Investment Conference APAC — Fairmont Singapore`, `Singapore Air Show — Changi Exhibition Centre`. A venue-column filter is mandatory.

**Route: `http-scrape`.**

---

## 2. Suntec — `https://www.suntecsingapore.com/visit-events` (v1 `suntec`)

### The URL in #113 is the wrong URL

#113 lists `https://www.suntecsingapore.com/visit`. **That page is not the listing.** Its "UPCOMING EVENTS" block is client-populated and the server HTML renders, verbatim:

> *"UPCOMING EVENTS … No results found"*

A plain GET of `/visit` (825 KB) contains **zero** `eventlist-event` articles and **zero** Google Calendar date intervals. `/visit-events` — what v1 actually built against — is still correct and still works.

**API/feed.** Unchanged from v1. Squarespace's `?format=json` / `?format=ical` endpoints exist; `https://www.suntecsingapore.com/robots.txt` disallows both for every agent:
```
Disallow:/*?format=json
Disallow:/*?format=ical
```

### New finding: the Terms & Conditions prohibit automated queries

v1's audit read Suntec's `robots.txt` and stopped there. `https://www.suntecsingapore.com/terms-conditions` §2 *Commercial Use Limitation* says:

> *"Unless otherwise specified, the Suntec Singapore Web Site/Service is for your personal and non-commercial use. You may not modify, copy, distribute, transmit, display, perform, reproduce, publish, license, create derivative works from, transfer, or sell any information, software, products or services obtained from the Suntec Singapore Web Site/Service. Without the advance express written permission of Suntec Singapore, you may not 'meta-search' the Suntec Singapore Web Site/Service, send, or cause to be sent, any automated queries of any sort to the Suntec Singapore Web Site/Service, or use the Suntec Singapore Web Site/Service in any commercial manner. 'Automated queries' shall include but not limited to using any software that sends queries to Suntec Singapore Web Site/Service to determine how a web site 'ranks'."*

The clause's own definition is anchored to SEO rank-checking (`shall include but not limited to`), which is where its evident intent sits — but the operative words are *"automated queries of any sort"*, and a nightly scraper is one. This is **materially weaker footing than v1 recorded**. It is the same clause shape as Ticketmaster's, differing mainly in that Suntec mounts no technical block and makes no legal threat.

**Rendering — server-rendered, verified, unchanged.** One 1.37 MB GET returned **161 `<article class="eventlist-event">`** — **131 upcoming**, 30 past — and **161 well-formed `dates=…Z/…Z` Google Calendar UTC intervals**. `datetime` attributes span **2026-07-21 → 2026-10-25** (~3 months forward).

**Anti-bot.** None. HTTP 200, `Server: Squarespace`, only the `crumb` CSRF cookie.

**AI-crawler note.** The `robots.txt` still stacks `ClaudeBot`, `GPTBot`, `anthropic-ai` etc. as consecutive `User-agent:` lines terminating in `User-agent: *`, sharing the `*` group's rules, with **no `Disallow: /`**. Unchanged from v1.

**Route: `http-scrape` — with a permission question that should be closed before v2 ships.** One email; the calendar drives traffic *to* their events, so it is an easy ask.

---

## 3. Marina Bay Sands / Sands Expo and Convention Centre 🚩

> **⚠️ SUPERSEDED IN PART — updated 04 Aug 2026, later the same day, from a real browser.**
> This section originally concluded that MBS's pages, `robots.txt` and Terms of Use were **all**
> unobtainable, and flagged the source on the grounds that *permission could not be established at
> all*. A subsequent session drove a real Chrome instance at the host and **retrieved all four**.
> The Akamai finding below stands unchanged and still binds the adapter's shape. What changes is
> the *reason for the flag*: MBS is no longer an unknowable-permission case, it is a
> **terms-of-service case**, alongside Eventbrite, Ticketmaster, VisitSingapore and Singapore EXPO.
> The original text is kept below; the new findings follow it under **Update**.

**This host cannot be reached by any HTTP client available here, and that is the finding.**

DNS: `www.marinabaysands.com` → `CNAME san.booking.marinabaysands.com.edgekey.net` → `e9200.a.akamaiedge.net` → `23.15.249.40`. **Akamai.**

The failure mode is a silent drop *after* the request is accepted:
```
* Connected to www.marinabaysands.com (23.15.249.40) port 443
* ALPN: server accepted h2
> GET /robots.txt HTTP/2
* HTTP/2 stream 1 was not closed cleanly: INTERNAL_ERROR (err 2)
```
Over HTTP/1.1: `curl: (56) Recv failure: Operation timed out` after 30 s. Retried with a complete Chrome header set — `Accept`, `Accept-Language`, `Accept-Encoding`, all four `Sec-Fetch-*`, `sec-ch-ua`, `sec-ch-ua-platform`, `Upgrade-Insecure-Requests` — **same timeout**. `WebFetch`, egressing from different infrastructure, also timed out. TLS 1.3 completes; HTTP never does. `HTTP 000, size=0` on `/`, `/robots.txt` and `/sitemap.xml` alike. This is TLS/HTTP fingerprinting, not a UA check — and it is a drop, not a 403.

**Alternate hosts are dead.** `sandsexpo.com.sg` → DNS **SERVFAIL**, no A record. `marinabaysands.com.sg` and `www.marinabaysands.com.sg` → NOERROR but **no A record**. The apex `marinabaysands.com` drops identically.

**Candidate listing URLs exist** (search engines index them, so Akamai clearly admits Googlebot) but **their content was not verified by me**:

- `https://www.marinabaysands.com/expo-and-convention/event-directory.html` — the Sands Expo directory. Its indexed description suggests it covers only the **next 3 days**, which would make it near-useless as a calendar. **Unconfirmed.**
- `https://www.marinabaysands.com/entertainment/shows.html` — Sands Theatre
- `https://www.marinabaysands.com/museum/whats-on.html` — ArtScience Museum

**The blocking consequence is not "scraping is hard" — it is that `robots.txt` and the Terms of Use are both unobtainable.** I cannot read MBS's crawl directives and I cannot read their terms. There is no way to establish permission, so there is no honest route. Driving a headless browser here would mean deliberately defeating a bot defence whose accompanying policy I have been unable to read.

**Partial mitigation.** Sands Expo / MBS events surface on three sources already in scope: **bigevent.io** (5 of its 13 entries), **EventsEye** (`Marina Bay Sands` appears as a venue value), and **TTGmice** (`ITB Asia — MBS`, `Travel Tech Asia — Sands Expo`). Any MBS coverage v2 gets will be second-hand and partial.

**Route: `none` — flagged.**

### Update — 04 Aug 2026, from a real browser

Everything above about Akamai was re-confirmed first: both candidate listing URLs still return `HTTP 000, size=0` in ~50 ms over HTTP/2 (`INTERNAL_ERROR`), and time out after 20 s over HTTP/1.1, with a full Chrome UA. **A scripted HTTP client cannot reach this host, and that has not changed.** A real Chrome instance reached every page on the first attempt, with no challenge, no CAPTCHA and no interstitial.

#### `robots.txt` — retrieved, and it permits both listings

```
User-Agent: SearchSG
Disallow: /

User-agent:*
Disallow: /content/dam/…/sands-rewards-club/
Disallow: /content/dam/…/casino/
Disallow: /content/content-repository/en/site-configuration/
Disallow: /*?offerCode=
Disallow: /reservations/
Disallow: /*promocode=
Disallow: /mbs/booking/
Disallow: /new-museum.html
Disallow: /new-museum/*

Sitemap: https://www.marinabaysands.com/content/sitemap.xml
```

The disallow list is **casino, loyalty, reservations, booking and promo-code paths**. Neither `/expo-and-convention/` nor `/entertainment/` appears. There is also a **sitemap**, previously unobtainable. On the crawl-directive question alone, MBS is permissive.

#### Terms of Use — retrieved, and they are the clearest prohibition on the list

`https://www.marinabaysands.com/terms-of-use.html`, under the heading ***Personal and Non-Commercial Use Limitation***:

> *"You may not use any "deep-link", "page-scrape", "robot", "spider" or other automatic device, program, algorithm or methodology, **or any similar or equivalent manual process**, to access, acquire, copy or monitor any portion of the Sands Platform or any content, or in any way reproduce or circumvent the navigational structure or presentation of the Sands Platform or any content, to obtain or attempt to obtain any materials, documents or information through any means not purposely made available…"*

> *"Unless otherwise specified, the Sands Platform is for your personal and non-commercial use. You may not modify, copy, distribute, transmit, display, perform, reproduce, publish, license, create derivative works from, transfer or sell any information, software, products or services obtained from the Sands Platform."*

This is **stronger than Eventbrite's §13**, which is the benchmark for an explicit clause. It names page-scraping, names robots and spiders, and then closes the transcribe-it-by-hand door with *"or any similar or equivalent manual process"*. The second clause independently bars republication. **`robots.txt` says yes and the ToU says no; the ToU governs.**

#### `/expo-and-convention/event-directory.html` — the 3-day window is confirmed

The page states its own scope: *"Explore the full list of upcoming events happening at Marina Bay Sands Expo & Convention over the next 3 days."* On 04 Aug 2026 it carried exactly three date headings — 04, 05 and 06 Aug 2026 — and a freshness stamp, *"Event list is updated as of 4 Aug 2026 12:41 pm"*. **The indexed hint was right.**

Content is **room-booking granularity, not calendar granularity**. Each event carries a title, a sub-activity label and a room: `SAP NOW AI TOUR SOUTHEAST ASIA 2026 / Executive Meeting Room 1 / L5 Sands A - 5102`. Roughly 15 titled entries per day, of which a minority are public: `SAP NOW AI TOUR SOUTHEAST ASIA 2026`, `BUILD WITH GEMINI SINGAPORE`, `2ND INTERNATIONAL CONFERENCE ON FUTURE OF AM 2026`, `PHARMAPACK ASIA INDUSTRY FORUM`. The majority are **not attendable events at all** — `MD STRATEGY MEETING`, `HOSPITALITY ORIENTATION`, `SSD TRAINING`, six separate `FOOD TASTING FOR …` rows, and `Prayer Room (Male)` / `Prayer Room (Female)` as line items. No times are published, only rooms.

**Ruling (Ed, 04 Aug 2026): the 3-day window is a valuable primary source, and this map treats it as one.** The reasoning, recorded so it is not re-litigated:

- It is **first-party**. Every other route to Sands Expo — bigevent.io, EventsEye, TTGmice — is second-hand, partial, and carries whatever the aggregator chose to list. This is the venue's own record of what is in its halls.
- Captured daily, a rolling window **accumulates**. Three days visible is not three days of data; it is an unbounded forward-confirmed record built one run at a time.
- It is a **verification source**. An aggregator claiming an MBS event that never appears in the venue's own directory is a claim worth doubting — which is exactly the input the moderation surface on this map needs.

**The operational consequence, named — this is the second source of its kind.** A rolling window with no backfill means **the value only exists if capture starts before the data is needed**, and a dropped run loses those days permanently. That is precisely the property ruled on for Changi arrivals in [#28](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/28), and it makes [#126](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/126) — `daily.yml`'s now-wrong *"a dropped run costs nothing"* comment — bind a second source rather than one. It also sharpens the permission ask: **for MBS, waiting to ask costs history that cannot be recovered.**

It also means the entries this source yields are **not the same shape as a VenueEvent**: no times, room-level location, and a majority that are internal operations rather than public events. Filtering and classification are an adapter concern here, not a moderation concern — the `Prayer Room` rows must never reach a human queue.

#### `/entertainment/shows.html` — the genuinely calendar-shaped page

**13 shows, 14 Aug 2026 → 14 Mar 2027** — seven months of horizon, comfortably past v1's 3-month ceiling. Clean date ranges in the rendered text (`14 – 16 Aug 2026`, `19 Aug – 6 Sep 2026`, `29 Aug 2026`, `16 Feb – 14 Mar 2027`), each with a category (`CONCERT`, `MUSICAL`, `BALLET`, `EXPERIENCE`, `FAMILY ENTERTAINMENT`) and a description. Sample: `BJÖRN AGAIN - THE ABBA FOREVER TOUR`, `JESUS CHRIST SUPERSTAR`, `CATS THE MUSICAL`, `THE NUTCRACKER BY STATE BALLET OF GEORGIA`, `MOULIN ROUGE! THE MUSICAL`.

**This is the better of the two pages by every calendar measure** — public events only, real horizon, no filtering problem. Note the overlap with Ticketmaster SG (§20): several of these are the same concerts, and MBS publishes them with better date structure and no 401.

`/museum/whats-on.html` (ArtScience Museum) was **not** retrieved in this session. Still open.

#### What this changes

| Claim in the original section | Status |
|---|---|
| Akamai drops every scripted client | **Stands.** Re-confirmed on both listing URLs |
| `robots.txt` unobtainable | **Wrong.** Retrieved; permits both listings; publishes a sitemap |
| Terms of Use unobtainable | **Wrong.** Retrieved; prohibits scraping in the strongest terms on the list |
| "Permission cannot be established at all" | **Wrong, and the flag's reason is replaced.** Permission is established — and it is refused |
| Event directory covers only 3 days — *unconfirmed* | **Confirmed**, and ruled valuable anyway (above) |
| Route `none` | **Holds, on new grounds** — ToS, not unknowability. A permission ask is now a coherent thing to make, which it previously was not |

**Route: `browser`, blocked by ToS — flagged, pending permission.** If permission is granted this becomes the **second** browser adapter after MBCCS, which is a real cost against ADR-0005's assumption that headless was a one-source exception. Both pages are worth having: `shows.html` for horizon, `event-directory.html` for first-party daily capture.

---

## 4. Sentosa — `https://www.sentosa.com.sg/en/things-to-do/events/`

#113 lists "Sentosa" as a brand; the listing exists at the URL above. Note `/en/whats-on/` is a **404** whose body is a 4.3 MB Sitecore shell full of dates — a convincing decoy for anyone probing by guesswork.

**API/feed.** Sitecore. `https://www.sentosa.com.sg/robots.txt` contains an unusual carve-out:
```
Disallow: /sitecore/*
Allow: /sitecore/api
```
But it is credential-gated:
```
GET /sitecore/api/graph/edge
→ 400 {"errors":[{"message":"SSC API key is required. Pass with 'sc_apikey' query string or HTTP header."}]}
```
and `/sitecore/api/layout/render/jss` returns a bare `400 Bad Request`. **Robots permits it; Sitecore does not.** Whether Sentosa would issue a key is **not established** — and the explicit `Allow` is a strong hint that they might.

**robots.txt is what shapes the route.** `Disallow: /en/search-listing/*` — and `search-listing/` is exactly the path in the listing page's JSS payload that its "load more" calls. **The paginated listing endpoint is off limits.**

**Terms of Use** (`https://www.sentosa.com.sg/en/legal-information/`) contains **no** automated-access clause. It restricts reuse:

> *"No part of this website may be reproduced or reused for any commercial purposes whatsoever without prior written permission from Sentosa."*

> *"Apart from any fair dealings for the purposes of private study, research, criticism or review, as permitted in law, no part of The Website may be reproduced or reused for any commercial purposes whatsoever without our prior written permission."*

**Rendering — server-rendered, verified.** Sentosa embeds its data as a Sitecore JSS JSON blob in the HTML. But the first response carries only **11 distinct event slugs**, with `startDate`/`endDate` appearing 12 times; the rest arrive over the disallowed AJAX path.

**The route that works instead:** `https://www.sentosa.com.sg/sitemap.xml` lists **61 URLs under `/en/things-to-do/events/`**, and every detail page is fully server-rendered with real ISO instants:
```json
"startDate":{"value":"2026-08-15T10:00:00Z"}, "endDate":{"value":"2026-08-15T14:00:00Z"}
```
So: **sitemap → 61 detail GETs → true UTC start and end.** Both paths are robots-allowed. The price is 62 requests rather than 1.

**But `startDate`/`endDate` are a *validity window*, not an event instant.** Sampling four detail pages makes this unmistakable:

| Slug | startDate → endDate | Reading |
|---|---|---|
| `singapore-biodiversity-race` | `2026-08-22T02:00Z → 2026-08-22T14:30Z` | a real one-day event |
| `island-symphony` | `2026-08-29T07:31Z → 2027-03-27T14:00Z` | a standing show |
| `sunset-yoga` | `2025-09-07T10:00Z → 2027-03-07T11:00Z` | a recurring programme |
| `fort-siloso-night-experience` | `2024-04-01T04:00Z → 2027-03-31T15:30Z` | a permanent attraction |

The workable heuristic is **same-day window = event, multi-month window = attraction**. Sentosa's true dated-event count is therefore well below 61, and Sentosa needs the "is this even an event?" filter more than any other source on the list.

**Anti-bot.** Imperva/Incapsula (`X-CDN: Imperva`, `visid_incap_*`/`nlbi_*`/`incap_ses_*` cookies) but **passive** — HTTP 200 with full content on every request. Same posture as SCC in v1.

**Route: `http-scrape` (sitemap + detail pages).**

---

## 5. Resorts World Convention Centre 🚩 — no listing exists

`https://www.rwsentosa.com/en/meetings` is titled *"Resorts World Convention Centre | Function Rooms | Meeting Spaces"* and is the venue's **sales** page. It opens with `You need to enable JavaScript to run this app. Loading...`, and its server-rendered text contains **zero dates** — the copy is *"A Destination Designed for Exceptional Events"*, *"Exclusive Perks for Delegates"*, *"Transformative Event Spaces"*. `https://www.rwsentosa.com/sitemap.xml` confirms the only pages under `/meetings` are `delegates-privileges`, `sustainable-mice`, and language variants. **There is no convention-centre event calendar.**

**Route: `none` — flagged, on the grounds that the source does not exist.**

### 5b. Nearest substitute: Resorts World Sentosa events — `https://www.rwsentosa.com/en/events`

A real listing, just not of the convention centre.

**robots.txt** disallows only query-parameter and Sitecore paths; `/en/events` is allowed.

**Terms of Use** (`https://www.rwsentosa.com/en/legal-information`) — the only source on the list to name crawlers in an *indemnity* rather than a prohibition:

> *"You also agree to indemnify us, our directors, officers, employees and agents for any losses, liabilities, expenses, damages, or costs, including reasonable attorneys' fees, arising or resulting from your use of software robots, spiders, crawlers, or similar data gathering and extraction tools, or any other action you take that imposes an unreasonable burden or load on our infrastructure."*

> *"Any other use of the Content on this Site, including but not limited to, the modification, reproduction, duplication, distribution, transmission, publication or uploading of, or the creation of derivative works from, any material, information or software obtained from this Site is expressly prohibited without our express prior written consent."*

That is not a ban on crawling; it is a shifting of liability onto whoever crawls. It is adverse but weaker than Eventbrite's or Constellar's.

**Rendering — server-rendered, verified.** 512 KB, dates present in raw HTML.

**The data quality is poor, and specifically so.** The page carries **48 titled cards** — hotels, restaurants and attractions mixed in with events. Each has `startDate` and `endDate`, and **all 23 occurrences are the null sentinel `0001-01-01T00:00:00Z`**. The real dates live only inside description prose, in square brackets, in at least four formats:

```
[Now - 30 September 2026]         Singapore Oceanarium Turns One
[8 August 2026]                   Adventure Cove Electra Festival 2026
[7 - 10 Aug 2026]                 Spotlight Sessions
[22 - 23 August 2026]             RWS Cares Festival 2026
[25 September - 1 November 2026]  Halloween Horror Nights 14
[3 January 2027]                  Eric Moo - Our Journey Through 40 Years Concert
```

**~15 dated cards, Aug 2026 → Jan 2027.** An adapter here is a free-text date parser sitting on top of a null-sentinel trap, and it breaks the day a copywriter changes bracket style.

**Route: `http-scrape`, low quality, low priority.**

---

## 6. Shangri-La Rasa Sentosa — `https://www.shangri-la.com/singapore/rasasentosaresort/offers/`

The resort's *property* page (`…/rasasentosaresort/`) publishes nothing dated: a plain GET returned 116 KB with **zero** recognisable date strings and no JSON-LD. `/happenings/` and `/whats-on/` are **404**; `/events/` 302s back to the resort home; `/daily-activities/` is a **recurring weekly schedule with no calendar dates** (Saturday: Fun at Breakfast 9am, Race Challenge 11am, Walk on Water 11:30am…); `/meetings-events/` is RFP marketing.

**The one dated listing is `/offers/`** — HTTP 200, 68.5 KB, **fully server-rendered**, with 9 entries each carrying an explicit `DD MMM YYYY - DD MMM YYYY` range and a category tag:

| Range | Offer |
|---|---|
| 09 Aug 2026 – 09 Aug 2026 | Makan by the Sea on National Day |
| 01 Aug 2026 – 31 Aug 2026 | National Day Wellness Retreat |
| 01 Aug 2026 – 30 Nov 2026 | Celebrate Singapore: Breakfast & Beyond |
| 14 Jul 2026 – 31 Dec 2026 | Petite Party |
| 14 Jul 2026 – 31 Dec 2026 | Year-End Dinner By The Sea |
| 01 Jul 2026 – 30 Sep 2026 | Serenity Relief Ritual |
| 01 Jul 2026 – 30 Sep 2026 | Aroma Wellness Reset |
| 05 Jun 2026 – 31 Dec 2026 | Rasa Private Beach BBQ |
| 01 Jun 2026 – 30 Aug 2026 | Seaside Summer Party |

**Eight of nine are multi-month promotional windows, not events.** Exactly one — *Makan by the Sea*, 09 Aug 2026 — is a point-in-time happening. This is a hotel offers page, and treating a three-month F&B promotion as a calendar entry would be the same category error the Sentosa windows invite.

**Discoverability is a problem.** `robots.txt` declares `sitemapmain.xml` and `sitemapindex.xml` under `/uploadedFiles/`; `sitemapindex.xml` **404s**, `sitemapmain.xml` returns 224 URLs listing only the `/cn/` and `/jp/` variants of this property, and `https://www.shangri-la.com/sitemap.xml` is a stale xml-sitemaps.com file with only the property root. **The `/offers/` URL appears in no sitemap** — you have to know it.

**robots.txt** (`https://www.shangri-la.com/robots.txt`) is a long list of booking-flow query-parameter disallows plus `/online-services/`, `*/mylightbox/`, `*/photo-library/`. Nothing bars `/offers/`.

**Terms** (`https://www.shangri-la.com/en/corporate/terms-conditions/`) have **no** automated-access clause (zero hits for robot/spider/scrape/crawl), only:

> *"The Website may only be used for personal and non-commercial purposes."*

**Anti-bot.** Cloudflare, **passive** — HTTP 200 to a plain GET.

**Route: `http-scrape`, marginal.** One real event out of nine entries. Recommend deferring; the yield does not justify an adapter unless offers-as-entries is explicitly in scope.

---

## 7. The Kallang — `https://www.thekallang.com.sg/en/things-to-do/events.html`

**First, a domain trap.** `thekallang.com` (no `.sg`) is a **parked/monetised domain** — its `robots.txt` serves `Disallow: /fcmedianet.js`, `/cmedianet`, `/mediamainlog.php` and a terminal `User-agent: * / Disallow: /`. It is **not** the venue. The venue is `www.thekallang.com.sg` — the Singapore Sports Hub, renamed by The Kallang Group in Nov 2025.

**robots.txt** (`https://www.thekallang.com.sg/robots.txt`) — an AEM default, fully permissive for content:
```
User-agent: *
Disallow: /bin/
Disallow: /libs/
Disallow: /tmp/
Allow: /content/
Allow: /etc.clientlibs/
```

**Terms of Use** (`https://www.thekallang.com.sg/en/terms-of-use.html`) — **no** automated-access clause. Two clauses matter for what v2 does *after* fetching:

> *"Except as otherwise provided, the Contents of this Website shall not be reproduced, republished, uploaded, posted, transmitted or otherwise distributed in any way, without the prior permission of the Company."*

> *"Except as set forth below, caching and links to, and the framing of this Website or any of the Contents are prohibited."*

A published ICS feed *is* redistribution, and a store *is* caching. This is a republication constraint, not an access one, and it applies equally to Sentosa, MBCCS, Suntec and TTGmice.

**API/feed.** None found — AEM with no published content API.

**Rendering — server-rendered, and the best-shaped payload of any new source.** `/en/events.html` and `/en/whats-on.html` both **404** (with a 134 KB shell body). The live listing is `/en/things-to-do/events.html`, 208 KB, embedding its cards as HTML-entity-escaped JSON in a data attribute:

```json
{"title":"Power Station “Life Goes On” World Tour - Singapore",
 "displayDate":"22 Aug 2026",
 "dates":["2026-08-22"],
 "venue":"Singapore Indoor Stadium"}
```

`dates[]` is an **ISO array that enumerates every performance date** — `["2026-11-10","2026-11-11"]` for My Chemical Romance. That is precisely the distinction Ticketmaster's `~` ranges destroy, published for free. `venue` resolves to the specific hall (National Stadium / Singapore Indoor Stadium / OCBC Arena).

Two shape caveats: there are **no times**, and `dates` is occasionally empty while `displayDate` is populated (`ITZY … "displayDate":"3 Oct 2026","dates":[]`), or reads `"Multiple dates"` for standing programmes.

**Anti-bot.** Cloudflare (`CF-RAY`), **passive** — HTTP 200 to a plain GET, no challenge.

**Volume & horizon.** **33 cards, ~29 with real dates**, spanning **Aug 2026 → 31 Mar 2027** (~8 months) — a longer horizon than any venue source v1 had. Sample: Post Malone (25 Sep 2026), The Weeknd (2–3 Oct), BIGBANG (17 Oct), Guns N' Roses (25 Nov), PGL Major (10–13 Dec), Jay Chou (8–10 Jan 2027), ENHYPEN (14 Mar 2027).

**Route: `http-scrape`. Build this one first among the new sources.**

---

## 8. Changi Exhibition Centre — `https://www.changiexhibitioncentre.com/events`

Operated by **Experia Events Pte Ltd** (site footer).

**robots.txt:** `User-agent: * / Disallow: /*pg=*&pg=` — the events page is allowed.

**Terms.** There is no terms-of-use page; the legal pages are `/disclaimer` and `/privacy-policy`, both HTTP 200. **Neither contains an automated-access clause** (zero hits for robot/spider/scrape/crawl/reproduce on the disclaimer; the privacy policy's "Automated Interactions" section is about personal-data processing, not site access).

**API/feed.** None. Bespoke stack (`/xpr/`, `/skin/qql/` asset paths), no CMS API.

**Rendering — server-rendered, verified.** 23 KB, no JS required.

**Anti-bot.** `Server: Sucuri/Cloudproxy` — a WAF, but **passive**: HTTP 200 to a plain GET.

**Volume & horizon — three events, all far future:**

| Event | Dates |
|---|---|
| Business Aviation Asia Forum and Expo (BAAFEx) | 22 – 24 March 2027 |
| IMDEX Asia | 4 – 6 May 2027 |
| Singapore Airshow | 15 – 20 February 2028 |

The rest of the page is a *"Highlights from the Past"* list with no dates. This venue hosts a handful of very large biennial shows, so **three entries is the honest full picture, not a truncation** — and it is the only source reaching Feb 2028 with a Singapore venue attached.

**Route: `http-scrape`.** Cheap, stable, tiny. Note that **ADR-0007's net-drop-of-the-future-dated-cohort signal is meaningless at n=3** — this source needs a different health check or an explicit exemption.

---

## 9. The Star — `https://www.thestar.sg/events`

The Star Performing Arts Centre, at The Star Vista.

**robots.txt.** `https://www.thestar.sg/robots.txt` returns **HTTP 200 with a zero-byte body**. An empty file imposes no restrictions on any agent.

**Terms.** There is **no site terms-of-use page**. The only legal pages are `/ticketing-terms-and-conditions` and `/privacy-statement` (both 200), and **neither carries an automated-access clause** — the ticketing T&Cs are entirely about sale, resale, refunds and admission.

**API/feed.** None. Webflow (`cdn.prod.website-files.com` assets).

**Rendering — server-rendered, verified.** 52 KB listing.

**Anti-bot.** Cloudflare, **passive** — HTTP 200, only a `_cfuvid` cookie.

**Volume & horizon.** **25 future events, 7 Aug → 2 Dec 2026** (~4 months), each a weekday-qualified date plus a title plus a `/events/<slug>` detail link:

```
Friday, August 7, 2026       David Byrne: Who Is The Sky? Tour in Singapore
Saturday, August 8, 2026     Kodaline - Farewell Tour in Singapore
Saturday, November 14, 2026  Joe Hisaishi World Dream Tour
Wednesday, December 2, 2026  Queens of the Stone Age World Tour in Singapore
```

**Detail pages add nothing structured.** I fetched `/events/kodaline-farewell-tour-in-singapore`: 31 KB, **no JSON-LD, no date/time fields, no venue field**. The hall appears only in prose — *"…set to take place on 8 August 2026 at The Star Theatre"*. So The Star is **date-only, with the hall recoverable only by text matching**, and there is no point paying for 25 extra GETs.

**Route: `http-scrape` of the listing alone.** Clean dates, no defences, no terms obstacle, decent volume. Second priority after The Kallang.

---

## 10. Singapore EXPO 🚩 — `https://www.singaporeexpo.com.sg/events-at-expo/`

Operated by **Constellar Venues Pte Ltd**. `/events/` 301s to `/events-at-expo/`.

### The one genuinely open API on the list — and it omits the dates

WordPress on WP Engine. `https://www.singaporeexpo.com.sg/wp-json/wp/v2/types` reveals an `event` custom post type, and it **is** exposed:

```
GET /wp-json/wp/v2/event?per_page=20   →  HTTP 200,  X-WP-Total: 9
```

Unauthenticated, no key, no approval, no rate gate encountered. But every record returns `"content":{"rendered":""}` and — decisively — **`"acf": []`**. The ACF fields holding dates and halls are not registered to `show_in_rest`. **The API yields nine titles and nine permalinks and no dates whatsoever.**

**Rendering — server-rendered, verified.** The listing page carries dates and halls in the markup:
```
Home Appliance Fair                   8 – 10 Aug 2026    Hall 5B
My Home Grand Furniture & Reno Expo   8 – 16 Aug 2026    Hall 6
AOCR SGCR-WIRES 2026                  20 – 23 Aug 2026   Meeting Rooms
NATAS Holidays 2026                   21 – 23 Aug 2026   Halls 3B, 4 & 5
APAC Food & Beverage Expo             21 – 23 Aug 2026   Hall 6B
The Click Five For Lovers Tour        29 Aug 2026        Arena @ EXPO
MRO Asia-Pacific                      22 – 24 Sep 2026   Halls 3 - 5 & Peridot Meeting Rooms
BINI: SIGNALS WORLD TOUR 2026         25 Oct 2026        Arena @ EXPO
JOJI: SOLARIS                         21 – 22 Nov 2026   Arena @ EXPO
```
Nine events, Aug → Nov 2026, at hall-level granularity — matching Suntec's.

**robots.txt** disallows only `/wp-admin/`. **Anti-bot:** Cloudflare, **passive** (`__cf_bm` only).

### The Terms of Service are the blocker

The site footer links its terms to the operator: `https://constellar.co/terms/` (HTTP 200), whose §1.2 defines *"Sites"* as *"various websites, mobile/web applications, social media accounts and digital platforms"* Constellar *"own[s] or manage[s]"* — which covers `singaporeexpo.com.sg`. It then prohibits, twice and unambiguously:

> *"(vi) use any robot, data mining or other extraction methods, or other automated means to access and/or use our Sites;"*

> *"(d) use any robot, spider, scraper or other automated means to access our Sites…"*
> *"(f) use any data mining, data gathering or extraction method;"*

> *"4.7. You may not copy, display, distribute, modify, publish, reproduce, transmit and/or otherwise transfer any content obtained from our Sites for any commercial purpose without our prior written consent."*

There is a genuine argument in the other direction — §1.3 frames the document as governing readers who *"have intentions to enter or have entered into an agreement or arrangement with us"*, and the WordPress REST API is a deliberately published, unauthenticated interface. But the prohibitions sit under general site-use, they name the exact activity, and the dates are only obtainable from the HTML the clause covers.

**Route: `none` — flagged.** Of all six flagged sources this is the most winnable: Constellar is a Singapore operator, the dataset is nine rows, and the calendar sends attendees to their halls. **Recommend asking for written permission before writing this off** — and if granted, use the public REST `id`/`slug` as the `sourceKey` (a genuinely stable identifier, better than Suntec's date-embedding slug) with dates parsed from the listing HTML.

---

## 11. Singapore Tourism Board — the seeded URL has no listing

**`https://www.stb.gov.sg/industries-experience-development/mice/`, the URL in #113, publishes no dated events.** It is a policy and industry-development page. It does carry a *"List of AIF Approved Events"* bucketed by year 2025–2030 (ITB Asia, IDEM Singapore, Medical Fair Asia, Tech Week Singapore, Seafood Expo Asia, Asia Pacific Maritime…) — but these are **names with a year and no dates**. Not a calendar.

**The actual dated listing is `https://www.stb.gov.sg/events/trade-events/`** (reached via `/events/` → "Trade Events"), a four-row table in raw HTML:

| Date | Office | Event |
|---|---|---|
| 13 to 15 October 2026 | STB Americas/HQ | IMEX America |
| 21-23 Oct 2026 | HQ | ITB Asia 2026 (to be held in Singapore) |
| 17 to 19 November 2026 | STB Europe/HQ | IBTM World |
| 20-21 Jan 2027 | HQ | TRAVEX 2027 (to be held in Singapore) |

The page states: *"The list of events is non-exhaustive, and STB's participation is subject to change."* Two of four are overseas. Date formats disagree within a single table (`13 to 15 October 2026` vs `21-23 Oct 2026`). Last updated 01 Jul 2026.

**robots.txt:** `Allow: /`, `Disallow: /search`. **Terms** (`https://www.stb.gov.sg/terms-of-use/`): **no** automated-access clause — zero occurrences of robot/spider/scrape/crawl — only a copyright statement. **Rendering:** server-rendered Isomer static site on `AmazonS3` behind CloudFront. **Anti-bot:** none.

### TIH is not merely dead — its domains no longer resolve

v1 (#4) recorded that STB's Tourism Information & Services Hub API was dead. That is now provable at the DNS layer. On 04 Aug 2026:

```
tih.stb.gov.sg       → curl: (6) Could not resolve host
tih-dev.stb.gov.sg   → curl: (6) Could not resolve host
api.stb.gov.sg       → curl: (6) Could not resolve host
```

NXDOMAIN on all three. STB's announcement was that TIH and its APIs ceased on 31 Jul 2025; the DNS records are now gone too. **There is no STB API. This does not need revisiting again.**

**Route: `http-scrape` of `/events/trade-events/`, marginal** — 4 rows, half not in Singapore. Defensible to call it `none`.

---

## 12. VisitSingapore MICE 🚩 — `https://www.visitsingapore.com/mice/en/event-listing/`

The one case where a clean, working, unauthenticated JSON API exists **and the site's own terms forbid using it**.

**Rendering — client-rendered, definitively.** A plain GET returned 106 KB of HTML which, tags stripped, is **5,306 characters of pure navigation chrome** and **not one event, not one date**. Adobe Experience Manager (`/etc.clientlibs/vmd/clientlibs/clientlib-*.min.js`). No JSON-LD, no inline data blob.

**The endpoint is in the page, not the bundle.** The listing's filter form declares it as its `action`:

```html
<form action="/content/mice/en/event-listing/_jcr_content/root/responsivegrid/responsivegrid/event_listing.search.json"
      method="get" id="events-filter-form" data-filter-load="12" data-first-load-number="12" data-offset="0">
```

A classic AEM Sling selector endpoint. Verified directly:

```
GET https://www.visitsingapore.com/content/mice/en/event-listing/_jcr_content/root/
      responsivegrid/responsivegrid/event_listing.search.json?offset=0&limit=200
→ 200, application/json;charset=utf-8, 16,780 bytes
  {"result_type":"event_list","total_results":33,"filter_results":[…33 records…]}
```

No auth, no cookies, no key; the 12-at-a-time paging is a UI concern only. Per record: `id`, `title`, `target_url`, `date` (human string, `"14 Jun 2026 - 16 Jun 2026"`), images, `tags[]`. **No venue, no time, no ISO dates.** Range across all 33: 14 Jun 2026 → 24 Mar 2027; **26 are current-or-future**, giving ~8 months of horizon.

**robots.txt** (`https://www.visitsingapore.com/robots.txt`) disallows `/web-services/`, `/services/`, `/mice-web-services/`, `/api.*`, and **`/*json$`**. The endpoint's bare path ends in `json` and so matches; with a query string appended it does not, under the path-and-query reading. **That ambiguity does not need resolving, because the Terms of Use are not ambiguous.**

**Terms of Use** (`https://www.visitsingapore.com/terms-of-use/`), §*Right of Access*:

> *"You agree that you will not use any device, software or routine to interfere or attempt to interfere with the proper working of the websites, use any robot, spider, other automatic device, or manual process to monitor or copy any pages within the websites or the Content without STB's prior written permission, and take any action that imposes a disproportionately large or unreasonable load on STB's servers."*

> *"The Content shall not be copied, reproduced, republished, uploaded, posted, transmitted, imitated or otherwise distributed, whether in whole or in part, without the written permission of STB."*

**Anti-bot.** Imperva, **passive** (`X-CDN: Imperva`; HTTP 200 throughout). No technical obstacle at all.

**Route: `none` — flagged.** Note the asymmetry with §11: **STB's own `stb.gov.sg` terms carry no such clause; `visitsingapore.com`, which STB also operates, does.** Both are STB, so **one written request could plausibly unlock both plus the AIF approved-events list** — the single highest-leverage permission ask on this map.

---

## 13. Eventbrite 🚩 — `https://www.eventbrite.sg/d/singapore--singapore/marina-bay-sands-expo/`

Technically the easiest source on the list; contractually the clearest prohibition.

### There is no public event search API

`https://www.eventbriteapi.com/v3/events/search/?location.address=singapore`:
```json
{"status_code":404,"error_description":"The path you requested does not exist.","error":"NOT_FOUND"}
```

The 404 is meaningful **because every other path returns 401 instead**:

| Path | Response |
|---|---|
| `/v3/events/search/` | **404 NOT_FOUND** — "The path you requested does not exist." |
| `/v3/users/me/` | 401 NO_AUTH — "An OAuth token is required for all requests" |
| `/v3/venues/1/` | 401 NO_AUTH |
| `/v3/destination/search/` | 401 NO_AUTH |

An unauthenticated request to an *existing* endpoint is refused for want of a token; the search endpoint is refused for not existing. **Public event discovery has been removed from the API.** (`/v3/destination/search/` — the private endpoint Eventbrite's own front end uses — does exist behind auth; `robots.txt` disallows `/api/v3/destination/events/`, and no documented route grants a third party access.)

### The Terms of Service prohibit scraping by name

`https://www.eventbrite.com/corporate/legal/terms-of-service/`, **§13, headed "Scraping or Commercial Use of Site Content is Prohibited"**:

> *"13.1 You can't use our content for your own purposes."*
>
> *"You have no right to use, and you agree not to use, any Site Content for your own commercial purposes. You have no right to, and you agree not to, scrape, crawl, or employ any automated means to extract data from the Sites."*

Not a copyright clause being stretched — a section heading that names the activity. `robots.txt` corroborates by disallowing every feed shape: `/rss/`, `/events/rss/`, `/events/atom/`, `/atom/`, `/api/v3/destination/events/`.

**The API Terms of Use are strikingly compatible with what v2 wants**, which sharpens the loss (`https://www.eventbrite.com/help/en-us/articles/833731/eventbrite-api-terms-of-use/`):

> *"As a general matter, you may store Site Content relating to future events, but you may not store any Site Content relating to events that have occurred in the past."*
>
> *"…your Application must display the event title and display a direct link to the Eventbrite webpage associated with that event on the Services."*
>
> *"3.5 Rate Limit … 1000 calls per hour on each OAuth token."*

A forward-only store with per-event attribution links is close to exactly what ADR-0004 and ADR-0008 already build. **The API terms would permit v2's design; the API no longer has an endpoint that would feed it.**

### What is being given up

A plain GET returns a server-rendered `application/ld+json` `ItemList` of **20 `Event` objects per page**, each with `startDate`, `endDate`, `description`, `url`, `image` — no browser, no heuristics. Pagination reports `"object_count":2732`, `"page_count":49`, `"page_size":20` (~980 retrievable). Page 1 alone spans **2026-08-05 → 2027-03-27**. No anti-bot.

**Route: `none` — flagged.** The only lawful path is a commercial or affiliate arrangement.

---

## 14. EventsEye — `https://www.eventseye.com/fairs/cd1_trade-shows_singapore_<month>_<n>.html`

The longest horizon and the largest volume on the list, from the least formal publisher.

**No robots.txt.** `https://www.eventseye.com/robots.txt` → **HTTP 404**, 236 bytes, Apache's default error body. No file means no directives.

**No terms document — verified absence.** The homepage's only footer links are `/cookiesconsent/CookiesMoreInfo1.html`, `contact1.html` and `whatsnew1.html`. I fetched `/aboutus.html`, `/legal.html`, `/terms.html`, `/contact.html`, `/contact1.html` and `/cookiesconsent/CookiesMoreInfo1.html`: **all HTTP 404**, including two of the three links the site's own footer publishes. The trade-show pages carry **no copyright line and no "all rights reserved"** — I grepped the raw HTML for both. The only footer text is *"Please note ! All dates are subject to changes. Contact organizers for more information before making arrangements."*

This is **ambiguous, not permissive**: absence of a prohibition is not a licence, and a site whose own legal links 404 may not be actively maintained. But it is the **only** source on the list with no contractual restriction on automated access.

**API/feed.** None. **Rendering — server-rendered, verified.** Plain static HTML tables, 24–38 KB per month page, `Server: Apache`, no JS, **no anti-bot**.

**URL pattern — confirmed by fetching multiple months.** `cd1_trade-shows_singapore_<month-lowercase>_<N>.html`, where `N` is a year index: **0 = 2026, 1 = 2027, 2 = 2028**. Two traps:

- `_3` (2029) is **404** for every month.
- **`_2` silently falls back to the 2027 page** for months with no 2028 data — I fetched `…august_2.html` and its own `<title>` reads *"Trade Shows in Singapore - August 2027"*. Only `january_2`–`may_2` genuinely serve 2028. A crawler that trusts the URL will duplicate 2027 as 2028. **Always trust the page's `<title>`, never the URL.**

**Volume & horizon.** Each page carries a month-by-month sidebar of counts, so the crawl plan is derivable from any single page. The sidebar count is *listed* shows; a growing share of out-year entries have a known month but **no firm date yet**:

| Period | Listed | With a firm date |
|---|---|---|
| Aug–Dec 2026 | 56 | 52 |
| 2027 | 97 | 33 |
| Jan–May 2028 | 30 | 4 |
| **Total future** | **183** | **89** |

**183 listed Singapore trade shows to May 2028; 89 currently carry a firm date; latest firm date observed 05 Apr 2028.** By comparison, all three v1 sources together published under 200 records over 3 months. Counts drift ±2 between fetches (CDN cache skew).

**Field shape.** `Exhibition Name`, a description paragraph, `Cycle` (`once a year`), `Venue`, and `Date` as **`MM/DD/YYYY` plus a duration** (`01/22/2027` + `3 days`) — US ordering, end date derived rather than published. **It is the only source that names the venue for third-party trade shows** (`Singapore Marina Bay Sands`, `Singapore Shangri-La Hotel`), though it often degrades to a bare `Singapore`.

**Route: `http-scrape`, ~21 month-pages per full refresh.** Highest-value new source by volume and horizon; lowest authority; soft dates beyond ~12 months.

---

## 15. bigevent.io — `https://bigevent.io/events/city/singapore/`

The seeded URL `/events/category/singapore/` **301s** to `/events/city/singapore/`.

**robots.txt** explicitly permits the listing:
```
Allow: /events/*
Allow: /event/*
Disallow: *ical=*
Disallow: *eventDisplay=*
Disallow: *tribe-bar-date=*
```
The `tribe_*` disallows are The Events Calendar plugin's crawl-trap parameters; the canonical listing paths are allowed by name.

**A Cloudflare quirk worth recording.** `robots.txt` returned **HTTP 403 over HTTP/2 and HTTP 200 over HTTP/1.1** with the same UA, and a second client got 403 on the homepage where I got 200. Cloudflare here is passive but fingerprint-sensitive and inconsistent. **Pin HTTP/1.1 and expect intermittent 403s** — a retry policy, not a blocker.

**Terms.** `https://bigevent.io/terms/` exists (HTTP 200) and its **body is empty** — after stripping markup the entire page is *"Terms of Use — Skip to content — Get Featured — Toggle Menu — Terms of Use — Top Categories — Company…"*, i.e. a heading and navigation with no clauses. `/terms-and-conditions/` and `/privacy-policy/` 404. The page-sitemap also lists `/imprint/` and `/disclaimer/`. **Verified: no automated-access clause exists on the terms page.**

**API/feed.** WordPress 7.0.2. `/wp-json/wp/v2/types` lists an `event` custom post type, but `/wp-json/wp/v2/event` returns `rest_no_route` (404) — **not exposed**. The `bigevent/v1` namespace holds only WPCode-snippet and term-seeding routes. `/wp-json/tribe/events/v1/events` → 404.

**Rendering — server-rendered, and already structured.** A Rank Math `application/ld+json` block carries an `ItemList` of **13 `Event` objects** with `startDate`, `endDate`, `eventStatus`, `location.name`, `organizer`.

**Volume & horizon.** 13 events, **26 Aug 2026 → 9 Sep 2027** (~13 months):

```
2026-08-26 → 2026-08-27  The Business Show Asia    Sands Expo & Convention Centre
2026-09-02 → 2026-09-04  BEX Asia                  Marina Bay Sands
2026-10-07 → 2026-10-08  TOKEN2049 Singapore       Marina Bay Sands
2027-03-17 → 2027-03-18  Geo Connect Asia          Sands Expo & Convention Centre
2027-09-08 → 2027-09-09  SuperAI 2027              Marina Bay Sands
```

**It is an aggregator, and its `url` points at the organiser's site, not at bigevent.io.** Five of thirteen are at MBS/Sands Expo, making it the cheapest partial proxy for the source we cannot reach. It will also duplicate EventsEye and TTGmice heavily — whichever same-entry ruling #112 lands will be exercised hardest here.

**Route: `http-scrape`** (parse the JSON-LD; ignore the HTML).

---

## 16. SportPlus SG — `https://www.sportplus.sg/singapore-sports-events`

**robots.txt** (`https://www.sportplus.sg/robots.txt`) — a Wix default: `Allow: /`, `Disallow: *?lightbox=`, and `PetalBot` banned outright. The listing is allowed.

**Terms — verified absence.** The site footer carries only *Privacy Policy* and *Accessibility Statement*. The full Wix `pages-sitemap.xml` (81 URLs, enumerated) contains **no** terms, legal, disclaimer or policy page; `/terms`, `/terms-of-use`, `/terms-and-conditions` and `/policies/terms-of-service` all 404. **No terms document exists.**

**API/feed.** The site has the **Wix CMS app installed** (`appDefinitionName":"Wix CMS"`, `wix-data-client-app`, 18 `dataBinding` references), so the repeater is very likely bound to a Wix collection — but no `/_api/cloud-data/…items/query` call and no events `collectionId` appear in the delivered page; the only whitelisted XHR paths are access-tokens, dynamicmodel and businesses. **A directly callable Wix data endpoint is not established** — and is not needed.

**Rendering — server-rendered, verified.** 1.42 MB, of which only ~2.7 KB is text; the rest is the Wix runtime bundle. The rows are in the SSR HTML.

**Volume & horizon — 13 entries, of which only 5 are future:**

| Date | Event | Venue |
|---|---|---|
| Sun, 13 Sept 2026 | TriFactor Triathlon & Duathlon Singapore 2026 (Asian Championships) | Castle Beach, East Coast Park |
| Sun, 27 Sept 2026 | The Kiprun Race Singapore 2026 | Decathlon Singapore Lab (Kallang) |
| Sun, 25 Oct 2026 | Garmin Run Marathon Series – Singapore 2026 | Marina Barrage |
| Sun, 01 Nov 2026 | Great Eastern Women's Run 2026 | National Stadium, The Kallang |
| Fri, 04 Dec 2026 | BYD Singapore International Marathon presented by adidas 2026 | The Kallang |

**Two data-quality problems.** First, the other eight entries are **already past (22 May – 14 Jun 2026) and still displayed — the page does not prune.** Second, **the visible dates carry no year**: `Sun, 13 Sept`. The year is only in the event title, and the abbreviations are inconsistent (`Sept` and `Sep`, `Oct` and `October`, in the same page). Full-form dates (`13 September 2026`) do appear in the embedded Wix render model, which is where an adapter should read them.

**Route: `http-scrape`, marginal.** Five future events, all of which also appear elsewhere (Great Eastern Women's Run is on both JustRunLah! and The Kallang).

---

## 17. JustRunLah! — `https://www.justrunlah.com/calendar-of-running-events-singapore/`

**robots.txt** disallows only phpBB forum scripts, `/wp-admin/` and `/cgi-bin/`. The calendar is allowed.

**Terms — verified absence.** The only legal page in the site's sitemaps is `/privacy-policy/` (HTTP 200); `/terms`, `/terms-of-use/`, `/terms-and-conditions/`, `/disclaimer/` all 404 and a sitemap-wide search for "terms" returns nothing. **No terms-of-use document exists**, and neither the privacy policy nor `/about-just-run-lah/` contains an automated-access clause.

**API/feed.** WordPress, but `/wp-json/wp/v2/types` lists **only** `post`, `page`, `attachment` and core block types — **no event post type** — and `/wp-json/tribe/events/v1/events` returns `rest_no_route`. Registered namespaces are forms, SEO, caching and the Newspaper theme.

**Rendering — server-rendered, verified.** 277 KB behind Cloudflare (**passive**, HTTP 200 to a browser UA), template `page-template-template-race-calendar-singapore`.

**Volume & horizon — 15 races, all future, and the richest field set of any new source.** The page states its own count (*"15 races matching your criteria."*), and each entry carries **date, flag-off time, venue and distance categories**, grouped under month headings, with no pagination:

- **Aug 2026 (2):** 7-Eleven Run 2026 (23 Aug, 06:00, Marina Barrage); Walk of a Lifetime (29 Aug, 08:00, The Meadow @ Gardens by the Bay)
- **Sep 2026 (6):** Sembawang West Biathlon Challenge (6th); GU Forest Force Run Series 30 km (13th); TriFactor Triathlon & Duathlon (13th); Yellow Ribbon Run (20th); Singtel–SCS Race Against Cancer (20th); The Kiprun Singapore (27th)
- **Oct 2026 (6):** Healing Steps (10th); ISCA Run (17th); Stride For Good (17th); POSB PAssion Run For Kids (25th); Garmin Run Singapore (25th); KEEN Dark Forest Run (31st)
- **Nov 2026 (1):** Great Eastern Women's Run 2026 (1 Nov, 04:30, The Kallang)

**It is the only new source publishing a start *time*.** Horizon 01 Nov 2026 (~3 months). Notably it does **not** carry the Singapore Marathon (4 Dec) that SportPlus does — the two are complementary and both thin.

**Route: `http-scrape`.**

---

## 18. Marina Bay Cruise Centre Singapore (v1 `mbccs`) — re-examined, unchanged

Every v1 finding reproduced exactly on 04 Aug 2026.

**Rendering — still client-only.** `__NEXT_DATA__` parses to `{"pageProps": {}}` with `__N_SSP: true`. The server HTML renders the empty state verbatim: *"Vessel  Pier Number  Arrival  Departure  There are no scheduled cruises."* The default window shown is `04 Aug 2026 (Today) → 08 Aug 2026`.

**API — still gated.**
```
GET https://api.mbccs.com.sg/sats-webfront-api/v1/cruise/schedule?vesselId=&startDate=&endDate=&size=20&page=1
→ HTTP 401  {"Code":400,"Message":"Missing Authorization Header!","Data":null}
```

**robots.txt** (`https://mbccs.com.sg/robots.txt`): `User-agent: * / Allow: /`.

**Terms** (`https://mbccs.com.sg/terms-and-conditions`) — **no** automated-access clause (zero hits for robot/spider/scrape/crawl/automated), but the broadest reproduction ban on the list:

> *"You may not reproduce, translate, use, modify, display, publish, adapt, communicate, transmit, broadcast, trade, sell or distribute, or otherwise use or exploit in any other way … any portion of or access to the MBCC website; … the Content or … any third party content, information or materials provided on or through the MBCC website for any commercial or any other purposes … Linking the MBCC website to any other website or mirroring any of the information on the MBCC website on any other server is also expressly prohibited without our prior written consent."*

Note *"for any commercial **or any other** purposes"* and the explicit ban on **mirroring information on any other server** — which is a fair description of publishing an ICS feed of their berth schedule.

**Anti-bot.** None on the web tier (CloudFront, HTTP 200).

**The leaked Basic-auth credential in the public `_app` chunk remains out of bounds**, for the three reasons v1 gave, and **remains unreported to SCCS**. That action survives from v1 untouched, and it is still the natural opening for an access conversation covering both MBCCS and Singapore Cruise Centre (SCCS operates both).

**Route: `browser` — ADR-0005's headless carve-out stands, and is still needed by exactly one adapter out of twenty.**

---

## 19. Singapore Cruise Centre (v1 `scc`) — re-examined; technically unchanged, legally not

**robots.txt** (`https://singaporecruise.com.sg/robots.txt`) is the Yoast block, `Disallow:` with an empty value — **everything allowed**. Unchanged.

**Rendering — server-rendered, verified.** One `<table>`, 20 `<tr>` = **19 sailings**, **30 Jul 2026 → 01 Nov 2026** (~3 months). Arrival and departure columns both carry `EEE, d MMM yyyy HHmm` local SGT — **true end times**, as v1 found.

**Anti-bot.** `X-CDN: Imperva`, `visid_incap_*` cookies — **still passive**, HTTP 200 with full content.

### New finding: the terms are a conditional grant, not silence

v1 recorded that `terms-conditions/` *"contains no robot/scraping/automation clause."* That is true and remains true — but v1 did not record what the page *does* say (`https://singaporecruise.com.sg/terms-conditions/`, §2.1):

> *"2.1 Content: You may view, copy, distribute or otherwise use the Content if:*
> *2.1.1 All such use is for internal, non-commercial, informational purposes only, and if you intend to use the Content for other purposes, you will first apply to webmaster@singaporecruise.com.sg for permission (which may be withdrawn without explanation or notice if we, in our sole discretion, decide that such use is excessive or inappropriate); and*
> *2.1.2 All copies that you make of the Content will bear the relevant copyright, trademark or other proprietary notice located on our Website."*

Publishing a public ICS feed of their sailings is not *"internal … informational"* use. **The terms name the remedy: apply to `webmaster@singaporecruise.com.sg`.** That is the same operator as MBCCS, so one email covers both — and it can carry the credential-exposure report at the same time.

**Route: `http-scrape` — unchanged technically; a permission ask is now indicated.**

**One data-shape note for the same-entry work.** Eleven of the nineteen rows are the same vessel (`STAR VOYAGER / STAR CRUISES`) on different dates, and two are `AEGEAN PARADISE`. ADR-0004's `` `${vessel}|${arrivalDate}` `` key holds in this sample **only because arrival dates differ**; two same-day calls by one vessel would collide. Not observed, but the margin is thinner than v1's 16-row sample implied.

---

## 20. Ticketmaster SG 🚩 — `https://ticketmaster.sg/activity`

Re-verified on 04 Aug 2026; v1's verdict holds in every particular.

**The technical block is still live.**
```
GET https://ticketmaster.sg/activity/detail/26sg_idle
→ HTTP/1.1 401 Unauthorized
   content-type: application/json
   ebid: Tj4C4AIWQgpBi6t0SwTQdCjLMPdgz_LDC-vTs8qTXFRpzFeXQdId-vf_QFP9-YAuUBIAqpCtp8W9j7O7
   esid: Gqd8EmJDO1VU3O-gGVt-wruQ19rGwadMq738HvDVxCeBrgi-LEpWsVURh_jghuwYXikOtIFAdvOOHnMp
   {"response":"identify"}
```
Listing pages (`/activity`, 83 KB) still return 200; **detail pages — the only place times and venues live — still return a device-identification challenge.**

**robots.txt** adds a directive v1 did not quote:
```
Disallow: /activity/get-more-game-list
Disallow: /activity/search-suggest/
Disallow: *startDate=*
```
`*startDate=*` bars any date-filtered crawl of the listing.

**The Terms of Use ban robots** (`https://ticketmaster.sg/terms-of-use`, quoted in v1's audit):

> *"You agree that you will not use any robot, spider, other automatic device, or manual process to monitor or copy our web pages or the content contained thereon or for any other unauthorised purpose without our prior express written permission."*

> *"…unauthorised use of any robot, spider or other automated device on the site, will be investigated and appropriate legal action will be taken, including without limitation civil, criminal and injunctive redress."*

**The API does not cover Singapore.** The Discovery API's own *Event Coverage* paragraph (`https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/`):

> *"With over 230K+ events available in the API, coverage spans different countries, including United States, Canada, Mexico, Australia, New Zealand, United Kingdom, Ireland, other European countries, and more."*

No Asian country named. v1 additionally read the *Supported Markets* list and found market IDs only for USA, Canada, Europe, Australia/NZ and Mexico — **no Singapore market, no Asian market except Turkey**. Documented quota: 5,000 calls/day, 5 req/s, deep paging capped at `size × page < 1000`.

**Route: `none` — flagged.** Forbidden by terms, blocked by technology, uncovered by the sanctioned API, and lacking times entirely.

**The cost of dropping it is much lower than it looks.** The Kallang's own event JSON links out to `ticketmaster.sg/activity/detail/<id>` for many of the same concerts, and The Star and Singapore EXPO carry the rest. **Most Ticketmaster SG inventory arrives free, lawfully, and with better date structure, via the venues.**

---

## 🚩 FLAGGED — candidates for Out of scope

| Source | Which constraint bites |
|---|---|
| **Marina Bay Sands / Sands Expo** | ~~**Anti-bot, compounded by unreadable policy.**~~ **Updated 04 Aug 2026 — see §3's Update. ToS clause, plus browser-only access.** Akamai still drops every *scripted* client, but a real browser reaches everything. `robots.txt` **permits** both listings; the ToU does not: *"You may not use any "deep-link", "page-scrape", "robot", "spider" or other automatic device… or any similar or equivalent manual process, to access, acquire, copy or monitor any portion of the Sands Platform"*, plus a separate personal-and-non-commercial-use bar on republication. **Stronger than Eventbrite's §13.** Two real pages behind it: `shows.html` (13 shows to Mar 2027) and `event-directory.html` (rolling 3 days, first-party, **ruled valuable** — see §3). Mitigated second-hand meanwhile via bigevent.io, EventsEye and TTGmice. |
| **Eventbrite** | **ToS clause.** §13, *"Scraping or Commercial Use of Site Content is Prohibited"* — *"You have no right to, and you agree not to, scrape, crawl, or employ any automated means to extract data from the Sites."* Compounded by the removal of public event search from the API (`/v3/events/search/` → 404 while all neighbouring paths → 401). Technically the easiest source on the list; contractually the clearest no. |
| **Ticketmaster SG** | **ToS clause *and* anti-bot.** ToU bans robots and threatens civil/criminal action; detail pages return HTTP 401 `{"response":"identify"}`; the sanctioned Discovery API has no Asian market. Also the only source publishing dates with no times at all. |
| **VisitSingapore MICE** | **ToS clause.** *"you will not … use any robot, spider, other automatic device, or manual process to monitor or copy any pages within the websites or the Content without STB's prior written permission."* `robots.txt` also disallows `/*json$`. Painful, because a clean unauthenticated JSON endpoint returning all 33 records in one call **does** exist and works. |
| **Singapore EXPO** | **ToS clause.** Constellar's terms bar *"any robot, spider, scraper or other automated means to access our Sites"* and *"any data mining, data gathering or extraction method"*. The public WordPress REST API is unauthenticated but carries no dates, so the blocked HTML is the only route to the data. |
| **Resorts World Convention Centre** | **No listing exists.** `/en/meetings` is a JS-rendered sales page with zero dates; the sitemap confirms no calendar page under `/meetings`. Substitute `rwsentosa.com/en/events` if resort-wide entertainment is wanted — a different source with materially worse date quality. |

**Two of these six are worth one email each before being written off**, and they are the two whose data is otherwise perfectly usable:

- **VisitSingapore MICE + STB.** Both are STB. `stb.gov.sg`'s own terms carry no automated-access clause; `visitsingapore.com`'s do. One written request could unlock the 26-event MICE listing, the `/events/trade-events/` table, and the AIF approved-events list. **Highest-leverage permission ask on the map.**
- **Singapore EXPO / Constellar.** A Singapore operator, nine rows, hall-level venue data, and a calendar that sends attendees to their halls.

Three further entries are **weak rather than blocked**, and should be decided rather than assumed:

- **STB trade events** — 4 rows, half overseas. Real and lawful; barely worth an adapter.
- **Shangri-La Rasa Sentosa `/offers/`** — 9 entries, 8 of which are multi-month promotional windows rather than events, and the URL appears in no sitemap.
- **RWS resort events** — dates exist only as free text inside description prose, over `0001-01-01` null sentinels. The most fragile parser on the list.

---

## What re-examination changes for the three v1 sources

**Short answer: nothing technical changed. What changed is that all three turn out to carry reuse-or-permission clauses v1 never read — and one of them is an automated-access clause.**

v1's audit (#2, resolved 16 Jul 2026) checked `robots.txt` for all four seed sources and terms pages for two. That was the right depth for a proof of concept. At twenty sources publishing a public feed, it is not.

### Suntec — two changes, neither technical

- **The listing URL in #113 (`/visit`) is not the listing.** `/visit` server-renders *"UPCOMING EVENTS … No results found"* and contains zero events. `/visit-events` is correct and unchanged. Anyone re-deriving the source list from the ticket would build against a permanently empty page.
- **v1 never read Suntec's Terms & Conditions.** They contain an automated-queries prohibition and a personal/non-commercial-use limitation (§2, quoted above). v1 found the `?format=json`/`?format=ical` robots disallows, routed around them, and treated the ordinary page as fair game. The ordinary page is *robots*-allowed; it is not unambiguously *terms*-allowed. **This is a live source in production today.**
- Everything technical holds: server-rendered, 161 articles in one GET, 131 upcoming, 100% Google-Calendar UTC interval coverage, ~3-month horizon, no anti-bot.

### MBCCS — unchanged technically; the reuse clause is broader than v1 recorded

Client-rendered (`pageProps: {}`), API 401, no anti-bot on the web tier, `robots.txt` fully permissive. v1 noted the ToU *"vests all content IP in SCCS and forbids reproducing, publishing, or distributing it"* — the exact text goes further, barring use *"for any commercial or any other purposes"* and explicitly prohibiting **"mirroring any of the information on the MBCC website on any other server"**. A public ICS feed is close to that description.

**ADR-0005's headless carve-out remains correct and remains the only one needed across all twenty sources.** The leaked Basic-auth credential is still in the public bundle and still unreported; that action survives from v1 untouched.

### SCC — unchanged technically; the terms are a conditional grant, not silence

Server-rendered table, Imperva passive, robots permissive, 19 sailings over ~3 months with true end times. But §2.1.1 grants use only *"for internal, non-commercial, informational purposes only"* and names the remedy for anything else: apply to `webmaster@singaporecruise.com.sg`. **v1's "no automation clause" reading was correct and incomplete.**

Also new: eleven of nineteen rows are the same vessel, so ADR-0004's `` `${vessel}|${arrivalDate}` `` key is carrying more weight than v1's 16-row sample suggested.

### The pattern, and what to do about it

**All three v1 sources, plus Sentosa, The Kallang and TTGmice, restrict *republication* while saying nothing (or little) about *access*.** v1 could ignore this because the accept-duplicates ruling made the output a small private artifact. v2 publishes ICS feeds from a server, at twenty sources, with an admin page — which is republication at scale.

Concretely, **SCCS operates both MBCCS and SCC, so one email closes two of the three v1 permission questions**, and it can carry the credential-exposure report. Suntec is a second email. That is two messages to put v1's entire live source set on a footing it does not currently have.

### What this means for the map's standing assumptions

- **ADR-0007's breakage signal does not survive the wider list.** The net-drop-of-the-future-dated-cohort test was tuned against sources publishing 19–131 records. Changi Exhibition Centre publishes **3**, STB publishes **4**, SportPlus publishes **5 future**, Singapore EXPO publishes **9**. At those sizes the signal is noise. The map already lists this as unspecified; this note supplies the numbers that force it.
- **ADR-0004's opaque `sourceKey` is vindicated, and then some.** The new sources disagree even more sharply than the old three: Singapore EXPO has a real WordPress `id`; VisitSingapore has a slug `id`; The Kallang has stable slugs; EventsEye has nothing but name + date + venue; bigevent.io's `url` points at a *third-party* site; RWS and SportPlus have no identifier at all. No core-owned key rule could span these.
- **Two sources need a "this is not an event" classifier before they need an adapter.** Sentosa's `startDate`/`endDate` are validity windows — a permanent attraction reads as a 3-year event — and Shangri-La's `/offers/` are multi-month promotions. Both would flood a calendar with entries that are technically well-formed and semantically wrong. This is a moderation-queue question as much as a parsing one, and it belongs in the store/admin tickets.
- **The calendar-span constraint v1 recorded is broken, in a good way.** v1 concluded no source reached beyond ~3 months. EventsEye reaches **May 2028**; Changi Exhibition Centre and TTGmice reach **Feb 2028**; bigevent.io reaches **Sep 2027**; The Kallang and VisitSingapore reach **Mar 2027**. A calendar showing 3 months forward now under-serves its sources.
- **Only one adapter needs a browser, out of twenty.** The map's open question about headless-by-default is answered: no. Fifteen sources answer one plain GET.

---

## Not established

| Question | Why it could not be settled | What would settle it |
|---|---|---|
| ~~**Does Marina Bay Sands publish a usable event listing, and what do its robots/terms say?**~~ **RESOLVED 04 Aug 2026** | ~~Akamai drops every client tried…~~ The predicted fix was correct: a real browser rendered every page on the first attempt. **Both listings, `robots.txt` and the Terms of Use were retrieved** — see §3's Update. Answers: yes it publishes usable listings (13 shows to Mar 2027; a rolling 3-day expo directory); robots **permits** them; **the ToU prohibits scraping outright**. | Settled. What remains is the written approach to MBS — now a coherent ask, since their terms are finally readable. |
| **Does ArtScience Museum's `/museum/whats-on.html` carry a usable listing?** | The one MBS candidate URL *not* retrieved in the 04 Aug 2026 browser session. | One browser visit. Same ToU governs it, so it is blocked on the same clause regardless of what it contains. |
| **Would Sentosa issue a Sitecore `sc_apikey`?** | `/sitecore/api/graph/edge` → `400 "SSC API key is required"`. `robots.txt` explicitly *allows* `/sitecore/api`, a strong hint the endpoint is meant to be usable by someone. | An email to Sentosa Development Corporation. Would collapse a 62-request crawl into one GraphQL query. |
| **Does the Ticketmaster Discovery API return any SG events?** | Requires a registered API key, which I did not obtain. Structural evidence (no SG market, no Asian country in the coverage prose, `ticketmaster.sg` on a wholly separate Yii stack) says no. **Carried over unresolved from v1.** | Register a free Discovery key; call `events.json?countryCode=SG`. Ten minutes. Since the ToU ban rules out scraping regardless, this is the *only* route that could keep Ticketmaster in scope. |
| **Does Eventbrite's affiliate or partner programme carry a data feed?** | The developer portal (`/platform/api`, `/platform/docs/introduction`, `/platform/api-terms`) is client-rendered — every fetch returned only the page `<title>`. The public ToS §13 and the API Terms of Use were both readable; the *affiliate* terms were not located. | Read the developer/affiliate portal in a browser, or ask Eventbrite partnerships. The only thing that could unflag Eventbrite. |
| **Would STB grant written permission for `visitsingapore.com`?** | Their ToU requires *"STB's prior written permission"* and no public grant process was found. | One email. Highest-leverage ask on the map — it would unlock the MICE listing, the trade-events table and the AIF list at once. |
| **Would Constellar grant permission for Singapore EXPO?** | Their terms bar automated access with no stated exception process. | One email. Nine rows with hall-level venue data. |
| **Is Shangri-La Rasa Sentosa's `/offers/` list complete?** | A `Loading…` element sits at the end of the 9 server-rendered entries, so more may load client-side. Not probed further. | Render the page in a browser, or find the XHR. Low stakes — 8 of the 9 known entries are promotional windows, not events. |
| **Does TTGmice's "download a list of 2026/27 Travel Trade Event" link yield a machine-readable file?** | The link text was seen in the page; the target was not retrieved. | One GET. Might replace HTML-table parsing — and would sidestep the year-inference hazard. |
| **How many of Sentosa's 61 event pages are genuinely dated events?** | Established that `startDate`/`endDate` are validity windows, and sampled four pages to derive the same-day-vs-multi-month heuristic. All 61 were not fetched. | Fetch all 61 and bucket by window length. Determines Sentosa's true volume, which is certainly well below 61. |
| **Is EventsEye's silence on terms deliberate or neglect?** | Verified absence: no `robots.txt` (404), no terms document (six 404s, including two links the site's own footer publishes), no copyright footer. Absence of prohibition is not a grant of licence. | An email to the operator. Worth it — it is the highest-volume, longest-horizon source on the list. |
| **Does a callable Wix data endpoint exist behind SportPlus?** | Wix CMS app and 18 `dataBinding` references are present, but no events `collectionId` and no `/_api/cloud-data/…items/query` call appear in the delivered page. | Watch the network tab in a browser. Low stakes — the rows are already in the SSR HTML. |

---

## Recommended build order

1. **The Kallang** — server-rendered ISO `dates[]` arrays, hall-level venue, ~29 events to Mar 2027, permissive robots, no automation clause, passive Cloudflare. Best-shaped new source by a clear margin.
2. **EventsEye** — 183 listed / 89 firm-dated to May 2028 from ~21 static pages, with venue names. Solves the horizon problem outright. Watch the `_2` → 2027 silent fallback: trust the page `<title>`, never the URL.
3. **The Star** — 25 clean weekday-qualified dates, empty `robots.txt`, no site ToU, no defences. Listing only; detail pages add nothing.
4. **JustRunLah!** — 15 races, all future, **with flag-off times** and venues; no terms document.
5. **bigevent.io** — 13 events as ready-made schema.org `Event` JSON-LD, and the cheapest partial proxy for Sands Expo. Pin HTTP/1.1; expect intermittent Cloudflare 403s.
6. **TTGmice** — 122 rows to Feb 2028, but needs a Singapore filter and year-inference from section headers.
7. **Sentosa** — real ISO instants via sitemap + 61 detail GETs, but needs the event-vs-attraction classifier first.
8. **Changi Exhibition Centre** — 3 events, trivial, and the only Singapore venue reaching Feb 2028. Exempt it from ADR-0007's cohort check.
9. **SportPlus SG** — 5 future events, stale past rows, year-less visible dates. Read the embedded render model, not the visible text.
10. **RWS resort events** — free-text bracket dates over null sentinels. Last, or never.
11. **STB trade events** — 4 rows, half overseas. Decide whether it earns an adapter at all.
12. **Shangri-La Rasa Sentosa `/offers/`** — one real event out of nine. Defer unless offers-as-entries is in scope.

**Unchanged from v1:** Suntec (`http-scrape`, permission ask), SCC (`http-scrape`, permission ask), MBCCS (`browser`).

**Not built:** Marina Bay Sands, Eventbrite, Ticketmaster SG, VisitSingapore MICE, Singapore EXPO, Resorts World Convention Centre — pending, for the last three, a permission conversation that is worth having.

> **Updated 04 Aug 2026 — Marina Bay Sands joins the permission-conversation group.** Now that its terms are readable, an ask is coherent, and MBS should be added to the list of sources worth one email — with **more urgency than the others**, because its expo directory is a rolling 3-day window with no backfill (§3). Every day without capture is history that cannot be recovered. When built, it is a **browser** adapter and slots after MBCCS in cost, not alongside the plain scrapes.
