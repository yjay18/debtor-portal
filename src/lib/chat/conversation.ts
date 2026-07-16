import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "../supabase/server";
//using zod to validate the chat states like we did with supabase
export const chatActionSchema = z.enum([
  "read_account", "update_account_holder", "read_preferred_contact_method",
  "update_preferred_contact_method", "add_related_person", "update_related_person",
  "remove_related_person", "read_related_people", "create_promise_to_pay",
  "read_promises_to_pay", "mock_payment", "read_transactions",
  "book_call_appointment", "read_call_appointments", "clarify", "unsupported",
]);

const queuedIntentSchema = z.object({
  action: chatActionSchema,
  fields: z.record(z.string(), z.unknown()),
});

export const dialogStateSchema = z.object({
  pendingAction: queuedIntentSchema.extend({
    missingFields: z.array(z.string().min(1)).min(1),
  }).optional(),
  queuedIntents: z.array(queuedIntentSchema).default([]),
  awaitingConfirmation: z.boolean().default(false),
});

export type DialogState = z.infer<typeof dialogStateSchema>;
export type DialogStateInput = z.input<typeof dialogStateSchema>;

export type ConversationRow = {
  id: string;
  account_holder_id: string;
  pending_action: unknown | null;
  created_at: string;
  updated_at: string;
};

export type Conversation = {
  id: string;
  accountHolderId: string;
  dialogState: DialogState;
  createdAt: string;
  updatedAt: string;
};

const messageAuditSchema = z.object({
  validationOutcome: z.string().min(1),
  notificationStatus: z.string().min(1).optional(),
  touchedIds: z.array(z.string()).default([]),
}).catchall(z.unknown());

const messageDetailsSchema = z.discriminatedUnion("role", [
  z.object({
    role: z.literal("account_holder"),
    action: z.null(),
    metadata: z.null(),
  }),
  z.object({
    role: z.literal("assistant"),
    action: chatActionSchema,
    metadata: messageAuditSchema,
  }),
]);
//enforcing authority fields using zod to enforce message structure
const newMessageSchema = z.discriminatedUnion("role", [
  z.object({
    conversationId: z.uuid(),
    role: z.literal("account_holder"),
    content: z.string().min(1),
  }).strict(),
  z.object({
    conversationId: z.uuid(),
    role: z.literal("assistant"),
    content: z.string().min(1),
    action: chatActionSchema,
    metadata: messageAuditSchema,
  }).strict(),
]);

export type NewChatMessage = z.input<typeof newMessageSchema>;

export type ChatMessageRow = {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  action: string | null;
  metadata: unknown | null;
  created_at: string;
};

type MessageBase = {
  id: string;
  conversationId: string;
  content: string;
  createdAt: string;
};

export type PersistedChatMessage = MessageBase & (
  | { role: "account_holder"; action?: never; metadata?: never }
  | {
      role: "assistant";
      action: z.infer<typeof chatActionSchema>;
      metadata: z.infer<typeof messageAuditSchema>;
    }
);

export function mapConversationRow(row: ConversationRow): Conversation {
  return {
    id: row.id,
    accountHolderId: row.account_holder_id,
    dialogState: dialogStateSchema.parse(row.pending_action ?? {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapChatMessageRow(row: ChatMessageRow): PersistedChatMessage {
  const details = messageDetailsSchema.parse(row);
  const common = {
    id: row.id,
    conversationId: row.conversation_id,
    content: row.content,
    createdAt: row.created_at,
  };

  return details.role === "account_holder"
    ? { ...common, role: details.role }
    : { ...common, ...details };
}
//tying account holder to the convo for possible legal compliance and audit, and prevent leakage of info between accs
export class ConversationStore {
  constructor(
    private readonly client: SupabaseClient = createServerSupabaseClient(),
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async loadOrCreate(
    accountId: string,
    conversationId?: string,
  ): Promise<Conversation> {
    const { data: holder, error: holderError } = await this.client
      .from("account_holders")
      .select("id")
      .eq("account_id", accountId)
      .maybeSingle();

    if (holderError) {
      throw new Error(`Failed to resolve account: ${holderError.message}`);
    }
    if (!holder) throw new Error("Account not found.");

    if (conversationId) {
      const { data, error } = await this.client
        .from("conversations")
        .select("*")
        .eq("id", conversationId)
        .eq("account_holder_id", holder.id)
        .maybeSingle();

      if (error) {
        throw new Error(`Failed to load conversation: ${error.message}`);
      }
      if (!data) throw new Error("Conversation not found for account.");

      return mapConversationRow(data as ConversationRow);
    }

    const { data, error } = await this.client
      .from("conversations")
      .insert({ account_holder_id: holder.id })
      .select("*")
      .single();

    if (error || !data) {
      throw new Error(`Failed to create conversation: ${error?.message ?? "no row returned"}`);
    }

    return mapConversationRow(data as ConversationRow);
  }
//loading messages and ensuring no cross loading data leaks between accounts
  async loadMessages(conversationId: string): Promise<PersistedChatMessage[]> {
    const validId = z.uuid().parse(conversationId);
    const { data, error } = await this.client
      .from("chat_messages")
      .select("*")
      .eq("conversation_id", validId)
      .order("created_at", { ascending: true });

    if (error) {
      throw new Error(`Failed to load conversation messages: ${error.message}`);
    }

    return (data ?? []).map((message) =>
      mapChatMessageRow(message as ChatMessageRow));
  }

  async addMessage(input: NewChatMessage): Promise<PersistedChatMessage> {
    const message = newMessageSchema.parse(input);
    const insertRow = message.role === "account_holder"
      ? {
          conversation_id: message.conversationId,
          role: message.role,
          content: message.content,
          action: null,
          metadata: null,
        }
      : {
          conversation_id: message.conversationId,
          role: message.role,
          content: message.content,
          action: message.action,
          metadata: message.metadata,
        };
    const { data, error } = await this.client
      .from("chat_messages")
      .insert(insertRow)
      .select("*")
      .single();

    if (error || !data) {
      throw new Error(`Failed to save conversation message: ${error?.message ?? "no row returned"}`);
    }

    return mapChatMessageRow(data as ChatMessageRow);
  }
//both IDs are required to ensure the conversation belongs to the account holder to prevent cross-account hacking or manipulation
  async updateDialogState(
    conversation: Pick<Conversation, "id" | "accountHolderId">,
    input: DialogStateInput,
  ): Promise<Conversation> {
    const conversationId = z.uuid().parse(conversation.id);
    const accountHolderId = z.uuid().parse(conversation.accountHolderId);
    const dialogState = dialogStateSchema.parse(input);
    const { data, error } = await this.client
      .from("conversations")
      .update({ pending_action: dialogState, updated_at: this.now() })
      .eq("id", conversationId)
      .eq("account_holder_id", accountHolderId)
      .select("*")
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to update conversation state: ${error.message}`);
    }
    if (!data) throw new Error("Conversation not found for account.");

    return mapConversationRow(data as ConversationRow);
  }
}
