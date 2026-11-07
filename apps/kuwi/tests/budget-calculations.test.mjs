import test from "node:test";
import assert from "node:assert/strict";
import { budgetPeriod, calculateBudgetProgress } from "../public/budget-calculations.mjs";

test("budget periods follow the recovered calendar boundaries", () => {
  assert.deepEqual(budgetPeriod("daily", "2026-11-07"), {
    start: "2026-11-07",
    end: "2026-11-07",
  });
  assert.deepEqual(budgetPeriod("weekly", "2026-11-07"), {
    start: "2026-11-02",
    end: "2026-11-08",
  });
  assert.deepEqual(budgetPeriod("bi-weekly", "2026-11-07", {
    biweeklyStartDate: "2026-11-01",
    biweeklyEndDate: "2026-11-10",
  }), {
    start: "2026-11-01",
    end: "2026-11-10",
  });
  assert.deepEqual(budgetPeriod("bi-weekly", "2026-11-07", {
    biweeklyStartDate: "invalid",
    biweeklyEndDate: "2026-11-01",
  }), {
    start: "2026-10-26",
    end: "2026-11-08",
  });
  assert.deepEqual(budgetPeriod("monthly", "2026-11-07", { monthlyCycleStartDay: 10 }), {
    start: "2026-10-10",
    end: "2026-11-09",
  });
  assert.deepEqual(budgetPeriod("monthly", "2026-11-07", { monthlyCycleStartDay: 31 }), {
    start: "2026-10-31",
    end: "2026-11-29",
  });
  assert.deepEqual(budgetPeriod("annually", "2026-11-07"), {
    start: "2026-01-01",
    end: "2026-12-31",
  });
});

test("fixed category progress counts eligible expenses from every account once", () => {
  const progress = calculateBudgetProgress({
    budget: { category_id: "food", type: "fixed", amount_milli: 1_000_000, interval: "monthly" },
    preferredCurrency: "PHP",
    today: "2026-11-07",
    accounts: [{ id: "cash", currency_code: "PHP", decimal_places: 2 }],
    expenses: [
      { account_id: "cash", category_id: "food", amount_minor: 12000, date: "2026-11-07" },
      { account_id: "cash", category_id: "food", amount_minor: 8000, date: "2026-11-08", planned: true },
      { account_id: "cash", category_id: "food", amount_minor: 5000, date: "2026-11-09", affects_spending: false },
      { account_id: "cash", category_id: "food", amount_minor: 20000, date: "2026-10-31" },
      { account_id: "cash", category_id: "transport", amount_minor: 4000, date: "2026-11-07" },
    ],
    incomes: [],
  });

  assert.equal(progress.limit, 1000);
  assert.equal(progress.spent, 120);
  assert.equal(progress.remaining, 880);
  assert.equal(progress.progressPercent, 12);
  assert.equal(progress.available, true);
});

test("percentage limits use actual income in the same category budget period", () => {
  const progress = calculateBudgetProgress({
    budget: { category_id: "food", type: "percentage", amount_milli: 0, percentage_basis_points: 1000, interval: "monthly" },
    preferredCurrency: "PHP",
    today: "2026-11-07",
    accounts: [{ id: "cash", currency_code: "PHP", decimal_places: 2 }],
    expenses: [{ account_id: "cash", category_id: "food", amount_minor: 12500, date: "2026-11-07" }],
    incomes: [
      { account_id: "cash", amount_minor: 300000, date: "2026-11-01", planned: 0 },
      { account_id: "cash", amount_minor: 200000, date: "2026-11-06", planned: 0 },
      { account_id: "cash", amount_minor: 100000, date: "2026-11-08", planned: 1 },
    ],
  });

  assert.equal(progress.incomeBase, 5000);
  assert.equal(progress.limit, 500);
  assert.equal(progress.spent, 125);
  assert.equal(progress.remaining, 375);
  assert.equal(progress.progressPercent, 25);
});

test("rollover carries fixed allowance and spending across completed monthly cycles", () => {
  const budget = {
    category_id: "food",
    type: "fixed",
    amount_milli: 100_000,
    interval: "monthly",
    rollover_enabled: 1,
    rollover_started_at: "2026-11-01",
  };
  const accounts = [{ id: "cash", currency_code: "PHP", decimal_places: 2 }];
  const expenses = [
    { account_id: "cash", category_id: "food", amount_minor: 12000, date: "2026-11-05" },
  ];

  const november = calculateBudgetProgress({ budget, preferredCurrency: "PHP", today: "2026-11-07", accounts, expenses, incomes: [] });
  const december = calculateBudgetProgress({
    budget,
    preferredCurrency: "PHP",
    today: "2026-12-07",
    accounts,
    expenses: [...expenses, { account_id: "cash", category_id: "food", amount_minor: 3000, date: "2026-12-02" }],
    incomes: [],
  });

  assert.equal(november.limit, 100);
  assert.equal(november.remaining, -20);
  assert.equal(december.limit, 200);
  assert.equal(december.spent, 150);
  assert.equal(december.remaining, 50);
});

test("mixed-currency progress stays unavailable when no exchange quote exists", () => {
  const progress = calculateBudgetProgress({
    budget: { category_id: "food", type: "fixed", amount_milli: 1_000_000, interval: "monthly" },
    preferredCurrency: "PHP",
    today: "2026-11-07",
    accounts: [
      { id: "cash", currency_code: "PHP", decimal_places: 2 },
      { id: "wallet", currency_code: "EUR", decimal_places: 2 },
    ],
    expenses: [
      { account_id: "cash", category_id: "food", amount_minor: 12000, date: "2026-11-07" },
      { account_id: "wallet", category_id: "food", amount_minor: 1000, date: "2026-11-07" },
    ],
    incomes: [],
  });

  assert.equal(progress.available, false);
  assert.deepEqual(progress.missingCurrencies, ["EUR", "PHP"]);
  assert.equal(progress.spent, null);
  assert.equal(progress.remaining, null);
});
