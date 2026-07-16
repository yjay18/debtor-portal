import { describe, expect, it, vi } from "vitest";

import standardFixture from "../../../../fixtures/debtor-standard.json";
import { normalizeLegacyFixture } from "@/lib/account/types";
import type { ParsedIntent } from "@/lib/llm/parser-schema";
import { buildParserInput, loadReadTurnContext, parseChatRequest, POST, routeLoadedReadIntent } from "./route";

const validRequest = { accountId: "acc_standard_001", message: "Show my account" };

describe("buildParserInput", () => {
  it("builds the minimum parser context from persisted state", () => {
    const account = normalizeLegacyFixture(standardFixture);
    const dialogState = { queuedIntents: [], awaitingConfirmation: false };
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
    const conversation = { id: "11111111-1111-4111-8111-111111111111", dialogState: { queuedIntents: [], awaitingConfirmation: false } };
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
});
