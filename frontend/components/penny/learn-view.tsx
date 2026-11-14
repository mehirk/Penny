"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Award,
  Check,
  Flame,
  Lock,
  LoaderCircle,
  RefreshCw,
  SlidersHorizontal,
  Star,
  Swords,
  Trophy,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  type Dashboard,
  type LearnBadge,
  type LearnCountry,
  type LearnProfile,
  type LearnState,
  learnApi,
  type LessonCard,
  type LessonTaskView,
  type LessonTier,
  type LessonTrack,
  type Mission,
  type TopicPath,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { CreditCalculator } from "./credit-tool";
import { Arcade } from "./arcade";
import { confetti, confettiFrom, CountUp, play, SoundToggle } from "./game-fx";
import { Mascot, type Outfit, useOutfit, Wardrobe } from "./mascot";
import { MoneyGuide } from "./money-guide";
import { SkillMap } from "./skill-map";
import { Building, TownScene } from "./money-town";
import { toneFor } from "./tone";
import { LessonPlayer } from "./lesson-player";
import { BadgeChip, Stars, TIER_STYLE } from "./learn-shared";
import { describeError, SectionHeading } from "./shared";

type Props = {
  dashboard: Dashboard;
  onCompleteMission: (mission: Mission) => void;
  /** Applies the snapshot returned when a lesson ends, so XP and streaks update everywhere. */
  onProgress: (dashboard: Dashboard) => void;
  onNavigate: (view: LessonTaskView) => void;
  onAsk: (question: string) => void;
};

const COUNTRIES: { id: LearnCountry; flag: string; name: string; detail: string }[] = [
  { id: "CA", flag: "🇨🇦", name: "Canada", detail: "CRA and T4s, TFSA/RRSP/FHSA, CDIC, the 35% interest cap" },
  { id: "US", flag: "🇺🇸", name: "United States", detail: "IRS and W-2s, 401(k)/IRA/Roth, FDIC, the CARD Act" },
];

const TOPIC_CHOICES: { id: LessonTrack; label: string; blurb: string }[] = [
  { id: "budgeting", label: "Budgeting", blurb: "Plan money before it’s spent" },
  { id: "saving", label: "Saving", blurb: "Emergency funds, interest, goals" },
  { id: "tax", label: "Tax", blurb: "Brackets, slips, refunds, credits" },
  { id: "credit", label: "Credit", blurb: "Scores, interest, paying down debt" },
  { id: "rules", label: "Rules & rights", blurb: "Deposit insurance, loan laws, scams" },
  { id: "investing", label: "Investing", blurb: "Accounts, fees, compounding" },
];

const LEVELS: { id: LessonTier; title: string; detail: string }[] = [
  { id: "easy", title: "I’m new to this", detail: "Start every topic at Easy. Pass a level to unlock the next." },
  { id: "medium", title: "I know the basics", detail: "Easy and Medium are open from the start." },
  { id: "hard", title: "Challenge me", detail: "Every level is open, Hard included." },
];

function useLearnState(version: number) {
  const [state, setState] = useState<LearnState | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(() => {
    learnApi
      .state()
      .then((next) => {
        setState(next);
        setError("");
      })
      .catch((reason: unknown) => setError(describeError(reason, "Couldn’t load your lessons").detail));
  }, []);
  // Reload whenever XP changes elsewhere (a challenge completed, a lesson finished).
  useEffect(() => {
    load();
  }, [load, version]);
  return { state, setState, error, reload: load };
}

export function LearnView({ dashboard, onCompleteMission, onProgress, onNavigate, onAsk }: Props) {
  const { state, setState, error, reload } = useLearnState(dashboard.xp_total);
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState<LessonCard | null>(null);
  // Bumped when a lesson ends, so the arcade re-checks today's quests.
  const [arcadeVersion, setArcadeVersion] = useState(0);
  const [outfit, setOutfit] = useOutfit(state?.level ?? 1);
  const persona = dashboard.profile.persona;
  const grown = toneFor(persona) === "grown";
  // Penny's plan opens guides and games elsewhere on Learn.
  const [guideRequest, setGuideRequest] = useState<{ area: string; nonce: number } | null>(null);
  const [gameRequest, setGameRequest] = useState<{ game: string; nonce: number } | null>(null);

  if (error && !state) {
    return (
      <Card className="mx-auto max-w-xl p-6 text-center">
        <p className="font-semibold text-ink">Your lessons didn’t load</p>
        <p className="mt-1 text-sm text-ink-subtle">{error}</p>
        <Button className="mt-4" variant="outline" onClick={reload}>
          <RefreshCw className="size-4" aria-hidden="true" />
          Try again
        </Button>
      </Card>
    );
  }
  if (!state)
    return (
      <div className="mx-auto max-w-5xl space-y-4" aria-busy="true" aria-label="Loading lessons">
        {[0, 1, 2].map((key) => (
          <div key={key} className="h-40 animate-pulse rounded-[var(--radius-card)] bg-sage-soft" />
        ))}
      </div>
    );

  if (!state.profile.country) {
    return (
      <div className="mx-auto max-w-3xl">
        <Card className="p-5 sm:p-8">
          <p className="text-sm font-semibold uppercase tracking-wider text-accent-strong">Set up your learning</p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight text-ink">
            Learn money the way it works where you live
          </h2>
          <p className="mt-1 text-sm text-ink-muted">Three quick questions. You can change any of them later.</p>
          <ProfileForm initial={state.profile} submitLabel="Start learning" onSaved={setState} />
        </Card>
        <div className="mt-6">
          <Arcade version={arcadeVersion} outfit={outfit} onProgress={reload} grown={grown} />
          <MoneyGuide outfit={outfit} />
        </div>
      </div>
    );
  }

  const country = COUNTRIES.find((item) => item.id === state.profile.country) ?? COUNTRIES[0];
  // Paths in the order that fits who Penny is coaching.
  const rank = (id: string) => (TOPIC_ORDER[persona ?? "student"] ?? []).indexOf(id);
  const selected = state.topics.filter((topic) => topic.selected).sort((a, b) => rank(a.id) - rank(b.id));
  const others = state.topics.filter((topic) => !topic.selected);
  const credit = selected.some((topic) => topic.id === "credit");

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <GameHud
        state={state}
        country={country}
        persona={persona}
        name={dashboard.profile.display_name.split(" ")[0]}
        outfit={outfit}
        onOutfit={setOutfit}
        onEdit={() => setEditing(true)}
      />
      <SkillMap
        version={arcadeVersion}
        outfit={outfit}
        onProgress={reload}
        onLesson={(lessonId) => {
          const lesson = state.topics.flatMap((topic) => topic.lessons).find((item) => item.id === lessonId);
          if (lesson) setOpen(lesson);
        }}
        onGuide={(area) => setGuideRequest({ area, nonce: Date.now() })}
        onGame={(game) => setGameRequest({ game, nonce: Date.now() })}
      />
      <Arcade version={arcadeVersion} outfit={outfit} launch={gameRequest} onProgress={reload} grown={grown} />
      <MoneyGuide outfit={outfit} request={guideRequest} />
      <BadgeShelf badges={state.badges} />

      <section aria-labelledby="paths-title" className="space-y-4">
        <SectionHeading
          id="paths-title"
          title="Your paths"
          description="Read the cards, then beat the challenge. Wrong answers cost a heart; run out and you start again."
        />
        {selected.map((topic) => (
          <TopicRow key={topic.id} topic={topic} onOpen={setOpen} />
        ))}
        {others.length > 0 && (
          <details className="rounded-[var(--radius-card)] border border-dashed border-line-strong bg-sage-soft/40 p-4">
            <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-2 text-sm font-semibold text-ink">
              More topics ({others.length})
              <span className="text-xs font-normal text-ink-subtle">Add them under Customize</span>
            </summary>
            <div className="mt-3 space-y-4">
              {others.map((topic) => (
                <TopicRow key={topic.id} topic={topic} onOpen={setOpen} />
              ))}
            </div>
          </details>
        )}
      </section>

      <Challenges missions={dashboard.missions} onComplete={onCompleteMission} />

      {credit && dashboard.credit && (
        <section aria-labelledby="credit-tool-title">
          <SectionHeading
            id="credit-tool-title"
            title="Try it: credit utilization"
            description="Use your fictional card, or change the numbers."
          />
          <CreditCalculator
            defaultBalance={dashboard.credit.balance_cents}
            defaultLimit={dashboard.credit.credit_limit_cents}
          />
        </section>
      )}

      <p className="px-1 text-xs text-ink-subtle">
        Lessons are general education for {country.name}, current to 2026. They aren’t personal tax, legal, credit, or
        investment advice.
      </p>

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Customize your learning</DialogTitle>
            <DialogDescription>Your stars and XP are kept when you switch country or topics.</DialogDescription>
          </DialogHeader>
          {editing && (
            <ProfileForm
              initial={state.profile}
              submitLabel="Save"
              onSaved={(next) => {
                setState(next);
                setEditing(false);
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <LessonPlayer
        outfit={outfit}
        lesson={open}
        onClose={() => setOpen(null)}
        onFinished={(snapshot) => {
          setArcadeVersion((version) => version + 1);
          if (snapshot) onProgress(snapshot);
          else reload();
        }}
        onTask={(task) => {
          setOpen(null);
          if (task.prompt) onAsk(task.prompt);
          else onNavigate(task.view);
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Profile: country, topics, starting level

function ProfileForm({
  initial,
  submitLabel,
  onSaved,
}: {
  initial: LearnProfile;
  submitLabel: string;
  onSaved: (state: LearnState) => void;
}) {
  const [step, setStep] = useState(0);
  const [country, setCountry] = useState<LearnCountry | null>(initial.country);
  const [topics, setTopics] = useState<LessonTrack[]>(
    initial.country ? initial.topics : ["budgeting", "saving", "tax"],
  );
  const [level, setLevel] = useState<LessonTier>(initial.start_tier);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const steps = ["Country", "Topics", "Level"];
  const canContinue = step === 0 ? country !== null : step === 1 ? topics.length > 0 : true;

  async function save() {
    if (!country) return;
    setBusy(true);
    setError("");
    try {
      onSaved(await learnApi.setProfile({ country, topics, start_tier: level }));
    } catch (reason) {
      setError(describeError(reason, "Couldn’t save").detail);
    } finally {
      setBusy(false);
    }
  }

  const option = (on: boolean) =>
    cn(
      "flex cursor-pointer items-center gap-3 rounded-xl border-2 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent",
      on ? "border-accent bg-accent-soft/60" : "border-line hover:border-line-strong",
    );

  return (
    <div className="mt-5">
      <ol className="mb-5 flex items-center gap-2" aria-label="Steps">
        {steps.map((label, index) => (
          <li key={label} className="flex flex-1 items-center gap-2" aria-current={index === step ? "step" : undefined}>
            <span
              className={cn(
                "grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold",
                index < step
                  ? "bg-accent text-white"
                  : index === step
                    ? "bg-primary text-on-primary"
                    : "bg-sage text-ink-subtle",
              )}
            >
              {index < step ? <Check className="size-3.5" aria-hidden="true" /> : index + 1}
            </span>
            <span className={cn("text-sm", index === step ? "font-semibold text-ink" : "text-ink-subtle")}>
              {label}
            </span>
            {index < steps.length - 1 && <span className="hidden h-px flex-1 bg-line sm:block" aria-hidden="true" />}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <fieldset>
          <legend className="text-base font-semibold text-ink">Where do you live?</legend>
          <p className="mt-0.5 text-sm text-ink-subtle">Tax, credit, accounts, and consumer rules differ by country.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {COUNTRIES.map((item) => (
              <label key={item.id} className={cn(option(country === item.id), "min-h-24 items-start rounded-2xl p-4")}>
                <input
                  type="radio"
                  name="learn-country"
                  value={item.id}
                  checked={country === item.id}
                  onChange={() => setCountry(item.id)}
                  className="sr-only"
                />
                <span className="text-3xl leading-none" aria-hidden="true">
                  {item.flag}
                </span>
                <span className="min-w-0">
                  <span className="block font-semibold text-ink">{item.name}</span>
                  <span className="mt-0.5 block text-xs text-ink-subtle">{item.detail}</span>
                </span>
                {country === item.id && (
                  <Check className="ml-auto size-5 shrink-0 text-accent-strong" aria-hidden="true" />
                )}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {step === 1 && (
        <fieldset>
          <legend className="text-base font-semibold text-ink">What do you want to learn?</legend>
          <p className="mt-0.5 text-sm text-ink-subtle">
            Pick at least one. Each topic has Easy, Medium, and Hard levels.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {TOPIC_CHOICES.map((item) => {
              const on = topics.includes(item.id);
              return (
                <label key={item.id} className={cn(option(on), "min-h-14 px-3 py-2")}>
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() =>
                      setTopics((current) => (on ? current.filter((id) => id !== item.id) : [...current, item.id]))
                    }
                    className="size-5 shrink-0 accent-[var(--color-accent)]"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-ink">{item.label}</span>
                    <span className="block text-xs text-ink-subtle">{item.blurb}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      )}

      {step === 2 && (
        <fieldset>
          <legend className="text-base font-semibold text-ink">How much do you already know?</legend>
          <p className="mt-0.5 text-sm text-ink-subtle">This only decides what’s unlocked at the start.</p>
          <div className="mt-3 grid gap-2">
            {LEVELS.map((item) => (
              <label key={item.id} className={cn(option(level === item.id), "min-h-16 px-4 py-3")}>
                <input
                  type="radio"
                  name="learn-level"
                  checked={level === item.id}
                  onChange={() => setLevel(item.id)}
                  className="sr-only"
                />
                <span
                  className={cn("shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold", TIER_STYLE[item.id].chip)}
                >
                  {TIER_STYLE[item.id].label}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-ink">{item.title}</span>
                  <span className="block text-xs text-ink-subtle">{item.detail}</span>
                </span>
                {level === item.id && (
                  <Check className="ml-auto size-5 shrink-0 text-accent-strong" aria-hidden="true" />
                )}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {error && (
        <p role="alert" className="mt-4 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="mt-6 flex gap-2">
        {step > 0 && (
          <Button variant="outline" onClick={() => setStep(step - 1)} disabled={busy}>
            Back
          </Button>
        )}
        {step < steps.length - 1 ? (
          <Button className="flex-1" disabled={!canContinue} onClick={() => setStep(step + 1)}>
            Continue
          </Button>
        ) : (
          <Button className="flex-1" disabled={busy || !country || topics.length === 0} onClick={() => void save()}>
            {busy && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
            {submitLabel}
          </Button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Progress, badges, paths

/** Who Penny coaches changes which paths come first. */
const TOPIC_ORDER: Record<string, string[]> = {
  student: ["budgeting", "saving", "credit", "tax", "rules", "investing"],
  working: ["budgeting", "tax", "saving", "investing", "credit", "rules"],
  learner: ["budgeting", "saving", "rules", "credit", "tax", "investing"],
};

/** What Penny says at the top of Learn: by name, in each persona's voice. */
function greeting(persona: string | null, name: string): string {
  if (persona === "student") return `Hey ${name}! Let’s make your money last all term, rent, books, and fun included.`;
  if (persona === "working")
    return `Hi ${name}. Let’s make every paycheque go further: tax, TFSAs, credit, and investing.`;
  if (persona === "learner") return `Hi ${name}! Let’s learn money the fun way. No real money needed!`;
  return `Hi ${name}! Let’s level up your money skills.`;
}

/**
 * The top of Learn, like a game's home screen: Money Town with Penny (tap to change outfits),
 * and a bar with level, XP, and streak. A level-up while here gets a fanfare.
 */
function GameHud({
  state,
  country,
  persona,
  name,
  outfit,
  onOutfit,
  onEdit,
}: {
  state: LearnState;
  country: (typeof COUNTRIES)[number];
  persona: string | null;
  name: string;
  outfit: Outfit;
  onOutfit: (outfit: Outfit) => void;
  onEdit: () => void;
}) {
  const [wardrobe, setWardrobe] = useState(false);
  const lastLevel = useRef(state.level);
  // A level reached since this screen opened (from a game or the chest): celebrate it once.
  useEffect(() => {
    if (state.level > lastLevel.current) {
      play("levelUp");
      confetti({ pieces: 180 });
    }
    lastLevel.current = state.level;
  }, [state.level]);
  const lessons = state.topics.filter((topic) => topic.selected).flatMap((topic) => topic.lessons);
  const stars = lessons.reduce((total, lesson) => total + lesson.stars, 0);
  const line = state.completed_today
    ? "You learned something today. Keep the streak going tomorrow!"
    : greeting(persona, name);
  return (
    <section aria-label="Your progress" className="space-y-3">
      <TownScene className="min-h-48 sm:min-h-52">
        <div className="flex items-start gap-3 p-4 pb-20 sm:p-5">
          <button
            type="button"
            onClick={() => setWardrobe(true)}
            className="group shrink-0 rounded-3xl focus-visible:outline-white"
            aria-label="Change Penny’s outfit"
          >
            <Mascot
              outfit={outfit}
              className="size-24 animate-bob drop-shadow-[0_6px_8px_rgb(0_0_0/0.25)] sm:size-28"
            />
            <span className="mt-0.5 block rounded-full bg-white/85 px-2 py-0.5 text-center text-[0.65rem] font-bold text-[#1d3b57] group-hover:bg-white">
              Outfits
            </span>
          </button>
          <div className="min-w-0 flex-1 pt-1">
            <p className="relative inline-block max-w-sm rounded-2xl rounded-tl-sm bg-white px-3.5 py-2.5 text-sm font-semibold text-[#1d3b57] shadow-[0_4px_12px_rgb(0_0_0/0.12)]">
              {line}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <SoundToggle className="border-white/70 bg-white/85 text-[#1d3b57] hover:bg-white" />
              <button
                type="button"
                onClick={onEdit}
                className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-white/70 bg-white/85 px-3 text-xs font-semibold text-[#1d3b57] hover:bg-white"
              >
                <span aria-hidden="true">{country.flag}</span>
                {country.name}
                <span className="sr-only">. Customize your learning</span>
                <SlidersHorizontal className="size-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      </TownScene>

      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-3 sm:gap-4 sm:p-4">
        <span
          className="relative grid size-14 place-items-center rounded-2xl bg-[linear-gradient(135deg,#6b7cff,#19b394)] text-white shadow-[0_4px_0_#0e7d67]"
          role="img"
          aria-label={`Level ${state.level}`}
        >
          <Star className="absolute size-11 fill-white/20 text-white/30" aria-hidden="true" />
          <span className="relative text-xl font-black" aria-hidden="true">
            {state.level}
          </span>
        </span>
        <div className="min-w-0">
          <p className="flex items-baseline justify-between gap-2">
            <span className="tabular text-lg font-bold tracking-tight text-ink">
              <CountUp to={state.xp_total} from={Math.max(0, state.xp_total - 60)} /> XP
            </span>
            <span className="truncate text-xs text-ink-subtle">
              {state.level_size_xp - state.level_xp} to level {state.level + 1}
            </span>
          </p>
          <div
            className="mt-1.5 h-3 overflow-hidden rounded-full bg-sage"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={state.level_size_xp}
            aria-valuenow={state.level_xp}
            aria-label={`${state.level_xp} of ${state.level_size_xp} XP to level ${state.level + 1}`}
          >
            <div
              className="h-full rounded-full bg-[linear-gradient(90deg,#f5b82e,#19b394)] shadow-[inset_0_-3px_0_rgb(0_0_0/0.12)] transition-[width] duration-700"
              style={{ width: `${(state.level_xp * 100) / state.level_size_xp}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-ink-subtle">
            <Star className="inline size-3 fill-gold text-gold" aria-hidden="true" /> {stars} of {lessons.length * 3}{" "}
            stars in your paths
          </p>
        </div>
        <span
          className={cn(
            "flex flex-col items-center rounded-2xl px-3 py-1.5",
            state.completed_today ? "bg-[#ffe7d6]" : "bg-sage-soft",
          )}
          role="img"
          aria-label={`${state.streak_days}-day learning streak${state.completed_today ? ", today done" : ""}`}
        >
          <Flame
            className={cn("size-6 text-[#e4572e]", state.completed_today && "animate-flicker fill-[#f6a04d]")}
            aria-hidden="true"
          />
          <span
            className={cn("tabular text-sm font-black", state.completed_today ? "text-[#b4441f]" : "text-ink")}
            aria-hidden="true"
          >
            {state.streak_days}
          </span>
        </span>
      </div>

      <Dialog open={wardrobe} onOpenChange={setWardrobe}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Penny’s outfits</DialogTitle>
            <DialogDescription>Level up to unlock more. You’re level {state.level}.</DialogDescription>
          </DialogHeader>
          <Wardrobe
            level={state.level}
            outfit={outfit}
            onPick={(next) => {
              play("coin");
              onOutfit(next);
            }}
          />
        </DialogContent>
      </Dialog>
    </section>
  );
}

function BadgeShelf({ badges }: { badges: LearnBadge[] }) {
  const earned = badges.filter((badge) => badge.earned).length;
  return (
    <section aria-labelledby="badges-title">
      <h2 id="badges-title" className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink">
        <Award className="size-4 text-gold-strong" aria-hidden="true" />
        Badges{" "}
        <span className="font-normal text-ink-subtle">
          {earned} of {badges.length}
        </span>
      </h2>
      <ul className="scroll-area -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
        {badges.map((badge) => (
          <BadgeChip key={badge.id} badge={badge} />
        ))}
      </ul>
    </section>
  );
}

/** Each topic is a "world" on the map, with its own emblem. */
const WORLD: Record<string, { tint: string }> = {
  budgeting: { tint: "from-[#f0645a]/20" },
  saving: { tint: "from-[#ff9fb6]/25" },
  tax: { tint: "from-[#8fb3ff]/25" },
  credit: { tint: "from-[#5b8def]/20" },
  rules: { tint: "from-[#19b394]/20" },
  investing: { tint: "from-[#22c38d]/20" },
};

/**
 * A topic as a level map: round level buttons on a track that fills as levels are passed. The
 * next level to play glows and bobs; locked ones show a padlock.
 */
function TopicRow({ topic, onOpen }: { topic: TopicPath; onOpen: (lesson: LessonCard) => void }) {
  const passed = topic.lessons.filter((lesson) => lesson.passed).length;
  const stars = topic.lessons.reduce((total, lesson) => total + lesson.stars, 0);
  const next = topic.lessons.find((lesson) => !lesson.locked && !lesson.passed);
  const world = WORLD[topic.id] ?? { tint: "from-accent/25" };
  const count = topic.lessons.length;
  // The track runs between the first and last level's centres and fills up to the next level.
  const filled = count > 1 ? (Math.min(passed, count - 1) * 100) / (count - 1) : 0;
  return (
    <Card className={cn("overflow-hidden bg-gradient-to-br to-transparent to-60% p-4 sm:p-5", world.tint)}>
      <div className="flex items-center gap-3">
        <Building topic={topic.id} className="size-16 shrink-0 drop-shadow-[0_3px_4px_rgb(0_0_0/0.15)]" />
        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-semibold tracking-tight text-ink">{topic.label}</h3>
          <p className="truncate text-sm text-ink-subtle">{topic.blurb}</p>
        </div>
        <span className="shrink-0 text-right text-xs font-semibold text-ink-subtle">
          {passed === count ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-gold-soft px-2.5 py-1 text-gold-strong">
              <Trophy className="size-3.5" aria-hidden="true" />
              Mastered
            </span>
          ) : (
            <>
              <span className="block">
                {passed} of {count} levels
              </span>
              <span className="tabular inline-flex items-center gap-0.5">
                <Star className="size-3 fill-gold text-gold" aria-hidden="true" />
                {stars}/{count * 3}
              </span>
            </>
          )}
        </span>
      </div>

      <ol className="relative mt-6 grid" style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}>
        <span
          aria-hidden="true"
          className="absolute top-8 h-2 -translate-y-1/2 rounded-full bg-sage"
          style={{ left: `${50 / count}%`, right: `${50 / count}%` }}
        >
          <span
            className="block h-full rounded-full bg-[linear-gradient(90deg,var(--color-gold),var(--color-accent))] transition-[width] duration-700"
            style={{ width: `${filled}%` }}
          />
        </span>
        {topic.lessons.map((lesson, index) => {
          const current = lesson === next;
          const previous = topic.lessons[index - 1];
          return (
            <li key={lesson.id} className="relative flex flex-col items-center px-1 text-center">
              {current && (
                <span
                  className="absolute -top-5 z-10 animate-bob rounded-full bg-primary px-2.5 py-0.5 text-[0.7rem] font-bold uppercase tracking-wide text-on-primary shadow-[var(--shadow-card)]"
                  aria-hidden="true"
                >
                  Start
                </span>
              )}
              <button
                type="button"
                disabled={lesson.locked}
                onClick={() => onOpen(lesson)}
                className={cn(
                  "relative grid size-16 place-items-center rounded-full border-4 text-xl font-bold transition-transform disabled:cursor-not-allowed",
                  "hover:scale-105 active:scale-95 disabled:hover:scale-100 motion-reduce:transform-none",
                  lesson.locked
                    ? "border-line-strong bg-sage text-ink-subtle"
                    : lesson.passed
                      ? "border-gold bg-[radial-gradient(circle_at_30%_30%,#ffe6a8,var(--color-gold))] text-white shadow-[0_4px_0_var(--color-gold-strong)]"
                      : "animate-glow border-accent bg-accent text-white shadow-[0_4px_0_var(--color-accent-strong)]",
                )}
              >
                {lesson.locked ? (
                  <Lock className="size-5" aria-hidden="true" />
                ) : lesson.passed ? (
                  <Check className="size-7" strokeWidth={3} aria-hidden="true" />
                ) : (
                  <span aria-hidden="true">{index + 1}</span>
                )}
                <span className="sr-only">
                  {lesson.title}, {TIER_STYLE[lesson.tier].label}.{" "}
                  {lesson.locked
                    ? `Locked: pass ${previous ? TIER_STYLE[previous.tier].label : "the level before"} to unlock.`
                    : lesson.passed
                      ? `Passed with ${lesson.stars} of 3 stars.`
                      : `${lesson.question_count} questions, ${lesson.hearts} hearts, up to ${lesson.xp_max} XP.`}
                </span>
              </button>
              <span className="mt-1.5 h-4" aria-hidden="true">
                {lesson.passed ? (
                  <Stars count={lesson.stars} className="size-3.5" />
                ) : !lesson.locked ? (
                  <span className="rounded-full bg-gold-soft px-1.5 py-0.5 text-[0.65rem] font-bold text-gold-strong">
                    +{lesson.xp_max} XP
                  </span>
                ) : null}
              </span>
              <span
                className={cn(
                  "mt-1.5 line-clamp-2 text-xs font-semibold leading-snug",
                  lesson.locked ? "text-ink-subtle" : "text-ink",
                )}
                aria-hidden="true"
              >
                {lesson.title}
              </span>
              <span
                className={cn(
                  "mt-1 rounded-full px-2 py-0.5 text-[0.65rem] font-semibold",
                  TIER_STYLE[lesson.tier].chip,
                )}
                aria-hidden="true"
              >
                {TIER_STYLE[lesson.tier].label}
              </span>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

function Challenges({ missions, onComplete }: { missions: Mission[]; onComplete: (mission: Mission) => void }) {
  return (
    <section aria-labelledby="challenges-title">
      <SectionHeading
        id="challenges-title"
        title="Challenges"
        description="Small real-world actions. Each one earns XP."
      />
      <ul className="grid gap-3 sm:grid-cols-2">
        {missions.map((mission) => (
          <li key={mission.id}>
            <Card className={cn("flex h-full items-start gap-3 p-4", mission.completed && "bg-sage-soft/60")}>
              <span
                className={cn(
                  "grid size-10 shrink-0 place-items-center rounded-xl",
                  mission.completed ? "bg-accent-soft text-accent-strong" : "bg-gold-soft text-gold-strong",
                )}
                aria-hidden="true"
              >
                {mission.completed ? <Trophy className="size-4" /> : <Swords className="size-4" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-ink">{mission.title}</p>
                <p className="mt-0.5 text-sm text-ink-muted">{mission.description}</p>
              </div>
              {mission.completed ? (
                <Badge className="animate-pop">+{mission.xp_reward} XP</Badge>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={(event) => {
                    play("coin");
                    confettiFrom(event.currentTarget, { pieces: 50, spread: 100 });
                    onComplete(mission);
                  }}
                >
                  Done
                </Button>
              )}
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}
