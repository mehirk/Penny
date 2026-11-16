"use client";

import { useEffect, useRef } from "react";
import { usePrefersReducedMotion } from "./motion";
import styles from "./welcome.module.css";

const EDGE = Array.from({ length: 17 }, (_, index) => index - 8);

/** Penny's coin: a slow spin in 3D that leans toward the pointer. Pure CSS and a little math. */
export function Coin() {
  const tiltRef = useRef<HTMLDivElement>(null);
  const still = usePrefersReducedMotion();

  useEffect(() => {
    const tilt = tiltRef.current;
    if (!tilt || still) return;
    let target = { x: 0, y: 0 };
    let current = { x: 0, y: 0 };
    let frame = 0;
    const step = () => {
      current = { x: current.x + (target.x - current.x) * 0.1, y: current.y + (target.y - current.y) * 0.1 };
      tilt.style.setProperty("--rx", `${current.x.toFixed(2)}deg`);
      tilt.style.setProperty("--ry", `${current.y.toFixed(2)}deg`);
      const moving = Math.abs(target.x - current.x) + Math.abs(target.y - current.y) > 0.05;
      frame = moving ? requestAnimationFrame(step) : 0;
    };
    const onMove = (event: PointerEvent) => {
      const box = tilt.getBoundingClientRect();
      target = {
        x: ((event.clientY - (box.top + box.height / 2)) / window.innerHeight) * -36,
        y: ((event.clientX - (box.left + box.width / 2)) / window.innerWidth) * 50,
      };
      if (!frame) frame = requestAnimationFrame(step);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(frame);
    };
  }, [still]);

  return (
    <div aria-hidden="true">
      <div className={styles.coinStage}>
        <div ref={tiltRef} className={styles.coinTilt}>
          <div className={styles.coin}>
            {EDGE.map((z) => (
              <span
                key={z}
                className={styles.edge}
                style={{ transform: `translateZ(${z}px)`, background: z % 2 ? "#7a3214" : "#5e250d" }}
              />
            ))}
            <div className={`${styles.face} ${styles.front}`}>
              <svg className={styles.ring} viewBox="0 0 200 200">
                <defs>
                  <path id="welcome-coin-ring" d="M100,100 m-80,0 a80,80 0 1,1 160,0 a80,80 0 1,1 -160,0" />
                </defs>
                <text>
                  <textPath href="#welcome-coin-ring">PENNY · MONEY THAT FINALLY MAKES SENSE · 2026 ·</textPath>
                </text>
              </svg>
              <span className={styles.coinGlyph}>P</span>
            </div>
            <div className={`${styles.face} ${styles.back}`}>
              <span className={styles.coinGlyph}>¢</span>
            </div>
          </div>
        </div>
      </div>
      <div className={styles.coinShadow} />
    </div>
  );
}
