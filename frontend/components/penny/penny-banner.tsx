"use client";

import type { Dashboard } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Mascot, type Mood } from "./mascot";
import { formatShortDate } from "@/lib/format";
import { cad } from "./shared";
import { type Tone, toneFor } from "./tone";

/**
 * Penny at the top of a page, in the user's tone (components/penny/tone.ts).
 *
 * Playful ("learning first"): a bright card, Penny bobbing beside a speech bubble, and a few
 * floating sparkles. Grown-up (students, working adults): a plain summary card with a small,
 * still Penny and a coloured edge. Every figure in the line comes from the dashboard.
 */

export type BannerTone = "sunset" | "mint" | "ocean" | "candy";
type Cheer = { title: string; line: string; mood: Mood; tone: Tone };

const TONES: Record<BannerTone, string> = {
  sunset: "from-[#ff8a5b] via-[#f5638f] to-[#b66df2]",
  mint: "from-[#19b394] via-[#1fa6b8] to-[#4a8fe7]",
  ocean: "from-[#4a8fe7] via-[#6d6cf0] to-[#b67df2]",
  candy: "from-[#f5b82e] via-[#ff8f6b] to-[#ff6fa8]",
};
// Sparkles drift around the playful card: [left %, top %, delay s, glyph].
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
  tone: look,
  className,
  ...cheer
}: {
  title: string;
  line: string;
  mood?: Mood;
  tone: Tone;
  className?: string;
} & { color: BannerTone }) {
  if (look === "grown")
    return (
      <section
        aria-label="Summary from Penny"
        className={cn(
          "relative flex items-center gap-3 overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface p-4 pl-5 shadow-[var(--shadow-card)]",
          className,
        )}
      >
        <span
          className={cn("absolute inset-y-0 left-0 w-1.5 bg-gradient-to-b", TONES[cheer.color])}
          aria-hidden="true"
        />
        <Mascot face className="size-10 shrink-0" />
        <div className="min-w-0">
          <p className="font-semibold text-ink">{title}</p>
          <p className="text-sm text-ink-muted">{line}</p>
        </div>
      </section>
    );
  return (
    <section
      aria-label="Penny says"
      className={cn(
        "relative overflow-hidden rounded-[var(--radius-card)] bg-gradient-to-br p-4 text-white shadow-[var(--shadow-raised)] sm:p-5",
        TONES[cheer.color],
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

/** One line in the persona's own terms (a student's term and rent, a worker's payday). */
function personaNote(dashboard: Dashboard, topic: "budget" | "goals"): string {
  const persona = dashboard.profile.persona;
  const payday = dashboard.pay?.upcoming.find((item) => !item.received);
  if (persona === "working")
    return topic === "budget"
      ? payday
        ? ` Next payday: ${formatShortDate(payday.on)}.`
        : ""
      : " Moving money to goals right after payday makes saving automatic.";
  if (persona === "student")
    return topic === "budget"
      ? " Rent and other bills are already counted."
      : " Small, regular amounts add up over a term.";
  return "";
}

const pct = (part: number, whole: number) => (whole > 0 ? Math.floor((part * 100) / whole) : 0);

export function spendingCheer(dashboard: Dashboard): Cheer {
  const tone = toneFor(dashboard.profile.persona);
  const spent = dashboard.transactions.filter((item) => item.kind === "spending");
  const top = dashboard.category_spending[0];
  const status = dashboard.spending_runway?.status;
  const phrase = dashboard.period.phrase;
  if (tone === "grown") {
    if (!spent.length) return { tone, mood: "happy", title: "No spending yet", line: `Nothing recorded ${phrase}.` };
    return {
      tone,
      mood: "happy",
      title: `${spent.length} purchase${spent.length === 1 ? "" : "s"} ${phrase}`,
      line:
        (top ? `${top.category_name} is your largest category (${cad(top.spent_cents)}).` : "") +
        (status === "over" || status === "empty" ? " You’re over this month’s budget." : ""),
    };
  }
  if (!spent.length)
    return {
      tone,
      title: "A fresh start! ✨",
      line: `Nothing spent ${phrase} yet. Tell me when you buy something and I’ll keep it tidy.`,
      mood: "happy",
    };
  if (status === "over" || status === "empty")
    return {
      tone,
      title: "Let’s slow down together 💛",
      line: `${spent.length} purchases ${phrase}, mostly ${top?.category_name ?? "a bit of everything"}. No stress: small swaps add up fast.`,
      mood: "sad",
    };
  return {
    tone,
    title: "Looking good! 🎉",
    line: `${spent.length} purchase${spent.length === 1 ? "" : "s"} ${phrase}${top ? `, and ${top.category_name} is your top spot` : ""}. Snap your next receipt and I’ll file it for you.`,
    mood: "happy",
  };
}

export function budgetCheer(dashboard: Dashboard, budget: number): Cheer {
  const tone = toneFor(dashboard.profile.persona);
  const phrase = dashboard.period.phrase;
  const left = budget - dashboard.totals.spending_cents;
  const free = Math.max(0, pct(left, budget));
  if (tone === "grown") {
    if (budget <= 0)
      return {
        tone,
        mood: "happy",
        title: "No budget yet",
        line: "Use Suggest budgets to start from your actual spending.",
      };
    if (left < 0)
      return { tone, mood: "sad", title: `${cad(-left)} over budget`, line: `Spending ${phrase} is past the plan.` };
    return {
      tone,
      mood: "happy",
      title: `${cad(left)} left ${phrase}`,
      line: `${free}% of your ${cad(budget)} budget is still available.${personaNote(dashboard, "budget")}`,
    };
  }
  if (budget <= 0)
    return {
      tone,
      title: "Let’s make a plan! 🧮",
      line: "Tap Suggest budgets and I’ll work out limits from how you really spend.",
      mood: "wow",
    };
  if (left < 0)
    return {
      tone,
      title: "We went a little over 💛",
      line: `${cad(-left)} past the plan ${phrase}. That happens! Let’s find one budget to trim.`,
      mood: "sad",
    };
  if (free < 15)
    return {
      tone,
      title: "Almost there! 💪",
      line: `${cad(left)} left ${phrase}. Let’s make every dollar count until payday.`,
      mood: "wow",
    };
  return {
    tone,
    title: "You’re crushing it! 🎉",
    line: `${cad(left)} left to enjoy, ${free}% of your budget still free ${phrase}.`,
    mood: "happy",
  };
}

export function chartsCheer(dashboard: Dashboard, kept: number, start: string, end: string): Cheer {
  const tone = toneFor(dashboard.profile.persona);
  if (tone === "grown")
    return {
      tone,
      mood: "happy",
      title: kept >= 0 ? `${cad(kept)} kept` : `${cad(-kept)} more out than in`,
      line: `Money in minus money out, ${start} to ${end}.`,
    };
  return kept >= 0
    ? {
        tone,
        title: kept > 0 ? "Look at you go! 📈" : "Every dot is a choice 🌱",
        line:
          kept > 0
            ? `You kept ${cad(kept)} from ${start} to ${end}. That’s money that stayed with you. 💪`
            : `Money in and out matched from ${start} to ${end}. Keeping even a little each month gets the line climbing.`,
        mood: kept > 0 ? "wow" : "happy",
      }
    : {
        tone,
        title: "Let’s turn it around 💛",
        line: `${cad(-kept)} more went out than came in from ${start} to ${end}. Tap a month to see where it went.`,
        mood: "sad",
      };
}

export function goalsCheer(dashboard: Dashboard): Cheer {
  const tone = toneFor(dashboard.profile.persona);
  const goals = dashboard.savings_goals;
  const reached = goals.find((goal) => goal.status === "completed");
  const active = goals.filter((goal) => goal.status === "active");
  const best = [...active].sort((a, b) => b.progress_basis_points - a.progress_basis_points)[0];
  if (tone === "grown") {
    if (!goals.length)
      return { tone, mood: "happy", title: "No goals yet", line: "Add one to see what it takes each month." };
    if (best)
      return {
        tone,
        mood: "happy",
        title: `${best.name}: ${Math.floor(best.progress_basis_points / 100)}% funded`,
        line: `${cad(best.current_cents)} of ${cad(best.target_cents)} saved.${personaNote(dashboard, "goals")}`,
      };
    return { tone, mood: "happy", title: `${reached?.name ?? "Goal"} reached`, line: "Every goal is complete." };
  }
  if (!goals.length)
    return {
      tone,
      title: "Dream it, then save for it 🌟",
      line: "A trip, a laptop, a rainy-day fund: start a goal and I’ll cheer you on.",
      mood: "wow",
    };
  if (best && best.current_cents === 0)
    return {
      tone,
      title: `${best.name} is ready to grow 🐷`,
      line: "It’s waiting for its first dollar. Even $5 gets it rolling, and I’ll celebrate every step.",
      mood: "happy",
    };
  if (best)
    return {
      tone,
      title: `${Math.floor(best.progress_basis_points / 100)}% of the way to ${best.name}! 🎯`,
      line: `${cad(best.current_cents)} saved so far. Keep feeding the piggy bank and we’ll get there together.`,
      mood: "wow",
    };
  return {
    tone,
    title: "Goal reached! 👑",
    line: `You finished ${reached?.name ?? "a goal"}. Ready for the next adventure?`,
    mood: "wow",
  };
}
