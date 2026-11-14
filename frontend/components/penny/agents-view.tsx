"use client";

import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import {
  Bell,
  BookOpen,
  Brain,
  Check,
  ChevronDown,
  Compass,
  CornerDownRight,
  CreditCard,
  ExternalLink,
  FilePenLine,
  Gift,
  Globe,
  GraduationCap,
  Handshake,
  History,
  LoaderCircle,
  type LucideIcon,
  MessageCircleQuestion,
  Route,
  ScanSearch,
  Shield,
  ShieldCheck,
  Stethoscope,
  TriangleAlert,
  Undo2,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import {
  type AgentApplied,
  type AgentId,
  type AgentLane,
  type AgentQuestion,
  type AutoTask,
  type Dashboard,
  type Finding,
  type MissionKind,
  type MissionRun,
  type TraceStep,
  agentApi,
  agentsApi,
  ApiError,
} from "@/lib/api";
import { formatShortDate } from "@/lib/format";
import { haptic, scheduleReminders } from "@/lib/native";
import { cn } from "@/lib/utils";
import { Mascot } from "./mascot";
import { PlanCard } from "./plan-card";
import { describeError, type View } from "./shared";

/**
 * Mission Control: give Penny's agents a goal and watch them work. Results come first (what to
 * approve, what was done, what matters); how the agents got there is one tap away. Penny (the
 * orchestrator) plans, the subagents run at the same time with their own tools, and a verifier
 * checks every figure and draft. The mission runs on the server; this page polls it.
 */

const POLL_MS = 700;
// A Watch mission this recent is news; an older one was already seen.
const WATCH_FRESH_MS = 3 * 60_000;

/** Each agent's look: its own icon and colour, used everywhere it appears. */
const AGENTS: Record<AgentId, { name: string; icon: LucideIcon; color: string; does: string }> = {
  analyst: { name: "Analyst", icon: ScanSearch, color: "#4a8fe7", does: "Spending" },
  cashflow: { name: "Cash-flow guard", icon: Shield, color: "#19b394", does: "Bills and payday" },
  planner: { name: "Planner", icon: Compass, color: "#9b6cf0", does: "Goals and budgets" },
  benefits: { name: "Benefits finder", icon: Gift, color: "#e39a2d", does: "Credits and grants" },
  people: { name: "People", icon: Handshake, color: "#ef6f6c", does: "Who owes you" },
  tutor: { name: "Tutor", icon: GraduationCap, color: "#d6589c", does: "Lessons" },
};

/** Missions to start with one tap (from the Penny AI welcome). */
export const AGENT_PRESETS: { kind: MissionKind; icon: LucideIcon; color: string; title: string; detail: string }[] = [
  { kind: "checkup", icon: Stethoscope, color: "#19b394", title: "Check-up", detail: "Spending, bills and goals" },
  { kind: "free_money", icon: Gift, color: "#e39a2d", title: "Find free money", detail: "Credits you may qualify for" },
  { kind: "payoff", icon: CreditCard, color: "#9b6cf0", title: "Pay off my card", detail: "The fastest way to zero" },
];

const TONE_COLOR: Record<Finding["tone"], string> = {
  alert: "var(--color-danger)",
  watch: "var(--color-gold)",
  good: "#19b394",
  info: "var(--color-info)",
};
const TONE_RANK: Record<Finding["tone"], number> = { alert: 0, watch: 1, good: 2, info: 3 };

const STEP_ICON: Record<TraceStep["kind"], LucideIcon> = {
  plan: Route,
  think: Brain,
  tool: Wrench,
  draft: FilePenLine,
  auto: Zap,
  check: ShieldCheck,
  error: TriangleAlert,
  ask: MessageCircleQuestion,
  web: Globe,
};

const uniqueAgents = (lanes: AgentLane[]) => [...new Set(lanes.map((lane) => lane.agent))];
const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};
/** What the mission cost the model, for the curious ("12 AI calls · 41k tokens, 63% cached"). */
const usage = (run: MissionRun) => {
  if (run.source !== "ai" || !run.ai_calls) return "Built-in playbooks (no AI calls)";
  const { input, cached, output, reused } = run.tokens;
  const thousands = Math.round((input + output) / 1000);
  const share = input ? Math.round((cached / input) * 100) : 0;
  return [
    `Penny AI · ${plural(run.ai_calls, "AI call")}`,
    thousands && `${thousands}k tokens, ${share}% from cache`,
    reused && `${plural(reused, "search")} reused`,
  ]
    .filter(Boolean)
    .join(" · ");
};
const seconds = (ms: number | null) => (ms === null ? "" : `${(ms / 1000).toFixed(1)}s`);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
/** The first sentence: the result card is a headline, not a report. */
const headline = (text: string | null) => text?.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? text ?? "";

/** The mission's reminders on the iPhone (a no-op in a browser). */
const remind = (run: MissionRun) =>
  scheduleReminders(
    run.id,
    run.auto.filter((task) => task.kind === "reminder"),
  );

// ------------------------------------------------------------------ shared bits

const GLYPH_SIZE = { xs: "size-6 rounded-lg", sm: "size-8 rounded-xl", md: "size-11 rounded-2xl" };
const GLYPH_ICON = { xs: "size-3.5", sm: "size-4", md: "size-5" };

/** An agent's tile: its icon on its colour, with a live ring while it works. */
function AgentGlyph({
  agent,
  size = "md",
  status,
  className,
}: {
  agent: AgentId;
  size?: keyof typeof GLYPH_SIZE;
  status?: AgentLane["status"];
  className?: string;
}) {
  const { icon: Icon, color } = AGENTS[agent];
  return (
    <span
      className={cn("relative grid shrink-0 place-items-center text-white", GLYPH_SIZE[size], className)}
      style={{ background: `linear-gradient(140deg, ${color}, color-mix(in srgb, ${color} 62%, #0b1a25))` }}
      aria-hidden="true"
    >
      <Icon className={GLYPH_ICON[size]} strokeWidth={2.25} />
      {(status === "running" || status === "waiting") && (
        <span
          className={cn("absolute inset-0 animate-ring border-2", GLYPH_SIZE[size])}
          style={{ borderColor: status === "waiting" ? "var(--color-gold)" : color }}
        />
      )}
      {status === "queued" && <span className={cn("absolute inset-0 bg-surface/55", GLYPH_SIZE[size])} />}
      {(status === "done" || status === "failed") && (
        <span
          className={cn(
            "absolute -bottom-1 -right-1 grid size-4 place-items-center rounded-full text-white ring-2 ring-surface",
            status === "done" ? "bg-[#19b394]" : "bg-danger",
          )}
        >
          {status === "done" ? <Check className="size-2.5" strokeWidth={3} /> : <X className="size-2.5" />}
        </span>
      )}
    </span>
  );
}

// ------------------------------------------------------------------ while it runs

const isDone = (lane: AgentLane) => lane.status === "done" || lane.status === "failed";

/** The agents at work, kept small inside the chat: who's on it, what's happening now, and any
 * question for the user. The full trace is in the answer's details. */
function MissionLive({ run }: { run: MissionRun }) {
  const finished = run.lanes.filter(isDone).length;
  const share = run.lanes.length ? Math.max(8, (finished / run.lanes.length) * 92) : 4;
  const latest = run.lanes
    .flatMap((lane) => lane.steps.map((step) => ({ step, lane })))
    .sort((a, b) => b.step.at_ms - a.step.at_ms)[0];
  const status = run.question
    ? `${AGENTS[run.question.agent].name} has a question for you`
    : latest
      ? `${latest.lane.name} · ${latest.lane.current ?? latest.step.title}`
      : "Penny is picking the team…";

  return (
    <Card className="overflow-hidden animate-enter" aria-live="polite">
      <div className="flex items-center gap-3 p-4">
        <span className="relative shrink-0">
          <span className="absolute inset-0 animate-ring rounded-full bg-accent/30" aria-hidden="true" />
          <Mascot face className="relative size-10" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-ink">{run.title}</p>
          <p key={status} className="truncate text-sm text-ink-subtle animate-fade">
            {status}
          </p>
        </div>
        {run.lanes.length > 0 && (
          <span className="shrink-0 text-xs font-semibold tabular-nums text-ink-subtle">
            {finished}/{run.lanes.length}
          </span>
        )}
      </div>
      <div className="h-1 bg-sage" aria-hidden="true">
        <div className="h-full bg-joy transition-[width] duration-500" style={{ width: `${share}%` }} />
      </div>
      {run.lanes.length > 0 && (
        <ul className="flex flex-wrap gap-2 px-4 py-3" aria-label="Agents">
          {run.lanes.map((lane) => (
            <li
              key={`${lane.agent}-${lane.wave}`}
              className={cn(
                "flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-xs font-medium animate-enter",
                lane.status === "running" || lane.status === "waiting"
                  ? "border-transparent bg-sage-soft text-ink"
                  : "border-line text-ink-muted",
              )}
              title={lane.because ?? lane.task}
            >
              <AgentGlyph agent={lane.agent} size="xs" status={lane.status} />
              {lane.wave > 1 && <CornerDownRight className="size-3 text-ink-subtle" aria-hidden="true" />}
              {lane.name}
              <span className="sr-only">: {lane.status}</span>
            </li>
          ))}
        </ul>
      )}
      {run.question && <QuestionCard run={run} question={run.question} />}
    </Card>
  );
}

/** An agent is waiting on the user: tap a choice or type an answer. */
function QuestionCard({ run, question }: { run: MissionRun; question: AgentQuestion }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  const inputId = useId();
  const agent = AGENTS[question.agent];

  async function send(answer: string) {
    if (!answer.trim()) return;
    setSending(true);
    setFailed(false);
    try {
      await agentsApi.answer(run.id, question.id, answer.trim());
      haptic("selection");
    } catch {
      setFailed(true);
      setSending(false);
    }
  }

  return (
    <div className="border-t border-line bg-gold-soft/50 p-4 animate-enter" role="group" aria-labelledby={inputId}>
      <div className="flex gap-3">
        <AgentGlyph agent={question.agent} status="waiting" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-ink-subtle">{agent.name} asks</p>
          <p id={inputId} className="mt-0.5 text-lg font-semibold leading-snug text-ink">
            {question.question}
          </p>
          <p className="mt-0.5 text-sm text-ink-muted">{question.why}</p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {question.choices.map((choice) => (
          <button
            key={choice}
            type="button"
            disabled={sending}
            onClick={() => void send(choice)}
            className="min-h-11 rounded-full border border-line-strong bg-surface px-4 text-sm font-semibold text-ink transition-colors hover:border-accent hover:bg-accent-soft disabled:opacity-50"
          >
            {choice}
          </button>
        ))}
      </div>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void send(text);
        }}
      >
        <label htmlFor={`${inputId}-answer`} className="sr-only">
          Your answer
        </label>
        <input
          id={`${inputId}-answer`}
          value={text}
          maxLength={200}
          autoComplete="off"
          onChange={(event) => setText(event.target.value)}
          placeholder="Or type your own answer"
          className="min-h-11 min-w-0 flex-1 rounded-xl border border-line-strong bg-surface px-3 text-sm text-ink focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15"
        />
        <Button type="submit" disabled={sending || !text.trim()}>
          {sending ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : "Answer"}
        </Button>
      </form>
      <p className="mt-2 text-xs text-ink-subtle">
        {failed ? "That didn’t send. Try again." : `No answer? It goes with: ${question.assumption}`}
      </p>
    </div>
  );
}

// ------------------------------------------------------------------ in the chat

/**
 * A mission inside the Penny AI chat: live while the agents work (with any question they ask),
 * then the answer the way an adviser gives it: the direct answer, the numbers that matter, the
 * options to pick from, and the steps to approve. Everything else is one tap away.
 */
export function MissionMessage({
  runId,
  dashboard,
  applyChange,
  onNavigate,
  onSend,
  onFinished,
}: {
  runId: string;
  dashboard: Dashboard;
  applyChange: (dashboard: Dashboard) => void;
  onNavigate: (view: View) => void;
  /** A message for Penny: an option the user picked follows up on this mission (`after`). */
  onSend: (text: string, after?: string) => void;
  /** The mission finished: its answer, so the chat can carry it as context. `live` is true
   * when it finished while on screen (not when an old chat is opened). */
  onFinished: (run: MissionRun, live: boolean) => void;
}) {
  const toast = useToast();
  const [run, setRun] = useState<MissionRun | null>(null);
  const [lost, setLost] = useState(false);
  const finished = useRef(onFinished);
  useEffect(() => {
    finished.current = onFinished;
  });

  const running = run === null || run.status === "running";
  useEffect(() => {
    if (!running) return;
    let active = true;
    let first = true;
    const load = () =>
      agentsApi
        .get(runId)
        .then((next) => {
          if (!active) return;
          setRun(next);
          if (next.status === "running") return;
          if (!first) {
            haptic(next.status === "done" ? "success" : "error");
            void remind(next).then((count) => {
              if (count)
                toast({
                  title: `${plural(count, "reminder")} set on your iPhone`,
                  description: "Your agents set them. Turn them off any time in the iPhone’s Settings.",
                });
            });
          }
          if (next.status === "done") finished.current(next, !first);
        })
        .catch((reason) => {
          // Only a mission the server doesn't have is gone; a network blip or a waking server
          // is retried on the next tick.
          if (active && reason instanceof ApiError && reason.status === 404) setLost(true);
        })
        .finally(() => {
          first = false;
        });
    void load();
    const timer = window.setInterval(() => void load(), POLL_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [runId, running, toast]);

  if (lost && !run)
    return (
      <p className="rounded-2xl bg-sage-soft px-4 py-3 text-sm text-ink-muted">
        This mission is no longer available. Ask again and Penny’s agents will redo it.
      </p>
    );
  if (!run)
    return (
      <Card className="flex items-center gap-3 p-4">
        <LoaderCircle className="size-5 animate-spin text-accent-strong" aria-hidden="true" />
        <span className="text-sm text-ink-muted">Penny is picking the team…</span>
      </Card>
    );
  if (run.status === "running") return <MissionLive run={run} />;
  return (
    <MissionAnswer
      run={run}
      dashboard={dashboard}
      applyChange={applyChange}
      onNavigate={onNavigate}
      onSend={onSend}
      onChange={setRun}
    />
  );
}

function MissionAnswer({
  run,
  dashboard,
  applyChange,
  onNavigate,
  onSend,
  onChange,
}: {
  run: MissionRun;
  dashboard: Dashboard;
  applyChange: (dashboard: Dashboard) => void;
  onNavigate: (view: View) => void;
  onSend: (text: string, after?: string) => void;
  onChange: (run: MissionRun) => void;
}) {
  const toast = useToast();
  const [undone, setUndone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [error, setError] = useState("");

  if (run.status === "failed")
    return (
      <Card className="flex items-center gap-3 p-4">
        <TriangleAlert className="size-5 shrink-0 text-danger" aria-hidden="true" />
        <p className="flex-1 text-sm text-ink">{run.error}</p>
        <Button variant="outline" size="sm" onClick={() => onSend(run.goal || run.title)}>
          Try again
        </Button>
      </Card>
    );

  const pending = run.steps.filter((step) => !run.approved.includes(step.id) && !run.declined.includes(step.id));
  const waiting = pending.length > 0 && !run.superseded;
  const findings = run.lanes
    .flatMap((lane) => lane.findings.map((finding) => ({ finding, lane })))
    .sort((a, b) => TONE_RANK[a.finding.tone] - TONE_RANK[b.finding.tone]);
  const sources = run.lanes.flatMap((lane) => lane.sources);
  const brief = run.brief;
  const answer = brief?.answer ?? run.summary ?? "";
  const lead = headline(answer);
  const rest = answer.slice(lead.length).trim();

  async function approved(applied: AgentApplied, kept: string[]) {
    haptic("success");
    const turnedDown = pending.map((step) => step.id).filter((id) => !kept.includes(id));
    try {
      onChange(await agentsApi.approved(run.id, kept, applied.undo_id, turnedDown));
    } catch {
      /* the change is applied; only the audit note failed */
    }
  }

  async function act(work: () => Promise<void>, failure: string) {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (reason) {
      setError(describeError(reason, failure).detail);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="overflow-hidden animate-enter">
      <div className="relative isolate p-4 sm:p-5">
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 bg-[radial-gradient(120%_90%_at_0%_0%,color-mix(in_srgb,var(--color-accent)_14%,transparent),transparent_60%),radial-gradient(90%_80%_at_100%_0%,color-mix(in_srgb,#9b6cf0_12%,transparent),transparent_60%)]"
        />
        <div className="flex flex-wrap items-center gap-2 text-xs text-ink-subtle">
          <span className="flex -space-x-1.5">
            {uniqueAgents(run.lanes).map((agent) => (
              <AgentGlyph key={agent} agent={agent} size="xs" className="ring-2 ring-surface" />
            ))}
          </span>
          {run.kind === "watch" ? (
            <span className="rounded-full bg-gold px-2 py-0.5 font-semibold text-[#3d2a00]">Penny noticed</span>
          ) : (
            <span className="font-medium">
              {plural(run.lanes.length, "agent run")} · {seconds(run.elapsed_ms)}
            </span>
          )}
          {(run.verification?.figures_checked ?? 0) > 0 && (
            <span className="inline-flex items-center gap-1">
              <ShieldCheck className="size-3.5 text-accent-strong" aria-hidden="true" />
              {run.verification!.figures_checked} figures checked
            </span>
          )}
        </div>

        <p className="mt-3 text-lg font-semibold leading-snug tracking-tight text-ink text-balance sm:text-xl">
          {lead}
        </p>
        {rest && <p className="mt-1.5 text-[15px] leading-relaxed text-ink-muted">{rest}</p>}

        {brief && brief.numbers.length > 0 && (
          <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {brief.numbers.slice(0, 4).map((number) => (
              <div key={number.label} className="rounded-2xl border border-line bg-surface/80 p-3">
                <dt className="line-clamp-2 text-xs font-medium leading-snug text-ink-subtle">{number.label}</dt>
                <dd
                  className={cn(
                    "mt-1 text-lg font-semibold tabular-nums tracking-tight",
                    /^[-−]/.test(number.value) ? "text-danger" : "text-ink",
                  )}
                >
                  {number.value}
                </dd>
              </div>
            ))}
          </dl>
        )}

        {brief && brief.options.length > 0 && (
          <div className="mt-4">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-subtle">What do you want to do?</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              {brief.options.map((option) => (
                <button
                  key={option.title}
                  type="button"
                  disabled={picked !== null}
                  aria-pressed={picked === option.title}
                  onClick={() => {
                    setPicked(option.title);
                    onSend(option.title, run.id);
                  }}
                  className={cn(
                    "flex min-h-14 flex-col items-start gap-1 rounded-2xl border p-3 text-left transition-colors disabled:cursor-default",
                    option.recommended
                      ? "border-accent bg-accent-soft hover:bg-accent-soft/70"
                      : "border-line bg-surface hover:border-accent",
                    picked !== null && picked !== option.title && "opacity-50",
                  )}
                >
                  <span className="flex w-full items-center gap-2 text-sm font-semibold text-ink">
                    {option.title}
                    {option.recommended && (
                      <span className="ml-auto rounded-full bg-[#0f8a72] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                        Suggested
                      </span>
                    )}
                  </span>
                  <span className="text-xs leading-snug text-ink-muted">{option.detail}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="space-y-4 border-t border-line p-4 sm:p-5">
        {run.memory.length > 0 && (
          <ul className="space-y-1.5" aria-label="Penny remembers">
            {run.memory.map((note) => (
              <li key={note.title} className="flex items-start gap-2 text-sm">
                <History
                  className="mt-0.5 size-4 shrink-0"
                  style={{ color: TONE_COLOR[note.tone] }}
                  aria-hidden="true"
                />
                <span className="min-w-0">
                  <span className="font-medium text-ink">{note.title}</span>
                  <span className="text-ink-subtle"> · {note.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        )}

        {pending.length > 0 && run.superseded ? (
          <Banner tone="muted" icon={TriangleAlert}>
            <span className="flex-1">A newer mission ran since, so these drafts may be out of date.</span>
            <Button variant="outline" size="sm" onClick={() => onSend(run.goal || run.title)}>
              Run it again
            </Button>
          </Banner>
        ) : waiting ? (
          <section aria-label="Needs your OK">
            <div className="flex items-center justify-between gap-3">
              <SectionTitle color="var(--color-gold)">Ready when you are</SectionTitle>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    onChange(
                      await agentsApi.declined(
                        run.id,
                        pending.map((step) => step.id),
                      ),
                    );
                  }, "That didn’t save")
                }
              >
                Not now
              </Button>
            </div>
            <div className="mt-2">
              <PlanCard
                compact
                allowChange={false}
                plan={{
                  heard: run.title,
                  steps: pending,
                  app: [],
                  question: null,
                  choices: [],
                  receipt: [],
                  source: run.source,
                  model: null,
                }}
                photo={null}
                dashboard={dashboard}
                applyChange={applyChange}
                onRefine={() => undefined}
                onVoice={() => undefined}
                onDone={(applied, kept) => void approved(applied, kept)}
                onAppOnly={() => undefined}
              />
            </div>
          </section>
        ) : run.approved.length > 0 ? (
          <Banner tone="good" icon={undone ? Undo2 : Check}>
            <span className="flex-1 font-medium">
              {undone ? "Undone. Everything is back." : `${plural(run.approved.length, "change")} applied`}
            </span>
            {run.undo_id && !undone && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    applyChange(await agentApi.undo(run.undo_id!));
                    setUndone(true);
                    toast({ title: "Undone", description: "Everything is back the way it was." });
                  }, "That couldn’t be undone")
                }
              >
                <Undo2 className="size-4" aria-hidden="true" />
                Undo
              </Button>
            )}
          </Banner>
        ) : run.declined.length > 0 ? (
          <Banner tone="muted" icon={History}>
            <span className="flex-1">
              Noted. Penny won’t suggest {run.declined.length === 1 ? "that" : "those"} again for a month.
            </span>
          </Banner>
        ) : null}
        {error && (
          <p role="alert" className="text-sm font-medium text-danger">
            {error}
          </p>
        )}

        <Details
          title={[
            run.auto.length && `${run.auto.length} done for you`,
            findings.length && plural(findings.length, "finding"),
            sources.length && plural(sources.length, "source"),
          ]
            .filter(Boolean)
            .join(" · ")}
        >
          {run.auto.length > 0 && (
            <section aria-label="Done for you">
              <SectionTitle color="#4a8fe7">Done for you</SectionTitle>
              <ul className="mt-2 space-y-1">
                {run.auto.map((task, index) => (
                  <AutoRow key={`${task.kind}-${task.title}-${index}`} task={task} onNavigate={onNavigate} />
                ))}
              </ul>
            </section>
          )}
          {findings.length > 0 && (
            <section aria-label="What the agents found">
              <SectionTitle color="#9b6cf0">What the agents found</SectionTitle>
              <ul className="mt-3 space-y-2">
                {findings.map(({ finding, lane }) => (
                  <FindingCard key={`${lane.agent}-${lane.wave}-${finding.title}`} finding={finding} lane={lane} />
                ))}
              </ul>
              {sources.length > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-ink-subtle">From the web:</span>
                  {sources.map((source) => (
                    <a
                      key={source.url}
                      href={source.url}
                      target="_blank"
                      rel="noreferrer"
                      title={source.title}
                      className="inline-flex min-h-8 items-center gap-1 rounded-full border border-line px-2.5 text-xs font-medium text-ink-muted hover:border-accent hover:text-ink"
                    >
                      <Globe className="size-3" aria-hidden="true" />
                      {hostOf(source.url)}
                    </a>
                  ))}
                </div>
              )}
            </section>
          )}
          <section aria-label="How your agents worked it out">
            <SectionTitle color="#19b394">How your agents worked it out</SectionTitle>
            <div className="mt-3">
              <HowItWorked run={run} />
            </div>
          </section>
        </Details>
      </div>
    </Card>
  );
}

/** The details under an answer: closed until asked for. */
function Details({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-11 w-full items-center gap-2 rounded-xl px-1 text-left text-sm font-semibold text-ink-muted hover:text-ink"
      >
        <ChevronDown className={cn("size-4 shrink-0 transition-transform", open && "rotate-180")} aria-hidden="true" />
        {open ? "Hide the details" : `Show the details${title ? ` · ${title}` : ""}`}
      </button>
      {open && (
        <div id={id} className="mt-3 space-y-6 animate-enter">
          {children}
        </div>
      )}
    </div>
  );
}

function SectionTitle({ color, children }: { color: string; children: ReactNode }) {
  return (
    <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-ink-subtle">
      <span className="size-1.5 rounded-full" style={{ background: color }} aria-hidden="true" />
      {children}
    </h3>
  );
}

function Banner({ tone, icon: Icon, children }: { tone: "good" | "muted"; icon: LucideIcon; children: ReactNode }) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-3 rounded-2xl px-4 py-3 text-sm text-ink",
        tone === "good" ? "bg-accent-soft" : "bg-sage-soft",
      )}
    >
      <span
        className={cn(
          "grid size-8 shrink-0 place-items-center rounded-full",
          tone === "good" ? "bg-[#0f8a72] text-white" : "bg-sage text-ink-muted",
        )}
        aria-hidden="true"
      >
        <Icon className="size-4" strokeWidth={2.5} />
      </span>
      {children}
    </div>
  );
}

function FindingCard({ finding, lane }: { finding: Finding; lane: AgentLane }) {
  return (
    <li className="relative flex gap-3 overflow-hidden rounded-2xl border border-line bg-surface p-3 pl-4">
      <span
        className="absolute inset-y-0 left-0 w-1"
        style={{ background: TONE_COLOR[finding.tone] }}
        aria-hidden="true"
      />
      <AgentGlyph agent={lane.agent} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-ink">{finding.title}</p>
        {finding.detail && <p className="mt-0.5 line-clamp-2 text-sm text-ink-muted">{finding.detail}</p>}
        <p className="mt-1 text-xs text-ink-subtle">{lane.name}</p>
      </div>
    </li>
  );
}

const AUTO_LOOK: Record<AutoTask["kind"], { icon: LucideIcon; tile: string }> = {
  reminder: { icon: Bell, tile: "bg-gold-soft text-gold-strong" },
  lesson: { icon: GraduationCap, tile: "bg-info-soft text-info" },
  guide: { icon: BookOpen, tile: "bg-accent-soft text-accent-strong" },
  link: { icon: ExternalLink, tile: "bg-sage text-ink-muted" },
};

function AutoRow({ task, onNavigate }: { task: AutoTask; onNavigate: (view: View) => void }) {
  const { icon: Icon, tile } = AUTO_LOOK[task.kind];
  const body = (
    <>
      <span className={cn("grid size-8 shrink-0 place-items-center rounded-xl", tile)} aria-hidden="true">
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1 truncate font-medium text-ink">{task.title}</span>
      {task.due_on && (
        <span className="shrink-0 rounded-full bg-sage px-2 py-0.5 text-xs font-medium tabular-nums text-ink-muted">
          {formatShortDate(task.due_on)}
        </span>
      )}
    </>
  );
  const row = "flex min-h-12 w-full items-center gap-3 rounded-xl px-2 text-left text-sm";
  if (task.kind === "lesson" || task.kind === "guide")
    return (
      <li>
        <button type="button" onClick={() => onNavigate("learn")} className={cn(row, "hover:bg-sage-soft")}>
          {body}
        </button>
      </li>
    );
  if (task.kind === "link" && task.ref)
    return (
      <li>
        <a href={task.ref} target="_blank" rel="noreferrer" className={cn(row, "hover:bg-sage-soft")}>
          {body}
        </a>
      </li>
    );
  return <li className={row}>{body}</li>;
}

// ------------------------------------------------------------------ how it worked (on demand)

function HowItWorked({ run }: { run: MissionRun }) {
  const v = run.verification;
  return (
    <ol className="relative space-y-3 before:absolute before:bottom-4 before:left-[15px] before:top-4 before:w-0.5 before:bg-line">
      <li className="relative flex gap-3">
        <Mascot face className="size-8 shrink-0 rounded-full bg-surface" />
        <div className="min-w-0 pt-1">
          <p className="text-sm font-semibold text-ink">Penny planned it</p>
          <p className="text-sm text-ink-muted">{run.plan}</p>
        </div>
      </li>

      {run.asked.map((asked) => (
        <li key={asked.id} className="relative flex gap-3">
          <span
            className="grid size-8 shrink-0 place-items-center rounded-xl bg-gold-soft text-gold-strong"
            aria-hidden="true"
          >
            <MessageCircleQuestion className="size-4" />
          </span>
          <div className="min-w-0 pt-1 text-sm">
            <p className="font-semibold text-ink">
              {AGENTS[asked.agent].name} asked: {asked.question}
            </p>
            <p className="text-ink-muted">
              {asked.answer ? `You said: ${asked.answer}` : `No answer, so it assumed: ${asked.assumption}`}
            </p>
          </div>
        </li>
      ))}

      {run.lanes
        .filter((lane) => lane.wave === 1)
        .map((lane) => (
          <AgentRow key={`${lane.agent}-1`} lane={lane} />
        ))}

      {run.lanes.some((lane) => lane.wave > 1) && (
        <>
          <li className="relative flex gap-3">
            <Mascot face className="size-8 shrink-0 rounded-full bg-surface" />
            <div className="min-w-0 pt-1">
              <p className="text-sm font-semibold text-ink">Penny read the reports and sent follow-ups</p>
              {run.review && <p className="text-sm text-ink-muted">{run.review}</p>}
            </div>
          </li>
          {run.lanes
            .filter((lane) => lane.wave > 1)
            .map((lane) => (
              <AgentRow key={`${lane.agent}-${lane.wave}`} lane={lane} />
            ))}
        </>
      )}

      {v && (
        <li className="relative flex gap-3">
          <span
            className="grid size-8 shrink-0 place-items-center rounded-xl bg-[#0f8a72] text-white"
            aria-hidden="true"
          >
            <ShieldCheck className="size-4" />
          </span>
          <div className="min-w-0 pt-1 text-sm">
            <p className="font-semibold text-ink">
              Verifier checked {v.figures_checked} figures and {plural(v.actions_checked, "draft")}
            </p>
            {v.notes.length > 0 ? (
              <ul className="mt-1 space-y-1 text-ink-muted">
                {v.notes.map((note) => (
                  <li key={note}>• {note}</li>
                ))}
              </ul>
            ) : (
              <p className="text-ink-muted">Every figure traced back to tested code.</p>
            )}
            <p className="mt-2 text-xs text-ink-subtle">
              {usage(run)} · finished in {seconds(run.elapsed_ms)}
            </p>
          </div>
        </li>
      )}
    </ol>
  );
}

function AgentRow({ lane }: { lane: AgentLane }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <li className="relative flex gap-3">
      <AgentGlyph agent={lane.agent} size="sm" status={lane.status === "failed" ? "failed" : undefined} />
      <div className="min-w-0 flex-1 rounded-2xl border border-line">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((value) => !value)}
          className="flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-ink">
              {lane.name}
              {lane.wave > 1 && (
                <span className="ml-1.5 rounded-full bg-sage px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                  Follow-up
                </span>
              )}
            </span>
            {lane.because && (
              <span className="flex items-center gap-1 text-xs text-ink-subtle">
                <CornerDownRight className="size-3 shrink-0" aria-hidden="true" />
                {lane.because}
              </span>
            )}
            <span className="block truncate text-xs text-ink-subtle">{lane.summary ?? lane.task}</span>
          </span>
          <span className="hidden shrink-0 text-xs tabular-nums text-ink-subtle sm:block">
            {plural(lane.tool_calls, "tool")} · {lane.model ?? "built-in"} · {seconds(lane.elapsed_ms)}
          </span>
          <ChevronDown
            className={cn("size-4 shrink-0 transition-transform", open && "rotate-180")}
            aria-hidden="true"
          />
        </button>
        {open && (
          <div id={id} className="space-y-3 border-t border-line p-3 animate-enter">
            <p className="text-xs text-ink-subtle">Task: {lane.task}</p>
            {lane.findings.length > 0 && (
              <ul className="space-y-2">
                {lane.findings.map((finding) => (
                  <li key={finding.title} className="flex gap-2.5 text-sm">
                    <span
                      className="mt-1.5 size-2 shrink-0 rounded-full"
                      style={{ background: TONE_COLOR[finding.tone] }}
                      aria-hidden="true"
                    />
                    <span className="min-w-0">
                      <span className="font-medium text-ink">{finding.title}</span>
                      {finding.detail && <span className="block text-ink-muted">{finding.detail}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <ol className="space-y-2 border-l-2 border-line pl-3">
              {lane.steps.map((step, index) => (
                <TraceRow key={`${step.at_ms}-${index}`} step={step} />
              ))}
            </ol>
          </div>
        )}
      </div>
    </li>
  );
}

function TraceRow({ step }: { step: TraceStep }) {
  const Icon = STEP_ICON[step.kind];
  return (
    <li className="flex gap-2 text-sm">
      <Icon
        className={cn(
          "mt-0.5 size-4 shrink-0",
          step.kind === "error"
            ? "text-danger"
            : step.kind === "draft"
              ? "text-gold-strong"
              : step.kind === "ask"
                ? "text-gold-strong"
                : step.kind === "web"
                  ? "text-info"
                  : step.kind === "auto" || step.kind === "check"
                    ? "text-accent-strong"
                    : "text-ink-subtle",
        )}
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1">
        <span className="text-ink">{step.title}</span>
        {step.kind === "tool" && step.detail && (
          <code className="ml-1.5 rounded bg-sage px-1.5 py-0.5 text-[11px] text-ink-muted">{step.detail}</code>
        )}
        {step.data && (
          <span className="mt-1 block overflow-x-auto rounded-lg bg-sage-soft px-2.5 py-2 font-mono text-[11px] leading-relaxed text-ink-muted">
            {step.data.input && Object.keys(step.data.input).length > 0 && (
              <span className="block break-all">in: {JSON.stringify(step.data.input)}</span>
            )}
            {step.data.output && <span className="block break-all">out: {step.data.output}</span>}
          </span>
        )}
      </span>
      <span className="shrink-0 text-xs tabular-nums text-ink-subtle">{seconds(step.at_ms)}</span>
    </li>
  );
}

// ------------------------------------------------------------------ autopilot

/**
 * Penny's proactive agents: the daily Autopilot check, started (or picked up) once the dashboard
 * loads, and Watch missions the server starts when a purchase tips a budget over, looked for
 * after each change to the dashboard. Each is followed until it finishes. Nothing they find
 * changes money without the user's approval.
 */
export function useAutopilot(enabled: boolean, dashboard: Dashboard | null): MissionRun | null {
  const toast = useToast();
  const [run, setRun] = useState<MissionRun | null>(null);
  const seen = useRef(new Set<string>());
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    agentsApi
      .autopilot()
      .then((found) => {
        if (!active) return;
        setRun((current) => current ?? found);
        if (found?.status === "done") void remind(found);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [enabled]);
  useEffect(() => {
    if (!enabled || !dashboard) return;
    let active = true;
    const timer = window.setTimeout(() => {
      agentsApi
        .list()
        .then(async (missions) => {
          const latest = missions.find((mission) => mission.kind === "watch");
          if (!active || !latest || seen.current.has(latest.id)) return;
          seen.current.add(latest.id);
          if (Date.now() - Date.parse(latest.started_at) > WATCH_FRESH_MS) return;
          const found = await agentsApi.get(latest.id);
          if (!active) return;
          setRun(found);
          haptic("light");
          toast({ title: `Penny noticed: ${found.title}`, description: "Her agents are already on it." });
        })
        .catch(() => undefined);
    }, 1_200);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [enabled, dashboard, toast]);
  const runningId = run?.status === "running" ? run.id : null;
  useEffect(() => {
    if (!runningId) return;
    const timer = window.setInterval(() => {
      agentsApi
        .get(runningId)
        .then((next) => {
          setRun(next);
          if (next.status === "done") void remind(next);
        })
        .catch(() => undefined);
    }, POLL_MS * 2);
    return () => window.clearInterval(timer);
  }, [runningId]);
  return run;
}

export function AutopilotBanner({ run, onOpen }: { run: MissionRun | null; onOpen: () => void }) {
  if (!run || run.status === "failed") return null;
  const pending = run.superseded ? 0 : run.steps.filter((step) => !run.approved.includes(step.id)).length;
  if (run.status === "done" && !pending && !run.auto.length) return null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="mb-5 flex w-full items-center gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-3 text-left shadow-[var(--shadow-card)] transition-colors hover:border-accent sm:p-4"
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#0b1a25] text-white" aria-hidden="true">
        {run.status === "running" ? <LoaderCircle className="size-5 animate-spin" /> : <Zap className="size-5" />}
      </span>
      <span className="min-w-0 flex-1" aria-live="polite">
        <span className="block font-semibold text-ink">
          {run.kind === "watch"
            ? `Penny noticed: ${run.title}`
            : run.status === "running"
              ? "Autopilot is checking your money…"
              : "Autopilot checked your money today"}
        </span>
        <span className="block text-sm text-ink-muted">
          {run.status === "running"
            ? "Your agents are on it."
            : [pending && `${pending} to approve`, run.auto.length && `${run.auto.length} done for you`]
                .filter(Boolean)
                .join(" · ")}
        </span>
      </span>
      <span className="shrink-0 text-sm font-semibold text-accent-strong">Review</span>
    </button>
  );
}
