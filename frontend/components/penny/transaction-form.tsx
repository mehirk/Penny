"use client";

import { FormEvent, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, LoaderCircle, Repeat, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Input, Select } from "@/components/ui/input";
import { type BillFrequency, type CategorySuggestion, type Dashboard, dashboardApi, type ParsedTransaction, type SplitTransactionWrite, type Transaction, type TransactionWrite } from "@/lib/api";
import { defaultTransactionDate } from "@/lib/format";
import { centsToInput, parseCadToCents } from "@/lib/money";
import { haptic } from "@/lib/native";
import { cn } from "@/lib/utils";
import { FREQUENCIES, nextAfter, PaymentMode } from "./bill-options";
import { FormError, parseAmount, type Submit } from "./form-parts";
import { type InlineCreate, NewAccount, NewCategory } from "./inline-create";
import { ACCOUNT_TYPE_LABELS, categoryOptions } from "./labels";
import { Field } from "./shared";

const KIND_STYLE = {
  spending: { label: "Money out", icon: ArrowUpRight, sign: "−", text: "text-money-out", on: "border-money-out bg-money-out-soft text-money-out", button: "bg-money-out text-on-money hover:brightness-95" },
  income: { label: "Money in", icon: ArrowDownLeft, sign: "+", text: "text-money-in", on: "border-money-in bg-money-in-soft text-money-in", button: "bg-money-in text-on-money hover:brightness-95" },
} as const;

const NEW = "__new__";

export function TransactionForm({ item, prefill = null, dashboard, onSubmit, onRequestDelete, onCreate }: { item: Transaction | null; prefill?: ParsedTransaction | null; dashboard: Dashboard; onSubmit: Submit<TransactionWrite | SplitTransactionWrite>; onRequestDelete?: () => void; onCreate: InlineCreate }) {
  const prefillCategory = prefill && dashboard.categories.find((c) => c.id === prefill.category_id && c.kind === prefill.kind)?.id;
  const prefillRepeat = prefill?.repeat && prefill.kind === "spending" ? prefill.repeat : null;
  const [kind, setKind] = useState<Transaction["kind"]>(item?.kind ?? prefill?.kind ?? "spending");
  const [amountError, setAmountError] = useState("");
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const [category, setCategory] = useState(item?.category_id ?? prefillCategory ?? "");
  const [categoryTouched, setCategoryTouched] = useState(Boolean(item || prefillCategory));
  const [suggestion, setSuggestion] = useState<CategorySuggestion | null>(null);
  const [account, setAccount] = useState(item?.account_id ?? dashboard.accounts.find((a) => a.account_type === "chequing")?.id ?? dashboard.accounts[0]?.id ?? "");
  const [date, setDate] = useState(item?.occurred_on ?? prefill?.occurred_on ?? defaultTransactionDate(dashboard.active_month, dashboard.money_calendar.today));
  const [adding, setAdding] = useState<"category" | "account" | null>(null);
  const [splits, setSplits] = useState<SplitDraft>({});
  const [splitErrors, setSplitErrors] = useState<Record<string, string>>({});
  // "every 2nd of the month" and the like arrive with Recurring ticked and the schedule set.
  const [repeat, setRepeat] = useState<{ on: boolean; frequency: BillFrequency; nextDue: string; auto: boolean }>(
    prefillRepeat ? { on: true, frequency: prefillRepeat.frequency, nextDue: prefillRepeat.next_due, auto: true } : { on: false, frequency: "monthly", nextDue: "", auto: true },
  );
  const splitMode = account === MULTIPLE;
  // Only a new money-out entry paid from one account can become a recurring bill.
  const canRepeat = !item && kind === "spending" && !splitMode;
  const splitTotal = splitTotalCents(dashboard, splits);
  const style = KIND_STYLE[kind];
  const options = categoryOptions(dashboard.categories, kind);

  function switchKind(next: Transaction["kind"]) {
    if (next !== kind) haptic("selection");
    setKind(next);
    if (dashboard.categories.find((c) => c.id === category)?.kind !== next) { setCategory(""); setCategoryTouched(false); setSuggestion(null); }
  }

  /** Fills in the category from the merchant name, unless the user already picked one. */
  async function suggestCategory(description: string) {
    if (categoryTouched || !description.trim()) return;
    try {
      const result = await dashboardApi.suggestCategory(description.trim(), kind);
      setSuggestion(result);
      if (result.category_id) setCategory(result.category_id);
    } catch { /* Suggestions are optional; the user can still pick a category. */ }
  }

  function chooseAccount(value: string) {
    if (value === NEW) { setAdding("account"); return; }
    if (value === MULTIPLE && account !== MULTIPLE) {
      // Start with every account included; the user unticks the ones they don't use.
      setSplits(Object.fromEntries(dashboard.accounts.map((option) => [option.id, splits[option.id] ?? { included: true, amount: "" }])));
      setSplitErrors({});
    }
    setAccount(value);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");
    const form = new FormData(event.currentTarget);
    const shared = { description: String(form.get("description")).trim(), category_id: category || null, kind, occurred_on: date };
    if (splitMode) {
      const parsed = parseSplits(dashboard, splits);
      setSplitErrors(parsed.errors);
      if (Object.keys(parsed.errors).length) return;
      if (parsed.parts.length === 0) { setFormError("Tick at least one account and enter its amount."); return; }
      setBusy(true);
      const error = await onSubmit(parsed.parts.length === 1 ? { ...shared, ...parsed.parts[0] } : { ...shared, splits: parsed.parts });
      setBusy(false);
      if (error) setFormError(error);
      return;
    }
    const amount = parseAmount(form.get("amount"));
    if ("error" in amount) { setAmountError(amount.error); return; }
    setAmountError("");
    if (canRepeat && repeat.on && repeat.nextDue && repeat.nextDue <= date) { setFormError("The next payment has to be after this one."); return; }
    setBusy(true);
    const error = await onSubmit({
      description: String(form.get("description")).trim(),
      account_id: account,
      category_id: category || null,
      amount_cents: amount.cents,
      kind,
      occurred_on: date,
      // Repeating is only offered when adding; the edit endpoint doesn't accept the field.
      ...(item ? {} : { repeat: canRepeat && repeat.on ? { frequency: repeat.frequency, next_due: repeat.nextDue || null, auto_record: repeat.auto } : null }),
    });
    setBusy(false);
    if (error) setFormError(error);
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div role="radiogroup" aria-label="Type" className="grid grid-cols-2 gap-2">
        {(["spending", "income"] as const).map((value) => {
          const option = KIND_STYLE[value];
          const Icon = option.icon;
          const selected = kind === value;
          return (
            <button key={value} type="button" role="radio" aria-checked={selected} onClick={() => switchKind(value)} className={cn("flex min-h-14 items-center justify-center gap-2 rounded-2xl border-2 text-base font-semibold transition-colors", selected ? option.on : "border-line text-ink-muted hover:bg-sage-soft")}>
              <Icon className="size-5" aria-hidden="true" />{option.label}
            </button>
          );
        })}
      </div>

      {/* A neutral frame: a coloured one read as an error before anything was typed. The sign carries the kind. */}
      <Field label="Amount (CAD)" error={amountError} hint={splitMode ? "The total of the accounts below." : undefined}>
        {(props) => (
          <div className="flex items-center rounded-2xl border-2 border-line bg-sage-soft px-4 transition-colors focus-within:border-accent focus-within:ring-4 focus-within:ring-accent/15">
            <span className={cn("tabular shrink-0 whitespace-nowrap text-3xl font-semibold", style.text)} aria-hidden="true">{style.sign}$</span>
            {splitMode
              ? <output {...props} className="tabular flex min-h-16 w-full min-w-0 items-center px-1 text-3xl font-semibold text-ink">{centsToInput(String(splitTotal))}</output>
              : <input {...props} name="amount" inputMode="decimal" enterKeyHint="next" autoComplete="off" placeholder="0.00" defaultValue={item ? centsToInput(String(item.amount_cents)) : prefill?.amount_cents ? centsToInput(String(prefill.amount_cents)) : ""} required className="tabular min-h-16 w-full min-w-0 bg-transparent px-1 text-3xl font-semibold text-ink placeholder:text-ink-subtle/60 focus:outline-none" />}
          </div>
        )}
      </Field>

      <Field label="Description">
        {(props) => <Input {...props} name="description" placeholder={kind === "income" ? "e.g. Harbour Books pay" : "e.g. Starbucks"} defaultValue={item?.description ?? prefill?.description} required maxLength={160} enterKeyHint="done" autoCapitalize="words" onBlur={(event) => void suggestCategory(event.target.value)} />}
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Category" hint={suggestion?.category_name && !categoryTouched && category === suggestion.category_id ? `${suggestion.source === "ai" ? "Picked by Penny AI" : "Picked automatically"}${suggestion.necessity ? ` · a ${suggestion.necessity}` : ""}` : undefined}>
          {(props) => (
            <Select {...props} value={category} onChange={(event) => { if (event.target.value === NEW) { setAdding("category"); return; } setCategory(event.target.value); setCategoryTouched(true); }}>
              <option value="">Uncategorized</option>
              {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
              <option value={NEW}>+ New {kind === "income" ? "income type" : "category"}…</option>
            </Select>
          )}
        </Field>
        <Field label={kind === "income" ? "Paid into" : "Paid from"}>
          {(props) => (
            <Select {...props} value={account} onChange={(event) => chooseAccount(event.target.value)} required>
              {dashboard.accounts.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
              {!item && dashboard.accounts.length > 1 && <option value={MULTIPLE}>Multiple accounts…</option>}
              <option value={NEW}>+ New account…</option>
            </Select>
          )}
        </Field>
      </div>

      {adding === "category" && <NewCategory kind={kind} dashboard={dashboard} onCreate={onCreate} onDone={(id) => { setAdding(null); if (id) { setCategory(id); setCategoryTouched(true); } }} />}
      {adding === "account" && <NewAccount onCreate={onCreate} onDone={(id) => { setAdding(null); if (id) setAccount(id); }} />}
      {splitMode && <SplitAccounts dashboard={dashboard} kind={kind} splits={splits} errors={splitErrors} onChange={setSplits} onSingle={() => setAccount(dashboard.accounts[0]?.id ?? "")} />}

      <Field label="Date">
        {(props) => <DatePicker id={props.id} aria-describedby={props["aria-describedby"]} value={date} onChange={(value) => { setDate(value); if (repeat.on) setRepeat({ ...repeat, nextDue: nextAfter(value, repeat.frequency) }); }} />}
      </Field>

      {canRepeat && (
        <div className={cn("rounded-2xl border transition-colors", repeat.on ? "border-primary/40 bg-primary-soft/40" : "border-line")}>
          <label className="flex min-h-14 cursor-pointer items-center gap-3 px-3">
            <input type="checkbox" checked={repeat.on} onChange={(event) => setRepeat({ ...repeat, on: event.target.checked, nextDue: event.target.checked ? nextAfter(date, repeat.frequency) : "" })} className="size-5 shrink-0 accent-[var(--color-accent)]" />
            <span className="min-w-0"><span className="flex items-center gap-1.5 text-sm font-semibold text-ink"><Repeat className="size-4 text-[#7047b7] dark:text-[#c1a5ee]" aria-hidden="true" />Recurring</span><span className="block text-xs text-ink-subtle">Repeats on a schedule, like rent or a subscription</span></span>
          </label>
          {repeat.on && (
            <div className="space-y-4 border-t border-line p-3">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="How often">{(props) => (
                  <Select {...props} value={repeat.frequency} onChange={(event) => { const frequency = event.target.value as BillFrequency; setRepeat({ ...repeat, frequency, nextDue: nextAfter(date, frequency) }); }}>
                    {FREQUENCIES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </Select>
                )}</Field>
                <Field label="Next payment">{(props) => <DatePicker id={props.id} value={repeat.nextDue} onChange={(value) => setRepeat({ ...repeat, nextDue: value })} />}</Field>
              </div>
              <PaymentMode value={repeat.auto} onChange={(auto) => setRepeat({ ...repeat, auto })} />
            </div>
          )}
        </div>
      )}

      <FormError message={formError} />
      <div className="sheet-footer flex flex-col-reverse gap-2 pt-1 sm:flex-row">
        {onRequestDelete && <Button variant="destructive-soft" onClick={onRequestDelete} disabled={busy}><Trash2 className="size-4" aria-hidden="true" />Delete</Button>}
        <Button type="submit" disabled={busy} className={cn("min-h-12 flex-1", style.button)}>
          {busy && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
          {item ? "Save changes" : kind === "income" ? "Add money in" : "Add money out"}
        </Button>
      </div>
    </form>
  );
}

const MULTIPLE = "__multiple__";
type SplitDraft = Record<string, { included: boolean; amount: string }>;

/** Sum of the ticked accounts' valid amounts, for the live total. */
function splitTotalCents(dashboard: Dashboard, splits: SplitDraft): number {
  return dashboard.accounts.reduce((total, account) => {
    const row = splits[account.id];
    if (!row?.included || !row.amount.trim()) return total;
    try { return total + parseCadToCents(row.amount); } catch { return total; }
  }, 0);
}

function parseSplits(dashboard: Dashboard, splits: SplitDraft): { parts: { account_id: string; amount_cents: number }[]; errors: Record<string, string> } {
  const parts: { account_id: string; amount_cents: number }[] = [];
  const errors: Record<string, string> = {};
  for (const account of dashboard.accounts) {
    const row = splits[account.id];
    if (!row?.included) continue;
    const amount = parseAmount(row.amount);
    if ("error" in amount) errors[account.id] = row.amount.trim() ? amount.error : "Enter an amount, or untick this account";
    else parts.push({ account_id: account.id, amount_cents: amount.cents });
  }
  return { parts, errors };
}

/** Every account with a tick box; ticked accounts get an amount, unticked ones are greyed out. */
function SplitAccounts({ dashboard, kind, splits, errors, onChange, onSingle }: { dashboard: Dashboard; kind: Transaction["kind"]; splits: SplitDraft; errors: Record<string, string>; onChange: (next: SplitDraft) => void; onSingle: () => void }) {
  const update = (id: string, patch: Partial<SplitDraft[string]>) => onChange({ ...splits, [id]: { ...(splits[id] ?? { included: true, amount: "" }), ...patch } });
  const style = KIND_STYLE[kind];
  return (
    <fieldset className="rounded-2xl border border-line p-3">
      <legend className="px-1 text-sm font-semibold text-ink">Split {kind === "income" ? "into" : "from"} accounts</legend>
      <ul className="space-y-2">
        {dashboard.accounts.map((account) => {
          const row = splits[account.id] ?? { included: true, amount: "" };
          const inputId = `split-${account.id}`;
          return (
            <li key={account.id} className={cn("rounded-xl transition-opacity", !row.included && "opacity-50")}>
              <div className="flex min-h-12 items-center gap-3">
                <label className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-3">
                  <input type="checkbox" checked={row.included} onChange={(event) => update(account.id, { included: event.target.checked })} className="size-5 shrink-0 accent-[var(--color-accent)]" />
                  <span className="min-w-0">
                    <span className={cn("block truncate text-sm font-semibold", row.included ? "text-ink" : "text-ink-subtle")}>{account.name}</span>
                    <span className="block text-xs text-ink-subtle">{row.included ? ACCOUNT_TYPE_LABELS[account.account_type] : "Not used · tick to add it back"}</span>
                  </span>
                </label>
                {row.included && (
                  <div className={cn("flex w-32 shrink-0 items-center rounded-xl border px-2 focus-within:ring-2 focus-within:ring-accent/30", errors[account.id] ? "border-danger" : "border-line-strong")}>
                    <span className={cn("text-sm font-semibold", style.text)} aria-hidden="true">{style.sign}$</span>
                    <input id={inputId} aria-label={`Amount for ${account.name}`} aria-invalid={Boolean(errors[account.id])} inputMode="decimal" autoComplete="off" placeholder="0.00" value={row.amount} onChange={(event) => update(account.id, { amount: event.target.value })} className="tabular min-h-11 w-full min-w-0 bg-transparent px-1 text-right text-base font-semibold text-ink focus:outline-none" />
                  </div>
                )}
              </div>
              {row.included && errors[account.id] && <p className="mt-1 text-right text-xs text-danger">{errors[account.id]}</p>}
            </li>
          );
        })}
      </ul>
      <button type="button" onClick={onSingle} className="mt-2 min-h-10 px-1 text-sm font-semibold text-accent-strong underline-offset-4 hover:underline">Use one account instead</button>
    </fieldset>
  );
}
