/**
 * Errors raised at the LLM API boundary.
 *
 * `FatalApiError` marks failures no amount of retrying will fix within this
 * session — missing or invalid API key (401), insufficient credits (402),
 * forbidden / account blocked (403). Auto-running loops (auto-play, Scenarios,
 * bulk generation, analysis jobs) check `err instanceof FatalApiError` and
 * halt immediately, so a single credit exhaustion doesn't fan out into
 * dozens of failed API calls before the user can react.
 *
 * Everything else (timeouts, 429 rate limits, 5xx transients, malformed
 * responses) stays a plain `Error` — those are retryable and loops handle
 * them via their existing per-iteration logic.
 */
export class FatalApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "FatalApiError";
    this.status = status;
  }
}

/** HTTP statuses that indicate the session can't proceed without user action. */
const FATAL_STATUSES = new Set([401, 402, 403]);

export function isFatalStatus(status: number): boolean {
  return FATAL_STATUSES.has(status);
}
