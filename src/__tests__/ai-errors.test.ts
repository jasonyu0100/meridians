// Tests for lib/ai/errors — FatalApiError subclass and isFatalStatus status-code classification.

import { describe, expect, it } from "vitest";
import { FatalApiError, isFatalStatus } from "@/lib/ai/errors";

describe("FatalApiError", () => {
  it("is a proper Error subclass so loops can catch it", () => {
    const err = new FatalApiError(402, "Insufficient credits");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(FatalApiError);
    expect(err.name).toBe("FatalApiError");
    expect(err.message).toBe("Insufficient credits");
    expect(err.status).toBe(402);
  });

  it("survives instanceof through a generic Error catch", () => {
    // Loops rely on this: they catch `err` and then discriminate by
    // `err instanceof FatalApiError`. If the class weren't wired up
    // correctly this check would silently fail and the halt path
    // wouldn't fire.
    let caught: unknown;
    try {
      throw new FatalApiError(401, "bad key");
    } catch (e) {
      caught = e;
    }
    expect(caught instanceof FatalApiError).toBe(true);
  });
});

describe("isFatalStatus", () => {
  it("flags auth + payment + forbidden as fatal", () => {
    expect(isFatalStatus(401)).toBe(true);
    expect(isFatalStatus(402)).toBe(true);
    expect(isFatalStatus(403)).toBe(true);
  });

  it("treats transient failures as non-fatal so retry logic still runs", () => {
    // 429 (rate limit), 5xx (transients), 400 (bad request — might be
    // recoverable via prompt repair), 408 (timeout) all stay Error.
    expect(isFatalStatus(400)).toBe(false);
    expect(isFatalStatus(408)).toBe(false);
    expect(isFatalStatus(429)).toBe(false);
    expect(isFatalStatus(500)).toBe(false);
    expect(isFatalStatus(502)).toBe(false);
    expect(isFatalStatus(503)).toBe(false);
    expect(isFatalStatus(504)).toBe(false);
  });

  it("treats success codes as non-fatal", () => {
    expect(isFatalStatus(200)).toBe(false);
    expect(isFatalStatus(204)).toBe(false);
  });
});
