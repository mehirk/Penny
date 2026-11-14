import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  Camera,
  GraduationCap,
  Lock,
  Mic,
  PiggyBank,
  ShieldCheck,
  Sparkles,
  Users,
  Wallet,
} from "lucide-react";
import { Mascot } from "@/components/penny/mascot";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Penny — your wallet, your coach",
  description:
    "Penny is a money coach for Canadian students and young adults. Snap a receipt or say what you spent, and Penny does the rest.",
};

/**
 * The public front door: what Penny is, and a way in for people who already have an account.
 * Sign-up is closed during the beta, so "Get Penny" explains the invite instead of collecting
 * anything. Every amount shown here is a fixed, fictional example.
 */

const FEATURES = [
  {
    icon: Wallet,
    title: "Safe to spend",
    body: "One number you can trust: your cash after every unpaid bill and budget, with a daily amount until payday.",
    tint: "from-[#19b394] to-[#1fa6b8]",
  },
  {
    icon: Sparkles,
    title: "A coach that knows your numbers",
    body: "Ask “Can I afford a $300 concert trip?” and get an answer worked out from your real month, not a guess.",
    tint: "from-[#4a8fe7] to-[#6d6cf0]",
  },
  {
    icon: Users,
    title: "Splits without the awkward texts",
    body: "Pizza with roommates, rent with friends. Penny works out every share and keeps track of who owes you.",
    tint: "from-[#f5638f] to-[#b66df2]",
  },
  {
    icon: PiggyBank,
    title: "Goals that tell you how",
    body: "A trip, a laptop, a rainy-day fund. See exactly what to set aside each month to hit the date.",
    tint: "from-[#f5b82e] to-[#ff8f6b]",
  },
  {
    icon: GraduationCap,
    title: "Learn by doing",
    body: "Short lessons on budgeting, credit, tax, and TFSAs, plus a practice game with pretend money.",
    tint: "from-[#15977f] to-[#4a8fe7]",
  },
  {
    icon: BadgeCheck,
    title: "Learns your usuals",
    body: "Your regular coffee, your weekly groceries. Penny remembers them and files them your way, in one tap.",
    tint: "from-[#ff8a5b] to-[#f5638f]",
  },
];

const STEPS = [
  { icon: Camera, title: "Snap it", body: "Take a photo of a receipt. Penny reads every line." },
  { icon: Mic, title: "Or say it", body: "“Lunch $16 with Sam, split it.” That’s the whole form." },
  { icon: Sparkles, title: "Tap Do it", body: "Check Penny’s plan. Nothing is saved until you say so." },
];

const PERSONAS = [
  {
    emoji: "🎓",
    title: "Students",
    body: "Make your money last all term: rent, books, and fun included.",
  },
  {
    emoji: "💼",
    title: "Working",
    body: "Make every paycheque go further, from tax and TFSAs to your first credit card.",
  },
  {
    emoji: "🌱",
    title: "Just learning",
    body: "Start with lessons and a practice game before you enter a single dollar.",
  },
];

const TRUST = [
  {
    icon: ShieldCheck,
    title: "The AI never does the maths",
    body: "Every total, share, and limit comes from tested code that works in exact cents. The AI only explains it.",
  },
  {
    icon: BadgeCheck,
    title: "Nothing changes without your tap",
    body: "Penny proposes; you approve. Every change can be undone.",
  },
  {
    icon: Lock,
    title: "No bank connection, ever",
    body: "You tell Penny what you want it to know, and you can delete everything at any time.",
  },
];

function Brand() {
  return (
    <span className="flex items-center gap-2.5">
      <Mascot face className="size-9" />
      <span className="text-lg font-bold tracking-tight text-ink">Penny</span>
    </span>
  );
}

/** A phone showing Penny's snap-or-say flow, built from plain markup so it stays crisp at any size. */
function PhonePreview() {
  return (
    <div className="relative mx-auto w-full max-w-[20rem]">
      <div
        aria-hidden="true"
        className="absolute -inset-8 rounded-full bg-[conic-gradient(from_200deg,#15977f,#356fc4,#8b5cf6,#ef6f6c,#efad3d,#15977f)] opacity-30 blur-3xl"
      />
      <div className="relative rounded-[2.75rem] bg-[#0b1118] p-2.5 ring-1 ring-white/10 shadow-[0_30px_80px_-20px_rgb(15_47_73/0.45)]">
        <div className="overflow-hidden rounded-[2.25rem] bg-canvas">
          <div className="flex items-center justify-between px-6 pb-2 pt-4 text-[11px] font-semibold text-ink">
            <span>9:41</span>
            <span className="h-5 w-20 rounded-full bg-[#0b1118]" />
            <span>100%</span>
          </div>
          <div className="space-y-3 px-4 pb-6 pt-2">
            <div className="rounded-2xl bg-joy p-4 text-white shadow-lg">
              <p className="text-xs font-medium text-white/85">Safe to spend until Friday</p>
              <p className="mt-0.5 text-3xl font-bold tracking-tight">$214.60</p>
              <p className="mt-1 text-xs text-white/85">About $42 a day · rent already counted</p>
            </div>
            <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3.5 py-2.5 text-sm text-on-primary shadow-sm">
              🎙️ “Pizza $36 with Sam and Priya, split 3 ways”
            </div>
            <div className="flex items-start gap-2">
              <Mascot face className="mt-1 size-8 shrink-0" />
              <div className="flex-1 rounded-2xl rounded-tl-sm border border-line bg-surface p-3 shadow-[var(--shadow-card)]">
                <p className="text-sm font-semibold text-ink">Here’s what I’ll do</p>
                <div className="mt-2 flex items-start gap-2.5 rounded-xl bg-sage-soft p-2.5">
                  <span className="text-xl" aria-hidden="true">
                    🍕
                  </span>
                  <div className="text-xs">
                    <p className="font-semibold text-ink">Split Pizza 3 ways</p>
                    <p className="text-ink-muted">You paid $36.00 · your share $12.00</p>
                    <p className="text-ink-muted">Sam and Priya owe you $12.00 each</p>
                  </div>
                </div>
                <div className="mt-2.5 flex h-9 items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-[#15977f] to-[#356fc4] text-sm font-semibold text-white">
                  <Sparkles className="size-4" aria-hidden="true" />
                  Do it
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="absolute inset-x-0 -bottom-5 hidden justify-center sm:flex">
        <span className="animate-bob rounded-2xl border border-line bg-surface px-3 py-2 text-xs font-semibold text-ink shadow-[var(--shadow-raised)]">
          ✅ Filed under Eating out
        </span>
      </div>
      <div
        className="absolute -right-8 top-24 hidden animate-bob rounded-2xl border border-line bg-surface px-3 py-2 text-xs font-semibold text-ink shadow-[var(--shadow-raised)] sm:block"
        style={{ animationDelay: "0.8s" }}
      >
        🎯 Tokyo trip · 62%
      </div>
    </div>
  );
}

export default function WelcomePage() {
  return (
    <div className="relative min-h-dvh overflow-x-clip bg-canvas text-ink">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-0 h-[42rem] bg-[radial-gradient(60rem_30rem_at_20%_-10%,rgb(25_179_148/0.18),transparent),radial-gradient(50rem_30rem_at_90%_0%,rgb(182_125_242/0.18),transparent)]"
      />

      <header className="relative mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
        <Link href="/welcome" aria-label="Penny home" className="rounded-xl">
          <Brand />
        </Link>
        <nav aria-label="Main" className="flex items-center gap-1 sm:gap-2">
          <a href="#how" className={cn(buttonVariants({ variant: "ghost" }), "max-sm:hidden")}>
            How it works
          </a>
          <a href="#features" className={cn(buttonVariants({ variant: "ghost" }), "max-sm:hidden")}>
            Features
          </a>
          <Link href="/login" className={buttonVariants({ variant: "outline" })}>
            Sign in
          </Link>
        </nav>
      </header>

      <main className="relative">
        {/* Hero */}
        <section className="mx-auto grid max-w-6xl items-center gap-14 px-4 pb-20 pt-10 sm:px-6 lg:grid-cols-[1.1fr_1fr] lg:pt-16">
          <div className="animate-enter">
            <p className="inline-flex items-center gap-2 rounded-full border border-line bg-surface/80 px-3 py-1.5 text-xs font-semibold text-ink-muted shadow-sm backdrop-blur">
              <span className="size-2 rounded-full bg-accent" aria-hidden="true" />
              Private beta · made in Canada 🇨🇦
            </p>
            <h1 className="mt-6 text-5xl font-bold leading-[1.02] tracking-tight text-ink sm:text-6xl lg:text-7xl">
              Money that finally <span className="bg-joy bg-clip-text text-transparent">makes sense.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg text-ink-muted sm:text-xl">
              Penny is your wallet and your coach. Snap a receipt or just say what you spent, and Penny files it, splits
              it, and tells you what you can actually afford before payday.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/login"
                className={cn(
                  buttonVariants(),
                  "h-13 gap-2 bg-gradient-to-r from-[#15977f] to-[#356fc4] px-7 text-base text-white shadow-lg hover:brightness-110",
                )}
              >
                Sign in to Penny
                <ArrowRight className="size-5" aria-hidden="true" />
              </Link>
              <a href="#invite" className={cn(buttonVariants({ variant: "outline" }), "h-13 px-7 text-base")}>
                Get Penny
              </a>
            </div>
            <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-ink-subtle">
              <li className="flex items-center gap-1.5">
                <Lock className="size-4 text-accent" aria-hidden="true" />
                No bank connection
              </li>
              <li className="flex items-center gap-1.5">
                <ShieldCheck className="size-4 text-accent" aria-hidden="true" />
                Exact to the cent
              </li>
              <li className="flex items-center gap-1.5">
                <BadgeCheck className="size-4 text-accent" aria-hidden="true" />
                Web and iPhone
              </li>
            </ul>
          </div>
          <PhonePreview />
        </section>

        {/* How it works */}
        <section id="how" className="scroll-mt-6 border-y border-line bg-surface/60 py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <p className="text-sm font-semibold uppercase tracking-wider text-accent-strong">How it works</p>
            <h2 className="mt-2 max-w-2xl text-3xl font-bold tracking-tight sm:text-4xl">Snap it. Say it. Done.</h2>
            <p className="mt-3 max-w-2xl text-ink-muted">
              No forms, no spreadsheets. Tell Penny what happened the way you’d tell a friend.
            </p>
            <ol className="mt-10 grid gap-4 sm:grid-cols-3">
              {STEPS.map(({ icon: Icon, title, body }, index) => (
                <li
                  key={title}
                  className="relative rounded-[var(--radius-card)] border border-line bg-surface p-6 shadow-[var(--shadow-card)]"
                >
                  <span className="absolute right-5 top-4 text-5xl font-bold text-line" aria-hidden="true">
                    {index + 1}
                  </span>
                  <span className="grid size-12 place-items-center rounded-2xl bg-joy text-white shadow-md">
                    <Icon className="size-6" aria-hidden="true" />
                  </span>
                  <h3 className="mt-5 text-lg font-semibold">{title}</h3>
                  <p className="mt-1 text-ink-muted">{body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Features */}
        <section id="features" className="mx-auto max-w-6xl scroll-mt-6 px-4 py-20 sm:px-6">
          <p className="text-sm font-semibold uppercase tracking-wider text-accent-strong">Everything in one place</p>
          <h2 className="mt-2 max-w-2xl text-3xl font-bold tracking-tight sm:text-4xl">
            Not just a tracker. A coach in your pocket.
          </h2>
          <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, body, tint }) => (
              <li
                key={title}
                className="group rounded-[var(--radius-card)] border border-line bg-surface p-6 shadow-[var(--shadow-card)] transition-transform duration-200 hover:-translate-y-1"
              >
                <span
                  className={cn(
                    "grid size-12 place-items-center rounded-2xl bg-gradient-to-br text-white shadow-md",
                    tint,
                  )}
                >
                  <Icon className="size-6" aria-hidden="true" />
                </span>
                <h3 className="mt-5 text-lg font-semibold">{title}</h3>
                <p className="mt-1 text-ink-muted">{body}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* Personas */}
        <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
          <div className="rounded-[2rem] border border-line bg-surface p-6 shadow-[var(--shadow-card)] sm:p-10">
            <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
              <Mascot mood="wow" className="size-20 shrink-0" />
              <div>
                <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Built for where you are</h2>
                <p className="mt-1 text-ink-muted">
                  Pick yours when you start. Penny’s tips, tone, and examples follow.
                </p>
              </div>
            </div>
            <ul className="mt-8 grid gap-4 sm:grid-cols-3">
              {PERSONAS.map(({ emoji, title, body }) => (
                <li key={title} className="rounded-2xl bg-sage-soft p-5">
                  <span className="text-3xl" aria-hidden="true">
                    {emoji}
                  </span>
                  <h3 className="mt-3 font-semibold">{title}</h3>
                  <p className="mt-1 text-sm text-ink-muted">{body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Trust */}
        <section className="bg-hero py-20 text-white">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <p className="text-sm font-semibold uppercase tracking-wider text-[#7fe0c8]">Honest by design</p>
            <h2 className="mt-2 max-w-2xl text-3xl font-bold tracking-tight sm:text-4xl">
              AI that can’t fudge the numbers.
            </h2>
            <ul className="mt-10 grid gap-6 sm:grid-cols-3">
              {TRUST.map(({ icon: Icon, title, body }) => (
                <li key={title} className="rounded-[var(--radius-card)] bg-white/8 p-6 ring-1 ring-white/15">
                  <Icon className="size-7 text-[#7fe0c8]" aria-hidden="true" />
                  <h3 className="mt-4 text-lg font-semibold">{title}</h3>
                  <p className="mt-1 text-white/75">{body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Final call */}
        <section id="invite" className="mx-auto max-w-6xl scroll-mt-6 px-4 py-20 sm:px-6">
          <div className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-[#19b394] via-[#4a8fe7] to-[#b67df2] p-8 text-white shadow-[var(--shadow-raised)] sm:p-14">
            <div aria-hidden="true" className="absolute -right-16 -top-16 size-72 rounded-full bg-white/15 blur-2xl" />
            <div className="relative flex flex-col items-start gap-8 md:flex-row md:items-center md:justify-between">
              <div className="max-w-xl">
                <h2 className="text-3xl font-bold tracking-tight sm:text-5xl">Your money, finally on your side.</h2>
                <p className="mt-4 text-lg text-white/90">
                  Penny is invite-only while we’re in beta. Already invited? Sign in with the email we set up for you.
                </p>
                <Link
                  href="/login"
                  className={cn(
                    buttonVariants(),
                    "mt-8 h-13 gap-2 bg-white px-7 text-base text-[#173f5f] shadow-lg hover:bg-white/90",
                  )}
                >
                  Sign in to Penny
                  <ArrowRight className="size-5" aria-hidden="true" />
                </Link>
              </div>
              <Mascot mood="happy" className="size-40 shrink-0 animate-bob drop-shadow-2xl max-md:hidden" />
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-sm text-ink-subtle sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <Brand />
          <p className="max-w-xl sm:text-right">
            Built for the Cognizant BrAInstorm AI Innovation Challenge 2026. Educational, not financial advice. Every
            person and amount shown is fictional.
          </p>
        </div>
      </footer>
    </div>
  );
}
