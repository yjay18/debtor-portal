import { describe, expect, it } from "vitest";

import { resolveFutureDate } from "./dates";

const nowIso = "2026-07-16T15:00:00.000Z";

describe("resolveFutureDate", () => {
  it.each([
    ["tomorrow", "2026-07-17"],
    ["August 1st", "2026-08-01"],
    ["the 1st of next month", "2026-08-01"],
  ])("accepts agreeing future date %s", (rawText, llmIso) => {
    expect(resolveFutureDate({ rawText, llmIso, nowIso, kind: "date" })).toEqual({
      status: "ready",
      iso: llmIso,
    });
  });

  it("accepts an agreeing Dublin future date and time", () => {
    expect(
      resolveFutureDate({
        rawText: "next Tuesday at 10am",
        llmIso: "2026-07-21T10:00:00+01:00",
        nowIso,
        kind: "dateTime",
      }),
    ).toEqual({ status: "ready", iso: "2026-07-21T09:00:00.000Z" });
  });

  it("accepts the same Dublin instant expressed in UTC", () => {
    expect(
      resolveFutureDate({
        rawText: "next Tuesday at 10am",
        llmIso: "2026-07-21T09:00:00Z",
        nowIso,
        kind: "dateTime",
      }),
    ).toMatchObject({ status: "ready" });
  });

  it.each([
    ["tomorrow", "2026-07-18", "date"],
    ["next Tuesday at 10am", "2026-07-21T11:00:00+01:00", "dateTime"],
  ] as const)("clarifies when Chrono and the model disagree for %s", (rawText, llmIso, kind) => {
    expect(resolveFutureDate({ rawText, llmIso, nowIso, kind })).toMatchObject({
      status: "clarify",
      reason: "date_disagreement",
    });
  });

  it.each([
    ["yesterday", "2026-07-15", "date"],
    ["yesterday at 10am", "2026-07-15T10:00:00+01:00", "dateTime"],
  ] as const)("rejects past value %s", (rawText, llmIso, kind) => {
    expect(resolveFutureDate({ rawText, llmIso, nowIso, kind })).toMatchObject({
      status: "clarify",
      reason: "not_future",
    });
  });

  it.each([
    ["tomorrow", "2026-02-30", "date"],
    ["tomorrow at 10am", "2026-02-30T10:00:00Z", "dateTime"],
    ["tomorrow at 10am", "2026-07-17T10:00:00", "dateTime"],
  ] as const)("rejects malformed model date %s", (rawText, llmIso, kind) => {
    expect(resolveFutureDate({ rawText, llmIso, nowIso, kind })).toMatchObject({
      status: "clarify",
      reason: "invalid_llm_date",
    });
  });

  it("clarifies text containing more than one parsed date", () => {
    expect(
      resolveFutureDate({
        rawText: "tomorrow or Friday",
        llmIso: "2026-07-17",
        nowIso,
        kind: "date",
      }),
    ).toMatchObject({ status: "clarify", reason: "unresolved_raw_date" });
  });

  it("rejects an invalid trusted clock value", () => {
    expect(() =>
      resolveFutureDate({
        rawText: "tomorrow",
        llmIso: "2026-07-17",
        nowIso: "not-a-date",
        kind: "date",
      }),
    ).toThrow("Current time must be a valid ISO timestamp.");
  });
});
