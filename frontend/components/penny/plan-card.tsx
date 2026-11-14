"use client";

import { useId, useState } from "react";
import { Check, LoaderCircle, Mic, PencilLine, Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { type AgentApplied, type AgentPlan, type AgentStep, type Dashboard, type FriendRef, agentApi } from "@/lib/api";
import { haptic } from "@/lib/native";
import { cn } from "@/lib/utils";
import { Mascot } from "./mascot";
import { cad, describeError } from "./shared";

/**
 * Penny's plan, step by step, before anything is saved: each step can be left out, a split asks
 * who you were with, an open question takes a typed, tapped, or spoken answer, and "Do it" sends
 * the chosen actions to the API in one go. Used by the capture sheet and inside Penny AI's chat.
 */

/** An even split, for showing the shares after the user picks friends. The API works out the
 * same shares again when it saves (app.domain.splits.even_split). */
function evenSplit(total: number, people: number) {
  const each = Math.floor(total / people);
  return { mine: total - each * (people - 1), each };
}

const joinNames = (names: string[]) =>
  names.length <= 2 ? names.join(" and ") : `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`;

function FriendPicker({
  dashboard,
  taken,
  picked,
  wanted,
  onChange,
}: {
  dashboard: Dashboard;
  taken: FriendRef[];
  picked: FriendRef[];
  wanted: number;
  onChange: (next: FriendRef[]) => void;
}) {
  const [name, setName] = useState("");
  const inputId = useId();
  const friends = dashboard.accounts.filter(
    (account) => account.account_type === "person" && !taken.some((friend) => friend.id === account.id),
  );
  const has = (ref: FriendRef) =>
    picked.some((item) => (ref.id ? item.id === ref.id : item.name.toLowerCase() === ref.name.toLowerCase()));
  const toggle = (ref: FriendRef) =>
    onChange(
      has(ref) ? picked.filter((item) => (ref.id ? item.id !== ref.id : item.name !== ref.name)) : [...picked, ref],
    );
  const add = () => {
    const clean = name.trim().slice(0, 60);
    if (!clean) return;
    // A friend already in Penny is picked, not added again.
    const known = dashboard.accounts.find(
      (account) => account.account_type === "person" && account.name.toLowerCase() === clean.toLowerCase(),
    );
    const ref = known
      ? { id: known.id, name: known.name }
      : { id: null, name: clean[0].toUpperCase() + clean.slice(1) };
    if (!has(ref)) onChange([...picked, ref]);
    setName("");
  };
  return (
    <div className="mt-3 space-y-2 rounded-xl bg-gold-soft/70 p-3" data-sheet-no-drag>
      <p className="text-xs font-semibold text-gold-strong">
        Who were you with?{wanted > 0 && ` (${wanted} more, you said)`}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {[...friends.map((f) => ({ id: f.id, name: f.name })), ...picked.filter((p) => !p.id)].map((ref) => (
          <button
            key={ref.id ?? `new-${ref.name}`}
            type="button"
            aria-pressed={has(ref)}
            onClick={() => toggle(ref)}
            className={cn(
              "min-h-9 rounded-full border px-3 text-sm font-medium transition-colors",
              has(ref)
                ? "border-[#15977f] bg-[#15977f] text-white"
                : "border-line bg-surface text-ink hover:border-accent",
            )}
          >
            {has(ref) && <Check className="mr-1 inline size-3.5 align-[-2px]" aria-hidden="true" />}
            {ref.name}
          </button>
        ))}
      </div>
      <div className="flex gap-1.5">
        <label htmlFor={inputId} className="sr-only">
          Add a friend by name
        </label>
        <input
          id={inputId}
          value={name}
          maxLength={60}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add();
            }
          }}
          placeholder="Add a name"
          className="min-h-10 min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 text-sm text-ink focus:border-accent focus:outline-none"
        />
        <Button type="button" size="sm" variant="outline" onClick={add} disabled={!name.trim()}>
          Add
        </Button>
      </div>
    </div>
  );
}

function StepCard({
  step,
  index,
  kept,
  onToggle,
  dashboard,
  picked,
  onPick,
}: {
  step: AgentStep;
  index: number;
  kept: boolean;
  onToggle: () => void;
  dashboard: Dashboard;
  picked: FriendRef[];
  onPick: (next: FriendRef[]) => void;
}) {
  const action = step.action;
  let title = step.title;
  let lines = step.lines;
  const split = action.kind === "split" ? action : null;
  if (split && picked.length) {
    // The user picked friends here, so show the shares for the people they picked.
    const people = [...split.friends, ...picked];
    const { mine, each } = evenSplit(split.total_cents, people.length + 1);
    const names = people.map((friend) => friend.name);
    title = `Split ${split.description} ${people.length + 1} ways`;
    lines = [
      `You paid ${cad(split.total_cents)} · your share ${cad(mine)}`,
      names.length === 1 ? `${names[0]} owes you ${cad(each)}` : `${joinNames(names)} owe you ${cad(each)} each`,
      ...(picked.some((friend) => !friend.id)
        ? [`Adds ${joinNames(picked.filter((f) => !f.id).map((f) => f.name))} to your friends`]
        : []),
    ];
  }
  return (
    <li
      style={{ animationDelay: `${index * 90}ms` }}
      className={cn(
        "rounded-2xl border bg-surface p-3 shadow-[var(--shadow-card)] transition-opacity animate-enter",
        kept ? "border-line" : "border-dashed border-line opacity-55",
      )}
    >
      <div className="flex items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-sage text-2xl" aria-hidden="true">
          {step.emoji}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-ink">{title}</p>
          <ul className="mt-0.5 space-y-0.5">
            {lines.map((line) => (
              <li
                key={line}
                className={cn("text-sm", line.includes("over by") ? "font-medium text-danger" : "text-ink-muted")}
              >
                {line}
              </li>
            ))}
          </ul>
        </div>
        <button
          type="button"
          role="checkbox"
          aria-checked={kept}
          aria-label={`Include: ${title}`}
          onClick={onToggle}
          className="grid size-11 shrink-0 place-items-center"
        >
          <span
            className={cn(
              "grid size-7 place-items-center rounded-lg border-2 transition-colors",
              kept ? "border-[#15977f] bg-[#15977f] text-white" : "border-line-strong bg-surface",
            )}
          >
            {kept && <Check className="size-4" aria-hidden="true" />}
          </span>
        </button>
      </div>
      {split && kept && (step.needs_friends > 0 || picked.length > 0) && (
        <FriendPicker
          dashboard={dashboard}
          taken={split.friends}
          picked={picked}
          wanted={Math.max(0, step.needs_friends - picked.length)}
          onChange={onPick}
        />
      )}
    </li>
  );
}

export function PlanCard({
  plan,
  photo,
  dashboard,
  applyChange,
  onRefine,
  onVoice,
  onDone,
  onAppOnly,
  compact = false,
}: {
  /** Inside Penny AI's chat: no header (the chat already shows who said what). */
  compact?: boolean;
  plan: AgentPlan;
  photo: string | null;
  dashboard: Dashboard;
  applyChange: (dashboard: Dashboard) => void;
  onRefine: (text: string) => void;
  onVoice: () => void;
  onDone: (applied: AgentApplied) => void;
  onAppOnly: () => void;
}) {
  const [kept, setKept] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(plan.steps.map((step) => [step.id, true])),
  );
  const [picked, setPicked] = useState<Record<string, FriendRef[]>>({});
  const [refining, setRefining] = useState(Boolean(plan.question));
  const [extra, setExtra] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const refineId = useId();

  const chosen = plan.steps.filter((step) => kept[step.id]);
  const actions = chosen.map((step) =>
    step.action.kind === "split"
      ? { ...step.action, friends: [...step.action.friends, ...(picked[step.id] ?? [])] }
      : step.action,
  );
  const missingFriends = actions.some((action) => action.kind === "split" && action.friends.length === 0);

  async function doIt() {
    if (!actions.length) {
      onAppOnly();
      return;
    }
    setBusy(true);
    setError("");
    try {
      const applied = await agentApi.apply(actions);
      applyChange(applied.dashboard);
      onDone(applied);
    } catch (reason) {
      haptic("error");
      setError(describeError(reason, "That couldn’t be saved").detail);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {compact ? (
        <p className="font-semibold text-ink">
          {plan.steps.length || plan.app.length ? "Here’s what I’ll do" : "Quick question"}
        </p>
      ) : (
        <div className="flex items-start gap-3">
          {photo ? (
            // eslint-disable-next-line @next/next/no-img-element -- a local photo preview
            <img
              src={photo}
              alt="Your receipt"
              className="size-14 shrink-0 rounded-xl border border-line object-cover"
            />
          ) : (
            <Mascot className="size-14 shrink-0" mood={plan.steps.length || plan.app.length ? "happy" : "wow"} />
          )}
          <div className="min-w-0">
            <p className="text-xl font-semibold tracking-tight text-ink">
              {plan.steps.length || plan.app.length ? "Here’s what I’ll do" : "One quick question"}
            </p>
            <p className="truncate text-sm text-ink-muted">“{plan.heard}”</p>
          </div>
        </div>
      )}

      {plan.steps.length > 0 && (
        <ul className="space-y-2.5">
          {plan.steps.map((step, index) => (
            <StepCard
              key={step.id}
              step={step}
              index={index}
              kept={Boolean(kept[step.id])}
              onToggle={() => setKept((value) => ({ ...value, [step.id]: !value[step.id] }))}
              dashboard={dashboard}
              picked={picked[step.id] ?? []}
              onPick={(next) => setPicked((value) => ({ ...value, [step.id]: next }))}
            />
          ))}
        </ul>
      )}

      {plan.app.length > 0 && (
        <ul className="space-y-2">
          {plan.app.map((item, index) => (
            <li
              key={item.kind + item.value}
              style={{ animationDelay: `${(plan.steps.length + index) * 90}ms` }}
              className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-3 shadow-[var(--shadow-card)] animate-enter"
            >
              <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-sage text-2xl" aria-hidden="true">
                {item.emoji}
              </span>
              <span className="font-semibold text-ink">{item.title}</span>
            </li>
          ))}
        </ul>
      )}

      {plan.question && (
        <div className="space-y-2">
          <p className="rounded-xl border border-gold/50 bg-gold-soft px-4 py-3 text-sm font-medium text-gold-strong">
            🤔 {plan.question}
          </p>
          {plan.choices.length > 0 && (
            <div className="flex flex-wrap gap-2" aria-label="Quick answers">
              {plan.choices.map((choice) => (
                <button
                  key={choice}
                  type="button"
                  onClick={() => onRefine(choice)}
                  className="min-h-10 rounded-full border border-line bg-surface px-3.5 text-sm font-medium text-ink transition-colors hover:border-accent hover:bg-accent-soft"
                >
                  {choice}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {refining ? (
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (extra.trim()) onRefine(extra.trim());
          }}
        >
          <label htmlFor={refineId} className="sr-only">
            {plan.question ?? "What should Penny change?"}
          </label>
          <input
            id={refineId}
            autoFocus
            value={extra}
            maxLength={300}
            onChange={(event) => setExtra(event.target.value)}
            placeholder={plan.question ? "Type your answer, or tap the mic" : "Actually it was $45, and Ana paid"}
            className="min-h-11 min-w-0 flex-1 rounded-xl border border-line-strong bg-surface px-3 text-base text-ink focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15"
          />
          <Button type="button" variant="outline" size="icon" onClick={onVoice} aria-label="Say it">
            <Mic className="size-5" aria-hidden="true" />
          </Button>
          <Button type="submit" size="icon" disabled={!extra.trim()} aria-label="Send">
            <Send className="size-5" aria-hidden="true" />
          </Button>
        </form>
      ) : null}

      {error && (
        <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger">
          {error}
        </p>
      )}

      {/* While Penny is waiting on an answer, only the answer moves things on. */}
      {(plan.steps.length > 0 || (plan.app.length > 0 && !plan.question)) && (
        <div className="flex gap-2">
          {!refining && (
            <Button variant="outline" className="gap-2" onClick={() => setRefining(true)}>
              <PencilLine className="size-4" aria-hidden="true" />
              Change
            </Button>
          )}
          <Button
            className="h-12 flex-1 gap-2 bg-gradient-to-r from-[#15977f] to-[#356fc4] text-base text-white hover:brightness-110"
            disabled={busy || (!chosen.length && !plan.app.length) || missingFriends}
            onClick={() => void doIt()}
          >
            {busy ? (
              <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />
            ) : (
              <Sparkles className="size-5" aria-hidden="true" />
            )}
            {missingFriends
              ? "Pick who you were with"
              : chosen.length + plan.app.length > 1
                ? `Do all ${chosen.length + plan.app.length}`
                : "Do it"}
          </Button>
        </div>
      )}
      <p className="text-center text-xs text-ink-subtle">
        {plan.source === "ai" ? "Read by Penny AI" : "Read by Penny"} · amounts and shares worked out by Penny · nothing
        saved until you tap
      </p>
    </div>
  );
}
