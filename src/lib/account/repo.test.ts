import { expect, it } from "vitest";
import {
  mapAccountHolderRow,
  mapAccountMeta,
  type AccountHolderRow,
} from "./repo";
//testing important fields with this one
const row: AccountHolderRow = {
  id: "holder-001",
  account_id: "acc_standard_001",
  first_name: "Jane",
  last_name: "Murphy",
  email: "jane.murphy@example.test",
  phone: "+353831234567",
  address_line1: "12 River Walk",
  address_line2: null,
  city: "Dublin",
  postal_code: "D06 X123",
  country: "Ireland",
  preferred_contact_method: "email",
  reference: "EI-2026-000123",
  creditor_name: "Example Energy Ireland",
  currency: "EUR",
  balance_cents: 128500,
  status: "overdue",
  days_past_due: 47,
  minimum_payment_cents: 2500,
  last_payment_date: "2026-01-10",
  last_payment_amount_cents: 5000,
  billing_due_date: "2026-01-24",
  last_statement_amount_cents: 116000,
  meta: {},
  created_at: "2026-06-30T12:30:00Z",
  updated_at: "2026-06-30T12:30:00Z",
};
//failure tests
it("maps an account-holder row into the domain contract", () => {
  const account = mapAccountHolderRow(row);

  expect(account).toMatchObject({
    accountId: "acc_standard_001",
    accountHolderFirstName: "Jane",
    accountHolderLastName: "Murphy",
    address: { line1: "12 River Walk", line2: undefined },
    preferredContactMethod: "email",
    balanceCents: 128500,
    lastPaymentDate: "2026-01-10",
  });
  expect(account).not.toHaveProperty("account_id");
});

it("rejects an unsupported stored contact method", () => {
  const invalidRow: AccountHolderRow = {
    ...row,
    preferred_contact_method: "carrier_pigeon",
  };

  expect(() => mapAccountHolderRow(invalidRow)).toThrow(
    "Account holder has an invalid contact method.",
  );
});

it("rejects a missing last payment date", () => {
  const invalidRow: AccountHolderRow = {
    ...row,
    last_payment_date: null,
  };

  expect(() => mapAccountHolderRow(invalidRow)).toThrow(
    "Account holder is missing a last payment date.",
  );
});

const meta = {
  support: {
    humanSupportAvailable: true,
    supportPhone: "+35318000000",
    supportEmail: "support@example.test",
  },
  paymentOptions: {
    payNowEnabled: true,
    promiseToPayEnabled: true,
    mockPaymentsEnabled: true,
    arrangementEnabled: false,
    eligibleArrangementOptions: [],
  },
  notificationRules: {
    sendEmailOnDataChange: true,
    pdfPasswordSource: "account_phone_last4",
  },
  faqContext: {
    recentStatementReason: "Higher winter usage",
    acceptedPaymentMethods: ["card"],
  },
  riskFlags: { disputeOpen: false },
};

it("validates complete account metadata", () => {
  expect(mapAccountMeta(meta)).toEqual(meta);
});

it.each([
  { name: "missing required sections", value: {} },
  {
    name: "invalid support email",
    value: { ...meta, support: { ...meta.support, supportEmail: "invalid" } },
  },
  {
    name: "string payment flag",
    value: { ...meta, paymentOptions: { ...meta.paymentOptions, payNowEnabled: "yes" } },
  },
  {
    name: "invalid arrangement values",
    value: {
      ...meta,
      paymentOptions: {
        ...meta.paymentOptions,
        eligibleArrangementOptions: [
          { frequency: "", installments: 0, suggestedAmountCents: -1 },
        ],
      },
    },
  },
  {
    name: "wrong PDF password source",
    value: { ...meta, notificationRules: { ...meta.notificationRules, pdfPasswordSource: "phone" } },
  },
  { name: "non-boolean risk flag", value: { ...meta, riskFlags: { disputeOpen: "no" } } },
])("rejects metadata with $name", ({ value }) => {
  expect(() => mapAccountMeta(value)).toThrow();
});
