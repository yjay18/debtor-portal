import { describe, expect, it } from "vitest";

import {
  actionIntentSchema,
  parseProviderIntent,
  parsedIntentJsonSchema,
  parsedIntentSchema,
} from "./parser-schema";

describe("parsedIntentSchema", () => {
  it.each([
    ["read_account", { topic: "balance" }],
    ["update_account_holder", { firstName: "Áine", phone: "+353831112233" }],
    ["read_preferred_contact_method", {}],
    ["update_preferred_contact_method", { method: "sms" }],
    ["add_related_person", { name: "John O'Brien", authorizedToAct: false }],
    ["update_related_person", { selector: "John", email: "john@example.test" }],
    ["remove_related_person", { selector: "John" }],
    ["read_related_people", {}],
    ["create_promise_to_pay", { amountRaw: "€50.00", dueDate: "2026-08-01" }],
    ["read_promises_to_pay", {}],
    ["mock_payment", { amountRaw: "50 euro" }],
    ["read_transactions", {}],
    ["book_call_appointment", { dateTime: "2026-08-01T10:00:00+01:00" }],
    ["read_call_appointments", {}],
    ["clarify", {}],
    ["unsupported", {}],
  ])("accepts the %s action and its own fields", (action, fields) => {
    const value = { action, fields, ...(action === "clarify"
      ? { clarificationQuestion: "What information should I update?" }
      : {}) };

    expect(parsedIntentSchema.parse(value)).toMatchObject({ action, fields });
  });

  it("defaults optional intent lists", () => {
    expect(parsedIntentSchema.parse({ action: "read_account", fields: {} }))
      .toEqual({
        action: "read_account",
        fields: {},
        additionalIntents: [],
        missingFields: [],
      });
  });

  it("accepts typed additional intents and missing fields", () => {
    const result = parsedIntentSchema.parse({
      action: "update_account_holder",
      fields: { email: "jane@example.test" },
      additionalIntents: [{ action: "mock_payment", fields: { amountRaw: "50 euro" } }],
      missingFields: ["phone"],
    });

    expect(result.additionalIntents[0].action).toBe("mock_payment");
    expect(result.missingFields).toEqual(["phone"]);
  });

  it.each([
    ["unknown action", { action: "delete_account", fields: {} }],
    ["wrong action fields", { action: "read_transactions", fields: { phone: "123" } }],
    ["invalid contact method", { action: "update_preferred_contact_method", fields: { method: "letter" } }],
    ["extra top-level key", { action: "read_account", fields: {}, execute: true }],
    ["clarify without a question", { action: "clarify", fields: {} }],
    ["invalid additional intent", {
      action: "read_account",
      fields: {},
      additionalIntents: [{ action: "mock_payment", fields: { amountRaw: 50 } }],
    }],
  ])("rejects %s", (_name, value) => {
    expect(() => parsedIntentSchema.parse(value)).toThrow();
  });

  it("keeps payment amounts as stated text", () => {
    const result = parsedIntentSchema.parse({
      action: "mock_payment",
      fields: { amountRaw: "€1,234.56" },
    });

    expect(result.fields).toEqual({ amountRaw: "€1,234.56" });
  });

  it("builds a strict provider schema without a root union", () => {
    expect(parsedIntentJsonSchema).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: [
        "action", "fields", "additionalIntents",
        "missingFields", "clarificationQuestion",
      ],
    });
    expect(parsedIntentJsonSchema).not.toHaveProperty("anyOf");
  });

  it("lists all actions in the provider schema", () => {
    const properties = parsedIntentJsonSchema.properties as Record<string, JsonSchema>;
    const localActions = actionIntentSchema.options.map((option) => option.shape.action.value);
    expect(properties.action.enum).toEqual(localActions);
    expect(properties.action.enum).not.toContain("delete_account");
  });

  it("makes every provider object strict with all properties required", () => {
    function inspect(schema: unknown): void {
      if (!schema || typeof schema !== "object") return;
      const value = schema as Record<string, unknown>;
      if (value.type === "object") {
        expect(value.additionalProperties).toBe(false);
        expect(value.required).toEqual(Object.keys(value.properties as object));
      }
      Object.values(value).forEach(inspect);
    }

    inspect(parsedIntentJsonSchema);
  });

  it("normalizes provider nulls before local Zod validation", () => {
    expect(parseProviderIntent({
      action: "update_account_holder",
      fields: { firstName: null, phone: "+353831112233" },
      additionalIntents: [{
        action: "mock_payment",
        fields: { amountRaw: "50 euro" },
      }],
      missingFields: [],
      clarificationQuestion: null,
    })).toEqual({
      action: "update_account_holder",
      fields: { phone: "+353831112233" },
      additionalIntents: [{ action: "mock_payment", fields: { amountRaw: "50 euro" } }],
      missingFields: [],
    });
  });

  it("still rejects action and field mismatches after provider enforcement", () => {
    expect(() => parseProviderIntent({
      action: "read_transactions",
      fields: { phone: "+353831112233" },
      additionalIntents: [],
      missingFields: [],
      clarificationQuestion: null,
    })).toThrow();
  });
});

type JsonSchema = Record<string, unknown>;
