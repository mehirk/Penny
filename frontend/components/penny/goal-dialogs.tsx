"use client";

import { FormEvent, useState } from "react";
import { ArrowRightLeft, LoaderCircle, PiggyBank, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DatePicker, isoToday } from "@/components/ui/date-picker";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/input";
import type { Dashboard, SavingsGoal } from "@/lib/api";
import { centsToInput, parseCadToCents } from "@/lib/money";
import { cn } from "@/lib/utils";
import { FormError, parseAmount, type Submit, SubmitButton } from "./form-parts";
import { isOwnAccount } from "./labels";
import { cad, Field } from "./shared";

type GoalBody = { name: string; target_cents: number; current_cents: number; target_date: string | null; account_id: string | null; status?: "active" | "paused" };

export function GoalDialog({ target, dashboard, onClose, onSubmit, onRequestDelete }: {
  target: SavingsGoal | "new" | null;
  dashboard: Dashboard;
  onClose: () => void;
  onSubmit: (id: string | null, body: GoalBody) => Promise<string | null>;
  onRequestDelete: (item: SavingsGoal) => void;
}) {
  const item = target && target !== "new" ? target : null;
  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{item ? "Edit savings goal" : "Create a savings goal"}</DialogTitle>
          <DialogDescription>Give your savings a destination. You can change these details any time.</DialogDescription>
        </DialogHeader>
        <GoalForm item={item} dashboard={dashboard} onSubmit={(body) => onSubmit(item?.id ?? null, body)} onRequestDelete={item ? () => onRequestDelete(item) : undefined} />
      </DialogContent>
    </Dialog>
  );
}

function GoalForm({ item, dashboard, onSubmit, onRequestDelete }: { item: SavingsGoal | null; dashboard: Dashboard; onSubmit: Submit<GoalBody>; onRequestDelete?: () => void }) {
  const holders = dashboard.accounts.filter((account) => account.account_type !== "credit" && isOwnAccount(account));
  const [targetDate, setTargetDate] = useState(item?.target_date ?? "");
  const [errors, setErrors] = useState<{ current?: string; target?: string }>({});
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");
    const form = new FormData(event.currentTarget);
    const target = parseAmount(form.get("target"));
    let current: { cents: number } | { error: string };
    try { current = { cents: parseCadToCents(String(form.get("current"))) }; } catch (reason) { current = { error: reason instanceof Error ? reason.message : "Enter a valid amount" }; }
    const next: typeof errors = {};
    if ("error" in target) next.target = target.error;
    if ("error" in current) next.current = current.error;
    if (!next.target && !next.current && "cents" in target && "cents" in current && current.cents > target.cents) next.current = "Saved so far can’t be more than the target.";
    setErrors(next);
    if (next.target || next.current || !("cents" in target) || !("cents" in current)) return;
    setBusy(true);
    const status = form.get("status");
    const error = await onSubmit({ name: String(form.get("name")).trim(), target_cents: target.cents, current_cents: current.cents, target_date: String(form.get("target_date")) || null, account_id: String(form.get("account_id")) || null, ...(status === "active" || status === "paused" ? { status } : {}) });
    setBusy(false);
    if (error) setFormError(error);
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="What are you saving for?">
        {(props) => <Input {...props} name="name" placeholder="e.g. Winter emergency fund" defaultValue={item?.name} required maxLength={100} />}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Target (CAD)" error={errors.target}>
          {(props) => <Input {...props} name="target" inputMode="decimal" autoComplete="off" placeholder="0.00" defaultValue={item ? centsToInput(String(item.target_cents)) : ""} required />}
        </Field>
        <Field label="Saved so far (CAD)" error={errors.current}>
          {(props) => <Input {...props} name="current" inputMode="decimal" autoComplete="off" defaultValue={item ? centsToInput(String(item.current_cents)) : "0.00"} required />}
        </Field>
      </div>
      <Field label="Kept in" hint="Money you add moves into this account.">
        {(props) => <Select {...props} name="account_id" defaultValue={item?.account_id ?? holders.find((account) => account.account_type === "savings")?.id ?? ""}>{holders.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</Select>}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Target date" hint="Optional">
          {(props) => <DatePicker id={props.id} aria-describedby={props["aria-describedby"]} name="target_date" value={targetDate} onChange={setTargetDate} min={isoToday()} optional />}
        </Field>
        {item && item.status !== "completed" && (
          <Field label="Status" hint="Paused goals keep their progress.">
            {(props) => (
              <Select {...props} name="status" defaultValue={item.status}>
                <option value="active">Active</option>
                <option value="paused">Paused</option>
              </Select>
            )}
          </Field>
        )}
      </div>
      <FormError message={formError} />
      <div className="sheet-footer flex flex-col-reverse gap-2 pt-1 sm:flex-row">
        {onRequestDelete && <Button variant="destructive-soft" onClick={onRequestDelete} disabled={busy}><Trash2 className="size-4" aria-hidden="true" />Delete</Button>}
        <SubmitButton busy={busy} label={item ? "Save goal" : "Create goal"} />
      </div>
    </form>
  );
}

export function AddMoneyDialog({ goal, dashboard, onClose, onSubmit }: { goal: SavingsGoal | null; dashboard: Dashboard; onClose: () => void; onSubmit: (goal: SavingsGoal, amountCents: number, fromAccountId: string) => Promise<string | null> }) {
  return (
    <Dialog open={goal !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        {goal && (
          <>
            <DialogHeader>
              <DialogTitle>Add money to {goal.name}</DialogTitle>
              <DialogDescription>{cad(goal.current_cents)} of {cad(goal.target_cents)} saved. {cad(goal.target_cents - goal.current_cents)} to go.</DialogDescription>
            </DialogHeader>
            <AddMoneyForm goal={goal} dashboard={dashboard} onSubmit={(amount, from) => onSubmit(goal, amount, from)} />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function AddMoneyForm({ goal, dashboard, onSubmit }: { goal: SavingsGoal; dashboard: Dashboard; onSubmit: (amountCents: number, fromAccountId: string) => Promise<string | null> }) {
  const sources = dashboard.accounts.filter((account) => account.account_type !== "credit" && isOwnAccount(account));
  const [from, setFrom] = useState(sources.find((account) => account.account_type === "chequing")?.id ?? sources[0]?.id ?? "");
  const [value, setValue] = useState("");
  const [amountError, setAmountError] = useState("");
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const source = sources.find((account) => account.id === from);
  const destination = dashboard.accounts.find((account) => account.id === goal.account_id);
  const remaining = goal.target_cents - goal.current_cents;
  const leftThisMonth = goal.monthly_needed_cents !== null ? goal.monthly_needed_cents - goal.contributed_this_month_cents : 0;
  const quick = [
    ...(leftThisMonth > 0 ? [{ label: `This month’s ${cad(leftThisMonth)}`, cents: leftThisMonth }] : []),
    ...[2500, 5000, 10000].map((cents) => ({ label: cad(cents).replace(".00", ""), cents })),
    { label: `All ${cad(remaining)}`, cents: remaining },
  ].filter((item, index, list) => item.cents <= remaining && list.findIndex((other) => other.cents === item.cents) === index);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");
    const amount = parseAmount(value);
    if ("error" in amount) { setAmountError(amount.error); return; }
    if (source && amount.cents > source.balance_cents) { setAmountError(`${source.name} has ${cad(source.balance_cents)}`); return; }
    setAmountError("");
    setBusy(true);
    const error = await onSubmit(amount.cents, from);
    setBusy(false);
    if (error) setFormError(error);
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Amount (CAD)" error={amountError}>
        {(props) => <Input {...props} value={value} onChange={(event) => setValue(event.target.value)} inputMode="decimal" autoComplete="off" placeholder="0.00" required autoFocus />}
      </Field>
      <div className="flex flex-wrap gap-2" aria-label="Quick amounts">
        {quick.map((item) => {
          const text = centsToInput(String(item.cents));
          return (
            <button key={item.label} type="button" onClick={() => setValue(text)} className={cn("min-h-10 rounded-full border px-3.5 text-sm font-semibold transition-colors", value === text ? "border-accent bg-accent-soft text-accent-strong" : "border-line text-ink-muted hover:bg-sage-soft")}>
              {item.label}
            </button>
          );
        })}
      </div>
      <Field label="Take it from" hint={source ? `${cad(source.balance_cents)} available in ${source.name}` : undefined}>
        {(props) => <Select {...props} value={from} onChange={(event) => setFrom(event.target.value)}>{sources.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</Select>}
      </Field>
      <p className="flex items-start gap-2 rounded-xl bg-sage-soft p-3 text-xs leading-relaxed text-ink-muted">
        <ArrowRightLeft className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
        {destination && destination.id !== from
          ? <span>Moves the money from <span className="font-semibold text-ink">{source?.name}</span> into <span className="font-semibold text-ink">{destination.name}</span>. Your total cash stays the same, but this money is set aside and no longer counts as available to spend.</span>
          : <span>The money is already in <span className="font-semibold text-ink">{source?.name}</span>, so it’s simply set aside for this goal.</span>}
      </p>
      <FormError message={formError} />
      <div className="sheet-footer flex pt-1">
        <Button type="submit" disabled={busy} className="flex-1">
          {busy ? <><LoaderCircle className="size-4 animate-spin" aria-hidden="true" />Adding…</> : <><PiggyBank className="size-4" aria-hidden="true" />Add to {goal.name}</>}
        </Button>
      </div>
    </form>
  );
}
