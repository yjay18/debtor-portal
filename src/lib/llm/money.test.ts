import { describe, expect, it } from "vitest";

import { normalizeMoney, parseMajorAmountToCents } from "./money";

describe("parseMajorAmountToCents", () => {
  it.each([
    ["150", 15_000],
    ["150.50", 15_050],
    ["€1,285.50", 128_550],
    ["500 euro", 50_000],
    ["1,000", 100_000],
    ["£0.01", 1],
  ])("converts %s to %i cents", (amountRaw, expected) => {
    expect(parseMajorAmountToCents(amountRaw)).toBe(expected);
  });

  it.each([
    "", "0", "-1", "1.234", "1,00", "10 20", "150.50.20",
    "999999999999999999999999",
  ])("rejects the unsafe amount %s", (amountRaw) => {
    expect(parseMajorAmountToCents(amountRaw)).toBeNull();
  });
});

describe("normalizeMoney", () => {
  it.each([
    ["150", "EUR", 15_000],
    ["€1,285.50", "EUR", 128_550],
    ["500 euro", "EUR", 50_000],
    ["500 EUR", "EUR", 50_000],
    ["500 quid", "EUR", 50_000],
    ["500 euro today", "EUR", 50_000],
    ["$200", "USD", 20_000],
  ])("accepts %s for a %s account", (amountRaw, currency, amountCents) => {
    expect(normalizeMoney(amountRaw, currency)).toEqual({
      status: "ready",
      amountCents,
      currency,
    });
  });

  it.each(["$200", "200 dollars", "200 dollars now", "£200"])(
    "asks for the ledger currency instead of converting %s",
    (amountRaw) => {
      expect(normalizeMoney(amountRaw, "EUR")).toMatchObject({
        status: "clarify",
        reason: "currency_mismatch",
      });
    },
  );

  it("clarifies an unknown currency word", () => {
    expect(normalizeMoney("200 credits", "EUR")).toMatchObject({
      status: "clarify",
      reason: "unknown_currency",
    });
  });

  it("clarifies an invalid amount before considering currency", () => {
    expect(normalizeMoney("€1.234", "EUR")).toMatchObject({
      status: "clarify",
      reason: "invalid_amount",
    });
  });

  it("rejects an invalid persisted account currency", () => {
    expect(() => normalizeMoney("200", "euro")).toThrow(
      "Account currency must be a three-letter code.",
    );
  });
});
