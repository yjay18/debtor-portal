//masking email addresses
export function redactEmailRecipient(email: string): string {
  const match = /^([^@\s]+)@([^@.\s]+)(\.[^@\s]+)$/.exec(email);
  if (!match) return "***";
  return `${match[1][0]}***@${match[2][0]}***${match[3]}`;
}
