"use client";

import { type ChangeEvent, useState } from "react";
import { Banknote, BellRing, Check, ChevronRight, FileUp, Lock, type LucideIcon, Palette, ShieldCheck, Sparkles, Tags, Trash2, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Input, Select } from "@/components/ui/input";
import { type Dashboard, dashboardApi, type PayFrequency, type PaySchedule } from "@/lib/api";
import { formatShortDate } from "@/lib/format";
import { centsToInput, parseCadToCents } from "@/lib/money";
import { cn } from "@/lib/utils";
import { PalettePicker, ProfileCard, SignOutRow, SurfacePicker, THEME_ICONS } from "./app-shell";
import { ACCOUNT_TYPE_LABELS } from "./dialogs";
import { PALETTE_OPTIONS, THEME_OPTIONS, usePreferences } from "./preferences";
import { EmailReminders } from "./email-reminders";
import { cad, Field } from "./shared";
import { BackBar } from "./back-bar";
import { useSubpage } from "./subpage";

/** Saves a change through the app's mutation runner; resolves to an error message or null. */
export type SaveChange = (action: () => Promise<Dashboard>, success: string) => Promise<string | null>;

// Each section opens inside its Settings row, which supplies the frame and the title.
const SECTION = "";

const PROTECTIONS_TODAY = [
  "Penny uses fictional data only. It never asks for your bank username or password.",
  "Sign-in runs through Supabase Auth, and every request is verified on our server with signed tokens.",
  "AI keys stay on the server. Penny AI can’t move money or change anything without your approval.",
  "Every amount Penny AI quotes is checked against your records before you see it.",
];

const BANK_CONNECTION_STANDARDS = [
  "Only through Canada’s consumer-driven banking framework, with accredited providers listed by the Bank of Canada. No screen scraping.",
  "Read-only access. Penny would never initiate payments or transfers.",
  "You choose exactly which accounts to share, and can revoke access at any time.",
  "Encryption in transit and at rest. Penny would never see or store your bank password.",
  "Device sign-in with passkeys, Face ID, or fingerprint.",
];

function AppearanceSection() {
  const { theme, setTheme } = usePreferences();
  return (
    <section aria-labelledby="appearance-title">
      <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-2">
        {THEME_OPTIONS.map((option) => {
          const Icon = THEME_ICONS[option.value];
          return <button key={option.value} type="button" role="radio" aria-checked={theme === option.value} onClick={() => setTheme(option.value)} className={cn("flex min-h-16 flex-col items-center justify-center gap-1.5 rounded-xl border p-2 text-sm font-semibold", theme === option.value ? "border-primary bg-primary-soft text-primary" : "border-line text-ink-muted hover:border-line-strong")}><Icon className="size-5" aria-hidden="true" />{option.label}</button>;
        })}
      </div>
      <h3 className="mt-5 text-sm font-semibold text-ink">Style</h3>
      <div className="mt-2"><PalettePicker /></div>
      <h3 className="mt-5 text-sm font-semibold text-ink">Surface</h3>
      <div className="mt-2"><SurfacePicker /></div>
      <p className="mt-5 text-sm text-ink-subtle">Text size follows your device: on iPhone, Settings › Display &amp; Brightness › Text Size.</p>
    </section>
  );
}

function TrustSection() {
  return (
    <section aria-labelledby="trust-title">
      <h3 className="text-sm font-semibold text-ink">How Penny protects you today</h3>
      <ul className="mt-2 space-y-2">{PROTECTIONS_TODAY.map((item) => <li key={item} className="flex gap-2 text-sm text-ink-muted"><Check className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />{item}</li>)}</ul>
      <h3 className="mt-5 text-sm font-semibold text-ink">If Penny ever connects to your bank</h3>
      <p className="mt-1 text-sm text-ink-subtle">These are the standards a connection would have to meet. They are commitments, not live features.</p>
      <ul className="mt-2 space-y-2">{BANK_CONNECTION_STANDARDS.map((item) => <li key={item} className="flex gap-2 text-sm text-ink-muted"><Lock className="mt-0.5 size-4 shrink-0 text-info" aria-hidden="true" />{item}</li>)}</ul>
    </section>
  );
}

const PAY_SHORT: Record<PayFrequency, string> = { weekly: "Weekly", biweekly: "Every 2 weeks", semimonthly: "Twice a month", monthly: "Monthly", custom: "Custom" };

type SettingsPage = { id: string; labelId: string; group: string; icon: LucideIcon; title: string; summary: string; body: React.ReactNode };

/**
 * Settings as an iPhone-style list: grouped rows with a one-line summary. A row opens its own
 * page, with "‹ Settings" (or the device's Back) to return.
 */
export function SettingsView({ dashboard, save }: { dashboard: Dashboard; save: SaveChange }) {
  const { theme, palette } = usePreferences();
  const [pageId, openPage, back] = useSubpage("settings");
  const pay = dashboard.pay_schedule;
  const styleName = PALETTE_OPTIONS.find((option) => option.value === palette)?.label ?? "Penny";
  const themeName = THEME_OPTIONS.find((option) => option.value === theme)?.label ?? "";
  const custom = dashboard.categories.filter((category) => category.custom).length;
  const pages: SettingsPage[] = [
    { id: "pay", labelId: "pay-title", group: "Money", icon: Banknote, title: "When you get paid", summary: pay ? `${PAY_SHORT[pay.frequency]} · next ${formatShortDate(pay.next_payday)}` : "Not set up yet", body: <PayScheduleSection dashboard={dashboard} save={save} /> },
    { id: "accounts", labelId: "accounts-title", group: "Money", icon: Wallet, title: "Accounts", summary: `${dashboard.accounts.length} account${dashboard.accounts.length === 1 ? "" : "s"}`, body: <AccountsSection dashboard={dashboard} save={save} /> },
    { id: "categories", labelId: "categories-title", group: "Money", icon: Tags, title: "Categories", summary: custom ? `${custom} of your own` : "Penny’s defaults", body: <CategoriesSection dashboard={dashboard} save={save} /> },
    { id: "import", labelId: "import-title", group: "Money", icon: FileUp, title: "Import history", summary: "From a CSV file", body: <ImportSection dashboard={dashboard} save={save} /> },
    { id: "appearance", labelId: "appearance-title", group: "App", icon: Palette, title: "Appearance", summary: `${styleName} · ${themeName}`, body: <AppearanceSection /> },
    { id: "reminders", labelId: "reminders-title", group: "App", icon: BellRing, title: "Email reminders", summary: "Bills, budgets, and streaks", body: <EmailReminders /> },
    { id: "security", labelId: "trust-title", group: "Privacy", icon: ShieldCheck, title: "Security and trust", summary: "How your data is protected", body: <TrustSection /> },
  ];
  const page = pages.find((item) => item.id === pageId);

  if (page) {
    return (
      <div className="mx-auto max-w-2xl">
        <BackBar label="Settings" onBack={back} />
        <h2 id={page.labelId} className="mt-1 px-1 text-2xl font-semibold tracking-tight text-ink">{page.title}</h2>
        <div className="mt-4 rounded-[var(--radius-card)] border border-line bg-surface p-4 sm:p-5">{page.body}</div>
      </div>
    );
  }

  const groups = [...new Set(pages.map((item) => item.group))];
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <ProfileCard dashboard={dashboard} />
      {groups.map((group) => (
        <section key={group} aria-label={group}>
          <h2 className="mb-1.5 px-4 font-sans text-xs font-semibold uppercase tracking-wider text-ink-subtle">{group}</h2>
          <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
            {pages.filter((item) => item.group === group).map(({ id, icon: Icon, title, summary }) => (
              <li key={id}>
                <button type="button" onClick={() => openPage(id)} className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left hover:bg-sage-soft">
                  <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-sage text-ink-muted" aria-hidden="true"><Icon className="size-[1.1rem]" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-ink">{title}</span>
                    <span className="block truncate text-sm text-ink-subtle">{summary}</span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-ink-subtle" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <SignOutRow />
    </div>
  );
}

const PAY_FREQUENCIES: { value: PayFrequency; label: string }[] = [
  { value: "weekly", label: "Every week" },
  { value: "biweekly", label: "Every 2 weeks" },
  { value: "semimonthly", label: "Twice a month (15th and last day)" },
  { value: "monthly", label: "Once a month" },
  { value: "custom", label: "Every … days" },
];

function PayScheduleSection({ dashboard, save }: { dashboard: Dashboard; save: SaveChange }) {
  const current = dashboard.pay_schedule;
  const [frequency, setFrequency] = useState<PayFrequency>(current?.frequency ?? "biweekly");
  const [nextPayday, setNextPayday] = useState(current?.next_payday ?? dashboard.money_calendar.today ?? dashboard.current_month);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    let cents: number;
    try { cents = parseCadToCents(String(form.get("amount"))); } catch { setError("Enter your usual take-home pay"); return; }
    const interval = frequency === "custom" ? Number(form.get("interval")) : null;
    if (interval !== null && !(interval >= 7 && interval <= 62)) { setError("Pick between 7 and 62 days"); return; }
    const body: PaySchedule = { name: String(form.get("name")).trim() || "Paycheque", amount_cents: cents, account_id: String(form.get("account_id")), frequency, next_payday: nextPayday, interval_days: interval };
    const result = await save(() => dashboardApi.setPaySchedule(body), "Pay schedule saved");
    setError(result ?? "");
    setSaved(!result);
  }

  return (
    <section className={SECTION} aria-labelledby="pay-title">
      <p className="mt-1 text-sm text-ink-subtle">Your payday forecast and pay cycles are built from this.</p>
      <form onSubmit={submit} onChange={() => setSaved(false)} className="mt-4 space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Paycheque name">{(props) => <Input {...props} name="name" defaultValue={current?.name ?? "Paycheque"} maxLength={80} />}</Field>
          <Field label="Take-home amount (CAD)">{(props) => <Input {...props} name="amount" inputMode="decimal" defaultValue={current ? centsToInput(String(current.amount_cents)) : ""} placeholder="0.00" required />}</Field>
          <Field label="How often">{(props) => <Select {...props} value={frequency} onChange={(event) => setFrequency(event.target.value as PayFrequency)}>{PAY_FREQUENCIES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</Select>}</Field>
          {frequency === "custom" ? <Field label="Days between paydays">{(props) => <Input {...props} name="interval" type="number" min={7} max={62} defaultValue={current?.interval_days ?? 18} />}</Field> : <div className="hidden sm:block" />}
          <Field label="Next payday">{(props) => <DatePicker id={props.id} value={nextPayday} onChange={(value) => { setNextPayday(value); setSaved(false); }} />}</Field>
          <Field label="Paid into">{(props) => <Select {...props} name="account_id" defaultValue={current?.account_id ?? dashboard.accounts[0]?.id}>{dashboard.accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</Select>}</Field>
        </div>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <Button type="submit">{saved ? <><Check className="size-4" aria-hidden="true" />Saved</> : "Save pay schedule"}</Button>
      </form>
    </section>
  );
}

function AccountsSection({ dashboard, save }: { dashboard: Dashboard; save: SaveChange }) {
  const [error, setError] = useState("");
  async function run(action: () => Promise<Dashboard>, success: string) {
    setError((await save(action, success)) ?? "");
  }
  return (
    <section className={SECTION} aria-labelledby="accounts-title">
      <p className="mt-1 text-sm text-ink-subtle">Rename or remove accounts. Add new ones from Add transaction, or below.</p>
      <ul className="mt-3 divide-y divide-line">
        {dashboard.accounts.map((account) => (
          <li key={account.id} className="flex items-center gap-3 py-2.5">
            <Input aria-label={`Name for ${account.name}`} defaultValue={account.name} maxLength={60} className="flex-1" onBlur={(event) => { const name = event.target.value.trim(); if (name && name !== account.name) void run(() => dashboardApi.renameAccount(account.id, name), "Account renamed"); }} />
            <Badge tone="neutral" className="shrink-0">{ACCOUNT_TYPE_LABELS[account.account_type]}</Badge>
            <span className="tabular hidden w-28 shrink-0 text-right text-sm font-semibold text-ink sm:block">{cad(account.balance_cents)}</span>
            <button type="button" onClick={() => void run(() => dashboardApi.deleteAccount(account.id), "Account removed")} className="grid size-11 shrink-0 place-items-center rounded-lg text-ink-subtle hover:bg-danger-soft hover:text-danger" aria-label={`Remove ${account.name}`}><Trash2 className="size-4" aria-hidden="true" /></button>
          </li>
        ))}
      </ul>
      <AddAccount onAdd={(body, success) => run(() => dashboardApi.createAccount(body), success)} />
      {error && <p role="alert" className="mt-3 rounded-xl bg-danger-soft p-3 text-sm text-danger">{error}</p>}
    </section>
  );
}

function AddAccount({ onAdd }: { onAdd: (body: Parameters<typeof dashboardApi.createAccount>[0], success: string) => Promise<void> }) {
  const [name, setName] = useState("");
  const [type, setType] = useState<keyof typeof ACCOUNT_TYPE_LABELS>("chequing");
  const [balance, setBalance] = useState("");
  const [limit, setLimit] = useState("");
  const [error, setError] = useState("");
  async function add() {
    if (!name.trim()) { setError("Name the account"); return; }
    let balanceCents = 0;
    let limitCents: number | null = null;
    try { balanceCents = balance ? parseCadToCents(balance) : 0; if (type === "credit") limitCents = parseCadToCents(limit); } catch { setError(type === "credit" ? "Enter a balance and credit limit" : "Enter a valid balance"); return; }
    setError("");
    await onAdd({ name: name.trim(), account_type: type, balance_cents: balanceCents, credit_limit_cents: limitCents }, `${name.trim()} added`);
    setName(""); setBalance(""); setLimit("");
  }
  return (
    <div className="mt-3 grid gap-2 rounded-xl bg-sage-soft p-3 sm:grid-cols-[1.3fr_1fr_1fr_auto]">
      <Input aria-label="New account name" placeholder="New account, e.g. Wallet" value={name} onChange={(event) => setName(event.target.value)} maxLength={60} />
      <Select aria-label="Account type" value={type} onChange={(event) => setType(event.target.value as keyof typeof ACCOUNT_TYPE_LABELS)}>{Object.entries(ACCOUNT_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select>
      <Input aria-label={type === "credit" ? "Credit limit" : "Starting balance"} placeholder={type === "credit" ? "Credit limit" : "Balance (optional)"} inputMode="decimal" value={type === "credit" ? limit : balance} onChange={(event) => (type === "credit" ? setLimit : setBalance)(event.target.value)} />
      <Button onClick={() => void add()}>Add</Button>
      {error && <p role="alert" className="text-sm text-danger sm:col-span-4">{error}</p>}
    </div>
  );
}

function CategoriesSection({ dashboard, save }: { dashboard: Dashboard; save: SaveChange }) {
  const [kind, setKind] = useState<"spending" | "income">("spending");
  const [name, setName] = useState("");
  const [parent, setParent] = useState("");
  const [error, setError] = useState("");
  const own = dashboard.categories.filter((category) => category.kind === kind);
  const parents = own.filter((category) => !category.parent_id);

  async function run(action: () => Promise<Dashboard>, success: string) {
    const result = await save(action, success);
    setError(result ?? "");
    return !result;
  }
  async function add() {
    if (!name.trim()) { setError("Name the category"); return; }
    if (await run(() => dashboardApi.createCategory({ name: name.trim(), kind, parent_id: kind === "spending" && parent ? parent : null }), `${name.trim()} added`)) { setName(""); setParent(""); }
  }

  return (
    <section className={SECTION} aria-labelledby="categories-title">
      <p className="mt-1 text-sm text-ink-subtle">Money in and money out have their own categories. Group spending with subcategories, like Food › Groceries.</p>
      <div role="tablist" aria-label="Category type" className="mt-4 grid grid-cols-2 gap-1 rounded-xl bg-sage-soft p-1">
        {([["spending", "Money out"], ["income", "Money in"]] as const).map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={kind === value} onClick={() => setKind(value)} className={cn("min-h-10 rounded-lg text-sm font-semibold", kind === value ? (value === "income" ? "bg-zone-green-soft text-ink shadow-sm" : "bg-danger-soft text-ink shadow-sm") : "text-ink-subtle")}>{label}</button>)}
      </div>
      <ul className="mt-3 space-y-1" role="tabpanel">
        {parents.map((category) => (
          <li key={category.id}>
            <CategoryRow name={category.name} custom={category.custom} onDelete={() => void run(() => dashboardApi.deleteCategory(category.id), `${category.name} removed`)} />
            <ul className="ml-5 border-l border-line pl-3">
              {own.filter((child) => child.parent_id === category.id).map((child) => <li key={child.id}><CategoryRow name={child.name} custom={child.custom} onDelete={() => void run(() => dashboardApi.deleteCategory(child.id), `${child.name} removed`)} /></li>)}
            </ul>
          </li>
        ))}
      </ul>
      <div className="mt-3 grid gap-2 rounded-xl bg-sage-soft p-3 sm:grid-cols-[1.3fr_1fr_auto]">
        <Input aria-label="New category name" placeholder={kind === "income" ? "e.g. Tutoring" : "e.g. Pets"} value={name} onChange={(event) => setName(event.target.value)} maxLength={40} />
        {kind === "spending" ? (
          <Select aria-label="Put it under" value={parent} onChange={(event) => setParent(event.target.value)}>
            <option value="">Top-level category</option>
            {parents.map((option) => <option key={option.id} value={option.id}>Under {option.name}</option>)}
          </Select>
        ) : <span className="hidden sm:block" />}
        <Button onClick={() => void add()}>Add</Button>
      </div>
      {error && <p role="alert" className="mt-3 rounded-xl bg-danger-soft p-3 text-sm text-danger">{error}</p>}
    </section>
  );
}

function CategoryRow({ name, custom, onDelete }: { name: string; custom: boolean; onDelete: () => void }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-2">
      <span className="text-sm text-ink">{name}{custom && <span className="ml-2 text-xs text-ink-subtle">yours</span>}</span>
      <button type="button" onClick={onDelete} className="grid size-11 place-items-center rounded-lg text-ink-subtle hover:bg-danger-soft hover:text-danger" aria-label={`Remove ${name}`}><Trash2 className="size-4" aria-hidden="true" /></button>
    </div>
  );
}

function ImportSection({ dashboard, save }: { dashboard: Dashboard; save: SaveChange }) {
  const [account, setAccount] = useState(dashboard.accounts.find((item) => item.account_type === "chequing")?.id ?? dashboard.accounts[0]?.id ?? "");
  const [result, setResult] = useState<{ imported: number; skipped: number; errors: string[]; ai_categorized: number } | null>(null);
  const [error, setError] = useState("");

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 400_000) { setError("That file is too big. Split it into smaller files."); return; }
    const text = await file.text();
    let summary: { imported: number; skipped: number; errors: string[]; ai_categorized: number } | null = null;
    const failure = await save(async () => { const response = await dashboardApi.importCsv(text, account); summary = response; return response.dashboard; }, "Import finished");
    setError(failure ?? "");
    setResult(summary);
  }

  return (
    <section className={SECTION} aria-labelledby="import-title">
      <p className="mt-1 text-sm text-ink-subtle">Import a CSV from your bank or another app. Needs Date (YYYY-MM-DD), Description, and Amount (negative for money out) columns. Duplicates are skipped and balances don’t change. Export anytime from Spending.</p>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <Select aria-label="Import into account" value={account} onChange={(event) => setAccount(event.target.value)} className="sm:max-w-xs">{dashboard.accounts.map((item) => <option key={item.id} value={item.id}>Into {item.name}</option>)}</Select>
        <label className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-on-primary hover:bg-primary-hover has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent">
          <FileUp className="size-4" aria-hidden="true" />Choose CSV file
          <input type="file" accept=".csv,text/csv" onChange={(event) => void onFile(event)} className="sr-only" />
        </label>
      </div>
      {error && <p role="alert" className="mt-3 rounded-xl bg-danger-soft p-3 text-sm text-danger">{error}</p>}
      {result && (
        <div className="mt-3 rounded-xl bg-sage-soft p-3 text-sm" role="status">
          <p className="font-semibold text-ink">Imported {result.imported} transaction{result.imported === 1 ? "" : "s"}{result.skipped ? `, skipped ${result.skipped}` : ""}.</p>
          {result.ai_categorized > 0 && <p className="mt-1 flex items-center gap-1.5 text-ink-muted"><Sparkles className="size-3.5 text-accent-strong" aria-hidden="true" />Penny AI sorted {result.ai_categorized} that the usual rules couldn’t place. They’re tagged “Auto” so you can check them.</p>}
          {result.errors.length > 0 && <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-ink-muted">{result.errors.map((item, index) => <li key={index}>{item}</li>)}</ul>}
        </div>
      )}
    </section>
  );
}
