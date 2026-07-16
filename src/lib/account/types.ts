export type ContactMethod = "email" | "sms" | "phone";

export type Address = {
  line1: string;
  line2?: string;
  city: string;
  postalCode: string;
  country: string;
};

export type AccountHolder = {
  accountId: string;
  accountHolderFirstName: string;
  accountHolderLastName: string;
  email: string;
  phone: string;
  address: Address;
  preferredContactMethod: ContactMethod;
  reference: string;
  creditorName: string;
  currency: string;
  balanceCents: number;
  status: string;
  daysPastDue: number;
  minimumPaymentCents: number;
  lastPaymentDate: string;
  lastPaymentAmountCents: number;
};

export type RelatedPerson = {
  id: string;
  name: string;
  email: string;
  phone: string;
  relationship?: string;
  authorizedToAct: boolean;
};

export type PromiseToPay = {
  id: string;
  amountCents: number;
  currency: string;
  dueDate: string;
  status: "active" | "completed" | "cancelled" | "missed";
  createdAt: string;
};

export type Transaction = {
  id: string;
  type: "payment" | "charge" | "fee" | "adjustment";
  status: "completed" | "pending" | "failed" | "posted";
  amountCents: number;
  currency: string;
  description: string;
  transactionDate: string;
};

export type CallAppointment = {
  id: string;
  scheduledAt: string;
  phone: string;
  reason?: string;
  status: "scheduled" | "cancelled" | "completed";
};

export type AccountContext = {
  account: AccountHolder;
  billing: {
    currentAmountCents: number;
    lastStatementAmountCents: number;
    dueDate: string;
  };
  paymentOptions: {
    payNowEnabled: boolean;
    promiseToPayEnabled: boolean;
    mockPaymentsEnabled: boolean;
    arrangementEnabled: boolean;
    eligibleArrangementOptions: Array<{
      frequency: string;
      installments: number;
      suggestedAmountCents: number;
    }>;
  };
  support: {
    humanSupportAvailable: boolean;
    supportPhone: string;
    supportEmail: string;
  };
  relatedPeople: RelatedPerson[];
  promisesToPay: PromiseToPay[];
  transactions: Transaction[];
  callAppointments: CallAppointment[];
  notificationRules: {
    sendEmailOnDataChange: boolean;
    pdfPasswordSource: "account_phone_last4";
  };
  faqContext?: {
    recentStatementReason?: string;
    acceptedPaymentMethods?: string[];
  };
  riskFlags?: Record<string, boolean>;
};

export type LegacyFixtureAccount = Omit<
  AccountHolder,
  | "accountHolderFirstName"
  | "accountHolderLastName"
  | "preferredContactMethod"
> & {
  debtorFirstName: string;
  debtorLastName: string;
  preferredContactMethod: string;
};

export type LegacyPromiseToPay = Omit<PromiseToPay, "status"> & {
  status: string;
};

export type LegacyTransaction = Omit<Transaction, "type" | "status"> & {
  type: string;
  status: string;
};

export type LegacyCallAppointment = Omit<CallAppointment, "status"> & {
  status: string;
};

export type LegacyAccountFixture = Omit<
  AccountContext,
  | "account"
  | "promisesToPay"
  | "transactions"
  | "callAppointments"
  | "notificationRules"
> & {
  account: LegacyFixtureAccount;
  promisesToPay: LegacyPromiseToPay[];
  transactions: LegacyTransaction[];
  callAppointments: LegacyCallAppointment[];
  notificationRules: {
    sendEmailOnDataChange: boolean;
    pdfPasswordSource: string;
  };
};

function normalizeContactMethod(value: string): ContactMethod {
  if (value === "email" || value === "sms" || value === "phone") {
    return value;
  }

  return "email";
}

export function normalizeLegacyFixture(
  fixture: LegacyAccountFixture,
): AccountContext {
  return {
    ...fixture,
    account: {
      ...fixture.account,
      accountHolderFirstName: fixture.account.debtorFirstName,
      accountHolderLastName: fixture.account.debtorLastName,
      preferredContactMethod: normalizeContactMethod(
        fixture.account.preferredContactMethod,
      ),
    },
    promisesToPay: fixture.promisesToPay as PromiseToPay[],
    transactions: fixture.transactions as Transaction[],
    callAppointments: fixture.callAppointments as CallAppointment[],
    notificationRules: {
      sendEmailOnDataChange: fixture.notificationRules.sendEmailOnDataChange,
      pdfPasswordSource: "account_phone_last4",
    },
  };
}
