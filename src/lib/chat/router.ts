import type { AccountRepo } from "@/lib/account/repo";
import type { AccountContext, CallAppointment } from "@/lib/account/types";
import type { ChatActionResult } from "@/lib/chat/types";
import { buildAccountHolderUpdateSummary, buildRelatedPersonCreateSummary, previewAccountHolderUpdate } from "@/lib/chat/change-summary";
import { validateAccountHolderUpdate, validatePreferredContactMethodUpdate, validateRelatedPersonCreate } from "@/lib/chat/validation";
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
  repo: Pick<AccountRepo, "addRelatedPerson">;
}): Promise<ChatActionResult> {
  const validation = validateRelatedPersonCreate(input.intent);
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
      reply: "I can help with account details, contact preferences, related people, promises, transactions, payments, and call appointments.",
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
