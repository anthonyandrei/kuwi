import { createHash, randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test as base, expect, webkit, chromium } from "@playwright/test";

const test = base.extend({
  /** Provide a test-only restore failure flag for the product worker. */
  storageFault: async ({}, provide) => {
    await provide({ failRestore: false });
  },
  /** Serve an independent origin with the real product worker and optional rollback fault. */
  baseURL: async ({ storageFault }, provide) => {
    const { startServer } = await import("../scripts/serve.mjs");
    const server = startServer(0, (path, bytes) => {
      if (path !== "/db-worker.js" || !storageFault.failRestore) return bytes;
      return Buffer.from(bytes.toString().replace(
        "      DELETE FROM currencies;\n    `);",
        "      DELETE FROM currencies;\n    `);\n    throw Error(\"Simulated restore write failure\");",
      ));
    });
    await new Promise((resolve) => server.once("listening", resolve));
    try {
      // WebKit shares OPFS by origin across persistent profiles and test runs.
      const host = `kuwi-${randomUUID()}.localhost`;
      await provide(`http://${host}:${server.address().port}`);
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  },
});

/** Complete visible first-run setup with the independent PHP 1,000 test example.
 * @param {import("@playwright/test").Page} page - Browser page to drive.
 * @returns {Promise<void>} Resolves after the saved balance appears.
 * @throws {Error} If local storage fails to open before setup starts.
 */
async function finishSetup(page) {
  await page.goto("/");
  const startButton = page.getByRole("button", {
    name: "Continue offline",
    exact: true,
  });
  const retryButton = page.getByRole("button", {
    name: "Retry opening",
    exact: true,
  });
  try {
    await expect(startButton.or(retryButton)).toBeVisible();
  } catch (error) {
    const screen = await page.locator("body").innerText().catch(() => "");
    throw new Error(
      `App startup did not reach first-run setup. Screen: ${screen || "empty"}. ${error.message}`,
    );
  }
  if (await retryButton.isVisible()) {
    throw new Error(
      `Local storage failed to open. Screen: ${await page.locator("body").innerText()}`,
    );
  }
  await startButton.click();
  await page.getByLabel("Preferred name", { exact: true }).fill("Anthony");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "Skip introduction", exact: true }).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByLabel("Opening balance (PHP)", { exact: true }).fill("1000");
  await page.getByRole("button", { name: "Save my account", exact: true }).click();
  await expect(page.getByText("₱1,000.00", { exact: true })).toBeVisible();
}

/** Supply a candidate through the real browser file picker.
 * @param {import("@playwright/test").Page} page - Browser page with the restore action.
 * @param {import("@playwright/test").FilePayload} file - Name, MIME hint, and candidate bytes.
 * @returns {Promise<void>} Resolves after the browser hands the file to the app.
 */
async function restoreFile(page, file) {
  const dataManagement = page.getByRole("button", { name: "Data management", exact: true });
  if (await dataManagement.isVisible()) await dataManagement.click();
  const chooserPromise = page.waitForEvent("filechooser", { timeout: 5000 });
  await page.getByRole("button", { name: "Restore backup", exact: true }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles(file);
  const replace = page.getByRole("button", { name: "Replace local data", exact: true });
  const alert = page.getByRole("alert");
  await expect(replace.or(alert)).toBeVisible();
  if (await replace.isVisible()) await replace.click();
}

async function openDataManagement(page) {
  const button = page.getByRole("button", { name: "Data management", exact: true });
  if (await button.isVisible()) await button.click();
}

test("workspace URLs follow browser history and keep an unfinished entry draft", async ({
  browserName,
  baseURL,
}, testInfo) => {
  const browserType = browserName === "webkit" ? webkit : chromium;
  const directory = testInfo.outputPath("workspace-navigation-profile");
  await rm(directory, { recursive: true, force: true });
  const context = await browserType.launchPersistentContext(directory, { baseURL });
  try {
    const page = await context.newPage();
    await finishSetup(page);
    await page.getByRole("button", { name: "View account Cash", exact: true }).click();
    await expect(page).toHaveURL(/view=account/);
    await page.getByRole("button", { name: "Add expense", exact: true }).click();
    await expect(page).toHaveURL(/view=expense/);
    await page.getByLabel("Expense amount", { exact: true }).fill("25");
    await page.getByLabel("Expense note", { exact: true }).fill("Keep this draft");

    await page.goBack();
    await expect(page).toHaveURL(/view=account/);
    await expect(page.getByText("₱1,000.00", { exact: true })).toBeVisible();
    await page.goForward();
    await expect(page).toHaveURL(/view=expense/);
    await expect(page.getByLabel("Expense amount", { exact: true })).toHaveValue("25");
    await expect(page.getByLabel("Expense note", { exact: true })).toHaveValue("Keep this draft");

    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page).toHaveURL(/view=account/);
    await expect(page.getByText("₱1,000.00", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Back to accounts", exact: true }).click();
    await page.getByRole("button", { name: "Data management", exact: true }).click();
    await expect(page).toHaveURL(/view=data-management/);
    await page.reload();
    await expect(page).toHaveURL(/view=data-management/);
    await expect(page.getByRole("heading", { name: "Data management" })).toBeVisible();
    await page.goto("/?view=account&accountId=missing-account");
    await expect(page.getByRole("heading", { name: "Your accounts" })).toBeVisible();
    await expect(page).toHaveURL(/view=accounts/);
  } finally {
    await context.close();
  }
});

test("system appearance changes live and narrow account rows stay within the viewport", async ({
  browserName,
  baseURL,
}, testInfo) => {
  const browserType = browserName === "webkit" ? webkit : chromium;
  const directory = testInfo.outputPath("appearance-profile");
  await rm(directory, { recursive: true, force: true });
  const context = await browserType.launchPersistentContext(directory, { baseURL });
  try {
    const page = await context.newPage();
    await finishSetup(page);
    await page.setViewportSize({ width: 320, height: 800 });
    await page.emulateMedia({ colorScheme: "dark" });

    const measureContrast = (foreground, background) => {
      const luminance = (color) => {
        const channels = color.match(/[\d.]+/g).slice(0, 3).map(Number).map((channel) => {
          const value = channel / 255;
          return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
        });
        return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
      };
      const first = luminance(foreground);
      const second = luminance(background);
      return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
    };
    const colors = async () => page.evaluate(() => {
      const heading = document.querySelector('[role="heading"]');
      const action = [...document.querySelectorAll('[role="button"]')].find((item) => item.textContent?.includes("Add account"));
      const actionText = action?.querySelector('[dir="auto"]');
      return {
        page: getComputedStyle(document.body).backgroundColor,
        heading: getComputedStyle(heading).color,
        action: getComputedStyle(action).backgroundColor,
        actionText: getComputedStyle(actionText).color,
      };
    });

    let palette = await colors();
    expect(palette.page).toBe("rgb(17, 26, 20)");
    expect(measureContrast(palette.heading, palette.page)).toBeGreaterThanOrEqual(4.5);
    expect(measureContrast(palette.actionText, palette.action)).toBeGreaterThanOrEqual(4.5);

    await page.emulateMedia({ colorScheme: "light" });
    await expect.poll(async () => (await colors()).page).toBe("rgb(249, 245, 235)");
    await page.emulateMedia({ colorScheme: "dark" });
    await expect.poll(async () => (await colors()).page).toBe("rgb(17, 26, 20)");

    const addAccount = page.getByRole("button", { name: "Add account", exact: true });
    await addAccount.hover();
    await expect.poll(() => addAccount.evaluate((element) => getComputedStyle(element).filter))
      .toBe("brightness(0.94)");
    const buttonBox = await addAccount.boundingBox();
    await page.mouse.move(buttonBox.x + buttonBox.width / 2, buttonBox.y + buttonBox.height / 2);
    await page.mouse.down();
    await expect.poll(() => addAccount.evaluate((element) => getComputedStyle(element).transform))
      .not.toBe("none");
    await page.mouse.up();

    await page.getByLabel("Account name", { exact: true }).fill("Long household emergency account");
    await page.getByLabel("Opening balance (PHP)", { exact: true }).fill("999999999.99");
    await page.getByRole("button", { name: "Save account", exact: true }).click();
    await expect(page.getByText("Long household emergency account", { exact: true })).toBeVisible();
    await expect(page.getByText("₱999,999,999.99", { exact: true })).toBeVisible();
    const viewportWidth = await page.evaluate(() => ({
      viewport: window.innerWidth,
      page: document.documentElement.scrollWidth,
    }));
    expect(viewportWidth.page).toBeLessThanOrEqual(viewportWidth.viewport);

    await page.getByRole("button", { name: "View account Long household emergency account", exact: true }).click();
    await page.getByRole("button", { name: "Transaction history", exact: true }).click();
    const backLinkColors = await page.getByText("Back to account", { exact: true }).evaluate((element) => ({
      foreground: getComputedStyle(element).color,
      background: getComputedStyle(document.body).backgroundColor,
    }));
    expect(measureContrast(backLinkColors.foreground, backLinkColors.background)).toBeGreaterThanOrEqual(4.5);
  } finally {
    await context.close();
  }
});

test("selecting a backup reviews it before local data can be replaced", async ({
  browserName,
  baseURL,
}, testInfo) => {
  const browserType = browserName === "webkit" ? webkit : chromium;
  const directory = testInfo.outputPath("backup-review-browser-profile");
  await rm(directory, { recursive: true, force: true });
  const context = await browserType.launchPersistentContext(directory, { baseURL });
  try {
    const page = await context.newPage();
    await finishSetup(page);
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Data management", exact: true }).click();
    await page.getByRole("button", { name: "Export backup", exact: true }).click();
    const download = await downloadPromise;
    const backup = await (await import("node:fs/promises")).readFile(await download.path());
    await page.getByRole("button", { name: "Back to accounts", exact: true }).click();

    await page.getByRole("button", { name: "Add account", exact: true }).click();
    await page.getByLabel("Account name", { exact: true }).fill("Reserve");
    await page.getByRole("button", { name: "Save account", exact: true }).click();
    await expect(page.getByText("Reserve", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Data management", exact: true }).click();
    const chooserPromise = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Restore backup", exact: true }).click();
    const chooser = await chooserPromise;
    await chooser.setFiles({ name: "candidate.kuwi.json", mimeType: "application/json", buffer: backup });

    await expect(page.getByText("candidate.kuwi.json", { exact: true })).toBeVisible();
    await expect(page.getByText("Accounts in backup: 1", { exact: true })).toBeVisible();
    await expect(page.getByText(/Exported/)).toBeVisible();
    await expect(page.getByText(/replacing this browser's local data/i)).toBeVisible();
    await page.getByRole("button", { name: "Cancel restore", exact: true }).click();
    await page.getByRole("button", { name: "Back to accounts", exact: true }).click();

    await expect(page.getByText("Reserve", { exact: true })).toBeVisible();
    await expect(page.getByText("₱1,000.00", { exact: true })).toBeVisible();
  } finally {
    await context.close();
  }
});

/** Recompute a test candidate's digest after an intentional data mutation.
 * @param {object} backup - Exported envelope to copy with a refreshed digest.
 * @returns {object} Candidate with the same metadata and a digest for its data.
 */
function withValidDigest(backup) {
  const body = {
    format: backup.format,
    version: backup.version,
    schemaVersion: backup.schemaVersion,
    data: backup.data,
  };
  return {
    ...body,
    exportedAt: backup.exportedAt,
    integrity: {
      algorithm: "SHA-256",
    digest: createHash("sha256").update(canonicalJson(body)).digest("hex"),
    },
  };
}

/** Remove the v10 profile and create-receipt fields from a backup candidate.
 * @param {object} backup - Candidate backup to downgrade for restoration.
 * @returns {object} The same backup with its pre-v10 row shape restored.
 */
function removeV10Fields(backup) {
  backup.data.profiles = backup.data.profiles.map(
    ({ monthly_cycle_start_day, ...profile }) => profile,
  );
  backup.data.pendingSyncOperations = backup.data.pendingSyncOperations.map(
    ({ request_fingerprint, ...marker }) => marker,
  );
  backup.data.pendingIncomeSyncOperations = backup.data.pendingIncomeSyncOperations.map(
    ({ request_fingerprint, ...marker }) => marker,
  );
  return backup;
}

/** Remove fields that were introduced after a legacy backup schema.
 * @param {object} backup - Candidate backup to downgrade for restoration.
 * @returns {object} The same backup with its legacy row shape restored.
 */
function removePlannedFields(backup) {
  removeV10Fields(backup);
  backup.data.expenses = backup.data.expenses.map(
    ({ planned, planned_amount_minor, ...expense }) => expense,
  );
  backup.data.incomes = backup.data.incomes.map(
    ({ planned_amount_minor, ...income }) => income,
  );
  return backup;
}

/** Serialize a test backup body with sorted object keys and retained array order.
 * @param {*} value - JSON-compatible test data.
 * @returns {string} Canonical JSON used to form the SHA-256 digest.
 */
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

test("backup round trip rejects bad files and reopens offline with the restored ledger", async ({
  browserName,
  baseURL,
}) => {
  const browserType = browserName === "webkit" ? webkit : chromium;
  const directory = await mkdtemp(join(tmpdir(), "kuwi-backup-roundtrip-"));
  let context = await browserType.launchPersistentContext(directory, { baseURL });
  try {
    let page = await context.newPage();
    await finishSetup(page);

    await page.getByRole("button", { name: "View account Cash", exact: true }).click();
    await page.getByRole("button", { name: "Add expense", exact: true }).click();
    await page.getByLabel("Expense amount", { exact: true }).fill("12");
    await page.getByLabel("Expense note", { exact: true }).fill("Coffee");
    await page.getByRole("button", { name: "Food", exact: true }).click();
    await page.getByRole("button", { name: "Save expense", exact: true }).click();
    await expect(page.getByText("₱988.00", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Back to accounts", exact: true }).click();
    await page.getByRole("button", { name: "View account Cash", exact: true }).click();
    await page.getByRole("button", { name: "Add income", exact: true }).click();
    await page.getByLabel("Income amount", { exact: true }).fill("25");
    await page.getByLabel("Income note", { exact: true }).fill("Monthly pay");
    await page.getByRole("button", { name: "Salary", exact: true }).click();
    await page.getByRole("button", { name: "Save income", exact: true }).click();
    await expect(page.getByText("₱1,013.00", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Transaction history", exact: true }).click();
    await page.getByRole("button", { name: "Edit Coffee", exact: true }).click();
    await page.getByLabel("Transaction amount", { exact: true }).fill("13");
    await page.getByLabel("Expense note", { exact: true }).fill("Coffee corrected");
    await page.getByRole("button", { name: "Shopping", exact: true }).click();
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Transaction updated");
    await expect(page.getByText("₱1,012.00", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Back to account", exact: true }).click();
    await page.getByRole("button", { name: "Add expense", exact: true }).click();
    await page.getByLabel("Expense amount", { exact: true }).fill("2");
    await page.getByLabel("Expense note", { exact: true }).fill("Discard me");
    await page.getByRole("button", { name: "Save expense", exact: true }).click();
    await page.getByRole("button", { name: "Transaction history", exact: true }).click();
    await page.getByRole("button", { name: "Delete Discard me", exact: true }).click();
    await page.getByRole("button", { name: "Confirm delete", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Transaction deleted");
    await expect(page.getByText("₱1,012.00", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Back to account", exact: true }).click();
    await page.getByRole("button", { name: "Back to accounts", exact: true }).click();
    await page.getByRole("button", { name: "Add account", exact: true }).click();
    await page.getByLabel("Account name", { exact: true }).fill("Reserve");
    await page.getByRole("button", { name: "Save account", exact: true }).click();
    await expect(page.getByText("Reserve", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "View account Cash", exact: true }).click();
    await page.getByRole("button", { name: "Transfer between accounts", exact: true }).click();
    await page.getByLabel("Transfer amount", { exact: true }).fill("100");
    await page.getByLabel("Transfer fee (optional)", { exact: true }).fill("2.25");
    await page.getByLabel("Transfer note", { exact: true }).fill("Reserve move");
    await page.getByRole("button", { name: "Save transfer", exact: true }).click();
    await expect(page.getByText("₱909.75", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Back to accounts", exact: true }).click();

    const downloadPromise = page.waitForEvent("download");
    await openDataManagement(page);
    await page.getByRole("button", { name: "Export backup", exact: true }).click();
    const download = await downloadPromise;
    const backupText = await (await import("node:fs/promises")).readFile(await download.path(), "utf8");
    const backup = JSON.parse(backupText);
    expect(backup).toMatchObject({
      format: "kuwi.backup",
      version: 1,
      schemaVersion: 10,
      integrity: { algorithm: "SHA-256" },
      data: {
        profiles: [{ preferred_name: "Anthony", preferred_currency: "PHP", monthly_cycle_start_day: 1 }],
        accounts: expect.arrayContaining([
          expect.objectContaining({ name: "Cash", currency_code: "PHP" }),
          expect.objectContaining({ name: "Reserve", currency_code: "PHP" }),
        ]),
        categories: expect.arrayContaining([expect.objectContaining({ id: "food", label: "Food" })]),
        expenses: expect.arrayContaining([
          expect.objectContaining({ note: "Coffee corrected", amount_minor: 1300, transfer_id: null }),
          expect.objectContaining({ note: "Bank transfer fee to Reserve", amount_minor: 225, transfer_id: expect.any(String) }),
        ]),
        pendingOperations: expect.arrayContaining([
          expect.objectContaining({ operation_type: "account.create" }),
        ]),
        pendingSyncOperations: expect.arrayContaining([
          expect.objectContaining({ operation_id: backup.data.expenses[0].id }),
        ]),
        incomeCategories: expect.arrayContaining([
          expect.objectContaining({ id: "salary", label: "Salary" }),
        ]),
        incomes: [expect.objectContaining({ note: "Monthly pay", amount_minor: 2500, planned: 0 })],
        pendingIncomeSyncOperations: expect.arrayContaining([
          expect.objectContaining({ operation_id: backup.data.incomes[0].id }),
        ]),
        transfers: [expect.objectContaining({ amount_minor: 10000, fee_amount_minor: 225, note: "Reserve move" })],
        pendingTransferOperations: expect.arrayContaining([
          expect.objectContaining({ operation_id: backup.data.transfers[0].id }),
        ]),
        pendingTransactionOperations: expect.arrayContaining([
          expect.objectContaining({
            transaction_kind: "expense",
            transaction_id: backup.data.expenses.find(({ note }) => note === "Coffee corrected").id,
            operation_type: "edit",
          }),
          expect.objectContaining({
            transaction_kind: "expense",
            operation_type: "delete",
          }),
        ]),
      },
    });
    expect(backup.data.pendingTransactionOperations).toHaveLength(2);

    const sameCurrencyV6Backup = structuredClone(backup);
    sameCurrencyV6Backup.schemaVersion = 6;
    removePlannedFields(sameCurrencyV6Backup);
    delete sameCurrencyV6Backup.data.budgets;
    delete sameCurrencyV6Backup.data.pendingBudgetOperations;
    sameCurrencyV6Backup.data.transfers = sameCurrencyV6Backup.data.transfers.map(
      ({ received_amount_minor, exchange_rate, ...transfer }) => transfer,
    );
    await restoreFile(page, {
      name: "same-currency-v6.kuwi.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(withValidDigest(sameCurrencyV6Backup))),
    });
    await expect(page.getByText("₱909.75", { exact: true })).toBeVisible();

    const currencyV7Backup = structuredClone(backup);
    currencyV7Backup.schemaVersion = 7;
    removePlannedFields(currencyV7Backup);
    delete currencyV7Backup.data.budgets;
    delete currencyV7Backup.data.pendingBudgetOperations;
    await restoreFile(page, {
      name: "currency-v7.kuwi.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(withValidDigest(currencyV7Backup))),
    });
    await expect(page.getByText("₱909.75", { exact: true })).toBeVisible();

    const budgetV7Backup = structuredClone(backup);
    budgetV7Backup.schemaVersion = 7;
    removePlannedFields(budgetV7Backup);
    budgetV7Backup.data.transfers = budgetV7Backup.data.transfers.map(
      ({ received_amount_minor, exchange_rate, ...transfer }) => transfer,
    );
    await restoreFile(page, {
      name: "budget-v7.kuwi.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(withValidDigest(budgetV7Backup))),
    });
    await expect(page.getByText("₱909.75", { exact: true })).toBeVisible();

    const currencyV8Backup = structuredClone(backup);
    currencyV8Backup.schemaVersion = 8;
    removeV10Fields(currencyV8Backup);
    currencyV8Backup.data.expenses = currencyV8Backup.data.expenses.map(
      ({ planned, planned_amount_minor, ...expense }) => expense,
    );
    currencyV8Backup.data.incomes = currencyV8Backup.data.incomes.map(
      ({ planned_amount_minor, ...income }) => income,
    );
    await restoreFile(page, {
      name: "currency-v8.kuwi.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(withValidDigest(currencyV8Backup))),
    });
    await expect(page.getByText("₱909.75", { exact: true })).toBeVisible();

    const plannedV8Backup = structuredClone(backup);
    plannedV8Backup.schemaVersion = 8;
    removeV10Fields(plannedV8Backup);
    plannedV8Backup.data.transfers = plannedV8Backup.data.transfers.map(
      ({ received_amount_minor, exchange_rate, ...transfer }) => transfer,
    );
    await restoreFile(page, {
      name: "planned-v8.kuwi.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(withValidDigest(plannedV8Backup))),
    });
    await expect(page.getByText("₱909.75", { exact: true })).toBeVisible();

    const plannedV9Backup = structuredClone(backup);
    plannedV9Backup.schemaVersion = 9;
    removeV10Fields(plannedV9Backup);
    await restoreFile(page, {
      name: "planned-v9.kuwi.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(withValidDigest(plannedV9Backup))),
    });
    await expect(page.getByText("₱909.75", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "View account Cash", exact: true }).click();
    await page.getByRole("button", { name: "Add expense", exact: true }).click();
    await page.getByLabel("Expense amount", { exact: true }).fill("5");
    await page.getByLabel("Expense note", { exact: true }).fill("Water");
    await page.getByRole("button", { name: "Save expense", exact: true }).click();
    await expect(page.getByText("₱904.75", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Back to accounts", exact: true }).click();

    await restoreFile(page, {
      name: "not-json.json",
      mimeType: "application/json",
      buffer: Buffer.from("not a Kuwi backup"),
    });
    await expect(page.getByRole("alert")).toContainText("not valid JSON");
    await expect(page.getByText("Cash: ₱904.75")).toBeVisible();

    const broken = { ...backup, data: { ...backup.data, expenses: [] } };
    await restoreFile(page, {
      name: "broken.kuwi.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(broken)),
    });
    await expect(page.getByRole("alert")).toContainText("integrity");
    await expect(page.getByText("Cash: ₱904.75")).toBeVisible();

    const badReference = structuredClone(backup);
    badReference.data.expenses[0].account_id = "missing-account";
    await restoreFile(page, {
      name: "bad-reference.kuwi.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(withValidDigest(badReference))),
    });
    await expect(page.getByRole("alert")).toContainText("reference");
    await expect(page.getByText("Cash: ₱904.75")).toBeVisible();

    const orphanedOperation = structuredClone(backup);
    orphanedOperation.data.pendingTransactionOperations.find(
      ({ operation_type }) => operation_type === "edit",
    ).transaction_id = "missing-transaction";
    await restoreFile(page, {
      name: "orphaned-transaction-operation.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(withValidDigest(orphanedOperation))),
    });
    await expect(page.getByRole("alert")).toContainText("transaction operation is orphaned");
    await expect(page.getByText("Cash: ₱904.75")).toBeVisible();

    const tamperedCreateReceipt = structuredClone(backup);
    tamperedCreateReceipt.data.pendingSyncOperations[0].request_fingerprint = "{}";
    await restoreFile(page, {
      name: "tampered-create-receipt.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(withValidDigest(tamperedCreateReceipt))),
    });
    await expect(page.getByRole("alert")).toContainText("expense create receipt is invalid");
    await expect(page.getByText("Cash: ₱904.75")).toBeVisible();

    const orphanedLog = structuredClone(backup);
    orphanedLog.data.pendingTransactionOperations.push({
      operation_id: "orphaned-log",
      transaction_kind: "expense",
      transaction_id: "missing-transaction",
      operation_type: "log",
      request_fingerprint: "a".repeat(64),
      created_at: "2026-11-08T00:00:00.000Z",
    });
    await restoreFile(page, {
      name: "orphaned-log-receipt.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(withValidDigest(orphanedLog))),
    });
    await expect(page.getByRole("alert")).toContainText("transaction operation is orphaned");
    await expect(page.getByText("Cash: ₱904.75")).toBeVisible();

    const duplicateCurrency = structuredClone(backup);
    duplicateCurrency.data.currencies[1] = { ...duplicateCurrency.data.currencies[0] };
    await restoreFile(page, {
      name: "duplicate-currency.kuwi.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(withValidDigest(duplicateCurrency))),
    });
    await expect(page.getByRole("alert")).toContainText("currencies contains duplicate code");
    await expect(page.getByText("Cash: ₱904.75")).toBeVisible();

    const futureExpense = structuredClone(backup);
    futureExpense.data.expenses[0].date = "9999-12-31";
    await restoreFile(page, {
      name: "future-expense.kuwi.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(withValidDigest(futureExpense))),
    });
    await expect(page.getByRole("alert")).toContainText("expense date or planned flag is invalid");
    await expect(page.getByText("Cash: ₱904.75")).toBeVisible();

    const unsupported = { ...backup, version: 99 };
    await restoreFile(page, {
      name: "unsupported.kuwi.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(unsupported)),
    });
    await expect(page.getByRole("alert")).toContainText("version");
    await expect(page.getByText("Cash: ₱904.75")).toBeVisible();

    const incomeOnlyBackup = structuredClone(backup);
    incomeOnlyBackup.schemaVersion = 4;
    removePlannedFields(incomeOnlyBackup);
    delete incomeOnlyBackup.data.budgets;
    delete incomeOnlyBackup.data.pendingBudgetOperations;
    const linkedFeeIds = new Set(
      incomeOnlyBackup.data.expenses.filter((expense) => expense.transfer_id).map(({ id }) => id),
    );
    incomeOnlyBackup.data.expenses = incomeOnlyBackup.data.expenses
      .filter(({ id }) => !linkedFeeIds.has(id))
      .map(({ transfer_id, ...expense }) => expense);
    incomeOnlyBackup.data.pendingSyncOperations = incomeOnlyBackup.data.pendingSyncOperations
      .filter(({ operation_id }) => !linkedFeeIds.has(operation_id));
    delete incomeOnlyBackup.data.transfers;
    delete incomeOnlyBackup.data.pendingTransferOperations;
    delete incomeOnlyBackup.data.pendingTransactionOperations;
    await restoreFile(page, {
      name: "income-only-v4.kuwi.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(withValidDigest(incomeOnlyBackup))),
    });
    await expect(page.getByText("₱1,012.00", { exact: true })).toBeVisible();

    const transferOnlyBackup = structuredClone(backup);
    transferOnlyBackup.schemaVersion = 4;
    removePlannedFields(transferOnlyBackup);
    delete transferOnlyBackup.data.budgets;
    delete transferOnlyBackup.data.pendingBudgetOperations;
    transferOnlyBackup.data.transfers = transferOnlyBackup.data.transfers.map(
      ({ received_amount_minor, exchange_rate, ...transfer }) => transfer,
    );
    delete transferOnlyBackup.data.incomeCategories;
    delete transferOnlyBackup.data.incomes;
    delete transferOnlyBackup.data.pendingIncomeSyncOperations;
    delete transferOnlyBackup.data.pendingTransactionOperations;
    await restoreFile(page, {
      name: "transfer-only-v4.kuwi.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(withValidDigest(transferOnlyBackup))),
    });
    await expect(page.getByText("₱884.75", { exact: true })).toBeVisible();

    const v4Backup = structuredClone(backup);
    v4Backup.schemaVersion = 4;
    removePlannedFields(v4Backup);
    delete v4Backup.data.budgets;
    delete v4Backup.data.pendingBudgetOperations;
    v4Backup.data.transfers = v4Backup.data.transfers.map(
      ({ received_amount_minor, exchange_rate, ...transfer }) => transfer,
    );
    delete v4Backup.data.pendingTransactionOperations;
    await restoreFile(page, {
      name: "combined-v4.kuwi.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(withValidDigest(v4Backup))),
    });
    await expect(page.getByText("₱909.75", { exact: true })).toBeVisible();

    const receiptOnlyV5Backup = structuredClone(backup);
    receiptOnlyV5Backup.schemaVersion = 5;
    removePlannedFields(receiptOnlyV5Backup);
    delete receiptOnlyV5Backup.data.budgets;
    delete receiptOnlyV5Backup.data.pendingBudgetOperations;
    const v5TransferFeeIds = new Set(
      receiptOnlyV5Backup.data.expenses
        .filter(({ transfer_id }) => transfer_id)
        .map(({ id }) => id),
    );
    receiptOnlyV5Backup.data.expenses = receiptOnlyV5Backup.data.expenses
      .filter(({ id }) => !v5TransferFeeIds.has(id))
      .map(({ transfer_id, ...expense }) => expense);
    receiptOnlyV5Backup.data.pendingSyncOperations = receiptOnlyV5Backup.data.pendingSyncOperations
      .filter(({ operation_id }) => !v5TransferFeeIds.has(operation_id));
    delete receiptOnlyV5Backup.data.transfers;
    delete receiptOnlyV5Backup.data.pendingTransferOperations;
    await restoreFile(page, {
      name: "receipts-without-transfers-v5.kuwi.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(withValidDigest(receiptOnlyV5Backup))),
    });
    await expect(page.getByText("₱1,012.00", { exact: true })).toBeVisible();

    const legacyBackup = structuredClone(backup);
    legacyBackup.schemaVersion = 3;
    removePlannedFields(legacyBackup);
    delete legacyBackup.data.budgets;
    delete legacyBackup.data.pendingBudgetOperations;
    delete legacyBackup.data.incomeCategories;
    delete legacyBackup.data.incomes;
    delete legacyBackup.data.pendingIncomeSyncOperations;
    const legacyFeeIds = new Set(
      legacyBackup.data.expenses.filter((expense) => expense.transfer_id).map(({ id }) => id),
    );
    legacyBackup.data.expenses = legacyBackup.data.expenses
      .filter(({ id }) => !legacyFeeIds.has(id))
      .map(({ transfer_id, ...expense }) => expense);
    legacyBackup.data.pendingSyncOperations = legacyBackup.data.pendingSyncOperations
      .filter(({ operation_id }) => !legacyFeeIds.has(operation_id));
    delete legacyBackup.data.transfers;
    delete legacyBackup.data.pendingTransferOperations;
    delete legacyBackup.data.pendingTransactionOperations;
    await restoreFile(page, {
      name: "before-income.kuwi.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(withValidDigest(legacyBackup))),
    });
    await expect(page.getByText("₱987.00", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "View account Cash", exact: true }).click();
    await page.getByRole("button", { name: "Transaction history", exact: true }).click();
    await expect(page.getByText("Coffee corrected", { exact: true })).toBeVisible();
    await expect(page.getByText("Transfer to Reserve", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Bank transfer fee to Reserve", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Salary", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Back to account", exact: true }).click();
    await page.getByRole("button", { name: "Back to accounts", exact: true }).click();

    await restoreFile(page, {
      name: "my-ledger.json",
      mimeType: "text/plain",
      buffer: Buffer.from(backupText),
    });
    await expect(page.getByText("₱909.75", { exact: true })).toBeVisible();
    await restoreFile(page, {
      name: "same-ledger-again.json",
      mimeType: "application/json",
      buffer: Buffer.from(backupText),
    });
    await expect(page.getByText("₱909.75", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "View account Cash", exact: true }).click();
    await page.getByRole("button", { name: "Transaction history", exact: true }).click();
    await expect(page.getByText("Coffee corrected", { exact: true })).toBeVisible();
    await expect(page.getByText(/Salary ·/)).toBeVisible();
    await expect(page.getByText("Monthly pay", { exact: true })).toBeVisible();
    await expect(page.getByText("Transfer to Reserve", { exact: true })).toBeVisible();
    await expect(page.getByText("Bank transfer fee to Reserve", { exact: true })).toBeVisible();
    await expect(page.getByText("Water", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Back to account", exact: true }).click();

    const restoredDownloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Back to accounts", exact: true }).click();
    await openDataManagement(page);
    await page.getByRole("button", { name: "Export backup", exact: true }).click();
    const restoredDownload = await restoredDownloadPromise;
    const restoredBackup = JSON.parse(await (await import("node:fs/promises")).readFile(await restoredDownload.path(), "utf8"));
    expect(restoredBackup.data.expenses.map(({ id }) => id)).toEqual(backup.data.expenses.map(({ id }) => id));
    expect(restoredBackup.data.pendingSyncOperations).toEqual(backup.data.pendingSyncOperations);
    expect(restoredBackup.data.incomes.map(({ id }) => id)).toEqual(backup.data.incomes.map(({ id }) => id));
    expect(restoredBackup.data.pendingIncomeSyncOperations).toEqual(backup.data.pendingIncomeSyncOperations);
    expect(restoredBackup.data.transfers.map(({ id }) => id)).toEqual(backup.data.transfers.map(({ id }) => id));
    expect(restoredBackup.data.pendingTransferOperations).toEqual(backup.data.pendingTransferOperations);
    expect(restoredBackup.data.pendingTransactionOperations).toEqual(backup.data.pendingTransactionOperations);
    expect(restoredBackup.data.pendingOperations.map(({ id }) => id)).toEqual(backup.data.pendingOperations.map(({ id }) => id));

    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await context.close();
    context = await browserType.launchPersistentContext(directory, {
      baseURL,
      offline: true,
    });
    page = await context.newPage();
    await page.goto("/");
    await expect(page.getByText("₱909.75", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "View account Cash", exact: true }).click();
    await page.getByRole("button", { name: "Add expense", exact: true }).click();
    await page.getByLabel("Expense amount", { exact: true }).fill("2");
    await page.getByLabel("Expense note", { exact: true }).fill("Offline tea");
    await page.getByRole("button", { name: "Save expense", exact: true }).click();
    await expect(page.getByText("₱907.75", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Transaction history", exact: true }).click();
    await expect(page.getByText("Coffee corrected", { exact: true })).toBeVisible();
    await expect(page.getByText(/Salary ·/)).toBeVisible();
    await expect(page.getByText("Transfer to Reserve", { exact: true })).toBeVisible();
    await expect(page.getByText("Bank transfer fee to Reserve", { exact: true })).toBeVisible();
    await expect(page.getByText("Offline tea", { exact: true })).toBeVisible();
  } finally {
    try {
      await context.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
});

test("restore rejects invalid cross-currency amounts and missing transfer receipts", async ({
  browserName,
  baseURL,
}, testInfo) => {
  const browserType = browserName === "webkit" ? webkit : chromium;
  const directory = testInfo.outputPath("invalid-transfer-backup-profile");
  await rm(directory, { recursive: true, force: true });
  const context = await browserType.launchPersistentContext(directory, { baseURL });
  try {
    const page = await context.newPage();
    await finishSetup(page);
    await page.getByRole("button", { name: "Add account", exact: true }).click();
    await page.getByLabel("Account name", { exact: true }).fill("Dollar wallet");
    await page.getByRole("button", { name: "USD US Dollar", exact: true }).click();
    await page.getByRole("button", { name: "Save account", exact: true }).click();
    await page.getByRole("button", { name: "View account Cash", exact: true }).click();
    await page.getByRole("button", { name: "Transfer between accounts", exact: true }).click();
    await page.getByLabel("To account", { exact: true }).selectOption({ label: "Dollar wallet" });
    await page.getByLabel("Transfer amount", { exact: true }).fill("100");
    await page.getByLabel("Exchange rate", { exact: true }).fill("0.018");
    await page.getByLabel("Transfer fee (optional)", { exact: true }).fill("1");
    await page.getByRole("button", { name: "Save transfer", exact: true }).click();
    await expect(page.getByText("₱899.00", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Back to accounts", exact: true }).click();

    const downloadPromise = page.waitForEvent("download");
    await openDataManagement(page);
    await page.getByRole("button", { name: "Export backup", exact: true }).click();
    const backup = JSON.parse(await (await import("node:fs/promises")).readFile(
      await (await downloadPromise).path(),
      "utf8",
    ));
    const invalidAmount = structuredClone(backup);
    invalidAmount.data.transfers[0].received_amount_minor = 0;
    await restoreFile(page, {
      name: "invalid-received-amount.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(withValidDigest(invalidAmount))),
    });
    await expect(page.getByRole("alert")).toContainText("received_amount_minor is invalid");
    await expect(page.getByText("Cash: ₱899.00")).toBeVisible();

    const missingReceipt = structuredClone(backup);
    missingReceipt.data.pendingTransferOperations = [];
    await restoreFile(page, {
      name: "missing-transfer-receipt.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(withValidDigest(missingReceipt))),
    });
    await expect(page.getByRole("alert")).toContainText("transfer is missing its pending operation");
    await expect(page.getByText("Cash: ₱899.00")).toBeVisible();
  } finally {
    await context.close();
  }
});

test("a failed restore keeps saved transactions and their edit receipts", async ({
  browserName,
  baseURL,
  storageFault,
}, testInfo) => {
  storageFault.failRestore = true;
  const browserType = browserName === "webkit" ? webkit : chromium;
  const directory = testInfo.outputPath("failed-backup-browser-profile");
  await rm(directory, { recursive: true, force: true });
  const context = await browserType.launchPersistentContext(
    directory,
    { baseURL },
  );
  try {
    const page = await context.newPage();
    await finishSetup(page);
    await page.getByRole("button", { name: "View account Cash", exact: true }).click();
    await page.getByRole("button", { name: "Add expense", exact: true }).click();
    await page.getByLabel("Expense amount", { exact: true }).fill("10");
    await page.getByLabel("Expense note", { exact: true }).fill("Coffee");
    await page.getByRole("button", { name: "Save expense", exact: true }).click();
    await page.getByRole("button", { name: "Transaction history", exact: true }).click();
    await page.getByRole("button", { name: "Edit Coffee", exact: true }).click();
    await page.getByLabel("Transaction amount", { exact: true }).fill("12");
    await page.getByLabel("Expense note", { exact: true }).fill("Corrected coffee");
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Transaction updated");
    await expect(page.getByText("₱988.00", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Back to account", exact: true }).click();
    await page.getByRole("button", { name: "Back to accounts", exact: true }).click();

    const downloadPromise = page.waitForEvent("download");
    await openDataManagement(page);
    await page.getByRole("button", { name: "Export backup", exact: true }).click();
    const download = await downloadPromise;
    const backupText = await (await import("node:fs/promises")).readFile(await download.path(), "utf8");
    await restoreFile(page, {
      name: "candidate.json",
      mimeType: "application/json",
      buffer: Buffer.from(backupText),
    });
    await expect(page.getByRole("alert")).toContainText("Simulated restore write failure");
    await page.getByRole("button", { name: "Cancel restore", exact: true }).click();
    await page.getByRole("button", { name: "Back to accounts", exact: true }).click();
    await expect(page.getByText("₱988.00", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "View account Cash", exact: true }).click();
    await page.getByRole("button", { name: "Transaction history", exact: true }).click();
    await expect(page.getByText("Corrected coffee", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Back to account", exact: true }).click();
    await page.getByRole("button", { name: "Back to accounts", exact: true }).click();
    const preservedDownloadPromise = page.waitForEvent("download");
    await openDataManagement(page);
    await page.getByRole("button", { name: "Export backup", exact: true }).click();
    const preservedDownload = await preservedDownloadPromise;
    const preservedBackup = JSON.parse(await (await import("node:fs/promises")).readFile(await preservedDownload.path(), "utf8"));
    expect(preservedBackup.data.pendingTransactionOperations).toHaveLength(1);
    expect(preservedBackup.data.pendingTransactionOperations[0]).toMatchObject({
      transaction_id: preservedBackup.data.expenses[0].id,
      operation_type: "edit",
    });
    await page.getByRole("button", { name: "Back to accounts", exact: true }).click();

    await page.getByRole("button", { name: "View account Cash", exact: true }).click();
    await page.getByRole("button", { name: "Add expense", exact: true }).click();
    await page.getByLabel("Expense amount", { exact: true }).fill("1");
    await page.getByLabel("Expense note", { exact: true }).fill("Still saved");
    await page.getByRole("button", { name: "Save expense", exact: true }).click();
    await expect(page.getByText("₱987.00", { exact: true })).toBeVisible();
  } finally {
    await context.close();
  }
});
