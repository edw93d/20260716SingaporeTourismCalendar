# Source register

The per-source legal facts behind [ADR-0021](adr/0021-reading-sources-that-forbid-it.md), as
re-priced by [ADR-0026](adr/0026-v2-publishes-the-code-and-the-calendar-are-public-the-data-leaves-the-repository.md).

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
| **Last re-priced** | 06 Aug 2026 (#144, ADR-0026) |

Also re-read on: any objection from any source (re-read **all** rows).

⚠️ **Re-read and re-priced are different, and the dates are kept apart on purpose.** Nobody has
re-read a terms document since 05 Aug 2026. What changed on 06 Aug 2026 is the *footing* every
clause is judged against. Collapsing the two would make this file look fresher than it is, which is
the exact staleness it exists to prevent.

### ⚠️ v2 publishes. This happened on 06 Aug 2026, and it was already true before then

ADR-0021 §5 held that v2 did not publish, on the stated fact that *"the repository is private and
the calendar is used by its owner."* **That was never true.** The repository has been public since
16 Jul 2026, GitHub Pages has been public, and the feeds, the served payload and the committed store
blob all returned 200.

**ADR-0026 rules that v2 publishes, deliberately:** the repository stays public (code only, no
scraped rows), and the calendar is public to read with credentials required only to change it. Every
*cleared by private use* verdict in the version of this file dated 05 Aug 2026 was therefore
**wrong on the day it was written**, and every one has been re-run below.

**What survives:** v2 still carries no revenue of any kind. That clears exactly **one** clause on
this list — Constellar §4.7 — which is what ADR-0021 §5 predicted non-commercial would be worth
alone.

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

**Cleared by non-commercial use?** — whether v2's no-revenue-of-any-kind position switches the
clause off. It clears **one clause on this entire list**. Every other reuse clause pairs
*non-commercial* with *personal* or *internal*, and a published calendar fails those at any price.
Marked `n/a` where the source bars nothing.

⚠️ **This column replaces *Cleared by private use?*, which described a state that never existed.**
The four extra clauses that column switched off are all back. See the re-priced note above.

⚠️ **No access clause is ever cleared by this.** Scraping is breached at any price and for any
purpose — that class is irreducible while the project exists, and it is the class the MVP is about.

---

## Sources bound by a clause

Every row here is read, stored **and republished** under accepted MVP risk. None trips a hard stop.

⚠️ **The previous version of this line said "None is republished."** It was false when written —
see the re-priced note above. It is corrected rather than quietly amended because this file's whole
job is to be the record of what was actually true.

| Source | Route | `robots.txt` | Operative clause | Cleared by non-commercial use? | Permission | Terms last read |
|---|---|---|---|---|---|---|
| **Suntec** *(v1, production)* | `http-scrape` | Allows the page to every agent | T&C forbid "automated queries of any sort"; use limited to personal / non-commercial | **No** — *personal* fails on a public calendar, and the automation clause never depended on money | `not-asked` | 04 Aug 2026 |
| **SCC** *(v1, production)* | `http-scrape` | Not established | ToU §2.1.1 grants use for "internal, non-commercial, informational purposes only" | **No** — *internal* fails outright. See ⚠️ below | `not-asked` | 04 Aug 2026 |
| **MBCCS** *(v1, production)* | `browser` | Not established | ToU bans reproduction "for any commercial **or any other purposes**" | **No** — an all-purposes ban. **Never cleared by any version of this project** | `not-asked` | 04 Aug 2026 |
| **Singapore EXPO / Constellar** | `http-scrape` | Disallows only `/wp-admin/` — listing **explicitly allowed** | §3.1(b)(vi) and §4.8(d) bar robots / scrapers / extraction; **§3.1(b)(i) bars archive, reproduce, distribute, publish**; §4.5 all content copyrighted; §4.7 bars commercial reuse | **§4.7 only** — the one clause on this whole list that non-commercial clears. §3.1(b)(i) now bites in **all three** limbs, and both robot clauses survive | `not-asked` | 05 Aug 2026 |
| **Marina Bay Sands** | `browser` | **Allowed by omission** — 17 `Disallow` lines covering casino, rewards-club, team-member, `/reservations/`, `/mbs/booking/`, `*?offerCode=`, `*promocode=`; **expo and the event directory are never mentioned**. `SearchSG` alone gets a blanket `Disallow: /`. ⚠️ The file itself is unreachable except from a browser | `terms-of-use.html`: ToU bars "deep-link", "page-scrape", "robot", "spider" **"or any similar or equivalent manual process"** to "access, acquire, copy or monitor"; separate **Personal and Non-Commercial Use Limitation** barring reproduce / publish / distribute. Scope is "all associated sites linked to www.marinabaysands.com" — the event directory is squarely inside it | **No** — the Personal limb fails, and the scraping clause was never money-conditional. Both limbs now live | `not-asked` | **05 Aug 2026** — re-verified live |
| **Changi / CAG** *(arrivals)* | `http-scrape` | Not established | Conditions of Use limit content to "your own **personal** and non-commercial use"; forbid storing it "in any information retrieval system" without written permission | **No** — *personal* fails; the retrieval-system ban was unconditional and is unchanged | `not-asked` — held deliberately, [#127](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/127) | 04 Aug 2026 |
| **VisitSingapore MICE** | not built | Not established | ToU bars "any robot, spider, other automatic device" | **No** — an access clause | `not-asked` | 04 Aug 2026 |

⚠️ **SCC is the weakest clause held, and it runs in production anyway** (ADR-0026 §6). Its "internal"
limb bars *distribution* regardless of method or money, and a public calendar is the opposite of
internal. It was briefly recorded as cleared, on 05 Aug 2026, on a private-use position that was
never true.

**The "no defence" wording is narrowed rather than repeated.** ADR-0021 §1's actual argument is that
reuse clauses are **contract claims needing assent never given** — no click-through, no account — and
that reaches SCC exactly as it reaches Suntec, MBS and Constellar. What is specifically true of SCC is
narrower: **facts-only does not help it**, because *internal* bars distribution whether or not the
thing distributed is copyrightable. A real weakness; not an empty hand.

**Why it keeps running:** MBCCS bars reproduction "for any commercial **or any other purposes**" —
broader than SCC's clause, never cleared by any version of this project, and in production throughout.
SCC now sits in the bucket MBCCS has occupied alone from the start. Dropping one while running the
other would be incoherent. ⚠️ SCC is nonetheless the likeliest source of a complaint, and cruise
terminals are two-of-two for `PortCall` supply.

⚠️ **Constellar §3.1(b)(i) now bites in all three limbs.** It bars *archive*, *reproduce* and
*publish* independently; the *publish* limb was recorded as cleared and is not. Every notice names
automated access **and** storage **and** republication together — asking narrowly now would mean
renegotiating later. Only §3.1 is explicitly curable: everything in it is prefaced "without our prior
written consent", while §4.8 carries no carve-out.

⚠️ **Marina Bay Sands carries the strictest *access* clause on the list** — page-scraping "or any
similar or equivalent manual process", closing even the transcribe-it-by-hand door, and never
money-conditional. Its Personal and Non-Commercial Use Limitation is now live alongside it, so both
of its limbs bite rather than one.

⚠️ **Every `not-asked` above is a live owner-held choice, not an unexamined gap** (ADR-0026 §9).
Permission asks are handled outside this project (Ed, 06 Aug 2026). Publication cuts both ways and
settles neither: asking is the **only** mechanism by which a source can be lost (ADR-0021, *Alternatives
rejected*), while ADR-0021 §6's defence of silence-is-null rests on a disclosure that has never been
sent. ⚠️ The easier version of that conversation — *"we have built this privately, may we publish
it"* — has been spent.

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

- ✅ **Marina Bay Sands serves an honestly-identified reader — risk reduced, 05 Aug 2026 ([#135](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/135)).**
  The earlier finding below it was drawn from **one** honest User-Agent, which conflated *honesty*
  with *string shape*. Re-run as a matrix, real Chrome headed, **honest-first**, ≥10 s apart:

  | User-Agent sent | Result |
  |---|---|
  | `Mozilla/5.0 (compatible; sg-tourism-calendar/0.1; +https://github.com/edw93d/…)` | `ERR_HTTP2_PROTOCOL_ERROR` |
  | `Mozilla/5.0 (compatible; sg-tourism-calendar/0.1; +github.com/edw93d/…)` | `ERR_HTTP2_PROTOCOL_ERROR` |
  | `Mozilla/5.0 (compatible; sg-tourism-calendar/0.1; github.com/edw93d/…)` | `ERR_HTTP2_PROTOCOL_ERROR` |
  | `Mozilla/5.0 (compatible; sg-tourism-calendar/0.1; +https://example.com/bot)` | `ERR_HTTP2_PROTOCOL_ERROR` |
  | `Mozilla/5.0 (compatible; sg-tourism-calendar/0.1; contact via GitHub issues)` | `ERR_HTTP2_PROTOCOL_ERROR` |
  | `sg-tourism-calendar/0.1 (+https://github.com/edw93d/…)` *(the string #113 tested)* | `ERR_HTTP2_PROTOCOL_ERROR` |
  | **`Mozilla/5.0 (compatible; sg-tourism-calendar/0.1)`** | **HTTP 200, 2442 bytes, marker matched** |
  | **`Mozilla/5.0 (compatible; sg-tourism-calendar/0.1; +edw93d/20260716SingaporeTourismCalendar)`** | **HTTP 200, 2442 bytes, marker matched** |
  | Real Chrome, its own default UA *(control)* | HTTP 200, 2442 bytes, marker matched |

  **The discriminator is not honesty and not the `Mozilla/5.0` token.** Both served forms declare
  themselves a bot by name; the blocked forms include one that declares nothing beyond the same name.
  What separates them is the *comment field*: every string carrying a **hostname-shaped token or
  whitespace** in the third field is refused, and the two without one are served — byte-identical to
  what Chrome's own User-Agent receives, room-level content included.

  ✅ **Route 1's confound is settled at the same time.** The leading candidate ran **first**, on a
  cold browser, and was still blocked in ~50 ms. Rate-based blocking after prior loads is excluded;
  the filter is User-Agent-string-based. The repeat of that same string later in the run reproduced
  the block exactly, and the served form reproduced 200 three times.

  ⚠️ **This does not clear §2.1 by itself.** §2.1 obliges a User-Agent *"naming the project and
  **linking the repository**"* — and every form carrying a resolvable URL is exactly what MBS
  refuses. `+edw93d/20260716SingaporeTourismCalendar` names the repository as an owner/repo path
  without a scheme or host. **Whether that counts as *linking* is an ADR reading, not a test result,
  and it is owner-held.** Two questions go with it: whether `Mozilla/5.0 (compatible; …)` is a
  "browser string" under §2.1's *never a browser string* (it carries the token but claims to be a
  bot, and §4.5 bars only claiming to be *a human's browser*), and whether a UA the host will not
  accept a contact URL in still discharges the *identify* obligation in substance.

  ⚠️ **Methodology note, because it produced a false negative once.** `waitUntil: "networkidle"`
  **never settles on this page even under Chrome's own User-Agent** — the first pass timed out on
  the known-good control and would have been read as a block. The directory is client-rendered; the
  correct settle is `domcontentloaded` then poll `document.body.innerText` for `/next 3 days/i`.
  Block signature remains `ERR_HTTP2_PROTOCOL_ERROR` in ~50 ms, distinguishable from a timeout.

  Headless remains blocked under every User-Agent, so the real-Chrome route stands (#121).
- ⚠️ *Superseded, kept for the record —* **MBS was recorded as blocking the honest User-Agent, 05 Aug
  2026 (#113).** Four configurations crossing engine against User-Agent: headless was refused under
  both the default and the honest UA; real Chrome was served under the default UA and refused under
  `sg-tourism-calendar/0.1 (+https://github.com/edw93d/…)`. The engine finding holds. The User-Agent
  finding was **true of that string and generalised too far** — see the entry above.
- ✅ **MBCCS is clear — risk closed, 05 Aug 2026.** All four configurations returned HTTP 200 with
  the expected content, **including headless with the honest User-Agent** (177–1527 ms). The
  production adapter can adopt ADR-0021 §2 with no reachability cost, and needs no real-Chrome
  route. This was the open question with the most at stake, since MBCCS runs in production today.
- ⚠️ **MBS's expo directory is a rolling 3-day window, so delay itself destroys history.** It is the
  only source where waiting has an irreversible cost, which makes it the most time-urgent notice on
  the list regardless of how unlikely a *yes* is.
- ⚠️ **A credential is exposed in a source's own public bundle.** Our adapter has never touched it
  and ADR-0005 permanently bans it. Disclosure is owner-held. **The value is never recorded here.**
- ⚠️ **Reinstated 06 Aug 2026 — the AGPL / committed-data overlap.** Filed as *conditional, returns
  on publication*; publication arrived, and had in fact preceded the filing. The project is
  `AGPL-3.0-or-later`, and a public repository carrying `data/calendar.sqlite`, `site/calendar.json`
  and the generated `.ics` feeds reads as granting redistribution rights over data obtained under
  terms forbidding exactly that. **ADR-0026 §4 removes all three from the tip — landed 06 Aug 2026
  (#147)**, so no data artefact falls under the grant going forward. ⚠️ It survives against history
  regardless, which ADR-0026 §7 keeps deliberately. AGPL is retained on ADR-0021's own reasoning.
- ✅ **Closed 06 Aug 2026 — the Pages site is deleted.** Removing the files from git did not
  un-publish them: GitHub Pages with `build_type: workflow` serves the **last deployed artefact**,
  not the branch, so the feeds and the full payload kept returning 200 until the site itself was
  deleted (`DELETE /repos/:owner/:repo/pages`). Done now, so they stop being served once the CDN
  cache drains. This was the only part of ADR-0026 that was not effective on #147's merge.
- ✅ **Closed — ADR-0011's deployment target.** It was conditional on a private repository requiring
  a paid Pages plan. The repository stays public and ADR-0026 §3 retires Pages outright, so the
  question no longer exists: v2's calendar is served by the server (ADR-0025 §4).
- ⚠️ **ADR-0021 §1's *with attribution* limb is live for the first time.** Dormant under
  non-publication. #38 labels every entry with its source id; whether a bare id discharges
  *attribution*, or whether it needs a link to the venue's own listing, is unresolved and ticketed.
  ⚠️ Relevant to every row in this file, since attribution is part of what the surviving facts-only
  position is built from.
