import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionController } from '../src/ui/session.js';
import { createCommandStore } from '../src/storage.js';
import { DEFAULT_APPEARANCE } from '../src/character.js';
import { summary, levelInfo } from '../src/model.js';
const record = { id:'record-1', date:'2026-01-01', stroke:'자유형', distance:1000, minutes:30 };
async function setup() {
  let raw = null, failed = false, writes = 0;
  const storage = {getItem:() => raw, setItem(value,next){ if (failed) throw Object.assign(new Error(),{name:'QuotaExceededError'}); raw = next; writes++; }};
  const store = createCommandStore(storage,{locks:{request:async (_name,_options,callback) => callback({})},eventTarget:null});
  await store.saveCharacter(DEFAULT_APPEARANCE); await store.saveRecord(record);
  let played, progress = 0, completions = [];
  const controller = createSessionController({store,play:(record,context) => {played = {record,context};},onProgress:() => progress++,onComplete:(...args) => completions.push(args)});
  return {store,controller,get played(){return played;},get progress(){return progress;},completions,set failed(value){failed=value;},get writes(){return writes;},storage};
}
test('1000m initial completion awaits persistence, excludes duplicate completion, restores 400 XP on revisit', async () => {
  const app = await setup(); const {controller} = app;
  assert.equal(controller.start({...record,status:'pending'}),true);
  const {context} = app.played; controller.progress(500,1000,context); assert.equal(app.progress,1);
  const pending = controller.complete(record.id,context);
  assert.equal(controller.busy,true); assert.equal(controller.completing,true); assert.equal(controller.start(record),false);
  await controller.complete(record.id,context); await pending;
  assert.equal(app.completions.length,1); assert.equal(controller.busy,false); assert.equal(app.writes,3);
  const restored = createCommandStore(app.storage,{eventTarget:null}).get().data;
  assert.equal(summary(restored.records).xp,400); assert.deepEqual(levelInfo(400),{level:3,current:100,required:300,percent:100/300*100});
});
test('completion failure preserves pending and retry pays once; replay never calls completion command', async () => {
  const app = await setup(); const {controller} = app;
  app.failed = true; controller.start({...record,status:'pending'}); await controller.complete(record.id,app.played.context);
  assert.equal(app.completions[0][0].code,'QUOTA'); assert.equal(summary(app.store.get().data.records).xp,0);
  app.failed = false; controller.start({...record,status:'pending'}); await controller.complete(record.id,app.played.context);
  const writes = app.writes;
  controller.start({...record,status:'complete'}); await controller.complete(record.id,app.played.context);
  assert.equal(app.writes,writes); assert.equal(summary(app.store.get().data.records).xp,400);
});
test('fixed context rejects prior session/epoch progress, wrong IDs and delayed completion', async () => {
  const app = await setup(); const {controller} = app;
  controller.start({...record,status:'pending'}); const old = app.played.context;
  await controller.complete('wrong',old); assert.equal(app.writes,2);
  controller.invalidate(); controller.start({...record,status:'pending'}); const next = app.played.context;
  controller.progress(900,1000,old); await controller.complete(record.id,old);
  assert.equal(app.progress,0); assert.equal(app.writes,2);
  controller.progress(25,1000,next); await controller.complete(record.id,next);
  assert.equal(app.progress,1); assert.equal(app.writes,3);
});
test('invalidating while completion awaits the lock cancels the old write and result', async () => {
  let resolve; let called = 0;
  const store = {completeRecord:() => new Promise(done => resolve=done),invalidateEpoch:() => {called++;}};
  let context, results = 0;
  const controller = createSessionController({store,play:(_record,c) => context=c,onComplete:() => results++});
  controller.start(record); const pending = controller.complete(record.id,context);
  controller.invalidate(); resolve({ok:false,code:'CANCELLED'}); await pending;
  assert.equal(results,0); assert.equal(called,1); assert.equal(controller.busy,false);
});
test('completion notification sees prior rendered state before final rerender, preserving level-up announcement', async () => {
  const app = await setup(); let rendered = app.store.get().data, announced, context;
  const controller = createSessionController({store:app.store,play:(_record,c)=>context=c,
    onChange:()=>{rendered=app.store.get().data;},
    onComplete:()=>{announced=[levelInfo(summary(rendered.records).xp).level,levelInfo(summary(app.store.get().data.records).xp).level];},
  });
  controller.start({...record,status:'pending'}); await controller.complete(record.id,context);
  assert.deepEqual(announced,[1,3]); assert.equal(summary(rendered.records).xp,400);
});
