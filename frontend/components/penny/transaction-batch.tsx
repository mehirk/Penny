"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, LoaderCircle, Plus, Repeat, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Input, Select } from "@/components/ui/input";
import { type BillFrequency, type Dashboard, dashboardApi, type ParsedTransaction, type Transaction, type TransactionWrite } from "@/lib/api";
import { centsToInput, parseCadToCents } from "@/lib/money";
import { cn } from "@/lib/utils";
import { FREQUENCIES, nextAfter } from "./bill-options";
import { categoryOptions } from "./dialogs";
import { cad } from "./shared";

export type Draft = {
  key: string;
  kind: Transaction["kind"];
  amount: string;
  description: string;
  category_id: string;
  account_id: string;
  occurred_on: string;
  repeat: { frequency: BillFrequency; next_due: string } | null;
  source: ParsedTransaction["source"] | "manual";
  // Who chose the category: the user (never overwritten), Penny AI, or the keyword rules.
  categoryBy: "user" | "ai" | "rules" | null;
};

let counter = 0;
const nextKey = () => `draft-${(counter += 1)}`;

export function draftFrom(parsed: ParsedTransaction | null, dashboard: Dashboard, fallbackDate: string): Draft {
  const account = dashboard.accounts.find((a) => a.account_type === "chequing")?.id ?? dashboard.accounts[0]?.id ?? "";
  const known = parsed && dashboard.categories.find((c) => c.id === parsed.category_id && c.kind === parsed.kind);
  return {
    key: nextKey(),
    kind: parsed?.kind ?? "spending",
    amount: parsed?.amount_cents ? centsToInput(String(parsed.amount_cents)) : "",
    description: parsed?.description ?? "",
    category_id: known ? known.id : "",
    account_id: account,
    occurred_on: parsed?.occurred_on ?? fallbackDate,
    repeat: parsed?.repeat && parsed.kind === "spending" ? parsed.repeat : null,
    source: parsed?.source ?? "manual",
    categoryBy: known ? (parsed?.source === "ai" ? "ai" : "rules") : null,
  };
}

function cents(amount: string): number | null {
  try {
    const value = parseCadToCents(amount);
    return value > 0 ? value : null;
  } catch {
    return null;
  }
}

/** Checks a draft and turns it into an API body, or explains what's missing. */
function toBody(draft: Draft): TransactionWrite | string {
  const amount = cents(draft.amount);
  if (amount === null) return "Enter an amount";
  if (!draft.description.trim()) return "Add a description";
  if (!draft.account_id) return "Pick an account";
  if (draft.repeat && draft.repeat.next_due <= draft.occurred_on) return "The next payment has to be after this one";
  return {
    description: draft.description.trim(),
    account_id: draft.account_id,
    category_id: draft.category_id || null,
    amount_cents: amount,
    kind: draft.kind,
    occurred_on: draft.occurred_on,
    repeat: draft.kind === "spending" && draft.repeat ? { frequency: draft.repeat.frequency, next_due: draft.repeat.next_due, auto_record: true } : null,
  };
}

/** Several transactions at once: review, edit, or remove each, then add them together. */
export function BatchReview({ dashboard, drafts, onChange, onSubmitMany, onBack, fallbackDate }: {
  dashboard: Dashboard;
  drafts: Draft[];
  onChange: (drafts: Draft[]) => void;
  onSubmitMany: (bodies: TransactionWrite[]) => Promise<{ error: string | null; saved: number }>;
  onBack: () => void;
  fallbackDate: string;
}) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Suggestions arrive after a network call; this keeps them from undoing edits made meanwhile.
  const latest = useRef(drafts);
  useEffect(() => { latest.current = drafts; }, [drafts]);
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const totals = drafts.reduce((sum, draft) => {
    const value = cents(draft.amount) ?? 0;
    return draft.kind === "income" ? { ...sum, in: sum.in + value } : { ...sum, out: sum.out + value };
  }, { in: 0, out: 0 });

  function update(key: string, patch: Partial<Draft>) {
    onChange(drafts.map((draft) => (draft.key === key ? { ...draft, ...patch } : draft)));
    if (errors[key]) setErrors((current) => { const next = { ...current }; delete next[key]; return next; });
  }

  /** Picks a category from the description (rules first, then Penny AI), unless the user chose one. */
  async function suggest(key: string, description: string, kind: Transaction["kind"]) {
    const draft = drafts.find((item) => item.key === key);
    if (!draft || draft.categoryBy === "user" || !description.trim()) return;
    try {
      const result = await dashboardApi.suggestCategory(description.trim(), kind);
      if (!result.category_id) return;
      // Apply against the latest list, and only if the user hasn't picked one in the meantime.
      latest.current = latest.current.map((item) => (item.key === key && item.categoryBy !== "user" && item.kind === kind ? { ...item, category_id: result.category_id ?? "", categoryBy: result.source === "ai" ? "ai" : "rules" } : item));
      onChange(latest.current);
    } catch { /* Suggestions are optional; the user can still pick a category. */ }
  }

  async function save() {
    setFormError("");
    const found: Record<string, string> = {};
    const bodies: TransactionWrite[] = [];
    for (const draft of drafts) {
      const body = toBody(draft);
      if (typeof body === "string") found[draft.key] = body;
      else bodies.push(body);
    }
    setErrors(found);
    if (Object.keys(found).length) { setFormError("Fix the highlighted entries, then add them."); return; }
    setBusy(true);
    const { error, saved } = await onSubmitMany(bodies);
    setBusy(false);
    if (!error) return;
    if (saved > 0) onChange(drafts.slice(saved));
    setFormError(saved > 0 ? `${saved} added. The next one couldn’t be: ${error}` : error);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-ink">Review {drafts.length} transaction{drafts.length === 1 ? "" : "s"}</p>
        <p className="tabular text-sm">
          {totals.out > 0 && <span className="font-semibold text-money-out">−{cad(totals.out)}</span>}
          {totals.out > 0 && totals.in > 0 && <span className="text-ink-subtle"> · </span>}
          {totals.in > 0 && <span className="font-semibold text-money-in">+{cad(totals.in)}</span>}
        </p>
      </div>
      <ol className="space-y-3">
        {drafts.map((draft, index) => (
          <DraftRow key={draft.key} index={index} draft={draft} dashboard={dashboard} error={errors[draft.key]} onChange={(patch) => update(draft.key, patch)} onSuggest={(description, kind) => void suggest(draft.key, description, kind)} onRemove={drafts.length > 1 ? () => onChange(drafts.filter((item) => item.key !== draft.key)) : undefined} />
        ))}
      </ol>
      <Button type="button" variant="outline" className="w-full" onClick={() => onChange([...drafts, draftFrom(null, dashboard, fallbackDate)])}><Plus className="size-4" aria-hidden="true" />Add another</Button>
      {formError && <p role="alert" className="rounded-xl border border-danger/25 bg-danger-soft px-3 py-2.5 text-sm font-medium text-danger">{formError}</p>}
      <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row">
        <Button type="button" variant="ghost" onClick={onBack} disabled={busy}>Start over</Button>
        <Button type="button" className="min-h-12 flex-1" onClick={() => void save()} disabled={busy}>
          {busy && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}Add {drafts.length} transaction{drafts.length === 1 ? "" : "s"}
        </Button>
      </div>
    </div>
  );
}

function DraftRow({ index, draft, dashboard, error, onChange, onSuggest, onRemove }: { index: number; draft: Draft; dashboard: Dashboard; error?: string; onChange: (patch: Partial<Draft>) => void; onSuggest: (description: string, kind: Transaction["kind"]) => void; onRemove?: () => void }) {
  const out = draft.kind === "spending";
  const label = `Transaction ${index + 1}`;
  return (
    <li aria-label={label} className={cn("rounded-2xl border-2 p-3 transition-colors", error ? "border-danger/60" : out ? "border-money-out/35" : "border-money-in/35")}>
      <div className="flex items-center gap-2">
        <div role="radiogroup" aria-label={`${label}: type`} className="grid shrink-0 grid-cols-2 gap-1 rounded-xl bg-sage-soft p-1">
          {(["spending", "income"] as const).map((kind) => {
            const selected = draft.kind === kind;
            const Icon = kind === "spending" ? ArrowUpRight : ArrowDownLeft;
            return (
              <button key={kind} type="button" role="radio" aria-checked={selected} aria-label={kind === "spending" ? "Money out" : "Money in"} onClick={() => { if (kind === draft.kind) return; onChange({ kind, category_id: "", categoryBy: null, repeat: kind === "income" ? null : draft.repeat }); onSuggest(draft.description, kind); }} className={cn("grid size-9 place-items-center rounded-lg transition-colors", selected ? (kind === "spending" ? "bg-money-out text-on-money" : "bg-money-in text-on-money") : "text-ink-subtle hover:text-ink")}>
                <Icon className="size-4" aria-hidden="true" />
              </button>
            );
          })}
        </div>
        <div className={cn("flex min-w-0 flex-1 items-center rounded-xl border px-3", out ? "border-money-out/40 bg-money-out-soft" : "border-money-in/40 bg-money-in-soft")}>
          <span className={cn("tabular shrink-0 whitespace-nowrap text-lg font-semibold", out ? "text-money-out" : "text-money-in")} aria-hidden="true">{out ? "−$" : "+$"}</span>
          <input aria-label={`${label}: amount`} inputMode="decimal" autoComplete="off" value={draft.amount} placeholder="0.00" onChange={(event) => onChange({ amount: event.target.value })} className="tabular min-h-11 w-full min-w-0 bg-transparent px-1 text-lg font-semibold text-ink placeholder:text-ink-subtle/60 focus:outline-none" />
        </div>
        {draft.source === "ai" && <Sparkles className="size-4 shrink-0 text-accent-strong" aria-label="Filled in by Penny AI" />}
        {onRemove && <button type="button" onClick={onRemove} aria-label={`Remove ${label.toLowerCase()}`} className="grid size-10 shrink-0 place-items-center rounded-lg text-ink-subtle hover:bg-danger-soft hover:text-danger"><X className="size-4" aria-hidden="true" /></button>}
      </div>
      <Input aria-label={`${label}: description`} value={draft.description} maxLength={160} placeholder={out ? "e.g. Starbucks" : "e.g. Harbour Books pay"} onChange={(event) => onChange({ description: event.target.value })} onBlur={(event) => onSuggest(event.target.value, draft.kind)} className="mt-2" />
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <div>
          <Select aria-label={`${label}: category`} aria-describedby={draft.categoryBy && draft.categoryBy !== "user" && draft.category_id ? `${draft.key}-category-hint` : undefined} value={draft.category_id} onChange={(event) => onChange({ category_id: event.target.value, categoryBy: "user" })}>
            <option value="">Uncategorized</option>
            {categoryOptions(dashboard.categories, draft.kind).map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </Select>
          {draft.categoryBy && draft.categoryBy !== "user" && draft.category_id && <p id={`${draft.key}-category-hint`} className="mt-1 flex items-center gap-1 text-[11px] text-ink-subtle">{draft.categoryBy === "ai" && <Sparkles className="size-3 text-accent-strong" aria-hidden="true" />}{draft.categoryBy === "ai" ? "Picked by Penny AI" : "Picked automatically"}</p>}
        </div>
        <Select aria-label={`${label}: account`} value={draft.account_id} onChange={(event) => onChange({ account_id: event.target.value })}>
          {dashboard.accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
        </Select>
        <div className="sm:col-span-2"><DatePicker value={draft.occurred_on} onChange={(value) => onChange({ occurred_on: value, repeat: draft.repeat ? { ...draft.repeat, next_due: nextAfter(value, draft.repeat.frequency) } : null })} /></div>
      </div>
      {out && (
        <div className="mt-2 space-y-2 text-sm">
          <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 font-medium text-ink">
            <input type="checkbox" checked={draft.repeat !== null} onChange={(event) => onChange({ repeat: event.target.checked ? { frequency: "monthly", next_due: nextAfter(draft.occurred_on, "monthly") } : null })} className="size-5 accent-[var(--color-accent)]" />
            <Repeat className="size-4 text-[#7047b7] dark:text-[#c1a5ee]" aria-hidden="true" />Recurring
          </label>
          {draft.repeat && (
            <div className="grid gap-2 sm:grid-cols-2">
              <Select aria-label={`${label}: how often`} value={draft.repeat.frequency} onChange={(event) => { const frequency = event.target.value as BillFrequency; onChange({ repeat: { frequency, next_due: nextAfter(draft.occurred_on, frequency) } }); }}>
                {FREQUENCIES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </Select>
              <div><DatePicker value={draft.repeat.next_due} onChange={(value) => onChange({ repeat: draft.repeat ? { ...draft.repeat, next_due: value } : null })} /></div>
              <p className="text-xs text-ink-subtle sm:col-span-2">Repeats {FREQUENCIES.find((option) => option.value === draft.repeat?.frequency)?.label.toLowerCase()}, next on the date above, and records itself.</p>
            </div>
          )}
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-sm font-medium text-danger">{error}</p>}
    </li>
  );
}
