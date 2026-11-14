"use client";

import { type FormEvent, useEffect, useState } from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  BookOpen,
  CircleCheck,
  CircleX,
  Heart,
  HeartCrack,
  LoaderCircle,
  RotateCcw,
  Sparkles,
  Star,
  Trophy,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  type AnswerResult,
  type AttemptView,
  type Dashboard,
  learnApi,
  type LessonCard,
  type LessonDetail,
  type QuestionView,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { CountUp, confetti, play, SoundToggle } from "./game-fx";
import { BadgeChip, TIER_STYLE } from "./learn-shared";
import { Mascot, type Mood, type Outfit } from "./mascot";
import { Building } from "./money-town";
import { describeError } from "./shared";
import { LessonExample } from "./smart-cards";

type Props = {
  lesson: LessonCard | null;
  /** Penny's outfit, so the teacher matches the mascot on Learn. */
  outfit?: Outfit;
  onClose: () => void;
  onFinished: (dashboard: Dashboard | null) => void;
  onTask: (task: NonNullable<LessonDetail["task"]>) => void;
};

/** Read the cards, then answer every question with a limited number of hearts. */
export function LessonPlayer({ lesson, outfit = "none", onClose, onFinished, onTask }: Props) {
  return (
    <Dialog open={lesson !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        {lesson && (
          <Player
            key={lesson.id}
            lesson={lesson}
            outfit={outfit}
            onClose={onClose}
            onFinished={onFinished}
            onTask={onTask}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

type Phase = "read" | "challenge" | "result";

/** Each topic's sky in the lesson scene (fixed colours: an illustration). */
const SKY: Record<string, string> = {
  budgeting: "from-[#ff9a7a] via-[#ffc59a] to-[#ffe7c2]",
  saving: "from-[#f58cc0] via-[#ffb3d1] to-[#ffe0ec]",
  tax: "from-[#6b8cff] via-[#9fb6ff] to-[#d9e3ff]",
  credit: "from-[#4a6fe7] via-[#7fa2ff] to-[#cfe0ff]",
  rules: "from-[#19a37f] via-[#5fd1ae] to-[#c9f2e3]",
  investing: "from-[#22a06b] via-[#6fd39a] to-[#d8f7c9]",
};

/** The lesson's stage: the topic's sky and building, Penny, and what Penny is saying. */
function Scene({
  topic,
  outfit,
  mood = "happy",
  badge,
  children,
}: {
  topic: string;
  outfit: Outfit;
  mood?: Mood;
  badge: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-3xl bg-gradient-to-br p-4 shadow-[inset_0_-6px_0_rgb(0_0_0/0.08)]",
        SKY[topic] ?? SKY.budgeting,
      )}
    >
      <svg
        viewBox="0 0 400 200"
        preserveAspectRatio="xMidYMax slice"
        className="absolute inset-0 size-full"
        aria-hidden="true"
      >
        <circle cx="350" cy="36" r="20" fill="#fff6c2" opacity="0.8" />
        <g fill="#fff" opacity="0.5">
          <ellipse cx="80" cy="34" rx="24" ry="7" />
          <ellipse cx="96" cy="30" rx="14" ry="7" />
        </g>
        <path d="M0 185 q100 -26 200 -6 t200 -10 v40 h-400 z" fill="#fff" opacity="0.3" />
      </svg>
      <Building
        topic={topic}
        className="absolute -bottom-1 right-2 size-24 opacity-90 drop-shadow-[0_4px_6px_rgb(0_0_0/0.2)] sm:size-28"
      />
      <span className="relative inline-block rounded-full bg-black/25 px-3 py-1 text-xs font-black uppercase tracking-wider text-white">
        {badge}
      </span>
      <div className="relative mt-3 flex items-end gap-3 pb-1 pr-16 sm:pr-24">
        <Mascot
          key={mood}
          outfit={outfit}
          mood={mood}
          className={cn(
            "size-20 shrink-0 drop-shadow-[0_6px_6px_rgb(0_0_0/0.25)] sm:size-24",
            mood === "happy" ? "animate-bob" : "animate-pop",
          )}
        />
        <div className="mb-4 min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}

/** A white speech bubble from Penny. */
function Bubble({ children, live = false }: { children: React.ReactNode; live?: boolean }) {
  return (
    <div
      aria-live={live ? "polite" : undefined}
      className="animate-pop rounded-2xl rounded-bl-sm bg-white px-4 py-3 text-base font-semibold leading-relaxed text-[#1d3b57] shadow-[0_6px_16px_rgb(0_0_0/0.15)]"
    >
      {children}
    </div>
  );
}

function Player({
  lesson,
  outfit = "none",
  onClose,
  onFinished,
  onTask,
}: { lesson: LessonCard } & Omit<Props, "lesson">) {
  const [detail, setDetail] = useState<LessonDetail | null>(null);
  const [phase, setPhase] = useState<Phase>("read");
  const [card, setCard] = useState(0);
  const [attempt, setAttempt] = useState<AttemptView | null>(null);
  const [index, setIndex] = useState(0);
  const [hearts, setHearts] = useState(lesson.hearts);
  const [feedback, setFeedback] = useState<AnswerResult | null>(null);
  const [final, setFinal] = useState<AnswerResult | null>(null);
  // Right answers in a row, for the combo badge (display only; scoring is the server's).
  const [combo, setCombo] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const style = TIER_STYLE[lesson.tier];

  useEffect(() => {
    let live = true;
    learnApi
      .lesson(lesson.id)
      .then((data) => {
        if (live) setDetail(data);
      })
      .catch((reason: unknown) => {
        if (live) setError(describeError(reason, "Couldn’t open this lesson").detail);
      });
    return () => {
      live = false;
    };
  }, [lesson.id]);

  async function start() {
    setBusy(true);
    setError("");
    try {
      const next = await learnApi.start(lesson.id);
      setAttempt(next);
      setHearts(next.hearts_left);
      setCombo(0);
      setIndex(0);
      setFeedback(null);
      setFinal(null);
      setPhase("challenge");
    } catch (reason) {
      setError(describeError(reason, "Couldn’t start the challenge").detail);
    } finally {
      setBusy(false);
    }
  }

  async function submit(body: { choices?: string[]; value?: string }) {
    if (!attempt) return;
    const question = attempt.questions[index];
    setBusy(true);
    setError("");
    try {
      const result = await learnApi.answer(attempt.id, { question_id: question.id, ...body });
      setFeedback(result);
      setHearts(result.hearts_left);
      if (result.correct) {
        play("correct");
        setCombo((count) => count + 1);
        confetti({ y: 0.7, pieces: 28 + Math.min(combo, 4) * 10, spread: 80 });
      } else {
        play("wrong");
        setCombo(0);
      }
      if (result.status !== "active") {
        setFinal(result);
        onFinished(result.dashboard);
      }
    } catch (reason) {
      // Unreadable answers (like "abc" for a number) cost no heart; the server says what's wrong.
      setError(describeError(reason, "Couldn’t check that answer").detail);
    } finally {
      setBusy(false);
    }
  }

  function next() {
    setError("");
    if (final) {
      setPhase("result");
      return;
    }
    setFeedback(null);
    setIndex(index + 1);
  }

  if (!detail) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>{lesson.title}</DialogTitle>
          <DialogDescription>{lesson.summary}</DialogDescription>
        </DialogHeader>
        {error ? (
          <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">
            {error}
          </p>
        ) : (
          <div className="grid place-items-center py-10">
            <LoaderCircle className="size-6 animate-spin text-ink-subtle" aria-label="Loading lesson" />
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <DialogHeader>
        <p className="flex items-center gap-2 pr-12 text-xs font-bold uppercase tracking-wider text-ink-subtle">
          <span className={cn("rounded-full px-2 py-0.5 normal-case tracking-normal", style.chip)}>{style.label}</span>
          {phase === "read" ? "📖 Study" : phase === "challenge" ? "⚔️ Challenge" : "🏆 Results"}
          <SoundToggle className="ml-auto min-h-8 px-2.5 normal-case tracking-normal" />
        </p>
        <DialogTitle className="mt-1.5 text-2xl font-black tracking-tight">{lesson.title}</DialogTitle>
        <DialogDescription className="sr-only">{lesson.summary}</DialogDescription>
      </DialogHeader>

      {phase === "read" && (
        <ReadCards
          outfit={outfit}
          detail={detail}
          index={card}
          onIndex={setCard}
          busy={busy}
          error={error}
          onStart={() => void start()}
        />
      )}

      {phase === "challenge" && attempt && (
        <div>
          {/* The HUD: progress as a gold track, hearts as lives, and the combo. */}
          <div className="flex items-center gap-3 rounded-2xl bg-sage-soft p-2.5 pl-3.5">
            <span className="tabular shrink-0 text-sm font-black text-ink">
              Q{index + 1}
              <span className="text-ink-subtle">/{attempt.questions.length}</span>
            </span>
            <div
              className="h-4 flex-1 overflow-hidden rounded-full bg-sage shadow-[inset_0_2px_0_rgb(0_0_0/0.15)]"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={attempt.questions.length}
              aria-valuenow={index + (feedback ? 1 : 0)}
              aria-label={`Question ${index + 1} of ${attempt.questions.length}`}
            >
              <div
                className="h-full rounded-full bg-[linear-gradient(90deg,#f5b82e,#19b394)] shadow-[inset_0_-3px_0_rgb(0_0_0/0.12)] transition-[width] duration-500"
                style={{ width: `${((index + (feedback ? 1 : 0)) * 100) / attempt.questions.length}%` }}
              />
            </div>
            <Hearts left={hearts} total={attempt.hearts_total} />
          </div>
          {combo >= 2 && (
            <p key={combo} className="mt-2 text-center">
              <span className="inline-block animate-pop rounded-full bg-[linear-gradient(90deg,#ff9a3d,#f0645a)] px-3 py-1 text-sm font-black text-white shadow-[0_3px_0_#b4441f]">
                <span aria-hidden="true">🔥</span> {combo} in a row!
              </span>
            </p>
          )}
          <QuestionCard
            topic={lesson.topic}
            outfit={outfit}
            key={attempt.questions[index].id}
            question={attempt.questions[index]}
            feedback={feedback}
            busy={busy}
            error={error}
            onSubmit={(body) => void submit(body)}
            onNext={next}
            lastStep={Boolean(final)}
          />
        </div>
      )}

      {phase === "result" && final?.result && (
        <ResultScreen
          outfit={outfit}
          result={final.result}
          detail={detail}
          busy={busy}
          onRetry={() => void start()}
          onReview={() => {
            setCard(0);
            setPhase("read");
          }}
          onClose={onClose}
          onTask={onTask}
        />
      )}
    </>
  );
}

function ReadCards({
  outfit,
  detail,
  index,
  onIndex,
  busy,
  error,
  onStart,
}: {
  outfit: Outfit;
  detail: LessonDetail;
  index: number;
  onIndex: (index: number) => void;
  busy: boolean;
  error: string;
  onStart: () => void;
}) {
  const last = index === detail.cards.length - 1;
  return (
    <div>
      <Scene topic={detail.card.topic} outfit={outfit} badge={`Card ${index + 1} of ${detail.cards.length}`}>
        <Bubble key={index} live>
          {detail.cards[index]}
        </Bubble>
      </Scene>
      {/* Cards read, as coins collected. */}
      <div className="mt-3 flex justify-center gap-2" aria-hidden="true">
        {detail.cards.map((_, dot) => (
          <span
            key={dot}
            className={cn(
              "grid size-7 place-items-center rounded-full border-2 text-xs font-black transition-colors",
              dot < index
                ? "border-[#c98a1c] bg-[radial-gradient(circle_at_35%_35%,#ffe6a8,#f2b84b)] text-[#6b4a00]"
                : dot === index
                  ? "animate-pop border-accent bg-accent-soft text-accent-strong"
                  : "border-line bg-surface text-ink-subtle",
            )}
          >
            {dot < index ? "✓" : dot + 1}
          </span>
        ))}
      </div>
      {last && (
        <>
          <div className="mt-4">
            <LessonExample lessonId={detail.card.id} />
          </div>
          {/* What's ahead, like a boss intro. */}
          <div className="mt-4 overflow-hidden rounded-3xl bg-[linear-gradient(135deg,#3b2a6b,#7b3fa0_55%,#f0645a)] p-4 text-white shadow-[0_5px_0_#2a1d4d]">
            <p className="text-xs font-black uppercase tracking-widest text-white/80">Challenge ahead</p>
            <p className="mt-1 text-lg font-black">Answer {detail.card.question_count} questions to clear the level</p>
            <div className="mt-3 flex flex-wrap gap-2 text-sm font-bold">
              <span className="rounded-full bg-white/20 px-3 py-1">
                <Heart className="mr-1 inline size-4 fill-[#ff6b81] text-[#ff6b81]" aria-hidden="true" />
                {detail.card.hearts} lives
              </span>
              <span className="rounded-full bg-white/20 px-3 py-1">❓ {detail.card.question_count} questions</span>
              <span className="rounded-full bg-[#ffe27a] px-3 py-1 text-[#6b4a00]">
                ⭐ Up to +{detail.card.xp_max} XP
              </span>
            </div>
            <p className="mt-2 text-xs text-white/80">The cards hide once you start, so take a second to re-read.</p>
          </div>
        </>
      )}
      {error && (
        <p role="alert" className="mt-3 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="mt-5 flex gap-2">
        {index > 0 && (
          <Button variant="outline" className="min-h-12 text-base font-bold" onClick={() => onIndex(index - 1)}>
            Back
          </Button>
        )}
        {last ? (
          <Button
            className="min-h-12 flex-1 bg-[linear-gradient(90deg,#f0645a,#b67df2)] text-base font-black text-white shadow-[0_4px_0_#8a4fc8] hover:brightness-110 active:translate-y-0.5 active:shadow-none"
            onClick={() => {
              play("tap");
              onStart();
            }}
            disabled={busy}
          >
            {busy ? (
              <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <span aria-hidden="true">⚔️</span>
            )}
            Start challenge
          </Button>
        ) : (
          <Button
            className="min-h-12 flex-1 text-base font-bold shadow-[0_4px_0_rgb(0_0_0/0.25)] active:translate-y-0.5 active:shadow-none"
            onClick={() => {
              play("tap");
              onIndex(index + 1);
            }}
          >
            Got it!
            <ArrowRight className="size-4" aria-hidden="true" />
          </Button>
        )}
      </div>
    </div>
  );
}

function Hearts({ left, total }: { left: number; total: number }) {
  return (
    <span
      className="flex shrink-0 gap-0.5"
      role="img"
      aria-label={`${left} of ${total} hearts left`}
      aria-live="polite"
    >
      {Array.from({ length: total }, (_, slot) =>
        slot < left ? (
          <Heart
            key={slot}
            className="size-6 fill-[#ff4d6d] text-[#ff4d6d] drop-shadow-[0_2px_0_#b0243f]"
            aria-hidden="true"
          />
        ) : (
          // Keyed by hearts left, so the heart just lost plays its break once.
          <HeartCrack
            key={`${slot}-${left}`}
            className={cn("size-6", slot === left ? "animate-heart-break text-danger" : "text-line-strong")}
            aria-hidden="true"
          />
        ),
      )}
    </span>
  );
}

const UNIT_HINT = {
  $: "Enter a dollar amount",
  "%": "Enter a percentage",
  years: "Enter a number of years",
  "": "Enter a number",
} as const;

function QuestionCard({
  topic,
  outfit,
  question,
  feedback,
  busy,
  error,
  onSubmit,
  onNext,
  lastStep,
}: {
  topic: string;
  outfit: Outfit;
  question: QuestionView;
  feedback: AnswerResult | null;
  busy: boolean;
  error: string;
  onSubmit: (body: { choices?: string[]; value?: string }) => void;
  onNext: () => void;
  lastStep: boolean;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [value, setValue] = useState("");
  const [order, setOrder] = useState(() => question.options.map((option) => option.id));
  const text = new Map(question.options.map((option) => [option.id, option.text]));
  const locked = feedback !== null;
  const ready = question.kind === "number" ? value.trim() !== "" : question.kind === "order" ? true : picked.length > 0;

  function check(event: FormEvent) {
    event.preventDefault();
    if (locked) {
      onNext();
      return;
    }
    if (!ready) return;
    onSubmit(question.kind === "number" ? { value } : { choices: question.kind === "order" ? order : picked });
  }

  function move(position: number, by: -1 | 1) {
    const next = [...order];
    [next[position], next[position + by]] = [next[position + by], next[position]];
    setOrder(next);
  }

  const optionState = (id: string) => {
    if (!feedback) return picked.includes(id) ? "picked" : "idle";
    if (feedback.correct_choices.includes(id)) return "right";
    return picked.includes(id) ? "wrong" : "idle";
  };

  return (
    <form onSubmit={check} className={cn("mt-3", feedback && !feedback.correct && "animate-shake")}>
      <Scene
        topic={topic}
        outfit={outfit}
        mood={feedback ? (feedback.correct ? "wow" : "sad") : "happy"}
        badge={
          question.kind === "multi" ? "Pick all that apply" : question.kind === "order" ? "Put in order" : "Question"
        }
      >
        <Bubble>{question.prompt}</Bubble>
      </Scene>
      <fieldset disabled={busy} className="mt-3">
        <legend className="sr-only">{question.prompt}</legend>
        {question.kind === "multi" && (
          <p className="mt-1 text-sm text-ink-subtle">
            Select all that apply. You need every right one, and none of the wrong ones.
          </p>
        )}
        {question.kind === "order" && (
          <p className="mt-1 text-sm text-ink-subtle">Use the arrows to put them in order, first at the top.</p>
        )}

        {(question.kind === "choice" || question.kind === "multi") && (
          <div className="mt-4 grid gap-2">
            {question.options.map((option, position) => {
              const stateOf = optionState(option.id);
              const single = question.kind === "choice";
              return (
                <label
                  key={option.id}
                  style={{ animationDelay: `${position * 70}ms` }}
                  className={cn(
                    "flex min-h-14 animate-pop items-center gap-3 rounded-2xl border-2 p-3 text-sm font-semibold transition-[transform,background-color,border-color] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent",
                    locked
                      ? "cursor-default"
                      : "cursor-pointer shadow-[0_4px_0_var(--color-line-strong)] hover:-translate-y-0.5 active:translate-y-0.5 active:shadow-none motion-reduce:transform-none",
                    stateOf === "right"
                      ? "border-[#19b394] bg-[#19b394]/15 shadow-[0_4px_0_#0e7d67]"
                      : stateOf === "wrong"
                        ? "border-danger bg-danger-soft shadow-[0_4px_0_var(--color-danger)]"
                        : stateOf === "picked"
                          ? "border-accent bg-accent-soft shadow-[0_4px_0_var(--color-accent-strong)]"
                          : "border-line bg-surface",
                  )}
                >
                  <span
                    className={cn(
                      "grid size-8 shrink-0 place-items-center rounded-xl text-sm font-black",
                      stateOf === "right"
                        ? "bg-[#19b394] text-white"
                        : stateOf === "wrong"
                          ? "bg-danger text-white"
                          : stateOf === "picked"
                            ? "bg-accent text-white"
                            : "bg-sage text-ink-muted",
                    )}
                    aria-hidden="true"
                  >
                    {String.fromCharCode(65 + position)}
                  </span>
                  <input
                    type={single ? "radio" : "checkbox"}
                    name={question.id}
                    checked={picked.includes(option.id)}
                    disabled={locked}
                    onChange={() =>
                      setPicked(
                        single
                          ? [option.id]
                          : picked.includes(option.id)
                            ? picked.filter((id) => id !== option.id)
                            : [...picked, option.id],
                      )
                    }
                    className="sr-only"
                  />
                  <span className="flex-1 text-ink">{option.text}</span>
                  {stateOf === "right" && (
                    <CircleCheck className="size-5 shrink-0 text-money-in" aria-label="Correct answer" />
                  )}
                  {stateOf === "wrong" && (
                    <CircleX className="size-5 shrink-0 text-danger" aria-label="Your answer, incorrect" />
                  )}
                </label>
              );
            })}
          </div>
        )}

        {question.kind === "number" && (
          <div className="mt-4">
            <label htmlFor={`${question.id}-value`} className="sr-only">
              {UNIT_HINT[question.unit]}
            </label>
            <div
              className={cn(
                "flex items-center rounded-2xl border-2 px-4 focus-within:ring-4 focus-within:ring-accent/15",
                feedback
                  ? feedback.correct
                    ? "border-zone-green bg-zone-green-soft"
                    : "border-danger bg-danger-soft"
                  : "border-line",
              )}
            >
              {question.unit === "$" && (
                <span className="text-2xl font-semibold text-ink-subtle" aria-hidden="true">
                  $
                </span>
              )}
              <input
                id={`${question.id}-value`}
                inputMode="decimal"
                autoComplete="off"
                value={value}
                readOnly={locked}
                onChange={(event) => setValue(event.target.value)}
                placeholder="0"
                className="tabular min-h-14 w-full min-w-0 bg-transparent px-1 text-2xl font-semibold text-ink placeholder:text-ink-subtle/50 focus:outline-none"
              />
              {question.unit === "%" && (
                <span className="text-2xl font-semibold text-ink-subtle" aria-hidden="true">
                  %
                </span>
              )}
              {question.unit === "years" && (
                <span className="text-base font-semibold text-ink-subtle" aria-hidden="true">
                  years
                </span>
              )}
            </div>
            {feedback && !feedback.correct && feedback.correct_value && (
              <p className="mt-2 text-sm text-ink">
                Answer:{" "}
                <span className="tabular font-semibold">
                  {question.unit === "$"
                    ? `$${Number(feedback.correct_value).toLocaleString("en-CA")}`
                    : `${feedback.correct_value}${question.unit === "%" ? "%" : question.unit === "years" ? " years" : ""}`}
                </span>
              </p>
            )}
          </div>
        )}

        {question.kind === "order" && (
          <ol className="mt-4 grid gap-2">
            {(feedback && !feedback.correct ? feedback.correct_choices : order).map((id, position, list) => (
              <li
                key={id}
                className={cn(
                  "flex min-h-12 items-center gap-2 rounded-xl border-2 p-2 pl-3 text-sm",
                  feedback
                    ? feedback.correct
                      ? "border-zone-green bg-zone-green-soft"
                      : "border-info bg-info-soft"
                    : "border-line",
                )}
              >
                <span
                  className="tabular grid size-7 shrink-0 place-items-center rounded-full bg-surface text-xs font-semibold text-ink-muted"
                  aria-hidden="true"
                >
                  {position + 1}
                </span>
                <span className="flex-1 text-ink">{text.get(id)}</span>
                {!locked && (
                  <span className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      onClick={() => move(position, -1)}
                      disabled={position === 0}
                      aria-label={`Move “${text.get(id)}” up`}
                      className="grid size-10 place-items-center rounded-lg text-ink-muted hover:bg-sage-soft disabled:opacity-30"
                    >
                      <ArrowUp className="size-4" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => move(position, 1)}
                      disabled={position === list.length - 1}
                      aria-label={`Move “${text.get(id)}” down`}
                      className="grid size-10 place-items-center rounded-lg text-ink-muted hover:bg-sage-soft disabled:opacity-30"
                    >
                      <ArrowDown className="size-4" aria-hidden="true" />
                    </button>
                  </span>
                )}
              </li>
            ))}
            {feedback && !feedback.correct && <p className="text-xs text-ink-subtle">Shown in the correct order.</p>}
          </ol>
        )}
      </fieldset>

      {feedback && (
        <div
          role="status"
          className={cn(
            "mt-4 rounded-2xl border-2 p-4",
            feedback.correct
              ? "animate-pop border-[#19b394] bg-[#19b394]/12"
              : "animate-enter border-danger/50 bg-danger-soft",
          )}
        >
          <p
            className={cn("flex items-center gap-2 font-semibold", feedback.correct ? "text-money-in" : "text-danger")}
          >
            {feedback.correct ? (
              <>
                <CircleCheck className="size-5" aria-hidden="true" />
                Correct!
              </>
            ) : (
              <>
                <HeartCrack className="size-5" aria-hidden="true" />
                Not quite. You lost a heart.
              </>
            )}
          </p>
          <p className="mt-1 text-sm leading-relaxed text-ink">{feedback.explanation}</p>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-3 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      <Button
        type="submit"
        className={cn(
          "mt-5 min-h-12 w-full text-base font-black shadow-[0_4px_0_rgb(0_0_0/0.25)] active:translate-y-0.5 active:shadow-none",
          locked && feedback?.correct && "bg-[#19b394] text-white shadow-[0_4px_0_#0e7d67] hover:bg-[#17a487]",
        )}
        disabled={busy || (!locked && !ready)}
      >
        {busy && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
        {!locked ? "Check answer" : lastStep ? "See results" : "Next question"}
      </Button>
    </form>
  );
}

function ResultScreen({
  outfit,
  result,
  detail,
  busy,
  onRetry,
  onReview,
  onClose,
  onTask,
}: {
  outfit: Outfit;
  result: NonNullable<AnswerResult["result"]>;
  detail: LessonDetail;
  busy: boolean;
  onRetry: () => void;
  onReview: () => void;
  onClose: () => void;
  onTask: (task: NonNullable<LessonDetail["task"]>) => void;
}) {
  const levelUp = result.level_after > result.level_before;
  useEffect(() => {
    if (!result.passed) {
      play("wrong");
      return;
    }
    play(levelUp ? "levelUp" : "win");
    confetti({ pieces: result.stars === 3 ? 180 : 110 });
    if (result.stars === 3) {
      const second = window.setTimeout(() => confetti({ x: 0.2, y: 0.5, pieces: 70, spread: 120 }), 350);
      const third = window.setTimeout(() => confetti({ x: 0.8, y: 0.5, pieces: 70, spread: 120 }), 600);
      return () => {
        window.clearTimeout(second);
        window.clearTimeout(third);
      };
    }
  }, [result.passed, result.stars, levelUp]);

  if (!result.passed) {
    return (
      <div className="text-center">
        <span className="relative mx-auto block w-fit animate-shake" aria-hidden="true">
          <Mascot outfit={outfit} mood="sad" className="size-24" />
          <HeartCrack className="absolute -right-2 top-0 size-8 text-danger" />
        </span>
        <p className="mt-4 text-xl font-semibold text-ink">Out of hearts</p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-ink-muted">
          That one’s tough. Re-read the cards (the explanations you just saw help too), then try again with full hearts.
          No XP is lost.
        </p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <Button variant="outline" className="flex-1" onClick={onReview}>
            <BookOpen className="size-4" aria-hidden="true" />
            Review the cards
          </Button>
          <Button className="flex-1" onClick={onRetry} disabled={busy}>
            <RotateCcw className="size-4" aria-hidden="true" />
            Try again
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="text-center">
      <span className="relative mx-auto block w-fit" aria-hidden="true">
        <span className="absolute inset-0 m-auto size-28 animate-glow rounded-full bg-gold-soft" />
        <Mascot outfit={outfit} mood="wow" className="relative size-28 animate-pop" />
        <Trophy className="absolute -right-3 bottom-2 size-10 animate-bob fill-[#ffd34d] text-[#c98a1c]" />
      </span>
      <p className="mt-5 text-2xl font-semibold tracking-tight text-ink">
        {result.stars === 3 ? "Flawless!" : "Lesson passed!"}
      </p>
      <PoppingStars count={result.stars} />
      <p className="mt-2 text-sm text-ink-muted">
        {result.mistakes === 0
          ? "No hearts lost."
          : `${result.mistakes} heart${result.mistakes === 1 ? "" : "s"} lost.`}{" "}
        {result.xp_awarded > 0 ? (
          <span className="font-semibold text-accent-strong">
            +<CountUp to={result.xp_awarded} /> XP
          </span>
        ) : result.stars < 3 ? (
          "Beat your best stars to earn more XP."
        ) : (
          "You’ve already earned the XP for this one."
        )}
      </p>
      {levelUp && (
        <p className="mx-auto mt-3 inline-flex animate-pop items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1.5 text-sm font-semibold text-accent-strong [animation-delay:900ms]">
          <Sparkles className="size-4" aria-hidden="true" />
          Level up! You’re now level {result.level_after}
        </p>
      )}
      {result.new_badges.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-subtle">
            New badge{result.new_badges.length === 1 ? "" : "s"}
          </p>
          <ul className="mt-2 flex animate-pop flex-wrap justify-center gap-2 [animation-delay:1100ms]">
            {result.new_badges.map((badge) => (
              <BadgeChip key={badge.id} badge={badge} />
            ))}
          </ul>
        </div>
      )}
      {detail.task && (
        <div className="mt-5 rounded-2xl border border-accent/30 bg-accent-soft/50 p-4 text-left">
          <p className="text-xs font-semibold uppercase tracking-wider text-accent-strong">Put it into practice</p>
          <p className="mt-1 text-sm font-semibold text-ink">{detail.task.label}</p>
          <Button
            size="sm"
            variant="outline"
            className="mt-3 bg-surface"
            onClick={() => detail.task && onTask(detail.task)}
          >
            {detail.task.prompt ? "Ask Penny" : "Go there"}
            <ArrowRight className="size-4" aria-hidden="true" />
          </Button>
        </div>
      )}
      <div className="mt-6 flex flex-col gap-2 sm:flex-row">
        {result.stars < 3 && (
          <Button variant="outline" className="flex-1" onClick={onRetry} disabled={busy}>
            <RotateCcw className="size-4" aria-hidden="true" />
            Replay for 3 stars
          </Button>
        )}
        <Button className="flex-1" onClick={onClose}>
          Back to lessons
        </Button>
      </div>
    </div>
  );
}

/** The result's stars, landing one after another; the ones not earned stay as outlines. */
function PoppingStars({ count }: { count: number }) {
  return (
    <span className="mt-3 flex justify-center gap-2" role="img" aria-label={`${count} of 3 stars`}>
      {[1, 2, 3].map((value) => (
        <Star
          key={value}
          style={{ animationDelay: `${200 + value * 220}ms` }}
          className={cn(
            "size-11",
            value <= count
              ? "animate-pop fill-gold text-gold drop-shadow-[0_2px_6px_rgb(239_173_61/0.5)]"
              : "text-line-strong",
            value === 2 && "-translate-y-2",
          )}
          aria-hidden="true"
        />
      ))}
    </span>
  );
}
