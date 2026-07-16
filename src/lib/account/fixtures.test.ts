import { describe, expect, it } from "vitest";

import disputeFixture from "../../../fixtures/debtor-dispute.json";
import hardshipFixture from "../../../fixtures/debtor-hardship.json";
import standardFixture from "../../../fixtures/debtor-standard.json";
import { normalizeLegacyFixture } from "./types";
import type { LegacyAccountFixture } from "./types";

const fixtures = [
  standardFixture,
  disputeFixture,
  hardshipFixture,
] satisfies LegacyAccountFixture[];

describe("account fixtures", () => {
  it("can be normalized into the starter account contract", () => {
    for (const fixture of fixtures) {
      const accountContext = normalizeLegacyFixture(fixture);

      expect(accountContext.account.accountHolderFirstName).toBeTruthy();
      expect(accountContext.account.accountHolderLastName).toBeTruthy();
      expect(accountContext.account.phone).toBe("+353831234567");
      expect(["email", "sms", "phone"]).toContain(
        accountContext.account.preferredContactMethod,
      );
      expect(accountContext.paymentOptions.mockPaymentsEnabled).toBe(true);
      expect(accountContext.notificationRules.pdfPasswordSource).toBe(
        "account_phone_last4",
      );
    }
  });
});
