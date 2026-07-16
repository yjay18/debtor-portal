import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "../supabase/server";
//using zod to validate the chat states like we did with supabase
const chatActionSchema = z.enum([
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

export function mapConversationRow(row: ConversationRow): Conversation {
  return {
    id: row.id,
    accountHolderId: row.account_holder_id,
    dialogState: dialogStateSchema.parse(row.pending_action ?? {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
//tying account holder to the convo for possible legal compliance and audit, and prevent leakage of info between accs
export class ConversationStore {
  constructor(
    private readonly client: SupabaseClient = createServerSupabaseClient(),
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
}
