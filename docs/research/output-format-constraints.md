# Output format constraints: the envelope the schema must satisfy

Research for [issue #6](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/6). Blocks the domain model decision (#7, #11).

**Question.** What hard constraints do the three output targets (iCal feed, web calendar, deferred Excel export) impose, and what schema envelope satisfies all of them?

**Position.** The iCal feed is a **deliberately reduced projection**, not a faithful one. Evidence below. The domain model is the source of truth; the feed is a lossy serializer with an explicitly enumerated output set.

---

## 1. TL;DR — the envelope

| Constraint | Verdict |
| --- | --- |
| Properties that survive **all three** major clients | `UID`, `DTSTAMP`, `DTSTART`, `DTEND`, `SUMMARY`, `DESCRIPTION`, `LOCATION`, `SEQUENCE`, `TRANSP` |
| Custom `X-` properties | **Dropped.** Confirmed — see §3 |
| `CATEGORIES` (standard RFC 5545!) | Outlook only — 1 of 3 |
| `URL` (standard RFC 5545!) | Apple only — 1 of 3 |
| `REFRESH-INTERVAL` / `X-PUBLISHED-TTL` | Outlook desktop only, as a *floor*. Ignored elsewhere — see §6 |
| `UID` stability | Load-bearing. **Assign once, store, never recompute** — see §5 |

**The punchline:** the surviving intersection is *exactly* the user's existing manual Excel columns (start, end, name, location, description) plus iCal's two mandatory bookkeeping fields (`UID`, `DTSTAMP`). Nothing added beyond that core reaches a subscriber's calendar. The map's standing constraint — "iCal is the narrowest output target" — is confirmed, and is in fact **narrower than assumed**: the loss is not limited to `X-` properties.

---

## 2. What a VEVENT actually permits (spec)

[RFC 5545 §3.6.1](https://www.rfc-editor.org/rfc/rfc5545.html#section-3.6.1) — a `VEVENT` requires only:

- `DTSTAMP`, `DTSTART`, `UID`

Everything else — `DTEND`, `SUMMARY`, `LOCATION`, `DESCRIPTION`, `CATEGORIES`, `URL`, `STATUS`, `SEQUENCE`, `TRANSP` — is optional. `DTSTART`, `DTEND`, `DURATION`, `CREATED`, `DTSTAMP`, `LAST-MODIFIED`, `SEQUENCE`, `UID` MUST NOT occur more than once. `DTEND` and `DURATION` MUST NOT both appear.

So the spec is permissive. The spec is not the constraint. **The clients are the constraint.**

### All-day vs timed, and multi-day spans

RFC 5545 §3.6.1, verbatim:

> The "DTSTART" property for a "VEVENT" specifies the inclusive start of the event. […] The "DTEND" property for a "VEVENT" calendar component specifies the **non-inclusive** end of the event.

The RFC's own multi-day example:

```
DTSTART;VALUE=DATE:20070628
DTEND;VALUE=DATE:20070709
```

> Note that the "DTEND" property is set to July 9th, 2007, since the "DTEND" property specifies the non-inclusive end of the event.

**Consequence.** An all-day event is `DTSTART;VALUE=DATE` + `DTEND;VALUE=DATE` where `DTEND` is **the day after the last day**. A conference running 28 June – 8 July inclusive emits `DTEND:20070709`. This is the single most common off-by-one in ICS generation. The manual Excel's `end` column almost certainly means *inclusive last day* — so the serializer must add one day. **The domain model should store the inclusive end and let the serializer do the +1**, because the inclusive form is what the web calendar and Excel want, and it is what a human data-entry process naturally produces.

Also from the same section: a `DATE`-typed `DTSTART` with no `DTEND`/`DURATION` means a one-day event.

Microsoft additionally sets `X-MICROSOFT-CDO-ALLDAYEVENT` ([MS-OXCICAL 2.1.3.1.1.20.28](https://learn.microsoft.com/en-us/openspecs/exchange_server_protocols/ms-oxcical/0f262da6-c5fd-459e-9f18-145eba86b5d2)) — but the `VALUE=DATE` form is the interoperable signal and is sufficient.

---

## 3. `X-` properties: CONFIRMED dropped — but the mechanism matters

**The expected finding is confirmed.** The reasoning is stronger than "clients are sloppy", and the precise mechanism changes what the workaround can be.

### The spec licenses the drop

[RFC 5545 §3.8.8.2](https://www.rfc-editor.org/rfc/rfc5545.html#section-3.8.8.2), verbatim:

> User agents that support this content type are expected to be able to **parse** the extension properties and property parameters but **can ignore them**.

So a client that discards every `X-` property is fully conformant. There is no spec-level recourse.

### Each client stores a closed schema — there is nowhere to put it

This is the structural argument, and it is verifiable from first-party sources:

- **Google.** The [Calendar API v3 `Event` resource](https://developers.google.com/workspace/calendar/api/v3/reference/events) is a fixed field list. Verified against the machine-readable [discovery document](https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest): the `Event` schema has **no** `url` field, **no** `categories` field, and no field holding arbitrary iCalendar properties. `extendedProperties` exists — but it is settable only through the API, not through an ICS subscription, so it is unreachable for a published feed.
- **Microsoft.** The [Graph `event` resource](https://learn.microsoft.com/en-us/graph/api/resources/event) is likewise a fixed list. `singleValueExtendedProperties` / `multiValueExtendedProperties` are MAPI-level and Graph-only — again unreachable from ICS. Decisively, [MS-OXCICAL Processing Rules](https://learn.microsoft.com/en-us/openspecs/exchange_server_protocols/ms-oxcical/74d3bf60-f30d-4fca-84d3-cfd04da8e627) enumerates the *complete* conversion table — "over 100 components, properties, and parameters that can be converted". It is an **allowlist**. A property not in the table has no conversion rule and therefore no destination.
- **Apple.** [`EKEvent`](https://developer.apple.com/documentation/eventkit/ekevent) / `EKCalendarItem` expose `title`, `location`, `notes`, `url`, `startDate`, `endDate`, `isAllDay`, `timeZone`, `recurrenceRules`, `alarms`, `availability`, `calendarItemExternalIdentifier`. There is no public dictionary for arbitrary properties.

### The important nuance

`X-` properties are **not** uniformly ignored — each vendor honours *its own*. MS-OXCICAL's table shows Outlook actively converting `X-MICROSOFT-CDO-ALLDAYEVENT`, `X-MICROSOFT-CDO-BUSYSTATUS`, `X-ALT-DESC`, `X-WR-CALNAME`, `X-PUBLISHED-TTL` and others.

So the accurate rule is not *"`X-` is ignored"* but:

> **Each client honours a closed, vendor-specific allowlist. Anything outside it — including third-party `X-` properties, and including standard RFC 5545 properties the vendor's model has no field for — is discarded silently, with no error and no feedback channel.**

There is no `X-SG-TOURISM-SOURCE` that any of the three will carry. **Confirmed and load-bearing: no schema field beyond the VEVENT core can survive the feed.**

### The sting: standard properties fail too

This is the finding that goes beyond the map's stated assumption. Two properties that are *fully standard RFC 5545* and look like the obvious homes for our extra data:

| Property | Google | Apple | Outlook | Survives? |
| --- | --- | --- | --- | --- |
| `CATEGORIES` | ✗ no field | ✗ no field | ✓ `categories` | **1 of 3** |
| `URL` | ✗ no field | ✓ `url` | ✗ not in MS-OXCICAL table | **1 of 3** |

Sources: Google discovery doc (`'categories' in Event → False`, `'url' in Event → False`); [Graph `event`](https://learn.microsoft.com/en-us/graph/api/resources/event) has `categories`; MS-OXCICAL's VEVENT table lists `CATEGORIES` but contains no `URL` row at all; [`EKCalendarItem.url`](https://developer.apple.com/documentation/eventkit/ekcalendaritem/url) exists.

**Therefore: source attribution and category cannot be carried structurally.** Not via `X-`, not via `CATEGORIES`, not via `URL`. If they must reach a subscriber, they have to be **rendered into `SUMMARY` and/or `DESCRIPTION` as human-readable text** — the only fields that survive everywhere. That is a presentation decision made in the serializer, not a schema field.

---

## 4. Timezones — Asia/Singapore specifically

### Floating vs TZID

[RFC 5545 §3.3.5](https://www.rfc-editor.org/rfc/rfc5545.html#section-3.3.5), FORM #1:

> DATE-TIME values of this type are said to be **"floating"** and are not bound to any time zone in particular. They are used to represent the same hour, minute, and second value **regardless of which time zone is currently being observed**.

**This is a trap for our use case.** A floating `20260901T090000` renders as 09:00 in Singapore *and* 09:00 in London. A Suntec conference starting 09:00 SGT is not a 09:00 London event. Floating time is only correct for things like "lunch at noon, wherever you are". Our events are physically located in Singapore. **Floating times are wrong here and must not be used.**

The alternatives are TZID-qualified local time or UTC. UTC (`…Z`) is unambiguous and needs no `VTIMEZONE`, but loses the authored local time and displays awkwardly in some tooling. **TZID-qualified is the correct choice** — it preserves intent and every client resolves it to the viewer's zone.

### TZID obliges a VTIMEZONE

[RFC 5545 §3.2.19](https://www.rfc-editor.org/rfc/rfc5545.html#section-3.2.19), verbatim:

> This property parameter specifies a text value that uniquely identifies the "VTIMEZONE" calendar component to be used when evaluating the time portion of the property. […] **An individual "VTIMEZONE" calendar component MUST be specified for each unique "TZID" parameter value specified in the iCalendar object.**
>
> Failure to include and follow VTIMEZONE definitions in iCalendar objects may lead to inconsistent understanding of the local time at any given location.

So `DTSTART;TZID=Asia/Singapore:…` **requires** an accompanying `VTIMEZONE` block. Emitting the `TZID` parameter without one is non-conformant; some clients tolerate it by resolving the IANA name, others do not. Don't rely on tolerance.

### The good news: Singapore is trivial

Verified empirically against IANA tzdata 2026b (`zdump -v Asia/Singapore`):

```
Asia/Singapore  Thu Dec 31 16:00:00 1981 UT = Fri Jan  1 00:00:00 1982 +08 isdst=0 gmtoff=28800
```

That is the **last transition**. Since 1982-01-01, Asia/Singapore is a fixed **UTC+08:00 with no DST**, forever forward. So the required `VTIMEZONE` is a single static `STANDARD` component with no `RRULE` and no `DAYLIGHT`:

```
BEGIN:VTIMEZONE
TZID:Asia/Singapore
BEGIN:STANDARD
DTSTART:19820101T000000
TZOFFSETFROM:+0730
TZOFFSETTO:+0800
TZNAME:+08
END:STANDARD
END:VTIMEZONE
```

It is a constant. It can be a literal in the codebase; no tzdata library is needed at serialization time, and there is no DST-boundary correctness risk. This is one of the few places where the domain being Singapore-specific makes life materially easier — and it is worth writing down so nobody later reaches for a heavyweight timezone dependency to solve a problem that does not exist.

**Recommendation.** All-day events (most MICE conferences, cruise port calls spanning a day) → `VALUE=DATE`, no timezone involved at all, no `VTIMEZONE` needed. Timed events → `TZID=Asia/Singapore` + the static `VTIMEZONE` above. Never floating.

---

## 5. UID stability — the most important item

### What the spec says

[RFC 5545 §3.8.4.7](https://www.rfc-editor.org/rfc/rfc5545.html#section-3.8.4.7), verbatim:

> **Purpose:** This property defines the **persistent, globally unique** identifier for the calendar component.
>
> **Description:** The "UID" itself MUST be a globally unique identifier. The generator of the identifier MUST guarantee that the identifier is unique. […] it is RECOMMENDED that the right-hand side contain some domain identifier […] such that the generator of the message identifier can guarantee the uniqueness of the left-hand side within the scope of that domain.

Note the word **persistent**. The RFC's suggested construction (timestamp + process id + `@domain`) guarantees *uniqueness* but explicitly **not** stability across regeneration — it is designed for one-shot message correlation. **Following the RFC's suggested algorithm literally would be the exact bug this ticket warns about.** Uniqueness and stability are different properties; we need both, and the RFC only helps with one.

### The clients key on UID — confirmed on all three

- **Google:** `iCalUID` is *"Event unique identifier as defined in RFC5545. It is used to uniquely identify events **accross calendaring systems** and must be supplied when importing events via the import method"* ([discovery doc](https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest) / [events.import](https://developers.google.com/workspace/calendar/api/v3/reference/events/import)).
- **Apple:** [`calendarItemExternalIdentifier`](https://developer.apple.com/documentation/eventkit/ekcalendaritem/calendaritemexternalidentifier) — *"The calendar item's external identifier as provided by the calendar server. This identifier allows you to access the same event or reminder **across multiple devices**."* Apple explicitly notes duplicates arise when *"A calendar item was imported from an ICS file into multiple calendars"* and *"Recurring event identifiers are the same for all occurrences."*
- **Outlook:** [MS-OXCICAL UID](https://learn.microsoft.com/en-us/openspecs/exchange_server_protocols/ms-oxcical/ac8c1e68-de58-4230-a2e2-79aae754a055) — a UID that isn't Outlook's own `EncodedGlobalId` form is treated as a `ThirdPartyGlobalId` and stored **verbatim** inside `PidLidGlobalObjectId` (prefixed with the bytes `vCal-Uid`), then exported back unchanged. Outlook preserves and keys on our UID.

**So the identity contract is real on all three.** Same UID → update in place. Different UID → a *new event*, with the old one left behind. A feed that regenerates UIDs on every scrape produces a duplicate per event per refresh. This is the failure mode the ticket names, and it is confirmed.

### The rule I recommend

> **A UID is assigned once, persisted in our own store, and never recomputed.**

UID must be **durable state, not a pure function of scraped content.** This is the core recommendation and it is deliberately stronger than "hash the fields".

Why not a content hash? Because *every* candidate input is mutable in practice. Hash the title → a typo fix on the source page resurrects the event as a duplicate. Hash the start date → a rescheduled conference duplicates rather than moves (and "the conference moved" is precisely the change subscribers most need to see *as an update*). Hash the description → any copy edit duplicates. Any pure function of scraped content is hostage to content drift, and scraped content drifts constantly. That is the whole problem.

Concretely:

1. **On first sight** of a record, resolve a **natural key** — the most stable identifier the source offers, in this order:
   1. the source's own event id (from a permalink, `data-` attribute, or query param) — **strongly preferred**;
   2. a normalised permalink URL (strip query strings, tracking params, fragments);
   3. **last resort**, `normalise(title) + start_date`. Document this as fragile: sources using it will duplicate on a title correction.
2. **Mint the UID** and write it to our store keyed by `(source_id, natural_key)`:
   ```
   UID = <sha256(source_id || ':' || natural_key) hex, truncated>@<our-domain>
   ```
   The `@domain` right-hand side satisfies the RFC's uniqueness guidance and prevents collisions with other publishers' feeds in a subscriber's calendar.
3. **On every subsequent scrape**, look the UID up by natural key. **Never re-derive it.** The hash is only how a *new* UID is minted; it is not how an existing one is found. This matters: it means we can change the derivation rule later, or repair a bad natural key, without detonating every subscriber's calendar. If UID were a pure function, the derivation rule would be frozen forever on day one.
4. **Never reuse** a UID for a different event.
5. **A changed title/time/location on the same natural key is an UPDATE**, not a new event: same UID, bump `SEQUENCE`, update `LAST-MODIFIED`.

This also gives us a free correctness check: if a scrape yields a record whose natural key is absent from the store, that is either a genuinely new event or a **breakage signal** (the source changed its URL scheme and every event now looks new). A sudden spike in "new" natural keys from one source is exactly the breakage detection the destination calls for — worth flagging to whoever picks up breakage detection, because the UID store makes it nearly free.

### Deletions

All three clients treat a subscribed feed as authoritative: an event whose UID vanishes from the feed is removed. No `STATUS:CANCELLED` tombstone is needed — and it wouldn't help anyway, since MS-OXCICAL's table shows `STATUS` is not converted by Outlook at all. Just drop the VEVENT.

### DTSTAMP — a practical trap

`DTSTAMP` is mandatory. The temptation is to set it to the scrape time. **Don't.** If `DTSTAMP` changes on every scrape, the feed bytes change on every scrape even when nothing happened, which defeats `ETag`/`If-Modified-Since` and forces every client to re-process the whole feed every poll.

**Set `DTSTAMP` to the time the event's content last actually changed** (i.e. track it alongside the UID in the store). The feed then becomes byte-stable between real changes, and can serve `304 Not Modified`. Given that clients poll on their own schedule and we cannot control the rate (§6), cheap 304s are the main lever we actually have over feed load.

---

## 6. Refresh cadence — clients poll on their own schedule

### The spec's hint is weak by construction

[RFC 7986 §5.7](https://www.rfc-editor.org/rfc/rfc7986#section-5.7) defines `REFRESH-INTERVAL`:

> **Purpose:** This property specifies a **suggested minimum** interval for polling for changes […]
>
> **Description:** This property specifies a positive duration that gives a suggested minimum polling interval […] The value of this property **SHOULD** be used by calendar user agents to **limit the polling interval** […] **to the minimum interval specified.**

Read that carefully: it is a **floor**, not a cadence. Even a client that fully honours it is only promising *not to poll more often than* the value. It can never make a client poll *faster*. `X-PUBLISHED-TTL` (Microsoft's de-facto predecessor) has the same semantics: *"Specifies a suggested iCalendar file download frequency"* ([MS-OXCICAL 2.1.3.1.1.15](https://learn.microsoft.com/en-us/openspecs/exchange_server_protocols/ms-oxcical/1fc7b244-ecd1-4d28-ac0c-2bb4df855a1f)).

**So the property is structurally incapable of delivering what we'd want it for.** Even in the best case it cannot buy us fresher subscribers.

### Per client

| Client | Honours the hint? | Actual behaviour |
| --- | --- | --- |
| **Outlook desktop** | **Partially — the only yes** | MS-OXCICAL: on import `X-PUBLISHED-TTL` *"SHOULD be ignored"*, but [product behaviour note \<32\>](https://learn.microsoft.com/en-us/openspecs/exchange_server_protocols/ms-oxcical/afb90409-bcd2-4a44-9f1e-ca9340ec0508) states Outlook 2007–2019 *"use this property for purposes outside the scope of this algorithm"* — i.e. the subscription's **"Update Limit"**, which per [Microsoft Support](https://support.microsoft.com/en-us/office/introduction-to-publishing-internet-calendars-a25e68d6-695a-41c6-a701-103d44ba151d) uses *"the publisher's recommendation for intervals to refresh"*. It throttles; it does not accelerate. |
| **Outlook.com / OWA** | **No** | Server-side polling, ~4h fixed; reported 3–24h in practice. Not configurable by publisher or user. |
| **Google Calendar** | **No** | **Reputation confirmed.** Google publishes **no** documented refresh cadence for URL subscriptions and **no** statement of honouring `REFRESH-INTERVAL`/`X-PUBLISHED-TTL`. Its [`Event` schema](https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest) has no field for either, and [its sync doc](https://support.google.com/calendar/answer/37648) says only that link subscriptions are **read-only**. Observed cadence in user reports is ~8–24h and not publisher-controllable. |
| **Apple Calendar** | **N/A — user-controlled** | [Apple Support](https://support.apple.com/guide/calendar/subscribe-to-calendars-icl1022/mac): *"Click the Auto-refresh pop-up menu, then choose how often to update the calendar."* The **subscriber** picks the interval, not the publisher. Apple also lets subscribers strip alerts and attachments — further confirming the client, not the feed, decides what lands. |

### Consequence for the design

**No client offers a publisher-controllable refresh cadence.** Emit `REFRESH-INTERVAL` and `X-PUBLISHED-TTL` (cheap, correct, helps Outlook desktop behave), but **treat them as advisory and design for a worst case of ~24h subscriber staleness.**

This has a real product implication worth surfacing to whoever owns scope: the map's "refreshed daily" promise is **honoured by our pipeline, not by the subscriber's calendar.** A daily scrape plus a client that polls every 8–24 hours means an iCal subscriber can be up to ~48h behind a source change. **The web calendar is the only surface where "daily" is actually true** — it reads our store directly. That is an argument for the web calendar being the primary artefact and iCal being the convenience subscription, which happens to align with the reduced-projection position below.

---

## 7. What the web calendar needs that iCal cannot carry

Everything in §3 that dies on the feed lives fine on the web:

- **Source attribution** ("Suntec", "Marina Bay Cruise Centre") — required, since the map accepts duplicates *labelled by source*. **`CATEGORIES` reaches only Outlook; `URL` only Apple.** So on the feed, attribution must be baked into `SUMMARY`/`DESCRIPTION` text.
- **Category / event type** (MICE / ticketed / port call) — same problem, same answer.
- **Filtering** by source or category — a query-time concern with no iCal equivalent at all. RFC 5545 has no notion of a filtered view. If per-source subscriptions are wanted, that is **one feed URL per filter combination** (e.g. `/feed/suntec.ics`), not a filter property inside one feed. Worth noting now: it shapes the feed-routing design, and it is the *only* way to give subscribers filtering.
- **Link back to source page** — `URL` only survives on Apple, so on the feed it goes in `DESCRIPTION` as plain text.
- **Provenance / freshness** (last-verified timestamp, breakage state) — no iCal home whatsoever.

This asymmetry is not incidental. **It is the whole argument of §9.**

---

## 8. What a flat Excel export implies

Deferred as a v1 feature; must not be foreclosed. Constraints it imposes on the **model**, not the code:

1. **One row per event; every field scalar.** A flat sheet cannot express nesting. If the model ever grows a collection-valued field (multiple categories, multiple sessions, multiple venues), Excel needs a defined flattening — and so does `SUMMARY`/`DESCRIPTION`. **Keeping the core fields cardinality-1 scalars keeps all three targets trivially satisfiable.** This is the cheapest way to not foreclose Excel: don't add a collection to the core.
2. **Repetition over reference.** Parent-ish data (source name, source URL) repeats on every row. That's fine and expected — it means the model must be able to *denormalise* cleanly, i.e. each event record must be able to answer "which source am I from" locally rather than by pointer traversal. An event should carry its `source_id` directly.
3. **Recurrence must not be structural — and this is a live decision, not a hypothetical.** If the model stores an `RRULE`, Excel must expand it into N rows, and the model then has two different notions of "an event" (the rule vs. the occurrence). It also drags in the worst-interop corner of iCal.

   Our sources emit discrete, one-off happenings — a conference has dates, a port call has an arrival. **Recommendation: no `RRULE` in v1. Store and emit discrete occurrences.** Then "one domain record = one VEVENT = one Excel row = one web calendar entry" holds across all three targets, and Excel stays a pure serializer rather than an expansion engine. This is the single decision that most cheaply keeps Excel un-foreclosed, and it costs nothing given the sources.
4. **Inclusive end dates.** As in §4 — Excel wants the inclusive last day; iCal wants exclusive. Store inclusive, let the ICS serializer add the day. (If we stored the exclusive form, every non-iCal target would have to subtract a day, and the Excel export would read as off-by-one to the user who has been maintaining these dates by hand.)

Excel is the *least* constraining target — it happily carries source, category, and anything else. It constrains **shape** (flat, scalar, non-recursive), not **content**.

---

## 9. Position: faithful projection or deliberately reduced?

**The iCal feed must be a deliberately reduced projection.** Explicitly, by design, with an enumerated output set.

### The evidence

1. **A faithful projection is not achievable.** Not "expensive" — *impossible*. RFC 5545 §3.8.8.2 licenses clients to ignore `X-`; all three clients store closed schemas with no destination for arbitrary data; and MS-OXCICAL proves Outlook's conversion is a fixed allowlist. There is no encoding of "source attribution" that reaches a Google Calendar subscriber as structured data. The choice is not *whether* to reduce but *whether the reduction is designed or accidental*.
2. **The loss is worse than `X-` properties.** `CATEGORIES` and `URL` — both standard, both the obvious homes for our extra fields — each survive on exactly one of three clients. A team believing "stick to standard properties and we're fine" would ship a feed that silently loses data on two thirds of clients. **Standards conformance does not imply survival.** This is the finding that most changes how the schema should be approached.
3. **The failures are silent.** No error, no warning, no feedback channel. A "faithful projection" would appear to work in testing (the ICS file *does* contain `X-SG-SOURCE`) and fail invisibly in production. Reduction must therefore be **explicit in the code**, so the loss is legible to the next developer reading the serializer rather than discovered by a user asking why the source label is missing.
4. **The surviving set is already exactly the manual Excel core.** `SUMMARY`/`DESCRIPTION`/`LOCATION`/`DTSTART`/`DTEND` ↔ name/description/location/start/end. The user's hand-built spreadsheet has, by accident, been the maximal iCal-safe schema all along. So the reduction costs *nothing that exists today*. It only constrains what may be *added* — which is precisely what #6 was asked to determine.
5. **A faithful projection would corrupt the model.** If the feed had to be faithful, the domain model could never grow a field that iCal can't carry — the narrowest output target would become the ceiling for the whole system, and the web calendar (the surface where attribution and filtering actually matter, and per §6 the only one where "daily" is even true) could never get richer than a 1998 file format. **That is the tail wagging the dog.** The map already anticipates this: *"Any schema richer than the VEVENT core is lossy on the feed by design."* This research confirms it and supplies the mechanism.

### What this means concretely

- The domain model is the **source of truth**, sized for the web calendar (the richest target). It may carry source attribution, category, provenance, freshness — none of which the feed will ever see, and that is **correct, not a defect**.
- The ICS serializer is a **deep, narrow function**: `DomainEvent → VEVENT`, with an **explicitly enumerated** output property set — `UID`, `DTSTAMP`, `DTSTART`, `DTEND`, `SUMMARY`, `DESCRIPTION`, `LOCATION`, `SEQUENCE`, plus calendar-level `PRODID`, `VERSION`, `X-WR-CALNAME`, `REFRESH-INTERVAL`, `X-PUBLISHED-TTL`, `VTIMEZONE`. **Enumerated, not reflected.** Adding a domain field must never silently change the feed.
- Anything from the model that must reach a subscriber gets **rendered into `SUMMARY`/`DESCRIPTION` as prose** by that serializer. Attribution becomes a presentation decision (e.g. `SUMMARY: [Suntec] Trade Show X`), consciously made and easy to change — not a schema field that quietly evaporates.
- **The loss should be documented at the seam**, in the serializer, so the next person to add a field sees immediately that the feed will not carry it.

---

## 10. Recommended envelope

**Calendar level**
```
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//<org>//SG Tourism Calendar//EN
CALSCALE:GREGORIAN
METHOD:PUBLISH
X-WR-CALNAME:<name>              ← de facto; honoured by Outlook (MS-OXCICAL 2.1.3.1.1.17) & others
NAME:<name>                       ← RFC 7986 standard equivalent; emit both
REFRESH-INTERVAL;VALUE=DURATION:PT12H
X-PUBLISHED-TTL:PT12H             ← for Outlook desktop's Update Limit
<VTIMEZONE Asia/Singapore>        ← static, only if any timed events present
```

**Event level — enumerated, nothing else**
```
BEGIN:VEVENT
UID:<stable, stored, never recomputed>@<domain>
DTSTAMP:<last content change, NOT scrape time>
DTSTART;VALUE=DATE:<start>        ← or DTSTART;TZID=Asia/Singapore:<...> if timed
DTEND;VALUE=DATE:<inclusive_end + 1 day>
SUMMARY:<name, with source attribution rendered in if wanted>
DESCRIPTION:<description + source name + source URL as prose>
LOCATION:<location>
SEQUENCE:<bump on change>
END:VEVENT
```

**Explicitly not emitted, and why:** `CATEGORIES` (1/3 clients), `URL` (1/3 clients), any `X-` of ours (0/3), `STATUS` (not converted by Outlook), `RRULE` (see §8.3).

**Domain model must therefore:** store inclusive end dates; keep core fields flat and scalar; carry `source_id` on every event; persist a minted UID and a last-content-changed timestamp per event; and be free to carry attribution/category/provenance that the feed will never emit.

---

## Confidence

**High** (primary, normative, quotable): RFC 5545 VEVENT/UID/DTEND/TZID/floating text; RFC 7986 `REFRESH-INTERVAL`; MS-OXCICAL conversion table, `UID`, `X-PUBLISHED-TTL` + note \<32\>; Google discovery doc field list; Graph `event` field list; Apple `calendarItemExternalIdentifier` and `EKEvent`; IANA tzdata 2026b for Asia/Singapore.

**Medium** (vendor behaviour documented but not fully specified): Outlook desktop's use of `X-PUBLISHED-TTL` via Update Limit — MS-OXCICAL note \<32\> confirms it is used but explicitly places the purpose *outside* the spec's scope, so the exact mechanism rests on Microsoft Support prose.

**Lower** (absence of evidence + consistent user reports; **not** first-party): Google's ~8–24h observed cadence, and OWA's ~4h. Google documents **no** cadence at all. The *structural* claim — Google's schema has no field for the hint, therefore cannot honour it — is high-confidence; only the observed numbers are soft. Nothing in the recommendation depends on the exact figure, since the design assumes a ~24h worst case regardless.

**Not verified by live experiment.** The X-property and CATEGORIES/URL drops are established structurally (each vendor's own documented schema has no destination field) rather than by publishing a test feed and subscribing from all three clients. The structural argument is strong and multi-sourced, and I'd rate the conclusion safe to build on. If cheap, publishing a probe feed with `X-`, `CATEGORIES` and `URL` set and subscribing from all three would convert this from near-certain to observed — worth doing once the feed exists, but **not** worth blocking #7/#11 on.
