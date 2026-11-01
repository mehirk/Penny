"use client";

import { createElement } from "react";
import { ChevronRight } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import type { Dashboard } from "@/lib/api";
import { cn } from "@/lib/utils";
import { BackBar } from "./back-bar";
import { categoryIcon } from "./category-icons";
import { categoryColours } from "./charts";
import { BigAmount, cad, type View } from "./shared";

const CARD = "overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-card)]";
const percent = (basisPoints: number) => `${Math.abs(basisPoints / 100).toFixed(1).replace(/\.0$/, "")}%`;

/** "Spent this month" on its own page: the total, where it went, and the budget left. All figures from the API. */
export function SpentDetail({ dashboard, onBack, onNavigate }: { dashboard: Dashboard; onBack: () => void; onNavigate: (view: View, anchor?: string) => void }) {
  const { totals, period } = dashboard;
  const change = dashboard.home.spending_change_basis_points;
  const items = dashboard.category_spending;
  const colourFor = categoryColours(dashboard.categories);
  const byId = new Map(dashboard.categories.map((category) => [category.id, category]));
  const over = totals.budget_remaining_cents < 0;
  const used = totals.total_budget_cents ? Math.min(100, (totals.spending_cents * 100) / totals.total_budget_cents) : 0;
  const links: { label: string; view: View; anchor: string }[] = [
    { label: "Budgets", view: "spending", anchor: "budgets" },
    { label: "All transactions", view: "spending", anchor: "transactions" },
    { label: "Trends over time", view: "spending", anchor: "trends" },
  ];
  return (
    <div className="mx-auto max-w-2xl">
      <BackBar label="Home" onBack={onBack} />

      <section aria-labelledby="spent-title" className="pb-2 pt-4 text-center">
        <h2 id="spent-title" className="text-base font-semibold text-ink-muted">Spent {period.phrase}</h2>
        <p className="mt-2 text-5xl font-semibold leading-none tracking-tight text-ink"><BigAmount cents={totals.spending_cents} /></p>
        {change !== null && <p className="mt-3 text-sm text-ink-muted"><span className="font-semibold text-ink">{percent(change)} {change <= 0 ? "less" : "more"}</span> than {period.phrase === "this month" ? "last month at this point" : "the period before"}</p>}
        {totals.total_budget_cents > 0 && (
          <div className="mx-auto mt-5 max-w-60">
            <Progress value={used} className="h-1.5" indicatorClassName={over ? "bg-danger" : "bg-ink-subtle"} aria-label={`${Math.round(used)}% of the budget used`} />
            <p className="mt-2 text-xs text-ink-subtle"><span className={cn("tabular font-semibold", over ? "text-danger" : "text-ink")}>{cad(Math.abs(totals.budget_remaining_cents))}</span> {over ? "over" : "left"} of a <span className="tabular">{cad(totals.total_budget_cents)}</span> budget</p>
          </div>
        )}
      </section>

      <section aria-labelledby="spent-where" className="mt-6">
        <h3 id="spent-where" className="mb-2 px-1 text-base font-semibold text-ink">Where it went</h3>
        {items.length === 0 ? <p className={cn(CARD, "p-4 text-sm text-ink-subtle")}>No spending recorded {period.phrase} yet.</p> : (
          <>
            <div className="mb-3 flex h-2.5 overflow-hidden rounded-full" role="img" aria-label={items.map((item) => `${item.category_name} ${Math.round(item.share_basis_points / 100)}%`).join(", ")}>
              {items.map((item) => <span key={item.category_id ?? "none"} style={{ width: `${item.share_basis_points / 100}%`, background: colourFor(item.category_id) }} className="border-r-2 border-canvas last:border-r-0" />)}
            </div>
            <ul className="space-y-2.5">
              {items.map((item) => (
                <li key={item.category_id ?? "none"} className={cn(CARD, "flex min-h-16 items-center gap-3 px-4 py-3")}>
                  <span className="grid size-10 shrink-0 place-items-center rounded-full" style={{ background: `color-mix(in srgb, ${colourFor(item.category_id)} 20%, transparent)`, color: colourFor(item.category_id) }} aria-hidden="true">
                    {createElement(categoryIcon(item.category_id ? byId.get(item.category_id) : undefined), { className: "size-4" })}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-ink">{item.category_name}</span>
                    <span className="block text-xs text-ink-subtle">{Math.round(item.share_basis_points / 100)}% of your spending</span>
                  </span>
                  <span className="tabular shrink-0 font-semibold text-ink">{cad(item.spent_cents)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <ul className={cn(CARD, "mt-6 divide-y divide-line")}>
        {links.map((link) => (
          <li key={link.label}>
            <button type="button" onClick={() => onNavigate(link.view, link.anchor)} className="flex min-h-14 w-full items-center justify-between gap-3 px-4 text-left font-semibold text-ink hover:bg-sage-soft">
              {link.label}<ChevronRight className="size-4 text-ink-subtle" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
