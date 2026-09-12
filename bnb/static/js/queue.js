/* The offline write queue.
 *
 * A rural guesthouse on intermittent mobile data must still be able to check a
 * guest in.  Writes made while offline are parked here and replayed when the
 * connection returns; each carries an idempotency key generated at the moment
 * the owner pressed save, so a replay that the server already received is
 * recognised rather than duplicated.
 *
 * Reads are served from the service worker's cache, so the whole app stays
 * legible with no signal at all.
 */

const KEY = 'perch.queue.v1';

function read() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}

function write(items) {
  try { localStorage.setItem(KEY, JSON.stringify(items)); } catch { /* private mode */ }
}

export function newKey() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `perch-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function enqueue(entry) {
  const items = read();
  items.push({ ...entry, queuedAt: new Date().toISOString() });
  write(items);
  return items.length;
}

export function pending() {
  return read();
}

/* Replay in order, stopping at the first network failure so nothing is
   reordered or skipped. A 4xx means the server understood and refused, so the
   entry is dropped rather than retried forever. */
export async function flush(send) {
  const items = read();
  const failures = [];
  for (let index = 0; index < items.length; index += 1) {
    try {
      await send(items[index]);
    } catch (error) {
      if (error && error.status >= 400 && error.status < 500) {
        failures.push({ entry: items[index], error });
        continue;
      }
      write(items.slice(index));           // keep this one and everything after
      return { flushed: index, remaining: items.length - index, failures };
    }
  }
  write([]);
  return { flushed: items.length, remaining: 0, failures };
}
