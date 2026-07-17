import { describe, expect, it, vi } from "vitest";

import standardFixture from "../../../../fixtures/debtor-standard.json";
import { normalizeLegacyFixture } from "@/lib/account/types";
import type { ChatActionResult, ChatResponse } from "@/lib/chat/types";
import type { ParsedIntent } from "@/lib/llm/parser-schema";
import { buildParserInput, executeReadChatTurn, loadReadTurnContext, parseChatRequest, persistAssistantResult, POST, respondToReadChatTurn, routeLoadedIntent, routeLoadedReadIntent } from "./route";

const validRequest = { accountId: "acc_standard_001", message: "Show my account" };

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
    const result = await routeLoadedIntent({ accountId: "acc_standard_001", account, intent, repo: { updateAccountHolder, addRelatedPerson: vi.fn() }, nowIso: "unused" });

    expect(updateAccountHolder).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ action: "update_account_holder", success: true });
  });

  it("routes preferred-contact updates to the shared persisted write", async () => {
    const account = normalizeLegacyFixture(standardFixture);
    const updateAccountHolder = vi.fn().mockResolvedValue({ ...account.account, preferredContactMethod: "sms" });
    const intent = { action: "update_preferred_contact_method", fields: { method: "sms" } } as ParsedIntent;
    const result = await routeLoadedIntent({ accountId: "acc_standard_001", account, intent, repo: { updateAccountHolder, addRelatedPerson: vi.fn() }, nowIso: "unused" });

    expect(updateAccountHolder).toHaveBeenCalledWith("acc_standard_001", { preferredContactMethod: "sms" });
    expect(result).toMatchObject({ action: "update_preferred_contact_method", success: true, notificationQueued: true });
  });

  it("keeps every other mutation blocked", async () => {
    const account = normalizeLegacyFixture(standardFixture);
    const updateAccountHolder = vi.fn();
    const intent = { action: "mock_payment", fields: { amountRaw: "50" } } as ParsedIntent;
    const result = await routeLoadedIntent({ accountId: "acc_standard_001", account, intent, repo: { updateAccountHolder, addRelatedPerson: vi.fn() }, nowIso: "unused" });

    expect(result).toMatchObject({ action: "unsupported", success: false });
    expect(updateAccountHolder).not.toHaveBeenCalled();
  });

  it("routes related-person creation to the scoped insert", async () => {
    const account = normalizeLegacyFixture(standardFixture);
    const addRelatedPerson = vi.fn().mockResolvedValue({ id: "person-002", name: "Mark Murphy", email: "mark@example.test", phone: "+353831112233", authorizedToAct: false });
    const intent = { action: "add_related_person", fields: { name: "Mark Murphy", email: "mark@example.test", phone: "+353831112233" } } as ParsedIntent;
    const result = await routeLoadedIntent({ accountId: "acc_standard_001", account, intent, repo: { updateAccountHolder: vi.fn(), addRelatedPerson }, nowIso: "unused" });

    expect(addRelatedPerson).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ action: "add_related_person", success: true, notificationQueued: true });
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
      conversations: { loadOrCreate: vi.fn().mockResolvedValue(conversation), loadMessages: vi.fn().mockResolvedValue([]), addMessage },
      repo: { getAccountContextByAccountId: vi.fn().mockResolvedValue(account), updateAccountHolder: vi.fn(), addRelatedPerson: vi.fn() },
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
    const response = await executeReadChatTurn(validRequest, { conversations: { loadOrCreate: vi.fn().mockResolvedValue(conversation), loadMessages: vi.fn().mockResolvedValue([]), addMessage }, repo: { getAccountContextByAccountId: vi.fn().mockResolvedValue(account), updateAccountHolder, addRelatedPerson: vi.fn() }, now: () => "2026-07-16T17:00:00+01:00", parse, processNotifications });

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
      conversations: { loadOrCreate: vi.fn().mockResolvedValue(conversation), loadMessages: vi.fn().mockResolvedValue([]), addMessage },
      repo: { getAccountContextByAccountId: vi.fn().mockResolvedValue(account), updateAccountHolder: vi.fn().mockResolvedValue({ ...account.account, preferredContactMethod: "sms" }), addRelatedPerson: vi.fn() },
      now: () => "2026-07-16T17:00:00+01:00",
      parse: vi.fn().mockResolvedValue({ action: "update_preferred_contact_method", fields: { method: "sms" } } as ParsedIntent),
      processNotifications: vi.fn().mockResolvedValue({ status: "logged", attemptCount: 1 }),
    });

    expect(response.result).toMatchObject({ action: "update_preferred_contact_method", notificationQueued: true });
    expect(addMessage).toHaveBeenNthCalledWith(2, expect.objectContaining({ action: "update_preferred_contact_method", metadata: expect.objectContaining({ validationOutcome: "mutation_succeeded", notificationStatus: "logged" }) }));
  });

  it("keeps a committed update successful when notification processing fails", async () => {
    const account = normalizeLegacyFixture(standardFixture);
    const conversation = { id: "11111111-1111-4111-8111-111111111111", accountHolderId: "22222222-2222-4222-8222-222222222222", dialogState: { queuedIntents: [] } };
    const addMessage = vi.fn().mockResolvedValueOnce({}).mockResolvedValueOnce({ id: "assistant-id", content: "Updated", createdAt: "2026-07-16T17:00:01+01:00" });
    const parse = vi.fn().mockResolvedValue({ action: "update_account_holder", fields: { phone: "+353831112233" } } as ParsedIntent);
    const response = await executeReadChatTurn(validRequest, { conversations: { loadOrCreate: vi.fn().mockResolvedValue(conversation), loadMessages: vi.fn().mockResolvedValue([]), addMessage }, repo: { getAccountContextByAccountId: vi.fn().mockResolvedValue(account), updateAccountHolder: vi.fn().mockResolvedValue({ ...account.account, phone: "+353831112233" }), addRelatedPerson: vi.fn() }, now: () => "2026-07-16T17:00:00+01:00", parse, processNotifications: vi.fn().mockRejectedValue(new Error("private delivery detail")) });

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
      conversations: { loadOrCreate: vi.fn().mockResolvedValue(conversation), loadMessages: vi.fn().mockResolvedValue([]), addMessage },
      repo: { getAccountContextByAccountId: vi.fn().mockResolvedValue(account), updateAccountHolder: vi.fn(), addRelatedPerson: vi.fn().mockResolvedValue(created) },
      now: () => "2026-07-16T17:00:00+01:00",
      parse: vi.fn().mockResolvedValue({ action: "add_related_person", fields: { name: created.name, email: created.email, phone: created.phone } } as ParsedIntent),
      processNotifications: vi.fn().mockResolvedValue({ status: "logged", attemptCount: 1 }),
    });

    expect(response.result).toMatchObject({ action: "add_related_person", notificationQueued: true });
    expect(addMessage).toHaveBeenNthCalledWith(2, expect.objectContaining({ metadata: expect.objectContaining({ validationOutcome: "mutation_succeeded", touchedIds: ["acc_standard_001", "person-002"], notificationStatus: "logged" }) }));
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
    expect(parseChatRequest({ accountId: " acc_standard_001 ", message: " Show my account " }))
      .toEqual(validRequest);
  });

  it.each([
    ["a missing account", { message: "Show my account" }],
    ["a blank message", { accountId: "acc_standard_001", message: "   " }],
    ["an invalid conversation ID", { ...validRequest, conversationId: "starter-conversation" }],
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
      error: "A valid accountId and message are required.",
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
