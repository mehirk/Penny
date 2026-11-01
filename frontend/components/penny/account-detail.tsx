"use client";

import { createElement } from "react";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import type { AccountBalance, Dashboard } from "@/lib/api";
import { formatShortDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { BackBar } from "./back-bar";
import { categoryIcon } from "./category-icons";
import { ACCOUNT_TYPE_LABELS } from "./dialogs";
import { accountEmoji } from "./emoji";
import { BigAmount, cad } from "./shared";

const GROUP = "overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface";

/**
 * One account on its own page (opened from Home or Accounts): its balance, what's set aside in
 * it, money in and out this period, and its recent transactions. Every figure is from the API.
 */
export function AccountDetail({ dashboard, account, backLabel, onBack }: { dashboard: Dashboard; account: AccountBalance; backLabel: string; onBack: () => void }) {
  const credit = account.account_type === "credit";
  const owed = credit && account.balance_cents > 0;
  const used = account.utilization_basis_points;
  const categories = new Map(dashboard.categories.map((category) => [category.id, category]));
  const rows = dashboard.transactions.filter((item) => item.account_id === account.id).slice(0, 20);
  const { phrase } = dashboard.period;
  return (
    <div className="mx-auto max-w-2xl">
      <BackBar label={backLabel} onBack={onBack} />

      <section aria-labelledby="account-title" className="pb-2 pt-4 text-center">
        <span className="mx-auto grid size-14 place-items-center rounded-full bg-sage text-3xl" aria-hidden="true">{accountEmoji(account.name, account.account_type)}</span>
        <h2 id="account-title" className="mt-3 text-lg font-semibold text-ink">{account.name}</h2>
        <p className="text-sm text-ink-subtle">{ACCOUNT_TYPE_LABELS[account.account_type]}</p>
        <p className={cn("mt-4 text-5xl font-semibold leading-none tracking-tight", owed ? "text-danger" : "text-ink")}><BigAmount cents={Math.abs(account.balance_cents)} negative={owed || account.balance_cents < 0} /></p>
        <p className="mt-2 text-sm text-ink-muted">{credit ? "Owed on this card" : "Balance today"}</p>
      </section>

      {credit && account.credit_limit_cents !== null && used !== null && (
        <div className="mx-auto mt-3 max-w-xs">
          <Progress className="h-1.5" value={Math.min(100, used / 100)} indicatorClassName={used > 3000 ? "bg-danger" : "bg-ink-subtle"} aria-label={`${(used / 100).toFixed(0)}% of the limit used`} />
          <p className="mt-2 text-center text-xs text-ink-subtle"><span className="tabular">{(used / 100).toFixed(1)}%</span> of <span className="tabular">{cad(account.credit_limit_cents)}</span> used · <span className="tabular">{cad(account.available_credit_cents ?? 0)}</span> available</p>
        </div>
      )}

      <div className="mt-6 space-y-6">
        <ul className={cn(GROUP, "divide-y divide-line")} aria-label={`Money in and out ${phrase}`}>
          <li className="flex min-h-14 items-center gap-3 px-4"><ArrowDownLeft className="size-4 text-money-in" aria-hidden="true" /><span className="flex-1 text-sm text-ink">Money in {phrase}</span><span className="tabular font-semibold text-ink">{cad(account.money_in_cents)}</span></li>
          <li className="flex min-h-14 items-center gap-3 px-4"><ArrowUpRight className="size-4 text-ink-subtle" aria-hidden="true" /><span className="flex-1 text-sm text-ink">Money out {phrase}</span><span className="tabular font-semibold text-ink">{cad(account.money_out_cents)}</span></li>
        </ul>

        {account.goals.length > 0 && (
          <section aria-labelledby="account-goals">
            <h3 id="account-goals" className="mb-1 px-1 text-base font-semibold text-ink">Set aside for goals</h3>
            <ul className={cn(GROUP, "divide-y divide-line")}>
              {account.goals.map((goal) => <li key={goal.id} className="flex min-h-14 items-center justify-between gap-3 px-4"><span className="min-w-0 truncate text-sm text-ink">{goal.name}</span><span className="tabular shrink-0 font-semibold text-ink">{cad(goal.current_cents)}</span></li>)}
              <li className="flex min-h-14 items-center justify-between gap-3 px-4"><span className="text-sm font-semibold text-ink">Free to use</span><span className="tabular font-semibold text-ink">{cad(account.free_cents ?? 0)}</span></li>
            </ul>
          </section>
        )}

        <section aria-labelledby="account-activity">
          <h3 id="account-activity" className="mb-1 px-1 text-base font-semibold text-ink">Activity {phrase}</h3>
          {rows.length === 0 ? <p className={cn(GROUP, "p-4 text-sm text-ink-subtle")}>No transactions in this account {phrase}.</p> : (
            <ul className={cn(GROUP, "divide-y divide-line")}>
              {rows.map((item) => {
                const income = item.kind === "income";
                return (
                  <li key={item.id} className="flex min-h-14 items-center gap-3 px-4 py-2">
                    <span className={cn("grid size-9 shrink-0 place-items-center rounded-full", income ? "bg-money-in-soft text-money-in" : "bg-sage text-ink-muted")} aria-hidden="true">
                      {createElement(categoryIcon(item.category_id ? categories.get(item.category_id) : undefined, item.kind), { className: "size-4" })}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-ink">{item.description}</span>
                      <span className="block truncate text-xs text-ink-subtle">{item.category} · {formatShortDate(item.occurred_on)}</span>
                    </span>
                    <span className={cn("tabular shrink-0 text-sm font-semibold", income ? "text-money-in" : "text-ink")}>{income ? cad(item.amount_cents, true) : cad(-item.amount_cents)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        <p className="px-1 text-xs text-ink-subtle">{dashboard.profile.is_fictional ? "Fictional account. " : ""}No bank is connected; this balance changes only when you record money in or out.</p>
      </div>
    </div>
  );
}
