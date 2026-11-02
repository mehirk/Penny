import type { Dashboard, Transaction } from "@/lib/api";
import { isOwnAccount } from "./labels";

/** A recent purchase that one tap fills the form with again. */
export type QuickPick = { description: string; amount_cents: number; category_id: string | null; account_id: string };

/** Entries the user typed in themselves; bill payments record themselves from the bill's account. */
const ownEntries = (dashboard: Dashboard, kind: Transaction["kind"]) =>
  dashboard.transactions.filter((item) => item.kind === kind && !item.bill_id);

/** The account the user last recorded this kind of transaction in (the API lists newest first), else chequing. */
export function usualAccount(dashboard: Dashboard, kind: Transaction["kind"]): string {
  // A purchase a friend paid for is theirs to pay, not a habit to repeat.
  const accounts = new Set(dashboard.accounts.filter(isOwnAccount).map((account) => account.id));
  const last = ownEntries(dashboard, kind).find((item) => accounts.has(item.account_id));
  return last?.account_id ?? dashboard.accounts.find((account) => account.account_type === "chequing")?.id ?? dashboard.accounts[0]?.id ?? "";
}

/** The purchases made most often in the period shown (newest first on a tie), each as last made. */
export function recentPurchases(dashboard: Dashboard, limit = 5): QuickPick[] {
  const accounts = new Set(dashboard.accounts.filter(isOwnAccount).map((account) => account.id));
  const byName = new Map<string, { pick: QuickPick; count: number; order: number }>();
  ownEntries(dashboard, "spending").forEach((item, order) => {
    if (!accounts.has(item.account_id)) return;
    const key = item.description.trim().toLocaleLowerCase("en-CA");
    const seen = byName.get(key);
    if (seen) seen.count += 1;
    else byName.set(key, { pick: { description: item.description, amount_cents: item.amount_cents, category_id: item.category_id, account_id: item.account_id }, count: 1, order });
  });
  return [...byName.values()].sort((a, b) => b.count - a.count || a.order - b.order).slice(0, limit).map((entry) => entry.pick);
}
