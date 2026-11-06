"use client";

import { useState } from "react";
import { CalendarPlus, Check, EyeOff, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { calendarApi, type CalendarReminder, type Dashboard } from "@/lib/api";
import { isNativeApp } from "@/lib/native";
import { cn } from "@/lib/utils";
import { describeError, Field } from "./shared";

const REMINDERS: { value: CalendarReminder; label: string }[] = [
  { value: "day_before", label: "The day before, at 9 a.m." },
  { value: "same_day", label: "On the day, at 9 a.m." },
  { value: "none", label: "No reminder" },
];

const FILE_NAME = "penny-money-dates.ics";

/** Hands the .ics file to the device: Safari (which offers Add All) in the iOS app, a download in a browser. */
async function openCalendarFile(url: string): Promise<void> {
  if (isNativeApp()) {
    window.location.href = url;
    return;
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error("The calendar file has expired. Try again.");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(await response.blob());
  link.download = FILE_NAME;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
}

/**
 * Settings › Add to calendar: one-way. Penny makes a calendar file of the next six months of
 * bills, card payments, and paydays; it never reads the user's calendar.
 */
export function CalendarSection({ dashboard }: { dashboard: Dashboard }) {
  const counts = { bills: dashboard.bills.length, cards: dashboard.card_payments.length, pay: dashboard.pay?.sources.length ?? 0 };
  const [kinds, setKinds] = useState({ bills: counts.bills > 0, cards: counts.cards > 0, pay: counts.pay > 0 });
  const [showAmounts, setShowAmounts] = useState(true);
  const [reminder, setReminder] = useState<CalendarReminder>("day_before");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [added, setAdded] = useState("");
  const nothing = !counts.bills && !counts.cards && !counts.pay;

  async function add() {
    if (!kinds.bills && !kinds.cards && !kinds.pay) { setError("Pick at least one kind of date"); return; }
    setBusy(true);
    setError("");
    setAdded("");
    try {
      const result = await calendarApi.export({ ...kinds, show_amounts: showAmounts, reminder });
      await openCalendarFile(calendarApi.fileUrl(result.path));
      const dates = `${result.event_count} date${result.event_count === 1 ? "" : "s"}`;
      setAdded(isNativeApp() ? `${dates} ready. In Safari, tap Add All to put them in your calendar.` : `Downloaded ${FILE_NAME} with ${dates}. Open it to add them to your calendar.`);
    } catch (reason) {
      setError(describeError(reason, "Couldn’t make the calendar file").detail);
    } finally {
      setBusy(false);
    }
  }

  const options: { key: keyof typeof kinds; label: string; count: number }[] = [
    { key: "bills", label: "Bills and subscriptions", count: counts.bills },
    { key: "cards", label: "Credit card payments", count: counts.cards },
    { key: "pay", label: "Paydays", count: counts.pay },
  ];

  return (
    <section aria-labelledby="calendar-title" className="space-y-5">
      <p className="text-sm text-ink-muted">Put your next six months of money dates in your phone’s calendar, with a reminder so nothing sneaks up on you.</p>
      {nothing ? (
        <p className="rounded-2xl bg-sage-soft p-4 text-sm text-ink-muted">Nothing to add yet. Add a bill, a credit card’s due date, or your pay, then come back.</p>
      ) : (
        <>
          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-semibold text-ink">What to add</legend>
            {options.map(({ key, label, count }) => (
              <label key={key} className={cn("flex min-h-12 items-center gap-3 rounded-2xl border px-3 py-2", count ? "cursor-pointer border-line" : "border-line opacity-60")}>
                <input type="checkbox" checked={kinds[key]} disabled={!count} onChange={(event) => setKinds((current) => ({ ...current, [key]: event.target.checked }))} className="size-5 shrink-0 accent-[var(--color-accent)]" />
                <span className="flex-1 text-sm font-medium text-ink">{label}</span>
                <span className="tabular text-xs text-ink-subtle">{count ? `${count} set up` : "None yet"}</span>
              </label>
            ))}
          </fieldset>

          <label className={cn("flex min-h-14 cursor-pointer items-center gap-3 rounded-2xl border px-3 py-2", !showAmounts ? "border-info/40 bg-info-soft/40" : "border-line")}>
            <input type="checkbox" checked={!showAmounts} onChange={(event) => setShowAmounts(!event.target.checked)} className="size-5 shrink-0 accent-[var(--color-accent)]" />
            <span className="min-w-0"><span className="flex items-center gap-1.5 text-sm font-semibold text-ink"><EyeOff className="size-4 text-info" aria-hidden="true" />Hide amounts</span><span className="block text-xs text-ink-subtle">Your calendar shows “Rent due”, not how much.</span></span>
          </label>

          <Field label="Reminder">{(props) => <Select {...props} value={reminder} onChange={(event) => setReminder(event.target.value as CalendarReminder)} className="min-h-11 text-base">{REMINDERS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</Select>}</Field>

          {error && <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
          {added && <p role="status" className="flex items-start gap-2 rounded-xl bg-money-in-soft px-3 py-2 text-sm text-ink"><Check className="mt-0.5 size-4 shrink-0 text-money-in" aria-hidden="true" />{added}</p>}
          <Button className="min-h-11 w-full sm:w-auto" disabled={busy} onClick={() => void add()}><CalendarPlus className="size-4" aria-hidden="true" />{busy ? "Making your file…" : "Add to calendar"}</Button>
        </>
      )}
      <p className="flex items-start gap-2 text-xs text-ink-subtle"><ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />One-way: Penny adds dates and never sees your calendar. The file’s link works for 10 minutes. If your dates change in Penny, add them again.</p>
    </section>
  );
}
