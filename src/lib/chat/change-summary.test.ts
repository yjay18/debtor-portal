import { expect, it } from "vitest";

import standardFixture from "../../../fixtures/debtor-standard.json";
import { normalizeLegacyFixture } from "@/lib/account/types";
import { buildAccountHolderUpdateSummary, buildRelatedPersonCreateSummary, previewAccountHolderUpdate } from "./change-summary";

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
