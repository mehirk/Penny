import type { Metadata } from "next";
import Link from "next/link";
import { Instrument_Serif, Inter, JetBrains_Mono } from "next/font/google";
import { ArrowRight } from "lucide-react";
import { ChaosLedger } from "@/components/welcome/chaos-ledger";
import { Coin } from "@/components/welcome/coin";
import { Receipt } from "@/components/welcome/receipt";
import { SayIt } from "@/components/welcome/say-it";
import styles from "@/components/welcome/welcome.module.css";

export const metadata: Metadata = {
  title: "Penny — money that finally makes sense",
  description:
    "Penny is a money coach for Canadian students and young adults. Snap a receipt or say what you spent, and Penny does the rest.",
};

// Self-hosted at build time, so the page needs no font requests to anyone else.
const serif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--w-serif",
});
const sans = Inter({ subsets: ["latin"], variable: "--w-sans" });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "600", "700", "800"], variable: "--w-mono" });

/**
 * The public front door. Sign-up is closed during the beta, so the only way in is "Sign in".
 * Every person and amount on this page is fictional.
 */

const MARQUEE = [
  "Rent",
  "Tuition",
  "First paycheque",
  "Co-op offer",
  "Pizza splits",
  "Subscriptions you forgot",
  "Your first credit card",
  "TFSA",
  "Textbooks",
  "Payday",
];

const PROMISES = [
  {
    title: "The AI never does the maths.",
    body: "Every total, share, and limit comes from tested code that works in exact cents. The AI only explains the answer.",
  },
  {
    title: "Nothing changes without your tap.",
    body: "Penny proposes, you approve. Every change shows you the plan first, and every change can be undone.",
  },
  {
    title: "No bank connection. Ever.",
    body: "You tell Penny what you want it to know, and you can delete all of it at any time.",
  },
];

const PERSONAS = [
  { title: "Students", accent: "make it last.", body: "Rent, books, and fun, all the way to the end of term." },
  { title: "Working", accent: "go further.", body: "Every paycheque, from tax and TFSAs to your first credit card." },
  {
    title: "Just learning",
    accent: "start safe.",
    body: "Short lessons and a practice game with pretend money, before you enter a single dollar.",
  },
];

export default function WelcomePage() {
  return (
    <div className={`${styles.page} ${serif.variable} ${sans.variable} ${mono.variable}`}>
      <header className={styles.header}>
        <Link href="/welcome" className={styles.brand} aria-label="Penny home">
          <span className={styles.brandCoin} aria-hidden="true" />
          Penny
        </Link>
        <nav aria-label="Main" className={styles.nav}>
          <a href="#say" className={styles.navLink}>
            How it works
          </a>
          <a href="#honest" className={styles.navLink}>
            Why trust it
          </a>
          <Link href="/login" className={styles.btnInk}>
            Sign in
          </Link>
        </nav>
      </header>

      <main>
        <ChaosLedger />

        <div className={styles.marquee} aria-hidden="true">
          <div className={styles.marqueeTrack}>
            {[...MARQUEE, ...MARQUEE].map((word, index) => (
              <span key={`${word}-${index}`}>
                {word} <span className={styles.dot}>✦</span>
              </span>
            ))}
          </div>
        </div>

        <section id="say" className={styles.section} aria-label="Just say it">
          <div className={styles.wrap}>
            <SayIt />
          </div>
        </section>

        <section className={`${styles.section} ${styles.askSection}`} aria-labelledby="ask-title">
          <div className={`${styles.wrap} ${styles.askGrid}`}>
            <div className={styles.askCopy}>
              <p className={styles.eyebrow}>
                <i />
                02 · Ask the big stuff
              </p>
              <h2 id="ask-title" className={styles.h2}>
                The honest answer, <em>itemized.</em>
              </h2>
              <p className={styles.question}>Can I afford a trip to the Maldives?</p>
              <p className={styles.body}>
                Penny puts a small team of agents on the question, prices every line, checks your savings, and tells you
                the truth, even when the truth is “not yet”. Then it tells you exactly how to get there, and the things
                you never thought to ask.
              </p>
              <ul className={styles.agents} aria-label="The team on this question">
                {[
                  ["Planner", "#9b6cf0"],
                  ["Cash flow", "#19b394"],
                  ["Analyst", "#4a8fe7"],
                  ["Travel scout", "#e39a2d"],
                ].map(([name, color]) => (
                  <li key={name} className={styles.agent}>
                    <i style={{ background: color }} aria-hidden="true" />
                    {name}
                  </li>
                ))}
              </ul>
            </div>
            <Receipt />
          </div>
        </section>

        <section id="honest" className={`${styles.section} ${styles.night}`} aria-labelledby="honest-title">
          <div className={styles.wrap}>
            <p className={styles.eyebrow}>
              <i />
              03 · Honest by design
            </p>
            <h2 id="honest-title" className={styles.h2}>
              AI that can’t <em>fudge the numbers.</em>
            </h2>
            <p className={styles.mathLabel}>How a computer adds money, left to itself</p>
            <p className={styles.mathBad}>
              <span className="sr-only">Crossed out: </span>0.1 + 0.2 = 0.30000000000000004
            </p>
            <p className={styles.mathLabel}>How Penny adds it</p>
            <p className={styles.mathGood}>10¢ + 20¢ = 30¢</p>
            <ol className={styles.promises}>
              {PROMISES.map((promise, index) => (
                <li key={promise.title} className={styles.promise}>
                  <span className={styles.pNum} aria-hidden="true">
                    0{index + 1}
                  </span>
                  <h3 className={styles.pTitle}>{promise.title}</h3>
                  <p className={styles.pBody}>{promise.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className={styles.section} aria-labelledby="who-title">
          <div className={styles.wrap}>
            <p className={styles.eyebrow}>
              <i />
              04 · Built for where you are
            </p>
            <h2 id="who-title" className={styles.h2}>
              Pick yours. <em>Penny follows.</em>
            </h2>
            <ul className={styles.menu}>
              {PERSONAS.map((persona) => (
                <li key={persona.title} className={styles.menuItem}>
                  <h3 className={styles.menuTitle}>
                    {persona.title}, <em>{persona.accent}</em>
                  </h3>
                  <p className={styles.menuBody}>{persona.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className={`${styles.section} ${styles.finale}`} aria-labelledby="finale-title">
          <Coin />
          <h2 id="finale-title" className={styles.finaleH}>
            Your money, finally <em>on your side.</em>
          </h2>
          <p className={styles.finaleNote}>
            Penny is invite-only while we’re in beta. Already invited? Sign in with the email we set up for you.
          </p>
          <div className={styles.ctaRow}>
            <Link href="/login" className={`${styles.btnInk} ${styles.btnBig}`}>
              Sign in to Penny
              <ArrowRight size={20} aria-hidden="true" />
            </Link>
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <Link href="/welcome" className={styles.brand} aria-label="Penny home">
          <span className={styles.brandCoin} aria-hidden="true" />
          Penny
        </Link>
        <p>
          Built for the Cognizant BrAInstorm AI Innovation Challenge 2026. Educational, not financial advice. Every
          person and amount shown is fictional.
        </p>
      </footer>
    </div>
  );
}
