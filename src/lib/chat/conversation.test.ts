import { expect, it } from "vitest";
//tests for the same
import {
  mapConversationRow,
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
