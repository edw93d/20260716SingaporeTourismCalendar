declare const instantBrand: unique symbol;

/**
 * A point in time, UTC, to second precision — `2026-07-17T04:00:00Z`.
 *
 * Branded so a bare string cannot be assigned. That brand is the whole point:
 * it forces every value through {@link instant}, which is where date-only and
 * offset-less values are refused. ADR-0003 retired the all-day shape when
 * Ticketmaster — the only date-only source — was dropped on the legal audit,
 * so a `VALUE=DATE` has nowhere to enter the model from.
 *
 * Canonical form sorts chronologically as plain text, which is what lets
 * ADR-0007's future-dated cohort compare without parsing.
 */
export type Instant = string & { readonly [instantBrand]: true };

/** ISO-8601 date-time with an explicit offset. Naive and date-only both miss. */
const ISO_WITH_OFFSET =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})$/;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `new Date('2026-02-30T04:00:00Z')` does not fail — it rolls over to 2 March.
 * A source that published an impossible date would therefore be silently
 * "corrected" into a plausible one, which is a fabrication, not a parse. So the
 * components are range-checked before the value is handed to `Date`.
 */
const componentsAreReal = (
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): boolean => {
  if (month < 1 || month > 12) return false;
  if (hour > 23 || minute > 59 || second > 59) return false;

  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day >= 1 && day <= daysInMonth;
};

/** Drops the `.sssZ` tail `toISOString` always emits; iCal carries seconds. */
const canonicalise = (date: Date): Instant =>
  `${date.toISOString().slice(0, 19)}Z` as Instant;

/**
 * Parse an observed date-time into an {@link Instant}, converting any explicit
 * offset to UTC.
 *
 * Throws rather than returning a nullable, because there is no honest fallback:
 * a scraper that cannot read a time has found a **failure**, which ADR-0006
 * requires it to report as a `ParseFailure` rather than quietly substitute.
 */
export const instant = (value: string): Instant => {
  if (DATE_ONLY.test(value)) {
    throw new Error(
      `Refusing a date-only value: ${value}. There is no all-day shape (ADR-0003) — supply a time and an offset.`,
    );
  }

  const match = ISO_WITH_OFFSET.exec(value);
  if (!match) {
    // Deliberately checked before parsing: `new Date('2026-07-17T12:00:00')`
    // succeeds by silently assuming the host's zone, which would make the
    // result depend on where the scraper ran.
    const looksNaive = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(value);
    throw new Error(
      looksNaive
        ? `Refusing a date-time with no offset: ${value}. State the offset observed at the source — Asia/Singapore is a fixed +08:00.`
        : `Not a valid instant: ${JSON.stringify(value)}.`,
    );
  }

  const [, year, month, day, hour, minute, second = "0"] = match;
  if (
    !componentsAreReal(
      Number(year),
      Number(month),
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
    )
  ) {
    throw new Error(`Not a valid instant: ${JSON.stringify(value)}.`);
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Not a valid instant: ${JSON.stringify(value)}.`);
  }

  return canonicalise(parsed);
};

/** Build an {@link Instant} from a `Date` — typically the injected clock. */
export const instantFromDate = (date: Date): Instant => {
  if (Number.isNaN(date.getTime())) {
    throw new Error("Not a valid instant: an invalid Date.");
  }
  return canonicalise(date);
};

/** Read an {@link Instant} back as a `Date`, for arithmetic. */
export const toDate = (value: Instant): Date => new Date(value);
