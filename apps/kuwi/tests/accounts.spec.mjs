import { expect, test as base, webkit } from "@playwright/test";
import { startServer } from "../scripts/serve.mjs";

const test = base.extend({
  storageFault: async ({}, provide) => {
    await provide({ current: null });
  },
  baseURL: async ({ storageFault }, provide) => {
    const server = startServer(0, (path, bytes) => {
      if (path !== "/db-worker.js" || !storageFault.current) return bytes;
      const source = bytes.toString();
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
      if (storageFault.current === "migrateV1" || storageFault.current === "failV1Migration") {
        const failMigration = storageFault.current === "failV1Migration";
        storageFault.current = null;
        let result = source.replace(
          'const version = db.selectValue("PRAGMA user_version");',
          `const originalVersion=db.selectValue("PRAGMA user_version");
          if(originalVersion===0){db.exec(\`CREATE TABLE currencies(code TEXT PRIMARY KEY NOT NULL, decimal_places INTEGER NOT NULL CHECK(decimal_places BETWEEN 0 AND 3)) STRICT;
          INSERT INTO currencies VALUES('PHP',2),('USD',2),('EUR',2),('GBP',2),('JPY',0),('TWD',2);
          CREATE TABLE profiles(id TEXT PRIMARY KEY NOT NULL, preferred_name TEXT NOT NULL CHECK(length(trim(preferred_name))>0), preferred_currency TEXT NOT NULL REFERENCES currencies(code)) STRICT;
          CREATE TABLE accounts(id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL CHECK(length(trim(name))>0), currency_code TEXT NOT NULL REFERENCES currencies(code), opening_balance_minor INTEGER NOT NULL) STRICT;
          CREATE TABLE setup(id INTEGER PRIMARY KEY CHECK(id=1), profile_id TEXT NOT NULL UNIQUE REFERENCES profiles(id), first_account_id TEXT NOT NULL UNIQUE REFERENCES accounts(id), completed_at TEXT NOT NULL) STRICT;
          INSERT INTO profiles VALUES('local','Anthony','PHP'); INSERT INTO accounts VALUES('first','Cash','PHP',123456); INSERT INTO setup VALUES(1,'local','first','2026-11-07T00:00:00.000Z'); PRAGMA user_version=1;\`);}
          const version = db.selectValue("PRAGMA user_version");`,
        );
        if (failMigration)
          result = result.replace(
            "migrateV1();",
            "transaction(() => { db.exec('CREATE TABLE migration_trial(id INTEGER)'); throw Error('Simulated migration failure'); });",
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

async function finishSetup(page, { name = "Anthony", currency = "PHP" } = {}) {
  await page.goto("/");
  await page.getByRole("button", { name: "Continue offline" }).click();
  await page.getByLabel("Preferred name").fill(name);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "Skip introduction" }).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByLabel(`Opening balance (${currency})`).fill("0");
  await page.getByRole("button", { name: "Save my account" }).click();
  await expect(page.getByRole("heading", { name: "Your accounts" })).toBeVisible();
}

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

test("migrates a populated v1 database into derived account balances", async ({
  page,
  storageFault,
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
});

test("a failed v1 migration keeps the populated database for a successful retry", async ({
  page,
  storageFault,
}) => {
  storageFault.current = "failV1Migration";
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText("Simulated migration failure");
  await page.getByRole("button", { name: "Retry opening" }).click();
  await expect(page.getByText("₱1,234.56", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Edit account Cash" }).click();
  await page.getByLabel("Account name").fill("After retry");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("After retry", { exact: true })).toBeVisible();
  await expect(page.getByText("₱1,234.56", { exact: true })).toBeVisible();
});
