import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseAccountRepo } from "../account/repo";
import { sendAccountChangeNotification } from "./account-change-notification";
//database schema for queued notification attempts
const queuedAttemptSchema = z.object({ id: z.uuid(), account_holder_id: z.uuid(), trigger_action: z.string().min(1) }).strict();
const updatedAttemptSchema = z.object({ id: z.uuid() }).strict();
export type QueuedNotificationBatch = { accountHolderId: string; attemptIds: string[]; triggerActions: string[] };
export type NotificationBatchStatus = "logged" | "sent" | "failed";
type ProcessorDependencies = {
  load: typeof loadQueuedNotificationBatch;
  update: typeof updateNotificationBatchStatus;
  loadAccount: (accountHolderId: string) => ReturnType<SupabaseAccountRepo["getAccountContextByHolderId"]>;
  notify: typeof sendAccountChangeNotification;
};
//batching notifications
export async function loadQueuedNotificationBatch(
  client: SupabaseClient,
  accountHolderId: string,
): Promise<QueuedNotificationBatch | null> {
  const { data, error } = await client.from("notification_attempts")
    .select("id,account_holder_id,trigger_action")
    .eq("account_holder_id", accountHolderId)
    .in("status", ["queued", "failed"])
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
    .eq("account_holder_id", batch.accountHolderId).in("status", ["queued", "failed"])
    .in("id", batch.attemptIds).select("id");
  if (error) throw new Error(`Failed to update notification status: ${error.message}`);

  const updatedIds = new Set(z.array(updatedAttemptSchema).parse(data ?? []).map((row) => row.id));
  if (updatedIds.size !== batch.attemptIds.length || batch.attemptIds.some((id) => !updatedIds.has(id))) {
    throw new Error("Not every queued notification attempt was updated.");
  }
}

export async function processQueuedNotifications(client: SupabaseClient, accountHolderId: string, deps?: ProcessorDependencies) {
  const repo = new SupabaseAccountRepo(client);
  const resolved = deps ?? {
    load: loadQueuedNotificationBatch,
    update: updateNotificationBatchStatus,
    loadAccount: (id: string) => repo.getAccountContextByHolderId(id),
    notify: sendAccountChangeNotification,
  };
  const batch = await resolved.load(client, accountHolderId);
  if (!batch) return { status: "none" as const, attemptCount: 0 };
  let status: Exclude<NotificationBatchStatus, "failed">;
  try {
    const snapshot = await resolved.loadAccount(accountHolderId);
    if (!snapshot) throw new Error("Notification account was not found.");
    const delivery = await resolved.notify({
      accountId: snapshot.account.accountId,
      changedBy: "account_holder",
      changeSummary: batch.triggerActions.join(", "),
      accountSnapshot: snapshot,
    });
    status = delivery.sent ? "sent" : "logged";
  } catch {
    await resolved.update(client, batch, "failed");
    return { status: "failed" as const, attemptCount: batch.attemptIds.length };
  }
  await resolved.update(client, batch, status);
  return { status, attemptCount: batch.attemptIds.length };
}
