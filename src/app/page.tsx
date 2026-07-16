import fixture from "../../fixtures/debtor-standard.json";

import { DebtorPortal } from "@/components/debtor-portal";

export default function Home() {
  // Starter data only: replace this fixture with a real account loaded from
  // your database once you begin the challenge.
  return <DebtorPortal fixture={fixture} />;
}
