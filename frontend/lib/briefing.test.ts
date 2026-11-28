// Run with `npm test` (Node's built-in test runner; Node strips the types itself).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildBriefing, type BriefingSource, spokenCad, spokenDate, spokenPercent } from "./briefing.ts";

const base: BriefingSource = {
  profile: {
    display_name: "Maya",
    age: 20,
    school: null,
    city: "Calgary",
    province: "AB",
    currency: "CAD",
    is_fictional: true,
    spending_from: "chequing" as BriefingSource["profile"]["spending_from"],
    persona: null,
  },
  period: {
    start: "2026-11-01",
    end: "2026-11-30",
    label: "November 2026",
    phrase: "this month",
    single_month: true,
    month_count: 1,
  },
  spending_power_cents: 75_647,
  safe_to_spend: {
    fixed_cents: 125_000,
    variable_cents: 80_000,
    budget_cents: 205_000,
    spent_cents: 40_000,
    unpaid_bills_cents: 0,
    safe_cents: 75_647,
    over_cents: 0,
    has_budget: true,
  },
  spending_runway: { until: "2026-11-30", until_payday: true, days_left: 5, per_day_cents: 15_129, status: "on_track" },
  totals: {
    income_cents: 300_000,
    spending_cents: 164_353,
    cash_flow_cents: 135_647,
    total_budget_cents: 205_000,
    budget_remaining_cents: 40_647,
    savings_rate_basis_points: 4_521,
  },
  home: { available_cents: 90_000, spending_change_basis_points: -1_250 },
  bills: [
    bill("b1", "Phone", 4_500, "2026-12-03"),
    bill("b2", "Rent", 125_000, "2026-12-01"),
    bill("b3", "Gym", 2_999, "2026-11-20"),
    bill("b4", "Streaming", 1_699, "2026-12-09"),
    bill("b5", "Insurance", 8_000, "2026-12-15"),
  ],
  budgets: [
    budget("Groceries", 40_000, 36_800, 9_200),
    budget("Food out", 15_000, 17_500, 11_666),
    budget("Fun", 10_000, 2_000, 2_000),
    budget("Empty", 0, 0, 0),
  ],
  savings_goals: [
    goal("Trip to Banff", 50_000, 20_000, 4_000, "active"),
    goal("Laptop", 150_000, 150_000, 10_000, "completed"),
  ],
  cash_warnings: [],
};

function bill(id: string, name: string, amount_cents: number, next_due: string): BriefingSource["bills"][number] {
  return {
    id,
    name,
    amount_cents,
    category_id: null,
    account_id: "a1",
    frequency: "monthly" as BriefingSource["bills"][number]["frequency"],
    next_due,
    auto_record: false,
    last_paid_on: null,
    due_day: null,
    usual_due: null,
  };
}

function budget(name: string, limit: number, spent: number, usage: number): BriefingSource["budgets"][number] {
  return {
    id: name,
    category_id: name,
    category_name: name,
    month_start: "2026-11-01",
    limit_cents: limit,
    spent_cents: spent,
    remaining_cents: limit - spent,
    usage_basis_points: usage,
    carried_over: false,
  };
}

function goal(
  name: string,
  target: number,
  current: number,
  progress: number,
  status: "active" | "completed" | "paused",
): BriefingSource["savings_goals"][number] {
  return {
    id: name,
    name,
    target_cents: target,
    current_cents: current,
    target_date: null,
    status,
    progress_basis_points: progress,
    monthly_needed_cents: null,
    account_id: null,
    contributed_this_month_cents: 0,
    recent_contributions: [],
  };
}

const text = (source: BriefingSource, id: string) =>
  buildBriefing(source, "2026-11-26").find((item) => item.id === id)?.text;

describe("spokenCad", () => {
  it("reads dollars and cents", () => {
    assert.equal(spokenCad(75_647), "756 dollars and 47 cents");
    assert.equal(spokenCad(125_000), "1,250 dollars");
    assert.equal(spokenCad(100_000_000), "1,000,000 dollars");
  });
  it("handles singular and boundary amounts", () => {
    assert.equal(spokenCad(0), "0 dollars");
    assert.equal(spokenCad(1), "1 cent");
    assert.equal(spokenCad(99), "99 cents");
    assert.equal(spokenCad(100), "1 dollar");
    assert.equal(spokenCad(101), "1 dollar and 1 cent");
  });
  it("reads negatives as minus", () => {
    assert.equal(spokenCad(-1_250), "minus 12 dollars and 50 cents");
  });
  it("rejects anything that isn't integer cents", () => {
    assert.throws(() => spokenCad(12.5), RangeError);
    assert.throws(() => spokenCad(Number.NaN), RangeError);
    assert.throws(() => spokenCad(Number.MAX_SAFE_INTEGER + 1), RangeError);
  });
  it("is exact at the largest safe integer", () => {
    assert.equal(spokenCad(Number.MAX_SAFE_INTEGER), "90,071,992,547,409 dollars and 91 cents");
  });
});

describe("spokenPercent and spokenDate", () => {
  it("rounds percent down so almost-full never sounds full", () => {
    assert.equal(spokenPercent(9_999), "99 percent");
    assert.equal(spokenPercent(10_000), "100 percent");
    assert.equal(spokenPercent(-1_250), "12 percent");
    assert.equal(spokenPercent(0), "0 percent");
    assert.throws(() => spokenPercent(1.5), RangeError);
  });
  it("reads ISO dates as month and day", () => {
    assert.equal(spokenDate("2026-12-01"), "December 1");
    assert.throws(() => spokenDate("Dec 1"), RangeError);
  });
});

describe("buildBriefing", () => {
  it("reads Home in order and labels demo data", () => {
    const items = buildBriefing(base, "2026-11-26");
    assert.deepEqual(
      items.map((item) => item.id),
      ["intro", "safe", "spent", "bills", "budgets", "goals", "outro"],
    );
    assert.ok(items[0].text.includes("November 2026"));
    assert.ok(items[0].text.includes("fictional demo data"));
  });
  it("speaks safe to spend and the daily runway", () => {
    assert.equal(
      text(base, "safe"),
      "You have 756 dollars and 47 cents safe to spend this month. That’s about 151 dollars and 29 cents a day for 5 days, until payday. You’re on track.",
    );
  });
  it("says today's amount on the last day, and when money is tight", () => {
    const lastDay = { ...base, spending_runway: { ...base.spending_runway!, days_left: 1, status: "tight" as const } };
    assert.equal(
      text(lastDay, "safe"),
      "You have 756 dollars and 47 cents safe to spend this month. That’s 151 dollars and 29 cents left for today. Money is tight until payday.",
    );
  });
  it("speaks overspending without a minus sign", () => {
    assert.equal(
      text({ ...base, spending_power_cents: -2_500 }, "safe"),
      "You’re 25 dollars over your budget this month.",
    );
  });
  it("handles no budget, and bills-only budgets", () => {
    assert.match(
      text({ ...base, safe_to_spend: { ...base.safe_to_spend!, has_budget: false } }, "safe")!,
      /haven’t set a monthly budget/,
    );
    assert.match(
      text({ ...base, safe_to_spend: { ...base.safe_to_spend!, variable_cents: 0 } }, "safe")!,
      /^All of your 2,050 dollars budget goes to bills\./,
    );
  });
  it("compares spending with last month", () => {
    assert.equal(
      text(base, "spent"),
      "You’ve spent 1,643 dollars and 53 cents this month. That’s 12 percent less than last month at this point.",
    );
    assert.equal(
      text({ ...base, home: { ...base.home, spending_change_basis_points: null } }, "spent"),
      "You’ve spent 1,643 dollars and 53 cents this month.",
    );
  });
  it("reads the next three bills from today, soonest first", () => {
    assert.equal(
      text(base, "bills"),
      "Coming up: Rent, 1,250 dollars, on December 1, Phone, 45 dollars, on December 3, and Streaming, 16 dollars and 99 cents, on December 9.",
    );
    assert.equal(text({ ...base, bills: [bill("x", "Gym", 2_999, "2026-11-01")] }, "bills"), undefined);
  });
  it("reads budgets at 90 percent or more, worst first, skipping empty limits", () => {
    assert.equal(
      text(base, "budgets"),
      "Budgets to watch: Food out is 25 dollars over and Groceries has 32 dollars left, with 92 percent used.",
    );
    const calm = { ...base, budgets: [budget("Fun", 10_000, 2_000, 2_000)] };
    assert.equal(text(calm, "budgets"), "All of your budgets are under 90 percent used.");
    assert.equal(text({ ...base, budgets: [] }, "budgets"), undefined);
  });
  it("reads active goals only", () => {
    assert.equal(
      text(base, "goals"),
      "Your goals: Trip to Banff has 200 dollars of 500 dollars, 40 percent of the way.",
    );
  });
  it("reads cash warnings first when there are any", () => {
    const short = {
      ...base,
      cash_warnings: [
        {
          account_id: "a1",
          account_name: "Chequing",
          due_cents: 125_000,
          balance_cents: 100_000,
          short_cents: 25_000,
          bill_names: ["Rent"],
          first_due_on: "2026-12-01",
          cover_account_id: null,
          cover_account_name: null,
        },
      ],
    };
    const items = buildBriefing(short, "2026-11-26");
    assert.equal(items[3].id, "cash");
    assert.equal(items[3].text, "Heads up. Chequing is 250 dollars short for Rent due December 1.");
  });
  it("keeps the shortest summary for an empty account and leaves out the demo label for real data", () => {
    const empty: BriefingSource = {
      ...base,
      profile: { ...base.profile, is_fictional: false },
      spending_runway: null,
      bills: [],
      budgets: [],
      savings_goals: [],
    };
    const items = buildBriefing(empty, "2026-11-26");
    assert.deepEqual(
      items.map((item) => item.id),
      ["intro", "safe", "spent", "outro"],
    );
    assert.ok(!items[0].text.includes("fictional"));
  });
  it("rejects a malformed today", () => {
    assert.throws(() => buildBriefing(base, "26/11/2026"), RangeError);
  });
});
