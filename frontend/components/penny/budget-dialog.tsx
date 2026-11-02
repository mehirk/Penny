"use client";

import { FormEvent, useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/input";
import type { Budget, Dashboard } from "@/lib/api";
import { formatMonth } from "@/lib/format";
import { centsToInput, parseCadToCents } from "@/lib/money";
import { FormError, type Submit, SubmitButton } from "./form-parts";
import { categoryOptions } from "./labels";
import { cad, Field } from "./shared";

export function BudgetDialog({ target, dashboard, onClose, onSubmit, onRequestDelete }: {
  target: Budget | "new" | null;
  dashboard: Dashboard;
  onClose: () => void;
  onSubmit: (id: string | null, body: { category_id: string; limit_cents: number }) => Promise<string | null>;
  onRequestDelete: (item: Budget) => void;
}) {
  const item = target && target !== "new" ? target : null;
  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{item ? `${item.category_name} budget` : "Add a monthly budget"}</DialogTitle>
          <DialogDescription>Set how much you plan to spend in a category for {formatMonth(dashboard.active_month)}. Spending is added up from your transactions.</DialogDescription>
        </DialogHeader>
        <BudgetForm item={item} dashboard={dashboard} onSubmit={(body) => onSubmit(item?.id ?? null, body)} onRequestDelete={item ? () => onRequestDelete(item) : undefined} />
      </DialogContent>
    </Dialog>
  );
}

function BudgetForm({ item, dashboard, onSubmit, onRequestDelete }: { item: Budget | null; dashboard: Dashboard; onSubmit: Submit<{ category_id: string; limit_cents: number }>; onRequestDelete?: () => void }) {
  const [amountError, setAmountError] = useState("");
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const budgeted = useMemo(() => new Set(dashboard.budgets.map((budget) => budget.category_id)), [dashboard.budgets]);
  const choices = categoryOptions(dashboard.categories, "spending").filter((option) => item?.category_id === option.id || !budgeted.has(option.id));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");
    const form = new FormData(event.currentTarget);
    let limit: number;
    try { limit = parseCadToCents(String(form.get("limit"))); } catch (reason) { setAmountError(reason instanceof Error ? reason.message : "Enter a valid amount"); return; }
    setAmountError("");
    setBusy(true);
    const error = await onSubmit({ category_id: item?.category_id ?? String(form.get("category_id")), limit_cents: limit });
    setBusy(false);
    if (error) setFormError(error);
  }

  if (!item && choices.length === 0) {
    return <p className="rounded-xl bg-sage-soft p-4 text-sm text-ink-muted">Every spending category already has a budget this month. Edit an existing budget instead.</p>;
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Category" hint={item ? "To budget a different category, add a new budget." : undefined}>
        {(props) => (
          <Select {...props} name="category_id" defaultValue={item?.category_id ?? choices[0]?.id} disabled={Boolean(item)} required>
            {choices.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </Select>
        )}
      </Field>
      <Field label="Monthly limit (CAD)" error={amountError} hint={item ? `You’ve spent ${cad(item.spent_cents)} in ${item.category_name} so far this month.` : undefined}>
        {(props) => <Input {...props} name="limit" inputMode="decimal" autoComplete="off" placeholder="0.00" defaultValue={item ? centsToInput(String(item.limit_cents)) : ""} required autoFocus={Boolean(item)} />}
      </Field>
      <FormError message={formError} />
      <div className="sheet-footer flex flex-col-reverse gap-2 pt-1 sm:flex-row">
        {onRequestDelete && <Button variant="destructive-soft" onClick={onRequestDelete} disabled={busy}><Trash2 className="size-4" aria-hidden="true" />Delete</Button>}
        <SubmitButton busy={busy} label="Save budget" />
      </div>
    </form>
  );
}
