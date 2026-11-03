"use client";

import { type FormEvent, useEffect, useState } from "react";
import { AlertTriangle, CalendarClock, Check, CheckCircle2, ChevronRight, Clock, CreditCard, Hand, History, Info, LoaderCircle, Pencil, Plus, Repeat, Sparkles, Trash2, Tv, Wand2, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DatePicker, isoToday } from "@/components/ui/date-picker";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/input";
import { type Bill, type BillFrequency, type BillHistory, type BillWrite, type CardPayment, type Dashboard, dashboardApi, type RecurringExpense, type RecurringMonth, type RecurringPayment, type UpcomingPayment } from "@/lib/api";
import { formatLongDate, formatShortDate } from "@/lib/format";
import { centsToInput, parseCadToCents } from "@/lib/money";
import { cn } from "@/lib/utils";
import { FREQUENCIES, PaymentMode } from "./bill-options";
import { categoryOptions } from "./labels";
import { cad, describeError, dueLabel, EmptyState, Field } from "./shared";
import { useTransfers } from "./transfer-dialog";

/** A bill to save. On an edit, `move_once` moves only the next payment (the schedule stays). */
export type BillInput = BillWrite & { move_once?: boolean };
export type RecurringActions = {
  /** `recordOnly`: already paid in the bank, so add it to history without changing a balance. */
  onMarkPaid: (bill: Bill, recordOnly?: boolean) => void;
  onSave: (id: string | null, body: BillInput) => Promise<string | null>;
  onDelete: (bill: Bill) => void;
  /** A card payment made outside Penny: the card moves to next month and no balance changes. */
  onCardPaid: (card: CardPayment) => void;
};
type Props = RecurringActions & { dashboard: Dashboard; onAsk: (question: string) => void };

const FREQUENCY_SHORT: Record<BillFrequency, string> = { weekly: "weekly", biweekly: "every 2 weeks", monthly: "monthly", yearly: "yearly" };

const billInput = (bill: Bill): BillInput => ({ name: bill.name, amount_cents: bill.amount_cents, category_id: bill.category_id, account_id: bill.account_id, frequency: bill.frequency, next_due: bill.next_due, auto_record: bill.auto_record });

type Section = "upcoming" | "paid" | "all";

export function RecurringView({ dashboard, onAsk, onMarkPaid, onSave, onDelete, onCardPaid }: Props) {
  const summary = dashboard.recurring;
  const [editing, setEditing] = useState<Bill | BillInput | "new" | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [section, setSection] = useState<Section>("upcoming");
  const bills = new Map(dashboard.bills.map((bill) => [bill.id, bill]));
  const viewed = viewing ? bills.get(viewing) ?? null : null;
  const month = summary.this_month;
  const monthName = new Date(`${dashboard.current_month}T00:00:00`).toLocaleDateString("en-CA", { month: "long" });
  const overdue = summary.items.filter((item) => item.status === "overdue");
  const paidTotal = summary.items.reduce((total, item) => total + item.payment_count, 0);
  const sections: { id: Section; label: string; count: number }[] = [
    { id: "upcoming", label: "Coming up", count: summary.upcoming.length },
    { id: "paid", label: "Paid", count: paidTotal },
    { id: "all", label: "All bills", count: summary.items.length },
  ];

  return (
    <div className="space-y-5">
      <section aria-labelledby="fixed-title" className="overflow-hidden rounded-[var(--radius-card)] bg-hero p-5 text-white shadow-[var(--shadow-raised)] sm:p-6">
        <div className="grid gap-5 lg:grid-cols-[1fr_minmax(0,22rem)] lg:items-center">
          <div>
            <p className="flex items-center gap-2 text-sm text-white/75"><Repeat className="size-4" aria-hidden="true" />Your recurring payments</p>
            <h2 id="fixed-title" className="mt-1 text-2xl font-semibold leading-snug tracking-tight sm:text-3xl">
              {summary.items.length === 0 ? "Nothing set up yet" : <>{summary.items.length} payment{summary.items.length === 1 ? "" : "s"} · <span className="tabular">{cad(summary.fixed_monthly_cents)}</span><span className="text-lg font-normal text-white/70"> a month</span></>}
            </h2>
            {summary.items.length > 0 && (
              <p className="mt-2 text-sm text-white/80">
                {summary.bill_count} bill{summary.bill_count === 1 ? "" : "s"} and {summary.subscription_count} subscription{summary.subscription_count === 1 ? "" : "s"}.
                {summary.share_of_income_basis_points !== null && <> That’s about <span className="font-semibold text-white">{Math.round(summary.share_of_income_basis_points / 100)}%</span> of your typical income.</>}
              </p>
            )}
            {summary.upcoming[0] && (
              <p className="mt-4 inline-flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl bg-white/10 px-3 py-2 text-sm">
                <CalendarClock className="size-4 shrink-0 text-white/80" aria-hidden="true" />
                <span className="text-white/75">Next up:</span>
                <span className="font-semibold">{summary.upcoming[0].name}</span>
                <span className="tabular font-semibold">{cad(summary.upcoming[0].amount_cents)}</span>
                <span className="text-white/75">{dueLabel(summary.upcoming[0].days_until_due).replace("Due ", "").toLowerCase()}</span>
              </p>
            )}
          </div>
          {month && summary.items.length > 0 && <MonthCard month={month} name={monthName} />}
        </div>
      </section>

      {overdue.length > 0 && (
        <div role="alert" className="flex flex-col gap-3 rounded-2xl border border-danger/30 bg-danger-soft p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-center gap-2 text-sm font-semibold text-danger"><AlertTriangle className="size-4 shrink-0" aria-hidden="true" />{overdue.length} payment{overdue.length === 1 ? " is" : "s are"} overdue: {overdue.map((item) => item.name).join(", ")}</p>
          <Button size="sm" variant="destructive-soft" onClick={() => setViewing(overdue[0].id)}>Review</Button>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Recurring payments" className="grid w-full grid-cols-3 rounded-xl bg-sage-soft p-1 sm:inline-flex sm:w-auto">
          {sections.map((item) => (
            <button key={item.id} type="button" role="tab" id={`recurring-${item.id}`} aria-selected={section === item.id} aria-controls={`recurring-panel-${item.id}`} onClick={() => setSection(item.id)} className={cn("inline-flex min-h-10 min-w-0 items-center justify-center gap-1.5 rounded-lg px-2 text-sm font-semibold transition-colors sm:px-3", section === item.id ? "bg-surface text-ink shadow-sm" : "text-ink-subtle hover:text-ink")}>
              {item.label}<span className={cn("tabular rounded-full px-1.5 text-xs", section === item.id ? "bg-accent-soft text-accent-strong" : "bg-sage text-ink-muted")}>{item.count}</span>
            </button>
          ))}
        </div>
        <Button onClick={() => setEditing("new")}><Plus className="size-4" aria-hidden="true" />Add a bill</Button>
      </div>

      <div role="tabpanel" id={`recurring-panel-${section}`} aria-labelledby={`recurring-${section}`}>
        {summary.items.length === 0 ? (
          <Card className="p-5"><EmptyState icon={Repeat} title="No recurring payments yet" description="Add rent, your phone plan, and subscriptions, or tick “Recurring” when you add a transaction." action={<Button size="sm" onClick={() => setEditing("new")}>Add a bill</Button>} /></Card>
        ) : section === "upcoming" ? (
          <Upcoming items={summary.upcoming} onOpen={setViewing} />
        ) : section === "paid" ? (
          <Paid payments={summary.recent_payments} total={paidTotal} onOpen={setViewing} />
        ) : (
          <AllBills items={summary.items} onOpen={setViewing} />
        )}
      </div>

      <CardCycles payments={dashboard.card_payments} onRecordOnly={onCardPaid} />

      {summary.suggestions.length > 0 && (
        <Card className="border-accent/30 p-5">
          <h2 className="flex items-center gap-2 font-semibold text-ink"><Wand2 className="size-4 text-accent" aria-hidden="true" />Found in your history</h2>
          <p className="mt-1 text-sm text-ink-muted">These charge the same amount every month. Add them so they’re tracked.</p>
          <ul className="mt-3 divide-y divide-line">
            {summary.suggestions.map((item) => (
              <li key={item.name} className="flex items-center justify-between gap-3 py-2.5">
                <span className="min-w-0"><span className="block truncate text-sm font-semibold text-ink">{item.name}</span><span className="text-xs text-ink-subtle"><span className="tabular">{cad(item.amount_cents)}</span> · next around {formatShortDate(item.next_due)}</span></span>
                <Button size="sm" variant="secondary" onClick={() => setEditing({ name: item.name, amount_cents: item.amount_cents, category_id: item.category_id, account_id: defaultAccount(dashboard), frequency: "monthly", next_due: item.next_due, auto_record: true })}>Add</Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {summary.subscriptions_monthly_cents > 0 && (
        <Card className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-center gap-2 text-sm text-ink-muted"><Tv className="size-4 shrink-0 text-[#7047b7] dark:text-[#c1a5ee]" aria-hidden="true" />{cad(summary.subscriptions_monthly_cents)} a month on subscriptions. Small charges add up over a year.</p>
          <Button variant="outline" onClick={() => onAsk("Are any of my subscriptions worth cancelling? What would it save me in a year?")}><Sparkles className="size-4" aria-hidden="true" />Review with Penny</Button>
        </Card>
      )}
      <p className="flex gap-2 px-1 text-xs leading-relaxed text-ink-subtle"><Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />{summary.methodology}</p>

      <BillDetail dashboard={dashboard} bill={viewed} onClose={() => setViewing(null)} onMarkPaid={onMarkPaid} onSave={onSave} onEdit={(bill) => { setViewing(null); setEditing(bill); }} onDelete={(bill) => { setViewing(null); onDelete(bill); }} />
      <BillDialog dashboard={dashboard} target={editing} onClose={() => setEditing(null)} onSave={onSave} onDelete={(bill) => { setEditing(null); onDelete(bill); }} />
    </div>
  );
}

function defaultAccount(dashboard: Dashboard): string {
  return dashboard.accounts.find((account) => account.account_type === "chequing")?.id ?? dashboard.accounts[0]?.id ?? "";
}

/**
 * Each credit card's payment, one cycle at a time. Recording a payment (Pay card) pays the cycle
 * coming up, so the card moves on to next month's due date and shows when it was paid.
 */
function CardCycles({ payments, onRecordOnly }: { payments: CardPayment[]; onRecordOnly: (card: CardPayment) => void }) {
  const transfers = useTransfers();
  if (payments.length === 0) return null;
  return (
    <Card className="p-5">
      <h2 className="flex items-center gap-2 font-semibold text-ink"><CreditCard className="size-4 text-danger" aria-hidden="true" />Credit cards</h2>
      <p className="mt-1 text-sm text-ink-muted">Paying a card isn’t spending: the purchases already counted. Recording a payment moves the card to next month.</p>
      <ul className="mt-3 space-y-1">
        {payments.map((card) => {
          const paid = card.paid_on !== null;
          return (
            <li key={card.account_id} className="rounded-xl px-2 py-1.5">
              <div className="flex min-h-16 items-center gap-3">
              <DateTile iso={card.due_on} tone={paid ? "paid" : card.days_until_due <= 3 ? "soon" : "later"} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-ink">{card.account_name}</span>
                <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                  {paid
                    ? <span className="inline-flex items-center gap-1 font-semibold text-money-in"><CheckCircle2 className="size-3.5" aria-hidden="true" />Paid {formatShortDate(card.paid_on!)} · next due {formatShortDate(card.due_on)}</span>
                    : <span className={cn("font-semibold", card.days_until_due <= 3 ? "text-gold-strong" : "text-ink-subtle")}>{dueLabel(card.days_until_due)}</span>}
                  <span className="text-ink-subtle">· <span className="tabular">{cad(card.owed_cents)}</span> owed now</span>
                </span>
              </span>
              {transfers && card.owed_cents > 0 && (
                <Button size="sm" variant={paid ? "outline" : "default"} onClick={() => transfers.openTransfer({ to: card.account_id, amountCents: card.owed_cents })}>{paid ? "Pay again" : "Mark paid"}</Button>
              )}
              </div>
              {!paid && (
                <button type="button" onClick={() => onRecordOnly(card)} className="mt-1 flex min-h-11 w-full items-center gap-2 rounded-xl border border-line px-3 text-left text-sm text-ink-muted hover:bg-sage-soft hover:text-ink">
                  <History className="size-4 shrink-0" aria-hidden="true" />
                  <span><span className="font-semibold text-ink">Already paid it?</span> Just record it. No balance changes.</span>
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/** This calendar month: how much is paid and how much is left, as a bar. */
function MonthCard({ month, name }: { month: RecurringMonth; name: string }) {
  const total = month.paid_cents + month.left_cents + month.overdue_cents;
  const share = total ? Math.round((month.paid_cents * 100) / total) : 0;
  return (
    <div className="rounded-2xl bg-white/10 p-4">
      <p className="text-sm font-semibold">{name} so far</p>
      <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-white/15" role="img" aria-label={`${share}% of this month’s recurring payments are paid`}>
        <div className="h-full rounded-full bg-white/85" style={{ width: `${share}%` }} />
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <div><dt className="flex items-center gap-1.5 text-white/75"><CheckCircle2 className="size-3.5" aria-hidden="true" />Paid</dt><dd className="mt-0.5 font-semibold"><span className="tabular">{cad(month.paid_cents)}</span> <span className="font-normal text-white/70">· {month.paid_count}</span></dd></div>
        <div><dt className="flex items-center gap-1.5 text-white/75"><Clock className="size-3.5" aria-hidden="true" />Still to pay</dt><dd className="mt-0.5 font-semibold"><span className="tabular">{cad(month.left_cents + month.overdue_cents)}</span> <span className="font-normal text-white/70">· {month.left_count + month.overdue_count}</span></dd></div>
      </dl>
      {month.left_count + month.overdue_count === 0 && month.paid_count > 0 && <p className="mt-2 text-xs text-white/75">Everything due this month is paid.</p>}
    </div>
  );
}

const shortMonth = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-CA", { month: "short" });

/** A calendar-page style date: month on top, day underneath. */
function DateTile({ iso, tone }: { iso: string; tone: "soon" | "later" | "paid" }) {
  return (
    <span className={cn("grid size-12 shrink-0 place-content-center rounded-xl text-center leading-none", tone === "soon" ? "bg-gold-soft text-gold-strong" : tone === "paid" ? "bg-zone-green-soft text-money-in" : "bg-sage text-ink-muted")} aria-hidden="true">
      <span className="text-[10px] font-semibold uppercase tracking-wider">{shortMonth(iso)}</span>
      <span className="tabular mt-0.5 text-lg font-semibold">{Number(iso.slice(8, 10))}</span>
    </span>
  );
}

function HowPaid({ auto }: { auto: boolean }) {
  return auto
    ? <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent-strong"><Zap className="size-3" aria-hidden="true" />Pays itself</span>
    : <span className="inline-flex items-center gap-1 rounded-full bg-info-soft px-2 py-0.5 text-[11px] font-semibold text-info"><Hand className="size-3" aria-hidden="true" />You pay</span>;
}

function GroupHeader({ title, count, total, noun }: { title: string; count: number; total: number; noun: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line pb-2">
      <h3 className="font-semibold text-ink">{title}</h3>
      <p className="text-sm text-ink-subtle"><span className="font-semibold text-ink">{count}</span> {noun}{count === 1 ? "" : "s"} · <span className="tabular font-semibold text-ink">{cad(total)}</span></p>
    </div>
  );
}

function Upcoming({ items, onOpen }: { items: UpcomingPayment[]; onOpen: (id: string) => void }) {
  if (items.length === 0) return <Card className="p-5"><EmptyState icon={CalendarClock} title="Nothing due in the next 30 days" description="Bills further out show under All bills." /></Card>;
  const groups = [
    { title: "This week", rows: items.filter((item) => item.days_until_due <= 7) },
    { title: "Later (next 30 days)", rows: items.filter((item) => item.days_until_due > 7) },
  ].filter((group) => group.rows.length > 0);
  return (
    <div className="grid gap-5 lg:grid-cols-2 [&>*]:min-w-0">
      {groups.map((group) => (
        <Card key={group.title} className="p-5">
          <GroupHeader title={group.title} count={group.rows.length} total={group.rows.reduce((sum, row) => sum + row.amount_cents, 0)} noun="payment" />
          <ul className="mt-2 space-y-1">
            {group.rows.map((row) => (
              <li key={`${row.bill_id}-${row.due_on}`}>
                <button type="button" onClick={() => onOpen(row.bill_id)} className="flex min-h-16 w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-sage-soft">
                  <DateTile iso={row.due_on} tone={row.days_until_due <= 3 ? "soon" : "later"} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-ink">{row.name}</span>
                    <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                      <span className={cn("font-semibold", row.days_until_due <= 3 ? "text-gold-strong" : "text-ink-subtle")}>{dueLabel(row.days_until_due)}</span>
                      <HowPaid auto={row.auto_record} />
                      {row.kind === "subscription" && <span className="rounded-full bg-[#f2ecff] px-2 py-0.5 text-[11px] font-semibold text-[#7047b7] dark:bg-[#302847] dark:text-[#c1a5ee]">Subscription</span>}
                    </span>
                  </span>
                  <span className="tabular shrink-0 text-sm font-semibold text-ink">{cad(row.amount_cents)}</span>
                  <ChevronRight className="size-4 shrink-0 text-ink-subtle" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}

function Paid({ payments, total, onOpen }: { payments: RecurringPayment[]; total: number; onOpen: (id: string) => void }) {
  if (payments.length === 0) return <Card className="p-5"><EmptyState icon={CheckCircle2} title="No payments yet" description="Payments appear here once a bill is paid." /></Card>;
  const months = [...new Set(payments.map((payment) => payment.occurred_on.slice(0, 7)))];
  return (
    <Card className="p-5">
      <div className="space-y-5">
        {months.map((key) => {
          const rows = payments.filter((payment) => payment.occurred_on.startsWith(key));
          const label = new Date(`${key}-01T00:00:00`).toLocaleDateString("en-CA", { month: "long", year: "numeric" });
          return (
            <section key={key}>
              <GroupHeader title={label} count={rows.length} total={rows.reduce((sum, row) => sum + row.amount_cents, 0)} noun="payment" />
              <ul className="mt-2 space-y-1">
                {rows.map((row, index) => (
                  <li key={`${row.bill_id}-${row.occurred_on}-${index}`}>
                    <button type="button" onClick={() => row.bill_id && onOpen(row.bill_id)} className="flex min-h-14 w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-sage-soft">
                      <DateTile iso={row.occurred_on} tone="paid" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-ink">{row.name}</span>
                        <span className="mt-1 flex items-center gap-1.5 text-xs text-ink-subtle"><CheckCircle2 className="size-3.5 text-money-in" aria-hidden="true" />Paid {formatShortDate(row.occurred_on)}{row.paid_automatically !== null && <PaymentBadge automatically={row.paid_automatically} />}</span>
                      </span>
                      <span className="tabular shrink-0 text-sm font-semibold text-ink">{cad(row.amount_cents)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
      <p className="mt-4 text-xs text-ink-subtle">{total > payments.length ? `Showing the latest ${payments.length} of ${total} payments. ` : ""}Open a bill for its full payment history.</p>
    </Card>
  );
}

function AllBills({ items, onOpen }: { items: RecurringExpense[]; onOpen: (id: string) => void }) {
  return (
    <ul className="grid gap-3 md:grid-cols-2">
      {items.map((item) => (
        <li key={item.id}>
          <button type="button" onClick={() => onOpen(item.id)} className="flex h-full w-full flex-col rounded-[var(--radius-card)] border border-line bg-surface p-4 text-left shadow-[var(--shadow-card)] transition-colors hover:border-accent">
            <span className="flex items-start gap-3">
              <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl", item.kind === "subscription" ? "bg-[#f2ecff] text-[#7047b7] dark:bg-[#302847] dark:text-[#c1a5ee]" : "bg-info-soft text-info")} aria-hidden="true">{item.kind === "subscription" ? <Tv className="size-4" /> : <Repeat className="size-4" />}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold text-ink">{item.name}</span>
                <span className="text-xs text-ink-subtle">{item.kind === "subscription" ? "Subscription" : "Bill"}{item.category_name ? ` · ${item.category_name}` : ""}</span>
              </span>
              <span className="shrink-0 text-right"><span className="tabular block font-semibold text-ink">{cad(item.amount_cents)}</span><span className="text-xs text-ink-subtle">{FREQUENCY_SHORT[item.frequency]}</span></span>
            </span>
            <dl className="mt-4 grid grid-cols-3 gap-2 text-xs">
              <div className="rounded-lg bg-sage-soft p-2"><dt className="text-ink-subtle">Next due</dt><dd className={cn("mt-0.5 font-semibold", item.status === "overdue" ? "text-danger" : item.status === "due_soon" ? "text-gold-strong" : "text-ink")}>{item.status === "overdue" ? "Overdue" : formatShortDate(item.next_due)}</dd></div>
              <div className="rounded-lg bg-sage-soft p-2"><dt className="text-ink-subtle">Last paid</dt><dd className="mt-0.5 font-semibold text-ink">{item.last_paid_on ? formatShortDate(item.last_paid_on) : "Not yet"}</dd></div>
              <div className="rounded-lg bg-sage-soft p-2"><dt className="text-ink-subtle">Payments</dt><dd className="mt-0.5 font-semibold text-ink">{item.payment_count}<span className="font-normal text-ink-subtle"> · <span className="tabular">{cad(item.total_paid_cents)}</span></span></dd></div>
            </dl>
            <span className="mt-3 flex items-center justify-between gap-2 text-xs">
              <HowPaid auto={item.auto_record} />
              {item.paid_this_month && <span className="inline-flex items-center gap-1 font-semibold text-money-in"><CheckCircle2 className="size-3.5" aria-hidden="true" />Paid this month</span>}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** One bill: how it's paid, the next payment, and every payment so far. */
function BillDetail({ dashboard, bill, onClose, onMarkPaid, onSave, onEdit, onDelete }: { dashboard: Dashboard; bill: Bill | null; onClose: () => void; onMarkPaid: Props["onMarkPaid"]; onSave: Props["onSave"]; onEdit: (bill: Bill) => void; onDelete: (bill: Bill) => void }) {
  const [history, setHistory] = useState<BillHistory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const accounts = new Map(dashboard.accounts.map((account) => [account.id, account.name]));
  const item = bill ? dashboard.recurring.items.find((entry) => entry.id === bill.id) : undefined;
  const today = dashboard.money_calendar.today ?? isoToday();

  useEffect(() => {
    if (!bill) return;
    let active = true;
    dashboardApi.billHistory(bill.id)
      .then((data) => { if (active) { setHistory(data); setError(null); } })
      .catch((reason: unknown) => { if (active) setError(describeError(reason, "History couldn’t load").detail); });
    return () => { active = false; };
  }, [bill, dashboard]);

  async function setMode(auto: boolean) {
    if (!bill || auto === bill.auto_record) return;
    setSaving(true);
    const result = await onSave(bill.id, { ...billInput(bill), auto_record: auto });
    setSaving(false);
    if (result) setError(result);
  }

  return (
    <Dialog open={bill !== null} onOpenChange={(open) => { if (!open) { onClose(); setHistory(null); } }}>
      <DialogContent className="sm:max-w-xl">
        {bill && (
          <>
            <DialogHeader>
              <DialogTitle>{bill.name}</DialogTitle>
              <DialogDescription><span className="tabular font-semibold text-ink">{cad(bill.amount_cents)}</span> {FREQUENCY_SHORT[bill.frequency]} from {accounts.get(bill.account_id) ?? "an account"}</DialogDescription>
            </DialogHeader>
            <div className="space-y-5">
              <div className="flex flex-col gap-3 rounded-2xl bg-sage-soft p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <span className="grid size-10 place-items-center rounded-xl bg-surface text-gold-strong" aria-hidden="true"><CalendarClock className="size-5" /></span>
                  <div>
                    <p className="text-xs text-ink-subtle">Next payment</p>
                    <p className="font-semibold text-ink">{formatLongDate(bill.next_due)}{item && <span className={cn("ml-2 text-sm font-medium", item.days_until_due <= 3 ? "text-gold-strong" : "text-ink-subtle")}>{dueLabel(item.days_until_due)}</span>}</p>
                    {bill.usual_due && <p className="text-xs text-ink-subtle">Moved from {formatShortDate(bill.usual_due)} this time only</p>}
                  </div>
                </div>
                <Button variant={bill.auto_record ? "outline" : "default"} onClick={() => onMarkPaid(bill)}><Check className="size-4" aria-hidden="true" />{bill.auto_record ? "Pay early" : "Mark paid"}</Button>
              </div>
              {bill.next_due <= today && (
                <button type="button" onClick={() => onMarkPaid(bill, true)} className="flex min-h-11 w-full items-center gap-2 rounded-xl border border-line px-3 text-left text-sm text-ink-muted hover:bg-sage-soft hover:text-ink">
                  <History className="size-4 shrink-0" aria-hidden="true" />
                  <span><span className="font-semibold text-ink">Already paid it?</span> Just record it. Your balance won’t change.</span>
                </button>
              )}

              <PaymentMode value={bill.auto_record} onChange={(auto) => void setMode(auto)} disabled={saving} />

              {error && <p role="alert" className="rounded-xl bg-danger-soft p-3 text-sm text-danger">{error}</p>}
              {!history ? <div className="grid h-32 place-items-center rounded-2xl bg-sage-soft"><LoaderCircle className="size-5 animate-spin text-accent" aria-hidden="true" /></div> : (
                <>
                  <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Stat label="Payments" value={String(history.payment_count)} />
                    <Stat label="Total paid" value={cad(history.total_paid_cents)} />
                    <Stat label="This year" value={cad(history.paid_this_year_cents)} />
                    <Stat label="Average" value={cad(history.average_cents)} />
                  </dl>
                  <section aria-labelledby="payment-history">
                    <h3 id="payment-history" className="text-sm font-semibold text-ink">Payment history</h3>
                    {history.payments.length === 0 ? <p className="mt-2 text-sm text-ink-subtle">No payments recorded yet.</p> : (
                      <ol className="mt-2 max-h-72 divide-y divide-line overflow-y-auto rounded-2xl border border-line">
                        {history.payments.map((payment) => (
                          <li key={payment.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                            <span className="w-24 shrink-0 text-ink-muted">{formatShortDate(payment.occurred_on)} {payment.occurred_on.slice(0, 4)}</span>
                            <span className="min-w-0 flex-1 truncate text-ink-subtle"><span className="hidden sm:inline">{accounts.get(payment.account_id) ?? "—"}</span></span>
                            <PaymentBadge automatically={payment.paid_automatically} />
                            <span className="tabular w-20 shrink-0 text-right font-semibold text-ink">{cad(payment.amount_cents)}</span>
                          </li>
                        ))}
                      </ol>
                    )}
                  </section>
                </>
              )}

              <div className="flex flex-col-reverse gap-2 border-t border-line pt-4 sm:flex-row sm:justify-between">
                <Button variant="destructive-soft" onClick={() => onDelete(bill)}><Trash2 className="size-4" aria-hidden="true" />Delete bill</Button>
                <Button variant="outline" onClick={() => onEdit(bill)}><Pencil className="size-4" aria-hidden="true" />Edit details</Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Auto-paid, marked paid by the user, or simply recorded (history or a manual entry). */
function PaymentBadge({ automatically }: { automatically: boolean | null }) {
  if (automatically === true) return <Badge tone="accent" className="shrink-0"><Zap className="size-3" aria-hidden="true" />Auto</Badge>;
  if (automatically === false) return <Badge tone="info" className="shrink-0"><Hand className="size-3" aria-hidden="true" />You marked paid</Badge>;
  return <Badge tone="neutral" className="shrink-0">Recorded</Badge>;
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl bg-sage-soft p-3"><dt className="text-xs text-ink-subtle">{label}</dt><dd className="tabular mt-0.5 truncate font-semibold text-ink">{value}</dd></div>;
}

function BillDialog({ dashboard, target, onClose, onSave, onDelete }: { dashboard: Dashboard; target: Bill | BillInput | "new" | null; onClose: () => void; onSave: Props["onSave"]; onDelete: (bill: Bill) => void }) {
  const existing = target && target !== "new" && "id" in target ? target : null;
  const draft = target === "new" ? null : target;
  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{existing ? "Edit bill" : "Add a bill"}</DialogTitle>
          <DialogDescription>It will show on your payday forecast on every due date.</DialogDescription>
        </DialogHeader>
        {target !== null && <BillForm key={existing?.id ?? draft?.name ?? "new"} dashboard={dashboard} draft={draft} onSubmit={async (body) => { const error = await onSave(existing?.id ?? null, body); if (!error) onClose(); return error; }} onDelete={existing ? () => onDelete(existing) : undefined} />}
      </DialogContent>
    </Dialog>
  );
}

type PaidAnswer = "not_yet" | NonNullable<BillWrite["already_paid"]>;

const PAID_ANSWERS: { value: PaidAnswer; label: string; detail: string }[] = [
  { value: "history", label: "Yes, just add it to my history", detail: "Your balance already reflects it." },
  { value: "balance", label: "Yes, and take it off my balance", detail: "Penny hasn’t counted it yet." },
  { value: "not_yet", label: "Not yet", detail: "It stays due until it’s paid." },
];

function BillForm({ dashboard, draft, onSubmit, onDelete }: { dashboard: Dashboard; draft: BillInput | Bill | null; onSubmit: (body: BillInput) => Promise<string | null>; onDelete?: () => void }) {
  const existing = draft && "id" in draft ? draft : null;
  const today = dashboard.money_calendar.today ?? isoToday();
  const [frequency, setFrequency] = useState<BillFrequency>(draft?.frequency ?? "monthly");
  // A new bill starts without a date, so a bill already paid this month isn't made due today.
  const [nextDue, setNextDue] = useState(draft?.next_due ?? "");
  const [autoRecord, setAutoRecord] = useState(draft?.auto_record ?? true);
  const [paid, setPaid] = useState<PaidAnswer | null>(null);
  const [moveOnce, setMoveOnce] = useState(true);
  const askPaid = !existing && nextDue !== "" && nextDue <= today;
  const moved = existing !== null && nextDue !== existing.next_due;
  const [amountError, setAmountError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    let cents: number;
    try { cents = parseCadToCents(String(form.get("amount"))); } catch (reason) { setAmountError(reason instanceof Error ? reason.message : "Enter an amount"); return; }
    if (cents <= 0) { setAmountError("Enter an amount greater than $0.00"); return; }
    setAmountError("");
    if (!nextDue) { setError("Choose when the next payment is due"); return; }
    if (askPaid && !paid) { setError("Tell Penny whether you’ve paid this one yet"); return; }
    setError("");
    setBusy(true);
    const result = await onSubmit({
      name: String(form.get("name")).trim(),
      amount_cents: cents,
      category_id: String(form.get("category_id")) || null,
      account_id: String(form.get("account_id")),
      frequency,
      next_due: nextDue,
      auto_record: autoRecord,
      ...(askPaid && paid !== "not_yet" ? { already_paid: paid } : {}),
      ...(moved ? { move_once: moveOnce } : {}),
    });
    setBusy(false);
    if (result) setError(result);
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-[1.4fr_1fr]">
        <Field label="Name">{(props) => <Input {...props} name="name" defaultValue={draft?.name} placeholder="e.g. Rent, Netflix" required maxLength={80} />}</Field>
        <Field label="Amount (CAD)" error={amountError}>{(props) => <Input {...props} name="amount" inputMode="decimal" defaultValue={draft ? centsToInput(String(draft.amount_cents)) : ""} placeholder="0.00" required />}</Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="How often">{(props) => <Select {...props} value={frequency} onChange={(event) => setFrequency(event.target.value as BillFrequency)}>{FREQUENCIES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</Select>}</Field>
        <Field label="Next payment due">{(props) => <DatePicker id={props.id} value={nextDue} onChange={setNextDue} />}</Field>
      </div>
      {askPaid && (
        <fieldset className="rounded-2xl border border-gold/40 bg-gold-soft/40 p-3">
          <legend className="px-1 text-sm font-semibold text-ink">{nextDue === today ? "This one is due today." : `This one was due ${formatShortDate(nextDue)}.`} Have you paid it?</legend>
          <div className="mt-1 space-y-1">
            {PAID_ANSWERS.map((answer) => (
              <label key={answer.value} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-2 hover:bg-surface/70">
                <input type="radio" name="already-paid" checked={paid === answer.value} onChange={() => setPaid(answer.value)} className="size-4 shrink-0 accent-[var(--color-accent)]" />
                <span className="text-sm"><span className="font-semibold text-ink">{answer.label}</span> <span className="text-ink-subtle">{answer.detail}</span></span>
              </label>
            ))}
          </div>
          {paid && paid !== "not_yet" && <p className="mt-1 px-2 text-xs text-ink-subtle">The next payment will be the one after.</p>}
        </fieldset>
      )}
      {moved && (
        <fieldset className="rounded-2xl border border-line p-3">
          <legend className="px-1 text-sm font-semibold text-ink">Move which payments?</legend>
          {[{ once: true, label: "Just this one", detail: `The rest stay on their usual date (${formatShortDate(existing!.usual_due ?? existing!.next_due)} each ${frequency === "yearly" ? "year" : frequency === "monthly" ? "month" : "time"}).` }, { once: false, label: "This and every one after", detail: "The new date becomes the usual one." }].map((option) => (
            <label key={String(option.once)} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-2 hover:bg-sage-soft">
              <input type="radio" name="move-once" checked={moveOnce === option.once} onChange={() => setMoveOnce(option.once)} className="size-4 shrink-0 accent-[var(--color-accent)]" />
              <span className="text-sm"><span className="font-semibold text-ink">{option.label}</span> <span className="text-ink-subtle">{option.detail}</span></span>
            </label>
          ))}
        </fieldset>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Category" hint="Leave blank and Penny will pick one from the name.">{(props) => (
          <Select {...props} name="category_id" defaultValue={draft?.category_id ?? ""}>
            <option value="">Pick for me</option>
            {categoryOptions(dashboard.categories, "spending").map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </Select>
        )}</Field>
        <Field label="Paid from">{(props) => <Select {...props} name="account_id" defaultValue={draft?.account_id ?? defaultAccount(dashboard)}>{dashboard.accounts.filter((account) => account.account_type !== "person").map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</Select>}</Field>
      </div>
      <PaymentMode value={autoRecord} onChange={setAutoRecord} />
      {error && <p role="alert" className="rounded-xl bg-danger-soft p-3 text-sm text-danger">{error}</p>}
      <div className="sheet-footer flex flex-col-reverse gap-2 sm:flex-row">
        {onDelete && <Button variant="destructive-soft" onClick={onDelete} disabled={busy}>Delete bill</Button>}
        <Button type="submit" className="flex-1" disabled={busy}>{draft && "id" in draft ? "Save bill" : "Add bill"}</Button>
      </div>
    </form>
  );
}
