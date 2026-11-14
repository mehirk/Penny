"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, Check, ChevronDown, RefreshCw, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { chartsApi, type ChartsResponse, type Dashboard } from "@/lib/api";
import { addMonths, formatMonth } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CategoryBars, categoryColours, type MonthSeries, MonthlyChart } from "./charts";
import { MonthRangePanel } from "./period-picker";
import { cad, describeError } from "./shared";
import { chartsCheer, PennyBanner } from "./penny-banner";

const MAX_MONTHS = 24;
type Preset = "3m" | "6m" | "12m" | "ytd" | "24m" | "custom";
const PRESETS: { id: Preset; label: string }[] = [
  { id: "3m", label: "3 months" },
  { id: "6m", label: "6 months" },
  { id: "12m", label: "12 months" },
  { id: "ytd", label: "This year" },
  { id: "24m", label: "2 years" },
  { id: "custom", label: "Custom" },
];
type ChartId = "cashflow" | "categories" | "needs" | "breakdown" | "accounts";
const CHARTS: { id: ChartId; label: string }[] = [
  { id: "cashflow", label: "Money in and out" },
  { id: "categories", label: "Spending by category" },
  { id: "needs", label: "Needs and wants" },
  { id: "breakdown", label: "Where it went" },
  { id: "accounts", label: "By account" },
];
const SHOWN_KEY = "penny-charts-shown";
const CHIP =
  "inline-flex min-h-10 shrink-0 snap-start items-center gap-1.5 rounded-full border px-3 text-sm font-semibold transition-colors";
const chip = (on: boolean) =>
  cn(CHIP, on ? "border-ink bg-ink text-canvas" : "border-line-strong bg-surface text-ink hover:border-ink-subtle");

function monthsBetween(start: string, end: string): number {
  return (
    (Number(end.slice(0, 4)) - Number(start.slice(0, 4))) * 12 + Number(end.slice(5, 7)) - Number(start.slice(5, 7)) + 1
  );
}

function readShown(): Set<ChartId> {
  try {
    const saved = JSON.parse(localStorage.getItem(SHOWN_KEY) ?? "null") as ChartId[] | null;
    if (Array.isArray(saved)) return new Set(saved.filter((id) => CHARTS.some((chart) => chart.id === id)));
  } catch {
    /* storage may be unavailable; show everything */
  }
  return new Set(CHARTS.map((chart) => chart.id));
}

/**
 * Charts: money over time for a chosen range, filtered by account and category, with the
 * fields on each chart and the charts themselves turned on or off. Every figure comes from
 * `/api/v1/charts` (integer cents from tested code); this file only lays them out.
 */
export function ChartsView({ dashboard }: { dashboard: Dashboard }) {
  const current = dashboard.current_month;
  const [preset, setPreset] = useState<Preset>("6m");
  const [custom, setCustom] = useState({ start: addMonths(current, -5), end: current });
  const [accounts, setAccounts] = useState<Set<string>>(new Set());
  const [categories, setCategories] = useState<Set<string>>(new Set());
  const [panel, setPanel] = useState<"categories" | "charts" | null>(null);
  const [shown, setShown] = useState<Set<ChartId>>(() =>
    typeof window === "undefined" ? new Set(CHARTS.map((c) => c.id)) : readShown(),
  );
  const [fields, setFields] = useState<Record<string, boolean>>({ budget: false });
  const [state, setState] = useState<{ key: string; data: ChartsResponse | null; error: string }>({
    key: "",
    data: null,
    error: "",
  });
  const [attempt, setAttempt] = useState(0);
  const [picking, setPicking] = useState(false);
  const rangeRoot = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!picking) return;
    const close = (event: MouseEvent) => {
      if (!rangeRoot.current?.contains(event.target as Node)) setPicking(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [picking]);

  const range = useMemo(() => {
    if (preset === "custom") return custom;
    const back = { "3m": 2, "6m": 5, "12m": 11, "24m": 23, ytd: Number(current.slice(5, 7)) - 1 }[preset];
    return { start: addMonths(current, -back), end: current };
  }, [preset, custom, current]);
  const tooLong = monthsBetween(range.start, range.end) > MAX_MONTHS;
  const backwards = range.start > range.end;
  const accountList = [...accounts].sort();
  const categoryList = [...categories].sort();
  const key = JSON.stringify([range.start, range.end, accountList, categoryList, attempt]);

  useEffect(() => {
    if (tooLong || backwards) return;
    let live = true;
    chartsApi
      .load(range.start, range.end, accountList, categoryList)
      .then((data) => {
        if (live) setState({ key, data, error: "" });
      })
      .catch((reason: unknown) => {
        if (live)
          setState((previous) => ({
            key,
            data: previous.data,
            error: describeError(reason, "Charts didn’t load").detail,
          }));
      });
    return () => {
      live = false;
    };
    // `key` captures every input to the request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const loading = state.key !== key && !tooLong && !backwards;
  const data = state.data;
  const colourFor = useMemo(() => categoryColours(dashboard.categories), [dashboard.categories]);
  const spendingParents = dashboard.categories.filter((c) => c.kind === "spending" && !c.parent_id);
  const incomeParents = dashboard.categories.filter((c) => c.kind === "income" && !c.parent_id);
  const filtering = accounts.size > 0 || categories.size > 0;

  function toggle<T>(set: Set<T>, value: T, update: (next: Set<T>) => void) {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    update(next);
  }
  function toggleChart(id: ChartId) {
    toggle(shown, id, (next) => {
      setShown(next);
      try {
        localStorage.setItem(SHOWN_KEY, JSON.stringify([...next]));
      } catch {
        /* per-device convenience only */
      }
    });
  }
  const isOn = (field: string, fallback = true) => fields[field] ?? fallback;
  const flip = (field: string, fallback = true) =>
    setFields((current) => ({ ...current, [field]: !(current[field] ?? fallback) }));

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      {/* Filters: one row above everything they scope; slides sideways on a phone. */}
      <section aria-label="Chart filters" className="space-y-2">
        <div
          ref={rangeRoot}
          className="relative"
          onKeyDown={(event) => {
            if (event.key === "Escape" && picking) {
              event.preventDefault();
              setPicking(false);
            }
          }}
        >
          <div
            role="radiogroup"
            aria-label="Time range"
            className="-mx-4 flex snap-x scroll-px-4 gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0 [&::-webkit-scrollbar]:hidden"
          >
            {PRESETS.map((item) => (
              <button
                key={item.id}
                type="button"
                role="radio"
                aria-checked={preset === item.id}
                aria-haspopup={item.id === "custom" ? "dialog" : undefined}
                aria-expanded={item.id === "custom" ? picking : undefined}
                onClick={() => {
                  if (item.id === "custom") setPicking(!picking);
                  else {
                    setPreset(item.id);
                    setPicking(false);
                  }
                }}
                className={chip(preset === item.id)}
              >
                {item.id === "custom" ? (
                  <CalendarDays className="size-4" aria-hidden="true" />
                ) : (
                  preset === item.id && <Check className="size-4" aria-hidden="true" />
                )}
                {item.id === "custom" && preset === "custom"
                  ? `${shortMonth(custom.start)} – ${shortMonth(custom.end)}`
                  : item.label}
              </button>
            ))}
          </div>
          {picking && (
            <MonthRangePanel
              id="charts-months"
              start={range.start}
              end={range.end}
              earliest={addMonths(current, -35)}
              latest={current}
              dataMonths={dashboard.data_months}
              maxMonths={MAX_MONTHS}
              onChoose={(next) => {
                setCustom(next);
                setPreset("custom");
                setPicking(false);
              }}
              onClose={() => setPicking(false)}
            />
          )}
        </div>
        {(tooLong || backwards) && (
          <p role="alert" className="text-sm text-danger">
            {backwards ? "Pick a start month before the end month." : `Pick up to ${MAX_MONTHS} months at a time.`}
          </p>
        )}

        <div
          className="-mx-4 flex snap-x scroll-px-4 items-center gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0 [&::-webkit-scrollbar]:hidden"
          role="group"
          aria-label="Accounts"
        >
          <button
            type="button"
            aria-pressed={accounts.size === 0}
            onClick={() => setAccounts(new Set())}
            className={chip(accounts.size === 0)}
          >
            All accounts
          </button>
          {dashboard.accounts.map((account) => (
            <button
              key={account.id}
              type="button"
              aria-pressed={accounts.has(account.id)}
              onClick={() => toggle(accounts, account.id, setAccounts)}
              className={chip(accounts.has(account.id))}
            >
              {account.name}
            </button>
          ))}
          <span className="mx-1 h-6 w-px shrink-0 bg-line" aria-hidden="true" />
          <button
            type="button"
            aria-expanded={panel === "categories"}
            onClick={() => setPanel(panel === "categories" ? null : "categories")}
            className={chip(categories.size > 0)}
          >
            Categories{categories.size > 0 ? ` · ${categories.size}` : ""}
            <ChevronDown
              className={cn("size-4 transition-transform", panel === "categories" && "rotate-180")}
              aria-hidden="true"
            />
          </button>
          <button
            type="button"
            aria-expanded={panel === "charts"}
            onClick={() => setPanel(panel === "charts" ? null : "charts")}
            className={chip(false)}
          >
            <SlidersHorizontal className="size-4" aria-hidden="true" />
            Charts · {shown.size}/{CHARTS.length}
          </button>
          {filtering && (
            <button
              type="button"
              onClick={() => {
                setAccounts(new Set());
                setCategories(new Set());
              }}
              className={cn(CHIP, "border-transparent text-ink-muted")}
            >
              <X className="size-4" aria-hidden="true" />
              Clear filters
            </button>
          )}
        </div>

        {panel === "categories" && (
          <div className="rounded-[var(--radius-card)] border border-line bg-surface p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-ink">Only these categories</p>
              {categories.size > 0 && (
                <button
                  type="button"
                  onClick={() => setCategories(new Set())}
                  className="min-h-10 px-2 text-sm font-semibold text-ink-muted"
                >
                  Clear
                </button>
              )}
            </div>
            {[
              ["Money out", spendingParents],
              ["Money in", incomeParents],
            ].map(([title, list]) => (
              <fieldset key={title as string} className="mt-2">
                <legend className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                  {title as string}
                </legend>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {(list as typeof spendingParents).map((category) => (
                    <button
                      key={category.id}
                      type="button"
                      aria-pressed={categories.has(category.id)}
                      onClick={() => toggle(categories, category.id, setCategories)}
                      className={chip(categories.has(category.id))}
                    >
                      {category.kind === "spending" && (
                        <span
                          className="size-2.5 rounded-[3px]"
                          style={{ background: colourFor(category.id) }}
                          aria-hidden="true"
                        />
                      )}
                      {category.name}
                    </button>
                  ))}
                  {title === "Money out" && (
                    <button
                      type="button"
                      aria-pressed={categories.has("uncategorized")}
                      onClick={() => toggle(categories, "uncategorized", setCategories)}
                      className={chip(categories.has("uncategorized"))}
                    >
                      Uncategorized
                    </button>
                  )}
                </div>
              </fieldset>
            ))}
          </div>
        )}
        {panel === "charts" && (
          <div className="rounded-[var(--radius-card)] border border-line bg-surface p-3">
            <p className="text-sm font-semibold text-ink">Charts to show</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {CHARTS.map((chart) => (
                <button
                  key={chart.id}
                  type="button"
                  aria-pressed={shown.has(chart.id)}
                  onClick={() => toggleChart(chart.id)}
                  className={chip(shown.has(chart.id))}
                >
                  {shown.has(chart.id) && <Check className="size-4" aria-hidden="true" />}
                  {chart.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      {state.error && state.key === key && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger"
        >
          <span>Charts didn’t load. {state.error}</span>
          <Button size="sm" variant="ghost" onClick={() => setAttempt((value) => value + 1)}>
            <RefreshCw className="size-4" aria-hidden="true" />
            Try again
          </Button>
        </div>
      )}

      {!data ? (
        <ChartsSkeleton />
      ) : (
        // While new data loads, the last charts stay in place, dimmed (no layout jump).
        <div aria-busy={loading} className={cn("space-y-5 transition-opacity", loading && "opacity-60")}>
          <p className="text-sm text-ink-subtle">
            {formatMonth(data.start)} to {formatMonth(data.end)}
            {filtering ? " · filtered" : ""}
          </p>
          <PennyBanner tone="ocean" {...chartsCheer(data.net_cents, formatMonth(data.start), formatMonth(data.end))} />
          <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Money in" emoji="💰" tint="#19b394" value={data.income_cents} />
            <Stat label="Money out" emoji="💸" tint="#f0645a" value={data.spending_cents} />
            <Stat label="Kept (in − out)" emoji="🐷" tint="#b67df2" value={data.net_cents} signed />
            <Stat label="Average spent a month" emoji="📅" tint="#4a8fe7" value={data.average_spending_cents} />
          </ul>

          {shown.size === 0 && (
            <p className="rounded-xl bg-sage-soft p-4 text-sm text-ink-muted">
              All charts are hidden. Use “Charts” above to show some.
            </p>
          )}

          <div className="grid gap-5 lg:grid-cols-2">
            {shown.has("cashflow") && (
              <ChartCard
                title="Money in and out"
                note="Budget is the total of your monthly budgets (not split by account)."
                wide
              >
                <MonthlyChart
                  months={data.months.map((m) => m.month)}
                  onToggle={(field) => flip(field, field !== "budget")}
                  series={[
                    {
                      key: "in",
                      label: "Money in",
                      colour: "var(--chart-in)",
                      kind: "bar",
                      values: data.months.map((m) => m.income_cents),
                      visible: isOn("in"),
                    },
                    {
                      key: "out",
                      label: "Money out",
                      colour: "var(--chart-out)",
                      kind: "bar",
                      values: data.months.map((m) => m.spending_cents),
                      visible: isOn("out"),
                    },
                    {
                      key: "kept",
                      label: "Kept",
                      colour: "var(--chart-net)",
                      kind: "line",
                      values: data.months.map((m) => m.net_cents),
                      visible: isOn("kept"),
                    },
                    {
                      key: "budget",
                      label: "Budget",
                      colour: "var(--chart-reference)",
                      kind: "line",
                      values: data.months.map((m) => m.budget_cents),
                      visible: isOn("budget", false),
                    },
                  ]}
                />
              </ChartCard>
            )}
            {shown.has("categories") && <CategoryTrend data={data} colourFor={colourFor} isOn={isOn} flip={flip} />}
            {shown.has("needs") && (
              <ChartCard
                title="Needs and wants"
                note="Sorted automatically from each purchase. Unsorted is spending Penny couldn’t place."
              >
                <MonthlyChart
                  stacked
                  totalLabel="Total spent"
                  months={data.months.map((m) => m.month)}
                  onToggle={(field) => flip(field)}
                  series={[
                    {
                      key: "need",
                      label: "Needs",
                      colour: "var(--chart-cat-1)",
                      kind: "bar",
                      values: data.months.map((m) => m.needs_cents),
                      visible: isOn("need"),
                    },
                    {
                      key: "want",
                      label: "Wants",
                      colour: "var(--chart-cat-4)",
                      kind: "bar",
                      values: data.months.map((m) => m.wants_cents),
                      visible: isOn("want"),
                    },
                    {
                      key: "unsorted",
                      label: "Unsorted",
                      colour: "var(--chart-other)",
                      kind: "bar",
                      values: data.months.map((m) => m.spending_cents - m.needs_cents - m.wants_cents),
                      visible: isOn("unsorted"),
                    },
                  ]}
                />
              </ChartCard>
            )}
            {shown.has("breakdown") && (
              <ChartCard title="Where it went" note="Spending per category over the whole range.">
                {data.categories.length === 0 ? (
                  <Empty />
                ) : (
                  <CategoryBars
                    items={data.categories.map((c) => ({ ...c, colour_token: "" }))}
                    colourFor={colourFor}
                  />
                )}
              </ChartCard>
            )}
            {shown.has("accounts") && <AccountBars data={data} />}
          </div>
        </div>
      )}
    </div>
  );
}

const SHORT_MONTH = new Intl.DateTimeFormat("en-CA", { month: "short", year: "numeric", timeZone: "UTC" });
const shortMonth = (month: string) => SHORT_MONTH.format(new Date(`${month}T00:00:00Z`)).replace(".", "");

function Stat({
  label,
  value,
  emoji,
  tint,
  signed = false,
}: {
  label: string;
  value: number;
  emoji: string;
  tint: string;
  signed?: boolean;
}) {
  return (
    <li
      className="relative overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--shadow-card)]"
      style={{ backgroundImage: `linear-gradient(135deg, ${tint}22, transparent 60%)` }}
    >
      <span className="absolute inset-x-0 top-0 h-1" style={{ background: tint }} aria-hidden="true" />
      <p className="flex items-center gap-1.5 text-xs font-semibold text-ink-subtle">
        <span aria-hidden="true">{emoji}</span>
        {label}
      </p>
      <p
        className={cn(
          "tabular mt-1 text-xl font-semibold tracking-tight",
          signed && value < 0 ? "text-danger" : "text-ink",
        )}
      >
        {cad(value)}
      </p>
    </li>
  );
}

function ChartCard({
  title,
  note,
  wide = false,
  children,
}: {
  title: string;
  note?: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Card className={cn("p-4 sm:p-5", wide && "lg:col-span-2")}>
      <h2 className="text-base font-semibold tracking-tight text-ink">{title}</h2>
      {note && <p className="mb-3 mt-0.5 text-xs text-ink-subtle">{note}</p>}
      {children}
    </Card>
  );
}

function Empty() {
  return (
    <p className="grid h-40 place-items-center rounded-xl bg-sage-soft text-sm text-ink-subtle">
      No spending in this range.
    </p>
  );
}

/** Stacked monthly spending by category. Colours follow each category's fixed slot; categories past the 7 slots share "Other". */
function CategoryTrend({
  data,
  colourFor,
  isOn,
  flip,
}: {
  data: ChartsResponse;
  colourFor: (id: string | null) => string;
  isOn: (field: string) => boolean;
  flip: (field: string) => void;
}) {
  const series = useMemo(() => {
    const named = data.categories.filter((c) => colourFor(c.category_id) !== "var(--chart-other)");
    const rest = new Set(
      data.categories.filter((c) => colourFor(c.category_id) === "var(--chart-other)").map((c) => c.category_id),
    );
    const amount = (monthIndex: number, match: (id: string | null) => boolean) =>
      data.months[monthIndex].categories.filter((c) => match(c.category_id)).reduce((sum, c) => sum + c.spent_cents, 0);
    const list: MonthSeries[] = named.map((c) => ({
      key: `cat:${c.category_id}`,
      label: c.category_name,
      colour: colourFor(c.category_id),
      kind: "bar",
      values: data.months.map((_, i) => amount(i, (id) => id === c.category_id)),
      visible: isOn(`cat:${c.category_id}`),
    }));
    if (rest.size)
      list.push({
        key: "cat:other",
        label: "Other",
        colour: "var(--chart-other)",
        kind: "bar",
        values: data.months.map((_, i) => amount(i, (id) => rest.has(id))),
        visible: isOn("cat:other"),
      });
    return list;
  }, [data, colourFor, isOn]);
  return (
    <ChartCard title="Spending by category" note="Tap a category to hide or show it." wide>
      {series.length === 0 ? (
        <Empty />
      ) : (
        <MonthlyChart
          stacked
          totalLabel="Total"
          months={data.months.map((m) => m.month)}
          series={series}
          onToggle={flip}
        />
      )}
    </ChartCard>
  );
}

/** Money in and out per account over the range: two thin bars per account on one scale. */
function AccountBars({ data }: { data: ChartsResponse }) {
  const largest = Math.max(1, ...data.accounts.flatMap((a) => [a.income_cents, a.spending_cents]));
  return (
    <ChartCard title="By account" note="Money in and out of each account over the range.">
      {data.accounts.length === 0 ? (
        <Empty />
      ) : (
        <>
          <div className="mb-3 flex gap-4 text-xs text-ink-muted">
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2.5 rounded-[3px] bg-[var(--chart-in)]" aria-hidden="true" />
              Money in
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2.5 rounded-[3px] bg-[var(--chart-out)]" aria-hidden="true" />
              Money out
            </span>
          </div>
          <ul className="space-y-4">
            {data.accounts.map((account) => (
              <li key={account.account_id}>
                <p className="text-sm font-semibold text-ink">{account.account_name}</p>
                {(
                  [
                    ["in", account.income_cents, "var(--chart-in)", "Money in"],
                    ["out", account.spending_cents, "var(--chart-out)", "Money out"],
                  ] as const
                ).map(([key, cents, colour, label]) => (
                  <div
                    key={key}
                    className="mt-1 flex items-center gap-2"
                    aria-label={`${account.account_name} ${label}: ${cad(cents)}`}
                  >
                    <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-sage-soft" aria-hidden="true">
                      <span
                        className="block h-full rounded-full"
                        style={{ width: `${(cents / largest) * 100}%`, background: colour }}
                      />
                    </span>
                    <span className="tabular w-24 shrink-0 text-right text-xs font-semibold text-ink">
                      {cad(cents)}
                    </span>
                  </div>
                ))}
              </li>
            ))}
          </ul>
        </>
      )}
    </ChartCard>
  );
}

function ChartsSkeleton() {
  return (
    <div className="space-y-5" aria-label="Loading charts">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-20 animate-pulse rounded-[var(--radius-card)] bg-sage-soft" />
        ))}
      </div>
      <div className="h-80 animate-pulse rounded-[var(--radius-card)] bg-sage-soft" />
      <div className="grid gap-5 lg:grid-cols-2">
        {[0, 1].map((i) => (
          <div key={i} className="h-64 animate-pulse rounded-[var(--radius-card)] bg-sage-soft" />
        ))}
      </div>
    </div>
  );
}
