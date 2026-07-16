import { randomBytes } from "node:crypto";
import PDFDocument from "pdfkit";
//pdf generation, done in memory so no file system access is required, and we can return the buffer directly to the client
import type { AccountContext } from "@/lib/account/types";
//normalizing from when putting text in pdf
function safePdfText(value: unknown, maxLength = 200): string {
  return String(value ?? "").normalize("NFC").replace(/[\u0000-\u001F\u007F]/g, " ").trim().slice(0, maxLength);
}

function formatMoney(cents: number, currency: string): string {
  const major = Math.trunc(cents / 100).toLocaleString("en-IE");
  const minor = Math.abs(cents % 100).toString().padStart(2, "0");
  return `${safePdfText(currency, 3)} ${major}.${minor}`;
}
//we use 1.7ext3 to support AES-256 encryption, which is the strongest available in PDFKit
export function buildEncryptedPdfOptions(password: string): PDFKit.PDFDocumentOptions {
  if (!/^\d{4}$/.test(password)) throw new Error("PDF password must contain four digits.");
  return {
    userPassword: password,
    ownerPassword: randomBytes(32).toString("hex"),
    pdfVersion: "1.7ext3",
    permissions: { copying: false, modifying: false, printing: "highResolution" },
    info: { Title: "Secure account summary" },
  };
}

function writeSection(document: PDFKit.PDFDocument, title: string, lines: string[]) {
  document.moveDown().fontSize(14).text(title).fontSize(10);
  for (const line of lines.length ? lines : ["None"]) document.text(line);
}

export async function buildAccountSummaryPdf(snapshot: AccountContext, password: string): Promise<Buffer> {
  const document = new PDFDocument(buildEncryptedPdfOptions(password));
  const chunks: Buffer[] = [];
  const completed = new Promise<Buffer>((resolve, reject) => {
    document.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);
  });
  const account = snapshot.account;
  const address = [account.address.line1, account.address.line2, account.address.city, account.address.postalCode, account.address.country]
    .map((part) => safePdfText(part)).filter(Boolean).join(", ");

  document.fontSize(20).text("Account summary");
  writeSection(document, "Account", [
    `Name: ${safePdfText(`${account.accountHolderFirstName} ${account.accountHolderLastName}`)}`,
    `Reference: ${safePdfText(account.reference)}`,
    `Creditor: ${safePdfText(account.creditorName)}`,
    `Status: ${safePdfText(account.status)}`,
    `Current balance: ${formatMoney(account.balanceCents, account.currency)}`,
  ]);
  writeSection(document, "Contact details", [
    `Email: ${safePdfText(account.email)}`, `Phone: ${safePdfText(account.phone)}`,
    `Address: ${address}`, `Preferred contact method: ${safePdfText(account.preferredContactMethod)}`,
  ]);
  writeSection(document, "Related people", snapshot.relatedPeople.map((person) =>
    `${safePdfText(person.name)} | ${safePdfText(person.relationship ?? "Relationship not provided")} | Authorized: ${person.authorizedToAct ? "Yes" : "No"}`));
  writeSection(document, "Transactions", snapshot.transactions.map((transaction) =>
    `${safePdfText(transaction.transactionDate)} | ${safePdfText(transaction.description)} | ${safePdfText(transaction.status)} | ${formatMoney(transaction.amountCents, transaction.currency)}`));
  writeSection(document, "Promises to pay", snapshot.promisesToPay.map((promise) =>
    `${safePdfText(promise.dueDate)} | ${safePdfText(promise.status)} | ${formatMoney(promise.amountCents, promise.currency)}`));
  const futureCalls = snapshot.callAppointments.filter((call) => call.status === "scheduled" && Date.parse(call.scheduledAt) > Date.now());
  writeSection(document, "Future calls", futureCalls.map((call) =>
    `${safePdfText(call.scheduledAt)} | ${safePdfText(call.phone)} | ${safePdfText(call.reason ?? "No reason provided")}`));
  document.end();
  return completed;
}
