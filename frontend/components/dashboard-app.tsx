"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import Link from "next/link";
import { Bot, CloudOff, LogIn, RefreshCw } from "lucide-react";
import { DisplaySettingsDialog, MobileNavigation, PageHeader, Sidebar } from "@/components/penny/app-shell";
import { SettingsView } from "@/components/penny/settings-view";
import { Onboarding } from "@/components/penny/onboarding";
import { slide } from "@/components/penny/subpage";
import { CoachView, useCoachChat } from "@/components/penny/coach-view";
import { AddMoneyDialog, BudgetDialog, ConfirmDialog, type ConfirmRequest, GoalDialog, type InlineCreate, TransactionDialog } from "@/components/penny/dialogs";
import { AccountsView } from "@/components/penny/accounts-view";
import { GoalsView } from "@/components/penny/goals-view";
import { ChartsView } from "./penny/charts-view";
import { BudgetsView } from "@/components/penny/budgets-view";
import { LearnView } from "@/components/penny/learn-view";
import type { BillInput } from "@/components/penny/recurring-view";
import { type SpendingTab, SpendingView } from "@/components/penny/spending-view";
import { TodayView } from "@/components/penny/today-view";
import { monthEnd, type PeriodRange } from "@/components/penny/period-picker";
import { usePreferences } from "@/components/penny/preferences";
import { PullToRefresh } from "@/components/penny/pull-to-refresh";
import { cad, describeError, MENU, NAVIGATION, type View } from "@/components/penny/shared";
import { Button, buttonVariants } from "@/components/ui/button";
import { ToastProvider, useToast } from "@/components/ui/toast";
import { type Bill, type Budget, type BudgetSuggestion, type Dashboard, dashboardApi, type Mission, type SavingsGoal, type Transaction } from "@/lib/api";
import { setAppSignedIn } from "@/lib/face-id";
import { addMonths, formatMonth } from "@/lib/format";
import { cn } from "@/lib/utils";

export function DashboardApp() {
  return <ToastProvider><PennyApp /></ToastProvider>;
}

const periodKey = (range: PeriodRange) => `${range.start}|${range.end}`;
const monthPeriod = (month: string): PeriodRange => ({ start: month, end: monthEnd(month) });
const isMonthPeriod = (range: PeriodRange) => range.start.endsWith("-01") && range.end === monthEnd(range.start);

const isView = (value: string): value is View => NAVIGATION.some((item) => item.id === value);
/** True when keys should go to a form field. A field inside a dialog that is closing doesn't count. */
const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  !target.closest("[role=dialog][data-state=closed]") &&
  (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

/** Scrolls to a section once it has rendered, and rings it briefly so the eye lands on it. */
function spotlight(id: string, attempt = 0) {
  const element = document.getElementById(id);
  if (!element) {
    if (attempt < 20) window.setTimeout(() => spotlight(id, attempt + 1), 100);
    return;
  }
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  element.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  element.classList.remove("penny-spotlight");
  void element.offsetWidth;
  element.classList.add("penny-spotlight");
  window.setTimeout(() => element.classList.remove("penny-spotlight"), 1800);
}

/** Runs a UI update inside a view transition where supported (and motion is allowed). */
function withViewTransition(update: () => void) {
  // After a back swipe (see BackBar) the page has already slid away by hand. The default
  // transition is a short cross-fade, which suits Reduce Motion too.
  if ("swiping" in document.documentElement.dataset || !("startViewTransition" in document)) { update(); return; }
  const transition = document.startViewTransition(() => flushSync(update));
  // The browser cancels the animation if the viewport changes mid-switch (a resize, the phone
  // keyboard opening). The view still updates; only the cross-fade is skipped, so swallow it.
  const ignore = () => undefined;
  transition.ready.catch(ignore);
  transition.finished.catch(ignore);
  transition.updateCallbackDone.catch(ignore);
}

/** Single-key shortcuts, ignored while typing in a field or while a dialog is open. */
function useKeyboardShortcuts(shortcuts: Record<string, () => void>) {
  const latest = useRef(shortcuts);
  useEffect(() => { latest.current = shortcuts; });
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
      if (document.querySelector("[role=dialog][data-state=open]")) return;
      const run = latest.current[event.key.toLowerCase()];
      if (!run) return;
      event.preventDefault();
      run();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

type ToastMessage = { title: string; description?: string; action?: { label: string; onClick: () => void } };
type Undo = { label: string; run: () => Promise<Dashboard>; done: string };
/** Runs an API mutation, shows a success toast, and resolves to an error message (or null). */
type Mutate = (action: () => Promise<Dashboard>, success: string | ((data: Dashboard) => ToastMessage), undo?: Undo) => Promise<string | null>;

/** A confirmed delete whose toast offers Undo by re-creating the record. */
function deleteConfirmation(mutate: Mutate, options: { title: string; description: string; confirmLabel: string; remove: () => Promise<Dashboard>; restore: () => Promise<Dashboard>; noun: string }): ConfirmRequest {
  return {
    title: options.title,
    description: `${options.description} You can undo this right after.`,
    confirmLabel: options.confirmLabel,
    onConfirm: () => mutate(options.remove, `${options.noun} deleted`, { label: "Undo", run: options.restore, done: `${options.noun} restored` }),
  };
}

function PennyApp() {
  const toast = useToast();
  const coachChat = useCoachChat();
  const { resolvedTheme, setTheme } = usePreferences();
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [view, setView] = useState<View>("today");
  const [spendingTab, setSpendingTab] = useState<SpendingTab>("transactions");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [monthLoading, setMonthLoading] = useState(false);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [loadError, setLoadError] = useState<ReturnType<typeof describeError> | null>(null);
  const [transactionTarget, setTransactionTarget] = useState<Transaction | "new" | null>(null);
  // First-run setup for new real accounts. Each step can be skipped, but not the whole setup;
  // a device that skipped it under the old "Skip for now" still opens on Home with a Set up card.
  const [setupSkipped] = useState(() => {
    try { return typeof window !== "undefined" && window.localStorage.getItem("penny-setup-skipped") === "1"; } catch { return false; }
  });
  const [setupOpen, setSetupOpen] = useState(false);

  const [budgetTarget, setBudgetTarget] = useState<Budget | "new" | null>(null);
  const [goalTarget, setGoalTarget] = useState<SavingsGoal | "new" | null>(null);
  const [addMoneyTarget, setAddMoneyTarget] = useState<SavingsGoal | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [displayOpen, setDisplayOpen] = useState(false);
  // Snapshots already fetched this session, keyed by period, so going back and forth feels instant.
  const cache = useRef(new Map<string, Dashboard>());
  const latestPeriodRequest = useRef<string | null>(null);
  const currentPeriod = useRef<PeriodRange | null>(null);
  useEffect(() => { currentPeriod.current = dashboard?.period ?? null; }, [dashboard]);
  // Signed in and the dashboard is showing: with Face ID on, the iPhone app now locks when it leaves the screen.
  const loaded = dashboard !== null;
  useEffect(() => { if (loaded) setAppSignedIn(true); }, [loaded]);

  const remember = useCallback((data: Dashboard) => { cache.current.set(periodKey(data.period), data); return data; }, []);

  const prefetch = useCallback((month: string, earliest: string) => {
    if (month < earliest || cache.current.has(periodKey(monthPeriod(month)))) return;
    dashboardApi.load(month).then(remember).catch(() => undefined);
  }, [remember]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = remember(await dashboardApi.load());
      setDashboard(data);
    } catch (reason) {
      setLoadError(describeError(reason, "Penny couldn’t load"));
    } finally {
      setLoading(false);
    }
  }, [remember]);

  useEffect(() => {
    const fromHash = () => {
      // "#settings/appearance" opens a page inside a view; the view is the part before "/".
      const hash = window.location.hash.slice(1).split("/")[0];
      // Recurring lives inside Spending; old #recurring links open that tab.
      if (hash === "recurring") { setSpendingTab("recurring"); setView("spending"); }
      else if (isView(hash)) setView(hash);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    let active = true;
    dashboardApi.load()
      .then((data) => { if (active) { setDashboard(remember(data)); prefetch(addMonths(data.active_month, -1), data.data_months[0] ?? data.active_month); } })
      .catch((reason: unknown) => { if (active) setLoadError(describeError(reason, "Penny couldn’t load")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; window.removeEventListener("hashchange", fromHash); };
  }, [prefetch, remember]);

  /**
   * Opens a view; with `anchor`, scrolls to that section and briefly highlights it. `motion`
   * "push"/"pop" slides like an inner page (e.g. Home ⇄ Net worth) instead of cross-fading.
   */
  const navigate = useCallback((target: View, anchor?: string, motion?: "push" | "pop") => {
    const next = target === "recurring" ? "spending" : target;
    if (target === "recurring") setSpendingTab("recurring");
    else if (target === "spending" && anchor) setSpendingTab("transactions");
    if (motion) slide(motion, () => setView(next)); else withViewTransition(() => setView(next));
    // Settings and Home anchors are pages of their own ("#settings/accounts", "#today/safe"), not sections to scroll to.
    const ownPage = next === "settings" || next === "today";
    const page = ownPage && anchor ? `${next}/${anchor}` : next;
    if (window.location.hash !== `#${page}`) {
      window.history.pushState(null, "", `#${page}`);
      // pushState fires no event; views with pages of their own (Settings) listen for this.
      window.dispatchEvent(new Event("penny:navigate"));
    }
    window.scrollTo({ top: 0 });
    window.requestAnimationFrame(() => document.getElementById("page-title")?.focus({ preventScroll: true }));
    if (anchor && !ownPage) spotlight(anchor);
  }, []);

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

  const openMonth = useCallback((month: string) => {
    if (view !== "today") navigate("today");
    goToMonth(month);
  }, [goToMonth, navigate, view]);

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

  useKeyboardShortcuts(dashboard ? {
    n: () => setTransactionTarget("new"),
    "[": () => goToMonth(addMonths(dashboard.active_month, -1)),
    "]": () => goToMonth(addMonths(dashboard.active_month, 1)),
    d: () => setTheme(resolvedTheme === "dark" ? "light" : "dark"),
    "?": () => setDisplayOpen(true),
    ...Object.fromEntries(MENU.map((item, index) => [String(index + 1), () => navigate(item.id)])),
  } : {});

  if (loading && !dashboard) return <DashboardSkeleton />;
  if (!dashboard) return <LoadError error={loadError ?? { title: "Penny couldn’t load", detail: "", needsSignIn: false }} onRetry={() => void load()} />;

  const month = dashboard.active_month;

  const confirmDeleteTransaction = (item: Transaction) => {
    setTransactionTarget(null);
    setConfirm(deleteConfirmation(mutate, {
      title: "Delete this transaction?",
      description: `“${item.description}” will be removed and your totals will update.`,
      confirmLabel: "Delete transaction",
      noun: "Transaction",
      remove: () => dashboardApi.deleteTransaction(item.id, month),
      restore: () => dashboardApi.createTransaction({ description: item.description, account_id: item.account_id, category_id: item.category_id, amount_cents: item.amount_cents, kind: item.kind, occurred_on: item.occurred_on }, month),
    }));
  };
  const confirmDeleteBudget = (item: Budget) => {
    setBudgetTarget(null);
    setConfirm(deleteConfirmation(mutate, {
      title: `Delete the ${item.category_name} budget?`,
      description: "Your transactions stay; only the monthly limit is removed.",
      confirmLabel: "Delete budget",
      noun: "Budget",
      remove: () => dashboardApi.deleteBudget(item.id, month),
      restore: () => dashboardApi.createBudget({ category_id: item.category_id, month_start: item.month_start, limit_cents: item.limit_cents }, month),
    }));
  };
  const confirmDeleteGoal = (item: SavingsGoal) => {
    setGoalTarget(null);
    setConfirm(deleteConfirmation(mutate, {
      title: `Delete “${item.name}”?`,
      description: "This removes the goal and its progress.",
      confirmLabel: "Delete goal",
      noun: "Goal",
      remove: () => dashboardApi.deleteGoal(item.id, month),
      restore: () => dashboardApi.createGoal({ name: item.name, target_cents: item.target_cents, current_cents: item.current_cents, target_date: item.target_date, account_id: item.account_id }, month),
    }));
  };
  const copyBudgets = (fromMonth: string) => {
    void mutate(() => dashboardApi.copyBudgets(fromMonth, month), (data) => ({ title: "Budgets copied", description: `${formatMonth(month)} now has ${data.budgets.length} category limits.` }))
      .then((error) => { if (error) toast({ title: "Nothing to copy", description: error, tone: "error" }); });
  };
  /** Applies the budget suggestions the user ticked, one normal create/update call each. */
  const applyBudgetSuggestions = (forMonth: string, picked: BudgetSuggestion[]) =>
    mutate(async () => {
      let data: Dashboard | null = null;
      for (const item of picked) {
        data = item.budget_id
          ? await dashboardApi.updateBudget(item.budget_id, item.suggested_cents, month)
          : await dashboardApi.createBudget({ category_id: item.category_id, month_start: forMonth, limit_cents: item.suggested_cents }, month);
      }
      if (!data) throw new Error("Pick at least one budget");
      return data;
    }, `${picked.length} budget${picked.length === 1 ? "" : "s"} updated`);
  /** Applies an approved rebalance: every limit changes together, or none do. */
  const applyBudgetChanges = (changes: { budget_id: string; limit_cents: number }[]) =>
    mutate(() => dashboardApi.applyBudgetChanges(changes, month), "Budgets rebalanced");
  const completeMission = (mission: Mission) => {
    void mutate(() => dashboardApi.completeMission(mission.id, month), `Mission complete · +${mission.xp_reward} XP`)
      .then((error) => { if (error) toast({ title: "Couldn’t complete the mission", description: error, tone: "error" }); });
  };
  const markBillPaid = (bill: Bill) => {
    void mutate(() => dashboardApi.markBillPaid(bill.id, month), `${bill.name} paid`)
      .then((error) => { if (error) toast({ title: "Couldn’t update the bill", description: error, tone: "error" }); });
  };
  const saveBill = (id: string | null, body: BillInput) =>
    mutate(() => (id ? dashboardApi.updateBill(id, body, month) : dashboardApi.createBill(body, month)), id ? "Bill updated" : `${body.name} added`);
  const confirmDeleteBill = (bill: Bill) => {
    setConfirm(deleteConfirmation(mutate, {
      title: `Delete ${bill.name}?`,
      description: "It will stop appearing on your forecast. Past payments stay.",
      confirmLabel: "Delete bill",
      noun: "Bill",
      remove: () => dashboardApi.deleteBill(bill.id, month),
      restore: () => dashboardApi.createBill({ name: bill.name, amount_cents: bill.amount_cents, category_id: bill.category_id, account_id: bill.account_id, frequency: bill.frequency, next_due: bill.next_due, auto_record: bill.auto_record }, month),
    }));
  };

  /** Opens Penny AI and asks a question on the user's behalf (from a button elsewhere). */
  const askPenny = (question: string) => {
    navigate("ai");
    void coachChat.send(question);
  };
  if (dashboard.needs_onboarding && (setupOpen || !setupSkipped)) {
    return <Onboarding dashboard={dashboard} onDone={(data) => { setSetupOpen(false); applyChange(data); toast({ title: "Your plan is ready", description: "Change any budget from Spending › Budgets." }); }} />;
  }

  return (
    <div className="min-h-dvh">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[70] focus:rounded-xl focus:bg-surface focus:px-4 focus:py-3 focus:font-semibold focus:shadow-[var(--shadow-raised)]">Skip to content</a>
      <Sidebar active={view} dashboard={dashboard} collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed((value) => !value)} onNavigate={navigate} />
      <div className={cn("transition-[padding] duration-200", sidebarCollapsed ? "lg:pl-20" : "lg:pl-64")}>
        <PageHeader view={view} dashboard={dashboard} monthLoading={monthLoading} onChangePeriod={goToPeriod} onAddTransaction={() => setTransactionTarget("new")} />
        <main id="main" tabIndex={-1} className="mx-auto max-w-7xl px-4 pb-[calc(6.5rem+env(safe-area-inset-bottom))] pt-5 focus:outline-none sm:px-6 lg:px-10 lg:pb-12 lg:pt-8">
          {/* A period that isn't cached yet shows a skeleton until its data arrives, never stale numbers. */}
          {monthLoading && <PageSkeleton />}
          <div key={view} className={monthLoading ? "hidden" : "animate-fade"} aria-busy={monthLoading}>
            {view === "today" && <TodayView dashboard={dashboard} onNavigate={navigate} onAsk={askPenny} onEditTransaction={setTransactionTarget} onSetUp={() => setSetupOpen(true)} />}
            {view === "spending" && <SpendingView dashboard={dashboard} historyVersion={historyVersion} tab={spendingTab} onTabChange={setSpendingTab} recurring={{ onMarkPaid: markBillPaid, onSave: saveBill, onDelete: confirmDeleteBill }} onAsk={askPenny} onSelectMonth={goToMonth} onChangePeriod={goToPeriod} onAddTransaction={() => setTransactionTarget("new")} onEditTransaction={setTransactionTarget} onDeleteTransaction={confirmDeleteTransaction} />}
            {view === "accounts" && <AccountsView dashboard={dashboard} onNavigate={navigate} onAsk={askPenny} />}
            {view === "goals" && <GoalsView dashboard={dashboard} onAsk={askPenny} onAdd={() => setGoalTarget("new")} onEdit={setGoalTarget} onAddMoney={setAddMoneyTarget} onComplete={(goal) => void mutate(() => dashboardApi.updateGoal(goal.id, { status: "completed" }, month), `${goal.name} reached`)} />}
            {view === "charts" && <ChartsView dashboard={dashboard} />}
            {view === "budgets" && <BudgetsView dashboard={dashboard} onNavigate={navigate} onAddBudget={() => setBudgetTarget("new")} onEditBudget={setBudgetTarget} onCopyBudgets={copyBudgets} onApplyBudgets={applyBudgetSuggestions} onApplyBudgetChanges={applyBudgetChanges} />}
            {view === "learn" && <LearnView dashboard={dashboard} onCompleteMission={completeMission} onProgress={applyChange} onNavigate={navigate} onAsk={askPenny} />}
            {view === "ai" && <CoachView chat={coachChat} dashboard={dashboard} onDashboardChange={applyChange} onApproved={(message) => toast({ title: "Change applied", description: message })} />}
            {view === "settings" && <SettingsView dashboard={dashboard} save={mutate} />}
          </div>
        </main>
      </div>
      <MobileNavigation active={view} onNavigate={navigate} onAdd={view === "today" || view === "spending" ? () => setTransactionTarget("new") : undefined} />
      <PullToRefresh onRefresh={refresh} />
      {/* Desktop only: on phones Penny AI is in the tab bar, and a floating button covered content. */}
      {view !== "ai" && <button type="button" onClick={() => navigate("ai")} className="fixed bottom-6 right-6 z-20 hidden min-h-11 items-center gap-2 rounded-full bg-primary px-4 text-sm font-semibold text-on-primary shadow-[var(--shadow-raised)] transition-transform hover:-translate-y-0.5 motion-reduce:transform-none lg:inline-flex"><Bot className="size-4" />Ask Penny</button>}

      <EditDialogs
        dashboard={dashboard}
        mutate={mutate}
        onCreate={createInline}
        onOpenMonth={openMonth}
        transaction={[transactionTarget, setTransactionTarget, confirmDeleteTransaction]}
        budget={[budgetTarget, setBudgetTarget, confirmDeleteBudget]}
        goal={[goalTarget, setGoalTarget, confirmDeleteGoal]}
        addMoney={[addMoneyTarget, setAddMoneyTarget]}
      />
      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
      <DisplaySettingsDialog open={displayOpen} onOpenChange={setDisplayOpen} />
    </div>
  );
}

type DialogSlot<T> = [target: T | null, setTarget: (target: T | null) => void, requestDelete: (item: Exclude<T, "new">) => void];

/** The create/edit dialogs. Each submit resolves to an error message shown inside its dialog. */
function EditDialogs({ dashboard, mutate, onCreate, onOpenMonth, transaction, budget, goal, addMoney }: {
  dashboard: Dashboard;
  mutate: Mutate;
  onCreate: InlineCreate;
  onOpenMonth: (month: string) => void;
  transaction: DialogSlot<Transaction | "new">;
  budget: DialogSlot<Budget | "new">;
  goal: DialogSlot<SavingsGoal | "new">;
  addMoney: [target: SavingsGoal | null, setTarget: (target: SavingsGoal | null) => void];
}) {
  const month = dashboard.active_month;
  const [transactionTarget, setTransactionTarget, deleteTransaction] = transaction;
  const [budgetTarget, setBudgetTarget, deleteBudget] = budget;
  const [goalTarget, setGoalTarget, deleteGoal] = goal;
  const [addMoneyTarget, setAddMoneyTarget] = addMoney;

  /** Saves, then closes the dialog only if the API accepted the change. */
  async function saveAndClose(save: Promise<string | null>, close: () => void) {
    const error = await save;
    if (!error) close();
    return error;
  }

  function transactionSaved(id: string | null, occurredOn: string): ToastMessage {
    const otherMonth = occurredOn.slice(0, 7) === month.slice(0, 7) ? null : `${occurredOn.slice(0, 7)}-01`;
    const title = id ? "Transaction updated" : "Transaction added";
    if (!otherMonth || otherMonth > dashboard.current_month) return { title };
    return { title, description: `It’s dated in ${formatMonth(otherMonth)}.`, action: { label: `View ${formatMonth(otherMonth).split(" ")[0]}`, onClick: () => onOpenMonth(otherMonth) } };
  }

  function contributionSaved(goalItem: SavingsGoal, data: Dashboard): ToastMessage {
    const updated = data.savings_goals.find((item) => item.id === goalItem.id);
    if (!updated) return { title: `Added to ${goalItem.name}` };
    return { title: updated.status === "completed" ? `${goalItem.name} reached!` : `Added to ${goalItem.name}`, description: `Now saved: ${cad(updated.current_cents)} of ${cad(updated.target_cents)}.` };
  }

  return (
    <>
      <TransactionDialog
        target={transactionTarget}
        dashboard={dashboard}
        onCreate={onCreate}
        onClose={() => setTransactionTarget(null)}
        onRequestDelete={deleteTransaction}
        onSubmitMany={async (bodies) => {
          // One normal create call per transaction. If one fails, the ones before it are kept,
          // and the review list drops them so nothing is added twice.
          let saved = 0;
          const error = await mutate(async () => {
            let data: Dashboard | null = null;
            for (const body of bodies) { data = await dashboardApi.createTransaction(body, month); saved += 1; }
            if (!data) throw new Error("Nothing to add");
            return data;
          }, `${bodies.length} transaction${bodies.length === 1 ? "" : "s"} added`);
          if (error && saved > 0) await onCreate(() => dashboardApi.load(month));
          if (!error) setTransactionTarget(null);
          return { error, saved };
        }}
        onSubmit={(id, body) => saveAndClose(mutate(() => ("splits" in body ? dashboardApi.createSplitTransaction(body, month) : id ? dashboardApi.updateTransaction(id, body, month) : dashboardApi.createTransaction(body, month)), () => transactionSaved(id, body.occurred_on)), () => setTransactionTarget(null))}
      />
      <BudgetDialog
        target={budgetTarget}
        dashboard={dashboard}
        onClose={() => setBudgetTarget(null)}
        onRequestDelete={deleteBudget}
        onSubmit={(id, body) => saveAndClose(mutate(() => (id ? dashboardApi.updateBudget(id, body.limit_cents, month) : dashboardApi.createBudget({ ...body, month_start: month }, month)), id ? "Budget updated" : "Budget added"), () => setBudgetTarget(null))}
      />
      <GoalDialog
        target={goalTarget}
        dashboard={dashboard}
        onClose={() => setGoalTarget(null)}
        onRequestDelete={deleteGoal}
        onSubmit={(id, body) => saveAndClose(mutate(() => (id ? dashboardApi.updateGoal(id, body, month) : dashboardApi.createGoal(body, month)), id ? "Goal updated" : "Goal created"), () => setGoalTarget(null))}
      />
      <AddMoneyDialog
        goal={addMoneyTarget}
        onClose={() => setAddMoneyTarget(null)}
        dashboard={dashboard}
        onSubmit={(goalItem, amount, fromAccountId) => saveAndClose(mutate(() => dashboardApi.contributeToGoal(goalItem.id, amount, fromAccountId, month), (data) => contributionSaved(goalItem, data)), () => setAddMoneyTarget(null))}
      />
    </>
  );
}

/** The standard loading state inside a page: shapes where the numbers and cards will be. */
function PageSkeleton() {
  return (
    <div className="mx-auto max-w-2xl animate-pulse space-y-4" aria-busy="true">
      <div className="mx-auto h-14 w-56 rounded-2xl bg-sage" />
      <div className="mx-auto h-4 w-40 rounded-full bg-sage" />
      {["a", "b", "c", "d"].map((key) => <div key={key} className="h-[4.5rem] rounded-[var(--radius-card)] border border-line bg-surface" />)}
      <output className="sr-only">Loading</output>
    </div>
  );
}

/** First load: the shape of Home (headline, then cards in one column, or two on wide screens). */
function DashboardSkeleton() {
  const card = "h-[4.5rem] rounded-[var(--radius-card)] border border-line bg-surface";
  return (
    <div className="min-h-dvh lg:pl-64" aria-busy="true">
      <div className="fixed inset-y-0 left-0 hidden w-64 border-r border-line lg:block" />
      <div className="mx-auto max-w-6xl animate-pulse px-4 pb-10 pt-[calc(env(safe-area-inset-top)+1.5rem)] sm:px-6 lg:px-10 lg:pt-8">
        <div className="h-5 w-32 rounded-full bg-sage" />
        <div className="mx-auto mt-12 h-16 w-60 rounded-2xl bg-sage" />
        <div className="mx-auto mt-4 h-4 w-44 rounded-full bg-sage" />
        <div className="mx-auto mt-6 h-1.5 w-60 rounded-full bg-sage" />
        <div className="mt-12 grid gap-6 lg:grid-cols-2 lg:gap-8">
          {["left", "right"].map((column) => (
            <div key={column} className="space-y-2.5">
              <div className="mb-3 h-4 w-24 rounded-full bg-sage" />
              {[1, 2, 3].map((row) => <div key={row} className={card} />)}
            </div>
          ))}
        </div>
        <output className="sr-only">Loading your Penny dashboard</output>
      </div>
    </div>
  );
}

function LoadError({ error, onRetry }: { error: ReturnType<typeof describeError>; onRetry: () => void }) {
  const Icon = error.needsSignIn ? LogIn : CloudOff;
  return (
    <main className="grid min-h-dvh place-items-center p-4">
      <div className="w-full max-w-md animate-enter rounded-[1.5rem] border border-line bg-surface p-6 text-center shadow-[var(--shadow-raised)] sm:p-8">
        <span className={error.needsSignIn ? "mx-auto grid size-12 place-items-center rounded-2xl bg-accent-soft text-accent-strong" : "mx-auto grid size-12 place-items-center rounded-2xl bg-danger-soft text-danger"} aria-hidden="true"><Icon className="size-6" /></span>
        <h1 className="mt-5 text-xl font-semibold tracking-tight text-ink">{error.title}</h1>
        <p className="mt-2 text-sm text-ink-muted" role="alert">{error.detail}</p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          {error.needsSignIn ? <Link href="/login" className={buttonVariants()}><LogIn className="size-4" aria-hidden="true" />Sign in</Link> : null}
          <Button variant={error.needsSignIn ? "outline" : "default"} onClick={onRetry}><RefreshCw className="size-4" aria-hidden="true" />Try again</Button>
        </div>
      </div>
    </main>
  );
}
