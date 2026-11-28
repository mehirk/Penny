"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Headphones, Pause, Play, SkipBack, SkipForward, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isoToday } from "@/components/ui/date-picker";
import type { Dashboard } from "@/lib/api";
import { buildBriefing } from "@/lib/briefing";
import {
  getListenServerSnapshot,
  getListenSnapshot,
  hasHeadphoneControls,
  isListenSupported,
  LISTEN_RATES,
  listenControl,
  type ListenSnapshot,
  setListenRate,
  startListening,
  subscribeListen,
} from "@/lib/listen";
import { cn } from "@/lib/utils";

/**
 * Listen mode (accessibility): Penny reads the Home summary aloud and AirPods presses control it.
 * The Home card turns it on, the player floats above the tab bar while it's on, and Settings ›
 * Listen mode explains the controls. Every amount comes from the dashboard's integer-cent figures.
 */

const CARD_KEY = "penny-listen-card";
const noSubscribe = () => () => undefined;

export function useListen(): ListenSnapshot {
  return useSyncExternalStore(subscribeListen, getListenSnapshot, getListenServerSnapshot);
}

function useSupport(): { speech: boolean; headphones: boolean } {
  const speech = useSyncExternalStore(noSubscribe, isListenSupported, () => false);
  const headphones = useSyncExternalStore(noSubscribe, hasHeadphoneControls, () => false);
  return { speech, headphones };
}

function listenTo(dashboard: Dashboard) {
  startListening(buildBriefing(dashboard, dashboard.money_calendar.today ?? isoToday()));
}

/** The one button that turns Listen mode on (or off once it's playing). */
function ListenToggle({ dashboard, className }: { dashboard: Dashboard; className?: string }) {
  const { status } = useListen();
  const on = status !== "off";
  return (
    <Button
      variant={on ? "outline" : "default"}
      className={cn("min-h-12 text-base", className)}
      onClick={() => (on ? listenControl("stop") : listenTo(dashboard))}
    >
      <Headphones className="size-5" aria-hidden="true" />
      {on ? "Turn off Listen mode" : "Turn on Listen mode"}
    </Button>
  );
}

const NO_SPEECH = "This browser can’t read aloud. Try Safari or Chrome, or the Penny iPhone app.";

/** Home: "Listen with AirPods". Can be hidden; it stays in Settings › Listen mode. */
export function ListenCard({ dashboard }: { dashboard: Dashboard }) {
  const { speech } = useSupport();
  const { status } = useListen();
  const [hidden, setHidden] = useState(() => {
    try {
      return window.localStorage.getItem(CARD_KEY) === "hidden";
    } catch {
      return false;
    }
  });
  if (hidden && status === "off") return null;
  const hide = () => {
    try {
      window.localStorage.setItem(CARD_KEY, "hidden");
    } catch {
      /* storage blocked: hide for this visit */
    }
    setHidden(true);
  };
  return (
    <section
      aria-labelledby="listen-card-title"
      className="relative rounded-[var(--radius-card)] border border-accent/40 bg-accent-soft p-4 sm:p-5"
    >
      <div className="flex items-start gap-3 pr-10">
        <span
          className="grid size-11 shrink-0 place-items-center rounded-full bg-surface text-accent-strong"
          aria-hidden="true"
        >
          <Headphones className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-accent-strong">Accessibility</p>
          <h2 id="listen-card-title" className="font-semibold text-ink">
            Listen with AirPods
          </h2>
          <p className="mt-0.5 text-sm text-ink-muted">
            Hear your money summary read aloud. Press your AirPods to pause, twice to skip, three times to go back. No
            reading or tapping needed.
          </p>
        </div>
      </div>
      {speech ? (
        <ListenToggle dashboard={dashboard} className="mt-4 w-full sm:w-auto" />
      ) : (
        <p className="mt-3 text-sm text-ink-muted">{NO_SPEECH}</p>
      )}
      {status === "off" && (
        <button
          type="button"
          onClick={hide}
          aria-label="Hide this card. Listen mode stays in Settings."
          className="absolute right-2 top-2 grid size-11 place-items-center rounded-full text-ink-muted hover:bg-surface hover:text-ink"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      )}
    </section>
  );
}

/** Floats above the tab bar (bottom right on laptops) while Listen mode is on. */
export function ListenPlayer() {
  const { status, index, items, error } = useListen();
  // Leaving the signed-in app (sign out, reload into login) turns Listen mode off.
  useEffect(() => () => listenControl("stop"), []);
  if (status === "off") return null;
  const item = items[index];
  const playing = status === "playing";
  const control =
    "grid size-11 shrink-0 place-items-center rounded-full text-ink hover:bg-sage-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";
  return (
    <section
      aria-label="Listen mode player"
      className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+5.25rem)] z-30 mx-auto max-w-md rounded-[var(--radius-card)] border border-line bg-surface/95 p-3 shadow-[var(--shadow-raised)] backdrop-blur-xl lg:inset-x-auto lg:bottom-6 lg:right-28 lg:w-[26rem]"
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "mt-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-accent-soft text-accent-strong",
            playing && "motion-safe:animate-pulse",
          )}
          aria-hidden="true"
        >
          <Headphones className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-ink-subtle">
            Listen mode · {status === "done" ? "Finished" : `${index + 1} of ${items.length}`}
          </p>
          <p className="font-semibold text-ink">{item?.title}</p>
          {/* The caption, for following along. Not a live region: screen readers would talk over Penny. */}
          <p className="mt-0.5 line-clamp-3 text-sm text-ink-muted">{item?.text}</p>
        </div>
      </div>
      {error && (
        <p role="alert" className="mt-2 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      <p className="sr-only" aria-live="polite">
        {status === "paused" ? "Paused" : status === "done" ? "Finished" : ""}
      </p>
      <div className="mt-2 flex items-center justify-between gap-1">
        <button type="button" className={control} onClick={() => listenControl("previous")} aria-label="Go back">
          <SkipBack className="size-5" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => listenControl("toggle")}
          aria-label={playing ? "Pause" : status === "done" ? "Play from the start" : "Play"}
          className="grid size-12 shrink-0 place-items-center rounded-full bg-primary text-on-primary hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          {playing ? <Pause className="size-5" aria-hidden="true" /> : <Play className="size-5" aria-hidden="true" />}
        </button>
        <button
          type="button"
          className={control}
          onClick={() => listenControl("next")}
          aria-label="Skip to next"
          disabled={status === "done"}
        >
          <SkipForward className="size-5" aria-hidden="true" />
        </button>
        <button
          type="button"
          className={control}
          onClick={() => listenControl("stop")}
          aria-label="Turn off Listen mode"
        >
          <X className="size-5" aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}

const CONTROLS: { press: string; does: string }[] = [
  { press: "Press once (double-tap on AirPods 1st and 2nd generation)", does: "Pause or play" },
  { press: "Press twice", does: "Skip to the next part" },
  { press: "Press three times", does: "Go back a part" },
  { press: "Take an AirPod out (with Automatic Ear Detection on)", does: "Pauses" },
];

/** Settings › Listen mode. */
export function ListenSettings({ dashboard }: { dashboard: Dashboard }) {
  const { speech, headphones } = useSupport();
  const { rate } = useListen();
  return (
    <section aria-labelledby="listen-title" className="space-y-5">
      <p className="text-sm text-ink-muted">
        Penny reads your summary aloud: what’s safe to spend, your spending, bills coming up, budgets to watch, and your
        goals. It’s built for anyone who finds small numbers hard to read, uses a screen reader, or has their hands
        full, and you control it with your AirPods.
      </p>
      {speech ? (
        <ListenToggle dashboard={dashboard} className="w-full sm:w-auto" />
      ) : (
        <p role="status" className="rounded-xl bg-sage px-3 py-2 text-sm text-ink">
          {NO_SPEECH}
        </p>
      )}

      <div>
        <h3 id="listen-speed" className="text-sm font-semibold text-ink">
          Reading speed
        </h3>
        <div role="radiogroup" aria-labelledby="listen-speed" className="mt-2 grid grid-cols-3 gap-2">
          {LISTEN_RATES.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={rate === option.value}
              onClick={() => setListenRate(option.value)}
              className={cn(
                "min-h-11 rounded-xl border px-3 text-sm font-semibold",
                rate === option.value
                  ? "border-accent bg-accent-soft text-accent-strong"
                  : "border-line bg-surface text-ink hover:bg-sage-soft",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-ink">AirPods controls</h3>
        <table className="mt-2 w-full text-left text-sm">
          <caption className="sr-only">What each AirPods press does in Listen mode</caption>
          <thead className="text-xs text-ink-subtle">
            <tr>
              <th scope="col" className="pb-1 pr-3 font-semibold">
                Do this
              </th>
              <th scope="col" className="pb-1 font-semibold">
                What happens
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {CONTROLS.map((row) => (
              <tr key={row.press}>
                <td className="py-2 pr-3 text-ink">{row.press}</td>
                <td className="py-2 text-ink-muted">{row.does}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-ink-subtle">
          {headphones
            ? "Also works with other headphones that have buttons, keyboard media keys, and the lock screen’s controls."
            : "This browser doesn’t pass headphone presses to web pages, so use the on-screen controls. Safari and Chrome do."}
        </p>
      </div>

      <p className="text-xs text-ink-subtle">
        Amounts are read out loud, so use headphones in public. The voice is your device’s own: nothing you hear is
        recorded or sent anywhere. Every amount comes from Penny’s calculations, not from AI.
      </p>
    </section>
  );
}
