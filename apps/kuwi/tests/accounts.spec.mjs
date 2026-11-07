import { chromium, expect, test as base, webkit } from "@playwright/test";
import { readFileSync } from "node:fs";
import { startServer } from "../scripts/serve.mjs";

const populatedV1 = readFileSync(
  new URL("./fixtures/populated-v1.sql", import.meta.url),
  "utf8",
);
const populatedV4 = readFileSync(
  new URL("./fixtures/populated-v4.sql", import.meta.url),
  "utf8",
);
const populatedV4Transfer = readFileSync(
  new URL("./fixtures/populated-v4-transfer.sql", import.meta.url),
  "utf8",
);
const populatedV5 = readFileSync(
  new URL("./fixtures/populated-v5.sql", import.meta.url),
  "utf8",
);
const legacyV1Shell = readFileSync(
  new URL("./fixtures/legacy-v1.html", import.meta.url),
);
const legacyV1Worker = readFileSync(
  new URL("./fixtures/legacy-v1-worker.js", import.meta.url),
);
const legacyV3Shell = readFileSync(
  new URL("./fixtures/legacy-v3.html", import.meta.url),
);
const legacyV3Worker = readFileSync(
  new URL("./fixtures/legacy-v3-worker.js", import.meta.url),
);

const test = base.extend({
  storageFault: async ({}, provide) => {
    await provide({ current: null, legacyBuild: false });
  },
  baseURL: async ({ storageFault }, provide) => {
    const server = startServer(0, (path, bytes) => {
      if (path === "/" && storageFault.legacyBuild === "v3")
        return legacyV3Shell;
      if (path === "/db-worker.js" && storageFault.legacyBuild === "v3")
        return legacyV3Worker;
      if (path === "/" && storageFault.legacyBuild)
        return legacyV1Shell;
      if (path === "/db-worker.js" && storageFault.legacyBuild)
        return legacyV1Worker;
      if (path !== "/db-worker.js" || !storageFault.current) return bytes;
      const source = bytes.toString();
      if (["upgradeV4", "upgradeV4Transfer", "upgradeV5", "upgradeV5MigrationFailure"].includes(storageFault.current)) {
        const upgrade = storageFault.current;
        const populated = upgrade === "upgradeV4"
          ? populatedV4
          : upgrade === "upgradeV4Transfer" ? populatedV4Transfer : populatedV5;
        storageFault.current = null;
        let transformed = source.replace(
          'const version = db.selectValue("PRAGMA user_version");',
          `const originalVersion=db.selectValue("PRAGMA user_version");
          if(originalVersion===0){db.exec(${JSON.stringify(populated)});}
          const version = db.selectValue("PRAGMA user_version");`,
        );
        if (upgrade === "upgradeV5MigrationFailure")
          transformed = transformed.replace(
            '    db.exec("CREATE INDEX IF NOT EXISTS transfers_by_from_date ON transfers(from_account_id,date DESC,created_at DESC)");',
            '    db.exec("CREATE INDEX IF NOT EXISTS transfers_by_from_date ON transfers(from_account_id,date DESC,created_at DESC)");\n    if (!self.__transferMigrationFailed) { self.__transferMigrationFailed = true; throw Error("Simulated transfer migration failure"); }',
          );
        return transformed;
      }
      if (storageFault.current === "transactionUpdateRollback") {
        storageFault.current = null;
        return source.replace(
          "    db.exec({ sql: updateSql, bind: values });",
          '    db.exec({ sql: updateSql, bind: values });\n    if (amountMinor === 2000 && !self.__transactionUpdateFailed) { self.__transactionUpdateFailed = true; throw Error("Simulated transaction update failure"); }',
        );
      }
      if (storageFault.current === "transactionDeleteRollback") {
        storageFault.current = null;
        const deleteExpense = "    db.exec({ sql: `DELETE FROM ${table} WHERE id=?`, bind: [transactionId] });";
        return source.replace(
          deleteExpense,
          `    if (!self.__transactionDeleteFailed) { self.__transactionDeleteFailed = true; throw Error("Simulated transaction delete failure"); }\n${deleteExpense}`,
        );
      }
      if (storageFault.current === "transactionReply") {
        storageFault.current = null;
        return source.replace(
          "    self.postMessage({ id, result });",
          '    if (command === "updateTransaction" && !self.__transactionReplyDropped) { self.__transactionReplyDropped = true; self.postMessage({ id, error: "Simulated lost transaction reply" }); } else self.postMessage({ id, result });',
        );
      }
      if (storageFault.current === "accountReply") {
        storageFault.current = null;
        return source.replace(
          "self.postMessage({ id, result });",
          "if(command==='account.create'&&!self.__accountReplyDropped){self.__accountReplyDropped=true;self.postMessage({id,error:'Save confirmation failed. Retry to check whether it was saved.'});}else{self.postMessage({id,result});}",
        );
      }
      if (storageFault.current === "accountUpdate") {
        storageFault.current = null;
        return source.replace(
          /db\.exec\(\{\s*sql: "UPDATE accounts SET name=/,
          'if(!self.__accountUpdateFailed){self.__accountUpdateFailed=true;throw Error("Simulated account update failure");} db.exec({sql: "UPDATE accounts SET name=',
        );
      }
      if (storageFault.current === "schemaV4Migration") {
        storageFault.current = null;
        return source.replace(
          '      PRAGMA user_version=4;\n    `);\n  });\n}',
          '      PRAGMA user_version=4;\n    `);\n    throw Error("Simulated version 4 migration failure");\n  });\n}',
        );
      }
      if (storageFault.current === "migrateV1" || storageFault.current === "failV1Migration") {
        const failMigration = storageFault.current === "failV1Migration";
        storageFault.current = null;
        let result = source.replace(
          'const version = db.selectValue("PRAGMA user_version");',
          `const originalVersion=db.selectValue("PRAGMA user_version");
          if(originalVersion===0){db.exec(${JSON.stringify(populatedV1)});}
          const version = db.selectValue("PRAGMA user_version");`,
        );
        if (failMigration)
          result = result.replace(
            '      PRAGMA user_version=2;\n    `);\n  });\n}\n\n/** Add ordinary expenses',
            '      PRAGMA user_version=2;\n    `);\n    if (!self.__legacyMigrationFailed) { self.__legacyMigrationFailed = true; throw Error("Simulated migration failure"); }\n  });\n}\n\n/** Add ordinary expenses',
          );
        return result;
      }
      return source;
    });
    await new Promise((resolve) => server.once("listening", resolve));
    try {
      await provide(`http://127.0.0.1:${server.address().port}`);
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  },
  context: async ({ browser, browserName, baseURL }, provide, testInfo) => {
    const context = browserName === "webkit"
      ? await webkit.launchPersistentContext(testInfo.outputPath("profile"), { baseURL })
      : await browser.newContext({ baseURL });
    try {
      await provide(context);
    } finally {
      await context.close();
    }
  },
});

/** Complete visible first-run setup with the selected currency and opening balance.
 * @param page - Browser page to drive through the first-run form.
 * @param options - Optional preferred name, currency, and opening amount text.
 * @returns Resolves after the saved account list appears.
 */
async function finishSetup(page, {
  name = "Anthony",
  currency = "PHP",
  openingBalance = "0",
} = {}) {
  await page.goto("/");
  await page.getByRole("button", { name: "Continue offline" }).click();
  await page.getByLabel("Preferred name").fill(name);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "Skip introduction" }).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByLabel(`Opening balance (${currency})`).fill(openingBalance);
  await page.getByRole("button", { name: "Save my account" }).click();
  await expect(page.getByRole("heading", { name: "Your accounts" })).toBeVisible();
}

/** Return a browser-local calendar date offset from today.
 * @param page - Browser page whose local time zone determines the date.
 * @param daysAgo - Whole-day offset to subtract from the current local date.
 * @returns A YYYY-MM-DD date string.
 */
async function localDate(page, daysAgo = 0) {
  return page.evaluate((offset) => {
    const date = new Date();
    date.setDate(date.getDate() - offset);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }, daysAgo);
}

test("a populated legacy build updates on the same origin and reopens offline", async ({
  browserName,
  baseURL,
  storageFault,
}, testInfo) => {
  const browserType = browserName === "webkit" ? webkit : chromium;
  const context = await browserType.launchPersistentContext(
    testInfo.outputPath("legacy-update-profile"),
    { baseURL },
  );
  try {
    const page = await context.newPage();
    storageFault.legacyBuild = true;
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Kuwi legacy build" })).toBeVisible();
    await page.getByRole("button", { name: "Save my account" }).click();
    await expect(page.getByRole("status")).toContainText("Welcome, Anthony.");
    await expect(page.getByRole("status")).toContainText("Cash: ₱1234.56");
    await page.getByRole("button", { name: "Close database" }).click();
    await expect(page.getByRole("status")).toHaveText("Database closed");

    storageFault.legacyBuild = false;
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Your accounts" })).toBeVisible();
    await expect(page.getByText("Welcome, Anthony.", { exact: true })).toBeVisible();
    await expect(page.getByText("₱1,234.56", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "View account Cash" }).click();
    await page.getByRole("button", { name: "Add expense" }).click();
    await page.getByLabel("Expense amount").fill("10");
    await page.getByLabel("Expense note").fill("After legacy update");
    await page.getByRole("button", { name: "Save expense" }).click();
    await expect(page.getByText("₱1,224.56", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Transaction history" }).click();
    await expect(page.getByText("After legacy update", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Back to account" }).click();
    await page.getByRole("button", { name: "Back to accounts" }).click();
    await page.evaluate(async () => navigator.serviceWorker.ready);
    await page.getByRole("button", { name: "Close database" }).click();
    await context.setOffline(true);
    await page.getByRole("button", { name: "Retry opening" }).click();
    await expect(page.getByText("₱1,224.56", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "View account Cash" }).click();
    await page.getByRole("button", { name: "Add expense" }).click();
    await page.getByLabel("Expense amount").fill("1");
    await page.getByLabel("Expense note").fill("Offline after legacy update");
    await page.getByRole("button", { name: "Save expense" }).click();
    await expect(page.getByText("₱1,223.56", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Transaction history" }).click();
    await expect(page.getByText("After legacy update", { exact: true })).toBeVisible();
    await expect(page.getByText("Offline after legacy update", { exact: true })).toBeVisible();
  } finally {
    await context.close();
  }
});

test("a legacy expense and backup survive the shell update", async ({
  browserName,
  baseURL,
  storageFault,
}, testInfo) => {
  const browserType = browserName === "webkit" ? webkit : chromium;
  const context = await browserType.launchPersistentContext(
    testInfo.outputPath("legacy-expense-update-profile"),
    { baseURL },
  );
  try {
    const page = await context.newPage();
    storageFault.legacyBuild = "v3";
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Kuwi previous shell" })).toBeVisible();
    await page.getByRole("button", { name: "Save my account" }).click();
    await expect(page.getByRole("status")).toContainText("Cash: ₱1234.56");
    await page.getByRole("button", { name: "Add expense" }).click();
    await expect(page.getByRole("status")).toHaveText("Legacy balance: ₱1224.56");

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export backup" }).click();
    const download = await downloadPromise;
    const backup = readFileSync(await download.path());
    expect(JSON.parse(backup.toString())).toMatchObject({
      format: "kuwi.backup",
      schemaVersion: 3,
      data: {
        accounts: [expect.objectContaining({ name: "Cash" })],
        expenses: [expect.objectContaining({ note: "Legacy coffee", amount_minor: 1000 })],
      },
    });
    await page.getByRole("button", { name: "Close database" }).click();
    await expect(page.getByRole("status")).toHaveText("Database closed");

    storageFault.legacyBuild = false;
    storageFault.current = "schemaV4Migration";
    await page.goto("/");
    await expect(page.getByRole("alert")).toContainText("Simulated version 4 migration failure");
    await page.reload();
    await expect(page.getByRole("heading", { name: "Your accounts" })).toBeVisible();
    await expect(page.getByText("₱1,224.56", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "View account Cash" }).click();
    await page.getByRole("button", { name: "Transaction history" }).click();
    await expect(page.getByText("Legacy coffee", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Back to account" }).click();
    await page.getByRole("button", { name: "Back to accounts" }).click();

    await page.getByRole("button", { name: "Add account" }).click();
    await page.getByLabel("Account name").fill("Reserve");
    await page.getByRole("button", { name: "Save account" }).click();
    await page.getByRole("button", { name: "View account Cash" }).click();
    await page.getByRole("button", { name: "Transfer between accounts" }).click();
    await page.getByLabel("To account").selectOption({ label: "Reserve" });
    await page.getByLabel("Transfer amount").fill("100");
    await page.getByLabel("Transfer fee (optional)").fill("4.56");
    await page.getByLabel("Transfer note").fill("Updated schema transfer");
    const tomorrow = await page.evaluate(() => {
      const date = new Date();
      date.setDate(date.getDate() + 1);
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    });
    await page.getByLabel("Transfer date").fill(tomorrow);
    await page.getByRole("button", { name: "Save transfer" }).click();
    await expect(page.getByText("₱1,120.00", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Back to accounts" }).click();
    await page.getByRole("button", { name: "View account Cash" }).click();
    await page.getByRole("button", { name: "Transaction history" }).click();
    await expect(page.getByText("Legacy coffee", { exact: true })).toBeVisible();
    await expect(page.getByText("Updated schema transfer", { exact: true })).toBeVisible();
    await expect(page.getByText("Bank transfer fee to Reserve", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Back to account" }).click();
    await page.getByRole("button", { name: "Back to accounts" }).click();

    const currentDownloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export backup" }).click();
    const currentDownload = await currentDownloadPromise;
    const currentBackup = JSON.parse(readFileSync(await currentDownload.path(), "utf8"));
    expect(currentBackup).toMatchObject({
      schemaVersion: 7,
      data: {
        expenses: expect.arrayContaining([expect.objectContaining({ transfer_id: expect.any(String) })]),
        transfers: [expect.objectContaining({ fee_amount_minor: 456, note: "Updated schema transfer" })],
        pendingTransferOperations: [expect.objectContaining({ operation_id: expect.any(String) })],
      },
    });

    const chooserPromise = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Restore backup" }).click();
    const chooser = await chooserPromise;
    await chooser.setFiles({
      name: "legacy-backup.json",
      mimeType: "application/json",
      buffer: backup,
    });
    await expect(page.getByText("₱1,224.56", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "View account Cash" }).click();
    await page.getByRole("button", { name: "Transaction history" }).click();
    await expect(page.getByText("Legacy coffee", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Back to account" }).click();
    await page.getByRole("button", { name: "Back to accounts" }).click();

    await page.evaluate(async () => navigator.serviceWorker.ready);
    await page.getByRole("button", { name: "Close database" }).click();
    await context.setOffline(true);
    await page.getByRole("button", { name: "Retry opening" }).click();
    await expect(page.getByText("₱1,224.56", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "View account Cash" }).click();
    await page.getByRole("button", { name: "Transaction history" }).click();
    await expect(page.getByText("Legacy coffee", { exact: true })).toBeVisible();
  } finally {
    await context.close();
  }
});

test("accounts can be added and renamed, with linked balances retained offline", async ({
  page,
  context,
}) => {
  await finishSetup(page);
  await page.getByRole("button", { name: "Add account" }).click();
  await page.getByLabel("Account name").fill("Travel wallet");
  await page.getByLabel("Opening balance (PHP)").fill("250.75");
  await page.getByRole("button", { name: "Save account" }).click();

  await expect(page.getByText("Travel wallet", { exact: true })).toBeVisible();
  await expect(page.getByText("₱250.75", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "View account Travel wallet" }).click();
  await expect(page.getByRole("heading", { name: "Travel wallet" })).toBeVisible();
  await expect(page.getByText("Currency PHP", { exact: true })).toBeVisible();
  await expect(page.getByText("₱250.75", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Back to accounts" }).click();
  await page.getByRole("button", { name: "Edit account Travel wallet" }).click();
  await expect(page.getByLabel("Opening balance (PHP)")).not.toBeEditable();
  await expect(page.getByRole("button", { name: "USD US Dollar" })).toBeDisabled();
  await page.getByLabel("Account name").fill("Trip wallet");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Trip wallet", { exact: true })).toBeVisible();

  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.close();
  await context.setOffline(true);
  const reopened = await context.newPage();
  await reopened.goto("/");
  await expect(reopened.getByText("Trip wallet", { exact: true })).toBeVisible();
  await expect(reopened.getByText("₱250.75", { exact: true })).toBeVisible();
});

test("account forms show validation and allow changing an unlinked starting balance", async ({
  page,
}) => {
  await finishSetup(page);
  await page.getByRole("button", { name: "Edit account Cash" }).click();
  await page.getByLabel("Account name").fill("   ");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("alert")).toContainText("enter an account name");

  await page.getByLabel("Account name").fill("Everyday");
  await page.getByLabel("Opening balance (PHP)").fill("1.234");
  await expect(page.getByLabel("Opening balance (PHP)")).toHaveValue("1.23");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Everyday", { exact: true })).toBeVisible();
  await expect(page.getByText("₱1.23", { exact: true })).toBeVisible();
});

test("accounts use supported currencies and keep a credit limit separate from owed balance", async ({
  page,
}) => {
  await finishSetup(page);
  await page.getByRole("button", { name: "Add account" }).click();
  await page.getByLabel("Account name").fill("Travel fund");
  await page.getByRole("radio", { name: "Assets" }).click();
  await page.getByRole("button", { name: "USD US Dollar" }).click();
  await page.getByLabel("Opening balance (USD)").fill("10.50");
  await page.getByRole("button", { name: "Save account" }).click();
  await expect(page.getByText(/(?:US)?\$10\.50/)).toBeVisible();
  await page
    .getByRole("button", { name: "View account Travel fund", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Add income", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Back to accounts", exact: true }).click();

  await page.getByRole("button", { name: "Add account" }).click();
  await page.getByLabel("Account name").fill("Everyday card");
  await page.getByRole("radio", { name: "Credit" }).click();
  await page.getByLabel("Credit limit (PHP)").fill("50000");
  await page.getByRole("button", { name: "Add current balance" }).click();
  await page.getByLabel("Current balance (PHP)").fill("1200");
  await page.getByRole("button", { name: "Save account" }).click();
  await expect(page.getByText("₱1,200.00", { exact: true })).toBeVisible();
  await expect(page.getByText("Credit limit ₱50,000.00", { exact: true })).toBeVisible();
});

test("retries of one account save reuse the operation and create one opening adjustment", async ({
  page,
  storageFault,
}) => {
  storageFault.current = "accountReply";
  await finishSetup(page);
  await page.getByRole("button", { name: "Add account" }).click();
  await page.getByLabel("Account name").fill("Reserve");
  await page.getByLabel("Opening balance (PHP)").fill("75.00");
  await page.getByRole("button", { name: "Save account" }).click();
  await expect(page.getByRole("alert")).toContainText("Save confirmation failed");
  await page.getByRole("button", { name: "Save account" }).click();
  await expect(page.getByText("Reserve", { exact: true })).toHaveCount(1);
  await expect(page.getByText("₱75.00", { exact: true })).toHaveCount(1);
});

test("failed account edits roll back and retry the same save", async ({
  page,
  storageFault,
}) => {
  storageFault.current = "accountUpdate";
  await finishSetup(page);
  await page.getByRole("button", { name: "Edit account Cash" }).click();
  await page.getByLabel("Account name").fill("Everyday");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("alert")).toContainText("Simulated account update failure");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Everyday", { exact: true })).toBeVisible();
});

test("expense and income edits move effects between accounts and deletions preserve other entries offline", async ({
  page,
  context,
}) => {
  const yesterday = await localDate(page, 1);
  await finishSetup(page, { openingBalance: "1000" });
  await page.getByRole("button", { name: "Add account" }).click();
  await page.getByLabel("Account name").fill("Reserve");
  await page.getByLabel("Opening balance (PHP)").fill("200");
  await page.getByRole("button", { name: "Save account" }).click();

  await page.getByRole("button", { name: "View account Cash" }).click();
  await page.getByRole("button", { name: "Add expense" }).click();
  await page.getByLabel("Expense amount").fill("5");
  await page.getByLabel("Expense note").fill("Rent");
  await page.getByRole("button", { name: "Save expense" }).click();
  await page.getByRole("button", { name: "Add expense" }).click();
  await page.getByLabel("Expense amount").fill("12");
  await page.getByLabel("Expense note").fill("Coffee");
  await page.getByRole("button", { name: "Food", exact: true }).click();
  await page.getByRole("button", { name: "Save expense" }).click();
  await expect(page.getByText("₱983.00", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Transaction history" }).click();
  await page.getByRole("button", { name: "Edit Coffee" }).click();
  await page.getByLabel("Transaction amount").fill("20");
  await page.getByRole("button", { name: "Shopping", exact: true }).click();
  await page.getByLabel("Expense date").fill(yesterday);
  await page.getByRole("button", { name: "Reserve", exact: true }).click();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("status")).toContainText("Transaction updated");
  await expect(page.getByText("₱995.00", { exact: true })).toBeVisible();
  await expect(page.getByText("Coffee", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Back to account" }).click();
  await page.getByRole("button", { name: "Back to accounts" }).click();
  await page.getByRole("button", { name: "View account Reserve" }).click();
  await expect(page.getByText("₱180.00", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Transaction history" }).click();
  await expect(page.getByText(`Shopping · ${yesterday} · Reserve`)).toBeVisible();
  await page.getByRole("button", { name: "Delete Coffee" }).click();
  await page.getByRole("button", { name: "Confirm delete" }).click();
  await expect(page.getByRole("status")).toContainText("Transaction deleted");
  await expect(page.getByText("₱200.00", { exact: true })).toBeVisible();
  await expect(page.getByText("Coffee", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Back to account" }).click();
  await page.getByRole("button", { name: "Back to accounts" }).click();
  await page.getByRole("button", { name: "View account Cash" }).click();
  await page.getByRole("button", { name: "Add income" }).click();
  await page.getByLabel("Income amount").fill("25");
  await page.getByLabel("Income note").fill("Pay");
  await page.getByRole("button", { name: "Salary", exact: true }).click();
  await page.getByRole("button", { name: "Save income" }).click();
  await expect(page.getByText("₱1,020.00", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Transaction history" }).click();
  await page.getByRole("button", { name: "Edit Pay" }).click();
  await page.getByLabel("Transaction amount").fill("35");
  await page.getByRole("button", { name: "Bonus", exact: true }).click();
  await page.getByLabel("Income date").fill(yesterday);
  await page.getByRole("button", { name: "Reserve", exact: true }).click();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("status")).toContainText("Transaction updated");
  await expect(page.getByText("₱995.00", { exact: true })).toBeVisible();
  await expect(page.getByText("Pay", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Back to account" }).click();
  await page.getByRole("button", { name: "Back to accounts" }).click();
  await page.getByRole("button", { name: "View account Reserve" }).click();
  await expect(page.getByText("₱235.00", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Transaction history" }).click();
  await expect(page.getByText(`Bonus · ${yesterday} · Reserve`)).toBeVisible();
  await page.getByRole("button", { name: "Delete Pay" }).click();
  await page.getByRole("button", { name: "Confirm delete" }).click();
  await expect(page.getByRole("status")).toContainText("Transaction deleted");
  await expect(page.getByText("₱200.00", { exact: true })).toBeVisible();
  await expect(page.getByText("Pay", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Back to account" }).click();
  await page.getByRole("button", { name: "Back to accounts" }).click();
  await expect(page.getByText("₱995.00", { exact: true })).toBeVisible();
  await expect(page.getByText("₱200.00", { exact: true })).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export backup" }).click();
  const download = await downloadPromise;
  const backup = JSON.parse(readFileSync(await download.path(), "utf8"));
  expect(backup.schemaVersion).toBe(7);
  expect(backup.data.expenses).toHaveLength(1);
  expect(backup.data.expenses[0].note).toBe("Rent");
  expect(backup.data.pendingSyncOperations).toEqual([
    { operation_id: backup.data.expenses[0].id },
  ]);
  expect(backup.data.incomes).toHaveLength(0);
  expect(backup.data.pendingIncomeSyncOperations).toHaveLength(0);
  expect(backup.data.pendingTransactionOperations).toHaveLength(4);
  expect(new Set(backup.data.pendingTransactionOperations.map(({ operation_id }) => operation_id)).size).toBe(4);

  await page.evaluate(async () => navigator.serviceWorker.ready);
  await page.close();
  await context.setOffline(true);
  const reopened = await context.newPage();
  await reopened.goto("/");
  await expect(reopened.getByText("₱995.00", { exact: true })).toBeVisible();
  await expect(reopened.getByText("₱200.00", { exact: true })).toBeVisible();
  await reopened.getByRole("button", { name: "View account Cash" }).click();
  await reopened.getByRole("button", { name: "Transaction history" }).click();
  await expect(reopened.getByText("Rent", { exact: true })).toBeVisible();
  await expect(reopened.getByText("Coffee", { exact: true })).toHaveCount(0);
  await expect(reopened.getByText("Pay", { exact: true })).toHaveCount(0);
});

test("a failed transaction edit rolls back stored values before a later correction", async ({
  page,
  storageFault,
}) => {
  const today = await localDate(page);
  const yesterday = await localDate(page, 1);
  storageFault.current = "transactionUpdateRollback";
  await finishSetup(page, { openingBalance: "1000" });
  await page.getByRole("button", { name: "View account Cash" }).click();
  await page.getByRole("button", { name: "Add expense" }).click();
  await page.getByLabel("Expense amount").fill("12");
  await page.getByLabel("Expense note").fill("Coffee");
  await page.getByRole("button", { name: "Save expense" }).click();
  await page.getByRole("button", { name: "Transaction history" }).click();
  await page.getByRole("button", { name: "Edit Coffee" }).click();
  await page.getByLabel("Transaction amount").fill("20");
  await page.getByRole("button", { name: "Shopping", exact: true }).click();
  await page.getByLabel("Expense date").fill(yesterday);
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("alert")).toContainText("Simulated transaction update failure");

  await page.reload();
  await expect(page.getByText("₱988.00", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "View account Cash" }).click();
  await page.getByRole("button", { name: "Transaction history" }).click();
  await expect(page.getByText(`Other · ${today} · Cash`)).toBeVisible();
  await page.getByRole("button", { name: "Edit Coffee" }).click();
  await page.getByLabel("Transaction amount").fill("21");
  await page.getByRole("button", { name: "Shopping", exact: true }).click();
  await page.getByLabel("Expense date").fill(yesterday);
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("status")).toContainText("Transaction updated");
  await expect(page.getByText("₱979.00", { exact: true })).toBeVisible();
  await expect(page.getByText(`Shopping · ${yesterday} · Cash`)).toBeVisible();
});

test("a failed delete rolls back its tombstone and sync marker before retry", async ({
  page,
  storageFault,
}) => {
  storageFault.current = "transactionDeleteRollback";
  await finishSetup(page, { openingBalance: "1000" });
  await page.getByRole("button", { name: "View account Cash" }).click();
  await page.getByRole("button", { name: "Add expense" }).click();
  await page.getByLabel("Expense amount").fill("12");
  await page.getByLabel("Expense note").fill("Coffee");
  await page.getByRole("button", { name: "Save expense" }).click();
  await page.getByRole("button", { name: "Transaction history" }).click();
  await page.getByRole("button", { name: "Delete Coffee" }).click();
  await page.getByRole("button", { name: "Confirm delete" }).click();
  await expect(page.getByRole("alert")).toContainText("Simulated transaction delete failure");
  await expect(page.getByText("₱988.00", { exact: true })).toBeVisible();
  await expect(page.getByText("Coffee", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Confirm delete" }).click();
  await expect(page.getByRole("status")).toContainText("Transaction deleted");
  await expect(page.getByText("₱1,000.00", { exact: true })).toBeVisible();
  await expect(page.getByText("Coffee", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Back to account" }).click();
  await page.getByRole("button", { name: "Back to accounts" }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export backup" }).click();
  const download = await downloadPromise;
  const backup = JSON.parse(readFileSync(await download.path(), "utf8"));
  expect(backup.data.expenses).toHaveLength(0);
  expect(backup.data.pendingSyncOperations).toHaveLength(0);
  expect(backup.data.pendingTransactionOperations).toHaveLength(1);
  expect(backup.data.pendingTransactionOperations[0]).toMatchObject({
    transaction_kind: "expense",
    operation_type: "delete",
    transaction_id: expect.stringMatching(/\S/),
  });
});

test("an edit with a lost reply reuses its saved operation ID", async ({
  page,
  storageFault,
}) => {
  storageFault.current = "transactionReply";
  await finishSetup(page, { openingBalance: "1000" });
  await page.getByRole("button", { name: "View account Cash" }).click();
  await page.getByRole("button", { name: "Add expense" }).click();
  await page.getByLabel("Expense amount").fill("12");
  await page.getByLabel("Expense note").fill("Coffee");
  await page.getByRole("button", { name: "Save expense" }).click();
  await page.getByRole("button", { name: "Transaction history" }).click();
  await page.getByRole("button", { name: "Edit Coffee" }).click();
  await page.getByLabel("Transaction amount").fill("20");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("alert")).toContainText("Simulated lost transaction reply");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("status")).toContainText("Transaction updated");
  await expect(page.getByText("₱980.00", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Back to account" }).click();
  await page.getByRole("button", { name: "Back to accounts" }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export backup" }).click();
  const download = await downloadPromise;
  const backup = JSON.parse(readFileSync(await download.path(), "utf8"));
  expect(backup.data.expenses).toHaveLength(1);
  expect(backup.data.expenses[0].amount_minor).toBe(2000);
  expect(backup.data.pendingSyncOperations).toEqual([
    { operation_id: backup.data.expenses[0].id },
  ]);
  expect(backup.data.pendingTransactionOperations).toHaveLength(1);
  expect(backup.data.pendingTransactionOperations[0]).toMatchObject({
    transaction_kind: "expense",
    operation_type: "edit",
    transaction_id: backup.data.expenses[0].id,
  });
});

test("a populated v4 database migrates while keeping account and transaction identities", async ({
  page,
  storageFault,
}) => {
  storageFault.current = "upgradeV4";
  await page.goto("/");
  await expect(page.getByText("₱1,013.00", { exact: true })).toBeVisible();
  await expect(page.getByText("₱200.00", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "View account Cash" }).click();
  await page.getByRole("button", { name: "Transaction history" }).click();
  await expect(page.getByText("Legacy coffee", { exact: true })).toBeVisible();
  await expect(page.getByText("Legacy pay", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Back to account" }).click();
  await page.getByRole("button", { name: "Back to accounts" }).click();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export backup" }).click();
  const download = await downloadPromise;
  const backup = JSON.parse(readFileSync(await download.path(), "utf8"));
  expect(backup.schemaVersion).toBe(7);
  expect(backup.data.accounts.map(({ id }) => id)).toEqual(["legacy-cash", "legacy-reserve"]);
  expect(backup.data.expenses.map(({ id }) => id)).toEqual(["legacy-expense"]);
  expect(backup.data.incomes.map(({ id }) => id)).toEqual(["legacy-income"]);
  expect(backup.data.pendingTransactionOperations).toEqual([]);
});

test("a populated v5 database gains transfer relations without losing transaction receipts", async ({
  page,
  storageFault,
}) => {
  storageFault.current = "upgradeV5";
  await page.goto("/");
  await expect(page.getByText("₱1,013.00", { exact: true })).toBeVisible();
  await expect(page.getByText("₱200.00", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "View account Cash" }).click();
  await page.getByRole("button", { name: "Transaction history" }).click();
  await expect(page.getByText("Legacy coffee", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Back to account" }).click();
  await page.getByRole("button", { name: "Transfer between accounts" }).click();
  await page.getByLabel("Transfer amount").fill("10");
  await page.getByLabel("Transfer fee (optional)").fill("0.50");
  await page.getByLabel("Transfer note").fill("After v5 migration");
  await page.getByRole("button", { name: "Save transfer" }).click();
  await expect(page.getByText("₱1,002.50", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Back to accounts" }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export backup" }).click();
  const download = await downloadPromise;
  const backup = JSON.parse(readFileSync(await download.path(), "utf8"));
  expect(backup).toMatchObject({
    schemaVersion: 7,
    data: {
      expenses: expect.arrayContaining([
        expect.objectContaining({ id: "legacy-expense", transfer_id: null }),
        expect.objectContaining({ note: "Bank transfer fee to Reserve", transfer_id: expect.any(String) }),
      ]),
      transfers: [expect.objectContaining({ note: "After v5 migration", fee_amount_minor: 50 })],
      pendingTransactionOperations: [expect.objectContaining({
        operation_id: "legacy-edit",
        transaction_id: "legacy-expense",
        operation_type: "edit",
      })],
    },
  });
});

test("a failed v6 migration rolls back and retries from a populated v5 database", async ({
  page,
  storageFault,
}) => {
  storageFault.disableCache = true;
  storageFault.current = "upgradeV5MigrationFailure";
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText("Simulated transfer migration failure");

  await page.reload();
  await expect(page.getByText("₱1,013.00", { exact: true })).toBeVisible();
  await expect(page.getByText("₱200.00", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "View account Cash" }).click();
  await page.getByRole("button", { name: "Transaction history" }).click();
  await expect(page.getByText("Legacy coffee", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Back to account" }).click();
  await page.getByRole("button", { name: "Transfer between accounts" }).click();
  await page.getByLabel("Transfer amount").fill("10");
  await page.getByRole("button", { name: "Save transfer" }).click();
  await expect(page.getByText("₱1,003.00", { exact: true })).toBeVisible();
});

test("a populated v4 transfer database keeps its transfer and linked fee through migration", async ({
  page,
  storageFault,
}) => {
  storageFault.current = "upgradeV4Transfer";
  await page.goto("/");
  await expect(page.getByText("₱908.44", { exact: true })).toBeVisible();
  await expect(page.getByText("₱300.00", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "View account Cash" }).click();
  await page.getByRole("button", { name: "Transaction history" }).click();
  await expect(page.getByText("Legacy transfer", { exact: true })).toBeVisible();
  await expect(page.getByText("Bank transfer fee to Reserve", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit Bank transfer fee to Reserve", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Delete Bank transfer fee to Reserve", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Back to account" }).click();
  await page.getByRole("button", { name: "Back to accounts" }).click();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export backup" }).click();
  const download = await downloadPromise;
  const backup = JSON.parse(readFileSync(await download.path(), "utf8"));
  expect(backup).toMatchObject({
    schemaVersion: 7,
    data: {
      expenses: expect.arrayContaining([
        expect.objectContaining({ id: "legacy-expense", transfer_id: null }),
        expect.objectContaining({ id: "legacy-transfer-fee", transfer_id: "legacy-transfer" }),
      ]),
      transfers: [expect.objectContaining({ id: "legacy-transfer", fee_amount_minor: 456 })],
      pendingTransferOperations: [{
        operation_id: "legacy-transfer",
        request_fingerprint: "b".repeat(64),
      }],
      pendingTransactionOperations: [],
    },
  });
});

test("migrates a populated v1 database into derived account balances", async ({
  page,
  storageFault,
  context,
}) => {
  storageFault.current = "migrateV1";
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Your accounts" })).toBeVisible();
  await expect(page.getByText("₱1,234.56", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Edit account Cash" }).click();
  await expect(page.getByLabel("Opening balance (PHP)")).not.toBeEditable();
  await page.getByLabel("Account name").fill("Migrated cash");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Migrated cash", { exact: true })).toBeVisible();
  await expect(page.getByText("₱1,234.56", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "View account Migrated cash" }).click();
  await page.getByRole("button", { name: "Add expense" }).click();
  await page.getByLabel("Expense amount").fill("10");
  await page.getByLabel("Expense note").fill("After v1 migration");
  await page.getByRole("button", { name: "Save expense" }).click();
  await expect(page.getByText("₱1,224.56", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Transaction history" }).click();
  await expect(page.getByText("After v1 migration", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Back to account" }).click();
  await page.getByRole("button", { name: "Back to accounts" }).click();
  await page.evaluate(async () => navigator.serviceWorker.ready);
  const second = await context.newPage();
  await second.goto("/");
  await expect(second.getByRole("alert")).toContainText("Database busy");
  await page.getByRole("button", { name: "Close database" }).click();
  await context.setOffline(true);
  await second.getByRole("button", { name: "Retry opening" }).click();
  await expect(second.getByText("Migrated cash", { exact: true })).toBeVisible();
  await expect(second.getByText("₱1,224.56", { exact: true })).toBeVisible();
  await second.getByRole("button", { name: "View account Migrated cash" }).click();
  await second.getByRole("button", { name: "Transaction history" }).click();
  await expect(second.getByText("After v1 migration", { exact: true })).toBeVisible();
  await second.getByRole("button", { name: "Back to account" }).click();
  await second.getByRole("button", { name: "Add expense" }).click();
  await second.getByLabel("Expense amount").fill("1");
  await second.getByLabel("Expense note").fill("Offline after migration");
  await second.getByRole("button", { name: "Save expense" }).click();
  await expect(second.getByText("₱1,223.56", { exact: true })).toBeVisible();
});

test("a failed v1 migration keeps the populated database for a successful retry", async ({
  page,
  storageFault,
}) => {
  storageFault.current = "failV1Migration";
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText("Simulated migration failure");
  await expect(page.getByRole("button", { name: "Retry opening" })).toBeVisible();
  await page.getByRole("button", { name: "Retry opening" }).click();
  await expect(page.getByText("₱1,234.56", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Edit account Cash" }).click();
  await page.getByLabel("Account name").fill("After retry");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("After retry", { exact: true })).toBeVisible();
  await expect(page.getByText("₱1,234.56", { exact: true })).toBeVisible();
});
