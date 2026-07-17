import { describe, expect, it, vi } from "vitest";

import standardFixture from "../../../../fixtures/debtor-standard.json";
import { normalizeLegacyFixture } from "@/lib/account/types";
import type { ChatActionResult, ChatResponse } from "@/lib/chat/types";
import type { ParsedIntent } from "@/lib/llm/parser-schema";
import { buildParserInput, executeReadChatTurn, loadReadTurnContext, parseChatRequest, persistAssistantResult, POST, respondToReadChatTurn, routeLoadedIntent, routeLoadedReadIntent } from "./route";

const validRequest = { accountId: "acc_standard_001", message: "Show my account", idempotencyKey: "00000000-0000-4000-8000-000000000004" };

describe("buildParserInput", () => {
  it("builds the minimum parser context from persisted state", () => {
    const account = normalizeLegacyFixture(standardFixture);
    const dialogState = { queuedIntents: [] };
    const input = buildParserInput({
      account, conversation: { dialogState }, message: "What is my balance?",
      history: [{ role: "account_holder", content: "Hello" }], nowIso: "2026-07-16T17:00:00+01:00",
    });

    expect(input.history).toEqual([{ role: "account_holder", content: "Hello" }]);
    expect(input.dialogState).toBe(dialogState);
    expect(input.account).toEqual({ holderName: "Jane Murphy", email: account.account.email, phone: account.account.phone, currency: "EUR", relatedPeopleCount: 1 });
    expect(input.account).not.toHaveProperty("balanceCents");
  });
});

describe("loadReadTurnContext", () => {
  it("loads persisted account and conversation context", async () => {
    const account = normalizeLegacyFixture(standardFixture);
    const conversation = { id: "11111111-1111-4111-8111-111111111111", dialogState: { queuedIntents: [] } };
    const conversations = { loadOrCreate: vi.fn().mockResolvedValue(conversation), loadMessages: vi.fn().mockResolvedValue([]) };
    const result = await loadReadTurnContext(validRequest, {
      conversations, repo: { getAccountContextByAccountId: vi.fn().mockResolvedValue(account) },
      now: () => "2026-07-16T17:00:00+01:00",
    });

    expect(conversations.loadOrCreate).toHaveBeenCalledWith("acc_standard_001", undefined);
    expect(conversations.loadMessages).toHaveBeenCalledWith(conversation.id);
    expect(result).toMatchObject({ account, conversation, history: [], nowIso: "2026-07-16T17:00:00+01:00" });
    expect(result.parserInput.message).toBe("Show my account");
  });

  it("rejects a missing account", async () => {
    const conversations = { loadOrCreate: vi.fn().mockResolvedValue({ id: "11111111-1111-4111-8111-111111111111" }), loadMessages: vi.fn().mockResolvedValue([]) };
    await expect(loadReadTurnContext(validRequest, {
      conversations, repo: { getAccountContextByAccountId: vi.fn().mockResolvedValue(null) }, now: () => "unused",
    })).rejects.toThrow("Account not found.");
  });
});

describe("routeLoadedReadIntent", () => {
  it("routes a read against the loaded account snapshot", async () => {
    const account = normalizeLegacyFixture(standardFixture);
    const intent = { action: "read_account", fields: {}, additionalIntents: [], missingFields: [] } as ParsedIntent;
    const result = await routeLoadedReadIntent({ accountId: "acc_standard_001", account, intent, nowIso: "2026-07-16T17:00:00+01:00" });
    expect(result).toMatchObject({ action: "read_account", success: true, account });
  });

  it("blocks mutation intents from the M2 execution path", async () => {
    const account = normalizeLegacyFixture(standardFixture);
    const intent = { action: "update_account_holder", fields: { phone: "+353831112233" } } as ParsedIntent;
    await expect(routeLoadedReadIntent({ accountId: "acc_standard_001", account, intent, nowIso: "unused" }))
      .resolves.toMatchObject({ action: "unsupported", success: false });
  });
});

describe("routeLoadedIntent", () => {
  it("routes account-holder updates to the mutation handler", async () => {
    const account = normalizeLegacyFixture(standardFixture);
    const updated = { ...account.account, phone: "+353831112233" };
    const updateAccountHolder = vi.fn().mockResolvedValue(updated);
    const intent = { action: "update_account_holder", fields: { phone: "+353831112233" } } as ParsedIntent;
    const result = await routeLoadedIntent({ accountId: "acc_standard_001", account, intent, repo: { updateAccountHolder, addRelatedPerson: vi.fn(), updateRelatedPerson: vi.fn(), addPromiseToPay: vi.fn(), recordPayment: vi.fn(), addCallAppointment: vi.fn() }, nowIso: "unused", rawMessage: "unused", idempotencyKey: validRequest.idempotencyKey });

    expect(updateAccountHolder).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ action: "update_account_holder", success: true });
  });

  it("routes preferred-contact updates to the shared persisted write", async () => {
    const account = normalizeLegacyFixture(standardFixture);
    const updateAccountHolder = vi.fn().mockResolvedValue({ ...account.account, preferredContactMethod: "sms" });
    const intent = { action: "update_preferred_contact_method", fields: { method: "sms" } } as ParsedIntent;
    const result = await routeLoadedIntent({ accountId: "acc_standard_001", account, intent, repo: { updateAccountHolder, addRelatedPerson: vi.fn(), updateRelatedPerson: vi.fn(), addPromiseToPay: vi.fn(), recordPayment: vi.fn(), addCallAppointment: vi.fn() }, nowIso: "unused", rawMessage: "unused", idempotencyKey: validRequest.idempotencyKey });

    expect(updateAccountHolder).toHaveBeenCalledWith("acc_standard_001", { preferredContactMethod: "sms" });
    expect(result).toMatchObject({ action: "update_preferred_contact_method", success: true, notificationQueued: true });
  });

  it("routes call appointments to the scoped insert", async () => {
    const account = normalizeLegacyFixture(standardFixture);
    const addCallAppointment = vi.fn().mockResolvedValue({ id: "call-002", scheduledAt: "2026-08-01T09:00:00.000Z", phone: account.account.phone, status: "scheduled" });
    const intent = { action: "book_call_appointment", fields: { dateTime: "2026-08-01T10:00:00+01:00" } } as ParsedIntent;
    const result = await routeLoadedIntent({ accountId: "acc_standard_001", account, intent, repo: { updateAccountHolder: vi.fn(), addRelatedPerson: vi.fn(), updateRelatedPerson: vi.fn(), addPromiseToPay: vi.fn(), recordPayment: vi.fn(), addCallAppointment }, nowIso: "2026-07-17T09:00:00Z", rawMessage: "Book a call on August 1st at 10am", idempotencyKey: validRequest.idempotencyKey });

    expect(result).toMatchObject({ action: "book_call_appointment", success: true, notificationQueued: true });
    expect(addCallAppointment).toHaveBeenCalledOnce();
  });

  it("routes related-person creation to the scoped insert", async () => {
    const account = normalizeLegacyFixture(standardFixture);
    const addRelatedPerson = vi.fn().mockResolvedValue({ id: "person-002", name: "Mark Murphy", email: "mark@example.test", phone: "+353831112233", authorizedToAct: false });
    const intent = { action: "add_related_person", fields: { name: "Mark Murphy", email: "mark@example.test", phone: "+353831112233", relationship: "undefined" } } as ParsedIntent;
    const result = await routeLoadedIntent({ accountId: "acc_standard_001", account, intent, repo: { updateAccountHolder: vi.fn(), addRelatedPerson, updateRelatedPerson: vi.fn(), addPromiseToPay: vi.fn(), recordPayment: vi.fn(), addCallAppointment: vi.fn() }, nowIso: "unused", rawMessage: "Add Mark Murphy so he can act for me.", relatedPersonRawMessage: "Add Mark Murphy so he can act for me.", idempotencyKey: validRequest.idempotencyKey });

    expect(addRelatedPerson).toHaveBeenCalledWith("acc_standard_001", expect.not.objectContaining({ relationship: expect.anything() }));
    expect(result).toMatchObject({ action: "add_related_person", success: true, notificationQueued: true });
  });

  it("routes related-person updates to the scoped write", async () => {
    const account = normalizeLegacyFixture(standardFixture);
    const updated = { ...account.relatedPeople[0], email: "new@example.test" };
    const updateRelatedPerson = vi.fn().mockResolvedValue(updated);
    const intent = { action: "update_related_person", fields: { selector: "John", email: updated.email } } as ParsedIntent;
    const result = await routeLoadedIntent({ accountId: "acc_standard_001", account, intent, repo: { updateAccountHolder: vi.fn(), addRelatedPerson: vi.fn(), updateRelatedPerson, addPromiseToPay: vi.fn(), recordPayment: vi.fn(), addCallAppointment: vi.fn() }, nowIso: "unused", rawMessage: "unused", idempotencyKey: validRequest.idempotencyKey });

    expect(updateRelatedPerson).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ action: "update_related_person", success: true, notificationQueued: true });
  });

  it("routes removal to a confirmation request without a delete capability", async () => {
    const account = normalizeLegacyFixture(standardFixture);
    const intent = { action: "remove_related_person", fields: { selector: "John" } } as ParsedIntent;
    const result = await routeLoadedIntent({ accountId: "acc_standard_001", account, intent, repo: { updateAccountHolder: vi.fn(), addRelatedPerson: vi.fn(), updateRelatedPerson: vi.fn(), addPromiseToPay: vi.fn(), recordPayment: vi.fn(), addCallAppointment: vi.fn() }, nowIso: "unused", rawMessage: "unused", idempotencyKey: validRequest.idempotencyKey });

    expect(result).toMatchObject({ action: "remove_related_person", success: false, relatedPeople: [account.relatedPeople[0]] });
  });

  it("routes promise creation to the scoped insert", async () => {
    const account = normalizeLegacyFixture(standardFixture);
    const created = { id: "promise-002", amountCents: 25000, currency: "EUR", dueDate: "2026-08-01", status: "active" as const, createdAt: "2026-07-17T09:00:00Z" };
    const addPromiseToPay = vi.fn().mockResolvedValue(created);
    const intent = { action: "create_promise_to_pay", fields: { amountRaw: "€250", dueDate: "2026-08-01" }, additionalIntents: [], missingFields: [] } as ParsedIntent;
    const result = await routeLoadedIntent({ accountId: "acc_standard_001", account, intent, repo: { updateAccountHolder: vi.fn(), addRelatedPerson: vi.fn(), updateRelatedPerson: vi.fn(), addPromiseToPay, recordPayment: vi.fn(), addCallAppointment: vi.fn() }, nowIso: "2026-07-17T09:00:00Z", rawMessage: "I promise to pay €250 on August 1st", idempotencyKey: validRequest.idempotencyKey });

    expect(addPromiseToPay).toHaveBeenCalledWith("acc_standard_001", { amountCents: 25000, currency: "EUR", dueDate: "2026-08-01" });
    expect(result).toMatchObject({ action: "create_promise_to_pay", success: true, notificationQueued: true });
  });

  it("routes payment through the idempotent repository boundary", async () => {
    const account = normalizeLegacyFixture(standardFixture);
    const transaction = { id: "transaction-003", type: "payment" as const, status: "completed" as const, amountCents: 15000, currency: "EUR", description: "Saved details", transactionDate: "2026-07-17" };
    const recordPayment = vi.fn().mockResolvedValue({ transaction, newBalanceCents: account.account.balanceCents - 15000, replayed: false });
    const intent = { action: "mock_payment", fields: { amountRaw: "€150" }, additionalIntents: [], missingFields: [] } as ParsedIntent;
    const result = await routeLoadedIntent({ accountId: "acc_standard_001", account, intent,
      repo: { updateAccountHolder: vi.fn(), addRelatedPerson: vi.fn(), updateRelatedPerson: vi.fn(), addPromiseToPay: vi.fn(), recordPayment, addCallAppointment: vi.fn() },
      nowIso: "unused", rawMessage: "Pay €150", idempotencyKey: validRequest.idempotencyKey });

    expect(recordPayment).toHaveBeenCalledWith("acc_standard_001", 15000, validRequest.idempotencyKey);
    expect(result).toMatchObject({ action: "mock_payment", success: true, notificationQueued: true });
  });
});

describe("persistAssistantResult", () => {
  it.each([[true, "read_succeeded"], [false, "not_completed"]] as const)(
    "persists success=%s with audit outcome %s", async (success, validationOutcome) => {
      const result: ChatActionResult = { action: success ? "read_account" : "unsupported", success, reply: "Saved reply" };
      const addMessage = vi.fn().mockResolvedValue({ id: "message-id", content: result.reply, createdAt: "2026-07-16T17:00:01+01:00" });
      const response = await persistAssistantResult({ conversationId: "11111111-1111-4111-8111-111111111111", result, conversations: { addMessage } });

      expect(addMessage).toHaveBeenCalledWith({
        conversationId: response.conversationId, role: "assistant", content: result.reply,
        action: result.action, metadata: { validationOutcome, touchedIds: [] },
      });
      expect(response).toEqual({
        conversationId: "11111111-1111-4111-8111-111111111111",
        message: { id: "message-id", role: "assistant", content: result.reply, createdAt: "2026-07-16T17:00:01+01:00" }, result,
      });
    },
  );
});

describe("executeReadChatTurn", () => {
  it("persists, parses, routes, and returns one read turn in order", async () => {
    const account = normalizeLegacyFixture(standardFixture);
    const conversation = { id: "11111111-1111-4111-8111-111111111111", dialogState: { queuedIntents: [] } };
    const intent = { action: "read_account", fields: {}, additionalIntents: [], missingFields: [] } as ParsedIntent;
    const addMessage = vi.fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ id: "assistant-id", content: "Here are your current account details.", createdAt: "2026-07-16T17:00:01+01:00" });
    const parse = vi.fn().mockResolvedValue(intent);
    const response = await executeReadChatTurn(validRequest, {
      conversations: { loadOrCreate: vi.fn().mockResolvedValue(conversation), loadMessages: vi.fn().mockResolvedValue([]), addMessage, updateDialogState: vi.fn() },
      repo: { getAccountContextByAccountId: vi.fn().mockResolvedValue(account), updateAccountHolder: vi.fn(), addRelatedPerson: vi.fn(), updateRelatedPerson: vi.fn(), deleteRelatedPerson: vi.fn(), addPromiseToPay: vi.fn(), recordPayment: vi.fn(), addCallAppointment: vi.fn() },
      now: () => "2026-07-16T17:00:00+01:00", parse, processNotifications: vi.fn(),
    });

    expect(addMessage).toHaveBeenNthCalledWith(1, { conversationId: conversation.id, role: "account_holder", content: validRequest.message });
    expect(addMessage.mock.invocationCallOrder[0]).toBeLessThan(parse.mock.invocationCallOrder[0]);
    expect(parse.mock.invocationCallOrder[0]).toBeLessThan(addMessage.mock.invocationCallOrder[1]);
    expect(response).toMatchObject({ conversationId: conversation.id, message: { id: "assistant-id" }, result: { action: "read_account", success: true, account } });
  });

  it("routes and audits a parsed account update", async () => {
    const account = normalizeLegacyFixture(standardFixture);
    const conversation = { id: "11111111-1111-4111-8111-111111111111", accountHolderId: "22222222-2222-4222-8222-222222222222", dialogState: { queuedIntents: [] } };
    const updated = { ...account.account, phone: "+353831112233" };
    const updateAccountHolder = vi.fn().mockResolvedValue(updated);
    const processNotifications = vi.fn().mockResolvedValue({ status: "logged", attemptCount: 1 });
    const addMessage = vi.fn().mockResolvedValueOnce({}).mockResolvedValueOnce({ id: "assistant-id", content: "Updated", createdAt: "2026-07-16T17:00:01+01:00" });
    const parse = vi.fn().mockResolvedValue({ action: "update_account_holder", fields: { phone: updated.phone } } as ParsedIntent);
    const response = await executeReadChatTurn(validRequest, { conversations: { loadOrCreate: vi.fn().mockResolvedValue(conversation), loadMessages: vi.fn().mockResolvedValue([]), addMessage, updateDialogState: vi.fn() }, repo: { getAccountContextByAccountId: vi.fn().mockResolvedValue(account), updateAccountHolder, addRelatedPerson: vi.fn(), updateRelatedPerson: vi.fn(), deleteRelatedPerson: vi.fn(), addPromiseToPay: vi.fn(), recordPayment: vi.fn(), addCallAppointment: vi.fn() }, now: () => "2026-07-16T17:00:00+01:00", parse, processNotifications });

    expect(updateAccountHolder).toHaveBeenCalledOnce();
    expect(processNotifications).toHaveBeenCalledWith(conversation.accountHolderId);
    expect(addMessage).toHaveBeenNthCalledWith(2, expect.objectContaining({ action: "update_account_holder", metadata: { validationOutcome: "mutation_succeeded", notificationStatus: "logged", touchedIds: ["acc_standard_001"] } }));
    expect(response.result).toMatchObject({ action: "update_account_holder", notificationQueued: true });
    expect(response.result.reply).toContain("notification attempt was logged");
  });

  it("processes and audits a preferred-contact mutation", async () => {
    const account = normalizeLegacyFixture(standardFixture);
    const conversation = { id: "11111111-1111-4111-8111-111111111111", accountHolderId: "22222222-2222-4222-8222-222222222222", dialogState: { queuedIntents: [] } };
    const addMessage = vi.fn().mockResolvedValueOnce({}).mockResolvedValueOnce({ id: "assistant-id", content: "Updated", createdAt: "2026-07-16T17:00:01+01:00" });
    const response = await executeReadChatTurn(validRequest, {
      conversations: { loadOrCreate: vi.fn().mockResolvedValue(conversation), loadMessages: vi.fn().mockResolvedValue([]), addMessage, updateDialogState: vi.fn() },
      repo: { getAccountContextByAccountId: vi.fn().mockResolvedValue(account), updateAccountHolder: vi.fn().mockResolvedValue({ ...account.account, preferredContactMethod: "sms" }), addRelatedPerson: vi.fn(), updateRelatedPerson: vi.fn(), deleteRelatedPerson: vi.fn(), addPromiseToPay: vi.fn(), recordPayment: vi.fn(), addCallAppointment: vi.fn() },
      now: () => "2026-07-16T17:00:00+01:00",
      parse: vi.fn().mockResolvedValue({ action: "update_preferred_contact_method", fields: { method: "sms" } } as ParsedIntent),
      processNotifications: vi.fn().mockResolvedValue({ status: "sent", attemptCount: 1 }),
    });

    expect(response.result).toMatchObject({ action: "update_preferred_contact_method", notificationQueued: true });
    expect(response.result.reply).toContain("confirmation email was sent");
    expect(addMessage).toHaveBeenNthCalledWith(2, expect.objectContaining({ action: "update_preferred_contact_method", metadata: expect.objectContaining({ validationOutcome: "mutation_succeeded", notificationStatus: "sent" }) }));
  });

  it("keeps a committed update successful when notification processing fails", async () => {
    const account = normalizeLegacyFixture(standardFixture);
    const conversation = { id: "11111111-1111-4111-8111-111111111111", accountHolderId: "22222222-2222-4222-8222-222222222222", dialogState: { queuedIntents: [] } };
    const addMessage = vi.fn().mockResolvedValueOnce({}).mockResolvedValueOnce({ id: "assistant-id", content: "Updated", createdAt: "2026-07-16T17:00:01+01:00" });
    const parse = vi.fn().mockResolvedValue({ action: "update_account_holder", fields: { phone: "+353831112233" } } as ParsedIntent);
    const response = await executeReadChatTurn(validRequest, { conversations: { loadOrCreate: vi.fn().mockResolvedValue(conversation), loadMessages: vi.fn().mockResolvedValue([]), addMessage, updateDialogState: vi.fn() }, repo: { getAccountContextByAccountId: vi.fn().mockResolvedValue(account), updateAccountHolder: vi.fn().mockResolvedValue({ ...account.account, phone: "+353831112233" }), addRelatedPerson: vi.fn(), updateRelatedPerson: vi.fn(), deleteRelatedPerson: vi.fn(), addPromiseToPay: vi.fn(), recordPayment: vi.fn(), addCallAppointment: vi.fn() }, now: () => "2026-07-16T17:00:00+01:00", parse, processNotifications: vi.fn().mockRejectedValue(new Error("private delivery detail")) });

    expect(response.result.success).toBe(true);
    expect(response.result.reply).toContain("notification could not be delivered");
    expect(addMessage).toHaveBeenNthCalledWith(2, expect.objectContaining({ metadata: expect.objectContaining({ notificationStatus: "failed" }) }));
  });

  it("processes and audits related-person creation", async () => {
    const account = normalizeLegacyFixture(standardFixture);
    const conversation = { id: "11111111-1111-4111-8111-111111111111", accountHolderId: "22222222-2222-4222-8222-222222222222", dialogState: { queuedIntents: [] } };
    const addMessage = vi.fn().mockResolvedValueOnce({}).mockResolvedValueOnce({ id: "assistant-id", content: "Added", createdAt: "2026-07-16T17:00:01+01:00" });
    const created = { id: "person-002", name: "Mark Murphy", email: "mark@example.test", phone: "+353831112233", authorizedToAct: false };
    const response = await executeReadChatTurn(validRequest, {
      conversations: { loadOrCreate: vi.fn().mockResolvedValue(conversation), loadMessages: vi.fn().mockResolvedValue([]), addMessage, updateDialogState: vi.fn() },
      repo: { getAccountContextByAccountId: vi.fn().mockResolvedValue(account), updateAccountHolder: vi.fn(), addRelatedPerson: vi.fn().mockResolvedValue(created), updateRelatedPerson: vi.fn(), deleteRelatedPerson: vi.fn(), addPromiseToPay: vi.fn(), recordPayment: vi.fn(), addCallAppointment: vi.fn() },
      now: () => "2026-07-16T17:00:00+01:00",
      parse: vi.fn().mockResolvedValue({ action: "add_related_person", fields: { name: created.name, email: created.email, phone: created.phone } } as ParsedIntent),
      processNotifications: vi.fn().mockResolvedValue({ status: "logged", attemptCount: 1 }),
    });

    expect(response.result).toMatchObject({ action: "add_related_person", notificationQueued: true });
    expect(addMessage).toHaveBeenNthCalledWith(2, expect.objectContaining({ metadata: expect.objectContaining({ validationOutcome: "mutation_succeeded", touchedIds: ["acc_standard_001", "person-002"], notificationStatus: "logged" }) }));
  });

  it("processes and audits a related-person update", async () => {
    const account = normalizeLegacyFixture(standardFixture);
    const conversation = { id: "11111111-1111-4111-8111-111111111111", accountHolderId: "22222222-2222-4222-8222-222222222222", dialogState: { queuedIntents: [] } };
    const updated = { ...account.relatedPeople[0], email: "new@example.test" };
    const addMessage = vi.fn().mockResolvedValueOnce({}).mockResolvedValueOnce({ id: "assistant-id", content: "Updated", createdAt: "2026-07-17T09:00:01+01:00" });
    const response = await executeReadChatTurn(validRequest, {
      conversations: { loadOrCreate: vi.fn().mockResolvedValue(conversation), loadMessages: vi.fn().mockResolvedValue([]), addMessage, updateDialogState: vi.fn() },
      repo: { getAccountContextByAccountId: vi.fn().mockResolvedValue(account), updateAccountHolder: vi.fn(), addRelatedPerson: vi.fn(), updateRelatedPerson: vi.fn().mockResolvedValue(updated), deleteRelatedPerson: vi.fn(), addPromiseToPay: vi.fn(), recordPayment: vi.fn(), addCallAppointment: vi.fn() },
      now: () => "2026-07-17T09:00:00+01:00",
      parse: vi.fn().mockResolvedValue({ action: "update_related_person", fields: { selector: "John", email: updated.email } } as ParsedIntent),
      processNotifications: vi.fn().mockResolvedValue({ status: "logged", attemptCount: 1 }),
    });

    expect(response.result).toMatchObject({ action: "update_related_person", notificationQueued: true });
    expect(addMessage).toHaveBeenNthCalledWith(2, expect.objectContaining({ metadata: expect.objectContaining({ validationOutcome: "mutation_succeeded", touchedIds: ["acc_standard_001", account.relatedPeople[0].id], notificationStatus: "logged" }) }));
  });

  it("persists a removal confirmation request without deleting", async () => {
    const baseAccount = normalizeLegacyFixture(standardFixture);
    const person = { ...baseAccount.relatedPeople[0], id: "00000000-0000-4000-8000-000000000003" };
    const account = { ...baseAccount, relatedPeople: [person] };
    const conversation = { id: "11111111-1111-4111-8111-111111111111", accountHolderId: "22222222-2222-4222-8222-222222222222", dialogState: { queuedIntents: [] } };
    const addMessage = vi.fn().mockResolvedValueOnce({}).mockResolvedValueOnce({ id: "assistant-id", content: "Confirm", createdAt: "2026-07-17T10:00:01+01:00" });
    const updateDialogState = vi.fn();
    const deleteRelatedPerson = vi.fn();
    const response = await executeReadChatTurn(validRequest, {
      conversations: { loadOrCreate: vi.fn().mockResolvedValue(conversation), loadMessages: vi.fn().mockResolvedValue([]), addMessage, updateDialogState },
      repo: { getAccountContextByAccountId: vi.fn().mockResolvedValue(account), updateAccountHolder: vi.fn(), addRelatedPerson: vi.fn(), updateRelatedPerson: vi.fn(), deleteRelatedPerson, addPromiseToPay: vi.fn(), recordPayment: vi.fn(), addCallAppointment: vi.fn() },
      now: () => "2026-07-17T10:00:00+01:00",
      parse: vi.fn().mockResolvedValue({ action: "remove_related_person", fields: { selector: "John" } } as ParsedIntent),
      processNotifications: vi.fn(),
    });

    expect(response.result).toMatchObject({ action: "remove_related_person", success: false });
    expect(updateDialogState).toHaveBeenCalledWith(conversation, { awaitingConfirmation: { kind: "remove_related_person", personId: person.id, personName: person.name }, queuedIntents: [] });
    expect(deleteRelatedPerson).not.toHaveBeenCalled();
  });

  it("deletes only after a persisted yes and clears the confirmation", async () => {
    const baseAccount = normalizeLegacyFixture(standardFixture);
    const person = { ...baseAccount.relatedPeople[0], id: "00000000-0000-4000-8000-000000000003" };
    const account = { ...baseAccount, relatedPeople: [person] };
    const conversation = { id: "11111111-1111-4111-8111-111111111111", accountHolderId: "22222222-2222-4222-8222-222222222222", dialogState: { queuedIntents: [], awaitingConfirmation: { kind: "remove_related_person" as const, personId: person.id, personName: person.name } } };
    const addMessage = vi.fn().mockResolvedValueOnce({}).mockResolvedValueOnce({ id: "assistant-id", content: "Removed", createdAt: "2026-07-17T10:01:01+01:00" });
    const updateDialogState = vi.fn();
    const deleteRelatedPerson = vi.fn().mockResolvedValue(person);
    const parse = vi.fn();
    const response = await executeReadChatTurn({ ...validRequest, message: "yes" }, {
      conversations: { loadOrCreate: vi.fn().mockResolvedValue(conversation), loadMessages: vi.fn().mockResolvedValue([]), addMessage, updateDialogState },
      repo: { getAccountContextByAccountId: vi.fn().mockResolvedValue(account), updateAccountHolder: vi.fn(), addRelatedPerson: vi.fn(), updateRelatedPerson: vi.fn(), deleteRelatedPerson, addPromiseToPay: vi.fn(), recordPayment: vi.fn(), addCallAppointment: vi.fn() },
      now: () => "2026-07-17T10:01:00+01:00", parse,
      processNotifications: vi.fn().mockResolvedValue({ status: "logged", attemptCount: 1 }),
    });

    expect(parse).not.toHaveBeenCalled();
    expect(deleteRelatedPerson).toHaveBeenCalledWith("acc_standard_001", person.id);
    expect(updateDialogState).toHaveBeenCalledWith(conversation, { queuedIntents: [] });
    expect(response.result).toMatchObject({ action: "remove_related_person", success: true, account: { relatedPeople: [] } });
    expect(addMessage).toHaveBeenNthCalledWith(2, expect.objectContaining({ metadata: expect.objectContaining({ validationOutcome: "mutation_succeeded", touchedIds: ["acc_standard_001", person.id], notificationStatus: "logged" }) }));
  });

  it("processes and audits a promise creation", async () => {
    const account = normalizeLegacyFixture(standardFixture);
    const conversation = { id: "11111111-1111-4111-8111-111111111111", accountHolderId: "22222222-2222-4222-8222-222222222222", dialogState: { queuedIntents: [] } };
    const created = { id: "promise-002", amountCents: 25000, currency: "EUR", dueDate: "2026-08-01", status: "active" as const, createdAt: "2026-07-17T11:00:00Z" };
    const addMessage = vi.fn().mockResolvedValueOnce({}).mockResolvedValueOnce({ id: "assistant-id", content: "Created", createdAt: "2026-07-17T11:00:01Z" });
    const response = await executeReadChatTurn({ ...validRequest, message: "I promise to pay €250 on August 1st" }, {
      conversations: { loadOrCreate: vi.fn().mockResolvedValue(conversation), loadMessages: vi.fn().mockResolvedValue([]), addMessage, updateDialogState: vi.fn() },
      repo: { getAccountContextByAccountId: vi.fn().mockResolvedValue(account), updateAccountHolder: vi.fn(), addRelatedPerson: vi.fn(), updateRelatedPerson: vi.fn(), deleteRelatedPerson: vi.fn(), addPromiseToPay: vi.fn().mockResolvedValue(created), recordPayment: vi.fn(), addCallAppointment: vi.fn() },
      now: () => "2026-07-17T11:00:00Z",
      parse: vi.fn().mockResolvedValue({ action: "create_promise_to_pay", fields: { amountRaw: "€250", dueDate: "2026-08-01" }, additionalIntents: [], missingFields: [] } as ParsedIntent),
      processNotifications: vi.fn().mockResolvedValue({ status: "logged", attemptCount: 1 }),
    });

    expect(response.result).toMatchObject({ action: "create_promise_to_pay", success: true, notificationQueued: true });
    expect(addMessage).toHaveBeenNthCalledWith(2, expect.objectContaining({ action: "create_promise_to_pay", metadata: expect.objectContaining({ validationOutcome: "mutation_succeeded", touchedIds: ["acc_standard_001", "promise-002"], notificationStatus: "logged" }) }));
  });

  it("processes and audits a new payment transaction", async () => {
    const account = normalizeLegacyFixture(standardFixture);
    const conversation = { id: "11111111-1111-4111-8111-111111111111", accountHolderId: "22222222-2222-4222-8222-222222222222", dialogState: { queuedIntents: [] } };
    const transaction = { id: "transaction-003", type: "payment" as const, status: "completed" as const, amountCents: 15000, currency: "EUR", description: "Saved details", transactionDate: "2026-07-17" };
    const addMessage = vi.fn().mockResolvedValueOnce({}).mockResolvedValueOnce({ id: "assistant-id", content: "Paid", createdAt: "2026-07-17T12:00:01Z" });
    const response = await executeReadChatTurn({ ...validRequest, message: "Pay €150" }, {
      conversations: { loadOrCreate: vi.fn().mockResolvedValue(conversation), loadMessages: vi.fn().mockResolvedValue([]), addMessage, updateDialogState: vi.fn() },
      repo: { getAccountContextByAccountId: vi.fn().mockResolvedValue(account), updateAccountHolder: vi.fn(), addRelatedPerson: vi.fn(), updateRelatedPerson: vi.fn(), deleteRelatedPerson: vi.fn(), addPromiseToPay: vi.fn(),
        recordPayment: vi.fn().mockResolvedValue({ transaction, newBalanceCents: account.account.balanceCents - 15000, replayed: false }), addCallAppointment: vi.fn() },
      now: () => "2026-07-17T12:00:00Z",
      parse: vi.fn().mockResolvedValue({ action: "mock_payment", fields: { amountRaw: "€150" }, additionalIntents: [], missingFields: [] } as ParsedIntent),
      processNotifications: vi.fn().mockResolvedValue({ status: "logged", attemptCount: 2 }),
    });

    expect(response.result).toMatchObject({ action: "mock_payment", success: true, notificationQueued: true, account: { account: { balanceCents: account.account.balanceCents - 15000 } } });
    expect(addMessage).toHaveBeenNthCalledWith(2, expect.objectContaining({ action: "mock_payment", metadata: expect.objectContaining({ validationOutcome: "mutation_succeeded", touchedIds: ["acc_standard_001", "transaction-003"], notificationStatus: "logged" }) }));
  });

  it("processes and audits a booked call appointment", async () => {
    const account = normalizeLegacyFixture(standardFixture);
    const conversation = { id: "11111111-1111-4111-8111-111111111111", accountHolderId: "22222222-2222-4222-8222-222222222222", dialogState: { queuedIntents: [] } };
    const created = { id: "call-002", scheduledAt: "2026-07-21T09:00:00.000Z", phone: account.account.phone, reason: "Discuss my account", status: "scheduled" as const };
    const addMessage = vi.fn().mockResolvedValueOnce({}).mockResolvedValueOnce({ id: "assistant-id", content: "Booked", createdAt: "2026-07-17T13:00:01Z" });
    const response = await executeReadChatTurn({ ...validRequest, message: "Book a call next Tuesday at 10am to discuss my account" }, {
      conversations: { loadOrCreate: vi.fn().mockResolvedValue(conversation), loadMessages: vi.fn().mockResolvedValue([]), addMessage, updateDialogState: vi.fn() },
      repo: { getAccountContextByAccountId: vi.fn().mockResolvedValue(account), updateAccountHolder: vi.fn(), addRelatedPerson: vi.fn(), updateRelatedPerson: vi.fn(),
        deleteRelatedPerson: vi.fn(), addPromiseToPay: vi.fn(), recordPayment: vi.fn(), addCallAppointment: vi.fn().mockResolvedValue(created) },
      now: () => "2026-07-16T15:00:00Z",
      parse: vi.fn().mockResolvedValue({ action: "book_call_appointment", fields: { dateTime: "2026-07-21T10:00:00+01:00", reason: created.reason }, additionalIntents: [], missingFields: [] } as ParsedIntent),
      processNotifications: vi.fn().mockResolvedValue({ status: "logged", attemptCount: 1 }),
    });

    expect(response.result).toMatchObject({ action: "book_call_appointment", success: true, notificationQueued: true,
      account: { callAppointments: [...account.callAppointments, created] } });
    expect(addMessage).toHaveBeenNthCalledWith(2, expect.objectContaining({ action: "book_call_appointment",
      metadata: expect.objectContaining({ validationOutcome: "mutation_succeeded", touchedIds: ["acc_standard_001", "call-002"], notificationStatus: "logged" }) }));
  });
});

describe("respondToReadChatTurn", () => {
  it("returns the completed response with status 200", async () => {
    const body: ChatResponse = { conversationId: "11111111-1111-4111-8111-111111111111", message: { id: "message-id", role: "assistant", content: "Done", createdAt: "2026-07-16T17:00:01+01:00" }, result: { action: "read_account", success: true, reply: "Done" } };
    const response = await respondToReadChatTurn(validRequest, {} as never, vi.fn().mockResolvedValue(body));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(body);
  });

  it("returns a fixed 500 without exposing operational errors", async () => {
    const response = await respondToReadChatTurn(validRequest, {} as never, vi.fn().mockRejectedValue(new Error("private provider detail")));
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "Unable to process the chat request safely." });
  });
});

describe("parseChatRequest", () => {
  it("trims valid customer input", () => {
    expect(parseChatRequest({ accountId: " acc_standard_001 ", message: " Show my account ", idempotencyKey: validRequest.idempotencyKey }))
      .toEqual(validRequest);
  });

  it.each([
    ["a missing account", { message: "Show my account" }],
    ["a blank message", { accountId: "acc_standard_001", message: "   " }],
    ["an invalid conversation ID", { ...validRequest, conversationId: "starter-conversation" }],
    ["an invalid idempotency key", { ...validRequest, idempotencyKey: "retry-1" }],
    ["an unknown field", { ...validRequest, inventedAction: "update_balance" }],
  ])("rejects %s", (_label, input) => {
    expect(() => parseChatRequest(input)).toThrow();
  });
});

describe("POST", () => {
  it("returns 400 for malformed JSON", async () => {
    const response = await POST(new Request("http://localhost/api/chat", {
      method: "POST", body: "{",
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "A valid accountId, message, and idempotencyKey are required.",
    });
  });

  it("returns a fixed 500 when server configuration is unavailable", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    const response = await POST(new Request("http://localhost/api/chat", { method: "POST", body: JSON.stringify(validRequest) }));
    vi.unstubAllEnvs();
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "Unable to process the chat request safely." });
  });
});
