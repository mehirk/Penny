"use client";

import { useEffect, useRef } from "react";

/** True when keys should go to a form field. A field inside a dialog that is closing doesn't count. */
const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  !target.closest("[role=dialog][data-state=closed]") &&
  (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

/** Single-key shortcuts, ignored while typing in a field or while a dialog is open. */
export function useKeyboardShortcuts(shortcuts: Record<string, () => void>) {
  const latest = useRef(shortcuts);
  useEffect(() => { latest.current = shortcuts; });
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
      if (document.querySelector("[role=dialog][data-state=open]")) return;
      const run = latest.current[event.key.toLowerCase()];
      if (!run) return;
      event.preventDefault();
      run();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
