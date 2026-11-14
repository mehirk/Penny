"use client";

import { type ChangeEvent, useState } from "react";
import { CircleAlert, CircleCheck, FileUp, History, LoaderCircle, ReceiptText, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import {
  type AccountType,
  assistApi,
  type Dashboard,
  dashboardApi,
  type StatementDraft,
  type StatementRow,
} from "@/lib/api";
import { formatShortDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { isOwnAccount } from "./labels";
import type { SaveChange } from "./settings-view";
import { cad, describeError } from "./shared";
import { SourceBadge } from "./smart-cards";

const MAX_BYTES = 8 * 1024 * 1024;
const NEW_ACCOUNT = "__new__";
const ACCEPT =
  ".pdf,.xlsx,.xlsm,.csv,.jpg,.jpeg,.png,.webp,application/pdf,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,image/jpeg,image/png,image/webp";

type Row = StatementRow & { key: number; include: boolean };
type Phase =
  { step: "idle" } | { step: "reading"; name: string } | { step: "review"; name: string; draft: StatementDraft };

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
 * Upload a bank or card statement (PDF, Excel, or CSV), or a photo of a receipt or bill. Penny AI
 * reads it into rows; the API checks them against the statement's balances or the receipt's
 * total, and groups a receipt into one purchase per category. Nothing is saved until the user
 * reviews the rows and presses Add. A statement is history (balances don't change; updating the
 * balance to the closing balance is a separate tick); a receipt is new purchases, which come off
 * the account unless they're already in its balance.
 */
export function StatementImport({ dashboard, save }: { dashboard: Dashboard; save: SaveChange }) {
  const [phase, setPhase] = useState<Phase>({ step: "idle" });
  const [rows, setRows] = useState<Row[]>([]);
  const [account, setAccount] = useState("");
  const [updateBalance, setUpdateBalance] = useState(true);
  // Receipts only: the purchases are already in the account's balance, so record them as history.
  const [inBalance, setInBalance] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ imported: number; skipped: number; errors: string[] } | null>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setError("That file is over 8 MB. Try one statement period at a time.");
      return;
    }
    await read(file.name, async () => assistApi.readStatement(file.name, await toBase64(file)));
  }

  async function read(name: string, load: () => Promise<StatementDraft>) {
    setError("");
    setDone(null);
    setPhase({ step: "reading", name });
    try {
      const draft = await load();
      setRows(draft.rows.map((row, key) => ({ ...row, key, include: !row.transfer })));
      setAccount(
        draft.account_id ??
          (draft.account_type
            ? NEW_ACCOUNT
            : (dashboard.accounts.find((item) => item.account_type === "chequing")?.id ??
              dashboard.accounts[0]?.id ??
              NEW_ACCOUNT)),
      );
      // A receipt's total isn't a balance; its purchases come off the account instead.
      setUpdateBalance(
        draft.document === "statement" && draft.closing_balance_cents !== null && draft.closing_balance_cents >= 0,
      );
      setInBalance(false);
      setPhase({ step: "review", name, draft });
    } catch (reason) {
      setPhase({ step: "idle" });
      setError(describeError(reason, "Penny couldn’t read that statement").detail);
    }
  }

  const edit = (key: number, change: Partial<Row>) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...change } : row)));

  async function add(draft: StatementDraft) {
    const picked = rows.filter((row) => row.include && row.description.trim());
    if (picked.length === 0) {
      setError("Tick at least one transaction to add.");
      return;
    }
    const closing = draft.closing_balance_cents;
    const type: AccountType = draft.account_type ?? "chequing";
    setBusy(true);
    setError("");
    let summary: { imported: number; skipped: number; errors: string[] } | null = null;
    const failure = await save(
      async () => {
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
        if (draft.document === "receipt") {
          let latest: Dashboard | null = null;
          for (const { occurred_on, description, amount_cents, kind, category_id } of picked) {
            latest = await dashboardApi.createTransaction({
              description: description.trim(),
              account_id: accountId,
              category_id,
              amount_cents,
              kind,
              occurred_on,
              history_only: inBalance,
            });
          }
          summary = { imported: picked.length, skipped: 0, errors: [] };
          return latest as Dashboard;
        }
        const result = await dashboardApi.importRows(
          accountId,
          picked.map(({ occurred_on, description, amount_cents, kind, category_id }) => ({
            occurred_on,
            description: description.trim(),
            amount_cents,
            kind,
            category_id,
          })),
        );
        summary = result;
        if (account !== NEW_ACCOUNT && updateBalance && closing !== null && closing >= 0) {
          return dashboardApi.updateAccount(accountId, { balance_cents: closing });
        }
        return result.dashboard;
      },
      draft.document === "receipt" ? "Receipt added" : "Statement added",
    );
    setBusy(false);
    if (failure) {
      setError(failure);
      return;
    }
    setDone(summary);
    setPhase({ step: "idle" });
    setRows([]);
  }

  return (
    <section aria-label="Scan a receipt or statement" aria-busy={phase.step === "reading"}>
      <p className="flex gap-2 rounded-xl bg-gold-soft/60 p-3 text-xs text-ink-muted">
        <ShieldAlert className="size-4 shrink-0 text-gold-strong" aria-hidden="true" />
        <span>
          The file is sent to OpenAI to be read, and Penny doesn’t keep it. Cover account numbers before you upload, and
          use a sample if you’re just trying it out.
        </span>
      </p>

      {phase.step !== "review" && (
        <div className="mt-4 flex flex-wrap gap-2">
          <label
            className={cn(
              "inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-on-primary hover:bg-primary-hover has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent",
              phase.step === "reading" && "pointer-events-none opacity-60",
            )}
          >
            <FileUp className="size-4" aria-hidden="true" />
            Choose a photo or file
            <input
              type="file"
              accept={ACCEPT}
              onChange={(event) => void onFile(event)}
              disabled={phase.step === "reading"}
              className="sr-only"
            />
          </label>
          <Button
            variant="outline"
            disabled={phase.step === "reading"}
            onClick={() => void read("Sample receipt", () => assistApi.sampleReceipt())}
          >
            <ReceiptText className="size-4" aria-hidden="true" />
            Try a sample receipt
          </Button>
        </div>
      )}

      {phase.step === "reading" && (
        <div className="mt-4 rounded-xl border border-line p-4" role="status">
          <p className="flex items-center gap-2 text-sm font-semibold text-ink">
            <LoaderCircle className="size-4 animate-spin text-accent-strong" aria-hidden="true" />
            Penny is reading {phase.name}…
          </p>
          <p className="mt-1 text-xs text-ink-subtle">Longer statements can take up to a minute.</p>
          <div className="mt-3 space-y-2" aria-hidden="true">
            {[92, 80, 86, 70, 78].map((width) => (
              <div key={width} className="h-9 animate-pulse rounded-lg bg-sage-soft" style={{ width: `${width}%` }} />
            ))}
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-3 rounded-xl bg-danger-soft p-3 text-sm text-danger">
          {error}
        </p>
      )}

      {done && (
        <div className="mt-3 rounded-xl bg-sage-soft p-3 text-sm" role="status">
          <p className="font-semibold text-ink">
            Added {done.imported} transaction{done.imported === 1 ? "" : "s"}
            {done.skipped ? `, skipped ${done.skipped}` : ""}.
          </p>
          {done.errors.length > 0 && (
            <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-ink-muted">
              {done.errors.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
          )}
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
          inBalance={inBalance}
          onInBalance={setInBalance}
          onEdit={edit}
          busy={busy}
          onAdd={() => void add(phase.draft)}
          onCancel={() => {
            setPhase({ step: "idle" });
            setRows([]);
            setError("");
          }}
        />
      )}
    </section>
  );
}

function BalanceCheck({ draft }: { draft: StatementDraft }) {
  const difference = draft.balance_difference_cents;
  if (draft.document === "receipt") return <ReceiptCheck draft={draft} />;
  if (difference === null) {
    return (
      <p className="flex gap-2 rounded-xl bg-sage-soft p-3 text-sm text-ink-muted">
        <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        This statement doesn’t show both an opening and closing balance, so give the amounts a quick look.
      </p>
    );
  }
  if (difference === 0) {
    return (
      <p className="flex gap-2 rounded-xl bg-money-in/10 p-3 text-sm text-ink">
        <CircleCheck className="mt-0.5 size-4 shrink-0 text-money-in" aria-hidden="true" />
        Every amount checks out: the rows add up exactly to the statement’s closing balance.
      </p>
    );
  }
  return (
    <p role="status" className="flex gap-2 rounded-xl bg-gold-soft p-3 text-sm text-ink">
      <CircleAlert className="mt-0.5 size-4 shrink-0 text-gold-strong" aria-hidden="true" />
      <span>
        The rows add up to <span className="tabular font-semibold">{cad(Math.abs(difference))}</span>{" "}
        {difference > 0 ? "more" : "less"} than the statement’s closing balance. A row may be missing or misread;
        compare it with the statement before adding.
      </span>
    </p>
  );
}

function Review({
  dashboard,
  name,
  draft,
  rows,
  account,
  onAccount,
  updateBalance,
  onUpdateBalance,
  inBalance,
  onInBalance,
  onEdit,
  busy,
  onAdd,
  onCancel,
}: {
  dashboard: Dashboard;
  name: string;
  draft: StatementDraft;
  rows: Row[];
  account: string;
  onAccount: (id: string) => void;
  updateBalance: boolean;
  onUpdateBalance: (on: boolean) => void;
  inBalance: boolean;
  onInBalance: (on: boolean) => void;
  onEdit: (key: number, change: Partial<Row>) => void;
  busy: boolean;
  onAdd: () => void;
  onCancel: () => void;
}) {
  const picked = rows.filter((row) => row.include);
  const receipt = draft.document === "receipt";
  const closing = receipt ? null : draft.closing_balance_cents;
  const accountName = dashboard.accounts.find((item) => item.id === account)?.name;
  const period =
    draft.period_start && draft.period_end
      ? draft.period_start === draft.period_end
        ? formatShortDate(draft.period_start)
        : `${formatShortDate(draft.period_start)} – ${formatShortDate(draft.period_end)}`
      : null;
  const found = receipt
    ? `${rows.length} purchase${rows.length === 1 ? "" : "s"}`
    : `${rows.length} transaction${rows.length === 1 ? "" : "s"} found`;
  const newLabel = `New account: ${draft.account_name ?? draft.institution ?? "Imported account"}${draft.account_type ? ` (${draft.account_type})` : ""}`;
  return (
    <div className="mt-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold text-ink">
            {[draft.institution, draft.account_name].filter(Boolean).join(" · ") || name}
          </p>
          <p className="text-xs text-ink-subtle">{[period, found].filter(Boolean).join(" · ")}</p>
        </div>
        {draft.source === "sample" ? (
          <span className="rounded-full bg-sage-soft px-2 py-0.5 text-[11px] font-semibold text-ink-subtle">
            Sample: read in advance
          </span>
        ) : (
          <SourceBadge source={draft.source} />
        )}
      </div>

      <BalanceCheck draft={draft} />

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-semibold text-ink">
          {receipt ? "Paid from" : "Add to account"}
          <Select className="mt-1" value={account} onChange={(event) => onAccount(event.target.value)}>
            {dashboard.accounts.filter(isOwnAccount).map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
            {!receipt && <option value={NEW_ACCOUNT}>{newLabel}</option>}
          </Select>
        </label>
        {closing !== null &&
          closing >= 0 &&
          (account === NEW_ACCOUNT ? (
            <p className="self-end text-xs text-ink-subtle">
              The new account starts at the closing balance,{" "}
              <span className="tabular font-semibold text-ink">{cad(closing)}</span>.
            </p>
          ) : (
            <label className="flex min-h-11 cursor-pointer items-center gap-3 self-end text-sm text-ink">
              <input
                type="checkbox"
                checked={updateBalance}
                onChange={(event) => onUpdateBalance(event.target.checked)}
                className="size-5 shrink-0 accent-[var(--color-accent)]"
              />
              <span>
                Set {accountName ?? "the account"}’s balance to the closing balance,{" "}
                <span className="tabular font-semibold">{cad(closing)}</span>
              </span>
            </label>
          ))}
        {receipt && (
          <label className="flex min-h-11 cursor-pointer items-center gap-3 self-end text-sm text-ink">
            <input
              type="checkbox"
              checked={inBalance}
              onChange={(event) => onInBalance(event.target.checked)}
              className="size-5 shrink-0 accent-[var(--color-accent)]"
            />
            <span className="flex items-center gap-1.5">
              <History className="size-4 text-info" aria-hidden="true" />
              Already in {accountName ?? "the account"}’s balance
            </span>
          </label>
        )}
      </div>

      <ul className="divide-y divide-line rounded-xl border border-line" aria-label="Transactions found">
        {rows.map((row) => {
          const options = dashboard.categories.filter((category) => category.kind === row.kind);
          return (
            <li
              key={row.key}
              className={cn("flex items-start gap-3 p-3 transition-opacity", !row.include && "opacity-55")}
            >
              <input
                type="checkbox"
                checked={row.include}
                onChange={(event) => onEdit(row.key, { include: event.target.checked })}
                aria-label={`Include ${row.description}`}
                className="mt-3 size-5 shrink-0 accent-[var(--color-accent)]"
              />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex items-center gap-2">
                  <Input
                    value={row.description}
                    onChange={(event) => onEdit(row.key, { description: event.target.value })}
                    aria-label="Description"
                    className="min-w-0 flex-1"
                    maxLength={160}
                  />
                  <span
                    className={cn(
                      "tabular shrink-0 text-sm font-semibold",
                      row.kind === "income" ? "text-money-in" : "text-ink",
                    )}
                  >
                    {row.kind === "income" ? "+" : "−"}
                    {cad(row.amount_cents)}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-ink-subtle">
                  <span className="tabular">{formatShortDate(row.occurred_on)}</span>
                  {row.transfer && (
                    <span className="rounded-full bg-sage-soft px-2 py-0.5 font-semibold">
                      Transfer between your accounts
                    </span>
                  )}
                  <Select
                    value={row.category_id ?? ""}
                    onChange={(event) => onEdit(row.key, { category_id: event.target.value || null })}
                    aria-label={`Category for ${row.description}`}
                    className="h-11 min-w-0 flex-1 text-xs sm:max-w-56"
                  >
                    <option value="">No category</option>
                    {options.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {draft.problems.length > 0 && (
        <details className="rounded-xl bg-sage-soft p-3 text-xs text-ink-muted">
          <summary className="min-h-11 cursor-pointer content-center font-semibold text-ink">
            {draft.problems.length} line{draft.problems.length === 1 ? "" : "s"} couldn’t be read
          </summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {draft.problems.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </details>
      )}

      <p className="text-xs text-ink-subtle">
        {receipt ? (
          <>These purchases come off {accountName ?? "the account"} unless you tick “Already in its balance”.</>
        ) : (
          <>
            Adding history doesn’t change your balances
            {closing !== null && closing >= 0 && account !== NEW_ACCOUNT ? " unless you tick the box above" : ""}.
            Transfers between your own accounts are left out unless you tick them.
          </>
        )}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy || picked.length === 0} onClick={onAdd}>
          {busy && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
          {picked.length === 0
            ? "Tick at least one"
            : `Add ${picked.length} transaction${picked.length === 1 ? "" : "s"}`}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function ReceiptCheck({ draft }: { draft: StatementDraft }) {
  const difference = draft.balance_difference_cents;
  const groups = `${draft.rows.length} purchase${draft.rows.length === 1 ? "" : "s"}, one per category`;
  if (difference === 0) {
    return (
      <p className="flex gap-2 rounded-xl bg-money-in/10 p-3 text-sm text-ink">
        <CircleCheck className="mt-0.5 size-4 shrink-0 text-money-in" aria-hidden="true" />
        <span>
          {groups}. They add up exactly to the receipt’s total,{" "}
          <span className="tabular font-semibold">{cad(draft.closing_balance_cents ?? 0)}</span>. Tax is included in the
          biggest one.
        </span>
      </p>
    );
  }
  return (
    <p role="status" className="flex gap-2 rounded-xl bg-gold-soft p-3 text-sm text-ink">
      <CircleAlert className="mt-0.5 size-4 shrink-0 text-gold-strong" aria-hidden="true" />
      <span>
        {groups}.{" "}
        {difference === null ? (
          "The receipt’s total wasn’t readable, so give the amounts a quick look."
        ) : (
          <>
            They add up to <span className="tabular font-semibold">{cad(Math.abs(difference))}</span>{" "}
            {difference > 0 ? "more" : "less"} than the printed total. A line may be misread; check before adding.
          </>
        )}
      </span>
    </p>
  );
}
