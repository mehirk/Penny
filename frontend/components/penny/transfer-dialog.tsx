"use client";

import { createContext, useContext, useState } from "react";
import { ArrowDown, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/input";
import type { Dashboard, Transfer, TransferWrite } from "@/lib/api";
import { centsToInput, parseCadToCents } from "@/lib/money";
import { cad, Field } from "./shared";

/** What to open the form with, for example "move $611 from Savings to Chequing" or "pay the Visa". */
export type TransferPrefill = { from?: string; to?: string; amountCents?: number };

/**
 * Move money between your own accounts, or pay a credit card. Penny records what was done in the
 * bank; it never moves real money. Not spending or income, so budgets and Safe to spend stay put.
 */
export function TransferDialog({
  dashboard,
  prefill,
  onClose,
  onSave,
}: {
  dashboard: Dashboard;
  prefill: TransferPrefill | null;
  onClose: () => void;
  onSave: (body: TransferWrite) => Promise<string | null>;
}) {
  return (
    <Dialog
      open={prefill !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        {prefill && <TransferForm dashboard={dashboard} prefill={prefill} onClose={onClose} onSave={onSave} />}
      </DialogContent>
    </Dialog>
  );
}

function TransferForm({
  dashboard,
  prefill,
  onClose,
  onSave,
}: {
  dashboard: Dashboard;
  prefill: TransferPrefill;
  onClose: () => void;
  onSave: (body: TransferWrite) => Promise<string | null>;
}) {
  const today = dashboard.money_calendar.today ?? new Date().toISOString().slice(0, 10);
  const accounts = dashboard.accounts;
  const sources = accounts.filter((a) => a.account_type !== "credit");
  const firstOther = (not?: string) => accounts.find((a) => a.id !== not)?.id ?? "";
  const [from, setFrom] = useState(
    prefill.from ?? sources.find((a) => a.account_type === "savings")?.id ?? sources[0]?.id ?? "",
  );
  const [to, setTo] = useState(
    prefill.to ??
      sources.find((a) => a.account_type === "chequing" && a.id !== (prefill.from ?? ""))?.id ??
      firstOther(prefill.from),
  );
  const [amount, setAmount] = useState(prefill.amountCents ? centsToInput(String(prefill.amountCents)) : "");
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const source = accounts.find((a) => a.id === from);
  const target = accounts.find((a) => a.id === to);
  const card = target?.account_type === "credit";
  const friend = [source, target].find((account) => account?.account_type === "person");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    let cents: number;
    try {
      cents = parseCadToCents(amount);
    } catch {
      setError("Enter an amount, like 611.00");
      return;
    }
    if (cents <= 0) {
      setError("Enter an amount above $0");
      return;
    }
    if (from === to) {
      setError("Pick two different accounts");
      return;
    }
    setBusy(true);
    setError("");
    const failed = await onSave({
      from_account_id: from,
      to_account_id: to,
      amount_cents: cents,
      occurred_on: date,
      note: note.trim() || null,
    });
    setBusy(false);
    if (failed) setError(failed);
    else onClose();
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {friend ? `Settle up with ${friend.name}` : card ? `Pay ${target?.name}` : "Move money"}
        </DialogTitle>
        <DialogDescription>
          {friend
            ? "Paying a friend back, or being paid back, isn’t spending: your share of what you split already counted."
            : card
              ? "A card payment lowers what you owe. Your purchases already counted as spending, so this doesn’t count again."
              : "Between your own accounts. It isn’t spending, so your budget and Safe to spend don’t change."}
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={submit} className="space-y-4">
        <Field label="From">
          {(props) => (
            <Select {...props} value={from} onChange={(e) => setFrom(e.target.value)} className="min-h-11 text-base">
              {sources.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} · {cad(a.balance_cents)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="-my-2 flex justify-center text-ink-subtle" aria-hidden="true">
          <ArrowDown className="size-4" />
        </div>
        <Field label="To">
          {(props) => (
            <Select {...props} value={to} onChange={(e) => setTo(e.target.value)} className="min-h-11 text-base">
              {accounts
                .filter((a) => a.id !== from)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} · {a.account_type === "credit" ? `${cad(a.balance_cents)} owed` : cad(a.balance_cents)}
                  </option>
                ))}
            </Select>
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Amount">
            {(props) => (
              <div className="relative">
                <span
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle"
                  aria-hidden="true"
                >
                  $
                </span>
                <Input
                  {...props}
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  required
                  className="min-h-11 pl-7 text-base tabular"
                />
              </div>
            )}
          </Field>
          <Field label="Date">
            {(props) => <DatePicker id={props.id} value={date} max={today} onChange={setDate} />}
          </Field>
        </div>
        {card && target && target.balance_cents > 0 && (
          <button
            type="button"
            onClick={() => setAmount(centsToInput(String(target.balance_cents)))}
            className="min-h-11 rounded-full border border-line px-3 text-sm font-medium text-ink-muted hover:border-accent hover:text-ink"
          >
            Pay the full {cad(target.balance_cents)} (avoids interest)
          </button>
        )}
        <Field label="Note (optional)">
          {(props) => (
            <Input
              {...props}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={120}
              placeholder={card ? "e.g. November statement" : "e.g. For rent"}
              className="min-h-11 text-base"
            />
          )}
        </Field>
        <p className="flex gap-2 rounded-xl bg-sage-soft p-3 text-xs text-ink-muted">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          Penny records this so your balances stay right. It doesn’t move real money: make the{" "}
          {card || friend ? "payment" : "transfer"} in your bank app too.
        </p>
        {error && (
          <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || !source || !target}>
            {busy ? "Saving…" : card ? "Record payment" : "Record transfer"}
          </Button>
        </div>
      </form>
    </>
  );
}

/** Lets any screen open the transfer form (the app shell provides it). */
export const TransferContext = createContext<{
  openTransfer: (prefill: TransferPrefill) => void;
  deleteTransfer: (transfer: Transfer) => void;
} | null>(null);
export const useTransfers = () => useContext(TransferContext);
