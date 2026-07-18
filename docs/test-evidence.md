# Test evidence

## Latest local checks

These checks were run after the final hardening work:

```bash
CI=true pnpm lint
CI=true pnpm typecheck
CI=true pnpm test
CI=true pnpm build
pnpm audit --prod
```

Results:

- Lint passed.
- Typecheck passed.
- Vitest passed: 383 tests across 19 files, zero skips.
- Production build passed on Next.js 16.2.10.
- Production audit was reduced from 57 advisories to one low build time Babel advisory through Next/styled-jsx. The advisory's stated fixed version is not published yet.

CI runs install, lint, typecheck, and tests from a frozen lockfile in `.github/workflows/ci.yml`.

## What the automated tests cover

| Area | Evidence |
| --- | --- |
| Chat route contract | `src/app/api/chat/route.test.ts` covers request validation, persisted turns, notification audit metadata, pending confirmations, overlong input, and mutation orchestration. |
| Router decisions | `src/lib/chat/router.test.ts` covers every read path, every mutation path, no-op behavior, unsupported requests, payment replay, insufficient balance, and concise singular reads. |
| Acceptance examples | `src/lib/chat/chat-contracts.test.ts` exercises the required phone update, related person add, missing detail follow-up, promise, mocked payment, and call examples. |
| Parser contract | `src/lib/llm/parser.test.ts` and `parser-schema.test.ts` cover prompt stability, deterministic guards, unsupported injection-like requests, strict schemas, singular reads, and safe clarification. |
| Money and dates | `src/lib/llm/money.test.ts` and `dates.test.ts` prove integer cents, no FX conversion, malformed amount rejection, Dublin date agreement, and past date clarification. |
| Database mapping | `src/lib/account/repo.test.ts` covers snake_case to camelCase mapping, strict metadata validation, scoped writes, and `record_payment` RPC mapping/replay recovery. |
| Notifications | `src/lib/notifications/*.test.ts` covers generic email bodies, sender validation, redacted fallback logging, encrypted PDF options, password derivation, queued/failed retry selection, and status updates. |
| UI safety | `src/lib/chat/request-lock.test.ts` covers the synchronous request lock used by the portal before React state updates render. |

## Model evaluation

The opt-in golden set has 46 synthetic customer messages. It includes the acceptance examples, paraphrases, missing field cases, prompts with more than one action, relative dates, currency mismatches, and injection-like prompts.

The selected model is `gpt-4.1-mini-2025-04-14`. It completed two corrected 46 case semantic passes with:

- 46/46 expected intents.
- 24/24 semantic field checks.
- zero product impacting failures.
- about $0.0142 per 46 case pass in the measured run.

The raw model output is intentionally ignored under `eval/output/`; only aggregate evidence is used for documentation.

## Deployed evidence

The deployed app has been checked for:

- M3 email/PDF proof: a generic email arrived, and the encrypted PDF opened with the current phone last four.
- M4 payment and call proof: a live EUR 5.00 mocked payment and a future call booking persisted after refresh and sent notification emails.
- M6 singular read proof: email, phone, due date, and preferred contact reads returned minimum data replies without a full account payload; a broad account details request still returned the full account.
- Safe validation probes: zero payments, foreign currency payments, standalone cancellation, and instruction override balance edits did not write account data.

One operational correction is documented in private context: an overly fast browser smoke test caused an unapproved EUR 30.00 payment. It was repaired with explicit approval, and the source now has a synchronous request lock to prevent overlapping sends.
