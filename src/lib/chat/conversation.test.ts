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
      missing: ["email"],
    },
    queuedIntents: [{ action: "read_transactions", fields: {} }],
    awaitingConfirmation: {
      kind: "next_intent",
      intent: { action: "read_transactions", fields: {} },
    },
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
    .toEqual({ queuedIntents: [] });
});

it("validates a related-person removal confirmation", () => {
  const awaitingConfirmation = {
    kind: "remove_related_person",
    personId: "00000000-0000-4000-8000-000000000003",
    personName: "John Murphy",
  };
  expect(mapConversationRow({
    ...row,
    pending_action: { awaitingConfirmation },
  }).dialogState).toEqual({ queuedIntents: [], awaitingConfirmation });
});

it.each([
  { name: "unknown action", state: { queuedIntents: [{ action: "delete_account", fields: {} }] } },
  {
    name: "empty missing-fields list",
    state: {
      pendingAction: { action: "update_account_holder", fields: {}, missing: [] },
    },
  },
  { name: "untyped confirmation", state: { awaitingConfirmation: true } },
  {
    name: "invalid removal person ID",
    state: {
      awaitingConfirmation: {
        kind: "remove_related_person",
        personId: "person-001",
        personName: "John Murphy",
      },
    },
  },
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
    dialogState: { queuedIntents: [] },
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

const persistedConversationId = "00000000-0000-4000-8000-000000000001";

function createMessageClient(overrides: {
  history?: FakeResult;
  inserted?: FakeResult;
} = {}) {
  const history = overrides.history ?? {
    data: [
      { ...accountHolderMessageRow, conversation_id: persistedConversationId },
      { ...assistantMessageRow, conversation_id: persistedConversationId },
    ],
    error: null,
  };
  const inserted = overrides.inserted ?? {
    data: {
      ...assistantMessageRow,
      conversation_id: persistedConversationId,
      metadata: { validationOutcome: "accepted", touchedIds: [] },
    },
    error: null,
  };
  const order = vi.fn(() => Promise.resolve(history));
  const insert = vi.fn(() => ({
    select: () => ({ single: () => Promise.resolve(inserted) }),
  }));
  const from = vi.fn(() => ({
    select: () => ({
      eq: () => ({ order }),
    }),
    insert,
  }));

  return { client: { from }, from, order, insert };
}

it("loads messages in chronological order", async () => {
  const { client, from, order } = createMessageClient();
  const messages = await new ConversationStore(client as never)
    .loadMessages(persistedConversationId);

  expect(messages.map((message) => message.role))
    .toEqual(["account_holder", "assistant"]);
  expect(from).toHaveBeenCalledWith("chat_messages");
  expect(order).toHaveBeenCalledWith("created_at", { ascending: true });
});

it("surfaces a message-history query error", async () => {
  const { client } = createMessageClient({
    history: { data: null, error: { message: "history unavailable" } },
  });

  await expect(new ConversationStore(client as never)
    .loadMessages(persistedConversationId))
    .rejects.toThrow("Failed to load conversation messages: history unavailable");
});

it("inserts an account-holder message with null audit fields", async () => {
  const insertedRow = {
    ...accountHolderMessageRow,
    conversation_id: persistedConversationId,
  };
  const { client, insert } = createMessageClient({
    inserted: { data: insertedRow, error: null },
  });

  await new ConversationStore(client as never).addMessage({
    conversationId: persistedConversationId,
    role: "account_holder",
    content: "Show me my transactions",
  });
  expect(insert).toHaveBeenCalledWith({
    conversation_id: persistedConversationId,
    role: "account_holder",
    content: "Show me my transactions",
    action: null,
    metadata: null,
  });
});

it("inserts an assistant message with audit metadata", async () => {
  const { client, insert } = createMessageClient();

  await new ConversationStore(client as never).addMessage({
    conversationId: persistedConversationId,
    role: "assistant",
    content: "Here are your transactions.",
    action: "read_transactions",
    metadata: { validationOutcome: "accepted" },
  });
  expect(insert).toHaveBeenCalledWith(expect.objectContaining({
    action: "read_transactions",
    metadata: { validationOutcome: "accepted", touchedIds: [] },
  }));
});

it.each([
  {
    name: "non-UUID conversation ID",
    input: { conversationId: "starter-conversation", role: "account_holder", content: "Hello" },
  },
  {
    name: "empty content",
    input: { conversationId: persistedConversationId, role: "account_holder", content: "" },
  },
  {
    name: "customer action claim",
    input: {
      conversationId: persistedConversationId,
      role: "account_holder",
      content: "Hello",
      action: "read_account",
    },
  },
  {
    name: "assistant without audit fields",
    input: {
      conversationId: persistedConversationId,
      role: "assistant",
      content: "Hello",
    },
  },
])("rejects an invalid new message with $name", async ({ input }) => {
  const { client, insert } = createMessageClient();

  await expect(new ConversationStore(client as never).addMessage(input as never))
    .rejects.toThrow();
  expect(insert).not.toHaveBeenCalled();
});

it("surfaces a message insert error", async () => {
  const { client } = createMessageClient({
    inserted: { data: null, error: { message: "message unavailable" } },
  });

  await expect(new ConversationStore(client as never).addMessage({
    conversationId: persistedConversationId,
    role: "account_holder",
    content: "Hello",
  })).rejects.toThrow("Failed to save conversation message: message unavailable");
});

const persistedHolderId = "00000000-0000-4000-8000-000000000002";
const updatedAt = "2026-07-16T14:30:00.000Z";

function createStateClient(result: FakeResult = {
  data: {
    ...row,
    id: persistedConversationId,
    account_holder_id: persistedHolderId,
    pending_action: {
      queuedIntents: [{ action: "read_transactions", fields: {} }],
      awaitingConfirmation: {
        kind: "next_intent",
        intent: { action: "read_transactions", fields: {} },
      },
    },
    updated_at: updatedAt,
  },
  error: null,
}) {
  const filters: Array<[string, string]> = [];
  const update = vi.fn(() => ({
    eq: (column: string, value: string) => {
      filters.push([column, value]);
      return { eq: (nextColumn: string, nextValue: string) => {
        filters.push([nextColumn, nextValue]);
        return {
          select: () => ({ maybeSingle: () => Promise.resolve(result) }),
        };
      } };
    },
  }));
  const from = vi.fn(() => ({ update }));

  return { client: { from }, from, update, filters };
}

it("updates validated dialog state within its account", async () => {
  const { client, from, update, filters } = createStateClient();
  const conversation = await new ConversationStore(client as never, () => updatedAt)
    .updateDialogState(
      { id: persistedConversationId, accountHolderId: persistedHolderId },
      {
        queuedIntents: [{ action: "read_transactions", fields: {} }],
        awaitingConfirmation: {
          kind: "next_intent",
          intent: { action: "read_transactions", fields: {} },
        },
      },
    );

  expect(from).toHaveBeenCalledWith("conversations");
  expect(update).toHaveBeenCalledWith({
    pending_action: {
      queuedIntents: [{ action: "read_transactions", fields: {} }],
      awaitingConfirmation: {
        kind: "next_intent",
        intent: { action: "read_transactions", fields: {} },
      },
    },
    updated_at: updatedAt,
  });
  expect(filters).toEqual([
    ["id", persistedConversationId],
    ["account_holder_id", persistedHolderId],
  ]);
  expect(conversation.updatedAt).toBe(updatedAt);
});

it.each([
  {
    name: "invalid conversation ID",
    conversation: { id: "starter-conversation", accountHolderId: persistedHolderId },
    state: {},
  },
  {
    name: "invalid account-holder ID",
    conversation: { id: persistedConversationId, accountHolderId: "holder-001" },
    state: {},
  },
  {
    name: "invalid dialog action",
    conversation: { id: persistedConversationId, accountHolderId: persistedHolderId },
    state: { queuedIntents: [{ action: "delete_account", fields: {} }] },
  },
])("rejects $name before updating", async ({ conversation, state }) => {
  const { client, update } = createStateClient();

  await expect(new ConversationStore(client as never)
    .updateDialogState(conversation, state as never))
    .rejects.toThrow();
  expect(update).not.toHaveBeenCalled();
});

it.each([
  {
    name: "database error",
    result: { data: null, error: { message: "state unavailable" } },
    message: "Failed to update conversation state: state unavailable",
  },
  {
    name: "ownership mismatch",
    result: { data: null, error: null },
    message: "Conversation not found for account.",
  },
])("fails safely for a state $name", async ({ result, message }) => {
  const { client } = createStateClient(result);

  await expect(new ConversationStore(client as never)
    .updateDialogState(
      { id: persistedConversationId, accountHolderId: persistedHolderId },
      {},
    )).rejects.toThrow(message);
});
