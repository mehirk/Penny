"use client";

import { ChevronRight } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import type { Dashboard } from "@/lib/api";
import { cn } from "@/lib/utils";
import { cad, type View } from "./shared";
import { type BudgetActions, Budgets } from "./spending-view";

const CARD = "rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-card)]";

/**
 * Budgets: the month's plan, which Safe to spend and everything else is measured against. A
 * summary of the whole budget on top, then each category's limit (with suggestions and fixes
 * when one goes over). All figures come from the API.
 */
export function BudgetsView({ dashboard, onNavigate, ...actions }: BudgetActions & { dashboard: Dashboard; onNavigate: (view: View, anchor?: string) => void }) {
  const { totals, period } = dashboard;
  const safe = dashboard.safe_to_spend;
  const budget = totals.total_budget_cents;
  const left = totals.budget_remaining_cents;
  const over = left < 0;
  const used = budget ? Math.min(100, (totals.spending_cents * 100) / budget) : 0;
  const safeOver = (safe?.safe_cents ?? 0) < 0;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {budget > 0 && (
        <section aria-labelledby="budget-summary" className={cn(CARD, "p-5 sm:p-6")}>
          <h2 id="budget-summary" className="sr-only">Budget {period.phrase}</h2>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-ink-muted">{over ? "Over budget" : "Left to spend"} {period.phrase}</p>
              <p className={cn("tabular mt-1 text-4xl font-semibold tracking-tight", over ? "text-danger" : "text-ink")}>{over ? "−" : ""}{cad(Math.abs(left))}</p>
            </div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
              <dt className="text-ink-subtle">Budget</dt><dd className="tabular text-right font-semibold text-ink">{cad(budget)}</dd>
              <dt className="text-ink-subtle">Spent</dt><dd className="tabular text-right font-semibold text-ink">{cad(totals.spending_cents)}</dd>
            </dl>
          </div>
          <Progress className="mt-4 h-2" value={used} indicatorClassName={over ? "bg-danger" : used >= 90 ? "bg-gold" : "bg-accent"} aria-label={`${Math.round(used)}% of the budget used ${period.phrase}`} />
          {safe && safe.has_budget && (
            <button type="button" onClick={() => onNavigate("today", "safe")} className="mt-4 flex min-h-12 w-full items-center justify-between gap-3 rounded-xl bg-sage-soft px-4 text-left text-sm hover:bg-sage">
              <span className="text-ink-muted">Safe to spend, after {cad(safe.unpaid_bills_cents)} in bills still due</span>
              <span className={cn("tabular inline-flex items-center gap-1 font-semibold", safeOver ? "text-danger" : "text-ink")}>{safeOver ? "−" : ""}{cad(Math.abs(safe.safe_cents))}<ChevronRight className="size-4 text-ink-subtle" aria-hidden="true" /></span>
            </button>
          )}
        </section>
      )}
      <Budgets dashboard={dashboard} {...actions} />
    </div>
  );
}
