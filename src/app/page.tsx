import { notFound } from "next/navigation";

import { DebtorPortal } from "@/components/debtor-portal";
import { SupabaseAccountRepo } from "@/lib/account/repo";

export const dynamic = "force-dynamic";

export default async function Home() {
  const accountContext = await new SupabaseAccountRepo()
    .getAccountContextByAccountId("acc_standard_001");

  if (!accountContext) {
    notFound();
  }

  return <DebtorPortal accountContext={accountContext} />;
}
