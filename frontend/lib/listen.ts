import type { BriefingItem } from "./briefing";
import { LISTEN_OFF, type ListenAction, type ListenQueue, listenReducer } from "./listen-queue";

/**
 * Listen mode's engine: reads the summary aloud with the device's own voice (Web Speech) and
 * takes AirPods presses through the Media Session API, the same channel music apps use:
 * one press is play/pause, two is next, three is previous. It works with any headphones or
 * keyboard that has media keys, in the browser and in the iOS app's web view.
 *
 * Browsers only route those presses to a page that is playing media, so while Listen mode is
 * on Penny loops a short silent track. Nothing is recorded and nothing leaves the device.
 */

export type ListenRate = "slower" | "normal" | "faster";
export const LISTEN_RATES: { value: ListenRate; label: string; speed: number }[] = [
  { value: "slower", label: "Slower", speed: 0.85 },
  { value: "normal", label: "Normal", speed: 1 },
  { value: "faster", label: "Faster", speed: 1.2 },
];
const RATE_KEY = "penny-listen-rate";

export type ListenSnapshot = ListenQueue & {
  items: BriefingItem[];
  rate: ListenRate;
  /** Set when the voice failed; cleared on the next start. */
  error: string | null;
};

const INITIAL: ListenSnapshot = { ...LISTEN_OFF, items: [], rate: "normal", error: null };
let snapshot: ListenSnapshot = INITIAL;
let rateLoaded = false;
const listeners = new Set<() => void>();

/** True where this browser can speak. Media Session is a bonus: without it the on-screen controls still work. */
export function isListenSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance === "function";
}

export function hasHeadphoneControls(): boolean {
  return typeof navigator !== "undefined" && "mediaSession" in navigator;
}

export function subscribeListen(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

export function getListenSnapshot(): ListenSnapshot {
  if (!rateLoaded && typeof window !== "undefined") {
    rateLoaded = true;
    snapshot = { ...snapshot, rate: readRate() };
  }
  return snapshot;
}

export const getListenServerSnapshot = (): ListenSnapshot => INITIAL;

function emit(next: ListenSnapshot) {
  snapshot = next;
  for (const listener of listeners) listener();
}

function readRate(): ListenRate {
  try {
    const saved = window.localStorage.getItem(RATE_KEY);
    return LISTEN_RATES.some((option) => option.value === saved) ? (saved as ListenRate) : "normal";
  } catch {
    return "normal";
  }
}

export function setListenRate(rate: ListenRate): void {
  try {
    window.localStorage.setItem(RATE_KEY, rate);
  } catch {
    /* storage blocked: keep it for this visit */
  }
  const restart = snapshot.status === "playing";
  emit({ ...getListenSnapshot(), rate });
  // Re-read the current item at the new speed so the change is heard straight away.
  if (restart) dispatch({ type: "play" }, true);
}

/** Starts reading `items` from the top. Call from a tap or click: browsers only allow speech after one. */
export function startListening(items: BriefingItem[]): void {
  if (!isListenSupported() || !items.length) return;
  getListenSnapshot();
  snapshot = { ...snapshot, items, error: null };
  attachMediaSession();
  // Started inside the tap, so iOS and Safari let both the voice and the keep-alive play.
  void keepAlive()
    ?.play()
    .catch(() => undefined);
  dispatch({ type: "start", length: items.length });
}

export function listenControl(action: "toggle" | "next" | "previous" | "stop"): void {
  dispatch({ type: action });
}

// ------------------------------------------------------------------ engine

let speechToken = 0;

function dispatch(action: ListenAction, forceRestart = false): void {
  const before = snapshot;
  const queue = listenReducer(before, action);
  const changed =
    queue.status !== before.status ||
    queue.index !== before.index ||
    queue.take !== before.take ||
    queue.length !== before.length;
  if (!changed && !forceRestart) return;
  const next: ListenSnapshot = { ...before, ...queue };
  if (forceRestart && next.status === "playing" && next.take === before.take) next.take += 1;
  emit(next);
  apply(before, next);
}

/** Makes the speech, the keep-alive track, and the system's now-playing info match the state. */
function apply(before: ListenSnapshot, now: ListenSnapshot): void {
  if (now.status === "playing") {
    if (now.take !== before.take) speak(now.items[now.index], now.rate);
    void keepAlive()
      ?.play()
      .catch(() => undefined);
  } else {
    speechToken += 1;
    window.speechSynthesis.cancel();
    keepAlive()?.pause();
  }
  if (now.status === "off") detachMediaSession();
  else updateNowPlaying(now);
}

function speak(item: BriefingItem | undefined, rate: ListenRate): void {
  if (!item) return;
  const token = ++speechToken;
  const synth = window.speechSynthesis;
  synth.cancel();
  const utterance = new SpeechSynthesisUtterance(item.text);
  utterance.lang = "en-CA";
  const voice = pickVoice(synth.getVoices());
  if (voice) utterance.voice = voice;
  utterance.rate = LISTEN_RATES.find((option) => option.value === rate)?.speed ?? 1;
  utterance.onend = () => {
    if (token === speechToken) dispatch({ type: "ended" });
  };
  utterance.onerror = (event) => {
    if (token !== speechToken || event.error === "interrupted" || event.error === "canceled") return;
    emit({ ...snapshot, error: "Penny’s voice stopped. Press play to try again." });
    dispatch({ type: "pause" });
  };
  // Chrome drops an utterance queued in the same tick as cancel(), so give it a moment.
  window.setTimeout(() => {
    if (token === speechToken) synth.speak(utterance);
  }, 60);
}

/** A Canadian English voice if the device has one, then any local English voice, then the default. */
function pickVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | undefined {
  const english = voices.filter((voice) => voice.lang.replace("_", "-").toLowerCase().startsWith("en"));
  return (
    english.find((voice) => voice.lang.replace("_", "-").toLowerCase() === "en-ca") ??
    english.find((voice) => voice.localService && voice.default) ??
    english.find((voice) => voice.localService) ??
    english[0]
  );
}

// ------------------------------------------------------------------ headphones

let audio: HTMLAudioElement | null = null;

/** A looping silent track: it holds the media session that headphone presses are sent to. */
function keepAlive(): HTMLAudioElement | null {
  if (typeof window === "undefined") return null;
  if (!audio) {
    audio = new Audio(silentTrackUrl());
    audio.loop = true;
    audio.preload = "auto";
    audio.setAttribute("playsinline", "");
    audio.setAttribute("aria-hidden", "true");
    // The system can pause media on its own (another app starts audio). Keep holding the
    // session while Penny is reading; real presses arrive through the handlers below.
    audio.addEventListener("pause", () => {
      if (snapshot.status === "playing") void audio?.play().catch(() => undefined);
    });
  }
  return audio;
}

/** 10 seconds of 8 kHz, 8-bit mono silence as a WAV (about 80 KB). Some browsers ignore media under 5 seconds. */
function silentTrackUrl(): string {
  const rate = 8_000;
  const samples = rate * 10;
  const buffer = new ArrayBuffer(44 + samples);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i));
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + samples, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true); // PCM header size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate, true); // bytes per second
  view.setUint16(32, 1, true); // block align
  view.setUint16(34, 8, true); // bits per sample
  text(36, "data");
  view.setUint32(40, samples, true);
  new Uint8Array(buffer, 44).fill(128); // 8-bit silence is the midpoint
  return URL.createObjectURL(new Blob([buffer], { type: "audio/wav" }));
}

const HANDLERS: [MediaSessionAction, () => void][] = [
  ["play", () => dispatch({ type: "play" })],
  ["pause", () => dispatch({ type: "pause" })],
  ["stop", () => dispatch({ type: "stop" })],
  ["nexttrack", () => dispatch({ type: "next" })],
  ["previoustrack", () => dispatch({ type: "previous" })],
];

function attachMediaSession(): void {
  if (!hasHeadphoneControls()) return;
  for (const [action, handler] of HANDLERS) {
    try {
      navigator.mediaSession.setActionHandler(action, handler);
    } catch {
      /* this browser doesn't support that action */
    }
  }
}

function detachMediaSession(): void {
  if (!hasHeadphoneControls()) return;
  for (const [action] of HANDLERS) {
    try {
      navigator.mediaSession.setActionHandler(action, null);
    } catch {
      /* not supported */
    }
  }
  navigator.mediaSession.metadata = null;
  navigator.mediaSession.playbackState = "none";
}

function updateNowPlaying(now: ListenSnapshot): void {
  if (!hasHeadphoneControls()) return;
  const item = now.items[now.index];
  // What the lock screen, Control Center, and the AirPods' "now playing" show.
  if (typeof MediaMetadata === "function")
    navigator.mediaSession.metadata = new MediaMetadata({
      title: item?.title ?? "Your summary",
      artist: "Penny",
      album: "Listen mode",
      artwork: [{ src: "/apple-icon.png", sizes: "180x180", type: "image/png" }],
    });
  navigator.mediaSession.playbackState = now.status === "playing" ? "playing" : "paused";
}
