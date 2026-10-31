"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;

const DRAG_SKIP = "input, textarea, select, [data-sheet-no-drag]";

/**
 * Lets a phone bottom sheet be dragged down to close, like an iOS sheet: from the top of its
 * scroll, past a third of the way or with a quick flick. A ref callback because the sheet
 * mounts in a portal only while open.
 */
function attachSheetDrag(sheet: HTMLDivElement | null) {
  if (!sheet) return;
  const phone = window.matchMedia("(max-width: 639px)");
  let startY = 0;
  let startTime = 0;
  let offset = 0;
  let dragging = false;

  const start = (event: TouchEvent) => {
    dragging = phone.matches && event.touches.length === 1 && sheet.scrollTop <= 0 && !(event.target instanceof Element && event.target.closest(DRAG_SKIP));
    startY = event.touches[0]?.clientY ?? 0;
    startTime = event.timeStamp;
    offset = 0;
  };
  const move = (event: TouchEvent) => {
    if (!dragging) return;
    offset = (event.touches[0]?.clientY ?? startY) - startY;
    // Moving up scrolls the sheet's content instead.
    if (offset <= 0) { dragging = false; sheet.style.transform = ""; return; }
    event.preventDefault();
    sheet.style.transition = "none";
    sheet.style.transform = `translateY(${offset}px)`;
  };
  const end = (event: TouchEvent) => {
    if (!dragging) return;
    dragging = false;
    const flick = offset > 40 && offset / Math.max(1, event.timeStamp - startTime) > 0.6;
    sheet.style.transition = "transform 220ms cubic-bezier(0.32, 0.72, 0, 1)";
    if (offset > sheet.offsetHeight / 3 || flick) {
      sheet.style.transform = "translateY(100%)";
      window.setTimeout(() => {
        sheet.querySelector<HTMLButtonElement>("[data-sheet-close]")?.click();
        // If the dialog chose to stay open, bring it back.
        window.setTimeout(() => { if (sheet.isConnected) sheet.style.transform = ""; }, 300);
      }, 200);
    } else {
      sheet.style.transform = "";
    }
  };

  sheet.addEventListener("touchstart", start, { passive: true });
  sheet.addEventListener("touchmove", move, { passive: false });
  sheet.addEventListener("touchend", end);
  sheet.addEventListener("touchcancel", end);
  return () => {
    sheet.removeEventListener("touchstart", start);
    sheet.removeEventListener("touchmove", move);
    sheet.removeEventListener("touchend", end);
    sheet.removeEventListener("touchcancel", end);
  };
}

/**
 * Bottom sheet on phones, centred modal from the sm breakpoint. Scrolls internally if tall.
 * On touch screens it opens without focusing a text field, so the keyboard doesn't cover it.
 */
export function DialogContent({ className, children, onOpenAutoFocus, ...props }: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="dialog-overlay fixed inset-0 z-40" />
      <DialogPrimitive.Content
        ref={attachSheetDrag}
        onOpenAutoFocus={(event) => {
          onOpenAutoFocus?.(event);
          if (event.defaultPrevented || !window.matchMedia("(pointer: coarse)").matches) return;
          event.preventDefault();
          (event.currentTarget as HTMLElement | null)?.focus({ preventScroll: true });
        }}
        className={cn(
          "dialog-content fixed inset-x-0 bottom-0 z-50 max-h-[calc(100dvh-env(safe-area-inset-top)-0.75rem)] overflow-y-auto overscroll-contain rounded-t-[1.5rem] bg-surface p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-[var(--shadow-raised)] focus:outline-none sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:max-h-[calc(100dvh-2rem)] sm:w-[calc(100%-2rem)] sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[1.5rem] sm:p-6",
          className,
        )}
        {...props}
      >
        <div aria-hidden="true" className="-mx-5 -mt-5 mb-1 flex h-7 items-center justify-center sm:hidden"><div className="h-1.5 w-10 rounded-full bg-line-strong" /></div>
        {children}
        <DialogPrimitive.Close data-sheet-close aria-label="Close" className="absolute right-3 top-3 grid size-11 place-items-center rounded-full text-ink-subtle transition-colors hover:bg-sage-soft hover:text-ink sm:right-4 sm:top-4">
          <X className="size-5" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("mb-5 pr-10", className)} {...props} />;
}
export function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className={cn("text-xl font-semibold tracking-tight text-ink", className)} {...props} />;
}
export function DialogDescription({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description className={cn("mt-1 text-sm text-ink-subtle", className)} {...props} />;
}
