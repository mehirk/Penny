"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, Lock, Plus, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Input, Select } from "@/components/ui/input";
import { type AccountType, type Dashboard, onboardingApi, type OnboardingAnswers, type PayFrequency, type StarterCheck, type StarterPlan } from "@/lib/api";
import { centsToInput, parseCadToCents } from "@/lib/money";
import { cn } from "@/lib/utils";
import { ACCOUNT_TYPE_LABELS } from "./dialogs";
import { accountEmoji } from "./emoji";
import { cad, describeError, DueDaySelect, Field } from "./shared";

/** Starting suggestions only; every amount is the user's to change. */
const BILL_PRESETS = [
  { key: "rent", name: "Rent", category: "cat-housing", amount: "800" },
  { key: "phone", name: "Phone plan", category: "cat-phone", amount: "45" },
  { key: "transit", name: "Transit pass", category: "cat-transport", amount: "80" },
  { key: "internet", name: "Internet", category: "cat-housing", amount: "50" },
  { key: "streaming", name: "Streaming & apps", category: "cat-fun", amount: "15" },
  { key: "gym", name: "Gym", category: "cat-health", amount: "30" },
];
const EVERYDAY_PRESETS = [
  { category: "cat-groceries", label: "Groceries", emoji: "🛒", amount: "250" },
  { category: "cat-eating-out", label: "Eating out & coffee", emoji: "☕", amount: "100" },
  { category: "cat-transport", label: "Getting around", emoji: "🚌", amount: "40" },
  { category: "cat-fun", label: "Entertainment", emoji: "🎬", amount: "80" },
  { category: "cat-health", label: "Health & personal care", emoji: "🧴", amount: "30" },
  { category: "cat-school", label: "School supplies", emoji: "📚", amount: "20" },
];
const SAVINGS_OPTIONS = [0, 500, 1_000, 1_500, 2_000];
const MAX_SAVINGS_BASIS_POINTS = 5_000;
const PAY_OPTIONS: { value: PayFrequency; label: string }[] = [
  { value: "weekly", label: "Every week" },
  { value: "biweekly", label: "Every 2 weeks" },
  { value: "semimonthly", label: "Twice a month" },
  { value: "monthly", label: "Once a month" },
];
const STEPS = ["Accounts", "Income", "Bills", "Everyday", "Savings", "Your plan"];

type Bill = { key: string; on: boolean; name: string; category: string; amount: string; day: string };
type NewAccount = { name: string; type: AccountType; balance: string; limit: string; dueDay: string };

const isoDay = (date: Date) => date.toISOString().slice(0, 10);
/** The next date with this day of the month, on or after `today` (day capped at 28). */
function nextOnDay(today: string, day: number): string {
  const base = new Date(`${today}T00:00:00Z`);
  const d = Math.min(28, Math.max(1, day));
  const candidate = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), d));
  if (candidate < base) candidate.setUTCMonth(candidate.getUTCMonth() + 1);
  return isoDay(candidate);
}
/** Basis points for a typed percentage ("12" or "12.5", up to 2 decimals); invalid is null. */
function percentToBasisPoints(value: string): number | null {
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(value.trim().replace(/%$/, ""));
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}
/** Cents for a typed amount; blank or invalid is null (amounts are required; 0.00 is fine). */
const toCents = (value: string): number | null => {
  try { return parseCadToCents(value); } catch { return null; }
};

/**
 * First-run setup for a real (non-demo) account: a few questions, then a starting budget built
 * by Penny's rules (the AI only explains it). Nothing is saved until the user approves the plan.
 */
export function Onboarding({ dashboard, onDone }: { dashboard: Dashboard; onDone: (data: Dashboard) => void }) {
  const today = dashboard.money_calendar.today ?? isoDay(new Date());
  const categoryIds = useMemo(() => new Set(dashboard.categories.filter((c) => c.kind === "spending").map((c) => c.id)), [dashboard.categories]);
  const editable = dashboard.accounts_overview.accounts.filter((a) => a.last_activity_on === null);
  const [step, setStep] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [balances, setBalances] = useState<Record<string, string>>(() => Object.fromEntries(editable.map((a) => [a.id, centsToInput(String(a.balance_cents))])));
  const [newAccounts, setNewAccounts] = useState<NewAccount[]>([]);
  const [incomeMode, setIncomeMode] = useState<"pay" | "monthly">("pay");
  const [pay, setPay] = useState({ amount: "", frequency: "biweekly" as PayFrequency, next: today });
  const [monthly, setMonthly] = useState("");
  const [bills, setBills] = useState<Bill[]>(() => BILL_PRESETS.filter((p) => categoryIds.has(p.category)).map((p) => ({ key: p.key, on: false, name: p.name, category: p.category, amount: p.amount, day: "1" })));
  const [everyday, setEveryday] = useState<Record<string, string>>(() => Object.fromEntries(EVERYDAY_PRESETS.filter((p) => categoryIds.has(p.category)).map((p) => [p.category, p.amount])));
  const [savings, setSavings] = useState(1_000);
  // A typed percentage when "Custom" is picked; null while a preset is chosen.
  const [customSavings, setCustomSavings] = useState<string | null>(null);
  const [plan, setPlan] = useState<StarterPlan | null>(null);
  // Shown once when the budget so far adds up to more than comes in; Continue again keeps it.
  const [warning, setWarning] = useState<{ check: StarterCheck; key: string } | null>(null);
  const [limits, setLimits] = useState<Record<string, string>>({});

  /** The answers as the API expects them, or an error message for the first bad amount. */
  function answers(savingsOverride?: number): OnboardingAnswers | string {
    const opening: Record<string, number> = {};
    for (const account of editable) {
      const cents = toCents(balances[account.id] ?? "");
      if (cents === null) return `Enter the balance for ${account.name} (0.00 if it's empty).`;
      if (cents !== account.balance_cents) opening[account.id] = cents;
    }
    const accounts: OnboardingAnswers["new_accounts"] = [];
    for (const item of newAccounts) {
      const balance = toCents(item.balance);
      const limit = item.type === "credit" ? toCents(item.limit) : null;
      if (!item.name.trim()) return "Give each new account a name.";
      if (balance === null) return `Enter the balance for ${item.name} (0.00 if it's empty).`;
      if (item.type === "credit" && !limit) return `Enter the credit limit for ${item.name}.`;
      if (item.type === "credit" && !item.dueDay) return `Pick the day ${item.name}'s payment is due.`;
      accounts.push({ name: item.name.trim(), account_type: item.type, balance_cents: balance, credit_limit_cents: item.type === "credit" ? limit : null, payment_due_day: item.type === "credit" ? Number(item.dueDay) : null });
    }
    let income: OnboardingAnswers["income"] = null;
    let monthlyMoney: number | null = null;
    if (incomeMode === "pay") {
      const cents = toCents(pay.amount);
      if (!cents) return "Enter your usual take-home pay, or choose “I don’t get regular pay”.";
      income = { amount_cents: cents, frequency: pay.frequency, next_payday: pay.next, interval_days: null };
    } else {
      monthlyMoney = toCents(monthly);
      if (monthlyMoney === null) return "Check the monthly amount.";
    }
    const billList: OnboardingAnswers["bills"] = [];
    for (const bill of bills.filter((b) => b.on)) {
      const cents = toCents(bill.amount);
      if (!cents || !bill.name.trim()) return `Check the amount for ${bill.name || "your bill"}.`;
      billList.push({ name: bill.name.trim(), amount_cents: cents, category_id: bill.category, frequency: "monthly", next_due: nextOnDay(today, Number(bill.day) || 1) });
    }
    const spend: Record<string, number> = {};
    for (const [category, value] of Object.entries(everyday)) {
      const cents = toCents(value);
      if (cents === null) return "Enter an amount for each everyday category (0.00 to skip one).";
      if (cents > 0) spend[category] = cents;
    }
    let savingsBasisPoints = savingsOverride ?? savings;
    if (savingsOverride === undefined && customSavings !== null) {
      const typed = percentToBasisPoints(customSavings);
      if (typed === null || typed > MAX_SAVINGS_BASIS_POINTS) return `Enter a savings percentage from 0 to ${MAX_SAVINGS_BASIS_POINTS / 100}.`;
      savingsBasisPoints = typed;
    }
    return { opening_balances: opening, new_accounts: accounts, income, monthly_money_cents: monthlyMoney, bills: billList, everyday: spend, savings_basis_points: savingsBasisPoints };
  }

  // Penny's suggestions stay on screen while amounts are entered (Everyday and Saving): the
  // figures come from the API's deterministic check, refreshed shortly after each change.
  const draft = step === 3 || step === 4 ? answers() : null;
  const draftKey = draft && typeof draft !== "string" ? JSON.stringify(draft) : null;
  const [live, setLive] = useState<{ check: StarterCheck; key: string } | null>(null);
  useEffect(() => {
    if (!draftKey) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      onboardingApi.check(JSON.parse(draftKey) as OnboardingAnswers).then((check) => { if (!cancelled) setLive({ check, key: draftKey }); }).catch(() => undefined);
    }, 350);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [draftKey]);

  /** Skips only the step on screen: its amounts become 0 (or nothing), then setup moves on. */
  function skipStep() {
    setError("");
    setWarning(null);
    if (step === 0) {
      setBalances(Object.fromEntries(editable.map((a) => [a.id, "0.00"])));
      setNewAccounts([]);
    } else if (step === 1) {
      setIncomeMode("monthly");
      setMonthly("0.00");
    } else if (step === 2) {
      setBills((list) => list.filter((b) => !b.key.startsWith("custom")).map((b) => ({ ...b, on: false })));
    } else if (step === 3) {
      setEveryday((values) => Object.fromEntries(Object.keys(values).map((key) => [key, "0.00"])));
    } else if (step === 4) {
      setSavings(0);
      setCustomSavings(null);
      void buildPlan(0);
      return;
    }
    setStep(step + 1);
  }

  async function next() {
    setError("");
    if (step === 3 || step === 4) {
      const draft = answers();
      if (typeof draft === "string") { setError(draft); return; }
      const key = JSON.stringify([draft.everyday, draft.bills, draft.savings_basis_points, draft.income, draft.monthly_money_cents]);
      if (warning?.key !== key) {
        setBusy(true);
        try {
          const check = await onboardingApi.check(draft);
          if (check.status !== "fits") { setWarning({ check, key }); return; }
        } catch {
          // The warning is a courtesy; never block setup on it.
        } finally {
          setBusy(false);
        }
      }
    }
    if (step < STEPS.length - 2) { setStep(step + 1); return; }
    await buildPlan();
  }

  async function buildPlan(savingsOverride?: number) {
    const built = answers(savingsOverride);
    if (typeof built === "string") { setError(built); return; }
    setBusy(true);
    try {
      const result = await onboardingApi.plan(built);
      setPlan(result);
      setLimits(Object.fromEntries(result.lines.filter((l) => l.requested_cents > 0).map((l) => [l.category_id, centsToInput(String(l.flexible_cents))])));
      setStep(STEPS.length - 1);
    } catch (reason) {
      setError(describeError(reason, "Penny couldn’t build your plan").detail);
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    const built = answers();
    if (typeof built === "string" || !plan) { setError(typeof built === "string" ? built : ""); return; }
    const everydayLimits: Record<string, number> = {};
    for (const [category, value] of Object.entries(limits)) {
      const cents = toCents(value);
      if (cents === null) { setError("Check the everyday amounts in your plan."); return; }
      everydayLimits[category] = cents;
    }
    setBusy(true);
    setError("");
    try {
      onDone(await onboardingApi.apply(built, everydayLimits));
    } catch (reason) {
      setError(describeError(reason, "Penny couldn’t save your plan").detail);
      setBusy(false);
    }
  }

  const updateBill = (key: string, patch: Partial<Bill>) => setBills((list) => list.map((b) => (b.key === key ? { ...b, ...patch } : b)));
  const money = (value: string, onChange: (v: string) => void, label: string) => (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle" aria-hidden="true">$</span>
      <Input inputMode="decimal" aria-label={label} placeholder="0.00" value={value} onChange={(e) => onChange(e.target.value)} className="min-h-11 pl-7 text-base tabular" />
    </div>
  );

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="setup-title" className="fixed inset-0 z-[60] overflow-y-auto bg-canvas">
      <div className="mx-auto flex min-h-dvh max-w-lg flex-col px-4 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] pt-[calc(env(safe-area-inset-top)+1rem)]">
        <div className="flex items-center justify-between gap-3">
          {step > 0 ? <button type="button" onClick={() => { setError(""); setStep(step - 1); }} className="-ml-2 inline-flex min-h-11 items-center gap-1 rounded-lg px-2 font-semibold text-ink-muted hover:text-ink"><ArrowLeft className="size-4" aria-hidden="true" />Back</button> : <span />}
          <span className="text-xs font-semibold text-ink-subtle">Step {step + 1} of {STEPS.length}</span>
        </div>
        <ol className="mt-2 flex gap-1.5" aria-label={`Step ${step + 1} of ${STEPS.length}`}>
          {STEPS.map((name, index) => <li key={name} className={cn("h-1 flex-1 rounded-full", index <= step ? "bg-primary" : "bg-sage")} aria-hidden="true" />)}
        </ol>

        <div key={step} className="mt-6 flex-1 animate-enter">
          {step === 0 && (
            <section>
              <h1 id="setup-title" className="text-2xl font-semibold tracking-tight text-ink">Let’s build your starting plan</h1>
              <p className="mt-2 text-sm text-ink-muted">A few questions, about 2 minutes. Penny suggests a budget and you can change anything before it’s saved. Use rough numbers; Penny never connects to your bank.</p>
              <h2 className="mt-6 text-base font-semibold text-ink">How much is in your accounts today?</h2>
              <ul className="mt-3 space-y-2.5">
                {editable.map((account) => (
                  <li key={account.id} className="flex items-center gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-3">
                    <span className="grid size-10 shrink-0 place-items-center rounded-full bg-sage text-lg" aria-hidden="true">{accountEmoji(account.name, account.account_type)}</span>
                    <span className="min-w-0 flex-1"><span className="block truncate font-semibold text-ink">{account.name}</span><span className="text-xs text-ink-subtle">{account.account_type === "credit" ? "Owed now" : "Balance now"}</span></span>
                    <div className="w-32">{money(balances[account.id] ?? "", (v) => setBalances({ ...balances, [account.id]: v }), `${account.name} balance`)}</div>
                  </li>
                ))}
                {newAccounts.map((item, index) => (
                  <li key={index} className="space-y-2 rounded-[var(--radius-card)] border border-line bg-surface p-3">
                    <div className="flex gap-2">
                      <Input aria-label="Account name" placeholder="e.g. Rainy day savings" value={item.name} onChange={(e) => setNewAccounts(newAccounts.map((a, i) => (i === index ? { ...a, name: e.target.value } : a)))} className="min-h-11 flex-1 text-base" />
                      <button type="button" aria-label="Remove account" onClick={() => setNewAccounts(newAccounts.filter((_, i) => i !== index))} className="grid size-11 place-items-center rounded-lg text-ink-subtle hover:bg-danger-soft hover:text-danger"><Trash2 className="size-4" aria-hidden="true" /></button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Select aria-label="Account type" value={item.type} onChange={(e) => setNewAccounts(newAccounts.map((a, i) => (i === index ? { ...a, type: e.target.value as AccountType } : a)))} className="min-h-11 text-base">
                        {(["savings", "chequing", "credit", "cash"] as AccountType[]).map((t) => <option key={t} value={t}>{ACCOUNT_TYPE_LABELS[t]}</option>)}
                      </Select>
                      {money(item.balance, (v) => setNewAccounts(newAccounts.map((a, i) => (i === index ? { ...a, balance: v } : a))), item.type === "credit" ? "Owed now" : "Balance now")}
                    </div>
                    {item.type === "credit" && (
                      <div className="grid grid-cols-2 gap-2">
                        <Field label="Credit limit">{(props) => <Input {...props} inputMode="decimal" placeholder="1000.00" value={item.limit} onChange={(e) => setNewAccounts(newAccounts.map((a, i) => (i === index ? { ...a, limit: e.target.value } : a)))} className="min-h-11 text-base" />}</Field>
                        <Field label="Payment due">{(props) => <DueDaySelect {...props} value={item.dueDay} onChange={(v) => setNewAccounts(newAccounts.map((a, i) => (i === index ? { ...a, dueDay: v } : a)))} />}</Field>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
              {newAccounts.length < 4 && <Button variant="outline" className="mt-3 w-full" onClick={() => setNewAccounts([...newAccounts, { name: "", type: "savings", balance: "0.00", limit: "", dueDay: "" }])}><Plus className="size-4" aria-hidden="true" />Add a savings account or card</Button>}

            </section>
          )}

          {step === 1 && (
            <section>
              <h1 id="setup-title" className="text-2xl font-semibold tracking-tight text-ink">What comes in?</h1>
              <div role="radiogroup" aria-label="Income type" className="mt-5 grid grid-cols-2 gap-2">
                {([["pay", "I get paid regularly"], ["monthly", "I don’t get regular pay"]] as const).map(([value, label]) => (
                  <button key={value} type="button" role="radio" aria-checked={incomeMode === value} onClick={() => setIncomeMode(value)} className={cn("min-h-14 rounded-xl border p-3 text-sm font-semibold", incomeMode === value ? "border-primary bg-primary-soft text-ink" : "border-line text-ink-muted")}>{label}</button>
                ))}
              </div>
              {incomeMode === "pay" ? (
                <div className="mt-5 space-y-4">
                  <Field label="Take-home pay each time (after tax)">{() => money(pay.amount, (v) => setPay({ ...pay, amount: v }), "Take-home pay")}</Field>
                  <Field label="How often">{(props) => <Select {...props} value={pay.frequency} onChange={(e) => setPay({ ...pay, frequency: e.target.value as PayFrequency })} className="min-h-11 text-base">{PAY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>}</Field>
                  <Field label="Next payday">{(props) => <DatePicker id={props.id} value={pay.next} min={today} onChange={(v) => setPay({ ...pay, next: v })} />}</Field>
                </div>
              ) : (
                <div className="mt-5"><Field label="How much can you spend each month?" hint="From savings, student loans, or family. Use your best guess.">{() => money(monthly, setMonthly, "Monthly money")}</Field></div>
              )}
            </section>
          )}

          {step === 2 && (
            <section>
              <h1 id="setup-title" className="text-2xl font-semibold tracking-tight text-ink">Your fixed bills</h1>
              <p className="mt-2 text-sm text-ink-muted">Bills that come every month. Their share of your budget stays locked until you change or remove the bill.</p>
              <ul className="mt-5 space-y-2.5">
                {bills.map((bill) => (
                  <li key={bill.key} className={cn("rounded-[var(--radius-card)] border bg-surface p-3", bill.on ? "border-primary" : "border-line")}>
                    <label className="flex min-h-11 cursor-pointer items-center gap-3">
                      <input type="checkbox" checked={bill.on} onChange={(e) => updateBill(bill.key, { on: e.target.checked })} className="size-5 accent-[var(--color-primary)]" />
                      {bill.key.startsWith("custom") ? <Input aria-label="Bill name" placeholder="Bill name" value={bill.name} onChange={(e) => updateBill(bill.key, { name: e.target.value })} className="min-h-11 flex-1 text-base" /> : <span className="flex-1 font-semibold text-ink">{bill.name}</span>}
                    </label>
                    {bill.on && (
                      <div className="mt-2 grid grid-cols-[1fr_7rem] gap-2">
                        {money(bill.amount, (v) => updateBill(bill.key, { amount: v }), `${bill.name} amount`)}
                        <Select aria-label={`${bill.name} due day`} value={bill.day} onChange={(e) => updateBill(bill.key, { day: e.target.value })} className="min-h-11 text-base">
                          {Array.from({ length: 28 }, (_, i) => String(i + 1)).map((d) => <option key={d} value={d}>Due {d}</option>)}
                        </Select>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
              <Button variant="outline" className="mt-3 w-full" onClick={() => setBills([...bills, { key: `custom-${bills.length}`, on: true, name: "", category: "cat-housing", amount: "", day: "1" }])}><Plus className="size-4" aria-hidden="true" />Add another bill</Button>
            </section>
          )}

          {step === 3 && (
            <section>
              <h1 id="setup-title" className="text-2xl font-semibold tracking-tight text-ink">Everyday spending</h1>
              <p className="mt-2 text-sm text-ink-muted">About how much a month? These are typical student amounts; change them to fit your life, or set 0.</p>
              <ul className="mt-5 space-y-2.5">
                {EVERYDAY_PRESETS.filter((p) => p.category in everyday).map((preset) => (
                  <li key={preset.category} className="flex items-center gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-3">
                    <span className="grid size-10 shrink-0 place-items-center rounded-full bg-sage text-lg" aria-hidden="true">{preset.emoji}</span>
                    <span className="min-w-0 flex-1 font-semibold text-ink">{preset.label}</span>
                    <div className="w-32">{money(everyday[preset.category] ?? "", (v) => setEveryday({ ...everyday, [preset.category]: v }), `${preset.label} per month`)}</div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {step === 4 && (
            <section>
              <h1 id="setup-title" className="text-2xl font-semibold tracking-tight text-ink">Saving</h1>
              <p className="mt-2 text-sm text-ink-muted">How much of what comes in would you like to set aside each month? Even a little builds a cushion.</p>
              <div role="radiogroup" aria-label="Savings" className="mt-5 grid grid-cols-3 gap-2 sm:grid-cols-6">
                {SAVINGS_OPTIONS.map((bp) => (
                  <button key={bp} type="button" role="radio" aria-checked={customSavings === null && savings === bp} onClick={() => { setSavings(bp); setCustomSavings(null); }} className={cn("min-h-14 rounded-xl border text-base font-semibold", customSavings === null && savings === bp ? "border-primary bg-primary-soft text-ink" : "border-line text-ink-muted")}>{bp / 100}%</button>
                ))}
                <button type="button" role="radio" aria-checked={customSavings !== null} onClick={() => setCustomSavings(customSavings ?? String(savings / 100))} className={cn("min-h-14 rounded-xl border text-base font-semibold", customSavings !== null ? "border-primary bg-primary-soft text-ink" : "border-line text-ink-muted")}>Custom</button>
              </div>
              {customSavings !== null && (
                <div className="mt-4">
                  <Field label="Your own percentage" hint={`From 0 to ${MAX_SAVINGS_BASIS_POINTS / 100}% of what comes in.`}>
                    {(props) => (
                      <div className="relative w-40">
                        <Input {...props} inputMode="decimal" autoFocus placeholder="12" value={customSavings} onChange={(e) => setCustomSavings(e.target.value)} className="min-h-11 pr-8 text-base tabular" />
                        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-subtle" aria-hidden="true">%</span>
                      </div>
                    )}
                  </Field>
                </div>
              )}
            </section>
          )}

          {(step === 3 || step === 4) && (live?.key === draftKey || warning) && <PennySuggestions check={live?.key === draftKey ? live.check : warning!.check} step={step === 3 ? "everyday" : "savings"} />}

          {step === 5 && plan && <PlanReview plan={plan} limits={limits} onLimit={(category, value) => setLimits({ ...limits, [category]: value })} />}
        </div>

        {error && <p role="alert" className="mt-4 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        <div className="sticky bottom-0 -mx-4 mt-6 bg-canvas/90 px-4 pb-1 pt-3 backdrop-blur">
          {step < STEPS.length - 1
            ? (
              <div className="flex gap-2">
                <Button variant="outline" className="min-h-12 shrink-0 text-base" disabled={busy} onClick={skipStep}>Skip this step</Button>
                <Button className="min-h-12 flex-1 text-base" disabled={busy} onClick={() => void next()}>{busy ? (step === STEPS.length - 2 ? "Building your plan…" : "Checking…") : (step === 3 || step === 4) && warning ? "Keep these amounts" : step === STEPS.length - 2 ? <><Sparkles className="size-4" aria-hidden="true" />See my plan</> : "Continue"}</Button>
              </div>
            )
            : <Button className="min-h-12 w-full text-base" disabled={busy} onClick={() => void approve()}><Check className="size-4" aria-hidden="true" />{busy ? "Saving…" : "Use this plan"}</Button>}
        </div>
      </div>
    </div>
  );
}

/**
 * Penny's suggestions while amounts are entered: the plan so far against what comes in, and the
 * 50/30/20 guide for comparison. Every figure comes from the API's check; advice only.
 */
function PennySuggestions({ check, step }: { check: StarterCheck; step: "everyday" | "savings" }) {
  if (check.status !== "fits") return <IncomeWarning check={check} />;
  if (check.income_cents === 0) {
    return (
      <div role="status" className="mt-5 rounded-xl border border-line bg-surface p-4 text-sm text-ink-muted">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-ink-subtle"><Sparkles className="size-3.5" aria-hidden="true" />Penny · suggestion</p>
        <p className="mt-1">Add what comes in each month (go Back to Income) and Penny will check this plan against it.</p>
      </div>
    );
  }
  const amount = (cents: number) => <span className="tabular font-semibold text-ink">{cad(cents)}</span>;
  return (
    <div role="status" aria-live="polite" className="mt-5 rounded-xl border border-primary/30 bg-primary-soft/40 p-4 text-sm text-ink-muted">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-ink-subtle"><Sparkles className="size-3.5" aria-hidden="true" />Penny · suggestion</p>
      <p className="mt-1 text-ink">Bills {amount(check.fixed_cents)} + everyday {amount(check.flexible_cents)} + savings {amount(check.savings_cents)} = {amount(check.planned_cents)} a month, of the {amount(check.income_cents)} coming in.</p>
      {check.buffer_cents > 0 && <p className="mt-1">That leaves {amount(check.buffer_cents)} unassigned as a buffer.</p>}
      {step === "everyday"
        ? <p className="mt-2">The 50/30/20 rule is a simple guide: about {amount(check.guide_needs_cents)} for needs (rent, bills, groceries) and {amount(check.guide_wants_cents)} for wants.</p>
        : check.savings_cents < check.guide_savings_cents
          ? <p className="mt-2">The 50/30/20 rule suggests saving about 20%, or {amount(check.guide_savings_cents)} a month. Any amount builds a cushion; you can raise it later.</p>
          : <p className="mt-2">That meets the 50/30/20 guide of saving about 20% ({amount(check.guide_savings_cents)} a month).</p>}
      <p className="mt-2 text-xs text-ink-subtle">Educational, not financial advice.</p>
    </div>
  );
}

/** "This seems high": the budget is more than comes in. Advice only; the user can keep it. */
function IncomeWarning({ check }: { check: Pick<StarterCheck, "income_cents" | "planned_cents" | "over_income_cents" | "guide_needs_cents" | "guide_wants_cents" | "guide_savings_cents"> }) {
  return (
    <div role="alert" className="mt-5 rounded-xl border border-gold/50 bg-gold-soft p-4 text-sm text-ink">
      <p className="font-semibold">This seems too high for your income</p>
      <p className="mt-1 text-ink-muted">
        Your plan comes to <span className="tabular font-semibold text-ink">{cad(check.planned_cents)}</span> a month, <span className="tabular font-semibold text-ink">{cad(check.over_income_cents)}</span> more than the <span className="tabular font-semibold text-ink">{cad(check.income_cents)}</span> coming in. We recommend keeping it below your income.
      </p>
      <p className="mt-2 text-ink-muted">The 50/30/20 rule is a simple guide: about <span className="tabular font-semibold text-ink">{cad(check.guide_needs_cents)}</span> for needs (rent, bills, groceries), <span className="tabular font-semibold text-ink">{cad(check.guide_wants_cents)}</span> for wants, and <span className="tabular font-semibold text-ink">{cad(check.guide_savings_cents)}</span> for savings.</p>
      <p className="mt-2 text-xs text-ink-subtle">You can still keep these amounts. Safe to spend will show in red if you go over. Educational, not financial advice.</p>
    </div>
  );
}

/** The proposed budget: locked fixed costs, editable everyday amounts, savings, and the buffer. */
function PlanReview({ plan, limits, onLimit }: { plan: StarterPlan; limits: Record<string, string>; onLimit: (category: string, value: string) => void }) {
  const fixed = plan.lines.filter((l) => l.fixed_cents > 0);
  const everyday = plan.lines.filter((l) => l.requested_cents > 0);
  const card = "rounded-[var(--radius-card)] border border-line bg-surface";
  // Re-totals as everyday amounts are edited, to keep the warning current (advice only; the saved plan comes from the API).
  const planned = plan.fixed_cents + plan.savings_cents + everyday.reduce((sum, l) => sum + (toCents(limits[l.category_id] ?? "") ?? l.flexible_cents), 0);
  return (
    <section>
      <h1 id="setup-title" className="text-2xl font-semibold tracking-tight text-ink">Your starting plan</h1>
      <p className="mt-1 text-sm text-ink-subtle">Each month, from <span className="tabular font-semibold text-ink">{cad(plan.income_cents)}</span> coming in.</p>
      <div className={cn(card, "mt-4 p-4")}>
        <p className="flex items-center gap-1.5 text-xs font-semibold text-ink-subtle"><Sparkles className="size-3.5" aria-hidden="true" />{plan.summary.source === "ai" ? "Penny AI" : "Penny"} · suggestion</p>
        <p className="mt-1 text-sm text-ink">{plan.summary.items[0]}</p>
      </div>
      {planned > plan.income_cents && <IncomeWarning check={{ ...plan, planned_cents: planned, over_income_cents: planned - plan.income_cents }} />}

      {fixed.length > 0 && (
        <>
          <h2 className="mb-2 mt-6 flex items-center gap-1.5 px-1 text-base font-semibold text-ink"><Lock className="size-4 text-ink-subtle" aria-hidden="true" />Fixed bills</h2>
          <ul className={cn(card, "divide-y divide-line")}>
            {fixed.map((l) => <li key={l.category_id} className="flex min-h-12 items-center justify-between px-4"><span className="text-sm text-ink">{l.category_name}</span><span className="tabular font-semibold text-ink">{cad(l.fixed_cents)}</span></li>)}
          </ul>
        </>
      )}

      {everyday.length > 0 && (
        <>
          <h2 className="mb-2 mt-6 px-1 text-base font-semibold text-ink">Everyday <span className="font-normal text-ink-subtle">· you can change these</span></h2>
          <ul className={cn(card, "divide-y divide-line")}>
            {everyday.map((l) => (
              <li key={l.category_id} className="flex min-h-14 items-center gap-3 px-4 py-2">
                <span className="min-w-0 flex-1"><span className="block text-sm text-ink">{l.category_name}</span></span>
                <div className="relative w-32">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle" aria-hidden="true">$</span>
                  <Input inputMode="decimal" aria-label={`${l.category_name} budget`} value={limits[l.category_id] ?? ""} onChange={(e) => onLimit(l.category_id, e.target.value)} className="min-h-11 pl-7 text-base tabular" />
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <ul className={cn(card, "mt-6 divide-y divide-line")}>
        <li className="flex min-h-12 items-center justify-between px-4"><span className="text-sm text-ink">Savings</span><span className="tabular font-semibold text-money-in">{cad(plan.savings_cents)}</span></li>
        <li className="flex min-h-12 items-center justify-between px-4"><span className="text-sm text-ink">Left as a buffer</span><span className="tabular font-semibold text-ink">{cad(plan.buffer_cents)}</span></li>
      </ul>
      <p className="mt-3 px-1 text-xs text-ink-subtle">Educational suggestion from your own answers, not financial advice. Change any budget later from Spending › Budgets.</p>
    </section>
  );
}
