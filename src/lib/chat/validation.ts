import { z } from "zod";

import type { AccountHolderUpdate } from "@/lib/account/repo";
import type { RelatedPersonCreate } from "@/lib/account/repo";
import type { CallAppointmentCreate, PromiseToPayCreate, RelatedPersonUpdate } from "@/lib/account/repo";
import { resolveFutureDate } from "@/lib/llm/dates";
import { normalizeMoney } from "@/lib/llm/money";
import type { ParsedIntent } from "@/lib/llm/parser-schema";

type AccountUpdateIntent = Extract<ParsedIntent, { action: "update_account_holder" }>;
type PreferredContactMethodUpdateIntent = Extract<ParsedIntent, { action: "update_preferred_contact_method" }>;
type RelatedPersonCreateIntent = Extract<ParsedIntent, { action: "add_related_person" }>;
type RelatedPersonUpdateIntent = Extract<ParsedIntent, { action: "update_related_person" }>;
type RelatedPersonRemoveIntent = Extract<ParsedIntent, { action: "remove_related_person" }>;
type PromiseToPayCreateIntent = Extract<ParsedIntent, { action: "create_promise_to_pay" }>;
type MockPaymentIntent = Extract<ParsedIntent, { action: "mock_payment" }>;
type CallAppointmentCreateIntent = Extract<ParsedIntent, { action: "book_call_appointment" }>;
//normalizing
export function sanitizeFreeText(value: string): string {
  return value.normalize("NFC").replace(/\p{Cc}/gu, " ").replace(/\s+/gu, " ").trim();
}

function sanitizedText(maxLength: number) {
  return z.string()
    .transform(sanitizeFreeText)
    .pipe(z.string().min(1).max(maxLength));
}
//strip common phone formatting (spaces, dashes, parentheses, dots) before validating shape
function normalizePhone(value: string): string {
  return value.replace(/[\s().-]/gu, "");
}
//phones must reduce to E.164: a leading + and 7-15 digits once formatting is removed
function phoneField() {
  return z.string()
    .max(40)
    .transform(sanitizeFreeText)
    .transform(normalizePhone)
    .pipe(z.string().regex(/^\+\d{7,15}$/));
}
//hard limits after text sanitization to avoid malicious input and prompt injection
const updateAccountFieldsSchema = z.object({
  firstName: sanitizedText(100).optional(),
  lastName: sanitizedText(100).optional(),
  email: sanitizedText(254).pipe(z.email()).optional(),
  phone: phoneField().optional(),
  addressLine1: sanitizedText(200).optional(),
  addressLine2: sanitizedText(200).optional(),
  city: sanitizedText(100).optional(),
  postalCode: sanitizedText(32).optional(),
  country: sanitizedText(100).optional(),
}).strict().refine((fields) => Object.values(fields).some((value) => value !== undefined), {
  message: "At least one account field is required.",
});

const relatedPersonCreateSchema = z.object({
  name: sanitizedText(100),
  email: sanitizedText(254).pipe(z.email()),
  phone: phoneField(),
  relationship: sanitizedText(100).optional(),
  authorizedToAct: z.boolean().optional(),
}).strict();

function statedRelationship(relationship: string | undefined, rawMessage?: string): string | undefined {
  if (!relationship) return undefined;

  const normalizedRelationship = sanitizeFreeText(relationship);
  const comparableRelationship = normalizedRelationship
    .toLocaleLowerCase("en")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  if (/^(?:undefined|unknown|null|not specified|(?:someone )?authori[sz]ed(?: to (?:act|speak)(?: for me)?)?|acts? for me)$/u.test(comparableRelationship)) {
    return undefined;
  }
  if (!rawMessage) return normalizedRelationship;

  const comparableMessage = sanitizeFreeText(rawMessage)
    .toLocaleLowerCase("en")
    .replace(/[^\p{L}\p{N}]+/gu, " ");
  return comparableMessage.includes(` ${comparableRelationship} `)
    || comparableMessage.startsWith(`${comparableRelationship} `)
    || comparableMessage.endsWith(` ${comparableRelationship}`)
    || comparableMessage === comparableRelationship
    ? normalizedRelationship
    : undefined;
}

const relatedPersonUpdateSchema = z.object({
  selector: sanitizedText(100),
  name: sanitizedText(100).optional(),
  email: sanitizedText(254).pipe(z.email()).optional(),
  phone: phoneField().optional(),
  relationship: sanitizedText(100).optional(),
  authorizedToAct: z.boolean().optional(),
}).strict().refine((fields) => Object.entries(fields).some(([key, value]) => key !== "selector" && value !== undefined), {
  message: "At least one related-person field is required.",
});

const relatedPersonRemoveSchema = z.object({
  selector: sanitizedText(100),
}).strict();

const callAppointmentDetailsSchema = z.object({
  phone: phoneField(),
  reason: sanitizedText(500).optional(),
}).strict();

export type ValidatedAccountUpdateFields = z.infer<typeof updateAccountFieldsSchema>
  & AccountHolderUpdate;

export type AccountUpdateValidation =
  | {
      status: "ready";
      fields: ValidatedAccountUpdateFields;
      additionalIntents: AccountUpdateIntent["additionalIntents"];
    }
  | {
      status: "clarify";
      intent: ParsedIntent;
    };

export type PreferredContactMethodValidation =
  | { status: "ready"; method: "email" | "sms" | "phone" }
  | { status: "clarify"; intent: ParsedIntent };

export type RelatedPersonCreateValidation =
  | { status: "ready"; fields: RelatedPersonCreate }
  | { status: "clarify"; intent: ParsedIntent };

export type RelatedPersonUpdateValidation =
  | { status: "ready"; selector: string; fields: RelatedPersonUpdate }
  | { status: "clarify"; intent: ParsedIntent };

export type RelatedPersonRemoveValidation =
  | { status: "ready"; selector: string }
  | { status: "clarify"; intent: ParsedIntent };

export type PromiseToPayCreateValidation =
  | { status: "ready"; fields: PromiseToPayCreate }
  | { status: "clarify"; intent: ParsedIntent };

export type MockPaymentValidation =
  | { status: "ready"; amountCents: number; currency: string; exceedsBalance: boolean }
  | { status: "clarify"; intent: ParsedIntent };

export type CallAppointmentCreateValidation =
  | { status: "ready"; fields: CallAppointmentCreate }
  | { status: "clarify"; intent: ParsedIntent };

const fieldLabels: Record<string, string> = {
  firstName: "first name",
  lastName: "last name",
  email: "email address",
  phone: "phone number",
  addressLine1: "first address line",
  addressLine2: "second address line",
  city: "city",
  postalCode: "postal code",
  country: "country",
  accountDetail: "account detail",
};

export function validateAccountHolderUpdate(
  intent: AccountUpdateIntent,
): AccountUpdateValidation {
  const result = updateAccountFieldsSchema.safeParse(intent.fields);
  if (result.success) {
    return {
      status: "ready",
      fields: result.data,
      additionalIntents: intent.additionalIntents,
    };
  }
//clarification question is generated based on the first missing field, if multiple fields are missing, the user will be prompted to provide them one by one
  const missingFields = [...new Set(result.error.issues.map((issue) =>
    String(issue.path[0] ?? "accountDetail")))];
  const firstField = missingFields[0];
  const question = firstField === "phone"
    ? "What phone number should I use? Please include + and the country code."
    : `What ${fieldLabels[firstField] ?? "account detail"} should I use?`;

  return {
    status: "clarify",
    intent: {
      action: "clarify",
      fields: {},
      additionalIntents: intent.additionalIntents,
      missingFields,
      clarificationQuestion: question,
    },
  };
}

export function validatePreferredContactMethodUpdate(
  intent: PreferredContactMethodUpdateIntent,
): PreferredContactMethodValidation {
  const result = z.enum(["email", "sms", "phone"]).safeParse(intent.fields.method);
  if (result.success) return { status: "ready", method: result.data };

  return {
    status: "clarify",
    intent: {
      action: "clarify",
      fields: {},
      additionalIntents: intent.additionalIntents,
      missingFields: ["method"],
      clarificationQuestion: "Would you prefer email, SMS, or phone?",
    },
  };
}
//validation for adding a related person, checks for required fields and generates clarification questions if any are missing
export function validateRelatedPersonCreate(
  intent: RelatedPersonCreateIntent,
  rawMessage?: string,
): RelatedPersonCreateValidation {
  const result = relatedPersonCreateSchema.safeParse({
    ...intent.fields,
    relationship: statedRelationship(intent.fields.relationship, rawMessage),
  });
  if (result.success) {
    return {
      status: "ready",
      fields: { ...result.data, authorizedToAct: result.data.authorizedToAct === true },
    };
  }

  const missingFields = [...new Set(result.error.issues.map((issue) => String(issue.path[0])) )];
  const firstField = missingFields[0];
  const question = firstField === "name"
    ? "To add someone, what is their name?"
    : firstField === "phone"
      ? "To add someone, what is their phone number? Please include + and the country code."
      : "To add someone, what is their email address?";
  return {
    status: "clarify",
    intent: {
      action: "clarify",
      fields: {},
      additionalIntents: intent.additionalIntents,
      missingFields,
      clarificationQuestion: question,
    },
  };
}

export function validateRelatedPersonUpdate(
  intent: RelatedPersonUpdateIntent,
): RelatedPersonUpdateValidation {
  const result = relatedPersonUpdateSchema.safeParse(intent.fields);
  if (result.success) {
    const { selector, ...fields } = result.data;
    return { status: "ready", selector, fields };
  }

  const missingFields = [...new Set(result.error.issues.map((issue) => String(issue.path[0] ?? "relatedPerson")))];
  const firstField = missingFields[0];
  const question = firstField === "selector"
    ? "Which related person should I update?"
    : firstField === "relatedPerson"
      ? "What detail should I update for that related person?"
      : `What ${fieldLabels[firstField] ?? "related-person detail"} should I use?`;
  return {
    status: "clarify",
    intent: {
      action: "clarify",
      fields: {},
      additionalIntents: intent.additionalIntents,
      missingFields,
      clarificationQuestion: question,
    },
  };
}

export function validateRelatedPersonRemove(
  intent: RelatedPersonRemoveIntent,
): RelatedPersonRemoveValidation {
  const result = relatedPersonRemoveSchema.safeParse(intent.fields);
  if (result.success) return { status: "ready", selector: result.data.selector };

  return {
    status: "clarify",
    intent: {
      action: "clarify",
      fields: {},
      additionalIntents: intent.additionalIntents,
      missingFields: ["selector"],
      clarificationQuestion: "Which related person should I remove?",
    },
  };
}
//validating promise to pay creation
export function validatePromiseToPayCreate(input: {
  intent: PromiseToPayCreateIntent;
  accountCurrency: string;
  nowIso: string;
  rawMessage: string;
}): PromiseToPayCreateValidation {
  const { amountRaw, dueDate } = input.intent.fields;
  if (!amountRaw || !dueDate) {
    const missingFields = [!amountRaw ? "amountRaw" : undefined, !dueDate ? "dueDate" : undefined]
      .filter((field): field is string => field !== undefined);
    return { status: "clarify", intent: { action: "clarify", fields: {}, additionalIntents: input.intent.additionalIntents, missingFields,
      clarificationQuestion: !amountRaw ? "How much would you like to promise to pay?" : "What future date will you make that payment?" } };
  }

  const money = normalizeMoney(amountRaw, input.accountCurrency);
  if (money.status === "clarify") {
    return { status: "clarify", intent: { action: "clarify", fields: {}, additionalIntents: input.intent.additionalIntents,
      missingFields: ["amountRaw"], clarificationQuestion: money.question } };
  }
  const date = resolveFutureDate({ rawText: input.rawMessage, llmIso: dueDate, nowIso: input.nowIso, kind: "date" });
  if (date.status === "clarify") {
    return { status: "clarify", intent: { action: "clarify", fields: {}, additionalIntents: input.intent.additionalIntents,
      missingFields: ["dueDate"], clarificationQuestion: date.question } };
  }

  return { status: "ready", fields: { amountCents: money.amountCents, currency: money.currency, dueDate: date.iso } };
}

export function validateMockPayment(input: {
  intent: MockPaymentIntent;
  accountCurrency: string;
  balanceCents: number;
}): MockPaymentValidation {
  const amountRaw = input.intent.fields.amountRaw;
  if (!amountRaw) {
    return { status: "clarify", intent: { action: "clarify", fields: {}, additionalIntents: input.intent.additionalIntents,
      missingFields: ["amountRaw"], clarificationQuestion: "How much would you like to pay?" } };
  }
  const money = normalizeMoney(amountRaw, input.accountCurrency);
  if (money.status === "clarify") {
    return { status: "clarify", intent: { action: "clarify", fields: {}, additionalIntents: input.intent.additionalIntents,
      missingFields: ["amountRaw"], clarificationQuestion: money.question } };
  }
  return { status: "ready", amountCents: money.amountCents, currency: money.currency,
    exceedsBalance: money.amountCents > input.balanceCents };
}

export function validateCallAppointmentCreate(input: {
  intent: CallAppointmentCreateIntent;
  accountPhone: string;
  nowIso: string;
  rawMessage: string;
}): CallAppointmentCreateValidation {
  const dateTime = input.intent.fields.dateTime;
  if (!dateTime) {
    return { status: "clarify", intent: { action: "clarify", fields: {}, additionalIntents: input.intent.additionalIntents,
      missingFields: ["dateTime"], clarificationQuestion: "What future date and time should I book the call for?" } };
  }
  const date = resolveFutureDate({ rawText: input.rawMessage, llmIso: dateTime, nowIso: input.nowIso, kind: "dateTime" });
  if (date.status === "clarify") {
    return { status: "clarify", intent: { action: "clarify", fields: {}, additionalIntents: input.intent.additionalIntents,
      missingFields: ["dateTime"], clarificationQuestion: date.question } };
  }
  const details = callAppointmentDetailsSchema.safeParse({
    phone: input.intent.fields.phone ?? input.accountPhone,
    reason: input.intent.fields.reason?.replace(/^\s*about\s+/iu, ""),
  });
  if (!details.success) {
    const field = String(details.error.issues[0]?.path[0] ?? "phone");
    return { status: "clarify", intent: { action: "clarify", fields: {}, additionalIntents: input.intent.additionalIntents,
      missingFields: [field], clarificationQuestion: field === "phone" ? "What phone number should we call? Please include + and the country code." : "What short reason should I add for the call?" } };
  }
  return { status: "ready", fields: { scheduledAt: date.iso, ...details.data } };
}
