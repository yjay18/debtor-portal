import * as chrono from "chrono-node";

const DUBLIN_TIME_ZONE = "Europe/Dublin";
const isoDatePattern = /^(\d{4})-(\d{2})-(\d{2})$/;
const isoDateTimePattern =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|([+-])(\d{2}):(\d{2}))$/;

type DateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

export type FutureDateKind = "date" | "dateTime";

export type FutureDateResolution =
  | { status: "ready"; iso: string }
  | {
      status: "clarify";
      reason: "invalid_llm_date" | "unresolved_raw_date" | "date_disagreement" | "not_future";
      question: string;
    };

const dublinFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: DUBLIN_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function dublinParts(date: Date): DateParts {
  const values = Object.fromEntries(
    dublinFormatter
      .formatToParts(date)
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, Number(value)]),
  );
  return values as DateParts;
}

function dateKey(parts: Pick<DateParts, "year" | "month" | "day">): string {
  return `${parts.year.toString().padStart(4, "0")}-${parts.month
    .toString()
    .padStart(2, "0")}-${parts.day.toString().padStart(2, "0")}`;
}

function dateTimeKey(parts: DateParts): string {
  return `${dateKey(parts)}T${parts.hour.toString().padStart(2, "0")}:${parts.minute
    .toString()
    .padStart(2, "0")}`;
}

function dublinOffsetMinutes(date: Date): number {
  const parts = dublinParts(date);
  const localAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return Math.round((localAsUtc - date.getTime()) / 60_000);
}

function isValidIsoDate(value: string): boolean {
  const match = isoDatePattern.exec(value);
  if (!match) return false;

  const [, yearRaw, monthRaw, dayRaw] = match;
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

function parseIsoDateTime(value: string): Date | null {
  const match = isoDateTimePattern.exec(value);
  if (!match) return null;

  const [, yearRaw, monthRaw, dayRaw, hourRaw, minuteRaw, secondRaw, , zone, sign, zoneHourRaw, zoneMinuteRaw] = match;
  const expected = {
    year: Number(yearRaw),
    month: Number(monthRaw),
    day: Number(dayRaw),
    hour: Number(hourRaw),
    minute: Number(minuteRaw),
    second: Number(secondRaw ?? "0"),
  };
  const zoneHours = Number(zoneHourRaw ?? "0");
  const zoneMinutes = Number(zoneMinuteRaw ?? "0");
  if (zone !== "Z" && (zoneHours > 14 || zoneMinutes > 59 || (zoneHours === 14 && zoneMinutes > 0))) {
    return null;
  }

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;

  const direction = sign === "-" ? -1 : 1;
  const offset = zone === "Z" ? 0 : direction * (zoneHours * 60 + zoneMinutes);
  const local = new Date(timestamp + offset * 60_000);
  const roundTrip = {
    year: local.getUTCFullYear(),
    month: local.getUTCMonth() + 1,
    day: local.getUTCDate(),
    hour: local.getUTCHours(),
    minute: local.getUTCMinutes(),
    second: local.getUTCSeconds(),
  };
  return Object.entries(expected).every(
    ([key, expectedValue]) => roundTrip[key as keyof DateParts] === expectedValue,
  )
    ? new Date(timestamp)
    : null;
}
//revalidation with chrono

function chronoKey(result: chrono.ParsedResult, kind: FutureDateKind): string | null {
  const parts = {
    year: result.start.get("year"),
    month: result.start.get("month"),
    day: result.start.get("day"),
    hour: result.start.get("hour"),
    minute: result.start.get("minute"),
    second: result.start.get("second"),
  };
  if (Object.values(parts).some((value) => value === null)) return null;
  return kind === "date" ? dateKey(parts as DateParts) : dateTimeKey(parts as DateParts);
}

export function resolveFutureDate(input: {
  rawText: string;
  llmIso: string;
  nowIso: string;
  kind: FutureDateKind;
}): FutureDateResolution {
  const now = new Date(input.nowIso);
  if (!Number.isFinite(now.getTime())) {
    throw new Error("Current time must be a valid ISO timestamp.");
  }

  const llmDateTime = input.kind === "dateTime" ? parseIsoDateTime(input.llmIso) : null;
  if (
    (input.kind === "date" && !isValidIsoDate(input.llmIso)) ||
    (input.kind === "dateTime" && llmDateTime === null)
  ) {
    return {
      status: "clarify",
      reason: "invalid_llm_date",
      question: "What future date or time would you like? Please give an exact date.",
    };
  }

  const chronoResults = chrono.en.GB.parse(
    input.rawText,
    { instant: now, timezone: dublinOffsetMinutes(now) },
    { forwardDate: true },
  );
  if (chronoResults.length !== 1) {
    return {
      status: "clarify",
      reason: "unresolved_raw_date",
      question: "I could not identify one clear date. What exact future date or time should I use?",
    };
  }

  const modelKey =
    input.kind === "date" ? input.llmIso : dateTimeKey(dublinParts(llmDateTime as Date));
  if (chronoKey(chronoResults[0], input.kind) !== modelKey) {
    return {
      status: "clarify",
      reason: "date_disagreement",
      question: "I found two possible dates. Please give the exact future date or time you mean.",
    };
  }

  const isFuture =
    input.kind === "date"
      ? input.llmIso > dateKey(dublinParts(now))
      : (llmDateTime as Date).getTime() > now.getTime();
  if (!isFuture) {
    return {
      status: "clarify",
      reason: "not_future",
      question: "Please choose a date or time in the future.",
    };
  }

  return {
    status: "ready",
    iso: input.kind === "date" ? input.llmIso : (llmDateTime as Date).toISOString(),
  };
}
