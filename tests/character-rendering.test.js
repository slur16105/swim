import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CHARACTER_CATALOG as catalog, normalizeAppearance, appearanceSummary } from '../src/character.js';
import { drawAvatar, makeSwimmer, textureKey } from '../src/game/art.js';

// Load the actual Scene methods; replace only Phaser's browser-only base/import.
const source = (await readFile(new URL('../src/game/PoolScene.js', import.meta.url), 'utf8'))
  .replace("import Phaser from 'phaser';", 'const Phaser = { Scene: class {} };')
  .replace("'../character.js'", JSON.stringify(new URL('../src/character.js', import.meta.url).href))
  .replace("'./art.js'", JSON.stringify(new URL('../src/game/art.js', import.meta.url).href));
const { PoolScene } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const combinations = Object.keys(catalog.cap).flatMap(cap => Object.keys(catalog.goggles).flatMap(goggles => Object.keys(catalog.suit).map(suit => ({ cap, goggles, suit }))));
function adapter() {
  const textures = new Map();
  const state = { textures, made: 0, destroyed: 0, fail: -1 };
  const graphics = () => {
    let color; const boxes = [];
    return { clear() {}, fillStyle(c) { color = c; }, fillRect(...args) { boxes.push([color, ...args]); },
      generateTexture(key) { textures.set(key, boxes); if (++state.made === state.fail) throw new Error('render failed'); }, destroy() { state.destroyed++; } };
  };
  const sprite = (x, y, key) => ({ x, y, key, angle: 0, setTexture(key) { this.key = key; return this; }, setAngle(a) { this.angle = a; return this; }, setScale() { return this; }, setPosition(x, y) { this.x = x; this.y = y; return this; } });
  return { state, textures: { exists: key => textures.has(key), remove: key => textures.delete(key) }, make: { graphics }, add: { graphics, sprite, text: () => ({ setOrigin() { return this; }, setPosition() {} }) } };
}
function canvas() {
  const result = { boxes: [], shown: null, fail: false, missingContext: false, failDraw: false, restored: 0 };
  result.ownerDocument = { createElement: () => { const buffer = canvas(); buffer.fail = result.fail; return buffer; } };
  result.getContext = () => result.missingContext ? null : ({ fillStyle: '', save() {}, restore() { result.restored++; }, fillRect(...args) { if (result.fail) throw new Error('canvas failed'); result.boxes.push([this.fillStyle, ...args]); }, drawImage(buffer) { if (result.failDraw) throw new Error('draw failed'); result.shown = buffer.boxes; } });
  return result;
}
const at = (boxes, x, y) => boxes.find(b => b[1] === x && b[2] === y)?.[0];
test('27 portraits and 108 swimmer textures share catalog colors, fixed geometry and labels', () => {
  const scene = adapter(); let portraitShape; const poolShapes = [];
  for (const a of combinations) {
    const c = canvas(); assert.equal(drawAvatar(c, a), true);
    assert.equal(at(c.shown, 20, 10), catalog.cap[a.cap].color);
    assert.equal(at(c.shown, 20, 22), catalog.goggles[a.goggles].color);
    assert.equal(at(c.shown, 23, 27), catalog.suit[a.suit].color);
    assert.equal(at(c.shown, 23, 23), '#b9e8db'); assert.equal(at(c.shown, 24, 17), '#f8cfa5');
    assert.equal(at(c.shown, 24, 11), '#fff3c8'); assert.equal(at(c.shown, 25, 34), '#5c9476');
    const shape = c.shown.map(b => b.slice(1)); portraitShape ??= shape; assert.deepEqual(shape, portraitShape);
    for (const part of Object.keys(catalog)) assert.ok(appearanceSummary(a).includes(catalog[part][a[part]].label));
    makeSwimmer(scene, a); makeSwimmer(scene, a);
    for (let frame = 0; frame < 4; frame++) {
      const boxes = scene.state.textures.get(textureKey(a, frame));
      const hex = c => parseInt(c.slice(1), 16);
      assert.equal(at(boxes, 8, 4), hex(catalog.cap[a.cap].color));
      assert.equal(at(boxes, 8, 11), a.goggles === 'dark' ? 0x234e50 : hex(catalog.goggles[a.goggles].color));
      assert.equal(at(boxes, 9, 13), a.suit === 'dark' ? 0x194f51 : hex(catalog.suit[a.suit].color));
      assert.equal(at(boxes, 10, 11), 0xa2e9ef); assert.equal(at(boxes, 9, 8), 0xe6ad85); assert.equal(at(boxes, 11, 5), 0xffe4ac);
      const shape = boxes.map(b => b.slice(1)); poolShapes[frame] ??= shape; assert.deepEqual(shape, poolShapes[frame]);
    }
  }
  assert.equal(scene.state.textures.size, 108); assert.equal(scene.state.made, 108); assert.equal(scene.state.destroyed, 108);
});
test('legacy strings normalize; invalid input fails without replacing a portrait', () => {
  const c = canvas(); drawAvatar(c, 'pink'); const shown = c.shown;
  assert.deepEqual(normalizeAppearance('pink'), { cap: 'pink', goggles: 'dark', suit: 'dark' });
  assert.throws(() => drawAvatar(c, 'unknown')); assert.equal(c.shown, shown);
  c.fail = true; assert.throws(() => drawAvatar(c, 'green')); assert.equal(c.shown, shown);
  c.fail = false; c.missingContext = true;
  assert.throws(() => drawAvatar(c, 'green'), /destination unavailable/); assert.equal(c.shown, shown);
  c.missingContext = false; c.failDraw = true; const restored = c.restored;
  assert.throws(() => drawAvatar(c, 'green'), /draw failed/); assert.equal(c.shown, shown); assert.equal(c.restored, restored + 1);
  c.failDraw = false; assert.equal(drawAvatar(c, 'green'), true); assert.notEqual(c.shown, shown);
  assert.equal(at(c.shown, 20, 10), catalog.cap.green.color);
  assert.throws(() => textureKey('orange', 4));
});
test('failed texture batches keep cached frames, clean partial frames and allow retry', () => {
  const scene = adapter(); makeSwimmer(scene, 'orange');
  const keep = scene.state.textures.get(textureKey('orange', 0));
  scene.state.textures.delete(textureKey('orange', 2)); scene.state.textures.delete(textureKey('orange', 3));
  scene.state.fail = 6; assert.throws(() => makeSwimmer(scene, 'orange'));
  assert.equal(scene.state.textures.size, 2); assert.equal(scene.state.textures.get(textureKey('orange', 0)), keep);
  assert.equal(scene.state.destroyed, 6);
  scene.state.fail = -1; makeSwimmer(scene, 'orange'); assert.equal(scene.state.textures.size, 4);
});
function snapshot(scene) { return { session: scene.session, values: { ...scene.session }, x: scene.swimmer.x, y: scene.swimmer.y, angle: scene.swimmer.angle, speed: scene.speed, paused: scene.paused, elapsed: scene.elapsed, frame: scene.currentFrame }; }
test('actual Scene create/setAppearance/update preserve progress and do not generate in update', () => {
  const scene = new PoolScene({ cap: 'orange' }); const mock = adapter(); Object.assign(scene, mock);
  scene.setAppearance(combinations[26]); scene.setAppearance(combinations[12]); scene.create();
  assert.deepEqual(scene.appearance, combinations[12]); assert.equal(scene.swimmer.key, textureKey(combinations[12], 0));
  scene.play({ id: 'record', distance: 1000 }); scene.speed = 4; scene.update(137, 80);
  for (const paused of [false, true]) {
    scene.paused = paused; const before = snapshot(scene);
    for (const a of combinations) { scene.setAppearance(a); assert.deepEqual(snapshot(scene), before); assert.equal(scene.swimmer.key, textureKey(a, before.frame)); }
  }
  const made = mock.state.made;
  scene.setAppearance(combinations[26]);
  for (const [paused, expectedFrame] of [[false, 2], [true, 0]]) {
    scene.paused = paused; scene.update(250, 16);
    assert.equal(scene.swimmer.key, textureKey(combinations[26], expectedFrame));
    assert.equal(scene.currentFrame, expectedFrame); assert.equal(mock.state.made, made);
  }
  assert.equal(made, 108);
  scene.setCap('pink'); assert.deepEqual(scene.appearance, normalizeAppearance('pink'));
});
test('Scene render and display failure preserve appearance/session and retry succeeds', () => {
  const scene = new PoolScene(); const mock = adapter(); Object.assign(scene, mock); scene.create(); scene.play({ id: 'r', distance: 500 }); scene.update(170, 50);
  const before = snapshot(scene), a = scene.appearance, key = scene.swimmer.key;
  mock.state.fail = 6; assert.throws(() => scene.setAppearance(combinations[26]));
  assert.equal(scene.appearance, a); assert.equal(scene.swimmer.key, key); assert.deepEqual(snapshot(scene), before);
  mock.state.fail = -1;
  const setTexture = scene.swimmer.setTexture; let fail = true;
  scene.swimmer.setTexture = function (key) { this.key = key; if (fail) { fail = false; throw new Error('display failed'); } return this; };
  assert.throws(() => scene.setAppearance(combinations[26])); assert.equal(scene.swimmer.key, key); assert.equal(scene.appearance, a); assert.deepEqual(snapshot(scene), before);
  scene.swimmer.setTexture = setTexture; scene.setAppearance(combinations[26]); assert.deepEqual(snapshot(scene), before);
  assert.throws(() => scene.setAppearance({ cap: 'pink' })); assert.deepEqual(scene.appearance, combinations[26]);
});
test('rendering and actual Scene methods never access browser storage', () => {
  const descriptors = Object.fromEntries(['localStorage', 'sessionStorage'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  try {
    for (const key of Object.keys(descriptors)) Object.defineProperty(globalThis, key, { configurable: true, get() { throw new Error('storage accessed'); } });
    const scene = new PoolScene(); Object.assign(scene, adapter()); scene.create();
    for (const a of combinations) { drawAvatar(canvas(), a); scene.setAppearance(a); }
    scene.play({ id: 'no-storage', distance: 100 }); scene.update(100, 16); scene.setCap('green');
  } finally {
    for (const [key, descriptor] of Object.entries(descriptors)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
  }
});
test('live reduced-motion preference suppresses decoration while playback continues without resubscribing', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'matchMedia');
  const preference = {matches:false}; let queries=0;
  Object.defineProperty(globalThis,'matchMedia',{configurable:true,value:query=>{assert.equal(query,'(prefers-reduced-motion: reduce)');queries++;return preference;}});
  try {
    const scene=new PoolScene();Object.assign(scene,adapter());scene.create();scene.play({id:'motion',distance:1000});
    let ripples=0,wakes=0;scene.ripples.fillRect=()=>ripples++;scene.wake.fillRect=()=>wakes++;
    scene.update(100,80);assert.equal(ripples,32);assert.equal(wakes,10);const travelled=scene.session.travelled;
    preference.matches=true;scene.update(180,80);
    assert.equal(ripples,32);assert.equal(wakes,10);assert.ok(scene.session.travelled>travelled);
    preference.matches=false;scene.update(260,80);assert.equal(ripples,64);assert.equal(wakes,20);assert.equal(queries,1);
  } finally {if(previous)Object.defineProperty(globalThis,'matchMedia',previous);else delete globalThis.matchMedia;}
});
test('actual Scene forwards the fixed context through controller and Store to persisted XP and idle state',async()=>{
  const {createCommandStore}=await import('../src/storage.js');
  const {createSessionController}=await import('../src/ui/session.js');
  const {summary,levelInfo}=await import('../src/model.js');
  let raw=null;const storage={getItem:()=>raw,setItem:(_key,value)=>raw=value};
  const store=createCommandStore(storage,{locks:{request:async(_name,_options,callback)=>callback({})},eventTarget:null});
  await store.saveCharacter(normalizeAppearance('pink'));
  const record={id:'scene-completion',date:'2026-01-01',stroke:'자유형',distance:1000,minutes:40};
  await store.saveRecord(record);
  let controller,expected,completion,completeContext,progressCalls=0;
  const scene=new PoolScene({appearance:store.get().data.character,
    onProgress(distance,total,context){assert.equal(context,expected);progressCalls++;controller.progress(distance,total,context);},
    onComplete(id,context){completeContext=context;completion=controller.complete(id,context);},
  });
  Object.assign(scene,adapter());scene.create();
  controller=createSessionController({store,play(record,context){expected=context;scene.play(record,context);}});
  controller.start(store.get().data.records[0]);assert.equal(scene.session.context,expected);assert.equal(controller.busy,true);
  scene.speed=4;
  for(let frame=0;scene.session && frame<101;frame++)scene.update(frame*80,80);
  assert.equal(scene.session,null);assert.equal(completeContext,expected);assert.ok(progressCalls>0);assert.equal(controller.completing,true);
  await completion;
  assert.equal(controller.busy,false);const persisted=JSON.parse(raw);assert.equal(persisted.records[0].status,'complete');
  assert.equal(summary(persisted.records).xp,400);assert.equal(levelInfo(summary(persisted.records).xp).level,3);
});

test('Scene stop clears playback before the next update and emits no completion', () => {
  let completions=0, progress=0;
  const scene=new PoolScene({onComplete(){completions++;},onProgress(){progress++;}});
  Object.assign(scene,adapter());scene.create();scene.play({id:'old',distance:25},{epoch:0});scene.update(10,80);
  const previousProgress=progress;let markerPosition;scene.marker.setPosition=(...position)=>{markerPosition=position;};
  scene.swimmer.setTexture(textureKey(scene.appearance,2));scene.stop();
  assert.equal(scene.swimmer.key,textureKey(scene.appearance,0));assert.deepEqual(markerPosition,[116,201]);
  assert.equal(scene.swimmer.x,116);assert.equal(scene.swimmer.angle,90);
  scene.update(20,80);
  assert.equal(scene.session,null);assert.equal(scene.paused,false);assert.equal(scene.currentFrame,0);
  assert.equal(scene.swimmer.x,116);assert.equal(completions,0);assert.equal(progress,previousProgress);
});
