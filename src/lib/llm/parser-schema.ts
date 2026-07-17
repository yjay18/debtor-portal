import { z } from "zod";
//building the parser using zod to enforce the structure of the intent and actions
import type { ChatAction } from "@/lib/chat/types";
//lot of fields are optional because users may not provude all the info at the same time, like say i want to pay and then next message the amount. so thats why
const textSchema = z.string().trim().min(1);
const emptyFieldsSchema = z.object({}).strict();
const accountFieldsSchema = z.object({
  firstName: textSchema.optional(),
  lastName: textSchema.optional(),
  email: textSchema.optional(),
  phone: textSchema.optional(),
  addressLine1: textSchema.optional(),
  addressLine2: textSchema.optional(),
  city: textSchema.optional(),
  postalCode: textSchema.optional(),
  country: textSchema.optional(),
}).strict();
const relatedPersonFieldsSchema = z.object({
  selector: textSchema.optional(),
  name: textSchema.optional(),
  email: textSchema.optional(),
  phone: textSchema.optional(),
  relationship: textSchema.optional(),
  authorizedToAct: z.boolean().optional(),
}).strict();

function defineIntent<const Action extends ChatAction, Fields extends z.ZodType>(
  action: Action,
  fields: Fields,
) {
  return z.object({ action: z.literal(action), fields }).strict();
}
//list of actions and intents that the model can recognize 
const intents = [
  defineIntent("read_account", z.object({ topic: textSchema.optional() }).strict()),
  defineIntent("update_account_holder", accountFieldsSchema),
  defineIntent("read_preferred_contact_method", emptyFieldsSchema),
  defineIntent("update_preferred_contact_method", z.object({
    method: z.enum(["email", "sms", "phone"]).optional(),
  }).strict()),
  defineIntent("add_related_person", relatedPersonFieldsSchema.omit({ selector: true })),
  defineIntent("update_related_person", relatedPersonFieldsSchema),
  defineIntent("remove_related_person", z.object({ selector: textSchema.optional() }).strict()),
  defineIntent("read_related_people", emptyFieldsSchema),
  defineIntent("create_promise_to_pay", z.object({
    amountRaw: textSchema.optional(),
    dueDate: textSchema.optional(),
  }).strict()),
  defineIntent("read_promises_to_pay", emptyFieldsSchema),
  defineIntent("mock_payment", z.object({ amountRaw: textSchema.optional() }).strict()),
  defineIntent("read_transactions", emptyFieldsSchema),
  defineIntent("book_call_appointment", z.object({
    dateTime: textSchema.optional(),
    phone: textSchema.optional(),
    reason: textSchema.optional(),
  }).strict()),
  defineIntent("read_call_appointments", emptyFieldsSchema),
  defineIntent("clarify", emptyFieldsSchema),
  defineIntent("unsupported", emptyFieldsSchema),
] as const;

export const actionIntentSchema = z.discriminatedUnion("action", intents);

const resultFields = {
  additionalIntents: z.array(actionIntentSchema).default([]),
  missingFields: z.array(textSchema).default([]),
  clarificationQuestion: textSchema.optional(),
};

export const parsedIntentSchema = z.discriminatedUnion("action", [
  intents[0].extend(resultFields), intents[1].extend(resultFields),
  intents[2].extend(resultFields), intents[3].extend(resultFields),
  intents[4].extend(resultFields), intents[5].extend(resultFields),
  intents[6].extend(resultFields), intents[7].extend(resultFields),
  intents[8].extend(resultFields), intents[9].extend(resultFields),
  intents[10].extend(resultFields), intents[11].extend(resultFields),
  intents[12].extend(resultFields), intents[13].extend(resultFields),
  intents[14].extend({ ...resultFields, clarificationQuestion: textSchema }),
  intents[15].extend(resultFields),
]);

export type ActionIntent = z.infer<typeof actionIntentSchema>;
export type ParsedIntent = z.infer<typeof parsedIntentSchema>;

type JsonSchema = Record<string, unknown>;

const nullableText = { type: ["string", "null"] };
const nullableBoolean = { type: ["boolean", "null"] };
const nullableOffsetDateTime = {
  type: ["string", "null"],
  pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}(?::\\d{2}(?:\\.\\d{1,3})?)?(?:Z|[+-]\\d{2}:\\d{2})$",
};
//using the strict object function to enforce constrained fields from the openai endpoint
// altho this exists, we use a local zod schema to validate the fields and actions
// coz openai endpoint can return any fields and actions (e.g action : "add_balance" and field: "phone number": +"1234567890") which definitely needs validation 
function strictObject(properties: Record<string, JsonSchema>): JsonSchema {
  return {
    type: "object",
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

const providerFields = {
  read_account: strictObject({ topic: nullableText }),
  update_account_holder: strictObject({
    firstName: nullableText, lastName: nullableText, email: nullableText,
    phone: nullableText, addressLine1: nullableText, addressLine2: nullableText,
    city: nullableText, postalCode: nullableText, country: nullableText,
  }),
  read_preferred_contact_method: strictObject({}),
  update_preferred_contact_method: strictObject({
    method: { anyOf: [{ type: "string", enum: ["email", "sms", "phone"] }, { type: "null" }] },
  }),
  add_related_person: strictObject({
    name: nullableText, email: nullableText, phone: nullableText,
    relationship: nullableText, authorizedToAct: nullableBoolean,
  }),
  update_related_person: strictObject({
    selector: nullableText, name: nullableText, email: nullableText,
    phone: nullableText, relationship: nullableText, authorizedToAct: nullableBoolean,
  }),
  remove_related_person: strictObject({ selector: nullableText }),
  read_related_people: strictObject({}),
  create_promise_to_pay: strictObject({ amountRaw: nullableText, dueDate: nullableText }),
  read_promises_to_pay: strictObject({}),
  mock_payment: strictObject({ amountRaw: nullableText }),
  read_transactions: strictObject({}),
  book_call_appointment: strictObject({
    dateTime: nullableOffsetDateTime, phone: nullableText, reason: nullableText,
  }),
  read_call_appointments: strictObject({}),
  clarify: strictObject({}),
  unsupported: strictObject({}),
} satisfies Record<ChatAction, JsonSchema>;

const providerActions = Object.keys(providerFields) as ChatAction[];
const providerFieldVariants = [...new Map(Object.values(providerFields)
  .map((schema) => [JSON.stringify(schema), schema])).values()];
const providerQueuedIntent = {
  anyOf: providerActions.map((action) => strictObject({
    action: { type: "string", enum: [action] },
    fields: providerFields[action],
  })),
};

export const parsedIntentJsonSchema = strictObject({
  action: { type: "string", enum: providerActions },
  fields: { anyOf: providerFieldVariants },
  additionalIntents: { type: "array", items: providerQueuedIntent },
  missingFields: { type: "array", items: { type: "string" } },
  clarificationQuestion: nullableText,
});

function withoutNullFields(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== null));
}

export function parseProviderIntent(value: unknown): ParsedIntent {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return parsedIntentSchema.parse(value);
  }

  const input = value as Record<string, unknown>;
  const additionalIntents = Array.isArray(input.additionalIntents)
    ? input.additionalIntents.map((intent) => intent && typeof intent === "object"
      ? { ...intent, fields: withoutNullFields((intent as Record<string, unknown>).fields) }
      : intent)
    : input.additionalIntents;
  const normalized: Record<string, unknown> = {
    ...input,
    fields: withoutNullFields(input.fields),
    additionalIntents,
  };
  if (normalized.clarificationQuestion === null) delete normalized.clarificationQuestion;
  return parsedIntentSchema.parse(normalized);
}
