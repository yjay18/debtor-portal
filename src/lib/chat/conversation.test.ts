import { expect, it, vi } from "vitest";
//tests for the same
import {
  ConversationStore,
  mapChatMessageRow,
  mapConversationRow,
  type ChatMessageRow,
  type ConversationRow,
} from "./conversation";

const row: ConversationRow = {
  id: "conversation-001",
  account_holder_id: "holder-001",
  pending_action: {
    pendingAction: {
      action: "update_account_holder",
      fields: { phone: "+353831234567" },
      missingFields: ["email"],
    },
    queuedIntents: [{ action: "read_transactions", fields: {} }],
    awaitingConfirmation: true,
  },
  created_at: "2026-07-16T12:00:00Z",
  updated_at: "2026-07-16T12:05:00Z",
};

it("maps and validates a persisted conversation", () => {
  expect(mapConversationRow(row)).toEqual({
    id: "conversation-001",
    accountHolderId: "holder-001",
    dialogState: row.pending_action,
    createdAt: "2026-07-16T12:00:00Z",
    updatedAt: "2026-07-16T12:05:00Z",
  });
});

it("uses an empty dialog state when none is stored", () => {
  expect(mapConversationRow({ ...row, pending_action: null }).dialogState)
    .toEqual({ queuedIntents: [], awaitingConfirmation: false });
});

it.each([
  { name: "unknown action", state: { queuedIntents: [{ action: "delete_account", fields: {} }] } },
  {
    name: "empty missing-fields list",
    state: {
      pendingAction: { action: "update_account_holder", fields: {}, missingFields: [] },
    },
  },
  { name: "non-boolean confirmation", state: { awaitingConfirmation: "yes" } },
])("rejects dialog state with $name", ({ state }) => {
  expect(() => mapConversationRow({ ...row, pending_action: state }))
    .toThrow();
});

const accountHolderMessageRow: ChatMessageRow = {
  id: "message-001",
  conversation_id: "conversation-001",
  role: "account_holder",
  content: "Show me my transactions",
  action: null,
  metadata: null,
  created_at: "2026-07-16T12:06:00Z",
};

const assistantMessageRow: ChatMessageRow = {
  ...accountHolderMessageRow,
  id: "message-002",
  role: "assistant",
  content: "Here are your transactions.",
  action: "read_transactions",
  metadata: {
    validationOutcome: "accepted",
    notificationStatus: "not_required",
    touchedIds: ["transaction-001"],
  },
};

it("maps an account-holder message without assistant audit fields", () => {
  expect(mapChatMessageRow(accountHolderMessageRow)).toEqual({
    id: "message-001",
    conversationId: "conversation-001",
    role: "account_holder",
    content: "Show me my transactions",
    createdAt: "2026-07-16T12:06:00Z",
  });
});

it("maps an assistant message with its audit trail", () => {
  expect(mapChatMessageRow(assistantMessageRow)).toMatchObject({
    role: "assistant",
    action: "read_transactions",
    metadata: {
      validationOutcome: "accepted",
      notificationStatus: "not_required",
      touchedIds: ["transaction-001"],
    },
  });
});

it.each([
  { name: "unknown role", row: { ...accountHolderMessageRow, role: "system" } },
  { name: "account-holder action", row: { ...accountHolderMessageRow, action: "read_account" } },
  { name: "missing assistant action", row: { ...assistantMessageRow, action: null } },
  { name: "missing validation outcome", row: { ...assistantMessageRow, metadata: {} } },
])("rejects a message with $name", ({ row: invalidRow }) => {
  expect(() => mapChatMessageRow(invalidRow)).toThrow();
});

type FakeResult = { data: unknown; error: { message: string } | null };

function createFakeClient(overrides: {
  holder?: FakeResult;
  conversation?: FakeResult;
  inserted?: FakeResult;
} = {}) {
  const holder = overrides.holder ?? { data: { id: "holder-001" }, error: null };
  const conversation = overrides.conversation ?? { data: row, error: null };
  const inserted = overrides.inserted ?? {
    data: { ...row, id: "conversation-new", pending_action: null },
    error: null,
  };
  const filters: Array<[string, string, string]> = [];
  const insert = vi.fn(() => ({
    select: () => ({ single: () => Promise.resolve(inserted) }),
  }));
  const from = vi.fn((table: string) => table === "account_holders" ? {
    select: () => ({
      eq: (column: string, value: string) => {
        filters.push([table, column, value]);
        return { maybeSingle: () => Promise.resolve(holder) };
      },
    }),
  } : {
    select: () => ({
      eq: (column: string, value: string) => {
        filters.push([table, column, value]);
        return { eq: (nextColumn: string, nextValue: string) => {
          filters.push([table, nextColumn, nextValue]);
          return { maybeSingle: () => Promise.resolve(conversation) };
        } };
      },
    }),
    insert,
  });

  return { client: { from }, filters, insert };
}

it("loads a conversation scoped to its account holder", async () => {
  const { client, filters, insert } = createFakeClient();
  const conversation = await new ConversationStore(client as never)
    .loadOrCreate("acc_standard_001", "conversation-001");

  expect(conversation.id).toBe("conversation-001");
  expect(filters).toEqual([
    ["account_holders", "account_id", "acc_standard_001"],
    ["conversations", "id", "conversation-001"],
    ["conversations", "account_holder_id", "holder-001"],
  ]);
  expect(insert).not.toHaveBeenCalled();
});

it("creates a conversation when no ID is supplied", async () => {
  const { client, insert } = createFakeClient();
  const conversation = await new ConversationStore(client as never)
    .loadOrCreate("acc_standard_001");

  expect(conversation).toMatchObject({
    id: "conversation-new",
    accountHolderId: "holder-001",
    dialogState: { queuedIntents: [], awaitingConfirmation: false },
  });
  expect(insert).toHaveBeenCalledWith({ account_holder_id: "holder-001" });
});

it.each([
  {
    name: "account query error",
    overrides: { holder: { data: null, error: { message: "account unavailable" } } },
    conversationId: undefined,
    message: "Failed to resolve account: account unavailable",
  },
  {
    name: "missing account",
    overrides: { holder: { data: null, error: null } },
    conversationId: undefined,
    message: "Account not found.",
  },
  {
    name: "conversation query error",
    overrides: { conversation: { data: null, error: { message: "chat unavailable" } } },
    conversationId: "conversation-001",
    message: "Failed to load conversation: chat unavailable",
  },
  {
    name: "conversation outside account",
    overrides: { conversation: { data: null, error: null } },
    conversationId: "conversation-001",
    message: "Conversation not found for account.",
  },
  {
    name: "insert error",
    overrides: { inserted: { data: null, error: { message: "insert unavailable" } } },
    conversationId: undefined,
    message: "Failed to create conversation: insert unavailable",
  },
])("fails safely for $name", async ({ overrides, conversationId, message }) => {
  const { client } = createFakeClient(overrides);

  await expect(new ConversationStore(client as never)
    .loadOrCreate("acc_standard_001", conversationId))
    .rejects.toThrow(message);
});
