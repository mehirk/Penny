"use client";

import { useEffect, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The game layer for Learn: confetti, sounds, and count-up numbers. Everything here is drawn or
 * synthesised in the browser (no images, audio files, or libraries), and is skipped when the
 * person has asked their device for reduced motion or turned Learn's sound off.
 */

const SOUND_KEY = "penny-learn-sound";
// Fixed party colours, so confetti stays bright in every theme (Graphite is all greys).
const PALETTE = ["#f5b82e", "#19b394", "#4a8fe7", "#f0645a", "#b67df2", "#ff8fb1"];

function reducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

type Burst = {
  /** Where the confetti starts, as a fraction of the viewport (default: the middle, a bit high). */
  x?: number;
  y?: number;
  /** About how many pieces: 30 for a small "correct!", 160 for a passed lesson. */
  pieces?: number;
  /** Spread in degrees: 360 sprays everywhere, 70 is a fountain. */
  spread?: number;
};

/** A one-off burst of confetti over the whole page; it removes itself when it lands. */
export function confetti({ x = 0.5, y = 0.35, pieces = 140, spread = 360 }: Burst = {}): void {
  if (typeof document === "undefined" || reducedMotion()) return;
  const canvas = document.createElement("canvas");
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = window.innerWidth * ratio;
  canvas.height = window.innerHeight * ratio;
  canvas.setAttribute("aria-hidden", "true");
  Object.assign(canvas.style, { position: "fixed", inset: "0", width: "100%", height: "100%", pointerEvents: "none" });
  canvas.style.zIndex = "80";
  document.body.appendChild(canvas);
  const context = canvas.getContext("2d");
  if (!context) {
    canvas.remove();
    return;
  }
  context.scale(ratio, ratio);

  const originX = window.innerWidth * x;
  const originY = window.innerHeight * y;
  const particles = Array.from({ length: pieces }, () => {
    const angle = ((-90 + (Math.random() - 0.5) * spread) * Math.PI) / 180;
    const speed = 6 + Math.random() * 9;
    return {
      x: originX,
      y: originY,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 3,
      size: 5 + Math.random() * 6,
      spin: Math.random() * Math.PI,
      turn: (Math.random() - 0.5) * 0.3,
      color: PALETTE[Math.floor(Math.random() * PALETTE.length)],
      round: Math.random() < 0.3,
    };
  });

  const started = performance.now();
  const frame = (now: number) => {
    const age = now - started;
    context.clearRect(0, 0, window.innerWidth, window.innerHeight);
    context.globalAlpha = age > 1800 ? Math.max(0, 1 - (age - 1800) / 700) : 1;
    for (const p of particles) {
      p.vx *= 0.985;
      p.vy = p.vy * 0.985 + 0.32;
      p.x += p.vx;
      p.y += p.vy;
      p.spin += p.turn;
      context.save();
      context.translate(p.x, p.y);
      context.rotate(p.spin);
      context.fillStyle = p.color;
      if (p.round) {
        context.beginPath();
        context.arc(0, 0, p.size / 2, 0, Math.PI * 2);
        context.fill();
      } else {
        // Paper strips flutter: squash one side as they turn.
        context.fillRect(-p.size / 2, -p.size / 4, p.size, (p.size / 2) * Math.abs(Math.cos(p.spin * 2)));
      }
      context.restore();
    }
    if (age < 2500) requestAnimationFrame(frame);
    else canvas.remove();
  };
  requestAnimationFrame(frame);
}

/** Confetti from an element on screen, such as the button that was just pressed. */
export function confettiFrom(element: Element | null, burst: Omit<Burst, "x" | "y"> = {}): void {
  if (!element) return confetti(burst);
  const box = element.getBoundingClientRect();
  confetti({
    ...burst,
    x: (box.left + box.width / 2) / window.innerWidth,
    y: (box.top + box.height / 2) / window.innerHeight,
  });
}

// ---------------------------------------------------------------------------------------------
// Sound: short tones made with Web Audio, only ever after a tap (browsers require that anyway).

type Sound = "correct" | "wrong" | "win" | "coin" | "levelUp" | "tap";

/** Each sound is a few notes: [frequency in Hz, start in seconds, length in seconds]. */
const NOTES: Record<Sound, { wave: OscillatorType; volume: number; notes: [number, number, number][] }> = {
  tap: { wave: "sine", volume: 0.05, notes: [[660, 0, 0.06]] },
  coin: {
    wave: "square",
    volume: 0.04,
    notes: [
      [988, 0, 0.07],
      [1319, 0.07, 0.16],
    ],
  },
  correct: {
    wave: "triangle",
    volume: 0.12,
    notes: [
      [784, 0, 0.1],
      [1175, 0.09, 0.22],
    ],
  },
  wrong: {
    wave: "sawtooth",
    volume: 0.05,
    notes: [
      [220, 0, 0.14],
      [165, 0.13, 0.26],
    ],
  },
  win: {
    wave: "triangle",
    volume: 0.12,
    notes: [
      [523, 0, 0.14],
      [659, 0.12, 0.14],
      [784, 0.24, 0.14],
      [1047, 0.36, 0.45],
    ],
  },
  levelUp: {
    wave: "square",
    volume: 0.05,
    notes: [
      [392, 0, 0.1],
      [523, 0.1, 0.1],
      [659, 0.2, 0.1],
      [784, 0.3, 0.1],
      [1047, 0.4, 0.5],
    ],
  },
};

let audio: AudioContext | null = null;

export function soundOn(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(SOUND_KEY) !== "off";
  } catch {
    return true;
  }
}

export function play(sound: Sound): void {
  if (typeof window === "undefined" || !soundOn()) return;
  try {
    audio ??= new AudioContext();
    if (audio.state === "suspended") void audio.resume();
    const { wave, volume, notes } = NOTES[sound];
    const now = audio.currentTime;
    for (const [frequency, start, length] of notes) {
      const tone = audio.createOscillator();
      const gain = audio.createGain();
      tone.type = wave;
      tone.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, now + start);
      gain.gain.exponentialRampToValueAtTime(volume, now + start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + start + length);
      tone.connect(gain).connect(audio.destination);
      tone.start(now + start);
      tone.stop(now + start + length + 0.02);
    }
  } catch {
    /* no Web Audio: play silently */
  }
}

/** Learn's sound on/off switch, remembered on this device. */
export function SoundToggle({ className }: { className?: string }) {
  const [on, setOn] = useState(soundOn);
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => {
        const next = !on;
        setOn(next);
        try {
          window.localStorage.setItem(SOUND_KEY, next ? "on" : "off");
        } catch {
          /* storage blocked: the switch works until the page reloads */
        }
        if (next) play("tap");
      }}
      className={cn(
        "inline-flex min-h-10 items-center gap-1.5 rounded-full border border-line px-3 text-xs font-semibold text-ink hover:bg-sage-soft",
        className,
      )}
    >
      {on ? <Volume2 className="size-3.5" aria-hidden="true" /> : <VolumeX className="size-3.5" aria-hidden="true" />}
      Sound {on ? "on" : "off"}
    </button>
  );
}

// ---------------------------------------------------------------------------------------------

/** A whole number that counts up from `from` to `to` (for XP), or jumps there with reduced motion. */
export function CountUp({ to, from = 0, duration = 900 }: { to: number; from?: number; duration?: number }) {
  const [value, setValue] = useState(from);
  useEffect(() => {
    if (reducedMotion() || to === from) return;
    let frame = 0;
    const started = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - started) / duration);
      setValue(Math.round(from + (to - from) * (1 - (1 - t) ** 3)));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [to, from, duration]);
  return <>{reducedMotion() || to === from ? to : value}</>;
}
