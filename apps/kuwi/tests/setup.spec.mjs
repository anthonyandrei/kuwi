import { randomUUID } from "node:crypto";
import { test as base, expect, webkit, chromium } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "../scripts/serve.mjs";
const test = base.extend({
  /** Provide mutable fault controls isolated to this journey. */
  storageFault: async ({}, provide) => {
    await provide({ current: null, disableCache: false });
  },
  /** Provide an independent origin with worker fault injection; close its server afterward. */
  baseURL: async ({ storageFault }, provide) => {
    const server = startServer(0, (path, bytes) => {
      if (path === "/sw.js" && storageFault.disableCache) return "";
      if (path !== "/db-worker.js" || !storageFault.current) return bytes;
      const source = bytes.toString();
      if (storageFault.current === "quota") {
        storageFault.current = null;
        return source.replace(
          'const sqlite = await sqlite3InitModule({',
          'throw new DOMException("Storage quota exceeded. Free space and retry.", "QuotaExceededError"); const sqlite = await sqlite3InitModule({',
        );
      }
      if (storageFault.current === "write")
        return source.replace(
          /db\.exec\(\{\s*sql: "INSERT INTO accounts VALUES\([^)]+debit[^)]*\)"/,
          "throw Error(\"Simulated write failure\"); db.exec({sql: \"INSERT INTO accounts VALUES(?,?, 'debit', ?, NULL, ?)\"",
        );
      if (storageFault.current === "expense-write")
        return source.replace(
          /db\.exec\(\{\s*sql: "INSERT INTO expenses/,
          'if(!globalThis.__expenseWriteFailed){globalThis.__expenseWriteFailed=true;throw Error("Simulated expense write failure");} db.exec({sql: "INSERT INTO expenses',
        );
      if (storageFault.current === "expense-outbox-write")
        return source.replace(
          /db\.exec\(\{\s*sql: "INSERT INTO pending_sync_operations/,
          'if(!globalThis.__outboxWriteFailed){globalThis.__outboxWriteFailed=true;throw Error("Simulated pending operation write failure");} db.exec({sql: "INSERT INTO pending_sync_operations',
        );
      if (storageFault.current === "expense-interrupt")
        return source.replace(
          /db\.exec\(\{\s*sql: "INSERT INTO pending_sync_operations/,
          'while(true) {} db.exec({sql: "INSERT INTO pending_sync_operations',
        );
      if (storageFault.current === "expense-reply")
        return source.replace(
          "self.postMessage({ id, result });",
          "if (command !== 'createExpense') self.postMessage({ id, result });",
        );
      if (storageFault.current === "income-write")
        return source.replace(
          /db\.exec\(\{\s*sql: "INSERT INTO incomes/,
          'if(!globalThis.__incomeWriteFailed){globalThis.__incomeWriteFailed=true;throw Error("Simulated income write failure");} db.exec({sql: "INSERT INTO incomes',
        );
      if (storageFault.current === "income-outbox-write")
        return source.replace(
          /db\.exec\(\{\s*sql: "INSERT INTO pending_income_sync_operations/,
          'if(!globalThis.__incomeOutboxFailed){globalThis.__incomeOutboxFailed=true;throw Error("Simulated income pending operation failure");} db.exec({sql: "INSERT INTO pending_income_sync_operations',
        );
      if (storageFault.current === "income-interrupt")
        return source.replace(
          /db\.exec\(\{\s*sql: "INSERT INTO pending_income_sync_operations/,
          'while(true) {} db.exec({sql: "INSERT INTO pending_income_sync_operations',
        );
      if (storageFault.current === "income-reply")
        return source.replace(
          "self.postMessage({ id, result });",
          "if (command !== 'createIncome') self.postMessage({ id, result });",
        );
      if (storageFault.current === "interrupt")
        return source.replace(
          /db\.exec\(\{\s*sql: "INSERT INTO accounts VALUES\([^)]+debit[^)]*\)"/,
          "while(true) {} db.exec({sql: \"INSERT INTO accounts VALUES(?,?, 'debit', ?, NULL, ?)\"",
        );
      if (storageFault.current === "reply") {
        storageFault.current = null;
        return source.replace(
          /self\.postMessage\(\{\s*id,\s*result\s*\}\);/,
          "if(command!=='complete') self.postMessage({id,result});",
        );
      }
      if (storageFault.current === "downgrade-v2")
        return source.replace(
          'else throw Error("Unknown database operation.");',
          'else if (command === "testDowngradeV2") { transaction(() => db.exec("DROP TABLE pending_transaction_operations; DROP TABLE pending_income_sync_operations; DROP TABLE incomes; DROP TABLE income_categories; DROP TABLE pending_sync_operations; DROP TABLE expenses; DROP TABLE categories; PRAGMA user_version=2;")); result = true; } else throw Error("Unknown database operation.");',
        );
      if (storageFault.current === "downgrade-v3")
        return source.replace(
          'else throw Error("Unknown database operation.");',
          'else if (command === "testDowngradeV3") { transaction(() => db.exec("DROP TABLE pending_transaction_operations; DROP TABLE pending_income_sync_operations; DROP TABLE incomes; DROP TABLE income_categories; PRAGMA user_version=3;")); result = true; } else throw Error("Unknown database operation.");',
        );
      if (storageFault.current === "account-rename")
        return source.replace(
          'else throw Error("Unknown database operation.");',
          'else if (command === "testRenameAccount") { transaction(() => db.exec({ sql: "UPDATE accounts SET name=? WHERE id=(SELECT first_account_id FROM setup WHERE id=1)", bind: [args.name] })); result = true; } else throw Error("Unknown database operation.");',
        );
      if (storageFault.current === "migration")
        return source.replace(
          "function migrateExpenses() {",
          'function migrateExpenses() { if (!globalThis.__migrationFailed) { globalThis.__migrationFailed = true; transaction(() => { db.exec("CREATE TABLE migration_trial(id INTEGER PRIMARY KEY)"); throw Error("Simulated migration failure"); }); }',
        );
      if (storageFault.current === "income-migration")
        return source.replace(
          "function migrateIncomes() {",
          'function migrateIncomes() { if (!globalThis.__incomeMigrationFailed) { globalThis.__incomeMigrationFailed = true; transaction(() => { db.exec("CREATE TABLE income_migration_trial(id INTEGER PRIMARY KEY)"); throw Error("Simulated income migration failure"); }); }',
        );
      throw Error("Unknown test fault");
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
  /** Give each journey isolated storage; WebKit needs a persistent profile for OPFS. */
  context: async ({ browser, browserName, baseURL }, provide) => {
    const profile = browserName === "webkit"
      ? await mkdtemp(join(tmpdir(), "kuwi-webkit-"))
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

test("a quota failure stays visible and reopening keeps the saved account", async ({
  page,
  storageFault,
}) => {
  storageFault.disableCache = true;
  await fundedSetup(page);
  await page.getByRole("button", { name: "Back to accounts", exact: true }).click();
  await page.getByRole("button", { name: "Close database", exact: true }).click();

  storageFault.current = "quota";
  await page.getByRole("button", { name: "Retry opening", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Storage quota exceeded");

  await page.getByRole("button", { name: "Retry opening", exact: true }).click();
  await expect(page.getByText("Welcome, Anthony.", { exact: true })).toBeVisible();
  await expect(page.getByText("₱1,000.00", { exact: true })).toBeVisible();
});
/**
 * Enter first-run setup or report the local-storage startup screen.
 * @param {import("@playwright/test").Page} page - Browser page after navigation.
 * @returns {Promise<void>} Resolves after the first-run button is clicked.
 * @throws {Error} If local storage fails to open or startup never reaches a usable screen.
 */
async function continueOffline(page) {
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
      `App startup did not reach first-run setup at ${page.url()}. Screen: ${screen || "empty"}. ${error.message}`,
    );
  }
  if (await retryButton.isVisible()) {
    throw new Error(
      `Local storage failed to open. Screen: ${await page.locator("body").innerText()}`,
    );
  }
  await startButton.click();
}

/**
 * Follow visible setup to the account form.
 * @param {import("@playwright/test").Page} page Browser page to drive.
 * @param {boolean} [navigate=true] Open the app first; false continues after startup retry.
 */
async function setup(page, navigate = true) {
  if (navigate) await page.goto("/");
  await continueOffline(page);
  await expect(
    page.getByRole("button", { name: "Next", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("Preferred name", { exact: true }).fill("Anthony");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page
    .getByRole("button", { name: "Skip introduction", exact: true })
    .click();
  await expect(
    page.getByText("Philippine Peso (PHP)", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByLabel("Account name", { exact: true })).toHaveValue(
    "Cash",
  );
  await expect(
    page.getByLabel("Opening balance (PHP)", { exact: true }),
  ).toHaveValue("0");
}
test("setup persists offline and hands ownership to another tab", async ({
  page,
  context,
}) => {
  await setup(page);
  await page
    .getByLabel("Opening balance (PHP)", { exact: true })
    .fill("1234.56");
  await page
    .getByRole("button", { name: "Save my account", exact: true })
    .click();
  await expect(page.getByText("₱1,234.56", { exact: true })).toBeVisible();
  const second = await context.newPage();
  await second.goto("/");
  await expect(second.getByRole("alert")).toContainText("Database busy");
  await page
    .getByRole("button", { name: "Close database", exact: true })
    .click();
  await second
    .getByRole("button", { name: "Retry opening", exact: true })
    .click();
  await expect(second.getByText("₱1,234.56", { exact: true })).toBeVisible();
  await second.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.close();
  await second.close();
  await context.setOffline(true);
  const reopened = await context.newPage();
  await reopened.goto("/");
  await expect(
    reopened.getByText("Welcome, Anthony.", { exact: true }),
  ).toBeVisible();
  await expect(reopened.getByText("₱1,234.56", { exact: true })).toBeVisible();
});
test("reject invalid decimal input without completing setup", async ({
  page,
}) => {
  await setup(page);
  await page.getByLabel("Opening balance (PHP)", { exact: true }).fill("1.234");
  await page
    .getByRole("button", { name: "Save my account", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("two decimal places");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Continue offline", exact: true }),
  ).toBeVisible();
});
test("preferred currency is used by the first account", async ({ page }) => {
  await page.goto("/");
  await continueOffline(page);
  await page.getByLabel("Preferred name", { exact: true }).fill("Anthony");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page
    .getByRole("button", { name: "Skip introduction", exact: true })
    .click();
  await page
    .getByRole("button", { name: "USD US Dollar", exact: true })
    .click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByLabel("Opening balance (USD)", { exact: true }).fill("25.00");
  await page
    .getByRole("button", { name: "Save my account", exact: true })
    .click();
  await expect(page.getByText(/^(?:US)?\$25\.00$/)).toBeVisible();
});

test("failed setup writes roll back and retry saves one account", async ({
  page,
  storageFault,
}) => {
  storageFault.current = "write";
  storageFault.disableCache = true;
  await setup(page);
  await page
    .getByRole("button", { name: "Save my account", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Simulated write failure",
  );
  storageFault.current = null;
  await page.reload();
  storageFault.disableCache = true;
  await setup(page);
  await page
    .getByRole("button", { name: "Save my account", exact: true })
    .click();
  await expect(
    page.getByText("Welcome, Anthony.", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("Welcome, Anthony.", { exact: true }),
  ).toBeVisible();
});

test("lost save reply exposes retry and returns the committed setup", async ({
  page,
  storageFault,
}) => {
  storageFault.disableCache = true;
  storageFault.current = "reply";
  await setup(page);
  await page
    .getByLabel("Opening balance (PHP)", { exact: true })
    .fill("1234.56");
  await page
    .getByRole("button", { name: "Save my account", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Save confirmation timed out",
  );
  storageFault.current = null;
  await page
    .getByRole("button", { name: "Save my account", exact: true })
    .click();
  await expect(page.getByText("₱1,234.56", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("₱1,234.56", { exact: true })).toBeVisible();
});

test("setup retry rejects the same operation ID with different details", async ({
  page,
}) => {
  await setup(page);
  await page.getByLabel("Opening balance (PHP)", { exact: true }).fill("25");
  await page.getByRole("button", { name: "Save my account", exact: true }).click();
  await expect(page.getByText("₱25.00", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close database", exact: true }).click();
  await expect(page.getByText("Database closed", { exact: true })).toBeVisible();

  const response = await page.evaluate(() => new Promise((resolve) => {
    const worker = new Worker("/db-worker.js", { type: "module" });
    let commandResult;
    worker.onmessage = ({ data }) => {
      if (data.id === 1) {
        commandResult = data;
        worker.postMessage({ id: 2, command: "close" });
      } else if (data.id === 2) {
        worker.terminate();
        resolve(commandResult);
      }
    };
    worker.postMessage({
      id: 1,
      command: "complete",
      args: {
        name: "Different name",
        account: "Cash",
        currency: "PHP",
        amountMinor: 2500,
        operationId: "setup:first",
      },
    });
  }));

  expect(response.error).toContain("already used for different account details");
  await page.getByRole("button", { name: "Retry opening", exact: true }).click();
  await expect(page.getByText("Welcome, Anthony.", { exact: true })).toBeVisible();
  await expect(page.getByText("₱25.00", { exact: true })).toBeVisible();
});

test("saved setup reopens offline after full browser closure", async ({
  browserName,
  baseURL,
}, testInfo) => {
  const browserType = browserName === "webkit" ? webkit : chromium;
  const directory = testInfo.outputPath("browser-profile");
  await rm(directory, { recursive: true, force: true });
  let context = await browserType.launchPersistentContext(directory, {
    baseURL,
  });
  try {
    let page = await context.newPage();
    await setup(page);
    await page
      .getByLabel("Opening balance (PHP)", { exact: true })
      .fill("1234.56");
    await page
      .getByRole("button", { name: "Save my account", exact: true })
      .click();
    await expect(page.getByText("₱1,234.56", { exact: true })).toBeVisible();
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
    await expect(
      page.getByText("Welcome, Anthony.", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("₱1,234.56", { exact: true })).toBeVisible();
  } finally {
    await context.close();
  }
});

/** Run a test-only database command while retaining the real worker and OPFS database. */
async function runWorkerCommand(page, command, args = {}) {
  await page.evaluate(
    async ({ command, args }) => {
      const worker = new Worker("/db-worker.js", { type: "module" });
      const send = (id, name, payload = {}) =>
        new Promise((resolve, reject) => {
          const onMessage = (event) => {
            const { data } = event;
            if (data.id !== id) return;
            worker.removeEventListener("message", onMessage);
            if (data.error) reject(Error(data.error));
            else resolve(data.result);
          };
          worker.addEventListener("message", onMessage);
          worker.postMessage({ id, command: name, args: payload });
        });
      try {
        await send(1, command, args);
        await send(2, "close");
      } finally {
        worker.terminate();
      }
    },
    { command, args },
  );
}

test("failed version-three migration preserves a version-two account and can reopen", async ({
  page,
  storageFault,
}) => {
  storageFault.disableCache = true;
  storageFault.current = "downgrade-v2";
  await fundedSetup(page);
  await page.getByRole("button", { name: "Back to accounts", exact: true }).click();
  await page
    .getByRole("button", { name: "Close database", exact: true })
    .click();
  await runWorkerCommand(page, "testDowngradeV2");
  storageFault.current = "migration";
  await page.reload();
  await expect(page.getByRole("alert")).toContainText(
    "Simulated migration failure",
  );
  storageFault.current = null;
  await page.reload();
  await expect(
    page.getByText("Welcome, Anthony.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("₱1,000.00", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "View account Cash", exact: true }).click();
  await page.getByRole("button", { name: "Add expense", exact: true }).click();
  await page.getByLabel("Expense amount", { exact: true }).fill("1");
  await page.getByLabel("Expense note", { exact: true }).fill("Migrated data");
  await page.getByRole("button", { name: "Save expense", exact: true }).click();
  await expect(page.getByText("₱999.00", { exact: true })).toBeVisible();
});

test("failed income migration preserves version-three expense history", async ({
  page,
  storageFault,
}) => {
  storageFault.disableCache = true;
  await fundedSetup(page);
  await page.getByRole("button", { name: "Add expense", exact: true }).click();
  await page.getByRole("button", { name: "Food", exact: true }).click();
  await page.getByLabel("Expense amount", { exact: true }).fill("10");
  await page.getByLabel("Expense note", { exact: true }).fill("Coffee");
  await page.getByRole("button", { name: "Save expense", exact: true }).click();
  await expect(page.getByText("₱990.00", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Back to accounts", exact: true }).click();
  await page.getByRole("button", { name: "Close database", exact: true }).click();
  storageFault.current = "downgrade-v3";
  await runWorkerCommand(page, "testDowngradeV3");
  storageFault.current = "income-migration";
  await page.reload();
  await expect(page.getByRole("alert")).toContainText(
    "Simulated income migration failure",
  );

  storageFault.current = null;
  await page.reload();
  await expect(page.getByText("₱990.00", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "View account Cash", exact: true }).click();
  await page.getByRole("button", { name: "Transaction history", exact: true }).click();
  await expect(page.getByText("Coffee", { exact: true })).toBeVisible();
  await expect(page.getByText(/Food · .* · Cash/)).toBeVisible();
});

test("renaming an account leaves linked expense history and balance intact", async ({
  page,
  storageFault,
}) => {
  storageFault.disableCache = true;
  storageFault.current = "account-rename";
  await fundedSetup(page);
  await page.getByRole("button", { name: "Add expense", exact: true }).click();
  await page.getByLabel("Expense amount", { exact: true }).fill("10");
  await page.getByLabel("Expense note", { exact: true }).fill("Coffee");
  await page.getByRole("button", { name: "Food", exact: true }).click();
  await page.getByRole("button", { name: "Save expense", exact: true }).click();
  await expect(page.getByText("₱990.00", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Back to accounts", exact: true }).click();
  await page.getByRole("button", { name: "Close database", exact: true }).click();
  await runWorkerCommand(page, "testRenameAccount", { name: "Everyday" });
  storageFault.current = null;
  await page.reload();
  await expect(page.getByText("Everyday", { exact: true })).toBeVisible();
  await expect(page.getByText("₱990.00", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "View account Everyday", exact: true }).click();
  await page.getByRole("button", { name: "Transaction history", exact: true }).click();
  await expect(page.getByText("Coffee", { exact: true })).toBeVisible();
  await expect(page.getByText(/Food · .* · Everyday/)).toBeVisible();
  await expect(page.getByText("₱10.00", { exact: true })).toBeVisible();
});

/** Finish setup with a funded Cash account for expense journeys. */
async function fundedSetup(page) {
  await setup(page);
  await page.getByLabel("Opening balance (PHP)", { exact: true }).fill("1000");
  await page.getByRole("button", { name: "Save my account", exact: true }).click();
  await expect(page.getByText("₱1,000.00", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "View account Cash", exact: true }).click();
}

/** Return a browser-local date offset from today for date-only journeys. */
async function localDateOffset(page, offsetDays) {
  return page.evaluate((offset) => {
    const date = new Date();
    date.setDate(date.getDate() + offset);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }, offsetDays);
}

test("expense journey saves history and derives the offline account balance", async ({
  page,
}) => {
  await fundedSetup(page);
  await page.getByRole("button", { name: "Add expense", exact: true }).click();
  await page.getByLabel("Expense amount", { exact: true }).fill("12.345");
  await page.getByLabel("Expense note", { exact: true }).fill("Coffee");
  const yesterday = await page.evaluate(() => {
    const date = new Date();
    date.setDate(date.getDate() - 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  });
  await page.getByLabel("Expense date", { exact: true }).fill(yesterday);
  await page.getByRole("button", { name: "Food", exact: true }).click();
  await page.getByRole("button", { name: "Save expense", exact: true }).click();

  await expect(page.getByText("₱987.65", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Transaction history", exact: true }).click();
  await expect(page.getByText("Coffee", { exact: true })).toBeVisible();
  await expect(page.getByText(/Food ·/)).toBeVisible();
  await expect(page.getByText(new RegExp(yesterday))).toBeVisible();
  await expect(page.getByText("₱12.35", { exact: true })).toBeVisible();
});

test("income journey saves history and derives the account balance", async ({
  page,
}) => {
  await fundedSetup(page);
  await page.getByRole("button", { name: "Add income", exact: true }).click();
  await page.getByLabel("Income amount", { exact: true }).fill("12.345");
  await page.getByLabel("Income note", { exact: true }).fill("Paycheck");
  await page.getByRole("button", { name: "Salary", exact: true }).click();
  await page.getByRole("button", { name: "Save income", exact: true }).click();

  await expect(page.getByText("₱1,012.35", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Transaction history", exact: true }).click();
  await expect(page.getByText("Paycheck", { exact: true })).toBeVisible();
  await expect(page.getByText(/Salary · .* · Cash/)).toBeVisible();
  await expect(page.getByText(/₱12.35/)).toBeVisible();
});

test("JPY income rounds to whole yen in history and the derived balance", async ({
  page,
}) => {
  await page.goto("/");
  await continueOffline(page);
  await page.getByLabel("Preferred name", { exact: true }).fill("Anthony");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "Skip introduction", exact: true }).click();
  await page.getByRole("button", { name: "JPY Japanese Yen", exact: true }).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByLabel("Opening balance (JPY)", { exact: true }).fill("1000");
  await page.getByRole("button", { name: "Save my account", exact: true }).click();
  await page.getByRole("button", { name: "View account Cash", exact: true }).click();
  await page.getByRole("button", { name: "Add income", exact: true }).click();
  await page.getByLabel("Income amount", { exact: true }).fill("12.5");
  await page.getByLabel("Income note", { exact: true }).fill("Interest");
  await page.getByRole("button", { name: "Save income", exact: true }).click();

  await expect(page.getByText(/(?:JP)?¥1,013/)).toBeVisible();
  await page.getByRole("button", { name: "Transaction history", exact: true }).click();
  await expect(page.getByText(/(?:JP)?¥13/)).toBeVisible();
});

test("income reduces the amount owed on a credit account", async ({ page }) => {
  await setup(page);
  await page.getByRole("button", { name: "Save my account", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your accounts" })).toBeVisible();
  await page.getByRole("button", { name: "Add account", exact: true }).click();
  await page.getByLabel("Account name", { exact: true }).fill("Credit card");
  await page.getByRole("radio", { name: "Credit", exact: true }).click();
  await page.getByLabel("Credit limit (PHP)", { exact: true }).fill("50000");
  await page.getByRole("button", { name: "Add current balance", exact: true }).click();
  await page.getByLabel("Current balance (PHP)", { exact: true }).fill("100");
  await page.getByRole("button", { name: "Save account", exact: true }).click();
  await page.getByRole("button", { name: "View account Credit card", exact: true }).click();
  await page.getByRole("button", { name: "Add income", exact: true }).click();
  await page.getByLabel("Income amount", { exact: true }).fill("25");
  await page.getByLabel("Income note", { exact: true }).fill("Card payment");
  await page.getByRole("button", { name: "Save income", exact: true }).click();

  await expect(page.getByText("₱75.00", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Transaction history", exact: true }).click();
  await expect(page.getByText("Card payment", { exact: true })).toBeVisible();
});

test("zero income is accepted only for a future planned date", async ({ page }) => {
  await fundedSetup(page);
  await page.getByRole("button", { name: "Add income", exact: true }).click();
  await page.getByLabel("Income amount", { exact: true }).fill("0");
  await page.getByRole("button", { name: "Save income", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("greater than zero");

  const tomorrow = await localDateOffset(page, 1);
  await page.getByLabel("Income date", { exact: true }).fill(tomorrow);
  await page.getByRole("button", { name: "Save income", exact: true }).click();
  await expect(page.getByText("₱1,000.00", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Transaction history", exact: true }).click();
  await expect(page.getByText(/Income · .* · Cash · Planned/)).toBeVisible();
  await expect(page.getByText(/₱0.00/)).toBeVisible();
});

test("a failed income outbox write rolls back before retry", async ({
  page,
  storageFault,
}) => {
  storageFault.disableCache = true;
  storageFault.current = "income-outbox-write";
  await fundedSetup(page);
  await page.getByRole("button", { name: "Add income", exact: true }).click();
  await page.getByLabel("Income amount", { exact: true }).fill("10");
  await page.getByLabel("Income note", { exact: true }).fill("Paycheck");
  await page.getByRole("button", { name: "Save income", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Simulated income pending operation failure",
  );
  await expect(page.getByText("₱1,000.00", { exact: true })).toBeVisible();

  storageFault.current = null;
  await page.getByRole("button", { name: "Save income", exact: true }).click();
  await expect(page.getByText("₱1,010.00", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Transaction history", exact: true }).click();
  await expect(page.getByText("Paycheck", { exact: true })).toHaveCount(1);
});

test("a lost income reply retries one stable operation", async ({
  page,
  storageFault,
}) => {
  storageFault.disableCache = true;
  storageFault.current = "income-reply";
  await fundedSetup(page);
  await page.getByRole("button", { name: "Add income", exact: true }).click();
  await page.getByLabel("Income amount", { exact: true }).fill("10");
  await page.getByLabel("Income note", { exact: true }).fill("Paycheck");
  await page.getByRole("button", { name: "Salary", exact: true }).click();
  await page.getByRole("button", { name: "Save income", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Save confirmation timed out");

  storageFault.current = null;
  await page.getByLabel("Income amount", { exact: true }).fill("15");
  await page.getByRole("button", { name: "Save income", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "different income details",
  );
  await page.getByLabel("Income amount", { exact: true }).fill("10");
  await page.getByRole("button", { name: "Save income", exact: true }).click();
  await expect(page.getByText("₱1,010.00", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Transaction history", exact: true }).click();
  await expect(page.getByText("Paycheck", { exact: true })).toHaveCount(1);
  await expect(page.getByText(/₱10.00/)).toBeVisible();
});

test("an interrupted income write leaves the ledger available for retry", async ({
  page,
  storageFault,
}) => {
  storageFault.disableCache = true;
  storageFault.current = "income-interrupt";
  await fundedSetup(page);
  await page.getByRole("button", { name: "Add income", exact: true }).click();
  await page.getByLabel("Income amount", { exact: true }).fill("10");
  await page.getByLabel("Income note", { exact: true }).fill("Paycheck");
  await page.getByRole("button", { name: "Save income", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Save confirmation timed out");
  await expect(page.getByText("₱1,000.00", { exact: true })).toBeVisible();

  storageFault.current = null;
  await expect(async () => {
    if (await page.getByRole("alert").isVisible())
      await page.getByRole("button", { name: "Save income", exact: true }).click();
    await expect(page.getByText("₱1,010.00", { exact: true })).toBeVisible({
      timeout: 1000,
    });
  }).toPass({ timeout: 20000 });
  await page.getByRole("button", { name: "Transaction history", exact: true }).click();
  await expect(page.getByText("Paycheck", { exact: true })).toHaveCount(1);
});

test("JPY expense rounding uses whole yen in history and the derived balance", async ({
  page,
}) => {
  await page.goto("/");
  await continueOffline(page);
  await page.getByLabel("Preferred name", { exact: true }).fill("Anthony");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "Skip introduction", exact: true }).click();
  await page.getByRole("button", { name: "JPY Japanese Yen", exact: true }).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByLabel("Opening balance (JPY)", { exact: true }).fill("1000");
  await page.getByRole("button", { name: "Save my account", exact: true }).click();
  await expect(page.getByText(/(?:JP)?¥1,000/)).toBeVisible();

  await page.getByRole("button", { name: "View account Cash", exact: true }).click();
  await page.getByRole("button", { name: "Add expense", exact: true }).click();
  await page.getByLabel("Expense amount", { exact: true }).fill("12.5");
  await page.getByLabel("Expense note", { exact: true }).fill("Train");
  await page.getByRole("button", { name: "Save expense", exact: true }).click();
  await expect(page.getByText(/(?:JP)?¥987/)).toBeVisible();
  await page.getByRole("button", { name: "Transaction history", exact: true }).click();
  await expect(page.getByText(/(?:JP)?¥13/)).toBeVisible();
});

test("an expense increases the amount owed on a credit account", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("button", { name: "Save my account", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your accounts" })).toBeVisible();
  await page.getByRole("button", { name: "Add account", exact: true }).click();
  await page.getByLabel("Account name", { exact: true }).fill("Credit card");
  await page.getByRole("radio", { name: "Credit", exact: true }).click();
  await page.getByLabel("Credit limit (PHP)", { exact: true }).fill("50000");
  await page.getByRole("button", { name: "Add current balance", exact: true }).click();
  await page.getByLabel("Current balance (PHP)", { exact: true }).fill("100");
  await page.getByRole("button", { name: "Save account", exact: true }).click();
  await page.getByRole("button", { name: "View account Credit card", exact: true }).click();
  await page.getByRole("button", { name: "Add expense", exact: true }).click();
  await page.getByLabel("Expense amount", { exact: true }).fill("25");
  await page.getByLabel("Expense note", { exact: true }).fill("Card purchase");
  await page.getByRole("button", { name: "Save expense", exact: true }).click();
  await expect(page.getByText("₱125.00", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Transaction history", exact: true }).click();
  await expect(page.getByText("Card purchase", { exact: true })).toBeVisible();
  await expect(page.getByText("₱25.00", { exact: true })).toBeVisible();
});

test("expense validation rejects zero and dates after today", async ({ page }) => {
  await fundedSetup(page);
  await page.getByRole("button", { name: "Add expense", exact: true }).click();
  await page.getByLabel("Expense amount", { exact: true }).fill("0");
  await page.getByRole("button", { name: "Save expense", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("greater than zero");

  await page.getByLabel("Expense amount", { exact: true }).fill("1");
  await page.getByLabel("Expense date", { exact: true }).fill("2099-01-01");
  await page.getByRole("button", { name: "Save expense", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("today or an earlier date");
});

test("failed expense write leaves history and balance unchanged before retry", async ({
  page,
  storageFault,
}) => {
  storageFault.disableCache = true;
  storageFault.current = "expense-write";
  await fundedSetup(page);
  await page.getByRole("button", { name: "Add expense", exact: true }).click();
  await page.getByLabel("Expense amount", { exact: true }).fill("10");
  await page.getByLabel("Expense note", { exact: true }).fill("Bus fare");
  await page.getByRole("button", { name: "Save expense", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Simulated expense write failure");
  await expect(page.getByText("₱1,000.00", { exact: true })).toBeVisible();
  storageFault.current = null;
  await page.getByRole("button", { name: "Back to account", exact: true }).click();
  await expect(page.getByText("₱1,000.00", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Transaction history", exact: true }).click();
  await expect(page.getByText("Your transactions will appear here.")).toBeVisible();
  await page.getByRole("button", { name: "Back to account", exact: true }).click();
  await page.getByRole("button", { name: "Add expense", exact: true }).click();
  await page.getByLabel("Expense amount", { exact: true }).fill("10");
  await page.getByLabel("Expense note", { exact: true }).fill("Bus fare");
  await page.getByRole("button", { name: "Save expense", exact: true }).click();
  await expect(page.getByText("₱990.00", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Transaction history", exact: true }).click();
  await expect(page.getByText("Bus fare", { exact: true })).toBeVisible();
});

test("pending operation failure rolls back its expense before retry", async ({
  page,
  storageFault,
}) => {
  storageFault.disableCache = true;
  storageFault.current = "expense-outbox-write";
  await fundedSetup(page);
  await page.getByRole("button", { name: "Add expense", exact: true }).click();
  await page.getByLabel("Expense amount", { exact: true }).fill("10");
  await page.getByLabel("Expense note", { exact: true }).fill("Market");
  await page.getByRole("button", { name: "Save expense", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Simulated pending operation write failure",
  );
  await expect(page.getByText("₱1,000.00", { exact: true })).toBeVisible();

  storageFault.current = null;
  await page.getByRole("button", { name: "Save expense", exact: true }).click();
  await expect(page.getByText("₱990.00", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Transaction history", exact: true }).click();
  await expect(page.getByText("Market", { exact: true })).toHaveCount(1);
});

test("a lost expense save reply retries the same operation without duplicating it", async ({
  page,
  storageFault,
}) => {
  storageFault.disableCache = true;
  storageFault.current = "expense-reply";
  await fundedSetup(page);
  await page.getByRole("button", { name: "Add expense", exact: true }).click();
  await page.getByLabel("Expense amount", { exact: true }).fill("10");
  await page.getByLabel("Expense note", { exact: true }).fill("Train fare");
  await page.getByRole("button", { name: "Save expense", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Save confirmation timed out");

  storageFault.current = null;
  await page.getByLabel("Expense amount", { exact: true }).fill("11");
  await expect(async () => {
    await page.getByRole("button", { name: "Save expense", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText(
      "different expense details",
      { timeout: 1000 },
    );
  }).toPass({ timeout: 20000 });
  await page.getByLabel("Expense amount", { exact: true }).fill("10");
  await page.getByRole("button", { name: "Save expense", exact: true }).click();
  await expect(async () => {
    if (await page.getByRole("alert").isVisible())
      await page.getByRole("button", { name: "Save expense", exact: true }).click();
    await expect(page.getByText("₱990.00", { exact: true })).toBeVisible({
      timeout: 1000,
    });
  }).toPass({ timeout: 20000 });
  await page.getByRole("button", { name: "Transaction history", exact: true }).click();
  await expect(page.getByText("Train fare", { exact: true })).toHaveCount(1);
  await expect(page.getByText("₱10.00", { exact: true })).toBeVisible();
});

test("an interrupted expense write leaves the ledger available for retry", async ({
  page,
  storageFault,
}) => {
  storageFault.disableCache = true;
  storageFault.current = "expense-interrupt";
  await fundedSetup(page);
  await page.getByRole("button", { name: "Add expense", exact: true }).click();
  await page.getByLabel("Expense amount", { exact: true }).fill("10");
  await page.getByLabel("Expense note", { exact: true }).fill("Taxi fare");
  await page.getByRole("button", { name: "Save expense", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Save confirmation timed out");
  await expect(page.getByText("₱1,000.00", { exact: true })).toBeVisible();

  storageFault.current = null;
  await expect(async () => {
    if (await page.getByRole("alert").isVisible())
      await page.getByRole("button", { name: "Save expense", exact: true }).click();
    await expect(page.getByText("₱990.00", { exact: true })).toBeVisible({
      timeout: 1000,
    });
  }).toPass({ timeout: 20000 });
  await page.getByRole("button", { name: "Transaction history", exact: true }).click();
  await expect(page.getByText("Taxi fare", { exact: true })).toHaveCount(1);
});

test("income and expense records survive full offline browser closure and allow another write", async ({
  browserName,
  baseURL,
}, testInfo) => {
  const browserType = browserName === "webkit" ? webkit : chromium;
  const directory = testInfo.outputPath("expense-browser-profile");
  await rm(directory, { recursive: true, force: true });
  let context = await browserType.launchPersistentContext(directory, { baseURL });
  try {
    let page = await context.newPage();
    await fundedSetup(page);
    await page.getByRole("button", { name: "Add expense", exact: true }).click();
    await page.getByLabel("Expense amount", { exact: true }).fill("12.35");
    await page.getByLabel("Expense note", { exact: true }).fill("Coffee");
    await page.getByRole("button", { name: "Food", exact: true }).click();
    await page.getByRole("button", { name: "Save expense", exact: true }).click();
    await expect(page.getByText("₱987.65", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Add income", exact: true }).click();
    await page.getByLabel("Income amount", { exact: true }).fill("20");
    await page.getByLabel("Income note", { exact: true }).fill("Paycheck");
    await page.getByRole("button", { name: "Bonus", exact: true }).click();
    await page.getByRole("button", { name: "Save income", exact: true }).click();
    await expect(page.getByText("₱1,007.65", { exact: true })).toBeVisible();
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
    await expect(page.getByText("₱1,007.65", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "View account Cash", exact: true }).click();
    await page.getByRole("button", { name: "Add income", exact: true }).click();
    await page.getByLabel("Income amount", { exact: true }).fill("2.35");
    await page.getByLabel("Income note", { exact: true }).fill("Interest");
    await page.getByRole("button", { name: "Save income", exact: true }).click();
    await expect(page.getByText("₱1,010.00", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Transaction history", exact: true }).click();
    await expect(page.getByText("Coffee", { exact: true })).toBeVisible();
    await expect(page.getByText("Paycheck", { exact: true })).toBeVisible();
    await expect(page.getByText("Interest", { exact: true })).toBeVisible();
  } finally {
    await context.close();
  }
});

test("number pad matches the observed PHP example and blank name uses Cash", async ({
  page,
}) => {
  await setup(page);
  await page.getByLabel("Account name", { exact: true }).fill("   ");
  await page
    .getByRole("button", { name: "Use number pad", exact: true })
    .click();
  for (const digit of ["1", "2", "3", "4", ".", "5", "6", "7"])
    await page.getByRole("button", { name: digit, exact: true }).click();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(
    page.getByLabel("Opening balance (PHP)", { exact: true }),
  ).toHaveValue("1234.56");
  await page
    .getByRole("button", { name: "Save my account", exact: true })
    .click();
  await expect(page.getByText("Cash", { exact: true })).toBeVisible();
  await expect(page.getByText("₱1,234.56", { exact: true })).toBeVisible();
});

test("worker interruption during setup rolls back before retry", async ({
  page,
  storageFault,
}) => {
  storageFault.current = "interrupt";
  storageFault.disableCache = true;
  await setup(page);
  await page
    .getByRole("button", { name: "Save my account", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Save confirmation timed out",
  );
  storageFault.current = null;
  // Chromium can release a terminated worker's lock after the timeout is displayed.
  // Exercise the visible retry until the new worker owns the preserved database.
  await page.goto("/");
  const retry = page.getByRole("button", { name: "Retry opening", exact: true });
  await expect(async () => {
    if (await retry.isVisible()) await retry.click();
    await expect(
      page.getByRole("button", { name: "Continue offline", exact: true }),
    ).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 20000 });
  await setup(page, false);
  await page
    .getByRole("button", { name: "Save my account", exact: true })
    .click();
  await expect(
    page.getByText("Welcome, Anthony.", { exact: true }),
  ).toBeVisible();
});
