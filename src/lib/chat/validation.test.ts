import { describe, expect, it } from "vitest";

import type { ParsedIntent } from "@/lib/llm/parser-schema";
import { sanitizeFreeText, validateAccountHolderUpdate, validateCallAppointmentCreate, validateMockPayment, validatePreferredContactMethodUpdate, validatePromiseToPayCreate, validateRelatedPersonCreate, validateRelatedPersonRemove, validateRelatedPersonUpdate } from "./validation";

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

  it.each([
    ["spaces", "+353 83 111 2233"],
    ["dashes", "+353-83-111-2233"],
    ["parentheses and spaces", "+353 (83) 111 2233"],
  ])("accepts a phone number that %s once formatting is removed", (_name, phone) => {
    expect(validateAccountHolderUpdate(accountUpdate({ phone })))
      .toMatchObject({ status: "ready", fields: { phone: "+353831112233" } });
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

describe("validateRelatedPersonCreate", () => {
  it("sanitizes required contact fields and defaults authorization to false", () => {
    expect(validateRelatedPersonCreate({ action: "add_related_person", fields: { name: " Mark O'Brien ", email: " mark@example.test ", phone: " +353831112233 ", relationship: " brother " }, additionalIntents: [], missingFields: [] }))
      .toEqual({ status: "ready", fields: { name: "Mark O'Brien", email: "mark@example.test", phone: "+353831112233", relationship: "brother", authorizedToAct: false } });
  });

  it("clarifies when a required contact detail is absent", () => {
    expect(validateRelatedPersonCreate({ action: "add_related_person", fields: { name: "Mark", phone: "+353831112233" }, additionalIntents: [], missingFields: [] }))
      .toMatchObject({ status: "clarify", intent: { missingFields: ["email"], clarificationQuestion: "To add someone, what is their email address?" } });
  });

  it("keeps only a relationship explicitly stated by the customer", () => {
    const intent: Extract<ParsedIntent, { action: "add_related_person" }> = { action: "add_related_person", fields: { name: "Mark Murphy", email: "mark@example.test", phone: "+353831112233", relationship: "undefined", authorizedToAct: true }, additionalIntents: [], missingFields: [] };

    expect(validateRelatedPersonCreate(intent, "Add Mark Murphy so he can act for me."))
      .toEqual({ status: "ready", fields: { name: "Mark Murphy", email: "mark@example.test", phone: "+353831112233", authorizedToAct: true } });
    expect(validateRelatedPersonCreate({ ...intent, fields: { ...intent.fields, relationship: "brother" } }, "Add my brother Mark Murphy, mark@example.test, +353831112233."))
      .toMatchObject({ status: "ready", fields: { relationship: "brother" } });
  });

  it("requires a complete relationship word while accepting punctuation in a stated label", () => {
    const intent = { action: "add_related_person", fields: { name: "Mark Murphy", email: "mark@example.test", phone: "+353831112233", relationship: "son" }, additionalIntents: [], missingFields: [] } as Extract<ParsedIntent, { action: "add_related_person" }>;

    expect(validateRelatedPersonCreate(intent, "Add a person called Mark Murphy, mark@example.test, +353831112233."))
      .toMatchObject({ status: "ready", fields: { relationship: undefined } });
    expect(validateRelatedPersonCreate({ ...intent, fields: { ...intent.fields, relationship: "mother-in-law" } }, "Please add my mother-in-law, Mark Murphy, mark@example.test, +353831112233."))
      .toMatchObject({ status: "ready", fields: { relationship: "mother-in-law" } });
  });
});

describe("validateRelatedPersonUpdate", () => {
  it("sanitizes a selector and changed field", () => {
    expect(validateRelatedPersonUpdate({ action: "update_related_person", fields: { selector: " Mark O'Brien ", phone: " +353831112233 " }, additionalIntents: [], missingFields: [] }))
      .toEqual({ status: "ready", selector: "Mark O'Brien", fields: { phone: "+353831112233" } });
  });

  it("clarifies when the selector or changed field is missing", () => {
    expect(validateRelatedPersonUpdate({ action: "update_related_person", fields: { selector: "Mark" }, additionalIntents: [], missingFields: [] }))
      .toMatchObject({ status: "clarify", intent: { missingFields: ["relatedPerson"] } });
    expect(validateRelatedPersonUpdate({ action: "update_related_person", fields: { phone: "+353831112233" }, additionalIntents: [], missingFields: [] }))
      .toMatchObject({ status: "clarify", intent: { missingFields: ["selector"] } });
  });
});

describe("validateRelatedPersonRemove", () => {
  it("sanitizes the required selector", () => {
    expect(validateRelatedPersonRemove({ action: "remove_related_person", fields: { selector: " John Murphy\n" }, additionalIntents: [], missingFields: [] }))
      .toEqual({ status: "ready", selector: "John Murphy" });
  });

  it("clarifies when the selector is absent", () => {
    expect(validateRelatedPersonRemove({ action: "remove_related_person", fields: {}, additionalIntents: [], missingFields: [] }))
      .toMatchObject({ status: "clarify", intent: { missingFields: ["selector"] } });
  });
});

describe("validatePromiseToPayCreate", () => {
  it("converts a matching-currency amount to cents and accepts an agreeing future date", () => {
    expect(validatePromiseToPayCreate({
      intent: { action: "create_promise_to_pay", fields: { amountRaw: "€250.50", dueDate: "2026-08-01" }, additionalIntents: [], missingFields: [] },
      accountCurrency: "EUR", nowIso: "2026-07-17T09:00:00.000Z", rawMessage: "I promise to pay €250.50 on August 1st",
    })).toEqual({ status: "ready", fields: { amountCents: 25050, currency: "EUR", dueDate: "2026-08-01" } });
  });

  it.each([
    ["foreign currency", "$250", "2026-08-01", "I promise to pay $250 on August 1st", "amountRaw"],
    ["past date", "€250", "2026-07-16", "I promise to pay €250 yesterday", "dueDate"],
  ])("clarifies %s without becoming write-ready", (_label, amountRaw, dueDate, rawMessage, missingField) => {
    expect(validatePromiseToPayCreate({
      intent: { action: "create_promise_to_pay", fields: { amountRaw, dueDate }, additionalIntents: [], missingFields: [] },
      accountCurrency: "EUR", nowIso: "2026-07-17T09:00:00.000Z", rawMessage,
    })).toMatchObject({ status: "clarify", intent: { missingFields: [missingField] } });
  });
});

describe("validateMockPayment", () => {
  it("normalizes a matching-currency payment into integer cents", () => {
    expect(validateMockPayment({ intent: { action: "mock_payment", fields: { amountRaw: "€150.50" }, additionalIntents: [], missingFields: [] }, accountCurrency: "EUR", balanceCents: 128500 }))
      .toEqual({ status: "ready", amountCents: 15050, currency: "EUR", exceedsBalance: false });
  });

  it.each([
    ["missing amount", undefined, 128500],
    ["foreign currency", "$150", 128500],
  ])("clarifies %s", (_label, amountRaw, balanceCents) => {
    expect(validateMockPayment({ intent: { action: "mock_payment", fields: { amountRaw }, additionalIntents: [], missingFields: [] }, accountCurrency: "EUR", balanceCents }))
      .toMatchObject({ status: "clarify", intent: { missingFields: ["amountRaw"] } });
  });

  it("flags an overpayment while keeping it eligible for an idempotent replay", () => {
    expect(validateMockPayment({ intent: { action: "mock_payment", fields: { amountRaw: "€1,286" }, additionalIntents: [], missingFields: [] }, accountCurrency: "EUR", balanceCents: 128500 }))
      .toEqual({ status: "ready", amountCents: 128600, currency: "EUR", exceedsBalance: true });
  });
});

describe("validateCallAppointmentCreate", () => {
  const intent = { action: "book_call_appointment", fields: { dateTime: "2026-07-21T10:00:00+01:00" }, additionalIntents: [], missingFields: [] } as Extract<ParsedIntent, { action: "book_call_appointment" }>;

  it("normalizes an agreeing future time and defaults to the account phone", () => {
    expect(validateCallAppointmentCreate({ intent, accountPhone: "+353831234567", nowIso: "2026-07-16T15:00:00Z", rawMessage: "Book a call next Tuesday at 10am" }))
      .toEqual({ status: "ready", fields: { scheduledAt: "2026-07-21T09:00:00.000Z", phone: "+353831234567" } });
  });

  it("sanitizes a supplied phone and reason", () => {
    expect(validateCallAppointmentCreate({ intent: { ...intent, fields: { ...intent.fields, phone: " +353831112233 ", reason: " about Discuss my account\n " } },
      accountPhone: "+353831234567", nowIso: "2026-07-16T15:00:00Z", rawMessage: "Book a call next Tuesday at 10am" }))
      .toMatchObject({ status: "ready", fields: { phone: "+353831112233", reason: "Discuss my account" } });
  });

  it("does not remove a non-conversational use of the word about from the call reason", () => {
    expect(validateCallAppointmentCreate({ intent: { ...intent, fields: { ...intent.fields, reason: "aboutabout payment" } },
      accountPhone: "+353831234567", nowIso: "2026-07-16T15:00:00Z", rawMessage: "Book a call next Tuesday at 10am" }))
      .toMatchObject({ status: "ready", fields: { reason: "aboutabout payment" } });
  });

  it.each([
    ["missing time", { ...intent, fields: {} }, "Book a call", "dateTime"],
    ["past time", { ...intent, fields: { dateTime: "2026-07-15T10:00:00+01:00" } }, "Book a call yesterday at 10am", "dateTime"],
    ["invalid phone", { ...intent, fields: { ...intent.fields, phone: "083 111 2233" } }, "Book a call next Tuesday at 10am", "phone"],
  ])("clarifies %s before writing", (_label, invalidIntent, rawMessage, missingField) => {
    expect(validateCallAppointmentCreate({ intent: invalidIntent as typeof intent, accountPhone: "+353831234567",
      nowIso: "2026-07-16T15:00:00Z", rawMessage })).toMatchObject({ status: "clarify", intent: { missingFields: [missingField] } });
  });
});
