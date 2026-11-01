"use client";

import { useId, useState } from "react";
import { ArrowRightLeft, CalendarDays, Check, ChevronDown, CircleCheck, Landmark, MessageCircle, Pencil, PiggyBank, Plus, Sparkles, Target } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { Dashboard, SavingsGoal } from "@/lib/api";
import { formatLongDate, formatShortDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { cad, EmptyState } from "./shared";
import { GoalPlan } from "./smart-cards";
import { FinancialHealthRow } from "./today-view";

type Props = {
  dashboard: Dashboard;
  onAdd: () => void;
  onEdit: (goal: SavingsGoal) => void;
  onAddMoney: (goal: SavingsGoal) => void;
  onComplete: (goal: SavingsGoal) => void;
  onAsk: (question: string) => void;
};

const MILESTONES = [25, 50, 75];

export function GoalsView({ dashboard, onAdd, onEdit, onAddMoney, onComplete, onAsk }: Props) {
  const goals = dashboard.savings_goals;
  const active = goals.filter((goal) => goal.status === "active");
  const saved = goals.reduce((total, goal) => total + goal.current_cents, 0);
  const neededThisMonth = active.reduce((total, goal) => total + (goal.monthly_needed_cents ?? 0), 0);
  const putAside = active.reduce((total, goal) => total + goal.contributed_this_month_cents, 0);
  const accounts = new Map(dashboard.accounts.map((account) => [account.id, account.name]));
  const share = neededThisMonth ? Math.min(100, (putAside * 100) / neededThisMonth) : 0;

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="sm:hidden"><FinancialHealthRow dashboard={dashboard} /></div>
      <section className="grid gap-4 rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-[var(--shadow-card)] sm:p-6 md:grid-cols-[1fr_1.4fr_auto] md:items-center">
        <div>
          <p className="text-sm text-ink-subtle">Saved across {goals.length} goal{goals.length === 1 ? "" : "s"}</p>
          <p className="tabular mt-1 text-3xl font-semibold tracking-tight text-ink">{cad(saved)}</p>
        </div>
        {neededThisMonth > 0 ? (
          <div className="rounded-2xl bg-sage-soft p-4">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-sm font-semibold text-ink">This month’s plan</p>
              <p className="tabular text-sm text-ink-muted"><span className="font-semibold text-ink">{cad(putAside)}</span> of {cad(neededThisMonth)}</p>
            </div>
            <Progress className="mt-2 h-2.5" value={share} indicatorClassName={share >= 100 ? "bg-zone-green" : "bg-accent"} aria-label={`${Math.round(share)}% of this month’s goal saving done`} />
            <p className="mt-2 text-xs text-ink-muted">{share >= 100 ? "You’ve set aside everything your goals need this month." : `Set aside ${cad(neededThisMonth - putAside)} more this month to keep every goal on schedule.`}</p>
          </div>
        ) : <div />}
        <Button onClick={onAdd}><Plus className="size-4" aria-hidden="true" />New goal</Button>
      </section>

      {goals.length === 0 ? (
        <Card className="p-5"><EmptyState icon={Target} title="No goals yet" description="Pick something you’re saving for and Penny will show what it takes each month." action={<Button size="sm" onClick={onAdd}>Create a goal</Button>} /></Card>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {goals.map((goal) => <GoalCard key={goal.id} goal={goal} accounts={accounts} onEdit={onEdit} onAddMoney={onAddMoney} onComplete={onComplete} onAsk={onAsk} />)}
        </ul>
      )}
      <p className="flex gap-2 px-1 text-xs leading-relaxed text-ink-subtle"><ArrowRightLeft className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />Adding money moves it from the account you choose into the account the goal is kept in. Your total cash stays the same, but it no longer counts as available to spend.</p>
    </div>
  );
}

function GoalCard({ goal, accounts, onEdit, onAddMoney, onComplete, onAsk }: { goal: SavingsGoal; accounts: Map<string, string> } & Omit<Props, "dashboard" | "onAdd">) {
  const percent = Math.floor(goal.progress_basis_points / 100);
  const done = goal.status === "completed";
  const needed = goal.monthly_needed_cents;
  const leftThisMonth = needed === null ? null : Math.max(0, needed - goal.contributed_this_month_cents);
  const [planning, setPlanning] = useState(false);
  // Phones show progress and the next step; dates, history and the other actions open on tap.
  const [open, setOpen] = useState(false);
  const extra = open ? "" : "max-sm:hidden";
  const detailsId = useId();
  return (
    <li>
      <Card className={cn("flex h-full flex-col p-4 sm:p-6", done && "border-accent/40")}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold text-ink">{goal.name}</h2>
            <p id={detailsId} className={cn("mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-ink-subtle", extra)}>
              <span className="inline-flex items-center gap-1.5"><CalendarDays className="size-3.5" aria-hidden="true" />{goal.target_date ? `By ${formatLongDate(goal.target_date)}` : "No target date"}</span>
              {goal.account_id && <span className="inline-flex items-center gap-1.5"><Landmark className="size-3.5" aria-hidden="true" />{accounts.get(goal.account_id) ?? "Account"}</span>}
            </p>
          </div>
          <Badge tone={done ? "accent" : goal.status === "paused" ? "neutral" : "info"}>{done ? "Reached" : goal.status === "paused" ? "Paused" : `${percent}%`}</Badge>
        </div>

        <div className="relative mt-4 sm:mt-5">
          <Progress className="h-3" value={percent} indicatorClassName="bg-accent" aria-label={`${goal.name}: ${percent}% saved`} />
          {MILESTONES.map((mark) => <span key={mark} className={cn("absolute top-0 h-3 w-0.5", percent >= mark ? "bg-surface/70" : "bg-line-strong")} style={{ left: `${mark}%` }} aria-hidden="true" />)}
        </div>
        <div className="mt-2 flex justify-between text-sm"><span className="tabular font-semibold text-ink">{cad(goal.current_cents)}</span><span className="tabular text-ink-subtle">of {cad(goal.target_cents)}</span></div>

        {!done && needed !== null && leftThisMonth !== null && (
          <p className={cn("mt-4 flex items-start gap-2 rounded-xl p-3 text-sm", leftThisMonth === 0 ? "bg-zone-green-soft text-ink" : "bg-accent-soft text-ink-muted")}>
            {leftThisMonth === 0
              ? <><CircleCheck className="mt-0.5 size-4 shrink-0 text-money-in" aria-hidden="true" /><span>On track this month: you’ve added <span className="tabular font-semibold text-ink">{cad(goal.contributed_this_month_cents)}</span>.</span></>
              : <span>Add <span className="tabular font-semibold text-ink">{cad(leftThisMonth)}</span> more this month to stay on schedule ({cad(needed)} a month).</span>}
          </p>
        )}

        {planning && !done && <GoalPlan goalId={goal.id} version={goal.current_cents} />}
        {planning && !done && <Button size="sm" variant="ghost" className="mt-1 -ml-2 self-start" onClick={() => onAsk(`How can I reach my ${goal.name} goal sooner?`)}><MessageCircle className="size-4" aria-hidden="true" />Talk it through with Penny AI</Button>}

        {goal.recent_contributions.length > 0 && (
          <div className={cn("mt-4", extra)}>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-subtle">Recent contributions</h3>
            <ul className="mt-1.5 divide-y divide-line text-sm">
              {goal.recent_contributions.slice(0, 3).map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-3 py-1.5">
                  <span className="min-w-0 truncate text-ink-muted">{formatShortDate(item.occurred_on)} · from {accounts.get(item.from_account_id) ?? "an account"}{item.source === "penny" ? " · via Penny" : ""}</span>
                  <span className="tabular shrink-0 font-semibold text-money-in">+{cad(item.amount_cents)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-auto flex flex-wrap gap-2 pt-4">
          <Button size="sm" onClick={() => onAddMoney(goal)} disabled={done}><PiggyBank className="size-4" aria-hidden="true" />Add money</Button>
          <Button size="sm" variant="outline" className={extra} onClick={() => onEdit(goal)}><Pencil className="size-4" aria-hidden="true" />Edit</Button>
          {!done && <Button size="sm" variant="ghost" className={extra} aria-expanded={planning} onClick={() => setPlanning((value) => !value)}><Sparkles className="size-4" aria-hidden="true" />{planning ? "Hide plan" : "Plan with Penny"}</Button>}
          {!done && goal.current_cents >= goal.target_cents && <Button size="sm" variant="ghost" onClick={() => onComplete(goal)}><Check className="size-4" aria-hidden="true" />Mark reached</Button>}
          <Button size="sm" variant="ghost" className="ml-auto sm:hidden" aria-expanded={open} aria-controls={detailsId} onClick={() => setOpen((value) => !value)}>{open ? "Less" : "Details"}<ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} aria-hidden="true" /></Button>
        </div>
      </Card>
    </li>
  );
}
