import { Bus, Coffee, Dumbbell, Gamepad2, GraduationCap, HeartPulse, Home, type LucideIcon, ShoppingCart, Smartphone, UtensilsCrossed, Wallet } from "lucide-react";
import type { Category, Transaction } from "@/lib/api";

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  "cat-housing": Home, "cat-food": UtensilsCrossed, "cat-groceries": ShoppingCart, "cat-eating-out": Coffee,
  "cat-transport": Bus, "cat-phone": Smartphone, "cat-school": GraduationCap, "cat-fun": Gamepad2, "cat-health": HeartPulse,
};

export function categoryIcon(category: Category | undefined, kind: Transaction["kind"] = "spending"): LucideIcon {
  if (kind === "income") return Wallet;
  return (category && (CATEGORY_ICONS[category.id] ?? (category.parent_id ? CATEGORY_ICONS[category.parent_id] : undefined))) ?? Dumbbell;
}
