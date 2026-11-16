"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ArrowRight, Mic } from "lucide-react";
import { Mascot } from "@/components/penny/mascot";
import { cad, usePrefersReducedMotion, useSeen } from "./motion";
import styles from "./welcome.module.css";

type Kind = "what" | "amount" | "who" | "split";

interface Segment {
  text: string;
  kind?: Kind;
}

interface PlanRow {
  label: string;
  cents?: number;
  tone?: "in" | "out" | "owed";
}

interface Example {
  id: string;
  chip: string;
  emoji: string;
  segments: Segment[];
  rows: PlanRow[];
  done: string;
}

const KIND_LABELS: Record<Kind, string> = { what: "What", amount: "Amount", who: "Who", split: "Split" };

/** Shares in whole cents; any leftover cents go to the first people, so the parts add up exactly. */
function splitCents(total: number, ways: number): number[] {
  const base = Math.floor(total / ways);
  const extra = total - base * ways;
  return Array.from({ length: ways }, (_, index) => base + (index < extra ? 1 : 0));
}

const PIZZA = 3600;
const [YOUR_SHARE, SAI_SHARE, MAYA_SHARE] = splitCents(PIZZA, 3);

const EXAMPLES: Example[] = [
  {
    id: "pizza",
    chip: "Split a pizza",
    emoji: "🍕",
    segments: [
      { text: "Pizza", kind: "what" },
      { text: ", " },
      { text: "$36", kind: "amount" },
      { text: ", " },
      { text: "split", kind: "split" },
      { text: " with " },
      { text: "Sai", kind: "who" },
      { text: " and " },
      { text: "Maya", kind: "who" },
      { text: "." },
    ],
    rows: [
      { label: "Log Pizza · Eating out", cents: -PIZZA, tone: "out" },
      { label: "Your share", cents: YOUR_SHARE },
      { label: "Sai owes you", cents: SAI_SHARE, tone: "owed" },
      { label: "Maya owes you", cents: MAYA_SHARE, tone: "owed" },
    ],
    done: `Logged and split. Sai and Maya each owe you ${cad(SAI_SHARE)}.`,
  },
  {
    id: "coffee",
    chip: "Log a coffee",
    emoji: "☕",
    segments: [
      { text: "Oat latte", kind: "what" },
      { text: " at the campus café, " },
      { text: "$4.85", kind: "amount" },
      { text: "." },
    ],
    rows: [
      { label: "Log Oat latte · Eating out", cents: -485, tone: "out" },
      { label: "Filed like your usual morning coffee" },
    ],
    done: "Logged under Eating out.",
  },
  {
    id: "pay",
    chip: "Add a paycheque",
    emoji: "💵",
    segments: [
      { text: "Got paid " },
      { text: "$612.40", kind: "amount" },
      { text: " from the " },
      { text: "bookstore", kind: "what" },
      { text: "." },
    ],
    rows: [
      { label: "Log Paycheque · Income", cents: 61240, tone: "in" },
      { label: "Rent on Friday is already covered" },
    ],
    done: "Logged. Your safe-to-spend is up to date.",
  },
];

function textOf(example: Example): string {
  return example.segments.map((segment) => segment.text).join("");
}

/** "Just say it": a sentence types itself out, Penny marks what it understood, then proposes. */
export function SayIt() {
  const demoRef = useRef<HTMLDivElement>(null);
  const seen = useSeen(demoRef);
  const still = usePrefersReducedMotion();
  const [index, setIndex] = useState(0);
  const [typed, setTyped] = useState(0);
  const [planFor, setPlanFor] = useState<string | null>(null);
  const [doneFor, setDoneFor] = useState<string | null>(null);

  const example = EXAMPLES[index];
  const full = textOf(example).length;
  const shown = still ? full : typed;
  const parsed = seen && shown >= full;
  const listening = seen && !still && shown < full;
  const planShown = planFor === example.id;
  const done = doneFor === example.id;

  // Type one character at a time once the demo is on screen.
  useEffect(() => {
    if (!seen || still || typed >= full) return;
    const timer = window.setTimeout(() => setTyped((count) => count + 1), typed === 0 ? 500 : 42);
    return () => window.clearTimeout(timer);
  }, [seen, still, typed, full]);

  // A beat after Penny underlines what it heard, the plan arrives.
  useEffect(() => {
    if (!parsed) return;
    const timer = window.setTimeout(() => setPlanFor(example.id), still ? 0 : 1100);
    return () => window.clearTimeout(timer);
  }, [parsed, example.id, still]);

  const choose = (next: number) => {
    setIndex(next);
    setTyped(0);
    setPlanFor(null);
    setDoneFor(null);
  };

  const starts = example.segments.map((_, at) =>
    example.segments.slice(0, at).reduce((sum, segment) => sum + segment.text.length, 0),
  );
  const kinds = Array.from(new Set(example.segments.flatMap((segment) => (segment.kind ? [segment.kind] : []))));

  return (
    <div className={styles.sayGrid}>
      <div>
        <p className={styles.eyebrow}>
          <i />
          01 · Just say it
        </p>
        <h2 className={styles.h2}>
          Tell Penny like you’d tell <em>a friend.</em>
        </h2>
        <p className={styles.body}>
          No forms, no categories, no spreadsheets. Say it or snap the receipt. Penny works out the rest, shows you the
          plan, and waits for your tap.
        </p>
        <ul className={styles.examples} aria-label="Try an example">
          {EXAMPLES.map((item, itemIndex) => (
            <li key={item.id}>
              <button
                type="button"
                className={styles.example}
                aria-pressed={itemIndex === index}
                onClick={() => choose(itemIndex)}
              >
                <span aria-hidden="true">{item.emoji}</span>
                {item.chip}
                <ArrowRight size={18} className={styles.exampleArrow} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div ref={demoRef} className={`${styles.demo} ${parsed ? styles.parsed : ""}`} data-done={done || undefined}>
        <div className={styles.micRow}>
          <span className={styles.mic} data-live={listening || undefined}>
            <Mic size={20} aria-hidden="true" />
          </span>
          <span aria-hidden="true">{listening ? "Listening…" : parsed ? "Got it" : "Ready"}</span>
        </div>

        <p className={styles.quote}>
          <span className="sr-only">You say: {textOf(example)}</span>
          <span aria-hidden="true">
            “
            {example.segments.map((segment, segmentIndex) => {
              const part = segment.text.slice(0, Math.max(0, shown - starts[segmentIndex]));
              if (!part) return null;
              return segment.kind ? (
                <span
                  key={segmentIndex}
                  className={styles.tok}
                  data-kind={segment.kind}
                  style={{ "--delay": `${segmentIndex * 0.1}s` } as CSSProperties}
                >
                  {part}
                </span>
              ) : (
                <span key={segmentIndex}>{part}</span>
              );
            })}
            {parsed ? "”" : <span className={styles.caret} />}
          </span>
        </p>

        <ul className={styles.chips} aria-label="What Penny understood">
          {kinds.map((kind) => (
            <li key={kind} className={styles.chip} data-kind={kind}>
              <i aria-hidden="true" />
              {KIND_LABELS[kind]}
            </li>
          ))}
        </ul>

        <div className={styles.plan} data-show={planShown || undefined} inert={!planShown}>
          <div className={styles.planHead}>
            <Mascot face className="size-9 shrink-0" />
            <div>
              <b>Here’s what I’ll do</b>
              <span>Nothing is saved until you say so.</span>
            </div>
          </div>
          <ul className={styles.planRows}>
            {example.rows.map((row) => (
              <li key={row.label} className={styles.planRow}>
                <span>{row.label}</span>
                {row.cents !== undefined ? (
                  <span className={`${styles.planAmt} ${row.tone ? styles[row.tone] : ""}`}>
                    {cad(row.cents, row.tone === "in" || row.tone === "out")}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
          <div className={styles.planBtns}>
            {done ? (
              <>
                <p className={styles.doneMsg}>✓ {example.done}</p>
                <button type="button" className={styles.ghost} onClick={() => setDoneFor(null)}>
                  Undo
                </button>
              </>
            ) : (
              <>
                <button type="button" className={styles.doIt} onClick={() => setDoneFor(example.id)}>
                  Do it
                </button>
                <button type="button" className={styles.ghost} onClick={() => choose(index)}>
                  Say it again
                </button>
              </>
            )}
          </div>
          <span className={styles.stamp} aria-hidden="true">
            Logged
          </span>
        </div>
        <p className="sr-only" aria-live="polite">
          {done ? example.done : ""}
        </p>
      </div>
    </div>
  );
}
