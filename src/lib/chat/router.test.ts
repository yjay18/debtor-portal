import { describe, expect, it, vi } from "vitest";

import standardFixture from "../../../fixtures/debtor-standard.json";
import { normalizeLegacyFixture, type AccountContext } from "@/lib/account/types";
import type { ParsedIntent } from "@/lib/llm/parser-schema";
import {
  futureScheduledCalls,
  isReadIntent,
  routeAccountHolderUpdate,
  routePreferredContactMethodUpdate,
  routeRelatedPersonCreate,
  routeRelatedPersonRemovalConfirmed,
  routeRelatedPersonRemovalRequest,
  routeRelatedPersonUpdate,
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

describe("routeAccountHolderUpdate", () => {
  it("validates, writes, and returns the persisted account holder", async () => {
    const updated = { ...account.account, phone: "+353831112233" };
    const updateAccountHolder = vi.fn().mockResolvedValue(updated);
    const intent: Extract<ParsedIntent, { action: "update_account_holder" }> = { action: "update_account_holder", fields: { phone: "\n+353831112233 " }, additionalIntents: [], missingFields: [] };
    const result = await routeAccountHolderUpdate({ accountId: "acc_standard_001", account, intent, repo: { updateAccountHolder } });

    expect(updateAccountHolder).toHaveBeenCalledWith("acc_standard_001", { phone: "+353831112233" });
    expect(result).toMatchObject({ success: true, account: { account: updated }, notificationQueued: true,
      changeSummary: [{ kind: "updated", entity: "account_holder", fields: [{ field: "Phone", before: account.account.phone, after: updated.phone }] }] });
  });

  it("skips the write and notification for an unchanged value", async () => {
    const updateAccountHolder = vi.fn();
    const intent = { action: "update_account_holder", fields: { phone: account.account.phone }, additionalIntents: [], missingFields: [] } as Extract<ParsedIntent, { action: "update_account_holder" }>;
    const result = await routeAccountHolderUpdate({ accountId: "acc_standard_001", account, intent, repo: { updateAccountHolder } });

    expect(result).toMatchObject({ success: true, changeSummary: [] });
    expect(result).not.toHaveProperty("notificationQueued");
    expect(updateAccountHolder).not.toHaveBeenCalled();
  });

  it("clarifies invalid fields without writing", async () => {
    const updateAccountHolder = vi.fn();
    const intent: Extract<ParsedIntent, { action: "update_account_holder" }> = { action: "update_account_holder", fields: { phone: "invalid" }, additionalIntents: [], missingFields: [] };
    const result = await routeAccountHolderUpdate({ accountId: "unused", account, intent, repo: { updateAccountHolder } });

    expect(result).toMatchObject({ action: "clarify", success: false, missingFields: ["phone"] });
    expect(updateAccountHolder).not.toHaveBeenCalled();
  });
});

describe("routePreferredContactMethodUpdate", () => {
  it("writes a changed method and returns notification evidence", async () => {
    const updated = { ...account.account, preferredContactMethod: "sms" as const };
    const updateAccountHolder = vi.fn().mockResolvedValue(updated);
    const intent: Extract<ParsedIntent, { action: "update_preferred_contact_method" }> = { action: "update_preferred_contact_method", fields: { method: "sms" }, additionalIntents: [], missingFields: [] };
    const result = await routePreferredContactMethodUpdate({ accountId: "acc_standard_001", account, intent, repo: { updateAccountHolder } });

    expect(updateAccountHolder).toHaveBeenCalledWith("acc_standard_001", { preferredContactMethod: "sms" });
    expect(result).toMatchObject({ action: "update_preferred_contact_method", success: true, notificationQueued: true,
      changeSummary: [{ fields: [{ field: "Preferred contact method", before: account.account.preferredContactMethod, after: "sms" }] }] });
  });

  it("skips a no-op method without queuing a notification", async () => {
    const updateAccountHolder = vi.fn();
    const intent = { action: "update_preferred_contact_method", fields: { method: account.account.preferredContactMethod }, additionalIntents: [], missingFields: [] } as Extract<ParsedIntent, { action: "update_preferred_contact_method" }>;
    const result = await routePreferredContactMethodUpdate({ accountId: "acc_standard_001", account, intent, repo: { updateAccountHolder } });

    expect(result).toMatchObject({ success: true, changeSummary: [] });
    expect(updateAccountHolder).not.toHaveBeenCalled();
  });
});

describe("routeRelatedPersonCreate", () => {
  it("creates a validated related person and returns immediate account state", async () => {
    const created = { id: "person-002", name: "Mark Murphy", email: "mark@example.test", phone: "+353831112233", authorizedToAct: true };
    const addRelatedPerson = vi.fn().mockResolvedValue(created);
    const intent: Extract<ParsedIntent, { action: "add_related_person" }> = { action: "add_related_person", fields: { name: "Mark Murphy", email: "mark@example.test", phone: "+353831112233", authorizedToAct: true }, additionalIntents: [], missingFields: [] };
    const result = await routeRelatedPersonCreate({ accountId: "acc_standard_001", account, intent, repo: { addRelatedPerson } });

    expect(addRelatedPerson).toHaveBeenCalledWith("acc_standard_001", { ...intent.fields, authorizedToAct: true });
    expect(result).toMatchObject({ action: "add_related_person", success: true, notificationQueued: true, account: { relatedPeople: [...account.relatedPeople, created] }, changeSummary: [{ kind: "created", entity: "related_person" }] });
  });

  it("clarifies missing contact details without inserting", async () => {
    const addRelatedPerson = vi.fn();
    const intent = { action: "add_related_person", fields: { name: "Mark" }, additionalIntents: [], missingFields: [] } as Extract<ParsedIntent, { action: "add_related_person" }>;
    const result = await routeRelatedPersonCreate({ accountId: "acc_standard_001", account, intent, repo: { addRelatedPerson } });

    expect(result).toMatchObject({ action: "clarify", success: false, missingFields: expect.arrayContaining(["email", "phone"]) });
    expect(addRelatedPerson).not.toHaveBeenCalled();
  });
});

describe("routeRelatedPersonUpdate", () => {
  it("updates one resolved person and returns the refreshed account state", async () => {
    const updated = { ...account.relatedPeople[0], phone: "+353831112233" };
    const updateRelatedPerson = vi.fn().mockResolvedValue(updated);
    const intent = { action: "update_related_person", fields: { selector: "John", phone: updated.phone }, additionalIntents: [], missingFields: [] } as Extract<ParsedIntent, { action: "update_related_person" }>;
    const result = await routeRelatedPersonUpdate({ accountId: "acc_standard_001", account, intent, repo: { updateRelatedPerson } });

    expect(updateRelatedPerson).toHaveBeenCalledWith("acc_standard_001", account.relatedPeople[0].id, { phone: updated.phone });
    expect(result).toMatchObject({ action: "update_related_person", success: true, notificationQueued: true,
      account: { relatedPeople: [updated] }, relatedPeople: [updated],
      changeSummary: [{ kind: "updated", entity: "related_person", fields: [{ field: "Phone", before: account.relatedPeople[0].phone, after: updated.phone }] }] });
  });

  it("does not write when the resolved value is unchanged", async () => {
    const updateRelatedPerson = vi.fn();
    const intent = { action: "update_related_person", fields: { selector: "John", phone: account.relatedPeople[0].phone }, additionalIntents: [], missingFields: [] } as Extract<ParsedIntent, { action: "update_related_person" }>;
    const result = await routeRelatedPersonUpdate({ accountId: "acc_standard_001", account, intent, repo: { updateRelatedPerson } });

    expect(result).toMatchObject({ action: "update_related_person", success: true, changeSummary: [] });
    expect(updateRelatedPerson).not.toHaveBeenCalled();
  });

  it("clarifies an ambiguous selector before writing", async () => {
    const updateRelatedPerson = vi.fn();
    const ambiguousAccount = { ...account, relatedPeople: [...account.relatedPeople, { ...account.relatedPeople[0], id: "person-duplicate", name: "John Moran" }] };
    const intent = { action: "update_related_person", fields: { selector: "John", phone: "+353831112233" }, additionalIntents: [], missingFields: [] } as Extract<ParsedIntent, { action: "update_related_person" }>;
    const result = await routeRelatedPersonUpdate({ accountId: "acc_standard_001", account: ambiguousAccount, intent, repo: { updateRelatedPerson } });

    expect(result).toMatchObject({ action: "clarify", success: false, missingFields: ["selector"] });
    expect(updateRelatedPerson).not.toHaveBeenCalled();
  });
});

describe("related-person removal", () => {
  it("requests explicit confirmation without deleting", async () => {
    const intent = { action: "remove_related_person", fields: { selector: "John" }, additionalIntents: [], missingFields: [] } as Extract<ParsedIntent, { action: "remove_related_person" }>;
    const result = await routeRelatedPersonRemovalRequest({ account, intent });

    expect(result).toMatchObject({ action: "remove_related_person", success: false, relatedPeople: [account.relatedPeople[0]] });
    expect(result.reply).toContain("Reply yes");
  });

  it("deletes only after confirmation and returns the refreshed account", async () => {
    const deleteRelatedPerson = vi.fn().mockResolvedValue(account.relatedPeople[0]);
    const result = await routeRelatedPersonRemovalConfirmed({ accountId: "acc_standard_001", account, personId: account.relatedPeople[0].id, repo: { deleteRelatedPerson } });

    expect(deleteRelatedPerson).toHaveBeenCalledWith("acc_standard_001", account.relatedPeople[0].id);
    expect(result).toMatchObject({ action: "remove_related_person", success: true, notificationQueued: true,
      account: { relatedPeople: [] }, changeSummary: [{ kind: "removed", entity: "related_person" }] });
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
