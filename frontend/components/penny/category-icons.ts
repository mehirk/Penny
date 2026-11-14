import {
  Bus,
  Coffee,
  Dumbbell,
  Gamepad2,
  GraduationCap,
  HeartPulse,
  Home,
  type LucideIcon,
  ShoppingCart,
  Smartphone,
  UtensilsCrossed,
  Wallet,
} from "lucide-react";
import type { Category, Transaction } from "@/lib/api";

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  "cat-housing": Home,
  "cat-food": UtensilsCrossed,
  "cat-groceries": ShoppingCart,
  "cat-eating-out": Coffee,
  "cat-transport": Bus,
  "cat-phone": Smartphone,
  "cat-school": GraduationCap,
  "cat-fun": Gamepad2,
  "cat-health": HeartPulse,
};

export function categoryIcon(category: Category | undefined, kind: Transaction["kind"] = "spending"): LucideIcon {
  if (kind === "income") return Wallet;
  return (
    (category &&
      (CATEGORY_ICONS[category.id] ?? (category.parent_id ? CATEGORY_ICONS[category.parent_id] : undefined))) ??
    Dumbbell
  );
}

// Bright, fixed colours per category (not the palette's), so lists stay lively in every theme.
const CATEGORY_TINTS: Record<string, string> = {
  "cat-housing": "#8b6cf0",
  "cat-food": "#f0645a",
  "cat-groceries": "#19b394",
  "cat-eating-out": "#ff8f4c",
  "cat-transport": "#4a8fe7",
  "cat-phone": "#1fa6b8",
  "cat-school": "#6d6cf0",
  "cat-fun": "#ff6fa8",
  "cat-health": "#e8506b",
};
const OTHER_TINTS = ["#f5b82e", "#b67df2", "#19b394", "#4a8fe7", "#ff6fa8", "#ff8f4c"];

/** The category's colour: its own, its parent's, or one picked steadily from its id. */
export function categoryTint(category: Category | undefined, kind: Transaction["kind"] = "spending"): string {
  if (kind === "income") return "#19b394";
  if (!category) return "#9aa7b2";
  const own = CATEGORY_TINTS[category.id] ?? (category.parent_id ? CATEGORY_TINTS[category.parent_id] : undefined);
  if (own) return own;
  const hash = [...category.id].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return OTHER_TINTS[hash % OTHER_TINTS.length];
}

/** A soft tile in the category's colour, for its icon. */
export function tintStyle(tint: string): { backgroundColor: string; color: string } {
  return { backgroundColor: `${tint}26`, color: tint };
}
