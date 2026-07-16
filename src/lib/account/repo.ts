import { z } from "zod";
//adding zod library to validate the fields, as typescript cannot inspect at runtime
import type {
  AccountContext,
  AccountHolder,
  CallAppointment,
  PromiseToPay,
  RelatedPerson,
  Transaction,
} from "./types";

const accountMetaSchema = z.object({
  support: z.object({
    humanSupportAvailable: z.boolean(),
    supportPhone: z.string().min(1),
    supportEmail: z.email(),
  }),
  paymentOptions: z.object({
    payNowEnabled: z.boolean(),
    promiseToPayEnabled: z.boolean(),
    mockPaymentsEnabled: z.boolean(),
    arrangementEnabled: z.boolean(),
    eligibleArrangementOptions: z.array(
      z.object({
        frequency: z.string().min(1),
        installments: z.number().int().positive(),
        suggestedAmountCents: z.number().int().nonnegative(),
      }),
    ),
  }),
  notificationRules: z.object({
    sendEmailOnDataChange: z.boolean(),
    pdfPasswordSource: z.literal("account_phone_last4"),
  }),
  faqContext: z
    .object({
      recentStatementReason: z.string().optional(),
      acceptedPaymentMethods: z.array(z.string()).optional(),
    })
    .optional(),
  riskFlags: z.record(z.string(), z.boolean()).optional(),
});

export function mapAccountMeta(meta: unknown) {
  return accountMetaSchema.parse(meta);
}

export type AccountHolderRow = {
  id: string;
  account_id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  address_line1: string;
  address_line2: string | null;
  city: string;
  postal_code: string;
  country: string;
  preferred_contact_method: string;
  reference: string;
  creditor_name: string;
  currency: string;
  balance_cents: number;
  status: string;
  days_past_due: number;
  minimum_payment_cents: number;
  last_payment_date: string | null;
  last_payment_amount_cents: number;
  billing_due_date: string | null;
  last_statement_amount_cents: number | null;
  meta: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};
//added three rows above and to supabase
//contact method types and wrapper function to map the row to the AccountHolder type
export function mapAccountHolderRow(row: AccountHolderRow): AccountHolder {
  const contactMethod = row.preferred_contact_method;

  if (
    contactMethod !== "email" &&
    contactMethod !== "sms" &&
    contactMethod !== "phone"
  ) {
    throw new Error("Account holder has an invalid contact method.");
  }
//altho null is allowed, seeded Jane account does have a payment date
  if (!row.last_payment_date) {
    throw new Error("Account holder is missing a last payment date.");
  }

  return {
    accountId: row.account_id,
    accountHolderFirstName: row.first_name,
    accountHolderLastName: row.last_name,
    email: row.email,
    phone: row.phone,
    address: {
      line1: row.address_line1,
      line2: row.address_line2 ?? undefined,
      city: row.city,
      postalCode: row.postal_code,
      country: row.country,
    }, //mapping money, UI will convert to fp, but here we preserve the accuracy
    preferredContactMethod: contactMethod,
    reference: row.reference,
    creditorName: row.creditor_name,
    currency: row.currency,
    balanceCents: row.balance_cents,
    status: row.status,
    daysPastDue: row.days_past_due,
    minimumPaymentCents: row.minimum_payment_cents,
    lastPaymentDate: row.last_payment_date,
    lastPaymentAmountCents: row.last_payment_amount_cents,
  };
}

export type RelatedPersonRow = {
  id: string;
  account_holder_id: string;
  name: string;
  email: string;
  phone: string;
  relationship: string | null;
  authorized_to_act: boolean;
  created_at: string;
  updated_at: string;
};

export function mapRelatedPersonRow(row: RelatedPersonRow): RelatedPerson {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    relationship: row.relationship ?? undefined,
    authorizedToAct: row.authorized_to_act,
  };
}

export type PromiseToPayRow = {
  id: string;
  account_holder_id: string;
  amount_cents: number;
  currency: string;
  due_date: string;
  status: string;
  created_at: string;
};

const promiseStatusSchema = z.enum(["active", "completed", "cancelled", "missed"]);

export function mapPromiseToPayRow(row: PromiseToPayRow): PromiseToPay {
  return {
    id: row.id,
    amountCents: row.amount_cents,
    currency: row.currency,
    dueDate: row.due_date,
    status: promiseStatusSchema.parse(row.status),
    createdAt: row.created_at,
  };
}

export type TransactionRow = {
  id: string;
  account_holder_id: string;
  type: string;
  status: string;
  amount_cents: number;
  currency: string;
  description: string;
  transaction_date: string;
  created_at: string;
};

const transactionTypeSchema = z.enum(["payment", "charge", "fee", "adjustment"]);
const transactionStatusSchema = z.enum(["completed", "pending", "failed", "posted"]);

export function mapTransactionRow(row: TransactionRow): Transaction {
  return {
    id: row.id,
    type: transactionTypeSchema.parse(row.type),
    status: transactionStatusSchema.parse(row.status),
    amountCents: row.amount_cents,
    currency: row.currency,
    description: row.description,
    transactionDate: row.transaction_date,
  };
}

export type CallAppointmentRow = {
  id: string;
  account_holder_id: string;
  scheduled_at: string;
  phone: string;
  reason: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

const callStatusSchema = z.enum(["scheduled", "cancelled", "completed"]);

export function mapCallAppointmentRow(row: CallAppointmentRow): CallAppointment {
  return {
    id: row.id,
    scheduledAt: row.scheduled_at,
    phone: row.phone,
    reason: row.reason ?? undefined,
    status: callStatusSchema.parse(row.status),
  };
}

type AccountCollections = Pick<AccountContext, "relatedPeople" | "promisesToPay" | "transactions" | "callAppointments">;

export function mapAccountContext(
  row: AccountHolderRow,
  collections: AccountCollections,
): AccountContext {
  if (!row.billing_due_date) {
    throw new Error("Account holder is missing a billing due date.");
  }

  if (row.last_statement_amount_cents === null) {
    throw new Error("Account holder is missing a last statement amount.");
  }

  return {
    account: mapAccountHolderRow(row),
    billing: {
      currentAmountCents: row.balance_cents,
      lastStatementAmountCents: row.last_statement_amount_cents,
      dueDate: row.billing_due_date,
    },
    ...mapAccountMeta(row.meta),
    ...collections,
  };
}

export interface AccountRepo {
  getAccountContextByAccountId(
    accountId: string,
  ): Promise<AccountContext | null>;
}
