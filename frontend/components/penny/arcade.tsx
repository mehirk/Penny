"use client";

import { useEffect, useState } from "react";
import { Check, LoaderCircle, Sparkles, Star } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { type ArcadeView, learnApi, type PracticeWeek } from "@/lib/api";
import { cn } from "@/lib/utils";
import { confettiFrom, CountUp, play } from "./game-fx";
import { type Outfit } from "./mascot";
import { NeedsOrWants } from "./needs-wants";
import { StoryGamePlay } from "./practice-game";
import { describeError, SectionHeading } from "./shared";

/**
 * Learn's arcade: today's three quests with a chest of bonus XP, the story game made for the
 * player's persona (first, marked "Made for you"), the other story games, and Needs or wants.
 * `version` changes when something elsewhere on Learn (a lesson) may have finished a quest.
 */
export function Arcade({
  version,
  outfit,
  launch,
  onProgress,
  grown = false,
}: {
  version: number;
  outfit: Outfit;
  /** The grown-up tone (students, working adults): "Practice", without daily quests or the chest. */
  grown?: boolean;
  /** From Penny's plan: open this game ("sort" or a story game id); `nonce` changes per request. */
  launch?: { game: string; nonce: number } | null;
  /** XP changed (a game or the chest): Learn reloads its level and XP. */
  onProgress: () => void;
}) {
  const [arcade, setArcade] = useState<ArcadeView | null>(null);
  const [error, setError] = useState("");
  const [story, setStory] = useState<PracticeWeek | null>(null);
  const [sorting, setSorting] = useState(false);
  const [launched, setLaunched] = useState(0);
  if (arcade && launch && launch.nonce !== launched) {
    setLaunched(launch.nonce);
    if (launch.game === "sort") setSorting(true);
    else setStory(arcade.stories.find((game) => game.id === launch.game) ?? null);
  }

  useEffect(() => {
    let live = true;
    learnApi
      .arcade()
      .then((data) => {
        if (live) setArcade(data);
      })
      .catch((reason: unknown) => {
        if (live) setError(describeError(reason, "The games didn’t load").detail);
      });
    return () => {
      live = false;
    };
  }, [version]);

  const refresh = () => {
    learnApi
      .arcade()
      .then(setArcade)
      .catch(() => undefined);
    onProgress();
  };

  if (!arcade) {
    return error ? (
      <p className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>
    ) : (
      <div className="h-48 animate-pulse rounded-[var(--radius-card)] bg-sage-soft" aria-label="Loading games" />
    );
  }

  const [featured, ...others] = arcade.stories;

  return (
    <section aria-labelledby="arcade-title" className="space-y-4">
      <SectionHeading
        id="arcade-title"
        title={grown ? "Practice" : "Arcade"}
        description={
          grown
            ? "Simulations with pretend money. Nothing touches your real accounts."
            : "Pretend-money games. Your best score earns XP, and nothing touches your real accounts."
        }
      />

      {!grown && (
        <Quests
          arcade={arcade}
          onOpened={(next) => {
            setArcade(next);
            onProgress();
          }}
        />
      )}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <GameTile
          featured
          emoji={featured.emoji}
          title={featured.title}
          blurb={featured.blurb}
          stars={featured.best_stars}
          tint="from-[#ffb86b] to-[#ff7a7a]"
          onPlay={() => setStory(featured)}
        />
        <GameTile
          emoji="⚡"
          title="Needs or wants"
          blurb={`Swipe ${arcade.sort.cards.length} cards in ${arcade.sort.seconds} seconds. Need or want?`}
          stars={arcade.sort.best_stars}
          tint="from-[#7cc4f5] to-[#6b7cff]"
          onPlay={() => setSorting(true)}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {others.map((game) => (
          <GameTile
            key={game.id}
            compact
            emoji={game.emoji}
            title={game.title}
            blurb={game.blurb}
            stars={game.best_stars}
            tint="from-[#7fd6b0] to-[#19b394]"
            onPlay={() => setStory(game)}
          />
        ))}
      </div>

      <Dialog open={story !== null} onOpenChange={(open) => !open && setStory(null)}>
        <DialogContent className="sm:max-w-xl">
          {story && (
            <StoryGamePlay
              key={story.id}
              week={story}
              outfit={outfit}
              onFinished={refresh}
              onClose={() => setStory(null)}
            />
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={sorting} onOpenChange={setSorting}>
        <DialogContent>{sorting && <NeedsOrWants view={arcade.sort} onFinished={refresh} />}</DialogContent>
      </Dialog>
    </section>
  );
}

function GameTile({
  emoji,
  title,
  blurb,
  stars,
  tint,
  featured = false,
  compact = false,
  onPlay,
}: {
  emoji: string;
  title: string;
  blurb: string;
  stars: number;
  tint: string;
  featured?: boolean;
  compact?: boolean;
  onPlay: () => void;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        play("tap");
        onPlay();
      }}
      className={cn(
        "group relative flex w-full items-center gap-4 overflow-hidden rounded-[var(--radius-card)] bg-gradient-to-br p-4 text-left text-white shadow-[0_5px_0_rgb(0_0_0/0.25)] transition-transform hover:-translate-y-0.5 active:translate-y-1 active:shadow-none motion-reduce:transform-none",
        tint,
        compact ? "min-h-24" : "min-h-36 sm:p-5",
      )}
    >
      {/* Shine */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -right-10 -top-16 size-44 rounded-full bg-white/15"
      />
      <span
        className={cn(
          "grid shrink-0 place-items-center rounded-2xl bg-white/25 shadow-inner transition-transform group-hover:-rotate-6 group-hover:scale-110 motion-reduce:transform-none",
          compact ? "size-14 text-3xl" : "size-20 text-5xl",
        )}
        aria-hidden="true"
      >
        {emoji}
      </span>
      <span className="relative min-w-0 flex-1">
        {featured && (
          <span className="mb-1 inline-flex items-center gap-1 rounded-full bg-white/90 px-2 py-0.5 text-[0.7rem] font-bold uppercase tracking-wide text-[#b4441f]">
            <Sparkles className="size-3" aria-hidden="true" />
            Made for you
          </span>
        )}
        <span className={cn("block font-bold tracking-tight", compact ? "text-base" : "text-xl")}>{title}</span>
        <span className="mt-0.5 block text-sm text-white/85">{blurb}</span>
        <span className="mt-2 flex items-center gap-2">
          <span
            className="inline-flex gap-0.5"
            role="img"
            aria-label={stars ? `Best: ${stars} of 3 stars` : "Not played yet"}
          >
            {[1, 2, 3].map((value) => (
              <Star
                key={value}
                className={cn("size-4", value <= stars ? "fill-[#ffe27a] text-[#ffe27a]" : "text-white/50")}
                aria-hidden="true"
              />
            ))}
          </span>
          <span className="ml-auto rounded-full bg-white px-3 py-1 text-xs font-bold text-[#1d3b57] shadow-[0_2px_0_rgb(0_0_0/0.2)]">
            {stars ? "Play again" : "Play"}
          </span>
        </span>
      </span>
    </button>
  );
}

/** Today's three quests and the chest they open. */
function Quests({ arcade, onOpened }: { arcade: ArcadeView; onOpened: (arcade: ArcadeView) => void }) {
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState("");
  const [award, setAward] = useState<number | null>(null);
  const done = arcade.quests.filter((quest) => quest.done).length;
  const ready = done === arcade.quests.length && !arcade.chest_claimed;

  async function open(button: HTMLButtonElement) {
    setOpening(true);
    setError("");
    try {
      const result = await learnApi.openChest();
      play(result.level_after > result.level_before ? "levelUp" : "win");
      confettiFrom(button, { pieces: 160 });
      setAward(result.xp_awarded);
      onOpened(result.arcade);
    } catch (reason) {
      setError(describeError(reason, "The chest wouldn’t open").detail);
    } finally {
      setOpening(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-[var(--radius-card)] border border-line bg-surface p-4 sm:flex-row sm:items-center sm:p-5">
      <div className="min-w-0 flex-1">
        <p className="flex items-center justify-between gap-2 text-sm font-semibold text-ink">
          Today’s quests
          <span className="tabular text-xs text-ink-subtle">
            {done} of {arcade.quests.length}
          </span>
        </p>
        <ul className="mt-3 space-y-2">
          {arcade.quests.map((quest) => (
            <li
              key={quest.id}
              className={cn(
                "flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 text-sm",
                quest.done ? "bg-money-in-soft text-ink" : "bg-sage-soft text-ink",
              )}
            >
              <span className="text-lg" aria-hidden="true">
                {quest.emoji}
              </span>
              <span className={cn("flex-1", quest.done && "line-through decoration-2 opacity-70")}>{quest.label}</span>
              {quest.done ? (
                <span className="grid size-6 animate-pop place-items-center rounded-full bg-money-in text-white">
                  <Check className="size-4" strokeWidth={3} aria-label="Done" />
                </span>
              ) : (
                <span className="size-6 rounded-full border-2 border-line-strong" aria-label="Not done yet" />
              )}
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-col items-center gap-2 sm:w-44">
        <button
          type="button"
          disabled={!ready || opening}
          onClick={(event) => void open(event.currentTarget)}
          className={cn(
            "relative grid size-28 place-items-center rounded-3xl transition-transform disabled:cursor-default",
            ready && "animate-wiggle hover:scale-105 motion-reduce:transform-none",
          )}
          aria-label={
            arcade.chest_claimed
              ? "Today’s chest is open"
              : ready
                ? `Open today’s chest: ${arcade.chest_xp} bonus XP`
                : `Chest: finish ${arcade.quests.length - done} more quest${arcade.quests.length - done === 1 ? "" : "s"} to open`
          }
        >
          {ready && <span className="absolute inset-2 animate-glow rounded-full" aria-hidden="true" />}
          <Chest open={arcade.chest_claimed} locked={!ready && !arcade.chest_claimed} />
          {opening && <LoaderCircle className="absolute size-6 animate-spin text-white" aria-hidden="true" />}
        </button>
        <p className="text-center text-xs font-semibold text-ink-subtle">
          {arcade.chest_claimed ? (
            award ? (
              <span className="animate-pop text-base font-bold text-gold-strong">
                +<CountUp to={award} /> XP!
              </span>
            ) : (
              "Opened. New quests tomorrow."
            )
          ) : ready ? (
            <span className="text-accent-strong">Tap to open!</span>
          ) : (
            `${arcade.chest_xp} XP chest · ${done}/${arcade.quests.length}`
          )}
        </p>
        {error && <p className="text-center text-xs text-danger">{error}</p>}
      </div>
    </div>
  );
}

/** A treasure chest, drawn in SVG: closed and locked, closed and ready, or open with coins. */
function Chest({ open, locked }: { open: boolean; locked: boolean }) {
  return (
    <svg viewBox="0 0 100 90" className={cn("size-24", locked && "opacity-60 grayscale-[0.6]")} aria-hidden="true">
      <ellipse cx="50" cy="84" rx="38" ry="5" fill="rgb(0 0 0 / 0.18)" />
      {open ? (
        // Lid tipped back behind the box, with coins and sparkles spilling out of the top.
        <g>
          <path d="M16 44 l-4 -30 h76 l-4 30 z" fill="#8a4a1f" stroke="#6b3815" strokeWidth="2" />
          <rect x="44" y="14" width="12" height="30" fill="#c98a1c" />
          <path d="M28 12 l3 -8 M50 8 l0 -8 M72 12 l-3 -8" stroke="#ffd34d" strokeWidth="3" strokeLinecap="round" />
          <circle cx="36" cy="40" r="7" fill="#ffd34d" stroke="#c98a1c" strokeWidth="1.5" />
          <circle cx="50" cy="34" r="7" fill="#ffd34d" stroke="#c98a1c" strokeWidth="1.5" />
          <circle cx="64" cy="40" r="7" fill="#ffd34d" stroke="#c98a1c" strokeWidth="1.5" />
        </g>
      ) : (
        <g>
          <path d="M14 46 q36 -36 72 0 z" fill="#c2723a" stroke="#8a4a1f" strokeWidth="2" />
          <rect x="44" y="30" width="12" height="16" fill="#f5b82e" />
        </g>
      )}
      <rect x="14" y="44" width="72" height="38" rx="6" fill="#a35b2a" />
      <rect x="14" y="44" width="72" height="8" fill="#8a4a1f" />
      <rect x="44" y="44" width="12" height="38" fill="#f5b82e" />
      <rect
        x="45"
        y="52"
        width="10"
        height="12"
        rx="2"
        fill={locked ? "#6b7a90" : "#ffe27a"}
        stroke="#8a4a1f"
        strokeWidth="1.5"
      />
    </svg>
  );
}
