# ADR-0001: VenueEvent and PortCall are separate types with a shared projection

- **Status:** Accepted
- **Date:** 2026-07-16
- **Ticket:** [#7](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/7)

## Context

The map assumed one unit — `{start, end, name, location, description}` — mirroring
the columns of the manual Excel. But "event" was doing at least two jobs:

- A **conference or concert**: something people attend, with a start and end, at a venue.
- A **cruise port call**: a ship docking. Nobody attends it. Its "location" is a
  terminal, and its value is that it lands thousands of people nearby.

The source capability audit (#2) settled this more sharply than the argument did.
The cruise sources emit **no name and no description at all** — MBCCS returns
`vesselName` / `berthNo` / `berthingDateTime` / `unberthingDateTime`; SCC is a table
of vessel, arrival, departure. A port call has no name because a port call *does not
have* a name. Any name it carried in a unified schema would be fabricated by us.

## Decision

Two domain types, each with honest fields, projected into one `CalendarEntry` that
the web calendar, iCal feed, and (later) Excel serialize.

```
VenueEvent { uid, sequence, source, sourceKey, name,
             start, end, venue, hall?, firstSeenAt, lastSeenAt }

PortCall   { uid, sequence, source, sourceKey, vessel,
             terminal, berth?, arrival, departure, firstSeenAt, lastSeenAt }

                          ↓ project()

CalendarEntry { uid, summary, start, end, location, description, source }
```

Projection:

| | VenueEvent | PortCall |
|---|---|---|
| `summary` | `name` | `Cruise: {vessel} at {terminal}` |
| `location` | `venue` (+ `hall`) | `terminal` |
| `description` | generated | generated (includes berth) |

`VenueEvent`, not `MiceEvent`: Suntec mixes business meetings with consumer events
like Cellar Fiesta, and MICE would misname the latter. Bare "Event" is banned in
`CONTEXT.md` as the ambiguity that caused this ticket.

`summary` carries category as prose because `CATEGORIES` survives on only 1 of 3
iCal clients (#6). This is independent of the feed-shape question (#11): separate
feeds still render into a single calendar grid, so the feed cannot carry the marker.

`vessel` is stored unsplit — see `CONTEXT.md`.

## Consequences

- One mapping layer to maintain, in exchange for "vessel", "berth" and "terminal"
  being real words instead of a dishonest `name` and `location`.
- **Excel is not foreclosed.** `CalendarEntry` flattens away `vessel`, `hall` and
  `berth`, but a future Excel serializer can read the domain types directly. The
  projection is a convenience, not a bottleneck.
- **#13 (ticketed-event coverage) becomes a pure sourcing question** — `VenueEvent`
  already models a ticketed concert; nothing in the model needs to change to admit one.
- **#8 (adapter interface)** must let an adapter emit either type.

## Alternatives rejected

- **One `Event` with nullable fields.** Cheapest, and the status quo ante. Rejected:
  it requires synthesizing a `name` for port calls and yields a `description` that is
  null for two of three sources — the exact incoherence the ticket was raised about.
- **One type with a discriminated-union payload.** Honest fields, one table — but the
  union leaks into every consumer, which is the cost of the projection without its benefit.
