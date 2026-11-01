"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

/**
 * Slides the page content like an iOS navigation push (in from the right) or pop (back from the
 * left), where View Transitions are supported and motion is allowed; otherwise it just updates.
 * The header and tab bar have their own transition names in globals.css, so they stay put.
 */
let latest = 0;

export function slide(direction: "push" | "pop", update: () => void) {
  const root = document.documentElement;
  // After a back swipe the page has already slid away by hand (BackBar eases the next one in).
  if ("swiping" in root.dataset) { update(); return; }
  // Reduce Motion: a short cross-fade instead of a slide, never a hard cut.
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!("startViewTransition" in document)) { update(); enter(reduce ? "fade" : direction); return; }
  root.dataset.nav = reduce ? "fade" : direction;
  const token = ++latest;
  const transition = document.startViewTransition(() => flushSync(update));
  // A newer slide may have started (and cancelled this one); only the latest clears the flag.
  const done = () => { if (token === latest) delete root.dataset.nav; };
  transition.finished.then(done, done);
  transition.ready.catch(() => undefined);
  transition.updateCallbackDone.catch(() => undefined);
}

/** Without View Transitions: animate only the incoming page (in from the side, or a fade). */
export function enter(kind: "push" | "pop" | "fade") {
  const page = document.getElementById("main");
  if (!page) return;
  const from = kind === "push" ? { transform: "translateX(40%)", opacity: 0 } : kind === "pop" ? { transform: "translateX(-28%)", opacity: 0.4 } : { opacity: 0 };
  page.animate([from, { transform: "none", opacity: 1 }], { duration: kind === "fade" ? 200 : 340, easing: "cubic-bezier(0.32, 0.72, 0, 1)" });
}

/**
 * A page inside a view, kept in the address ("#settings/appearance", "#today/acct-1") so the
 * device's Back returns to the list and a link can open the page directly.
 */
export function useSubpage(view: string): [string | null, (id: string) => void, () => void] {
  const [page, setPage] = useState<string | null>(null);
  const shown = useRef<string | null>(null);
  const show = useCallback((next: string | null) => { shown.current = next; setPage(next); }, []);
  useEffect(() => {
    const sync = () => {
      const [current, sub] = window.location.hash.slice(1).split("/");
      const next = current === view && sub ? decodeURIComponent(sub) : null;
      if (next === shown.current) return;
      // Back from a page to its list (the device's Back or a swipe) slides the other way;
      // leaving for another tab doesn't, since that view cross-fades instead.
      // Back fires both popstate and hashchange; mark the list as shown now so the second is a no-op.
      if (shown.current && !next && current === view) { shown.current = null; slide("pop", () => { show(null); window.scrollTo(0, 0); }); }
      else show(next);
    };
    sync();
    const events = ["popstate", "hashchange", "penny:navigate"];
    for (const name of events) window.addEventListener(name, sync);
    return () => { for (const name of events) window.removeEventListener(name, sync); };
  }, [view, show]);

  const open = useCallback((id: string) => {
    window.history.pushState({ pennySubpage: true }, "", `#${view}/${encodeURIComponent(id)}`);
    slide("push", () => { show(id); window.scrollTo(0, 0); });
  }, [view, show]);

  const back = useCallback(() => {
    const fromList = (window.history.state as { pennySubpage?: boolean } | null)?.pennySubpage;
    // A back swipe: show the list now (the swipe already animated); the history step then matches.
    if ("swiping" in document.documentElement.dataset) {
      show(null);
      if (fromList) window.history.back(); else window.history.replaceState(null, "", `#${view}`);
      return;
    }
    // Opened from the list: step back in history (popstate slides it). Arrived by link: show the list.
    if (fromList) { window.history.back(); return; }
    window.history.replaceState(null, "", `#${view}`);
    slide("pop", () => { show(null); window.scrollTo(0, 0); });
  }, [view, show]);

  return [page, open, back];
}
