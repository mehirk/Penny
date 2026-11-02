"use client";

import { useState } from "react";
import { Plus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { type Dashboard, dashboardApi, type SharedPurchaseWrite } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { InlineCreate } from "./inline-create";
import { cad } from "./shared";

/** A purchase shared with friends, like Splitwise. `payer` is "me" or the friend who paid. */
export type SharedDraft = { on: boolean; payer: string; friends: string[] };
export const NOT_SHARED: SharedDraft = { on: false, payer: "me", friends: [] };

const ME = "me";

/** An even split: each friend's share, floored to the cent, and the rest (the odd cents) is yours. */
function evenShares(totalCents: number, friends: number): { mine: number; each: number } {
  const each = Math.floor(totalCents / (friends + 1));
  return { mine: totalCents - each * friends, each };
}

/**
 * What to save for a shared purchase, or why it can't be saved yet. When a friend paid, the
 * amount entered is your share (what you owe them); when you paid, it's the total, split evenly.
 */
export function sharedPurchase(draft: SharedDraft, amountCents: number, base: { description: string; category_id: string | null; occurred_on: string; paidFrom: string }): SharedPurchaseWrite | { error: string } {
  const shared = { description: base.description, category_id: base.category_id, occurred_on: base.occurred_on };
  const { paidFrom } = base;
  if (draft.payer !== ME) return draft.payer ? { ...shared, paid_from: draft.payer, my_share_cents: amountCents, owed_by: [] } : { error: "Add the friend who paid" };
  if (draft.friends.length === 0) return { error: "Pick who you split it with" };
  const { mine, each } = evenShares(amountCents, draft.friends.length);
  if (each <= 0) return { error: "That’s too little to split" };
  return { ...shared, paid_from: paidFrom, my_share_cents: mine, owed_by: draft.friends.map((id) => ({ account_id: id, amount_cents: each })) };
}

export function SplitWithFriends({ dashboard, draft, amountCents, onChange, onCreate }: { dashboard: Dashboard; draft: SharedDraft; amountCents: number | null; onChange: (next: SharedDraft) => void; onCreate: InlineCreate }) {
  const friends = dashboard.accounts.filter((account) => account.account_type === "person");
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const names = new Map(friends.map((friend) => [friend.id, friend.name]));
  const iPaid = draft.payer === ME;
  const split = amountCents && iPaid && draft.friends.length ? evenShares(amountCents, draft.friends.length) : null;

  async function addFriend() {
    const trimmed = name.trim();
    if (!trimmed) { setError("Give your friend a name"); return; }
    const result = await onCreate(() => dashboardApi.createAccount({ name: trimmed, account_type: "person", balance_cents: 0, credit_limit_cents: null }));
    if (typeof result === "string") { setError(result); return; }
    const created = result.accounts.find((account) => account.account_type === "person" && account.name === trimmed);
    if (created) onChange(iPaid ? { ...draft, friends: [...draft.friends, created.id] } : { ...draft, payer: created.id });
    setName("");
    setError("");
    setAdding(false);
  }

  return (
    <div className={cn("rounded-2xl border transition-colors", draft.on ? "border-info/40 bg-info-soft/40" : "border-line")}>
      <label className="flex min-h-14 cursor-pointer items-center gap-3 px-3">
        <input type="checkbox" checked={draft.on} onChange={(event) => onChange({ ...draft, on: event.target.checked })} className="size-5 shrink-0 accent-[var(--color-accent)]" />
        <span className="min-w-0"><span className="flex items-center gap-1.5 text-sm font-semibold text-ink"><Users className="size-4 text-info" aria-hidden="true" />Split with friends</span><span className="block text-xs text-ink-subtle">Only your share counts as spending. Penny keeps track of who owes whom.</span></span>
      </label>
      {draft.on && (
        <div className="space-y-3 border-t border-line p-3">
          <div role="radiogroup" aria-label="Who paid?" className="grid grid-cols-2 gap-2">
            {[{ value: true, label: "I paid" }, { value: false, label: "A friend paid" }].map((option) => (
              <button key={option.label} type="button" role="radio" aria-checked={iPaid === option.value} onClick={() => { onChange({ ...draft, payer: option.value ? ME : friends[0]?.id ?? "" }); if (!option.value && friends.length === 0) setAdding(true); }} className={cn("min-h-11 rounded-xl border text-sm font-semibold transition-colors", iPaid === option.value ? "border-primary bg-primary-soft text-ink" : "border-line text-ink-muted hover:bg-sage-soft")}>
                {option.label}
              </button>
            ))}
          </div>

          {iPaid ? (
            <fieldset>
              <legend className="text-sm font-semibold text-ink">Split evenly with</legend>
              {friends.length === 0 && <p className="mt-1 text-xs text-ink-subtle">Add the friends you shared it with.</p>}
              <ul className="mt-1 flex flex-wrap gap-2">
                {friends.map((friend) => {
                  const on = draft.friends.includes(friend.id);
                  return (
                    <li key={friend.id}>
                      <button type="button" aria-pressed={on} onClick={() => onChange({ ...draft, friends: on ? draft.friends.filter((id) => id !== friend.id) : [...draft.friends, friend.id] })} className={cn("min-h-11 rounded-full border px-3.5 text-sm font-semibold transition-colors", on ? "border-accent bg-accent-soft text-accent-strong" : "border-line text-ink-muted hover:bg-sage-soft")}>
                        {friend.name}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </fieldset>
          ) : friends.length > 0 && (
            <label className="block text-sm font-semibold text-ink">Who paid?
              <Select value={draft.payer} onChange={(event) => onChange({ ...draft, payer: event.target.value })} className="mt-1.5 min-h-11 text-base font-normal">
                {friends.map((friend) => <option key={friend.id} value={friend.id}>{friend.name}</option>)}
              </Select>
            </label>
          )}

          {adding ? (
            <div className="flex gap-2">
              <Input aria-label="Friend’s name" placeholder="e.g. Alex" value={name} onChange={(event) => setName(event.target.value)} maxLength={60} autoFocus className="min-h-11 flex-1" />
              <Button size="sm" onClick={() => void addFriend()}>Add</Button>
              <Button size="sm" variant="ghost" onClick={() => { setAdding(false); setError(""); }}>Cancel</Button>
            </div>
          ) : (
            <button type="button" onClick={() => setAdding(true)} className="inline-flex min-h-11 items-center gap-1.5 px-1 text-sm font-semibold text-accent-strong hover:underline"><Plus className="size-4" aria-hidden="true" />Add a friend</button>
          )}
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}

          <p className="rounded-xl bg-surface/70 p-3 text-sm text-ink-muted" aria-live="polite">
            {!iPaid
              ? <>The amount above is your share. You’ll owe <span className="font-semibold text-ink">{names.get(draft.payer) ?? "them"}</span>{amountCents ? <> <span className="tabular font-semibold text-ink">{cad(amountCents)}</span></> : ""}.</>
              : split
                ? <>Your share is <span className="tabular font-semibold text-ink">{cad(split.mine)}</span>. {draft.friends.map((id) => names.get(id)).join(", ")} {draft.friends.length === 1 ? "owes" : "each owe"} you <span className="tabular font-semibold text-ink">{cad(split.each)}</span>.</>
                : "Enter the total you paid, then pick who you split it with."}
          </p>
        </div>
      )}
    </div>
  );
}
