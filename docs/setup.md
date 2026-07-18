# Setup guide

## Prerequisites

- Node 24
- pnpm 11
- A Supabase project
- A Resend account if you want real email delivery
- An OpenAI compatible model endpoint

## Install

```bash
pnpm install --frozen-lockfile
cp .env.local.example .env.local
```

Fill `.env.local` locally. The example file uses placeholder text only.

| Variable | Required | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Supabase project URL. Safe for the browser. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | yes | Browser key. RLS denies direct table access. |
| `SUPABASE_SECRET_KEY` | yes | Server only key used by the page and chat route. |
| `RESEND_API_KEY` | no for offline tests, yes for deployed email | Server only. Tests mock this boundary. |
| `NOTIFICATION_FROM_EMAIL` | optional | Leave blank to use Resend's test sender, or set a verified sender. |
| `LLM_BASE_URL` | yes for live parser | Defaults well to `https://api.openai.com/v1` for production. |
| `LLM_MODEL` | yes for live parser | Tested with `gpt-4.1-mini-2025-04-14`. |
| `OPENAI_API_KEY` | yes for OpenAI | Server-only. Do not commit it. |

`LLM_SUPPORTS_JSON_SCHEMA` is intentionally omitted. The client uses strict JSON Schema unless this variable is exactly `false`, which is useful for local endpoints that don't accept structured output.

## Database

Apply the migrations in order from `supabase/migrations/`.

```bash
supabase db push
```

The starter migration seeds Jane Murphy as `acc_standard_001`. Later migrations add account context columns, conversation tables, deny-by-default RLS, notification triggers, and the atomic payment RPC.

If you do not use the Supabase CLI, apply the SQL files in timestamp order through your normal Supabase workflow.

## Run locally

```bash
pnpm dev
```

Open the local URL and use the seeded account. Without provider credentials, the offline tests still run; live chat parsing needs the LLM variables.

## Deploy

On Vercel, set the same environment variable names. Never expose `SUPABASE_SECRET_KEY`, `RESEND_API_KEY`, or `OPENAI_API_KEY` to the browser.

After deployment, verify:

1. The page loads the seeded account.
2. A read-only chat message works.
3. A mutation with your explicit approval persists after refresh.
4. A generic Resend email arrives.
5. The PDF opens with the last four digits of the current phone number.

Resend's sandbox sender only delivers to permitted inboxes. For a reviewer demo, first change the account email to an inbox you control.
