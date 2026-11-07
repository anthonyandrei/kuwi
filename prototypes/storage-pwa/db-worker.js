import sqlite3InitModule from './vendor/sqlite3.mjs';

// Scratch data only. Never point this pool or lock at a production ledger.
const DB_PATH = '/PROTOTYPE-wipe-me.sqlite3';
const LOCK = 'kuwi-storage-prototype-v1';
let sqlite;
let pool;
let db;
let ready;
let release;
let lockTask;
let queue = Promise.resolve();

/**
 * Execute internal SQL and return object rows, or an empty array for no matches.
 * @param {string} sql - Trusted prototype SQL; never supplied by page messages.
 * @param {Array} [bind=[]] - Positional SQLite values.
 * @param {object} [source=db] - Open database, borrowed without closing it.
 */
function rows(sql, bind = [], source = db) {
  return source.exec({ sql, bind, rowMode: 'object', returnValue: 'resultRows' });
}

/**
 * Run related writes in one immediate transaction and roll back on failure.
 * @param {Function} write - Synchronous callback; must not return a Promise or nest transactions.
 * @returns {*} The callback result after commit. Callback and SQLite errors propagate.
 */
function transaction(write) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = write();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

/** Create the scratch schema once; a failed migration leaves its old version intact. */
function migrate() {
  const version = db.selectValue('PRAGMA user_version');
  if (version === 1) return;
  if (version !== 0) throw new Error(`Unsupported scratch schema: ${version}`);
  transaction(() => {
    db.exec(`
      CREATE TABLE accounts (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL UNIQUE,
        currency TEXT NOT NULL CHECK (currency = 'PHP'),
        opening_balance_minor INTEGER NOT NULL CHECK (opening_balance_minor >= 0)
      ) STRICT;
      CREATE TABLE expenses (
        id TEXT PRIMARY KEY NOT NULL,
        account_id TEXT NOT NULL REFERENCES accounts(id),
        amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE outbox (
        operation_id TEXT PRIMARY KEY NOT NULL,
        expense_id TEXT NOT NULL UNIQUE REFERENCES expenses(id)
      ) STRICT;
      CREATE VIEW balances AS
        SELECT a.id AS account_id,
          a.opening_balance_minor - COALESCE(SUM(e.amount_minor), 0) AS balance_minor
        FROM accounts a LEFT JOIN expenses e ON e.account_id = a.id
        GROUP BY a.id;
      INSERT INTO accounts VALUES ('cash', 'Prototype Cash', 'PHP', 100000);
      PRAGMA user_version = 1;
    `);
  });
}

/**
 * Acquire exclusive ownership before opening OPFS and migrating the scratch store.
 * @returns {Promise<void>} Cached startup result; rejects unsupported APIs, competing
 * ownership, or SQLite initialization errors. Closing requires a fresh worker to reopen.
 * The lock stays held until close or worker termination, including during startup.
 */
function initialize() {
  if (ready) return ready;
  ready = new Promise((resolve, reject) => {
    if (!navigator.locks || !navigator.storage?.getDirectory) {
      reject(new Error('This browser needs Web Locks and OPFS in a secure context.'));
      return;
    }
    lockTask = navigator.locks.request(LOCK, { ifAvailable: true }, async (lock) => {
      if (!lock) {
        reject(new Error('Database busy. Close the database in the other Kuwi test tab, then reopen here.'));
        return;
      }
      try {
        sqlite = await sqlite3InitModule({ locateFile: (name) => `/vendor/${name}` });
        pool = await sqlite.installOpfsSAHPoolVfs({
          name: 'kuwi-prototype-sahpool',
          directory: '/kuwi-storage-PROTOTYPE-wipe-me',
          clearOnInit: false,
          preserveOnInitFailure: true,
          initialCapacity: 6,
        });
        db = new pool.OpfsSAHPoolDb(DB_PATH);
        db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA trusted_schema=OFF;');
        migrate();
        // Hold the Web Lock for the worker lifetime, including initialization.
        const lifetime = new Promise((done) => { release = done; });
        resolve();
        await lifetime;
      } catch (error) {
        reject(error);
      } finally {
        db?.close();
        db = undefined;
        pool?.pauseVfs();
      }
    }).catch(reject);
  });
  return ready;
}

/** Return current ledger records, derived balances, and active storage settings. */
function snapshot() {
  return {
    sqliteVersion: sqlite.version.libVersion,
    vfs: 'opfs-sahpool',
    schemaVersion: db.selectValue('PRAGMA user_version'),
    foreignKeys: db.selectValue('PRAGMA foreign_keys'),
    synchronous: db.selectValue('PRAGMA synchronous'),
    journalMode: db.selectValue('PRAGMA journal_mode'),
    accounts: rows('SELECT * FROM accounts ORDER BY id'),
    expenses: rows('SELECT * FROM expenses ORDER BY id'),
    outbox: rows('SELECT * FROM outbox ORDER BY operation_id'),
    balances: rows('SELECT * FROM balances ORDER BY account_id'),
    migrationProbeExists: Boolean(db.selectValue("SELECT 1 FROM sqlite_schema WHERE name='migration_probe'")),
  };
}

/**
 * Commit an expense and its pending operation once, returning the current snapshot.
 * @param {object} args - Scratch expense fields.
 * @param {string} args.id - Nonempty retry key; reuse with different content rejects.
 * @param {string} [args.accountId='cash'] - Must reference an existing account.
 * @param {number} [args.amountMinor=2500] - Positive safe integer in centavos.
 * @param {boolean} [args.failAfterExpense=false] - Inject an error before the outbox insert.
 * Validation, foreign-key, and injected errors propagate after rollback.
 */
function writeExpense({ id, accountId = 'cash', amountMinor = 2500, failAfterExpense = false }) {
  if (typeof id !== 'string' || !id || !Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
    throw new Error('Supply an operation ID and a positive integer amount in centavos.');
  }
  transaction(() => {
    const existing = rows('SELECT * FROM expenses WHERE id=?', [id])[0];
    if (existing) {
      if (existing.account_id !== accountId || existing.amount_minor !== amountMinor) {
        throw new Error('This operation ID already has different content.');
      }
      return;
    }
    db.exec({ sql: 'INSERT INTO expenses VALUES (?, ?, ?, ?)', bind: [id, accountId, amountMinor, new Date().toISOString()] });
    if (failAfterExpense) throw new Error('Intentional failure before the pending-sync write.');
    db.exec({ sql: 'INSERT INTO outbox VALUES (?, ?)', bind: [id, id] });
  });
  return snapshot();
}

/** Verify that failed schema and data changes roll back together. */
function migrationFailure() {
  try {
    transaction(() => {
      db.exec('CREATE TABLE migration_probe (id INTEGER PRIMARY KEY) STRICT; PRAGMA user_version=2;');
      throw new Error('Intentional migration failure.');
    });
  } catch (error) {
    if (error.message !== 'Intentional migration failure.') throw error;
  }
  return snapshot();
}

/**
 * Validate a backup in a separate file, then replace scratch records atomically.
 * @param {Uint8Array} bytes - Prototype schema-v1 SQLite file, at most 10 MiB.
 * @returns {Promise<object>} Restored snapshot. Invalid files or incompatible records
 * reject without replacing the ledger; the temporary candidate is closed and unlinked.
 * Only data is copied into our schema; candidate schema definitions are not installed.
 */
async function restore(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > 10 * 1024 * 1024) {
    throw new Error('Choose a SQLite backup smaller than 10 MiB.');
  }
  const candidatePath = '/restore-candidate.sqlite3';
  let candidate;
  try {
    await pool.importDb(candidatePath, bytes);
    candidate = new pool.OpfsSAHPoolDb(candidatePath);
    candidate.exec('PRAGMA trusted_schema=OFF; PRAGMA query_only=ON;');
    if (candidate.selectValue('PRAGMA quick_check') !== 'ok' || candidate.selectValue('PRAGMA user_version') !== 1) {
      throw new Error('This is not a supported, intact prototype backup.');
    }
    const accounts = rows('SELECT id, name, currency, opening_balance_minor FROM accounts', [], candidate);
    const expenses = rows('SELECT id, account_id, amount_minor, created_at FROM expenses', [], candidate);
    const outbox = rows('SELECT operation_id, expense_id FROM outbox', [], candidate);
    transaction(() => {
      db.exec('DELETE FROM outbox; DELETE FROM expenses; DELETE FROM accounts;');
      for (const a of accounts) db.exec({ sql: 'INSERT INTO accounts VALUES (?, ?, ?, ?)', bind: [a.id, a.name, a.currency, a.opening_balance_minor] });
      for (const e of expenses) db.exec({ sql: 'INSERT INTO expenses VALUES (?, ?, ?, ?)', bind: [e.id, e.account_id, e.amount_minor, e.created_at] });
      for (const o of outbox) db.exec({ sql: 'INSERT INTO outbox VALUES (?, ?)', bind: [o.operation_id, o.expense_id] });
      if (accounts.length !== 1 || accounts[0].id !== 'cash' || db.selectValue('SELECT COUNT(*) FROM expenses') !== db.selectValue('SELECT COUNT(*) FROM outbox')) {
        throw new Error('The backup does not contain a complete prototype ledger.');
      }
    });
    return snapshot();
  } finally {
    candidate?.close();
    pool.unlink(candidatePath);
  }
}

/**
 * Dispatch a scratch operation after startup; the message queue serializes callers.
 * @returns {Promise<*>} A snapshot, export bytes, or a phase marker for fault/close commands.
 * Unknown commands and storage errors reject. beginUncommitted intentionally leaves
 * a transaction open for termination tests; close releases ownership and ends this worker's DB use.
 * No command sends cloud requests or accepts arbitrary SQL.
 */
async function run(command, args = {}) {
  await initialize();
  switch (command) {
    case 'state': return snapshot();
    case 'expense': return writeExpense(args);
    case 'migrationFailure': return migrationFailure();
    case 'export': return pool.exportFile(DB_PATH);
    case 'restore': return restore(args.bytes);
    case 'reset':
      transaction(() => db.exec('DELETE FROM outbox; DELETE FROM expenses; UPDATE accounts SET opening_balance_minor=100000;'));
      return snapshot();
    case 'beginUncommitted':
      db.exec('BEGIN IMMEDIATE');
      db.exec({ sql: 'INSERT INTO expenses VALUES (?, ?, ?, ?)', bind: [args.id, 'cash', 2500, new Date().toISOString()] });
      return { phase: 'uncommitted', id: args.id };
    case 'close':
      release();
      await lockTask;
      return { phase: 'closed' };
    default: throw new Error(`Unknown prototype command: ${command}`);
  }
}

self.onmessage = ({ data: { id, command, args } }) => {
  queue = queue.then(async () => {
    try {
      const result = await run(command, args);
      self.postMessage({ id, result });
    } catch (error) {
      self.postMessage({ id, error: error.message });
    }
  });
};
