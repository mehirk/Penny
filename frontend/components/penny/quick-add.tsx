"use client";

import { useState } from "react";
import { LoaderCircle, Sparkles, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { shortDateLabel } from "@/components/ui/date-picker";
import { assistApi, type BillFrequency, type Dashboard, type ParsedTransaction, type TransactionWrite } from "@/lib/api";
import { cn } from "@/lib/utils";
import { FormError, type Submit } from "./form-parts";
import { type QuickPick, usualAccount } from "./habits";
import { categoryOptions } from "./labels";
import { cad } from "./shared";
import { KIND_STYLE } from "./transaction-form";

const FREQUENCY_WORDS: Record<BillFrequency, string> = { weekly: "weekly", biweekly: "every 2 weeks", monthly: "monthly", yearly: "yearly" };

/** Plain-language notes ("lunch 14 friday", one or several) read into transactions to review. */
export function QuickAdd({ onParsed, filled }: { onParsed: (items: ParsedTransaction[]) => void; filled: ParsedTransaction | null }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const hintId = "quick-add-hint";

  async function read() {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const { items } = await assistApi.parseTransactions(text.trim().slice(0, 1000));
      if (items.length === 0) setError("Penny couldn’t find a transaction in that. Try “coffee 4.50 yesterday”.");
      else onParsed(items);
    } catch {
      setError("Penny couldn’t read that. Fill in the form below instead.");
    } finally {
      setBusy(false);
    }
  }

  const repeat = filled?.repeat && filled.kind === "spending" ? filled.repeat : null;
  return (
    <div className="rounded-2xl border border-accent/30 bg-accent-soft/50 p-3">
      <label htmlFor="quick-add" className="flex items-center gap-1.5 text-sm font-semibold text-ink"><Wand2 className="size-4 text-accent-strong" aria-hidden="true" />Type it in plain words</label>
      <div className="mt-2 flex items-start gap-2">
        <textarea
          id="quick-add"
          value={text}
          rows={text.includes("\n") ? Math.min(6, text.split("\n").length + 1) : 2}
          maxLength={1000}
          enterKeyHint="go"
          aria-describedby={hintId}
          placeholder="coffee 4.50 yesterday; phone bill 65 every 2nd of the month"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void read(); } }}
          className="min-h-[5.75rem] min-w-0 flex-1 resize-none rounded-xl border border-line bg-surface px-3 py-2.5 text-base text-ink sm:min-h-11 sm:text-sm placeholder:text-ink-subtle focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15"
        />
        <Button type="button" onClick={() => void read()} disabled={busy || !text.trim()} className="shrink-0">
          {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <Sparkles className="size-4" aria-hidden="true" />}Fill in
        </Button>
      </div>
      <p id={hintId} role="status" className={cn("mt-1.5 text-xs", error ? "text-danger" : "text-ink-subtle")}>
        {error || (filled
          ? `Filled in ${filled.source === "ai" ? "by Penny AI" : "from your note"}${repeat ? `, set to repeat ${FREQUENCY_WORDS[repeat.frequency]} (next ${shortDateLabel(repeat.next_due)})` : ""}. Review it below, then add it.`
          : <>Add one, or several separated by ; or a new line<span className="max-sm:hidden"> (Shift+Enter)</span>. Nothing saves until you review it.</>)}
      </p>
    </div>
  );
}

/** Recent purchases as chips: one tap fills the form with it again, dated today. */
export function QuickPicks({ picks, selected, onPick }: { picks: QuickPick[]; selected: string | null; onPick: (pick: QuickPick) => void }) {
  if (picks.length === 0) return null;
  return (
    <div>
      <p id="quick-picks-label" className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-subtle">Again?</p>
      <ul aria-labelledby="quick-picks-label" className="mt-2 flex flex-wrap gap-2">
        {picks.map((pick) => {
          const on = selected === pick.description;
          return (
            <li key={pick.description}>
              <button type="button" aria-pressed={on} onClick={() => onPick(pick)} className={cn("inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold transition-colors", on ? "border-accent bg-accent-soft text-accent-strong" : "border-line text-ink-muted hover:bg-sage-soft hover:text-ink")}>
                {pick.description}<span className="tabular font-normal">{cad(pick.amount_cents)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** One entry read from a note, shown whole and added with one tap; "Edit details" opens the form. */
export function QuickConfirm({ parsed, dashboard, onSubmit, onEdit }: { parsed: ParsedTransaction & { amount_cents: number }; dashboard: Dashboard; onSubmit: Submit<TransactionWrite>; onEdit: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const style = KIND_STYLE[parsed.kind];
  const accountId = usualAccount(dashboard, parsed.kind);
  const account = dashboard.accounts.find((item) => item.id === accountId);
  const category = categoryOptions(dashboard.categories, parsed.kind).find((option) => option.id === parsed.category_id);
  const repeat = parsed.kind === "spending" ? parsed.repeat : null;
  const details = [category?.label ?? "Uncategorized", account?.name, shortDateLabel(parsed.occurred_on), repeat && `repeats ${FREQUENCY_WORDS[repeat.frequency]}`].filter(Boolean).join(" · ");

  async function add() {
    setBusy(true);
    setError("");
    const message = await onSubmit({
      description: parsed.description,
      account_id: accountId,
      category_id: category?.id ?? null,
      amount_cents: parsed.amount_cents,
      kind: parsed.kind,
      occurred_on: parsed.occurred_on,
      repeat: repeat ? { frequency: repeat.frequency, next_due: repeat.next_due, auto_record: true } : null,
    });
    setBusy(false);
    if (message) setError(message);
  }

  return (
    <div className="rounded-2xl border border-line p-4">
      <p className={cn("text-3xl font-semibold", style.text)}><span className="tabular">{style.sign}{cad(parsed.amount_cents)}</span></p>
      <p className="mt-1 font-semibold text-ink">{parsed.description}</p>
      <p className="mt-0.5 text-sm text-ink-subtle">{details}</p>
      {error && <div className="mt-3"><FormError message={error} /></div>}
      <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row">
        <Button variant="outline" onClick={onEdit} disabled={busy}>Edit details</Button>
        <Button onClick={() => void add()} disabled={busy} className={cn("min-h-12 flex-1", style.button)}>
          {busy && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
          {parsed.kind === "income" ? "Add money in" : "Add money out"}
        </Button>
      </div>
    </div>
  );
}
