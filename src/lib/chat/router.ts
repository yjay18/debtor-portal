import { PaymentRepoError, type AccountRepo } from "@/lib/account/repo";
import type { AccountContext, CallAppointment, RelatedPerson } from "@/lib/account/types";
import type { ChatActionResult } from "@/lib/chat/types";
import { buildAccountHolderUpdateSummary, buildCallAppointmentCreateSummary, buildPaymentSummary, buildPromiseToPayCreateSummary, buildRelatedPersonCreateSummary, buildRelatedPersonRemoveSummary, buildRelatedPersonUpdateSummary, previewAccountHolderUpdate, previewRelatedPersonUpdate } from "@/lib/chat/change-summary";
import { resolveRelatedPerson } from "@/lib/chat/disambiguate";
import { validateAccountHolderUpdate, validateCallAppointmentCreate, validateMockPayment, validatePreferredContactMethodUpdate, validatePromiseToPayCreate, validateRelatedPersonCreate, validateRelatedPersonRemove, validateRelatedPersonUpdate } from "@/lib/chat/validation";
import type { ParsedIntent } from "@/lib/llm/parser-schema";
//actions supported by the read only route
export type ReadAction =
  | "read_account"
  | "read_preferred_contact_method"
  | "read_related_people"
  | "read_promises_to_pay"
  | "read_transactions"
  | "read_call_appointments";

// "unsupported" and "clarify" are also valid actions, but they are handled separately in the router
export type ReadIntent = Extract<
  ParsedIntent,
  { action: ReadAction | "clarify" | "unsupported" }
>;
type AccountUpdateIntent = Extract<ParsedIntent, { action: "update_account_holder" }>;
type PreferredContactMethodUpdateIntent = Extract<ParsedIntent, { action: "update_preferred_contact_method" }>;
type RelatedPersonCreateIntent = Extract<ParsedIntent, { action: "add_related_person" }>;
type RelatedPersonUpdateIntent = Extract<ParsedIntent, { action: "update_related_person" }>;
type RelatedPersonRemoveIntent = Extract<ParsedIntent, { action: "remove_related_person" }>;
type PromiseToPayCreateIntent = Extract<ParsedIntent, { action: "create_promise_to_pay" }>;
type MockPaymentIntent = Extract<ParsedIntent, { action: "mock_payment" }>;
type CallAppointmentCreateIntent = Extract<ParsedIntent, { action: "book_call_appointment" }>;
//from routing
const readIntentActions = new Set<ParsedIntent["action"]>([
  "read_account",
  "read_preferred_contact_method",
  "read_related_people",
  "read_promises_to_pay",
  "read_transactions",
  "read_call_appointments",
  "clarify",
  "unsupported",
]);

export function isReadIntent(intent: ParsedIntent): intent is ReadIntent {
  return readIntentActions.has(intent.action);
}
//update acc and notification queue
export async function routeAccountHolderUpdate(input: {
  accountId: string;
  account: AccountContext;
  intent: AccountUpdateIntent;
  repo: Pick<AccountRepo, "updateAccountHolder">;
}): Promise<ChatActionResult> {
  const validation = validateAccountHolderUpdate(input.intent);
  if (validation.status === "clarify") {
    return { action: "clarify", success: false,
      reply: validation.intent.clarificationQuestion ?? "What account detail should I use?",
      missingFields: validation.intent.missingFields };
  }
  const before = input.account.account;
  const preview = previewAccountHolderUpdate(before, validation.fields);
  if (buildAccountHolderUpdateSummary(before, preview, validation.fields).length === 0) {
    return { action: "update_account_holder", success: true,
      reply: "Those account details are already up to date.", account: input.account, changeSummary: [] };
  }
  const updated = await input.repo.updateAccountHolder(input.accountId, validation.fields);
  const reply = validation.fields.phone && Object.keys(validation.fields).length === 1
    ? `Phone updated to ${updated.phone}.`
    : "Your account details were updated.";
  return {
    action: "update_account_holder",
    success: true,
    reply,
    account: { ...input.account, account: updated },
    notificationQueued: true,
    changeSummary: buildAccountHolderUpdateSummary(before, updated, validation.fields),
  };
}

export async function routePreferredContactMethodUpdate(input: {
  accountId: string;
  account: AccountContext;
  intent: PreferredContactMethodUpdateIntent;
  repo: Pick<AccountRepo, "updateAccountHolder">;
}): Promise<ChatActionResult> {
  const validation = validatePreferredContactMethodUpdate(input.intent);
  if (validation.status === "clarify") {
    return { action: "clarify", success: false, reply: validation.intent.clarificationQuestion ?? "Would you prefer email, SMS, or phone?", missingFields: validation.intent.missingFields };
  }

  const fields = { preferredContactMethod: validation.method };
  const before = input.account.account;
  const preview = previewAccountHolderUpdate(before, fields);
  if (buildAccountHolderUpdateSummary(before, preview, fields).length === 0) {
    return { action: "update_preferred_contact_method", success: true, reply: "Your preferred contact method is already up to date.", account: input.account, changeSummary: [] };
  }

  const updated = await input.repo.updateAccountHolder(input.accountId, fields);
  return {
    action: "update_preferred_contact_method",
    success: true,
    reply: `Preferred contact method updated to ${updated.preferredContactMethod}.`,
    account: { ...input.account, account: updated },
    notificationQueued: true,
    changeSummary: buildAccountHolderUpdateSummary(before, updated, fields),
  };
}
//we refresh the account context in UI after adding related person for instant feedback
export async function routeRelatedPersonCreate(input: {
  accountId: string;
  account: AccountContext;
  intent: RelatedPersonCreateIntent;
  rawMessage?: string;
  repo: Pick<AccountRepo, "addRelatedPerson">;
}): Promise<ChatActionResult> {
  const validation = validateRelatedPersonCreate(input.intent, input.rawMessage);
  if (validation.status === "clarify") {
    return { action: "clarify", success: false, reply: validation.intent.clarificationQuestion ?? "What details should I use?", missingFields: validation.intent.missingFields };
  }

  const created = await input.repo.addRelatedPerson(input.accountId, validation.fields);
  return {
    action: "add_related_person",
    success: true,
    reply: `${created.name} was added to your account.`,
    account: { ...input.account, relatedPeople: [...input.account.relatedPeople, created] },
    relatedPeople: [created],
    notificationQueued: true,
    changeSummary: buildRelatedPersonCreateSummary(created),
  };
}
//we refresh the account context in UI after updating related person for instant feedback
export async function routeRelatedPersonUpdate(input: {
  accountId: string;
  account: AccountContext;
  intent: RelatedPersonUpdateIntent;
  repo: Pick<AccountRepo, "updateRelatedPerson">;
  resolve?: (input: { selector: string; people: RelatedPerson[] }) => ReturnType<typeof resolveRelatedPerson>;
}): Promise<ChatActionResult> {
  const validation = validateRelatedPersonUpdate(input.intent);
  if (validation.status === "clarify") {
    return { action: "clarify", success: false, reply: validation.intent.clarificationQuestion ?? "Which related person should I update?", missingFields: validation.intent.missingFields };
  }

  const resolution = await (input.resolve ?? resolveRelatedPerson)({
    selector: validation.selector,
    people: input.account.relatedPeople,
  });
  if (resolution.status === "ambiguous") {
    return { action: "clarify", success: false, reply: "I found more than one matching related person. Please provide their full name.", missingFields: ["selector"] };
  }
  if (resolution.status === "not_found") {
    return { action: "clarify", success: false, reply: "I couldn't identify that related person. Please provide their full name.", missingFields: ["selector"] };
  }

  const before = resolution.person;
  const preview = previewRelatedPersonUpdate(before, validation.fields);
  if (buildRelatedPersonUpdateSummary(before, preview, validation.fields).length === 0) {
    return { action: "update_related_person", success: true, reply: `${before.name}'s details are already up to date.`, account: input.account, changeSummary: [] };
  }

  const updated = await input.repo.updateRelatedPerson(input.accountId, before.id, validation.fields);
  return {
    action: "update_related_person",
    success: true,
    reply: `${updated.name}'s details were updated.`,
    account: { ...input.account, relatedPeople: input.account.relatedPeople.map((person) => person.id === updated.id ? updated : person) },
    relatedPeople: [updated],
    notificationQueued: true,
    changeSummary: buildRelatedPersonUpdateSummary(before, updated, validation.fields),
  };
}

export async function routeRelatedPersonRemovalRequest(input: {
  account: AccountContext;
  intent: RelatedPersonRemoveIntent;
  resolve?: (input: { selector: string; people: RelatedPerson[] }) => ReturnType<typeof resolveRelatedPerson>;
}): Promise<ChatActionResult> {
  const validation = validateRelatedPersonRemove(input.intent);
  if (validation.status === "clarify") {
    return { action: "clarify", success: false, reply: validation.intent.clarificationQuestion ?? "Which related person should I remove?", missingFields: validation.intent.missingFields };
  }

  const resolution = await (input.resolve ?? resolveRelatedPerson)({
    selector: validation.selector,
    people: input.account.relatedPeople,
  });
  if (resolution.status === "ambiguous") {
    return { action: "clarify", success: false, reply: "I found more than one matching related person. Please provide their full name.", missingFields: ["selector"] };
  }
  if (resolution.status === "not_found") {
    return { action: "clarify", success: false, reply: "I couldn't identify that related person. Please provide their full name.", missingFields: ["selector"] };
  }

  return {
    action: "remove_related_person",
    success: false,
    reply: `Please confirm that you want to remove ${resolution.person.name}. Reply yes to remove them or no to cancel.`,
    relatedPeople: [resolution.person],
  };
}

export async function routeRelatedPersonRemovalConfirmed(input: {
  accountId: string;
  account: AccountContext;
  personId: string;
  repo: Pick<AccountRepo, "deleteRelatedPerson">;
}): Promise<ChatActionResult> {
  const removed = await input.repo.deleteRelatedPerson(input.accountId, input.personId);
  return {
    action: "remove_related_person",
    success: true,
    reply: `${removed.name} was removed from your account.`,
    account: { ...input.account, relatedPeople: input.account.relatedPeople.filter((person) => person.id !== removed.id) },
    relatedPeople: [removed],
    notificationQueued: true,
    changeSummary: buildRelatedPersonRemoveSummary(removed),
  };
}
// for promise to pay actions, we refresh context in UI for instant feedback, and queue a notif for the credit
export async function routePromiseToPayCreate(input: {
  accountId: string;
  account: AccountContext;
  intent: PromiseToPayCreateIntent;
  rawMessage: string;
  nowIso: string;
  repo: Pick<AccountRepo, "addPromiseToPay">;
}): Promise<ChatActionResult> {
  const validation = validatePromiseToPayCreate({ intent: input.intent, accountCurrency: input.account.account.currency,
    nowIso: input.nowIso, rawMessage: input.rawMessage });
  if (validation.status === "clarify") {
    return { action: "clarify", success: false, reply: validation.intent.clarificationQuestion ?? "What amount and future date should I use?", missingFields: validation.intent.missingFields };
  }

  const created = await input.repo.addPromiseToPay(input.accountId, validation.fields);
  return {
    action: "create_promise_to_pay",
    success: true,
    reply: `Your promise to pay ${created.currency} ${(created.amountCents / 100).toFixed(2)} by ${created.dueDate} was created.`,
    account: { ...input.account, promisesToPay: [...input.account.promisesToPay, created] },
    promisesToPay: [created],
    notificationQueued: true,
    changeSummary: buildPromiseToPayCreateSummary(created),
  };
}

export async function routeMockPayment(input: {
  accountId: string;
  account: AccountContext;
  intent: MockPaymentIntent;
  idempotencyKey: string;
  repo: Pick<AccountRepo, "recordPayment">;
}): Promise<ChatActionResult> {
  if (!input.account.paymentOptions.mockPaymentsEnabled) {
    return { action: "unsupported", success: false, reply: "Payments are not enabled for this account." };
  }
  const validation = validateMockPayment({ intent: input.intent, accountCurrency: input.account.account.currency,
    balanceCents: input.account.account.balanceCents });
  if (validation.status === "clarify") {
    return { action: "clarify", success: false, reply: validation.intent.clarificationQuestion ?? "How much would you like to pay?", missingFields: validation.intent.missingFields };
  }

  let payment;
  try {
    payment = await input.repo.recordPayment(input.accountId, validation.amountCents, input.idempotencyKey);
  } catch (error) {
    if (error instanceof PaymentRepoError && error.code === "insufficient_balance") {
      const reply = validation.exceedsBalance
        ? "That amount is greater than the current balance. What smaller amount would you like to pay?"
        : "The balance changed before the payment completed. Please choose an amount no greater than the current balance.";
      return { action: "clarify", success: false, reply, missingFields: ["amountRaw"] };
    }
    throw error;
  }

  const transactions = input.account.transactions.some((transaction) => transaction.id === payment.transaction.id)
    ? input.account.transactions
    : [...input.account.transactions, payment.transaction];
  const account = { ...input.account,
    account: { ...input.account.account, balanceCents: payment.newBalanceCents },
    billing: { ...input.account.billing, currentAmountCents: payment.newBalanceCents },
    transactions };
  if (payment.replayed) {
    return { action: "mock_payment", success: true, reply: "That payment was already recorded, so the account was not charged again.", account,
      transaction: payment.transaction, transactions: [payment.transaction], changeSummary: [] };
  }

  return { action: "mock_payment", success: true,
    reply: `Payment of ${payment.transaction.currency} ${(payment.transaction.amountCents / 100).toFixed(2)} completed using saved payment details. The new balance is ${payment.transaction.currency} ${(payment.newBalanceCents / 100).toFixed(2)}.`,
    account, transaction: payment.transaction, transactions: [payment.transaction], notificationQueued: true,
    changeSummary: buildPaymentSummary({ beforeBalanceCents: input.account.account.balanceCents, afterBalanceCents: payment.newBalanceCents, transaction: payment.transaction }) };
}

export async function routeCallAppointmentCreate(input: {
  accountId: string;
  account: AccountContext;
  intent: CallAppointmentCreateIntent;
  rawMessage: string;
  nowIso: string;
  repo: Pick<AccountRepo, "addCallAppointment">;
}): Promise<ChatActionResult> {
  const validation = validateCallAppointmentCreate({ intent: input.intent, accountPhone: input.account.account.phone,
    nowIso: input.nowIso, rawMessage: input.rawMessage });
  if (validation.status === "clarify") {
    return { action: "clarify", success: false, reply: validation.intent.clarificationQuestion ?? "What future date and time should I use?", missingFields: validation.intent.missingFields };
  }
  const created = await input.repo.addCallAppointment(input.accountId, validation.fields);
  return { action: "book_call_appointment", success: true, reply: `Your call appointment was booked for ${created.scheduledAt}.`,
    account: { ...input.account, callAppointments: [...input.account.callAppointments, created] }, callAppointments: [created],
    notificationQueued: true, changeSummary: buildCallAppointmentCreateSummary(created) };
}

type ReadRepo = Pick<AccountRepo, "getAccountContextByAccountId">;
//for singular and plural count when outputting deterministically
function describeCount(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
//for future scheduled calls, some data time management
export function futureScheduledCalls(
  calls: CallAppointment[],
  nowIso: string,
): CallAppointment[] {
  const now = Date.parse(nowIso);
  if (Number.isNaN(now)) throw new Error("Invalid current time.");

  const datedCalls = calls.map((call) => {
    const scheduledAt = Date.parse(call.scheduledAt);
    if (Number.isNaN(scheduledAt)) throw new Error("Invalid call appointment time.");
    return { call, scheduledAt };
  });
  return datedCalls
    .filter(({ call, scheduledAt }) => call.status === "scheduled" && scheduledAt > now)
    .sort((left, right) => left.scheduledAt - right.scheduledAt)
    .map(({ call }) => call);
}
//unsupported i.e the action does not qualify for any of types (ie someone asking a poem or something)
export async function routeReadAction(input: {
  accountId: string;
  intent: ReadIntent;
  repo: ReadRepo;
  nowIso: string;
}): Promise<ChatActionResult> {
  const { intent } = input;
  if (intent.action === "clarify") {
    return {
      action: "clarify",
      success: false,
      reply: intent.clarificationQuestion,
      missingFields: intent.missingFields,
    };
  }
  if (intent.action === "unsupported") {
    return {
      action: "unsupported",
      success: false,
      reply: "Sorry, I can't do that. I can help with account details, contact preferences, related people, promises, transactions, payments, and call appointments.",
    };
  }

  const account = await input.repo.getAccountContextByAccountId(input.accountId);
  if (!account) {
    return {
      action: intent.action,
      success: false,
      reply: "I couldn't find that account.",
    };
  }

  switch (intent.action) {
    case "read_account":
      if (intent.fields.topic === "balance") {
        return { action: intent.action, success: true,
          reply: `Your current balance is ${new Intl.NumberFormat("en-IE", { style: "currency", currency: account.account.currency }).format(account.account.balanceCents / 100)}.` };
      }
      return { action: intent.action, success: true, reply: "Here are your current account details.", account };
    case "read_preferred_contact_method":
      return {
        action: intent.action,
        success: true,
        reply: `Your preferred contact method is ${account.account.preferredContactMethod}.`,
        account,
      };
    case "read_related_people":
      return {
        action: intent.action,
        success: true,
        reply: `I found ${describeCount(account.relatedPeople.length, "related person", "related people")} on your account.`,
        relatedPeople: account.relatedPeople,
      };
    case "read_promises_to_pay":
      return {
        action: intent.action,
        success: true,
        reply: `I found ${describeCount(account.promisesToPay.length, "promise", "promises")} to pay.`,
        promisesToPay: account.promisesToPay,
      };
    case "read_transactions":
      return {
        action: intent.action,
        success: true,
        reply: `I found ${describeCount(account.transactions.length, "transaction", "transactions")}.`,
        transactions: account.transactions,
      };
    case "read_call_appointments": {
      const calls = futureScheduledCalls(account.callAppointments, input.nowIso);
      return {
        action: intent.action,
        success: true,
        reply: `I found ${describeCount(calls.length, "future call appointment", "future call appointments")}.`,
        callAppointments: calls,
      };
    }
  }
}
