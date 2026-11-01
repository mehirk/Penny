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
 * Safe to spend on its own page: every step of the sum (spending money, then what's held back),
 * the unpaid bills behind it with their dates, and Penny's read. All figures come from the API.
 */
export function SafeDetail({ dashboard, onBack, onNavigate, onAsk }: { dashboard: Dashboard; onBack: () => void; onNavigate: (view: View, anchor?: string) => void; onAsk: (question: string) => void }) {
  const safe = dashboard.safe_to_spend;
  const runway = dashboard.spending_runway;
  const unpaid = dashboard.recurring.unpaid;
  if (!safe) {
    return (
      <div className="mx-auto max-w-2xl">
        <BackBar label="Home" onBack={onBack} />
        <p className={cn(CARD, "mt-4 p-4 text-sm text-ink-subtle")}>Safe to spend isn’t available for this period.</p>
      </div>
    );
  }
  const steps: { label: string; detail?: string; cents: number; sign: "+" | "−" }[] = [
    { label: "Spending money", detail: safe.spending_from === "chequing" ? "Chequing and cash" : "Chequing, cash, and savings", cents: safe.spending_money_cents, sign: "+" },
    { label: "Set aside for goals", cents: safe.set_aside_cents, sign: "−" },
    { label: "Owed on credit cards", detail: "Card purchases are money already spent", cents: safe.owed_on_cards_cents, sign: "−" },
    { label: "Unpaid bills", detail: `Due by ${formatShortDate(safe.holds_until)}, overdue ones included`, cents: safe.unpaid_bills_cents, sign: "−" },
    { label: "Spent from other accounts", detail: "This month, outside your spending money", cents: safe.spent_outside_cents, sign: "−" },
  ];
  const shown = steps.filter((step, index) => index === 0 || step.cents > 0);
  // The version changes whenever any step does, so Penny's read is refetched only when it would differ.
  const version = [safe.safe_cents, safe.spending_money_cents, safe.unpaid_bills_cents, safe.owed_on_cards_cents, safe.set_aside_cents, safe.spent_outside_cents, dashboard.budgets.length].join(":");
  const links: { label: string; view: View; anchor?: string }[] = [
    { label: "Which accounts count as spending money", view: "settings", anchor: "accounts" },
    { label: "Recurring bills", view: "recurring" },
    { label: "Budgets", view: "spending", anchor: "budgets" },
  ];

  return (
    <div className="mx-auto max-w-2xl">
      <BackBar label="Home" onBack={onBack} />

      <section aria-labelledby="safe-detail-title" className="pb-2 pt-4 text-center">
        <h2 id="safe-detail-title" className="text-base font-semibold text-ink-muted">Safe to spend</h2>
        <p className="mt-2 text-5xl font-semibold leading-none tracking-tight text-ink"><BigAmount cents={safe.safe_cents} /></p>
        {runway && safe.safe_cents > 0 && <p className="mt-3 text-sm text-ink-muted">About <span className="tabular font-semibold text-ink">{cad(runway.per_day_cents)}</span> a day for {runway.days_left} day{runway.days_left === 1 ? "" : "s"}</p>}
        {safe.short_cents > 0 && <p role="status" className="mx-auto mt-3 max-w-sm rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">What’s spoken for is <span className="tabular font-semibold">{cad(safe.short_cents)}</span> more than your spending money.</p>}
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
          <li className="flex min-h-14 items-center justify-between gap-3 bg-sage-soft/60 px-4 py-3">
            <span className="text-sm font-semibold text-ink">Safe to spend</span>
            <span className="tabular shrink-0 text-lg font-semibold text-ink">{cad(safe.safe_cents)}</span>
          </li>
        </ul>
        <p className="mt-2 px-1 text-xs text-ink-subtle">Calculated by Penny’s tested rules, never by AI. Paid bills have already left your balance, so they aren’t taken out twice.</p>
      </section>

      {unpaid.length > 0 && (
        <section aria-labelledby="safe-bills" className="mt-6">
          <h3 id="safe-bills" className="mb-2 px-1 text-base font-semibold text-ink">Bills held back</h3>
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
