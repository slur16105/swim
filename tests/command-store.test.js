import test from 'node:test';
import assert from 'node:assert/strict';
import { createCommandStore, LOCK_TIMEOUT_MS, WRITE_LOCK } from '../src/storage.js';
import { STORAGE_KEY, summary, levelInfo } from '../src/model.js';

const appearance = { cap: 'orange', goggles: 'dark', suit: 'dark' };
const pink = { cap: 'pink', goggles: 'pink', suit: 'pink' };
const record = { id: 'submission-1', date: '2026-01-01', stroke: '자유형', distance: 1000, minutes: 30 };
const payload = (records = [], revision = 3) => ({ version: 2, revision, character: appearance, records });
function storage(raw = null) {
  return { raw, writes: 0, readError: false, writeError: null,
    getItem(key) { assert.equal(key, STORAGE_KEY); if (this.readError) throw Error(); return this.raw; },
    setItem(key, value) { assert.equal(key, STORAGE_KEY); if (this.writeError) throw this.writeError; this.writes++; this.raw = value; },
  };
}
function locks() {
  let tail = Promise.resolve();
  const api = { active: false, requests: 0, request(name, options, callback) {
    assert.equal(name, WRITE_LOCK); assert.equal(options.mode, 'exclusive'); assert.ok(options.signal);
    assert.equal('steal' in options, false); api.requests++;
    const pending = tail.then(() => { api.active = true; try { return callback({ name }); } finally { api.active = false; } });
    tail = pending.catch(() => {}); return pending;
  } }; return api;
}
const storeFor = (disk, options = {}) => createCommandStore(disk, { locks: locks(), eventTarget: null, ...options });
const code = async (promise, expected) => assert.deepEqual(await promise, { ok: false, code: expected });

test('new state, copied submissions/results, validation and successful detached subscriptions', async () => {
  const disk = storage(), lock = locks(), store = storeFor(disk, { locks: lock });
  assert.equal(disk.writes, 0); assert.equal(store.get().status, 'new');
  await code(store.saveRecord(record), 'INVALID');
  await code(store.saveCharacter({ ...appearance, cap: '#fff' }), 'INVALID');
  const input = { ...appearance, records: [record], xp: 999 };
  let notices = 0;
  const observedLockStates = [];
  store.subscribe(() => observedLockStates.push(lock.active));
  store.subscribe(() => { throw Error('observer'); });
  store.subscribe(data => { notices++; data.character.cap = 'green'; });
  const pending = store.saveCharacter(input); input.cap = 'green';
  assert.equal((await pending).ok, true);
  assert.deepEqual(store.get().data.character, appearance);
  assert.equal(store.get().data.records.length, 0);
  const result = await store.saveRecord(record); result.data.records[0].distance = 25;
  assert.equal(store.get().data.records[0].distance, 1000);
  const copy = store.get(); copy.data.character.cap = 'green';
  assert.equal(store.get().data.character.cap, 'orange');
  assert.equal(notices, 2);
  assert.deepEqual(observedLockStates, [false, false]);
  await code(store.saveRecord({ ...record, distance: 3 }), 'INVALID');
  await code(store.saveRecord({ ...record, id: '' }), 'INVALID');
  await code(store.saveRecord(() => {}), 'INVALID');
  await code(store.completeRecord('missing'), 'NOT_FOUND');
  await code(store.completeRecord(null), 'INVALID');
  assert.equal(notices, 2);
});

test('record retries preserve ID/order/status/extras and completed edits derive XP', async () => {
  const stored = { ...record, status: 'complete', extra: { note: 'keep' } };
  const disk = storage(JSON.stringify(payload([stored]))), store = storeFor(disk);
  await store.saveRecord({ ...record, distance: 500, status: 'pending', extra: { note: 'overwrite' } });
  await store.saveRecord({ ...record, distance: 500 });
  assert.deepEqual(store.get().data.records, [{ ...stored, distance: 500 }]);
  assert.equal(summary(store.get().data.records).xp, 200);
  const fresh = { ...record, id: 'second', status: 'complete' };
  await store.saveRecord(fresh); await store.saveRecord(fresh);
  assert.equal(store.get().data.records.length, 2);
  assert.equal(store.get().data.records[1].status, 'pending');
});

for (const completionFirst of [true, false]) test(`queue preserves appearance and completion, completion first=${completionFirst}`, async () => {
  const disk = storage(JSON.stringify(payload([{ ...record, status: 'pending' }]))), store = storeFor(disk);
  const calls = completionFirst ? [store.completeRecord(record.id), store.saveCharacter(pink)]
    : [store.saveCharacter(pink), store.completeRecord(record.id)];
  assert.ok((await Promise.all(calls)).every(result => result.ok));
  const data = store.get().data;
  assert.deepEqual(data.character, pink); assert.equal(data.revision, 5);
  assert.equal(summary(data.records).xp, 400);
  assert.deepEqual(levelInfo(400), { level: 3, current: 100, required: 300, percent: 100 / 300 * 100 });
  let notices = 0; store.subscribe(() => notices++);
  await store.completeRecord(record.id);
  assert.equal(disk.writes, 2); assert.equal(notices, 0);
});

test('v1 first successful change migrates once; quota/generic write failures preserve memory and raw', async () => {
  const raw = JSON.stringify({ version: 1, cap: 'green', records: [{ ...record, status: 'pending', extra: [1, 2] }] });
  const disk = storage(raw), store = storeFor(disk), before = store.get().data;
  let notices = 0; store.subscribe(() => notices++);
  disk.writeError = { name: 'QuotaExceededError' };
  await code(store.saveCharacter(pink), 'QUOTA');
  assert.deepEqual(store.get().data, before); assert.equal(disk.raw, raw);
  disk.writeError = Error('blocked');
  await code(store.completeRecord(record.id), 'STORAGE_UNAVAILABLE');
  assert.deepEqual(store.get().data, before); assert.equal(notices, 0);
  disk.writeError = null;
  assert.equal(store.get().status, 'protected');
  await code(store.saveCharacter(pink), 'STORAGE_UNAVAILABLE');
  assert.equal((await store.reload()).ok, true);
  assert.equal((await store.saveCharacter(pink)).ok, true);
  assert.equal(disk.writes, 1); assert.equal(notices, 1);
  assert.equal(JSON.parse(disk.raw).revision, 1);
  assert.deepEqual(JSON.parse(disk.raw).records, before.records);
});

test('two Stores serialize read/compare/write and require explicit reload after conflict', async () => {
  const disk = storage(), lock = locks();
  const originalRead = disk.getItem.bind(disk), originalWrite = disk.setItem.bind(disk);
  const a = storeFor(disk, { locks: lock }), b = storeFor(disk, { locks: lock });
  disk.getItem = key => { assert.equal(lock.active, true); return originalRead(key); };
  disk.setItem = (key, raw) => { assert.equal(lock.active, true); originalWrite(key, raw); };
  const results = await Promise.all([a.saveCharacter(appearance), b.saveCharacter(pink)]);
  assert.equal(results[0].ok, true); assert.equal(results[1].code, 'CONFLICT');
  assert.equal(disk.writes, 1); assert.equal(b.get().data.character, null);
  await code(b.saveCharacter(pink), 'CONFLICT');
  assert.equal((await b.reload()).ok, true);
  assert.equal((await b.saveCharacter(pink)).ok, true); assert.equal(disk.writes, 2);
});

test('external events compare current raw, preserve protection and detach on dispose', async () => {
  const disk = storage(JSON.stringify(payload())), events = new EventTarget();
  const store = storeFor(disk, { eventTarget: events });
  await store.saveCharacter(pink);
  const event = new Event('storage'); Object.assign(event, { key: STORAGE_KEY, newValue: 'stale' });
  events.dispatchEvent(event); assert.equal(store.get().status, 'ready');
  disk.raw = JSON.stringify(payload([], 10)); events.dispatchEvent(new Event('focus'));
  assert.equal(store.get().code, 'CONFLICT');
  disk.raw = JSON.stringify({ ...payload([], 4), character: pink });
  assert.equal(store.checkExternalChange().code, 'CONFLICT');
  await store.reload(); assert.equal(store.get().status, 'ready');
  store.dispose(); disk.raw = 'broken'; events.dispatchEvent(new Event('focus'));
  assert.equal(store.get().status, 'ready');
  await code(store.saveCharacter(pink), 'CANCELLED');
});

test('initial corruption/read denial and failed reload protect previous confirmed data', async () => {
  for (const raw of ['', '{', '{"version":99}']) {
    const disk = storage(raw), store = storeFor(disk);
    assert.equal(store.get().status, 'protected');
    assert.equal((await store.saveCharacter(appearance)).ok, false);
    assert.equal(disk.raw, raw); assert.equal(disk.writes, 0);
  }
  const disk = storage(JSON.stringify(payload())), store = storeFor(disk), before = store.get().data;
  let notices = 0; store.subscribe(() => notices++);
  disk.readError = true;
  await code(store.saveCharacter(pink), 'STORAGE_UNAVAILABLE');
  await code(store.reload(), 'STORAGE_UNAVAILABLE');
  disk.readError = false; disk.raw = 'broken';
  await code(store.reload(), 'CORRUPT');
  assert.deepEqual(store.get().data, before); assert.equal(notices, 0);
  disk.raw = JSON.stringify(payload([], 7));
  await code(store.saveCharacter(pink), 'CORRUPT');
  assert.equal((await store.reload()).ok, true); assert.equal(notices, 1);
  assert.equal(store.get().data.revision, 7);
  const denied = storage(); denied.readError = true;
  assert.equal(storeFor(denied).get().code, 'STORAGE_UNAVAILABLE');
});

test('unsupported locks and request failures never fall back to unprotected writes', async () => {
  for (const lock of [null, {}, { request() { throw Error(); } }, { request: () => Promise.reject(Error()) }]) {
    const disk = storage(), store = storeFor(disk, { locks: lock });
    await code(store.saveCharacter(appearance), 'UNSUPPORTED'); assert.equal(disk.writes, 0);
  }
});

test('default 5000ms timeout aborts waiting; late callback cannot write and queue can retry', async () => {
  const disk = storage(); let expire, callback, signal, delay;
  const lock = { request(name, options, cb) { signal = options.signal; callback = cb; return new Promise(() => {}); } };
  const store = storeFor(disk, { locks: lock, setTimeout(fn, ms) { expire = fn; delay = ms; return 1; }, clearTimeout() {} });
  const pending = store.saveCharacter(appearance); await Promise.resolve();
  assert.equal(delay, 5000); assert.equal(LOCK_TIMEOUT_MS, 5000);
  expire(); await code(pending, 'BUSY'); assert.equal(signal.aborted, true);
  callback({}); assert.equal(disk.writes, 0);
  lock.request = locks().request;
  assert.equal((await store.saveCharacter(pink)).ok, true);
});

test('epoch cancellation before execution and after acquisition, reload captures current epoch', async () => {
  const disk = storage(), callbacks = [];
  const lock = { request(name, options, cb) { return new Promise(resolve => callbacks.push(() => resolve(cb({ name })))); } };
  const store = storeFor(disk, { locks: lock });
  const waiting = store.saveCharacter(appearance);
  await Promise.resolve();
  const queued = store.saveCharacter(pink);
  assert.deepEqual(store.invalidateEpoch(1), { ok: true });
  callbacks.shift()();
  await code(waiting, 'CANCELLED'); await code(queued, 'CANCELLED');
  await code(store.saveCharacter(pink, { epoch: 0 }), 'CANCELLED');
  assert.equal(disk.writes, 0);
  const reload = store.reload(); await Promise.resolve(); callbacks.shift()();
  assert.equal((await reload).ok, true);
  assert.equal(store.invalidateEpoch(0).code, 'INVALID');
});

test('v2 uncreated revision and safe revision ceiling are preserved', async () => {
  const disk = storage(JSON.stringify({ ...payload([], 12), character: null })), store = storeFor(disk);
  await store.saveCharacter(appearance); assert.equal(store.get().data.revision, 13);
  const full = storage(JSON.stringify(payload([], Number.MAX_SAFE_INTEGER))), saturated = storeFor(full);
  await code(saturated.saveCharacter(pink), 'INVALID'); assert.equal(full.writes, 0);
});

for (const action of ['invalidate', 'dispose']) for (const ending of ['timeout', 'reject']) {
  test(`waiting lock ${ending} after ${action} returns CANCELLED without changes`, async () => {
    const disk = storage(JSON.stringify(payload())), raw = disk.raw;
    let expire, rejectRequest, signal;
    const lock = { request(name, options) {
      signal = options.signal;
      return new Promise((resolve, reject) => { rejectRequest = reject; });
    } };
    const store = storeFor(disk, { locks: lock,
      setTimeout(callback) { expire = callback; return 1; }, clearTimeout() {} });
    const before = store.get().data;
    let notices = 0; store.subscribe(() => notices++);
    const pending = store.saveCharacter(pink); await Promise.resolve();
    if (action === 'invalidate') store.invalidateEpoch(1);
    else store.dispose();
    if (ending === 'timeout') { expire(); assert.equal(signal.aborted, true); }
    else rejectRequest(Error('lock unavailable'));
    await code(pending, 'CANCELLED');
    assert.equal(disk.raw, raw); assert.equal(disk.writes, 0);
    assert.deepEqual(store.get().data, before); assert.equal(notices, 0);
  });
}

test('epoch change after synchronous commit does not reclassify success', async () => {
  const disk = storage(); let committed, release;
  const lock = { request(name, options, callback) {
    committed = callback({ name });
    return new Promise(resolve => { release = () => resolve(committed); });
  } };
  const store = storeFor(disk, { locks: lock });
  const pending = store.saveCharacter(appearance); await Promise.resolve();
  store.invalidateEpoch(1); release();
  assert.equal((await pending).ok, true); assert.equal(disk.writes, 1);
});

for (const command of ['saveRecord', 'completeRecord']) {
  test(`first v1 ${command} migrates and changes its record in one write`, async () => {
    const original = { ...record, status: 'pending', extra: { note: ['preserved'] } };
    const other = { ...original, id: 'other', status: 'complete' };
    const disk = storage(JSON.stringify({ version: 1, cap: 'green', records: [original, other] }));
    const store = storeFor(disk);
    const result = command === 'saveRecord'
      ? await store.saveRecord({ ...record, distance: 500 }) : await store.completeRecord(record.id);
    assert.equal(result.ok, true); assert.equal(disk.writes, 1);
    const saved = JSON.parse(disk.raw);
    assert.equal(saved.version, 2); assert.equal(saved.revision, 1);
    assert.deepEqual(saved.character, { ...appearance, cap: 'green' });
    assert.deepEqual(saved.records, [
      { ...original, ...(command === 'saveRecord' ? { distance: 500 } : { status: 'complete' }) }, other,
    ]);
    assert.deepEqual(store.get().data, saved);
  });
}

for (const action of ['unsubscribe', 'dispose']) {
  test(`subscriber ${action} prevents later stale notification`, async () => {
    const disk = storage(), store = storeFor(disk), observed = [];
    let unsubscribe;
    store.subscribe(() => {
      observed.push('first');
      if (action === 'dispose') store.dispose();
      else unsubscribe();
    });
    unsubscribe = store.subscribe(() => observed.push('removed'));
    store.subscribe(() => observed.push('last'));
    assert.equal((await store.saveCharacter(appearance)).ok, true);
    assert.deepEqual(observed, action === 'dispose' ? ['first'] : ['first', 'last']);
    assert.equal(disk.writes, 1);
  });
}

test('cancelled queued work never replaces conflict or a recovered status with CANCELLED', async () => {
  const disk=storage(JSON.stringify(payload()));let release, hold=true;
  const store=storeFor(disk,{locks:{request:async(_name,_options,callback)=>{if(hold)await new Promise(resolve=>release=resolve);return callback({});}}});
  const old=store.saveCharacter(pink);await Promise.resolve();
  disk.raw=JSON.stringify(payload([],4));store.checkExternalChange();store.invalidateEpoch(1);
  const reload=store.reload();hold=false;release();
  await code(old,'CANCELLED');assert.notEqual(store.get().code,'CANCELLED');
  assert.equal((await reload).ok,true);assert.equal(store.get().ok,true);assert.equal(disk.writes,0);
});
