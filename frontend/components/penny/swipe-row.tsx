"use client";

import { useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { haptic } from "@/lib/native";
import { cn } from "@/lib/utils";

const OPEN = 88;

/**
 * A list row that slides sideways on touch (either direction) to show Delete, like iOS Mail.
 * Delete calls `onDelete`, which asks for confirmation first. A tap while open just closes it.
 * Keyboard and screen-reader users keep the row's own Delete action, so nothing depends on swiping.
 */
export function SwipeRow({
  label,
  onDelete,
  children,
  className,
}: {
  label: string;
  onDelete: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  const [offset, setOffsetState] = useState(0);
  const [dragging, setDragging] = useState(false);
  // The latest position, for handlers that run before React re-renders (fast swipes).
  const current = useRef(0);
  const setOffset = (value: number) => {
    current.current = value;
    setOffsetState(value);
  };
  const start = useRef<{ x: number; y: number; base: number; horizontal: boolean | null } | null>(null);

  const onTouchStart = (event: React.TouchEvent) => {
    const touch = event.touches[0];
    if (touch) start.current = { x: touch.clientX, y: touch.clientY, base: current.current, horizontal: null };
  };
  const onTouchMove = (event: React.TouchEvent) => {
    const origin = start.current;
    const touch = event.touches[0];
    if (!origin || !touch) return;
    const dx = touch.clientX - origin.x;
    const dy = touch.clientY - origin.y;
    if (origin.horizontal === null) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      origin.horizontal = Math.abs(dx) > Math.abs(dy);
    }
    if (!origin.horizontal) return;
    setDragging(true);
    setOffset(Math.max(-OPEN - 24, Math.min(OPEN + 24, origin.base + dx)));
  };
  const onTouchEnd = () => {
    const origin = start.current;
    start.current = null;
    if (!origin?.horizontal) return;
    setDragging(false);
    const at = current.current;
    const next = at > OPEN / 2 ? OPEN : at < -OPEN / 2 ? -OPEN : 0;
    if (next !== 0 && origin.base === 0) haptic("light");
    setOffset(next);
  };

  const remove = () => {
    setOffset(0);
    onDelete();
  };
  const action = (side: "left" | "right") => (
    <button
      type="button"
      tabIndex={-1}
      aria-hidden="true"
      onClick={remove}
      className={cn(
        "absolute inset-y-0 flex w-[88px] flex-col items-center justify-center gap-1 bg-danger text-xs font-semibold text-white",
        side === "left" ? "left-0" : "right-0",
      )}
    >
      <Trash2 className="size-5" />
      Delete
    </button>
  );

  return (
    <div className={cn("relative overflow-hidden", className)} aria-label={label}>
      {offset > 0 && action("left")}
      {offset < 0 && action("right")}
      <div
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
        onClickCapture={(event) => {
          if (offset !== 0) {
            event.preventDefault();
            event.stopPropagation();
            setOffset(0);
          }
        }}
        style={{
          transform: offset ? `translateX(${offset}px)` : undefined,
          transition: dragging ? "none" : "transform 240ms cubic-bezier(0.32, 0.72, 0, 1)",
          touchAction: "pan-y",
        }}
        className="relative bg-surface"
      >
        {children}
      </div>
    </div>
  );
}
