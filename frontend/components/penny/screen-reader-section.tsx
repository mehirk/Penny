"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Headphones, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Settings › Screen reader (accessibility). Penny has no screen-reader switch of its own: it works with the one
 * built into the device. This page makes that support visible: how to turn the reader on, what Penny does for it,
 * and a button that sends a test announcement so people can hear that it works. Every claim here is backed by the
 * app's markup (labelled controls, skip link, focus on each page title, charts described in words, live regions).
 */

const TURN_ON: { device: string; how: string }[] = [
  { device: "iPhone", how: "Settings › Accessibility › VoiceOver, or ask Siri to “turn on VoiceOver”" },
  { device: "Mac", how: "Press Command-F5" },
  { device: "Android", how: "Settings › Accessibility › TalkBack" },
  { device: "Windows", how: "Press Ctrl + Windows + Enter (Narrator)" },
];

const SUPPORT: { title: string; detail: string }[] = [
  { title: "Every button has a name", detail: "Icons and controls are read out by what they do, not as “button”." },
  { title: "Skip to content", detail: "The first thing you reach jumps straight past the menu." },
  { title: "You always know where you are", detail: "Opening a page moves you to its title, so it’s read first." },
  { title: "Charts in words", detail: "Each chart and each month is described with its amounts." },
  { title: "Changes are announced", detail: "Saves, errors and confirmations are read out as they happen." },
  { title: "Works with a keyboard", detail: "A clear focus ring shows where you are; every tap target is at least 44 points." },
  { title: "Follows your device", detail: "If Reduce Motion is on, Penny keeps its animations still." },
];

const TEST_MESSAGE = "Penny is working with your screen reader.";

export function ScreenReaderSection({ onOpenListen }: { onOpenListen: () => void }) {
  // Empty first, then the message: a live region only speaks when its text changes.
  const [announcement, setAnnouncement] = useState("");
  const [tested, setTested] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);

  const runTest = () => {
    setAnnouncement("");
    setTested(true);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setAnnouncement(TEST_MESSAGE), 150);
  };

  return (
    <section aria-labelledby="screen-reader-title" className="space-y-5">
      <p className="text-sm text-ink-muted">
        Penny works with the screen reader built into your phone or computer. There’s nothing to switch on in Penny:
        turn on your device’s reader and every screen is ready for it.
      </p>

      <div className="rounded-2xl border border-line bg-surface p-4">
        <h3 className="text-sm font-semibold text-ink">Check that it works</h3>
        <p className="mt-1 text-sm text-ink-muted">
          With your screen reader on, press the button. You should hear Penny’s test message.
        </p>
        <Button className="mt-3 min-h-12 w-full text-base sm:w-auto" onClick={runTest}>
          <Volume2 className="size-5" aria-hidden="true" />
          Send a test message
        </Button>
        {tested && (
          <p className="mt-3 flex items-start gap-2 rounded-xl bg-sage px-3 py-2 text-sm text-ink" aria-hidden="true">
            <Check className="mt-0.5 size-4 shrink-0" />
            Sent: “{TEST_MESSAGE}” If you didn’t hear it, check that your screen reader is on and the volume is up.
          </p>
        )}
        <p className="sr-only" role="status" aria-live="polite">
          {announcement}
        </p>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-ink">Turn on your screen reader</h3>
        <table className="mt-2 w-full text-left text-sm">
          <caption className="sr-only">How to turn on the screen reader on each device</caption>
          <thead className="text-xs text-ink-subtle">
            <tr>
              <th scope="col" className="pb-1 pr-3 font-semibold">
                Device
              </th>
              <th scope="col" className="pb-1 font-semibold">
                How
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {TURN_ON.map((row) => (
              <tr key={row.device}>
                <td className="py-2 pr-3 font-semibold text-ink">{row.device}</td>
                <td className="py-2 text-ink-muted">{row.how}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-ink">What Penny does for you</h3>
        <ul className="mt-2 space-y-2">
          {SUPPORT.map((item) => (
            <li key={item.title} className="flex gap-3 rounded-xl border border-line bg-surface px-3 py-2.5">
              <Check className="mt-0.5 size-4 shrink-0 text-accent-strong" aria-hidden="true" />
              <span className="text-sm">
                <span className="font-semibold text-ink">{item.title}.</span>{" "}
                <span className="text-ink-muted">{item.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-2xl bg-accent-soft p-4">
        <h3 className="text-sm font-semibold text-ink">Prefer to just listen?</h3>
        <p className="mt-1 text-sm text-ink-muted">
          Listen mode reads your money summary aloud in one go, and you control it with your AirPods. It works with or
          without a screen reader.
        </p>
        <Button variant="outline" className="mt-3 min-h-12 w-full text-base sm:w-auto" onClick={onOpenListen}>
          <Headphones className="size-5" aria-hidden="true" />
          Open Listen mode
        </Button>
      </div>
    </section>
  );
}
