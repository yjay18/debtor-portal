import type { QueuedNotificationBatch } from "./processor";

export type RedactedNotificationLog = { event: "notification_delivery_skipped"; attemptCount: number; triggerActions: string[] };
export function redactNotificationBatch(batch: QueuedNotificationBatch): RedactedNotificationLog {
  return { event: "notification_delivery_skipped", attemptCount: batch.attemptIds.length, triggerActions: [...batch.triggerActions] };
}
