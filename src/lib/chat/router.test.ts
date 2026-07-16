import { describe, expect, it, vi } from "vitest";

import standardFixture from "../../../fixtures/debtor-standard.json";
import { normalizeLegacyFixture, type AccountContext } from "@/lib/account/types";
import type { ParsedIntent } from "@/lib/llm/parser-schema";
import {
  futureScheduledCalls,
  isReadIntent,
  routeReadAction,
  type ReadAction,
  type ReadIntent,
} from "./router";

const baseAccount = normalizeLegacyFixture(standardFixture);
const account: AccountContext = {
  ...baseAccount,
  callAppointments: [
    ...baseAccount.callAppointments,
    {
      id: "future-late",
      scheduledAt: "2026-07-22T14:00:00+01:00",
      phone: "+353831234567",
      status: "scheduled",
    },
    {
      id: "future-early",
      scheduledAt: "2026-07-20T10:00:00+01:00",
      phone: "+353831234567",
      status: "scheduled",
    },
    {
      id: "future-completed",
      scheduledAt: "2026-07-19T10:00:00+01:00",
      phone: "+353831234567",
      status: "completed",
    },
  ],
};
const nowIso = "2026-07-16T16:00:00+01:00";

function readIntent(action: ReadAction): ReadIntent {
  return {
    action,
    fields: {},
    additionalIntents: [],
    missingFields: [],
  } as ReadIntent;
}

function createRepo(value: AccountContext | null = account) {
  return { getAccountContextByAccountId: vi.fn().mockResolvedValue(value) };
}

describe("isReadIntent", () => {
  it.each([
    "read_account", "read_preferred_contact_method", "read_related_people",
    "read_promises_to_pay", "read_transactions", "read_call_appointments",
    "clarify", "unsupported",
  ] as const)("accepts %s", (action) => {
    expect(isReadIntent({ action } as ParsedIntent)).toBe(true);
  });

  it.each([
    "update_account_holder", "update_preferred_contact_method", "add_related_person",
    "update_related_person", "remove_related_person", "create_promise_to_pay",
    "mock_payment", "book_call_appointment",
  ] as const)("rejects the mutation action %s", (action) => {
    expect(isReadIntent({ action } as ParsedIntent)).toBe(false);
  });
});

describe("futureScheduledCalls", () => {
  it("keeps only future scheduled calls and sorts them soonest first", () => {
    expect(futureScheduledCalls(account.callAppointments, nowIso).map((call) => call.id))
      .toEqual(["future-early", "future-late"]);
  });

  it("rejects an invalid current time", () => {
    expect(() => futureScheduledCalls(account.callAppointments, "not-a-date"))
      .toThrow("Invalid current time.");
  });

  it("rejects an invalid stored appointment time", () => {
    expect(() => futureScheduledCalls([
      { ...account.callAppointments[0], scheduledAt: "not-a-date" },
    ], nowIso)).toThrow("Invalid call appointment time.");
  });
});

describe("routeReadAction", () => {
  it("returns the complete account context", async () => {
    const result = await routeReadAction({
      accountId: "acc_standard_001", intent: readIntent("read_account"), repo: createRepo(), nowIso,
    });

    expect(result).toMatchObject({ action: "read_account", success: true, account });
  });

  it("returns the persisted preferred contact method", async () => {
    const result = await routeReadAction({
      accountId: "acc_standard_001",
      intent: readIntent("read_preferred_contact_method"),
      repo: createRepo(),
      nowIso,
    });

    expect(result).toMatchObject({
      action: "read_preferred_contact_method",
      success: true,
      reply: "Your preferred contact method is email.",
      account,
    });
  });

  it.each([
    ["read_related_people", "relatedPeople", account.relatedPeople, "I found 1 related person on your account."],
    ["read_promises_to_pay", "promisesToPay", account.promisesToPay, "I found 1 promise to pay."],
    ["read_transactions", "transactions", account.transactions, "I found 2 transactions."],
  ] as const)("returns persisted lists for %s", async (action, key, expected, reply) => {
    const result = await routeReadAction({
      accountId: "acc_standard_001", intent: readIntent(action), repo: createRepo(), nowIso,
    });

    expect(result).toMatchObject({ action, success: true, reply, [key]: expected });
  });

  it("returns only future scheduled call appointments", async () => {
    const result = await routeReadAction({
      accountId: "acc_standard_001",
      intent: readIntent("read_call_appointments"),
      repo: createRepo(),
      nowIso,
    });

    expect(result.callAppointments?.map((call) => call.id))
      .toEqual(["future-early", "future-late"]);
  });

  it("returns a typed clarification without loading the account", async () => {
    const repo = createRepo();
    const intent: Extract<ParsedIntent, { action: "clarify" }> = {
      action: "clarify",
      fields: {},
      additionalIntents: [],
      missingFields: ["phone"],
      clarificationQuestion: "Which phone number should I use?",
    };
    const result = await routeReadAction({ accountId: "unused", intent, repo, nowIso });

    expect(result).toEqual({
      action: "clarify",
      success: false,
      reply: "Which phone number should I use?",
      missingFields: ["phone"],
    });
    expect(repo.getAccountContextByAccountId).not.toHaveBeenCalled();
  });

  it("returns supported capabilities without loading the account", async () => {
    const repo = createRepo();
    const intent: Extract<ParsedIntent, { action: "unsupported" }> = {
      action: "unsupported", fields: {}, additionalIntents: [], missingFields: [],
    };
    const result = await routeReadAction({ accountId: "unused", intent, repo, nowIso });

    expect(result).toMatchObject({ action: "unsupported", success: false });
    expect(result.reply).toContain("account details");
    expect(repo.getAccountContextByAccountId).not.toHaveBeenCalled();
  });

  it("fails safely when the account does not exist", async () => {
    const repo = createRepo(null);
    const result = await routeReadAction({
      accountId: "missing", intent: readIntent("read_account"), repo, nowIso,
    });

    expect(result).toEqual({
      action: "read_account",
      success: false,
      reply: "I couldn't find that account.",
    });
  });
});
