import { expect, it } from "vitest";

import standardFixture from "../../../fixtures/debtor-standard.json";
import { normalizeLegacyFixture } from "@/lib/account/types";
import { buildAccountSummaryPdf, buildEncryptedPdfOptions } from "./pdf";

const account = normalizeLegacyFixture(standardFixture);
const password = account.account.phone.replace(/\D/g, "").slice(-4);

it("uses the current-phone password with AES-256 PDF options", () => {
  const options = buildEncryptedPdfOptions(password);
  expect(options).toMatchObject({ userPassword: password, pdfVersion: "1.7ext3" });
  expect(options.ownerPassword).toMatch(/^[a-f0-9]{64}$/);
  expect(options.ownerPassword).not.toBe(password);
});

it("builds a non-empty encrypted account summary in memory", async () => {
  const buffer = await buildAccountSummaryPdf(account, password);
  const encoded = buffer.toString("latin1");
  expect(buffer.subarray(0, 8).toString()).toBe("%PDF-1.7");
  expect(buffer.length).toBeGreaterThan(1_000);
  expect(encoded).toContain("/Encrypt");
  expect(encoded).not.toContain(account.account.email);
});
