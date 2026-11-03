"use client";

import { useCallback, useEffect, useState } from "react";
import { Bot } from "lucide-react";
import { AccountsView } from "@/components/penny/accounts-view";
import { DisplaySettingsDialog, MobileNavigation, PageHeader, Sidebar } from "@/components/penny/app-shell";
import { BillShortDialog } from "@/components/penny/bill-short-dialog";
import { BudgetsView } from "@/components/penny/budgets-view";
import { ChartsView } from "@/components/penny/charts-view";
import { CoachView, useCoachChat } from "@/components/penny/coach-view";
import { ConfirmDialog, type ConfirmRequest, deleteConfirmation } from "@/components/penny/confirm-dialog";
import { EditDialogs } from "@/components/penny/edit-dialogs";
import { GoalsView } from "@/components/penny/goals-view";
import { LearnView } from "@/components/penny/learn-view";
import { DashboardSkeleton, LoadError, PageSkeleton } from "@/components/penny/load-states";
import { Onboarding } from "@/components/penny/onboarding";
import { usePreferences } from "@/components/penny/preferences";
import { PullToRefresh } from "@/components/penny/pull-to-refresh";
import type { BillInput } from "@/components/penny/recurring-view";
import { SettingsView } from "@/components/penny/settings-view";
import { MENU, NAVIGATION, type View } from "@/components/penny/shared";
import { type SpendingTab, SpendingView } from "@/components/penny/spending-view";
import { slide, spotlight, withViewTransition } from "@/components/penny/subpage";
import { TodayView } from "@/components/penny/today-view";
import type { TransactionTarget } from "@/components/penny/transaction-dialog";
import { TransferContext, TransferDialog, type TransferPrefill } from "@/components/penny/transfer-dialog";
import { useDashboard } from "@/components/penny/use-dashboard";
import { useKeyboardShortcuts } from "@/components/penny/use-keyboard-shortcuts";
import { ToastProvider, useToast } from "@/components/ui/toast";
import { type Bill, type Budget, type BudgetSuggestion, type Dashboard, dashboardApi, type Mission, type SavingsGoal, type Transaction, type Transfer } from "@/lib/api";
import { onPasswordRequired, setAppSignedIn } from "@/lib/face-id";
import { addMonths, formatMonth } from "@/lib/format";
import { createSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase";
import { cn } from "@/lib/utils";

export function DashboardApp() {
  return <ToastProvider><PennyApp /></ToastProvider>;
}

const isView = (value: string): value is View => NAVIGATION.some((item) => item.id === value);

function PennyApp() {
  const toast = useToast();
  const coachChat = useCoachChat();
  const { resolvedTheme, setTheme } = usePreferences();
  const { dashboard, loading, monthLoading, loadError, historyVersion, reload, goToPeriod, goToMonth, applyChange, refresh, createInline, mutate } = useDashboard();
  const [view, setView] = useState<View>("today");
  const [spendingTab, setSpendingTab] = useState<SpendingTab>("transactions");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  // First-run setup for new real accounts. Each step can be skipped, but not the whole setup;
  // a device that skipped it under the old "Skip for now" still opens on Home with a Set up card.
  const [setupSkipped] = useState(() => {
    try { return typeof window !== "undefined" && window.localStorage.getItem("penny-setup-skipped") === "1"; } catch { return false; }
  });
  const [setupOpen, setSetupOpen] = useState(false);

  const [transactionTarget, setTransactionTarget] = useState<TransactionTarget | null>(null);
  const [budgetTarget, setBudgetTarget] = useState<Budget | "new" | null>(null);
  const [transferTarget, setTransferTarget] = useState<TransferPrefill | null>(null);
  const [billShort, setBillShort] = useState<Bill | null>(null);
  const [goalTarget, setGoalTarget] = useState<SavingsGoal | "new" | null>(null);
  const [addMoneyTarget, setAddMoneyTarget] = useState<SavingsGoal | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [displayOpen, setDisplayOpen] = useState(false);

  // Signed in and the dashboard is showing: with Face ID on, the iPhone app now locks when it leaves the screen.
  const loaded = dashboard !== null;
  useEffect(() => { if (loaded) setAppSignedIn(true); }, [loaded]);
  // The app lock gave up on Face ID (two failures): sign out and ask for the password. The lock
  // stays over the app until the sign-in page shows, so no balances flash in between.
  useEffect(() => onPasswordRequired(() => {
    const signOut = isSupabaseConfigured() ? createSupabaseBrowserClient().auth.signOut() : Promise.resolve();
    void signOut.catch(() => undefined).finally(() => { window.location.replace("/login/?faceid=failed"); });
  }), []);

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
    return () => window.removeEventListener("hashchange", fromHash);
  }, []);

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

  const openMonth = useCallback((month: string) => {
    if (view !== "today") navigate("today");
    goToMonth(month);
  }, [goToMonth, navigate, view]);

  useKeyboardShortcuts(dashboard ? {
    n: () => setTransactionTarget("new"),
    "[": () => goToMonth(addMonths(dashboard.active_month, -1)),
    "]": () => goToMonth(addMonths(dashboard.active_month, 1)),
    d: () => setTheme(resolvedTheme === "dark" ? "light" : "dark"),
    "?": () => setDisplayOpen(true),
    ...Object.fromEntries(MENU.map((item, index) => [String(index + 1), () => navigate(item.id)])),
  } : {});

  if (loading && !dashboard) return <DashboardSkeleton />;
  if (!dashboard) return <LoadError error={loadError ?? { title: "Penny couldn’t load", detail: "", needsSignIn: false }} onRetry={() => void reload()} />;

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
  /** `accountId` pays it from another account this once; `recordOnly` records a payment already made. */
  const markBillPaid = (bill: Bill, { accountId, recordOnly = false }: { accountId?: string; recordOnly?: boolean } = {}) => {
    void mutate(() => dashboardApi.markBillPaid(bill.id, month, accountId, recordOnly), recordOnly ? `${bill.name} recorded as paid` : `${bill.name} paid`)
      .then((error) => {
        if (!error) return;
        // Not enough in the bill's account: offer to move money or pay from another account.
        if (/negative/i.test(error)) setBillShort(bill);
        else toast({ title: "Couldn’t update the bill", description: error, tone: "error" });
      });
  };
  const transfers = {
    openTransfer: (prefill: TransferPrefill) => setTransferTarget(prefill),
    deleteTransfer: (transfer: Transfer) => setConfirm(deleteConfirmation(mutate, {
      title: transfer.kind === "card_payment" ? "Remove this card payment?" : "Remove this transfer?",
      description: "Both account balances go back to how they were before it.",
      confirmLabel: "Remove",
      noun: transfer.kind === "card_payment" ? "Card payment" : "Transfer",
      remove: () => dashboardApi.deleteTransfer(transfer.id, month),
      restore: () => dashboardApi.addTransfer({ from_account_id: transfer.from_account_id, to_account_id: transfer.to_account_id, amount_cents: transfer.amount_cents, occurred_on: transfer.occurred_on, note: transfer.note }, month),
    })),
  };
  const saveBill = (id: string | null, { already_paid: alreadyPaid, move_once: moveOnce, ...body }: BillInput) =>
    mutate(() => (id ? dashboardApi.updateBill(id, { ...body, ...(moveOnce === undefined ? {} : { move_once: moveOnce }) }, month) : dashboardApi.createBill({ ...body, already_paid: alreadyPaid ?? null }, month)), id ? "Bill updated" : `${body.name} added`);
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
    <TransferContext.Provider value={transfers}>
    <div className="min-h-dvh">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[70] focus:rounded-xl focus:bg-surface focus:px-4 focus:py-3 focus:font-semibold focus:shadow-[var(--shadow-raised)]">Skip to content</a>
      <Sidebar active={view} dashboard={dashboard} collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed((value) => !value)} onNavigate={navigate} />
      <div className={cn("transition-[padding] duration-200", sidebarCollapsed ? "lg:pl-20" : "lg:pl-64")}>
        <PageHeader view={view} dashboard={dashboard} monthLoading={monthLoading} onChangePeriod={goToPeriod} onAddTransaction={() => setTransactionTarget("new")} />
        <main id="main" tabIndex={-1} className="mx-auto max-w-7xl px-4 pb-[calc(6.5rem+env(safe-area-inset-bottom))] pt-5 focus:outline-none sm:px-6 lg:px-10 lg:pb-12 lg:pt-8">
          {/* A period that isn't cached yet shows a skeleton until its data arrives, never stale numbers. */}
          {monthLoading && <PageSkeleton />}
          <div key={view} className={monthLoading ? "hidden" : "animate-fade"} aria-busy={monthLoading}>
            {view === "today" && <TodayView dashboard={dashboard} splits={{ save: mutate, onAddExpense: (share) => setTransactionTarget({ share }) }} onNavigate={navigate} onAsk={askPenny} onEditTransaction={setTransactionTarget} onSetUp={() => setSetupOpen(true)} />}
            {view === "spending" && <SpendingView dashboard={dashboard} historyVersion={historyVersion} tab={spendingTab} onTabChange={setSpendingTab} recurring={{ onMarkPaid: (bill, recordOnly) => markBillPaid(bill, { recordOnly }), onSave: saveBill, onDelete: confirmDeleteBill, onCardPaid: (card) => void mutate(() => dashboardApi.updateAccount(card.account_id, { card_paid_on: dashboard.money_calendar.today ?? new Date().toISOString().slice(0, 10) }), `${card.account_name} recorded as paid`) }} onAsk={askPenny} onSelectMonth={goToMonth} onChangePeriod={goToPeriod} onAddTransaction={() => setTransactionTarget("new")} onEditTransaction={setTransactionTarget} onDeleteTransaction={confirmDeleteTransaction} />}
            {view === "accounts" && <AccountsView dashboard={dashboard} onNavigate={navigate} onAsk={askPenny} />}
            {view === "goals" && <GoalsView dashboard={dashboard} onAsk={askPenny} onAdd={() => setGoalTarget("new")} onEdit={setGoalTarget} onAddMoney={setAddMoneyTarget} onComplete={(goal) => void mutate(() => dashboardApi.updateGoal(goal.id, { status: "completed" }, month), `${goal.name} reached`)} />}
            {view === "charts" && <ChartsView dashboard={dashboard} />}
            {view === "budgets" && <BudgetsView dashboard={dashboard} onNavigate={navigate} onAddBudget={() => setBudgetTarget("new")} onEditBudget={setBudgetTarget} onCopyBudgets={copyBudgets} onApplyBudgets={applyBudgetSuggestions} onApplyBudgetChanges={applyBudgetChanges} />}
            {view === "learn" && <LearnView dashboard={dashboard} onCompleteMission={completeMission} onProgress={applyChange} onNavigate={navigate} onAsk={askPenny} />}
            {view === "ai" && <CoachView chat={coachChat} dashboard={dashboard} onDashboardChange={applyChange} onApproved={(message) => toast({ title: "Change applied", description: message })} onApplyBudgets={applyBudgetSuggestions} />}
            {view === "settings" && <SettingsView dashboard={dashboard} save={mutate} onReset={() => { navigate("today"); setSetupOpen(true); }} />}
          </div>
        </main>
      </div>
      <MobileNavigation active={view} onNavigate={navigate} onAdd={() => setTransactionTarget("new")} />
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
      <TransferDialog dashboard={dashboard} prefill={transferTarget} onClose={() => setTransferTarget(null)} onSave={(body) => mutate(() => dashboardApi.addTransfer(body, month), body.to_account_id && dashboard.accounts.find((a) => a.id === body.to_account_id)?.account_type === "credit" ? "Card payment recorded" : "Transfer recorded")} />
      <BillShortDialog dashboard={dashboard} bill={billShort} onClose={() => setBillShort(null)} onTransfer={(prefill) => { setBillShort(null); setTransferTarget(prefill); }} onPayFrom={(bill, accountId) => { setBillShort(null); markBillPaid(bill, { accountId }); }} onRecordOnly={(bill) => { setBillShort(null); markBillPaid(bill, { recordOnly: true }); }} />
    </div>
    </TransferContext.Provider>
  );
}
