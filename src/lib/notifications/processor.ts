import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { redactNotificationBatch, type RedactedNotificationLog } from "./redact";
//database schema for queued notification attempts
const queuedAttemptSchema = z.object({ id: z.uuid(), account_holder_id: z.uuid(), trigger_action: z.string().min(1) }).strict();
const updatedAttemptSchema = z.object({ id: z.uuid() }).strict();
export type QueuedNotificationBatch = { accountHolderId: string; attemptIds: string[]; triggerActions: string[] };
export type NotificationBatchStatus = "logged" | "sent" | "failed";
type ProcessorDependencies = {
  load: typeof loadQueuedNotificationBatch;
  update: typeof updateNotificationBatchStatus;
  log: (entry: RedactedNotificationLog) => void;
};
//batching notifications
export async function loadQueuedNotificationBatch(
  client: SupabaseClient,
  accountHolderId: string,
): Promise<QueuedNotificationBatch | null> {
  const { data, error } = await client.from("notification_attempts")
    .select("id,account_holder_id,trigger_action")
    .eq("account_holder_id", accountHolderId)
    .eq("status", "queued")
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Failed to load queued notifications: ${error.message}`);
//runtime validation of returned rows
  const rows = z.array(queuedAttemptSchema).parse(data ?? []);
  if (rows.length === 0) return null;
  //rechecking account auth
  if (rows.some((row) => row.account_holder_id !== accountHolderId)) throw new Error("Queued notification account mismatch.");
  return { accountHolderId, attemptIds: rows.map((row) => row.id), triggerActions: [...new Set(rows.map((row) => row.trigger_action))] };
}
//updating the status of notification 
export async function updateNotificationBatchStatus(client: SupabaseClient, batch: QueuedNotificationBatch, status: NotificationBatchStatus): Promise<void> {
  if (batch.attemptIds.length === 0) throw new Error("Notification batch has no attempts.");
  const changes = { status, error_message: status === "failed" ? "Notification delivery failed." : null };
  //we throw this error to avoid exposing details of notification system to user
  const { data, error } = await client.from("notification_attempts").update(changes)
    .eq("account_holder_id", batch.accountHolderId).eq("status", "queued")
    .in("id", batch.attemptIds).select("id");
  if (error) throw new Error(`Failed to update notification status: ${error.message}`);

  const updatedIds = new Set(z.array(updatedAttemptSchema).parse(data ?? []).map((row) => row.id));
  if (updatedIds.size !== batch.attemptIds.length || batch.attemptIds.some((id) => !updatedIds.has(id))) {
    throw new Error("Not every queued notification attempt was updated.");
  }
}

const processorDependencies: ProcessorDependencies = {
  load: loadQueuedNotificationBatch,
  update: updateNotificationBatchStatus,
  log: (entry) => console.info(entry),
};
export async function logQueuedNotifications(client: SupabaseClient, accountHolderId: string, deps: ProcessorDependencies = processorDependencies) {
  const batch = await deps.load(client, accountHolderId);
  if (!batch) return { status: "none" as const, attemptCount: 0 };
  deps.log(redactNotificationBatch(batch));
  await deps.update(client, batch, "logged");
  return { status: "logged" as const, attemptCount: batch.attemptIds.length };
}
