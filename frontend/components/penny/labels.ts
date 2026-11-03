import type { AccountType, Category } from "@/lib/api";

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = { chequing: "Chequing", savings: "Savings", credit: "Credit card", cash: "Cash", investment: "Investment", other: "Other", person: "Friend" };

/** Account types money can be kept in (not a friend's IOU), for "Paid from", goals, and setup. */
export const isOwnAccount = (account: { account_type: AccountType }) => account.account_type !== "person";

/** A friend's balance in words: positive, they owe you; negative, you owe them. */
export function friendStatus(balanceCents: number): string {
  if (balanceCents > 0) return "Owes you";
  return balanceCents < 0 ? "You owe" : "All settled up";
}

/** The transfer that settles up with a friend: pay them what you owe, or record them paying you back. */
export function settleUp(accounts: { id: string; account_type: AccountType }[], friendId: string, balanceCents: number): { from?: string; to?: string; amountCents: number } {
  const home = accounts.find((account) => account.account_type === "chequing")?.id;
  return balanceCents < 0 ? { from: home, to: friendId, amountCents: -balanceCents } : { from: friendId, to: home, amountCents: balanceCents };
}

/** Categories for one kind, with subcategories listed under their parent ("Food › Groceries"). */
export function categoryOptions(categories: Category[], kind: Category["kind"]): { id: string; label: string }[] {
  const own = categories.filter((category) => category.kind === kind);
  return own.filter((category) => !category.parent_id).flatMap((parent) => [
    { id: parent.id, label: parent.name },
    ...own.filter((child) => child.parent_id === parent.id).map((child) => ({ id: child.id, label: `${parent.name} › ${child.name}` })),
  ]);
}
