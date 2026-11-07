import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test as base, expect, chromium, webkit } from "@playwright/test";
import { startServer } from "../scripts/serve.mjs";

const test = base.extend({
  /** Provide a one-shot worker failure for atomic save and retry journeys. */
  storageFault: async ({}, provide) => {
    await provide({ current: null });
  },
  /** Serve the actual product worker with an isolated budget-write failure when requested. */
  baseURL: async ({ storageFault }, provide) => {
    const server = startServer(0, (path, bytes) => {
      if (path !== "/db-worker.js" || !storageFault.current) return bytes;
      const fault = storageFault.current;
      storageFault.current = null;
      let source = bytes.toString();
      if (fault === "budget-outbox")
        source = source.replace(
          /db\.exec\(\{\s*sql: "INSERT INTO pending_budget_operations/,
          'if (!self.__budgetOutboxFailure) { self.__budgetOutboxFailure = true; throw Error("Simulated budget operation write failure"); } db.exec({ sql: "INSERT INTO pending_budget_operations',
        );
      if (fault === "budget-reply")
        source = source.replace(
          "self.postMessage({ id, result });",
          'if (command === "saveBudget" && !self.__budgetReplyFailure) { self.__budgetReplyFailure = true; self.postMessage({ id, error: "Simulated lost budget save reply" }); } else self.postMessage({ id, result });',
        );
      return Buffer.from(source);
    });
    await new Promise((resolve) => server.once("listening", resolve));
    try {
      await provide(`http://kuwi-${randomUUID()}.localhost:${server.address().port}`);
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  },
  /** Use a persistent WebKit profile so the budget journey exercises real OPFS storage. */
  context: async ({ browser, browserName, baseURL }, provide) => {
    const profile = browserName === "webkit"
      ? await mkdtemp(join(tmpdir(), "kuwi-budget-webkit-"))
      : null;
    let context;
    try {
      if (browserName === "webkit")
        context = await webkit.launchPersistentContext(profile, { baseURL });
      else context = await browser.newContext({ baseURL });
      await provide(context);
    } finally {
      try {
        await context?.close();
      } finally {
        if (profile) await rm(profile, { recursive: true, force: true });
      }
    }
  },
});

/** Complete first-run setup with a funded PHP test account.
 * @param {import("@playwright/test").Page} page - Isolated product page to drive.
 * @returns {Promise<void>} Resolves when the saved PHP 1,000 account is visible.
 */
async function finishSetup(page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Continue offline", exact: true }).click();
  await page.getByLabel("Preferred name", { exact: true }).fill("Anthony");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "Skip introduction", exact: true }).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByLabel("Opening balance (PHP)", { exact: true }).fill("1000");
  await page.getByRole("button", { name: "Save my account", exact: true }).click();
  await expect(page.getByText("₱1,000.00", { exact: true })).toBeVisible();
}

/** Save a fixed category budget through the visible editor.
 * @param {import("@playwright/test").Page} page - Page with the budget category list open.
 * @param {string} category - Visible built-in expense category label.
 * @param {string} amount - Fixed amount text in the preferred currency.
 * @returns {Promise<void>} Resolves after the saved budget is visible.
 */
async function setFixedBudget(page, category, amount) {
  await page.getByRole("button", { name: `Set ${category} budget`, exact: true }).click();
  await page.getByLabel("Budget amount", { exact: true }).fill(amount);
  await page.getByRole("button", { name: "Save budget", exact: true }).click();
  await expect(page.getByRole("button", { name: `Edit ${category} budget`, exact: true })).toBeVisible();
}

/** Open the budget list from the current account or account list.
 * @param {import("@playwright/test").Page} page - Product page with the Budgets action available.
 * @returns {Promise<void>} Resolves when the budget workspace heading is visible.
 */
async function openBudgets(page) {
  await page.getByRole("button", { name: "Budgets", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Budgets", level: 1 })).toBeVisible();
}

test("budget progress follows corrected expenses, income, and transfer fees after offline reopening and restore", async ({
  browserName,
  baseURL,
}, testInfo) => {
  const browserType = browserName === "webkit" ? webkit : chromium;
  const directory = testInfo.outputPath("budget-browser-profile");
  let context = await browserType.launchPersistentContext(directory, { baseURL });
  try {
    let page = await context.newPage();
    await finishSetup(page);

    await openBudgets(page);
    await setFixedBudget(page, "Food", "1000");
    await page.getByRole("button", { name: "Back to accounts", exact: true }).click();

    await page.getByRole("button", { name: "View account Cash", exact: true }).click();
    await page.getByRole("button", { name: "Add expense", exact: true }).click();
    await page.getByLabel("Expense amount", { exact: true }).fill("12");
    await page.getByLabel("Expense note", { exact: true }).fill("Coffee");
    await page.getByRole("button", { name: "Food", exact: true }).click();
    await page.getByRole("button", { name: "Save expense", exact: true }).click();

    await page.getByRole("button", { name: "Add income", exact: true }).click();
    await page.getByLabel("Income amount", { exact: true }).fill("500");
    await page.getByLabel("Income note", { exact: true }).fill("Pay");
    await page.getByRole("button", { name: "Salary", exact: true }).click();
    await page.getByRole("button", { name: "Save income", exact: true }).click();

    await page.getByRole("button", { name: "Transaction history", exact: true }).click();
    await page.getByRole("button", { name: "Edit Coffee", exact: true }).click();
    await page.getByLabel("Transaction amount", { exact: true }).fill("20");
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await page.getByRole("button", { name: "Back to account", exact: true }).click();
    await openBudgets(page);
    await expect(page.getByText("2% used")).toBeVisible();
    await expect(page.getByText("₱980.00 remaining")).toBeVisible();
    await page.getByRole("button", { name: "Back to accounts", exact: true }).click();
    await page.getByRole("button", { name: "Back to accounts", exact: true }).click();

    await page.getByRole("button", { name: "Add account", exact: true }).click();
    await page.getByLabel("Account name", { exact: true }).fill("Reserve");
    await page.getByRole("button", { name: "Save account", exact: true }).click();
    await page.getByRole("button", { name: "View account Cash", exact: true }).click();
    await page.getByRole("button", { name: "Transfer between accounts", exact: true }).click();
    await page.getByLabel("Transfer amount", { exact: true }).fill("100");
    await page.getByLabel("Transfer fee (optional)", { exact: true }).fill("5");
    await page.getByRole("button", { name: "Save transfer", exact: true }).click();

    await openBudgets(page);
    await setFixedBudget(page, "Fees", "50");
    await page.getByRole("button", { name: "Set Transport budget", exact: true }).click();
    await page.getByLabel("Budget amount", { exact: true }).fill("20");
    await page.getByRole("button", { name: "Save budget", exact: true }).click();
    await page.getByRole("button", { name: "Edit Fees budget", exact: true }).click();
    await page.getByRole("radio", { name: "Percentage of income", exact: true }).click();
    await page.getByLabel("Budget percentage", { exact: true }).fill("10");
    await page.getByRole("button", { name: "Save budget", exact: true }).click();
    await expect(page.getByText("10% used")).toBeVisible();
    await expect(page.getByText("₱45.00 remaining")).toBeVisible();

    await page.getByRole("button", { name: "Back to accounts", exact: true }).click();
    await page.getByRole("button", { name: "Back to accounts", exact: true }).click();
    await page.getByRole("button", { name: "Close database", exact: true }).click();
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await context.close();

    context = await browserType.launchPersistentContext(directory, {
      baseURL,
      offline: true,
    });
    page = await context.newPage();
    await page.goto("/");
    await openBudgets(page);
    await expect(page.getByText("2% used")).toBeVisible();
    await expect(page.getByText("10% used")).toBeVisible();

    await page.getByRole("button", { name: "Back to accounts", exact: true }).click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export backup", exact: true }).click();
    const download = await downloadPromise;
    const backup = JSON.parse(await readFile(await download.path(), "utf8"));
    expect(backup.schemaVersion).toBe(7);
    expect(backup.data.budgets).toHaveLength(3);
    expect(backup.data.pendingBudgetOperations).toHaveLength(4);
    expect(backup.data.budgets.find(({ category_id }) => category_id === "food")).toMatchObject({
      amount_milli: 1_000_000,
      type: "fixed",
      interval: "monthly",
    });
    expect(backup.data.budgets[0]).not.toHaveProperty("spent");

    await openBudgets(page);
    await page.getByRole("button", { name: "Edit Food budget", exact: true }).click();
    await page.getByLabel("Budget amount", { exact: true }).fill("0");
    await page.getByRole("button", { name: "Save budget", exact: true }).click();
    await expect(page.getByRole("button", { name: "Set Food budget", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Back to accounts", exact: true }).click();

    const chooserPromise = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Restore backup", exact: true }).click();
    const chooser = await chooserPromise;
    await chooser.setFiles({
      name: "budgets.kuwi.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(backup)),
    });
    await expect(page.getByText("Backup restored.", { exact: true })).toBeVisible();
    await openBudgets(page);
    await expect(page.getByText("2% used")).toBeVisible();
  } finally {
    await context.close();
  }
});

test("failed budget writes roll back and unchanged retries retain one operation", async ({
  page,
  storageFault,
}) => {
  storageFault.current = "budget-outbox";
  await finishSetup(page);
  await openBudgets(page);
  await page.getByRole("button", { name: "Set Food budget", exact: true }).click();
  await page.getByLabel("Budget amount", { exact: true }).fill("1000");
  await page.getByRole("button", { name: "Save budget", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Simulated budget operation write failure");

  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Back to accounts", exact: true }).click();
  await openBudgets(page);
  await expect(page.getByRole("button", { name: "Set Food budget", exact: true })).toBeVisible();
});

test("a lost save reply reuses its operation ID and creates one saved budget", async ({
  page,
  storageFault,
}) => {
  storageFault.current = "budget-reply";
  await finishSetup(page);
  await openBudgets(page);
  await page.getByRole("button", { name: "Set Food budget", exact: true }).click();
  await page.getByLabel("Budget amount", { exact: true }).fill("1000");
  await page.getByRole("button", { name: "Save budget", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Simulated lost budget save reply");
  await page.getByRole("button", { name: "Save budget", exact: true }).click();
  await expect(page.getByRole("button", { name: "Edit Food budget", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Back to accounts", exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export backup", exact: true }).click();
  const download = await downloadPromise;
  const backup = JSON.parse(await readFile(await download.path(), "utf8"));
  expect(backup.data.budgets).toHaveLength(1);
  expect(backup.data.pendingBudgetOperations).toHaveLength(1);
});
