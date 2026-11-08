"use client";

import { useId, useState } from "react";
import {
  AlertTriangle,
  ArrowLeftRight,
  BarChart3,
  X,
  ChevronRight,
  CreditCard,
  Home,
  PiggyBank,
  ShoppingCart,
  Sparkles,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import type { AccountType, Dashboard, SpendingRunway, Transaction } from "@/lib/api";
import { formatShortDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { categoryIcon } from "./category-icons";
import { AccountDetail } from "./account-detail";
import { SafeDetail } from "./safe-detail";
import { SpentDetail } from "./spent-detail";
import { ACCOUNT_TYPE_LABELS, isOwnAccount } from "./labels";
import { PaydayPrompt } from "./pay-section";
import type { SaveChange } from "./settings-view";
import type { SharedDraft } from "./split-with-friends";
import { SplitsView, splitsNet } from "./splits-view";
import { accountEmoji } from "./emoji";
import { AmountsToggle, BigAmount, cad, type View } from "./shared";
import { useSubpage } from "./subpage";
import { useTransfers } from "./transfer-dialog";

// Accounts read like the sum: what you have, then what you owe.
const ACCOUNT_ORDER: AccountType[] = ["chequing", "cash", "savings", "investment", "other", "credit"];

type Props = {
  /** What the Splits page (opened from Home) needs to save and to add a shared expense. */
  splits: { save: SaveChange; onAddExpense: (share: SharedDraft) => void };
  dashboard: Dashboard;
  onNavigate: (view: View, anchor?: string, motion?: "push" | "pop") => void;
  onAsk: (question: string) => void;
  /** Phones: tapping a recent transaction opens it for editing. */
  onEditTransaction?: (item: Transaction) => void;
  /** Reopens first-run setup (shown while the account has no plan yet). */
  onSetUp?: () => void;
};

/** Questions built from the user's own numbers, most pressing first; generic ones fill the rest. */
function personalPrompts(dashboard: Dashboard): { icon: LucideIcon; text: string }[] {
  const prompts: { icon: LucideIcon; text: string }[] = [];
  const over = [...dashboard.budgets]
    .filter((b) => !b.carried_over && b.remaining_cents < 0)
    .sort((a, b) => a.remaining_cents - b.remaining_cents)[0];
  if (over) prompts.push({ icon: BarChart3, text: `How do I get ${over.category_name} back under budget?` });
  const due = dashboard.recurring.upcoming.find((item) => item.days_until_due <= 3);
  if (due) prompts.push({ icon: Home, text: `Can I comfortably cover ${due.name} (${cad(due.amount_cents)})?` });
  const behind = dashboard.savings_goals.find(
    (g) => g.status === "active" && g.monthly_needed_cents && g.contributed_this_month_cents < g.monthly_needed_cents,
  );
  if (behind) prompts.push({ icon: PiggyBank, text: `How can I catch up on my ${behind.name}?` });
  if (dashboard.credit && dashboard.credit.utilization_basis_points > 3000)
    prompts.push({ icon: CreditCard, text: "How do I bring my card under 30%?" });
  for (const fallback of AI_PROMPTS) {
    if (prompts.length >= 4) break;
    if (!prompts.some((item) => item.icon === fallback.icon)) prompts.push(fallback);
  }
  return prompts.slice(0, 4);
}

const AI_PROMPTS = [
  { icon: ShoppingCart, text: "Can I afford this purchase?" },
  { icon: BarChart3, text: "Where am I overspending?" },
  { icon: CreditCard, text: "How can I improve my credit?" },
  { icon: TrendingUp, text: "Should I invest or save?" },
];

export function TodayView({ dashboard, splits, onNavigate, onAsk, onEditTransaction, onSetUp }: Props) {
  // An account ("#today/<account id>") or the month's spending ("#today/spent") opens as its own page.
  const [pageId, openPage, back] = useSubpage("today");
  const account = dashboard.accounts_overview.accounts.find((item) => item.id === pageId);
  if (account) return <AccountDetail dashboard={dashboard} account={account} backLabel="Home" onBack={back} />;
  if (pageId === "splits")
    return <SplitsView dashboard={dashboard} save={splits.save} onAddExpense={splits.onAddExpense} onBack={back} />;
  if (pageId === "spent") return <SpentDetail dashboard={dashboard} onBack={back} onNavigate={onNavigate} />;
  if (pageId === "safe")
    return <SafeDetail dashboard={dashboard} onBack={back} onNavigate={onNavigate} onAsk={onAsk} />;
  return (
    <HomeOverview
      dashboard={dashboard}
      save={splits.save}
      onNavigate={onNavigate}
      onAsk={onAsk}
      onEditTransaction={onEditTransaction}
      onSetUp={onSetUp}
      onOpenPage={openPage}
    />
  );
}

// ------------------------------------------------------------------ overview

// Colour only where it carries meaning: a small status dot, and the bar once money is tight.
const RUNWAY_STYLE: Record<SpendingRunway["status"], { dot: string; bar: string }> = {
  on_track: { dot: "bg-money-in", bar: "bg-ink-subtle" },
  tight: { dot: "bg-gold", bar: "bg-gold" },
  empty: { dot: "bg-danger", bar: "bg-danger" },
  over: { dot: "bg-danger", bar: "bg-danger" },
};

function runwayLabel(runway: SpendingRunway): string {
  if (runway.status === "on_track") return "On track";
  if (runway.status === "empty") return "Nothing left";
  if (runway.status === "over") return "Over budget";
  return runway.until_payday ? "Tight until payday" : "Tight this month";
}

/** A grouped list on a phone: a bordered panel without the card's shadow, like an iOS inset list. */
const GROUP = "overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface";
/** A stack of separate raised cards (accounts, bills), like a bank app's account list. */
const STACK = "space-y-2.5";
const CARD = "overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-card)]";

/**
 * Home: what you can spend (and per day, until payday), your accounts, then what's next. One
 * column on phones; on wide screens the headline spans the top and the rest sits in two columns.
 * The charts and score live on Spending, Goals, and Learn. Every figure comes from the API.
 */
function HomeOverview({
  dashboard,
  save,
  onNavigate,
  onAsk,
  onEditTransaction,
  onSetUp,
  onOpenPage,
}: Omit<Props, "splits"> & { save: SaveChange; onOpenPage: (id: string) => void }) {
  const { home, totals, period, accounts_overview: overview, splits } = dashboard;
  // Friends are summed into one Splits row below, so 50 friends are still one line.
  const accounts = overview.accounts
    .filter(isOwnAccount)
    .sort((a, b) => ACCOUNT_ORDER.indexOf(a.account_type) - ACCOUNT_ORDER.indexOf(b.account_type));
  const change = home.spending_change_basis_points;
  return (
    <div className="mx-auto max-w-6xl space-y-6 lg:space-y-10">
      {dashboard.needs_onboarding && onSetUp && (
        <button
          type="button"
          onClick={onSetUp}
          className="flex w-full items-center gap-3 rounded-[var(--radius-card)] border border-primary/40 bg-primary-soft p-4 text-left"
        >
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-surface text-lg" aria-hidden="true">
            ✨
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold text-ink">Set up your plan</span>
            <span className="block text-sm text-ink-muted">
              A few questions and Penny suggests a budget. About 2 minutes.
            </span>
          </span>
          <ChevronRight className="size-4 shrink-0 text-ink-muted" aria-hidden="true" />
        </button>
      )}
      <SafeToSpendHero
        dashboard={dashboard}
        onOpen={() => onOpenPage("safe")}
        onSetBudgets={() => onNavigate("budgets")}
      />
      <PaydayPrompt dashboard={dashboard} save={save} />
      {dashboard.cash_warnings.length > 0 && <CashHeadsUp dashboard={dashboard} onOpenAccount={onOpenPage} />}
      <div className="grid gap-6 lg:grid-cols-2 lg:gap-8 [&>*]:min-w-0">
        <div className="space-y-6">
          {/* Accounts live on Home, like a bank app; each opens its own page. Net worth is one tap away. */}
          <PhoneSection title="Accounts" action="Net worth" onOpen={() => onNavigate("accounts", undefined, "push")}>
            <ul className={STACK}>
              {accounts.map((account) => {
                const owed = account.account_type === "credit" && account.balance_cents > 0;
                const overdrawn = account.balance_cents < 0;
                const detail =
                  account.account_type === "credit" && account.utilization_basis_points !== null ? (
                    `${percent(account.utilization_basis_points)} of limit used`
                  ) : overdrawn ? (
                    "Overdrawn"
                  ) : account.goal_cents > 0 ? (
                    <>
                      <span className="tabular">{cad(account.goal_cents)}</span> set aside for goals
                    </>
                  ) : (
                    ACCOUNT_TYPE_LABELS[account.account_type]
                  );
                return (
                  <Glance
                    key={account.id}
                    emoji={accountEmoji(account.name, account.account_type)}
                    label={account.name}
                    detail={detail}
                    value={owed ? `−${cad(account.balance_cents)}` : cad(account.balance_cents)}
                    tone={owed || overdrawn ? "text-danger" : undefined}
                    onOpen={() => onOpenPage(account.id)}
                  />
                );
              })}
            </ul>
            {splits && splits.friends.length > 0 && (
              <ul className={cn(STACK, "mt-2.5")}>
                <Glance
                  emoji="🤝"
                  label="Splits"
                  value={splitsNet(splits.net_cents).text}
                  tone={splitsNet(splits.net_cents).tone}
                  onOpen={() => onOpenPage("splits")}
                  detail={
                    splits.net_cents > 0
                      ? "You’re owed overall"
                      : splits.net_cents < 0
                        ? "You owe overall"
                        : "All settled up"
                  }
                />
              </ul>
            )}
            <ul className={cn(STACK, "mt-2.5")}>
              <Glance
                emoji="🧾"
                label={`Spent ${period.phrase}`}
                value={cad(totals.spending_cents)}
                onOpen={() => onOpenPage("spent")}
                detail={
                  change === null
                    ? undefined
                    : `${percent(change)} ${change <= 0 ? "less" : "more"} than ${period.phrase === "this month" ? "last month" : "the period before"}`
                }
              />
            </ul>
          </PhoneSection>
          <div className="hidden lg:block">
            <AskPenny dashboard={dashboard} onNavigate={onNavigate} onAsk={onAsk} />
          </div>
        </div>

        <div className="space-y-6">
          <PhoneBills dashboard={dashboard} onOpen={() => onNavigate("recurring")} onOpenCard={onOpenPage} />
          <PhoneRecent
            dashboard={dashboard}
            onOpen={() => onNavigate("spending", "transactions")}
            onEdit={onEditTransaction}
          />
          <div className="lg:hidden">
            <AskPenny dashboard={dashboard} onNavigate={onNavigate} onAsk={onAsk} />
          </div>
        </div>
      </div>
    </div>
  );
}

/** The one big number, centred like a bank app's balance: what's safe to spend and per day until payday. */
function SafeToSpendHero({
  dashboard,
  onOpen,
  onSetBudgets,
}: Pick<Props, "dashboard"> & { onOpen: () => void; onSetBudgets: () => void }) {
  const { totals, period } = dashboard;
  const runway = dashboard.spending_runway;
  const safe = dashboard.safe_to_spend;
  const cents = dashboard.spending_power_cents;
  const over = cents < 0;
  const used = totals.total_budget_cents ? Math.min(100, (totals.spending_cents * 100) / totals.total_budget_cents) : 0;
  // Bills but no category budgets: the whole budget is bills, so nothing is left to spend yet.
  const onlyBills = !!safe && safe.has_budget && safe.fixed_cents > 0 && safe.variable_cents === 0;
  const billShare = safe && safe.budget_cents ? (safe.fixed_cents * 100) / safe.budget_cents : 0;
  return (
    <section aria-labelledby="safe-title" className="pb-2 pt-4 text-center">
      <p className={cn("text-[3.5rem] font-semibold leading-none tracking-tight", over ? "text-danger" : "text-ink")}>
        <BigAmount cents={Math.abs(cents)} negative={over} />
      </p>
      <div className="mt-3 flex items-center justify-center gap-1">
        <button
          type="button"
          id="safe-title"
          onClick={onOpen}
          className="inline-flex min-h-11 items-center gap-1 rounded-full px-3 text-base font-semibold text-ink-muted hover:text-ink"
        >
          Safe to spend
          <ChevronRight className="size-4" aria-hidden="true" />
        </button>
        <AmountsToggle className="-ml-1" />
      </div>
      {safe && !safe.has_budget ? (
        <p className="text-sm text-ink-muted">Set a monthly budget to see what’s safe to spend.</p>
      ) : onlyBills && !over ? (
        <div className="mx-auto max-w-sm">
          <p className="text-sm text-ink-muted">
            All of your <span className="tabular font-semibold text-ink">{cad(safe.budget_cents)}</span> budget goes to
            bills. Set budgets for groceries, food, and fun to see what’s safe to spend.
          </p>
          <button
            type="button"
            onClick={onSetBudgets}
            className="mt-3 inline-flex min-h-11 items-center gap-1 rounded-full bg-primary px-5 text-sm font-semibold text-on-primary"
          >
            Set budgets
            <ChevronRight className="size-4" aria-hidden="true" />
          </button>
        </div>
      ) : over ? (
        <p role="status" className="text-sm font-semibold text-danger">
          You’re <span className="tabular">{cad(-cents)}</span> over your budget {period.phrase}
        </p>
      ) : (
        runway && (
          <p className="text-sm text-ink-muted">
            <span className="inline-flex items-center gap-1.5 font-semibold text-ink">
              <span className={cn("size-2 rounded-full", RUNWAY_STYLE[runway.status].dot)} aria-hidden="true" />
              {runwayLabel(runway)}
            </span>
            {" · "}
            {runway.days_left === 1 ? (
              <>
                <span className="tabular font-semibold text-ink">{cad(runway.per_day_cents)}</span> left for today
              </>
            ) : (
              <>
                about <span className="tabular font-semibold text-ink">{cad(runway.per_day_cents)}</span> a day for{" "}
                {runway.days_left} days
              </>
            )}
          </p>
        )
      )}
      {safe && safe.budget_cents > 0 && (
        <div className="mx-auto mt-5 max-w-72">
          {/* What the budget is made of: bills (blue) and everyday spending, then how much is used. */}
          <div className="flex h-1.5 gap-0.5 overflow-hidden rounded-full" aria-hidden="true">
            {safe.fixed_cents > 0 && <span className="rounded-full bg-recurring" style={{ width: `${billShare}%` }} />}
            {safe.variable_cents > 0 && <span className="flex-1 rounded-full bg-primary/70" />}
          </div>
          <p className="mt-2 text-xs text-ink-subtle">
            <span className="tabular font-semibold text-ink-muted">{cad(safe.budget_cents)}</span> budget ·{" "}
            <span className="inline-flex items-center gap-1">
              <span className="size-1.5 rounded-full bg-recurring" aria-hidden="true" />
              <span className="tabular">{cad(safe.fixed_cents)}</span> bills
            </span>{" "}
            ·{" "}
            <span className="inline-flex items-center gap-1">
              <span className="size-1.5 rounded-full bg-primary/70" aria-hidden="true" />
              <span className="tabular">{cad(safe.variable_cents)}</span> category budgets
            </span>
          </p>
          <Progress
            value={used}
            className="mt-3 h-1"
            indicatorClassName={over ? "bg-danger" : runway ? RUNWAY_STYLE[runway.status].bar : "bg-ink-subtle"}
            aria-label={`${Math.round(used)}% of the budget used ${period.phrase}`}
          />
          <p className="mt-1.5 text-xs text-ink-subtle">
            {Math.round(used)}% used {period.phrase}
          </p>
        </div>
      )}
    </section>
  );
}

/**
 * Heads-up: an account can't cover the bills still due from it this month (for example $0 in
 * Chequing with rent due). Safe to spend doesn't change; Penny never moves money.
 */
const HEADS_UP_KEY = "penny-heads-up-dismissed";

/** Heads-ups closed with ×, by warning, with the day they were closed (this device only). */
function readDismissed(): Record<string, string> {
  try {
    return JSON.parse(window.localStorage.getItem(HEADS_UP_KEY) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

function CashHeadsUp({ dashboard, onOpenAccount }: Pick<Props, "dashboard"> & { onOpenAccount: (id: string) => void }) {
  const transfers = useTransfers();
  // The server only sends these from 3 days before a due date. Closing one hides it for the
  // rest of today; it comes back tomorrow if the money still isn't there.
  const today = dashboard.money_calendar.today ?? new Date().toISOString().slice(0, 10);
  const [dismissed, setDismissed] = useState<Record<string, string>>(readDismissed);
  const keyOf = (w: Dashboard["cash_warnings"][number]) => `${w.account_id}:${w.first_due_on}:${w.due_cents}`;
  const shown = dashboard.cash_warnings.filter((w) => dismissed[keyOf(w)] !== today);
  function dismiss(key: string) {
    // Keep only today's entries, so the list never grows.
    const next = { ...Object.fromEntries(Object.entries(dismissed).filter(([, day]) => day === today)), [key]: today };
    setDismissed(next);
    try {
      window.localStorage.setItem(HEADS_UP_KEY, JSON.stringify(next));
    } catch {
      /* storage blocked: hidden until reload */
    }
  }
  if (shown.length === 0) return null;
  return (
    <ul className="space-y-2.5" aria-label="Heads-up">
      {shown.map((w) => {
        const bills = w.bill_names.length === 1 ? w.bill_names[0] : `${w.bill_names.length} bills`;
        return (
          <li
            key={w.account_id}
            role="alert"
            className="relative rounded-[var(--radius-card)] border border-gold/50 bg-gold-soft p-4 pr-14"
          >
            <button
              type="button"
              aria-label="Hide until tomorrow"
              title="Hide until tomorrow"
              onClick={() => dismiss(keyOf(w))}
              className="absolute right-2 top-2 grid size-11 place-items-center rounded-full text-ink-subtle hover:bg-gold/20 hover:text-ink"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
            <p className="flex items-start gap-2 text-sm text-ink">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-gold-strong" aria-hidden="true" />
              <span>
                <span className="font-semibold">
                  {bills} (<span className="tabular">{cad(w.due_cents)}</span>){" "}
                  {w.bill_names.length === 1 ? "is" : "are"} due {formatShortDate(w.first_due_on)}, but {w.account_name}{" "}
                  has <span className="tabular">{cad(Math.max(0, w.balance_cents))}</span>.
                </span>{" "}
                {w.cover_account_name ? (
                  <>
                    Move <span className="tabular font-semibold">{cad(w.short_cents)}</span> from {w.cover_account_name}{" "}
                    to cover it.
                  </>
                ) : (
                  <>
                    You’re <span className="tabular font-semibold">{cad(w.short_cents)}</span> short.
                  </>
                )}
              </span>
            </p>
            <div className="mt-3 ml-6 flex flex-wrap items-center gap-2">
              {w.cover_account_id && transfers && (
                <button
                  type="button"
                  onClick={() =>
                    transfers.openTransfer({ from: w.cover_account_id!, to: w.account_id, amountCents: w.short_cents })
                  }
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-left text-sm font-semibold text-on-primary"
                >
                  <ArrowLeftRight className="size-4 shrink-0" aria-hidden="true" />
                  <span>
                    Move <span className="tabular">{cad(w.short_cents)}</span> from {w.cover_account_name}
                  </span>
                </button>
              )}
              <button
                type="button"
                onClick={() => onOpenAccount(w.account_id)}
                className="inline-flex min-h-11 items-center gap-1 px-2 text-sm font-semibold text-ink underline-offset-2 hover:underline"
              >
                Open {w.account_name}
                <ChevronRight className="size-4" aria-hidden="true" />
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function AskPenny({ dashboard, onNavigate, onAsk }: Pick<Props, "dashboard" | "onNavigate" | "onAsk">) {
  return (
    <PhoneSection title="Ask Penny">
      <button
        type="button"
        onClick={() => onNavigate("ai")}
        className={cn(
          GROUP,
          "flex min-h-12 w-full items-center gap-3 px-4 text-left text-sm text-ink-subtle hover:border-accent",
        )}
      >
        <Sparkles className="size-4 shrink-0 text-info" aria-hidden="true" />
        Ask anything about your money
      </button>
      <ul className="mt-2 space-y-2" aria-label="Suggested questions">
        {personalPrompts(dashboard)
          .slice(0, 2)
          .map(({ icon: Icon, text }) => (
            <li key={text}>
              <button
                type="button"
                onClick={() => onAsk(text)}
                className="flex min-h-11 w-full items-center gap-2.5 rounded-xl bg-sage-soft px-3 py-2 text-left text-sm text-ink-muted hover:text-ink"
              >
                <Icon className="size-4 shrink-0" aria-hidden="true" />
                {text}
              </button>
            </li>
          ))}
      </ul>
    </PhoneSection>
  );
}

function PhoneSection({
  title,
  action,
  onOpen,
  children,
}: {
  title: string;
  action?: string;
  onOpen?: () => void;
  children: React.ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id}>
      <div className="mb-1 flex items-center justify-between gap-3 px-1">
        <h2 id={id} className="text-base font-semibold tracking-tight text-ink">
          {title}
        </h2>
        {action && onOpen && (
          <button
            type="button"
            onClick={onOpen}
            className="-mr-2 inline-flex min-h-11 items-center gap-0.5 rounded-lg px-2 text-sm font-semibold text-info"
          >
            {action}
            <ChevronRight className="size-4" aria-hidden="true" />
          </button>
        )}
      </div>
      {children}
    </section>
  );
}

function Glance({
  emoji,
  label,
  value,
  detail,
  tone,
  onOpen,
  grouped = false,
}: {
  emoji: string;
  label: string;
  value: string;
  detail?: React.ReactNode;
  tone?: string;
  onOpen: () => void;
  grouped?: boolean;
}) {
  return (
    <li className={grouped ? undefined : CARD}>
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "flex w-full items-center gap-3 px-4 text-left hover:bg-sage-soft",
          grouped ? "min-h-16 py-3" : "min-h-[4.5rem] py-4",
        )}
      >
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-sage text-lg" aria-hidden="true">
          {emoji}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-ink">{label}</span>
          {detail && <span className="block truncate text-xs text-ink-subtle">{detail}</span>}
        </span>
        <span className={cn("tabular shrink-0 font-semibold", tone ?? "text-ink")}>{value}</span>
        <ChevronRight className="size-4 shrink-0 text-ink-muted" aria-hidden="true" />
      </button>
    </li>
  );
}

function dueIn(days: number): string {
  if (days < 0) return "Overdue";
  if (days === 0) return "Today";
  return days === 1 ? "Tomorrow" : `In ${days} days`;
}

/** Bills and card payments due next, soonest first. A card payment opens the card's page. */
function PhoneBills({
  dashboard,
  onOpen,
  onOpenCard,
}: {
  dashboard: Dashboard;
  onOpen: () => void;
  onOpenCard: (accountId: string) => void;
}) {
  const byId = new Map(dashboard.categories.map((category) => [category.id, category]));
  const bills = new Map(dashboard.bills.map((bill) => [bill.id, bill]));
  type Row = {
    key: string;
    name: string;
    due: string;
    days: number;
    cents: number;
    icon: React.ComponentType<{ className?: string }>;
    open: () => void;
    note?: string;
  };
  const rows: Row[] = [
    ...dashboard.recurring.items.map((item): Row => {
      const bill = bills.get(item.id);
      return {
        key: item.id,
        name: item.name,
        due: item.next_due,
        days: item.days_until_due,
        cents: item.amount_cents,
        icon: categoryIcon(bill?.category_id ? byId.get(bill.category_id) : undefined),
        open: onOpen,
      };
    }),
    // Card purchases already count as spending, so the payment is shown, not taken off Safe to spend again.
    ...dashboard.card_payments
      .filter((card) => card.owed_cents > 0)
      .map((card): Row => ({
        key: `card-${card.account_id}`,
        name: `${card.account_name} payment`,
        due: card.due_on,
        days: card.days_until_due,
        cents: card.owed_cents,
        icon: CreditCard,
        open: () => onOpenCard(card.account_id),
        note: "owed now",
      })),
  ]
    .sort((a, b) => a.due.localeCompare(b.due) || a.name.localeCompare(b.name))
    .slice(0, 4);
  return (
    <PhoneSection title="Coming up" action="All bills" onOpen={onOpen}>
      {rows.length === 0 ? (
        <p className={cn(GROUP, "p-4 text-sm text-ink-subtle")}>No bills or card payments due.</p>
      ) : (
        <ul className={STACK}>
          {rows.map((row) => {
            const soon = row.days <= 1;
            const Icon = row.icon;
            return (
              <li key={row.key} className={CARD}>
                <button
                  type="button"
                  onClick={row.open}
                  className="flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left hover:bg-sage-soft"
                >
                  <span
                    className="grid size-10 shrink-0 place-items-center rounded-full bg-sage text-ink-muted"
                    aria-hidden="true"
                  >
                    <Icon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-ink">{row.name}</span>
                    <span className="block text-xs">
                      <span className={soon ? "font-semibold text-danger" : "text-ink-subtle"}>{dueIn(row.days)}</span>
                      <span className="text-ink-subtle"> · {formatShortDate(row.due)}</span>
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="tabular block text-sm font-semibold text-ink">{cad(row.cents)}</span>
                    {row.note && <span className="block text-[11px] text-ink-subtle">{row.note}</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </PhoneSection>
  );
}

function shiftDay(value: string, days: number): string {
  const day = new Date(`${value}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}

/** The latest transactions, grouped under Today, Yesterday, or the date, like a bank app's feed. */
function PhoneRecent({
  dashboard,
  onOpen,
  onEdit,
}: {
  dashboard: Dashboard;
  onOpen: () => void;
  onEdit?: (item: Transaction) => void;
}) {
  const byId = new Map(dashboard.categories.map((category) => [category.id, category]));
  const today = dashboard.money_calendar.today;
  const dayLabel = (value: string) =>
    value === today ? "Today" : today && value === shiftDay(today, -1) ? "Yesterday" : formatShortDate(value);
  const groups: { day: string; rows: Transaction[] }[] = [];
  for (const item of dashboard.transactions.slice(0, 4)) {
    const last = groups.at(-1);
    if (last?.day === item.occurred_on) last.rows.push(item);
    else groups.push({ day: item.occurred_on, rows: [item] });
  }
  return (
    <PhoneSection title="Recent" action="See all" onOpen={onOpen}>
      {groups.length === 0 ? (
        <p className={cn(GROUP, "p-4 text-sm text-ink-subtle")}>No transactions {dashboard.period.phrase} yet.</p>
      ) : (
        <div className={GROUP}>
          {groups.map((group) => (
            <section key={group.day} aria-label={dayLabel(group.day)} className="border-t border-line first:border-t-0">
              <h3 className="px-4 pb-0.5 pt-2.5 text-xs font-semibold text-ink-subtle" aria-hidden="true">
                {dayLabel(group.day)}
              </h3>
              <ul>
                {group.rows.map((item) => {
                  const category = item.category_id ? byId.get(item.category_id) : undefined;
                  const Icon = categoryIcon(category, item.kind);
                  const income = item.kind === "income";
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => (onEdit ? onEdit(item) : onOpen())}
                        className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left hover:bg-sage-soft"
                      >
                        <span
                          className={cn(
                            "grid size-9 shrink-0 place-items-center rounded-full",
                            income ? "bg-money-in-soft text-money-in" : "bg-sage text-ink-muted",
                          )}
                          aria-hidden="true"
                        >
                          <Icon className="size-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-ink">{item.description}</span>
                          {item.category && (
                            <span className="block truncate text-xs text-ink-subtle">{item.category}</span>
                          )}
                        </span>
                        <span
                          className={cn(
                            "tabular shrink-0 text-sm font-semibold",
                            income ? "text-money-in" : "text-ink",
                          )}
                        >
                          {income ? cad(item.amount_cents, true) : cad(-item.amount_cents)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </PhoneSection>
  );
}

/** Financial health as one row that opens how it's scored; phone Goals shows it (Home's card is desktop-only). */
export function FinancialHealthRow({ dashboard }: { dashboard: Dashboard }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <ul>
        <Glance
          emoji="❤️"
          label="Financial health"
          value={`${dashboard.financial_health.score}/100`}
          detail="How it’s scored"
          onOpen={() => setOpen(true)}
        />
      </ul>
      <ScoreDialog open={open} onOpenChange={setOpen} dashboard={dashboard} />
    </>
  );
}

const percent = (basisPoints: number) =>
  `${Math.abs(basisPoints / 100)
    .toFixed(1)
    .replace(/\.0$/, "")}%`;

function ScoreDialog({
  open,
  onOpenChange,
  dashboard,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dashboard: Dashboard;
}) {
  const health = dashboard.financial_health;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Financial health · {health.score}/100</DialogTitle>
          <DialogDescription>{health.methodology}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {health.factors.map((factor) => (
            <div key={factor.id}>
              <div className="flex justify-between text-sm">
                <span className="text-ink">{factor.label}</span>
                <span className="tabular text-ink-subtle">
                  {factor.score}/{factor.max_score}
                </span>
              </div>
              <Progress
                className="mt-1"
                value={(factor.score * 100) / factor.max_score}
                indicatorClassName="bg-primary"
              />
              <p className="mt-1 text-xs text-ink-subtle">{factor.explanation}</p>
            </div>
          ))}
        </div>
        <div className="mt-5 rounded-xl bg-sage-soft p-4">
          <h3 className="text-sm font-semibold text-ink">Daily Money Score</h3>
          <p className="mt-1 text-xs leading-relaxed text-ink-muted">{dashboard.money_calendar.methodology}</p>
        </div>
        <p className="mt-4 text-xs text-ink-subtle">
          Educational indicators from fictional data. Neither is a credit score.
        </p>
      </DialogContent>
    </Dialog>
  );
}
