"use client";

import { useEffect, useRef } from "react";
import { flushSync } from "react-dom";
import { ChevronLeft } from "lucide-react";
import { haptic, isNativeApp } from "@/lib/native";
import { enter } from "./subpage";

const EDGE = 28;

/**
 * The top of an inner page on small screens: "‹ Home" (or wherever Back goes) in place of the
 * app header, which `html[data-subpage]` hides below `lg`. In the iOS app, a swipe from the left
 * edge drags the page and goes back, like a native navigation stack.
 */
export function BackBar({ label, onBack }: { label: string; onBack: () => void }) {
  const back = useRef(onBack);
  useEffect(() => {
    back.current = onBack;
  }, [onBack]);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.subpage = "";
    return () => {
      delete root.dataset.subpage;
    };
  }, []);

  useEffect(() => {
    if (!isNativeApp()) return;
    const page = document.getElementById("main");
    if (!page) return;
    let startX = 0,
      startY = 0,
      startTime = 0,
      dx = 0;
    let state: "idle" | "maybe" | "drag" = "idle";
    const reset = (animate: boolean) => {
      page.style.transition = animate ? "transform 220ms cubic-bezier(0.32, 0.72, 0, 1)" : "none";
      page.style.transform = "";
      page.style.boxShadow = "";
    };
    const start = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (event.touches.length !== 1 || !touch || touch.clientX > EDGE || document.querySelector("[role=dialog]"))
        return;
      startX = touch.clientX;
      startY = touch.clientY;
      startTime = event.timeStamp;
      dx = 0;
      state = "maybe";
    };
    const move = (event: TouchEvent) => {
      if (state === "idle") return;
      const touch = event.touches[0];
      if (!touch) return;
      dx = Math.max(0, touch.clientX - startX);
      const dy = Math.abs(touch.clientY - startY);
      if (state === "maybe") {
        if (dy > 10 && dy > dx) {
          state = "idle";
          return;
        }
        if (dx < 8) return;
        state = "drag";
        page.style.transition = "none";
        page.style.boxShadow = "-12px 0 32px rgb(0 0 0 / 0.25)";
      }
      event.preventDefault();
      page.style.transform = `translateX(${dx}px)`;
    };
    const end = (event: TouchEvent) => {
      if (state !== "drag") {
        state = "idle";
        return;
      }
      state = "idle";
      const fast = dx > 50 && dx / Math.max(1, event.timeStamp - startTime) > 0.5;
      if (dx < window.innerWidth * 0.35 && !fast) {
        reset(true);
        return;
      }
      page.style.transition = "transform 180ms cubic-bezier(0.32, 0.72, 0, 1)";
      page.style.transform = "translateX(100%)";
      haptic("light");
      // Switch just before the page has fully left, so there's no empty frame in between.
      window.setTimeout(() => {
        // Already slid away by hand, so the change itself shouldn't animate again.
        document.documentElement.dataset.swiping = "";
        flushSync(() => back.current());
        delete document.documentElement.dataset.swiping;
        reset(false);
        window.scrollTo(0, 0);
        // The page underneath eases in from the left, as in an iOS back swipe.
        enter(window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "fade" : "pop");
      }, 120);
    };
    document.addEventListener("touchstart", start, { passive: true });
    document.addEventListener("touchmove", move, { passive: false });
    document.addEventListener("touchend", end);
    document.addEventListener("touchcancel", end);
    return () => {
      document.removeEventListener("touchstart", start);
      document.removeEventListener("touchmove", move);
      document.removeEventListener("touchend", end);
      document.removeEventListener("touchcancel", end);
      reset(false);
    };
  }, []);

  return (
    <div className="back-bar sticky top-0 z-20 -mx-4 -mt-5 mb-2 bg-canvas/85 px-2 pt-[env(safe-area-inset-top)] backdrop-blur-md sm:-mx-6 lg:static lg:mx-0 lg:mt-0 lg:bg-transparent lg:px-0 lg:pt-0 lg:backdrop-blur-none">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex min-h-11 items-center gap-0.5 rounded-lg px-2 text-base font-semibold text-ink-muted hover:text-ink lg:-ml-2"
      >
        <ChevronLeft className="size-5" aria-hidden="true" />
        {label}
      </button>
    </div>
  );
}
