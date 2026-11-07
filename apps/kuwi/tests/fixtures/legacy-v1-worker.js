/* eslint-disable import/no-unresolved -- Served from the app root with its vendor module. */
import sqlite3InitModule from "./vendor/sqlite3.mjs";
let db, pool, release, ownership;
let queue = Promise.resolve();
/**
 * Execute internal SQL with positional SQLite bindings; return an empty array when no rows match.
 * @param {string} sql - Internal statement, never taken from worker messages.
 * @param {Array} [bind=[]] - Bound scalar values.
 * @returns {Array<object>} Object rows; SQLite errors propagate to the message handler.
 */
function rows(sql, bind = []) {
  return db.exec({ sql, bind, rowMode: "object", returnValue: "resultRows" });
}
/**
 * Commit related writes together; propagate callback or SQLite failures after rollback.
 * @param {Function} write - Synchronous callback; must not nest or return a promise.
 * @returns {*} Callback result after commit.
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
/** Open product storage only after acquiring ownership; never reset existing files. */
async function open() {
  if (db) return;
  if (!navigator.locks || !navigator.storage?.getDirectory)
    throw Error("Saving requires a secure browser with OPFS and Web Locks.");
  await new Promise((resolve, reject) => {
    ownership = navigator.locks
      .request(
        "kuwi-product-database-v1",
        { ifAvailable: true },
        async (lock) => {
          if (!lock) {
            reject(
              Error("Database busy. Close Kuwi in the other tab, then retry."),
            );
            return;
          }
          try {
            const sqlite = await sqlite3InitModule({
              locateFile: (name) => `/vendor/${name}`,
            });
            pool = await sqlite.installOpfsSAHPoolVfs({
              name: "kuwi-product-sahpool",
              directory: "/kuwi-product-v1",
              clearOnInit: false,
              preserveOnInitFailure: true,
              initialCapacity: 6,
            });
            db = new pool.OpfsSAHPoolDb("/kuwi.sqlite3");
            db.exec(
              "PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL; PRAGMA journal_mode=DELETE; PRAGMA trusted_schema=OFF;",
            );
            const version = db.selectValue("PRAGMA user_version");
            if (version !== 0 && version !== 1)
              throw Error(
                "Unsupported database version. Existing data has been preserved.",
              );
            if (version === 0)
              transaction(() =>
                db.exec(`
     CREATE TABLE currencies(code TEXT PRIMARY KEY NOT NULL, decimal_places INTEGER NOT NULL CHECK(decimal_places BETWEEN 0 AND 3)) STRICT;
     INSERT INTO currencies VALUES('PHP',2),('USD',2),('EUR',2),('GBP',2),('JPY',0),('TWD',2);
     CREATE TABLE profiles(id TEXT PRIMARY KEY NOT NULL, preferred_name TEXT NOT NULL CHECK(length(trim(preferred_name))>0), preferred_currency TEXT NOT NULL REFERENCES currencies(code)) STRICT;
     CREATE TABLE accounts(id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL CHECK(length(trim(name))>0), currency_code TEXT NOT NULL REFERENCES currencies(code), opening_balance_minor INTEGER NOT NULL) STRICT;
     CREATE TABLE setup(id INTEGER PRIMARY KEY CHECK(id=1), profile_id TEXT NOT NULL UNIQUE REFERENCES profiles(id), first_account_id TEXT NOT NULL UNIQUE REFERENCES accounts(id), completed_at TEXT NOT NULL) STRICT;
     PRAGMA user_version=1;
    `),
              );
            const lifetime = new Promise((done) => {
              release = done;
            });
            resolve();
            await lifetime;
          } catch (error) {
            reject(error);
          } finally {
            db?.close();
            db = undefined;
            await pool?.pauseVfs();
          }
        },
      )
      .catch(reject);
  });
}
/** Return completed setup through its explicit references, or null before setup. */
function state() {
  return (
    rows(
      `SELECT p.preferred_name, p.preferred_currency, a.id AS account_id, a.name AS account_name, a.currency_code, a.opening_balance_minor FROM setup s JOIN profiles p ON p.id=s.profile_id JOIN accounts a ON a.id=s.first_account_id WHERE s.id=1`,
    )[0] ?? null
  );
}
/**
 * Save setup exactly once. Failed related inserts roll back all setup records.
 * @param {object} args - Trimmed nonempty name, optional account name (blank uses Cash), supported currency (default PHP), and safe-integer minor units.
 * @returns {object} Committed setup, or the existing setup on a repeated completion.
 * @throws {Error} Invalid name/amount or a propagated SQLite constraint/write failure.
 */
function complete(args) {
  const name = args.name?.trim(),
    account = args.account?.trim() || "Cash";
  const currency = args.currency || "PHP";
  if (!["PHP", "USD", "EUR", "GBP", "JPY", "TWD"].includes(currency))
    throw Error("Choose a supported currency.");
  if (!name || !Number.isSafeInteger(args.amountMinor))
    throw Error("Enter a name and a valid opening balance.");
  transaction(() => {
    db.exec(
      "INSERT OR IGNORE INTO currencies VALUES('USD',2),('EUR',2),('GBP',2),('JPY',0),('TWD',2)",
    );
    if (state()) return;
    db.exec({
      sql: "INSERT INTO profiles VALUES(?,?,?)",
      bind: ["local", name, currency],
    });
    db.exec({
      sql: "INSERT INTO accounts VALUES(?,?,?,?)",
      bind: ["first", account, currency, args.amountMinor],
    });
    db.exec({
      sql: "INSERT INTO setup VALUES(1,?,?,?)",
      bind: ["local", "first", new Date().toISOString()],
    });
  });
  return state();
}
/** Serialize worker messages; return failures without opening a fallback database. */
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
    else if (command === "complete") result = complete(args);
    else throw Error("Unknown database operation.");
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({ id, error: error.message });
  }
}
self.onmessage = ({ data }) => {
  queue = queue.then(() => dispatch(data));
};
