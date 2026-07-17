import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "../supabase/server";
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
  idempotency_key: string | null;
  created_at: string;
};

const recordPaymentRowSchema = z.object({
  transaction_id: z.uuid(),
  new_balance_cents: z.number().int().nonnegative(),
  replayed: z.boolean(),
}).strict();

export type RecordPaymentResult = {
  transaction: Transaction;
  newBalanceCents: number;
  replayed: boolean;
};

export class PaymentRepoError extends Error {
  constructor(readonly code: "insufficient_balance") {
    super(code);
  }
}

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

export type AccountHolderUpdate = {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  postalCode?: string;
  country?: string;
  preferredContactMethod?: AccountHolder["preferredContactMethod"];
};

export type RelatedPersonCreate = {
  name: string;
  email: string;
  phone: string;
  relationship?: string;
  authorizedToAct: boolean;
};

export type RelatedPersonUpdate = Partial<RelatedPersonCreate>;

export type PromiseToPayCreate = {
  amountCents: number;
  currency: string;
  dueDate: string;
};

export type CallAppointmentCreate = {
  scheduledAt: string;
  phone: string;
  reason?: string;
};

export function mapRelatedPersonCreate(fields: RelatedPersonCreate) {
  return {
    name: fields.name,
    email: fields.email,
    phone: fields.phone,
    relationship: fields.relationship ?? null,
    authorized_to_act: fields.authorizedToAct,
  };
}

export function mapRelatedPersonUpdate(fields: RelatedPersonUpdate) {
  return Object.fromEntries([
    ["name", fields.name],
    ["email", fields.email],
    ["phone", fields.phone],
    ["relationship", fields.relationship],
    ["authorized_to_act", fields.authorizedToAct],
  ].filter((entry): entry is [string, string | boolean] => entry[1] !== undefined));
}
// to convert from Typescript camelcase to posgres snake case
//and we remove undefined entries to avoid overwriting and prevent field data leakage
export function mapAccountHolderUpdate(fields: AccountHolderUpdate): Record<string, string> {
  return Object.fromEntries([
    ["first_name", fields.firstName],
    ["last_name", fields.lastName],
    ["email", fields.email],
    ["phone", fields.phone],
    ["address_line1", fields.addressLine1],
    ["address_line2", fields.addressLine2],
    ["city", fields.city],
    ["postal_code", fields.postalCode],
    ["country", fields.country],
    ["preferred_contact_method", fields.preferredContactMethod],
  ].filter((entry): entry is [string, string] => entry[1] !== undefined));
}

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
  getAccountContextByHolderId(
    accountHolderId: string,
  ): Promise<AccountContext | null>;
  updateAccountHolder(
    accountId: string,
    fields: AccountHolderUpdate,
  ): Promise<AccountHolder>;
  addRelatedPerson(
    accountId: string,
    fields: RelatedPersonCreate,
  ): Promise<RelatedPerson>;
  updateRelatedPerson(
    accountId: string,
    personId: string,
    fields: RelatedPersonUpdate,
  ): Promise<RelatedPerson>;
  deleteRelatedPerson(
    accountId: string,
    personId: string,
  ): Promise<RelatedPerson>;
  addPromiseToPay(
    accountId: string,
    fields: PromiseToPayCreate,
  ): Promise<PromiseToPay>;
  recordPayment(
    accountId: string,
    amountCents: number,
    idempotencyKey: string,
  ): Promise<RecordPaymentResult>;
  addCallAppointment(
    accountId: string,
    fields: CallAppointmentCreate,
  ): Promise<CallAppointment>;
}
//wrapper class to create supa client and fetch acc context
export class SupabaseAccountRepo implements AccountRepo {
  constructor(
    private readonly client: SupabaseClient = createServerSupabaseClient(),
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async getAccountContextByAccountId(
    accountId: string,
  ): Promise<AccountContext | null> {
    return this.loadAccountContext("account_id", accountId);
  }

  async getAccountContextByHolderId(
    accountHolderId: string,
  ): Promise<AccountContext | null> {
    return this.loadAccountContext("id", accountHolderId);
  }

  private async loadAccountContext(
    column: "account_id" | "id",
    value: string,
  ): Promise<AccountContext | null> {
    const { data: holder, error: holderError } = await this.client
      .from("account_holders")
      .select("*")
      .eq(column, value)
      .maybeSingle();

    if (holderError) {
      throw new Error(`Failed to load account: ${holderError.message}`);
    }

    if (!holder) return null;

    const [people, promises, transactions, calls] = await Promise.all([
      this.client.from("related_people").select("*").eq("account_holder_id", holder.id),
      this.client.from("promises_to_pay").select("*").eq("account_holder_id", holder.id),
      this.client.from("transactions").select("*").eq("account_holder_id", holder.id),
      this.client.from("call_appointments").select("*").eq("account_holder_id", holder.id),
    ]);
    const childError = [people, promises, transactions, calls]
      .map((result) => result.error)
      .find(Boolean);

    if (childError) {
      throw new Error(`Failed to load account details: ${childError.message}`);
    }

    return mapAccountContext(holder as AccountHolderRow, {
      relatedPeople: (people.data ?? []).map((row) => mapRelatedPersonRow(row as RelatedPersonRow)),
      promisesToPay: (promises.data ?? []).map((row) => mapPromiseToPayRow(row as PromiseToPayRow)),
      transactions: (transactions.data ?? []).map((row) => mapTransactionRow(row as TransactionRow)),
      callAppointments: (calls.data ?? []).map((row) => mapCallAppointmentRow(row as CallAppointmentRow)),
    });
  }

  async updateAccountHolder(
    accountId: string,
    fields: AccountHolderUpdate,
  ): Promise<AccountHolder> {
    const update = mapAccountHolderUpdate(fields);
    if (Object.keys(update).length === 0) {
      throw new Error("At least one account-holder field is required.");
    }

    const { data, error } = await this.client
      .from("account_holders")
      .update({ ...update, updated_at: this.now() })
      .eq("account_id", accountId)
      .select("*")
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to update account: ${error.message}`);
    }
    if (!data) throw new Error("Account not found.");

    return mapAccountHolderRow(data as AccountHolderRow);
  }
//we attach the related persons to the account holders themselves
  async addRelatedPerson(
    accountId: string,
    fields: RelatedPersonCreate,
  ): Promise<RelatedPerson> {
    const { data: holder, error: holderError } = await this.client
      .from("account_holders")
      .select("id")
      .eq("account_id", accountId)
      .maybeSingle();
    if (holderError) throw new Error(`Failed to load account: ${holderError.message}`);
    if (!holder) throw new Error("Account not found.");

    const { data, error } = await this.client
      .from("related_people")
      .insert({ account_holder_id: holder.id, ...mapRelatedPersonCreate(fields) })
      .select("*")
      .maybeSingle();
    if (error) throw new Error(`Failed to add related person: ${error.message}`);
    if (!data) throw new Error("Related person was not created.");

    return mapRelatedPersonRow(data as RelatedPersonRow);
  }
//so related person operations scoped to the account holder
  async updateRelatedPerson(
    accountId: string,
    personId: string,
    fields: RelatedPersonUpdate,
  ): Promise<RelatedPerson> {
    const update = mapRelatedPersonUpdate(fields);
    if (Object.keys(update).length === 0) throw new Error("At least one related-person field is required.");

    const { data: holder, error: holderError } = await this.client
      .from("account_holders")
      .select("id")
      .eq("account_id", accountId)
      .maybeSingle();
    if (holderError) throw new Error(`Failed to load account: ${holderError.message}`);
    if (!holder) throw new Error("Account not found.");

    const { data, error } = await this.client
      .from("related_people")
      .update({ ...update, updated_at: this.now() })
      .eq("id", personId)
      .eq("account_holder_id", holder.id)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(`Failed to update related person: ${error.message}`);
    if (!data) throw new Error("Related person not found.");

    return mapRelatedPersonRow(data as RelatedPersonRow);
  }

  async deleteRelatedPerson(
    accountId: string,
    personId: string,
  ): Promise<RelatedPerson> {
    const { data: holder, error: holderError } = await this.client
      .from("account_holders")
      .select("id")
      .eq("account_id", accountId)
      .maybeSingle();
    if (holderError) throw new Error(`Failed to load account: ${holderError.message}`);
    if (!holder) throw new Error("Account not found.");

    const { data, error } = await this.client
      .from("related_people")
      .delete()
      .eq("id", personId)
      .eq("account_holder_id", holder.id)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(`Failed to remove related person: ${error.message}`);
    if (!data) throw new Error("Related person not found.");

    return mapRelatedPersonRow(data as RelatedPersonRow);
  }

  async addPromiseToPay(
    accountId: string,
    fields: PromiseToPayCreate,
  ): Promise<PromiseToPay> {
    const { data: holder, error: holderError } = await this.client
      .from("account_holders")
      .select("id")
      .eq("account_id", accountId)
      .maybeSingle();
    if (holderError) throw new Error(`Failed to load account: ${holderError.message}`);
    if (!holder) throw new Error("Account not found.");

    const { data, error } = await this.client
      .from("promises_to_pay")
      .insert({ account_holder_id: holder.id, amount_cents: fields.amountCents, currency: fields.currency, due_date: fields.dueDate, status: "active" })
      .select("*")
      .maybeSingle();
    if (error) throw new Error(`Failed to create promise to pay: ${error.message}`);
    if (!data) throw new Error("Promise to pay was not created.");

    return mapPromiseToPayRow(data as PromiseToPayRow);
  }

  async recordPayment(
    accountId: string,
    amountCents: number,
    idempotencyKey: string,
  ): Promise<RecordPaymentResult> {
    const { data: holder, error: holderError } = await this.client
      .from("account_holders")
      .select("id")
      .eq("account_id", accountId)
      .maybeSingle();
    if (holderError) throw new Error(`Failed to load account: ${holderError.message}`);
    if (!holder) throw new Error("Account not found.");

    const { data, error } = await this.client.rpc("record_payment", {
      p_account_holder_id: holder.id,
      p_amount_cents: amountCents,
      p_idempotency_key: idempotencyKey,
    });
    if (error?.code === "23505") return this.loadConcurrentPaymentReplay(holder.id, idempotencyKey);
    if (error?.message.includes("INSUFFICIENT_BALANCE")) throw new PaymentRepoError("insufficient_balance");
    if (error) throw new Error(`Failed to record payment: ${error.message}`);

    const payment = z.array(recordPaymentRowSchema).length(1).parse(data)[0];
    const transaction = await this.loadPaymentTransaction(holder.id, "id", payment.transaction_id);
    return { transaction, newBalanceCents: payment.new_balance_cents, replayed: payment.replayed };
  }

  private async loadPaymentTransaction(holderId: string, column: "id" | "idempotency_key", value: string) {
    const { data, error } = await this.client.from("transactions").select("*")
      .eq(column, value).eq("account_holder_id", holderId).maybeSingle();
    if (error) throw new Error(`Failed to load payment transaction: ${error.message}`);
    if (!data) throw new Error("Payment transaction not found.");
    return mapTransactionRow(data as TransactionRow);
  }

  private async loadConcurrentPaymentReplay(holderId: string, idempotencyKey: string): Promise<RecordPaymentResult> {
    const [transaction, balanceResult] = await Promise.all([
      this.loadPaymentTransaction(holderId, "idempotency_key", idempotencyKey),
      this.client.from("account_holders").select("balance_cents").eq("id", holderId).maybeSingle(),
    ]);
    if (balanceResult.error) throw new Error(`Failed to load account balance: ${balanceResult.error.message}`);
    if (!balanceResult.data) throw new Error("Account not found.");
    const newBalanceCents = z.number().int().nonnegative().parse(balanceResult.data.balance_cents);
    return { transaction, newBalanceCents, replayed: true };
  }

  async addCallAppointment(
    accountId: string,
    fields: CallAppointmentCreate,
  ): Promise<CallAppointment> {
    const { data: holder, error: holderError } = await this.client
      .from("account_holders").select("id").eq("account_id", accountId).maybeSingle();
    if (holderError) throw new Error(`Failed to load account: ${holderError.message}`);
    if (!holder) throw new Error("Account not found.");

    const { data, error } = await this.client.from("call_appointments")
      .insert({ account_holder_id: holder.id, scheduled_at: fields.scheduledAt, phone: fields.phone,
        reason: fields.reason ?? null, status: "scheduled" })
      .select("*").maybeSingle();
    if (error) throw new Error(`Failed to book call appointment: ${error.message}`);
    if (!data) throw new Error("Call appointment was not created.");
    return mapCallAppointmentRow(data as CallAppointmentRow);
  }
}
