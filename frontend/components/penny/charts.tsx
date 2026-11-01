"use client";

import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Table2 } from "lucide-react";
import type { Category, CategorySpending, HistoryMonth } from "@/lib/api";
import { cn } from "@/lib/utils";
import { cad } from "./shared";

/*
 * Hand-built SVG charts. Every plotted value is integer cents from the API; the code here
 * only maps values to pixels. Specs follow the dataviz guide: <=24px columns with 4px
 * rounded data-ends, 2px lines, >=8px ringed markers, hairline solid grid, one y-axis,
 * a legend for 2+ series, hover + keyboard tooltips, and a table view for every chart.
 */

// ------------------------------------------------------------------ shared helpers

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Clean axis ticks over [min, max] cents: steps of 1, 2, 2.5 or 5 × 10^n dollars. */
export function niceTicks(minCents: number, maxCents: number, count = 4): number[] {
  const span = Math.max(maxCents - minCents, 100);
  const rough = span / count;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((factor) => factor * power).find((candidate) => candidate >= rough) ?? 10 * power;
  const start = Math.floor(minCents / step) * step;
  const ticks: number[] = [];
  for (let value = start; value <= maxCents + step * 0.001; value += step) ticks.push(Math.round(value));
  if (ticks[ticks.length - 1] < maxCents) ticks.push(ticks[ticks.length - 1] + Math.round(step));
  return ticks;
}

/** Axis label: $0, $500, $1.5K, $12K. Display only. */
export function compactCad(cents: number): string {
  const dollars = cents / 100;
  const sign = dollars < 0 ? "−" : "";
  const absolute = Math.abs(dollars);
  if (absolute >= 1000) return `${sign}$${(absolute / 1000).toFixed(absolute % 1000 === 0 ? 0 : 1)}K`;
  return `${sign}$${absolute.toFixed(0)}`;
}

/** Column with a 4px rounded data-end and a square baseline (works up or down). */
function columnPath(x: number, width: number, yValue: number, yBase: number): string {
  const height = Math.abs(yBase - yValue);
  if (height < 0.5) return "";
  const r = Math.min(4, width / 2, height);
  if (yValue <= yBase) {
    return `M${x},${yBase}V${yValue + r}Q${x},${yValue} ${x + r},${yValue}H${x + width - r}Q${x + width},${yValue} ${x + width},${yValue + r}V${yBase}Z`;
  }
  return `M${x},${yBase}V${yValue - r}Q${x},${yValue} ${x + r},${yValue}H${x + width - r}Q${x + width},${yValue} ${x + width},${yValue - r}V${yBase}Z`;
}

function monthLabel(month: string, withYear = false) {
  const short = new Intl.DateTimeFormat("en-CA", { month: "short", timeZone: "UTC" }).format(new Date(`${month}T00:00:00Z`)).replace(".", "");
  return withYear ? `${short} ’${month.slice(2, 4)}` : short;
}

function LegendItem({ kind, colour, label }: { kind: "bar" | "line" | "reference"; colour: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
      {kind === "bar" ? <span className="size-2.5 rounded-[3px]" style={{ background: colour }} aria-hidden="true" /> : <span className={cn("h-0.5 w-4 rounded-full", kind === "reference" && "opacity-80")} style={{ background: colour }} aria-hidden="true" />}
      {label}
    </span>
  );
}

function TableToggle({ showTable, onToggle, controls }: { showTable: boolean; onToggle: () => void; controls: string }) {
  return (
    <button type="button" onClick={onToggle} aria-expanded={showTable} aria-controls={controls} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-ink-muted transition-colors hover:bg-sage-soft hover:text-ink">
      <Table2 className="size-3.5" aria-hidden="true" />{showTable ? "Show chart" : "Show table"}
    </button>
  );
}

function Tooltip({ x, width, children }: { x: number; width: number; children: React.ReactNode }) {
  const flip = x > width - 170;
  return (
    <div role="status" className="pointer-events-none absolute top-1 z-10 min-w-40 rounded-xl border border-line bg-surface px-3 py-2 text-xs shadow-[var(--shadow-raised)]" style={flip ? { right: Math.max(4, width - x + 10) } : { left: Math.max(4, x + 10) }}>
      {children}
    </div>
  );
}

function TooltipRow({ colour, kind = "line", label, value }: { colour: string; kind?: "line" | "bar"; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-0.5">
      <span className="flex items-center gap-1.5 text-ink-subtle"><span className={kind === "bar" ? "size-2 rounded-[2px]" : "h-0.5 w-3 rounded-full"} style={{ background: colour }} aria-hidden="true" />{label}</span>
      <span className="tabular font-semibold text-ink">{value}</span>
    </div>
  );
}

// ------------------------------------------------------------------ cash flow by month

export function CashFlowChart({ months, selectedMonth, onSelectMonth, height = 240, labelSelected = true }: { months: HistoryMonth[]; selectedMonth?: string; onSelectMonth?: (month: string) => void; height?: number; labelSelected?: boolean }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  const tableId = useId();
  const margin = { top: 18, right: 8, bottom: 26, left: 46 };
  const plotW = Math.max(0, width - margin.left - margin.right);
  const plotH = height - margin.top - margin.bottom;

  const scale = useMemo(() => {
    const max = Math.max(0, ...months.flatMap((row) => [row.income_cents, row.spending_cents, row.cash_flow_cents]));
    const min = Math.min(0, ...months.map((row) => row.cash_flow_cents));
    const ticks = niceTicks(min, max);
    return { ticks, low: ticks[0], high: ticks[ticks.length - 1] };
  }, [months]);
  const y = (cents: number) => margin.top + (plotH * (scale.high - cents)) / (scale.high - scale.low || 1);
  const band = months.length ? plotW / months.length : 0;
  const barW = Math.max(3, Math.min(24, (band * 0.62 - 2) / 2));
  const centre = (index: number) => margin.left + band * index + band / 2;
  const showEvery = band < 34 ? 2 : 1;
  const selectedIndex = months.findIndex((row) => row.month === selectedMonth);
  const labelIndex = labelSelected ? (selectedIndex >= 0 ? selectedIndex : months.length - 1) : -1;
  const linePoints = months.map((row, index) => `${centre(index)},${y(row.cash_flow_cents)}`).join(" ");
  const summary = months.length ? `Money in and out for ${months.length} months, ${monthLabel(months[0].month, true)} to ${monthLabel(months[months.length - 1].month, true)}.` : "No months to show.";

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <LegendItem kind="bar" colour="var(--chart-in)" label="Money in" />
          <LegendItem kind="bar" colour="var(--chart-out)" label="Money out" />
          <LegendItem kind="line" colour="var(--chart-net)" label="Kept (in minus out)" />
        </div>
        <TableToggle showTable={showTable} onToggle={() => setShowTable(!showTable)} controls={tableId} />
      </div>
      {showTable ? (
        <div id={tableId} className="relative overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">{summary}</caption>
            <thead><tr className="text-left text-xs text-ink-subtle"><th scope="col" className="py-2 font-semibold">Month</th><th scope="col" className="py-2 text-right font-semibold">Money in</th><th scope="col" className="py-2 text-right font-semibold">Money out</th><th scope="col" className="py-2 text-right font-semibold">Kept</th></tr></thead>
            <tbody>{months.map((row) => <tr key={row.month} className="border-t border-line"><th scope="row" className="py-2 text-left font-medium text-ink">{monthLabel(row.month, true)}</th><td className="tabular py-2 text-right">{cad(row.income_cents)}</td><td className="tabular py-2 text-right">{cad(row.spending_cents)}</td><td className={cn("tabular py-2 text-right font-semibold", row.cash_flow_cents < 0 && "text-danger")}>{cad(row.cash_flow_cents)}</td></tr>)}</tbody>
          </table>
        </div>
      ) : (
        <div ref={ref} id={tableId} className="relative" style={{ height }} onPointerLeave={() => setActive(null)}>
          {width > 0 && (
            <svg width={width} height={height} role="img" aria-label={summary} className="block overflow-visible">
              {scale.ticks.map((tick) => (
                <g key={tick}>
                  <line x1={margin.left} x2={width - margin.right} y1={y(tick)} y2={y(tick)} stroke={tick === 0 ? "var(--chart-axis)" : "var(--chart-grid)"} strokeWidth={1} shapeRendering="crispEdges" />
                  <text x={margin.left - 8} y={y(tick)} dy="0.32em" textAnchor="end" className="tabular fill-ink-subtle text-[11px]">{compactCad(tick)}</text>
                </g>
              ))}
              {months.map((row, index) => {
                const highlighted = index === active || index === selectedIndex;
                const x = centre(index);
                return (
                  <g key={row.month}>
                    {highlighted && <rect x={x - band / 2 + 2} y={margin.top - 10} width={band - 4} height={plotH + 10} rx={8} className={index === active ? "fill-sage" : "fill-sage-soft"} />}
                    <path d={columnPath(x - barW - 1, barW, y(row.income_cents), y(0))} fill="var(--chart-in)" />
                    <path d={columnPath(x + 1, barW, y(row.spending_cents), y(0))} fill="var(--chart-out)" />
                    {index === labelIndex && barW >= 14 && (
                      <>
                        <text x={x - barW / 2 - 1} y={y(row.income_cents) - 5} textAnchor="middle" className="tabular fill-ink-muted text-[10px] font-semibold">{compactCad(row.income_cents)}</text>
                        <text x={x + barW / 2 + 1} y={y(row.spending_cents) - 5} textAnchor="middle" className="tabular fill-ink-muted text-[10px] font-semibold">{compactCad(row.spending_cents)}</text>
                      </>
                    )}
                    {index % showEvery === 0 && <text x={x} y={height - 6} textAnchor="middle" className={cn("text-[11px]", index === selectedIndex ? "fill-ink font-semibold" : "fill-ink-subtle")}>{monthLabel(row.month, index === 0 || row.month.endsWith("-01-01"))}</text>}
                  </g>
                );
              })}
              <polyline points={linePoints} fill="none" stroke="var(--chart-net)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              {months.map((row, index) => <circle key={row.month} cx={centre(index)} cy={y(row.cash_flow_cents)} r={4} fill="var(--chart-net)" stroke="var(--color-surface)" strokeWidth={2} />)}
              {months.map((row, index) => (
                <rect
                  key={`hit-${row.month}`}
                  x={centre(index) - band / 2}
                  y={margin.top - 10}
                  width={band}
                  height={plotH + margin.bottom + 10}
                  fill="transparent"
                  tabIndex={0}
                  role={onSelectMonth ? "button" : undefined}
                  aria-label={`${monthLabel(row.month, true)}: money in ${cad(row.income_cents)}, money out ${cad(row.spending_cents)}, kept ${cad(row.cash_flow_cents)}${onSelectMonth ? ". Open this month" : ""}`}
                  className={cn("outline-none", onSelectMonth && "cursor-pointer")}
                  onPointerEnter={() => setActive(index)}
                  onFocus={() => setActive(index)}
                  onBlur={() => setActive(null)}
                  onClick={() => onSelectMonth?.(row.month)}
                  onKeyDown={(event) => { if (onSelectMonth && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); onSelectMonth(row.month); } }}
                />
              ))}
            </svg>
          )}
          {active !== null && months[active] && (
            <Tooltip x={centre(active)} width={width}>
              <p className="mb-1 font-semibold text-ink">{monthLabel(months[active].month, true)}</p>
              <TooltipRow kind="bar" colour="var(--chart-in)" label="Money in" value={cad(months[active].income_cents)} />
              <TooltipRow kind="bar" colour="var(--chart-out)" label="Money out" value={cad(months[active].spending_cents)} />
              <TooltipRow colour="var(--chart-net)" label="Kept" value={cad(months[active].cash_flow_cents)} />
              {onSelectMonth && <p className="mt-1 text-[11px] text-ink-subtle">Click to open this month</p>}
            </Tooltip>
          )}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ categories

/** Fixed colour slot per spending category, in the API's category order (never by rank). */
export function categoryColours(categories: Category[]): (categoryId: string | null) => string {
  const slots = new Map(categories.filter((category) => category.kind === "spending" && !category.parent_id).map((category, index) => [category.id, index < 7 ? `var(--chart-cat-${index + 1})` : "var(--chart-other)"]));
  return (categoryId) => (categoryId && slots.get(categoryId)) || "var(--chart-other)";
}

/** Ranked category spending: one bar colour (magnitude), identity from the swatch beside the label. */
export function CategoryBars({ items, colourFor, limit }: { items: CategorySpending[]; colourFor: (id: string | null) => string; limit?: number }) {
  const shown = limit ? items.slice(0, limit) : items;
  const largest = shown[0]?.spent_cents ?? 0;
  return (
    <ul className="space-y-3">
      {shown.map((item) => (
        <li key={item.category_id ?? "none"}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="flex min-w-0 items-center gap-2 text-ink"><span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: colourFor(item.category_id) }} aria-hidden="true" /><span className="truncate">{item.category_name}</span></span>
            <span className="tabular whitespace-nowrap font-semibold text-ink">{cad(item.spent_cents)} <span className="font-normal text-ink-subtle">· {(item.share_basis_points / 100).toFixed(1)}%</span></span>
          </div>
          <div className="mt-1.5 h-2 rounded-full bg-sage-soft" aria-hidden="true">
            <div className="h-full rounded-full bg-accent transition-[width] duration-500 ease-out" style={{ width: `${largest ? Math.max(2, (item.spent_cents / largest) * 100) : 0}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

// ------------------------------------------------------------------ monthly series (Charts tab)

export type MonthSeries = { key: string; label: string; colour: string; values: number[]; kind: "bar" | "line"; visible: boolean };

/**
 * Months along the bottom; bars (side by side, or stacked) and lines on one cents axis. The
 * legend doubles as the field picker: each entry turns its series on or off. Hover or focus a
 * month for every visible series' value; the table view lists them all.
 */
export function MonthlyChart({ months, series, stacked = false, onToggle, height = 260, totalLabel }: { months: string[]; series: MonthSeries[]; stacked?: boolean; onToggle: (key: string) => void; height?: number; totalLabel?: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  const tableId = useId();
  const margin = { top: 14, right: 8, bottom: 26, left: 46 };
  const plotW = Math.max(0, width - margin.left - margin.right);
  const plotH = height - margin.top - margin.bottom;
  const bars = series.filter((item) => item.kind === "bar" && item.visible);
  const lines = series.filter((item) => item.kind === "line" && item.visible);

  const scale = useMemo(() => {
    const values: number[] = [0];
    if (stacked) months.forEach((_, index) => values.push(bars.reduce((sum, item) => sum + Math.max(0, item.values[index] ?? 0), 0)));
    else bars.forEach((item) => values.push(...item.values));
    lines.forEach((item) => values.push(...item.values));
    const ticks = niceTicks(Math.min(...values), Math.max(...values));
    return { ticks, low: ticks[0], high: ticks[ticks.length - 1] };
  }, [months, bars, lines, stacked]);
  const y = (cents: number) => margin.top + (plotH * (scale.high - cents)) / (scale.high - scale.low || 1);
  const band = months.length ? plotW / months.length : 0;
  const groupW = Math.min(stacked ? 28 : 56, band * 0.7);
  const barW = stacked ? Math.max(3, groupW) : Math.max(3, Math.min(24, (groupW - 2 * Math.max(0, bars.length - 1)) / Math.max(1, bars.length)));
  const centre = (index: number) => margin.left + band * index + band / 2;
  const showEvery = band < 30 ? Math.ceil(30 / Math.max(band, 1)) : 1;
  const label = (index: number) => monthLabel(months[index], index === 0 || months[index].endsWith("-01-01"));
  const summary = months.length ? `${series.filter((s) => s.visible).map((s) => s.label).join(", ")} for ${months.length} months, ${label(0)} to ${monthLabel(months[months.length - 1], true)}.` : "No months to show.";
  const visible = series.filter((item) => item.visible);
  const total = (index: number) => bars.reduce((sum, item) => sum + (item.values[index] ?? 0), 0);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Fields to show">
          {series.map((item) => (
            <button key={item.key} type="button" aria-pressed={item.visible} onClick={() => onToggle(item.key)} className={cn("inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-colors", item.visible ? "border-line-strong bg-surface text-ink" : "border-dashed border-line text-ink-subtle line-through decoration-ink-subtle/60")}>
              {item.kind === "bar" ? <span className="size-2.5 rounded-[3px]" style={{ background: item.visible ? item.colour : "var(--chart-grid)" }} aria-hidden="true" /> : <span className="h-0.5 w-4 rounded-full" style={{ background: item.visible ? item.colour : "var(--chart-grid)" }} aria-hidden="true" />}
              {item.label}
            </button>
          ))}
        </div>
        <TableToggle showTable={showTable} onToggle={() => setShowTable(!showTable)} controls={tableId} />
      </div>
      {visible.length === 0 ? (
        <p className="grid place-items-center rounded-xl bg-sage-soft text-sm text-ink-subtle" style={{ height }}>Turn on a field above to see it here.</p>
      ) : showTable ? (
        <div id={tableId} className="relative max-h-[22rem] overflow-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">{summary}</caption>
            <thead className="sticky top-0 bg-surface"><tr className="text-left text-xs text-ink-subtle"><th scope="col" className="py-2 pr-3 font-semibold">Month</th>{visible.map((item) => <th key={item.key} scope="col" className="whitespace-nowrap py-2 pl-3 text-right font-semibold">{item.label}</th>)}{stacked && totalLabel && <th scope="col" className="py-2 pl-3 text-right font-semibold">{totalLabel}</th>}</tr></thead>
            <tbody>{months.map((month, index) => <tr key={month} className="border-t border-line"><th scope="row" className="whitespace-nowrap py-2 pr-3 text-left font-medium text-ink">{monthLabel(month, true)}</th>{visible.map((item) => <td key={item.key} className={cn("tabular py-2 pl-3 text-right", (item.values[index] ?? 0) < 0 && "text-danger")}>{cad(item.values[index] ?? 0)}</td>)}{stacked && totalLabel && <td className="tabular py-2 pl-3 text-right font-semibold">{cad(total(index))}</td>}</tr>)}</tbody>
          </table>
        </div>
      ) : (
        <div ref={ref} id={tableId} className="relative" style={{ height }} onPointerLeave={() => setActive(null)}>
          {width > 0 && (
            <svg width={width} height={height} role="img" aria-label={summary} className="block overflow-visible">
              {scale.ticks.map((tick) => (
                <g key={tick}>
                  <line x1={margin.left} x2={width - margin.right} y1={y(tick)} y2={y(tick)} stroke={tick === 0 ? "var(--chart-axis)" : "var(--chart-grid)"} strokeWidth={1} shapeRendering="crispEdges" />
                  <text x={margin.left - 8} y={y(tick)} dy="0.32em" textAnchor="end" className="tabular fill-ink-subtle text-[11px]">{compactCad(tick)}</text>
                </g>
              ))}
              {months.map((month, index) => {
                const x = centre(index);
                let stackTop = 0;
                return (
                  <g key={month}>
                    {index === active && <rect x={x - band / 2 + 2} y={margin.top - 8} width={band - 4} height={plotH + 8} rx={8} className="fill-sage-soft" />}
                    {bars.map((item, position) => {
                      const value = Math.max(0, item.values[index] ?? 0);
                      if (stacked) {
                        const base = stackTop;
                        stackTop += value;
                        if (!value) return null;
                        // Each segment sits 2px apart (surface gap); only the top one gets rounded ends.
                        const top = y(base + value);
                        const bottom = y(base) - (base > 0 ? 2 : 0);
                        const isTop = bars.slice(position + 1).every((next) => !(next.values[index] ?? 0));
                        return isTop
                          ? <path key={item.key} d={columnPath(x - barW / 2, barW, top, bottom)} fill={item.colour} />
                          : <rect key={item.key} x={x - barW / 2} y={top} width={barW} height={Math.max(0, bottom - top)} fill={item.colour} />;
                      }
                      const left = x - groupW / 2 + position * (barW + 2) + (groupW - (bars.length * barW + (bars.length - 1) * 2)) / 2;
                      return <path key={item.key} d={columnPath(left, barW, y(item.values[index] ?? 0), y(0))} fill={item.colour} />;
                    })}
                    {index % showEvery === 0 && <text x={x} y={height - 6} textAnchor="middle" className="fill-ink-subtle text-[11px]">{label(index)}</text>}
                  </g>
                );
              })}
              {lines.map((item) => (
                <g key={item.key}>
                  <polyline points={months.map((_, index) => `${centre(index)},${y(item.values[index] ?? 0)}`).join(" ")} fill="none" stroke={item.colour} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={item.key === "budget" ? "5 4" : undefined} />
                  {months.length <= 13 && months.map((month, index) => <circle key={month} cx={centre(index)} cy={y(item.values[index] ?? 0)} r={4} fill={item.colour} stroke="var(--color-surface)" strokeWidth={2} />)}
                </g>
              ))}
              {months.map((month, index) => (
                <rect key={`hit-${month}`} x={centre(index) - band / 2} y={margin.top - 8} width={band} height={plotH + margin.bottom + 8} fill="transparent" tabIndex={0}
                  aria-label={`${monthLabel(month, true)}: ${visible.map((item) => `${item.label} ${cad(item.values[index] ?? 0)}`).join(", ")}`}
                  className="outline-none" onPointerEnter={() => setActive(index)} onFocus={() => setActive(index)} onBlur={() => setActive(null)} />
              ))}
            </svg>
          )}
          {active !== null && months[active] && (
            <Tooltip x={centre(active)} width={width}>
              <p className="mb-1 font-semibold text-ink">{monthLabel(months[active], true)}</p>
              {[...visible].reverse().map((item) => <TooltipRow key={item.key} kind={item.kind} colour={item.colour} label={item.label} value={cad(item.values[active] ?? 0)} />)}
              {stacked && totalLabel && <div className="mt-1 border-t border-line pt-1"><TooltipRow kind="bar" colour="transparent" label={totalLabel} value={cad(total(active))} /></div>}
            </Tooltip>
          )}
        </div>
      )}
    </div>
  );
}
