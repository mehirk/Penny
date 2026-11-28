import type { Dashboard } from "./api";

/**
 * Listen mode's spoken summary: the Home screen's figures, worded for the ear. Every amount is
 * one the API already computed in integer cents; this only puts words around it (nothing is
 * calculated or written by a model). No runtime imports, so `node --test` runs it directly.
 */

export type BriefingItem = {
  /** Stable per section, so the player can say which one it's on. */
  id: "intro" | "safe" | "spent" | "cash" | "bills" | "budgets" | "goals" | "outro";
  /** Short label shown in the player. */
  title: string;
  /** What is read aloud, and shown as the caption. */
  text: string;
};

export type BriefingSource = Pick<
  Dashboard,
  | "profile"
  | "period"
  | "spending_power_cents"
  | "safe_to_spend"
  | "spending_runway"
  | "totals"
  | "home"
  | "bills"
  | "budgets"
  | "savings_goals"
  | "cash_warnings"
>;

/** Budgets at or above this share used (in basis points) are read out. */
export const BUDGET_WARNING_BASIS_POINTS = 9_000;
const MAX_BILLS = 3;
const MAX_BUDGETS = 3;
const MAX_GOALS = 2;
const MAX_WARNINGS = 2;

function assertCents(cents: number): void {
  if (!Number.isSafeInteger(cents)) throw new RangeError(`Expected integer cents, got ${cents}`);
}

const plural = (count: bigint, one: string, many: string) => (count === 1n ? one : many);
const grouped = (value: bigint) => value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/**
 * Cents as speech: 75647 → "756 dollars and 47 cents", 100 → "1 dollar", 5 → "5 cents".
 * Digits stay digits so every voice reads them in its own natural way; the "$" and "." that
 * voices stumble over (and the "−" sign many skip) are spelled out instead.
 */
export function spokenCad(cents: number): string {
  assertCents(cents);
  const value = BigInt(cents);
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const dollars = absolute / 100n;
  const rest = absolute % 100n;
  const dollarPart = `${grouped(dollars)} ${plural(dollars, "dollar", "dollars")}`;
  const centPart = `${rest} ${plural(rest, "cent", "cents")}`;
  const words = dollars === 0n && rest > 0n ? centPart : rest === 0n ? dollarPart : `${dollarPart} and ${centPart}`;
  return negative ? `minus ${words}` : words;
}

/** Basis points as a whole spoken percent, rounded down so "almost all" is never "all": 9_950 → "99 percent". */
export function spokenPercent(basisPoints: number): string {
  if (!Number.isSafeInteger(basisPoints)) throw new RangeError(`Expected integer basis points, got ${basisPoints}`);
  return `${Math.trunc(Math.abs(basisPoints) / 100)} percent`;
}

/** "2026-12-01" → "December 1". */
export function spokenDate(isoDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) throw new RangeError(`Expected YYYY-MM-DD, got ${isoDate}`);
  return new Intl.DateTimeFormat("en-CA", { month: "long", day: "numeric", timeZone: "UTC" }).format(
    new Date(`${isoDate}T00:00:00Z`),
  );
}

/** "a", "a and b", "a, b, and c". */
function listOf(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

function safeToSpend(d: BriefingSource): string {
  const { safe_to_spend: safe, spending_power_cents: cents, spending_runway: runway, period } = d;
  if (safe && !safe.has_budget)
    return "You haven’t set a monthly budget yet, so Penny can’t work out what’s safe to spend. You can set one on the Budgets page.";
  if (cents < 0) return `You’re ${spokenCad(-cents)} over your budget ${period.phrase}.`;
  if (safe && safe.fixed_cents > 0 && safe.variable_cents === 0)
    return `All of your ${spokenCad(safe.budget_cents)} budget goes to bills. Set budgets for groceries, food, and fun to see what’s safe to spend.`;
  let text = `You have ${spokenCad(cents)} safe to spend ${period.phrase}.`;
  if (!runway) return text;
  if (runway.status === "empty")
    return `${text} Nothing is left to spend until ${runway.until_payday ? "payday" : "the month ends"}.`;
  text +=
    runway.days_left === 1
      ? ` That’s ${spokenCad(runway.per_day_cents)} left for today.`
      : ` That’s about ${spokenCad(runway.per_day_cents)} a day for ${runway.days_left} days${runway.until_payday ? ", until payday" : ""}.`;
  if (runway.status === "on_track") text += " You’re on track.";
  else if (runway.status === "tight") text += ` Money is tight ${runway.until_payday ? "until payday" : "this month"}.`;
  return text;
}

function spent(d: BriefingSource): string {
  const change = d.home.spending_change_basis_points;
  let text = `You’ve spent ${spokenCad(d.totals.spending_cents)} ${d.period.phrase}.`;
  if (change !== null && change !== 0) {
    const before = d.period.phrase === "this month" ? "last month" : "the period before";
    text += ` That’s ${spokenPercent(change)} ${change < 0 ? "less" : "more"} than ${before} at this point.`;
  } else if (change === 0) {
    text += " That’s about the same as before.";
  }
  return text;
}

function cashWarnings(d: BriefingSource): string | null {
  if (!d.cash_warnings.length) return null;
  const lines = d.cash_warnings.slice(0, MAX_WARNINGS).map((warning) => {
    const bills = listOf(warning.bill_names);
    return `${warning.account_name} is ${spokenCad(warning.short_cents)} short for ${bills || "bills"} due ${spokenDate(warning.first_due_on)}.`;
  });
  const more = d.cash_warnings.length - lines.length;
  return `Heads up. ${lines.join(" ")}${more > 0 ? ` And ${more} more on the Home screen.` : ""}`;
}

function upcomingBills(d: BriefingSource, today: string): string | null {
  const next = d.bills
    .filter((bill) => bill.next_due >= today)
    .sort((a, b) => a.next_due.localeCompare(b.next_due) || a.name.localeCompare(b.name))
    .slice(0, MAX_BILLS);
  if (!next.length) return null;
  const parts = next.map((bill) => `${bill.name}, ${spokenCad(bill.amount_cents)}, on ${spokenDate(bill.next_due)}`);
  return `Coming up: ${listOf(parts)}.`;
}

function budgets(d: BriefingSource): string | null {
  const active = d.budgets.filter((budget) => budget.limit_cents > 0);
  if (!active.length) return null;
  const close = active
    .filter((budget) => budget.usage_basis_points >= BUDGET_WARNING_BASIS_POINTS)
    .sort((a, b) => b.usage_basis_points - a.usage_basis_points || a.category_name.localeCompare(b.category_name))
    .slice(0, MAX_BUDGETS);
  if (!close.length) return "All of your budgets are under 90 percent used.";
  const parts = close.map((budget) =>
    budget.remaining_cents < 0
      ? `${budget.category_name} is ${spokenCad(-budget.remaining_cents)} over`
      : `${budget.category_name} has ${spokenCad(budget.remaining_cents)} left, with ${spokenPercent(budget.usage_basis_points)} used`,
  );
  return `Budgets to watch: ${listOf(parts)}.`;
}

function goals(d: BriefingSource): string | null {
  const active = d.savings_goals.filter((goal) => goal.status === "active").slice(0, MAX_GOALS);
  if (!active.length) return null;
  const parts = active.map(
    (goal) =>
      `${goal.name} has ${spokenCad(goal.current_cents)} of ${spokenCad(goal.target_cents)}, ${spokenPercent(goal.progress_basis_points)} of the way`,
  );
  return `Your goals: ${listOf(parts)}.`;
}

/**
 * The summary, in the order Home shows it. `today` (YYYY-MM-DD) decides which bills are still
 * ahead. Sections with nothing to say are left out, so the shortest summary is intro, safe to
 * spend, spending, and the sign-off.
 */
export function buildBriefing(d: BriefingSource, today: string): BriefingItem[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) throw new RangeError(`Expected YYYY-MM-DD, got ${today}`);
  const demo = d.profile.is_fictional ? " This is fictional demo data." : "";
  const items: (BriefingItem | null)[] = [
    {
      id: "intro",
      title: "Your summary",
      text: `Here’s your Penny summary for ${d.period.label}.${demo} Press your AirPods once to pause, twice to skip, or three times to go back.`,
    },
    { id: "safe", title: "Safe to spend", text: safeToSpend(d) },
    { id: "spent", title: "Spending", text: spent(d) },
    textItem("cash", "Heads up", cashWarnings(d)),
    textItem("bills", "Bills coming up", upcomingBills(d, today)),
    textItem("budgets", "Budgets", budgets(d)),
    textItem("goals", "Goals", goals(d)),
    { id: "outro", title: "That’s all", text: "That’s everything for now. Press play to hear it again." },
  ];
  return items.filter((item): item is BriefingItem => item !== null);
}

function textItem(id: BriefingItem["id"], title: string, text: string | null): BriefingItem | null {
  return text ? { id, title, text } : null;
}
