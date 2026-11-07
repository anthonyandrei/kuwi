import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
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
      await provide(`http://127.0.0.1:${server.address().port}`);
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  },
});

/** Complete visible first-run setup with the independent PHP 1,000 test example.
 * @param {import("@playwright/test").Page} page - Browser page to drive.
 * @returns {Promise<void>} Resolves after the saved balance appears.
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

/** Supply a candidate through the real browser file picker.
 * @param {import("@playwright/test").Page} page - Browser page with the restore action.
 * @param {import("@playwright/test").FilePayload} file - Name, MIME hint, and candidate bytes.
 * @returns {Promise<void>} Resolves after the browser hands the file to the app.
 */
async function restoreFile(page, file) {
  const chooserPromise = page.waitForEvent("filechooser", { timeout: 5000 });
  await page.getByRole("button", { name: "Restore backup", exact: true }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles(file);
}

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
}, testInfo) => {
  const browserType = browserName === "webkit" ? webkit : chromium;
  const directory = testInfo.outputPath("backup-browser-profile");
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
    await page.getByRole("button", { name: "Back to accounts", exact: true }).click();
    await page.getByRole("button", { name: "Add account", exact: true }).click();
    await page.getByLabel("Account name", { exact: true }).fill("Reserve");
    await page.getByRole("button", { name: "Save account", exact: true }).click();
    await expect(page.getByText("Reserve", { exact: true })).toBeVisible();

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export backup", exact: true }).click();
    const download = await downloadPromise;
    const backupText = await (await import("node:fs/promises")).readFile(await download.path(), "utf8");
    const backup = JSON.parse(backupText);
    expect(backup).toMatchObject({
      format: "kuwi.backup",
      version: 1,
      schemaVersion: 4,
      integrity: { algorithm: "SHA-256" },
      data: {
        profiles: [{ preferred_name: "Anthony", preferred_currency: "PHP" }],
        accounts: expect.arrayContaining([
          expect.objectContaining({ name: "Cash", currency_code: "PHP" }),
          expect.objectContaining({ name: "Reserve", currency_code: "PHP" }),
        ]),
        categories: expect.arrayContaining([expect.objectContaining({ id: "food", label: "Food" })]),
        expenses: [expect.objectContaining({ note: "Coffee", amount_minor: 1200 })],
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
      },
    });

    await page.getByRole("button", { name: "View account Cash", exact: true }).click();
    await page.getByRole("button", { name: "Add expense", exact: true }).click();
    await page.getByLabel("Expense amount", { exact: true }).fill("5");
    await page.getByLabel("Expense note", { exact: true }).fill("Water");
    await page.getByRole("button", { name: "Save expense", exact: true }).click();
    await expect(page.getByText("₱1,008.00", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Back to accounts", exact: true }).click();

    await restoreFile(page, {
      name: "not-json.json",
      mimeType: "application/json",
      buffer: Buffer.from("not a Kuwi backup"),
    });
    await expect(page.getByRole("alert")).toContainText("not valid JSON");
    await expect(page.getByText("₱1,008.00", { exact: true })).toBeVisible();

    const broken = { ...backup, data: { ...backup.data, expenses: [] } };
    await restoreFile(page, {
      name: "broken.kuwi.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(broken)),
    });
    await expect(page.getByRole("alert")).toContainText("integrity");
    await expect(page.getByText("₱1,008.00", { exact: true })).toBeVisible();

    const badReference = structuredClone(backup);
    badReference.data.expenses[0].account_id = "missing-account";
    await restoreFile(page, {
      name: "bad-reference.kuwi.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(withValidDigest(badReference))),
    });
    await expect(page.getByRole("alert")).toContainText("reference");
    await expect(page.getByText("₱1,008.00", { exact: true })).toBeVisible();

    const duplicateCurrency = structuredClone(backup);
    duplicateCurrency.data.currencies[1] = { ...duplicateCurrency.data.currencies[0] };
    await restoreFile(page, {
      name: "duplicate-currency.kuwi.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(withValidDigest(duplicateCurrency))),
    });
    await expect(page.getByRole("alert")).toContainText("currencies contains duplicate code");
    await expect(page.getByText("₱1,008.00", { exact: true })).toBeVisible();

    const futureExpense = structuredClone(backup);
    futureExpense.data.expenses[0].date = "9999-12-31";
    await restoreFile(page, {
      name: "future-expense.kuwi.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(withValidDigest(futureExpense))),
    });
    await expect(page.getByRole("alert")).toContainText("expense date is invalid");
    await expect(page.getByText("₱1,008.00", { exact: true })).toBeVisible();

    const unsupported = { ...backup, version: 99 };
    await restoreFile(page, {
      name: "unsupported.kuwi.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(unsupported)),
    });
    await expect(page.getByRole("alert")).toContainText("version");
    await expect(page.getByText("₱1,008.00", { exact: true })).toBeVisible();

    const legacyBackup = structuredClone(backup);
    legacyBackup.schemaVersion = 3;
    delete legacyBackup.data.incomeCategories;
    delete legacyBackup.data.incomes;
    delete legacyBackup.data.pendingIncomeSyncOperations;
    await restoreFile(page, {
      name: "before-income.kuwi.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(withValidDigest(legacyBackup))),
    });
    await expect(page.getByText("₱988.00", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "View account Cash", exact: true }).click();
    await page.getByRole("button", { name: "Transaction history", exact: true }).click();
    await expect(page.getByText("Coffee", { exact: true })).toBeVisible();
    await expect(page.getByText("Salary", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Back to account", exact: true }).click();
    await page.getByRole("button", { name: "Back to accounts", exact: true }).click();

    await restoreFile(page, {
      name: "my-ledger.json",
      mimeType: "text/plain",
      buffer: Buffer.from(backupText),
    });
    await expect(page.getByText("₱1,013.00", { exact: true })).toBeVisible();
    await restoreFile(page, {
      name: "same-ledger-again.json",
      mimeType: "application/json",
      buffer: Buffer.from(backupText),
    });
    await expect(page.getByText("₱1,013.00", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "View account Cash", exact: true }).click();
    await page.getByRole("button", { name: "Transaction history", exact: true }).click();
    await expect(page.getByText("Coffee", { exact: true })).toBeVisible();
    await expect(page.getByText(/Salary ·/)).toBeVisible();
    await expect(page.getByText("Monthly pay", { exact: true })).toBeVisible();
    await expect(page.getByText("Water", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Back to account", exact: true }).click();

    const restoredDownloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Back to accounts", exact: true }).click();
    await page.getByRole("button", { name: "Export backup", exact: true }).click();
    const restoredDownload = await restoredDownloadPromise;
    const restoredBackup = JSON.parse(await (await import("node:fs/promises")).readFile(await restoredDownload.path(), "utf8"));
    expect(restoredBackup.data.expenses.map(({ id }) => id)).toEqual(backup.data.expenses.map(({ id }) => id));
    expect(restoredBackup.data.pendingSyncOperations).toEqual(backup.data.pendingSyncOperations);
    expect(restoredBackup.data.incomes.map(({ id }) => id)).toEqual(backup.data.incomes.map(({ id }) => id));
    expect(restoredBackup.data.pendingIncomeSyncOperations).toEqual(backup.data.pendingIncomeSyncOperations);
    expect(restoredBackup.data.pendingOperations.map(({ id }) => id)).toEqual(backup.data.pendingOperations.map(({ id }) => id));

    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await context.close();
    context = await browserType.launchPersistentContext(directory, {
      baseURL,
      offline: true,
    });
    page = await context.newPage();
    await page.goto("/");
    await expect(page.getByText("₱1,013.00", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "View account Cash", exact: true }).click();
    await page.getByRole("button", { name: "Add expense", exact: true }).click();
    await page.getByLabel("Expense amount", { exact: true }).fill("2");
    await page.getByLabel("Expense note", { exact: true }).fill("Offline tea");
    await page.getByRole("button", { name: "Save expense", exact: true }).click();
    await expect(page.getByText("₱1,011.00", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Transaction history", exact: true }).click();
    await expect(page.getByText("Coffee", { exact: true })).toBeVisible();
    await expect(page.getByText(/Salary ·/)).toBeVisible();
    await expect(page.getByText("Offline tea", { exact: true })).toBeVisible();
  } finally {
    await context.close();
  }
});

test("a failed restore rolls back after replacement starts and keeps the saved account", async ({
  browserName,
  baseURL,
  storageFault,
}, testInfo) => {
  storageFault.failRestore = true;
  const browserType = browserName === "webkit" ? webkit : chromium;
  const context = await browserType.launchPersistentContext(
    testInfo.outputPath("failed-backup-browser-profile"),
    { baseURL },
  );
  try {
    const page = await context.newPage();
    await finishSetup(page);
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export backup", exact: true }).click();
    const download = await downloadPromise;
    const backupText = await (await import("node:fs/promises")).readFile(await download.path(), "utf8");
    await restoreFile(page, {
      name: "candidate.json",
      mimeType: "application/json",
      buffer: Buffer.from(backupText),
    });
    await expect(page.getByRole("alert")).toContainText("Simulated restore write failure");
    await expect(page.getByText("₱1,000.00", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "View account Cash", exact: true }).click();
    await page.getByRole("button", { name: "Add expense", exact: true }).click();
    await page.getByLabel("Expense amount", { exact: true }).fill("1");
    await page.getByLabel("Expense note", { exact: true }).fill("Still saved");
    await page.getByRole("button", { name: "Save expense", exact: true }).click();
    await expect(page.getByText("₱999.00", { exact: true })).toBeVisible();
  } finally {
    await context.close();
  }
});
