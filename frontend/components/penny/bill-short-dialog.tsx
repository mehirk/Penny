"use client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Bill, Dashboard } from "@/lib/api";
import { cad } from "./shared";
import type { TransferPrefill } from "./transfer-dialog";

/**
 * A bill's account doesn't have enough to pay it: move money in first (recommended), or pay it
 * from another account this once. Penny only records it either way.
 */
export function BillShortDialog({ dashboard, bill, onClose, onTransfer, onPayFrom, onRecordOnly }: { dashboard: Dashboard; bill: Bill | null; onClose: () => void; onTransfer: (prefill: TransferPrefill) => void; onPayFrom: (bill: Bill, accountId: string) => void; onRecordOnly: (bill: Bill) => void }) {
  const account = bill ? dashboard.accounts.find((a) => a.id === bill.account_id) : undefined;
  // Money a friend owes you isn't there to pay with.
  const others = bill ? dashboard.accounts.filter((a) => a.id !== bill.account_id && a.account_type !== "credit" && a.account_type !== "person" && a.balance_cents >= bill.amount_cents) : [];
  const short = bill && account ? Math.max(0, bill.amount_cents - account.balance_cents) : 0;
  const richest = [...others].sort((a, b) => (a.account_type === "savings" ? 0 : 1) - (b.account_type === "savings" ? 0 : 1) || b.balance_cents - a.balance_cents)[0];
  return (
    <Dialog open={bill !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        {bill && account && (
          <>
            <DialogHeader>
              <DialogTitle>Not enough in {account.name}</DialogTitle>
              <DialogDescription>{bill.name} is {cad(bill.amount_cents)}, and {account.name} has {cad(account.balance_cents)}.</DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Button className="w-full" onClick={() => onTransfer({ from: richest?.id, to: account.id, amountCents: short })}>Move {cad(short)} into {account.name} first</Button>
              {others.map((other) => (
                <Button key={other.id} variant="outline" className="w-full" onClick={() => onPayFrom(bill, other.id)}>Pay from {other.name} this time</Button>
              ))}
              <Button variant="outline" className="w-full" onClick={() => onRecordOnly(bill)}>I already paid it: just record it</Button>
              <Button variant="ghost" className="w-full" onClick={onClose}>Cancel</Button>
            </div>
            <p className="text-xs text-ink-subtle">Penny records what you do in your bank. It doesn’t move real money.</p>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
