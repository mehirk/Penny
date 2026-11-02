"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "@/components/ui/toast";
import { type Dashboard, dashboardApi } from "@/lib/api";
import { addMonths } from "@/lib/format";
import type { InlineCreate } from "./inline-create";
import { monthEnd, type PeriodRange } from "./period-picker";
import { describeError } from "./shared";
import { withViewTransition } from "./subpage";

export type ToastMessage = { title: string; description?: string; action?: { label: string; onClick: () => void } };
export type Undo = { label: string; run: () => Promise<Dashboard>; done: string };
/** Runs an API mutation, shows a success toast, and resolves to an error message (or null). */
export type Mutate = (action: () => Promise<Dashboard>, success: string | ((data: Dashboard) => ToastMessage), undo?: Undo) => Promise<string | null>;

const periodKey = (range: PeriodRange) => `${range.start}|${range.end}`;
const monthPeriod = (month: string): PeriodRange => ({ start: month, end: monthEnd(month) });
const isMonthPeriod = (range: PeriodRange) => range.start.endsWith("-01") && range.end === monthEnd(range.start);

/**
 * The dashboard on screen and every way it changes: the first load, moving between periods,
 * refreshing, and applying the fresh snapshot each edit returns. Every figure comes from the API.
 */
export function useDashboard() {
  const toast = useToast();
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [monthLoading, setMonthLoading] = useState(false);
  // Bumped after any edit so views with their own requests (history, charts) refetch.
  const [historyVersion, setHistoryVersion] = useState(0);
  const [loadError, setLoadError] = useState<ReturnType<typeof describeError> | null>(null);
  // Snapshots already fetched this session, keyed by period, so going back and forth feels instant.
  const cache = useRef(new Map<string, Dashboard>());
  const latestPeriodRequest = useRef<string | null>(null);
  const currentPeriod = useRef<PeriodRange | null>(null);
  useEffect(() => { currentPeriod.current = dashboard?.period ?? null; }, [dashboard]);

  const remember = useCallback((data: Dashboard) => { cache.current.set(periodKey(data.period), data); return data; }, []);

  const prefetch = useCallback((month: string, earliest: string) => {
    if (month < earliest || cache.current.has(periodKey(monthPeriod(month)))) return;
    dashboardApi.load(month).then(remember).catch(() => undefined);
  }, [remember]);

  useEffect(() => {
    let active = true;
    dashboardApi.load()
      .then((data) => { if (active) { setDashboard(remember(data)); prefetch(addMonths(data.active_month, -1), data.data_months[0] ?? data.active_month); } })
      .catch((reason: unknown) => { if (active) setLoadError(describeError(reason, "Penny couldn’t load")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [prefetch, remember]);

  /** Tries the first load again after it failed. */
  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setDashboard(remember(await dashboardApi.load()));
    } catch (reason) {
      setLoadError(describeError(reason, "Penny couldn’t load"));
    } finally {
      setLoading(false);
    }
  }, [remember]);

  /** Shows a period immediately from cache (if seen before), then refreshes it from the API. */
  const goToPeriod = useCallback((range: PeriodRange) => {
    if (!dashboard) return;
    const key = periodKey(range);
    if (key === periodKey(dashboard.period) && !monthLoading) return;
    const single = isMonthPeriod(range);
    latestPeriodRequest.current = key;
    const cached = cache.current.get(key);
    if (cached) withViewTransition(() => setDashboard(cached));
    setMonthLoading(true);
    (single ? dashboardApi.load(range.start) : dashboardApi.loadPeriod(range.start, range.end))
      .then((data) => {
        remember(data);
        if (latestPeriodRequest.current !== key) return;
        setDashboard(data);
        if (single) prefetch(addMonths(range.start, -1), data.data_months[0] ?? range.start);
      })
      .catch((reason: unknown) => {
        if (latestPeriodRequest.current !== key) return;
        const error = describeError(reason, "That period couldn’t load");
        toast({ title: error.title, description: error.detail, tone: "error" });
      })
      .finally(() => { if (latestPeriodRequest.current === key) setMonthLoading(false); });
  }, [dashboard, monthLoading, prefetch, remember, toast]);

  const goToMonth = useCallback((month: string) => {
    if (!dashboard) return;
    const earliest = dashboard.data_months[0] ?? month;
    if (month < earliest || month > dashboard.current_month) return;
    goToPeriod(monthPeriod(month));
  }, [dashboard, goToPeriod]);

  /**
   * Applies a fresh snapshot after an edit. Edits return a one-month snapshot, so when a longer
   * period is on screen it is reloaded; other cached periods and charts are refreshed.
   */
  const applyChange = useCallback((data: Dashboard) => {
    cache.current.clear();
    setHistoryVersion((value) => value + 1);
    const shown = currentPeriod.current;
    if (shown && !isMonthPeriod(shown)) {
      dashboardApi.loadPeriod(shown.start, shown.end).then((range) => setDashboard(remember(range))).catch(() => setDashboard(remember(data)));
      return;
    }
    setDashboard(remember(data));
  }, [remember]);

  /** Reloads the period on screen (pull to refresh in the iOS app). */
  const refresh = useCallback(async () => {
    const shown = currentPeriod.current;
    try {
      const data = shown && !isMonthPeriod(shown) ? await dashboardApi.loadPeriod(shown.start, shown.end) : await dashboardApi.load(shown?.start);
      cache.current.clear();
      setHistoryVersion((value) => value + 1);
      setDashboard(remember(data));
    } catch (reason) {
      const error = describeError(reason, "Penny couldn’t refresh");
      toast({ title: error.title, description: error.detail, tone: "error" });
    }
  }, [remember, toast]);

  /** Creates something from inside a form (a category, an account) and returns the new snapshot. */
  const createInline = useCallback<InlineCreate>(async (action) => {
    try {
      const data = await action();
      applyChange(data);
      return data;
    } catch (reason) {
      return describeError(reason, "That couldn’t be created").detail;
    }
  }, [applyChange]);

  /** Runs an API mutation; shows a toast on success and returns an error message on failure. */
  const mutate = useCallback<Mutate>(async (action, success, undo) => {
    try {
      const data = await action();
      applyChange(data);
      const message = typeof success === "string" ? { title: success } : success(data);
      toast({
        ...message,
        action: message.action ?? (undo && {
          label: undo.label,
          onClick: () => {
            undo.run().then((next) => { applyChange(next); toast({ title: undo.done }); })
              .catch((reason: unknown) => { const error = describeError(reason, "Couldn’t undo"); toast({ title: error.title, description: error.detail, tone: "error" }); });
          },
        }),
      });
      return null;
    } catch (reason) {
      return describeError(reason, "That change couldn’t be saved").detail;
    }
  }, [applyChange, toast]);

  return { dashboard, loading, monthLoading, loadError, historyVersion, reload, goToPeriod, goToMonth, applyChange, refresh, createInline, mutate };
}
