"use client";

import { useState } from "react";
import { ChevronDown, ListPlus, Wand2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Dashboard, ParsedTransaction, SplitTransactionWrite, Transaction, TransactionWrite } from "@/lib/api";
import { defaultTransactionDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Submit } from "./form-parts";
import type { InlineCreate } from "./inline-create";
import { QuickAdd } from "./quick-add";
import { BatchReview, type Draft, draftFrom } from "./transaction-batch";
import { TransactionForm } from "./transaction-form";

export function TransactionDialog({ target, dashboard, onClose, onSubmit, onSubmitMany, onRequestDelete, onCreate }: {
  target: Transaction | "new" | null;
  dashboard: Dashboard;
  onClose: () => void;
  onSubmit: (id: string | null, body: TransactionWrite | SplitTransactionWrite) => Promise<string | null>;
  onSubmitMany: (bodies: TransactionWrite[]) => Promise<{ error: string | null; saved: number }>;
  onRequestDelete: (item: Transaction) => void;
  onCreate: InlineCreate;
}) {
  const item = target && target !== "new" ? target : null;
  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{item ? "Edit transaction" : "Add transactions"}</DialogTitle>
          <DialogDescription>{item ? "Totals recalculate as soon as you save." : "Type it like a note and Penny fills it in, or add it by hand."}</DialogDescription>
        </DialogHeader>
        {item
          ? <TransactionForm key={item.id} item={item} dashboard={dashboard} onCreate={onCreate} onSubmit={(body) => onSubmit(item.id, body)} onRequestDelete={() => onRequestDelete(item)} />
          : target === "new" && <NewTransactions dashboard={dashboard} onCreate={onCreate} onSubmit={(body) => onSubmit(null, body)} onSubmitMany={onSubmitMany} />}
      </DialogContent>
    </Dialog>
  );
}

/**
 * New transactions open on the form. "Quick AI add" expands above it: one entry fills the form
 * in for review; several open a review list. The form can also switch to adding several by hand.
 */
function NewTransactions({ dashboard, onSubmit, onSubmitMany, onCreate }: { dashboard: Dashboard; onSubmit: Submit<TransactionWrite | SplitTransactionWrite>; onSubmitMany: (bodies: TransactionWrite[]) => Promise<{ error: string | null; saved: number }>; onCreate: InlineCreate }) {
  const [mode, setMode] = useState<"form" | "batch">("form");
  const [quickOpen, setQuickOpen] = useState(false);
  const [prefill, setPrefill] = useState<ParsedTransaction | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const today = defaultTransactionDate(dashboard.active_month, dashboard.money_calendar.today);

  function onParsed(items: ParsedTransaction[]) {
    if (items.length === 1) {
      setPrefill(items[0]);
      setFormKey((key) => key + 1);
    } else {
      setDrafts(items.map((parsed) => draftFrom(parsed, dashboard, today)));
      setMode("batch");
    }
  }

  if (mode === "batch") {
    return <BatchReview dashboard={dashboard} drafts={drafts} onChange={setDrafts} onSubmitMany={onSubmitMany} onBack={() => { setDrafts([]); setMode("form"); }} fallbackDate={today} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" aria-expanded={quickOpen} aria-controls="quick-add-panel" onClick={() => setQuickOpen(!quickOpen)} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-2 text-sm font-semibold text-accent-strong hover:bg-accent-soft">
          <Wand2 className="size-4" aria-hidden="true" />Quick AI add<ChevronDown className={cn("size-4 transition-transform", quickOpen && "rotate-180")} aria-hidden="true" />
        </button>
        <button type="button" onClick={() => { setDrafts([draftFrom(null, dashboard, today), draftFrom(null, dashboard, today)]); setMode("batch"); }} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-2 text-sm font-semibold text-ink-muted hover:bg-sage-soft hover:text-ink">
          <ListPlus className="size-4" aria-hidden="true" />Add several by hand
        </button>
      </div>
      {quickOpen && <div id="quick-add-panel"><QuickAdd onParsed={onParsed} filled={prefill} /></div>}
      <TransactionForm key={formKey} item={null} prefill={prefill} dashboard={dashboard} onCreate={onCreate} onSubmit={onSubmit} />
    </div>
  );
}
