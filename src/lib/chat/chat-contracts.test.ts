import { describe, expect, it, vi } from "vitest";

import standardFixture from "../../../fixtures/debtor-standard.json";
import { normalizeLegacyFixture } from "@/lib/account/types";
import { executeReadChatTurn } from "@/app/api/chat/route";
import { routeAccountHolderUpdate, routeCallAppointmentCreate, routeMockPayment, routePromiseToPayCreate, routeRelatedPersonCreate } from "./router";
import type { ParsedIntent } from "@/lib/llm/parser-schema";

const account = normalizeLegacyFixture(standardFixture);
const accountId = account.account.accountId;
const nowIso = "2026-07-17T09:00:00Z";

describe("chat action acceptance contracts", () => {
  it("updates the account holder phone number and queues a redacted notification", async () => {
    const phone = "+353831112233";
    const result = await routeAccountHolderUpdate({ accountId, account,
      intent: { action: "update_account_holder", fields: { phone } } as Extract<ParsedIntent, { action: "update_account_holder" }>,
      repo: { updateAccountHolder: vi.fn().mockResolvedValue({ ...account.account, phone }) } });

    expect(result).toMatchObject({ success: true, notificationQueued: true,
      account: { account: { phone } }, changeSummary: [{ kind: "updated" }] });
    expect(result.reply).not.toContain(account.account.reference);
  });

  it("adds an authorized related person with name, email, and phone", async () => {
    const person = { id: "person-002", name: "Mark Murphy", email: "mark@example.test",
      phone: "+353831998877", relationship: "brother", authorizedToAct: true };
    const result = await routeRelatedPersonCreate({ accountId, account,
      intent: { action: "add_related_person", fields: { name: person.name, email: person.email,
        phone: person.phone, relationship: person.relationship, authorizedToAct: true } } as Extract<ParsedIntent, { action: "add_related_person" }>,
      repo: { addRelatedPerson: vi.fn().mockResolvedValue(person) } });

    expect(result).toMatchObject({ success: true, notificationQueued: true,
      relatedPeople: [person], changeSummary: [{ kind: "created", entity: "related_person" }] });
  });

  it("completes a pending action from details supplied in a follow-up turn", async () => {
    const person = { id: "person-002", name: "Mark Murphy", email: "mark@example.test",
      phone: "+353831998877", relationship: "brother", authorizedToAct: true };
    const conversation = { id: "11111111-1111-4111-8111-111111111111",
      accountHolderId: "22222222-2222-4222-8222-222222222222", createdAt: nowIso, updatedAt: nowIso,
      dialogState: { queuedIntents: [], pendingAction: { action: "add_related_person" as const,
        fields: { relationship: "brother", authorizedToAct: true }, missing: ["name", "email", "phone"] } } };
    const addRelatedPerson = vi.fn().mockResolvedValue(person);
    const result = await executeReadChatTurn({ accountId, message: "Mark Murphy, mark@example.test, +353831998877",
      idempotencyKey: "00000000-0000-4000-8000-000000000004" }, {
      conversations: { loadOrCreate: vi.fn().mockResolvedValue(conversation), loadMessages: vi.fn().mockResolvedValue([]),
        addMessage: vi.fn().mockResolvedValueOnce({}).mockResolvedValueOnce({ id: "message-2", content: "Added", createdAt: nowIso }), updateDialogState: vi.fn() },
      repo: { getAccountContextByAccountId: vi.fn().mockResolvedValue(account), updateAccountHolder: vi.fn(),
        addRelatedPerson, updateRelatedPerson: vi.fn(), deleteRelatedPerson: vi.fn(), addPromiseToPay: vi.fn(),
        recordPayment: vi.fn(), addCallAppointment: vi.fn() }, now: () => nowIso,
      parse: vi.fn().mockResolvedValue({ action: "add_related_person", fields: { name: person.name, email: person.email, phone: person.phone }, additionalIntents: [], missingFields: [] }),
      processNotifications: vi.fn().mockResolvedValue({ status: "logged", attemptCount: 1 }),
    });

    expect(addRelatedPerson).toHaveBeenCalledWith(accountId, expect.objectContaining({ relationship: "brother", authorizedToAct: true }));
    expect(result.result).toMatchObject({ success: true, action: "add_related_person" });
  });

  it("records a one-time promise to pay with amount and future due date", async () => {
    const promise = { id: "promise-002", amountCents: 50000, currency: "EUR", dueDate: "2026-08-01",
      status: "active" as const, createdAt: nowIso };
    const result = await routePromiseToPayCreate({ accountId, account, nowIso, rawMessage: "Can I pay 500 euro on the 1st of next month?",
      intent: { action: "create_promise_to_pay", fields: { amountRaw: "500 euro", dueDate: "2026-08-01" } } as Extract<ParsedIntent, { action: "create_promise_to_pay" }>,
      repo: { addPromiseToPay: vi.fn().mockResolvedValue(promise) } });

    expect(result).toMatchObject({ success: true, notificationQueued: true, promisesToPay: [promise] });
  });

  it("records a mocked payment transaction and deducts it from balance", async () => {
    const transaction = { id: "transaction-003", type: "payment" as const, status: "completed" as const,
      amountCents: 15000, currency: "EUR", description: "Saved details", transactionDate: "2026-07-17" };
    const result = await routeMockPayment({ accountId, account,
      intent: { action: "mock_payment", fields: { amountRaw: "150 euro" } } as Extract<ParsedIntent, { action: "mock_payment" }>,
      idempotencyKey: "00000000-0000-4000-8000-000000000004",
      repo: { recordPayment: vi.fn().mockResolvedValue({ transaction, newBalanceCents: 113500, replayed: false }) } });

    expect(result).toMatchObject({ success: true, account: { account: { balanceCents: 113500 } },
      transaction, changeSummary: [{ entity: "account_holder" }, { entity: "transaction" }] });
  });

  it("books a future call appointment and rejects dates in the past", async () => {
    const call = { id: "call-002", scheduledAt: "2026-08-01T09:00:00.000Z", phone: account.account.phone,
      reason: "Discuss bill", status: "scheduled" as const };
    const repo = { addCallAppointment: vi.fn().mockResolvedValue(call) };
    const future = await routeCallAppointmentCreate({ accountId, account, nowIso, rawMessage: "August 1st at 10am",
      intent: { action: "book_call_appointment", fields: { dateTime: "2026-08-01T10:00:00+01:00" } } as Extract<ParsedIntent, { action: "book_call_appointment" }>, repo });
    const past = await routeCallAppointmentCreate({ accountId, account, nowIso, rawMessage: "yesterday",
      intent: { action: "book_call_appointment", fields: { dateTime: "2026-07-16T10:00:00+01:00" } } as Extract<ParsedIntent, { action: "book_call_appointment" }>, repo });

    expect(future).toMatchObject({ success: true, notificationQueued: true, callAppointments: [call] });
    expect(past).toMatchObject({ action: "clarify", success: false, missingFields: ["dateTime"] });
    expect(repo.addCallAppointment).toHaveBeenCalledOnce();
  });
});

describe("confirmed multi-intent queue", () => {
  const baseConversation = { id: "11111111-1111-4111-8111-111111111111",
    accountHolderId: "22222222-2222-4222-8222-222222222222", createdAt: nowIso, updatedAt: nowIso };
  const repo = { getAccountContextByAccountId: vi.fn().mockResolvedValue(account), updateAccountHolder: vi.fn(),
    addRelatedPerson: vi.fn(), updateRelatedPerson: vi.fn(), deleteRelatedPerson: vi.fn(), addPromiseToPay: vi.fn(),
    recordPayment: vi.fn(), addCallAppointment: vi.fn() };

  it("executes one action and waits for yes before the next", async () => {
    const updateDialogState = vi.fn();
    const conversation = { ...baseConversation, dialogState: { queuedIntents: [] } };
    const first = await executeReadChatTurn({ accountId, message: "Show my account and transactions",
      idempotencyKey: "00000000-0000-4000-8000-000000000004" }, {
      conversations: { loadOrCreate: vi.fn().mockResolvedValue(conversation), loadMessages: vi.fn().mockResolvedValue([]),
        addMessage: vi.fn().mockResolvedValueOnce({}).mockResolvedValueOnce({ id: "message-2", content: "Account", createdAt: nowIso }), updateDialogState },
      repo, now: () => nowIso, processNotifications: vi.fn(),
      parse: vi.fn().mockResolvedValue({ action: "read_account", fields: {},
        additionalIntents: [{ action: "read_transactions", fields: {} }], missingFields: [] }),
    });

    expect(first.result.reply).toContain("request to view transactions");
    expect(updateDialogState).toHaveBeenCalledWith(conversation, { queuedIntents: [],
      awaitingConfirmation: { kind: "next_intent", intent: { action: "read_transactions", fields: {} } } });

    const parse = vi.fn();
    const confirmedConversation = { ...baseConversation, dialogState: { queuedIntents: [],
      awaitingConfirmation: { kind: "next_intent" as const, intent: { action: "read_transactions" as const, fields: {} } } } };
    const confirmed = await executeReadChatTurn({ accountId, message: "yes",
      idempotencyKey: "00000000-0000-4000-8000-000000000005" }, {
      conversations: { loadOrCreate: vi.fn().mockResolvedValue(confirmedConversation), loadMessages: vi.fn().mockResolvedValue([]),
        addMessage: vi.fn().mockResolvedValueOnce({}).mockResolvedValueOnce({ id: "message-4", content: "Transactions", createdAt: nowIso }), updateDialogState: vi.fn() },
      repo, now: () => nowIso, processNotifications: vi.fn(), parse,
    });

    expect(parse).not.toHaveBeenCalled();
    expect(confirmed.result).toMatchObject({ action: "read_transactions", success: true });
  });

  it("drops the queued action when the customer says no", async () => {
    const updateDialogState = vi.fn();
    const conversation = { ...baseConversation, dialogState: { queuedIntents: [],
      awaitingConfirmation: { kind: "next_intent" as const, intent: { action: "read_transactions" as const, fields: {} } } } };
    const result = await executeReadChatTurn({ accountId, message: "no",
      idempotencyKey: "00000000-0000-4000-8000-000000000006" }, {
      conversations: { loadOrCreate: vi.fn().mockResolvedValue(conversation), loadMessages: vi.fn().mockResolvedValue([]),
        addMessage: vi.fn().mockResolvedValueOnce({}).mockResolvedValueOnce({ id: "message-2", content: "Skipped", createdAt: nowIso }), updateDialogState },
      repo, now: () => nowIso, processNotifications: vi.fn(), parse: vi.fn(),
    });

    expect(result.result.reply).toBe("Your queued request to view transactions was skipped.");
    expect(updateDialogState).toHaveBeenCalledWith(conversation, { queuedIntents: [] });
  });

  it("keeps a queued request pending when the customer asks for something else", async () => {
    const updateDialogState = vi.fn();
    const conversation = { ...baseConversation, dialogState: { queuedIntents: [], awaitingConfirmation: {
      kind: "next_intent" as const, intent: { action: "read_transactions" as const, fields: {} },
    } } };
    const parse = vi.fn();
    const result = await executeReadChatTurn({ accountId, message: "What is my preferred contact method?", idempotencyKey: "00000000-0000-4000-8000-000000000008" }, {
      conversations: { loadOrCreate: vi.fn().mockResolvedValue(conversation), loadMessages: vi.fn().mockResolvedValue([]),
        addMessage: vi.fn().mockResolvedValueOnce({}).mockResolvedValueOnce({ id: "message-2", content: "Clarify", createdAt: nowIso }), updateDialogState },
      repo, now: () => nowIso, processNotifications: vi.fn(), parse,
    });

    expect(parse).not.toHaveBeenCalled();
    expect(result.result.reply).toBe("Sorry, I can't do that while your queued request to view transactions is waiting. Reply yes to continue or no to skip it. I can help with account details, contact preferences, related people, promises, transactions, payments, and call appointments.");
    expect(updateDialogState).not.toHaveBeenCalled();
  });

  it("uses the original request to validate a confirmed queued promise", async () => {
    const promise = { id: "promise-002", amountCents: 50000, currency: "EUR", dueDate: "2026-08-01", status: "active" as const, createdAt: nowIso };
    const addPromiseToPay = vi.fn().mockResolvedValue(promise);
    const conversation = { ...baseConversation, dialogState: { queuedIntents: [], awaitingConfirmation: {
      kind: "next_intent" as const, intent: { action: "create_promise_to_pay" as const, fields: { amountRaw: "500 euro", dueDate: "2026-08-01" } },
    } } };
    const result = await executeReadChatTurn({ accountId, message: "yes", idempotencyKey: "00000000-0000-4000-8000-000000000007" }, {
      conversations: { loadOrCreate: vi.fn().mockResolvedValue(conversation), loadMessages: vi.fn().mockResolvedValue([
        { role: "account_holder" as const, content: "Show my account and promise to pay 500 euro on August 1st" },
        { role: "assistant" as const, content: "Reply yes to continue" },
      ]), addMessage: vi.fn().mockResolvedValueOnce({}).mockResolvedValueOnce({ id: "message-2", content: "Promise", createdAt: nowIso }), updateDialogState: vi.fn() },
      repo: { ...repo, addPromiseToPay }, now: () => nowIso, processNotifications: vi.fn().mockResolvedValue({ status: "logged", attemptCount: 1 }), parse: vi.fn(),
    });

    expect(addPromiseToPay).toHaveBeenCalledWith(accountId, { amountCents: 50000, currency: "EUR", dueDate: "2026-08-01" });
    expect(result.result).toMatchObject({ action: "create_promise_to_pay", success: true });
  });
});
