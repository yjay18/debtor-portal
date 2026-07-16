import { expect, it } from "vitest";

import standardFixture from "../../../fixtures/debtor-standard.json";
import { normalizeLegacyFixture } from "@/lib/account/types";
import { buildAccountHolderUpdateSummary, previewAccountHolderUpdate } from "./change-summary";

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
