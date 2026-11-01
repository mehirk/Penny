"use client";

import { useId, useState } from "react";
import { BarChart3, ChevronRight, CreditCard, Home, PiggyBank, ShoppingCart, Sparkles, TrendingUp, type LucideIcon } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import type { AccountType, Dashboard, SpendingRunway, Transaction } from "@/lib/api";
import { formatShortDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { categoryIcon } from "./category-icons";
import { AccountDetail } from "./account-detail";
import { SpentDetail } from "./spent-detail";
import { ACCOUNT_TYPE_LABELS } from "./dialogs";
import { accountEmoji } from "./emoji";
import { AmountsToggle, BigAmount, cad, type View } from "./shared";
import { useSubpage } from "./subpage";

// Accounts read like the sum: what you have, then what you owe.
const ACCOUNT_ORDER: AccountType[] = ["chequing", "cash", "savings", "investment", "other", "credit"];

export { categoryIcon };

type Props = {
  dashboard: Dashboard;
  onNavigate: (view: View, anchor?: string, motion?: "push" | "pop") => void;
  onAsk: (question: string) => void;
  /** Phones: tapping a recent transaction opens it for editing. */
  onEditTransaction?: (item: Transaction) => void;
};

/** Questions built from the user's own numbers, most pressing first; generic ones fill the rest. */
function personalPrompts(dashboard: Dashboard): { icon: LucideIcon; text: string }[] {
  const prompts: { icon: LucideIcon; text: string }[] = [];
  const over = [...dashboard.budgets].filter((b) => !b.carried_over && b.remaining_cents < 0).sort((a, b) => a.remaining_cents - b.remaining_cents)[0];
  if (over) prompts.push({ icon: BarChart3, text: `How do I get ${over.category_name} back under budget?` });
  const due = dashboard.recurring.upcoming.find((item) => item.days_until_due <= 3);
  if (due) prompts.push({ icon: Home, text: `Can I comfortably cover ${due.name} (${cad(due.amount_cents)})?` });
  const behind = dashboard.savings_goals.find((g) => g.status === "active" && g.monthly_needed_cents && g.contributed_this_month_cents < g.monthly_needed_cents);
  if (behind) prompts.push({ icon: PiggyBank, text: `How can I catch up on my ${behind.name}?` });
  if (dashboard.credit && dashboard.credit.utilization_basis_points > 3000) prompts.push({ icon: CreditCard, text: "How do I bring my card under 30%?" });
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

export function TodayView({ dashboard, onNavigate, onAsk, onEditTransaction }: Props) {
  // An account ("#today/<account id>") or the month's spending ("#today/spent") opens as its own page.
  const [pageId, openPage, back] = useSubpage("today");
  const account = dashboard.accounts_overview.accounts.find((item) => item.id === pageId);
  if (account) return <AccountDetail dashboard={dashboard} account={account} backLabel="Home" onBack={back} />;
  if (pageId === "spent") return <SpentDetail dashboard={dashboard} onBack={back} onNavigate={onNavigate} />;
  return <HomeOverview dashboard={dashboard} onNavigate={onNavigate} onAsk={onAsk} onEditTransaction={onEditTransaction} onOpenPage={openPage} />;
}

// ------------------------------------------------------------------ overview

// Colour only where it carries meaning: a small status dot, and the bar once money is tight.
const RUNWAY_STYLE: Record<SpendingRunway["status"], { dot: string; bar: string }> = {
  on_track: { dot: "bg-money-in", bar: "bg-ink-subtle" },
  tight: { dot: "bg-gold", bar: "bg-gold" },
  empty: { dot: "bg-danger", bar: "bg-danger" },
};

function runwayLabel(runway: SpendingRunway): string {
  if (runway.status === "on_track") return "On track";
  if (runway.status === "empty") return "Nothing left";
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
function HomeOverview({ dashboard, onNavigate, onAsk, onEditTransaction, onOpenPage }: Props & { onOpenPage: (id: string) => void }) {
  const { home, totals, period, accounts_overview: overview } = dashboard;
  const accounts = [...overview.accounts].sort((a, b) => ACCOUNT_ORDER.indexOf(a.account_type) - ACCOUNT_ORDER.indexOf(b.account_type));
  const change = home.spending_change_basis_points;
  return (
    <div className="mx-auto max-w-6xl space-y-6 lg:space-y-10">
      <SafeToSpendHero dashboard={dashboard} onNavigate={onNavigate} />
      <div className="grid gap-6 lg:grid-cols-2 lg:gap-8 [&>*]:min-w-0">
      <div className="space-y-6">

      {/* Accounts live on Home, like a bank app; each opens its own page. Net worth is one tap away. */}
      <PhoneSection title="Accounts" action="Net worth" onOpen={() => onNavigate("accounts", undefined, "push")}>
        <ul className={STACK}>
          {accounts.map((account) => {
            const owed = account.account_type === "credit" && account.balance_cents > 0;
            const detail = account.account_type === "credit" && account.utilization_basis_points !== null
              ? `${percent(account.utilization_basis_points)} of limit used`
              : account.goal_cents > 0 ? <><span className="tabular">{cad(account.goal_cents)}</span> set aside for goals</> : ACCOUNT_TYPE_LABELS[account.account_type];
            return <Glance key={account.id} emoji={accountEmoji(account.name, account.account_type)} label={account.name} detail={detail} value={owed ? `−${cad(account.balance_cents)}` : cad(account.balance_cents)} tone={owed ? "text-danger" : undefined} onOpen={() => onOpenPage(account.id)} />;
          })}
        </ul>
        <ul className={cn(STACK, "mt-2.5")}>
          <Glance emoji="🧾" label={`Spent ${period.phrase}`} value={cad(totals.spending_cents)} onOpen={() => onOpenPage("spent")}
            detail={change === null ? undefined : `${percent(change)} ${change <= 0 ? "less" : "more"} than ${period.phrase === "this month" ? "last month" : "the period before"}`} />
        </ul>
      </PhoneSection>
      <div className="hidden lg:block">
        <AskPenny dashboard={dashboard} onNavigate={onNavigate} onAsk={onAsk} />
      </div>
      </div>

      <div className="space-y-6">
      <PhoneBills dashboard={dashboard} onOpen={() => onNavigate("recurring")} />
      <PhoneRecent dashboard={dashboard} onOpen={() => onNavigate("spending", "transactions")} onEdit={onEditTransaction} />
      <div className="lg:hidden">
        <AskPenny dashboard={dashboard} onNavigate={onNavigate} onAsk={onAsk} />
      </div>

      </div>
      </div>
    </div>
  );
}

/** The one big number, centred like a bank app's balance: what's safe to spend and per day until payday. */
function SafeToSpendHero({ dashboard, onNavigate }: Pick<Props, "dashboard" | "onNavigate">) {
  const { totals, period } = dashboard;
  const runway = dashboard.spending_runway;
  const used = totals.total_budget_cents ? Math.min(100, (totals.spending_cents * 100) / totals.total_budget_cents) : 0;
  return (
  <section aria-labelledby="safe-title" className="pb-2 pt-4 text-center">
    <p className="text-[3.5rem] font-semibold leading-none tracking-tight text-ink"><BigAmount cents={dashboard.spending_power_cents} /></p>
    <div className="mt-3 flex items-center justify-center gap-1">
      <button type="button" id="safe-title" onClick={() => onNavigate("spending", "budgets")} className="inline-flex min-h-11 items-center gap-1 rounded-full px-3 text-base font-semibold text-ink-muted hover:text-ink">
        Safe to spend<ChevronRight className="size-4" aria-hidden="true" />
      </button>
      <AmountsToggle className="-ml-1" />
    </div>
    {runway && (
      <p className="text-sm text-ink-muted">
        <span className="inline-flex items-center gap-1.5 font-semibold text-ink"><span className={cn("size-2 rounded-full", RUNWAY_STYLE[runway.status].dot)} aria-hidden="true" />{runwayLabel(runway)}</span>
        {" · "}about <span className="tabular font-semibold text-ink">{cad(runway.per_day_cents)}</span> a day for {runway.days_left} day{runway.days_left === 1 ? "" : "s"}
      </p>
    )}
    <div className="mx-auto mt-5 max-w-60">
      <Progress value={used} className="h-1.5" indicatorClassName={runway ? RUNWAY_STYLE[runway.status].bar : "bg-ink-subtle"} aria-label={`${Math.round(used)}% of the budget used ${period.phrase}`} />
      <p className="mt-2 text-xs text-ink-subtle">{Math.round(used)}% of your budget used · bills before payday already taken out</p>
    </div>
  </section>
  );
}

function AskPenny({ dashboard, onNavigate, onAsk }: Pick<Props, "dashboard" | "onNavigate" | "onAsk">) {
  return (
    <PhoneSection title="Ask Penny">
      <button type="button" onClick={() => onNavigate("ai")} className={cn(GROUP, "flex min-h-12 w-full items-center gap-3 px-4 text-left text-sm text-ink-subtle hover:border-accent")}>
        <Sparkles className="size-4 shrink-0 text-info" aria-hidden="true" />Ask anything about your money
      </button>
      <ul className="mt-2 space-y-2" aria-label="Suggested questions">
        {personalPrompts(dashboard).slice(0, 2).map(({ icon: Icon, text }) => (
          <li key={text}><button type="button" onClick={() => onAsk(text)} className="flex min-h-11 w-full items-center gap-2.5 rounded-xl bg-sage-soft px-3 py-2 text-left text-sm text-ink-muted hover:text-ink"><Icon className="size-4 shrink-0" aria-hidden="true" />{text}</button></li>
        ))}
      </ul>
    </PhoneSection>
  );
}

function PhoneSection({ title, action, onOpen, children }: { title: string; action?: string; onOpen?: () => void; children: React.ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id}>
      <div className="mb-1 flex items-center justify-between gap-3 px-1">
        <h2 id={id} className="text-base font-semibold tracking-tight text-ink">{title}</h2>
        {action && onOpen && <button type="button" onClick={onOpen} className="-mr-2 inline-flex min-h-11 items-center gap-0.5 rounded-lg px-2 text-sm font-semibold text-info">{action}<ChevronRight className="size-4" aria-hidden="true" /></button>}
      </div>
      {children}
    </section>
  );
}

function Glance({ emoji, label, value, detail, tone, onOpen, grouped = false }: { emoji: string; label: string; value: string; detail?: React.ReactNode; tone?: string; onOpen: () => void; grouped?: boolean }) {
  return (
    <li className={grouped ? undefined : CARD}>
      <button type="button" onClick={onOpen} className={cn("flex w-full items-center gap-3 px-4 text-left hover:bg-sage-soft", grouped ? "min-h-16 py-3" : "min-h-[4.5rem] py-4")}>
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-sage text-lg" aria-hidden="true">{emoji}</span>
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

function PhoneBills({ dashboard, onOpen }: { dashboard: Dashboard; onOpen: () => void }) {
  const byId = new Map(dashboard.categories.map((category) => [category.id, category]));
  const bills = new Map(dashboard.bills.map((bill) => [bill.id, bill]));
  const items = dashboard.recurring.items.slice(0, 3);
  return (
    <PhoneSection title="Coming up" action="All bills" onOpen={onOpen}>
      {items.length === 0 ? <p className={cn(GROUP, "p-4 text-sm text-ink-subtle")}>No bills set up yet.</p> : (
        <ul className={STACK}>
          {items.map((item) => {
            const bill = bills.get(item.id);
            const Icon = categoryIcon(bill?.category_id ? byId.get(bill.category_id) : undefined);
            const soon = item.days_until_due <= 1;
            return (
              <li key={item.id} className={CARD}>
                <button type="button" onClick={onOpen} className="flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left hover:bg-sage-soft">
                  <span className="grid size-10 shrink-0 place-items-center rounded-full bg-sage text-ink-muted" aria-hidden="true"><Icon className="size-4" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-ink">{item.name}</span>
                    <span className="block text-xs"><span className={soon ? "font-semibold text-danger" : "text-ink-subtle"}>{dueIn(item.days_until_due)}</span><span className="text-ink-subtle"> · {formatShortDate(item.next_due)}</span></span>
                  </span>
                  <span className="tabular shrink-0 text-sm font-semibold text-ink">{cad(item.amount_cents)}</span>
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
function PhoneRecent({ dashboard, onOpen, onEdit }: { dashboard: Dashboard; onOpen: () => void; onEdit?: (item: Transaction) => void }) {
  const byId = new Map(dashboard.categories.map((category) => [category.id, category]));
  const today = dashboard.money_calendar.today;
  const dayLabel = (value: string) => value === today ? "Today" : today && value === shiftDay(today, -1) ? "Yesterday" : formatShortDate(value);
  const groups: { day: string; rows: Transaction[] }[] = [];
  for (const item of dashboard.transactions.slice(0, 4)) {
    const last = groups.at(-1);
    if (last?.day === item.occurred_on) last.rows.push(item);
    else groups.push({ day: item.occurred_on, rows: [item] });
  }
  return (
    <PhoneSection title="Recent" action="See all" onOpen={onOpen}>
      {groups.length === 0 ? <p className={cn(GROUP, "p-4 text-sm text-ink-subtle")}>No transactions {dashboard.period.phrase} yet.</p> : (
        <div className={GROUP}>
          {groups.map((group) => (
            <section key={group.day} aria-label={dayLabel(group.day)} className="border-t border-line first:border-t-0">
              <h3 className="px-4 pb-0.5 pt-2.5 text-xs font-semibold text-ink-subtle" aria-hidden="true">{dayLabel(group.day)}</h3>
              <ul>
                {group.rows.map((item) => {
                  const category = item.category_id ? byId.get(item.category_id) : undefined;
                  const Icon = categoryIcon(category, item.kind);
                  const income = item.kind === "income";
                  return (
                    <li key={item.id}>
                      <button type="button" onClick={() => (onEdit ? onEdit(item) : onOpen())} className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left hover:bg-sage-soft">
                        <span className={cn("grid size-9 shrink-0 place-items-center rounded-full", income ? "bg-money-in-soft text-money-in" : "bg-sage text-ink-muted")} aria-hidden="true"><Icon className="size-4" /></span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-ink">{item.description}</span>
                          {item.category && <span className="block truncate text-xs text-ink-subtle">{item.category}</span>}
                        </span>
                        <span className={cn("tabular shrink-0 text-sm font-semibold", income ? "text-money-in" : "text-ink")}>{income ? cad(item.amount_cents, true) : cad(-item.amount_cents)}</span>
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
        <Glance emoji="❤️" label="Financial health" value={`${dashboard.financial_health.score}/100`} detail="How it’s scored" onOpen={() => setOpen(true)} />
      </ul>
      <ScoreDialog open={open} onOpenChange={setOpen} dashboard={dashboard} />
    </>
  );
}

const percent = (basisPoints: number) => `${Math.abs(basisPoints / 100).toFixed(1).replace(/\.0$/, "")}%`;


function ScoreDialog({ open, onOpenChange, dashboard }: { open: boolean; onOpenChange: (open: boolean) => void; dashboard: Dashboard }) {
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
              <div className="flex justify-between text-sm"><span className="text-ink">{factor.label}</span><span className="tabular text-ink-subtle">{factor.score}/{factor.max_score}</span></div>
              <Progress className="mt-1" value={(factor.score * 100) / factor.max_score} indicatorClassName="bg-primary" />
              <p className="mt-1 text-xs text-ink-subtle">{factor.explanation}</p>
            </div>
          ))}
        </div>
        <div className="mt-5 rounded-xl bg-sage-soft p-4">
          <h3 className="text-sm font-semibold text-ink">Daily Money Score</h3>
          <p className="mt-1 text-xs leading-relaxed text-ink-muted">{dashboard.money_calendar.methodology}</p>
        </div>
        <p className="mt-4 text-xs text-ink-subtle">Educational indicators from fictional data. Neither is a credit score.</p>
      </DialogContent>
    </Dialog>
  );
}
