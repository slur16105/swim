import { inspectSnapshot, STORAGE_KEY, validateRecord } from './model.js';
import { isAppearance } from './character.js';

// 읽기 어댑터: getItem만 사용하며 원문을 수정·삭제하지 않는다.
export function readSnapshot(storage) {
  let raw;
  try { raw = storage.getItem(STORAGE_KEY); }
  catch {
    return { status: 'protected', data: null, raw: null, sourceVersion: null, code: 'STORAGE_UNAVAILABLE' };
  }
  return inspectSnapshot(raw);
}

export const WRITE_LOCK = 'lane-club:write';
export const LOCK_TIMEOUT_MS = 5000;
const failure = code => ({ ok: false, code });
const copy = value => structuredClone(value);

// Sole application writer: commands commit v2 snapshots under the shared lock.
// get(): {ok, status: new|ready|protected, code?, data}; raw never leaves the Store.
// Commands/reload return Promise<{ok, code?, data?}>; data is a detached v2 payload.
// metadata.epoch defaults to the epoch at submission. Inputs are copied immediately.
// options: locks (Web Locks-compatible), eventTarget (storage/focus), epoch (default 0),
// lockTimeoutMs (test override; production default 5000), setTimeout/clearTimeout.
export function createCommandStore(storage, options = {}) {
  const locks = Object.hasOwn(options, 'locks') ? options.locks : globalThis.navigator?.locks;
  const events = Object.hasOwn(options, 'eventTarget') ? options.eventTarget : globalThis.window;
  const schedule = options.setTimeout ?? globalThis.setTimeout;
  const unschedule = options.clearTimeout ?? globalThis.clearTimeout;
  let snapshot = readSnapshot(storage);
  let protection = snapshot.code;
  let lastCode = protection;
  let epoch = options.epoch ?? 0;
  let disposed = false;
  let queue = Promise.resolve();
  const listeners = new Set();
  const get = () => {
    const code = protection ?? lastCode;
    return { ok: !code, status: protection ? 'protected' : snapshot.status,
      ...(code ? { code } : {}), data: copy(snapshot.data) };
  };
  const protect = code => { protection = code; return failure(code); };
  const cancelled = submittedEpoch => disposed || submittedEpoch !== epoch;

  // The callback is entirely synchronous. Notifications run only after lock release.
  function transaction(kind, input) {
    if (kind !== 'reload' && protection) return failure(protection);
    const current = readSnapshot(storage);
    if (current.code === 'STORAGE_UNAVAILABLE') return protect(current.code);
    if (kind !== 'reload' && current.raw !== snapshot.raw) return protect('CONFLICT');
    if (current.status === 'protected') return protect(current.code);
    if (kind === 'reload') {
      const changed = JSON.stringify(snapshot.data) !== JSON.stringify(current.data);
      snapshot = current;
      protection = undefined;
      return { ok: true, data: copy(snapshot.data), changed };
    }
    const next = copy(snapshot.data);
    if (kind === 'character') {
      if (!isAppearance(input)) return failure('INVALID');
      next.character = { cap: input.cap, goggles: input.goggles, suit: input.suit };
    } else if (kind === 'record') {
      if (!next.character || !input || typeof input.id !== 'string' || !input.id.trim()) return failure('INVALID');
      let fields;
      try { fields = validateRecord(input); } catch { return failure('INVALID'); }
      const index = next.records.findIndex(record => record.id === input.id);
      if (index < 0) next.records.push({ id: input.id, ...fields, status: 'pending' });
      else next.records[index] = { ...next.records[index], ...fields };
    } else {
      if (typeof input !== 'string' || !input.trim()) return failure('INVALID');
      const record = next.records.find(record => record.id === input);
      if (!record) return failure('NOT_FOUND');
      if (record.status === 'complete') return { ok: true, data: copy(snapshot.data) };
      record.status = 'complete';
    }
    if (!Number.isSafeInteger(next.revision + 1)) return failure('INVALID');
    next.revision++;
    const raw = JSON.stringify(next);
    const checked = inspectSnapshot(raw);
    if (checked.status === 'protected') return failure('INVALID');
    try { storage.setItem(STORAGE_KEY, raw); }
    catch (error) {
      return error?.name === 'QuotaExceededError' || error?.name === 'NS_ERROR_DOM_QUOTA_REACHED'
        ? failure('QUOTA') : protect('STORAGE_UNAVAILABLE');
    }
    snapshot = checked;
    return { ok: true, data: copy(snapshot.data), changed: true };
  }

  function withLock(submittedEpoch, work) {
    if (!locks || typeof locks.request !== 'function') return Promise.resolve(failure('UNSUPPORTED'));
    return new Promise(resolve => {
      const controller = new AbortController();
      let settled = false;
      let acquired = false;
      const finish = result => {
        if (settled) return;
        settled = true;
        unschedule(timer);
        resolve(result);
      };
      const timer = schedule(() => {
        if (acquired || settled) return;
        finish(failure(cancelled(submittedEpoch) ? 'CANCELLED' : 'BUSY'));
        controller.abort();
      }, options.lockTimeoutMs ?? LOCK_TIMEOUT_MS);
      try {
        Promise.resolve(locks.request(WRITE_LOCK, { mode: 'exclusive', signal: controller.signal }, lock => {
          if (settled) return failure('BUSY'); // Even a faulty/late adapter cannot write.
          acquired = true;
          unschedule(timer);
          if (cancelled(submittedEpoch)) return failure('CANCELLED');
          if (!lock) return failure('UNSUPPORTED');
          return work();
        })).then(finish, () => finish(failure(cancelled(submittedEpoch) ? 'CANCELLED' : 'UNSUPPORTED')));
      } catch { finish(failure(cancelled(submittedEpoch) ? 'CANCELLED' : 'UNSUPPORTED')); }
    });
  }

  function submit(kind, value, metadata) {
    const submittedEpoch = metadata?.epoch ?? epoch;
    let input, invalid = false;
    try { input = copy(value); } catch { invalid = true; }
    const execute = async () => {
      let result;
      if (cancelled(submittedEpoch)) result = failure('CANCELLED');
      else if (invalid) result = failure('INVALID');
      else result = await withLock(submittedEpoch, () => transaction(kind, input));
      if (!cancelled(submittedEpoch) && result.code !== 'CANCELLED') lastCode = result.ok ? protection : result.code;
      if (result.ok && result.changed && !cancelled(submittedEpoch)) {
        for (const listener of [...listeners]) {
          if (disposed) break;
          if (!listeners.has(listener)) continue;
          try { listener(copy(result.data)); } catch { /* Observers cannot change persistence success. */ }
        }
      }
      const { changed, ...publicResult } = result;
      return publicResult;
    };
    const pending = queue.then(execute);
    queue = pending.catch(() => {});
    return pending;
  }

  // Synchronous auxiliary comparison; never adopts external data or clears protection.
  function checkExternalChange() {
    if (disposed) return failure('CANCELLED');
    const current = readSnapshot(storage);
    if (current.code === 'STORAGE_UNAVAILABLE') protect(current.code);
    else if (current.raw !== snapshot.raw) protect('CONFLICT');
    lastCode = protection ?? lastCode;
    return get();
  }
  const onStorage = event => {
    if ((event.key === null || event.key === STORAGE_KEY)
      && (!event.storageArea || event.storageArea === storage)) checkExternalChange();
  };
  const onFocus = () => checkExternalChange();
  events?.addEventListener('storage', onStorage);
  events?.addEventListener('focus', onFocus);
  return {
    get,
    saveCharacter: (appearance, metadata) => submit('character', appearance, metadata),
    saveRecord: (input, metadata) => submit('record', input, metadata),
    completeRecord: (id, metadata) => submit('complete', id, metadata),
    reload: metadata => submit('reload', undefined, metadata),
    // Epochs increase monotonically so an old callback can never become current again.
    invalidateEpoch(nextEpoch) {
      if (!Number.isSafeInteger(nextEpoch) || nextEpoch <= epoch) return failure('INVALID');
      epoch = nextEpoch;
      return { ok: true };
    },
    checkExternalChange,
    // Listener receives a separate detached payload per successful data change.
    subscribe(listener) {
      if (!disposed && typeof listener === 'function') listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      disposed = true;
      listeners.clear();
      events?.removeEventListener('storage', onStorage);
      events?.removeEventListener('focus', onFocus);
    },
  };
}
