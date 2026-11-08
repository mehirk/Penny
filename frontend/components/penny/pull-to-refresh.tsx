"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown, LoaderCircle } from "lucide-react";
import { haptic, isNativeApp } from "@/lib/native";

const TRIGGER_PX = 72;

/**
 * Pull down from the top of the page to reload, as in iOS apps. Only in the iOS app: Safari
 * already has its own. Ignored while a sheet is open.
 */
export function PullToRefresh({ onRefresh }: { onRefresh: () => Promise<void> }) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const latest = useRef(onRefresh);
  useEffect(() => {
    latest.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    if (!isNativeApp()) return;
    let startY: number | null = null;
    let armed = false;
    let busy = false;
    const start = (event: TouchEvent) => {
      const atTop = window.scrollY <= 0 && !document.querySelector("[role=dialog][data-state=open]");
      startY = atTop && !busy && event.touches.length === 1 ? event.touches[0].clientY : null;
      armed = false;
    };
    const move = (event: TouchEvent) => {
      if (startY === null) return;
      const distance = Math.max(0, event.touches[0].clientY - startY);
      setPull(Math.min(distance, TRIGGER_PX * 1.5));
      if (distance >= TRIGGER_PX !== armed) {
        armed = !armed;
        if (armed) haptic("light");
      }
    };
    const end = () => {
      if (startY === null) return;
      startY = null;
      setPull(0);
      if (!armed) return;
      busy = true;
      setRefreshing(true);
      latest.current().finally(() => {
        busy = false;
        setRefreshing(false);
      });
    };
    document.addEventListener("touchstart", start, { passive: true });
    document.addEventListener("touchmove", move, { passive: true });
    document.addEventListener("touchend", end);
    document.addEventListener("touchcancel", end);
    return () => {
      document.removeEventListener("touchstart", start);
      document.removeEventListener("touchmove", move);
      document.removeEventListener("touchend", end);
      document.removeEventListener("touchcancel", end);
    };
  }, []);

  const progress = Math.min(1, pull / TRIGGER_PX);
  return (
    <>
      <p role="status" className="sr-only">
        {refreshing ? "Refreshing" : ""}
      </p>
      {(refreshing || pull > 0) && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+0.75rem)] z-40 flex justify-center"
        >
          <div
            style={{ opacity: refreshing ? 1 : progress, transform: `translateY(${refreshing ? 8 : pull / 3}px)` }}
            className="grid size-9 place-items-center rounded-full border border-line bg-surface text-accent-strong shadow-[var(--shadow-raised)]"
          >
            {refreshing ? (
              <LoaderCircle className="size-5 animate-spin" />
            ) : (
              <ArrowDown
                className="size-5 transition-transform duration-150"
                style={{ transform: `rotate(${progress >= 1 ? 180 : 0}deg)` }}
              />
            )}
          </div>
        </div>
      )}
    </>
  );
}
