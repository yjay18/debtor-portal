# Chat Scenarios

Use these scenarios as acceptance examples. The exact wording does not need to match, but the behaviour should.

## Read Account Details

User: "What phone number is on my account?"

Expected behaviour: return the current phone number without changing data or sending a notification.

## Update Phone Number

User: "Change my phone number to +353831112233."

Expected behaviour: validate the phone number, persist it, confirm the change, and queue the generic email with encrypted PDF.

## Missing Related Person Details

User: "Add my brother so he can speak for me."

Expected behaviour: ask for missing name, phone number, and email address before writing anything. Keep enough pending-request context to complete the same action when the user supplies those details in the next message.

## Add Authorized Related Person

User: "Add Mark Murphy, mark@example.test, +353831998877 so he can act for me."

Expected behaviour: create Mark as a related person with `authorizedToAct: true`, confirm the change, and queue the generic email with encrypted PDF.

## Update Related Person

User: "Change Mark's phone number to +353831112233."

Expected behaviour: find the related person, update the phone number, confirm the change, and queue the generic email with encrypted PDF. If more than one Mark exists, ask a clarifying question.

## Promise To Pay

User: "Can I pay 500 euro on the 1st of next month?"

Expected behaviour: parse amount and future date, store a one-time promise to pay, confirm it, and queue the generic email with encrypted PDF.

## Mock Payment

User: "Pay 150 euro now."

Expected behaviour: validate the amount, record a completed mocked payment transaction, reduce the account balance by 150 euro, confirm that saved payment details were used, and queue the generic email with encrypted PDF. The balance and transaction history should remain consistent if the request fails or is repeated; document the behaviour you choose.

## Transaction History

User: "Show my transactions."

Expected behaviour: list seeded transactions plus any mocked payments created during the chat.

## Future Call Appointment

User: "Book a call next Tuesday at 10am about my bill."

Expected behaviour: schedule a future call appointment, confirm the time and phone number, and queue the generic email with encrypted PDF.

## Past Call Appointment

User: "Book a call yesterday."

Expected behaviour: reject the past date and ask for a future date.
