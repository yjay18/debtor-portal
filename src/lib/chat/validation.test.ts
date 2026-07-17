import { describe, expect, it } from "vitest";

import type { ParsedIntent } from "@/lib/llm/parser-schema";
import { sanitizeFreeText, validateAccountHolderUpdate, validatePreferredContactMethodUpdate } from "./validation";

type AccountUpdateIntent = Extract<ParsedIntent, { action: "update_account_holder" }>;

function accountUpdate(fields: AccountUpdateIntent["fields"]): AccountUpdateIntent {
  return {
    action: "update_account_holder",
    fields,
    additionalIntents: [],
    missingFields: [],
  };
}

describe("sanitizeFreeText", () => {
  it("normalizes Unicode, removes controls, and trims surrounding space", () => {
    expect(sanitizeFreeText("  Jose\u0301\nO'Brien\u0000  ")).toBe("José O'Brien");
  });

  it("preserves valid Unicode, apostrophes, and hyphens", () => {
    expect(sanitizeFreeText(" 李 O'Brien-Smith ")).toBe("李 O'Brien-Smith");
  });
});

describe("validateAccountHolderUpdate", () => {
  it("accepts and sanitizes every account-holder field", () => {
    const result = validateAccountHolderUpdate(accountUpdate({
      firstName: " Jane ",
      lastName: " Murphy ",
      email: " jane@example.test ",
      phone: "\n+353831112233 ",
      addressLine1: " 1 Main Street ",
      addressLine2: " Apartment 2 ",
      city: " Dublin ",
      postalCode: " D01 AB12 ",
      country: " Ireland ",
    }));

    expect(result).toMatchObject({
      status: "ready",
      fields: {
        firstName: "Jane",
        lastName: "Murphy",
        email: "jane@example.test",
        phone: "+353831112233",
        addressLine1: "1 Main Street",
        addressLine2: "Apartment 2",
        city: "Dublin",
        postalCode: "D01 AB12",
        country: "Ireland",
      },
    });
  });

  it.each([
    ["missing plus", "353831112233"],
    ["too short", "+123456"],
    ["too long", "+1234567890123456"],
    ["contains spaces", "+353 83 111 2233"],
    ["contains letters", "+35383CALLME"],
  ])("clarifies a phone number with %s", (_name, phone) => {
    const result = validateAccountHolderUpdate(accountUpdate({ phone }));

    expect(result).toMatchObject({
      status: "clarify",
      intent: {
        action: "clarify",
        missingFields: ["phone"],
        clarificationQuestion: "What phone number should I use? Please include + and the country code.",
      },
    });
  });

  it("clarifies when no update field is present", () => {
    const result = validateAccountHolderUpdate(accountUpdate({}));

    expect(result).toMatchObject({
      status: "clarify",
      intent: { missingFields: ["accountDetail"] },
    });
  });

  it.each([
    ["invalid email", { email: "not-an-email" }],
    ["empty name", { firstName: "\n\u0000" }],
    ["overlong name", { firstName: "a".repeat(101) }],
    ["overlong address", { addressLine1: "a".repeat(201) }],
    ["unknown field", { nickname: "Jane" }],
  ])("fails closed for %s", (_name, fields) => {
    expect(validateAccountHolderUpdate(accountUpdate(
      fields as AccountUpdateIntent["fields"],
    )).status).toBe("clarify");
  });

  it("preserves queued intents while asking for corrected details", () => {
    const intent = accountUpdate({ phone: "invalid" });
    intent.additionalIntents = [{ action: "read_transactions", fields: {} }];

    const result = validateAccountHolderUpdate(intent);
    expect(result).toMatchObject({
      status: "clarify",
      intent: {
        additionalIntents: [{ action: "read_transactions", fields: {} }],
      },
    });
  });
});

describe("validatePreferredContactMethodUpdate", () => {
  it.each(["email", "sms", "phone"] as const)("accepts %s", (method) => {
    expect(validatePreferredContactMethodUpdate({ action: "update_preferred_contact_method", fields: { method }, additionalIntents: [], missingFields: [] }))
      .toEqual({ status: "ready", method });
  });

  it("clarifies an omitted method without trusting parser completeness", () => {
    expect(validatePreferredContactMethodUpdate({ action: "update_preferred_contact_method", fields: {}, additionalIntents: [], missingFields: [] }))
      .toMatchObject({ status: "clarify", intent: { action: "clarify", missingFields: ["method"] } });
  });
});
