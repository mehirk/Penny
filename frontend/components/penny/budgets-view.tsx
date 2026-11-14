"use client";

import { Check, ChevronRight, Plus, Repeat } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import type { BudgetPlan, Dashboard } from "@/lib/api";
import { formatShortDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { cad, type View } from "./shared";
import { type BudgetActions, Budgets } from "./spending-view";
import { budgetCheer, PennyBanner } from "./penny-banner";

const CARD = "rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-card)]";

/**
 * Budgets: the month's plan, which Safe to spend and everything else is measured against. The
 * budget is recurring bills (fixed, in the recurring blue) plus the category budgets the user sets (variable).
 * A summary of the whole budget on top, then the recurring bills, then each category's limit
 * (with suggestions and fixes when one goes over). All figures come from the API.
 */
export function BudgetsView({
  dashboard,
  onNavigate,
  ...actions
}: BudgetActions & { dashboard: Dashboard; onNavigate: (view: View, anchor?: string) => void }) {
  const { totals, period } = dashboard;
  const plan = dashboard.budget_plan;
  const safe = dashboard.safe_to_spend;
  const budget = totals.total_budget_cents;
  const left = totals.budget_remaining_cents;
  const over = left < 0;
  const used = budget ? Math.min(100, (totals.spending_cents * 100) / budget) : 0;
  const safeOver = (safe?.safe_cents ?? 0) < 0;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PennyBanner tone="mint" {...budgetCheer(dashboard, budget)} />
      {budget > 0 && (
        <section aria-labelledby="budget-summary" className={cn(CARD, "p-5 sm:p-6")}>
          <h2 id="budget-summary" className="sr-only">
            Budget {period.phrase}
          </h2>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-ink-muted">
                {over ? "Over budget" : "Left to spend"} {period.phrase}
              </p>
              <p
                className={cn("tabular mt-1 text-4xl font-semibold tracking-tight", over ? "text-danger" : "text-ink")}
              >
                {over ? "−" : ""}
                {cad(Math.abs(left))}
              </p>
            </div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
              <dt className="text-ink-subtle">Budget</dt>
              <dd className="tabular text-right font-semibold text-ink">{cad(budget)}</dd>
              <dt className="text-ink-subtle">Spent</dt>
              <dd className="tabular text-right font-semibold text-ink">{cad(totals.spending_cents)}</dd>
            </dl>
          </div>
          <Progress
            className="mt-4 h-2"
            value={used}
            indicatorClassName={over ? "bg-danger" : used >= 90 ? "bg-gold" : "bg-joy"}
            aria-label={`${Math.round(used)}% of the budget used ${period.phrase}`}
          />
          {plan && plan.fixed_cents > 0 && <BudgetMakeup plan={plan} />}
          {safe && safe.has_budget && (
            <button
              type="button"
              onClick={() => onNavigate("today", "safe")}
              className="mt-4 flex min-h-12 w-full items-center justify-between gap-3 rounded-xl bg-sage-soft px-4 text-left text-sm hover:bg-sage"
            >
              <span className="text-ink-muted">Safe to spend on everything else</span>
              <span
                className={cn(
                  "tabular inline-flex items-center gap-1 font-semibold",
                  safeOver ? "text-danger" : "text-ink",
                )}
              >
                {safeOver ? "−" : ""}
                {cad(Math.abs(safe.safe_cents))}
                <ChevronRight className="size-4 text-ink-subtle" aria-hidden="true" />
              </span>
            </button>
          )}
        </section>
      )}
      {plan && (
        <RecurringBudget
          plan={plan}
          today={dashboard.money_calendar.today}
          phrase={period.phrase}
          onNavigate={onNavigate}
        />
      )}
      <Budgets dashboard={dashboard} {...actions} />
    </div>
  );
}

/** How the budget splits: recurring bills (blue) and category budgets, as one bar with a legend. */
function BudgetMakeup({ plan }: { plan: BudgetPlan }) {
  const fixedShare = plan.total_cents ? (plan.fixed_cents * 100) / plan.total_cents : 0;
  return (
    <div className="mt-4">
      <div className="flex h-2 gap-0.5 overflow-hidden rounded-full" aria-hidden="true">
        <span className="rounded-full bg-recurring" style={{ width: `${fixedShare}%` }} />
        {plan.variable_cents > 0 && <span className="flex-1 rounded-full bg-primary/70" />}
      </div>
      <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs">
        <div className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-recurring" aria-hidden="true" />
          <dt className="text-ink-muted">Recurring bills</dt>
          <dd className="tabular font-semibold text-ink">{cad(plan.fixed_cents)}</dd>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-primary/70" aria-hidden="true" />
          <dt className="text-ink-muted">Categories</dt>
          <dd className="tabular font-semibold text-ink">{cad(plan.variable_cents)}</dd>
        </div>
      </dl>
    </div>
  );
}

/** The fixed part of the budget: every recurring bill due in the period, paid or still to pay. */
function RecurringBudget({
  plan,
  today,
  phrase,
  onNavigate,
}: {
  plan: BudgetPlan;
  today: string | null;
  phrase: string;
  onNavigate: (view: View, anchor?: string) => void;
}) {
  return (
    <section aria-labelledby="recurring-budget" className={cn(CARD, "p-5 sm:p-6")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="recurring-budget" className="flex items-center gap-2 text-lg font-semibold tracking-tight text-ink">
            <span className="grid size-7 place-items-center rounded-full bg-recurring-soft text-recurring">
              <Repeat className="size-3.5" aria-hidden="true" />
            </span>
            Recurring expenses
          </h2>
          <p className="mt-0.5 text-sm text-ink-muted">Fixed bills, part of your budget {phrase}.</p>
        </div>
        {plan.fixed.length > 0 && (
          <div className="text-right">
            <p className="tabular text-lg font-semibold text-ink">{cad(plan.fixed_cents)}</p>
            <p className="tabular text-xs text-ink-subtle">{cad(plan.fixed_paid_cents)} paid</p>
          </div>
        )}
      </div>
      {plan.fixed.length === 0 ? (
        <button
          type="button"
          onClick={() => onNavigate("recurring")}
          className="mt-4 flex min-h-12 w-full items-center gap-2 rounded-xl bg-recurring-soft px-4 text-left text-sm font-semibold text-ink hover:brightness-95"
        >
          <Plus className="size-4 text-recurring" aria-hidden="true" />
          Add rent, a phone plan, or other bills
          <ChevronRight className="ml-auto size-4 text-ink-subtle" aria-hidden="true" />
        </button>
      ) : (
        <ul className="mt-5 grid gap-x-8 gap-y-5 md:grid-cols-2">
          {plan.fixed.map((line) => {
            const paid = line.due_cents === 0;
            const overdue = !paid && !!line.next_due_on && !!today && line.next_due_on < today;
            const share = line.amount_cents ? (line.paid_cents * 100) / line.amount_cents : 0;
            return (
              <li key={line.bill_id}>
                <div className="flex items-center justify-between gap-3">
                  <span className="min-w-0">
                    <span className="flex items-center gap-2 truncate text-sm font-semibold text-ink">
                      <span className="size-2.5 shrink-0 rounded-full bg-recurring" aria-hidden="true" />
                      {line.name}
                    </span>
                    <span
                      className={cn(
                        "flex items-center gap-1 pl-[1.125rem] text-xs",
                        paid ? "text-money-in" : overdue ? "font-semibold text-danger" : "text-ink-subtle",
                      )}
                    >
                      {paid ? (
                        <>
                          <Check className="size-3" aria-hidden="true" />
                          Paid
                        </>
                      ) : overdue ? (
                        `Overdue since ${formatShortDate(line.next_due_on!)}`
                      ) : line.next_due_on ? (
                        `Due ${formatShortDate(line.next_due_on)}`
                      ) : (
                        "Due"
                      )}
                      {line.kind === "subscription" && <span className="text-ink-subtle"> · subscription</span>}
                    </span>
                  </span>
                  <span className="tabular shrink-0 text-sm font-semibold text-ink">{cad(line.amount_cents)}</span>
                </div>
                <Progress
                  className="mt-1.5"
                  value={share}
                  indicatorClassName="bg-recurring"
                  aria-label={`${line.name}: ${cad(line.paid_cents)} of ${cad(line.amount_cents)} paid`}
                />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
