/**
 * Where the daily run reads and writes, relative to the repository root.
 *
 * **Constants, not configuration.** There is no environment variable and no
 * config file behind any of these (see the architecture test): the pipeline runs
 * in exactly one place, and a path that could be overridden would be one more
 * thing that can differ between the run we test and the run that happens.
 *
 * They live in their own module rather than in the entry point because the
 * workflow has to agree with them, and the guard that holds it to that would
 * otherwise have to import the entry point — which runs the pipeline on import.
 */

/**
 * The pipeline's memory, committed to the repository each run (git-as-database:
 * a connection string is a credential, and the zero-credentials property is
 * load-bearing).
 */
export const DB_PATH = "data/calendar.sqlite";

/** The Pages artifact root: the static shell plus the generated feeds under it. */
export const SITE_DIR = "site";

/**
 * The web calendar's data payload — the everything-view the static page is built
 * from (#38). Written *inside* the published root, beside the shell that fetches
 * it, and committed for the same reason as the feeds: it is the one legible,
 * diffable record of what the day's calendar actually holds, sitting next to a
 * store blob that only says *that* it changed (ADR-0011).
 */
export const SITE_PAYLOAD = `${SITE_DIR}/calendar.json`;

/**
 * The `.ics` files, written *inside* the published directory rather than beside
 * it, so that one location is both what Pages uploads and what git commits.
 * See ADR-0011 for why it is both rather than either.
 */
export const FEEDS_DIR = `${SITE_DIR}/feeds`;
