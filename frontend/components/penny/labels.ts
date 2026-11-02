import type { AccountType, Category } from "@/lib/api";

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = { chequing: "Chequing", savings: "Savings", credit: "Credit card", cash: "Cash", investment: "Investment", other: "Other" };

/** Categories for one kind, with subcategories listed under their parent ("Food › Groceries"). */
export function categoryOptions(categories: Category[], kind: Category["kind"]): { id: string; label: string }[] {
  const own = categories.filter((category) => category.kind === kind);
  return own.filter((category) => !category.parent_id).flatMap((parent) => [
    { id: parent.id, label: parent.name },
    ...own.filter((child) => child.parent_id === parent.id).map((child) => ({ id: child.id, label: `${parent.name} › ${child.name}` })),
  ]);
}
