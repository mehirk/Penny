import { getSupabaseAccessToken } from "./supabase";

export type SpendingFrom = "chequing" | "chequing_and_savings";
/** "person": a friend you share costs with. Positive balance, they owe you; negative, you owe them. */
export type AccountType = "chequing" | "savings" | "credit" | "cash" | "investment" | "other" | "person";
export type AccountBalance = {
  id: string;
  name: string;
  account_type: AccountType;
  balance_cents: number;
  net_cents: number;
  credit_limit_cents: number | null;
  available_credit_cents: number | null;
  utilization_basis_points: number | null;
  goals: { id: string; name: string; current_cents: number }[];
  goal_cents: number;
  free_cents: number | null;
  money_in_cents: number;
  money_out_cents: number;
  last_activity_on: string | null;
};
/** Every account and how they add up, as of today (whatever period is on screen). */
export type AccountsOverview = {
  accounts: AccountBalance[];
  spending_cents: number;
  savings_cents: number;
  assets_cents: number;
  owed_cents: number;
  net_worth_cents: number;
  goal_cents: number;
  goal_shortfall_cents: number;
};
export type Account = {
  id: string;
  name: string;
  account_type: AccountType;
  balance_cents: number;
  credit_limit_cents: number | null;
  payment_due_day: number | null;
  card_paid_on: string | null;
};
/** A credit card's next payment (from its due day) and what's owed on it now. */
export type CardPayment = {
  account_id: string;
  account_name: string;
  due_on: string;
  days_until_due: number;
  owed_cents: number;
  paid_on: string | null;
};
export type Category = {
  id: string;
  name: string;
  colour_token: string;
  kind: "income" | "spending";
  parent_id: string | null;
  custom: boolean;
};
export type Transaction = {
  id: string;
  description: string;
  category: string;
  account_id: string;
  category_id: string | null;
  amount_cents: number;
  kind: "income" | "spending";
  occurred_on: string;
  necessity: "need" | "want" | null;
  auto_categorized: boolean;
  bill_id: string | null;
  paid_automatically: boolean | null;
  unusual: boolean;
  history_only: boolean;
  group_id: string | null;
  pay_id: string | null;
};
export type Budget = {
  id: string;
  category_id: string;
  category_name: string;
  month_start: string;
  limit_cents: number;
  spent_cents: number;
  remaining_cents: number;
  usage_basis_points: number;
  carried_over: boolean;
};
export type GoalContribution = {
  id: string;
  amount_cents: number;
  from_account_id: string;
  to_account_id: string | null;
  occurred_on: string;
  source: "you" | "penny";
};
export type SavingsGoal = {
  id: string;
  name: string;
  target_cents: number;
  current_cents: number;
  target_date: string | null;
  status: "active" | "completed" | "paused";
  progress_basis_points: number;
  monthly_needed_cents: number | null;
  account_id: string | null;
  contributed_this_month_cents: number;
  recent_contributions: GoalContribution[];
};
export type Mission = { id: string; title: string; description: string; xp_reward: number; completed: boolean };
export type CategorySpending = {
  category_id: string | null;
  category_name: string;
  colour_token: string;
  spent_cents: number;
  share_basis_points: number;
};
type FinancialHealthFactor = { id: string; label: string; score: number; max_score: number; explanation: string };
export type FinancialHealth = { score: number; factors: FinancialHealthFactor[]; methodology: string };
type Zone = "green" | "yellow" | "red";
/** The daily Money Score. `today` is the app's "today" while the current month is shown. */
export type MoneyCalendar = {
  today: string | null;
  today_score: number | null;
  today_zone: Zone | null;
  daily_allowance_cents: number;
  streaks: {
    current_green: number;
    best_green: number;
    no_spend_days: number;
    green_days: number;
    scored_days: number;
  };
  methodology: string;
};
export type BillFrequency = "weekly" | "biweekly" | "monthly" | "yearly";
/** `usual_due` is set when only the next payment was moved: the date it would usually be due. */
export type Bill = {
  id: string;
  name: string;
  amount_cents: number;
  category_id: string | null;
  account_id: string;
  frequency: BillFrequency;
  next_due: string;
  auto_record: boolean;
  last_paid_on: string | null;
  due_day: number | null;
  usual_due: string | null;
};
/** A bill to save. `already_paid` answers "have you paid it?" for a due date that has passed. */
export type BillWrite = Omit<Bill, "id" | "last_paid_on" | "due_day" | "usual_due"> & {
  already_paid?: "history" | "balance" | null;
};
export type PayFrequency = "weekly" | "biweekly" | "semimonthly" | "monthly" | "custom";
export type PayScheduleWrite = {
  name: string;
  amount_cents: number;
  account_id: string;
  frequency: PayFrequency;
  next_payday: string;
  interval_days: number | null;
};
/** One source of pay (a job, a scholarship, an allowance); people can have several. */
export type PaySchedule = PayScheduleWrite & { id: string };
export type PaySource = PaySchedule & { monthly_cents: number; upcoming: string[] };
/** Every source of pay, their monthly total, and every payday in the next 35 days. */
/** One payday; `received` once a paycheque is recorded for it. */
export type UpcomingPay = { pay_id: string; name: string; on: string; amount_cents: number; received: boolean };
/** `to_confirm`: paydays from the last week (today too) with no paycheque recorded yet. */
export type PayOverview = {
  monthly_cents: number;
  sources: PaySource[];
  upcoming: UpcomingPay[];
  to_confirm: UpcomingPay[];
};
export type PayReceivedWrite = { occurred_on: string; amount_cents: number; affect_balance: boolean };
/** The payday check-in (backend app/domain/payday_plan.py). Suggestions only. */
export type PlanDue = { name: string; due_on: string; amount_cents: number; kind: "bill" | "card" };
export type PaydayPlan = {
  amount_cents: number;
  usual_cents: number;
  extra_cents: number;
  windfall: boolean;
  next_payday: string | null;
  until: string;
  from_account_id: string;
  from_account_name: string;
  spendable_cents: number;
  due: PlanDue[];
  due_cents: number;
  short_cents: number;
  card: { account_id: string; account_name: string; owed_cents: number; amount_cents: number } | null;
  save: { goal_id: string | null; goal_name: string | null; amount_cents: number } | null;
  yours_cents: number;
  methodology: string;
};
export type CalendarReminder = "none" | "same_day" | "day_before";
export type CalendarExportWrite = {
  bills: boolean;
  cards: boolean;
  pay: boolean;
  show_amounts: boolean;
  reminder: CalendarReminder;
};
export type CalendarExport = { path: string; event_count: number; expires_in_seconds: number };
export type RecurringExpense = {
  id: string;
  name: string;
  category_name: string | null;
  amount_cents: number;
  monthly_cents: number;
  frequency: BillFrequency;
  next_due: string;
  days_until_due: number;
  kind: "bill" | "subscription";
  auto_record: boolean;
  last_paid_on: string | null;
  payment_count: number;
  total_paid_cents: number;
  paid_this_month: boolean;
  status: "overdue" | "due_soon" | "later";
};
export type RecurringPayment = {
  bill_id: string;
  name: string;
  occurred_on: string;
  amount_cents: number;
  paid_automatically: boolean | null;
};
export type UpcomingPayment = {
  bill_id: string;
  name: string;
  due_on: string;
  days_until_due: number;
  amount_cents: number;
  auto_record: boolean;
  kind: "bill" | "subscription";
};
export type RecurringMonth = {
  paid_count: number;
  paid_cents: number;
  left_count: number;
  left_cents: number;
  overdue_count: number;
  overdue_cents: number;
};
type RecurringSuggestion = { name: string; category_id: string | null; amount_cents: number; next_due: string };
export type RecurringSummary = {
  items: RecurringExpense[];
  bill_count: number;
  subscription_count: number;
  this_month: RecurringMonth | null;
  upcoming: UpcomingPayment[];
  recent_payments: RecurringPayment[];
  suggestions: RecurringSuggestion[];
  fixed_monthly_cents: number;
  subscriptions_monthly_cents: number;
  unpaid_bills_cents: number;
  unpaid: UpcomingPayment[];
  share_of_income_basis_points: number | null;
  methodology: string;
};
export type BillHistory = {
  bill: Bill;
  payments: Transaction[];
  payment_count: number;
  total_paid_cents: number;
  paid_this_year_cents: number;
  average_cents: number;
};
export type LessonTrack = "budgeting" | "saving" | "tax" | "credit" | "rules" | "investing";
export type LessonTier = "easy" | "medium" | "hard";
/** The date range a dashboard covers. `phrase` reads after a verb: "spent $X this month". */
export type Period = {
  start: string;
  end: string;
  label: string;
  phrase: string;
  single_month: boolean;
  month_count: number;
};
export type Dashboard = {
  active_month: string;
  period: Period;
  current_month: string;
  data_months: string[];
  profile: {
    display_name: string;
    age: number | null;
    school: string | null;
    city: string | null;
    province: string | null;
    currency: "CAD";
    is_fictional: boolean;
    spending_from: SpendingFrom;
  };
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
  budgets: Budget[];
  savings_goals: SavingsGoal[];
  missions: Mission[];
  xp_total: number;
  category_spending: CategorySpending[];
  credit: {
    account_id: string;
    account_name: string;
    balance_cents: number;
    credit_limit_cents: number;
    utilization_basis_points: number;
  } | null;
  financial_health: FinancialHealth;
  money_calendar: MoneyCalendar;
  recurring: RecurringSummary;
  spending_classification: {
    needs_cents: number;
    wants_cents: number;
    needs_basis_points: number;
    wants_basis_points: number;
  };
  bills: Bill[];
  /** Every source of pay; the largest a month is first and sets the pay cycles. */
  pay: PayOverview | null;
  /** Spending money now, and month-to-date spending against last month's same days. */
  home: { available_cents: number; spending_change_basis_points: number | null };
  accounts_overview: AccountsOverview;
  previous_month_cash_flow_cents: number | null;
  spending_power_cents: number;
  safe_to_spend: SafeToSpendBreakdown | null;
  card_payments: CardPayment[];
  budget_plan: BudgetPlan | null;
  /** Accounts that can't cover the bills still due from them this month (a heads-up only). */
  cash_warnings: CashWarning[];
  /** Transfers and card payments in the period on screen, newest first. */
  transfers: Transfer[];
  splits: SplitsOverview | null;
  /** A real account with no budget, bills, or pay schedule yet: offer the setup. */
  needs_onboarding: boolean;
  /** How long Safe to spend has to last; null when the period shown doesn't include today. */
  spending_runway: SpendingRunway | null;
  totals: {
    income_cents: number;
    spending_cents: number;
    cash_flow_cents: number;
    total_budget_cents: number;
    budget_remaining_cents: number;
    savings_rate_basis_points: number;
  };
};

/** Money the user moved between their own accounts in their bank (Penny records it; it never moves money). */
export type TransferWrite = {
  from_account_id: string;
  to_account_id: string;
  amount_cents: number;
  occurred_on: string;
  note: string | null;
};
export type Transfer = TransferWrite & {
  id: string;
  kind: "transfer" | "card_payment" | "split";
  group_id: string | null;
};
export type SplitGroupWrite = { name: string; member_ids: string[] };
export type SplitGroup = SplitGroupWrite & { id: string; expense_count: number; spent_cents: number };
/** A friend's balance: positive, they owe you; negative, you owe them. */
export type SplitFriend = { account_id: string; name: string; balance_cents: number; last_activity_on: string | null };
export type SplitActivity = {
  id: string;
  kind: "lent" | "borrowed" | "paid_back" | "you_paid_back";
  friend_id: string;
  friend_name: string;
  description: string;
  amount_cents: number;
  occurred_on: string;
  group_id: string | null;
  transfer_id: string | null;
  transaction_id: string | null;
};
export type SplitsOverview = {
  owed_to_you_cents: number;
  you_owe_cents: number;
  net_cents: number;
  friends: SplitFriend[];
  groups: SplitGroup[];
  activity: SplitActivity[];
};
export type CashWarning = {
  account_id: string;
  account_name: string;
  due_cents: number;
  balance_cents: number;
  short_cents: number;
  bill_names: string[];
  first_due_on: string;
  cover_account_id: string | null;
  cover_account_name: string | null;
};
/** One recurring bill's share of the month's budget: paid so far plus what's still due. */
export type FixedCost = {
  bill_id: string;
  name: string;
  category_id: string | null;
  kind: "bill" | "subscription";
  amount_cents: number;
  paid_cents: number;
  due_cents: number;
  next_due_on: string | null;
};
/** The month's budget: recurring bills (fixed) plus the category budgets (variable). */
export type BudgetPlan = {
  fixed_cents: number;
  fixed_paid_cents: number;
  variable_cents: number;
  total_cents: number;
  fixed: FixedCost[];
};
/** Each step of Safe to spend, as the API computed it. */
export type SafeToSpendBreakdown = {
  fixed_cents: number;
  variable_cents: number;
  budget_cents: number;
  spent_cents: number;
  unpaid_bills_cents: number;
  safe_cents: number;
  over_cents: number;
  has_budget: boolean;
};
export type SpendingRunway = {
  until: string;
  until_payday: boolean;
  days_left: number;
  per_day_cents: number;
  status: "on_track" | "tight" | "empty" | "over";
};

export type HistoryMonth = {
  month: string;
  income_cents: number;
  spending_cents: number;
  cash_flow_cents: number;
  budget_cents: number;
  transaction_count: number;
};
export type History = {
  start: string;
  end: string;
  months: HistoryMonth[];
  totals: {
    income_cents: number;
    spending_cents: number;
    cash_flow_cents: number;
    months_with_activity: number;
    average_spending_cents: number;
  };
  categories: CategorySpending[];
  data_months: string[];
};
export type CategorySuggestion = {
  category_id: string | null;
  category_name: string | null;
  necessity: "need" | "want" | null;
  matched: string | null;
  source: "rules" | "ai" | null;
};
export type CreditUtilization = {
  balance_cents: number;
  credit_limit_cents: number;
  utilization_basis_points: number;
  within_common_guideline: boolean;
};

export type TransactionWrite = Omit<
  Transaction,
  | "id"
  | "category"
  | "necessity"
  | "auto_categorized"
  | "bill_id"
  | "paid_automatically"
  | "unusual"
  | "history_only"
  | "group_id"
  | "pay_id"
> & {
  repeat?: { frequency: BillFrequency; next_due: string | null; auto_record: boolean } | null;
  history_only?: boolean;
};
/** One purchase or deposit across several accounts; the API saves one transaction per account. */
export type SplitTransactionWrite = Omit<TransactionWrite, "account_id" | "amount_cents"> & {
  splits: { account_id: string; amount_cents: number }[];
};
/** A purchase split with friends: your share is spending; when you paid, `owed_by` is what each friend owes you. */
export type SharedPurchaseWrite = {
  description: string;
  category_id: string | null;
  occurred_on: string;
  paid_from: string;
  my_share_cents: number;
  owed_by: { account_id: string; amount_cents: number }[];
  group_id: string | null;
};
type GoalWrite = Pick<SavingsGoal, "name" | "target_cents" | "current_cents" | "target_date" | "account_id">;
export type CoachRole = "user" | "assistant";
export type CoachFact = {
  label: string;
  display: string;
  cents: number | null;
  basis_points: number | null;
  source: string;
};
export type CoachProposal = {
  id: string;
  version: string;
  kind: "goal_contribution" | "budget_limit";
  title: string;
  reason: string;
  target_id: string;
  target_name: string;
  current_cents: number;
  proposed_cents: number;
};
export type CoachReply = {
  reply: string;
  follow_ups: string[];
  facts: CoachFact[];
  tools_used: { name: string; label: string }[];
  proposal: CoachProposal | null;
  budget_plan?: CoachBudgetPlan | null;
  source: "ai" | "built_in";
  fallback_reason: "no_api_key" | "model_error" | "timeout" | "unverified_numbers" | "ai_limit" | null;
  model: string | null;
  usage: { input_tokens: number; output_tokens: number; elapsed_ms: number };
};
export type CoachSignal = {
  id: string;
  tone: "positive" | "watch" | "alert";
  title: string;
  detail: string;
  prompt: string;
};
export type CoachBrief = {
  greeting: string;
  month_label: string;
  signals: CoachSignal[];
  suggested_questions: string[];
};

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

/**
 * FastAPI sends `detail` as a string for app errors, but as a list of {loc, msg} objects when a
 * request fails validation. Either way, turn it into a readable sentence.
 */
function errorText(detail: unknown): string | null {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) =>
        item && typeof item === "object" && "msg" in item ? String(item.msg).replace(/^Value error, /, "") : null,
      )
      .filter((message): message is string => Boolean(message));
    return messages.length ? `Penny couldn’t save that: ${messages.join("; ")}.` : null;
  }
  return null;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }

  get needsSignIn(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

type TokenSources = {
  sessionToken: () => Promise<string | null>;
  demoMode: boolean;
  demoToken: string | undefined;
};

/**
 * Picks the bearer token for API calls: the Supabase session first, then the fictional demo
 * token only when demo mode is explicitly enabled. Never invents a token.
 */
async function resolveAccessToken(sources: TokenSources): Promise<string> {
  const sessionToken = await sources.sessionToken();
  if (sessionToken) return sessionToken;
  if (sources.demoMode && sources.demoToken) return sources.demoToken;
  throw new ApiError("Sign in to view your Penny dashboard.", 401);
}

const browserTokenSources: TokenSources = {
  sessionToken: getSupabaseAccessToken,
  demoMode: process.env.NEXT_PUBLIC_DEMO_MODE === "true",
  demoToken: process.env.NEXT_PUBLIC_DEMO_AUTH_TOKEN,
};

async function authorizedRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await resolveAccessToken(browserTokenSources);
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { detail?: unknown } | null;
    throw new ApiError(errorText(payload?.detail) ?? `Request failed with status ${response.status}`, response.status);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

const request = (path: string, init?: RequestInit) => authorizedRequest<Dashboard>(path, init);

/** Appends the month whose snapshot the API should return (YYYY-MM-01). */
const inMonth = (path: string, month?: string) =>
  month ? `${path}${path.includes("?") ? "&" : "?"}month=${encodeURIComponent(month)}` : path;

export const dashboardApi = {
  load: (month?: string) => request(inMonth("/api/v1/dashboard", month)),
  loadPeriod: (start: string, end: string) => request(`/api/v1/dashboard?start=${start}&end=${end}`),
  createTransaction: (body: TransactionWrite, month?: string) =>
    request(inMonth("/api/v1/transactions", month), { method: "POST", body: JSON.stringify(body) }),
  createSplitTransaction: (body: SplitTransactionWrite, month?: string) =>
    request(inMonth("/api/v1/transactions/split", month), { method: "POST", body: JSON.stringify(body) }),
  createSharedPurchase: (body: SharedPurchaseWrite, month?: string) =>
    request(inMonth("/api/v1/transactions/shared", month), { method: "POST", body: JSON.stringify(body) }),
  createSplitGroup: (body: SplitGroupWrite, month?: string) =>
    request(inMonth("/api/v1/split-groups", month), { method: "POST", body: JSON.stringify(body) }),
  updateSplitGroup: (id: string, body: SplitGroupWrite, month?: string) =>
    request(inMonth(`/api/v1/split-groups/${id}`, month), { method: "PUT", body: JSON.stringify(body) }),
  deleteSplitGroup: (id: string, month?: string) =>
    request(inMonth(`/api/v1/split-groups/${id}`, month), { method: "DELETE" }),
  updateTransaction: (id: string, body: Partial<TransactionWrite>, month?: string) =>
    request(inMonth(`/api/v1/transactions/${id}`, month), { method: "PATCH", body: JSON.stringify(body) }),
  deleteTransaction: (id: string, month?: string) =>
    request(inMonth(`/api/v1/transactions/${id}`, month), { method: "DELETE" }),
  createBudget: (body: { category_id: string; month_start: string; limit_cents: number }, month?: string) =>
    request(inMonth("/api/v1/budgets", month), { method: "POST", body: JSON.stringify(body) }),
  updateBudget: (id: string, limit_cents: number, month?: string) =>
    request(inMonth(`/api/v1/budgets/${id}`, month), { method: "PATCH", body: JSON.stringify({ limit_cents }) }),
  deleteBudget: (id: string, month?: string) => request(inMonth(`/api/v1/budgets/${id}`, month), { method: "DELETE" }),
  copyBudgets: (fromMonth: string, toMonth: string) =>
    request("/api/v1/budgets/copy", {
      method: "POST",
      body: JSON.stringify({ from_month: fromMonth, to_month: toMonth }),
    }),
  createGoal: (body: GoalWrite, month?: string) =>
    request(inMonth("/api/v1/savings-goals", month), { method: "POST", body: JSON.stringify(body) }),
  updateGoal: (id: string, body: Partial<GoalWrite> & { status?: SavingsGoal["status"] }, month?: string) =>
    request(inMonth(`/api/v1/savings-goals/${id}`, month), { method: "PATCH", body: JSON.stringify(body) }),
  /** Erases all of the user's data and Penny AI chats; setup shows again. */
  resetData: () => request("/api/v1/account/reset", { method: "POST", body: JSON.stringify({ confirm: "reset" }) }),
  /** Deletes the account, its data, and (when the server can) its sign-in. Can't be undone. */
  deleteMyAccount: () =>
    authorizedRequest<{ signin_deleted: boolean }>("/api/v1/account/delete", {
      method: "POST",
      body: JSON.stringify({ confirm: "delete" }),
    }),
  deleteGoal: (id: string, month?: string) =>
    request(inMonth(`/api/v1/savings-goals/${id}`, month), { method: "DELETE" }),
  contributeToGoal: (id: string, amount_cents: number, fromAccountId: string, month?: string) =>
    request(inMonth(`/api/v1/savings-goals/${id}/contributions`, month), {
      method: "POST",
      body: JSON.stringify({ amount_cents, from_account_id: fromAccountId }),
    }),
  completeMission: (id: string, month?: string) =>
    request(inMonth(`/api/v1/missions/${id}/complete`, month), { method: "POST" }),
  billHistory: (id: string) => authorizedRequest<BillHistory>(`/api/v1/bills/${id}/history`),
  /** `recordOnly` adds the payment to history without changing a balance (already paid in the bank). */
  markBillPaid: (id: string, month?: string, accountId?: string, recordOnly = false) => {
    const query = new URLSearchParams();
    if (accountId) query.set("account_id", accountId);
    if (recordOnly) query.set("record_only", "true");
    const suffix = query.size ? `?${query.toString()}` : "";
    return request(inMonth(`/api/v1/bills/${id}/mark-paid${suffix}`, month), { method: "POST" });
  },
  addTransfer: (body: TransferWrite, month?: string) =>
    request(inMonth("/api/v1/transfers", month), { method: "POST", body: JSON.stringify(body) }),
  deleteTransfer: (id: string, month?: string) =>
    request(inMonth(`/api/v1/transfers/${id}`, month), { method: "DELETE" }),
  createBill: (body: BillWrite, month?: string) =>
    request(inMonth("/api/v1/bills", month), { method: "POST", body: JSON.stringify(body) }),
  /** `move_once` with a new `next_due` moves only the next payment; the schedule stays. */
  updateBill: (id: string, body: Partial<Omit<BillWrite, "already_paid">> & { move_once?: boolean }, month?: string) =>
    request(inMonth(`/api/v1/bills/${id}`, month), { method: "PATCH", body: JSON.stringify(body) }),
  deleteBill: (id: string, month?: string) => request(inMonth(`/api/v1/bills/${id}`, month), { method: "DELETE" }),
  addPay: (body: PayScheduleWrite) => request("/api/v1/pay-schedules", { method: "POST", body: JSON.stringify(body) }),
  updatePay: (id: string, body: PayScheduleWrite) =>
    request(`/api/v1/pay-schedules/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deletePay: (id: string) => request(`/api/v1/pay-schedules/${id}`, { method: "DELETE" }),
  recordPay: (id: string, body: PayReceivedWrite, month?: string) =>
    request(inMonth(`/api/v1/pay-schedules/${id}/received`, month), { method: "POST", body: JSON.stringify(body) }),
  /** The check-in for money that came in; `payId` null for money that isn't pay. Changes nothing. */
  paydayPlan: (amountCents: number, payId: string | null) =>
    authorizedRequest<PaydayPlan>(
      `/api/v1/payday-plan?amount_cents=${amountCents}${payId ? `&pay_id=${encodeURIComponent(payId)}` : ""}`,
    ),
  createCategory: (body: { name: string; kind: Category["kind"]; parent_id: string | null }) =>
    request("/api/v1/categories", { method: "POST", body: JSON.stringify(body) }),
  deleteCategory: (id: string) => request(`/api/v1/categories/${id}`, { method: "DELETE" }),
  createAccount: (body: {
    name: string;
    account_type: AccountType;
    balance_cents: number;
    credit_limit_cents: number | null;
    payment_due_day?: number | null;
    payment_next_due?: string | null;
  }) => request("/api/v1/accounts", { method: "POST", body: JSON.stringify(body) }),
  updateAccount: (
    id: string,
    body: {
      name?: string;
      balance_cents?: number;
      credit_limit_cents?: number;
      payment_due_day?: number;
      payment_next_due?: string;
      card_paid_on?: string;
    },
  ) => request(`/api/v1/accounts/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteAccount: (id: string) => request(`/api/v1/accounts/${id}`, { method: "DELETE" }),
  importRows: (account_id: string, rows: ImportRow[]) =>
    authorizedRequest<{ imported: number; skipped: number; errors: string[]; dashboard: Dashboard }>(
      "/api/v1/transactions/import-rows",
      { method: "POST", body: JSON.stringify({ account_id, rows }) },
    ),
  applyBudgetChanges: (changes: { budget_id: string; limit_cents: number }[], month?: string) =>
    request(inMonth("/api/v1/budgets/changes", month), { method: "POST", body: JSON.stringify({ changes }) }),
  suggestCategory: (description: string, kind: Transaction["kind"]) =>
    authorizedRequest<CategorySuggestion>(
      `/api/v1/categorize?description=${encodeURIComponent(description)}&kind=${kind}`,
    ),
};

export type AssistSource = "ai" | "built_in";
export type ParsedTransaction = {
  description: string;
  amount_cents: number | null;
  kind: Transaction["kind"];
  occurred_on: string;
  category_id: string | null;
  source: AssistSource;
  repeat: { frequency: BillFrequency; next_due: string } | null;
};
export type SearchFilters = {
  query: string;
  kind: "all" | "income" | "spending";
  category_id: string | null;
  min_cents: number | null;
  max_cents: number | null;
  start: string | null;
  end: string | null;
  summary: string;
  source: AssistSource;
};
export type AssistText = { items: string[]; source: AssistSource; model: string | null };
export type BudgetSuggestion = {
  category_id: string;
  budget_id: string | null;
  category_name: string;
  current_limit_cents: number | null;
  suggested_cents: number;
  average_cents: number;
  reason: string;
};
export type BudgetChange = {
  budget_id: string;
  category_id: string;
  category_name: string;
  from_cents: number;
  to_cents: number;
  spent_cents: number;
};
export type BudgetRebalance = {
  month: string;
  over_cents: number;
  covered_cents: number;
  uncovered_cents: number;
  changes: BudgetChange[];
  summary: AssistText;
};
export type ImportRow = {
  occurred_on: string;
  description: string;
  amount_cents: number;
  kind: Transaction["kind"];
  category_id: string | null;
};
export type StatementRow = ImportRow & { transfer: boolean };
export type StatementDraft = {
  source: AssistSource;
  model: string | null;
  file_kind: "pdf" | "xlsx" | "csv";
  institution: string | null;
  account_name: string | null;
  account_type: "chequing" | "savings" | "credit" | null;
  account_id: string | null;
  period_start: string | null;
  period_end: string | null;
  opening_balance_cents: number | null;
  closing_balance_cents: number | null;
  /** Closing balance the rows add up to minus the printed one; 0 means every amount checks out. */
  balance_difference_cents: number | null;
  rows: StatementRow[];
  problems: string[];
};
/** The whole picture behind suggested budgets (backend app/domain/smart_budget.py). */
export type BudgetPlanSummary = {
  income_cents: number;
  income_source: "stated" | "pay" | "history" | "none";
  fixed_cents: number;
  savings_cents: number;
  everyday_cents: number;
  planned_cents: number;
  buffer_cents: number;
  status: "fits" | "trimmed" | "short" | "no_income";
};
export type BudgetSuggestions = {
  month: string;
  suggestions: BudgetSuggestion[];
  summary: AssistText;
  plan: (BudgetPlanSummary & { history_months: number }) | null;
};
/** A whole budget Penny AI built in chat; "Add to my budgets" applies its lines like suggestions. */
export type CoachBudgetPlan = BudgetPlanSummary & { month: string; summary: string; lines: BudgetSuggestion[] };

export type OnboardingAnswers = {
  opening_balances: Record<string, number>;
  new_accounts: {
    name: string;
    account_type: AccountType;
    balance_cents: number;
    credit_limit_cents: number | null;
    payment_next_due: string | null;
  }[];
  income: { amount_cents: number; frequency: PayFrequency; next_payday: string; interval_days: number | null } | null;
  monthly_money_cents: number | null;
  bills: {
    name: string;
    amount_cents: number;
    category_id: string;
    frequency: BillFrequency;
    next_due: string;
    already_paid?: boolean;
  }[];
  everyday: Record<string, number>;
  savings_basis_points: number;
  spending_from?: SpendingFrom;
};
export type StarterPlanLine = {
  category_id: string;
  category_name: string;
  fixed_cents: number;
  flexible_cents: number;
  requested_cents: number;
  limit_cents: number;
};
export type StarterPlan = {
  income_cents: number;
  fixed_cents: number;
  savings_cents: number;
  flexible_cents: number;
  buffer_cents: number;
  over_income_cents: number;
  status: "fits" | "over" | "short";
  lines: StarterPlanLine[];
  guide_needs_cents: number;
  guide_wants_cents: number;
  guide_savings_cents: number;
  summary: AssistText;
};

export type StarterCheck = {
  income_cents: number;
  fixed_cents: number;
  flexible_cents: number;
  savings_cents: number;
  planned_cents: number;
  buffer_cents: number;
  over_income_cents: number;
  status: "fits" | "over" | "short";
  guide_needs_cents: number;
  guide_wants_cents: number;
  guide_savings_cents: number;
};

/** First-run setup: the plan is only a proposal until `apply` (the user's approval). */
export const onboardingApi = {
  check: (answers: OnboardingAnswers) =>
    authorizedRequest<StarterCheck>("/api/v1/onboarding/check", { method: "POST", body: JSON.stringify(answers) }),
  plan: (answers: OnboardingAnswers) =>
    authorizedRequest<StarterPlan>("/api/v1/onboarding/plan", { method: "POST", body: JSON.stringify(answers) }),
  apply: (answers: OnboardingAnswers, everydayLimits: Record<string, number>) =>
    request("/api/v1/onboarding/apply", {
      method: "POST",
      body: JSON.stringify({ answers, everyday_limits: everydayLimits }),
    }),
};

/** Smart helpers. They only read data or fill forms; every change still goes through a user action. */
export const assistApi = {
  search: (text: string) =>
    authorizedRequest<SearchFilters>("/api/v1/assist/search", { method: "POST", body: JSON.stringify({ text }) }),
  parseTransactions: (text: string) =>
    authorizedRequest<{ items: ParsedTransaction[] }>("/api/v1/assist/parse-transactions", {
      method: "POST",
      body: JSON.stringify({ text }),
    }),
  spendingTake: (start: string, end: string) =>
    authorizedRequest<AssistText>(`/api/v1/assist/spending-take?start=${start}&end=${end}`),
  budgetSuggestions: () => authorizedRequest<BudgetSuggestions>("/api/v1/assist/budget-suggestions"),
  goalPlan: (id: string) => authorizedRequest<AssistText>(`/api/v1/assist/goal-plan/${encodeURIComponent(id)}`),
  safeToSpend: () => authorizedRequest<AssistText>("/api/v1/assist/safe-to-spend"),
  budgetRebalance: () => authorizedRequest<BudgetRebalance>("/api/v1/assist/budget-rebalance"),
  /** Reads a statement into rows to review; nothing is saved. `data_base64` is the file's bytes. */
  readStatement: (filename: string, data_base64: string) =>
    authorizedRequest<StatementDraft>("/api/v1/assist/read-statement", {
      method: "POST",
      body: JSON.stringify({ filename, data_base64 }),
    }),
  accountsRead: () => authorizedRequest<AssistText>("/api/v1/assist/accounts-read"),
  lessonExample: (id: string) =>
    authorizedRequest<AssistText>(`/api/v1/assist/lesson-example/${encodeURIComponent(id)}`),
};

export type LearnCountry = "CA" | "US";
export type LearnProfile = { country: LearnCountry | null; topics: LessonTrack[]; start_tier: LessonTier };
export type LessonCard = {
  id: string;
  topic: LessonTrack;
  tier: LessonTier;
  title: string;
  summary: string;
  locked: boolean;
  passed: boolean;
  stars: number;
  xp_earned: number;
  xp_max: number;
  hearts: number;
  question_count: number;
};
export type TopicPath = { id: LessonTrack; label: string; blurb: string; selected: boolean; lessons: LessonCard[] };
export type LearnBadge = { id: string; title: string; description: string; earned: boolean };
export type LearnState = {
  profile: LearnProfile;
  xp_total: number;
  level: number;
  level_xp: number;
  level_size_xp: number;
  streak_days: number;
  completed_today: boolean;
  topics: TopicPath[];
  badges: LearnBadge[];
};
export type LessonTaskView = "spending" | "budgets" | "goals" | "ai" | "settings";
export type LessonDetail = {
  card: LessonCard;
  cards: string[];
  task: { label: string; view: LessonTaskView; prompt: string | null } | null;
};
export type QuestionKind = "choice" | "multi" | "number" | "order";
export type QuestionView = {
  id: string;
  kind: QuestionKind;
  prompt: string;
  options: { id: string; text: string }[];
  unit: "$" | "%" | "years" | "";
};
export type AttemptView = {
  id: string;
  lesson_id: string;
  hearts_total: number;
  hearts_left: number;
  questions: QuestionView[];
};
export type AttemptResult = {
  passed: boolean;
  stars: number;
  mistakes: number;
  xp_awarded: number;
  level_before: number;
  level_after: number;
  new_badges: LearnBadge[];
};
export type AnswerResult = {
  correct: boolean;
  explanation: string;
  correct_choices: string[];
  correct_value: string | null;
  hearts_left: number;
  status: "active" | "passed" | "failed";
  result: AttemptResult | null;
  dashboard: Dashboard | null;
};

/** The learning game. Grading, hearts, and XP live on the server; answers arrive only after answering. */
export const learnApi = {
  state: () => authorizedRequest<LearnState>("/api/v1/learn"),
  setProfile: (body: { country: LearnCountry; topics: LessonTrack[]; start_tier: LessonTier }) =>
    authorizedRequest<LearnState>("/api/v1/learn/profile", { method: "PUT", body: JSON.stringify(body) }),
  lesson: (id: string) => authorizedRequest<LessonDetail>(`/api/v1/learn/lessons/${encodeURIComponent(id)}`),
  start: (id: string) =>
    authorizedRequest<AttemptView>(`/api/v1/learn/lessons/${encodeURIComponent(id)}/attempts`, { method: "POST" }),
  answer: (attemptId: string, body: { question_id: string; choices?: string[]; value?: string }) =>
    authorizedRequest<AnswerResult>(`/api/v1/learn/attempts/${encodeURIComponent(attemptId)}/answers`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
};

export type ChartMonth = {
  month: string;
  income_cents: number;
  spending_cents: number;
  net_cents: number;
  budget_cents: number;
  needs_cents: number;
  wants_cents: number;
  categories: { category_id: string | null; spent_cents: number }[];
};
export type ChartCategory = {
  category_id: string | null;
  category_name: string;
  spent_cents: number;
  share_basis_points: number;
};
export type ChartAccount = {
  account_id: string;
  account_name: string;
  account_type: string;
  income_cents: number;
  spending_cents: number;
};
export type ChartsResponse = {
  start: string;
  end: string;
  months: ChartMonth[];
  categories: ChartCategory[];
  accounts: ChartAccount[];
  income_cents: number;
  spending_cents: number;
  net_cents: number;
  budget_cents: number;
  average_spending_cents: number;
  data_months: string[];
};

/** The Charts tab: month-by-month figures for a range, optionally only some accounts or categories. */
export const chartsApi = {
  load: (start: string, end: string, accounts: string[], categories: string[]) => {
    const query = new URLSearchParams({ start, end });
    for (const id of accounts) query.append("account", id);
    for (const id of categories) query.append("category", id);
    return authorizedRequest<ChartsResponse>(`/api/v1/charts?${query.toString()}`);
  },
};

export const historyApi = {
  load: (start: string, end: string) => authorizedRequest<History>(`/api/v1/history?start=${start}&end=${end}`),
};

export const calculationsApi = {
  creditUtilization: (balance_cents: number, credit_limit_cents: number) =>
    authorizedRequest<CreditUtilization>("/api/v1/calculations/credit-utilization", {
      method: "POST",
      body: JSON.stringify({ balance_cents, credit_limit_cents }),
    }),
};

/** A Penny AI chat as saved on the server. `reply` is set on Penny's messages. */
export type SavedChatMessage = { id: string; role: CoachRole; content: string; reply?: CoachReply | null };
export type SavedConversation = {
  id: string;
  title: string;
  updated_at: string;
  messages: SavedChatMessage[];
  proposals: Record<string, "approving" | "approved" | "dismissed">;
};

export const calendarApi = {
  /** Makes the .ics file; its link works without signing in, for a few minutes. */
  export: (body: CalendarExportWrite) =>
    authorizedRequest<CalendarExport>("/api/v1/calendar/exports", { method: "POST", body: JSON.stringify(body) }),
  fileUrl: (path: string) => `${API_BASE}${path}`,
};

export const coachApi = {
  conversations: () => authorizedRequest<SavedConversation[]>("/api/v1/coach/conversations"),
  saveConversation: ({ id, title, messages, proposals }: SavedConversation) =>
    authorizedRequest<SavedConversation>(`/api/v1/coach/conversations/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify({
        title,
        messages: messages.map(({ id: messageId, role, content, reply }) => ({
          id: messageId,
          role,
          content,
          reply: reply ?? null,
        })),
        proposals,
      }),
    }),
  deleteConversation: (id: string) =>
    authorizedRequest<void>(`/api/v1/coach/conversations/${encodeURIComponent(id)}`, { method: "DELETE" }),
  brief: () => authorizedRequest<CoachBrief>("/api/v1/coach/brief"),
  chat: (messages: { role: CoachRole; content: string }[]) =>
    authorizedRequest<CoachReply>("/api/v1/coach/chat", { method: "POST", body: JSON.stringify({ messages }) }),
  approve: (proposal: CoachProposal) =>
    authorizedRequest<{ message: string; dashboard: Dashboard }>(`/api/v1/coach/proposals/${proposal.id}/approve`, {
      method: "POST",
      body: JSON.stringify({ approved: true, version: proposal.version }),
    }),
};
