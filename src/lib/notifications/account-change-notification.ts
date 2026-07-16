import type { AccountContext } from "@/lib/account/types";

export type AccountChangeNotification = {
  accountId: string;
  changedBy: "account_holder" | "authorized_representative";
  changeSummary: string;
  accountSnapshot: AccountContext;
};

export type AccountChangeNotificationResult = {
  notificationId: string;
  sent: boolean;
  redactedRecipient: string;
};

export async function sendAccountChangeNotification(
  notification: AccountChangeNotification,
): Promise<AccountChangeNotificationResult> {
  void notification;

  throw new Error(
    "sendAccountChangeNotification is a starter boundary. Implement Resend email plus encrypted PDF attachment here, and mock this function in automated tests.",
  );
}
