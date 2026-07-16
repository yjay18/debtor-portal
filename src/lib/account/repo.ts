import type { AccountContext } from "./types";

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


export interface AccountRepo {
  getAccountContextByAccountId(
    accountId: string,
  ): Promise<AccountContext | null>;
}
