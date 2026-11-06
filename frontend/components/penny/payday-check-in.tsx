"use client";

import { useEffect, useState } from "react";
import { CalendarClock, Check, CreditCard, LoaderCircle, PartyPopper, PiggyBank } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isoToday } from "@/components/ui/date-picker";
import { DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { type Dashboard, dashboardApi, type PaydayPlan } from "@/lib/api";
import { formatShortDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { cad, describeError } from "./shared";
import type { SaveChange } from "./settings-view";

type Step = "card" | "save";

/**
 * The payday check-in after money comes in (backend app/domain/payday_plan.py): what's due before
 * the next payday, then suggestions the user acts on one at a time. A windfall (a bonus, a gift,
 * a much bigger paycheque) gets a split of the extra. Every number comes from the API, and
 * nothing changes until the user taps a suggestion.
 */
export function PaydayCheckIn({ dashboard, amountCents, payId, save, onDone }: { dashboard: Dashboard; amountCents: number; payId: string | null; save: SaveChange; onDone: () => void }) {
  const [plan, setPlan] = useState<PaydayPlan | null>(null);
  const [error, setError] = useState("");
  const [done, setDone] = useState<Record<Step, boolean>>({ card: false, save: false });
  const [busy, setBusy] = useState<Step | null>(null);
  const today = dashboard.money_calendar.today ?? isoToday();

  useEffect(() => {
    let active = true;
    dashboardApi.paydayPlan(amountCents, payId)
      .then((data) => { if (active) setPlan(data); })
      .catch((reason) => { if (active) setError(describeError(reason, "Couldn’t load your check-in").detail); });
    return () => { active = false; };
  }, [amountCents, payId]);

  async function act(step: Step, action: () => ReturnType<typeof dashboardApi.load>, success: string) {
    setBusy(step);
    setError("");
    const failed = await save(action, success);
    setBusy(null);
    if (failed) setError(failed); else setDone((current) => ({ ...current, [step]: true }));
  }

  const card = plan?.card ?? null;
  const saving = plan?.save ?? null;
  const goalId = saving?.goal_id ?? null;
  const until = plan ? (plan.next_payday ? `your next payday, ${formatShortDate(plan.next_payday)}` : formatShortDate(plan.until)) : "";
  const title = plan?.windfall ? "Extra money! Here’s a plan" : "Payday check-in";
  const intro = !plan ? "Working out what this money needs to cover…"
    : plan.windfall && plan.usual_cents > 0 ? `${cad(plan.extra_cents)} more than usual came in. Here’s one way to make it count.`
    : plan.windfall ? `${cad(plan.amount_cents)} came in. Here’s one way to make it count.`
    : `${cad(plan.amount_cents)} landed. Here’s what it needs to cover.`;

  return (
    <div className="space-y-4">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{intro}</DialogDescription>
      </DialogHeader>

      {!plan && !error && <p className="flex items-center gap-2 text-sm text-ink-subtle" role="status"><LoaderCircle className="size-4 animate-spin" aria-hidden="true" />Checking your bills and goals…</p>}

      {plan && (
        <>
          <section aria-labelledby="checkin-due" className="rounded-2xl bg-sage-soft p-4">
            <h3 id="checkin-due" className="flex items-center gap-1.5 text-sm font-semibold text-ink"><CalendarClock className="size-4 text-ink-subtle" aria-hidden="true" />Due before {until}</h3>
            {plan.due.length === 0 ? (
              <p className="mt-1 text-sm text-ink-muted">Nothing from chequing or cash. 🎉</p>
            ) : (
              <>
                <ul className="mt-2 space-y-1.5">
                  {plan.due.map((item) => (
                    <li key={`${item.kind}:${item.name}:${item.due_on}`} className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="min-w-0 truncate text-ink">{item.name} <span className="text-ink-subtle">· {formatShortDate(item.due_on)}</span></span>
                      <span className="tabular shrink-0 font-semibold text-ink">{cad(item.amount_cents)}</span>
                    </li>
                  ))}
                </ul>
                <p className={cn("mt-3 flex items-center gap-1.5 border-t border-line pt-2 text-sm font-semibold", plan.short_cents > 0 ? "text-danger" : "text-money-in")}>
                  {plan.short_cents > 0
                    ? `${cad(plan.due_cents)} due, and you’re ${cad(plan.short_cents)} short. Move money in, or check if something can wait.`
                    : <><Check className="size-4" aria-hidden="true" />{cad(plan.due_cents)} due. Chequing and cash cover it.</>}
                </p>
              </>
            )}
          </section>

          <ul className="space-y-2.5" aria-label="Suggestions">
            {card && (
              <Suggestion icon={CreditCard} title={`Pay ${cad(card.amount_cents)} toward ${card.account_name}`} detail={`Card interest costs more than savings earn. Owed now: ${cad(card.owed_cents)}. Pay it in your bank, then record it here.`}>
                <Button size="sm" variant={done.card ? "ghost" : "default"} disabled={done.card || busy !== null} onClick={() => { void act("card", () => dashboardApi.addTransfer({ from_account_id: plan.from_account_id, to_account_id: card.account_id, amount_cents: card.amount_cents, occurred_on: today, note: "Payday check-in" }), `${cad(card.amount_cents)} paid toward ${card.account_name}`); }}>
                  {done.card ? <><Check className="size-4" aria-hidden="true" />Recorded</> : busy === "card" ? "Saving…" : "Record payment"}
                </Button>
              </Suggestion>
            )}
            {saving && (goalId ? (
              <Suggestion icon={PiggyBank} title={`Move ${cad(saving.amount_cents)} into ${saving.goal_name}`} detail={plan.windfall ? `Saved from ${plan.from_account_name}. Putting part of a windfall to work makes it last.` : `About 10% of this paycheque, from ${plan.from_account_name}.`}>
                <Button size="sm" variant={done.save ? "ghost" : "default"} disabled={done.save || busy !== null} onClick={() => { void act("save", () => dashboardApi.contributeToGoal(goalId, saving.amount_cents, plan.from_account_id), `${cad(saving.amount_cents)} moved into ${saving.goal_name}`); }}>
                  {done.save ? <><Check className="size-4" aria-hidden="true" />Moved</> : busy === "save" ? "Moving…" : "Move it"}
                </Button>
              </Suggestion>
            ) : (
              <Suggestion icon={PiggyBank} title={`Set aside ${cad(saving.amount_cents)}`} detail="Start a savings goal in Goals to give it a home." />
            ))}
            {plan.yours_cents > 0 && <Suggestion icon={PartyPopper} title={`${cad(plan.yours_cents)} is yours to enjoy`} detail="Spending some of a windfall is part of the plan." />}
            {!card && !saving && plan.yours_cents === 0 && plan.short_cents === 0 && (
              <li className="rounded-2xl border border-line p-3 text-sm text-ink-muted">Nothing else to do. Everything due is covered.</li>
            )}
          </ul>

          <details className="text-xs text-ink-subtle">
            <summary className="flex min-h-11 cursor-pointer items-center font-semibold">How Penny worked this out</summary>
            <p className="pb-1">{plan.methodology}</p>
          </details>
        </>
      )}

      {error && <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      <Button className="min-h-11 w-full" variant={card || goalId ? "outline" : "default"} onClick={onDone}>Done</Button>
    </div>
  );
}

function Suggestion({ icon: Icon, title, detail, children }: { icon: typeof PiggyBank; title: string; detail: string; children?: React.ReactNode }) {
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-2xl border border-line p-3 animate-enter">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent-strong" aria-hidden="true"><Icon className="size-5" /></span>
      <div className="min-w-0 flex-1 basis-40">
        <p className="tabular text-sm font-semibold text-ink">{title}</p>
        <p className="text-xs text-ink-subtle">{detail}</p>
      </div>
      {children && <div className="w-full shrink-0 sm:w-auto [&>button]:min-h-11 [&>button]:w-full">{children}</div>}
    </li>
  );
}
