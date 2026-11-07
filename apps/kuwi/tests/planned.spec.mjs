import { randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test as base, expect, webkit } from "@playwright/test";
import { startServer } from "../scripts/serve.mjs";

const populatedV7 = readFileSync(new URL("./fixtures/populated-v7.sql", import.meta.url), "utf8");
const populatedV8Currency = `${populatedV7}
ALTER TABLE transfers ADD COLUMN received_amount_minor INTEGER NOT NULL DEFAULT 1 CHECK(received_amount_minor>0);
ALTER TABLE transfers ADD COLUMN exchange_rate TEXT NOT NULL DEFAULT '1' CHECK(length(exchange_rate)>0);
UPDATE accounts SET currency_code='USD' WHERE id='legacy-reserve';
INSERT INTO transfers(id,from_account_id,to_account_id,amount_minor,date,note,created_at,received_amount_minor,exchange_rate)
  VALUES('legacy-fx','legacy-cash','legacy-reserve',10000,'2026-11-04','Legacy FX','2026-11-04T08:00:00.000Z',180,'0.018');
INSERT INTO expenses(id,account_id,category_id,amount_minor,date,note,created_at,transfer_id)
  VALUES('fee:legacy-fx','legacy-cash','fees',500,'2026-11-04','Legacy FX fee','2026-11-04T08:00:00.000Z','legacy-fx');
INSERT INTO pending_sync_operations(operation_id) VALUES('fee:legacy-fx');
INSERT INTO pending_transfer_operations(operation_id,request_fingerprint)
  VALUES('legacy-fx','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
PRAGMA user_version=8;`;
const populatedV8Planned = `${populatedV7}
ALTER TABLE expenses ADD COLUMN planned INTEGER NOT NULL DEFAULT 0 CHECK(planned IN (0,1));
ALTER TABLE expenses ADD COLUMN planned_amount_minor INTEGER CHECK(planned_amount_minor IS NULL OR planned_amount_minor>=0);
ALTER TABLE incomes ADD COLUMN planned_amount_minor INTEGER CHECK(planned_amount_minor IS NULL OR planned_amount_minor>=0);
UPDATE expenses SET planned=1, planned_amount_minor=amount_minor WHERE id='legacy-expense';
UPDATE incomes SET planned=1, planned_amount_minor=amount_minor WHERE id='legacy-income';
ALTER TABLE pending_transaction_operations RENAME TO pending_transaction_operations_v7;
CREATE TABLE pending_transaction_operations(
  operation_id TEXT PRIMARY KEY NOT NULL,
  transaction_kind TEXT NOT NULL CHECK(transaction_kind IN ('expense','income')),
  transaction_id TEXT NOT NULL,
  operation_type TEXT NOT NULL CHECK(operation_type IN ('edit','delete','log')),
  request_fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;
INSERT INTO pending_transaction_operations SELECT * FROM pending_transaction_operations_v7;
INSERT INTO pending_transaction_operations VALUES(
  'legacy-expense-log','expense','legacy-expense','log',
  'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
  '2026-11-05T08:00:00.000Z'
);
DROP TABLE pending_transaction_operations_v7;
PRAGMA user_version=8;`;

const test = base.extend({
  storageFault: async ({}, provide) => {
    await provide({
      today: null,
      failExpenseSave: false,
      failLog: false,
      loseLogReply: false,
      upgradeV7: false,
      failMigration: false,
      upgradeV8Layout: null,
    });
  },
  baseURL: async ({ storageFault }, provide) => {
    const server = startServer(0, (path, bytes) => {
      if (path !== "/db-worker.js") return bytes;
      let source = bytes.toString();
      const dateHelper = source.match(/function localDate\(\) \{[\s\S]*?\n\}/)?.[0];
      if (!dateHelper) throw Error("Could not find the worker local-date helper.");
      source = source.replace(dateHelper, `let __kuwiTestToday = ${JSON.stringify(storageFault.today)};
const __kuwiTestClock = new BroadcastChannel("kuwi-planned-test-clock");
__kuwiTestClock.onmessage = ({ data }) => {
  if (data?.today) {
    __kuwiTestToday = data.today;
    __kuwiTestClock.postMessage({ ack: data.today });
  }
};
${dateHelper.replace("function localDate() {", "function localDate() {\n  if (__kuwiTestToday) return __kuwiTestToday;")}`);
      if (storageFault.upgradeV7 || storageFault.upgradeV8Layout) {
        const fixture = storageFault.upgradeV8Layout === "currency" ? populatedV8Currency
          : storageFault.upgradeV8Layout === "planned" ? populatedV8Planned
            : populatedV7;
        storageFault.upgradeV7 = false;
        storageFault.upgradeV8Layout = null;
        source = source.replace(
          'const version = db.selectValue("PRAGMA user_version");',
          `const originalVersion=db.selectValue("PRAGMA user_version"); if(originalVersion===0){db.exec(${JSON.stringify(fixture)});} const version = db.selectValue("PRAGMA user_version");`,
        );
      }
      if (storageFault.failMigration) {
        storageFault.failMigration = false;
        source = source.replace(
          '    db.exec("PRAGMA user_version=9");',
          '    db.exec("PRAGMA user_version=9"); if(!self.__v9MigrationFailed){self.__v9MigrationFailed=true;throw Error("Simulated v9 migration failure");}',
        );
      }
      if (storageFault.failExpenseSave) {
        storageFault.failExpenseSave = false;
        source = source.replace(
          `    db.exec({
      sql: "INSERT INTO expenses(id, account_id, category_id, amount_minor, date, note, created_at, planned, planned_amount_minor) VALUES(?,?,?,?,?,?,?,?,NULL)",
      bind: [operationId, accountId, categoryId, amountMinor, date, note, createdAt, Number(planned)],
    });
    db.exec({
      sql: "INSERT INTO pending_sync_operations(operation_id) VALUES(?)",`,
          `    db.exec({
      sql: "INSERT INTO expenses(id, account_id, category_id, amount_minor, date, note, created_at, planned, planned_amount_minor) VALUES(?,?,?,?,?,?,?,?,NULL)",
      bind: [operationId, accountId, categoryId, amountMinor, date, note, createdAt, Number(planned)],
    });
    if (!self.__plannedExpenseSaveFailed) { self.__plannedExpenseSaveFailed = true; throw Error("Simulated planned expense save failure"); }
    db.exec({
      sql: "INSERT INTO pending_sync_operations(operation_id) VALUES(?)",`,
        );
      }
      if (storageFault.failLog) {
        storageFault.failLog = false;
        source = source.replace(
          "    db.exec({ sql: updateSql, bind: values });",
          '    db.exec({ sql: updateSql, bind: values });\n    if (operationType === "log" && !self.__plannedLogFailed) { self.__plannedLogFailed = true; throw Error("Simulated planned log failure"); }',
        );
      }
      if (storageFault.loseLogReply) {
        storageFault.loseLogReply = false;
        source = source.replace(
          "    self.postMessage({ id, result });",
          '    if (command === "updateTransaction" && args.operationType === "log" && !self.__plannedLogReplyDropped) { self.__plannedLogReplyDropped = true; self.postMessage({ id, error: "Simulated lost planned log reply" }); } else self.postMessage({ id, result });',
        );
      }
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
  context: async ({ browser, browserName, baseURL }, provide) => {
    const profile = browserName === "webkit"
      ? await mkdtemp(join(tmpdir(), "kuwi-planned-webkit-"))
      : null;
    let context;
    try {
      context = browserName === "webkit"
        ? await webkit.launchPersistentContext(profile, { baseURL })
        : await browser.newContext({ baseURL });
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

/** Freeze the page clock at local noon for one controlled date-only journey.
 * @param {import("@playwright/test").Page} page - Page to receive the clock override.
 * @param {string} value - Local calendar date in YYYY-MM-DD form.
 * @returns {Promise<void>} Resolves after Playwright installs the clock.
 */
async function setDate(page, value) {
  await page.clock.install({ time: new Date(`${value}T12:00:00`) });
}

/** Set the test worker's local calendar date and wait until it accepts the value.
 * @param {import("@playwright/test").Page} page - Page sharing the worker's origin.
 * @param {string} value - Controlled local date in YYYY-MM-DD form.
 * @returns {Promise<void>} Resolves after the database worker acknowledges the date.
 */
async function setWorkerDate(page, value) {
  await page.evaluate((today) => new Promise((resolve, reject) => {
    const channel = new BroadcastChannel("kuwi-planned-test-clock");
    const timeout = setTimeout(() => {
      channel.close();
      reject(Error("The database worker did not accept its test date."));
    }, 5000);
    channel.onmessage = ({ data }) => {
      if (data?.ack !== today) return;
      clearTimeout(timeout);
      channel.close();
      resolve();
    };
    channel.postMessage({ today });
  }), value);
}

/** Complete setup with a fixed local date and an initial PHP 1,000 balance.
 * @param {import("@playwright/test").Page} page - Page to drive through setup.
 * @param {string} date - Local calendar date used by the page and worker.
 * @returns {Promise<void>} Resolves after the opening balance appears.
 */
async function finishSetup(page, date = "2026-11-07") {
  await setDate(page, date);
  await page.goto("/");
  await page.getByRole("button", { name: "Continue offline", exact: true }).click();
  await expect(page.getByLabel("Preferred name", { exact: true })).toBeVisible();
  await setWorkerDate(page, date);
  await page.getByLabel("Preferred name", { exact: true }).fill("Anthony");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "Skip introduction", exact: true }).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByLabel("Opening balance (PHP)", { exact: true }).fill("1000");
  await page.getByRole("button", { name: "Save my account", exact: true }).click();
  await expect(page.getByText("₱1,000.00", { exact: true })).toBeVisible();
}

test("future entries remain planned across offline reopening and log on explicit action", async ({
  context,
  storageFault,
}) => {
  storageFault.today = "2026-11-07";
  let page = await context.newPage();
  await finishSetup(page);
  await page.getByRole("button", { name: "View account Cash", exact: true }).click();

  await page.getByRole("button", { name: "Add expense", exact: true }).click();
  await page.getByLabel("Expense amount", { exact: true }).fill("125");
  await page.getByLabel("Expense date", { exact: true }).fill("2026-11-08");
  await page.getByLabel("Expense note", { exact: true }).fill("Planned rent");
  await page.getByRole("button", { name: "Save expense", exact: true }).click();

  await page.getByRole("button", { name: "Add income", exact: true }).click();
  await page.getByLabel("Income amount", { exact: true }).fill("150");
  await page.getByLabel("Income date", { exact: true }).fill("2026-11-08");
  await page.getByLabel("Income note", { exact: true }).fill("Planned pay");
  await page.getByRole("button", { name: "Save income", exact: true }).click();
  await page.getByRole("button", { name: "Add expense", exact: true }).click();
  await page.getByLabel("Expense amount", { exact: true }).fill("25");
  await page.getByLabel("Expense date", { exact: true }).fill("2026-11-10");
  await page.getByLabel("Expense note", { exact: true }).fill("Still future");
  await page.getByRole("button", { name: "Save expense", exact: true }).click();
  await expect(page.getByText("₱1,000.00", { exact: true })).toBeVisible();

  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await page.close();
  storageFault.today = "2026-11-09";
  page = await context.newPage();
  await setDate(page, "2026-11-09");
  await page.goto("/");
  await expect(page.getByText("₱1,000.00", { exact: true })).toBeVisible();
  await setWorkerDate(page, "2026-11-09");
  await page.getByRole("button", { name: "View account Cash", exact: true }).click();
  await page.getByRole("button", { name: "Transaction history", exact: true }).click();
  await expect(page.getByText("Overdue", { exact: false })).toHaveCount(2);

  await page.getByRole("button", { name: "Log Planned rent", exact: true }).click();
  await expect(page.getByText("Log this expense?", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Confirm log expense", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Expense logged");
  await expect(page.getByText("₱875.00", { exact: true })).toBeVisible();
  await expect(page.getByText("₱125.00", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Log Planned pay", exact: true }).click();
  await page.getByLabel("Actual income amount", { exact: true }).fill("147");
  await page.getByRole("button", { name: "Confirm log income", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Income logged");
  await expect(page.getByText("₱1,022.00", { exact: true })).toBeVisible();
  await expect(page.getByText("+₱147.00", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Log Still future", exact: true }).click();
  await page.getByRole("button", { name: "Confirm log expense", exact: true }).click();
  await expect(page.getByText("₱997.00", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Back to account", exact: true }).click();
  await page.getByRole("button", { name: "Back to accounts", exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export backup", exact: true }).click();
  const download = await downloadPromise;
  const { readFile } = await import("node:fs/promises");
  const exported = JSON.parse(await readFile(await download.path(), "utf8"));
  expect(exported.schemaVersion).toBe(9);
  expect(exported.data.expenses).toContainEqual(expect.objectContaining({
    note: "Planned rent", amount_minor: 12500, date: "2026-11-08", planned: 0, planned_amount_minor: 12500,
  }));
  expect(exported.data.incomes).toContainEqual(expect.objectContaining({
    note: "Planned pay", amount_minor: 14700, date: "2026-11-08", planned: 0, planned_amount_minor: 15000,
  }));
  expect(exported.data.expenses).toContainEqual(expect.objectContaining({
    note: "Still future", amount_minor: 2500, date: "2026-11-09", planned: 0, planned_amount_minor: 2500,
  }));
  expect(exported.data.pendingTransactionOperations).toEqual(expect.arrayContaining([
    expect.objectContaining({ operation_type: "log", transaction_kind: "expense" }),
    expect.objectContaining({ operation_type: "log", transaction_kind: "income" }),
    expect.objectContaining({ operation_type: "log", transaction_kind: "expense" }),
  ]));

  const restorePromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Restore backup", exact: true }).click();
  const restore = await restorePromise;
  await restore.setFiles({
    name: "planned-ledger.kuwi.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(exported)),
  });
  await expect(page.getByText("Backup restored.", { exact: true })).toBeVisible();
  await expect(page.getByText("₱997.00", { exact: true })).toBeVisible();
  await page.evaluate(async () => navigator.serviceWorker.ready);
  await page.close();
  await context.setOffline(true);
  page = await context.newPage();
  await setDate(page, "2026-11-09");
  await page.goto("/");
  await expect(page.getByText("₱1,000.00", { exact: true })).toBeVisible();
  await setWorkerDate(page, "2026-11-09");
  await page.getByRole("button", { name: "View account Cash", exact: true }).click();
  await page.getByRole("button", { name: "Transaction history", exact: true }).click();
  await expect(page.getByText("₱997.00", { exact: true })).toBeVisible();
  await expect(page.getByText("Planned rent", { exact: true })).toBeVisible();
  await expect(page.getByText("Planned pay", { exact: true })).toBeVisible();
});

test("a future expense retry after its due date keeps the original planned intent", async ({
  context,
  storageFault,
}) => {
  storageFault.today = "2026-11-07";
  storageFault.failExpenseSave = true;
  const page = await context.newPage();
  await finishSetup(page);
  await page.getByRole("button", { name: "View account Cash", exact: true }).click();
  await page.getByRole("button", { name: "Add expense", exact: true }).click();
  await page.getByLabel("Expense amount", { exact: true }).fill("40");
  await page.getByLabel("Expense date", { exact: true }).fill("2026-11-08");
  await page.getByLabel("Expense note", { exact: true }).fill("Retry across due date");
  await page.getByRole("button", { name: "Save expense", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Simulated planned expense save failure");

  await page.clock.fastForward(24 * 60 * 60 * 1000);
  await setWorkerDate(page, "2026-11-08");
  await page.getByRole("button", { name: "Save expense", exact: true }).click();
  await expect(page.getByText("₱1,000.00", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Transaction history", exact: true }).click();
  await expect(page.getByText("Retry across due date", { exact: true })).toBeVisible();
  await expect(page.getByText("Planned", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Log Retry across due date", exact: true })).toBeVisible();
});

test("a planned entry stays unposted when reopened on its due date and after an ordinary edit", async ({
  context,
  storageFault,
}) => {
  storageFault.today = "2026-11-07";
  let page = await context.newPage();
  await finishSetup(page);
  await page.getByRole("button", { name: "View account Cash", exact: true }).click();
  await page.getByRole("button", { name: "Add expense", exact: true }).click();
  await page.getByLabel("Expense amount", { exact: true }).fill("40");
  await page.getByLabel("Expense date", { exact: true }).fill("2026-11-08");
  await page.getByLabel("Expense note", { exact: true }).fill("Due today plan");
  await page.getByRole("button", { name: "Save expense", exact: true }).click();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await page.close();

  storageFault.today = "2026-11-08";
  page = await context.newPage();
  await setDate(page, "2026-11-08");
  await page.goto("/");
  await expect(page.getByText("₱1,000.00", { exact: true })).toBeVisible();
  await setWorkerDate(page, "2026-11-08");
  await page.getByRole("button", { name: "View account Cash", exact: true }).click();
  await page.getByRole("button", { name: "Transaction history", exact: true }).click();
  await expect(page.getByText("Planned", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Edit Due today plan", exact: true }).click();
  await page.getByLabel("Expense note", { exact: true }).fill("Due day edit");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByText("Due day edit", { exact: true })).toBeVisible();
  await expect(page.getByText("₱1,000.00", { exact: true })).toBeVisible();

  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.close();
  storageFault.today = "2026-11-09";
  page = await context.newPage();
  await setDate(page, "2026-11-09");
  await page.goto("/");
  await expect(page.getByText("₱1,000.00", { exact: true })).toBeVisible();
  await setWorkerDate(page, "2026-11-09");
  await page.getByRole("button", { name: "View account Cash", exact: true }).click();
  await page.getByRole("button", { name: "Transaction history", exact: true }).click();
  await expect(page.getByText("Due day edit", { exact: true })).toBeVisible();
  await expect(page.getByText("Overdue", { exact: false })).toBeVisible();
});

test("a populated v7 database migrates to planned transactions with receipts intact", async ({
  page,
  storageFault,
}) => {
  storageFault.today = "2026-11-07";
  storageFault.upgradeV7 = true;
  await setDate(page, "2026-11-07");
  await page.goto("/");
  await expect(page.getByText("₱1,013.00", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "View account Cash", exact: true }).click();
  await page.getByRole("button", { name: "Transaction history", exact: true }).click();
  await expect(page.getByText("Legacy coffee", { exact: true })).toBeVisible();
  await expect(page.getByText("Legacy pay", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Back to account", exact: true }).click();
  await page.getByRole("button", { name: "Back to accounts", exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export backup", exact: true }).click();
  const download = await downloadPromise;
  const { readFile } = await import("node:fs/promises");
  const backup = JSON.parse(await readFile(await download.path(), "utf8"));
  expect(backup.schemaVersion).toBe(9);
  expect(backup.data.expenses).toEqual([
    expect.objectContaining({ id: "legacy-expense", planned: 0, planned_amount_minor: null }),
  ]);
  expect(backup.data.incomes).toEqual([
    expect.objectContaining({ id: "legacy-income", planned: 0, planned_amount_minor: null }),
  ]);
  expect(backup.data.pendingTransactionOperations).toEqual([
    expect.objectContaining({ operation_id: "legacy-edit", operation_type: "edit" }),
  ]);
  expect(backup.data.pendingBudgetOperations).toEqual([
    expect.objectContaining({ operation_id: "legacy-budget" }),
  ]);
});

test("a populated currency-aware v8 store keeps transfer amounts and canonical rates", async ({
  page,
  storageFault,
}) => {
  storageFault.today = "2026-11-07";
  storageFault.upgradeV8Layout = "currency";
  await setDate(page, "2026-11-07");
  await page.goto("/");
  await expect(page.getByText("₱908.00", { exact: true })).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export backup", exact: true }).click();
  const backup = JSON.parse(await readFile(await (await downloadPromise).path(), "utf8"));
  expect(backup.schemaVersion).toBe(9);
  expect(backup.data.transfers).toEqual([
    expect.objectContaining({
      id: "legacy-fx",
      amount_minor: 10000,
      received_amount_minor: 180,
      exchange_rate: "0.018",
      fee_amount_minor: 500,
    }),
  ]);
});

test("a populated planned v8 store gains currency columns without losing planned facts", async ({
  page,
  storageFault,
}) => {
  storageFault.today = "2026-11-07";
  storageFault.upgradeV8Layout = "planned";
  await setDate(page, "2026-11-07");
  await page.goto("/");
  await expect(page.getByText("₱1,000.00", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "View account Cash", exact: true }).click();
  await page.getByRole("button", { name: "Transaction history", exact: true }).click();
  await expect(page.getByText("Legacy coffee", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Back to account", exact: true }).click();
  await page.getByRole("button", { name: "Back to accounts", exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export backup", exact: true }).click();
  const backup = JSON.parse(await readFile(await (await downloadPromise).path(), "utf8"));
  expect(backup.schemaVersion).toBe(9);
  expect(backup.data.expenses).toEqual([
    expect.objectContaining({ id: "legacy-expense", planned: 1, planned_amount_minor: 1200 }),
  ]);
  expect(backup.data.incomes).toEqual([
    expect.objectContaining({ id: "legacy-income", planned: 1, planned_amount_minor: 2500 }),
  ]);
  expect(backup.data.transfers).toEqual([]);
  expect(backup.data.pendingTransactionOperations).toEqual(expect.arrayContaining([
    expect.objectContaining({ operation_id: "legacy-edit", operation_type: "edit" }),
    expect.objectContaining({ operation_id: "legacy-expense-log", operation_type: "log" }),
  ]));
});

test("a failed v9 migration retains the populated v7 database for a later retry", async ({
  page,
  storageFault,
}) => {
  storageFault.today = "2026-11-07";
  storageFault.upgradeV7 = true;
  storageFault.failMigration = true;
  await setDate(page, "2026-11-07");
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText("Simulated v9 migration failure");
  await expect(page.getByRole("button", { name: "Retry opening", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Retry opening", exact: true }).click();
  await expect(page.getByText("₱1,013.00", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "View account Cash", exact: true }).click();
  await page.getByRole("button", { name: "Transaction history", exact: true }).click();
  await expect(page.getByText("Legacy coffee", { exact: true })).toBeVisible();
  await expect(page.getByText("Legacy pay", { exact: true })).toBeVisible();
});

test("planned expense and income edits keep balances exact through due dates and deletion", async ({
  context,
  page,
  storageFault,
}) => {
  storageFault.today = "2026-11-07";
  await finishSetup(page);
  await page.getByRole("button", { name: "View account Cash", exact: true }).click();
  await page.getByRole("button", { name: "Add expense", exact: true }).click();
  await page.getByLabel("Expense amount", { exact: true }).fill("10");
  await page.getByLabel("Expense date", { exact: true }).fill("2026-11-08");
  await page.getByLabel("Expense note", { exact: true }).fill("Flexible plan");
  await page.getByRole("button", { name: "Save expense", exact: true }).click();
  await page.getByRole("button", { name: "Add income", exact: true }).click();
  await page.getByLabel("Income amount", { exact: true }).fill("20");
  await page.getByLabel("Income date", { exact: true }).fill("2026-11-08");
  await page.getByLabel("Income note", { exact: true }).fill("Flexible income");
  await page.getByRole("button", { name: "Save income", exact: true }).click();
  await expect(page.getByText("₱1,000.00", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Transaction history", exact: true }).click();
  await page.getByRole("button", { name: "Edit Flexible plan", exact: true }).click();
  await page.getByLabel("Expense date", { exact: true }).fill("2026-11-07");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByText("₱990.00", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Edit Flexible plan", exact: true }).click();
  await page.getByLabel("Expense date", { exact: true }).fill("2026-11-08");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByText("₱1,000.00", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Edit Flexible income", exact: true }).click();
  await page.getByLabel("Transaction amount", { exact: true }).fill("0");
  await page.getByLabel("Income date", { exact: true }).fill("2026-11-07");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("greater than zero");
  await expect(page.getByText("₱1,000.00", { exact: true })).toBeVisible();
  await page.getByLabel("Transaction amount", { exact: true }).fill("21");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByText("₱1,021.00", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Edit Flexible income", exact: true }).click();
  await page.getByLabel("Income date", { exact: true }).fill("2026-11-08");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByText("₱1,000.00", { exact: true })).toBeVisible();

  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await page.close();
  storageFault.today = "2026-11-09";
  page = await context.newPage();
  await setDate(page, "2026-11-09");
  await page.goto("/");
  await expect(page.getByRole("button", { name: "View account Cash", exact: true })).toBeVisible();
  await setWorkerDate(page, "2026-11-09");
  await page.getByRole("button", { name: "View account Cash", exact: true }).click();
  await page.getByRole("button", { name: "Transaction history", exact: true }).click();
  await page.getByRole("button", { name: "Edit Flexible plan", exact: true }).click();
  await page.getByLabel("Expense note", { exact: true }).fill("Overdue plan retained");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByText("₱1,000.00", { exact: true })).toBeVisible();
  await expect(page.getByText("Overdue", { exact: false }).first()).toBeVisible();
  await page.getByRole("button", { name: "Edit Flexible income", exact: true }).click();
  await page.getByLabel("Income note", { exact: true }).fill("Overdue income retained");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByText("₱1,000.00", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Delete Overdue income retained", exact: true }).click();
  await page.getByRole("button", { name: "Confirm delete", exact: true }).click();
  await expect(page.getByText("₱1,000.00", { exact: true })).toBeVisible();
  await expect(page.getByText("Overdue income retained", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Delete Overdue plan retained", exact: true }).click();
  await page.getByRole("button", { name: "Confirm delete", exact: true }).click();
  await expect(page.getByText("₱1,000.00", { exact: true })).toBeVisible();
  await expect(page.getByText("Overdue plan retained", { exact: true })).toHaveCount(0);
});

test("planned logging rolls back and a retry or lost reply posts once", async ({
  page,
  storageFault,
}) => {
  storageFault.today = "2026-11-07";
  storageFault.failLog = true;
  storageFault.loseLogReply = true;
  await finishSetup(page);
  await page.getByRole("button", { name: "View account Cash", exact: true }).click();
  await page.getByRole("button", { name: "Add income", exact: true }).click();
  await page.getByLabel("Income amount", { exact: true }).fill("150");
  await page.getByLabel("Income date", { exact: true }).fill("2026-11-08");
  await page.getByLabel("Income note", { exact: true }).fill("Income to log");
  await page.getByRole("button", { name: "Save income", exact: true }).click();
  await page.getByRole("button", { name: "Transaction history", exact: true }).click();
  await page.getByRole("button", { name: "Log Income to log", exact: true }).click();
  await page.getByLabel("Actual income amount", { exact: true }).fill("147");
  await page.getByRole("button", { name: "Confirm log income", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Simulated planned log failure");
  await expect(page.getByText("₱1,000.00", { exact: true })).toBeVisible();
  await expect(page.getByText("Income to log", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Confirm log income", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Simulated lost planned log reply");
  await page.getByRole("button", { name: "Confirm log income", exact: true }).click();
  await expect(page.getByText("₱1,147.00", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Back to account", exact: true }).click();
  await page.getByRole("button", { name: "Add expense", exact: true }).click();
  await page.getByLabel("Expense amount", { exact: true }).fill("25");
  await page.getByLabel("Expense date", { exact: true }).fill("2026-11-08");
  await page.getByLabel("Expense note", { exact: true }).fill("Reply to retry");
  await page.getByRole("button", { name: "Save expense", exact: true }).click();
  await page.getByRole("button", { name: "Transaction history", exact: true }).click();
  await page.getByRole("button", { name: "Log Reply to retry", exact: true }).click();
  await page.getByRole("button", { name: "Confirm log expense", exact: true }).click();
  await expect(page.getByText("₱1,122.00", { exact: true })).toBeVisible();
  await expect(page.getByText("₱25.00", { exact: true })).toBeVisible();
});
