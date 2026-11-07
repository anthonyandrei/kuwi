let worker;
let nextId = 0;
const pending = new Map();
const status = document.querySelector('#status');
const output = document.querySelector('#state');
const log = document.querySelector('#log');

/** Append a visible result for manual checks. */
function note(message) {
  log.textContent = `${new Date().toLocaleTimeString()} ${message}\n${log.textContent}`;
}

/** Replace the visible state and return the same snapshot for the caller. */
function display(state) {
  output.textContent = JSON.stringify(state, null, 2);
  status.textContent = 'Database open';
  status.dataset.phase = 'open';
  if (state.balances) document.querySelector('#balance').textContent = `₱${(state.balances[0].balance_minor / 100).toFixed(2)}`;
  return state;
}

/** Start one worker and connect replies; callers must stop any previous worker first. */
function startWorker() {
  worker = new Worker('./db-worker.js', { type: 'module' });
  worker.onmessage = ({ data }) => {
    const request = pending.get(data.id);
    if (!request) return;
    pending.delete(data.id);
    clearTimeout(request.timer);
    if (data.error) request.reject(new Error(data.error));
    else request.resolve(data.result);
  };
  worker.onerror = (event) => {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error(event.message || 'Database worker failed.'));
    }
    pending.clear();
  };
}

/**
 * Send a scratch operation to the worker.
 * @param {string} command - A command handled by db-worker's run function.
 * @param {object} [args] - Structured-cloneable command arguments.
 * @returns {Promise<*>} The command result; rejects worker errors or a 30-second timeout.
 * A timeout does not cancel the operation. Stop and reopen before retrying a write.
 */
function call(command, args) {
  return new Promise((resolve, reject) => {
    if (!worker) return reject(new Error('Database closed. Choose Reopen database.'));
    const id = ++nextId;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('Database request timed out. Close and reopen the test.'));
    }, 30000);
    pending.set(id, { resolve, reject, timer });
    worker.postMessage({ id, command, args });
  });
}

/** End this worker, also rejecting any requests interrupted by termination. */
function stopWorker() {
  worker?.terminate();
  worker = undefined;
  for (const request of pending.values()) {
    clearTimeout(request.timer);
    request.reject(new Error('Database worker stopped.'));
  }
  pending.clear();
}

/**
 * Replace the worker and open this origin's existing scratch database.
 * @returns {Promise<object>} Current snapshot; rejects ownership or startup failures.
 * Pending requests on the previous worker are rejected by stopWorker.
 */
async function reopen() {
  stopWorker();
  startWorker();
  try {
    return display(await call('state'));
  } catch (error) {
    status.textContent = error.message;
    status.dataset.phase = 'blocked';
    throw error;
  }
}

/**
 * Log a command and display snapshot results, refreshing state after failures.
 * @returns {Promise<*>} The worker result; command errors are logged and rethrown.
 */
async function action(command, args) {
  try {
    const result = await call(command, args);
    if (result?.accounts) display(result);
    note(`${command}: completed`);
    return result;
  } catch (error) {
    note(`${command}: ${error.message}`);
    try { display(await call('state')); } catch { /* The owning tab may still hold the lock. */ }
    throw error;
  }
}

/**
 * Register the service worker and wait until it controls this page.
 * @returns {Promise<string>} Its scope once the initial asset cache is ready.
 * Registration or installation failures reject; the startup caller displays them.
 */
async function prepareOffline() {
  const registration = await navigator.serviceWorker.register('./sw.js');
  await navigator.serviceWorker.ready;
  if (!navigator.serviceWorker.controller) {
    await new Promise((resolve) => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
  }
  document.querySelector('#offline').textContent = 'Offline ready';
  return registration.scope;
}

/**
 * Display whether this origin has persistent storage.
 * @param {boolean} [request=false] - Request a grant when true; otherwise only query it.
 * @returns {Promise<boolean>} The browser's grant status, not a guarantee against data loss.
 */
async function persistence(request = false) {
  const granted = request ? await navigator.storage.persist() : await navigator.storage.persisted();
  document.querySelector('#persistence').textContent = granted ? 'Persistent storage granted' : 'Storage remains best effort';
  return granted;
}

/** Download a committed SQLite snapshot without changing the scratch records. */
async function downloadBackup() {
  const bytes = await action('export');
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.sqlite3' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'kuwi-PROTOTYPE-backup.sqlite3';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Intentional test API. This page and database are disposable, not product code.
window.storageProbe = { call, reopen, stopWorker, action };
document.querySelector('#add').onclick = () => action('expense', { id: crypto.randomUUID() }).catch(() => {});
document.querySelector('#fail').onclick = () => action('expense', { id: crypto.randomUUID(), failAfterExpense: true }).catch(() => {});
document.querySelector('#migration').onclick = () => action('migrationFailure').catch(() => {});
document.querySelector('#interrupt').onclick = async () => {
  try {
    await call('beginUncommitted', { id: crypto.randomUUID() });
    await reopen();
    note('Interrupted write: worker terminated; reopened database shows committed records only.');
  } catch (error) { note(error.message); }
};
document.querySelector('#close').onclick = async () => {
  try {
    await call('close');
    stopWorker();
    status.textContent = 'Database closed';
    status.dataset.phase = 'closed';
  } catch (error) { note(error.message); }
};
document.querySelector('#reopen').onclick = () => reopen().catch((error) => note(error.message));
document.querySelector('#reset').onclick = () => action('reset').catch(() => {});
document.querySelector('#export').onclick = () => downloadBackup().catch((error) => note(error.message));
document.querySelector('#restore').onchange = async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try { await action('restore', { bytes: new Uint8Array(await file.arrayBuffer()) }); }
  catch { /* The action already reports the error and current data. */ }
  event.target.value = '';
};
document.querySelector('#persist').onclick = () => persistence(true).catch((error) => note(error.message));

reopen().catch((error) => note(error.message));
prepareOffline().catch((error) => { document.querySelector('#offline').textContent = `Offline not ready: ${error.message}`; });
persistence().catch((error) => note(error.message));
