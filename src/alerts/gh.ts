import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { SourceId } from "../domain/types.js";
import { type IssueGateway, markerFor } from "./issues.js";

/**
 * The one place this repository shells out to `gh`, and the one place the alert
 * pipeline touches anything outside the process.
 *
 * **`gh` is the whole of "authenticates with `GITHUB_TOKEN` only".** It reads
 * the token from its own inherited environment — the daily workflow injects the
 * run-scoped `GITHUB_TOKEN` that Actions mints and expires with the run. No code
 * here reads `process.env` (the architecture test forbids it), no connection
 * string is stored, and the zero-credentials property #8 established is spent
 * only inside the workflow, exactly where ADR-0007 said the cost would land.
 *
 * `gh` also infers the repository from the checkout's git remote, so identity is
 * carried by the clone rather than configured here.
 */

const run = promisify(execFile);

/** Runs a `gh` subcommand and returns its stdout. Arguments are passed as an
 * array — no shell — so a fragment or a title needs no escaping and cannot be
 * interpreted as a command. */
export type Gh = (args: string[]) => Promise<string>;

/**
 * The real `gh` runner. Rejects if `gh` exits non-zero, carrying its stderr so a
 * failure is legible in the workflow log rather than a bare exit code.
 */
export const runGh: Gh = async (args) => {
  const { stdout } = await run("gh", args, { encoding: "utf8" });
  return stdout;
};

type ListedIssue = { number: number; body: string | null };

/**
 * An {@link IssueGateway} backed by `gh`. Finds a source's open issue by scanning
 * open issue bodies for the hidden marker (title-edit-proof identity), opens with
 * `gh issue create`, and closes with `gh issue close --comment`.
 */
export const createGhGateway = (gh: Gh = runGh): IssueGateway => ({
  findOpen: async (source: SourceId) => {
    // A body-marker scan rather than a label filter: labels would have to be
    // provisioned before an issue could carry one, and `gh issue create` errors
    // on a label that does not yet exist. The marker needs nothing set up first.
    const stdout = await gh(["issue", "list", "--state", "open", "--limit", "200", "--json", "number,body"]);
    const issues = JSON.parse(stdout) as ListedIssue[];
    const marker = markerFor(source);
    const hit = issues.find((issue) => (issue.body ?? "").includes(marker));
    return hit ? { number: hit.number } : null;
  },

  open: async (_source, title, body) => {
    await gh(["issue", "create", "--title", title, "--body", body]);
  },

  close: async (issue, comment) => {
    await gh(["issue", "close", String(issue.number), "--comment", comment]);
  },
});
