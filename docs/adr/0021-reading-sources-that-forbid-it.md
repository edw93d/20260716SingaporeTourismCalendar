# ADR-0021: Reading sources that forbid it

- **Status:** Accepted
- **Date:** 2026-08-05
- **Ticket:** [#123](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/123)
- ⛔ **§5 is superseded in whole by [ADR-0026](0026-v2-publishes-the-code-and-the-calendar-are-public-the-data-leaves-the-repository.md)
  ([#144](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/144), 06 Aug 2026) — its
  premise was never true, and v2 publishes.** Everything else here still binds. See the note at §5.
- **Supersedes no ADR.** It formalises a rule already applied three times — [#28](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/28) (Changi), [#113](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/113) (Marina Bay Sands), [#128](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/128) (Singapore EXPO) — and never written down.
- **Amends [ADR-0005](0005-source-adapter-interface.md)** by extending its core-owned politeness policy to the browser route (Amendment 4). See *Consequences*.
- **Constrains [ADR-0011](0011-pages-from-an-artifact-feeds-committed-to-the-branch.md)** without resolving it: §5 makes the repository private, and Pages from a private repository is not free. See *Consequences*.
- **Register:** [`docs/source-register.md`](../source-register.md) carries the per-source facts this ADR governs.

## Context

Six of twenty v2 sources forbid automated access in their own terms, and two of the three v1
adapters running in production today sit on clauses v1's audit never read — it checked `robots.txt`
and stopped there. [#113](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/113)
established the shape of the problem on 04 Aug 2026 against live sources; this ADR is the rule.

**The standing rule was already settled on [#128](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/128):**
v2 scrapes politely regardless of terms, seeks written permission for every barred source in
parallel, and stops on refusal — stated there as general policy, not a per-source call. What was
*not* settled was every limit on it, and a rule without limits is a rule that authorises anything.
This ADR fixes those limits.

### The rule had been applied three times before it existed

| Source | The clause | Ruling |
|---|---|---|
| **Changi / CAG** | No storing content "in any information retrieval system" without written permission | #28, 04 Aug 2026 — publishes anyway, accepted MVP risk |
| **Marina Bay Sands** | ToU bans "page-scrape", "robot", "spider" *and* "any similar or equivalent manual process" | #113, 04 Aug 2026 — the 3-day expo directory stays in scope |
| **Singapore EXPO / Constellar** | Two robot clauses, an archive/publish ban, and a separate commercial gate | #128, 05 Aug 2026 — build the adapter, ask separately |

Three consistent rulings recorded only in closed issue threads is a rule surviving by memory. The
next adapter PR needs something to be checked against.

### Access was never the whole problem

Every ruling so far was about *reading* a page. But our store **archives** and our feeds
**publish**, and for at least four sources the reuse clause bites even if scraping were permitted
outright: Constellar §3.1(b)(i) bars *archive, reproduce, distribute, publish* with no robot
mentioned at all; MBS carries a standalone Personal and Non-Commercial Use Limitation; Changi
forbids storing in "any information retrieval system"; SCC limits use to "internal". A rule that
stopped at access would not reach the thing this project actually does.

### `robots.txt` and the terms document disagree, routinely

Constellar is the purest case. `https://www.singaporeexpo.com.sg/events-at-expo/` returns HTTP 200,
265 KB, on one plain GET, with real dates in the raw HTML; `robots.txt` disallows only `/wp-admin/`,
so the listing is **explicitly allowed**. Five terms clauses forbid the same access, the archiving
and the republication. The machine-readable instrument says yes and the human-readable contract says
no. MBS is the same shape: `robots.txt` permits both listings and publishes a sitemap, while the ToU
closes even the transcribe-it-by-hand door.

Treating the two as one signal — as v1's audit did — is not a defensible position in either
direction. They are different instruments and are ruled on separately below.

## Decision

### 1. One rule, covering access, storage and republication together

> **v2 reads any source politely, stores the facts it extracts, and — where it republishes them —
> republishes facts only, with attribution, regardless of what that source's terms say about
> automated access or reuse. It extracts facts only, never expression. It seeks written permission
> for every barred source in parallel, asking for access, storage and republication together. It
> stops on refusal.**

The three limbs are one rule and not three, because the permission asks have to cover the union
anyway: permission to *scrape* Singapore EXPO alone would leave us in breach of §3.1(b)(i) —
allowed to read the events, not allowed to put them in the calendar.

**v2 exercises two of the three limbs.** It reads and it stores; it does not republish (§5). The
republication limb is stated here because the rule is written once for the project rather than for
this phase of it, and because the permission asks cover it regardless — asking broadly now costs
nothing, and renegotiating later costs a great deal.

**Facts-only is the load-bearing limb** (ADR-0002, `CONTEXT.md` → *Facts-only extraction*). No
copyright subsists in the fact that a congress happens on 16 Jul 2026, so the reuse clauses are
contract claims rather than infringement claims. That is a materially stronger position on the
reuse side than on the access side, and it is stated here rather than left implied. Extraction
beyond facts requires a fresh legal read and is outside this ADR.

### 2. "Politely" means `src/pipeline/http.ts`, and it binds the browser route too

The rule's whole defence is that word, so it names a file rather than a posture. Five obligations,
each checkable in review:

1. **Identify.** A non-browser User-Agent naming the project and linking the repository. Never a
   browser string: impersonating Chrome is what a reader does when it expects to be unwelcome, and
   it is the first thing that would be held against a scrape whose defence is that it takes only
   facts and behaves itself.
   > **Loosened by [ADR-0027](0027-the-source-contract-survives-twenty-sources.md) (#121,
   > 06 Aug 2026).** A scheme-less `owner/repo` identifier — `+edw93d/20260716SingaporeTourismCalendar`,
   > no `github.com` — **discharges *linking***. The obligation exists so a human reading a log can
   > find who is reading them and how to object, which that path does unambiguously; a resolvable
   > URL is not required, and #135 found it is exactly what Marina Bay Sands' WAF refuses. *Never a
   > browser string* is untouched. This is the reading §4's #135 amendment left owner-held, now
   > settled, and it fixes the one core-owned User-Agent for the whole list (ADR-0027 §4).
2. **One request per host per second**, per-host so one source never pays another's debt. On the
   browser route: **one page load per host per run, and no crawling** — navigate to the known
   listing URL, never follow links.
3. **Never retry a refusal.** 403, 404 and 401 mean *not ever*; only 408, 425, 429 and 5xx mean
   *not now*. Retrying into a WAF is exactly the behaviour that gets a reader blocked for good.
4. **Block subresources on the browser route** — images, fonts, analytics, advertising. This is the
   difference between one page's worth of load and roughly a hundred requests.
5. **Honour `Crawl-delay`** where a source publishes one, as a floor over the 1s default.

**Adapters never touch the network directly — browser route included.** True today for scrapes by
construction (ADR-0005: an adapter cannot construct a client and cannot reach `fetch`). The browser
route needs the same seam: a core-owned driver the adapter is handed, never a driver the adapter
imports. Politeness is structural, not disciplinary, or it lapses the first time a source is added
in a hurry.

### 3. `robots.txt` is a hard stop. A terms clause is not.

Asymmetric, deliberately.

`robots.txt` is the only channel a site has that is addressed **specifically to automated readers**.
It is the norm the entire ecosystem runs on, it is unambiguous, and it costs one GET to check.
Ignoring it would be the single most damning fact anyone could produce about this project's conduct,
and it would gut the well-behaved-reader posture the facts-only position rests on.

Terms of use are written for human visitors and sweep automation up in boilerplate. They are a
contract claim needing assent we never gave — no click-through, no account — over facts in which no
copyright subsists.

**The rule is nearly free to hold, which is what makes it credible rather than self-serving.** From
#113's audit: Constellar disallows only `/wp-admin/`; MBS disallows casino, loyalty, booking and
promo paths, not the listings; Suntec allows the page to every agent; bigevent.io publishes
`Allow: /events/*`; Sentosa *explicitly allows* `/sitecore/api`; EventsEye serves no `robots.txt`;
The Star's is 0 bytes. **Not one source on the twenty-source list is blocked by `robots.txt` today.**

Two corollaries, both with live instances:

- **Absence is permission.** No `robots.txt`, or a 0-byte one, means no rules — not implied
  prohibition (EventsEye, The Star).
- **Paths are read literally.** A `Disallow` blocks that path, not the host. MBS's casino disallows
  say nothing about `/expo-and-convention/event-directory.html`.

And the limb with teeth: **if a source later adds a `Disallow` covering a page we read, we stop
reading it — that run, no appeal, no MVP-risk override.** This is the only mechanism by which a
source can turn us off without sending an email, which is worth wanting: it gives them a one-line,
zero-effort refusal, and us a defensible answer to *"did you give them any way to say no?"*

### 4. Five hard stops, which accepted MVP risk does not override

1. **A `robots.txt` `Disallow`** on the path we read.
2. **Any authentication wall** — a login, an account, a credential, a paywall. We read what is
   served to an anonymous member of the public and nothing else. This one carries statutory weight
   rather than contractual: unauthorised access to a computer is the Computer Misuse Act, a
   different category of exposure from everything else here.
3. **An explicit refusal, once received.** From that moment the source is dropped — reading,
   storing and publishing, all three. This is what makes *seek permission in parallel* honest
   rather than a formality.
4. **An active technical block aimed at us.** Ticketmaster SG returns `401 {"response":"identify"}`
   on detail pages. That is a door closed to us specifically, and we do not pick it.
5. **Impersonation, as such.** No User-Agent claiming to be a human's browser, no forged headers to
   defeat a filter, no IP rotation or residential proxies to look like different people. This is
   the principle underneath (4), named separately because the whole facts-only defence stands on it.

**Honest identification wins even when it costs a source.** That principle is unchanged. What has
changed is that it does not, in fact, cost us MBS.

> **Amended 05 Aug 2026 on [#135](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/135).
> The ruling below — that MBS drops — is reversed on evidence.** MBS **serves** an honestly-identified
> reader. The original test ran **one** honest string and generalised from it, conflating the string's
> *honesty* with its *shape*. Re-run as a matrix, real Chrome headed, honest-first, MBS returns HTTP
> 200 to `Mozilla/5.0 (compatible; sg-tourism-calendar/0.1)` and to
> `Mozilla/5.0 (compatible; sg-tourism-calendar/0.1; +edw93d/20260716SingaporeTourismCalendar)` —
> byte-identical to what Chrome's own User-Agent receives. Both declare themselves a bot by name and
> impersonate nothing. What MBS refuses is any User-Agent carrying a **hostname-shaped token or
> whitespace** in its comment field, whatever it claims to be. **The block was never about honesty.**
>
> Two things survive the reversal. **The engine finding holds** — headless is refused under every
> User-Agent, so the real-Chrome route stands. And **§2.1 is not automatically satisfied**: it obliges
> a User-Agent *linking the repository*, and every form carrying a resolvable URL is precisely what
> MBS refuses. The served form names the repository as a scheme-less `owner/repo` path. Whether that
> discharges *linking* is a reading of §2.1, not a test result, and is owner-held — see
> `docs/source-register.md` → *Open risks*, which carries the full matrix and the two adjacent
> readings it raises. **Resolved by [ADR-0027](0027-the-source-contract-survives-twenty-sources.md)
> (#121, 06 Aug 2026): it discharges *linking*, and the scheme-less form is fixed as the one
> core-owned User-Agent — see §2.1's amendment note above.**
>
> **The confound in the original test is also settled**: the winning candidate ran first, on a cold
> browser, and was still refused in ~50 ms, so rate-based blocking is excluded. #121 no longer owes it.

*Superseded, kept because the reasoning is instructive:* MBS is reachable only because #113's
amendment drove a *real Chrome instance* at it; Akamai drops every scripted client at TLS, even with
full Chrome headers. That was the predicted failure mode, and it was tested on 05 Aug 2026: a real
Chrome sending `sg-tourism-calendar/0.1` is blocked, while the same browser sending Chrome's default
User-Agent is served. One confound is unexcluded — the honest case ran fourth, so rate-based blocking
is not ruled out. The ruling drawn from it was that **the only configuration that reached MBS did so
by claiming to be Chrome**, so MBS is a source we cannot reach without impersonating a person, and
**MBS drops** rather than the identification — an adapter that works only while pretending to be
human being the single worst fact this project could hold, precisely what MBS's "or any similar or
equivalent manual process" clause anticipates, and poison for the facts-only argument across all
nineteen other sources. Losing MBS was accepted as a real cost: seven months of clean horizon on the
shows page, and a 3-day directory where delay destroys history permanently.

**The instructive part is the failure mode, not the conclusion.** One negative test was read as a
property of the whole class it belonged to. The cost of that error was nearly the largest venue on
the list — 60% of Singapore's listed trade shows — and it was caught only because the ruling was
written down explicitly enough to be argued with.

**MBCCS, tested identically, is clear** — all four configurations served it, including headless with
the honest User-Agent. The rule costs nothing in production.

### 5. v2 runs privately, for personal use, non-commercially

> ⛔ **Superseded in whole by [ADR-0026](0026-v2-publishes-the-code-and-the-calendar-are-public-the-data-leaves-the-repository.md)
> ([#144](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/144), 06 Aug 2026).
> Do not rely on anything in this section — its premise was never true.**
>
> This section argues from *"the repository is private"* as a **stated fact**, not as a decision to
> implement. The repository has been public since 16 Jul 2026, Pages has been public, and the feeds,
> the payload and the committed store blob all served 200. **The four clauses the table below
> switches off were never actually clear**, including SCC's — and `docs/source-register.md` carried
> them as cleared for a day on that basis.
>
> **ADR-0026 rules that v2 publishes, deliberately**: the repository is public *on purpose* and
> carries the code and not the harvest, and the calendar is public to read with credentials required
> only to hide an entry. Non-commercial survives and clears **one** clause on the whole list —
> exactly as this section predicts it would alone.
>
> **The rest of this ADR is untouched and still binding**: §1's one rule, §2's politeness, §3's
> `robots.txt` asymmetry, §4's five hard stops, §6's silence-is-null, §7's owner-held asks and §8's
> register. Only §5 falls, and the section is kept rather than deleted because **the failure is the
> instructive part** — a fact that one `curl` would have settled was asserted instead, one day after
> §4 wrote two pages on generalising from a single unchecked test.

**v2 is not published.** The repository is private and the calendar is used by its owner. This is a
reversal made the same day the ADR was drafted (owner, 05 Aug 2026), and the reasoning is recorded
because the first answer was wrong for an instructive reason.

The MVP's purpose is demonstrating that twenty sources can be scraped, normalised and rendered as a
calendar. **Public reachability was never what demonstrated it** — the thing running does, via a
screen-share, a screenshot, or a live demo. Publishing was assumed to be the demonstration, and it
is not; it is a separate act with its own legal consequences, and separating the two costs the MVP
almost nothing.

⚠️ **"Private" means the repository, not the URL.** ADR-0011 commits generated `.ics` feeds to the
branch, so a public repository republishes the data whether or not the site URL is shared — the
feeds are readable straight out of the tree and are indexed. Withholding a Pages URL achieves
nothing on its own; an unlisted URL is not a private one. The private repository is the decision.

**v2 carries no revenue of any kind** — no charging, no sponsorship, no advertising, no paid tier,
no paid API, no donations. The gate is drawn generously on purpose: arguing whether a donations link
is "commercial" with a venue's counsel is a fight with no upside.

**What private, personal, non-commercial use actually clears** — and what it does not:

| Clause | Cleared? |
|---|---|
| SCC — "**internal**, non-commercial, informational" | **Yes** — the weakest clause held becomes the strongest position |
| Suntec — "personal and non-commercial" *(reuse limb)* | **Yes** |
| Marina Bay Sands — Personal and Non-Commercial Use Limitation | **Yes** |
| Constellar §4.7 — reuse "for any commercial purpose" | **Yes** |
| Constellar §3.1(b)(i) — archive / reproduce / **publish** | **Partly** — *publish* falls away; *archive* and *reproduce* do not |
| Changi — "own personal and non-commercial use" | **Partly** — the separate "any information retrieval system" ban is unconditional |
| MBCCS — reproduction "for any commercial **or any other purposes**" | **No** — an all-purposes ban |
| **Every access clause** — Suntec's "automated queries of any sort", MBS's robot/spider/page-scrape, Constellar §3.1(b)(vi) and §4.8(d), VisitSingapore's "robot, spider, other automatic device" | **No** — breached by the scrape itself, at any price and for any purpose |

**The residue is honest and worth naming: the class that cannot be cleared is the one the MVP is
about.** Scraping is the thing being demonstrated, so the access clauses are irreducible — no
posture short of not building it removes them. What running privately sheds is the *republication*
layer, which is the smaller legal exposure but much the larger practical one: **republishing is how
a source finds out at all.** A polite, once-daily, honestly-identified reader is close to invisible
in a server log; a public calendar carrying a venue's events is not.

It also improves the permission asks it does not replace. Each notice becomes *"we have built this
privately, may we publish it"* rather than *"please bless what we already publish"* — a materially
easier yes, and one where the honesty clause is no longer an admission.

**Publishing v2, or attaching revenue to it, voids this section and requires a re-decision.** Both
bite retroactively on the archive already built, so discovering them at the point of publishing is
discovering them too late.

**Non-commercial alone would not have cleared much, which is why privacy is doing the work here.**
Had v2 published while merely staying free, it would have switched off exactly **one** clause across
the whole list — Constellar §4.7. Every other reuse clause pairs *non-commercial* with *personal* or
*internal*, and a published calendar fails those at any price; the access clauses never mention
money at all. The table above is the version that holds once *personal and private* is added to
*non-commercial*, and the difference between the two is four clauses.

This is worth stating because *non-commercial* reads like a defence and mostly is not one. It is a
condition on a small number of clauses and a strong signal of good faith. It is not cover.

### 6. Silence is null

Silence is the likeliest outcome of every permission email, so a rule resolving only on *yes* or
*no* does not resolve. **Silence is neither consent nor refusal: the source stays exactly where it
was** — read under accepted MVP risk, recorded in the register, subject to every hard stop.

- *Silence as tacit consent* was rejected: nobody's failure to read an inbox is a licence, and it is
  the reading that would look worst quoted back.
- *Silence as refusal after N weeks* was rejected: it hands the outcome to inbox routing rather than
  to a decision, and it would mean the more sources we notify, the more we lose — inverting the
  point of asking.

What makes *null* honest rather than convenient is that the disclosure did the work. Under a
notice-and-opt-out email a source has been told what we take, where it is published, and given a
one-line way to stop it. **We do not rely on their silence for permission — we rely on facts-only,
politeness and honest disclosure, exactly as we did the day before writing.** The email adds a way
to say no; it was never load-bearing for the yes.

⚠️ **The accepted cost:** a source that would have said no, had anyone read the email, stays in the
calendar indefinitely. That is the direct consequence of not treating silence as refusal, and it is
recorded rather than left as an inferred gap.

### 7. Permission asks and vulnerability disclosure are owner-held

Which sources are emailed, in what order, and what the message says are **the owner's**, not this
ADR's and not an agent's. A permission request is a representation about what this project is and
creates a written record binding it. [#127](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/127)
is the existing pattern — owner-held, deliberately unsent, with the asymmetry argued both ways.

The same applies to the credential exposed in a source's own public bundle
([#37](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/37)), which our adapter has
never touched and ADR-0005 permanently bans. **One project rule survives that hand-off: the
credential value is never written into this repository, the register, an issue thread, or a commit
message.** Reference it obliquely or not at all.

### 8. The register, and the annual re-read

What made v1's audit indefensible was not its conclusion but that it left **no record of what was
read**. So the per-source facts live in [`docs/source-register.md`](../source-register.md): the URL
read, the `robots.txt` verdict, the operative clause verbatim, the route, permission status, whether
the clause is money-conditional, and **the date the terms were last read**.

The register is a separate file rather than a section of this ADR because it goes stale monthly
while the decision should be stable for years, and an ADR that looks wrong every few months stops
being trusted.

**Three triggers force a re-read**, beyond the per-source ends (permission arrives, refusal arrives,
we drop it):

- **Any objection, in any form** — and an objection to one source re-reads all of them.
- **Publication, in any form** — making the repository public, deploying the site where anyone can
  reach it, or sharing a feed URL. Under §5 this voids the private-use position outright, so it is a
  re-decision rather than a re-read, and every row's *cleared?* verdict changes with it.
- **Annually, on a date.** Terms change silently and nothing else is guaranteed to fire. One
  follow-up notice per year per unanswered source goes with it, so the record shows a standing offer
  to stop rather than a message sent once. **Any adapter touched re-reads that source's terms in the
  same PR.**

A stale register is worse than none, because it looks authoritative. The annual date and the
touched-adapter rule are what keep it honest.

## Consequences

- **ADR-0005 is amended, not superseded.** It already gives the core "browser lifecycle" and argues
  that politeness is structural, so §2 above *fulfils* it rather than reversing it. But an
  implementer working from ADR-0005 alone would miss the User-Agent and subresource obligations on
  the browser route, so ADR-0005 carries a pointer here.
- ⚠️ **MBCCS needs a code change today.** It is a browser adapter in production, so §2's identifying
  User-Agent and subresource blocking now bind it. That change carries the same untested risk as
  MBS: we do not know whether `mbccs.com.sg` still serves a Chrome announcing itself as
  `sg-tourism-calendar`. Under §4 the honest-identification rule wins there too.
- **The three v1 sources continue unchanged otherwise.** None trips a hard stop. Notably **MBCCS
  does not trip the authentication stop**: `src/sources/mbccs.ts` loads the page as any member of
  the public does and harvests the state it already holds; the leaked credential is never touched.
  That line was drawn in v1, before there was a rule requiring it.
- ⚠️ **SCC is the weakest clause we hold**, and the register marks it so rather than averaging it in.
  Suntec and MBCCS bar the *method* and the *purpose*, where facts-only and non-commercial each do
  real work. SCC's "internal" bars the *distribution* regardless of method or money, and there is no
  facts-only argument against it — it is a plain contract term we are plainly outside.
- **Pausing the three v1 sources pending permission was rejected.** It would halt the only working
  pipeline for an indefinite wait on emails that will most likely go unanswered, and it is a *worse*
  posture than continuing: stopping and restarting on silence is an admission you thought you should
  not have been reading it.
- **Unbarred sources are never emailed.** Fourteen of twenty either publish no terms or permissive
  ones. Asking them for permission invites a *no* to a question nobody asked and manufactures a
  refusal risk out of nothing.
- ⚠️ **ADR-0011 needs re-reading against a private repository.** It puts the site on Pages and
  commits the feeds to the branch. Neither mechanism is wrong, but **GitHub Pages from a private
  repository requires a paid plan**, so the deployment target is a live practical question rather
  than a settled one — and the committed feeds are exactly what makes a public repository a
  republication (§5). This ADR does not resolve ADR-0011; it changes the constraint ADR-0011 has to
  satisfy.
- **The AGPL / committed-feeds problem dissolves while the repository is private, and returns the
  day it is published.** The project is `AGPL-3.0-or-later` and ADR-0011 commits generated feeds to
  the branch; a reader finding `.ics` files in an AGPL repository could take the data as licensed
  too, which would have us purporting to grant redistribution rights over data obtained under terms
  forbidding exactly that. With no recipients there is no such grant and no appearance of one.
  **AGPL is kept regardless** — it costs nothing while dormant and preserves the option to open the
  repository without relicensing. Recorded in the register as a *conditional* risk rather than a
  closed one, so it is not rediscovered.
- **#121 inherits a constraint, not just a cost.** Pricing MBS and MBCCS as browser adapters now
  includes the core-owned driver seam, the identifying User-Agent, and subresource blocking.
- **Every future adapter PR has something to be checked against**, which is the point: the register
  row, the five politeness obligations, and the five hard stops.

## Alternatives rejected

- **An access-only rule, with republication decided per source.** Rejected: the permission asks
  cover the union regardless, so the rule would be narrower than the emails implementing it. It was
  genuinely arguable — MBS's 3-day directory was kept partly as a *verification check* on aggregator
  claims, a use needing no republication at all — but one rule beats a rule plus an exception.
- **Treating `robots.txt` and terms as one signal**, in either direction. Ruling both hard would
  concede the two largest MICE venues in Singapore for clauses nobody has ever enforced against a
  facts-only reader. Ruling both soft would forfeit the one norm that costs nothing to honour and
  buys the entire well-behaved-reader posture. v1 collapsed them by checking only `robots.txt`; that
  is the mistake this ADR is correcting.
- **Defining politeness for the HTTP route only, browser adapters best-effort.** Rejected: it would
  leave the two most legally exposed sources as the two least governed, which is exactly backwards.
- **Keeping Chrome's default User-Agent on the browser route so MBS stays reachable.** Rejected —
  see §4. Reachability is not worth the one fact that would sink every other source.
- ~~**Running v2 privately until permission lands.**~~ **Adopted** — see §5. Initially rejected on
  the ground that demonstrating the thing working *is* the MVP, then reversed the same day once it
  was clear that **publishing is not what demonstrates it**. Recorded struck-through rather than
  deleted, because the mistake is the useful part: *demonstrate it works* and *publish it* had been
  treated as one act, and separating them turned out to cost the MVP nothing and to clear four
  clauses.
- **Publishing while merely staying non-commercial.** The version of §5 first drafted. It would have
  switched off one clause (Constellar §4.7) and left the personal/internal limbs breached on five
  sources — buying the appearance of restraint for very little of its substance.
- **Keeping the repository public but not sharing the site URL.** Rejected on the facts: ADR-0011
  commits the feeds to the branch, so a public repository republishes the data regardless of who
  holds the URL. Unlisted is not private.
- **Treating silence as refusal after a fixed window.** See §6.
- **Emailing every barred source at once.** Asking is the *only* mechanism by which we can lose a
  source: silence cannot hurt us, a *no* is a hard stop. So the ask is a targeted instrument, not a
  mailshot — and it never goes to a source that has forbidden nothing.
