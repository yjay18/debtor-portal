import { existsSync, mkdirSync, writeFileSync } from "node:fs";

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

async function main() {
  const failures: Array<Record<string, unknown>> = [];
  let intentMatches = 0;
  let fieldMatches = 0;
  let fieldCases = 0;

  for (const testCase of goldenSet) {
    const actual = await parseMessage({ ...parserContext, message: testCase.message });
    const acceptedActions = Array.isArray(testCase.expectedAction) ? testCase.expectedAction : [testCase.expectedAction];
    const actionMatches = acceptedActions.includes(actual.action);
    const fieldsMatch = testCase.expectedFields === undefined || stable(actual.fields) === stable(testCase.expectedFields);
    const additionalMatches = testCase.expectedAdditionalAction === undefined
      || actual.additionalIntents[0]?.action === testCase.expectedAdditionalAction;
    if (actionMatches) intentMatches += 1;
    if (testCase.expectedFields !== undefined) {
      fieldCases += 1;
      if (fieldsMatch) fieldMatches += 1;
    }
    if (!actionMatches || !fieldsMatch || !additionalMatches) failures.push({
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
    failures,
  };
  mkdirSync("eval/output", { recursive: true });
  writeFileSync("eval/output/latest.json", `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Golden set: ${intentMatches}/${goldenSet.length} intents (${(report.intentAccuracy * 100).toFixed(1)}%), ${fieldMatches}/${fieldCases} exact fields (${(report.fieldExactMatch * 100).toFixed(1)}%), ${failures.length} flagged cases.`);
}

void main();
