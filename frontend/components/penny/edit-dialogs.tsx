"use client";

import { type Budget, type Dashboard, dashboardApi, type SavingsGoal, type Transaction } from "@/lib/api";
import { formatMonth } from "@/lib/format";
import { BudgetDialog } from "./budget-dialog";
import { AddMoneyDialog, GoalDialog } from "./goal-dialogs";
import type { InlineCreate } from "./inline-create";
import { cad } from "./shared";
import { TransactionDialog, type TransactionTarget } from "./transaction-dialog";
import type { TransactionBody } from "./transaction-form";
import type { Mutate, ToastMessage } from "./use-dashboard";

type DialogSlot<T> = [target: T | null, setTarget: (target: T | null) => void, requestDelete: (item: Exclude<T, "new">) => void];

/** The create/edit dialogs. Each submit resolves to an error message shown inside its dialog. */
export function EditDialogs({ dashboard, mutate, onCreate, onOpenMonth, transaction, budget, goal, addMoney }: {
  dashboard: Dashboard;
  mutate: Mutate;
  onCreate: InlineCreate;
  onOpenMonth: (month: string) => void;
  transaction: [target: TransactionTarget | null, setTarget: (target: TransactionTarget | null) => void, requestDelete: (item: Transaction) => void];
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

  /** Saves the form: one transaction (new or edited), a split across accounts, or a purchase shared with friends. */
  function saveTransaction(id: string | null, body: TransactionBody): Promise<Dashboard> {
    if ("paid_from" in body) return dashboardApi.createSharedPurchase(body, month);
    if ("splits" in body) return dashboardApi.createSplitTransaction(body, month);
    return id ? dashboardApi.updateTransaction(id, body, month) : dashboardApi.createTransaction(body, month);
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
        onSubmit={(id, body) => saveAndClose(mutate(() => saveTransaction(id, body), () => transactionSaved(id, body.occurred_on)), () => setTransactionTarget(null))}
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
