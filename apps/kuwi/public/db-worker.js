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

/** Create the v2 schema and six supported currencies for an empty installation. */
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

/** Add ordinary expenses and their pending sync records to the account schema. */
function migrateExpenses() {
  transaction(() => {
    db.exec(`
      CREATE TABLE categories(
        id TEXT PRIMARY KEY NOT NULL,
        label TEXT NOT NULL,
        sort_order INTEGER NOT NULL UNIQUE CHECK(sort_order>=0)
      ) STRICT;
      INSERT INTO categories VALUES
        ('food','Food',0),('transport','Transport',1),('phone','Phone',2),
        ('bills','Bills',3),('shopping','Shopping',4),('entertainment','Fun',5),
        ('health','Health',6),('fees','Fees',7),('other','Other',8);
      CREATE TABLE expenses(
        id TEXT PRIMARY KEY NOT NULL,
        account_id TEXT NOT NULL REFERENCES accounts(id),
        category_id TEXT NOT NULL REFERENCES categories(id),
        amount_minor INTEGER NOT NULL CHECK(amount_minor>0),
        date TEXT NOT NULL CHECK(length(date)=10),
        note TEXT,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX expenses_by_account_date
        ON expenses(account_id, date DESC, created_at DESC);
      CREATE TABLE pending_sync_operations(
        operation_id TEXT PRIMARY KEY NOT NULL REFERENCES expenses(id)
      ) STRICT;
      PRAGMA user_version=3;
    `);
  });
}

/**
 * Migrate v3 to v4 in one transaction, adding canonical income categories,
 * income records, and pending sync markers without changing existing rows.
 * @returns {void} The database is left at v4 after commit.
 * @throws {Error} SQLite failures roll back the migration and retain v3 data.
 */
function migrateIncomes() {
  transaction(() => {
    db.exec(`
      CREATE TABLE income_categories(
        id TEXT PRIMARY KEY NOT NULL,
        label TEXT NOT NULL,
        sort_order INTEGER NOT NULL UNIQUE CHECK(sort_order>=0)
      ) STRICT;
      INSERT INTO income_categories VALUES
        ('salary','Salary',0),('bonus','Bonus',1),('freelance','Freelance',2),
        ('commission','Commission',3),('business','Business',4),
        ('side-hustle','Side Hustle',5),('allowance','Allowance',6),
        ('gift','Gift',7),('refund','Refund',8),('cashback','Cashback',9),
        ('interest','Interest',10),('dividend','Dividend',11),
        ('rental','Rental',12),('other','Other',13);
      CREATE TABLE incomes(
        id TEXT PRIMARY KEY NOT NULL,
        account_id TEXT NOT NULL REFERENCES accounts(id),
        category_id TEXT REFERENCES income_categories(id),
        amount_minor INTEGER NOT NULL CHECK(amount_minor>=0),
        date TEXT NOT NULL CHECK(length(date)=10),
        note TEXT,
        planned INTEGER NOT NULL CHECK(planned IN (0,1)),
        created_at TEXT NOT NULL,
        CHECK(amount_minor>0 OR planned=1)
      ) STRICT;
      CREATE INDEX incomes_by_account_date
        ON incomes(account_id, date DESC, created_at DESC);
      CREATE TABLE pending_income_sync_operations(
        operation_id TEXT PRIMARY KEY NOT NULL REFERENCES incomes(id)
      ) STRICT;
      PRAGMA user_version=4;
    `);
  });
}

/**
 * Own the OPFS database lock for the connection lifetime and initialize SQLite.
 * Fresh stores are upgraded through v4; stored v1, v2, and v3 databases run each
 * required migration before a command can read or write data. A failed step
 * leaves that step's starting schema and records available for a later retry.
 * @throws {Error} OPFS or Web Locks is unavailable, another tab owns the database,
 *   the database version is unsupported, or initialization fails.
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
          if (version === 0) {
            transaction(createSchema);
            migrateExpenses();
            migrateIncomes();
          } else if (version === 1) {
            migrateV1();
            migrateExpenses();
            migrateIncomes();
          } else if (version === 2) {
            migrateExpenses();
            migrateIncomes();
          } else if (version === 3) migrateIncomes();
          else if (version !== 4)
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
 * Read one account with its balance derived from adjustments, expenses, and posted income.
 * Expenses reduce Debit/Assets balances and increase Credit debt; income applies the reverse.
 * `has_activity` is true when the account has an adjustment, expense, or income.
 * @param {string} accountId - Account primary key.
 * @returns {object|null} Account details with currency precision and balance, or null when missing.
 */
function account(accountId) {
  return rows(
    `SELECT a.id, a.name, a.type, a.currency_code, a.credit_limit_minor, c.decimal_places,
      (SELECT COALESCE(SUM(j.amount_minor),0) FROM account_adjustments j WHERE j.account_id=a.id)
      + CASE WHEN a.type='credit'
          THEN (SELECT COALESCE(SUM(e.amount_minor),0) FROM expenses e WHERE e.account_id=a.id AND e.date<=?)
             - (SELECT COALESCE(SUM(i.amount_minor),0) FROM incomes i WHERE i.account_id=a.id AND i.date<=? AND i.planned=0)
          ELSE -(SELECT COALESCE(SUM(e.amount_minor),0) FROM expenses e WHERE e.account_id=a.id AND e.date<=?)
             + (SELECT COALESCE(SUM(i.amount_minor),0) FROM incomes i WHERE i.account_id=a.id AND i.date<=? AND i.planned=0)
        END AS balance_minor,
      (EXISTS(SELECT 1 FROM account_adjustments linked WHERE linked.account_id=a.id)
        OR EXISTS(SELECT 1 FROM expenses linked WHERE linked.account_id=a.id)
        OR EXISTS(SELECT 1 FROM incomes linked WHERE linked.account_id=a.id)) AS has_activity
     FROM accounts a JOIN currencies c ON c.code=a.currency_code WHERE a.id=?`,
    [localDate(), localDate(), localDate(), localDate(), accountId],
  )[0] ?? null;
}

/**
 * List accounts in creation order with balances derived from adjustments, expenses, and posted income.
 * @returns {Array<object>} Saved account details, currency precision, and derived balances.
 */
function accountList() {
  return rows(
    `SELECT a.id, a.name, a.type, a.currency_code, a.credit_limit_minor, c.decimal_places,
      (SELECT COALESCE(SUM(j.amount_minor),0) FROM account_adjustments j WHERE j.account_id=a.id)
      + CASE WHEN a.type='credit'
          THEN (SELECT COALESCE(SUM(e.amount_minor),0) FROM expenses e WHERE e.account_id=a.id AND e.date<=?)
             - (SELECT COALESCE(SUM(i.amount_minor),0) FROM incomes i WHERE i.account_id=a.id AND i.date<=? AND i.planned=0)
          ELSE -(SELECT COALESCE(SUM(e.amount_minor),0) FROM expenses e WHERE e.account_id=a.id AND e.date<=?)
             + (SELECT COALESCE(SUM(i.amount_minor),0) FROM incomes i WHERE i.account_id=a.id AND i.date<=? AND i.planned=0)
        END AS balance_minor,
      (EXISTS(SELECT 1 FROM account_adjustments linked WHERE linked.account_id=a.id)
        OR EXISTS(SELECT 1 FROM expenses linked WHERE linked.account_id=a.id)
        OR EXISTS(SELECT 1 FROM incomes linked WHERE linked.account_id=a.id)) AS has_activity
     FROM accounts a JOIN currencies c ON c.code=a.currency_code
     ORDER BY a.created_at, a.id`,
    [localDate(), localDate(), localDate(), localDate()],
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

const backupFormat = "kuwi.backup";
const backupVersion = 1;
const backupSchemaVersion = 4;
const legacyBackupSchemaVersion = 3;
const backupCurrencies = { EUR: 2, GBP: 2, JPY: 0, PHP: 2, TWD: 2, USD: 2 };
const backupCategories = [
  ["food", "Food", 0],
  ["transport", "Transport", 1],
  ["phone", "Phone", 2],
  ["bills", "Bills", 3],
  ["shopping", "Shopping", 4],
  ["entertainment", "Fun", 5],
  ["health", "Health", 6],
  ["fees", "Fees", 7],
  ["other", "Other", 8],
];
const backupIncomeCategories = [
  ["salary", "Salary", 0],
  ["bonus", "Bonus", 1],
  ["freelance", "Freelance", 2],
  ["commission", "Commission", 3],
  ["business", "Business", 4],
  ["side-hustle", "Side Hustle", 5],
  ["allowance", "Allowance", 6],
  ["gift", "Gift", 7],
  ["refund", "Refund", 8],
  ["cashback", "Cashback", 9],
  ["interest", "Interest", 10],
  ["dividend", "Dividend", 11],
  ["rental", "Rental", 12],
  ["other", "Other", 13],
];

/** Serialize JSON data with keys sorted recursively and array order retained.
 * @param {*} value - JSON-compatible value to serialize.
 * @returns {string} Canonical JSON text.
 */
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

/** Hash a backup's format, version, schema version, and data with SHA-256.
 * @param {object} body - The exact contract fields covered by the digest.
 * @returns {Promise<string>} Lowercase hexadecimal SHA-256 digest.
 */
async function backupDigest(body) {
  const bytes = new TextEncoder().encode(canonicalJson(body));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Snapshot every v4 source relation in deterministic order and attach its integrity digest.
 * @returns {Promise<object>} A complete v1/v4 Kuwi backup envelope.
 * @throws {Error} SQLite reads or Web Crypto digest generation fail.
 */
async function createBackup() {
  const data = {
    currencies: rows("SELECT code, decimal_places FROM currencies ORDER BY code"),
    profiles: rows("SELECT id, preferred_name, preferred_currency FROM profiles ORDER BY id"),
    accounts: rows("SELECT id, name, type, currency_code, credit_limit_minor, created_at FROM accounts ORDER BY id"),
    accountAdjustments: rows("SELECT id, account_id, amount_minor, adjustment_type, created_at FROM account_adjustments ORDER BY id"),
    setup: rows("SELECT id, profile_id, first_account_id, completed_at FROM setup ORDER BY id"),
    pendingOperations: rows("SELECT id, account_id, operation_type, request_fingerprint, created_at FROM pending_operations ORDER BY id"),
    categories: rows("SELECT id, label, sort_order FROM categories ORDER BY sort_order, id"),
    expenses: rows("SELECT id, account_id, category_id, amount_minor, date, note, created_at FROM expenses ORDER BY id"),
    pendingSyncOperations: rows("SELECT operation_id FROM pending_sync_operations ORDER BY operation_id"),
    incomeCategories: rows("SELECT id, label, sort_order FROM income_categories ORDER BY sort_order, id"),
    incomes: rows("SELECT id, account_id, category_id, amount_minor, date, note, planned, created_at FROM incomes ORDER BY id"),
    pendingIncomeSyncOperations: rows("SELECT operation_id FROM pending_income_sync_operations ORDER BY operation_id"),
  };
  const body = { format: backupFormat, version: backupVersion, schemaVersion: backupSchemaVersion, data };
  return {
    ...body,
    exportedAt: new Date().toISOString(),
    integrity: { algorithm: "SHA-256", digest: await backupDigest(body) },
  };
}

/** Reject values that cannot be stored as a nonempty SQLite text key or fact.
 * @param {*} value - Candidate text value.
 * @param {string} description - Relation and column used in the failure message.
 * @returns {void} Resolves when the value is nonempty text.
 * @throws {Error} The value is not nonempty text.
 */
function requireText(value, description) {
  if (typeof value !== "string" || !value.trim())
    throw Error(`Backup data constraints failed: ${description} must be nonempty text.`);
}

/** Ensure a relation contains only rows with the backup contract's exact columns.
 * @param {object} data - Candidate backup data object.
 * @param {string} relation - Relation key in the backup.
 * @param {string[]} fields - Required row property names.
 * @returns {object[]} Validated relation rows.
 * @throws {Error} The relation is absent or one row has missing or extra fields.
 */
function requireRows(data, relation, fields) {
  const relationRows = data[relation];
  if (!Array.isArray(relationRows))
    throw Error(`Backup data constraints failed: ${relation} must be an array.`);
  for (const row of relationRows) {
    if (!row || typeof row !== "object" || Array.isArray(row) ||
      Object.keys(row).sort().join("\0") !== [...fields].sort().join("\0"))
      throw Error(`Backup data constraints failed: ${relation} has an invalid row shape.`);
  }
  return relationRows;
}

/** Check for nonempty, unique values in one relation's primary key.
 * @param {object[]} rowsToCheck - Candidate rows in one relation.
 * @param {string} key - Primary key column name.
 * @param {string} relation - Relation name used in errors.
 * @returns {Set<string>} The relation's validated key values.
 * @throws {Error} A key is empty or duplicated.
 */
function requireUnique(rowsToCheck, key, relation) {
  const seen = new Set();
  for (const row of rowsToCheck) {
    requireText(row[key], `${relation}.${key}`);
    if (seen.has(row[key]))
      throw Error(`Backup data constraints failed: ${relation} contains duplicate ${key} values.`);
    seen.add(row[key]);
  }
  return seen;
}

/** Check an integer's safe range and optional lower bound before insertion.
 * @param {*} value - Candidate SQLite integer.
 * @param {string} description - Relation and column used in the failure message.
 * @param {{nullable?: boolean, minimum?: number}} [options] - Nullability and inclusive minimum.
 * @returns {void} Resolves when the value meets the requested range.
 * @throws {Error} The value is not a safe integer or falls below the minimum.
 */
function requireInteger(value, description, { nullable = false, minimum = Number.MIN_SAFE_INTEGER } = {}) {
  if (nullable && value === null) return;
  if (!Number.isSafeInteger(value) || value < minimum)
    throw Error(`Backup data constraints failed: ${description} is invalid.`);
}

/** Require a nonempty timestamp string while preserving SQLite's accepted text formats.
 * @param {*} value - Candidate timestamp column value.
 * @param {string} description - Relation and column used in the failure message.
 * @returns {void} Resolves when the value is nonempty text.
 * @throws {Error} The value is missing or not text.
 */
function requireTimestamp(value, description) {
  requireText(value, description);
}

/** Validate the v1 envelope, supported definitions, row constraints, and references without changing live tables.
 * Expense dates must be valid calendar dates no later than the browser's local date.
 * @param {unknown} backup - Parsed candidate file contents.
 * @returns {Promise<object>} The candidate's validated v4 relation rows.
 * @throws {Error} The format, version, integrity digest, schema, constraints, or references fail.
 */
async function validateBackup(backup) {
  if (!backup || typeof backup !== "object" || Array.isArray(backup) || backup.format !== backupFormat)
    throw Error("This file is not a Kuwi backup.");
  if (backup.version !== backupVersion ||
    ![legacyBackupSchemaVersion, backupSchemaVersion].includes(backup.schemaVersion))
    throw Error("This Kuwi backup uses an unsupported version.");
  const expectedEnvelopeKeys = ["data", "exportedAt", "format", "integrity", "schemaVersion", "version"];
  if (Object.keys(backup).sort().join("\0") !== expectedEnvelopeKeys.sort().join("\0"))
    throw Error("Backup data constraints failed: the envelope has unsupported fields.");
  if (!backup.integrity || backup.integrity.algorithm !== "SHA-256" ||
    !/^[a-f0-9]{64}$/.test(backup.integrity.digest || ""))
    throw Error("Backup integrity information is missing or unsupported.");
  if (Object.keys(backup.integrity).sort().join("\0") !== ["algorithm", "digest"].join("\0"))
    throw Error("Backup data constraints failed: integrity fields are unsupported.");
  const body = {
    format: backup.format,
    version: backup.version,
    schemaVersion: backup.schemaVersion,
    data: backup.data,
  };
  if (await backupDigest(body) !== backup.integrity.digest)
    throw Error("Backup integrity check failed. The file may be damaged or changed.");
  if (typeof backup.exportedAt !== "string" || !Number.isFinite(Date.parse(backup.exportedAt)) ||
    new Date(backup.exportedAt).toISOString() !== backup.exportedAt)
    throw Error("Backup data constraints failed: exportedAt is invalid.");

  const data = backup.data;
  const legacy = backup.schemaVersion === legacyBackupSchemaVersion;
  const legacyRelations = ["accountAdjustments", "accounts", "categories", "currencies", "expenses", "pendingOperations", "pendingSyncOperations", "profiles", "setup"];
  const currentRelations = [...legacyRelations, "incomeCategories", "incomes", "pendingIncomeSyncOperations"];
  if (!data || typeof data !== "object" || Array.isArray(data) ||
    Object.keys(data).sort().join("\0") !== [...(legacy ? legacyRelations : currentRelations)].sort().join("\0"))
    throw Error("Backup data constraints failed: the data set is incomplete or unsupported.");
  const currencies = requireRows(data, "currencies", ["code", "decimal_places"]);
  const profiles = requireRows(data, "profiles", ["id", "preferred_name", "preferred_currency"]);
  const accounts = requireRows(data, "accounts", ["id", "name", "type", "currency_code", "credit_limit_minor", "created_at"]);
  const adjustments = requireRows(data, "accountAdjustments", ["id", "account_id", "amount_minor", "adjustment_type", "created_at"]);
  const setupRows = requireRows(data, "setup", ["id", "profile_id", "first_account_id", "completed_at"]);
  const operations = requireRows(data, "pendingOperations", ["id", "account_id", "operation_type", "request_fingerprint", "created_at"]);
  const categories = requireRows(data, "categories", ["id", "label", "sort_order"]);
  const expenses = requireRows(data, "expenses", ["id", "account_id", "category_id", "amount_minor", "date", "note", "created_at"]);
  const pendingSync = requireRows(data, "pendingSyncOperations", ["operation_id"]);
  const incomeCategories = legacy
    ? backupIncomeCategories.map(([id, label, sort_order]) => ({ id, label, sort_order }))
    : requireRows(data, "incomeCategories", ["id", "label", "sort_order"]);
  const incomes = legacy
    ? []
    : requireRows(data, "incomes", ["id", "account_id", "category_id", "amount_minor", "date", "note", "planned", "created_at"]);
  const pendingIncomeSync = legacy
    ? []
    : requireRows(data, "pendingIncomeSyncOperations", ["operation_id"]);

  if (currencies.length !== Object.keys(backupCurrencies).length ||
    currencies.some(({ code, decimal_places }) => backupCurrencies[code] !== decimal_places))
    throw Error("Backup data constraints failed: the currency definitions are unsupported.");
  if (categories.length !== backupCategories.length || categories.some((category, index) =>
    category.id !== backupCategories[index][0] || category.label !== backupCategories[index][1] || category.sort_order !== backupCategories[index][2]))
    throw Error("Backup data constraints failed: the category definitions are unsupported.");
  if (incomeCategories.length !== backupIncomeCategories.length || incomeCategories.some((category, index) =>
    category.id !== backupIncomeCategories[index][0] || category.label !== backupIncomeCategories[index][1] || category.sort_order !== backupIncomeCategories[index][2]))
    throw Error("Backup data constraints failed: the income category definitions are unsupported.");

  requireUnique(currencies, "code", "currencies");
  const currencyCodes = new Set(currencies.map(({ code }) => code));
  const profileIds = requireUnique(profiles, "id", "profiles");
  const accountIds = requireUnique(accounts, "id", "accounts");
  requireUnique(adjustments, "id", "accountAdjustments");
  requireUnique(operations, "id", "pendingOperations");
  const categoryIds = requireUnique(categories, "id", "categories");
  const expenseIds = requireUnique(expenses, "id", "expenses");
  const pendingIds = requireUnique(pendingSync, "operation_id", "pendingSyncOperations");
  const incomeCategoryIds = requireUnique(incomeCategories, "id", "incomeCategories");
  const incomeIds = requireUnique(incomes, "id", "incomes");
  const pendingIncomeIds = requireUnique(pendingIncomeSync, "operation_id", "pendingIncomeSyncOperations");

  if (profiles.length > 1 || (profiles.length === 1) !== (setupRows.length === 1) ||
    (setupRows.length === 1) !== (accounts.length > 0))
    throw Error("Backup data constraints failed: setup, profile, and accounts are inconsistent.");
  for (const profile of profiles) {
    requireText(profile.preferred_name, "profiles.preferred_name");
    if (!currencyCodes.has(profile.preferred_currency))
      throw Error("Backup reference check failed: profile currency is missing.");
  }
  for (const accountRow of accounts) {
    requireText(accountRow.name, "accounts.name");
    if (!currencyCodes.has(accountRow.currency_code))
      throw Error("Backup reference check failed: account currency is missing.");
    if (!["debit", "assets", "credit"].includes(accountRow.type))
      throw Error("Backup data constraints failed: account type is unsupported.");
    const credit = accountRow.type === "credit";
    if (credit !== (accountRow.credit_limit_minor !== null))
      throw Error("Backup data constraints failed: credit limit does not match account type.");
    requireInteger(accountRow.credit_limit_minor, "accounts.credit_limit_minor", { nullable: !credit, minimum: 0 });
    requireTimestamp(accountRow.created_at, "accounts.created_at");
  }
  for (const adjustment of adjustments) {
    if (!accountIds.has(adjustment.account_id))
      throw Error("Backup reference check failed: an account adjustment refers to a missing account.");
    requireInteger(adjustment.amount_minor, "accountAdjustments.amount_minor");
    if (adjustment.amount_minor === 0 || adjustment.adjustment_type !== "initial")
      throw Error("Backup data constraints failed: account adjustment is invalid.");
    requireTimestamp(adjustment.created_at, "accountAdjustments.created_at");
  }
  for (const setupRow of setupRows) {
    if (setupRow.id !== 1 || !profileIds.has(setupRow.profile_id) || !accountIds.has(setupRow.first_account_id))
      throw Error("Backup reference check failed: setup points to missing or unsupported records.");
    requireTimestamp(setupRow.completed_at, "setup.completed_at");
  }
  for (const operation of operations) {
    if (!accountIds.has(operation.account_id))
      throw Error("Backup reference check failed: a pending account operation refers to a missing account.");
    if (!["account.create", "account.update"].includes(operation.operation_type) ||
      !/^[a-f0-9]{64}$/.test(operation.request_fingerprint))
      throw Error("Backup data constraints failed: a pending account operation is invalid.");
    requireTimestamp(operation.created_at, "pendingOperations.created_at");
  }
  for (const expense of expenses) {
    if (!accountIds.has(expense.account_id) || !categoryIds.has(expense.category_id))
      throw Error("Backup reference check failed: an expense refers to a missing account or category.");
    requireInteger(expense.amount_minor, "expenses.amount_minor", { minimum: 1 });
    if (!isValidDate(expense.date) || expense.date > localDate())
      throw Error("Backup data constraints failed: an expense date is invalid.");
    if (expense.note !== null && typeof expense.note !== "string")
      throw Error("Backup data constraints failed: an expense note is invalid.");
    requireTimestamp(expense.created_at, "expenses.created_at");
  }
  if (pendingIds.size !== expenseIds.size || [...pendingIds].some((id) => !expenseIds.has(id)))
    throw Error("Backup reference check failed: an expense is missing its pending sync operation.");

  for (const income of incomes) {
    const selectedAccount = accounts.find(({ id }) => id === income.account_id);
    if (!selectedAccount || (income.category_id !== null && !incomeCategoryIds.has(income.category_id)))
      throw Error("Backup reference check failed: an income refers to a missing account or category.");
    if (!["debit", "credit"].includes(selectedAccount.type))
      throw Error("Backup data constraints failed: income account type is unsupported.");
    requireInteger(income.amount_minor, "incomes.amount_minor", { minimum: 0 });
    if (!isValidDate(income.date) || (income.amount_minor === 0 && income.planned !== 1) ||
      ![0, 1].includes(income.planned) || (income.date > localDate() && income.planned !== 1))
      throw Error("Backup data constraints failed: an income amount, date, or planned flag is invalid.");
    if (income.note !== null && typeof income.note !== "string")
      throw Error("Backup data constraints failed: an income note is invalid.");
    requireTimestamp(income.created_at, "incomes.created_at");
  }
  if (pendingIncomeIds.size !== incomeIds.size || [...pendingIncomeIds].some((id) => !incomeIds.has(id)))
    throw Error("Backup reference check failed: an income is missing its pending sync operation.");

  return {
    ...data,
    incomeCategories,
    incomes,
    pendingIncomeSyncOperations: pendingIncomeSync,
  };
}

/** Replace v4 records atomically; callers must validate the candidate before calling.
 * @param {object} data - Complete v4 relations returned by `validateBackup`.
 * @returns {void} Resolves after SQLite commits the replacement.
 * @throws {Error} SQLite rejects a delete, insert, constraint, or commit.
 */
function replaceBackupData(data) {
  transaction(() => {
    db.exec(`
      DELETE FROM pending_income_sync_operations;
      DELETE FROM incomes;
      DELETE FROM pending_sync_operations;
      DELETE FROM expenses;
      DELETE FROM pending_operations;
      DELETE FROM account_adjustments;
      DELETE FROM setup;
      DELETE FROM accounts;
      DELETE FROM profiles;
      DELETE FROM income_categories;
      DELETE FROM categories;
      DELETE FROM currencies;
    `);
    /** Insert already-validated rows using fixed table and column names. */
    const insertRows = (table, columns, values) => {
      for (const row of values) {
        db.exec({
          sql: `INSERT INTO ${table}(${columns.join(",")}) VALUES(${columns.map(() => "?").join(",")})`,
          bind: columns.map((column) => row[column]),
        });
      }
    };
    insertRows("currencies", ["code", "decimal_places"], data.currencies);
    insertRows("profiles", ["id", "preferred_name", "preferred_currency"], data.profiles);
    insertRows("categories", ["id", "label", "sort_order"], data.categories);
    insertRows("income_categories", ["id", "label", "sort_order"], data.incomeCategories);
    insertRows("accounts", ["id", "name", "type", "currency_code", "credit_limit_minor", "created_at"], data.accounts);
    insertRows("account_adjustments", ["id", "account_id", "amount_minor", "adjustment_type", "created_at"], data.accountAdjustments);
    insertRows("setup", ["id", "profile_id", "first_account_id", "completed_at"], data.setup);
    insertRows("pending_operations", ["id", "account_id", "operation_type", "request_fingerprint", "created_at"], data.pendingOperations);
    insertRows("expenses", ["id", "account_id", "category_id", "amount_minor", "date", "note", "created_at"], data.expenses);
    insertRows("pending_sync_operations", ["operation_id"], data.pendingSyncOperations);
    insertRows("incomes", ["id", "account_id", "category_id", "amount_minor", "date", "note", "planned", "created_at"], data.incomes);
    insertRows("pending_income_sync_operations", ["operation_id"], data.pendingIncomeSyncOperations);
  });
}

/** Validate a complete backup, atomically replace the store, and return its setup.
 * @param {unknown} backup - Parsed candidate file contents.
 * @returns {Promise<object|null>} Restored setup and derived accounts, or null for an empty backup.
 * @throws {Error} Validation or replacement fails; a failed write rolls back the old store.
 */
async function restoreBackup(backup) {
  const data = await validateBackup(backup);
  replaceBackupData(data);
  return state();
}

/**
 * Return one account, canonical categories, and its combined transaction history.
 * @param {string} [accountId] - Account ID; omitted to use the setup account.
 * @returns {object|null} The account ledger, or null when the requested account is unavailable.
 */
function readLedger(accountId) {
  const firstAccountId = rows("SELECT first_account_id FROM setup WHERE id=1")[0]?.first_account_id;
  const selectedAccount = account(accountId || firstAccountId);
  if (!selectedAccount) return null;
  return {
    account: selectedAccount,
    expense_categories: rows("SELECT id, label FROM categories ORDER BY sort_order"),
    income_categories: rows("SELECT id, label FROM income_categories ORDER BY sort_order"),
    transactions: rows(
      `SELECT 'expense' AS kind, e.id, e.account_id, e.category_id,
        c.label AS category_label, e.amount_minor, e.date, e.note, e.created_at,
        0 AS planned
       FROM expenses e JOIN categories c ON c.id=e.category_id
       JOIN pending_sync_operations p ON p.operation_id=e.id
       WHERE e.account_id=?
      UNION ALL
       SELECT 'income' AS kind, i.id, i.account_id, i.category_id,
        c.label AS category_label, i.amount_minor, i.date, i.note, i.created_at,
        i.planned
       FROM incomes i LEFT JOIN income_categories c ON c.id=i.category_id
       JOIN pending_income_sync_operations p ON p.operation_id=i.id
       WHERE i.account_id=?
       ORDER BY 7 DESC, 9 DESC, 2 DESC`,
      [selectedAccount.id, selectedAccount.id],
    ),
  };
}

/**
 * Format today's browser-local calendar date for date-only financial entries.
 * @returns {string} The local date as YYYY-MM-DD.
 */
function localDate() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/**
 * Check a date-only value without relying on local-time parsing.
 * @param {unknown} value - Candidate YYYY-MM-DD date.
 * @returns {boolean} Whether the value is a real calendar date in that format.
 */
function isValidDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value;
}

/**
 * Save one current or past expense and its pending sync marker atomically.
 * The operation ID is also the expense ID. Identical retries return the saved
 * ledger; reuse with different account, category, amount, date, or note fails.
 * @param {object} args - Expense operation ID, account/category IDs, positive minor units, date, and optional note.
 * @returns {{ledger: object, replayed: boolean}} The refreshed account ledger and whether this was a retry.
 * @throws {Error} Invalid fields, unavailable references, a conflicting retry, or a failed database write.
 */
function createExpense(args) {
  const operationId = args.operationId?.trim();
  const accountId = args.accountId;
  const categoryId = args.categoryId || "other";
  const amountMinor = args.amountMinor;
  const date = args.date;
  const note = args.note?.trim() || null;
  if (!operationId || !Number.isSafeInteger(amountMinor) || amountMinor <= 0)
    throw Error("Enter an expense amount greater than zero.");
  if (!isValidDate(date)) throw Error("Choose a valid expense date.");
  if (date > localDate()) throw Error("Choose today or an earlier date.");
  const selectedAccount = account(accountId);
  if (!selectedAccount) throw Error("Choose an available account.");
  if (!rows("SELECT id FROM categories WHERE id=?", [categoryId])[0])
    throw Error("Choose a valid expense category.");

  let replayed = false;
  transaction(() => {
    const existing = rows(
      `SELECT e.account_id, e.category_id, e.amount_minor, e.date, e.note
       FROM expenses e JOIN pending_sync_operations p ON p.operation_id=e.id
       WHERE p.operation_id=?`,
      [operationId],
    )[0];
    if (existing) {
      if (
        existing.account_id !== accountId ||
        existing.category_id !== categoryId ||
        existing.amount_minor !== amountMinor ||
        existing.date !== date ||
        existing.note !== note
      )
        throw Error("This save retry contains different expense details.");
      replayed = true;
      return;
    }
    const createdAt = new Date().toISOString();
    db.exec({
      sql: "INSERT INTO expenses(id, account_id, category_id, amount_minor, date, note, created_at) VALUES(?,?,?,?,?,?,?)",
      bind: [operationId, accountId, categoryId, amountMinor, date, note, createdAt],
    });
    db.exec({
      sql: "INSERT INTO pending_sync_operations(operation_id) VALUES(?)",
      bind: [operationId],
    });
  });
  return { ledger: readLedger(accountId), replayed };
}

/**
 * Save one ordinary income and its pending sync marker atomically.
 * The operation ID is also the income ID. Future dates are planned and do not
 * affect the balance; only those entries may have a zero amount. Identical
 * retries return the saved ledger, while changed content under the same ID fails.
 * @param {object} args - Operation ID, Debit/Credit account ID, optional category ID,
 *   nonnegative account-currency minor units, valid date, and optional note.
 * @returns {{ledger: object, replayed: boolean}} The refreshed ledger and whether this was a retry.
 * @throws {Error} Invalid fields, unavailable references, a conflicting retry, or a failed database write.
 */
function createIncome(args) {
  const operationId = typeof args.operationId === "string" ? args.operationId.trim() : "";
  const accountId = args.accountId;
  const categoryId = typeof args.categoryId === "string"
    ? args.categoryId.trim() || null
    : args.categoryId == null ? null : "";
  const amountMinor = args.amountMinor;
  const date = args.date;
  const note = typeof args.note === "string" ? args.note.trim() || null : null;
  if (!operationId || !Number.isSafeInteger(amountMinor) || amountMinor < 0)
    throw Error("Enter a valid income amount.");
  if (!isValidDate(date)) throw Error("Choose a valid income date.");
  const planned = date > localDate();
  if (amountMinor === 0 && !planned)
    throw Error("Enter an income amount greater than zero.");
  if (args.categoryId != null && typeof args.categoryId !== "string")
    throw Error("Choose a valid income category.");
  if (args.note != null && typeof args.note !== "string")
    throw Error("Enter a valid income note.");

  const selectedAccount = account(accountId);
  if (!selectedAccount || !["debit", "credit"].includes(selectedAccount.type))
    throw Error("Choose an available debit or credit account.");
  if (categoryId && !rows("SELECT id FROM income_categories WHERE id=?", [categoryId])[0])
    throw Error("Choose a valid income category.");

  let replayed = false;
  transaction(() => {
    const existing = rows(
      `SELECT i.account_id, i.category_id, i.amount_minor, i.date, i.note, i.planned
       FROM incomes i JOIN pending_income_sync_operations p ON p.operation_id=i.id
       WHERE p.operation_id=?`,
      [operationId],
    )[0];
    if (existing) {
      if (
        existing.account_id !== accountId ||
        existing.category_id !== categoryId ||
        existing.amount_minor !== amountMinor ||
        existing.date !== date ||
        existing.note !== note ||
        existing.planned !== Number(planned)
      )
        throw Error("This save retry contains different income details.");
      replayed = true;
      return;
    }
    const createdAt = new Date().toISOString();
    db.exec({
      sql: "INSERT INTO incomes(id, account_id, category_id, amount_minor, date, note, planned, created_at) VALUES(?,?,?,?,?,?,?,?)",
      bind: [operationId, accountId, categoryId, amountMinor, date, note, Number(planned), createdAt],
    });
    db.exec({
      sql: "INSERT INTO pending_income_sync_operations(operation_id) VALUES(?)",
      bind: [operationId],
    });
  });
  return { ledger: readLedger(accountId), replayed };
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
 * @returns {Promise<object>} The committed account with its derived balance.
 * @throws {Error} Validation fails, the operation ID conflicts, or SQLite rejects a write.
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
 * @returns {Promise<object>} The updated account with its derived balance.
 * @throws {Error} The account is missing, validation or linked-activity checks fail,
 *   the operation ID conflicts, or SQLite rejects a write.
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
 * @returns {Promise<object>} The saved setup and its accounts.
 * @throws {Error} Validation fails, the operation ID conflicts, or a related write fails.
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
 * Run one queued storage command and post its result or error to the requesting page.
 * @param {object} message - Worker request with a response ID and optional command arguments.
 * @returns {Promise<void>} Resolves after the worker posts its response.
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
    else if (command === "ledger") result = readLedger(args.accountId);
    else if (command === "account.create") result = await createAccount(args);
    else if (command === "account.update") result = await updateAccount(args);
    else if (command === "createExpense") result = createExpense(args);
    else if (command === "createIncome") result = createIncome(args);
    else if (command === "complete") result = await complete(args);
    else if (command === "exportBackup") result = await createBackup();
    else if (command === "restoreBackup") result = await restoreBackup(args.backup);
    else throw Error("Unknown database operation.");
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({ id, error: error.message });
  }
}

self.onmessage = ({ data }) => {
  queue = queue.then(() => dispatch(data));
};
