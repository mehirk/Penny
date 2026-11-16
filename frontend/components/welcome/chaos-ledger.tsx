"use client";

import Link from "next/link";
import { useEffect, useRef, type ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { cad, clamp01, easeInOut, usePrefersReducedMotion } from "./motion";
import styles from "./welcome.module.css";

/** Where a scrap sits before Penny sorts it: centre as a fraction of the stage, and a tilt. */
type Place = readonly [x: number, y: number, tilt: number];

interface Scrap {
  id: string;
  wide: Place;
  narrow: Place;
  face: ReactNode;
  label: string;
  tag: string;
  cents: number;
  tone: "in" | "out" | "owed";
}

/** A fictional week of money, as it actually arrives, and the ledger row each scrap becomes. */
const SCRAPS: Scrap[] = [
  {
    id: "rent",
    wide: [0.13, 0.24, -8],
    narrow: [0.24, 0.29, -8],
    face: (
      <div className={styles.sticky}>
        RENT!!!
        <br />
        due fri
      </div>
    ),
    label: "Rent",
    tag: "Due Friday",
    cents: -115000,
    tone: "out",
  },
  {
    id: "jordan",
    wide: [0.8, 0.2, 5],
    narrow: [0.7, 0.2, 5],
    face: (
      <div className={styles.bubble}>
        <span className={styles.from}>Jordan</span>
        you still owe me $15 for pizza 🍕
      </div>
    ),
    label: "Pizza",
    tag: "You owe Jordan",
    cents: -1500,
    tone: "out",
  },
  {
    id: "coffee",
    wide: [0.9, 0.55, 9],
    narrow: [0.8, 0.66, 9],
    face: (
      <div className={styles.stub}>
        CAMPUS CAFÉ
        <br />
        <span className={styles.stubRow}>
          <span>OAT LATTE</span>
          <span>4.85</span>
        </span>
        <span className={styles.stubRow}>
          <span>TOTAL</span>
          <span>4.85</span>
        </span>
        *** THANK YOU ***
      </div>
    ),
    label: "Coffee",
    tag: "Eating out",
    cents: -485,
    tone: "out",
  },
  {
    id: "music",
    wide: [0.2, 0.82, 4],
    narrow: [0.3, 0.83, 4],
    face: (
      <div className={styles.notif}>
        <span className={styles.notifIcon} style={{ background: "#1fae5b" }}>
          ♫
        </span>
        <span>
          <b>Subscription renewed</b>
          <span>Music app · $11.99</span>
        </span>
      </div>
    ),
    label: "Music app",
    tag: "Renews the 14th",
    cents: -1199,
    tone: "out",
  },
  {
    id: "pay",
    wide: [0.74, 0.86, -5],
    narrow: [0.68, 0.93, -5],
    face: (
      <div className={styles.notif}>
        <span className={styles.notifIcon} style={{ background: "#0b6b58" }}>
          $
        </span>
        <span>
          <b>Deposit received</b>
          <span>+$612.40 · Bookstore payroll</span>
        </span>
      </div>
    ),
    label: "Paycheque",
    tag: "Bookstore",
    cents: 61240,
    tone: "in",
  },
  {
    id: "tuition",
    wide: [0.4, 0.15, -3],
    narrow: [0.34, 0.13, -3],
    face: (
      <div className={styles.email}>
        <span className={styles.from}>Student accounts</span>
        <b>Tuition balance</b>
        $3,480.00 due January 8
      </div>
    ),
    label: "Tuition",
    tag: "Already set aside",
    cents: -348000,
    tone: "out",
  },
  {
    id: "cab",
    wide: [0.08, 0.56, 7],
    narrow: [0.18, 0.69, 7],
    face: <div className={styles.torn}>cab home w/ Sai — split??</div>,
    label: "Cab home",
    tag: "Sai owes you",
    cents: 920,
    tone: "owed",
  },
  {
    id: "phone",
    wide: [0.47, 0.88, -7],
    narrow: [0.4, 0.76, -7],
    face: (
      <div className={styles.notif}>
        <span className={styles.notifIcon} style={{ background: "#b3261e" }}>
          !
        </span>
        <span>
          <b>Payment failed</b>
          <span>Phone bill · $65.00</span>
        </span>
      </div>
    ),
    label: "Phone bill",
    tag: "Retry Thursday",
    cents: -6500,
    tone: "out",
  },
];

/**
 * The opening: a week of loose money (sticky notes, texts, receipts, alerts) flies into one tidy
 * ledger as you scroll. The section is tall and its stage sticks, so scroll drives the sort.
 */
export function ChaosLedger() {
  const sectionRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const still = usePrefersReducedMotion();

  useEffect(() => {
    const section = sectionRef.current;
    const stage = stageRef.current;
    if (!section || !stage) return;
    const items = Array.from(stage.querySelectorAll<HTMLElement>("[data-item]"));
    const slots = Array.from(stage.querySelectorAll<HTMLElement>("[data-slot]"));
    let offsets: { dx: number; dy: number; tilt: number }[] = [];
    let frame = 0;

    // Each scrap is laid over its ledger row; its scattered spot is an offset from there.
    const measure = () => {
      const box = stage.getBoundingClientRect();
      const narrow = box.width < 768;
      offsets = items.map((item, index) => {
        const slot = slots[index].getBoundingClientRect();
        const left = slot.left - box.left;
        const top = slot.top - box.top;
        item.style.left = `${left}px`;
        item.style.top = `${top}px`;
        item.style.width = `${slot.width}px`;
        item.style.height = `${slot.height}px`;
        const [x, y, tilt] = narrow ? SCRAPS[index].narrow : SCRAPS[index].wide;
        return { dx: x * box.width - (left + slot.width / 2), dy: y * box.height - (top + slot.height / 2), tilt };
      });
    };

    const render = (progress: number) => {
      const headline = clamp01((progress - 0.6) / 0.18);
      stage.style.setProperty("--p", progress.toFixed(4));
      stage.style.setProperty("--a", clamp01(1 - progress / 0.24).toFixed(3));
      stage.style.setProperty("--b", headline.toFixed(3));
      stage.style.setProperty("--l", clamp01((progress - 0.26) / 0.24).toFixed(3));
      stage.style.setProperty("--f", clamp01((progress - 0.82) / 0.1).toFixed(3));
      items.forEach((item, index) => {
        const offset = offsets[index];
        if (!offset) return;
        const t = easeInOut(clamp01((progress - 0.14 - index * 0.045) / 0.36));
        const away = 1 - t;
        item.style.transform = `translate3d(${offset.dx * away}px, ${offset.dy * away}px, 0) rotate(${offset.tilt * away}deg)`;
        item.style.setProperty("--t", t.toFixed(3));
      });
      // The headline's links can't be reached while it's still invisible.
      if (headRef.current) headRef.current.inert = headline < 0.4;
    };

    const progressNow = () => {
      if (still) return 1;
      const rect = section.getBoundingClientRect();
      const range = rect.height - window.innerHeight;
      return range > 0 ? clamp01(-rect.top / range) : 1;
    };
    const tick = () => {
      frame = 0;
      render(progressNow());
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(tick);
    };
    const onResize = () => {
      measure();
      onScroll();
    };

    measure();
    render(progressNow());
    stage.dataset.ready = "true";
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    // Web fonts change the ledger's height, so measure again once they land.
    document.fonts?.ready.then(onResize).catch(() => undefined);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      cancelAnimationFrame(frame);
    };
  }, [still]);

  return (
    <section ref={sectionRef} className={styles.hero} data-still={still || undefined} aria-labelledby="welcome-title">
      <div ref={stageRef} className={styles.heroStage}>
        <p className={styles.headA} aria-hidden="true">
          <span>Money is</span>
          <em>a mess.</em>
        </p>

        <div ref={headRef} className={styles.headB}>
          <h1 id="welcome-title" className={styles.h1}>
            <span className={styles.strike}>Money is a mess.</span> Penny makes it <em>make sense.</em>
          </h1>
          <p className={styles.lede}>
            Snap a receipt or just say what you spent. Penny files it, splits it, and tells you what you can actually
            afford before payday.
          </p>
          <div className={styles.ctaRow}>
            <Link href="/login" className={styles.btnInk}>
              Sign in to Penny
              <ArrowRight size={18} aria-hidden="true" />
            </Link>
            <a href="#say" className={styles.btnLine}>
              See how it works
            </a>
          </div>
        </div>

        <div className={styles.ledger} aria-hidden="true">
          <div className={styles.ledgerHead}>
            <p className={styles.ledgerTitle}>This week, sorted</p>
            <p className={styles.ledgerDate}>Penny · Nov 15</p>
          </div>
          {SCRAPS.map((scrap) => (
            <div key={scrap.id} data-slot className={styles.slot} />
          ))}
          <div className={styles.ledgerFoot}>
            <div>
              <p className={styles.safeLabel}>Safe to spend until Friday</p>
              <p className={styles.safeNote}>Fictional example · worked out in code</p>
            </div>
            <p className={styles.safe}>{cad(21460)}</p>
          </div>
        </div>

        {SCRAPS.map((scrap, index) => (
          <div key={scrap.id} data-item className={styles.item} aria-hidden="true">
            <div className={styles.scrap}>
              <div className={styles.drift} style={{ animationDelay: `${-index * 0.7}s` }}>
                {scrap.face}
              </div>
            </div>
            <div className={styles.row}>
              <span className={styles.rowLabel}>{scrap.label}</span>
              <span className={styles.rowTag}>{scrap.tag}</span>
              <span className={`${styles.rowAmt} ${styles[scrap.tone]}`}>{cad(scrap.cents, true)}</span>
            </div>
          </div>
        ))}

        <p className={styles.hint} aria-hidden="true">
          Scroll · Penny sorts it
          <i />
        </p>
      </div>
    </section>
  );
}
