"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ListPlus, Wand2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Dashboard, ParsedTransaction, Transaction, TransactionWrite } from "@/lib/api";
import { defaultTransactionDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Submit } from "./form-parts";
import { type QuickPick, recentPurchases } from "./habits";
import type { InlineCreate } from "./inline-create";
import { QuickAdd, QuickConfirm, QuickPicks } from "./quick-add";
import type { SharedDraft } from "./split-with-friends";
import { BatchReview, type Draft, draftFrom } from "./transaction-batch";
import { type TransactionBody, TransactionForm, type TransactionPrefill } from "./transaction-form";

/** What the transaction dialog opens on: a new entry, one shared with friends, or an edit. */
export type TransactionTarget = Transaction | "new" | { share: SharedDraft };

export function TransactionDialog({
  target,
  dashboard,
  onClose,
  onSubmit,
  onSubmitMany,
  onRequestDelete,
  onCreate,
}: {
  target: TransactionTarget | null;
  dashboard: Dashboard;
  onClose: () => void;
  onSubmit: (id: string | null, body: TransactionBody) => Promise<string | null>;
  onSubmitMany: (bodies: TransactionWrite[]) => Promise<{ error: string | null; saved: number }>;
  onRequestDelete: (item: Transaction) => void;
  onCreate: InlineCreate;
}) {
  const item = target && target !== "new" && !("share" in target) ? target : null;
  const share = target && target !== "new" && "share" in target ? target.share : undefined;
  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{item ? "Edit transaction" : "Add transactions"}</DialogTitle>
          <DialogDescription>
            {item
              ? "Totals recalculate as soon as you save."
              : "Type it like a note and Penny fills it in, or add it by hand."}
          </DialogDescription>
        </DialogHeader>
        {item ? (
          <TransactionForm
            key={item.id}
            item={item}
            dashboard={dashboard}
            onCreate={onCreate}
            onSubmit={(body) => onSubmit(item.id, body)}
            onRequestDelete={() => onRequestDelete(item)}
          />
        ) : (
          target && (
            <NewTransactions
              dashboard={dashboard}
              share={share}
              onCreate={onCreate}
              onSubmit={(body) => onSubmit(null, body)}
              onSubmitMany={onSubmitMany}
            />
          )
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * New transactions open on the form, with recent purchases above it as one-tap chips that fill it
 * in again. "Quick AI add" expands above the form: one entry shows as a card to add in one tap (or
 * open in the form), several open a review list. The form can also switch to adding several by hand.
 */
function NewTransactions({
  dashboard,
  share,
  onSubmit,
  onSubmitMany,
  onCreate,
}: {
  dashboard: Dashboard;
  share?: SharedDraft;
  onSubmit: Submit<TransactionBody>;
  onSubmitMany: (bodies: TransactionWrite[]) => Promise<{ error: string | null; saved: number }>;
  onCreate: InlineCreate;
}) {
  const [mode, setMode] = useState<"form" | "batch">("form");
  const [quickOpen, setQuickOpen] = useState(false);
  const [prefill, setPrefill] = useState<TransactionPrefill | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  // The note Quick AI add last read, and its single entry when it can be added in one tap.
  const [fromNote, setFromNote] = useState<ParsedTransaction | null>(null);
  const [confirm, setConfirm] = useState<(ParsedTransaction & { amount_cents: number }) | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const picks = useMemo(() => recentPurchases(dashboard), [dashboard]);
  const today = defaultTransactionDate(dashboard.active_month, dashboard.money_calendar.today);

  function fill(next: TransactionPrefill) {
    setConfirm(null);
    setPrefill(next);
    setFormKey((key) => key + 1);
  }

  function onPick(item: QuickPick) {
    setPicked(item.description);
    setFromNote(null);
    fill({ ...item, kind: "spending", occurred_on: today, repeat: null });
  }

  function onParsed(items: ParsedTransaction[]) {
    if (items.length === 1) {
      const [only] = items;
      setPicked(null);
      setFromNote(only);
      // Without an amount there's nothing to add yet, so it goes to the form.
      if (only.amount_cents) setConfirm({ ...only, amount_cents: only.amount_cents });
      else fill(only);
    } else {
      setDrafts(items.map((parsed) => draftFrom(parsed, dashboard, today)));
      setMode("batch");
    }
  }

  if (mode === "batch") {
    return (
      <BatchReview
        dashboard={dashboard}
        drafts={drafts}
        onChange={setDrafts}
        onSubmitMany={onSubmitMany}
        onBack={() => {
          setDrafts([]);
          setMode("form");
        }}
        fallbackDate={today}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          aria-expanded={quickOpen}
          aria-controls="quick-add-panel"
          onClick={() => setQuickOpen(!quickOpen)}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-2 text-sm font-semibold text-accent-strong hover:bg-accent-soft"
        >
          <Wand2 className="size-4" aria-hidden="true" />
          Quick AI add
          <ChevronDown className={cn("size-4 transition-transform", quickOpen && "rotate-180")} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => {
            setDrafts([draftFrom(null, dashboard, today), draftFrom(null, dashboard, today)]);
            setMode("batch");
          }}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-2 text-sm font-semibold text-ink-muted hover:bg-sage-soft hover:text-ink"
        >
          <ListPlus className="size-4" aria-hidden="true" />
          Add several by hand
        </button>
      </div>
      <QuickPicks picks={picks} selected={picked} onPick={onPick} />
      {quickOpen && (
        <div id="quick-add-panel">
          <QuickAdd onParsed={onParsed} filled={fromNote} />
        </div>
      )}
      {confirm ? (
        <QuickConfirm parsed={confirm} dashboard={dashboard} onSubmit={onSubmit} onEdit={() => fill(confirm)} />
      ) : (
        <TransactionForm
          key={formKey}
          item={null}
          prefill={prefill}
          share={share}
          dashboard={dashboard}
          onCreate={onCreate}
          onSubmit={onSubmit}
        />
      )}
    </div>
  );
}
