import { existsSync, mkdirSync, writeFileSync } from "node:fs";

import { normalizeMoney, parseMajorAmountToCents } from "@/lib/llm/money";
import { parseMessage, type ParserInput } from "@/lib/llm/parser";
import { goldenSet } from "./golden-set";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const parserContext: Omit<ParserInput, "message"> = {
  history: [],
  dialogState: { queuedIntents: [] },
  account: { holderName: "Test Account", email: "test@example.test", phone: "+353831234567", currency: "EUR", relatedPeopleCount: 1 },
  nowIso: "2026-07-17T09:00:00.000Z",
};

function stable(value: unknown): string {
  if (!value || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
    .map(([key, field]) => `${JSON.stringify(key)}:${stable(field)}`).join(",")}}`;
}

function semanticFields(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;

  return Object.fromEntries(Object.entries(value).map(([field, fieldValue]) => {
    if (field !== "amountRaw" || typeof fieldValue !== "string") return [field, fieldValue];

    const amountCents = parseMajorAmountToCents(fieldValue);
    if (amountCents === null) return [field, fieldValue];
    const money = normalizeMoney(fieldValue, parserContext.account.currency);
    return [field, money.status === "ready"
      ? { amountCents, currency: money.currency }
      : { amountCents, reason: money.reason }];
  }));
}

async function main() {
  const failures: Array<Record<string, unknown>> = [];
  let intentMatches = 0;
  let fieldMatches = 0;
  let semanticFieldMatches = 0;
  let representationDifferences = 0;
  let fieldCases = 0;

  for (const testCase of goldenSet) {
    const actual = await parseMessage({ ...parserContext, message: testCase.message });
    const acceptedActions = Array.isArray(testCase.expectedAction) ? testCase.expectedAction : [testCase.expectedAction];
    const actionMatches = acceptedActions.includes(actual.action);
    const fieldsMatch = testCase.expectedFields === undefined || stable(actual.fields) === stable(testCase.expectedFields);
    const semanticFieldsMatch = testCase.expectedFields === undefined
      || stable(semanticFields(actual.fields)) === stable(semanticFields(testCase.expectedFields));
    const additionalMatches = testCase.expectedAdditionalAction === undefined
      || actual.additionalIntents[0]?.action === testCase.expectedAdditionalAction;
    if (actionMatches) intentMatches += 1;
    if (testCase.expectedFields !== undefined) {
      fieldCases += 1;
      if (fieldsMatch) fieldMatches += 1;
      if (semanticFieldsMatch) semanticFieldMatches += 1;
      if (!fieldsMatch && semanticFieldsMatch) representationDifferences += 1;
    }
    if (!actionMatches || !semanticFieldsMatch || !additionalMatches) failures.push({
      id: testCase.id,
      expectedAction: testCase.expectedAction,
      actualAction: actual.action,
      ...(testCase.expectedFields === undefined ? {} : { expectedFields: testCase.expectedFields, actualFields: actual.fields }),
      ...(testCase.expectedAdditionalAction === undefined ? {} : {
        expectedAdditionalAction: testCase.expectedAdditionalAction,
        actualAdditionalAction: actual.additionalIntents[0]?.action ?? null,
      }),
    });
  }

  const report = {
    evaluatedAt: new Date().toISOString(),
    caseCount: goldenSet.length,
    intentAccuracy: intentMatches / goldenSet.length,
    fieldExactMatch: fieldCases === 0 ? 1 : fieldMatches / fieldCases,
    fieldSemanticMatch: fieldCases === 0 ? 1 : semanticFieldMatches / fieldCases,
    representationDifferences,
    failures,
  };
  mkdirSync("eval/output", { recursive: true });
  writeFileSync("eval/output/latest.json", `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Golden set: ${intentMatches}/${goldenSet.length} intents (${(report.intentAccuracy * 100).toFixed(1)}%), ${fieldMatches}/${fieldCases} exact fields (${(report.fieldExactMatch * 100).toFixed(1)}%), ${semanticFieldMatches}/${fieldCases} semantic fields (${(report.fieldSemanticMatch * 100).toFixed(1)}%), ${representationDifferences} representation differences, ${failures.length} product-impacting cases.`);
}

const keepAlive = setInterval(() => undefined, 1_000);
void main()
  .catch(() => {
    console.error("Golden-set evaluation failed.");
    process.exitCode = 1;
  })
  .finally(() => clearInterval(keepAlive));
