"use client";

import { useId, useState } from "react";
import { ArrowDownRight, ArrowRight, ArrowUpRight, BarChart3, ChevronRight, CreditCard, Flame, Home, Info, PiggyBank, ShoppingCart, Sparkles, Sprout, TrendingDown, TrendingUp, Wallet, type LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import type { AccountType, Dashboard, MonthPoint, SpendingRunway, Transaction } from "@/lib/api";
import { formatShortDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { categoryColours } from "./charts";
import { ZONE_STYLE } from "./money-score";
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
  const [scoreInfo, setScoreInfo] = useState(false);
  // Phones: an account ("#today/<account id>") or the month's spending ("#today/spent") opens as its own page.
  const [pageId, openPage, back] = useSubpage("today");
  const account = dashboard.accounts_overview.accounts.find((item) => item.id === pageId);
  return (
    <div className="mx-auto max-w-7xl space-y-5">
      {account
        ? <div className="sm:hidden"><AccountDetail dashboard={dashboard} account={account} backLabel="Home" onBack={back} /></div>
        : pageId === "spent"
          ? <div className="sm:hidden"><SpentDetail dashboard={dashboard} onBack={back} onNavigate={onNavigate} /></div>
          : <PhoneToday dashboard={dashboard} onNavigate={onNavigate} onAsk={onAsk} onEditTransaction={onEditTransaction} onOpenPage={openPage} />}
      <div className="hidden gap-5 sm:grid xl:grid-cols-[minmax(0,1fr)_24rem] [&>*]:min-w-0">
        <div className="space-y-5">
          <Card className="py-4"><SafeToSpendHero dashboard={dashboard} onNavigate={onNavigate} /></Card>
          <MetricCards dashboard={dashboard} onNavigate={onNavigate} />
          <SpendingOverview dashboard={dashboard} onNavigate={onNavigate} />
          <div className="grid gap-5 md:grid-cols-[1fr_1.35fr] [&>*]:min-w-0">
            <HealthCard dashboard={dashboard} onExplain={() => setScoreInfo(true)} />
            <PennyCard dashboard={dashboard} onAsk={onAsk} onOpen={() => onNavigate("ai")} />
          </div>
        </div>
        <div className="space-y-5">
          <RecentTransactions dashboard={dashboard} onOpen={() => onNavigate("spending", "transactions")} onEdit={onEditTransaction} />
          <UpcomingBills dashboard={dashboard} onOpen={() => onNavigate("recurring")} />
          <LearningStreak dashboard={dashboard} onOpen={() => onNavigate("learn")} />
        </div>
      </div>
      <ScoreDialog open={scoreInfo} onOpenChange={setScoreInfo} dashboard={dashboard} />
    </div>
  );
}

// ------------------------------------------------------------------ phone

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
 * Home on a phone: what you can spend (and per day, until payday), three numbers, then what's
 * next. The charts and score live on their own tabs here. Every figure comes from the API.
 */
function PhoneToday({ dashboard, onNavigate, onAsk, onEditTransaction, onOpenPage }: Props & { onOpenPage: (id: string) => void }) {
  const { home, totals, period, accounts_overview: overview } = dashboard;
  const accounts = [...overview.accounts].sort((a, b) => ACCOUNT_ORDER.indexOf(a.account_type) - ACCOUNT_ORDER.indexOf(b.account_type));
  const change = home.spending_change_basis_points;
  return (
    <div className="space-y-6 sm:hidden">
      <SafeToSpendHero dashboard={dashboard} onNavigate={onNavigate} />

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

      <PhoneBills dashboard={dashboard} onOpen={() => onNavigate("recurring")} />
      <PhoneRecent dashboard={dashboard} onOpen={() => onNavigate("spending", "transactions")} onEdit={onEditTransaction} />

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

// ------------------------------------------------------------------ metric cards

const percent = (basisPoints: number) => `${Math.abs(basisPoints / 100).toFixed(1).replace(/\.0$/, "")}%`;

function MetricCards({ dashboard, onNavigate }: { dashboard: Dashboard; onNavigate: (view: View, anchor?: string) => void }) {
  const { home, credit } = dashboard;
  const savedShare = home.monthly_goal_cents > 0 ? Math.min(100, Math.max(0, Math.round((home.monthly_saved_cents * 100) / home.monthly_goal_cents))) : null;
  return (
    <section aria-label="Key numbers" className="grid grid-cols-3 gap-3">
      <Metric icon={Wallet} tone="bg-zone-green-soft text-money-in" title="Total cash" value={cad(home.cash_cents)} onOpen={() => onNavigate("accounts", "total-balance")}
        note={home.cash_change_basis_points !== null && <Change basisPoints={home.cash_change_basis_points} suffix="from last month" />}>
        <Sparkline points={home.cash_history} colour="var(--color-zone-green)" label="Cash over the last six months" />
      </Metric>
      <Metric icon={CreditCard} tone="bg-[#f2ecff] text-[#7047b7] dark:bg-[#302847] dark:text-[#c1a5ee]" title="Credit used" value={credit ? percent(credit.utilization_basis_points) : "No card"} onOpen={() => (credit ? onNavigate("accounts", "account-credit") : onNavigate("settings"))}
        note={<span className="text-ink-subtle">{credit ? `${cad(credit.balance_cents)} of ${cad(credit.credit_limit_cents)}` : "Add a card in Settings"}</span>}>
        {credit && <Bar value={credit.utilization_basis_points / 100} className={credit.utilization_basis_points > 3000 ? "bg-gold" : "bg-[#9c6ade]"} label="Credit utilization" caption={credit.utilization_basis_points > 3000 ? "Above the 30% guideline" : "Under the 30% guideline"} />}
      </Metric>
      <Metric icon={PiggyBank} tone="bg-gold-soft text-gold-strong" title={dashboard.period.single_month ? "Monthly savings" : "Saved"} value={cad(home.monthly_saved_cents)} onOpen={() => onNavigate("goals")}
        note={<span className="text-ink-subtle">kept after spending {dashboard.period.phrase}</span>}>
        {savedShare !== null && <Bar value={savedShare} className="bg-gold" label={`${savedShare}% of what your goals need`} caption={`${savedShare}% of goal`} />}
      </Metric>
    </section>
  );
}

function Metric({ icon: Icon, tone, title, value, note, children, onOpen }: { icon: LucideIcon; tone: string; title: string; value: string; note: React.ReactNode; children?: React.ReactNode; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="group flex min-w-0 flex-col rounded-[var(--radius-card)] border border-line bg-surface p-3.5 text-left shadow-[var(--shadow-card)] transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-[var(--shadow-raised)] motion-reduce:transform-none sm:p-5">
      <span className="flex items-center justify-between">
        <span className={cn("grid size-11 place-items-center rounded-xl", tone)} aria-hidden="true"><Icon className="size-5" /></span>
        <span className="grid size-8 place-items-center rounded-full bg-sage-soft text-ink-muted transition-transform group-hover:translate-x-0.5" aria-hidden="true"><ChevronRight className="size-4" /></span>
      </span>
      <span className="mt-4 text-sm font-semibold text-ink">{title}</span>
      <span className="tabular mt-0.5 truncate text-xl font-semibold tracking-tight text-ink sm:text-2xl xl:text-[1.35rem] 2xl:text-[1.7rem]">{value}</span>
      <span className="mt-1 text-xs">{note}</span>
      <span className="mt-auto pt-3">{children}</span>
    </button>
  );
}

function Change({ basisPoints, suffix }: { basisPoints: number; suffix: string }) {
  const up = basisPoints >= 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return <span className="inline-flex items-center gap-1"><Icon className={cn("size-3.5", up ? "text-money-in" : "text-danger")} aria-hidden="true" /><span className={cn("font-semibold", up ? "text-money-in" : "text-danger")}>{percent(basisPoints)}</span><span className="text-ink-subtle">{suffix}</span></span>;
}

function Bar({ value, className, label, caption }: { value: number; className: string; label: string; caption: string }) {
  return (
    <span className="block">
      <Progress value={value} className="h-2" indicatorClassName={className} aria-label={label} />
      <span className="mt-1.5 block text-[11px] text-ink-subtle">{caption}</span>
    </span>
  );
}

/** Smooth line with a soft fill; decorative trend only, the number above is the fact. */
function Sparkline({ points, colour, label }: { points: MonthPoint[]; colour: string; label: string }) {
  if (points.length < 2) return null;
  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const span = Math.max(...values) - min || 1;
  const coords = values.map((value, index) => [(index / (values.length - 1)) * 100, 28 - ((value - min) / span) * 24]);
  const line = coords.map(([x, y], index) => `${index ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const id = `spark-${label.replace(/\W+/g, "")}`;
  return (
    <svg viewBox="0 0 100 32" preserveAspectRatio="none" className="h-10 w-full" role="img" aria-label={label}>
      <defs><linearGradient id={id} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={colour} stopOpacity="0.28" /><stop offset="100%" stopColor={colour} stopOpacity="0" /></linearGradient></defs>
      <path d={`${line} L100,32 L0,32 Z`} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={colour} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ------------------------------------------------------------------ spending overview

function SpendingOverview({ dashboard, onNavigate }: { dashboard: Dashboard; onNavigate: (view: View, anchor?: string) => void }) {
  const { period } = dashboard;
  const items = dashboard.category_spending;
  const total = items.reduce((sum, item) => sum + item.spent_cents, 0);
  const colourFor = categoryColours(dashboard.categories);
  const byId = new Map(dashboard.categories.map((category) => [category.id, category]));
  const change = dashboard.home.spending_change_basis_points;

  return (
    <Card className="p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-ink">Spending overview</h2>
          <p className="mt-0.5 text-sm text-ink-muted">You’ve spent <span className="tabular font-semibold text-ink">{cad(total)}</span> {period.phrase}.</p>
        </div>
      </div>

      {total === 0 ? <p className="mt-5 rounded-xl bg-sage-soft p-4 text-sm text-ink-subtle">No spending recorded yet.</p> : (
        <>
          <div className="mt-5 flex h-4 overflow-hidden rounded-full" role="img" aria-label={items.map((item) => `${item.category_name} ${Math.round(item.share_basis_points / 100)}%`).join(", ")}>
            {items.map((item) => <span key={item.category_id ?? "none"} style={{ width: `${item.share_basis_points / 100}%`, background: colourFor(item.category_id) }} className="border-r-2 border-surface last:border-r-0" />)}
          </div>
          <ul className="mt-4 grid gap-x-8 sm:grid-cols-2">
            {items.slice(0, 8).map((item) => {
              const Icon = categoryIcon(item.category_id ? byId.get(item.category_id) : undefined);
              return (
                <li key={item.category_id ?? "none"} className="flex items-center gap-3 border-b border-line py-2.5 last:border-b-0 sm:[&:nth-last-child(2)]:border-b-0">
                  <span className="grid size-9 shrink-0 place-items-center rounded-xl" style={{ background: `color-mix(in srgb, ${colourFor(item.category_id)} 18%, transparent)`, color: colourFor(item.category_id) }} aria-hidden="true"><Icon className="size-4" /></span>
                  <span className="min-w-0 flex-1 truncate text-sm text-ink">{item.category_name}</span>
                  <span className="tabular text-sm font-semibold text-ink">{cad(item.spent_cents)}</span>
                  <span className="tabular w-10 text-right text-xs text-ink-subtle">{Math.round(item.share_basis_points / 100)}%</span>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {change !== null && (
        <button type="button" onClick={() => onNavigate("spending", "trends")} className={cn("mt-4 flex w-full items-center gap-3 rounded-2xl p-3 text-left transition-colors sm:p-4", change <= 0 ? "bg-zone-green-soft hover:brightness-95" : "bg-gold-soft hover:brightness-95")}>
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface/70" aria-hidden="true">{change <= 0 ? <TrendingDown className="size-5 text-money-in" /> : <TrendingUp className="size-5 text-gold-strong" />}</span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-ink">{period.phrase === "this month" ? `You’re spending ${percent(change)} ${change <= 0 ? "less" : "more"} than last month so far.` : `You spent ${percent(change)} ${change <= 0 ? "less" : "more"} than the period before.`}</span>
            <span className="block text-xs text-ink-muted">Keep flexible spending under <span className="tabular font-semibold">{cad(dashboard.home.weekly_flexible_cents)}</span> this week to stay on track.</span>
          </span>
          <ChevronRight className="size-5 shrink-0 text-ink-muted" aria-hidden="true" />
        </button>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------ right column

function SideCard({ title, action, onOpen, children }: { title: React.ReactNode; action: string; onOpen: () => void; children: React.ReactNode }) {
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-ink">{title}</h2>
        <button type="button" onClick={onOpen} className="inline-flex min-h-10 items-center gap-1 rounded-lg px-2 text-sm font-semibold text-info hover:bg-info-soft">{action}<ArrowRight className="size-4" aria-hidden="true" /></button>
      </div>
      {children}
    </Card>
  );
}

function RecentTransactions({ dashboard, onOpen, onEdit }: { dashboard: Dashboard; onOpen: () => void; onEdit?: (item: Transaction) => void }) {
  const byId = new Map(dashboard.categories.map((category) => [category.id, category]));
  const rows = dashboard.transactions.slice(0, 5);
  return (
    <SideCard title="Recent transactions" action="View all" onOpen={onOpen}>
      {rows.length === 0 ? <p className="mt-3 text-sm text-ink-subtle">No transactions {dashboard.period.phrase} yet.</p> : (
        <table className="mt-2 w-full table-fixed text-sm">
          <caption className="sr-only">Five most recent transactions</caption>
          <thead><tr className="text-left text-xs text-ink-subtle"><th scope="col" className="w-14 py-2 font-medium">Date</th><th scope="col" className="py-2 font-medium">Merchant</th><th scope="col" className="hidden w-28 py-2 font-medium sm:table-cell xl:hidden">Category</th><th scope="col" className="w-24 py-2 text-right font-medium">Amount</th></tr></thead>
          <tbody>
            {rows.map((item) => {
              const category = item.category_id ? byId.get(item.category_id) : undefined;
              const Icon = categoryIcon(category, item.kind);
              const income = item.kind === "income";
              return (
                <tr key={item.id} className="border-t border-line">
                  <td className="whitespace-nowrap py-2.5 pr-2 text-ink-subtle">{formatShortDate(item.occurred_on)}</td>
                  <td className="max-w-0 py-2.5 pr-2">
                    <span className="flex items-center gap-2"><span className={cn("grid size-8 shrink-0 place-items-center rounded-full", income ? "bg-money-in-soft text-money-in" : "bg-sage text-ink-muted")} aria-hidden="true"><Icon className="size-4" /></span>{onEdit ? <button type="button" onClick={() => onEdit(item)} className="truncate text-left font-medium text-ink hover:underline" title={`Edit ${item.description}`}>{item.description}</button> : <span className="truncate font-medium text-ink">{item.description}</span>}</span>
                  </td>
                  <td className="hidden truncate py-2.5 pr-2 text-ink-muted sm:table-cell xl:hidden">{item.category}</td>
                  <td className={cn("tabular whitespace-nowrap py-2.5 text-right font-semibold", income ? "text-money-in" : "text-money-out")}>{income ? cad(item.amount_cents, true) : cad(-item.amount_cents)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </SideCard>
  );
}

function UpcomingBills({ dashboard, onOpen }: { dashboard: Dashboard; onOpen: () => void }) {
  const byId = new Map(dashboard.categories.map((category) => [category.id, category]));
  const bills = new Map(dashboard.bills.map((bill) => [bill.id, bill]));
  const items = dashboard.recurring.items.slice(0, 4);
  return (
    <SideCard title="Upcoming bills" action="View all" onOpen={onOpen}>
      {items.length === 0 ? <p className="mt-3 text-sm text-ink-subtle">No bills set up yet.</p> : (
        <ul className="mt-2 space-y-1">
          {items.map((item) => {
            const bill = bills.get(item.id);
            const Icon = categoryIcon(bill?.category_id ? byId.get(bill.category_id) : undefined);
            const days = item.days_until_due;
            const pill = days <= 3 ? "bg-danger-soft text-danger" : days <= 7 ? "bg-gold-soft text-gold-strong" : "bg-info-soft text-info";
            return (
              <li key={item.id}>
                <button type="button" onClick={onOpen} className="flex min-h-14 w-full items-center gap-3 rounded-xl px-1 text-left hover:bg-sage-soft">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-sage text-ink" aria-hidden="true"><Icon className="size-5" /></span>
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-ink">{item.name}</span><span className="text-xs text-ink-subtle">Due {formatShortDate(item.next_due)}</span></span>
                  <span className="tabular text-sm font-semibold text-ink">{cad(item.amount_cents)}</span>
                  <span className={cn("w-[5.5rem] shrink-0 rounded-lg py-1.5 text-center text-xs font-semibold", pill)}>{days <= 0 ? "Due today" : `${days} day${days === 1 ? "" : "s"} left`}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </SideCard>
  );
}

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

function LearningStreak({ dashboard, onOpen }: { dashboard: Dashboard; onOpen: () => void }) {
  const learning = dashboard.learning;
  const todayIndex = dashboard.money_calendar.today ? (new Date(`${dashboard.money_calendar.today}T00:00:00Z`).getUTCDay() + 6) % 7 : -1;
  return (
    <Card className="p-4 sm:p-5">
      <button type="button" onClick={onOpen} className="flex w-full items-center justify-between text-left">
        <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-ink"><Flame className="size-5 text-[#e4572e]" aria-hidden="true" />Learning streak</h2>
        <ChevronRight className="size-5 text-ink-muted" aria-hidden="true" />
      </button>
      <div className="mt-3 grid gap-3 sm:grid-cols-[auto_1fr] xl:grid-cols-1 2xl:grid-cols-[auto_1fr]">
        <div>
          <p className="tabular text-3xl font-semibold tracking-tight text-ink">{learning.streak_days} day{learning.streak_days === 1 ? "" : "s"}</p>
          <ol className="mt-2 flex gap-1.5" aria-label="Lessons completed this week">
            {learning.week_activity.map((done, index) => (
              <li key={index} className="flex flex-col items-center gap-1">
                <span className={cn("size-5 rounded-full", done ? "bg-info" : index === todayIndex ? "border-2 border-info bg-info-soft" : "bg-sage")} aria-label={`${WEEKDAYS[index]}: ${done ? "lesson done" : "no lesson"}`} />
                <span className="text-[10px] text-ink-subtle" aria-hidden="true">{WEEKDAYS[index]}</span>
              </li>
            ))}
          </ol>
        </div>
        {learning.next_lesson && (
          <button type="button" onClick={onOpen} className="flex items-center gap-3 rounded-2xl bg-sage-soft p-3 text-left hover:bg-sage">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-zone-green-soft text-money-in" aria-hidden="true"><Sprout className="size-5" /></span>
            <span className="min-w-0 flex-1"><span className="block text-[11px] text-ink-subtle">Next lesson</span><span className="block text-sm font-semibold text-ink">{learning.next_lesson.title}</span><span className="text-[11px] text-ink-subtle">2 min · +{learning.next_lesson.xp_reward} XP</span></span>
            <ChevronRight className="size-4 shrink-0 text-ink-muted" aria-hidden="true" />
          </button>
        )}
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------ bottom row

function HealthCard({ dashboard, onExplain }: { dashboard: Dashboard; onExplain: () => void }) {
  const health = dashboard.financial_health;
  const bars = [...health.history.map((point) => point.value), health.score];
  const previous = health.history.at(-1)?.value;
  const change = previous === undefined ? null : health.score - previous;
  const calendar = dashboard.money_calendar;
  return (
    <Card className="flex flex-col p-4 sm:p-5">
      <button type="button" onClick={onExplain} className="flex items-center justify-between text-left">
        <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-ink"><BarChart3 className="size-5 text-ink-muted" aria-hidden="true" />Financial health</h2>
        <Info className="size-4 text-ink-subtle" aria-label="How it’s scored" />
      </button>
      <div className="mt-3 flex items-end justify-between gap-3">
        <div>
          <p className="tabular text-4xl font-semibold tracking-tight text-ink">{health.score}<span className="text-xl font-normal text-ink-subtle"> / 100</span></p>
          {change !== null && <p className={cn("mt-1 text-sm font-semibold", change >= 0 ? "text-money-in" : "text-danger")}>{change >= 0 ? "↑" : "↓"} {Math.abs(change)} pt{Math.abs(change) === 1 ? "" : "s"} <span className="whitespace-nowrap font-normal text-ink-subtle">vs last month</span></p>}
        </div>
        <div className="flex h-16 shrink-0 items-end gap-1" role="img" aria-label={`Health score by month: ${bars.join(", ")}`}>
          {bars.map((value, index) => <span key={index} className={cn("w-2.5 rounded-sm", index === bars.length - 1 ? "bg-zone-green" : "bg-sage")} style={{ height: `${Math.max(10, value)}%` }} />)}
        </div>
      </div>
      {calendar.today_score !== null && calendar.today_zone && (
        <dl className="mt-auto grid grid-cols-2 gap-2 border-t border-line pt-3 text-xs">
          <div><dt className="text-ink-subtle">Money Score today</dt><dd className="mt-0.5 flex items-center gap-1.5 font-semibold text-ink"><span className={cn("size-2.5 rounded-full", ZONE_STYLE[calendar.today_zone].fill)} aria-hidden="true" /><span className="tabular">{calendar.today_score}</span> {ZONE_STYLE[calendar.today_zone].label.toLowerCase()}</dd></div>
          <div><dt className="text-ink-subtle">Green streak</dt><dd className="mt-0.5 flex items-center gap-1 font-semibold text-ink"><Flame className="size-3.5 text-[#e4572e]" aria-hidden="true" /><span className="tabular">{calendar.streaks.current_green}</span> days</dd></div>
        </dl>
      )}
    </Card>
  );
}

function PennyCard({ dashboard, onAsk, onOpen }: { dashboard: Dashboard; onAsk: (question: string) => void; onOpen: () => void }) {
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-ink"><Sparkles className="size-5 text-info" aria-hidden="true" />Penny AI</h2>
          <p className="mt-1 text-sm text-ink-subtle">Have a question? Personal answers from your own numbers.</p>
        </div>
        <button type="button" onClick={onOpen} className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-full bg-ink px-4 text-sm font-semibold text-canvas hover:opacity-90">Ask Penny<ArrowRight className="size-4" aria-hidden="true" /></button>
      </div>
      <ul className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2" aria-label="Suggested questions">
        {personalPrompts(dashboard).map(({ icon: Icon, text }) => (
          <li key={text}><button type="button" onClick={() => onAsk(text)} className="flex min-h-11 w-full items-center gap-2.5 rounded-xl border border-line bg-sage-soft px-3 text-left text-sm text-ink-muted hover:border-accent hover:text-ink"><Icon className="size-4 shrink-0" aria-hidden="true" />{text}</button></li>
        ))}
      </ul>
    </Card>
  );
}

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
