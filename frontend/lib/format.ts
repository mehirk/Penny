const utc = (value: string) => new Date(`${value}T00:00:00Z`);

export function formatShortDate(value: string): string {
  return new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", timeZone: "UTC" }).format(utc(value));
}

export function formatLongDate(value: string): string {
  return new Intl.DateTimeFormat("en-CA", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(
    utc(value),
  );
}

export function formatMonth(value: string): string {
  return new Intl.DateTimeFormat("en-CA", { month: "long", year: "numeric", timeZone: "UTC" }).format(utc(value));
}

/**
 * A new transaction's date: the app's "today" (from the API, which keeps the demo inside its own
 * month) when it falls in the month shown, else the device's date, else the month's first day.
 */
export function defaultTransactionDate(activeMonth: string, appToday: string | null = null, now = new Date()): string {
  if (appToday?.slice(0, 7) === activeMonth.slice(0, 7)) return appToday;
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return today.slice(0, 7) === activeMonth.slice(0, 7) ? today : activeMonth;
}

export function greeting(now = new Date()): string {
  const hour = now.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/** Shifts a YYYY-MM-01 month string by whole months. */
export function addMonths(month: string, count: number): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const index = year * 12 + (monthNumber - 1) + count;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}-01`;
}

/** The last day (YYYY-MM-DD) of the month `count` months after `day`'s month. */
export function monthEndAfter(day: string, count: number): string {
  const [year, month] = addMonths(`${day.slice(0, 7)}-01`, count)
    .split("-")
    .map(Number);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
}
