import sqlite3InitModule from "./vendor/sqlite3.mjs";
let db, pool, release, ownership;
let queue = Promise.resolve();

/**
 * Run an internal query with bound values so worker messages never become SQL.
 * @param {string} sql - Fixed SQL selected by this module.
 * @param {Array<unknown>} [bind=[]] - Values bound to positional placeholders.
 * @returns {Array<object>} Matching rows; SQLite errors propagate to dispatch.
 */
function rows(sql, bind = []) {
  return db.exec({ sql, bind, rowMode: "object", returnValue: "resultRows" });
}

/**
 * Commit a synchronous group of related writes or roll every one back.
 * @param {Function} write - Synchronous callback; nested or asynchronous writes are unsupported.
 * @returns {*} The callback result after SQLite commits.
 * @throws {Error} The original write error after rollback.
 */
function transaction(write) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = write();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/** Create schema v2 and its six currencies for an empty installation. */
function createSchema() {
  db.exec(`
    CREATE TABLE currencies(code TEXT PRIMARY KEY NOT NULL, decimal_places INTEGER NOT NULL CHECK(decimal_places BETWEEN 0 AND 3)) STRICT;
    INSERT INTO currencies VALUES('PHP',2),('USD',2),('EUR',2),('GBP',2),('JPY',0),('TWD',2);
    CREATE TABLE profiles(id TEXT PRIMARY KEY NOT NULL, preferred_name TEXT NOT NULL CHECK(length(trim(preferred_name))>0), preferred_currency TEXT NOT NULL REFERENCES currencies(code)) STRICT;
    CREATE TABLE accounts(
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL CHECK(length(trim(name))>0),
      type TEXT NOT NULL CHECK(type IN ('debit','assets','credit')),
      currency_code TEXT NOT NULL REFERENCES currencies(code),
      credit_limit_minor INTEGER CHECK(credit_limit_minor IS NULL OR credit_limit_minor >= 0),
      created_at TEXT NOT NULL,
      CHECK((type='credit' AND credit_limit_minor IS NOT NULL) OR (type!='credit' AND credit_limit_minor IS NULL))
    ) STRICT;
    CREATE TABLE account_adjustments(
      id TEXT PRIMARY KEY NOT NULL,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      amount_minor INTEGER NOT NULL CHECK(amount_minor != 0),
      adjustment_type TEXT NOT NULL CHECK(adjustment_type='initial'),
      created_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE pending_operations(
      id TEXT PRIMARY KEY NOT NULL,
      account_id TEXT NOT NULL REFERENCES accounts(id),
      operation_type TEXT NOT NULL CHECK(operation_type IN ('account.create','account.update')),
      request_fingerprint TEXT NOT NULL,
      created_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE setup(
      id INTEGER PRIMARY KEY CHECK(id=1),
      profile_id TEXT NOT NULL UNIQUE REFERENCES profiles(id),
      first_account_id TEXT NOT NULL UNIQUE REFERENCES accounts(id),
      completed_at TEXT NOT NULL
    ) STRICT;
    PRAGMA user_version=2;
  `);
}

/**
 * Upgrade v1 in one transaction while preserving profile, account, and setup IDs.
 * Each nonzero stored opening balance becomes an initial adjustment; zero needs no row.
 */
function migrateV1() {
  transaction(() => {
    db.exec(`
      CREATE TABLE accounts_v2(
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL CHECK(length(trim(name))>0),
        type TEXT NOT NULL CHECK(type IN ('debit','assets','credit')),
        currency_code TEXT NOT NULL REFERENCES currencies(code),
        credit_limit_minor INTEGER CHECK(credit_limit_minor IS NULL OR credit_limit_minor >= 0),
        created_at TEXT NOT NULL,
        CHECK((type='credit' AND credit_limit_minor IS NOT NULL) OR (type!='credit' AND credit_limit_minor IS NULL))
      ) STRICT;
      CREATE TABLE account_adjustments_v2(
        id TEXT PRIMARY KEY NOT NULL,
        account_id TEXT NOT NULL REFERENCES accounts_v2(id) ON DELETE CASCADE,
        amount_minor INTEGER NOT NULL CHECK(amount_minor != 0),
        adjustment_type TEXT NOT NULL CHECK(adjustment_type='initial'),
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE setup_v2(
        id INTEGER PRIMARY KEY CHECK(id=1),
        profile_id TEXT NOT NULL UNIQUE REFERENCES profiles(id),
        first_account_id TEXT NOT NULL UNIQUE REFERENCES accounts_v2(id),
        completed_at TEXT NOT NULL
      ) STRICT;
      INSERT INTO accounts_v2(id,name,type,currency_code,credit_limit_minor,created_at)
        SELECT id,name,'debit',currency_code,NULL,COALESCE((SELECT completed_at FROM setup WHERE id=1),CURRENT_TIMESTAMP) FROM accounts;
      INSERT INTO account_adjustments_v2(id,account_id,amount_minor,adjustment_type,created_at)
        SELECT 'opening:'||id,id,opening_balance_minor,'initial',COALESCE((SELECT completed_at FROM setup WHERE id=1),CURRENT_TIMESTAMP)
        FROM accounts WHERE opening_balance_minor != 0;
      INSERT INTO setup_v2 SELECT id,profile_id,first_account_id,completed_at FROM setup;
      DROP TABLE setup;
      DROP TABLE accounts;
      ALTER TABLE accounts_v2 RENAME TO accounts;
      ALTER TABLE account_adjustments_v2 RENAME TO account_adjustments;
      ALTER TABLE setup_v2 RENAME TO setup;
      CREATE TABLE pending_operations(
        id TEXT PRIMARY KEY NOT NULL,
        account_id TEXT NOT NULL REFERENCES accounts(id),
        operation_type TEXT NOT NULL CHECK(operation_type IN ('account.create','account.update')),
        request_fingerprint TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;
      PRAGMA user_version=2;
    `);
  });
}

/**
 * Own the OPFS database lock for the connection lifetime and initialize SQLite.
 * Fresh creation and v1 migration happen before any command can read or write data.
 * Unsupported versions and migration errors leave the existing store intact.
 */
async function open() {
  if (db) return;
  if (!navigator.locks || !navigator.storage?.getDirectory)
    throw Error("Saving requires a secure browser with OPFS and Web Locks.");
  await new Promise((resolve, reject) => {
    ownership = navigator.locks
      .request("kuwi-product-database-v1", { ifAvailable: true }, async (lock) => {
        if (!lock) {
          reject(Error("Database busy. Close Kuwi in the other tab, then retry."));
          return;
        }
        try {
          const sqlite = await sqlite3InitModule({ locateFile: (name) => `/vendor/${name}` });
          pool = await sqlite.installOpfsSAHPoolVfs({
            name: "kuwi-product-sahpool",
            directory: "/kuwi-product-v1",
            clearOnInit: false,
            preserveOnInitFailure: true,
            initialCapacity: 6,
          });
          db = new pool.OpfsSAHPoolDb("/kuwi.sqlite3");
          db.exec("PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL; PRAGMA journal_mode=DELETE; PRAGMA trusted_schema=OFF;");
          const version = db.selectValue("PRAGMA user_version");
          if (version === 0) transaction(createSchema);
          else if (version === 1) migrateV1();
          else if (version !== 2)
            throw Error("Unsupported database version. Existing data has been preserved.");
          const lifetime = new Promise((done) => { release = done; });
          resolve();
          await lifetime;
        } catch (error) {
          reject(error);
        } finally {
          db?.close();
          db = undefined;
          await pool?.pauseVfs();
        }
      })
      .catch(reject);
  });
}

/**
 * Read one account with its balance summed from adjustment facts.
 * `has_activity` currently means at least one adjustment row, including an initial row.
 * @param {string} accountId - Account primary key.
 * @returns {object|null} Account fields and derived balance, or null when missing.
 */
function account(accountId) {
  return rows(
    `SELECT a.id, a.name, a.type, a.currency_code, a.credit_limit_minor,
      COALESCE(SUM(j.amount_minor),0) AS balance_minor,
      EXISTS(SELECT 1 FROM account_adjustments linked WHERE linked.account_id=a.id) AS has_activity
     FROM accounts a LEFT JOIN account_adjustments j ON j.account_id=a.id
     WHERE a.id=? GROUP BY a.id`,
    [accountId],
  )[0] ?? null;
}

/**
 * List accounts in creation order with balances calculated from adjustment rows.
 * @returns {Array<object>} Account fields and derived balance for each saved account.
 */
function accountList() {
  return rows(
    `SELECT a.id, a.name, a.type, a.currency_code, a.credit_limit_minor,
      COALESCE(SUM(j.amount_minor),0) AS balance_minor,
      EXISTS(SELECT 1 FROM account_adjustments linked WHERE linked.account_id=a.id) AS has_activity
     FROM accounts a LEFT JOIN account_adjustments j ON j.account_id=a.id
     GROUP BY a.id ORDER BY a.created_at, a.id`,
  );
}

/**
 * Hash normalized command content for stable retry detection without copying it to the queue.
 * @param {object} value - Normalized command content.
 * @returns {Promise<string>} Lowercase SHA-256 hex digest.
 */
async function requestFingerprint(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Return onboarding details and all accounts, or null before setup completes.
 * @returns {object|null} Setup profile, first-account summary, and account list.
 */
function state() {
  const first = rows(
    `SELECT p.preferred_name, p.preferred_currency, a.id AS account_id,
      a.name AS account_name, a.currency_code,
      COALESCE(SUM(j.amount_minor),0) AS opening_balance_minor
     FROM setup s JOIN profiles p ON p.id=s.profile_id
     JOIN accounts a ON a.id=s.first_account_id
     LEFT JOIN account_adjustments j ON j.account_id=a.id
     WHERE s.id=1 GROUP BY a.id`,
  )[0];
  return first ? { ...first, accounts: accountList() } : null;
}

/**
 * Validate account fields and normalize amount values before fingerprinting or writing.
 * Negative balances and limits clamp to zero; currency and type must be supported.
 * @param {object} args - Account fields from a worker command.
 * @returns {object} Trimmed name, currency, type, and safe integer minor-unit values.
 * @throws {Error} A required field is invalid or unsupported.
 */
function normalizedAccount(args) {
  const name = args.name?.trim();
  const currency = args.currency || "PHP";
  const type = args.type || "debit";
  if (!name) throw Error("Please enter an account name.");
  if (!rows("SELECT code FROM currencies WHERE code=?", [currency]).length)
    throw Error("Choose a supported currency.");
  if (!["debit", "assets", "credit"].includes(type))
    throw Error("Choose a supported account type.");
  const amount = args.balanceMinor ?? 0;
  if (!Number.isSafeInteger(amount)) throw Error("Enter a valid account balance.");
  const balanceMinor = Math.max(0, amount);
  let creditLimitMinor = null;
  if (type === "credit") {
    const limit = args.creditLimitMinor ?? args.amountMinor;
    if (!Number.isSafeInteger(limit)) throw Error("Enter a valid credit limit.");
    creditLimitMinor = Math.max(0, limit);
  }
  return { name, currency, type, balanceMinor, creditLimitMinor };
}

/**
 * Check the durable idempotency record for a write.
 * @returns {object|null} The saved account for an identical retry, or null for a new ID.
 * @throws {Error} The ID is absent or has already been used for different content.
 */
function priorOperation(operationId, operationType, fingerprint) {
  if (typeof operationId !== "string" || !operationId.trim())
    throw Error("Save could not be verified. Retry the account change.");
  const prior = rows("SELECT account_id, operation_type, request_fingerprint FROM pending_operations WHERE id=?", [operationId])[0];
  if (!prior) return null;
  if (prior.operation_type !== operationType || prior.request_fingerprint !== fingerprint)
    throw Error("This save ID was already used for different account details.");
  return account(prior.account_id);
}

/** Add a positive opening balance as a referenced fact; zero requires no ledger row. */
function addOpeningAdjustment(accountId, balanceMinor, createdAt) {
  if (balanceMinor > 0)
    db.exec({
      sql: "INSERT INTO account_adjustments VALUES(?,?,?,'initial',?)",
      bind: [`opening:${accountId}`, accountId, balanceMinor, createdAt],
    });
}

/**
 * Save an account, optional opening adjustment, and retry record in one transaction.
 * Repeating the operation ID with identical normalized fields returns the saved row.
 * @param {object} args - Account fields and caller-supplied operation ID.
 */
async function createAccount(args) {
  const accountDetails = normalizedAccount(args);
  const operationId = args.operationId;
  const fingerprint = await requestFingerprint(accountDetails);
  let result;
  transaction(() => {
    const prior = priorOperation(operationId, "account.create", fingerprint);
    if (prior) { result = prior; return; }
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    db.exec({
      sql: "INSERT INTO accounts VALUES(?,?,?,?,?,?)",
      bind: [id, accountDetails.name, accountDetails.type, accountDetails.currency,
        accountDetails.creditLimitMinor, createdAt],
    });
    addOpeningAdjustment(id, accountDetails.balanceMinor, createdAt);
    db.exec({
      sql: "INSERT INTO pending_operations VALUES(?,?,?,?,?)",
      bind: [operationId, id, "account.create", fingerprint, createdAt],
    });
    result = account(id);
  });
  return result;
}

/**
 * Update editable account terms while protecting balance and currency after an adjustment.
 * Credit limits remain editable; a same-content retry returns the committed account.
 * @param {object} args - Account ID, editable fields, and caller-supplied operation ID.
 */
async function updateAccount(args) {
  const existing = account(args.accountId);
  if (!existing) throw Error("That account is no longer available. Refresh and try again.");
  const accountDetails = normalizedAccount({ ...args, type: existing.type });
  const operationId = args.operationId;
  const fingerprint = await requestFingerprint({ accountId: existing.id, ...accountDetails });
  let result;
  transaction(() => {
    const prior = priorOperation(operationId, "account.update", fingerprint);
    if (prior) { result = prior; return; }
    const current = account(existing.id);
    if (current.has_activity && current.currency_code !== accountDetails.currency)
      throw Error("Currency cannot change after account activity. Your existing records were kept.");
    if (current.has_activity && current.balance_minor !== accountDetails.balanceMinor)
      throw Error("Balance cannot change after account activity. Use a balance adjustment instead.");
    const createdAt = new Date().toISOString();
    const creditLimit = current.type === "credit"
      ? accountDetails.creditLimitMinor
      : null;
    db.exec({
      sql: "UPDATE accounts SET name=?, currency_code=?, credit_limit_minor=? WHERE id=?",
      bind: [accountDetails.name,
        current.has_activity ? current.currency_code : accountDetails.currency,
        creditLimit, existing.id],
    });
    if (!current.has_activity) addOpeningAdjustment(existing.id, accountDetails.balanceMinor, createdAt);
    db.exec({
      sql: "INSERT INTO pending_operations VALUES(?,?,?,?,?)",
      bind: [operationId, existing.id, "account.update", fingerprint, createdAt],
    });
    result = account(existing.id);
  });
  return result;
}

/**
 * Save first-run profile, account, optional starting adjustment, and retry record atomically.
 * A completed setup is returned unchanged when onboarding is submitted again.
 * @param {object} args - Validated onboarding fields and stable setup operation ID.
 */
async function complete(args) {
  const name = args.name?.trim(),
    accountName = args.account?.trim() || "Cash",
    currency = args.currency || "PHP";
  if (!name) throw Error("Enter your preferred name.");
  if (!rows("SELECT code FROM currencies WHERE code=?", [currency]).length)
    throw Error("Choose a supported currency.");
  if (!Number.isSafeInteger(args.amountMinor) || args.amountMinor < 0)
    throw Error("Enter a valid opening balance.");
  const fingerprint = await requestFingerprint({ name, account: accountName, currency, amountMinor: args.amountMinor });
  const operationId = args.operationId || "setup:first";
  return transaction(() => {
    const prior = priorOperation(operationId, "account.create", fingerprint);
    if (prior) return state();
    const existing = state();
    if (existing) return existing;
    const accountId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    db.exec({ sql: "INSERT INTO profiles VALUES(?,?,?)", bind: ["local", name, currency] });
    db.exec({
      sql: "INSERT INTO accounts VALUES(?,?, 'debit', ?, NULL, ?)",
      bind: [accountId, accountName, currency, createdAt],
    });
    addOpeningAdjustment(accountId, args.amountMinor, createdAt);
    db.exec({
      sql: "INSERT INTO setup VALUES(1,?,?,?)",
      bind: ["local", accountId, createdAt],
    });
    db.exec({
      sql: "INSERT INTO pending_operations VALUES(?,?,?,?,?)",
      bind: [operationId, accountId, "account.create", fingerprint, createdAt],
    });
    return state();
  });
}

/**
 * Run one queued storage command and report failures to its caller.
 * @param {object} message - Worker request with response ID, command, and optional args.
 */
async function dispatch({ id, command, args = {} }) {
  try {
    if (command === "close") {
      release?.();
      await ownership;
      self.postMessage({ id, result: null });
      return;
    }
    await open();
    let result;
    if (command === "state") result = state();
    else if (command === "accounts") result = accountList();
    else if (command === "account.create") result = await createAccount(args);
    else if (command === "account.update") result = await updateAccount(args);
    else if (command === "complete") result = await complete(args);
    else throw Error("Unknown database operation.");
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({ id, error: error.message });
  }
}

self.onmessage = ({ data }) => {
  queue = queue.then(() => dispatch(data));
};
