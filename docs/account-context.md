# Account Context

The fixtures in `fixtures/` are the starter account data. The migration in `supabase/migrations/` seeds the standard account into a minimal table outline. Candidates should evolve that schema as needed, and the final implementation should preserve the same business concepts.

## Mutable Fields

These fields should be readable and writable through chat:

- account holder name
- account holder email
- account holder phone
- account holder address
- preferred contact method
- related people
- promises to pay
- transactions created by mocked payments
- call appointments
- current account balance after mocked payments

## Read-Only Starter Fields

These fields may be treated as read-only unless the candidate documents a reason to change them:

- account reference
- creditor name
- account status
- days past due
- billing due date
- support phone and email
- seeded historical transactions

## Legacy Fixture Names

The JSON fixtures still use `debtorFirstName` and `debtorLastName` because the original starter came from a debtor-portal challenge. Candidate-facing code should prefer `account holder` language. The starter helper in `src/lib/account/types.ts` normalizes those legacy fixture fields into `accountHolderFirstName` and `accountHolderLastName`.

## Notification Rule

Every fixture starts with phone number `+353831234567`. The initial encrypted PDF password is the last four digits: `4567`.

When persisted account data changes, the app should send a generic email and put sensitive account details in the encrypted PDF attachment.

The deployed submission should use Resend for the email and attach an encrypted PDF. Tests should mock this boundary instead of calling Resend or inspecting a real inbox.
