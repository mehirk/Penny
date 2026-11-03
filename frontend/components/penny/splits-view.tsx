"use client";

import { type FormEvent, useState } from "react";
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Pencil, Plus, Receipt, Trash2, UserPlus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { type Dashboard, dashboardApi, type SplitActivity, type SplitFriend, type SplitGroup, type SplitsOverview } from "@/lib/api";
import { formatShortDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { BackBar } from "./back-bar";
import { FormError } from "./form-parts";
import { settleUp } from "./labels";
import type { SaveChange } from "./settings-view";
import { cad, EmptyState, Field } from "./shared";
import { NOT_SHARED, type SharedDraft } from "./split-with-friends";
import { useTransfers } from "./transfer-dialog";

const NOTHING: SplitsOverview = { owed_to_you_cents: 0, you_owe_cents: 0, net_cents: 0, friends: [], groups: [], activity: [] };
type Tab = "friends" | "groups" | "activity";

/** A friend's balance in words, coloured: green when they owe you, red when you owe them. */
function Owed({ cents, className }: { cents: number; className?: string }) {
  if (cents > 0) return <span className={cn("text-money-in", className)}>owes you <span className="tabular font-semibold">{cad(cents)}</span></span>;
  if (cents < 0) return <span className={cn("text-danger", className)}>you owe <span className="tabular font-semibold">{cad(-cents)}</span></span>;
  return <span className={cn("text-ink-subtle", className)}>settled up</span>;
}

/** The net across every friend as a signed, coloured amount ("$66.00", "−$12.00"). */
export function splitsNet(cents: number): { text: string; tone: string } {
  if (cents > 0) return { text: cad(cents), tone: "text-money-in" };
  if (cents < 0) return { text: `−${cad(-cents)}`, tone: "text-danger" };
  return { text: cad(0), tone: "text-ink" };
}

const Initial = ({ name, className }: { name: string; className?: string }) => (
  <span className={cn("grid size-10 shrink-0 place-items-center rounded-full bg-info-soft text-sm font-semibold text-ink", className)} aria-hidden="true">{name.trim().charAt(0).toUpperCase() || "?"}</span>
);

/**
 * Splits, a Home page like an account's: costs shared with friends. The overall figure, then friends (who owes whom, settle
 * up), groups (people you often split with), and everything that changed, newest first. Every
 * figure comes from the API; adding an expense opens the usual transaction form, already split.
 */
export function SplitsView({ dashboard, save, onAddExpense, onBack }: { dashboard: Dashboard; save: SaveChange; onAddExpense: (share: SharedDraft) => void; onBack: () => void }) {
  const splits = dashboard.splits ?? NOTHING;
  const [tab, setTab] = useState<Tab>("friends");
  const [friendId, setFriendId] = useState<string | null>(null);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [editing, setEditing] = useState<SplitGroup | "new" | null>(null);
  const [addingFriend, setAddingFriend] = useState(false);
  const transfers = useTransfers();
  const groupNames = new Map(splits.groups.map((group) => [group.id, group.name]));
  const friend = splits.friends.find((item) => item.account_id === friendId) ?? null;
  const group = splits.groups.find((item) => item.id === groupId) ?? null;
  const expense = (friends: string[], group: string | null = null) => onAddExpense({ ...NOT_SHARED, on: true, friends, groupId: group });
  const settle = (item: SplitFriend) => transfers?.openTransfer(settleUp(dashboard.accounts, item.account_id, item.balance_cents));
  const net = splitsNet(splits.net_cents);
  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: "friends", label: "Friends", count: splits.friends.length },
    { id: "groups", label: "Groups", count: splits.groups.length },
    { id: "activity", label: "Activity" },
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <BackBar label="Home" onBack={onBack} />
      <div className="pt-1 text-center">
        <h2 className="text-lg font-semibold text-ink">Splits</h2>
        <p className="text-sm text-ink-subtle">Costs shared with friends: who owes whom, groups, and settling up.</p>
      </div>
      <section aria-labelledby="splits-total" className="rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-[var(--shadow-card)] sm:p-6">
        <p id="splits-total" className="text-sm text-ink-subtle">{splits.net_cents > 0 ? "Overall, you’re owed" : splits.net_cents < 0 ? "Overall, you owe" : "Overall"}</p>
        <p className={cn("tabular mt-1 text-4xl font-semibold tracking-tight", net.tone)}>{splits.net_cents === 0 && splits.friends.length > 0 ? "All settled up" : net.text}</p>
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-2xl bg-money-in-soft p-3"><dt className="text-ink-muted">Owed to you</dt><dd className="tabular mt-0.5 text-lg font-semibold text-money-in">{cad(splits.owed_to_you_cents)}</dd></div>
          <div className="rounded-2xl bg-danger-soft p-3"><dt className="text-ink-muted">You owe</dt><dd className="tabular mt-0.5 text-lg font-semibold text-danger">{cad(splits.you_owe_cents)}</dd></div>
        </dl>
        <div className="mt-4 grid grid-cols-3 gap-2">
          <Button onClick={() => expense([])}><Receipt className="size-4" aria-hidden="true" />Add expense</Button>
          <Button variant="outline" onClick={() => setEditing("new")}><Users className="size-4" aria-hidden="true" />New group</Button>
          <Button variant="outline" onClick={() => setAddingFriend(true)}><UserPlus className="size-4" aria-hidden="true" />Add friend</Button>
        </div>
      </section>

      <div role="tablist" aria-label="Splits" className="grid grid-cols-3 gap-1 rounded-2xl bg-sage-soft p-1">
        {tabs.map((item) => (
          <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} onClick={() => setTab(item.id)} className={cn("min-h-11 rounded-xl text-sm font-semibold transition-colors", tab === item.id ? "bg-surface text-ink shadow-sm" : "text-ink-muted hover:text-ink")}>
            {item.label}{item.count !== undefined && <span className="ml-1.5 text-xs text-ink-subtle">{item.count}</span>}
          </button>
        ))}
      </div>

      {tab === "friends" && (splits.friends.length === 0
        ? <Card className="p-5"><EmptyState icon={Users} title="No friends yet" description="Add the people you share costs with. When you split a purchase, only your share counts as spending, and Penny keeps track of who owes whom." action={<Button size="sm" onClick={() => setAddingFriend(true)}>Add a friend</Button>} /></Card>
        : (
          <Card className="divide-y divide-line p-0">
            {splits.friends.map((item) => (
              <div key={item.account_id} className="flex items-center gap-3 px-4 py-3">
                <button type="button" onClick={() => setFriendId(item.account_id)} className="flex min-h-11 min-w-0 flex-1 items-center gap-3 text-left">
                  <Initial name={item.name} />
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-ink">{item.name}</span>
                    <span className="block text-sm"><Owed cents={item.balance_cents} />{item.last_activity_on && <span className="text-ink-subtle"> · {formatShortDate(item.last_activity_on)}</span>}</span>
                  </span>
                </button>
                {transfers && item.balance_cents !== 0 && <Button size="sm" variant="outline" onClick={() => settle(item)}>Settle up</Button>}
              </div>
            ))}
          </Card>
        ))}

      {tab === "groups" && (splits.groups.length === 0
        ? <Card className="p-5"><EmptyState icon={Users} title="No groups yet" description="Make a group for roommates, a trip, or a team, and split with everyone in one tap." action={<Button size="sm" onClick={() => setEditing("new")}>New group</Button>} /></Card>
        : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {splits.groups.map((item) => (
              <li key={item.id}>
                <Card className="flex h-full flex-col p-4">
                  <button type="button" onClick={() => setGroupId(item.id)} className="min-h-11 text-left">
                    <span className="block text-lg font-semibold text-ink">{item.name}</span>
                    <span className="block text-sm text-ink-subtle">{item.member_ids.length} {item.member_ids.length === 1 ? "friend" : "friends"} · {item.expense_count} {item.expense_count === 1 ? "expense" : "expenses"} · <span className="tabular">{cad(item.spent_cents)}</span></span>
                  </button>
                  <p className="mt-2 line-clamp-2 text-sm text-ink-muted">{memberNames(item, splits).join(", ")}</p>
                  <div className="mt-auto flex gap-2 pt-3">
                    <Button size="sm" className="flex-1" onClick={() => expense(item.member_ids, item.id)}><Plus className="size-4" aria-hidden="true" />Add expense</Button>
                    <Button size="sm" variant="outline" aria-label={`Edit ${item.name}`} onClick={() => setEditing(item)}><Pencil className="size-4" aria-hidden="true" /></Button>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        ))}

      {tab === "activity" && (splits.activity.length === 0
        ? <Card className="p-5"><EmptyState icon={Receipt} title="Nothing split yet" description="Purchases you split and payments between you and friends show here." /></Card>
        : <Card className="p-0"><ActivityList items={splits.activity} groupNames={groupNames} /></Card>)}

      <FriendSheet friend={friend} splits={splits} groupNames={groupNames} onClose={() => setFriendId(null)} onSettle={transfers ? settle : undefined} onAddExpense={(id) => { setFriendId(null); expense([id]); }} />
      <GroupSheet group={group} splits={splits} groupNames={groupNames} onClose={() => setGroupId(null)} onAddExpense={(item) => { setGroupId(null); expense(item.member_ids, item.id); }} onEdit={(item) => { setGroupId(null); setEditing(item); }} />
      <GroupDialog target={editing} dashboard={dashboard} save={save} onClose={() => setEditing(null)} />
      <AddFriendDialog open={addingFriend} save={save} onClose={() => setAddingFriend(false)} />
    </div>
  );
}

function memberNames(group: SplitGroup, splits: SplitsOverview): string[] {
  const names = new Map(splits.friends.map((friend) => [friend.account_id, friend.name]));
  return group.member_ids.map((id) => names.get(id)).filter((name): name is string => Boolean(name));
}

const ACTIVITY: Record<SplitActivity["kind"], { icon: typeof ArrowUpRight; title: (item: SplitActivity) => string; detail: (item: SplitActivity) => string; tone: string }> = {
  lent: { icon: ArrowUpRight, title: (item) => item.description, detail: (item) => `You paid · ${item.friend_name} owes you`, tone: "text-money-in" },
  borrowed: { icon: ArrowDownLeft, title: (item) => item.description, detail: (item) => `${item.friend_name} paid · you owe`, tone: "text-danger" },
  paid_back: { icon: ArrowLeftRight, title: (item) => `${item.friend_name} paid you back`, detail: () => "Settled", tone: "text-ink" },
  you_paid_back: { icon: ArrowLeftRight, title: (item) => `You paid ${item.friend_name} back`, detail: () => "Settled", tone: "text-ink" },
};

function ActivityList({ items, groupNames }: { items: SplitActivity[]; groupNames: Map<string, string> }) {
  return (
    <ul className="divide-y divide-line">
      {items.map((item) => {
        const style = ACTIVITY[item.kind];
        const Icon = style.icon;
        return (
          <li key={item.id} className="flex min-h-16 items-center gap-3 px-4 py-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-sage" aria-hidden="true"><Icon className="size-4 text-ink-muted" /></span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-ink">{style.title(item)}</span>
              <span className="block truncate text-xs text-ink-subtle">{style.detail(item)} · {formatShortDate(item.occurred_on)}{item.group_id && groupNames.get(item.group_id) ? ` · ${groupNames.get(item.group_id)}` : ""}</span>
            </span>
            <span className={cn("tabular shrink-0 text-sm font-semibold", style.tone)}>{cad(item.amount_cents)}</span>
          </li>
        );
      })}
    </ul>
  );
}

function FriendSheet({ friend, splits, groupNames, onClose, onSettle, onAddExpense }: { friend: SplitFriend | null; splits: SplitsOverview; groupNames: Map<string, string>; onClose: () => void; onSettle?: (friend: SplitFriend) => void; onAddExpense: (id: string) => void }) {
  const items = friend ? splits.activity.filter((item) => item.friend_id === friend.account_id) : [];
  return (
    <Dialog open={friend !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        {friend && (
          <>
            <DialogHeader>
              <DialogTitle>{friend.name}</DialogTitle>
              <DialogDescription>Settling up is a transfer, not spending: your share already counted.</DialogDescription>
            </DialogHeader>
            <div className="flex items-center gap-3 rounded-2xl bg-sage-soft p-4">
              <Initial name={friend.name} className="size-12 text-base" />
              <p className="text-lg first-letter:uppercase"><Owed cents={friend.balance_cents} /></p>
            </div>
            <div className="flex gap-2">
              <Button className="flex-1" onClick={() => onAddExpense(friend.account_id)}><Plus className="size-4" aria-hidden="true" />Add expense</Button>
              {onSettle && friend.balance_cents !== 0 && <Button variant="outline" className="flex-1" onClick={() => { onClose(); onSettle(friend); }}><ArrowLeftRight className="size-4" aria-hidden="true" />Settle up</Button>}
            </div>
            {items.length > 0
              ? <div className="-mx-1 max-h-80 overflow-y-auto rounded-2xl border border-line"><ActivityList items={items} groupNames={groupNames} /></div>
              : <p className="text-sm text-ink-subtle">Nothing split with {friend.name} yet.</p>}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function GroupSheet({ group, splits, groupNames, onClose, onAddExpense, onEdit }: { group: SplitGroup | null; splits: SplitsOverview; groupNames: Map<string, string>; onClose: () => void; onAddExpense: (group: SplitGroup) => void; onEdit: (group: SplitGroup) => void }) {
  const members = group ? splits.friends.filter((friend) => group.member_ids.includes(friend.account_id)) : [];
  const items = group ? splits.activity.filter((item) => item.group_id === group.id) : [];
  return (
    <Dialog open={group !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        {group && (
          <>
            <DialogHeader>
              <DialogTitle>{group.name}</DialogTitle>
              <DialogDescription>{group.expense_count} {group.expense_count === 1 ? "expense" : "expenses"} · <span className="tabular">{cad(group.spent_cents)}</span> in all. Balances are each friend’s overall total.</DialogDescription>
            </DialogHeader>
            <ul className="divide-y divide-line rounded-2xl border border-line">
              {members.map((friend) => (
                <li key={friend.account_id} className="flex min-h-14 items-center gap-3 px-3 py-2">
                  <Initial name={friend.name} className="size-9" />
                  <span className="min-w-0 flex-1 truncate font-semibold text-ink">{friend.name}</span>
                  <span className="text-sm"><Owed cents={friend.balance_cents} /></span>
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <Button className="flex-1" onClick={() => onAddExpense(group)}><Plus className="size-4" aria-hidden="true" />Add expense</Button>
              <Button variant="outline" onClick={() => onEdit(group)}><Pencil className="size-4" aria-hidden="true" />Edit group</Button>
            </div>
            {items.length > 0 && <div className="-mx-1 max-h-72 overflow-y-auto rounded-2xl border border-line"><ActivityList items={items} groupNames={groupNames} /></div>}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Make or change a group: a name and who's in it. New friends can be added from here. */
function GroupDialog({ target, dashboard, save, onClose }: { target: SplitGroup | "new" | null; dashboard: Dashboard; save: SaveChange; onClose: () => void }) {
  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{target === "new" ? "New group" : "Edit group"}</DialogTitle>
          <DialogDescription>Pick everyone you split with often. Each friend’s balance stays their own.</DialogDescription>
        </DialogHeader>
        {target !== null && <GroupForm key={target === "new" ? "new" : target.id} group={target === "new" ? null : target} dashboard={dashboard} save={save} onDone={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function GroupForm({ group, dashboard, save, onDone }: { group: SplitGroup | null; dashboard: Dashboard; save: SaveChange; onDone: () => void }) {
  const friends = dashboard.accounts.filter((account) => account.account_type === "person");
  const [name, setName] = useState(group?.name ?? "");
  const [members, setMembers] = useState<string[]>(group?.member_ids ?? []);
  const [newFriend, setNewFriend] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const month = dashboard.active_month;

  async function addFriend() {
    const trimmed = newFriend.trim();
    if (!trimmed) return;
    setBusy(true);
    let created: string | undefined;
    const failed = await save(async () => {
      const data = await dashboardApi.createAccount({ name: trimmed, account_type: "person", balance_cents: 0, credit_limit_cents: null });
      created = data.accounts.find((account) => account.account_type === "person" && account.name === trimmed && !friends.some((friend) => friend.id === account.id))?.id;
      return data;
    }, `${trimmed} added`);
    setBusy(false);
    if (failed) { setError(failed); return; }
    if (created) setMembers((list) => [...list, created!]);
    setNewFriend("");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) { setError("Give the group a name"); return; }
    if (members.length === 0) { setError("Pick at least one friend"); return; }
    setBusy(true);
    const body = { name: name.trim(), member_ids: members };
    const failed = await save(() => (group ? dashboardApi.updateSplitGroup(group.id, body, month) : dashboardApi.createSplitGroup(body, month)), group ? "Group updated" : `${body.name} created`);
    setBusy(false);
    if (failed) setError(failed); else onDone();
  }

  async function remove() {
    if (!group) return;
    setBusy(true);
    const failed = await save(() => dashboardApi.deleteSplitGroup(group.id, month), `${group.name} removed`);
    setBusy(false);
    if (failed) setError(failed); else onDone();
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Group name">{(props) => <Input {...props} value={name} onChange={(event) => setName(event.target.value)} maxLength={60} placeholder="e.g. Roommates" className="min-h-11 text-base" />}</Field>
      <fieldset>
        <legend className="text-sm font-semibold text-ink">Who’s in it</legend>
        {friends.length === 0 && <p className="mt-1 text-xs text-ink-subtle">Add your first friend below.</p>}
        <ul className="mt-2 flex flex-wrap gap-2">
          {friends.map((friend) => {
            const on = members.includes(friend.id);
            return (
              <li key={friend.id}>
                <button type="button" aria-pressed={on} onClick={() => setMembers(on ? members.filter((id) => id !== friend.id) : [...members, friend.id])} className={cn("min-h-11 rounded-full border px-3.5 text-sm font-semibold transition-colors", on ? "border-accent bg-accent-soft text-accent-strong" : "border-line text-ink-muted hover:bg-sage-soft")}>
                  {friend.name}
                </button>
              </li>
            );
          })}
        </ul>
      </fieldset>
      <div className="flex gap-2">
        <Input aria-label="New friend’s name" placeholder="Add a friend" value={newFriend} onChange={(event) => setNewFriend(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void addFriend(); } }} maxLength={60} className="min-h-11 flex-1 text-base" />
        <Button type="button" variant="outline" disabled={busy || !newFriend.trim()} onClick={() => void addFriend()}><UserPlus className="size-4" aria-hidden="true" />Add</Button>
      </div>
      <FormError message={error} />
      <div className="flex flex-col-reverse gap-2 sm:flex-row">
        {group && (confirmDelete
          ? <Button type="button" variant="destructive-soft" disabled={busy} onClick={() => void remove()}><Trash2 className="size-4" aria-hidden="true" />Remove group? What friends owe stays</Button>
          : <Button type="button" variant="destructive-soft" disabled={busy} onClick={() => setConfirmDelete(true)}><Trash2 className="size-4" aria-hidden="true" />Delete</Button>)}
        <Button type="submit" disabled={busy} className="min-h-12 flex-1">{busy ? "Saving…" : group ? "Save group" : "Create group"}</Button>
      </div>
    </form>
  );
}

function AddFriendDialog({ open, save, onClose }: { open: boolean; save: SaveChange; onClose: () => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) { setError("Give your friend a name"); return; }
    setBusy(true);
    const failed = await save(() => dashboardApi.createAccount({ name: trimmed, account_type: "person", balance_cents: 0, credit_limit_cents: null }), `${trimmed} added`);
    setBusy(false);
    if (failed) { setError(failed); return; }
    setName("");
    setError("");
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) { setError(""); onClose(); } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a friend</DialogTitle>
          <DialogDescription>Someone you share costs with. They start all settled up.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <Field label="Name">{(props) => <Input {...props} value={name} onChange={(event) => setName(event.target.value)} maxLength={60} placeholder="e.g. Alex" autoFocus className="min-h-11 text-base" />}</Field>
          <FormError message={error} />
          <Button type="submit" disabled={busy} className="min-h-12 w-full">{busy ? "Adding…" : "Add friend"}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
