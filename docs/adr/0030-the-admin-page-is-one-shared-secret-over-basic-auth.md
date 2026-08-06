# ADR-0030: The admin page is one shared secret over HTTP Basic Auth

- **Status:** Accepted
- **Date:** 2026-08-06
- **Ticket:** [#118](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/118)
- **Answers the admin half of [ADR-0025](0025-the-store-is-a-service-and-v2-ships-the-web-only.md) §4** —
  *who may reach the served calendar* split into two: the calendar's own reach was ruled by ADR-0026 §2,
  and the operator's login is ruled here.
- **Fills in the login [ADR-0026](0026-v2-publishes-the-code-and-the-calendar-are-public-the-data-leaves-the-repository.md) §2 pointed at** —
  *"write the calendar → the operator, behind #118's login."* This is that login.
- **Rides on [ADR-0025](0025-the-store-is-a-service-and-v2-ships-the-web-only.md)'s spent
  zero-credentials property** — it adds one more server-side secret of the same kind as the connection
  string, not a change of kind. It does not re-spend [ADR-0010](0010-network-access-is-injected-never-defaulted.md),
  whose injected-never-defaulted rule the secret follows.
- **Confirms [ADR-0024](0024-moderation-is-one-flag-and-the-mvp-does-not-match.md) §3 and
  [ADR-0025](0025-the-store-is-a-service-and-v2-ships-the-web-only.md) §6** — the flags stay
  person-set with no *by whom* or *when*, because this ADR keeps the single-operator assumption they
  rest on.

## Context

ADR-0025 landed a running server: it holds one connection string, writes to Postgres, and serves the
web calendar's data live. ADR-0026 ruled the calendar public to read and put the one privileged act —
changing it — behind a login it named but did not build: `hidden`, `reviewed` and `manual` hand-entry
are person-only, and anything reaching the admin surface can set all three.

The store itself has **no notion of accounts** — access to it is the single connection string the
server holds, not per-person credentials. So *does the admin side have accounts* is entirely a
question about the admin page, and it turns first on whether more than one person ever moderates.

#118 was blocked on ADR-0025 because the plausible mechanisms differ sharply between a file behind one
process and a service with its own access model. It is the second, which narrows the ticket: there is
one write path to guard, subscriber identity is out of scope entirely (ADR-0025 §3 moved the feeds to
v3 and parked #119), and two of the three flags record *that* they were set but never *by whom*, on an
explicit one-moderator assumption ADR-0025 records as a reopen trigger.

## Decision

### 1. Single operator. No accounts on either side

Only Ed moderates, now and foreseeably. There is **no user table, no per-user state, no account
model** — on the store side (ADR-0025) or the admin side. "Who marked this record" has exactly one
possible answer, which is what keeps `hidden` and `reviewed` unambiguous without an authorship column.

A second moderator is the clean reopen (see *Reopen trigger*) — it is the same trigger ADR-0025
already carries, because two hands on flags that record no author make both flags ambiguous at once.

### 2. The mechanism is a single shared secret, checked as HTTP Basic Auth

The server compares one secret per request. The browser prompts for it, caches it, and re-sends it on
every request. There is **no login page, no session store, no cookie logic, no user model** — the
browser supplies the credential UI and its persistence, and the server supplies one comparison.

This is the leanest thing that guards the write path, chosen on that ground. What it gives up is
recorded rather than hidden: it authenticates *what you know*, not *who you are* — no second factor,
no phishing resistance — and it has no server-side session to expire (log-out means clearing the
browser credential). For a one-person hide-button on a public tourism calendar, that is proportionate.

### 3. The secret is a server-side env var, a long random token, injected not defaulted

- It lives as an environment variable (e.g. `ADMIN_PASSWORD`) **beside the connection string** — the
  same kind of secret, never committed, injected exactly as ADR-0010 requires the HTTP client and
  ADR-0025 requires the store connection to be.
- It is a **long random token, not a memorable phrase.** That removes the need to build brute-force
  lockout or rate-limiting for the MVP, and it is what gets rotated.
- The Basic Auth **username is fixed and ignored** — only the password is the secret, so there is
  nothing to remember on the username side.
- **Recovery when the credential is lost is to rotate the env var and redeploy.** There is no account
  state to reset, no recovery email, no second factor to fall back to.

### 4. No audit trail for the MVP

Nothing records who set a flag, or when. ⚠️ With one operator, an authorship column stores a constant
and a who/when log records "Ed, at some time" for events only Ed could have caused — cost for no
information. This confirms ADR-0024 §3 and ADR-0025 §6, which already declined to store why/when/by-whom.

This is about *authorship*, not *undo*: hiding is already reversible (ADR-0024 — nothing retires a
UID), so a mistake is recoverable regardless; there is simply no log of when it happened.

### 5. One auth boundary around the whole admin surface

The single Basic Auth guard wraps **everything under the admin path** — the admin page itself, the
review-queue read (which reads `VenueEvent` directly, including unreviewed and hidden rows), the
hand-entry form, and every write route. The **public calendar's read payload stays open** (ADR-0026 §2).

Guarding writes alone was rejected: it would leave the operator surface — hidden rows, the controls,
the queue — served to any stranger who loaded the admin page, and it makes two lines to keep in sync
where one suffices. The boundary is mounted one level up; it is the same middleware, not more code.

### 6. HTTPS is a binding host constraint

Basic Auth sends the secret on every request, so over plain HTTP the password is base64 — readable.
⚠️ **The admin surface must be served over HTTPS.** This is the analog of ADR-0025's *the host must
have point-in-time restore*: a real constraint that rides forward to `/to-spec` and the still-deferred
host pick. **A host that cannot terminate TLS on the admin surface does not satisfy this ADR.**

## Consequences

- ✅ **#118 is resolved and nothing gates the launch.** The mechanism is one env var and one middleware
  on a server that is being built regardless.
- **`/to-spec` carries two host constraints now, not one.** ADR-0025's PITR and this ADR's HTTPS both
  bind the deferred host choice; a host must satisfy both.
- ⚠️ **The zero-credentials property is not re-spent, but the secret count rises to two.** The server
  holds the connection string (ADR-0025) and now the admin token. Both are server-side env vars of the
  same kind; this is more of the same secret, not a new kind of exposure.
- **The admin↔public boundary is one line.** Everything under the admin path is guarded; the calendar
  read payload is open. There is exactly one place where "public" becomes "operator."
- ⚠️ **No brute-force protection is built.** It is unnecessary only while the secret is a long random
  token (§3). A memorable password would reopen this immediately.
- **Subscriber identity shares nothing with admin auth**, because there is no subscriber identity in
  v2 — ADR-0025 §3 moved the feeds and #119 to v3. This ADR neither constrains nor is constrained by it.

## Reopen trigger

- **A second operator appears.** This is the same trigger ADR-0025 and ADR-0024 §3 carry: `hidden` and
  `reviewed` record no author, so two moderators make both flags ambiguous, and the shared secret can no
  longer tell which person acted. That reopens §1 (accounts), §4 (audit trail / authorship on the
  flags), and §2 (per-person credentials instead of one shared secret) together.
- **Any revenue of any kind.** ADR-0026's revenue trigger fires the publication re-decision, not this
  ADR directly — but a login that fronts a paid surface is a heavier thing than a personal hide-button,
  and the proportionality argument in §2 would be re-run.
- **The shared secret leaks, or Basic Auth's crudeness bites.** If the token is exposed, or the
  always-on credential / no-logout UX proves to be friction, the answer is a proper session login
  (cookie, expiry, a login page) — more code, deliberately deferred here.

## Alternatives rejected

- **Sign in with GitHub (OAuth).** The identity Ed already has. Rejected because it re-adds the exact
  GitHub dependency v2 is shedding, and it brings OAuth's account and callback machinery to prove one
  person.
- **A hosted identity provider (Auth0, Clerk, and similar).** Rejected as a second vendor and a whole
  accounts apparatus to authenticate a single operator.
- **A network-level lock (IP allowlist, Tailscale, VPN).** Can be near-zero application code, but
  rejected as not actually simpler: it needs infrastructure on a host that is still deferred, couples
  "can I moderate" to "am I on the right network," and fights the shape where one server serves both
  the public calendar and the admin surface. Basic Auth is self-contained in the app and portable
  across whatever host is chosen.
- **A proper session-cookie login** (login page, server-side session, expiry). The nicer UX, and the
  thing to return to if Basic Auth's crudeness bites. Rejected for the MVP as more code — a session
  store, cookie handling and a login page — for a one-person tool opened occasionally.
- **An unguessable admin URL instead of a credential.** Rejected on ADR-0026 §2's own reasoning:
  obscurity is not a credential and does not change what the server does when a stranger asks.
- **Guarding the write routes only, leaving the admin page readable.** Rejected in §5: it serves the
  operator surface and hidden rows to strangers, and splits the boundary in two.
- **Storing authorship / a timestamp on the flags now.** Rejected in §4: with one operator it records a
  constant. It returns with the second operator, as a set with the accounts question.
- **A memorable password.** Rejected: it would force brute-force lockout and rate-limiting into the
  MVP that a long random token makes unnecessary.
