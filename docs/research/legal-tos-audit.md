# Legal & ToS audit: may we scrape and publicly redistribute each source?

Resolves [#3](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/3). Researched 2026-07-16 against primary sources (the actual ToS pages and the actual `robots.txt` files, fetched live).

> **This is not legal advice.** I am not a lawyer. This is a risk summary compiled from primary sources to inform a decision about the seed source list. Every clause below is quoted from the live page so it can be checked rather than taken on trust. Points that genuinely need a Singapore-qualified IP/tech lawyer are flagged explicitly in [Where professional advice is genuinely warranted](#where-professional-advice-is-genuinely-warranted) — they are not papered over.

## Verdict table

| Source | robots.txt | ToS on scraping | ToS on redistribution | Verdict |
|---|---|---|---|---|
| Suntec Singapore | Permits `/visit-events`; blocks `?format=ical` | Narrow anti-"meta-search" clause | "personal and non-commercial use"; no public/commercial reuse | **Conditional** |
| Ticketmaster SG | Blocks `*startDate=*` | Express ban: "no robot, spider, other automatic device" | Review-only licence; "No Commercial Use" | **Avoid** |
| Marina Bay Cruise Centre | `Allow: /` (fully open) | No automated-access clause | Broad ban incl. mirroring | **Conditional** |
| Singapore Cruise Centre | `Disallow:` (fully open) | No automated-access clause | Express permission if internal/non-commercial | **Conditional** |

No source is **green**. Every one restricts public redistribution of *expression* by contract. Whether that reaches bare *facts* is the crux, and it is addressed below.

## The distinction that decides this

The ticket's framing is correct and load-bearing. Two separate legal regimes are in play, and they give different answers:

1. **Copyright** — governs *expression*. Under Singapore law it does **not** reach facts. Strong position for us.
2. **Contract (the ToS)** — governs *conduct*, and can restrict things copyright does not. Weaker position for us, and the real exposure.

A ToS can validly prohibit conduct that copyright would permit. So "facts aren't copyrightable" is a real defence against a *copyright* claim and **not** a defence against a *breach of contract* claim. Both must be cleared, and they must be cleared separately. Conflating them is the single most common way this analysis goes wrong.

### Singapore copyright: facts are free, and there is no database right

This is unusually favourable to us and it is worth being precise about why.

**Global Yellow Pages Ltd v Promedia Directories Pte Ltd [2017] SGCA 28** ([full judgment, eLitigation](https://www.elitigation.sg/gd/s/2017_sgca_28)) is the controlling Court of Appeal authority. It held:

- **Data is not copyrightable material**, even where it is commercially valuable and expensive to compile. What the defendant took from Yellow Pages *was* data, and that take was not infringement.
- Singapore follows the **"creativity" approach, not "sweat of the brow"**. Effort alone does not create originality. A compilation earns copyright only through creative *selection and arrangement*.
- Yellow Pages' directories **failed** that threshold, being merely alphabetical arrangements of data.

Two consequences for us:

- **A chronological list of events, or a date-ordered berth schedule, is about as close to "mere arrangement" as a compilation can get.** On *Global Yellow Pages*, the source sites' own event listings are unlikely to attract compilation copyright at all. Their claim to the arrangement is weak on their own facts.
- **Singapore has no sui generis database right.** Unlike the EU/UK, Parliament consciously declined to introduce one ([IPKat analysis](https://ipkitten.blogspot.com/2017/08/the-challenge-of-protecting-database.html); [Bird & Bird](https://www.twobirds.com/en/insights/2017/singapore/copyright-protection-for-factual-compilations-in-singapore-creativity-alone-is-not-enough)). There is no fallback right protecting the investment in the schedule. This closes the route by which a source might otherwise claim the *dataset* regardless of creativity.

**This maps precisely onto the map's standing constraint of "existence + timing only"** (issue #1). That constraint was adopted for product reasons, but it turns out to be the exact line Singapore copyright draws. Start, end, name, location are facts. A marketing description is expression. Keeping to the former is not merely defensible — it is the strongest available position, and it is already the plan.

The one field in tension is **`description`**, which the map lists as carried by the manual Excel. See [Recommendations](#recommendations).

### Contract: the harder half

All four sources present terms via **browsewrap** (a footer link, no click-to-accept). Enforceability of browsewrap turns on notice and assent, and is materially weaker than clickwrap — a site cannot easily bind a visitor to terms they were never meaningfully shown. But "weaker" is not "void", and I would not build a product on the assumption that a browsewrap ToS is unenforceable. Treat the terms as potentially binding and act accordingly. **This is a point for a lawyer, not for me** — see below.

## Per-source findings

### 1. Suntec Singapore — **CONDITIONAL**

Source: `https://www.suntecsingapore.com/visit-events`

**robots.txt** (`https://www.suntecsingapore.com/robots.txt`) — a stock Squarespace file. `/visit-events` is **not** disallowed. The `*` group blocks `/config`, `/search`, `/account`, `/api/`, `/static/`, and a set of query-string patterns:

```
User-agent: *
Disallow: /config
Disallow: /search
Disallow: /api/
Disallow:/*?format=ical
Disallow:/*&format=ical
Disallow:/*?format=json
Disallow:/*?month=*
```

Two things worth flagging, both easy to get wrong:

- **`?format=ical` and `?format=json` are disallowed.** Squarespace exposes machine-readable JSON and iCal endpoints on collection pages. These are the obvious things a scraper reaches for, and they are exactly what robots.txt excludes — while the human HTML page is permitted. A crawler that "helpfully" grabs the JSON feed is the one that violates robots.txt. Scrape the rendered HTML page instead. This inverts the usual instinct and should be written into the scraper module.
- **The long list of AI user-agents at the top of that file (`ClaudeBot`, `GPTBot`, `CCBot`, `anthropic-ai`, …) is not a block.** Under [RFC 9309](https://www.rfc-editor.org/rfc/rfc9309.html) §2.2.1, consecutive `User-agent` lines followed by rules form *one group* applying to all of them. Those agents are grouped **with `*`** and receive the same rules — there is no `Disallow: /` anywhere in the file. This is widely misread as an AI opt-out; it is not. Either way it does not affect us: our scraper is not those agents and falls under `*`.

**ToS** (`https://www.suntecsingapore.com/terms-conditions`):

> "Unless otherwise specified, the Suntec Singapore Web Site/Service is for your **personal and non-commercial use**."

> "You may not modify, copy, distribute, transmit, display, perform, reproduce, publish, license, create derivative works from, transfer, or sell any information, software, products or services obtained from the Suntec Singapore Web Site/Service."

> Users may "download or print the Content solely in connection of your use of the Services" and may not "sell copy, reproduce, distribute, modify, display, transmit, reuse, re-post, or otherwise use the Content **for any public or commercial purposes** without Suntec Singapore's … prior written permission."

> "All copyright and other intellectual property and proprietary rights in the content, including but not limited to text, software, code, scripts, webpages, music, sound, photographs, video, graphics … **('Content')** belong to Suntec Singapore or other third party content providers."

On automated access the clause is narrow and aimed at SEO tooling, not aggregation:

> "you may not 'meta-search' the Suntec Singapore Web Site/Service … use any software that sends queries to Suntec Singapore Web Site/Service to determine how a web site 'ranks'."

**Assessment.** The anti-automation clause is about rank-checking and does not naturally cover a daily event fetch — a fair reading is that a polite scraper does not breach it. The real obstacle is "public or commercial purposes", which a public calendar plainly is. But note the restriction attaches to **"Content"**, and the definition is a list of *expressive* artefacts (text, photographs, graphics, video). It does not say "facts" or "event data". On *Global Yellow Pages*, the bare fact that an event exists on a date is not Suntec's property to license in the first place, so the clause has nothing to bite on as applied to facts. Take name/date/venue; take no descriptions, no images, no logos.

### 2. Ticketmaster SG — **AVOID**

Source: `https://ticketmaster.sg/venues`

This is the expected problem, and the expectation is confirmed. Ticketmaster is the only source of the four with an **express, unambiguous prohibition on automated access**, and it is the only one with the demonstrated appetite to enforce.

**robots.txt** (`https://ticketmaster.sg/robots.txt`):

```
User-agent: *
Disallow: /activity/get-more-game-list
Disallow: /activity/search-suggest/
Disallow: *startDate=*

User-agent: msnbot
Crawl-delay: 2

Sitemap: https://ticketmaster.sg/sitemap.xml
```

`Disallow: *startDate=*` is the significant line. **It blocks precisely the date-filtered query pattern a calendar scraper needs.** `/venues` itself is not disallowed, but the mechanism for asking "what is on between these dates" is. robots.txt is directionally hostile to this exact use case, not incidentally restrictive.

**ToS** (`https://ticketmaster.sg/terms-of-use` — note `/terms` returns HTTP 401):

Under the heading **"Access and Interference"**:

> "You agree that you will not use any **robot, spider, other automatic device, or manual process to monitor or copy our web pages** …"

Under **"Permitted Use"**:

> "… you shall not duplicate, download, publish, modify or otherwise distribute the material on this Site for any purpose **other than to review event and promotional information** …"

Under **"No Commercial Use"**:

> "No area of this Site may be used by our visitors for any commercial purposes …"

Under **"Ownership of Materials"**:

> "All materials on Ticketmaster's website are copyrighted and are protected under treaty provisions and world-wide copyright laws. Ticketmaster's materials **may not be reproduced, copied, edited, published, transmitted or uploaded in any way without Ticketmaster's written permission**."

Under **"Disputes"**:

> "… you agree that the dispute will be governed and construed by **Singapore law** … litigation must be brought in **court in Singapore** …"

**Assessment — this stacks four ways, and each is independently adverse:**

1. **Scraping is expressly banned by name.** No interpretive room; no "narrow SEO clause" reading available as with Suntec.
2. **The licence is expressly "review-only".** Republication is outside the granted purpose on the face of the clause.
3. **robots.txt blocks the date-query pattern**, so the technically compliant path to the data we want does not exist.
4. **Jurisdiction is Singapore.** Ticketmaster-Singapore Pte Ltd is a Singapore-registered entity (company number 201313980N) and litigation is in Singapore courts. There is no practical friction of a foreign forum to rely on. A local plaintiff suing a local project in local courts is the cheapest possible enforcement posture for them.

**Enforcement history.** Ticketmaster's record of litigating against scrapers is well documented — *Ticketmaster Corp v Tickets.com* (C.D. Cal., 2000–2003), *Ticketmaster L.L.C. v RMG Technologies* (C.D. Cal. 2007, injunction over automated ticket-buying bots), *Ticketmaster L.L.C. v Prestige Entertainment* (C.D. Cal. 2018). These are **US cases and not binding in Singapore** — at most they evidence corporate appetite to enforce, not the local legal position, and I am not going to overstate them.

But *Tickets.com* deserves an honest note precisely because it cuts **our** way on the copyright half: the court accepted that copying purely factual event information (event, date, venue, price) was **not** copyright infringement, since facts are not protectable. That is consistent with *Global Yellow Pages*. The catch, and the reason this is still **avoid**: the **contract and trespass claims survived independently of copyright**. *Tickets.com* is the clearest available illustration of the exact trap in this ticket — winning the copyright argument and losing anyway on the terms.

**The official-feed escape hatch is closed.** I checked, rather than assuming. Ticketmaster's [Discovery API](https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/) is the legitimate licensed route and would sidestep the whole question — but **it does not cover Singapore**. Documented coverage is "United States, Canada, Mexico, Australia, New Zealand, United Kingdom, Ireland, other European countries"; the [Discovery Feed](https://developer.ticketmaster.com/products-and-docs/apis/discovery-feed/) country list (US, CA, IE, GB, AU, NZ, MX, AE, AT, BE, DE, DK, ES, FI, NL, NO, PL, SE, CH, CZ, IT, FR, ZA, KE, UG, TR, BR, CL, PE) **omits SG**. So the sanctioned path does not reach our market, and the unsanctioned path is expressly prohibited. There is no compliant way to get Ticketmaster SG data into a public v1.

**Verdict: drop from the seed list for v1.** This is the one source where the ToS, robots.txt, jurisdiction, and enforcement record all point the same direction and no licensed alternative exists. Everything else here is a judgement call; this one is not.

### 3. Marina Bay Cruise Centre (MBCCS) — **CONDITIONAL**

Source: `https://mbccs.com.sg/cruise-information?tab=cruise-schedule`

**robots.txt** (`https://mbccs.com.sg/robots.txt`) — fully permissive, no restrictions of any kind:

```
User-agent: *
Allow: /

Host: https://mbccs.com.sg/
Sitemap: https://mbccs.com.sg/sitemap.xml
```

**ToS** (`https://mbccs.com.sg/terms-and-conditions`) — broad, but aimed at content rather than access:

> Users may not "reproduce, translate, use, modify, display, publish, adapt, communicate, transmit, broadcast, trade, sell or distribute" … or "otherwise use or exploit in any other way (including without limitation in the creation of derivative works)" any portion of the website "for any commercial or any other purposes".

> "**Linking the MBCC website to any other website or mirroring any of the information on the MBCC website on any other server is also expressly prohibited without our prior written consent.**"

> "All Content is **owned by, licensed to, controlled by or proprietary to SATS-Creuers Cruise Services (SCCS)**, and is protected by the various intellectual property laws."

> "These Terms and Conditions … shall be governed by, and construed in accordance with **Singapore law**."

**Assessment.** No automated-access prohibition exists — robots.txt is maximally open and the ToS is silent on crawlers. Scraping *qua* scraping is unobjectionable here.

The awkward clause is the **anti-linking and anti-mirroring** one, which is unusually broad and worth taking seriously since our product does both in spirit. Two mitigating observations: (a) a blanket prohibition on *linking* is legally dubious and widely regarded as unenforceable — the web does not function on that premise, and a term that purports to forbid inbound hyperlinks is close to unarguable; (b) "mirroring any of the **information** … on any other server" is the sharper phrase, and unlike Suntec's clause it does say *information*, not just expressive Content.

That said, a berth schedule — vessel, pier, arrival, departure — is factual data, and per *Global Yellow Pages* MBCCS has no property right in facts to enforce, whatever the clause asserts. The clause is an assertion of a right, not proof of one. Note also that the schedule is **operational port information**, published to inform the public; the equities of restricting its factual restatement are poor. Publishing "vessel X berths on date Y", sourced and attributed, is a materially different act from mirroring their pages.

**Practical note for the scraper:** the page renders per date-range and returned "There are no scheduled cruises" for 16–20 Jul 2026 on fetch. An empty result is a legitimate state, **not** a breakage signal — the daily breakage detection must distinguish "no cruises scheduled" from "selectors broke", or it will alarm constantly. Flag this to the scraper ticket.

### 4. Singapore Cruise Centre (SCC) — **CONDITIONAL** (least restrictive of the four)

Source: `https://singaporecruise.com.sg/schedule/cruise/`

**robots.txt** (`https://singaporecruise.com.sg/robots.txt`) — a Yoast block with an empty `Disallow`, which per RFC 9309 permits everything:

```
# START YOAST BLOCK
User-agent: *
Disallow:

Sitemap: https://singaporecruise.com.sg/sitemap_index.xml
# END YOAST BLOCK
```

**ToS** (`https://singaporecruise.com.sg/terms-conditions/` — note `/terms-of-use/` returns HTTP 404):

> "You **may view, copy, distribute or otherwise use the Content if**: All such use is for **internal, non-commercial, informational purposes only**"

> "All copies that you make of the Content will bear the relevant copyright, trademark or other proprietary notice located on our Website."

> "These Terms are governed by and construed in accordance with the **Singapore law** and you irrevocably submit to the non-exclusive jurisdiction of the Singapore Courts"

> "Any dispute … shall be referred to and finally resolved by **arbitration in Singapore in accordance with the Arbitration Rules of Singapore International Arbitration Centre**"

No clause addresses automated access, crawlers, or bots at all.

**Assessment.** Structurally the friendliest: robots.txt permits everything, nothing prohibits scraping, and the terms are framed as a **grant** ("you may view, copy, distribute … if") rather than a prohibition. The condition attached is the problem — "internal, non-commercial, **informational** purposes only". A public calendar is not *internal*.

Weighing against that: the data is a factual berth schedule; the site carries "© Copyright 2026 Singapore Cruise Centre Pte Ltd. All rights reserved" and the terms require copies to carry proprietary notices — which is an attribution requirement we can simply **satisfy**, and which the map's "duplicates accepted in v1, labelled by source" constraint already sets us up to do. Note the **SIAC arbitration clause**: a dispute would go to arbitration rather than open court. That does not change whether we are in the right, but it does mean any dispute is expensive and private — worth knowing.

## Singapore-specific context

**PDPA — does not bite, as the ticket anticipated.** The Personal Data Protection Act 2012 governs "personal data" — data about an *identifiable individual*. Our records are events and vessel movements: conference names, dates, venues, ship names, berth times. None of it identifies a natural person. The map's "existence + timing only" constraint keeps us clear by construction. **One caveat worth watching:** if a scraper ever pulls a named speaker, performer, or listed contact person into a record, that field *is* personal data and PDPA obligations (consent, purpose limitation, notification) attach to it. The named-performer case is realistic for event listings. Keep individuals out of the schema and PDPA stays out of scope — another reason to hold the "facts only, no descriptions" line.

**No sui generis database right** (above) — materially better for us than an EU/UK equivalent project would be. There is no separate right in the *investment* of compiling a schedule; the only routes are copyright (which fails on facts) and contract.

**Copyright Act 2021** did not disturb *Global Yellow Pages* on originality of compilations.

**Official licensed feeds — I checked; there is essentially nothing left.**

- **Ticketmaster Discovery API** — real, licensed, and **excludes Singapore**. Detailed above. This is the one that would have solved the hardest source, and it does not reach our market.
- **STB Tourism Information Hub (TIH)** — this is the obvious suggestion for a Singapore tourism project, and it is **dead**. TIH, including its events dataset and all TIH APIs, was **discontinued on 31 July 2025**; all existing API keys were disabled on that date, content upload closed 30 May 2025, and only the media-asset repository survives (as "Singapore Tourism Photos and Videos", launched 16 July 2025). Anything recommending TIH is written against a platform that no longer exists — worth stating plainly, because it is a year stale and still widely cited. STB has not published an events-data API replacement that I could find.
- **Suntec, MBCCS, SCC** — none publishes an API. Suntec's Squarespace instance has iCal/JSON endpoints, but robots.txt disallows them (above), so they are not a sanctioned route.

**Conclusion: there is no licensed feed that sidesteps the question for any of the four sources.** Scraping is the only route to this dataset, which is very likely *why* the user compiles it by hand today.

## Where professional advice is genuinely warranted

Flagged rather than papered over. These are the points I cannot responsibly resolve from primary sources alone:

1. **Browsewrap enforceability in Singapore.** Whether footer-linked terms bind a visitor who never clicked accept is the hinge of the whole contract analysis, and it is unsettled enough that I will not call it. If it goes one way, the ToS restrictions largely evaporate and everything is green. If it goes the other, the "conditional" sources are conditional in earnest.
2. **Whether MBCCS's "mirroring any of the information" clause reaches a factual restatement.** This is the one clause across all four sources drafted broadly enough to arguably cover facts. My read is that it cannot create a right that copyright denies, but that is an argument, not a settled answer.
3. **Whether a free public calendar is "commercial"** within these clauses. Most turn on "commercial or public purposes". v1 is free, but "public" is expressly named by Suntec, and the answer may differ if the project is ever monetised. **Monetisation would require re-running this audit** — the analysis below is for a free, public, attributed v1 and does not survive a business model change.
4. **Ticketmaster specifically**, if there is any appetite to include it anyway. Do not do so on the strength of this document.

Get advice before v1 goes public if the project has any commercial future. The cost of a short consult is small against the cost of a takedown after launch.

## Recommendations

1. **Drop Ticketmaster SG from the seed list for v1.** The only source where express scraping prohibition + review-only licence + robots.txt blocking the date-query + Singapore jurisdiction + a documented enforcement record all converge, with no licensed feed available. The rest are judgement calls; this is not. If ticketed-event coverage is essential, look for an alternative SG ticketing source (SISTIC is the obvious candidate) and audit it separately — that is a new research ticket, not an assumption.
2. **Proceed with Suntec, MBCCS and SCC on strict facts-only extraction.** Name, start, end, venue. This is the strongest legal position available *and* it is already the map's standing constraint — no product compromise is being made here.
3. **Reconsider the `description` field.** The map lists `description` among the fields the manual Excel carries. A verbatim scraped marketing description is **copyrightable expression** and is the single field that moves us from "facts, which they do not own" to "their Content, which they do". Options: drop it; or store only self-authored/derived text; or keep it strictly for manually-entered events. **This wants a decision and is the one place the audit pushes back on the current schema.** Recommend raising as a domain-modeling question rather than settling it here.
4. **Take no images, logos, or marketing copy from any source.** Unambiguously Content under every ToS quoted, and unambiguously copyrightable. There is no argument available here — it is the clearest line in the document.
5. **Attribute every event to its source and link out.** SCC's terms *require* proprietary notices on copies; attribution is cheap, satisfies that condition, and is good faith evidence generally. The map's "duplicates accepted in v1, labelled by source" constraint already delivers this — the labelling is doing double duty as legal hygiene.
6. **Scrape politely and identify honestly.** Descriptive User-Agent with contact URL, ~daily frequency (matching the map's refresh cadence), rate limits, backoff. Excessive load is what converts an ignorable scrape into a trespass/interference claim — the *manner* of scraping is a live variable and one of the few we fully control.
7. **Respect robots.txt to the letter, especially Suntec's.** Scrape the **HTML** `/visit-events` page, not `?format=ical` or `?format=json`, which are disallowed. This is counter-intuitive — the machine-readable endpoint is the forbidden one — and must be a comment in the Suntec scraper module or someone will "optimise" it into a violation.
8. **Honour takedown requests immediately and without argument.** The realistic downside here is a request to stop, not litigation. Being trivially easy to deal with is the cheapest risk control available. Worth a named contact route on the public site.

## Sources

All fetched live 2026-07-16.

**Primary — robots.txt:** [Suntec](https://www.suntecsingapore.com/robots.txt) · [Ticketmaster SG](https://ticketmaster.sg/robots.txt) · [MBCCS](https://mbccs.com.sg/robots.txt) · [SCC](https://singaporecruise.com.sg/robots.txt)

**Primary — terms:** [Suntec T&C](https://www.suntecsingapore.com/terms-conditions) · [Ticketmaster SG Terms of Use](https://ticketmaster.sg/terms-of-use) · [Ticketmaster SG Purchase Policy](https://ticketmaster.sg/purchase) · [MBCCS T&C](https://mbccs.com.sg/terms-and-conditions) · [SCC T&C](https://singaporecruise.com.sg/terms-conditions/)

**Primary — target pages:** [Suntec events](https://www.suntecsingapore.com/visit-events) · [Ticketmaster SG venues](https://ticketmaster.sg/venues) · [MBCCS schedule](https://mbccs.com.sg/cruise-information?tab=cruise-schedule) · [SCC schedule](https://singaporecruise.com.sg/schedule/cruise/)

**Primary — law & standards:** [Global Yellow Pages v Promedia [2017] SGCA 28](https://www.elitigation.sg/gd/s/2017_sgca_28) · [RFC 9309 (Robots Exclusion Protocol)](https://www.rfc-editor.org/rfc/rfc9309.html)

**Primary — official feeds:** [Ticketmaster Discovery API](https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/) · [Discovery Feed country coverage](https://developer.ticketmaster.com/products-and-docs/apis/discovery-feed/) · [Ticketmaster Partner API Terms](https://developer.ticketmaster.com/support/terms-of-use/partner/) · [STB TIH](https://tih.stb.gov.sg/) (discontinued 31 Jul 2025)

**Secondary — commentary on SGCA 28** (used only to corroborate the judgment, which is linked above): [Bird & Bird](https://www.twobirds.com/en/insights/2017/singapore/copyright-protection-for-factual-compilations-in-singapore-creativity-alone-is-not-enough) · [IPKat](https://ipkitten.blogspot.com/2017/08/the-challenge-of-protecting-database.html) · [Singapore Law Blog](https://singaporelawblog.sg/blog/article/187)
