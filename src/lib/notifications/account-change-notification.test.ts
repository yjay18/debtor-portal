import { expect, it, vi } from "vitest";

import standardFixture from "../../../fixtures/debtor-standard.json";
import { normalizeLegacyFixture } from "@/lib/account/types";
import { DEFAULT_RESEND_FROM_EMAIL, deliverAccountChangeNotification, derivePdfPassword, type AccountChangeNotification } from "./account-change-notification";

const accountSnapshot = normalizeLegacyFixture(standardFixture);
const notification: AccountChangeNotification = {
  accountId: accountSnapshot.account.accountId,
  changedBy: "account_holder",
  changeSummary: "Private changed value",
  accountSnapshot,
};
const now = () => new Date("2026-07-16T12:00:00.000Z");

it("derives the attachment password from the current phone", () => {
  const expected = accountSnapshot.account.phone.replace(/\D/g, "").slice(-4);
  expect(derivePdfPassword(accountSnapshot.account.phone)).toBe(expected);
});

it("logs only a masked recipient when Resend is not configured", async () => {
  const log = vi.fn();
  const buildPdf = vi.fn();
  const result = await deliverAccountChangeNotification(notification, { buildPdf, log, now });
  expect(result).toMatchObject({ sent: false, redactedRecipient: "j***@e***.test" });
  expect(log).toHaveBeenCalledWith({ event: "notification_delivery_skipped", redactedRecipient: result.redactedRecipient });
  expect(buildPdf).not.toHaveBeenCalled();
});

it("sends a generic email with the encrypted PDF attached", async () => {
  const pdf = Buffer.from("encrypted-pdf");
  const buildPdf = vi.fn().mockResolvedValue(pdf);
  const sendEmail = vi.fn().mockResolvedValue({ data: { id: "email-id" }, error: null, headers: null });
  const result = await deliverAccountChangeNotification(notification, { fromEmail: "Portal <sender@example.test>", buildPdf, sendEmail, log: vi.fn(), now });
  const expectedPassword = accountSnapshot.account.phone.replace(/\D/g, "").slice(-4);

  expect(buildPdf).toHaveBeenCalledWith(accountSnapshot, expectedPassword);
  expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
    to: accountSnapshot.account.email, subject: "Your account was updated",
    attachments: [{ filename: "account-summary.pdf", content: pdf, contentType: "application/pdf" }],
  }));
  const email = sendEmail.mock.calls[0][0];
  expect(email.text).toContain("See the attached secure document for details.");
  for (const sensitive of [notification.changeSummary, accountSnapshot.account.reference, accountSnapshot.account.phone,
    accountSnapshot.account.email, accountSnapshot.account.accountHolderFirstName, accountSnapshot.account.accountHolderLastName]) {
    expect(email.text).not.toContain(sensitive);
  }
  expect(result).toEqual({ notificationId: "email-id", sent: true, redactedRecipient: "j***@e***.test" });
});

it("uses the Resend test sender when no sender is configured", async () => {
  const sendEmail = vi.fn().mockResolvedValue({ data: { id: "email-id" }, error: null, headers: null });
  await deliverAccountChangeNotification(notification, { buildPdf: vi.fn().mockResolvedValue(Buffer.from("pdf")), sendEmail, log: vi.fn(), now });
  expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ from: DEFAULT_RESEND_FROM_EMAIL }));
});

it("replaces provider details with a fixed delivery failure", async () => {
  const sendEmail = vi.fn().mockResolvedValue({ data: null, error: { message: "private provider detail" }, headers: null });
  await expect(deliverAccountChangeNotification(notification, {
    fromEmail: "sender@example.test", buildPdf: vi.fn().mockResolvedValue(Buffer.from("pdf")),
    sendEmail, log: vi.fn(), now,
  })).rejects.toThrow("Notification delivery failed.");
});
