"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Banknote, Check, ChevronRight, FileUp, Lock, type LucideIcon, Palette, Pencil, Plus, RotateCcw, ScanFace, ShieldCheck, Tags, Trash2, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/input";
import { type Dashboard, dashboardApi } from "@/lib/api";
import { biometryName, clearSignIn, faceIdStatus, type FaceIdStatus, isCancelled, saveSignIn, setFaceIdDeclined } from "@/lib/face-id";
import { DatePicker, isoToday } from "@/components/ui/date-picker";
import { formatShortDate, monthEndAfter } from "@/lib/format";
import { centsToInput, parseCadToCents } from "@/lib/money";
import { createSupabaseBrowserClient, getSupabaseUserEmail } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { PalettePicker, ProfileCard, SignOutRow, SurfacePicker, ThemePicker } from "./app-shell";
import { ACCOUNT_TYPE_LABELS, friendStatus } from "./labels";
import { accountEmoji } from "./emoji";
import { PALETTE_OPTIONS, THEME_OPTIONS, usePreferences } from "./preferences";
import { cad, Field } from "./shared";
import { BackBar } from "./back-bar";
import { PaySection } from "./pay-section";
import { StatementImport } from "./statement-import";
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
  return (
    <section aria-labelledby="appearance-title">
      <ThemePicker />
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

/**
 * Settings, very end: erase everything and start again. Typing "reset" confirms it, since it
 * can't be undone; afterwards first-run setup opens.
 */
function ResetDataRow({ save, onReset }: { save: SaveChange; onReset: () => void }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const confirmed = typed.trim().toLowerCase() === "reset";

  async function reset() {
    setBusy(true);
    setError("");
    // Setup opens again after a reset, even on a device where it was once skipped.
    try { window.localStorage.removeItem("penny-setup-skipped"); } catch { /* storage blocked */ }
    const failed = await save(() => dashboardApi.resetData(), "Your data was reset");
    setBusy(false);
    if (failed) { setError(failed); return; }
    setOpen(false);
    setTyped("");
    // Straight into setup, like a brand-new account (Home is underneath when it's done).
    onReset();
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="flex min-h-14 w-full items-center justify-center gap-2 rounded-[var(--radius-card)] font-semibold text-ink-subtle hover:bg-danger-soft hover:text-danger">
        <RotateCcw className="size-4" aria-hidden="true" />Reset data
      </button>
      <Dialog open={open} onOpenChange={(next) => { if (!busy) { setOpen(next); setTyped(""); setError(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset all your data?</DialogTitle>
            <DialogDescription>This erases your transactions, budgets, bills, goals, accounts, categories you made, pay schedule, Learn progress, and Penny AI chats. You’ll start again from setup. This can’t be undone.</DialogDescription>
          </DialogHeader>
          <form onSubmit={(event) => { event.preventDefault(); if (confirmed) void reset(); }} className="space-y-4">
            <Field label="Type reset to confirm">{(props) => <Input {...props} autoComplete="off" autoCapitalize="none" value={typed} onChange={(event) => setTyped(event.target.value)} disabled={busy} className="min-h-11 text-base" />}</Field>
            {error && <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="ghost" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" variant="destructive" disabled={!confirmed || busy}>{busy ? "Resetting…" : "Reset everything"}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Turns sign-in with Face ID on (it needs the password once, to keep it behind Face ID) or off. */
function FaceIdSection({ status, onChange }: { status: FaceIdStatus; onChange: (status: FaceIdStatus) => void }) {
  const name = biometryName(status);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function turnOn() {
    setError("");
    setBusy(true);
    try {
      const email = await getSupabaseUserEmail();
      if (!email) { setError("Sign in again first, then turn this on."); return; }
      // Checks the password is right before keeping it, so Face ID never saves a wrong one.
      const { error: authError } = await createSupabaseBrowserClient().auth.signInWithPassword({ email, password });
      if (authError) { setError(/invalid login credentials/i.test(authError.message) ? "That password isn’t right." : authError.message); return; }
      await saveSignIn(email, password);
      setFaceIdDeclined(false);
      setPassword("");
      onChange({ ...status, saved: true });
    } catch (reason) {
      if (!isCancelled(reason)) setError(`${name} couldn’t be turned on. Try again.`);
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    await clearSignIn();
    onChange({ ...status, saved: false });
    setBusy(false);
  }

  return (
    <section aria-labelledby="face-id-title" className="space-y-4">
      {status.saved ? (
        <>
          <p className="flex items-start gap-2 text-sm text-ink"><Check className="mt-0.5 size-4 shrink-0 text-money-in" aria-hidden="true" />On. Penny asks for {name} each time you come back to the app, and uses it instead of your password when you sign in.</p>
          <Button variant="outline" className="w-full sm:w-auto" disabled={busy} onClick={() => void turnOff()}>Turn off {name}</Button>
        </>
      ) : (
        <form onSubmit={(event) => { event.preventDefault(); void turnOn(); }} className="space-y-4">
          <p className="text-sm text-ink-muted">Lock Penny whenever you leave the app, and sign in with a glance instead of your password. Enter your password once to turn it on.</p>
          <Field label="Password">{(props) => <Input {...props} type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy} className="min-h-11 text-base" />}</Field>
          {error && <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
          <Button type="submit" className="w-full sm:w-auto" disabled={busy || !password}><ScanFace className="size-4" aria-hidden="true" />{busy ? "Turning on…" : `Turn on ${name}`}</Button>
        </form>
      )}
      <p className="text-xs text-ink-subtle">Your sign-in is kept only on this iPhone, in its Keychain, and can be read only after {name}. If you change your password or the faces set up in {name}, Penny asks for your password again.</p>
    </section>
  );
}

type SettingsPage = { id: string; labelId: string; group: string; icon: LucideIcon; title: string; summary: string; body: React.ReactNode };

/**
 * Settings as an iPhone-style list: grouped rows with a one-line summary. A row opens its own
 * page, with "‹ Settings" (or the device's Back) to return.
 */
export function SettingsView({ dashboard, save, onReset }: { dashboard: Dashboard; save: SaveChange; onReset: () => void }) {
  const { theme, palette } = usePreferences();
  const [pageId, openPage, back] = useSubpage("settings");
  const pay = dashboard.pay;
  const nextPay = pay?.upcoming[0]?.on ?? pay?.sources.flatMap((source) => source.upcoming).sort()[0];
  const styleName = PALETTE_OPTIONS.find((option) => option.value === palette)?.label ?? "Penny";
  const themeName = THEME_OPTIONS.find((option) => option.value === theme)?.label ?? "";
  const custom = dashboard.categories.filter((category) => category.custom).length;
  const [faceId, setFaceId] = useState<FaceIdStatus | null>(null);
  useEffect(() => { void faceIdStatus().then(setFaceId); }, []);
  const pages: SettingsPage[] = [
    { id: "pay", labelId: "pay-title", group: "Money", icon: Banknote, title: "When you get paid", summary: pay ? `${pay.sources.length === 1 ? "1 source" : `${pay.sources.length} sources`} · about ${cad(pay.monthly_cents)} a month${nextPay ? ` · next ${formatShortDate(nextPay)}` : ""}` : "Not set up yet", body: <PaySection dashboard={dashboard} save={save} /> },
    { id: "accounts", labelId: "accounts-title", group: "Money", icon: Wallet, title: "Accounts", summary: `${dashboard.accounts.length} account${dashboard.accounts.length === 1 ? "" : "s"}`, body: <AccountsSection dashboard={dashboard} save={save} /> },
    { id: "categories", labelId: "categories-title", group: "Money", icon: Tags, title: "Categories", summary: custom ? `${custom} of your own` : "Penny’s defaults", body: <CategoriesSection dashboard={dashboard} save={save} /> },
    { id: "import", labelId: "import-title", group: "Money", icon: FileUp, title: "Import a statement", summary: "PDF, Excel, or CSV · read by Penny AI", body: <StatementImport dashboard={dashboard} save={save} /> },
    { id: "appearance", labelId: "appearance-title", group: "App", icon: Palette, title: "Appearance", summary: `${styleName} · ${themeName}`, body: <AppearanceSection /> },
    { id: "security", labelId: "trust-title", group: "Privacy", icon: ShieldCheck, title: "Security and trust", summary: "How your data is protected", body: <TrustSection /> },
  ];
  // iPhone with Face ID (or Touch ID) set up: sign in with it instead of the password.
  if (faceId?.available) {
    pages.splice(pages.length - 1, 0, { id: "face-id", labelId: "face-id-title", group: "Privacy", icon: ScanFace, title: biometryName(faceId), summary: faceId.saved ? "On · no password needed" : "Off", body: <FaceIdSection status={faceId} onChange={setFaceId} /> });
  }
  const page = pages.find((item) => item.id === pageId);
  // Laptop: the list stays on the left and the chosen section shows beside it (first by default).
  const wide = useWideScreen();
  const shown = page ?? (wide ? pages[0] : undefined);
  const groups = [...new Set(pages.map((item) => item.group))];

  const list = (
    <div className="space-y-6">
      <ProfileCard dashboard={dashboard} />
      {groups.map((group) => (
        <section key={group} aria-label={group}>
          <h2 className="mb-1.5 px-4 font-sans text-xs font-semibold uppercase tracking-wider text-ink-subtle">{group}</h2>
          <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
            {pages.filter((item) => item.group === group).map(({ id, icon: Icon, title, summary }) => {
              const current = wide && shown?.id === id;
              return (
                <li key={id}>
                  <button type="button" onClick={() => openPage(id, !wide)} aria-current={current ? "page" : undefined} className={cn("flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left hover:bg-sage-soft", current && "bg-primary-soft")}>
                    <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-sage text-ink-muted" aria-hidden="true"><Icon className="size-[1.1rem]" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold text-ink">{title}</span>
                      <span className="block truncate text-sm text-ink-subtle">{summary}</span>
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-ink-subtle" aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      <SignOutRow />
      <ResetDataRow save={save} onReset={onReset} />
    </div>
  );

  if (wide) {
    return (
      <div className="mx-auto grid max-w-6xl grid-cols-[20rem_minmax(0,1fr)] items-start gap-8">
        <div className="sticky top-6">{list}</div>
        {shown && (
          <section aria-labelledby={shown.labelId} className="min-w-0">
            <h2 id={shown.labelId} className="px-1 text-2xl font-semibold tracking-tight text-ink">{shown.title}</h2>
            <div className="mt-4 rounded-[var(--radius-card)] border border-line bg-surface p-5">{shown.body}</div>
          </section>
        )}
      </div>
    );
  }

  if (page) {
    return (
      <div className="mx-auto max-w-2xl">
        <BackBar label="Settings" onBack={back} />
        <h2 id={page.labelId} className="mt-1 px-1 text-2xl font-semibold tracking-tight text-ink">{page.title}</h2>
        <div className="mt-4 rounded-[var(--radius-card)] border border-line bg-surface p-4 sm:p-5">{page.body}</div>
      </div>
    );
  }
  return <div className="mx-auto max-w-2xl">{list}</div>;
}

/** True from the `lg` breakpoint (1024px), where Settings shows two panes. */
function useWideScreen(): boolean {
  return useSyncExternalStore(
    (onChange) => { const media = window.matchMedia("(min-width: 1024px)"); media.addEventListener("change", onChange); return () => media.removeEventListener("change", onChange); },
    () => window.matchMedia("(min-width: 1024px)").matches,
    () => false,
  );
}

function AccountsSection({ dashboard, save }: { dashboard: Dashboard; save: SaveChange }) {
  const today = dashboard.money_calendar.today ?? isoToday();
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  async function run(action: () => Promise<Dashboard>, success: string): Promise<boolean> {
    const result = await save(action, success);
    setError(result ?? "");
    return !result;
  }
  return (
    <section className={SECTION} aria-labelledby="accounts-title">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold text-ink">Your accounts</h3>
        <Button size="sm" onClick={() => { setError(""); setAdding(true); }}><Plus className="size-4" aria-hidden="true" />New account</Button>
      </div>
      <ul className="mt-2 space-y-2.5">
        {dashboard.accounts.map((account) => (
          <li key={account.id} className="rounded-[var(--radius-card)] border border-line bg-surface">
            {editing === account.id
              ? <EditAccount account={account} today={today} nextDue={dashboard.card_payments.find((payment) => payment.account_id === account.id)?.due_on ?? ""} onCancel={() => setEditing(null)} onSave={async (body) => { if (await run(() => dashboardApi.updateAccount(account.id, body), "Account updated")) setEditing(null); }} onDelete={async () => { if (await run(() => dashboardApi.deleteAccount(account.id), "Account removed")) setEditing(null); }} />
              : (
                <div className="flex min-h-16 items-center gap-3 px-4 py-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-full bg-sage text-lg" aria-hidden="true">{accountEmoji(account.name, account.account_type)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-ink">{account.name}</span>
                    <span className="block text-xs text-ink-subtle">{ACCOUNT_TYPE_LABELS[account.account_type]}{account.account_type === "credit" ? " · owed" : account.account_type === "person" ? ` · ${friendStatus(account.balance_cents).toLowerCase()}` : account.balance_cents < 0 ? " · overdrawn" : ""}</span>
                  </span>
                  <span className={cn("tabular shrink-0 font-semibold", account.balance_cents < 0 ? "text-danger" : "text-ink")}>{cad(account.balance_cents)}</span>
                  <Button size="sm" variant="outline" onClick={() => setEditing(account.id)} aria-label={`Edit ${account.name}`}><Pencil className="size-4" aria-hidden="true" />Edit</Button>
                </div>
              )}
          </li>
        ))}
      </ul>
      {error && !adding && <p role="alert" className="mt-3 rounded-xl bg-danger-soft p-3 text-sm text-danger">{error}</p>}

      <Dialog open={adding} onOpenChange={(open) => { setAdding(open); setError(""); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New account</DialogTitle>
            <DialogDescription>Add a chequing, savings, cash, or card account. Use fictional amounts.</DialogDescription>
          </DialogHeader>
          {adding && error && <p role="alert" className="rounded-xl bg-danger-soft p-3 text-sm text-danger">{error}</p>}
          {adding && <AddAccount today={today} onAdd={async (body, success) => { const ok = await run(() => dashboardApi.createAccount(body), success); if (ok) setAdding(false); return ok; }} />}
        </DialogContent>
      </Dialog>
    </section>
  );
}

type AccountChanges = { name: string; balance_cents?: number; credit_limit_cents?: number; payment_next_due?: string };

/** A card's next payment date, like setup: the coming one, or next month's when this month's is paid. */
function CardDueField({ today, value, onChange, label }: { today: string; value: string; onChange: (value: string) => void; label: string }) {
  return (
    <div className="space-y-1 sm:col-span-2">
      <Field label={label}>{(props) => <DatePicker id={props.id} value={value} min={today} max={monthEndAfter(today, 2)} onChange={onChange} />}</Field>
      <p className="text-xs text-ink-subtle">Already paid this month’s? Pick next month’s date. Penny then shows it as paid and moves on.</p>
    </div>
  );
}

function EditAccount({ account, today, nextDue, onSave, onCancel, onDelete }: { account: Dashboard["accounts"][number]; today: string; nextDue: string; onSave: (body: AccountChanges) => Promise<void>; onCancel: () => void; onDelete: () => Promise<void> }) {
  const credit = account.account_type === "credit";
  const [name, setName] = useState(account.name);
  const savedBalance = centsToInput(String(account.balance_cents));
  const [balance, setBalance] = useState(savedBalance);
  const [limit, setLimit] = useState(account.credit_limit_cents ? centsToInput(String(account.credit_limit_cents)) : "");
  const [due, setDue] = useState(nextDue);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) { setError("Give the account a name"); return; }
    if (credit && !due) { setError("Pick when the card's next payment is due"); return; }
    try {
      // The balance is sent only when changed, so an overdrawn account can still be renamed.
      const body: AccountChanges = { name: name.trim(), ...(balance === savedBalance ? {} : { balance_cents: parseCadToCents(balance || "0") }) };
      if (credit) {
        body.credit_limit_cents = parseCadToCents(limit);
        // Only a new date is sent: it also says whether this month's payment is done.
        if (due !== nextDue) body.payment_next_due = due;
      }
      setError("");
      await onSave(body);
    } catch { setError(credit ? "Enter the amount owed and the credit limit" : "Enter a valid balance"); }
  }
  return (
    <form onSubmit={submit} className="space-y-3 p-4">
      <p className="text-sm font-semibold text-ink">Edit {account.name}</p>
      <Field label="Account name">{(props) => <Input {...props} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} className="min-h-11 text-base" />}</Field>
      <div className={cn("grid gap-3", credit && "sm:grid-cols-2")}>
        <Field label={credit ? "Owed now" : "Balance"} hint="Correct it to match your real account.">{(props) => <Input {...props} inputMode="decimal" value={balance} onChange={(e) => setBalance(e.target.value)} className="min-h-11 text-base tabular" />}</Field>
        {credit && <Field label="Credit limit">{(props) => <Input {...props} inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} className="min-h-11 text-base tabular" />}</Field>}
        {credit && <CardDueField today={today} value={due} onChange={setDue} label="Next payment due" />}
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit">Save</Button>
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        <span className="flex-1" />
        {confirming
          ? <><span className="text-sm text-ink-muted">Delete {account.name}?</span><Button type="button" variant="outline" className="border-danger text-danger" onClick={() => void onDelete()}>Delete</Button><Button type="button" variant="ghost" onClick={() => setConfirming(false)}>Keep</Button></>
          : <Button type="button" variant="ghost" className="text-danger" onClick={() => setConfirming(true)}><Trash2 className="size-4" aria-hidden="true" />Delete account</Button>}
      </div>
    </form>
  );
}

function AddAccount({ today, onAdd }: { today: string; onAdd: (body: Parameters<typeof dashboardApi.createAccount>[0], success: string) => Promise<boolean> }) {
  const [name, setName] = useState("");
  const [type, setType] = useState<keyof typeof ACCOUNT_TYPE_LABELS>("chequing");
  const [balance, setBalance] = useState("0.00");
  const [limit, setLimit] = useState("");
  const [due, setDue] = useState("");
  const [error, setError] = useState("");
  const credit = type === "credit";
  async function add(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) { setError("Give the account a name"); return; }
    let balanceCents: number;
    if (credit && !due) { setError("Pick when the card's next payment is due"); return; }
    let limitCents: number | null = null;
    try {
      balanceCents = parseCadToCents(balance);
      if (credit) limitCents = parseCadToCents(limit);
    } catch { setError(credit ? "Enter what's owed (0.00 if nothing) and the credit limit" : "Enter the balance (0.00 if empty)"); return; }
    setError("");
    if (await onAdd({ name: name.trim(), account_type: type, balance_cents: balanceCents, credit_limit_cents: limitCents, payment_next_due: credit ? due : null }, `${name.trim()} added`)) {
      setName(""); setBalance("0.00"); setLimit(""); setDue("");
    }
  }
  return (
    <form onSubmit={add}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Account name">{(props) => <Input {...props} placeholder="e.g. Rainy day savings" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className="min-h-11 text-base" />}</Field>
        <Field label="Type">{(props) => <Select {...props} value={type} onChange={(e) => setType(e.target.value as keyof typeof ACCOUNT_TYPE_LABELS)} className="min-h-11 text-base">{Object.entries(ACCOUNT_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select>}</Field>
        <Field label={credit ? "Owed now" : "Balance"} hint={credit ? "0.00 if the card is paid off." : "Required. 0.00 if it's empty."}>{(props) => <Input {...props} required inputMode="decimal" value={balance} onChange={(e) => setBalance(e.target.value)} className="min-h-11 text-base tabular" />}</Field>
        {credit && <Field label="Credit limit">{(props) => <Input {...props} required inputMode="decimal" placeholder="1000.00" value={limit} onChange={(e) => setLimit(e.target.value)} className="min-h-11 text-base tabular" />}</Field>}
        {credit && <CardDueField today={today} value={due} onChange={setDue} label="When is the next payment due?" />}
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
      <Button type="submit" className="mt-5 min-h-11 w-full"><Plus className="size-4" aria-hidden="true" />Add account</Button>
    </form>
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

