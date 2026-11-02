"use client";

import { type ChangeEvent, useState } from "react";
import { CircleAlert, CircleCheck, FileUp, LoaderCircle, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { type AccountType, assistApi, type Dashboard, dashboardApi, type StatementDraft, type StatementRow } from "@/lib/api";
import { formatShortDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { isOwnAccount } from "./labels";
import type { SaveChange } from "./settings-view";
import { cad, describeError } from "./shared";
import { SourceBadge } from "./smart-cards";

const MAX_BYTES = 8 * 1024 * 1024;
const NEW_ACCOUNT = "__new__";
const ACCEPT = ".pdf,.xlsx,.xlsm,.csv,application/pdf,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

type Row = StatementRow & { key: number; include: boolean };
type Phase = { step: "idle" } | { step: "reading"; name: string } | { step: "review"; name: string; draft: StatementDraft };

/** The file's bytes as base64, without the "data:...;base64," prefix. */
function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1] ?? "");
    reader.onerror = () => reject(reader.error ?? new Error("Couldn’t read that file"));
    reader.readAsDataURL(file);
  });
}

/**
 * Upload a bank or card statement (PDF, Excel, or CSV). Penny AI reads it into rows; the API
 * checks them against the statement's own opening and closing balances. Nothing is saved until
 * the user reviews the rows and presses Add. Like CSV import, adding history doesn't change
 * balances; updating the account's balance to the statement's closing balance is a separate tick.
 */
export function StatementImport({ dashboard, save }: { dashboard: Dashboard; save: SaveChange }) {
  const [phase, setPhase] = useState<Phase>({ step: "idle" });
  const [rows, setRows] = useState<Row[]>([]);
  const [account, setAccount] = useState("");
  const [updateBalance, setUpdateBalance] = useState(true);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ imported: number; skipped: number; errors: string[] } | null>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError("");
    setDone(null);
    if (file.size > MAX_BYTES) { setError("That file is over 8 MB. Try one statement period at a time."); return; }
    setPhase({ step: "reading", name: file.name });
    try {
      const draft = await assistApi.readStatement(file.name, await toBase64(file));
      setRows(draft.rows.map((row, key) => ({ ...row, key, include: !row.transfer })));
      setAccount(draft.account_id ?? (draft.account_type ? NEW_ACCOUNT : dashboard.accounts.find((item) => item.account_type === "chequing")?.id ?? dashboard.accounts[0]?.id ?? NEW_ACCOUNT));
      setUpdateBalance(draft.closing_balance_cents !== null && draft.closing_balance_cents >= 0);
      setPhase({ step: "review", name: file.name, draft });
    } catch (reason) {
      setPhase({ step: "idle" });
      setError(describeError(reason, "Penny couldn’t read that statement").detail);
    }
  }

  const edit = (key: number, change: Partial<Row>) => setRows((current) => current.map((row) => (row.key === key ? { ...row, ...change } : row)));

  async function add(draft: StatementDraft) {
    const picked = rows.filter((row) => row.include && row.description.trim());
    if (picked.length === 0) { setError("Tick at least one transaction to add."); return; }
    const closing = draft.closing_balance_cents;
    const type: AccountType = draft.account_type ?? "chequing";
    setBusy(true);
    setError("");
    let summary: { imported: number; skipped: number; errors: string[] } | null = null;
    const failure = await save(async () => {
      let accountId = account;
      if (account === NEW_ACCOUNT) {
        const created = await dashboardApi.createAccount({
          name: (draft.account_name ?? draft.institution ?? "Imported account").slice(0, 60),
          account_type: type,
          balance_cents: closing !== null && closing >= 0 ? closing : 0,
          credit_limit_cents: null,
        });
        const known = new Set(dashboard.accounts.map((item) => item.id));
        accountId = created.accounts.find((item) => !known.has(item.id))?.id ?? "";
        if (!accountId) throw new Error("Couldn’t create the account");
      }
      const result = await dashboardApi.importRows(accountId, picked.map(({ occurred_on, description, amount_cents, kind, category_id }) => ({ occurred_on, description: description.trim(), amount_cents, kind, category_id })));
      summary = result;
      if (account !== NEW_ACCOUNT && updateBalance && closing !== null && closing >= 0) {
        return dashboardApi.updateAccount(accountId, { balance_cents: closing });
      }
      return result.dashboard;
    }, "Statement added");
    setBusy(false);
    if (failure) { setError(failure); return; }
    setDone(summary);
    setPhase({ step: "idle" });
    setRows([]);
  }

  return (
    <section aria-labelledby="import-title" aria-busy={phase.step === "reading"}>
      <p className="mt-1 text-sm text-ink-subtle">Upload a statement from your bank or card: PDF, Excel, or CSV. Penny AI reads the transactions, checks them against the statement’s balances, and fills everything in for you to review. Duplicates are skipped.</p>
      <p className="mt-3 flex gap-2 rounded-xl bg-gold-soft/60 p-3 text-xs text-ink-muted">
        <ShieldAlert className="size-4 shrink-0 text-gold-strong" aria-hidden="true" />
        <span>Penny is a demo that uses fictional data. Please upload a sample or made-up statement, not a real one: the file is sent to OpenAI to be read. Penny doesn’t keep the file.</span>
      </p>

      {phase.step !== "review" && (
        <label className={cn("mt-4 inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-on-primary hover:bg-primary-hover has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent", phase.step === "reading" && "pointer-events-none opacity-60")}>
          <FileUp className="size-4" aria-hidden="true" />Choose a statement
          <input type="file" accept={ACCEPT} onChange={(event) => void onFile(event)} disabled={phase.step === "reading"} className="sr-only" />
        </label>
      )}

      {phase.step === "reading" && (
        <div className="mt-4 rounded-xl border border-line p-4" role="status">
          <p className="flex items-center gap-2 text-sm font-semibold text-ink"><LoaderCircle className="size-4 animate-spin text-accent-strong" aria-hidden="true" />Penny is reading {phase.name}…</p>
          <p className="mt-1 text-xs text-ink-subtle">Longer statements can take up to a minute.</p>
          <div className="mt-3 space-y-2" aria-hidden="true">{[92, 80, 86, 70, 78].map((width) => <div key={width} className="h-9 animate-pulse rounded-lg bg-sage-soft" style={{ width: `${width}%` }} />)}</div>
        </div>
      )}

      {error && <p role="alert" className="mt-3 rounded-xl bg-danger-soft p-3 text-sm text-danger">{error}</p>}

      {done && (
        <div className="mt-3 rounded-xl bg-sage-soft p-3 text-sm" role="status">
          <p className="font-semibold text-ink">Added {done.imported} transaction{done.imported === 1 ? "" : "s"}{done.skipped ? `, skipped ${done.skipped}` : ""}.</p>
          {done.errors.length > 0 && <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-ink-muted">{done.errors.map((item, index) => <li key={index}>{item}</li>)}</ul>}
        </div>
      )}

      {phase.step === "review" && (
        <Review
          dashboard={dashboard}
          name={phase.name}
          draft={phase.draft}
          rows={rows}
          account={account}
          onAccount={setAccount}
          updateBalance={updateBalance}
          onUpdateBalance={setUpdateBalance}
          onEdit={edit}
          busy={busy}
          onAdd={() => void add(phase.draft)}
          onCancel={() => { setPhase({ step: "idle" }); setRows([]); setError(""); }}
        />
      )}
    </section>
  );
}

function BalanceCheck({ draft }: { draft: StatementDraft }) {
  const difference = draft.balance_difference_cents;
  if (difference === null) {
    return <p className="flex gap-2 rounded-xl bg-sage-soft p-3 text-sm text-ink-muted"><CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />This statement doesn’t show both an opening and closing balance, so give the amounts a quick look.</p>;
  }
  if (difference === 0) {
    return <p className="flex gap-2 rounded-xl bg-money-in/10 p-3 text-sm text-ink"><CircleCheck className="mt-0.5 size-4 shrink-0 text-money-in" aria-hidden="true" />Every amount checks out: the rows add up exactly to the statement’s closing balance.</p>;
  }
  return (
    <p role="status" className="flex gap-2 rounded-xl bg-gold-soft p-3 text-sm text-ink">
      <CircleAlert className="mt-0.5 size-4 shrink-0 text-gold-strong" aria-hidden="true" />
      <span>The rows add up to <span className="tabular font-semibold">{cad(Math.abs(difference))}</span> {difference > 0 ? "more" : "less"} than the statement’s closing balance. A row may be missing or misread; compare it with the statement before adding.</span>
    </p>
  );
}

function Review({ dashboard, name, draft, rows, account, onAccount, updateBalance, onUpdateBalance, onEdit, busy, onAdd, onCancel }: {
  dashboard: Dashboard; name: string; draft: StatementDraft; rows: Row[]; account: string; onAccount: (id: string) => void;
  updateBalance: boolean; onUpdateBalance: (on: boolean) => void; onEdit: (key: number, change: Partial<Row>) => void;
  busy: boolean; onAdd: () => void; onCancel: () => void;
}) {
  const picked = rows.filter((row) => row.include);
  const closing = draft.closing_balance_cents;
  const accountName = dashboard.accounts.find((item) => item.id === account)?.name;
  const period = draft.period_start && draft.period_end ? `${formatShortDate(draft.period_start)} – ${formatShortDate(draft.period_end)}` : null;
  const newLabel = `New account: ${draft.account_name ?? draft.institution ?? "Imported account"}${draft.account_type ? ` (${draft.account_type})` : ""}`;
  return (
    <div className="mt-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold text-ink">{[draft.institution, draft.account_name].filter(Boolean).join(" · ") || name}</p>
          <p className="text-xs text-ink-subtle">{[period, `${rows.length} transaction${rows.length === 1 ? "" : "s"} found`].filter(Boolean).join(" · ")}</p>
        </div>
        <SourceBadge source={draft.source} />
      </div>

      <BalanceCheck draft={draft} />

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-semibold text-ink">
          Add to account
          <Select className="mt-1" value={account} onChange={(event) => onAccount(event.target.value)}>
            {dashboard.accounts.filter(isOwnAccount).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            <option value={NEW_ACCOUNT}>{newLabel}</option>
          </Select>
        </label>
        {closing !== null && closing >= 0 && (
          account === NEW_ACCOUNT
            ? <p className="self-end text-xs text-ink-subtle">The new account starts at the closing balance, <span className="tabular font-semibold text-ink">{cad(closing)}</span>.</p>
            : (
              <label className="flex min-h-11 cursor-pointer items-center gap-3 self-end text-sm text-ink">
                <input type="checkbox" checked={updateBalance} onChange={(event) => onUpdateBalance(event.target.checked)} className="size-5 shrink-0 accent-[var(--color-accent)]" />
                <span>Set {accountName ?? "the account"}’s balance to the closing balance, <span className="tabular font-semibold">{cad(closing)}</span></span>
              </label>
            )
        )}
      </div>

      <ul className="divide-y divide-line rounded-xl border border-line" aria-label="Transactions found">
        {rows.map((row) => {
          const options = dashboard.categories.filter((category) => category.kind === row.kind);
          return (
            <li key={row.key} className={cn("flex items-start gap-3 p-3 transition-opacity", !row.include && "opacity-55")}>
              <input type="checkbox" checked={row.include} onChange={(event) => onEdit(row.key, { include: event.target.checked })} aria-label={`Include ${row.description}`} className="mt-3 size-5 shrink-0 accent-[var(--color-accent)]" />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex items-center gap-2">
                  <Input value={row.description} onChange={(event) => onEdit(row.key, { description: event.target.value })} aria-label="Description" className="min-w-0 flex-1" maxLength={160} />
                  <span className={cn("tabular shrink-0 text-sm font-semibold", row.kind === "income" ? "text-money-in" : "text-ink")}>{row.kind === "income" ? "+" : "−"}{cad(row.amount_cents)}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-ink-subtle">
                  <span className="tabular">{formatShortDate(row.occurred_on)}</span>
                  {row.transfer && <span className="rounded-full bg-sage-soft px-2 py-0.5 font-semibold">Transfer between your accounts</span>}
                  <Select value={row.category_id ?? ""} onChange={(event) => onEdit(row.key, { category_id: event.target.value || null })} aria-label={`Category for ${row.description}`} className="h-11 min-w-0 flex-1 text-xs sm:max-w-56">
                    <option value="">No category</option>
                    {options.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                  </Select>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {draft.problems.length > 0 && (
        <details className="rounded-xl bg-sage-soft p-3 text-xs text-ink-muted">
          <summary className="min-h-11 cursor-pointer content-center font-semibold text-ink">{draft.problems.length} line{draft.problems.length === 1 ? "" : "s"} couldn’t be read</summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">{draft.problems.map((item, index) => <li key={index}>{item}</li>)}</ul>
        </details>
      )}

      <p className="text-xs text-ink-subtle">Adding history doesn’t change your balances{closing !== null && closing >= 0 && account !== NEW_ACCOUNT ? " unless you tick the box above" : ""}. Transfers between your own accounts are left out unless you tick them.</p>
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy || picked.length === 0} onClick={onAdd}>{busy && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}{picked.length === 0 ? "Tick at least one" : `Add ${picked.length} transaction${picked.length === 1 ? "" : "s"}`}</Button>
        <Button variant="ghost" disabled={busy} onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}
