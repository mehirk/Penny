"use client";

import type { Dashboard } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Mascot, type Mood } from "./mascot";
import { cad } from "./shared";

/**
 * Penny at the top of a page: a bright card, Penny bobbing beside a speech bubble, and a few
 * floating sparkles. The colours are fixed (not the palette's), so it stays cheerful in every
 * theme, including the greyscale ones. Every figure in the line comes from the dashboard.
 */

export type BannerTone = "sunset" | "mint" | "ocean" | "candy";

const TONES: Record<BannerTone, string> = {
  sunset: "from-[#ff8a5b] via-[#f5638f] to-[#b66df2]",
  mint: "from-[#19b394] via-[#1fa6b8] to-[#4a8fe7]",
  ocean: "from-[#4a8fe7] via-[#6d6cf0] to-[#b67df2]",
  candy: "from-[#f5b82e] via-[#ff8f6b] to-[#ff6fa8]",
};
// Sparkles drift around the card: [left %, top %, delay s, glyph].
const SPARKLES: [number, number, number, string][] = [
  [62, 18, 0, "✨"],
  [78, 62, 0.6, "💛"],
  [90, 14, 1.2, "⭐"],
  [70, 80, 1.8, "✨"],
  [96, 70, 0.9, "💫"],
];

export function PennyBanner({
  title,
  line,
  mood = "happy",
  tone,
  className,
}: {
  title: string;
  line: string;
  mood?: Mood;
  tone: BannerTone;
  className?: string;
}) {
  return (
    <section
      aria-label="Penny says"
      className={cn(
        "relative overflow-hidden rounded-[var(--radius-card)] bg-gradient-to-br p-4 text-white shadow-[var(--shadow-raised)] sm:p-5",
        TONES[tone],
        className,
      )}
    >
      {SPARKLES.map(([left, top, delay, glyph]) => (
        <span
          key={`${left}-${top}`}
          aria-hidden="true"
          className="pointer-events-none absolute select-none text-lg opacity-80 animate-bob max-sm:hidden"
          style={{ left: `${left}%`, top: `${top}%`, animationDelay: `${delay}s` }}
        >
          {glyph}
        </span>
      ))}
      {/* A soft glow behind Penny. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -left-10 -top-10 size-44 rounded-full bg-white/25 blur-2xl"
      />
      <div className="relative flex items-center gap-3 sm:gap-4">
        <Mascot mood={mood} className="size-16 shrink-0 animate-bob drop-shadow-lg sm:size-20" />
        <div className="min-w-0 max-w-2xl rounded-2xl rounded-tl-sm bg-white/20 px-4 py-3 backdrop-blur-sm">
          <p className="text-base font-bold tracking-tight sm:text-lg">{title}</p>
          <p className="mt-0.5 text-sm text-white/95">{line}</p>
        </div>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ what Penny says on each page

export function spendingCheer(dashboard: Dashboard): { title: string; line: string; mood: Mood } {
  const spent = dashboard.transactions.filter((item) => item.kind === "spending");
  const top = dashboard.category_spending[0];
  const status = dashboard.spending_runway?.status;
  if (!spent.length)
    return {
      title: "A fresh start! ✨",
      line: `Nothing spent ${dashboard.period.phrase} yet. Tell me when you buy something and I’ll keep it tidy.`,
      mood: "happy",
    };
  if (status === "over" || status === "empty")
    return {
      title: "Let’s slow down together 💛",
      line: `${spent.length} purchases ${dashboard.period.phrase}, mostly ${top?.category_name ?? "a bit of everything"}. No stress: small swaps add up fast.`,
      mood: "sad",
    };
  return {
    title: "Looking good! 🎉",
    line: `${spent.length} purchase${spent.length === 1 ? "" : "s"} ${dashboard.period.phrase}${top ? `, and ${top.category_name} is your top spot` : ""}. Snap your next receipt and I’ll file it for you.`,
    mood: "happy",
  };
}

export function budgetCheer(dashboard: Dashboard, budget: number): { title: string; line: string; mood: Mood } {
  if (budget <= 0)
    return {
      title: "Let’s make a plan! 🧮",
      line: "Tap Suggest budgets and I’ll work out limits from how you really spend.",
      mood: "wow",
    };
  const spent = dashboard.totals.spending_cents;
  const left = budget - spent;
  const free = Math.max(0, Math.floor((left * 100) / budget));
  if (left < 0)
    return {
      title: "We went a little over 💛",
      line: `${cad(-left)} past the plan ${dashboard.period.phrase}. That happens! Let’s find one budget to trim.`,
      mood: "sad",
    };
  if (free < 15)
    return {
      title: "Almost there! 💪",
      line: `${cad(left)} left ${dashboard.period.phrase}. Let’s make every dollar count until payday.`,
      mood: "wow",
    };
  return {
    title: "You’re crushing it! 🎉",
    line: `${cad(left)} left to enjoy, ${free}% of your budget still free ${dashboard.period.phrase}.`,
    mood: "happy",
  };
}

export function chartsCheer(kept: number, start: string, end: string): { title: string; line: string; mood: Mood } {
  return kept >= 0
    ? {
        title: kept > 0 ? "Look at you go! 📈" : "Every dot is a choice 🌱",
        line:
          kept > 0
            ? `You kept ${cad(kept)} from ${start} to ${end}. That’s money that stayed with you. 💪`
            : `Money in and out matched from ${start} to ${end}. Keeping even a little each month gets the line climbing.`,
        mood: kept > 0 ? "wow" : "happy",
      }
    : {
        title: "Let’s turn it around 💛",
        line: `${cad(-kept)} more went out than came in from ${start} to ${end}. Tap a month to see where it went.`,
        mood: "sad",
      };
}

export function goalsCheer(dashboard: Dashboard): { title: string; line: string; mood: Mood } {
  const goals = dashboard.savings_goals;
  const reached = goals.find((goal) => goal.status === "completed");
  const active = goals.filter((goal) => goal.status === "active");
  const best = [...active].sort((a, b) => b.progress_basis_points - a.progress_basis_points)[0];
  if (!goals.length)
    return {
      title: "Dream it, then save for it 🌟",
      line: "A trip, a laptop, a rainy-day fund: start a goal and I’ll cheer you on.",
      mood: "wow",
    };
  if (best && best.current_cents === 0)
    return {
      title: `${best.name} is ready to grow 🐷`,
      line: "It’s waiting for its first dollar. Even $5 gets it rolling, and I’ll celebrate every step.",
      mood: "happy",
    };
  if (best)
    return {
      title: `${Math.floor(best.progress_basis_points / 100)}% of the way to ${best.name}! 🎯`,
      line: `${cad(best.current_cents)} saved so far. Keep feeding the piggy bank and we’ll get there together.`,
      mood: "wow",
    };
  return {
    title: "Goal reached! 👑",
    line: `You finished ${reached?.name ?? "a goal"}. Ready for the next adventure?`,
    mood: "wow",
  };
}
