import type { AccountHolder, CallAppointment, PromiseToPay, Transaction } from "@/lib/account/types";
import type { RelatedPerson } from "@/lib/account/types";
import type { AccountHolderUpdate, RelatedPersonUpdate } from "@/lib/account/repo";
import type { ChangeSummary } from "./types";

//render a stored UTC timestamp in Europe/Dublin so replies and change cards match what the customer asked for
export function formatDublinDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-IE", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Europe/Dublin",
  }).format(date);
}

export function buildUpdateSummary(input: {
  entity: ChangeSummary["entity"];
  label: string;
  fields: Array<{ field: string; before: string; after: string }>;
}): ChangeSummary[] {
  const fields = input.fields.filter((field) => field.before !== field.after);
  return fields.length ? [{ kind: "updated", entity: input.entity, label: input.label, fields }] : [];
}

export function buildCreateSummary(input: {
  entity: ChangeSummary["entity"];
  label: string;
  fields: Array<{ field: string; after: string }>;
}): ChangeSummary[] {
  return [{ kind: "created", entity: input.entity, label: input.label, fields: input.fields }];
}

export function buildRelatedPersonCreateSummary(person: RelatedPerson): ChangeSummary[] {
  return buildCreateSummary({
    entity: "related_person",
    label: person.name,
    fields: [
      { field: "Email", after: person.email },
      { field: "Phone", after: person.phone },
      ...(person.relationship ? [{ field: "Relationship", after: person.relationship }] : []),
      { field: "Authorized to act", after: person.authorizedToAct ? "Yes" : "No" },
    ],
  });
}

export function previewRelatedPersonUpdate(person: RelatedPerson, fields: RelatedPersonUpdate): RelatedPerson {
  return { ...person, ...fields };
}

export function buildRelatedPersonUpdateSummary(
  before: RelatedPerson,
  after: RelatedPerson,
  touched: RelatedPersonUpdate,
) {
  const candidates = [
    ["name", "Name", before.name, after.name],
    ["email", "Email", before.email, after.email],
    ["phone", "Phone", before.phone, after.phone],
    ["relationship", "Relationship", before.relationship ?? "Not set", after.relationship ?? "Not set"],
    ["authorizedToAct", "Authorized to act", before.authorizedToAct ? "Yes" : "No", after.authorizedToAct ? "Yes" : "No"],
  ] as const;
  return buildUpdateSummary({ entity: "related_person", label: after.name,
    fields: candidates.filter(([key]) => touched[key] !== undefined)
      .map(([, field, oldValue, newValue]) => ({ field, before: oldValue, after: newValue })) });
}

export function buildRelatedPersonRemoveSummary(person: RelatedPerson): ChangeSummary[] {
  return [{
    kind: "removed",
    entity: "related_person",
    label: person.name,
    fields: [
      { field: "Email", before: person.email },
      { field: "Phone", before: person.phone },
      ...(person.relationship ? [{ field: "Relationship", before: person.relationship }] : []),
      { field: "Authorized to act", before: person.authorizedToAct ? "Yes" : "No" },
    ],
  }];
}

export function buildPromiseToPayCreateSummary(promise: PromiseToPay): ChangeSummary[] {
  const amount = new Intl.NumberFormat("en-IE", { style: "currency", currency: promise.currency }).format(promise.amountCents / 100);
  return buildCreateSummary({ entity: "promise_to_pay", label: "Promise to pay", fields: [
    { field: "Amount", after: amount },
    { field: "Due date", after: promise.dueDate },
    { field: "Status", after: "Active" },
  ] });
}

export function buildPaymentSummary(input: {
  beforeBalanceCents: number;
  afterBalanceCents: number;
  transaction: Transaction;
}): ChangeSummary[] {
  const format = (amountCents: number) => new Intl.NumberFormat("en-IE", { style: "currency", currency: input.transaction.currency }).format(amountCents / 100);
  return [
    { kind: "updated", entity: "account_holder", label: "Balance", fields: [
      { field: "Balance", before: format(input.beforeBalanceCents), after: format(input.afterBalanceCents) },
    ] },
    { kind: "created", entity: "transaction", label: "Payment", fields: [
      { field: "Amount", after: format(input.transaction.amountCents) }, { field: "Status", after: "Completed" },
    ] },
  ];
}

export function buildCallAppointmentCreateSummary(call: CallAppointment): ChangeSummary[] {
  return buildCreateSummary({ entity: "call_appointment", label: "Call appointment", fields: [
    { field: "Scheduled for", after: `${formatDublinDateTime(call.scheduledAt)} (Europe/Dublin)` },
    { field: "Phone", after: call.phone },
    ...(call.reason ? [{ field: "Reason", after: call.reason }] : []),
    { field: "Status", after: "Scheduled" },
  ] });
}

export function previewAccountHolderUpdate(holder: AccountHolder, fields: AccountHolderUpdate): AccountHolder {
  return {
    ...holder,
    accountHolderFirstName: fields.firstName ?? holder.accountHolderFirstName,
    accountHolderLastName: fields.lastName ?? holder.accountHolderLastName,
    email: fields.email ?? holder.email,
    phone: fields.phone ?? holder.phone,
    address: {
      ...holder.address,
      line1: fields.addressLine1 ?? holder.address.line1,
      line2: fields.addressLine2 ?? holder.address.line2,
      city: fields.city ?? holder.address.city,
      postalCode: fields.postalCode ?? holder.address.postalCode,
    country: fields.country ?? holder.address.country,
  },
    preferredContactMethod: fields.preferredContactMethod ?? holder.preferredContactMethod,
  };
}

export function buildAccountHolderUpdateSummary(before: AccountHolder, after: AccountHolder, touched: AccountHolderUpdate) {
  const candidates = [
    ["firstName", "First name", before.accountHolderFirstName, after.accountHolderFirstName],
    ["lastName", "Last name", before.accountHolderLastName, after.accountHolderLastName],
    ["email", "Email", before.email, after.email], ["phone", "Phone", before.phone, after.phone],
    ["addressLine1", "Address line 1", before.address.line1, after.address.line1],
    ["addressLine2", "Address line 2", before.address.line2 ?? "", after.address.line2 ?? ""],
    ["city", "City", before.address.city, after.address.city],
    ["postalCode", "Postal code", before.address.postalCode, after.address.postalCode],
    ["country", "Country", before.address.country, after.address.country],
    ["preferredContactMethod", "Preferred contact method", before.preferredContactMethod, after.preferredContactMethod],
  ] as const;
  return buildUpdateSummary({ entity: "account_holder", label: "Account details",
    fields: candidates.filter(([key]) => touched[key] !== undefined)
      .map(([, field, oldValue, newValue]) => ({ field, before: oldValue, after: newValue })) });
}
