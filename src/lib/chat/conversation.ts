import { z } from "zod";
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
