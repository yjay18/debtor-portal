import { expect, it } from "vitest";
import {
  mapAccountContext,
  mapAccountHolderRow,
  mapAccountMeta,
  mapCallAppointmentRow,
  mapPromiseToPayRow,
  mapRelatedPersonRow,
  mapTransactionRow,
  type AccountHolderRow,
  type CallAppointmentRow,
  type PromiseToPayRow,
  type RelatedPersonRow,
  type TransactionRow,
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
//adding related person rows 
const relatedPersonRow: RelatedPersonRow = {
  id: "person-001",
  account_holder_id: "holder-001",
  name: "John Murphy",
  email: "john.murphy@example.test",
  phone: "+353831987654",
  relationship: "spouse",
  authorized_to_act: false,
  created_at: "2026-06-30T12:30:00Z",
  updated_at: "2026-06-30T12:30:00Z",
};

it("maps a related-person row into the domain contract", () => {
  expect(mapRelatedPersonRow(relatedPersonRow)).toEqual({
    id: "person-001",
    name: "John Murphy",
    email: "john.murphy@example.test",
    phone: "+353831987654",
    relationship: "spouse",
    authorizedToAct: false,
  });
});

it("maps a missing optional relationship to undefined", () => {
  expect(mapRelatedPersonRow({ ...relatedPersonRow, relationship: null }))
    .toHaveProperty("relationship", undefined);
});

const promiseRow: PromiseToPayRow = {
  id: "promise-001",
  account_holder_id: "holder-001",
  amount_cents: 25000,
  currency: "EUR",
  due_date: "2026-07-15",
  status: "active",
  created_at: "2026-06-20T10:15:00Z",
};

it("maps a promise-to-pay row into the domain contract", () => {
  expect(mapPromiseToPayRow(promiseRow)).toEqual({
    id: "promise-001",
    amountCents: 25000,
    currency: "EUR",
    dueDate: "2026-07-15",
    status: "active",
    createdAt: "2026-06-20T10:15:00Z",
  });
});

it("rejects an unsupported promise-to-pay status", () => {
  expect(() => mapPromiseToPayRow({ ...promiseRow, status: "unknown" }))
    .toThrow();
});

const transactionRow: TransactionRow = {
  id: "transaction-001",
  account_holder_id: "holder-001",
  type: "payment",
  status: "completed",
  amount_cents: 5000,
  currency: "EUR",
  description: "Card payment",
  transaction_date: "2026-01-10",
  created_at: "2026-01-10T09:00:00Z",
};

it("maps a transaction row into the domain contract", () => {
  expect(mapTransactionRow(transactionRow)).toEqual({
    id: "transaction-001",
    type: "payment",
    status: "completed",
    amountCents: 5000,
    currency: "EUR",
    description: "Card payment",
    transactionDate: "2026-01-10",
  });
});

it.each([
  { field: "type", invalidRow: { ...transactionRow, type: "refund" } },
  { field: "status", invalidRow: { ...transactionRow, status: "unknown" } },
])("rejects an unsupported transaction $field", ({ invalidRow }) => {
  expect(() => mapTransactionRow(invalidRow)).toThrow();
});

const callRow: CallAppointmentRow = {
  id: "call-001",
  account_holder_id: "holder-001",
  scheduled_at: "2026-07-20T10:30:00Z",
  phone: "+353831234567",
  reason: "Discuss the balance",
  status: "scheduled",
  created_at: "2026-07-16T09:00:00Z",
  updated_at: "2026-07-16T09:00:00Z",
};

it("maps a call-appointment row into the domain contract", () => {
  expect(mapCallAppointmentRow(callRow)).toEqual({
    id: "call-001",
    scheduledAt: "2026-07-20T10:30:00Z",
    phone: "+353831234567",
    reason: "Discuss the balance",
    status: "scheduled",
  });
});

it("maps a missing call reason to undefined", () => {
  expect(mapCallAppointmentRow({ ...callRow, reason: null }))
    .toHaveProperty("reason", undefined);
});

it("rejects an unsupported call status", () => {
  expect(() => mapCallAppointmentRow({ ...callRow, status: "unknown" }))
    .toThrow();
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

const collections = { relatedPeople: [], promisesToPay: [], transactions: [], callAppointments: [] };

it("assembles the complete account context", () => {
  const context = mapAccountContext({ ...row, meta }, collections);

  expect(context).toMatchObject({
    account: { accountId: "acc_standard_001" },
    billing: { currentAmountCents: 128500, lastStatementAmountCents: 116000, dueDate: "2026-01-24" },
    support: meta.support,
    paymentOptions: meta.paymentOptions,
    ...collections,
  });
});

it.each([
  { name: "missing billing due date", invalidRow: { ...row, meta, billing_due_date: null } },
  { name: "missing statement amount", invalidRow: { ...row, meta, last_statement_amount_cents: null } },
  { name: "malformed metadata", invalidRow: { ...row, meta: {} } },
])("rejects account context with $name", ({ invalidRow }) => {
  expect(() => mapAccountContext(invalidRow, collections)).toThrow();
});
