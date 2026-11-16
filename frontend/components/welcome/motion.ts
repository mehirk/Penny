"use client";

import { useEffect, useState, useSyncExternalStore, type RefObject } from "react";
import { formatCad } from "@/lib/money";

const REDUCED = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void) {
  const query = window.matchMedia(REDUCED);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** True when the visitor asked for less motion; the page then shows every end state at once. */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(REDUCED).matches,
    () => false,
  );
}

/** Becomes true the first time the element scrolls into view, and stays true. */
export function useSeen(ref: RefObject<Element | null>, rootMargin = "0px 0px -20% 0px"): boolean {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element || seen) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setSeen(true);
          observer.disconnect();
        }
      },
      { rootMargin },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, rootMargin, seen]);
  return seen;
}

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function easeInOut(value: number): number {
  return value < 0.5 ? 4 * value ** 3 : 1 - (-2 * value + 2) ** 3 / 2;
}

/** CAD for a fictional example amount held in integer cents, through the app's own formatter. */
export function cad(cents: number, showSign = false): string {
  if (!Number.isSafeInteger(cents)) throw new Error("Example amounts must be whole cents");
  return formatCad(String(cents), showSign);
}
