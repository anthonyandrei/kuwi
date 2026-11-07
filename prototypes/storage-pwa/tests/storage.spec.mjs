import { test as base, expect, chromium, webkit } from '@playwright/test';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../server.mjs';

// WebKit's ephemeral automation profile rejects even a bare getDirectory() on
// this host. Use a disk profile and a unique origin for each test, not a fallback
// DB. Distinct profile directories alone did not isolate OPFS in this build.
const test = base.extend({
  baseURL: async ({}, use) => {
    const server = await startServer(0);
    try { await use(`http://127.0.0.1:${server.address().port}`); }
    finally { await new Promise((resolve) => server.close(resolve)); }
  },
  context: async ({ browser, browserName, baseURL }, use) => {
    const profile = browserName === 'webkit' ? await mkdtemp(join(tmpdir(), 'kuwi-webkit-test-')) : undefined;
    const context = profile
      ? await webkit.launchPersistentContext(profile, { headless: true, baseURL })
      : await browser.newContext({ baseURL });
    try { await use(context); }
    finally {
      await context.close();
      if (profile) await rm(profile, { recursive: true, force: true });
    }
  },
});

/** Open the scratch page and wait for its worker to own the database. */
async function open(page) {
  await page.goto('/');
  await expect(page.locator('#status')).toHaveAttribute('data-phase', 'open');
}

/** Invoke the page's worker API and propagate its result or rejection to the assertion. */
async function command(page, name, args = {}) {
  return page.evaluate(({ name, args }) => window.storageProbe.call(name, args), { name, args });
}

test('opens the pinned OPFS database with foreign keys and full synchronization', async ({ page }) => {
  await open(page);
  const state = await command(page, 'state');
  expect(state).toMatchObject({ sqliteVersion: '3.54.1', vfs: 'opfs-sahpool', schemaVersion: 1, foreignKeys: 1, synchronous: 2, journalMode: 'delete' });
  expect(state.balances).toEqual([{ account_id: 'cash', balance_minor: 100000 }]);
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(false);
});

test('commits an expense and pending operation once, with a derived balance', async ({ page }) => {
  await open(page);
  const args = { id: 'same-operation', amountMinor: 1234 };
  const first = await command(page, 'expense', args);
  expect(first.balances[0].balance_minor).toBe(98766);
  expect(first.expenses).toHaveLength(1);
  expect(first.outbox).toEqual([{ operation_id: args.id, expense_id: args.id }]);
  expect(await command(page, 'expense', args)).toEqual(first);
  await expect(command(page, 'expense', { ...args, amountMinor: 2000 })).rejects.toThrow('different content');
  expect(await command(page, 'state')).toEqual(first);
});

test('rolls back an expense when the pending operation cannot be written', async ({ page }) => {
  await open(page);
  const before = await command(page, 'state');
  await expect(command(page, 'expense', { id: 'fail', failAfterExpense: true })).rejects.toThrow('Intentional failure');
  expect(await command(page, 'state')).toEqual(before);
});

test('enforces account references and integer positive centavos', async ({ page }) => {
  await open(page);
  const before = await command(page, 'state');
  await expect(command(page, 'expense', { id: 'missing-account', accountId: 'missing' })).rejects.toThrow('FOREIGN KEY');
  for (const amountMinor of [0, -1, 1.5]) {
    await expect(command(page, 'expense', { id: 'bad-amount', amountMinor })).rejects.toThrow('positive integer');
  }
  expect(await command(page, 'state')).toEqual(before);
});

test('keeps the schema version and records after a failed migration', async ({ page }) => {
  await open(page);
  const before = await command(page, 'expense', { id: 'before-migration' });
  expect(await command(page, 'migrationFailure')).toEqual(before);
});

test('reopens committed data after worker termination and discards an unfinished write', async ({ page }) => {
  await open(page);
  const before = await command(page, 'expense', { id: 'committed' });
  await command(page, 'beginUncommitted', { id: 'interrupted' });
  const reopened = await page.evaluate(() => window.storageProbe.reopen());
  expect(reopened).toEqual(before);
});

test('retains committed records when a tab closes during a transaction', async ({ page, context }) => {
  await open(page);
  const before = await command(page, 'expense', { id: 'before-tab-close' });
  await command(page, 'beginUncommitted', { id: 'tab-interrupted' });
  await page.close();
  const next = await context.newPage();
  await open(next);
  expect(await command(next, 'state')).toEqual(before);
});

test('blocks a second owner and lets it open unchanged data after the first closes', async ({ page, context }) => {
  await open(page);
  const before = await command(page, 'expense', { id: 'first-owner' });
  const second = await context.newPage();
  await second.goto('/');
  await expect(second.locator('#status')).toContainText('Database busy');
  await page.getByRole('button', { name: 'Close database', exact: true }).click();
  await expect(page.locator('#status')).toHaveAttribute('data-phase', 'closed');
  await second.getByRole('button', { name: 'Reopen database', exact: true }).click();
  await expect(second.locator('#status')).toHaveAttribute('data-phase', 'open');
  expect(await command(second, 'state')).toEqual(before);
});

test('exports a SQLite file and restores it through the file chooser', async ({ page }, testInfo) => {
  await open(page);
  await expect(page.locator('#restore')).not.toHaveAttribute('accept', /.+/);
  const before = await command(page, 'expense', { id: 'backed-up', amountMinor: 4321 });
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export backup', exact: true }).click();
  // File-provider metadata may not identify SQLite; validate the bytes, not the suffix.
  const backupPath = testInfo.outputPath('scratch-backup.backup');
  await (await downloaded).saveAs(backupPath);
  expect((await readFile(backupPath)).subarray(0, 16).toString()).toBe('SQLite format 3\0');
  await page.getByRole('button', { name: 'Reset scratch entries', exact: true }).click();
  await expect(page.locator('#balance')).toHaveText('₱1000.00');
  await page.locator('#restore').setInputFiles(backupPath);
  await expect(page.locator('#balance')).toHaveText('₱956.79');
  expect(await command(page, 'state')).toEqual(before);
  expect((await command(page, 'expense', { id: 'after-restore' })).expenses).toHaveLength(2);
});

test('rejects an invalid backup without replacing existing data', async ({ page }) => {
  await open(page);
  const before = await command(page, 'expense', { id: 'keep-me' });
  await page.locator('#restore').setInputFiles({
    name: 'invalid-backup.sqlite3', mimeType: 'application/octet-stream', buffer: Buffer.from([1, 2, 3]),
  });
  await expect(page.locator('#log')).toContainText('restore:');
  await expect(page.locator('#log')).not.toContainText('restore: completed');
  await expect(page.locator('#restore')).toHaveValue('');
  expect(await command(page, 'state')).toEqual(before);
});

test('reopens the complete PWA offline and can commit another entry', async ({ page, context }) => {
  await open(page);
  await expect(page.locator('#offline')).toHaveText('Offline ready');
  await command(page, 'expense', { id: 'before-offline' });
  await page.close();
  await context.setOffline(true);
  const offline = await context.newPage();
  await open(offline);
  await expect(offline.locator('#offline')).toHaveText('Offline ready');
  expect((await command(offline, 'state')).expenses).toHaveLength(1);
  const after = await command(offline, 'expense', { id: 'while-offline' });
  expect(after.expenses).toHaveLength(2);
  expect(after.outbox).toHaveLength(2);
  expect(after.balances[0].balance_minor).toBe(95000);
});

test('recovers the disk profile after its Chromium browser process is killed', async ({ browserName, baseURL }) => {
  test.skip(browserName !== 'chromium', 'CDP process identification is Chromium-specific.');
  const profile = await mkdtemp(join(tmpdir(), 'kuwi-storage-crash-'));
  let persistent;
  try {
    persistent = await chromium.launchPersistentContext(profile, { headless: true, baseURL });
    const page = persistent.pages()[0];
    await open(page);
    const before = await command(page, 'expense', { id: 'committed-before-crash' });
    await command(page, 'beginUncommitted', { id: 'lost-on-crash' });
    const cdp = await persistent.browser().newBrowserCDPSession();
    const { processInfo } = await cdp.send('SystemInfo.getProcessInfo');
    const processId = processInfo.find((entry) => entry.type === 'browser').id;
    const closed = persistent.waitForEvent('close');
    process.kill(processId, 'SIGKILL');
    await closed;
    persistent = await chromium.launchPersistentContext(profile, { headless: true, baseURL });
    await open(persistent.pages()[0]);
    expect(await command(persistent.pages()[0], 'state')).toEqual(before);
  } finally {
    await persistent?.close();
    await rm(profile, { recursive: true, force: true });
  }
});
