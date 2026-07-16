import type { AccountHolder } from "@/lib/account/types";
import type { AccountHolderUpdate } from "@/lib/account/repo";
import type { ChangeSummary } from "./types";

export function buildUpdateSummary(input: {
  entity: ChangeSummary["entity"];
  label: string;
  fields: Array<{ field: string; before: string; after: string }>;
}): ChangeSummary[] {
  const fields = input.fields.filter((field) => field.before !== field.after);
  return fields.length ? [{ kind: "updated", entity: input.entity, label: input.label, fields }] : [];
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
  ] as const;
  return buildUpdateSummary({ entity: "account_holder", label: "Account details",
    fields: candidates.filter(([key]) => touched[key] !== undefined)
      .map(([, field, oldValue, newValue]) => ({ field, before: oldValue, after: newValue })) });
}
