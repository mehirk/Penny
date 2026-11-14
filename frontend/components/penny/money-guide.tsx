"use client";

import { useMemo, useState } from "react";
import { BookOpenCheck, Check, ExternalLink, Search, Sparkles, TriangleAlert, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { confetti, play } from "./game-fx";
import {
  type Block,
  CATEGORIES,
  type Guide,
  type GuideCategory,
  GUIDES,
  GUIDES_CHECKED,
  QUIZZES,
  type QuizItem,
  type Stat,
} from "./guide-content";
import { Mascot, type Outfit } from "./mascot";
import { SectionHeading } from "./shared";

/**
 * The Money Guide: a library of plain-language guides to Canadian money rules (accounts, credit,
 * taxes, benefits, protections), each with its official sources. Which guides were read is kept
 * on this device only.
 */

const READ_KEY = "penny-guides-read";

function savedRead(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(READ_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

const tintOf = (category: GuideCategory) => CATEGORIES.find((item) => item.id === category)?.tint ?? "";

function searchable(guide: Guide): string {
  const text = guide.blocks.map((block) =>
    block.kind === "table"
      ? [block.heading, ...block.columns, ...block.rows.flat()].join(" ")
      : block.kind === "list" || block.kind === "steps"
        ? [block.heading, ...block.items].join(" ")
        : block.kind === "text"
          ? `${block.heading ?? ""} ${block.body}`
          : block.body,
  );
  return [guide.title, guide.tagline, ...(guide.stats ?? []).map((s) => `${s.value} ${s.label}`), ...text]
    .join(" ")
    .toLowerCase();
}

export function MoneyGuide({
  outfit,
  request,
  onAsk,
}: {
  outfit: Outfit;
  /** From Penny's plan: open the first unread guide in this area (`nonce` changes per request). */
  request?: { area: string; nonce: number } | null;
  onAsk: (question: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<GuideCategory | "all">("all");
  const [open, setOpen] = useState<Guide | null>(null);
  const [read, setRead] = useState<string[]>(savedRead);
  const [all, setAll] = useState(false);
  const [handled, setHandled] = useState(0);
  if (request && request.nonce !== handled) {
    setHandled(request.nonce);
    const inArea = GUIDES.filter((guide) => guide.category === request.area);
    const target = inArea.find((guide) => !read.includes(guide.id)) ?? inArea[0];
    if (target) {
      setCategory(target.category);
      setOpen(target);
    }
  }
  const index = useMemo(() => new Map(GUIDES.map((guide) => [guide.id, searchable(guide)])), []);

  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = GUIDES.filter(
    (guide) =>
      (category === "all" || guide.category === category) && words.every((word) => index.get(guide.id)?.includes(word)),
  );
  // Learn is long already: the full list shows on request, or when searching or filtering.
  const collapsed = !all && category === "all" && words.length === 0;
  const visible = collapsed ? shown.slice(0, 6) : shown;
  const done = read.filter((id) => GUIDES.some((guide) => guide.id === id)).length;

  function markRead(guide: Guide) {
    if (read.includes(guide.id)) return;
    const next = [...read, guide.id];
    setRead(next);
    try {
      window.localStorage.setItem(READ_KEY, JSON.stringify(next));
    } catch {
      /* storage blocked: progress lasts until the page reloads */
    }
    const categoryDone = GUIDES.filter((item) => item.category === guide.category).every((item) =>
      next.includes(item.id),
    );
    play(categoryDone ? "win" : "coin");
    confetti({ pieces: categoryDone ? 160 : 60, spread: categoryDone ? 360 : 90, y: categoryDone ? 0.35 : 0.8 });
  }

  return (
    <section aria-labelledby="guide-title" className="space-y-4">
      <SectionHeading
        id="guide-title"
        title="Money Guide"
        description="Everything official sources say about money in Canada, in plain language."
      />

      {/* Library banner */}
      <div className="relative overflow-hidden rounded-[var(--radius-card)] bg-[linear-gradient(135deg,#2b2f6b,#4a4fb0_45%,#19a37f)] p-5 text-white shadow-[var(--shadow-card)] sm:p-6">
        <svg
          viewBox="0 0 400 140"
          className="pointer-events-none absolute inset-0 size-full opacity-25"
          preserveAspectRatio="xMidYMid slice"
          aria-hidden="true"
        >
          {/* A bookshelf of different-height spines along the bottom. */}
          {Array.from({ length: 26 }, (_, i) => (
            <rect
              key={i}
              x={i * 16}
              y={140 - (34 + ((i * 37) % 30))}
              width="13"
              height={34 + ((i * 37) % 30)}
              rx="2"
              fill={["#ffd34d", "#ff8fb1", "#7fd6b0", "#9fb6ff", "#ffffff"][i % 5]}
            />
          ))}
        </svg>
        <div className="relative flex items-center gap-4">
          <Mascot
            outfit={outfit === "none" ? "grad" : outfit}
            className="hidden size-24 shrink-0 animate-bob sm:block"
          />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-black uppercase tracking-widest text-white/75">Penny’s library</p>
            <p className="mt-1 text-xl font-black leading-tight sm:text-2xl">
              Accounts, credit, taxes, benefits, and your rights
            </p>
            <p className="mt-1 text-sm text-white/80">
              {GUIDES.length} guides from Canada.ca, the CRA, and the FCAC · Updated {GUIDES_CHECKED}
            </p>
            <div className="mt-3 flex items-center gap-3">
              <div className="h-3 flex-1 overflow-hidden rounded-full bg-white/20" aria-hidden="true">
                <div
                  className="h-full rounded-full bg-[linear-gradient(90deg,#ffd34d,#7fd6b0)] transition-[width] duration-700"
                  style={{ width: `${(done * 100) / GUIDES.length}%` }}
                />
              </div>
              <span className="tabular shrink-0 text-sm font-black">
                ⭐ {done}/{GUIDES.length} cleared
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Search and topics */}
      <div className="space-y-3">
        <label className="relative block">
          <span className="sr-only">Search the Money Guide</span>
          <Search
            className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-ink-subtle"
            aria-hidden="true"
          />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search: TFSA, credit score, tax brackets, scams…"
            className="min-h-12 w-full rounded-2xl border border-line bg-surface pl-12 pr-4 text-base text-ink placeholder:text-ink-subtle/80 focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15"
          />
        </label>
        <div
          className="scroll-area -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0"
          role="group"
          aria-label="Topics"
        >
          {[{ id: "all" as const, label: "All", emoji: "✨" }, ...CATEGORIES].map((item) => {
            const active = category === item.id;
            const count =
              item.id === "all" ? GUIDES.length : GUIDES.filter((guide) => guide.category === item.id).length;
            return (
              <button
                key={item.id}
                type="button"
                aria-pressed={active}
                onClick={() => setCategory(item.id)}
                className={cn(
                  "inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold transition-colors",
                  active
                    ? "border-transparent bg-primary text-on-primary"
                    : "border-line bg-surface text-ink hover:bg-sage-soft",
                )}
              >
                <span aria-hidden="true">{item.emoji}</span>
                {item.label}
                <span className={cn("tabular text-xs", active ? "opacity-80" : "text-ink-subtle")}>{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Guides */}
      {shown.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-[var(--radius-card)] border border-dashed border-line-strong p-8 text-center">
          <Mascot mood="sad" outfit={outfit} className="size-16" />
          <p className="font-semibold text-ink">No guides match “{query}”</p>
          <Button variant="outline" size="sm" onClick={() => setQuery("")}>
            Clear search
          </Button>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((guide) => {
            const isRead = read.includes(guide.id);
            const stat = guide.stats?.[0];
            return (
              <li key={guide.id}>
                <button
                  type="button"
                  onClick={() => {
                    play("tap");
                    setOpen(guide);
                  }}
                  className="group flex h-full w-full flex-col overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface text-left shadow-[var(--shadow-card)] transition-transform hover:-translate-y-0.5 motion-reduce:transform-none"
                >
                  <span
                    className={cn(
                      "relative flex items-center gap-3 bg-gradient-to-br p-4 text-white",
                      tintOf(guide.category),
                    )}
                  >
                    <span
                      className="grid size-12 shrink-0 place-items-center rounded-2xl bg-white/90 text-2xl shadow-[0_3px_0_rgb(0_0_0/0.15)] transition-transform group-hover:-rotate-6 group-hover:scale-110 motion-reduce:transform-none"
                      aria-hidden="true"
                    >
                      {guide.emoji}
                    </span>
                    {stat && (
                      <span className="min-w-0">
                        <span className="tabular block truncate text-lg font-black leading-tight">{stat.value}</span>
                        <span className="line-clamp-1 text-xs text-white/85">{stat.label}</span>
                      </span>
                    )}
                    {isRead && (
                      <span className="absolute right-3 top-3 rounded-full bg-white px-2 py-0.5 text-xs font-black text-[#0e7d67]">
                        ⭐ Cleared
                      </span>
                    )}
                  </span>
                  <span className="flex flex-1 flex-col p-4">
                    <span className="font-bold leading-snug text-ink">{guide.title}</span>
                    <span className="mt-1 flex-1 text-sm text-ink-muted">{guide.tagline}</span>
                    <span className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-ink-subtle">
                      <Zap className="size-3.5" aria-hidden="true" />
                      {isRead ? "Play again" : `${QUIZZES[guide.id]?.length ?? 0}-question blitz`}
                      <span className="ml-auto">{CATEGORIES.find((c) => c.id === guide.category)?.label}</span>
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {collapsed && shown.length > visible.length && (
        <Button variant="outline" className="min-h-12 w-full text-base font-bold" onClick={() => setAll(true)}>
          Show all {shown.length} guides
        </Button>
      )}

      <Dialog open={open !== null} onOpenChange={(value) => !value && setOpen(null)}>
        <DialogContent className="sm:max-w-3xl">
          {open && (
            <Reader
              guide={open}
              outfit={outfit}
              read={read.includes(open.id)}
              onRead={() => markRead(open)}
              onAsk={(question) => {
                setOpen(null);
                onAsk(question);
              }}
              onOpen={(id) => {
                const next = GUIDES.find((guide) => guide.id === id);
                if (next) setOpen(next);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}

function Reader({
  guide,
  outfit,
  read,
  onRead,
  onAsk,
  onOpen,
}: {
  guide: Guide;
  outfit: Outfit;
  read: boolean;
  onRead: () => void;
  onAsk: (question: string) => void;
  onOpen: (id: string) => void;
}) {
  const category = CATEGORIES.find((item) => item.id === guide.category);
  const related = GUIDES.filter((item) => item.category === guide.category && item.id !== guide.id).slice(0, 3);
  return (
    <article key={guide.id}>
      <header
        className={cn(
          "relative mt-8 overflow-hidden rounded-3xl bg-gradient-to-br px-5 py-6 text-white sm:px-7",
          tintOf(guide.category),
        )}
      >
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -right-10 -top-12 size-48 rounded-full bg-white/15"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-16 right-24 size-32 rounded-full bg-white/10"
        />
        <div className="relative flex items-start gap-4">
          <span
            className="grid size-16 shrink-0 animate-pop place-items-center rounded-3xl bg-white/90 text-4xl shadow-[0_4px_0_rgb(0_0_0/0.15)]"
            aria-hidden="true"
          >
            {guide.emoji}
          </span>
          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-widest text-white/80">
              {category?.emoji} {category?.label} · {QUIZZES[guide.id]?.length ?? 0} question blitz
            </p>
            <DialogTitle className="mt-1 text-2xl font-black leading-tight text-white sm:text-3xl">
              {guide.title}
            </DialogTitle>
            <DialogDescription className="mt-1 text-base text-white/90">{guide.tagline}</DialogDescription>
          </div>
        </div>
      </header>

      <div className="space-y-6 pt-6">
        <FactBlitz key={guide.id} quiz={QUIZZES[guide.id] ?? []} outfit={outfit} cleared={read} onCleared={onRead} />

        {guide.stats && (
          <div>
            <p className="mb-2 text-sm font-black uppercase tracking-wider text-ink-subtle">
              Guess the number, then tap to reveal
            </p>
            <div className={cn("grid gap-2.5", guide.stats.length >= 3 ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-2")}>
              {guide.stats.map((stat, position) => (
                <FlipStat key={stat.label} stat={stat} delay={position * 90} />
              ))}
            </div>
          </div>
        )}

        <details className="group rounded-2xl border border-line">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-2 px-4 text-sm font-bold text-ink">
            <span className="flex items-center gap-2">
              <BookOpenCheck className="size-4 text-accent-strong" aria-hidden="true" />
              Read the full guide · {guide.minutes} min
            </span>
            <span className="text-ink-subtle transition-transform group-open:rotate-180" aria-hidden="true">
              ▾
            </span>
          </summary>
          <div className="space-y-6 border-t border-line p-4">
            {guide.blocks.map((block, position) => (
              <BlockView key={position} block={block} outfit={outfit} />
            ))}
          </div>
        </details>

        <div className="rounded-2xl border border-line p-4">
          <p className="flex items-center gap-2 text-sm font-bold text-ink">
            <BookOpenCheck className="size-4 text-accent-strong" aria-hidden="true" />
            Official sources
          </p>
          <ul className="mt-2 space-y-1.5">
            {guide.sources.map((source) => (
              <li key={source.url}>
                <a
                  href={source.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-8 items-center gap-1.5 text-sm font-semibold text-info underline-offset-2 hover:underline"
                >
                  {source.label}
                  <ExternalLink className="size-3.5" aria-hidden="true" />
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs leading-relaxed text-ink-subtle">
            General education, last checked {GUIDES_CHECKED}. Rules and amounts change, so confirm on the official
            pages. This isn’t personal financial, tax, or legal advice.
          </p>
        </div>

        {related.length > 0 && (
          <div>
            <p className="text-sm font-bold text-ink">Keep reading</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {related.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onOpen(item.id)}
                  className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-sm font-semibold text-ink hover:bg-sage-soft"
                >
                  <span aria-hidden="true">{item.emoji}</span>
                  {item.title}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2 sm:flex-row">
          {guide.ask && (
            <Button variant="outline" className="min-h-12 flex-1 text-base font-bold" onClick={() => onAsk(guide.ask!)}>
              <Sparkles className="size-4" aria-hidden="true" />
              Ask Penny AI about this
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}

function BlockView({ block, outfit }: { block: Block; outfit: Outfit }) {
  const heading = "heading" in block && block.heading && (
    <h3 className="mb-2 text-lg font-bold tracking-tight text-ink">{block.heading}</h3>
  );
  switch (block.kind) {
    case "text":
      return (
        <div>
          {heading}
          <p className="text-base leading-relaxed text-ink-muted">{block.body}</p>
        </div>
      );
    case "list":
      return (
        <div>
          {heading}
          <ul className="space-y-2">
            {block.items.map((item) => (
              <li key={item} className="flex gap-3 text-base leading-relaxed text-ink-muted">
                <span
                  className="mt-1 grid size-5 shrink-0 place-items-center rounded-full bg-accent-soft text-accent-strong"
                  aria-hidden="true"
                >
                  <Check className="size-3" strokeWidth={3} />
                </span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      );
    case "steps":
      return (
        <div>
          {heading}
          <ol className="space-y-2.5">
            {block.items.map((item, position) => (
              <li key={item} className="flex gap-3 text-base leading-relaxed text-ink-muted">
                <span
                  className="grid size-7 shrink-0 place-items-center rounded-full bg-[linear-gradient(135deg,#f5b82e,#19b394)] text-sm font-black text-white shadow-[0_2px_0_rgb(0_0_0/0.2)]"
                  aria-hidden="true"
                >
                  {position + 1}
                </span>
                <span className="pt-0.5">{item}</span>
              </li>
            ))}
          </ol>
        </div>
      );
    case "tip":
      return (
        <div className="flex items-start gap-3">
          <Mascot outfit={outfit} className="size-12 shrink-0" />
          <p className="flex-1 rounded-2xl rounded-tl-sm border border-[#19b394]/30 bg-[#19b394]/10 px-4 py-3 text-sm leading-relaxed text-ink">
            <span className="font-bold text-[#0e7d67]">Penny’s tip: </span>
            {block.body}
          </p>
        </div>
      );
    case "warning":
      return (
        <p className="flex gap-3 rounded-2xl border border-[#f39a2b]/40 bg-[#f39a2b]/10 px-4 py-3 text-sm leading-relaxed text-ink">
          <TriangleAlert className="mt-0.5 size-5 shrink-0 text-[#c46f0f]" aria-hidden="true" />
          <span>{block.body}</span>
        </p>
      );
    case "table":
      return (
        <div>
          {heading}
          <div className="overflow-x-auto rounded-2xl border border-line">
            <table className="w-full min-w-[28rem] text-left text-sm">
              <thead className="bg-sage-soft">
                <tr>
                  {block.columns.map((column) => (
                    <th key={column} scope="col" className="px-3.5 py-2.5 font-bold text-ink">
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row) => (
                  <tr key={row.join("|")} className="border-t border-line">
                    {row.map((cell, column) =>
                      column === 0 ? (
                        <th key={column} scope="row" className="px-3.5 py-2.5 font-semibold text-ink">
                          {cell}
                        </th>
                      ) : (
                        <td key={column} className="tabular px-3.5 py-2.5 text-ink-muted">
                          {cell}
                        </td>
                      ),
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
  }
}

/**
 * The guide as a quick game: a few multiple-choice questions with instant feedback. Clearing it
 * (answering every one) marks the guide as read.
 */
function FactBlitz({
  quiz,
  outfit,
  cleared,
  onCleared,
}: {
  quiz: QuizItem[];
  outfit: Outfit;
  cleared: boolean;
  onCleared: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  if (quiz.length === 0) return null;
  const item = quiz[index];
  const right = picked !== null && picked === item.answer;

  function pick(option: number) {
    if (picked !== null) return;
    setPicked(option);
    if (option === item.answer) {
      setScore((value) => value + 1);
      play("correct");
      confetti({ y: 0.6, pieces: 40, spread: 80 });
    } else {
      play("wrong");
    }
  }

  function next() {
    if (index + 1 < quiz.length) {
      setIndex(index + 1);
      setPicked(null);
      return;
    }
    setDone(true);
    onCleared();
  }

  function replay() {
    setIndex(0);
    setPicked(null);
    setScore(0);
    setDone(false);
  }

  return (
    <div className="overflow-hidden rounded-3xl bg-[linear-gradient(135deg,#2b2f6b,#4a4fb0_55%,#7b4fd8)] p-4 text-white shadow-[0_5px_0_#1d2050] sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <span className="rounded-full bg-white/15 px-3 py-1 text-xs font-black uppercase tracking-widest">
          ⚡ Fact Blitz
        </span>
        <span className="flex gap-1.5" aria-label={`Question ${Math.min(index + 1, quiz.length)} of ${quiz.length}`}>
          {quiz.map((_, dot) => (
            <span
              key={dot}
              className={cn(
                "size-3 rounded-full",
                dot < index || done ? "bg-[#ffd34d]" : dot === index ? "bg-white" : "bg-white/30",
              )}
            />
          ))}
        </span>
      </div>

      {done ? (
        <div className="flex flex-col items-center gap-2 py-3 text-center" role="status">
          <Mascot outfit={outfit} mood={score === quiz.length ? "wow" : "happy"} className="size-20 animate-pop" />
          <p className="text-2xl font-black">
            {score === quiz.length ? "Perfect blitz!" : score > 0 ? "Guide cleared!" : "Nice try!"}
          </p>
          <p className="text-sm text-white/85">
            {score} of {quiz.length} right · Open the full guide below to dig deeper.
          </p>
          <button
            type="button"
            onClick={replay}
            className="mt-1 min-h-10 rounded-full bg-white/15 px-4 text-sm font-bold hover:bg-white/25"
          >
            Play again
          </button>
        </div>
      ) : (
        <div key={index} className="animate-enter">
          <p className="mt-3 text-lg font-black leading-snug sm:text-xl">{item.q}</p>
          <div className="mt-3 grid gap-2">
            {item.options.map((option, position) => {
              const state =
                picked === null ? "idle" : position === item.answer ? "right" : position === picked ? "wrong" : "dim";
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => pick(position)}
                  disabled={picked !== null}
                  className={cn(
                    "flex min-h-12 items-center gap-3 rounded-2xl px-3 text-left text-base font-bold transition-transform",
                    state === "idle" &&
                      "bg-white text-[#1d2050] shadow-[0_4px_0_rgb(0_0_0/0.25)] hover:-translate-y-0.5 active:translate-y-0.5 active:shadow-none",
                    state === "right" && "animate-pop bg-[#19b394] text-white shadow-[0_4px_0_#0e7d67]",
                    state === "wrong" && "animate-shake bg-[#f0645a] text-white shadow-[0_4px_0_#b23a31]",
                    state === "dim" && "bg-white/20 text-white/70",
                  )}
                >
                  <span
                    className={cn(
                      "grid size-8 shrink-0 place-items-center rounded-xl text-sm font-black",
                      state === "idle" ? "bg-[#ece9ff] text-[#4a4fb0]" : "bg-white/25",
                    )}
                    aria-hidden="true"
                  >
                    {state === "right" ? "✓" : state === "wrong" ? "✗" : String.fromCharCode(65 + position)}
                  </span>
                  {option}
                </button>
              );
            })}
          </div>
          {picked !== null && (
            <div className="mt-3 flex items-start gap-2" role="status">
              <Mascot outfit={outfit} mood={right ? "wow" : "sad"} className="size-10 shrink-0" />
              <p className="flex-1 rounded-2xl rounded-tl-sm bg-white px-3 py-2 text-sm font-semibold text-[#1d2050]">
                <span className={right ? "text-[#0e7d67]" : "text-[#b23a31]"}>{right ? "Yes! " : "Not quite. "}</span>
                {item.why}
              </p>
            </div>
          )}
          {picked !== null && (
            <button
              type="button"
              onClick={next}
              className="mt-3 min-h-12 w-full rounded-2xl bg-[#ffd34d] text-base font-black text-[#5a3b00] shadow-[0_4px_0_#c98a1c] active:translate-y-0.5 active:shadow-none"
            >
              {index + 1 < quiz.length ? "Next question →" : cleared ? "Finish" : "Clear the guide ⭐"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** A key number, face down until tapped: a tiny guessing game. */
function FlipStat({ stat, delay }: { stat: Stat; delay: number }) {
  const [shown, setShown] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        if (!shown) play("coin");
        setShown(true);
      }}
      aria-label={shown ? `${stat.value}: ${stat.label}` : `Reveal: ${stat.label}`}
      style={{ animationDelay: `${delay}ms` }}
      className={cn(
        "flex min-h-24 animate-pop flex-col justify-center rounded-2xl p-3.5 text-left transition-colors",
        shown
          ? "border border-line bg-sage-soft/60"
          : "bg-[linear-gradient(135deg,#ffd34d,#f39a2b)] text-[#5a3b00] shadow-[0_4px_0_#c46f0f] hover:brightness-105",
      )}
    >
      {shown ? (
        <span key="value" className="animate-pop">
          <span className="tabular block text-2xl font-black tracking-tight text-ink">{stat.value}</span>
          <span className="mt-0.5 block text-xs font-semibold leading-snug text-ink-subtle">{stat.label}</span>
        </span>
      ) : (
        <>
          <span className="block text-2xl font-black">❓</span>
          <span className="mt-0.5 block text-xs font-bold leading-snug">{stat.label}</span>
        </>
      )}
    </button>
  );
}
