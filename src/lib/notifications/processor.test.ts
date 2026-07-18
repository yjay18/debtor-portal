import { expect, it, vi } from "vitest";

import standardFixture from "../../../fixtures/debtor-standard.json";
import { normalizeLegacyFixture } from "@/lib/account/types";
import { loadQueuedNotificationBatch, processQueuedNotifications, updateNotificationBatchStatus } from "./processor";

const accountHolderId = "11111111-1111-4111-8111-111111111111";
function createClient(result: unknown) {
  const order = vi.fn().mockResolvedValue(result);
  const query = { eq: vi.fn(), in: vi.fn(), order };
  query.eq.mockReturnValue(query); query.in.mockReturnValue(query);
  const select = vi.fn().mockReturnValue(query);
  const from = vi.fn().mockReturnValue({ select });
  return { client: { from } as never, from, query };
}

function createUpdateClient(result: unknown) {
  const select = vi.fn().mockResolvedValue(result);
  const query = { eq: vi.fn(), in: vi.fn(), select };
  query.eq.mockReturnValue(query); query.in.mockReturnValue(query);
  const update = vi.fn().mockReturnValue(query);
  return { client: { from: vi.fn().mockReturnValue({ update }) } as never, query, update };
}

it("loads oldest-first queued and failed attempts into one deduplicated batch", async () => {
  const rows = [{ id: "22222222-2222-4222-8222-222222222222", account_holder_id: accountHolderId, trigger_action: "account_holders:update" }, { id: "33333333-3333-4333-8333-333333333333", account_holder_id: accountHolderId, trigger_action: "account_holders:update" }];
  const fake = createClient({ data: rows, error: null });
  await expect(loadQueuedNotificationBatch(fake.client, accountHolderId)).resolves.toEqual({ accountHolderId, attemptIds: rows.map((row) => row.id), triggerActions: ["account_holders:update"] });
  expect(fake.query.eq).toHaveBeenCalledWith("account_holder_id", accountHolderId);
  expect(fake.query.in).toHaveBeenCalledWith("status", ["queued", "failed"]);
  expect(fake.query.order).toHaveBeenCalledWith("created_at", { ascending: true });
});

it("returns null for an empty queue", async () => expect(loadQueuedNotificationBatch(createClient({ data: [], error: null }).client, accountHolderId)).resolves.toBeNull());
it("fails closed on a queue query error", async () => expect(loadQueuedNotificationBatch(createClient({ data: null, error: { message: "unavailable" } }).client, accountHolderId)).rejects.toThrow("Failed to load queued notifications: unavailable"));
it("rejects malformed queue rows", async () => expect(loadQueuedNotificationBatch(createClient({ data: [{ id: "bad" }], error: null }).client, accountHolderId)).rejects.toThrow());
it("rejects cross-account rows", async () => expect(loadQueuedNotificationBatch(createClient({ data: [{ id: "22222222-2222-4222-8222-222222222222", account_holder_id: "99999999-9999-4999-8999-999999999999", trigger_action: "account_holders:update" }], error: null }).client, accountHolderId)).rejects.toThrow("Queued notification account mismatch."));

const batch = { accountHolderId, attemptIds: ["22222222-2222-4222-8222-222222222222"], triggerActions: ["account_holders:update"] };
const accountSnapshot = normalizeLegacyFixture(standardFixture);
it.each([["logged", null], ["sent", null], ["failed", "Notification delivery failed."]] as const)("marks a batch %s with safe error data", async (status, errorMessage) => {
  const fake = createUpdateClient({ data: [{ id: batch.attemptIds[0] }], error: null });
  await updateNotificationBatchStatus(fake.client, batch, status);
  expect(fake.update).toHaveBeenCalledWith({ status, error_message: errorMessage });
  expect(fake.query.eq).toHaveBeenCalledWith("account_holder_id", accountHolderId);
  expect(fake.query.in.mock.calls).toEqual([["status", ["queued", "failed"]], ["id", batch.attemptIds]]);
});
it("rejects an empty batch", async () => expect(updateNotificationBatchStatus(createUpdateClient({ data: [], error: null }).client, { ...batch, attemptIds: [] }, "logged")).rejects.toThrow("Notification batch has no attempts."));
it("rejects a status query error", async () => expect(updateNotificationBatchStatus(createUpdateClient({ data: null, error: { message: "unavailable" } }).client, batch, "sent")).rejects.toThrow("Failed to update notification status: unavailable"));
it("rejects a partial status update", async () => expect(updateNotificationBatchStatus(createUpdateClient({ data: [], error: null }).client, batch, "sent")).rejects.toThrow("Not every queued notification attempt was updated."));

it("does nothing when no notification is queued", async () => {
  const deps = { load: vi.fn().mockResolvedValue(null), update: vi.fn(), loadAccount: vi.fn(), notify: vi.fn() };
  await expect(processQueuedNotifications({} as never, accountHolderId, deps)).resolves.toEqual({ status: "none", attemptCount: 0 });
  expect(deps.loadAccount).not.toHaveBeenCalled(); expect(deps.notify).not.toHaveBeenCalled(); expect(deps.update).not.toHaveBeenCalled();
});
it.each([[true, "sent"], [false, "logged"]] as const)("maps sent=%s delivery to %s", async (sent, status) => {
  const deps = { load: vi.fn().mockResolvedValue(batch), update: vi.fn(), loadAccount: vi.fn().mockResolvedValue(accountSnapshot),
    notify: vi.fn().mockResolvedValue({ notificationId: "delivery-id", sent, redactedRecipient: "masked" }) };
  await expect(processQueuedNotifications({} as never, accountHolderId, deps)).resolves.toEqual({ status, attemptCount: 1 });
  expect(deps.loadAccount).toHaveBeenCalledWith(accountHolderId);
  expect(deps.notify).toHaveBeenCalledWith(expect.objectContaining({ accountId: "acc_standard_001", accountSnapshot }));
  expect(deps.update).toHaveBeenCalledWith(expect.anything(), batch, status);
});
it("marks the batch failed without exposing a delivery exception", async () => {
  const deps = { load: vi.fn().mockResolvedValue(batch), update: vi.fn(), loadAccount: vi.fn().mockResolvedValue(accountSnapshot),
    notify: vi.fn().mockRejectedValue(new Error("private provider detail")) };
  await expect(processQueuedNotifications({} as never, accountHolderId, deps)).resolves.toEqual({ status: "failed", attemptCount: 1 });
  expect(deps.update).toHaveBeenCalledWith(expect.anything(), batch, "failed");
});
