import { z } from "zod";

import type { AccountHolderUpdate } from "@/lib/account/repo";
import type { RelatedPersonCreate } from "@/lib/account/repo";
import type { ParsedIntent } from "@/lib/llm/parser-schema";

type AccountUpdateIntent = Extract<ParsedIntent, { action: "update_account_holder" }>;
type PreferredContactMethodUpdateIntent = Extract<ParsedIntent, { action: "update_preferred_contact_method" }>;
type RelatedPersonCreateIntent = Extract<ParsedIntent, { action: "add_related_person" }>;
//normalizing
export function sanitizeFreeText(value: string): string {
  return value.normalize("NFC").replace(/\p{Cc}/gu, " ").replace(/\s+/gu, " ").trim();
}

function sanitizedText(maxLength: number) {
  return z.string()
    .transform(sanitizeFreeText)
    .pipe(z.string().min(1).max(maxLength));
}
//hard limits after text sanitization to avoid malicious input and prompt injection
const updateAccountFieldsSchema = z.object({
  firstName: sanitizedText(100).optional(),
  lastName: sanitizedText(100).optional(),
  email: sanitizedText(254).pipe(z.email()).optional(),
  phone: sanitizedText(16).pipe(z.string().regex(/^\+\d{7,15}$/)).optional(),
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
  phone: sanitizedText(16).pipe(z.string().regex(/^\+\d{7,15}$/)),
  relationship: sanitizedText(100).optional(),
  authorizedToAct: z.boolean().optional(),
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
): RelatedPersonCreateValidation {
  const result = relatedPersonCreateSchema.safeParse(intent.fields);
  if (result.success) {
    return {
      status: "ready",
      fields: { ...result.data, authorizedToAct: result.data.authorizedToAct === true },
    };
  }

  const missingFields = [...new Set(result.error.issues.map((issue) => String(issue.path[0])) )];
  const firstField = missingFields[0];
  const label = firstField === "name" ? "their name" : firstField === "phone" ? "their phone number" : "their email address";
  return {
    status: "clarify",
    intent: {
      action: "clarify",
      fields: {},
      additionalIntents: intent.additionalIntents,
      missingFields,
      clarificationQuestion: `To add someone, what is ${label}?`,
    },
  };
}
