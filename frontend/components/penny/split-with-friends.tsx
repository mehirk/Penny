"use client";

import { useState } from "react";
import { ArrowUp, Plus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { type Dashboard, dashboardApi, type SharedPurchaseWrite } from "@/lib/api";
import { parseCadToCents } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { InlineCreate } from "./inline-create";
import { cad } from "./shared";

/** How a total you paid is shared: evenly, by amount, or by percentage. */
type SplitMethod = "equal" | "exact" | "percent";

/**
 * A purchase shared with friends. `payer` is "me" or the friend who paid. `amounts` holds each
 * friend's typed share (dollars or percent) for an uneven split; `groupId` tags the purchase.
 */
export type SharedDraft = {
  on: boolean;
  payer: string;
  friends: string[];
  method: SplitMethod;
  amounts: Record<string, string>;
  groupId: string | null;
};
export const NOT_SHARED: SharedDraft = {
  on: false,
  payer: "me",
  friends: [],
  method: "equal",
  amounts: {},
  groupId: null,
};

const ME = "me";
const METHODS: { value: SplitMethod; label: string }[] = [
  { value: "equal", label: "Equally" },
  { value: "exact", label: "Exact amounts" },
  { value: "percent", label: "Percent" },
];

/** Basis points for a typed percentage ("25" or "12.5"); invalid is null. */
function percentToBasisPoints(value: string): number | null {
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(value.trim().replace(/%$/, ""));
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

/**
 * Each friend's share of a total you paid, and yours (what's left). An even split floors each
 * friend's share to the cent, so the odd cents are yours; percentages floor the same way.
 */
function splitShares(
  draft: SharedDraft,
  totalCents: number,
): { mine: number; shares: Record<string, number> } | { error: string } {
  if (draft.friends.length === 0) return { error: "Pick who you split it with" };
  const shares: Record<string, number> = {};
  if (draft.method === "equal") {
    const each = Math.floor(totalCents / (draft.friends.length + 1));
    if (each <= 0) return { error: "That’s too little to split" };
    draft.friends.forEach((id) => {
      shares[id] = each;
    });
  } else {
    let percentTotal = 0;
    for (const id of draft.friends) {
      const typed = draft.amounts[id] ?? "";
      if (draft.method === "exact") {
        let cents: number;
        try {
          cents = parseCadToCents(typed);
        } catch {
          return { error: "Enter each friend’s share" };
        }
        if (cents <= 0) return { error: "Each friend’s share must be more than $0" };
        shares[id] = cents;
      } else {
        const points = percentToBasisPoints(typed);
        if (points === null || points <= 0) return { error: "Enter each friend’s percentage" };
        percentTotal += points;
        shares[id] = Math.floor((totalCents * points) / 10_000);
        if (shares[id] <= 0) return { error: "A share comes to less than a cent" };
      }
    }
    if (percentTotal > 10_000) return { error: "The percentages add up to more than 100%" };
  }
  const theirs = Object.values(shares).reduce((sum, cents) => sum + cents, 0);
  if (theirs > totalCents) return { error: "Friends’ shares add up to more than the total" };
  return { mine: totalCents - theirs, shares };
}

/**
 * What to save for a shared purchase, or why it can't be saved yet. When a friend paid, the
 * amount entered is your share (what you owe them); when you paid, it's the total.
 */
export function sharedPurchase(
  draft: SharedDraft,
  amountCents: number,
  base: { description: string; category_id: string | null; occurred_on: string; paidFrom: string },
): SharedPurchaseWrite | { error: string } {
  const shared = {
    description: base.description,
    category_id: base.category_id,
    occurred_on: base.occurred_on,
    group_id: draft.groupId,
  };
  if (draft.payer !== ME)
    return draft.payer
      ? { ...shared, paid_from: draft.payer, my_share_cents: amountCents, owed_by: [] }
      : { error: "Add the friend who paid" };
  const split = splitShares(draft, amountCents);
  if ("error" in split) return split;
  return {
    ...shared,
    paid_from: base.paidFrom,
    my_share_cents: split.mine,
    owed_by: Object.entries(split.shares).map(([account_id, amount_cents]) => ({ account_id, amount_cents })),
  };
}

export function SplitWithFriends({
  dashboard,
  draft,
  amountCents,
  onChange,
  onCreate,
  onEnterAmount,
}: {
  dashboard: Dashboard;
  draft: SharedDraft;
  amountCents: number | null;
  onChange: (next: SharedDraft) => void;
  onCreate: InlineCreate;
  onEnterAmount: () => void;
}) {
  const friends = dashboard.accounts.filter((account) => account.account_type === "person");
  const groups = dashboard.splits?.groups ?? [];
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const names = new Map(friends.map((friend) => [friend.id, friend.name]));
  const iPaid = draft.payer === ME;
  const split = amountCents && iPaid ? splitShares(draft, amountCents) : null;

  async function addFriend() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Give your friend a name");
      return;
    }
    const result = await onCreate(() =>
      dashboardApi.createAccount({ name: trimmed, account_type: "person", balance_cents: 0, credit_limit_cents: null }),
    );
    if (typeof result === "string") {
      setError(result);
      return;
    }
    const created = result.accounts.find((account) => account.account_type === "person" && account.name === trimmed);
    if (created)
      onChange(iPaid ? { ...draft, friends: [...draft.friends, created.id] } : { ...draft, payer: created.id });
    setName("");
    setError("");
    setAdding(false);
  }

  function pickGroup(id: string) {
    if (draft.groupId === id) {
      onChange({ ...draft, groupId: null });
      return;
    }
    const members = groups.find((group) => group.id === id)?.member_ids.filter((member) => names.has(member)) ?? [];
    onChange(
      iPaid
        ? { ...draft, groupId: id, friends: members }
        : { ...draft, groupId: id, payer: members.includes(draft.payer) ? draft.payer : (members[0] ?? draft.payer) },
    );
  }

  return (
    <div
      className={cn(
        "rounded-2xl border transition-colors",
        draft.on ? "border-info/40 bg-info-soft/40" : "border-line",
      )}
    >
      <label className="flex min-h-14 cursor-pointer items-center gap-3 px-3">
        <input
          type="checkbox"
          checked={draft.on}
          onChange={(event) => onChange({ ...draft, on: event.target.checked })}
          className="size-5 shrink-0 accent-[var(--color-accent)]"
        />
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 text-sm font-semibold text-ink">
            <Users className="size-4 text-info" aria-hidden="true" />
            Split with friends
          </span>
          <span className="block text-xs text-ink-subtle">
            Only your share counts as spending. Penny keeps track of who owes whom.
          </span>
        </span>
      </label>
      {draft.on && (
        <div className="space-y-3 border-t border-line p-3">
          <div role="radiogroup" aria-label="Who paid?" className="grid grid-cols-2 gap-2">
            {[
              { value: true, label: "I paid" },
              { value: false, label: "A friend paid" },
            ].map((option) => (
              <button
                key={option.label}
                type="button"
                role="radio"
                aria-checked={iPaid === option.value}
                onClick={() => {
                  onChange({ ...draft, payer: option.value ? ME : (friends[0]?.id ?? "") });
                  if (!option.value && friends.length === 0) setAdding(true);
                }}
                className={cn(
                  "min-h-11 rounded-xl border text-sm font-semibold transition-colors",
                  iPaid === option.value
                    ? "border-primary bg-primary-soft text-ink"
                    : "border-line text-ink-muted hover:bg-sage-soft",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>

          {groups.length > 0 && (
            <fieldset>
              <legend className="text-sm font-semibold text-ink">Group</legend>
              <ul className="mt-1 flex flex-wrap gap-2">
                {groups.map((group) => (
                  <li key={group.id}>
                    <button
                      type="button"
                      aria-pressed={draft.groupId === group.id}
                      onClick={() => pickGroup(group.id)}
                      className={cn(
                        "min-h-11 rounded-full border px-3.5 text-sm font-semibold transition-colors",
                        draft.groupId === group.id
                          ? "border-info bg-info-soft text-ink"
                          : "border-line text-ink-muted hover:bg-sage-soft",
                      )}
                    >
                      {group.name}
                    </button>
                  </li>
                ))}
              </ul>
            </fieldset>
          )}

          {iPaid ? (
            <>
              <fieldset>
                <legend className="text-sm font-semibold text-ink">Split with</legend>
                {friends.length === 0 && (
                  <p className="mt-1 text-xs text-ink-subtle">Add the friends you shared it with.</p>
                )}
                <ul className="mt-1 flex flex-wrap gap-2">
                  {friends.map((friend) => {
                    const on = draft.friends.includes(friend.id);
                    return (
                      <li key={friend.id}>
                        <button
                          type="button"
                          aria-pressed={on}
                          onClick={() =>
                            onChange({
                              ...draft,
                              friends: on
                                ? draft.friends.filter((id) => id !== friend.id)
                                : [...draft.friends, friend.id],
                            })
                          }
                          className={cn(
                            "min-h-11 rounded-full border px-3.5 text-sm font-semibold transition-colors",
                            on
                              ? "border-accent bg-accent-soft text-accent-strong"
                              : "border-line text-ink-muted hover:bg-sage-soft",
                          )}
                        >
                          {friend.name}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </fieldset>
              {draft.friends.length > 0 && (
                <div
                  role="radiogroup"
                  aria-label="How to split"
                  className="grid grid-cols-3 gap-1 rounded-xl bg-sage-soft p-1"
                >
                  {METHODS.map((method) => (
                    <button
                      key={method.value}
                      type="button"
                      role="radio"
                      aria-checked={draft.method === method.value}
                      onClick={() => onChange({ ...draft, method: method.value, amounts: {} })}
                      className={cn(
                        "min-h-11 rounded-lg px-1 text-xs font-semibold transition-colors sm:text-sm",
                        draft.method === method.value
                          ? "bg-surface text-ink shadow-sm"
                          : "text-ink-muted hover:text-ink",
                      )}
                    >
                      {method.label}
                    </button>
                  ))}
                </div>
              )}
              {draft.method !== "equal" && draft.friends.length > 0 && (
                <ul className="space-y-2">
                  {draft.friends.map((id) => (
                    <li key={id} className="flex items-center gap-3">
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
                        {names.get(id) ?? "Friend"}
                      </span>
                      <div className="relative w-32">
                        {draft.method === "exact" && (
                          <span
                            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle"
                            aria-hidden="true"
                          >
                            $
                          </span>
                        )}
                        <Input
                          aria-label={`${names.get(id) ?? "Friend"}’s share${draft.method === "percent" ? " in percent" : ""}`}
                          inputMode="decimal"
                          placeholder={draft.method === "exact" ? "0.00" : "0"}
                          value={draft.amounts[id] ?? ""}
                          onChange={(event) =>
                            onChange({ ...draft, amounts: { ...draft.amounts, [id]: event.target.value } })
                          }
                          className={cn(
                            "min-h-11 text-right text-base tabular",
                            draft.method === "exact" ? "pl-7" : "pr-8",
                          )}
                        />
                        {draft.method === "percent" && (
                          <span
                            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-subtle"
                            aria-hidden="true"
                          >
                            %
                          </span>
                        )}
                      </div>
                    </li>
                  ))}
                  <li className="flex items-center gap-3 text-sm text-ink-muted">
                    <span className="flex-1">You</span>
                    <span className="w-32 text-right tabular font-semibold text-ink">
                      {split && !("error" in split) ? cad(split.mine) : "—"}
                    </span>
                  </li>
                </ul>
              )}
            </>
          ) : (
            friends.length > 0 && (
              <label className="block text-sm font-semibold text-ink">
                Who paid?
                <Select
                  value={draft.payer}
                  onChange={(event) => onChange({ ...draft, payer: event.target.value })}
                  className="mt-1.5 min-h-11 text-base font-normal"
                >
                  {friends.map((friend) => (
                    <option key={friend.id} value={friend.id}>
                      {friend.name}
                    </option>
                  ))}
                </Select>
              </label>
            )
          )}

          {adding ? (
            <div className="flex gap-2">
              <Input
                aria-label="Friend’s name"
                placeholder="e.g. Alex"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={60}
                autoFocus
                className="min-h-11 flex-1"
              />
              <Button size="sm" onClick={() => void addFriend()}>
                Add
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setAdding(false);
                  setError("");
                }}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="inline-flex min-h-11 items-center gap-1.5 px-1 text-sm font-semibold text-accent-strong hover:underline"
            >
              <Plus className="size-4" aria-hidden="true" />
              Add a friend
            </button>
          )}
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}

          {/* The amount is typed at the top of the form, often out of view by now: this takes you there. */}
          {!amountCents ? (
            <button
              type="button"
              onClick={onEnterAmount}
              className="flex min-h-11 w-full items-center gap-2 rounded-xl border border-dashed border-line-strong p-3 text-left text-sm text-ink-muted hover:bg-sage-soft hover:text-ink"
            >
              <ArrowUp className="size-4 shrink-0" aria-hidden="true" />
              <span>
                <span className="font-semibold text-ink">
                  {iPaid ? "Enter the total you paid" : "Enter your share"}
                </span>{" "}
                in Amount at the top.{iPaid && draft.friends.length === 0 ? " Then pick who you split it with." : ""}
              </span>
            </button>
          ) : (
            <div className="rounded-xl bg-surface/70 p-3 text-sm text-ink-muted" aria-live="polite">
              {!iPaid ? (
                <>
                  You’ll owe <span className="font-semibold text-ink">{names.get(draft.payer) ?? "them"}</span>{" "}
                  <span className="tabular font-semibold text-ink">{cad(amountCents)}</span>, your share.
                </>
              ) : !split || "error" in split ? (
                split && "error" in split ? (
                  split.error
                ) : (
                  "Pick who you split it with."
                )
              ) : (
                <>
                  Your share is <span className="tabular font-semibold text-ink">{cad(split.mine)}</span>.
                  {draft.friends.map((id) => (
                    <span key={id} className="block">
                      {names.get(id)} owes you{" "}
                      <span className="tabular font-semibold text-ink">{cad(split.shares[id])}</span>
                    </span>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
