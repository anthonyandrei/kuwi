import { test as base, expect, webkit, chromium } from "@playwright/test";
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
      if (storageFault.current === "write")
        return source.replace(
          /db\.exec\(\{\s*sql: "INSERT INTO accounts/,
          'throw Error("Simulated write failure"); db.exec({sql: "INSERT INTO accounts',
        );
      if (storageFault.current === "interrupt")
        return source.replace(
          /db\.exec\(\{\s*sql: "INSERT INTO accounts/,
          'while(true) {} db.exec({sql: "INSERT INTO accounts',
        );
      if (storageFault.current === "reply") {
        storageFault.current = null;
        return source.replace(
          /self\.postMessage\(\{\s*id,\s*result\s*\}\);/,
          "if(command!=='complete') self.postMessage({id,result});",
        );
      }
      if (storageFault.current === "migration")
        return source.replace(
          "const version = db.selectValue",
          "transaction(()=>{db.exec('CREATE TABLE migration_trial(id INTEGER PRIMARY KEY)');throw Error('Simulated migration failure');}); const version = db.selectValue",
        );
      throw Error("Unknown test fault");
    });
    await new Promise((resolve) => server.once("listening", resolve));
    try {
      await provide(`http://127.0.0.1:${server.address().port}`);
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  },
  /** Provide disk-backed WebKit storage or a Chromium context; close it after the journey. */
  context: async ({ browser, browserName, baseURL }, provide, testInfo) => {
    const context =
      browserName === "webkit"
        ? await webkit.launchPersistentContext(testInfo.outputPath("profile"), {
            baseURL,
          })
        : await browser.newContext({ baseURL });
    try {
      await provide(context);
    } finally {
      await context.close();
    }
  },
});
/**
 * Follow visible setup to the account form.
 * @param {import("@playwright/test").Page} page Browser page to drive.
 * @param {boolean} [navigate=true] Open the app first; false continues after startup retry.
 */
async function setup(page, navigate = true) {
  if (navigate) await page.goto("/");
  await page
    .getByRole("button", { name: "Continue offline", exact: true })
    .click();
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
  await page
    .getByRole("button", { name: "Continue offline", exact: true })
    .click();
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

test("saved setup reopens offline after full browser closure", async ({
  browserName,
  baseURL,
}, testInfo) => {
  const browserType = browserName === "webkit" ? webkit : chromium;
  const directory = testInfo.outputPath("browser-profile");
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

test("failed migration preserves the saved account and can reopen", async ({
  page,
  storageFault,
}) => {
  storageFault.disableCache = true;
  await setup(page);
  await page
    .getByRole("button", { name: "Save my account", exact: true })
    .click();
  await expect(
    page.getByText("Welcome, Anthony.", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Close database", exact: true })
    .click();
  storageFault.current = "migration";
  storageFault.disableCache = true;
  await page.reload();
  await expect(page.getByRole("alert")).toContainText(
    "Simulated migration failure",
  );
  storageFault.current = null;
  await page
    .getByRole("button", { name: "Retry opening", exact: true })
    .click();
  await expect(
    page.getByText("Welcome, Anthony.", { exact: true }),
  ).toBeVisible();
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
