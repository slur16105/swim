import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateRecord, recordXP, levelInfo, summary, createStore, decode } from '../src/model.js';
const record = { id:'one', date:'2026-11-01', stroke:'자유형', distance:1000, minutes:40, status:'complete' };
test('25m segments, input boundaries and invalid dates', () => {
  assert.equal(recordXP(validateRecord(record, '2026-11-01')), 400);
  for (const input of [{distance:26}, {distance:0}, {distance:10025}, {minutes:0}, {minutes:1.5}, {date:'2026-02-30'}, {date:'2026-11-02'}, {stroke:'invalid'}]) assert.throws(() => validateRecord({...record,...input}, '2026-11-01'));
});
test('level boundaries and multiple level ups', () => {
  assert.deepEqual(levelInfo(0), {level:1,current:0,required:100,percent:0});
  assert.equal(levelInfo(100).level, 2); assert.equal(levelInfo(300).level, 3);
  assert.equal(levelInfo(400).current, 100);
});
test('pending XP, edited distances, duplicates of a swimming day', () => {
  assert.equal(summary([{...record,status:'pending'}]).xp, 0);
  assert.equal(summary([{...record,distance:500}]).xp, 200);
  const stats = summary([record, {...record,id:'two'}, {...record,id:'three',date:'2026-10-31'}], new Date('2026-11-01T12:00:00'));
  assert.equal(stats.streak, 2); assert.equal(stats.weekCount, 3);
  assert.equal(summary([record], new Date('2026-11-02T12:00:00')).streak, 1);
  assert.equal(summary([record], new Date('2026-11-03T12:00:00')).streak, 0);
  assert.equal(summary([record], new Date('2026-11-02T12:00:00')).weekCount, 0);
});
test('persistence, reload, conflicting tabs and failed write preserve memory', () => {
  let raw = null; const storage = {getItem:()=>raw,setItem:(_,v)=>{raw=v;}};
  const store = createStore(storage), stale = createStore(storage);
  store.save({...store.get(),records:[{...record,status:'pending'}]});
  assert.equal(createStore(storage).get().records[0].status, 'pending');
  assert.throws(() => stale.save(stale.get()));
  storage.setItem = () => {throw Error('quota');};
  assert.throws(() => store.save({...store.get(),cap:'pink'}));
  assert.equal(store.get().cap, 'orange');
});
test('reject damaged data without overwriting it', () => {
  assert.throws(() => decode('{broken'));
  assert.throws(() => decode(JSON.stringify({version:1,cap:'orange',records:[record,record]})));
  assert.throws(() => decode(JSON.stringify({version:2,records:[]})));
});
