"use client";

import { useEffect, useRef } from "react";
import { cad, clamp01, usePrefersReducedMotion } from "./motion";
import styles from "./welcome.module.css";

/** The fictional Maldives answer. Totals are summed here in whole cents, never typed in. */
const LINES = [
  { label: "Flights · YYZ ⇄ MLE", cents: 148600 },
  { label: "Hotel · 7 nights", cents: 161000 },
  { label: "Tourist tax · 7 × $12", cents: 8400 },
  { label: "Seaplane transfers", cents: 62000 },
];
const TOTAL = LINES.reduce((sum, line) => sum + line.cents, 0);
const SAVED = 124000;
const NEEDED = TOTAL - SAVED;
const WEEKS = 24;
/** Rounded up to a whole dollar, so 24 weeks always covers what's still needed. */
const WEEKLY = Math.ceil(NEEDED / WEEKS / 100) * 100;

const TEAM = ["Planner", "Cash flow", "Analyst", "Travel scout (new)"];

/** A receipt that prints line by line as you scroll, then gets stamped with the honest answer. */
export function Receipt() {
  const printerRef = useRef<HTMLDivElement>(null);
  const stampRef = useRef<HTMLDivElement>(null);
  const still = usePrefersReducedMotion();

  useEffect(() => {
    const printer = printerRef.current;
    const stamp = stampRef.current;
    if (!printer || !stamp) return;
    if (still) {
      printer.style.setProperty("--print", "1");
      printer.dataset.stamped = "true";
      return;
    }
    let frame = 0;
    const tick = () => {
      frame = 0;
      const rect = printer.getBoundingClientRect();
      // The paper's edge sits at 72% of the screen: each line prints as it scrolls past that point.
      const print = clamp01((window.innerHeight * 0.72 - rect.top) / rect.height);
      printer.style.setProperty("--print", print.toFixed(4));
      const stampAt = (stamp.offsetTop + stamp.offsetHeight) / rect.height;
      if (print >= stampAt) printer.dataset.stamped = "true";
      else delete printer.dataset.stamped;
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(tick);
    };
    tick();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [still]);

  return (
    <div ref={printerRef} className={styles.printer}>
      <div className={styles.receipt}>
        <div className={styles.rcCenter}>
          <p className={styles.rcBrand}>Penny</p>
          <p className={styles.rcMeta}>ANSWER NO. 0042 · 15 NOV 2026 · 9:41 PM</p>
        </div>
        <hr className={styles.rcRule} />
        <p className={styles.rcCaps}>Q: Can I afford a trip to the Maldives?</p>
        <hr className={styles.rcRule} />
        <p className={styles.rcCaps}>Team on it</p>
        <ul className={styles.rcList}>
          {TEAM.map((name) => (
            <li key={name} className={styles.rcRow}>
              <span>{name}</span>
              <span>✓</span>
            </li>
          ))}
        </ul>
        <hr className={styles.rcRule} />
        <ul className={styles.rcList}>
          {LINES.map((line) => (
            <li key={line.label} className={styles.rcRow}>
              <span>{line.label}</span>
              <span>{cad(line.cents)}</span>
            </li>
          ))}
        </ul>
        <hr className={styles.rcRuleDouble} />
        <p className={`${styles.rcRow} ${styles.rcStrong}`}>
          <span>Trip total</span>
          <span>{cad(TOTAL)}</span>
        </p>
        <p className={styles.rcRow}>
          <span>Saved so far</span>
          <span>{cad(-SAVED)}</span>
        </p>
        <p className={`${styles.rcRow} ${styles.rcStrong}`}>
          <span>Still needed</span>
          <span>{cad(NEEDED)}</span>
        </p>

        <div ref={stampRef} className={styles.stampWrap}>
          <span className={styles.notYet}>NOT YET.</span>
          <p className={styles.soon}>…but soon.</p>
        </div>

        <p className={`${styles.rcRow} ${styles.rcStrong}`}>
          <span>Save weekly</span>
          <span>{cad(WEEKLY)}</span>
        </p>
        <p className={styles.rcRow}>
          <span>For {WEEKS} weeks · going by</span>
          <span>MAY 2</span>
        </p>
        <hr className={styles.rcRule} />
        <p className={styles.rcCaps}>You didn’t ask, but:</p>
        <ul className={styles.rcList}>
          <li>* Your card charges 2.5% abroad</li>
          <li>* Passport must be valid 6+ months</li>
          <li>* eSIM $25 beats roaming at $16/day</li>
        </ul>
        <hr className={styles.rcRule} />
        <p className={styles.rcCaps}>Every figure worked out by code, to the cent. The AI only explains.</p>
        <p className={styles.goalBox}>☐ Set up goal · needs your OK</p>
        <div className={styles.barcode} aria-hidden="true" />
        <p className={`${styles.rcMeta} ${styles.rcCenter}`}>FICTIONAL EXAMPLE · NOT FINANCIAL ADVICE</p>
      </div>
      <div className={styles.head} aria-hidden="true" />
    </div>
  );
}
