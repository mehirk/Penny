"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { type AccountType, type Category, type Dashboard, dashboardApi } from "@/lib/api";
import { parseCadToCents } from "@/lib/money";
import { ACCOUNT_TYPE_LABELS } from "./labels";

/** Runs a create call (category, account), applies the new dashboard, and returns it or an error. */
export type InlineCreate = (action: () => Promise<Dashboard>) => Promise<Dashboard | string>;

/** Inline "new category" form; reports the created id (or null if cancelled). */
export function NewCategory({ kind, dashboard, onCreate, onDone }: { kind: Category["kind"]; dashboard: Dashboard; onCreate: InlineCreate; onDone: (id: string | null) => void }) {
  const [name, setName] = useState("");
  const [parent, setParent] = useState("");
  const [error, setError] = useState("");
  const parents = dashboard.categories.filter((c) => c.kind === kind && !c.parent_id);
  async function save() {
    if (!name.trim()) { setError("Give it a name"); return; }
    const result = await onCreate(() => dashboardApi.createCategory({ name: name.trim(), kind, parent_id: parent || null }));
    if (typeof result === "string") { setError(result); return; }
    onDone(result.categories.find((c) => c.kind === kind && c.name.toLowerCase() === name.trim().toLowerCase())?.id ?? null);
  }
  return (
    <div className="space-y-3 rounded-2xl border border-line bg-sage-soft p-3">
      <p className="text-sm font-semibold text-ink">New {kind === "income" ? "income type" : "category"}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <Input aria-label="Name" placeholder={kind === "income" ? "e.g. Tutoring" : "e.g. Pets"} value={name} onChange={(event) => setName(event.target.value)} maxLength={40} autoFocus />
        {kind === "spending" && (
          <Select aria-label="Put it under" value={parent} onChange={(event) => setParent(event.target.value)}>
            <option value="">Top-level category</option>
            {parents.map((option) => <option key={option.id} value={option.id}>Under {option.name}</option>)}
          </Select>
        )}
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex gap-2"><Button size="sm" onClick={() => void save()}>Add</Button><Button size="sm" variant="ghost" onClick={() => onDone(null)}>Cancel</Button></div>
    </div>
  );
}

export function NewAccount({ onCreate, onDone }: { onCreate: InlineCreate; onDone: (id: string | null) => void }) {
  const [name, setName] = useState("");
  const [type, setType] = useState<AccountType>("chequing");
  const [limit, setLimit] = useState("");
  const [error, setError] = useState("");
  async function save() {
    if (!name.trim()) { setError("Give it a name"); return; }
    let limitCents: number | null = null;
    if (type === "credit") {
      try { limitCents = parseCadToCents(limit); } catch { setError("Enter the card’s credit limit"); return; }
      if (limitCents <= 0) { setError("Enter the card’s credit limit"); return; }
    }
    const result = await onCreate(() => dashboardApi.createAccount({ name: name.trim(), account_type: type, balance_cents: 0, credit_limit_cents: limitCents }));
    if (typeof result === "string") { setError(result); return; }
    onDone(result.accounts.find((a) => a.name === name.trim())?.id ?? null);
  }
  return (
    <div className="space-y-3 rounded-2xl border border-line bg-sage-soft p-3">
      <p className="text-sm font-semibold text-ink">New account</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <Input aria-label="Account name" placeholder="e.g. Wallet cash" value={name} onChange={(event) => setName(event.target.value)} maxLength={60} autoFocus />
        <Select aria-label="Account type" value={type} onChange={(event) => setType(event.target.value as AccountType)}>
          {Object.entries(ACCOUNT_TYPE_LABELS).filter(([value]) => value !== "person").map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </Select>
        {type === "credit" && <Input aria-label="Credit limit (CAD)" inputMode="decimal" placeholder="Credit limit, e.g. 1500" value={limit} onChange={(event) => setLimit(event.target.value)} />}
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex gap-2"><Button size="sm" onClick={() => void save()}>Add</Button><Button size="sm" variant="ghost" onClick={() => onDone(null)}>Cancel</Button></div>
    </div>
  );
}
