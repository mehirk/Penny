import type { Persona } from "@/lib/api";

/**
 * How Penny talks and moves. "Learning first" gets the playful Penny (games, confetti, sound,
 * cheerful lines); students and working adults get a calm, plain one: same data and features,
 * no bouncing, no emoji, sound off unless they turn it on.
 */
export type Tone = "playful" | "grown";

export const toneFor = (persona: Persona | null | undefined): Tone => (persona === "learner" ? "playful" : "grown");

/** The tone set on the page (`<html data-tone>`), for code without the dashboard at hand. */
export function pageTone(): Tone {
  return typeof document !== "undefined" && document.documentElement.dataset.tone === "playful" ? "playful" : "grown";
}
