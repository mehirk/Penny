"use client";

import { useState } from "react";
import { CalendarDays, Check, History, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DatePicker, isoToday } from "@/components/ui/date-picker";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/input";
import { type Dashboard, dashboardApi, type PayFrequency, type PayScheduleWrite, type PaySource, type UpcomingPay } from "@/lib/api";
import { formatShortDate } from "@/lib/format";
import { centsToInput, parseCadToCents } from "@/lib/money";
import { cn } from "@/lib/utils";
import { isOwnAccount } from "./labels";
import { PaydayCheckIn } from "./payday-check-in";
import { cad, Field } from "./shared";
import type { SaveChange } from "./settings-view";

const FREQUENCIES: { value: PayFrequency; label: string; short: string }[] = [
  { value: "weekly", label: "Every week", short: "every week" },
  { value: "biweekly", label: "Every 2 weeks", short: "every 2 weeks" },
  { value: "semimonthly", label: "Twice a month (15th and last day)", short: "twice a month" },
  { value: "monthly", label: "Once a month", short: "every month" },
  { value: "custom", label: "Every … days", short: "custom" },
];

/** Each source of pay keeps one colour (chart tokens, in a fixed order) across the timeline and its card. */
const DOTS = ["var(--chart-cat-1)", "var(--chart-cat-3)", "var(--chart-cat-4)", "var(--chart-cat-5)", "var(--chart-cat-2)", "var(--chart-cat-6)", "var(--chart-cat-7)", "var(--chart-other)"];

const howOften = (source: Pick<PaySource, "frequency" | "interval_days">) =>
  source.frequency === "custom" ? `every ${source.interval_days} days` : FREQUENCIES.find((f) => f.value === source.frequency)?.short ?? "";

/**
 * Settings › When you get paid: every source of pay (a job, a scholarship, an allowance), what
 * they come to a month, and the paydays coming up. All amounts come from the API.
 */
export function PaySection({ dashboard, save }: { dashboard: Dashboard; save: SaveChange }) {
  const pay = dashboard.pay;
  const sources = pay?.sources ?? [];
  const [editing, setEditing] = useState<PaySource | "new" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [error, setError] = useState("");
  const colour = (id: string) => DOTS[Math.max(0, sources.findIndex((s) => s.id === id)) % DOTS.length];
  const accountName = (id: string) => dashboard.accounts.find((a) => a.id === id)?.name ?? "an account";

  async function remove(source: PaySource) {
    if (confirmDelete !== source.id) { setConfirmDelete(source.id); return; }
    setConfirmDelete(null);
    setError((await save(() => dashboardApi.deletePay(source.id), `${source.name} removed`)) ?? "");
  }

  return (
    <section aria-labelledby="pay-title" className="space-y-5">
      <PaydayPrompt dashboard={dashboard} save={save} />
      {pay ? (
        <div className="rounded-2xl bg-sage-soft p-4">
          <p className="text-sm text-ink-muted">Coming in, about</p>
          <p className="tabular text-3xl font-semibold tracking-tight text-ink">{cad(pay.monthly_cents)}<span className="text-base font-medium text-ink-subtle"> a month</span></p>
          <p className="mt-0.5 text-xs text-ink-subtle">From {sources.length} source{sources.length === 1 ? "" : "s"} of pay, averaged over the year.</p>
          {pay.upcoming.length > 0 && (
            <>
              <h3 className="mt-4 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-ink-subtle"><CalendarDays className="size-3.5" aria-hidden="true" />Next 5 weeks</h3>
              <ol className="-mx-4 mt-2 flex snap-x gap-2 overflow-x-auto scroll-px-4 px-4 pb-1 [scrollbar-width:none]">
                {pay.upcoming.map((item) => (
                  <li key={`${item.pay_id}:${item.on}`} className="min-w-[8.5rem] shrink-0 snap-start rounded-xl border border-line bg-surface px-3 py-2 animate-enter">
                    <p className="text-xs font-semibold text-ink-subtle">{formatShortDate(item.on)}</p>
                    <p className="mt-0.5 flex items-center gap-1.5 truncate text-sm font-semibold text-ink"><span className="size-2 shrink-0 rounded-full" style={{ background: colour(item.pay_id) }} aria-hidden="true" />{item.name}</p>
                    <p className="tabular text-sm text-ink-muted">{cad(item.amount_cents)}</p>
                    {item.received && <p className="mt-0.5 flex items-center gap-1 text-xs font-semibold text-money-in"><Check className="size-3.5" aria-hidden="true" />Received</p>}
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
      ) : (
        <p className="text-sm text-ink-subtle">Add how you get paid: a job, a scholarship, student loans, an allowance. Your payday forecast and pay cycles are built from it.</p>
      )}

      {sources.length > 0 && (
        <ul className="space-y-2.5">
          {sources.map((source, index) => (
            <li key={source.id} className="rounded-[var(--radius-card)] border border-line bg-surface p-4 animate-enter">
              <div className="flex items-start gap-3">
                <span className="mt-1.5 size-2.5 shrink-0 rounded-full" style={{ background: colour(source.id) }} aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-x-2 font-semibold text-ink">
                    <span className="truncate">{source.name}</span>
                    {index === 0 && sources.length > 1 && <span className="rounded-full bg-primary-soft px-2 py-0.5 text-[0.7rem] font-semibold text-ink" title="Your pay cycles follow this one">Main</span>}
                  </p>
                  <p className="tabular text-sm text-ink-muted">{cad(source.amount_cents)} {howOften(source)} · into {accountName(source.account_id)}</p>
                  <p className="tabular text-xs text-ink-subtle">About {cad(source.monthly_cents)} a month</p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button type="button" aria-label={`Edit ${source.name}`} onClick={() => { setError(""); setEditing(source); }} className="grid size-11 place-items-center rounded-lg text-ink-subtle hover:bg-sage-soft hover:text-ink"><Pencil className="size-4" aria-hidden="true" /></button>
                  <button type="button" aria-label={confirmDelete === source.id ? `Tap again to remove ${source.name}` : `Remove ${source.name}`} onClick={() => void remove(source)} onBlur={() => setConfirmDelete(null)} className={cn("grid h-11 place-items-center rounded-lg px-2.5 text-ink-subtle hover:bg-danger-soft hover:text-danger", confirmDelete === source.id && "bg-danger-soft text-danger")}>
                    {confirmDelete === source.id ? <span className="text-xs font-semibold">Remove?</span> : <Trash2 className="size-4" aria-hidden="true" />}
                  </button>
                </div>
              </div>
              {source.upcoming.length > 0 && (
                <p className="mt-2 flex flex-wrap gap-1.5 pl-5.5">
                  {source.upcoming.map((day) => <span key={day} className="rounded-full bg-sage-soft px-2 py-0.5 text-xs text-ink-muted">{formatShortDate(day)}</span>)}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {error && <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      <Button variant={sources.length ? "outline" : "default"} className="w-full sm:w-auto" onClick={() => { setError(""); setEditing("new"); }}><Plus className="size-4" aria-hidden="true" />{sources.length ? "Add another pay" : "Add your pay"}</Button>

      <Dialog open={editing !== null} onOpenChange={(open) => { if (!open) setEditing(null); }}>
        <DialogContent>
          {editing !== null && <PayForm dashboard={dashboard} source={editing === "new" ? null : editing} save={save} onDone={() => setEditing(null)} />}
        </DialogContent>
      </Dialog>
    </section>
  );
}

/** Add or edit one source of pay. The next paydays preview updates as the schedule changes. */
function PayForm({ dashboard, source, save, onDone }: { dashboard: Dashboard; source: PaySource | null; save: SaveChange; onDone: () => void }) {
  const today = dashboard.money_calendar.today ?? new Date().toISOString().slice(0, 10);
  const [name, setName] = useState(source?.name ?? (dashboard.pay ? "" : "Paycheque"));
  const [amount, setAmount] = useState(source ? centsToInput(String(source.amount_cents)) : "");
  const [frequency, setFrequency] = useState<PayFrequency>(source?.frequency ?? "biweekly");
  const [interval, setInterval] = useState(String(source?.interval_days ?? 18));
  const [nextPayday, setNextPayday] = useState(source?.next_payday ?? today);
  const [accountId, setAccountId] = useState(source?.account_id ?? dashboard.accounts.find((a) => a.account_type === "chequing")?.id ?? dashboard.accounts[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const days = Number(interval);
  const preview = frequency === "custom" && !(days >= 7 && days <= 62) ? [] : nextPaydays(frequency, nextPayday, days, 3);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    let cents: number;
    try { cents = parseCadToCents(amount); } catch { setError("Enter the take-home amount, like 640.00"); return; }
    if (cents <= 0) { setError("Enter the take-home amount, like 640.00"); return; }
    if (frequency === "custom" && !(days >= 7 && days <= 62)) { setError("Pick between 7 and 62 days"); return; }
    const body: PayScheduleWrite = { name: name.trim() || "Paycheque", amount_cents: cents, account_id: accountId, frequency, next_payday: nextPayday, interval_days: frequency === "custom" ? days : null };
    setBusy(true);
    const failed = await save(() => (source ? dashboardApi.updatePay(source.id, body) : dashboardApi.addPay(body)), source ? `${body.name} saved` : `${body.name} added`);
    setBusy(false);
    if (failed) { setError(failed); return; }
    onDone();
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{source ? `Edit ${source.name}` : "Add pay"}</DialogTitle>
        <DialogDescription>A job, a scholarship, student loans, an allowance: anything that comes in on a schedule.</DialogDescription>
      </DialogHeader>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Name">{(props) => <Input {...props} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Bookstore job" maxLength={80} className="min-h-11 text-base" />}</Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Take-home amount">{(props) => (
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle" aria-hidden="true">$</span>
              <Input {...props} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" required className="min-h-11 pl-7 text-base tabular" />
            </div>
          )}</Field>
          <Field label="How often">{(props) => <Select {...props} value={frequency} onChange={(e) => setFrequency(e.target.value as PayFrequency)} className="min-h-11 text-base">{FREQUENCIES.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}</Select>}</Field>
          {frequency === "custom" && <Field label="Days between paydays">{(props) => <Input {...props} type="number" min={7} max={62} value={interval} onChange={(e) => setInterval(e.target.value)} className="min-h-11 text-base" />}</Field>}
          <Field label="Next payday">{(props) => <DatePicker id={props.id} value={nextPayday} onChange={setNextPayday} />}</Field>
          <Field label="Paid into">{(props) => <Select {...props} value={accountId} onChange={(e) => setAccountId(e.target.value)} className="min-h-11 text-base">{dashboard.accounts.filter(isOwnAccount).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>}</Field>
        </div>
        {preview.length > 0 && (
          <div aria-live="polite">
            <p className="text-xs font-semibold text-ink-subtle">Next paydays</p>
            <p className="mt-1 flex flex-wrap gap-1.5">{preview.map((day) => <span key={day} className="rounded-full bg-sage-soft px-2.5 py-1 text-xs font-medium text-ink">{formatShortDate(day)}</span>)}</p>
          </div>
        )}
        {error && <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="ghost" disabled={busy} onClick={onDone}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? "Saving…" : source ? "Save" : "Add pay"}</Button>
        </div>
      </form>
    </>
  );
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const lastDay = (year: number, month: number) => new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

/**
 * "Payday!" for each payday from the last week with no paycheque recorded: one tap opens
 * "I got paid". Hidden while a past month is shown (it's about today).
 */
export function PaydayPrompt({ dashboard, save }: { dashboard: Dashboard; save: SaveChange }) {
  const [open, setOpen] = useState<UpcomingPay | null>(null);
  const today = dashboard.money_calendar.today;
  const items = today ? dashboard.pay?.to_confirm ?? [] : [];
  // Recording the paycheque removes its prompt; the dialog stays open for the check-in.
  if (items.length === 0 && !open) return null;
  return (
    <section aria-label="Payday" className={cn("space-y-2.5", items.length === 0 && "hidden")}>
      {items.map((item) => (
        <div key={`${item.pay_id}:${item.on}`} className="flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] border border-money-in/30 bg-money-in-soft p-4 animate-enter">
          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-surface text-xl" aria-hidden="true">💰</span>
          <div className="min-w-0 flex-1 basis-48">
            <p className="font-semibold text-ink">{item.on === today ? "It’s payday!" : `Payday was ${formatShortDate(item.on)}`}</p>
            <p className="tabular text-sm text-ink-muted">{item.name} · usually {cad(item.amount_cents)}. Did it land?</p>
          </div>
          <Button className="min-h-11 w-full shrink-0 sm:w-auto" onClick={() => setOpen(item)}><Check className="size-4" aria-hidden="true" />I got paid</Button>
        </div>
      ))}
      <Dialog open={open !== null} onOpenChange={(value) => { if (!value) setOpen(null); }}>
        <DialogContent>
          {open && <GotPaidForm dashboard={dashboard} payday={open} save={save} onDone={() => setOpen(null)} />}
        </DialogContent>
      </Dialog>
    </section>
  );
}

/** Record one paycheque: what actually landed (it can differ from the usual), and when. Then
 * the payday check-in. */
function GotPaidForm({ dashboard, payday, save, onDone }: { dashboard: Dashboard; payday: UpcomingPay; save: SaveChange; onDone: () => void }) {
  const [landed, setLanded] = useState<number | null>(null);
  if (landed !== null) return <PaydayCheckIn dashboard={dashboard} amountCents={landed} payId={payday.pay_id} save={save} onDone={onDone} />;
  return <GotPaidFields dashboard={dashboard} payday={payday} save={save} onDone={onDone} onRecorded={setLanded} />;
}

function GotPaidFields({ dashboard, payday, save, onDone, onRecorded }: { dashboard: Dashboard; payday: UpcomingPay; save: SaveChange; onDone: () => void; onRecorded: (cents: number) => void }) {
  const today = dashboard.money_calendar.today ?? isoToday();
  const source = dashboard.pay?.sources.find((item) => item.id === payday.pay_id);
  const account = dashboard.accounts.find((item) => item.id === source?.account_id)?.name ?? "your account";
  const [amount, setAmount] = useState(centsToInput(String(payday.amount_cents)));
  const [on, setOn] = useState(payday.on <= today ? payday.on : today);
  const [inBalance, setInBalance] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    let cents: number;
    try { cents = parseCadToCents(amount); } catch { setError("Enter what landed, like 1264.00"); return; }
    if (cents <= 0) { setError("Enter what landed, like 1264.00"); return; }
    setBusy(true);
    const result = await save(() => dashboardApi.recordPay(payday.pay_id, { occurred_on: on, amount_cents: cents, affect_balance: !inBalance }), `${payday.name} added`);
    setBusy(false);
    if (result) setError(result); else onRecorded(cents);
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      <DialogHeader>
        <DialogTitle>I got paid</DialogTitle>
        <DialogDescription>{payday.name} goes in as income on {account}. Change the amount if this one was different.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Amount that landed (CAD)">{(props) => <Input {...props} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="min-h-11 text-base tabular" />}</Field>
        <Field label="When it arrived">{(props) => <DatePicker id={props.id} value={on} max={today} onChange={setOn} />}</Field>
      </div>
      <label className={cn("flex min-h-14 cursor-pointer items-center gap-3 rounded-2xl border px-3 py-2 transition-colors", inBalance ? "border-info/40 bg-info-soft/40" : "border-line")}>
        <input type="checkbox" checked={inBalance} onChange={(event) => setInBalance(event.target.checked)} className="size-5 shrink-0 accent-[var(--color-accent)]" />
        <span className="min-w-0"><span className="flex items-center gap-1.5 text-sm font-semibold text-ink"><History className="size-4 text-info" aria-hidden="true" />Already in my balance</span><span className="block text-xs text-ink-subtle">Just record it. {account}’s balance won’t change.</span></span>
      </label>
      {error && <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" className="min-h-11 flex-1" disabled={busy}>Add paycheque</Button>
        <Button type="button" variant="ghost" className="min-h-11" onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}

/**
 * The first `count` paydays on or after `anchor`, for the form's preview only (dates, no money).
 * Matches the server's rules (app/domain/pay_cycle.py): semimonthly is the 15th and the last
 * day; monthly keeps the anchor's day, or the month's last day when it's shorter.
 */
function nextPaydays(frequency: PayFrequency, anchor: string, intervalDays: number, count: number): string[] {
  const start = new Date(`${anchor}T00:00:00Z`);
  if (Number.isNaN(start.getTime())) return [];
  const days: string[] = [];
  if (frequency === "semimonthly") {
    for (let m = 0; days.length < count && m < 24; m += 1) {
      const y = start.getUTCFullYear(), mo = start.getUTCMonth() + m;
      for (const d of [15, lastDay(y, mo)]) {
        const candidate = new Date(Date.UTC(y, mo, d));
        if (candidate >= start && days.length < count) days.push(iso(candidate));
      }
    }
    return days;
  }
  if (frequency === "monthly") {
    for (let m = 0; m < count; m += 1) {
      const y = start.getUTCFullYear(), mo = start.getUTCMonth() + m;
      days.push(iso(new Date(Date.UTC(y, mo, Math.min(start.getUTCDate(), lastDay(y, mo))))));
    }
    return days;
  }
  const step = frequency === "weekly" ? 7 : frequency === "biweekly" ? 14 : intervalDays;
  for (let i = 0; i < count; i += 1) days.push(iso(new Date(start.getTime() + i * step * 86_400_000)));
  return days;
}
