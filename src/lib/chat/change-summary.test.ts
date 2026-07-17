import { expect, it } from "vitest";

import standardFixture from "../../../fixtures/debtor-standard.json";
import { normalizeLegacyFixture } from "@/lib/account/types";
import { buildAccountHolderUpdateSummary, buildCallAppointmentCreateSummary, buildPaymentSummary, buildPromiseToPayCreateSummary, buildRelatedPersonCreateSummary, buildRelatedPersonRemoveSummary, buildRelatedPersonUpdateSummary, previewAccountHolderUpdate, previewRelatedPersonUpdate } from "./change-summary";

const holder = normalizeLegacyFixture(standardFixture).account;

it("builds a phone before-and-after update from touched fields only", () => {
  const touched = { phone: "+353831112233" };
  const after = previewAccountHolderUpdate(holder, touched);
  expect(buildAccountHolderUpdateSummary(holder, after, touched)).toEqual([{
    kind: "updated", entity: "account_holder", label: "Account details",
    fields: [{ field: "Phone", before: holder.phone, after: touched.phone }],
  }]);
});

it("returns no summary when a touched value is unchanged", () => {
  const touched = { phone: holder.phone };
  expect(buildAccountHolderUpdateSummary(holder, previewAccountHolderUpdate(holder, touched), touched)).toEqual([]);
});

it("builds a preferred-contact before-and-after update", () => {
  const touched = { preferredContactMethod: "sms" as const };
  const after = previewAccountHolderUpdate(holder, touched);
  expect(buildAccountHolderUpdateSummary(holder, after, touched)).toEqual([{
    kind: "updated", entity: "account_holder", label: "Account details",
    fields: [{ field: "Preferred contact method", before: holder.preferredContactMethod, after: "sms" }],
  }]);
});

it("builds a created related-person summary without before values", () => {
  const summary = buildRelatedPersonCreateSummary({ id: "person-002", name: "Mark Murphy", email: "mark@example.test", phone: "+353831112233", authorizedToAct: false });
  expect(summary).toEqual([{ kind: "created", entity: "related_person", label: "Mark Murphy", fields: [
    { field: "Email", after: "mark@example.test" }, { field: "Phone", after: "+353831112233" }, { field: "Authorized to act", after: "No" },
  ] }]);
});
//building a related person update summary 
it("builds only changed related-person fields", () => {
  const before = { id: "person-002", name: "Mark Murphy", email: "mark@example.test", phone: "+353831112233", authorizedToAct: false };
  const fields = { email: "new@example.test", authorizedToAct: true };
  expect(buildRelatedPersonUpdateSummary(before, previewRelatedPersonUpdate(before, fields), fields)).toEqual([{
    kind: "updated", entity: "related_person", label: "Mark Murphy", fields: [
      { field: "Email", before: "mark@example.test", after: "new@example.test" },
      { field: "Authorized to act", before: "No", after: "Yes" },
    ],
  }]);
});

it("builds a removed related-person summary without after values", () => {
  const summary = buildRelatedPersonRemoveSummary({ id: "person-002", name: "Mark Murphy", email: "mark@example.test", phone: "+353831112233", authorizedToAct: false });
  expect(summary).toEqual([{ kind: "removed", entity: "related_person", label: "Mark Murphy", fields: [
    { field: "Email", before: "mark@example.test" }, { field: "Phone", before: "+353831112233" }, { field: "Authorized to act", before: "No" },
  ] }]);
});

it("builds a created promise summary using persisted cents and date", () => {
  expect(buildPromiseToPayCreateSummary({ id: "promise-002", amountCents: 25050, currency: "EUR", dueDate: "2026-08-01", status: "active", createdAt: "2026-07-17T09:00:00Z" }))
    .toEqual([{ kind: "created", entity: "promise_to_pay", label: "Promise to pay", fields: [
      { field: "Amount", after: "€250.50" }, { field: "Due date", after: "2026-08-01" }, { field: "Status", after: "Active" },
    ] }]);
});

it("builds separate balance and transaction evidence for a payment", () => {
  const transaction = { id: "transaction-002", type: "payment" as const, status: "completed" as const, amountCents: 15000, currency: "EUR", description: "Saved details", transactionDate: "2026-07-17" };
  expect(buildPaymentSummary({ beforeBalanceCents: 128500, afterBalanceCents: 113500, transaction })).toEqual([
    { kind: "updated", entity: "account_holder", label: "Balance", fields: [{ field: "Balance", before: "€1,285.00", after: "€1,135.00" }] },
    { kind: "created", entity: "transaction", label: "Payment", fields: [{ field: "Amount", after: "€150.00" }, { field: "Status", after: "Completed" }] },
  ]);
});

it("builds a created call-appointment summary from the persisted row", () => {
  expect(buildCallAppointmentCreateSummary({ id: "call-002", scheduledAt: "2026-07-21T09:00:00.000Z", phone: "+353831234567", reason: "Discuss my account", status: "scheduled" }))
    .toEqual([{ kind: "created", entity: "call_appointment", label: "Call appointment", fields: [
      { field: "Scheduled for", after: "2026-07-21T09:00:00.000Z" }, { field: "Phone", after: "+353831234567" },
      { field: "Reason", after: "Discuss my account" }, { field: "Status", after: "Scheduled" },
    ] }]);
});
