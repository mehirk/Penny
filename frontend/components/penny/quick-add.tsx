"use client";

import { useState } from "react";
import { LoaderCircle, Sparkles, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { shortDateLabel } from "@/components/ui/date-picker";
import { assistApi, type BillFrequency, type ParsedTransaction } from "@/lib/api";
import { cn } from "@/lib/utils";

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
