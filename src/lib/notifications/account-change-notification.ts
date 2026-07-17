import type { AccountContext } from "@/lib/account/types";
import { Resend, type CreateEmailOptions, type CreateEmailResponse } from "resend";

import { buildAccountSummaryPdf } from "./pdf";
import { redactEmailRecipient } from "./redact";

export const DEFAULT_RESEND_FROM_EMAIL = "onboarding@resend.dev";

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
type NotificationDeliveryDependencies = {
  fromEmail?: string;
  buildPdf: typeof buildAccountSummaryPdf;
  sendEmail?: (email: CreateEmailOptions) => Promise<CreateEmailResponse>;
  log: (entry: { event: "notification_delivery_skipped"; redactedRecipient: string }) => void;
  now: () => Date;
};

//derives password from last 4 digits of phone number
export function derivePdfPassword(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4) throw new Error("Current phone cannot provide a PDF password.");
  return digits.slice(-4);
}
//generic email body for notifications
function genericEmailBody(notification: AccountChangeNotification, now: Date): string {
  const supportEmail = notification.accountSnapshot.support.supportEmail
    .replace(/[\u0000-\u001F\u007F]/g, "").slice(0, 254);
  return `Your account was updated on ${now.toISOString().slice(0, 10)}. See the attached secure document for details. For help, contact ${supportEmail}.`;
}

export async function deliverAccountChangeNotification(
  notification: AccountChangeNotification,
  deps: NotificationDeliveryDependencies,
): Promise<AccountChangeNotificationResult> {
  const recipient = notification.accountSnapshot.account.email;
  const redactedRecipient = redactEmailRecipient(recipient);
  //sender validation and email delivery
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) throw new Error("Notification recipient is invalid.");
  if (!deps.sendEmail) {
    deps.log({ event: "notification_delivery_skipped", redactedRecipient });
    return { notificationId: "logged-without-provider", sent: false, redactedRecipient };
  }
  const from = deps.fromEmail?.trim() || DEFAULT_RESEND_FROM_EMAIL;
  if (/[\r\n]/.test(from)) throw new Error("Notification sender is not configured safely.");
  const pdf = await deps.buildPdf(notification.accountSnapshot, derivePdfPassword(notification.accountSnapshot.account.phone));
  //resend payload
  let response: CreateEmailResponse;
  try {
    response = await deps.sendEmail({
      from, to: recipient, subject: "Your account was updated",
      text: genericEmailBody(notification, deps.now()),
      attachments: [{ filename: "account-summary.pdf", content: pdf, contentType: "application/pdf" }],
    });
  } catch {
    throw new Error("Notification delivery failed.");
  }
  if (response.error || !response.data.id) throw new Error("Notification delivery failed.");
  return { notificationId: response.data.id, sent: true, redactedRecipient };
}

export async function sendAccountChangeNotification(
  notification: AccountChangeNotification,
): Promise<AccountChangeNotificationResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const resend = apiKey ? new Resend(apiKey) : null;
  return deliverAccountChangeNotification(notification, {
    fromEmail: process.env.NOTIFICATION_FROM_EMAIL,
    buildPdf: buildAccountSummaryPdf,
    sendEmail: resend ? (email) => resend.emails.send(email) : undefined,
    log: (entry) => console.info(entry),
    now: () => new Date(),
  });
}
