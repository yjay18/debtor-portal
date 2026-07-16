const amountTokenPattern = /[+-]?\d[\d,]*(?:\.\d+)?/g;
const validAmountPattern = /^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?$/;

const currencyAliases: Record<string, string> = {
  "€": "EUR",
  euro: "EUR",
  euros: "EUR",
  "$": "USD",
  dollar: "USD",
  dollars: "USD",
  "£": "GBP",
  pound: "GBP",
  pounds: "GBP",
};

export type MoneyNormalizationResult =
  | { status: "ready"; amountCents: number; currency: string }
  | {
      status: "clarify";
      reason: "invalid_amount" | "unknown_currency" | "currency_mismatch";
      question: string;
    };

export function parseMajorAmountToCents(amountRaw: string): number | null {
  const tokens = amountRaw.match(amountTokenPattern);
  if (!tokens || tokens.length !== 1) return null;
// strict, we reject ambiguous amounts , but we keep decoration for later use (currency conversion if needed)
  const [token] = tokens;
  const decoration = amountRaw.replace(token, "");
  if (/[\d.,+-]/.test(decoration) || !validAmountPattern.test(token)) return null;

  const majorAmount = Number(token.replaceAll(",", ""));
  const amountCents = Math.round(majorAmount * 100);
  return Number.isSafeInteger(amountCents) && amountCents > 0
    ? amountCents
    : null;
}
//we dont attempt to convert currencies, only in Euro 
export function normalizeMoney(
  amountRaw: string,
  accountCurrency: string,
): MoneyNormalizationResult {
  const currency = accountCurrency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new Error("Account currency must be a three-letter code.");
  }

  const amountCents = parseMajorAmountToCents(amountRaw);
  if (amountCents === null) {
    return {
      status: "clarify",
      reason: "invalid_amount",
      question: "What positive amount would you like to use? Please use no more than two decimal places.",
    };
  }

  const mention = amountRaw
    .replace(amountTokenPattern, "")
    .trim()
    .toLocaleLowerCase("en");
  const statedCurrency =
    mention === "" || mention === "quid" || mention === "quids"
      ? currency
      : currencyAliases[mention] ?? (/^[a-z]{3}$/.test(mention) ? mention.toUpperCase() : null);

  if (statedCurrency === null) {
    return {
      status: "clarify",
      reason: "unknown_currency",
      question: `Which currency is that amount in? This account is billed in ${currency}.`,
    };
  }

  if (statedCurrency !== currency) {
    return {
      status: "clarify",
      reason: "currency_mismatch",
      question: `This account is billed in ${currency}. Please provide the amount in ${currency}; currency conversion is not supported.`,
    };
  }

  return { status: "ready", amountCents, currency };
}
