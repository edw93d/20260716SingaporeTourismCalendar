# Source register

The per-source legal facts behind [ADR-0021](adr/0021-reading-sources-that-forbid-it.md).

**This file is the record of what was read.** v1's audit was indefensible not because it reached the
wrong conclusion but because it checked `robots.txt`, stopped, and left no record — so there was
nothing to point at when the question was reopened. A row here is what a permission email is drafted
from, what an objection is answered from, and what an adapter PR is checked against.

**A stale register is worse than none, because it looks authoritative.** Two rules keep it honest:

- **Any adapter touched re-reads that source's terms in the same PR**, and updates its row.
- **The whole file is re-read annually**, on the date in *Review* below.

**Never record a credential here**, or anywhere else in this repository — including one a source has
exposed in its own public bundle. See ADR-0021 §7.

Where a fact was not established, the cell says so. A blank or a guess would defeat the point.

---

## Review

| | |
|---|---|
| **Created** | 05 Aug 2026 (#123) |
| **Last full re-read** | 05 Aug 2026 |
| **Next scheduled re-read** | 05 Aug 2027 |

Also re-read on: any objection from any source (re-read **all** rows).

⚠️ **Publishing v2 in any form — making the repository public, deploying the site, sharing a feed
URL — voids ADR-0021 §5 and every *cleared by private use* verdict in this file.** That is a
re-decision, not a re-read.

---

## Status vocabulary

**Route** — `http-scrape`, `browser`, or `stopped`.

**Permission**
- `not-barred` — the source forbids nothing; **no email is ever sent** (ADR-0021, *Alternatives
  rejected*). Asking manufactures a refusal risk out of nothing.
- `not-asked` — barred, no email sent yet.
- `disclosed-no-reply` — notice-and-opt-out sent, no response. **Not** the same as `not-asked`: it
  means the source has been told what we take and given a one-line way to stop it. Silence changes
  nothing either way (ADR-0021 §6).
- `granted` — written permission held. The source is lawful, permanently.
- `refused` — hard stop. Reading, storing and publishing all cease.

**Cleared by private use?** — whether ADR-0021 §5 (private repository, personal use, non-commercial)
switches the clause off. *Non-commercial alone* would clear only one clause on the whole list;
adding *personal and private* clears four more, because most reuse clauses pair *non-commercial*
with *personal* or *internal*. Marked `n/a` where the source bars nothing.

⚠️ **No access clause is ever cleared by this.** Scraping is breached at any price and for any
purpose — that class is irreducible while the project exists, and it is the class the MVP is about.

---

## Sources bound by a clause

Every row here is read and stored under accepted MVP risk. **None is republished** — ADR-0021 §5
keeps the repository private and the calendar personal. None trips a hard stop.

| Source | Route | `robots.txt` | Operative clause | Cleared by private use? | Permission | Terms last read |
|---|---|---|---|---|---|---|
| **Suntec** *(v1, production)* | `http-scrape` | Allows the page to every agent | T&C forbid "automated queries of any sort"; use limited to personal / non-commercial | **Reuse limb yes**; the automation clause survives | `not-asked` | 04 Aug 2026 |
| **SCC** *(v1, production)* | `http-scrape` | Not established | ToU §2.1.1 grants use for "internal, non-commercial, informational purposes only" | **Yes** — see ⚠️ below | `not-asked` | 04 Aug 2026 |
| **MBCCS** *(v1, production)* | `browser` | Not established | ToU bans reproduction "for any commercial **or any other purposes**" | **No** — an all-purposes ban | `not-asked` | 04 Aug 2026 |
| **Singapore EXPO / Constellar** | `http-scrape` | Disallows only `/wp-admin/` — listing **explicitly allowed** | §3.1(b)(vi) and §4.8(d) bar robots / scrapers / extraction; **§3.1(b)(i) bars archive, reproduce, distribute, publish**; §4.5 all content copyrighted; §4.7 bars commercial reuse | **Partly** — §4.7 and §3.1(b)(i)'s *publish* limb fall away; *archive*, *reproduce* and both robot clauses survive | `not-asked` | 05 Aug 2026 |
| **Marina Bay Sands** | `browser` | **Allowed by omission** — 17 `Disallow` lines covering casino, rewards-club, team-member, `/reservations/`, `/mbs/booking/`, `*?offerCode=`, `*promocode=`; **expo and the event directory are never mentioned**. `SearchSG` alone gets a blanket `Disallow: /`. ⚠️ The file itself is unreachable except from a browser | `terms-of-use.html`: ToU bars "deep-link", "page-scrape", "robot", "spider" **"or any similar or equivalent manual process"** to "access, acquire, copy or monitor"; separate **Personal and Non-Commercial Use Limitation** barring reproduce / publish / distribute. Scope is "all associated sites linked to www.marinabaysands.com" — the event directory is squarely inside it | **Reuse limb yes**; the scraping clause survives — and it is the strictest on the list | `not-asked` | **05 Aug 2026** — re-verified live |
| **Changi / CAG** *(arrivals)* | `http-scrape` | Not established | Conditions of Use limit content to "your own **personal** and non-commercial use"; forbid storing it "in any information retrieval system" without written permission | **Partly** — the personal/non-commercial limb yes; the retrieval-system ban is unconditional and survives | `not-asked` — held deliberately, [#127](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/127) | 04 Aug 2026 |
| **VisitSingapore MICE** | not built | Not established | ToU bars "any robot, spider, other automatic device" | **No** — an access clause | `not-asked` | 04 Aug 2026 |

⚠️ **SCC was the weakest clause held, and private use clears it.** Its "internal" limb barred the
*distribution* regardless of method or money, and facts-only had no answer to it — the one clause on
the list with no defence. Not republishing removes it. Recorded because it is the single largest
change private use makes, and it reverses on the day anything is published.

⚠️ **Constellar §3.1(b)(i) still shapes every email.** Our store *archives* even when it does not
publish, and the clause bars *archive* and *reproduce* independently of *publish*. Every notice
still names automated access **and** storage **and** republication together — asking narrowly now
would mean renegotiating later. Only §3.1 is explicitly curable: everything in it is prefaced
"without our prior written consent", while §4.8 carries no carve-out.

⚠️ **Marina Bay Sands is now the strictest live clause**, having inherited the position SCC vacated.
Its ToU bars page-scraping "or any similar or equivalent manual process" — closing even the
transcribe-it-by-hand door — and that is an access clause, so private use does nothing for it.

---

## Sources bound by nothing

**No email is ever sent to these.** They have forbidden nothing; asking invites a *no* to a question
nobody asked.

| Source | Route | `robots.txt` | Terms | Permission | Terms last read |
|---|---|---|---|---|---|
| **EventsEye** | `http-scrape` | None served | No terms document anywhere on the site | `not-barred` | 04 Aug 2026 |
| **The Star** | `http-scrape` | 0 bytes — no rules | No site ToU exists | `not-barred` | 04 Aug 2026 |
| **JustRunLah!** | `http-scrape` | Not established | No terms document | `not-barred` | 04 Aug 2026 |
| **bigevent.io** | `http-scrape` | Publishes `Allow: /events/*` | Terms page is an empty shell | `not-barred` | 04 Aug 2026 |
| **STB** (`stb.gov.sg`) | `http-scrape` | Not established | **No automation clause** — unlike `visitsingapore.com`, which is a separate row above | `not-barred` | 04 Aug 2026 |

**A 0-byte or absent `robots.txt` is permission, not implied prohibition** (ADR-0021 §3).

---

## Sources whose terms have never been read

Live or candidate sources with an unresolved legal position. **A row cannot leave this table by
assumption** — only by someone reading the terms and moving it to one of the two above.

| Source | Route | Why it is here |
|---|---|---|
| **TTGmice** | `http-scrape` | Terms never retrieved |
| **Sentosa** | `http-scrape` | Terms never retrieved. `robots.txt` explicitly **allows** `/sitecore/api`, which reads like an invitation |
| **The Kallang** | `http-scrape` | Terms never retrieved. Best-shaped new source per #113 |
| **RWS** *(resort events)* | `http-scrape` | Terms never retrieved |
| **Changi Exhibition Centre** | `http-scrape` | Terms never retrieved. Operated by Constellar — the §3.1 clauses above may well govern it too, **unverified** |
| **SportPlus SG** | `http-scrape` | Terms never retrieved |
| **Shangri-La Rasa Sentosa** | `http-scrape` | Terms never retrieved |
| **SISTIC** | not built | Never audited at all — capability or legal. T&C are JS-gated and unread ([#131](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/131)) |

---

## Hard stops

Not read, not stored, not published. **Accepted MVP risk does not reach these** (ADR-0021 §4), and
**no permission email is sent** — emailing a platform's legal inbox for scraping permission is a
near-certain *no* that converts *not pursued* into *formally refused*, for nothing.

| Source | Which stop | Detail |
|---|---|---|
| **Ticketmaster SG** | Active block aimed at us | Detail pages return `401 {"response":"identify"}`. ToU also bans robots and threatens legal action; the sanctioned Discovery API has no Asian market coverage |
| **Eventbrite** | Terms + no data | ToS §13, "Scraping … is Prohibited", names the activity. Public event search has been *removed* from the API — `/v3/events/search/` returns 404 while neighbouring paths return 401 |
| **Resorts World Convention Centre** | No data | Not a legal stop. `/en/meetings` is a JS sales page with zero dates; the sitemap confirms no calendar page exists |

---

## Open risks

- ⚠️ **Marina Bay Sands blocks the honest User-Agent — tested 05 Aug 2026, one confound unexcluded.**
  Playwright, four configurations, crossing engine against User-Agent:

  | Configuration | Result |
  |---|---|
  | Bundled Chromium (headless), default UA | `ERR_HTTP2_PROTOCOL_ERROR` |
  | Bundled Chromium (headless), honest UA | `ERR_HTTP2_PROTOCOL_ERROR` |
  | **Real Chrome (headed), default UA** | **HTTP 200** |
  | **Real Chrome (headed), honest UA** | **`ERR_HTTP2_PROTOCOL_ERROR`** |

  So **two** filters sit in front of MBS: an automation-fingerprint check that headless fails under
  any User-Agent, and — apparently — a User-Agent check that a real Chrome fails once it stops
  claiming to be Chrome. The block signature is identical to plain `curl` (`http=000` in ~50 ms).

  ⚠️ **Confound, stated rather than buried:** the honest-UA case ran fourth, so rate-based blocking
  after three prior loads is not excluded. Re-running with the honest case first would settle it,
  and **#121 gets that for free** when it prices the MBS adapter, since it must drive a browser at
  the host anyway.

  **The confound affects confidence, not the ruling.** Even the one passing configuration passed only
  by sending Chrome's *default* User-Agent, which ADR-0021 §2 forbids. On today's evidence MBS is
  reachable only by impersonating a browser, and §4 rules that the source drops rather than the
  identification. Recorded as **blocked pending #121's confirmation**, not yet as `stopped`.
- ✅ **MBCCS is clear — risk closed, 05 Aug 2026.** All four configurations returned HTTP 200 with
  the expected content, **including headless with the honest User-Agent** (177–1527 ms). The
  production adapter can adopt ADR-0021 §2 with no reachability cost, and needs no real-Chrome
  route. This was the open question with the most at stake, since MBCCS runs in production today.
- ⚠️ **MBS's expo directory is a rolling 3-day window, so delay itself destroys history.** It is the
  only source where waiting has an irreversible cost, which makes it the most time-urgent notice on
  the list regardless of how unlikely a *yes* is.
- ⚠️ **A credential is exposed in a source's own public bundle.** Our adapter has never touched it
  and ADR-0005 permanently bans it. Disclosure is owner-held. **The value is never recorded here.**
- **Conditional — returns on publication: the AGPL / committed-feeds overlap.** The project is
  `AGPL-3.0-or-later` and ADR-0011 commits generated `.ics` feeds to the branch. In a *public*
  repository that reads as granting redistribution rights over data obtained under terms forbidding
  exactly that. Dormant while private — no recipients, no grant, no appearance of one — and AGPL is
  kept regardless, since it costs nothing dormant and preserves the option to open the repository
  without relicensing. **Reinstate this row the day anything is published.**
- **Conditional — ADR-0011's deployment target is unresolved under a private repository.** Pages
  from a private repository requires a paid plan. Not a legal risk; a live practical one.
