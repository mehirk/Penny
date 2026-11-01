"use client";

import { createElement, useEffect, useId, useMemo, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { ArrowUpDown, CalendarDays, ChevronRight, Download, LoaderCircle, Plus, ReceiptText, Repeat, Search, Sparkles, X } from "lucide-react";
import { Calendar, shortDateLabel } from "@/components/ui/date-picker";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { assistApi, type Category, type Dashboard, type SearchFilters, type Transaction } from "@/lib/api";
import { formatShortDate } from "@/lib/format";
import { EMPTY_FILTERS, filterTransactions, hasActiveFilters, type KindFilter, sortTransactions, type TransactionFilters, type TransactionSort, transactionsToCsv } from "@/lib/transactions";
import { cn } from "@/lib/utils";
import { BackBar } from "./back-bar";
import { categoryOptions } from "./dialogs";
import { cad, EmptyState } from "./shared";
import { SwipeRow } from "./swipe-row";
import { categoryIcon } from "./category-icons";

type Props = {
  dashboard: Dashboard;
  /** Switches the period on screen, for searches about another month. */
  onChangePeriod?: (range: { start: string; end: string }) => void;
  onAdd: () => void;
  /** Opens one transaction on its own page. */
  onOpen: (item: Transaction) => void;
  onDelete: (item: Transaction) => void;
  onBack: () => void;
};

const RECENT_COUNT = 5;
const DAY_HEADING = new Intl.DateTimeFormat("en-CA", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const dayHeading = (day: string) => DAY_HEADING.format(new Date(`${day}T00:00:00Z`)).toUpperCase();

/** A list row: icon, name and category, amount. Tapping opens the transaction's page; on touch, swipe to delete. */
function ActivityRow({ item, category, onOpen, onDelete }: { item: Transaction; category: Category | undefined; onOpen: () => void; onDelete: () => void }) {
  const income = item.kind === "income";
  return (
    <SwipeRow label={item.description} onDelete={onDelete}>
      <button type="button" onClick={onOpen} className="flex min-h-16 w-full min-w-0 items-center gap-3 px-4 py-3 text-left hover:bg-sage-soft/60 sm:px-5" aria-label={`${item.description}, ${income ? "money in" : "money out"} ${cad(item.amount_cents)}, ${item.category}, ${formatShortDate(item.occurred_on)}. Open`}>
        <TransactionIdentity item={item} category={category} />
        <span className={cn("tabular shrink-0 whitespace-nowrap font-semibold", income ? "text-money-in" : "text-ink")}>{income ? cad(item.amount_cents, true) : cad(-item.amount_cents)}</span>
        <ChevronRight className="size-4 shrink-0 text-ink-subtle" aria-hidden="true" />
      </button>
    </SwipeRow>
  );
}

/** Spending's Transactions card: the latest few, and "See all" for the full activity page. */
export function RecentTransactions({ dashboard, onAdd, onOpen, onDelete, onSeeAll }: Pick<Props, "dashboard" | "onAdd" | "onOpen" | "onDelete"> & { onSeeAll: () => void }) {
  const categories = useMemo(() => new Map(dashboard.categories.map((category) => [category.id, category])), [dashboard.categories]);
  const rows = useMemo(() => sortTransactions(dashboard.transactions, "newest").slice(0, RECENT_COUNT), [dashboard.transactions]);
  const total = dashboard.transactions.length;
  const { period } = dashboard;
  return (
    <Card id="transactions" className="scroll-mt-28 overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 pt-4 sm:px-5 sm:pt-5">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold tracking-tight text-ink">Transactions</h2>
          <p className="text-sm text-ink-subtle">{total} {period.phrase}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button size="sm" onClick={onAdd} className="max-sm:hidden"><Plus className="size-4" aria-hidden="true" />Add<span className="sr-only"> transaction</span></Button>
          {total > 0 && <Button size="sm" variant="ghost" onClick={onSeeAll}>See all<ChevronRight className="size-4" aria-hidden="true" /></Button>}
        </div>
      </div>
      {total === 0 ? (
        <div className="p-5 pt-3">
          <EmptyState icon={ReceiptText} title={`No transactions ${period.phrase}`} description="Add one, or pick a different period at the top of the page." action={<Button size="sm" onClick={onAdd}><Plus className="size-4" aria-hidden="true" />Add transaction</Button>} />
        </div>
      ) : (
        <ul className="mt-2 divide-y divide-line/70 border-t border-line">
          {rows.map((item) => <li key={item.id}><ActivityRow item={item} category={item.category_id ? categories.get(item.category_id) : undefined} onOpen={() => onOpen(item)} onDelete={() => onDelete(item)} /></li>)}
          {total > RECENT_COUNT && <li><button type="button" onClick={onSeeAll} className="flex min-h-12 w-full items-center justify-center gap-1 text-sm font-semibold text-accent-strong hover:bg-sage-soft">See all {total} transactions<ChevronRight className="size-4" aria-hidden="true" /></button></li>}
        </ul>
      )}
    </Card>
  );
}

const KIND_OPTIONS: { value: KindFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "income", label: "In" },
  { value: "spending", label: "Out" },
];
const SORT_OPTIONS: { value: TransactionSort; label: string }[] = [
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "largest", label: "Largest" },
  { value: "smallest", label: "Smallest" },
];
/** Filter controls share one compact size so the bar reads as a single row of tools. 16px on phones, where iOS zooms into smaller fields. */
const CONTROL = "min-h-10 rounded-lg text-base sm:text-sm";

/**
 * Every transaction in the period on its own page, newest first and grouped by day like a bank's
 * activity list. Filters sit in one row of chips that slides sideways on a phone.
 */
export function TransactionsPanel({ dashboard, onChangePeriod, onAdd, onOpen, onDelete, onBack }: Props) {
  const [filters, setFilters] = useState<TransactionFilters>(EMPTY_FILTERS);
  const [understood, setUnderstood] = useState<{ summary: string; source: SearchFilters["source"] } | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");

  /** Enter in the search box: Penny reads the words into filters (the list itself is exact). */
  async function smartSearch() {
    const text = filters.query.trim();
    if (!text || searching) return;
    setSearching(true);
    setSearchError("");
    try {
      const result = await assistApi.search(text);
      const { period: shown } = dashboard;
      if (result.start && result.end && onChangePeriod && (result.start < shown.start || result.end > shown.end)) {
        onChangePeriod({ start: result.start.slice(0, 8) + "01", end: result.end });
      }
      setFilters({
        query: result.query,
        kind: result.kind,
        category: result.category_id ?? "all",
        from: result.start ?? "",
        to: result.end ?? "",
        minCents: result.min_cents,
        maxCents: result.max_cents,
      });
      setUnderstood({ summary: result.summary, source: result.source });
    } catch {
      setSearchError("Smart search isn’t available right now; filtering by text instead.");
    } finally {
      setSearching(false);
    }
  }

  function clearAll() {
    setFilters(EMPTY_FILTERS);
    setUnderstood(null);
    setSearchError("");
  }
  const [sort, setSort] = useState<TransactionSort>("newest");
  const headingId = useId();
  const searchId = useId();
  const accounts = useMemo(() => new Map(dashboard.accounts.map((account) => [account.id, account.name])), [dashboard.accounts]);
  const categories = useMemo(() => new Map(dashboard.categories.map((category) => [category.id, category])), [dashboard.categories]);
  const rows = useMemo(() => {
    const parents = new Map(dashboard.categories.map((category) => [category.id, category.parent_id]));
    return sortTransactions(filterTransactions(dashboard.transactions, filters, (id) => parents.get(id) ?? null), sort);
  }, [dashboard.transactions, dashboard.categories, filters, sort]);
  const total = dashboard.transactions.length;
  const filtering = hasActiveFilters(filters);
  const { period } = dashboard;

  function exportCsv() {
    const blob = new Blob([`\ufeff${transactionsToCsv(rows, accounts)}`], { type: "text/csv;charset=utf-8" });
    const name = `penny-transactions-${period.start}-to-${period.end}.csv`;
    // The iOS app's web view ignores download links, so it hands the file to the share sheet (Save to Files, AirDrop, Mail).
    const file = new File([blob], name, { type: blob.type });
    if (Capacitor.isNativePlatform() && navigator.canShare?.({ files: [file] })) {
      navigator.share({ files: [file] }).catch(() => undefined);
      return;
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // By day when sorted by date; one list when sorted by amount.
  const groups = useMemo(() => {
    if (sort !== "newest" && sort !== "oldest") return [{ day: "", items: rows }];
    const byDay: { day: string; items: Transaction[] }[] = [];
    for (const item of rows) {
      const last = byDay[byDay.length - 1];
      if (last && last.day === item.occurred_on) last.items.push(item);
      else byDay.push({ day: item.occurred_on, items: [item] });
    }
    return byDay;
  }, [rows, sort]);
  const CHIP = "min-h-10 shrink-0 snap-start rounded-full border px-3 text-sm font-semibold";

  return (
    <div className="mx-auto max-w-3xl">
      <BackBar label="Spending" onBack={onBack} />
      <div className="flex items-center justify-between gap-3 pb-2 pt-1">
        <div className="min-w-0">
          <h2 id={headingId} className="text-2xl font-semibold tracking-tight text-ink">Activity</h2>
          <p className="text-sm text-ink-subtle" aria-live="polite">{filtering ? `${rows.length} of ${total} shown` : `${total} ${period.phrase}`}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {rows.length > 0 && <Button variant="outline" size="sm" onClick={exportCsv} aria-label={`Export ${filtering ? "filtered " : ""}transactions as CSV`}><Download className="size-4" aria-hidden="true" /><span className="hidden sm:inline">Export</span></Button>}
          <Button size="sm" onClick={onAdd} className="max-sm:hidden"><Plus className="size-4" aria-hidden="true" />Add<span className="sr-only"> transaction</span></Button>
        </div>
      </div>

      {total > 0 && (
        <div role="search" aria-label="Filter transactions" className="relative sticky top-[calc(env(safe-area-inset-top)+3.25rem)] z-10 -mx-4 bg-canvas/90 px-4 pb-3 pt-2 backdrop-blur-md sm:-mx-6 sm:px-6 lg:top-0">
          <div className="relative">
            <label htmlFor={searchId} className="sr-only">Search transactions</label>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" aria-hidden="true" />
            <Input id={searchId} type="search" enterKeyHint="search" placeholder="Search, or ask: “eating out over $20 last month”" value={filters.query} aria-describedby={`${searchId}-hint`} onChange={(event) => { setFilters({ ...filters, query: event.target.value }); setUnderstood(null); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void smartSearch(); } }} className={cn(CONTROL, "rounded-full pl-9 pr-10")} />
            <button type="button" onClick={() => void smartSearch()} disabled={searching || !filters.query.trim()} aria-label="Smart search with Penny" title="Smart search (Enter)" className="absolute right-1 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-full text-accent-strong hover:bg-accent-soft disabled:opacity-40">
              {searching ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <Sparkles className="size-4" aria-hidden="true" />}
            </button>
          </div>
          {/* One row of filter chips; on a phone it slides sideways instead of wrapping. */}
          <div className="-mx-4 mt-2 flex snap-x scroll-px-4 items-center gap-2 overflow-x-auto px-4 pb-1 sm:scroll-px-6 [scrollbar-width:none] sm:-mx-6 sm:px-6 [&::-webkit-scrollbar]:hidden">
            {KIND_OPTIONS.map((option) => (
              <button key={option.value} type="button" aria-pressed={filters.kind === option.value} onClick={() => setFilters({ ...filters, kind: option.value })} className={cn(CHIP, filters.kind === option.value ? "border-ink bg-ink text-canvas" : "border-line-strong bg-surface text-ink")}>
                {option.value === "all" ? "All" : option.value === "income" ? "Money in" : "Money out"}
              </button>
            ))}
            <label className="sr-only" htmlFor={`${searchId}-account`}>Account</label>
            <Select id={`${searchId}-account`} value={filters.account ?? "all"} onChange={(event) => setFilters({ ...filters, account: event.target.value })} className={cn(CONTROL, "w-auto shrink-0 snap-start rounded-full font-semibold", filters.account && filters.account !== "all" && "border-ink")}>
              <option value="all">All accounts</option>
              {dashboard.accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
            </Select>
            <label className="sr-only" htmlFor={`${searchId}-category`}>Category</label>
            <Select id={`${searchId}-category`} value={filters.category} onChange={(event) => setFilters({ ...filters, category: event.target.value })} className={cn(CONTROL, "w-auto shrink-0 snap-start rounded-full font-semibold", filters.category !== "all" && "border-ink")}>
              <option value="all">All categories</option>
              <optgroup label="Money out">{categoryOptions(dashboard.categories, "spending").map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</optgroup>
              <optgroup label="Money in">{categoryOptions(dashboard.categories, "income").map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</optgroup>
              <option value="uncategorized">Uncategorized</option>
            </Select>
            <div className="shrink-0 snap-start"><DateFilter start={period.start} end={period.end} transactions={dashboard.transactions} from={filters.from} to={filters.to} onChange={(from, to) => setFilters({ ...filters, from, to })} /></div>
            <label className="sr-only" htmlFor={`${searchId}-sort`}>Sort</label>
            <span className="relative shrink-0 snap-start">
              <ArrowUpDown className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" aria-hidden="true" />
              <Select id={`${searchId}-sort`} value={sort} onChange={(event) => setSort(event.target.value as TransactionSort)} className={cn(CONTROL, "w-auto rounded-full pl-9 font-semibold")}>
                {SORT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </Select>
            </span>
            {filtering && <button type="button" onClick={clearAll} className={cn(CHIP, "inline-flex items-center gap-1 border-transparent text-ink-muted")}><X className="size-4" aria-hidden="true" />Clear</button>}
          </div>
          <p id={`${searchId}-hint`} aria-live="polite" className={cn("mt-1 flex flex-wrap items-center gap-1.5 text-xs", searchError ? "text-danger" : "text-ink-subtle")}>
            {searchError || (understood
              ? <><Sparkles className="size-3.5 text-accent-strong" aria-hidden="true" />Showing <span className="font-semibold text-ink">{understood.summary}</span>{understood.source === "ai" ? " · read by Penny AI" : ""}</>
              : <span className="sr-only">Type to filter by name, or press Enter to search in plain words.</span>)}
          </p>
        </div>
      )}

      {total === 0 ? (
        <EmptyState className="mt-4" icon={ReceiptText} title={`No transactions ${period.phrase}`} description="Add one, or pick a different period on Spending." action={<Button size="sm" onClick={onAdd}><Plus className="size-4" aria-hidden="true" />Add transaction</Button>} />
      ) : rows.length === 0 ? (
        <EmptyState className="mt-4" icon={Search} title="No matching transactions" description="Try a different search, or clear the filters to see everything." action={<Button size="sm" variant="outline" onClick={clearAll}><X className="size-4" aria-hidden="true" />Clear filters</Button>} />
      ) : (
        <section aria-labelledby={headingId} className="mt-2 space-y-5">
          {groups.map((group) => (
            <div key={group.day || "all"}>
              {group.day && <h3 className="mb-1.5 px-1 text-xs font-semibold tracking-wider text-ink-subtle">{dayHeading(group.day)}</h3>}
              <ul className="divide-y divide-line/70 overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
                {group.items.map((item) => <li key={item.id}><ActivityRow item={item} category={item.category_id ? categories.get(item.category_id) : undefined} onOpen={() => onOpen(item)} onDelete={() => onDelete(item)} /></li>)}
              </ul>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

/** The category's icon, as on Home, so a list of purchases can be scanned by kind. */
export function TransactionIdentity({ item, category }: { item: Transaction; category: Category | undefined }) {
  const income = item.kind === "income";
  return (
    <>
      <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl", income ? "bg-money-in-soft text-money-in" : "bg-sage text-ink-muted")} aria-hidden="true">
        {createElement(categoryIcon(category, item.kind), { className: "size-[1.1rem]" })}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold text-ink">{item.description}</span>
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-ink-subtle">
          <span className="truncate">{item.category} · {formatShortDate(item.occurred_on)}</span>
          {item.bill_id && <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-[#f2ecff] px-1.5 py-px text-[11px] font-semibold text-[#7047b7] dark:bg-[#302847] dark:text-[#c1a5ee]"><Repeat className="size-2.5" aria-hidden="true" />Recurring</span>}
          {item.necessity && <span className={cn("shrink-0 rounded-full px-1.5 max-sm:hidden py-px text-[11px] font-semibold", item.necessity === "need" ? "bg-info-soft text-info" : "bg-gold-soft text-gold-strong")}>{item.necessity === "need" ? "Need" : "Want"}</span>}
          {item.unusual && <span className="shrink-0 rounded-full bg-danger-soft px-1.5 py-px text-[11px] font-semibold text-danger" title="At least 3 times what you usually spend on one purchase in this category">Unusual</span>}
          {item.auto_categorized && <span className="shrink-0 max-sm:hidden rounded-full bg-accent-soft px-1.5 py-px text-[11px] font-semibold text-accent-strong" title="Category picked automatically from the merchant name">Auto</span>}
        </span>
      </span>
    </>
  );
}

/**
 * One date control: pick a single day to see that day's transactions, or switch to a range
 * and pick From and To on two calendars. Days with transactions are dotted.
 */
function DateFilter({ start, end, transactions, from, to, onChange }: { start: string; end: string; transactions: readonly Transaction[]; from: string; to: string; onChange: (from: string, to: string) => void }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"day" | "range">(from && to && from !== to ? "range" : "day");
  const root = useRef<HTMLDivElement>(null);
  const panelId = useId();
  // The calendars cover the period on screen and open on its latest month.
  const first = start;
  const last = end;
  const opening = `${end.slice(0, 8)}01` < start ? start : `${end.slice(0, 8)}01`;
  const marked = useMemo(() => new Set(transactions.map((item) => item.occurred_on)), [transactions]);
  const active = Boolean(from || to);
  const label = !active ? "Any date" : from && from === to ? shortDateLabel(from) : `${from ? shortDateLabel(from) : "Start"} – ${to ? shortDateLabel(to) : "End"}`;

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  function pickFrom(day: string) { onChange(day, to && to < day ? "" : to); }
  function pickTo(day: string) { onChange(from && from > day ? day : from, day); }

  return (
    <div ref={root} onKeyDown={(event) => { if (event.key === "Escape" && open) { event.preventDefault(); setOpen(false); } }}>
      <div className={cn("flex min-h-10 items-center rounded-lg border bg-surface shadow-sm", active ? "border-accent" : "border-line-strong")}>
        <button type="button" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? panelId : undefined} onClick={() => setOpen((value) => !value)} className="flex min-h-10 min-w-0 flex-1 items-center gap-2 whitespace-nowrap px-3 text-left text-sm text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent">
          <CalendarDays className="size-4 shrink-0 text-ink-subtle" aria-hidden="true" />
          <span className="sr-only">Date: </span><span className="truncate">{label}</span>
        </button>
        {active && <button type="button" onClick={() => onChange("", "")} className="grid size-10 shrink-0 place-items-center rounded-r-lg text-ink-subtle hover:text-ink" aria-label="Clear date filter"><X className="size-4" aria-hidden="true" /></button>}
      </div>
      {open && (
        <div id={panelId} role="dialog" aria-label="Filter by date" className="absolute inset-x-4 top-full z-30 mt-1 animate-enter sm:left-auto sm:right-5 sm:w-[min(40rem,calc(100vw-2.5rem))] rounded-2xl border border-line bg-surface p-3 shadow-[var(--shadow-raised)] sm:p-4">
          <div role="radiogroup" aria-label="Date filter type" className="grid grid-cols-2 gap-1 rounded-xl bg-sage-soft p-1">
            {([["day", "One day"], ["range", "Date range"]] as const).map(([value, text]) => (
              <button key={value} type="button" role="radio" aria-checked={mode === value} onClick={() => { setMode(value); if (value === "day" && from !== to) onChange("", ""); }} className={cn("min-h-10 rounded-lg text-sm font-semibold", mode === value ? "bg-surface text-ink shadow-sm" : "text-ink-subtle")}>{text}</button>
            ))}
          </div>
          {mode === "day" ? (
            <div className="mx-auto mt-3 max-w-sm">
              <p className="mb-2 text-xs text-ink-subtle">Pick a day to see its transactions. Dotted days have activity.</p>
              <Calendar value={from === to ? from : ""} onPick={(day) => { onChange(day, day); setOpen(false); }} min={first} max={last} initialMonth={opening} marked={marked} label="Pick a day" />
            </div>
          ) : (
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <div>
                <p className="mb-2 text-sm font-semibold text-ink">From <span className="font-normal text-ink-subtle">{from ? shortDateLabel(from) : "start of month"}</span></p>
                <Calendar value={from} onPick={pickFrom} min={first} max={last} initialMonth={opening} range={{ from, to }} marked={marked} label="From date" />
              </div>
              <div>
                <p className="mb-2 text-sm font-semibold text-ink">To <span className="font-normal text-ink-subtle">{to ? shortDateLabel(to) : "end of month"}</span></p>
                <Calendar value={to} onPick={pickTo} min={from || first} max={last} initialMonth={opening} range={{ from, to }} marked={marked} label="To date" />
              </div>
            </div>
          )}
          <div className="mt-3 flex justify-between gap-2 border-t border-line pt-3">
            <Button size="sm" variant="ghost" onClick={() => onChange("", "")} disabled={!active}>Clear</Button>
            <Button size="sm" onClick={() => setOpen(false)}>Done</Button>
          </div>
        </div>
      )}
    </div>
  );
}

