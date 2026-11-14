"use client";

import { useId, useState } from "react";
import { Check, Lock } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Penny, the coin mascot of Learn: drawn in SVG, with outfits unlocked by level. The outfit is a
 * look only, remembered on this device; it never affects XP or scores.
 */

export type Outfit = "none" | "cap" | "glasses" | "headphones" | "grad" | "crown";
export type Mood = "happy" | "wow" | "sad";

export const OUTFITS: { id: Outfit; label: string; level: number }[] = [
  { id: "none", label: "Classic", level: 1 },
  { id: "cap", label: "Ball cap", level: 2 },
  { id: "glasses", label: "Sunglasses", level: 3 },
  { id: "headphones", label: "Headphones", level: 4 },
  { id: "grad", label: "Grad cap", level: 5 },
  { id: "crown", label: "Crown", level: 6 },
];

const OUTFIT_KEY = "penny-mascot-outfit";

function savedOutfit(): Outfit {
  if (typeof window === "undefined") return "none";
  try {
    const value = window.localStorage.getItem(OUTFIT_KEY);
    return OUTFITS.some((item) => item.id === value) ? (value as Outfit) : "none";
  } catch {
    return "none";
  }
}

/** The outfit picked on this device, falling back to Classic if it's above the player's level. */
export function useOutfit(level: number): [Outfit, (outfit: Outfit) => void] {
  const [outfit, setOutfit] = useState<Outfit>(savedOutfit);
  const allowed = (OUTFITS.find((item) => item.id === outfit)?.level ?? 1) <= level ? outfit : "none";
  const choose = (next: Outfit) => {
    setOutfit(next);
    try {
      window.localStorage.setItem(OUTFIT_KEY, next);
    } catch {
      /* storage blocked: the outfit lasts until the page reloads */
    }
  };
  return [allowed, choose];
}

export function Mascot({
  outfit = "none",
  mood = "happy",
  className,
}: {
  outfit?: Outfit;
  mood?: Mood;
  className?: string;
}) {
  // Unique per drawing: several mascots can be on screen at once.
  const face = `penny-face-${useId().replace(/:/g, "")}`;
  return (
    <svg viewBox="0 0 120 130" className={cn("overflow-visible", className)} aria-hidden="true">
      <defs>
        <radialGradient id={face} cx="38%" cy="32%" r="75%">
          <stop offset="0%" stopColor="#ffe9b0" />
          <stop offset="55%" stopColor="#f2b84b" />
          <stop offset="100%" stopColor="#c98a1c" />
        </radialGradient>
      </defs>
      {/* Shadow, arms, and feet */}
      <ellipse cx="60" cy="124" rx="30" ry="5" fill="rgb(0 0 0 / 0.18)" />
      <path d="M18 78 q-12 6 -8 18" stroke="#c98a1c" strokeWidth="6" strokeLinecap="round" fill="none" />
      <path d="M102 78 q12 -10 10 -22" stroke="#c98a1c" strokeWidth="6" strokeLinecap="round" fill="none" />
      <rect x="40" y="110" width="14" height="10" rx="5" fill="#8a5a10" />
      <rect x="66" y="110" width="14" height="10" rx="5" fill="#8a5a10" />
      {/* The coin */}
      <circle cx="60" cy="68" r="46" fill="#b07612" />
      <circle cx="60" cy="66" r="46" fill={`url(#${face})`} />
      <circle cx="60" cy="66" r="38" fill="none" stroke="#d99a2b" strokeWidth="3" strokeDasharray="3 5" />
      {/* Face */}
      {outfit !== "glasses" && (
        <>
          <ellipse cx="45" cy="60" rx="5" ry={mood === "wow" ? 7 : 6} fill="#3b2506" />
          <ellipse cx="75" cy="60" rx="5" ry={mood === "wow" ? 7 : 6} fill="#3b2506" />
          <circle cx="47" cy="57" r="1.8" fill="#fff" />
          <circle cx="77" cy="57" r="1.8" fill="#fff" />
        </>
      )}
      <ellipse cx="36" cy="74" rx="6" ry="3.5" fill="#f08a6b" opacity="0.55" />
      <ellipse cx="84" cy="74" rx="6" ry="3.5" fill="#f08a6b" opacity="0.55" />
      {mood === "happy" && (
        <path d="M48 76 q12 12 24 0" stroke="#3b2506" strokeWidth="4" strokeLinecap="round" fill="none" />
      )}
      {mood === "wow" && <ellipse cx="60" cy="80" rx="7" ry="8" fill="#3b2506" />}
      {mood === "sad" && (
        <path d="M48 82 q12 -9 24 0" stroke="#3b2506" strokeWidth="4" strokeLinecap="round" fill="none" />
      )}
      {/* Outfits */}
      {outfit === "cap" && (
        <g>
          <path d="M22 40 q38 -38 76 0 z" fill="#2f6fd6" />
          <path d="M90 38 q22 0 26 8 q-14 2 -30 -2 z" fill="#1f4fa0" />
          <circle cx="60" cy="16" r="4" fill="#1f4fa0" />
        </g>
      )}
      {outfit === "glasses" && (
        <g>
          <rect x="30" y="52" width="26" height="16" rx="6" fill="#1b1b1f" />
          <rect x="64" y="52" width="26" height="16" rx="6" fill="#1b1b1f" />
          <path d="M56 58 h8" stroke="#1b1b1f" strokeWidth="4" />
          <path d="M34 56 l8 0" stroke="#6b7cff" strokeWidth="2.5" strokeLinecap="round" />
          <path d="M68 56 l8 0" stroke="#6b7cff" strokeWidth="2.5" strokeLinecap="round" />
        </g>
      )}
      {outfit === "headphones" && (
        <g>
          <path d="M16 64 q0 -50 44 -50 q44 0 44 50" stroke="#e84f6b" strokeWidth="7" fill="none" />
          <rect x="6" y="56" width="16" height="26" rx="7" fill="#e84f6b" />
          <rect x="98" y="56" width="16" height="26" rx="7" fill="#e84f6b" />
        </g>
      )}
      {outfit === "grad" && (
        <g>
          <path d="M60 4 l46 16 l-46 16 l-46 -16 z" fill="#20222b" />
          <path d="M36 28 v12 q24 10 48 0 v-12" fill="#2b2e3a" />
          <path d="M100 22 v22" stroke="#f5b82e" strokeWidth="3" />
          <circle cx="100" cy="46" r="4" fill="#f5b82e" />
        </g>
      )}
      {outfit === "crown" && (
        <g>
          <path
            d="M30 32 l6 -26 l14 16 l10 -20 l10 20 l14 -16 l6 26 z"
            fill="#ffd34d"
            stroke="#c98a1c"
            strokeWidth="2"
          />
          <circle cx="60" cy="18" r="3.5" fill="#e84f6b" />
          <circle cx="40" cy="22" r="3" fill="#19b394" />
          <circle cx="80" cy="22" r="3" fill="#4a8fe7" />
        </g>
      )}
    </svg>
  );
}

/** Pick Penny's outfit; locked ones say which level unlocks them. */
export function Wardrobe({
  level,
  outfit,
  onPick,
}: {
  level: number;
  outfit: Outfit;
  onPick: (outfit: Outfit) => void;
}) {
  return (
    <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
      {OUTFITS.map((item) => {
        const locked = item.level > level;
        const current = item.id === outfit;
        return (
          <li key={item.id}>
            <button
              type="button"
              disabled={locked}
              aria-pressed={current}
              onClick={() => onPick(item.id)}
              className={cn(
                "relative flex w-full flex-col items-center rounded-2xl border-2 p-3 transition-colors disabled:cursor-not-allowed",
                current ? "border-accent bg-accent-soft" : "border-line bg-surface hover:border-accent",
              )}
            >
              <Mascot outfit={item.id} className={cn("size-20", locked && "opacity-35 grayscale")} />
              <span className="mt-1 text-sm font-semibold text-ink">{item.label}</span>
              <span className="text-xs text-ink-subtle">
                {locked ? `Unlocks at level ${item.level}` : current ? "Wearing" : "Unlocked"}
              </span>
              {locked && <Lock className="absolute right-2.5 top-2.5 size-4 text-ink-subtle" aria-hidden="true" />}
              {current && <Check className="absolute right-2.5 top-2.5 size-4 text-accent-strong" aria-hidden="true" />}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
