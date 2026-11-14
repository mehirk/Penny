"use client";

import { type PointerEvent, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, LoaderCircle, RotateCcw, Timer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { learnApi, type SortCard, type SortKind, type SortOutcome, type SortView } from "@/lib/api";
import { cn } from "@/lib/utils";
import { confetti, CountUp, play } from "./game-fx";
import { Mascot } from "./mascot";
import { describeError } from "./shared";

/**
 * Needs or wants: swipe (or tap, or press ← →) each card before the clock runs out. Each card
 * shows right or wrong at once; the score, stars, and XP come from the API.
 */

const SWIPE_PX = 90;

type Phase = "ready" | "playing" | "scoring" | "done";

export function NeedsOrWants({ view, onFinished }: { view: SortView; onFinished: (outcome: SortOutcome) => void }) {
  const [phase, setPhase] = useState<Phase>("ready");
  const [deck, setDeck] = useState<SortCard[]>(view.cards);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, SortKind>>({});
  const [timeLeft, setTimeLeft] = useState(view.seconds);
  const [combo, setCombo] = useState(0);
  const [flash, setFlash] = useState<{ card: SortCard; right: boolean; to: SortKind } | null>(null);
  const [outcome, setOutcome] = useState<SortOutcome | null>(null);
  const [error, setError] = useState("");
  const [drag, setDrag] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragFrom = useRef<number | null>(null);
  const answersRef = useRef(answers);
  const card = deck[index];

  function start() {
    // Shuffle (Fisher–Yates) so every round is different.
    const shuffled = [...view.cards];
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    setDeck(shuffled);
    setIndex(0);
    setAnswers({});
    answersRef.current = {};
    setTimeLeft(view.seconds);
    setCombo(0);
    setFlash(null);
    setOutcome(null);
    setError("");
    setPhase("playing");
    play("tap");
  }

  async function finish(final: Record<string, SortKind>) {
    setPhase("scoring");
    try {
      const result = await learnApi.playSort(final);
      setOutcome(result);
      setPhase("done");
      onFinished(result);
      if (result.stars >= 2) {
        play("win");
        confetti({ pieces: result.stars === 3 ? 170 : 110 });
      } else {
        play("wrong");
      }
    } catch (reason) {
      setError(describeError(reason, "Penny couldn’t score that round").detail);
      setPhase("done");
    }
  }

  function answer(kind: SortKind) {
    if (phase !== "playing" || !card) return;
    const right = card.kind === kind;
    const next = { ...answers, [card.id]: kind };
    setAnswers(next);
    answersRef.current = next;
    setFlash({ card, right, to: kind });
    setDrag(0);
    if (right) {
      play("correct");
      setCombo((count) => count + 1);
    } else {
      play("wrong");
      setCombo(0);
    }
    if (index + 1 >= deck.length) void finish(next);
    else setIndex(index + 1);
  }

  // The clock: one tick a second while playing; time up scores what's been sorted so far.
  useEffect(() => {
    if (phase !== "playing") return;
    let remaining = view.seconds;
    const timer = window.setInterval(() => {
      remaining -= 1;
      setTimeLeft(remaining);
      if (remaining <= 0) {
        window.clearInterval(timer);
        void finish(answersRef.current);
      }
    }, 1000);
    return () => window.clearInterval(timer);
    // finish reads the answers through the ref, so the clock never restarts mid-round.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, view.seconds]);

  // Arrow keys sort the card on top.
  useEffect(() => {
    if (phase !== "playing") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft") answer("need");
      if (event.key === "ArrowRight") answer("want");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    dragFrom.current = event.clientX;
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (dragFrom.current !== null) setDrag(event.clientX - dragFrom.current);
  }
  function onPointerUp() {
    const moved = drag;
    dragFrom.current = null;
    setDragging(false);
    if (moved <= -SWIPE_PX) answer("need");
    else if (moved >= SWIPE_PX) answer("want");
    else setDrag(0);
  }

  const answered = Object.keys(answers).length;
  const urgent = timeLeft <= 10;

  return (
    <div className="space-y-4">
      <DialogHeader>
        <DialogTitle>Needs or wants</DialogTitle>
        <DialogDescription>
          Swipe left for a need, right for a want. {view.seconds} seconds, {view.cards.length} cards.
        </DialogDescription>
      </DialogHeader>

      {phase === "ready" && (
        <div className="flex flex-col items-center gap-4 py-2 text-center">
          <Mascot mood="wow" className="size-24 animate-bob" />
          <div className="grid w-full grid-cols-2 gap-2 text-sm">
            <p className="rounded-2xl bg-info-soft p-3 font-semibold text-info">
              <ArrowLeft className="mx-auto mb-1 size-5" aria-hidden="true" />
              Need: hard to go without
            </p>
            <p className="rounded-2xl bg-gold-soft p-3 font-semibold text-gold-strong">
              <ArrowRight className="mx-auto mb-1 size-5" aria-hidden="true" />
              Want: nice to have
            </p>
          </div>
          <p className="text-sm text-ink-muted">
            Sort 12 or more with 90% right for three stars.
            {view.best_stars > 0 && ` Your best: ${view.best_stars} of 3 stars.`}
          </p>
          <Button className="min-h-12 w-full text-base" onClick={start}>
            Start
          </Button>
        </div>
      )}

      {(phase === "playing" || phase === "scoring") && (
        <>
          <div className="flex items-center gap-3">
            <span
              className={cn(
                "tabular inline-flex min-w-16 items-center gap-1.5 rounded-full px-3 py-1 text-sm font-bold",
                urgent ? "animate-pulse bg-danger-soft text-danger" : "bg-sage-soft text-ink",
              )}
              role="timer"
              aria-label={`${timeLeft} seconds left`}
            >
              <Timer className="size-4" aria-hidden="true" />
              {timeLeft}s
            </span>
            <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-sage" aria-hidden="true">
              <span
                className={cn(
                  "block h-full rounded-full transition-[width] duration-1000 ease-linear",
                  urgent ? "bg-danger" : "bg-accent",
                )}
                style={{ width: `${(timeLeft * 100) / view.seconds}%` }}
              />
            </span>
            <span className="tabular text-sm font-semibold text-ink-subtle">
              {answered}/{deck.length}
            </span>
          </div>

          <div className="relative grid h-64 place-items-center">
            {/* The next card peeks out behind the current one. */}
            {deck[index + 1] && (
              <div
                className="absolute h-56 w-52 translate-y-3 scale-95 rounded-3xl border-2 border-line bg-surface opacity-60"
                aria-hidden="true"
              />
            )}
            {flash && (
              <div
                key={flash.card.id}
                aria-hidden="true"
                className={cn(
                  "absolute flex h-56 w-52 flex-col items-center justify-center rounded-3xl border-4 bg-surface",
                  flash.right ? "border-money-in" : "border-danger",
                  flash.to === "need" ? "animate-fly-left" : "animate-fly-right",
                )}
              >
                <span className="text-6xl">{flash.card.emoji}</span>
              </div>
            )}
            {card && phase === "playing" && (
              <div
                key={card.id}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                style={{ transform: `translateX(${drag}px) rotate(${drag / 14}deg)` }}
                className={cn(
                  "relative flex h-56 w-52 touch-none select-none flex-col items-center justify-center gap-3 rounded-3xl border-2 bg-surface p-4 text-center shadow-[var(--shadow-raised)] animate-pop",
                  drag <= -40 ? "border-info" : drag >= 40 ? "border-gold" : "border-line",
                  !dragging && "transition-transform",
                )}
              >
                {drag <= -40 && (
                  <span className="absolute left-3 top-3 rotate-[-12deg] rounded-lg border-2 border-info px-2 text-sm font-black text-info">
                    NEED
                  </span>
                )}
                {drag >= 40 && (
                  <span className="absolute right-3 top-3 rotate-12 rounded-lg border-2 border-gold-strong px-2 text-sm font-black text-gold-strong">
                    WANT
                  </span>
                )}
                <span className="text-6xl" aria-hidden="true">
                  {card.emoji}
                </span>
                <span className="text-lg font-bold leading-tight text-ink" aria-live="polite">
                  {card.label}
                </span>
              </div>
            )}
            {phase === "scoring" && (
              <LoaderCircle className="size-8 animate-spin text-ink-subtle" aria-label="Scoring" />
            )}
          </div>

          <p className="min-h-10 text-center text-sm" role="status">
            {flash &&
              (flash.right ? (
                <span className="font-semibold text-money-in">
                  {combo >= 3 ? `🔥 ${combo} in a row! ` : "Right! "}
                  <span className="font-normal text-ink-muted">
                    {flash.card.label} is a {flash.card.kind}. {flash.card.why}
                  </span>
                </span>
              ) : (
                <span className="font-semibold text-danger">
                  Oops! {flash.card.label} is a {flash.card.kind}.{" "}
                  <span className="font-normal text-ink-muted">{flash.card.why}</span>
                </span>
              ))}
          </p>

          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              className="min-h-14 border-2 border-info/40 text-base text-info"
              disabled={phase !== "playing"}
              onClick={() => answer("need")}
            >
              <ArrowLeft className="size-5" aria-hidden="true" />
              Need
            </Button>
            <Button
              variant="outline"
              className="min-h-14 border-2 border-gold/50 text-base text-gold-strong"
              disabled={phase !== "playing"}
              onClick={() => answer("want")}
            >
              Want
              <ArrowRight className="size-5" aria-hidden="true" />
            </Button>
          </div>
        </>
      )}

      {phase === "done" && (
        <div className="flex flex-col items-center gap-3 text-center" role="status">
          {outcome ? (
            <>
              <Mascot
                mood={outcome.stars >= 2 ? "wow" : outcome.stars ? "happy" : "sad"}
                className="size-24 animate-pop"
              />
              <p className="text-2xl font-bold tracking-tight text-ink">
                {outcome.stars === 3
                  ? "Sorting superstar!"
                  : outcome.stars === 2
                    ? "Nice sorting!"
                    : outcome.stars
                      ? "Good start"
                      : "Keep practising"}
              </p>
              <span className="flex gap-1.5" role="img" aria-label={`${outcome.stars} of 3 stars`}>
                {[1, 2, 3].map((value) => (
                  <span
                    key={value}
                    style={{ animationDelay: `${150 + value * 200}ms` }}
                    className={cn("text-4xl", value <= outcome.stars ? "animate-pop" : "opacity-25 grayscale")}
                    aria-hidden="true"
                  >
                    ⭐
                  </span>
                ))}
              </span>
              <p className="tabular text-sm text-ink-muted">
                {outcome.correct} right out of {outcome.answered} sorted
                {outcome.answered < deck.length ? ` (time ran out with ${deck.length - outcome.answered} left)` : ""}
              </p>
              {outcome.xp_awarded > 0 && (
                <span className="animate-pop rounded-full bg-gold-soft px-3 py-1 text-sm font-bold text-gold-strong [animation-delay:800ms]">
                  +<CountUp to={outcome.xp_awarded} /> XP
                </span>
              )}
            </>
          ) : (
            <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}
          <Button className="mt-2 min-h-11 w-full" onClick={start}>
            <RotateCcw className="size-4" aria-hidden="true" />
            Play again
          </Button>
        </div>
      )}
    </div>
  );
}
