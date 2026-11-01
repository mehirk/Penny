import type { AccountType } from "@/lib/api";

/** Display only: a friendly emoji picked from what something is called. First match wins. */
const BY_NAME: [RegExp, string][] = [
  [/rainy|emergency|cushion|safety/i, "☔"],
  [/laptop|computer|macbook|tech/i, "💻"],
  [/trip|travel|vacation|flight|holiday/i, "✈️"],
  [/\bcar\b|vehicle/i, "🚗"],
  [/\bphone\b|iphone/i, "📱"],
  [/school|tuition|textbook|college|university/i, "🎓"],
  [/concert|music|festival|ticket/i, "🎵"],
  [/gift|christmas|birthday/i, "🎁"],
  [/house|home|apartment|rent|move/i, "🏠"],
  [/bike|bicycle/i, "🚲"],
  [/health|dental|medical/i, "🩺"],
  [/wedding|ring/i, "💍"],
  [/pet|\bdog\b|\bcat\b/i, "🐾"],
];

const BY_TYPE: Record<AccountType, string> = {
  chequing: "🏦",
  cash: "💵",
  savings: "🐷",
  investment: "📈",
  credit: "💳",
  other: "🗂️",
};

const fromName = (name: string) => BY_NAME.find(([pattern]) => pattern.test(name))?.[1];

export const accountEmoji = (name: string, type: AccountType) => (type === "credit" ? BY_TYPE.credit : fromName(name) ?? BY_TYPE[type]);

export const goalEmoji = (name: string) => fromName(name) ?? "🎯";
