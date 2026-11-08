"use client";

import { ChevronRight } from "lucide-react";
import type { Dashboard } from "@/lib/api";
import { formatShortDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { BackBar } from "./back-bar";
import { BigAmount, cad, type View } from "./shared";
import { SafeToSpendRead } from "./smart-cards";

const CARD = "overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-card)]";

/**
 * Safe to spend on its own page: the month's budget, minus what's been spent, minus bills still
 * due this month, and Penny's read. It goes negative (in red) once spending passes the budget.
 * Account balances don't change it. All figures come from the API.
 */
export function SafeDetail({ dashboard, onBack, onNavigate, onAsk }: { dashboard: Dashboard; onBack: () => void; onNavigate: (view: View, anchor?: string) => void; onAsk: (question: string) => void }) {
  const safe = dashboard.safe_to_spend;
  const runway = dashboard.spending_runway;
  const unpaid = dashboard.recurring.unpaid;
  const { period } = dashboard;
  if (!safe) {
    return (
      <div className="mx-auto max-w-2xl">
        <BackBar label="Home" onBack={onBack} />
        <p className={cn(CARD, "mt-4 p-4 text-sm text-ink-subtle")}>Safe to spend isn’t available for this period.</p>
      </div>
    );
  }
  const over = safe.safe_cents < 0;
  const steps: { label: string; detail?: string; cents: number; sign: "+" | "−" }[] = [
    { label: "Monthly budget", detail: safe.fixed_cents > 0 ? `${cad(safe.fixed_cents)} recurring bills + ${cad(safe.variable_cents)} category budgets` : "Your category budgets added up", cents: safe.budget_cents, sign: "+" },
    { label: `Spent ${period.phrase}`, detail: "From any account, card included", cents: safe.spent_cents, sign: "−" },
    { label: "Bills still due", detail: "Unpaid this month, overdue ones included", cents: safe.unpaid_bills_cents, sign: "−" },
  ];
  const shown = steps.filter((step, index) => index === 0 || step.cents > 0);
  // The version changes whenever any step does, so Penny's read is refetched only when it would differ.
  const version = [safe.safe_cents, safe.budget_cents, safe.spent_cents, safe.unpaid_bills_cents, unpaid.length].join(":");
  const links: { label: string; view: View; anchor?: string }[] = [
    { label: "Budgets", view: "budgets" },
    { label: "Recurring bills", view: "recurring" },
  ];

  return (
    <div className="mx-auto max-w-2xl">
      <BackBar label="Home" onBack={onBack} />

      <section aria-labelledby="safe-detail-title" className="pb-2 pt-4 text-center">
        <h2 id="safe-detail-title" className="text-base font-semibold text-ink-muted">Safe to spend</h2>
        <p className={cn("mt-2 text-5xl font-semibold leading-none tracking-tight", over ? "text-danger" : "text-ink")}><BigAmount cents={Math.abs(safe.safe_cents)} negative={over} /></p>
        {over
          ? <p role="status" className="mt-3 text-sm font-semibold text-danger">You’re <span className="tabular">{cad(safe.over_cents)}</span> over your budget {period.phrase}</p>
          : runway && safe.safe_cents > 0 && <p className="mt-3 text-sm text-ink-muted">{runway.days_left === 1 ? <><span className="tabular font-semibold text-ink">{cad(runway.per_day_cents)}</span> left for today</> : <>About <span className="tabular font-semibold text-ink">{cad(runway.per_day_cents)}</span> a day for {runway.days_left} days</>}</p>}
        {!safe.has_budget && (
          <button type="button" onClick={() => onNavigate("budgets")} className="mx-auto mt-3 block min-h-11 rounded-xl bg-primary-soft px-4 text-sm font-semibold text-ink">Set a monthly budget</button>
        )}
      </section>

      <section aria-labelledby="safe-how" className="mt-6">
        <h3 id="safe-how" className="mb-2 px-1 text-base font-semibold text-ink">How it’s worked out</h3>
        <ul className={cn(CARD, "divide-y divide-line")}>
          {shown.map((step) => (
            <li key={step.label} className="flex min-h-14 items-center justify-between gap-3 px-4 py-3">
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-ink">{step.label}</span>
                {step.detail && <span className="block text-xs text-ink-subtle">{step.detail}</span>}
              </span>
              <span className="tabular shrink-0 font-semibold text-ink"><span aria-hidden="true">{step.sign === "−" ? "− " : ""}</span><span className="sr-only">{step.sign === "−" ? "minus " : ""}</span>{cad(step.cents)}</span>
            </li>
          ))}
          <li className={cn("flex min-h-14 items-center justify-between gap-3 px-4 py-3", over ? "bg-danger-soft" : "bg-sage-soft/60")}>
            <span className="text-sm font-semibold text-ink">Safe to spend</span>
            <span className={cn("tabular shrink-0 text-lg font-semibold", over ? "text-danger" : "text-ink")}>{over ? "−" : ""}{cad(Math.abs(safe.safe_cents))}</span>
          </li>
        </ul>
        <p className="mt-2 px-1 text-xs text-ink-subtle">Your budget is the plan, so account balances don’t change this number. Calculated by Penny’s tested rules, never by AI. A paid bill is part of what’s spent, so it’s never counted twice.</p>
      </section>

      {unpaid.length > 0 && (
        <section aria-labelledby="safe-bills" className="mt-6">
          <h3 id="safe-bills" className="mb-2 px-1 text-base font-semibold text-ink">Bills set aside</h3>
          <ul className={cn(CARD, "divide-y divide-line")}>
            {unpaid.map((bill) => (
              <li key={`${bill.bill_id}:${bill.due_on}`} className="flex min-h-14 items-center justify-between gap-3 px-4 py-3">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-ink">{bill.name}</span>
                  <span className={cn("block text-xs", bill.days_until_due < 0 ? "font-semibold text-danger" : "text-ink-subtle")}>
                    {bill.days_until_due < 0 ? `Overdue since ${formatShortDate(bill.due_on)}` : bill.days_until_due === 0 ? "Due today" : `Due ${formatShortDate(bill.due_on)}`}
                  </span>
                </span>
                <span className="tabular shrink-0 font-semibold text-ink">{cad(bill.amount_cents)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mt-6"><SafeToSpendRead version={version} onAsk={onAsk} /></div>

      <ul className={cn(CARD, "mt-6 divide-y divide-line")}>
        {links.map((link) => (
          <li key={link.label}>
            <button type="button" onClick={() => onNavigate(link.view, link.anchor)} className="flex min-h-14 w-full items-center justify-between gap-3 px-4 text-left font-semibold text-ink hover:bg-sage-soft">
              {link.label}<ChevronRight className="size-4 shrink-0 text-ink-subtle" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
