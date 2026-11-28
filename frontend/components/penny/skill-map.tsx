"use client";

import { useEffect, useState } from "react";
import { LoaderCircle, RotateCcw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  type AreaMastery,
  type CoachPlan,
  learnApi,
  type PlanStep,
  type SkillCheckResult,
  type SkillCheckView,
} from "@/lib/api";
import { recall, remember } from "@/lib/session-cache";
import { cn } from "@/lib/utils";
import { confetti, CountUp, play } from "./game-fx";
import { Mascot, type Outfit } from "./mascot";
import { describeError } from "./shared";

/**
 * Money IQ and the skill map: a 12-question check graded by the API, a radar of mastery in six
 * areas (the check blended with lesson stars, computed by the API), and Penny's plan: the next
 * lessons, guides, and games for the weakest areas, with a note from Penny AI (or built-in text).
 */

const SKILL_MAP_KEY = "skill-map";
const AREA_ORDER = ["banking", "registered", "credit", "tax", "grow", "protect"] as const;
const AREA_LOOK: Record<string, { emoji: string; short: string; color: string }> = {
  banking: { emoji: "🏦", short: "Banking", color: "#4a8fe7" },
  registered: { emoji: "🍁", short: "Accounts", color: "#e8475f" },
  credit: { emoji: "💳", short: "Credit", color: "#9b6cf0" },
  tax: { emoji: "🧾", short: "Taxes", color: "#f39a2b" },
  grow: { emoji: "🌱", short: "Save & grow", color: "#19a37f" },
  protect: { emoji: "🛡️", short: "Protect", color: "#6b7a90" },
};

const tier = (pct: number) =>
  pct >= 80
    ? { label: "Strong", className: "bg-money-in-soft text-money-in" }
    : pct >= 50
      ? { label: "Growing", className: "bg-gold-soft text-gold-strong" }
      : { label: "Gap", className: "bg-danger-soft text-danger" };

export function SkillMap({
  version,
  outfit,
  onLesson,
  onGuide,
  onGame,
  onProgress,
}: {
  version: number;
  outfit: Outfit;
  onLesson: (lessonId: string) => void;
  onGuide: (area: string) => void;
  onGame: (gameId: string) => void;
  onProgress: () => void;
}) {
  // The last result shows at once (no loading flash when coming back to Learn); a fresh copy replaces it.
  const [plan, setPlan] = useState<CoachPlan | null>(() => recall<CoachPlan>(SKILL_MAP_KEY) ?? null);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let live = true;
    learnApi
      .coachPlan()
      .then((data) => {
        remember(SKILL_MAP_KEY, data);
        if (live) setPlan(data);
      })
      .catch((reason: unknown) => {
        if (live) setError(describeError(reason, "Your skill map didn’t load").detail);
      });
    return () => {
      live = false;
    };
  }, [version, refresh]);

  const dialog = (
    <Dialog open={checking} onOpenChange={setChecking}>
      <DialogContent className="sm:max-w-xl">
        {checking && (
          <MoneyIQ
            outfit={outfit}
            onDone={() => {
              setChecking(false);
              setPlan(null);
              setRefresh((value) => value + 1);
              onProgress();
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );

  if (!plan) {
    return error ? (
      <p className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>
    ) : (
      <div
        className="h-56 animate-pulse rounded-[var(--radius-card)] bg-sage-soft"
        aria-label="Loading your skill map"
      />
    );
  }

  if (!plan.checked) {
    return (
      <section aria-labelledby="iq-title">
        <div className="relative overflow-hidden rounded-[var(--radius-card)] bg-[linear-gradient(135deg,#1d2050,#4a4fb0_50%,#e8475f)] p-5 text-white shadow-[0_6px_0_#141638] sm:p-6">
          <HexBackdrop />
          <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="flex items-end gap-3">
              <Mascot outfit={outfit} mood="wow" className="size-24 shrink-0 animate-bob" />
              <p className="mb-6 max-w-[12rem] animate-pop rounded-2xl rounded-bl-sm bg-white px-3 py-2 text-sm font-bold text-[#1d2050] sm:hidden">
                Let’s find what you already know!
              </p>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-black uppercase tracking-widest text-white/75">🧠 Money IQ</p>
              <h2 id="iq-title" className="mt-1 text-2xl font-black leading-tight sm:text-3xl">
                Find your money gaps
              </h2>
              <p className="mt-1 text-sm text-white/85">
                12 quick questions across 6 skills. Penny AI maps your strengths and builds a plan of lessons, guides,
                and games just for you.
              </p>
              <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold">
                {["⏱ 3 minutes", "🎯 6 skills", "⭐ +20 XP", "🤖 AI plan"].map((chip) => (
                  <span key={chip} className="rounded-full bg-white/15 px-2.5 py-1">
                    {chip}
                  </span>
                ))}
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                play("tap");
                setChecking(true);
              }}
              className="min-h-14 shrink-0 rounded-2xl bg-[#ffd34d] px-6 text-lg font-black text-[#5a3b00] shadow-[0_5px_0_#c98a1c] transition-transform hover:-translate-y-0.5 active:translate-y-1 active:shadow-none"
            >
              Start Money IQ
            </button>
          </div>
        </div>
        {dialog}
      </section>
    );
  }

  const byId = new Map(plan.areas.map((area) => [area.id, area]));
  const weakest = plan.areas[0];

  return (
    <section aria-labelledby="skills-title" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="skills-title" className="text-xl font-bold tracking-tight text-ink">
            Your skill map
          </h2>
          <p className="text-sm text-ink-subtle">Money IQ plus your lesson stars. Penny’s plan targets the gaps.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setChecking(true)}>
          <RotateCcw className="size-4" aria-hidden="true" />
          Retake Money IQ
        </Button>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
          <Radar areas={AREA_ORDER.map((id) => byId.get(id)).filter((area): area is AreaMastery => Boolean(area))} />
          <ul className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {AREA_ORDER.map((id) => {
              const area = byId.get(id);
              if (!area) return null;
              const level = tier(area.mastery_pct);
              return (
                <li key={id} className="rounded-xl bg-sage-soft/60 px-2.5 py-2">
                  <p className="flex items-center justify-between gap-1 text-xs font-bold text-ink">
                    <span className="truncate">
                      {AREA_LOOK[id].emoji} {AREA_LOOK[id].short}
                    </span>
                    <span className="tabular">{area.mastery_pct}%</span>
                  </p>
                  <span
                    className={cn("mt-1 inline-block rounded-full px-1.5 text-[0.65rem] font-black", level.className)}
                  >
                    {level.label}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="flex flex-col gap-3 rounded-[var(--radius-card)] bg-[linear-gradient(160deg,#1d2050,#2e3380)] p-4 text-white sm:p-5">
          <div className="flex items-start gap-3">
            <Mascot outfit={outfit} className="size-16 shrink-0 animate-bob" />
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 text-xs font-black uppercase tracking-widest text-white/70">
                <Sparkles className="size-3.5" aria-hidden="true" />
                Penny’s plan for you
                <span className="ml-1 rounded-full bg-white/15 px-1.5 py-0.5 normal-case tracking-normal">
                  {plan.note?.source === "ai" ? "Penny AI" : "From your scores"}
                </span>
              </p>
              <p className="mt-1.5 animate-pop rounded-2xl rounded-tl-sm bg-white px-3.5 py-2.5 text-sm font-semibold leading-relaxed text-[#1d2050]">
                {plan.note?.items[0] ??
                  (weakest ? `Let’s work on ${weakest.label} first.` : "You’re strong everywhere. Keep playing!")}
              </p>
            </div>
          </div>
          {plan.steps.length > 0 ? (
            <ol className="space-y-2">
              {plan.steps.slice(0, 6).map((step, position) => (
                <PlanRow
                  key={`${step.kind}-${step.area}-${step.title}`}
                  step={step}
                  number={position + 1}
                  mastery={byId.get(step.area)?.mastery_pct ?? 0}
                  onGo={() => {
                    play("tap");
                    if (step.kind === "lesson" && step.lesson_id) onLesson(step.lesson_id);
                    else if (step.kind === "game" && step.game_id) onGame(step.game_id);
                    else onGuide(step.area);
                  }}
                />
              ))}
            </ol>
          ) : (
            <p className="rounded-2xl bg-white/10 p-3 text-sm">
              Every skill is maxed out. Try Hard lessons for 3 stars!
            </p>
          )}
        </div>
      </div>
      {dialog}
    </section>
  );
}

function PlanRow({
  step,
  number,
  mastery,
  onGo,
}: {
  step: PlanStep;
  number: number;
  mastery: number;
  onGo: () => void;
}) {
  const look = AREA_LOOK[step.area];
  const kind = step.kind === "lesson" ? "📘 Lesson" : step.kind === "guide" ? "📚 Guide blitz" : "🎮 Game";
  return (
    <li
      style={{ animationDelay: `${number * 80}ms` }}
      className="flex animate-pop items-center gap-3 rounded-2xl bg-white/10 p-2.5 pl-3"
    >
      <span
        className="grid size-8 shrink-0 place-items-center rounded-full text-sm font-black text-white"
        style={{ background: look?.color }}
        aria-hidden="true"
      >
        {number}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-bold">{step.title}</span>
        <span className="block text-xs text-white/70">
          {kind} · {look?.emoji} {look?.short} {mastery}%
        </span>
      </span>
      <button
        type="button"
        onClick={onGo}
        className="min-h-10 shrink-0 rounded-xl bg-[#ffd34d] px-3.5 text-sm font-black text-[#5a3b00] shadow-[0_3px_0_#c98a1c] active:translate-y-0.5 active:shadow-none"
      >
        Go
      </button>
    </li>
  );
}

/** The six areas as a hexagonal radar chart: each axis is one area's mastery. */
function Radar({ areas }: { areas: AreaMastery[] }) {
  const size = 260;
  const center = size / 2;
  const radius = 92;
  const point = (index: number, pct: number) => {
    const angle = (Math.PI * 2 * index) / areas.length - Math.PI / 2;
    return [center + Math.cos(angle) * radius * (pct / 100), center + Math.sin(angle) * radius * (pct / 100)];
  };
  const ring = (pct: number) => areas.map((_, index) => point(index, pct).join(",")).join(" ");
  const shape = areas.map((area, index) => point(index, Math.max(area.mastery_pct, 6)).join(",")).join(" ");
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className="mx-auto block w-full max-w-[18rem]"
      role="img"
      aria-label={`Skill map: ${areas.map((area) => `${area.label} ${area.mastery_pct}%`).join(", ")}`}
    >
      <defs>
        <linearGradient id="radar-fill" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ffd34d" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#19b394" stopOpacity="0.85" />
        </linearGradient>
      </defs>
      {[25, 50, 75, 100].map((pct) => (
        <polygon
          key={pct}
          points={ring(pct)}
          fill="none"
          stroke="currentColor"
          className="text-line-strong"
          strokeWidth="1"
        />
      ))}
      {areas.map((_, index) => {
        const [x, y] = point(index, 100);
        return <line key={index} x1={center} y1={center} x2={x} y2={y} stroke="currentColor" className="text-line" />;
      })}
      <polygon
        points={shape}
        fill="url(#radar-fill)"
        stroke="#0e7d67"
        strokeWidth="2.5"
        strokeLinejoin="round"
        className="origin-center animate-pop"
        style={{ transformBox: "fill-box" }}
      />
      {areas.map((area, index) => {
        const [x, y] = point(index, Math.max(area.mastery_pct, 6));
        const [lx, ly] = point(index, 128);
        return (
          <g key={area.id}>
            <circle cx={x} cy={y} r="5" fill="#fff" stroke={AREA_LOOK[area.id]?.color} strokeWidth="3" />
            <text x={lx} y={ly - 4} textAnchor="middle" fontSize="16">
              {AREA_LOOK[area.id]?.emoji}
            </text>
            <text x={lx} y={ly + 12} textAnchor="middle" fontSize="11" fontWeight="800" className="fill-ink">
              {area.mastery_pct}%
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function HexBackdrop() {
  return (
    <svg
      viewBox="0 0 400 160"
      className="pointer-events-none absolute inset-0 size-full opacity-15"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      {Array.from({ length: 18 }, (_, i) => {
        const x = (i % 6) * 72 + (Math.floor(i / 6) % 2) * 36;
        const y = Math.floor(i / 6) * 60;
        return (
          <polygon
            key={i}
            points={`${x + 20},${y} ${x + 40},${y + 11} ${x + 40},${y + 34} ${x + 20},${y + 45} ${x},${y + 34} ${x},${y + 11}`}
            fill="none"
            stroke="#fff"
            strokeWidth="2"
          />
        );
      })}
    </svg>
  );
}

/** The skill check as a game: one question at a time, then a results reveal with each area. */
function MoneyIQ({ outfit, onDone }: { outfit: Outfit; onDone: () => void }) {
  const [view, setView] = useState<SkillCheckView | null>(null);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<SkillCheckResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    learnApi
      .skillCheck()
      .then((data) => {
        if (live) setView(data);
      })
      .catch((reason: unknown) => {
        if (live) setError(describeError(reason, "Money IQ didn’t load").detail);
      });
    return () => {
      live = false;
    };
  }, []);

  async function pick(questionId: string, optionId: string) {
    if (!view || busy) return;
    play("tap");
    const next = { ...answers, [questionId]: optionId };
    setAnswers(next);
    if (index + 1 < view.questions.length) {
      setIndex(index + 1);
      return;
    }
    setBusy(true);
    try {
      const graded = await learnApi.submitSkillCheck(next);
      setResult(graded);
      const right = graded.marks.filter((mark) => mark.correct).length;
      play(right >= 9 ? "win" : "coin");
      confetti({ pieces: right >= 9 ? 180 : 90 });
    } catch (reason) {
      setError(describeError(reason, "Penny couldn’t score that").detail);
    } finally {
      setBusy(false);
    }
  }

  if (!view) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Money IQ</DialogTitle>
          <DialogDescription>12 questions across 6 skills.</DialogDescription>
        </DialogHeader>
        {error ? (
          <p className="mt-3 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>
        ) : (
          <div className="grid place-items-center py-10">
            <LoaderCircle className="size-6 animate-spin text-ink-subtle" aria-label="Loading" />
          </div>
        )}
      </>
    );
  }

  if (result) {
    const right = result.marks.filter((mark) => mark.correct).length;
    return (
      <div className="space-y-4">
        <DialogHeader>
          <p className="text-xs font-black uppercase tracking-widest text-ink-subtle">🧠 Money IQ results</p>
          <DialogTitle className="text-2xl font-black tracking-tight">
            {right >= 10 ? "Money genius!" : right >= 7 ? "Solid skills!" : "Great start!"}
          </DialogTitle>
          <DialogDescription className="sr-only">Your score in each area.</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-4 rounded-3xl bg-[linear-gradient(135deg,#1d2050,#4a4fb0)] p-4 text-white">
          <Mascot outfit={outfit} mood={right >= 7 ? "wow" : "happy"} className="size-20 shrink-0 animate-pop" />
          <div>
            <p className="tabular text-4xl font-black">
              <CountUp to={right} />
              <span className="text-xl text-white/70">/{result.marks.length}</span>
            </p>
            <p className="text-sm text-white/85">right answers</p>
            {result.xp_awarded > 0 && (
              <span className="mt-1 inline-block animate-pop rounded-full bg-[#ffd34d] px-2.5 py-0.5 text-sm font-black text-[#5a3b00] [animation-delay:600ms]">
                +{result.xp_awarded} XP
              </span>
            )}
          </div>
        </div>
        <ul className="space-y-2">
          {AREA_ORDER.map((id, position) => {
            const area = result.areas.find((item) => item.id === id);
            if (!area) return null;
            return (
              <li key={id} className="flex items-center gap-3">
                <span className="w-28 shrink-0 truncate text-sm font-bold text-ink">
                  {AREA_LOOK[id].emoji} {AREA_LOOK[id].short}
                </span>
                <span className="h-3 flex-1 overflow-hidden rounded-full bg-sage">
                  <span
                    className="block h-full rounded-full transition-[width] duration-1000 ease-out"
                    style={{
                      width: `${area.check_pct}%`,
                      background: AREA_LOOK[id].color,
                      transitionDelay: `${position * 120}ms`,
                    }}
                  />
                </span>
                <span className="tabular w-10 text-right text-sm font-black text-ink">{area.check_pct}%</span>
              </li>
            );
          })}
        </ul>
        <details className="rounded-2xl border border-line">
          <summary className="flex min-h-11 cursor-pointer items-center px-4 text-sm font-bold text-ink">
            See the answers
          </summary>
          <ul className="space-y-2 border-t border-line p-3">
            {view.questions.map((question) => {
              const mark = result.marks.find((item) => item.question_id === question.id);
              return (
                <li key={question.id} className="text-sm">
                  <p className="font-semibold text-ink">
                    {mark?.correct ? "✅" : "❌"} {question.prompt}
                  </p>
                  <p className="text-ink-muted">{mark?.explanation}</p>
                </li>
              );
            })}
          </ul>
        </details>
        <Button className="min-h-12 w-full text-base font-black" onClick={onDone}>
          <Sparkles className="size-4" aria-hidden="true" />
          See my plan
        </Button>
      </div>
    );
  }

  const question = view.questions[index];
  const look = AREA_LOOK[question.area];
  return (
    <div className="space-y-4">
      <DialogHeader>
        <p className="text-xs font-black uppercase tracking-widest text-ink-subtle">
          🧠 Money IQ · {index + 1} of {view.questions.length}
        </p>
        <DialogTitle className="sr-only">Money IQ</DialogTitle>
        <DialogDescription className="sr-only">Pick the best answer to each question.</DialogDescription>
      </DialogHeader>
      <div className="flex gap-1" aria-hidden="true">
        {view.questions.map((item, dot) => (
          <span
            key={item.id}
            className="h-2 flex-1 rounded-full transition-colors"
            style={{ background: dot <= index ? AREA_LOOK[item.area]?.color : "var(--color-sage)" }}
          />
        ))}
      </div>
      <div
        key={question.id}
        className="animate-enter rounded-3xl p-4 text-white shadow-[0_5px_0_rgb(0_0_0/0.2)]"
        style={{ background: `linear-gradient(135deg, ${look?.color}, #1d2050)` }}
      >
        <span className="rounded-full bg-white/20 px-2.5 py-1 text-xs font-black uppercase tracking-wider">
          {look?.emoji} {look?.short}
        </span>
        <div className="mt-3 flex items-end gap-3">
          <Mascot outfit={outfit} className="size-16 shrink-0 animate-bob" />
          <p className="mb-3 flex-1 animate-pop rounded-2xl rounded-bl-sm bg-white px-3.5 py-2.5 text-base font-bold leading-snug text-[#1d2050]">
            {question.prompt}
          </p>
        </div>
      </div>
      <div className="grid gap-2">
        {question.options.map((option, position) => (
          <button
            key={option.id}
            type="button"
            disabled={busy}
            onClick={() => void pick(question.id, option.id)}
            style={{ animationDelay: `${position * 70}ms` }}
            className="flex min-h-14 animate-pop items-center gap-3 rounded-2xl border-2 border-line bg-surface p-3 text-left text-base font-semibold text-ink shadow-[0_4px_0_var(--color-line-strong)] transition-transform hover:-translate-y-0.5 hover:border-accent active:translate-y-0.5 active:shadow-none disabled:opacity-60"
          >
            <span
              className="grid size-8 shrink-0 place-items-center rounded-xl bg-sage text-sm font-black text-ink-muted"
              aria-hidden="true"
            >
              {String.fromCharCode(65 + position)}
            </span>
            {option.text}
          </button>
        ))}
      </div>
      {busy && (
        <p className="flex items-center justify-center gap-2 text-sm font-semibold text-ink-subtle" role="status">
          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          Penny is mapping your skills…
        </p>
      )}
      {error && <p className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      {index > 0 && !busy && (
        <button
          type="button"
          className="mx-auto block min-h-10 text-sm font-semibold text-ink-subtle hover:text-ink"
          onClick={() => setIndex(index - 1)}
        >
          ← Previous question
        </button>
      )}
    </div>
  );
}
