"use client";

import { type ReactNode, type RefObject, useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  Camera,
  Check,
  Keyboard,
  LoaderCircle,
  Mic,
  PencilLine,
  Plus,
  RotateCcw,
  Send,
  Sparkles,
  Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  type AgentApplied,
  type AgentPlan,
  type AgentStep,
  type AgentUpload,
  type AppStep,
  type Dashboard,
  type FriendRef,
  agentApi,
} from "@/lib/api";
import { haptic } from "@/lib/native";
import { cn } from "@/lib/utils";
import { confetti, play } from "./game-fx";
import { Mascot } from "./mascot";
import { cad, describeError } from "./shared";

export type CaptureStart = "menu" | "camera" | "voice" | "type";
export type CaptureHandle = {
  /** With `onText`, a voice note is only turned into text and handed back (Penny AI's mic). */
  start: (how: CaptureStart, onText?: (text: string) => void) => void;
  stopVoice: () => void;
};

type Phase =
  | { step: "menu" }
  | { step: "type" }
  | { step: "listening" }
  | { step: "thinking"; photo: string | null; heard: string | null }
  | { step: "plan"; plan: AgentPlan; photo: string | null }
  | { step: "done"; applied: AgentApplied }
  | { step: "app-done"; items: AppStep[] }
  | { step: "error"; message: string };

const EXAMPLES = [
  "Dinner $90 with Sam and Ana, split 3 ways",
  "Lunch $14.50 at Tim Hortons",
  "Pay off my credit card",
  "Add Spotify, $11.99 every month",
  "Put $50 in my laptop fund",
  "Switch to dark mode",
  "Can I afford a $300 concert trip?",
];
const THINKING = ["Reading it…", "Picking categories…", "Doing the math…", "Checking your budgets…"];
const MAX_RECORDING_MS = 60_000;
// Bright on every theme, like the confetti.
const ORB = "bg-[conic-gradient(from_200deg,#15977f,#356fc4,#8b5cf6,#ef6f6c,#efad3d,#15977f)]";

/** The file's (or recording's) bytes as base64, without the "data:...;base64," prefix. */
function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1] ?? "");
    reader.onerror = () => reject(reader.error ?? new Error("Couldn’t read that"));
    reader.readAsDataURL(blob);
  });
}

/** A phone photo is several MB; a 1600px JPEG reads just as well and uploads in a moment. */
async function shrinkPhoto(file: File): Promise<AgentUpload> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (blob) return { filename: "receipt.jpg", data_base64: await toBase64(blob) };
  } catch {
    /* fall through: send the photo as it is */
  }
  const name = /\.(jpe?g|png|webp)$/i.test(file.name) ? file.name : "receipt.jpg";
  return { filename: name, data_base64: await toBase64(file) };
}

function recordingType(): { mimeType?: string; ext: string } {
  const options: [string, string][] = [
    ["audio/webm;codecs=opus", ".webm"],
    ["audio/webm", ".webm"],
    ["audio/mp4", ".m4a"],
    ["audio/ogg", ".ogg"],
  ];
  const found = options.find(([type]) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type));
  return found ? { mimeType: found[0], ext: found[1] } : { ext: ".m4a" };
}

/** An even split, for showing the shares after the user picks friends. The API works out the
 * same shares again when it saves (app.domain.splits.even_split). */
function evenSplit(total: number, people: number) {
  const each = Math.floor(total / people);
  return { mine: total - each * (people - 1), each };
}

const joinNames = (names: string[]) =>
  names.length <= 2 ? names.join(" and ") : `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`;

/**
 * Snap a receipt or say what happened, and Penny does the rest: it reads it into a plan
 * (transactions, splits with friends, budgets, goals), the user taps "Do it", and everything is
 * saved at once, with Undo. Nothing is saved before that tap.
 */
export function AgentCapture({
  handle,
  dashboard,
  applyChange,
  onManual,
  onApp,
}: {
  handle: RefObject<CaptureHandle | null>;
  dashboard: Dashboard;
  applyChange: (dashboard: Dashboard) => void;
  onManual: () => void;
  /** Runs a step on this device: open a page, change the look, sound, or ask Penny AI. */
  onApp: (step: AppStep) => void;
}) {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>({ step: "menu" });
  const [said, setSaid] = useState("");
  const photoInput = useRef<HTMLInputElement>(null);
  const recorder = useRef<{ rec: MediaRecorder; stop: () => void } | null>(null);
  const [level, setLevel] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const photoUrl = useRef<string | null>(null);

  const forgetPhoto = () => {
    if (photoUrl.current) URL.revokeObjectURL(photoUrl.current);
    photoUrl.current = null;
  };

  async function runPlan(body: Parameters<typeof agentApi.plan>[0], photo: string | null) {
    setPhase({ step: "thinking", photo, heard: body.text ?? null });
    try {
      const plan = await agentApi.plan(body);
      haptic("success");
      // Only app things (a page, the theme, a question for Penny AI): nothing to approve, so do it now.
      if (!plan.steps.length && plan.app.length && !plan.question) {
        runApp(plan.app);
        return;
      }
      play(plan.steps.length ? "correct" : "tap");
      setPhase({ step: "plan", plan, photo });
    } catch (reason) {
      haptic("error");
      setPhase({ step: "error", message: describeError(reason, "Penny couldn’t do that").detail });
    }
  }

  /** An answer or a change to the plan on screen: the whole request is read again with it,
   * and Penny sees what she asked, so "just make a new one" continues instead of starting over. */
  function refine(plan: AgentPlan, photo: string | null, extra: string) {
    const text = said ? `${said}. ${extra}` : extra;
    setSaid(text);
    const context = said && plan.question ? `User: ${said}\nPenny: ${plan.question}` : "";
    void runPlan({ text: text.slice(0, 1000), receipt: plan.receipt, context }, photo);
  }

  function runApp(items: AppStep[]) {
    items.forEach(onApp);
    play("coin");
    // Opening a page or asking Penny AI: get out of the way so the user sees it.
    if (items.some((item) => item.kind === "navigate" || item.kind === "ask")) {
      close(false);
      return;
    }
    setOpen(true);
    setPhase({ step: "app-done", items });
    window.setTimeout(() => close(false), 1600);
  }

  function sendText(text: string) {
    const clean = text.trim();
    if (!clean) return;
    setSaid(clean);
    forgetPhoto();
    void runPlan({ text: clean }, null);
  }

  async function onPhoto(file: File | undefined) {
    if (!file) return;
    forgetPhoto();
    photoUrl.current = URL.createObjectURL(file);
    setSaid("");
    setOpen(true);
    const photo = photoUrl.current;
    setPhase({ step: "thinking", photo, heard: null });
    try {
      await runPlan({ image: await shrinkPhoto(file) }, photo);
    } catch (reason) {
      setPhase({ step: "error", message: describeError(reason, "Couldn’t read that photo").detail });
    }
  }

  function stopVoice() {
    recorder.current?.stop();
  }

  /** `onText` takes the words instead of planning; `closeAfter` leaves the sheet (the chat's mic). */
  async function startVoice(onText?: (text: string) => void, closeAfter = true) {
    setOpen(true);
    setPhase({ step: "listening" });
    setSeconds(0);
    setLevel(0);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setPhase({ step: "type" });
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setPhase({ step: "error", message: "Penny needs the microphone for that. Allow it in Settings, or type it." });
      return;
    }
    haptic("light");
    const { mimeType, ext } = recordingType();
    const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];
    rec.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data);
    };
    // A live level meter, so it visibly hears you.
    const audio = new AudioContext();
    const analyser = audio.createAnalyser();
    analyser.fftSize = 256;
    audio.createMediaStreamSource(stream).connect(analyser);
    const samples = new Uint8Array(analyser.frequencyBinCount);
    let frame = 0;
    let started: number | null = null;
    const tick = (now: number) => {
      started ??= now;
      analyser.getByteFrequencyData(samples);
      setLevel(samples.reduce((sum, value) => sum + value, 0) / samples.length / 128);
      setSeconds(Math.floor((now - started) / 1000));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    const limit = window.setTimeout(() => recorder.current?.stop(), MAX_RECORDING_MS);
    const cleanUp = () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(limit);
      stream.getTracks().forEach((track) => track.stop());
      void audio.close();
      recorder.current = null;
    };
    rec.onstop = async () => {
      cleanUp();
      const blob = new Blob(chunks, { type: rec.mimeType || mimeType || "audio/mp4" });
      if (blob.size < 1200) {
        setPhase({ step: "error", message: "That was too short. Hold the mic and say what happened." });
        return;
      }
      setPhase({ step: "thinking", photo: null, heard: null });
      try {
        const { text } = await agentApi.transcribe({ filename: `note${ext}`, data_base64: await toBase64(blob) });
        if (onText) {
          if (closeAfter) close(false);
          onText(text);
          return;
        }
        setSaid(text);
        forgetPhoto();
        await runPlan({ text }, null);
      } catch (reason) {
        setPhase({ step: "error", message: describeError(reason, "Penny couldn’t hear that").detail });
      }
    };
    recorder.current = {
      rec,
      stop: () => {
        if (rec.state !== "inactive") rec.stop();
      },
    };
    rec.start();
  }

  function start(how: CaptureStart, onText?: (text: string) => void) {
    haptic("selection");
    if (how === "camera") {
      // Clicked straight away, inside the user's tap, so the camera opens on iPhone.
      photoInput.current?.click();
      return;
    }
    if (how === "voice") {
      void startVoice(onText);
      return;
    }
    setOpen(true);
    setPhase({ step: how });
  }

  useImperativeHandle(handle, () => ({ start, stopVoice }));

  function close(next: boolean) {
    if (next) return setOpen(true);
    recorder.current?.stop();
    setOpen(false);
    forgetPhoto();
    window.setTimeout(() => setPhase({ step: "menu" }), 250);
  }

  return (
    <>
      <input
        ref={photoInput}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          void onPhoto(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      <Dialog open={open} onOpenChange={close}>
        <DialogContent className="overflow-hidden sm:max-w-lg">
          <DialogTitle className="sr-only">Penny does it for you</DialogTitle>
          <DialogDescription className="sr-only">
            Snap a receipt or say what happened. Penny makes a plan, and nothing is saved until you tap Do it.
          </DialogDescription>
          {phase.step === "menu" && (
            <Menu
              onCamera={() => start("camera")}
              onVoice={() => start("voice")}
              onType={() => setPhase({ step: "type" })}
              onExample={sendText}
              onManual={() => {
                close(false);
                onManual();
              }}
            />
          )}
          {phase.step === "type" && <TypeIt initial={said} onSend={sendText} onVoice={() => start("voice")} />}
          {phase.step === "listening" && <Listening level={level} seconds={seconds} onStop={stopVoice} />}
          {phase.step === "thinking" && <Thinking photo={phase.photo} heard={phase.heard} />}
          {phase.step === "plan" && (
            <PlanCard
              key={phase.plan.heard + phase.plan.steps.length}
              plan={phase.plan}
              photo={phase.photo}
              dashboard={dashboard}
              applyChange={applyChange}
              onRefine={(extra) => refine(phase.plan, phase.photo, extra)}
              // Talking here answers Penny's question; it doesn't start a new request.
              onVoice={() => {
                const { plan, photo } = phase;
                haptic("selection");
                void startVoice((text) => refine(plan, photo, text), false);
              }}
              onAppOnly={() => runApp(phase.plan.app)}
              onDone={(applied) => {
                setPhase({ step: "done", applied });
                if (phase.plan.app.length) window.setTimeout(() => runApp(phase.plan.app), 900);
                play("win");
                haptic("success");
                confetti({ y: 0.4, pieces: 160 });
              }}
            />
          )}
          {phase.step === "done" && (
            <Done
              applied={phase.applied}
              applyChange={applyChange}
              onAnother={() => {
                forgetPhoto();
                setSaid("");
                setPhase({ step: "menu" });
              }}
              onClose={() => close(false)}
            />
          )}
          {phase.step === "app-done" && (
            <div className="flex flex-col items-center gap-3 py-4 text-center" role="status">
              <Mascot className="size-20 animate-pop" mood="wow" />
              <p className="text-xl font-semibold text-ink">Done!</p>
              <ul className="space-y-1.5">
                {phase.items.map((item) => (
                  <li key={item.kind + item.value} className="text-base font-medium text-ink-muted animate-enter">
                    {item.emoji} {item.title}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {phase.step === "error" && (
            <Problem
              message={phase.message}
              onRetry={() => setPhase({ step: "menu" })}
              onType={() => setPhase({ step: "type" })}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

// ------------------------------------------------------------------ the button

/**
 * The capture button: tap for the menu, or press and hold to talk (let go to send). Penny's
 * colourful orb, so it reads as "Penny does it", not another form.
 */
export function CaptureOrb({
  handle,
  className,
  size = "md",
  label = "Snap or say it",
}: {
  handle: RefObject<CaptureHandle | null>;
  className?: string;
  size?: "md" | "lg";
  label?: string;
}) {
  const hold = useRef<{ timer: number; holding: boolean } | null>(null);
  const begin = () => {
    hold.current = {
      holding: false,
      timer: window.setTimeout(() => {
        if (!hold.current) return;
        hold.current.holding = true;
        haptic("light");
        handle.current?.start("voice");
      }, 380),
    };
  };
  const end = () => {
    const current = hold.current;
    hold.current = null;
    if (!current) return;
    window.clearTimeout(current.timer);
    if (current.holding) handle.current?.stopVoice();
    else handle.current?.start("menu");
  };
  return (
    <button
      type="button"
      aria-label={`${label}. Tap for options, or press and hold to talk.`}
      title={`${label} · hold to talk`}
      onPointerDown={(event) => {
        if (event.button === 0) begin();
      }}
      onPointerUp={end}
      onPointerLeave={() => {
        // Sliding off cancels a tap but keeps a recording going until it's let go.
        if (hold.current && !hold.current.holding) {
          window.clearTimeout(hold.current.timer);
          hold.current = null;
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          handle.current?.start("menu");
        }
      }}
      onContextMenu={(event) => event.preventDefault()}
      className={cn(
        "group relative grid shrink-0 touch-none select-none place-items-center rounded-full text-white shadow-[var(--shadow-raised)] transition-transform active:scale-95 [-webkit-touch-callout:none]",
        size === "lg" ? "size-14" : "size-[52px]",
        className,
      )}
    >
      <span
        className="absolute inset-0 rounded-full bg-accent/40 animate-ring motion-reduce:hidden"
        aria-hidden="true"
      />
      <span className={cn("absolute inset-0 rounded-full animate-orb", ORB)} aria-hidden="true" />
      <span className="absolute inset-[3px] rounded-full bg-[#10283d]/45" aria-hidden="true" />
      {/* Penny herself: tap her and she does it. */}
      <Mascot face className="relative size-[78%] drop-shadow transition-transform group-hover:scale-110" />
    </button>
  );
}

// ------------------------------------------------------------------ phases

function Menu({
  onCamera,
  onVoice,
  onType,
  onExample,
  onManual,
}: {
  onCamera: () => void;
  onVoice: () => void;
  onType: () => void;
  onExample: (text: string) => void;
  onManual: () => void;
}) {
  const tiles: { label: string; hint: string; icon: ReactNode; onClick: () => void; tone: string }[] = [
    {
      label: "Snap",
      hint: "A receipt or bill",
      icon: <Camera className="size-7" aria-hidden="true" />,
      onClick: onCamera,
      tone: "from-[#15977f] to-[#0f7a8f]",
    },
    {
      label: "Say it",
      hint: "“Dinner $90, split 3 ways”",
      icon: <Mic className="size-7" aria-hidden="true" />,
      onClick: onVoice,
      tone: "from-[#6d5ce8] to-[#356fc4]",
    },
    {
      label: "Type it",
      hint: "Anything you did",
      icon: <Keyboard className="size-7" aria-hidden="true" />,
      onClick: onType,
      tone: "from-[#ef8f4c] to-[#e0567a]",
    },
  ];
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Mascot className="size-14 shrink-0 animate-bob" />
        <div>
          <p className="text-xl font-semibold tracking-tight text-ink">What happened?</p>
          <p className="text-sm text-ink-muted">
            Snap it or say it: spending, bills, goals, settings. I’ll do the rest.
          </p>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2.5">
        {tiles.map((tile, index) => (
          <button
            key={tile.label}
            type="button"
            onClick={tile.onClick}
            style={{ animationDelay: `${index * 60}ms` }}
            className={cn(
              "flex min-h-32 flex-col items-center justify-center gap-2 rounded-2xl bg-gradient-to-br p-3 text-center text-white shadow-[var(--shadow-card)] transition-transform animate-pop hover:-translate-y-0.5 active:scale-95",
              tile.tone,
            )}
          >
            {tile.icon}
            <span className="text-base font-semibold">{tile.label}</span>
            <span className="text-[11px] leading-tight text-white/85">{tile.hint}</span>
          </button>
        ))}
      </div>
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-subtle">Try one</p>
        <div className="flex flex-wrap gap-2">
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => onExample(example)}
              className="min-h-10 rounded-full border border-line bg-surface px-3 text-sm text-ink-muted transition-colors hover:border-accent hover:bg-accent-soft hover:text-ink"
            >
              {example}
            </button>
          ))}
        </div>
      </div>
      <button
        type="button"
        onClick={onManual}
        className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-medium text-ink-subtle hover:bg-sage-soft hover:text-ink"
      >
        <Plus className="size-4" aria-hidden="true" />
        Add a transaction myself
      </button>
    </div>
  );
}

function TypeIt({
  initial,
  onSend,
  onVoice,
}: {
  initial: string;
  onSend: (text: string) => void;
  onVoice: () => void;
}) {
  const [text, setText] = useState(initial);
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSend(text);
      }}
    >
      <div className="flex items-center gap-3">
        <Mascot className="size-12 shrink-0" />
        <p className="text-lg font-semibold text-ink">Tell Penny what you did</p>
      </div>
      <label htmlFor="agent-text" className="sr-only">
        What happened
      </label>
      <textarea
        id="agent-text"
        autoFocus
        rows={3}
        maxLength={1000}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            onSend(text);
          }
        }}
        placeholder="Went for dinner with Sam and Ana, $90, I paid, split 3 ways"
        className="w-full resize-none rounded-2xl border border-line-strong bg-surface p-4 text-base text-ink placeholder:text-ink-subtle/80 focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15"
      />
      <div className="flex gap-2">
        <Button type="button" variant="outline" size="icon" onClick={onVoice} aria-label="Say it instead">
          <Mic className="size-5" aria-hidden="true" />
        </Button>
        <Button type="submit" className="flex-1 gap-2" disabled={!text.trim()}>
          <Sparkles className="size-4" aria-hidden="true" />
          Make my plan
        </Button>
      </div>
    </form>
  );
}

function Listening({ level, seconds, onStop }: { level: number; seconds: number; onStop: () => void }) {
  const bars = [0.5, 0.8, 1, 0.7, 0.9, 0.6, 1, 0.75, 0.55];
  return (
    <div className="flex flex-col items-center gap-5 py-4 text-center" role="status" aria-live="polite">
      <p className="text-lg font-semibold text-ink">I’m listening…</p>
      <p className="-mt-3 text-sm text-ink-muted">Say what you bought, who with, and how much.</p>
      <div className="flex h-16 items-center gap-1.5" aria-hidden="true">
        {bars.map((weight, index) => (
          <span
            key={index}
            className="w-2 rounded-full bg-gradient-to-t from-[#356fc4] to-[#15977f] transition-[height] duration-75"
            style={{ height: `${Math.max(10, Math.min(64, 10 + level * 70 * weight))}px` }}
          />
        ))}
      </div>
      <button
        type="button"
        onClick={onStop}
        className="relative grid size-24 place-items-center rounded-full text-white shadow-[var(--shadow-raised)] active:scale-95"
        aria-label="Done talking"
      >
        <span
          className="absolute inset-0 rounded-full bg-danger/40 animate-ring motion-reduce:hidden"
          aria-hidden="true"
        />
        <span className="absolute inset-0 rounded-full bg-danger" aria-hidden="true" />
        <span className="relative size-7 rounded-md bg-white" aria-hidden="true" />
      </button>
      <p className="text-sm tabular-nums text-ink-subtle">
        0:{String(seconds).padStart(2, "0")} · tap to finish (or let go)
      </p>
    </div>
  );
}

function Thinking({ photo, heard }: { photo: string | null; heard: string | null }) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setIndex((value) => (value + 1) % THINKING.length), 1100);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <div className="flex flex-col items-center gap-4 py-4 text-center" role="status" aria-live="polite">
      {photo ? (
        <div className="relative h-56 w-44 overflow-hidden rounded-2xl border border-line shadow-[var(--shadow-card)]">
          {/* eslint-disable-next-line @next/next/no-img-element -- a local photo preview */}
          <img src={photo} alt="Your receipt" className="size-full object-cover" />
          <span
            className="absolute inset-x-0 h-1 bg-accent shadow-[0_0_18px_6px] shadow-accent/60 animate-scan"
            aria-hidden="true"
          />
        </div>
      ) : (
        <Mascot className="size-20 animate-bob" mood="wow" />
      )}
      {heard && (
        <p className="max-w-sm rounded-2xl rounded-br-md bg-info px-4 py-2.5 text-sm font-medium text-white">
          “{heard}”
        </p>
      )}
      <p className="flex items-center gap-2 text-base font-semibold text-ink">
        <LoaderCircle className="size-5 animate-spin text-accent" aria-hidden="true" />
        {photo && index === 0 ? "Reading your receipt…" : THINKING[index]}
      </p>
    </div>
  );
}

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
        <label htmlFor="agent-friend" className="sr-only">
          Add a friend by name
        </label>
        <input
          id="agent-friend"
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
          <label htmlFor="agent-refine" className="sr-only">
            {plan.question ?? "What should Penny change?"}
          </label>
          <input
            id="agent-refine"
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

function Done({
  applied,
  applyChange,
  onAnother,
  onClose,
}: {
  applied: AgentApplied;
  applyChange: (dashboard: Dashboard) => void;
  onAnother: () => void;
  onClose: () => void;
}) {
  const [undone, setUndone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function undo() {
    setBusy(true);
    setError("");
    try {
      applyChange(await agentApi.undo(applied.undo_id));
      setUndone(true);
    } catch (reason) {
      setError(describeError(reason, "Couldn’t undo").detail);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-col items-center gap-4 py-2 text-center">
      <div className="relative">
        <Mascot className="size-24 animate-pop" mood={undone ? "sad" : "wow"} />
        {!undone && (
          <span className="absolute -right-1 bottom-1 grid size-9 place-items-center rounded-full bg-zone-green text-white shadow-[var(--shadow-raised)] animate-pop">
            <Check className="size-5" aria-hidden="true" />
          </span>
        )}
      </div>
      <p className="text-2xl font-semibold tracking-tight text-ink">{undone ? "All undone" : "Done!"}</p>
      <ul className="w-full space-y-2 text-left">
        {applied.done.map((line, index) => (
          <li
            key={line}
            style={{ animationDelay: `${150 + index * 120}ms` }}
            className={cn(
              "flex items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2.5 text-sm font-medium text-ink animate-enter",
              undone && "line-through opacity-60",
            )}
          >
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-zone-green-soft text-zone-green">
              <Check className="size-4" aria-hidden="true" />
            </span>
            {line}
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="w-full rounded-xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger">
          {error}
        </p>
      )}
      <div className="flex w-full gap-2">
        {!undone && (
          <Button variant="outline" className="gap-2" onClick={() => void undo()} disabled={busy}>
            <Undo2 className="size-4" aria-hidden="true" />
            Undo
          </Button>
        )}
        <Button variant="outline" className="flex-1 gap-2" onClick={onAnother}>
          <Sparkles className="size-4" aria-hidden="true" />
          Another
        </Button>
        <Button className="flex-1" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}

function Problem({ message, onRetry, onType }: { message: string; onRetry: () => void; onType: () => void }) {
  return (
    <div className="flex flex-col items-center gap-4 py-4 text-center">
      <Mascot className="size-20 animate-shake" mood="sad" />
      <p className="max-w-sm text-base font-medium text-ink">{message}</p>
      <div className="flex w-full gap-2">
        <Button variant="outline" className="flex-1 gap-2" onClick={onType}>
          <Keyboard className="size-4" aria-hidden="true" />
          Type it
        </Button>
        <Button className="flex-1 gap-2" onClick={onRetry}>
          <RotateCcw className="size-4" aria-hidden="true" />
          Try again
        </Button>
      </div>
    </div>
  );
}
