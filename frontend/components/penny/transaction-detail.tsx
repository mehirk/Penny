"use client";

import { createElement, useEffect } from "react";
import { Pencil, Repeat, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Dashboard, Transaction } from "@/lib/api";
import { cn } from "@/lib/utils";
import { BackBar } from "./back-bar";
import { categoryIcon } from "./category-icons";
import { BigAmount } from "./shared";

const CARD = "overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-card)]";
const LONG_DATE = new Intl.DateTimeFormat("en-CA", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

/** One transaction on its own page, like a bank app's activity detail: amount, facts, Edit and Delete. */
export function TransactionDetail({ dashboard, id, backLabel, onBack, onEdit, onDelete }: { dashboard: Dashboard; id: string; backLabel: string; onBack: () => void; onEdit: (item: Transaction) => void; onDelete: (item: Transaction) => void }) {
  const item = dashboard.transactions.find((transaction) => transaction.id === id);
  // Deleted (or moved out of the period on screen): go back to the list.
  useEffect(() => { if (!item) onBack(); }, [item, onBack]);
  if (!item) return null;

  const income = item.kind === "income";
  const category = item.category_id ? dashboard.categories.find((entry) => entry.id === item.category_id) : undefined;
  const account = dashboard.accounts.find((entry) => entry.id === item.account_id);
  const bill = item.bill_id ? dashboard.bills.find((entry) => entry.id === item.bill_id) : undefined;
  const facts: { label: string; value: string }[] = [
    { label: "Date", value: LONG_DATE.format(new Date(`${item.occurred_on}T00:00:00Z`)) },
    { label: "Type", value: income ? "Money in" : "Money out" },
    { label: "Account", value: account?.name ?? "Unknown account" },
    { label: "Category", value: item.category || "Uncategorized" },
  ];
  if (item.necessity) facts.push({ label: "Need or want", value: item.necessity === "need" ? "Need" : "Want" });
  if (item.bill_id) facts.push({ label: "Recurring", value: `${bill?.name ?? "A recurring bill"} · ${item.paid_automatically === true ? "paid automatically" : item.paid_automatically === false ? "you marked it paid" : "recurring payment"}` });

  return (
    <div className="mx-auto max-w-2xl">
      <BackBar label={backLabel} onBack={onBack} />

      <section aria-labelledby="tx-title" className="pb-2 pt-4 text-center">
        <span className={cn("mx-auto grid size-14 place-items-center rounded-2xl", income ? "bg-money-in-soft text-money-in" : "bg-sage text-ink-muted")} aria-hidden="true">
          {createElement(categoryIcon(category, item.kind), { className: "size-6" })}
        </span>
        <h2 id="tx-title" className="mt-3 text-lg font-semibold text-ink">{item.description}</h2>
        <p className={cn("mt-2 text-5xl font-semibold leading-none tracking-tight", income ? "text-money-in" : "text-ink")}>
          {income ? "+" : ""}<BigAmount cents={item.amount_cents} negative={!income} />
        </p>
        <div className="mt-3 flex flex-wrap justify-center gap-1.5">
          {item.bill_id && <span className="inline-flex items-center gap-1 rounded-full bg-[#f2ecff] px-2 py-0.5 text-xs font-semibold text-[#7047b7] dark:bg-[#302847] dark:text-[#c1a5ee]"><Repeat className="size-3" aria-hidden="true" />Recurring</span>}
          {item.unusual && <span className="rounded-full bg-danger-soft px-2 py-0.5 text-xs font-semibold text-danger">Unusual for this category</span>}
          {item.auto_categorized && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent-strong">Category picked automatically</span>}
        </div>
      </section>

      <dl className={cn(CARD, "mt-6 divide-y divide-line")}>
        {facts.map((fact) => (
          <div key={fact.label} className="flex min-h-14 items-center justify-between gap-4 px-4 py-3">
            <dt className="text-sm text-ink-subtle">{fact.label}</dt>
            <dd className="min-w-0 text-right text-sm font-semibold text-ink">{fact.value}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-6 grid grid-cols-2 gap-3">
        <Button variant="outline" className="min-h-12" onClick={() => onEdit(item)}><Pencil className="size-4" aria-hidden="true" />Edit</Button>
        <Button variant="destructive-soft" className="min-h-12" onClick={() => onDelete(item)}><Trash2 className="size-4" aria-hidden="true" />Delete</Button>
      </div>
    </div>
  );
}
