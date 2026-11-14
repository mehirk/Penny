"use client";

import { useEffect, useState } from "react";
import { LoaderCircle, RotateCcw, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { learnApi, type PracticeChoice, type PracticeOutcome, type PracticeWeek } from "@/lib/api";
import { cn } from "@/lib/utils";
import { confetti, CountUp, play, SoundToggle } from "./game-fx";
import { Mascot, type Outfit } from "./mascot";
import { cad, describeError } from "./shared";

/**
 * Story games with pretend money (backend app/learning/practice.py): a pocket-money week, a
 * month of student life, or a first paycheque. Each round is a choice; the goal is money left
 * at the end. The running wallet here is only for display; the score, stars, and XP come from
 * the API.
 */
export function PracticeCard({ scenario = "pocket-money", onPlayed }: { scenario?: string; onPlayed?: () => void }) {
  const [week, setWeek] = useState<PracticeWeek | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let active = true;
    learnApi
      .practice(scenario)
      .then((data) => {
        if (active) setWeek(data);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [scenario]);
  if (!week) return null;
  return (
    <section
      aria-labelledby="practice-title"
      className="rounded-[var(--radius-card)] border border-accent/30 bg-accent-soft p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-center gap-3">
        <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-surface text-2xl" aria-hidden="true">
          {week.emoji}
        </span>
        <div className="min-w-0 flex-1 basis-48">
          <h2 id="practice-title" className="font-semibold text-ink">
            {week.title}
          </h2>
          <p className="text-sm text-ink-muted">{week.blurb}</p>
        </div>
        <Stars
          count={week.best_stars}
          label={week.best_stars ? `Best: ${week.best_stars} of 3 stars` : "Not played yet"}
        />
      </div>
      <Button className="mt-3 min-h-11 w-full sm:w-auto" onClick={() => setOpen(true)}>
        {week.best_stars ? "Play again" : "Play"}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-xl">
          {open && (
            <StoryGamePlay
              week={week}
              onFinished={(outcome) => {
                setWeek((current) =>
                  current ? { ...current, best_stars: Math.max(current.best_stars, outcome.stars) } : current,
                );
                onPlayed?.();
              }}
              onClose={() => setOpen(false)}
            />
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}

export function StoryGamePlay({
  week,
  outfit = "none",
  onFinished,
  onClose,
}: {
  week: PracticeWeek;
  outfit?: Outfit;
  onFinished: (outcome: PracticeOutcome) => void;
  onClose: () => void;
}) {
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [outcome, setOutcome] = useState<PracticeOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // The last price paid, shown floating off the jar (display only).
  const [paid, setPaid] = useState<{ cents: number; key: number } | null>(null);
  const index = Object.keys(picks).length;
  const day = week.days[index];
  const spent = week.days.reduce(
    (sum, item) => sum + (item.choices.find((choice) => choice.id === picks[item.id])?.cost_cents ?? 0),
    0,
  );
  const left = week.start_cents - spent;

  async function pick(dayId: string, choice: PracticeChoice) {
    const next = { ...picks, [dayId]: choice.id };
    play(choice.cost_cents ? "coin" : "tap");
    if (choice.cost_cents) setPaid({ cents: choice.cost_cents, key: Object.keys(next).length });
    setPicks(next);
    if (Object.keys(next).length < week.days.length) return;
    setBusy(true);
    setError("");
    try {
      const result = await learnApi.playPractice(week.id, next);
      setOutcome(result);
      onFinished(result);
      if (result.reached_goal) {
        play("win");
        confetti({ pieces: result.stars === 3 ? 180 : 120 });
      } else {
        play("wrong");
      }
    } catch (reason) {
      setError(describeError(reason, "Penny couldn’t score that week").detail);
    } finally {
      setBusy(false);
    }
  }

  function restart() {
    setPaid(null);
    setPicks({});
    setOutcome(null);
    setError("");
  }

  const theme = SCENE[week.id] ?? SCENE["pocket-money"];
  // Penny looks impressed for a moment after money is spent, otherwise cheerful.
  const mood = outcome ? (outcome.reached_goal ? "wow" : "sad") : paid && paid.key === index ? "wow" : "happy";
  const say = outcome
    ? outcome.reached_goal
      ? `You kept ${cad(week.goal_cents)} for ${week.goal_name}!`
      : `Oh no, ${week.goal_name} came up short.`
    : day
      ? day.situation
      : "Adding it all up…";

  return (
    <div className="space-y-4">
      <DialogHeader className="pr-10">
        <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-ink-subtle">
          <span aria-hidden="true">{week.emoji}</span>
          {week.title}
        </p>
        <DialogTitle className="text-2xl font-black tracking-tight">
          {outcome ? (outcome.reached_goal ? "Stage clear!" : "Game over") : day ? day.name : "Scoring…"}
        </DialogTitle>
        <DialogDescription className="sr-only">
          Pretend money only. Nothing here touches your real accounts.
        </DialogDescription>
      </DialogHeader>

      {/* The scene: Penny tells the story, and the week is a road with a stop for each round. */}
      <div
        className={cn(
          "relative overflow-hidden rounded-3xl bg-gradient-to-br p-4 pb-0 shadow-[inset_0_-6px_0_rgb(0_0_0/0.08)]",
          theme.sky,
        )}
      >
        <SceneDecor kind={theme.decor} />
        <div className="relative flex items-center justify-between gap-2">
          <span className="rounded-full bg-black/25 px-3 py-1 text-xs font-black uppercase tracking-wider text-white">
            {outcome ? "Results" : `Round ${Math.min(index + 1, week.days.length)} of ${week.days.length}`}
          </span>
          <SoundToggle className="min-h-8 border-white/60 bg-white/85 px-2.5 text-[#1d3b57] hover:bg-white" />
        </div>
        <div className="relative mt-3 flex items-end gap-3">
          <Mascot
            key={`${index}-${mood}`}
            outfit={outfit}
            mood={mood}
            className={cn(
              "size-20 shrink-0 drop-shadow-[0_6px_6px_rgb(0_0_0/0.25)] sm:size-24",
              mood === "wow" ? "animate-pop" : "animate-bob",
            )}
          />
          <p
            key={say}
            className="relative mb-6 flex-1 animate-pop rounded-2xl rounded-bl-sm bg-white px-4 py-3 text-base font-bold leading-snug text-[#1d3b57] shadow-[0_6px_16px_rgb(0_0_0/0.15)]"
          >
            {say}
          </p>
        </div>
        <RoadTrail week={week} picks={picks} index={index} />
      </div>

      <CoinJar
        startCents={week.start_cents}
        leftCents={outcome ? outcome.left_cents : left}
        goalCents={week.goal_cents}
        goalName={week.goal_name}
        paid={paid}
      />

      {!outcome && day && (
        <div key={day.id} className="grid animate-enter gap-3 sm:grid-cols-2">
          {day.choices.map((choice, position) => {
            const affordable = choice.cost_cents <= left;
            const look = !affordable
              ? "from-[#9aa3ad] to-[#6b7480] shadow-[0_5px_0_#4b525b]"
              : choice.treat
                ? "from-[#ff8fb1] to-[#b67df2] shadow-[0_5px_0_#8a4fc8]"
                : choice.cost_cents
                  ? "from-[#5fb0ff] to-[#4a6fe7] shadow-[0_5px_0_#3450b0]"
                  : "from-[#4fd1a5] to-[#19a37f] shadow-[0_5px_0_#0e7d67]";
            return (
              <button
                key={choice.id}
                type="button"
                disabled={!affordable || busy}
                onClick={() => void pick(day.id, choice)}
                style={{ animationDelay: `${position * 90}ms` }}
                className={cn(
                  "group relative flex min-h-32 animate-pop flex-col items-start overflow-hidden rounded-3xl bg-gradient-to-br p-4 text-left text-white transition-transform",
                  "hover:-translate-y-1 active:translate-y-1 active:shadow-none disabled:cursor-not-allowed disabled:hover:translate-y-0 motion-reduce:transform-none",
                  look,
                )}
              >
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute -right-6 -top-8 size-24 rounded-full bg-white/15"
                />
                {choice.treat && affordable && (
                  <span className="absolute right-3 top-3 rounded-full bg-white/90 px-2 py-0.5 text-[0.65rem] font-black uppercase tracking-wide text-[#8a4fc8]">
                    ✨ Treat
                  </span>
                )}
                <span
                  className="grid size-14 place-items-center rounded-2xl bg-white/90 text-3xl shadow-[0_3px_0_rgb(0_0_0/0.15)] transition-transform group-hover:-rotate-6 group-hover:scale-110 motion-reduce:transform-none"
                  aria-hidden="true"
                >
                  {choice.emoji}
                </span>
                <span className="mt-3 text-lg font-black leading-tight drop-shadow-[0_1px_1px_rgb(0_0_0/0.2)]">
                  {choice.label}
                </span>
                <span
                  className={cn(
                    "tabular mt-2 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-sm font-black shadow-[0_2px_0_rgb(0_0_0/0.2)]",
                    !affordable
                      ? "bg-black/25 text-white"
                      : choice.cost_cents
                        ? "bg-[#ffe27a] text-[#6b4a00]"
                        : "bg-white text-[#0e7d67]",
                  )}
                >
                  {!affordable ? "🔒 Not enough left" : choice.cost_cents ? <>🪙 {cad(choice.cost_cents)}</> : "FREE"}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {busy && (
        <p role="status" className="flex items-center justify-center gap-2 text-sm font-semibold text-ink-subtle">
          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          Adding up your week…
        </p>
      )}

      {outcome && (
        <div className="animate-enter space-y-3" role="status">
          <div className="flex flex-col items-center gap-2 text-center">
            <Stars count={outcome.stars} label={`${outcome.stars} of 3 stars`} large />
            {outcome.xp_awarded > 0 && (
              <span className="animate-pop rounded-full bg-gold-soft px-3 py-1 text-sm font-bold text-gold-strong [animation-delay:800ms]">
                +<CountUp to={outcome.xp_awarded} /> XP
              </span>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              { label: "Spent", value: cad(outcome.spent_cents), emoji: "💸" },
              { label: "Treats", value: String(outcome.treats), emoji: "✨" },
              { label: "Left", value: cad(outcome.left_cents), emoji: "🪙" },
            ].map((stat, position) => (
              <p
                key={stat.label}
                style={{ animationDelay: `${300 + position * 120}ms` }}
                className="animate-pop rounded-2xl bg-sage-soft px-2 py-3"
              >
                <span className="block text-xl" aria-hidden="true">
                  {stat.emoji}
                </span>
                <span className="tabular block text-base font-black text-ink">{stat.value}</span>
                <span className="block text-xs font-semibold text-ink-subtle">{stat.label}</span>
              </p>
            ))}
          </div>
          <ul className="space-y-2">
            {outcome.lessons.map((line) => (
              <li key={line} className="flex items-start gap-2">
                <Mascot outfit={outfit} className="size-8 shrink-0" />
                <span className="flex-1 rounded-2xl rounded-tl-sm bg-sage-soft px-3 py-2 text-sm text-ink">{line}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        {(outcome || error) && (
          <Button variant="outline" className="min-h-12 flex-1 text-base font-bold" onClick={restart}>
            <RotateCcw className="size-4" aria-hidden="true" />
            Play again
          </Button>
        )}
        <Button
          variant={outcome ? "default" : "ghost"}
          className={cn("min-h-12 flex-1", outcome && "text-base font-bold")}
          onClick={onClose}
        >
          {outcome ? "Done" : "Quit game"}
        </Button>
      </div>
    </div>
  );
}

/** Each story game's backdrop: its sky and the silhouette along the horizon. */
const SCENE: Record<string, { sky: string; decor: "hills" | "campus" | "city" }> = {
  "pocket-money": { sky: "from-[#7cc4f5] via-[#a8dcff] to-[#c9f2d0]", decor: "hills" },
  semester: { sky: "from-[#8e7cf5] via-[#e98fc1] to-[#ffd29a]", decor: "campus" },
  "first-paycheque": { sky: "from-[#2f8fbf] via-[#5fc0d8] to-[#b8f0e0]", decor: "city" },
};

function SceneDecor({ kind }: { kind: "hills" | "campus" | "city" }) {
  return (
    <svg
      viewBox="0 0 400 200"
      preserveAspectRatio="xMidYMax slice"
      className="pointer-events-none absolute inset-0 size-full"
      aria-hidden="true"
    >
      <circle cx="340" cy="40" r="22" fill="#fff6c2" opacity="0.85" />
      <g fill="#fff" opacity="0.55">
        <ellipse cx="70" cy="40" rx="26" ry="8" />
        <ellipse cx="88" cy="35" rx="15" ry="8" />
        <ellipse cx="230" cy="58" rx="20" ry="6" />
      </g>
      {kind === "hills" && (
        <path d="M0 160 q70 -40 140 -10 t140 -12 t120 -6 v70 h-400 z" fill="#ffffff" opacity="0.25" />
      )}
      {kind === "campus" && (
        <path
          d="M0 170 v-40 h40 v-20 h20 v-14 l10 -8 l10 8 v14 h20 v20 h50 v-30 l30 -20 l30 20 v30 h40 v-46 h16 v46 h44 v-24 h30 v24 h60 v70 h-400 z"
          fill="#ffffff"
          opacity="0.22"
        />
      )}
      {kind === "city" && (
        <path
          d="M0 170 v-50 h26 v-30 h22 v40 h18 v-70 h30 v70 h16 v-44 h24 v24 h20 v-60 h28 v60 h18 v-36 h26 v-20 h20 v56 h22 v-80 h30 v80 h20 v-30 h40 v70 h-400 z"
          fill="#ffffff"
          opacity="0.2"
        />
      )}
    </svg>
  );
}

function Stars({ count, label, large = false }: { count: number; label: string; large?: boolean }) {
  return (
    <span className="inline-flex items-center gap-0.5" role="img" aria-label={label}>
      {[1, 2, 3].map((value) => (
        <Star
          key={value}
          style={large ? { animationDelay: `${150 + value * 200}ms` } : undefined}
          className={cn(
            large ? "size-10" : "size-4",
            value <= count ? "fill-gold text-gold" : "text-ink-subtle/40",
            large && value <= count && "animate-pop",
          )}
          aria-hidden="true"
        />
      ))}
    </span>
  );
}

/**
 * The rounds as stops along a road, with a map pin moving to the current one. Played stops show
 * what was picked.
 */
function RoadTrail({ week, picks, index }: { week: PracticeWeek; picks: Record<string, string>; index: number }) {
  const count = week.days.length;
  const at = Math.min(index, count - 1);
  // Stops are spread evenly with half a gap at each end; the pin stands on the current one.
  const left = ((at + 0.5) * 100) / count;
  return (
    <div className="relative -mx-4 mt-1" aria-label={`Round ${at + 1} of ${count}`} role="img">
      <span
        aria-hidden="true"
        className="absolute bottom-[2.8rem] z-10 -translate-x-1/2 transition-[left] duration-500 ease-out motion-reduce:transition-none"
        style={{ left: `${left}%` }}
      >
        <svg viewBox="0 0 24 30" className="h-8 w-7 animate-bob drop-shadow-[0_3px_2px_rgb(0_0_0/0.3)]">
          <path
            d="M12 29 C12 29 2 17 2 11 a10 10 0 0 1 20 0 c0 6 -10 18 -10 18 z"
            fill="#f0645a"
            stroke="#fff"
            strokeWidth="2"
          />
          <circle cx="12" cy="11" r="4" fill="#fff" />
        </svg>
      </span>
      <div className="relative h-14 bg-[#3d4452] shadow-[inset_0_4px_0_rgb(0_0_0/0.25)]" aria-hidden="true">
        <span className="absolute inset-x-0 top-1/2 -translate-y-1/2 border-t-[3px] border-dashed border-[#ffd34d]" />
        <ol className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}>
          {week.days.map((item, position) => {
            const choice = item.choices.find((option) => option.id === picks[item.id]);
            const today = position === index;
            return (
              <li key={item.id} className="relative grid place-items-center">
                <span
                  className={cn(
                    "grid size-10 place-items-center rounded-full border-[3px] text-lg shadow-[0_3px_0_rgb(0_0_0/0.3)]",
                    choice
                      ? "animate-pop border-white bg-[#ffd34d]"
                      : today
                        ? "animate-glow border-white bg-[#19b394] text-sm font-black text-white"
                        : "border-white/60 bg-[#5a6272] text-sm font-black text-white/70",
                  )}
                >
                  {choice ? choice.emoji : position + 1}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

const COIN_SIZES = [100, 500, 1_000, 2_500, 5_000, 10_000];

/**
 * The wallet as a jar of coins, stacked from the bottom; the bottom ones (ringed green) are the
 * goal. Coins fly out as they're spent, and the goal turns red once spending reaches it.
 */
function CoinJar({
  startCents,
  leftCents,
  goalCents,
  goalName,
  paid,
}: {
  startCents: number;
  leftCents: number;
  goalCents: number;
  goalName: string;
  paid: { cents: number; key: number } | null;
}) {
  // Each coin is the smallest round amount that keeps the jar to 20 coins ($1 for pocket money,
  // $50 for a month's budget).
  const unit = COIN_SIZES.find((size) => startCents / size <= 20) ?? COIN_SIZES[COIN_SIZES.length - 1];
  const total = Math.ceil(startCents / unit);
  const coinsLeft = Math.max(0, Math.floor(leftCents / unit));
  const goalCoins = Math.ceil(goalCents / unit);
  const perRow = 5;
  const rows = Math.ceil(total / perRow);
  const safe = leftCents >= goalCents;
  return (
    <div
      className="flex items-end gap-4"
      role="img"
      aria-label={`${cad(leftCents)} left. Goal: keep ${cad(goalCents)} for ${goalName}.`}
    >
      <div className="relative w-36 shrink-0 rounded-b-[2rem] rounded-t-lg border-4 border-t-0 border-line-strong bg-sage-soft/60 px-2 pb-2 pt-4">
        <span
          aria-hidden="true"
          className="absolute -top-1 left-1/2 h-2 w-28 -translate-x-1/2 rounded-full bg-line-strong"
        />
        <div className="flex flex-col-reverse gap-1">
          {Array.from({ length: rows }, (_, row) => (
            <div key={row} className="relative flex justify-center gap-1">
              {Array.from({ length: perRow }, (_, column) => {
                const coin = row * perRow + column;
                if (coin >= total) return <span key={column} className="size-5" />;
                const spent = coin >= coinsLeft;
                // The bottom coins are the goal: ringed green while they're still in the jar.
                const goal = coin < goalCoins;
                return (
                  <span
                    key={column}
                    aria-hidden="true"
                    style={spent ? { animationDelay: `${(coin % perRow) * 40}ms` } : undefined}
                    className={cn(
                      "size-5 rounded-full border-2 bg-[radial-gradient(circle_at_35%_35%,#ffe6a8,#f2b84b)] shadow-[inset_0_-2px_0_rgb(0_0_0/0.15)]",
                      goal ? "border-money-in ring-2 ring-money-in/30" : "border-[#c98a1c]/70",
                      spent && "animate-coin-out",
                    )}
                  />
                );
              })}
            </div>
          ))}
        </div>
        {paid && (
          <span
            key={paid.key}
            aria-hidden="true"
            className="absolute -top-3 right-0 animate-float-up rounded-full bg-danger px-2 py-0.5 text-xs font-bold text-white"
          >
            −{cad(paid.cents)}
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1 space-y-2.5 pb-1">
        <p>
          <span className="block text-xs font-bold uppercase tracking-wider text-ink-subtle">In your jar</span>
          <span
            key={leftCents}
            className="tabular inline-block animate-pop text-3xl font-black tracking-tight text-ink"
          >
            {cad(leftCents)}
          </span>
        </p>
        {/* The goal meter, like a health bar: the marker is the goal; stay right of it. */}
        <div>
          <div className="relative h-4 overflow-hidden rounded-full bg-sage shadow-[inset_0_2px_0_rgb(0_0_0/0.15)]">
            <div
              className={cn(
                "h-full rounded-full transition-[width] duration-500",
                safe ? "bg-[linear-gradient(90deg,#19b394,#4fd1a5)]" : "bg-[linear-gradient(90deg,#f0645a,#ff9a7a)]",
              )}
              style={{ width: `${Math.max(0, Math.min(100, (leftCents * 100) / startCents))}%` }}
            />
            <span
              aria-hidden="true"
              className="absolute inset-y-0 w-1 -translate-x-1/2 bg-white shadow-[0_0_0_1px_rgb(0_0_0/0.25)]"
              style={{ left: `${(goalCents * 100) / startCents}%` }}
            />
          </div>
          <p className={cn("mt-1.5 text-sm font-bold", safe ? "text-money-in" : "text-danger")}>
            <span aria-hidden="true">{safe ? "🎯 " : "⚠️ "}</span>
            {safe ? `Goal safe: ${cad(goalCents)} for ${goalName}` : `Below your ${cad(goalCents)} goal!`}
          </p>
        </div>
      </div>
    </div>
  );
}
