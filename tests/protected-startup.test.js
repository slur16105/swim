import { PoolScene, adapter } from './helpers/scene.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as model from '../src/model.js';
import * as character from '../src/character.js';
import { createCommandStore } from '../src/storage.js';
import { createSessionController } from '../src/ui/session.js';
import { createCharacterEditor } from '../src/ui/editor.js';
import { handleDialogTab } from '../src/ui/dialog-focus.js';

// Run actual application initialization with actual Store/editor/session modules.
// The DOM adapter only records UI state; browser focus/layout requires browser verification.
const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '');
function boot(raw, { denied = false, supported = true, lockAdapter } = {}) {
  const elements = new Map(), windowHandlers = new Map();
  let document, failWrites = false, allowWrites = false, writes = 0;
  const timers = []; let failReads = false;
  const attempts = [], played = []; let scene, completion;
  const disconnect = node => { if (typeof node !== 'object') return; node.isConnected = false; node.children?.forEach(disconnect); };
  const element = (tag = 'div') => {
    const handlers = new Map();
    return { tag, hidden:false, disabled:false, dataset:{}, children:[], style:{}, isConnected:true, value:'',
      setAttribute(){}, addEventListener(name, handler){handlers.set(name,handler);},
      fire(name,event={}){return handlers.get(name)?.({preventDefault(){},...event});},
      replaceChildren(){this.children.forEach(disconnect);this.children=[];}, append(...children){this.children.push(...children);},
      contains(target){return this === target || this.children.some(child=>typeof child === 'object' && child.contains(target));},
      querySelectorAll(selector){const matches = []; const visit = node => { if(typeof node !== 'object')return; if(selector.split(',').some(part=>part.startsWith(node.tag) && (!part.includes('radio') || node.type==='radio')))matches.push(node);node.children.forEach(visit);};this.children.forEach(visit);return matches;},
      showModal(){this.open=true;},close(){this.open=false;},focus(){document.activeElement=this;},
      reset(){Object.values(this.elements ?? {}).forEach(input=>input.value='');},
    };
  };
  const entries = [element('button'),element('button')];
  const get = selector => {
    if(!elements.has(selector))elements.set(selector,element(selector.match(/button|main-action|close-|cancel-|save-character|continue-editing|discard-editor|retry-/)?'button':'div'));
    return elements.get(selector);
  };
  const recordForm = get('#record-form');recordForm.elements={};
  for(const name of ['id','date','stroke','distance','minutes']) { const input=element('input'); input.name=name;recordForm.elements[name]=input;recordForm.append(input); }
  recordForm.append(get('#close-dialog'),get('.submit-button'));get('#record-dialog').append(recordForm);
  get('#character-form').append(get('#color-groups'),get('#save-character'),get('#cancel-editor'));
  get('#character-dialog').append(get('#character-form'),get('#close-editor'));
  const storage={getItem:()=>{if(failReads)throw Error('blocked');return raw;},setItem:(_key,next)=>{assert.ok(allowWrites,'초기화에서 저장 금지');attempts.push(JSON.parse(next));if(failWrites)throw Object.assign(new Error(),{name:typeof failWrites === 'string' ? failWrites : 'QuotaExceededError'});raw=next;writes++;},removeItem:()=>assert.fail('초기화에서 삭제 금지')};
  const window={removeEventListener(name, handler){windowHandlers.set(name,(windowHandlers.get(name)??[]).filter(item=>item!==handler));},addEventListener(name,handler){const handlers=windowHandlers.get(name)??[];handlers.push(handler);windowHandlers.set(name,handlers);}};
  Object.defineProperty(window,'localStorage',{get(){if(denied)throw Error('denied');return storage;}});
  document={querySelector:get,querySelectorAll:selector=>selector==='[data-open-record]'?entries:[],createElement:element,activeElement:null};
  const locks=lockAdapter ?? (supported?{request:async(_name,_options,callback)=>callback({})}:undefined);
  const previousDocument=globalThis.document, previousWindow=globalThis.window;globalThis.document=document;globalThis.window=window;
  try {
    runInNewContext(source,{...model,...character,createCommandStore:storage=>createCommandStore(storage,{locks,eventTarget:window}),createSessionController,createCharacterEditor,handleDialogTab,
      document,window,navigator:{locks},HTMLDialogElement:class{},structuredClone,crypto:{randomUUID:()=> 'new-record-id'},
      FormData:class{constructor(form){this.form=form;}*[Symbol.iterator](){for(const[name,input]of Object.entries(this.form.elements))yield[name,input.value];}},
      drawAvatar(){},createPool(options){scene=new PoolScene({...options,onComplete(...args){completion=options.onComplete(...args);return completion;}});Object.assign(scene,adapter());const play=scene.play;scene.play=function(...args){played.push(args);return play.apply(this,args);};scene.create();return{scene};},setTimeout(callback){timers.push(callback);},clearTimeout(){}});
  } finally {globalThis.document=previousDocument;globalThis.window=previousWindow;}
  let activeActions=0, savedDocument, savedWindow;
  async function withDocument(action){
    if(activeActions++===0){savedDocument=globalThis.document;savedWindow=globalThis.window;globalThis.document=document;globalThis.window=window;}
    try{return await action();}finally{if(--activeActions===0){globalThis.document=savedDocument;globalThis.window=savedWindow;}}
  }
  return {get,entries,storage,document,played,attempts,scene,windowHandlers,
    flushTimers:()=>withDocument(()=>{const pending=timers.splice(0);for(const callback of pending)callback();}),
    set failReads(value){failReads=value;},
    set denied(value){denied=value;},
    finish:()=>withDocument(async()=>{scene.session.travelled=scene.session.distance-1;scene.paused=false;scene.update(1000,80);return await completion;}),
    fire:(node,name,event)=>withDocument(()=>node.fire(name,event)),
    emit:(name,event={})=>withDocument(()=>{for(const handler of windowHandlers.get(name)??[])handler(event);}),
    set raw(value){raw=value;},set failWrites(value){failWrites=value;},set allowWrites(value){allowWrites=value;},get writes(){return writes;},
  };
}
test('손상·미지원 버전·저장소 차단은 보호 안내와 쓰기 잠금, 원문 무쓰기', () => {
  for (const [raw, denied] of [['',false],['{broken',false],[JSON.stringify({version:99}),false],[null,true]]) {
    const app = boot(raw,{denied});
    assert.equal(app.get('#storage-alert').hidden,false);
    assert.ok(app.get('#storage-alert').textContent.length > 0);
    assert.ok(app.entries.every(button => button.disabled)); assert.equal(app.get('#main-action').disabled,true);
    assert.equal(app.storage.getItem(),raw);
  }
});
test('v1과 v2 기존 사용자는 재생성 없이 기록 가능하며 읽기만으로 이관하지 않음', () => {
  for (const raw of [JSON.stringify({version:1,cap:'pink',records:[]}),JSON.stringify({version:2,revision:5,character:{cap:'green',goggles:'pink',suit:'orange'},records:[]})]) {
    const app = boot(raw); assert.equal(app.get('#storage-alert').hidden,true);
    assert.ok(app.entries.every(button => !button.disabled)); assert.equal(app.get('#main-action').textContent,'＋ 수영 기록하기'); assert.equal(app.storage.getItem(),raw);
  }
});
test('키 부재와 유효한 미생성 v2는 생성만 허용하고 기록을 차단', () => {
  for (const raw of [null,JSON.stringify({version:2,revision:7,character:null,records:[]})]) {
    const app = boot(raw); assert.equal(app.get('#main-action').disabled,false);
    assert.equal(app.get('#main-action').textContent,'내 캐릭터 만들기'); assert.ok(app.entries.every(button => button.disabled));
  }
});
test('잠금 미지원은 정상 저장 내용도 읽기 전용으로 유지', () => {
  const app = boot(JSON.stringify({version:1,cap:'pink',records:[]}),{supported:false});
  assert.equal(app.get('#main-action').disabled,true); assert.match(app.get('#storage-alert').textContent,/읽기만/);
});
const completedRecord = {id:'done',date:'2026-01-01',stroke:'자유형',distance:1000,minutes:30,status:'complete'};
const readyRaw = records => JSON.stringify({version:2,revision:1,character:{cap:'pink',goggles:'dark',suit:'dark'},records});
const rowButtons = app => app.get('#record-list').querySelectorAll('button');
test('unchanged focus preserves the exact history action; conflict removes it with a valid focus fallback', async () => {
  const app=boot(readyRaw([completedRecord]));const action=rowButtons(app)[1];action.focus();
  await app.emit('focus');assert.equal(rowButtons(app)[1],action);assert.equal(app.document.activeElement,action);
  app.raw=readyRaw([]);await app.emit('focus');
  assert.equal(action.isConnected,false);assert.equal(app.document.activeElement,app.get('#character-title'));
  assert.ok(rowButtons(app).every(button=>button.disabled));
});
test('external protection is explained inside an open record dialog without losing input or focus',async()=>{
  const app=boot(readyRaw([]));await app.fire(app.get('#main-action'),'click');
  const distance=app.get('#record-form').elements.distance;distance.value='750';distance.focus();
  app.raw=readyRaw([completedRecord]);await app.emit('focus');
  assert.match(app.get('#record-blocked').textContent,/다른 탭/);assert.equal(app.get('#record-dialog').open,true);
  assert.equal(distance.value,'750');assert.equal(app.document.activeElement,distance);assert.equal(app.get('.submit-button').disabled,true);
});
test('external protection in creation preserves its draft and current radio focus with an in-dialog reason',async()=>{
  const app=boot(null);await app.fire(app.get('#main-action'),'click');
  const pink=app.get('#character-form').querySelectorAll('input').find(input=>input.name==='cap'&&input.value==='pink');
  pink.focus();await app.fire(pink,'change');app.raw=readyRaw([]);await app.emit('focus');
  assert.match(app.get('#editor-blocked').textContent,/다른 탭/);assert.match(app.get('#preview-summary').textContent,/수모 분홍/);
  assert.equal(app.document.activeElement,pink);assert.equal(app.get('#save-character').disabled,true);
});
test('actual main record failure retains input and ID, unlocks with error focus, then retries exactly once',async()=>{
  const app=boot(readyRaw([]));app.allowWrites=true;app.failWrites=true;
  await app.fire(app.get('#main-action'),'click');const form=app.get('#record-form');
  form.elements.distance.value='1000';form.elements.minutes.value='40';const values=Object.fromEntries(Object.entries(form.elements).map(([name,node])=>[name,node.value]));
  await app.fire(form,'submit');
  assert.equal(app.get('#record-dialog').open,true);assert.equal(app.played.length,0);assert.equal(app.writes,0);
  assert.deepEqual(Object.fromEntries(Object.entries(form.elements).map(([name,node])=>[name,node.value])),values);
  assert.ok(form.querySelectorAll('input,select,button').every(node=>!node.disabled));assert.equal(app.document.activeElement,app.get('#form-error'));assert.match(app.get('#form-error').textContent,/부족/);
  app.failWrites=false;await app.fire(form,'submit');
  assert.equal(app.get('#record-dialog').open,false);assert.equal(app.played.length,1);assert.equal(app.writes,1);
  const data=JSON.parse(app.storage.getItem());assert.equal(data.records.length,1);assert.equal(data.records[0].id,values.id);
  assert.deepEqual(app.attempts[0].records,app.attempts[1].records);
});
test('actual main completed edit warns before saving decreased distance, recalculates XP without playback',async()=>{
  const app=boot(readyRaw([completedRecord]));app.allowWrites=true;
  await app.fire(rowButtons(app)[1],'click');const form=app.get('#record-form');form.elements.distance.value='500';await app.fire(form,'input');
  assert.equal(app.get('#xp-reduction').hidden,false);assert.match(app.get('#record-preview').textContent,/1× 기준/);
  await app.fire(form,'submit');const data=JSON.parse(app.storage.getItem());
  assert.equal(app.played.length,0);assert.equal(data.records.length,1);assert.equal(data.records[0].status,'complete');assert.equal(model.summary(data.records).xp,200);
  assert.equal(app.get('#level-chip').textContent,'LV. 2');
});
test('replay immediately states no additional XP before its first progress callback',async()=>{
  const app=boot(readyRaw([completedRecord]));await app.fire(rowButtons(app)[0],'click');
  assert.equal(app.played.length,1);assert.match(app.get('#session-detail').textContent,/XP가 추가되지/);assert.doesNotMatch(app.get('#session-detail').textContent,/XP를 받아/);
});
test('record Escape keydown prevents native close while saving, then closes normally after failure',async()=>{
  const app=boot(readyRaw([]));app.allowWrites=true;app.failWrites=true;
  await app.fire(app.get('#main-action'),'click');const form=app.get('#record-form');form.elements.distance.value='1000';form.elements.minutes.value='30';
  const pending=app.fire(form,'submit');
  let prevented=0;const escape={key:'Escape',preventDefault(){prevented++;}};
  // Dispatch synchronously before the command queue finishes the pending write.
  app.get('#record-dialog').fire('keydown',escape);app.get('#record-dialog').fire('keydown',escape);
  assert.equal(prevented,2);assert.equal(app.get('#record-dialog').open,true);
  await pending;
  await app.fire(app.get('#record-dialog'),'keydown',escape);
  assert.equal(prevented,3);assert.equal(app.get('#record-dialog').open,false);
});
const choose = (app,part,value) => app.get('#character-form').querySelectorAll('input').find(node=>node.name===part&&node.value===value);
async function openEditor(app) {assert.equal(app.get('#edit-character').hidden,false);assert.equal(app.get('#edit-character').disabled,false);app.get('#edit-character').focus();await app.fire(app.get('#edit-character'),'click');}
async function change(app,part,value) {const radio=choose(app,part,value);radio.focus();await app.fire(radio,'change');return radio;}
test('actual edit baseline prevents no-op writes; cancel and revisit keep committed appearance and records',async()=>{
  const app=boot(readyRaw([completedRecord]));app.allowWrites=true;await openEditor(app);
  assert.equal(app.get('#save-character').disabled,true);assert.match(app.get('#editor-unchanged').textContent,/변경한 내용/);
  await app.fire(app.get('#character-form'),'submit');await change(app,'cap','pink');await app.fire(app.get('#character-form'),'submit');assert.equal(app.writes,0);
  await change(app,'cap','green');assert.equal(app.windowHandlers.get('beforeunload').length,1);
  let prevented=false;await app.emit('beforeunload',{preventDefault(){prevented=true;}});assert.equal(prevented,true);
  await change(app,'cap','pink');assert.equal(app.get('#save-character').disabled,true);assert.equal(app.windowHandlers.get('beforeunload').length,0);
  await change(app,'suit','orange');await app.fire(app.get('#close-editor'),'click');
  await app.fire(app.get('#discard-editor'),'click');assert.equal(app.writes,0);assert.equal(app.document.activeElement,app.get('#edit-character'));assert.equal(app.windowHandlers.get('beforeunload').length,0);
  await openEditor(app);assert.equal(choose(app,'suit','dark').checked,true);
  await change(app,'suit','pink');await app.fire(app.get('#character-form'),'submit');assert.equal(app.document.activeElement,app.get('#edit-character'));assert.equal(app.windowHandlers.get('beforeunload').length,0);
  const data=JSON.parse(app.storage.getItem());assert.deepEqual(data.records,[completedRecord]);assert.equal(data.character.suit,'pink');
  const revisit=boot(app.storage.getItem());await openEditor(revisit);assert.equal(choose(revisit,'suit','pink').checked,true);assert.equal(revisit.get('#level-chip').textContent,'LV. 3');
});
for(const returnLeg of [false,true])for(const paused of [false,true])test(`actual main/Scene edit preserves playback identity, direction, speed, returnLeg=${returnLeg} and paused=${paused}`,async()=>{
  const app=boot(readyRaw([{...completedRecord,status:'pending'}]));app.allowWrites=true;await app.fire(rowButtons(app)[0],'click');
  app.scene.speed=4;for(let frame=0;frame<(returnLeg?3:1);frame++)app.scene.update(100+frame*80,80);app.scene.paused=paused;
  assert.equal(app.scene.swimmer.angle,returnLeg?-90:90);
  const session=app.scene.session,values={...session},position=[app.scene.swimmer.x,app.scene.swimmer.y,app.scene.swimmer.angle];
  await openEditor(app);await change(app,'cap','green');assert.equal(app.scene.appearance.cap,'pink');
  await app.fire(app.get('#character-form'),'submit');
  assert.equal(app.scene.session,session);assert.deepEqual(app.scene.session,values);assert.deepEqual([app.scene.swimmer.x,app.scene.swimmer.y,app.scene.swimmer.angle],position);assert.equal(app.scene.speed,4);assert.equal(app.scene.paused,paused);assert.equal(app.played.length,1);
  await openEditor(app);await change(app,'suit','orange');await app.fire(app.get('#cancel-editor'),'click');await app.fire(app.get('#discard-editor'),'click');assert.equal(app.played.length,1);assert.equal(app.writes,1);assert.equal(app.scene.appearance.suit,'dark');
});
for(const completionFirst of [true,false])test(`actual main completion and appearance queue both survive, completionFirst=${completionFirst}`,async()=>{
  const app=boot(readyRaw([{...completedRecord,status:'pending'}]));app.allowWrites=true;await app.fire(rowButtons(app)[0],'click');await openEditor(app);
  const radio=await change(app,'cap','green');
  if(completionFirst){
    const completion=app.finish();const saving=app.fire(app.get('#character-form'),'submit');
    await Promise.all([completion,saving]);
    assert.match(app.get('#editor-completion').textContent,/400 XP.*레벨 3/);
    assert.match(app.get('#session-detail').textContent,/400 XP.*레벨 3/);
    assert.equal(app.attempts[0].records[0].status,'complete');assert.equal(app.attempts[0].character.cap,'pink');
    assert.equal(app.attempts[1].character.cap,'green');
  }else{
    // Queue both without awaiting: onSaved may render the completed Store before onComplete.
    const saving=app.fire(app.get('#character-form'),'submit');const completion=app.finish();await Promise.all([saving,completion]);
    assert.match(app.get('#character-feedback').textContent,/레벨 3/);
  }
  const data=JSON.parse(app.storage.getItem());assert.equal(data.character.cap,'green');assert.equal(data.records[0].status,'complete');assert.equal(model.summary(data.records).xp,400);assert.equal(app.get('#level-chip').textContent,'LV. 3');assert.equal(app.get('#xp-label').textContent,'100 / 300 XP');assert.equal(app.played.length,1);assert.equal(app.writes,2);
});
test('completion preserves discard confirmation and focus; failed completion says pending; replay adds no XP',async()=>{
  const app=boot(readyRaw([{...completedRecord,status:'pending'}]));app.allowWrites=true;await app.fire(rowButtons(app)[0],'click');await openEditor(app);await change(app,'suit','pink');await app.fire(app.get('#close-editor'),'click');
  app.failWrites=true;await app.finish();assert.match(app.get('#editor-completion').textContent,/XP 지급 대기/);assert.doesNotMatch(app.get('#editor-completion').textContent,/400 XP/);assert.equal(app.get('#discard-confirmation').hidden,false);assert.equal(app.document.activeElement,app.get('#continue-editing'));assert.equal(app.get('#level-chip').textContent,'LV. 1');
  await app.fire(app.get('#discard-editor'),'click');app.failWrites=false;await app.fire(rowButtons(app)[0],'click');await app.finish();
  const writes=app.writes;await app.fire(rowButtons(app)[0],'click');await openEditor(app);await change(app,'cap','green');await app.fire(app.get('#character-form'),'submit');await openEditor(app);await app.finish();assert.match(app.get('#editor-completion').textContent,/XP 추가 없음/);assert.equal(app.writes,writes+1);assert.equal(app.get('#xp-label').textContent,'100 / 300 XP');
});
test('edit failure preserves draft/error focus and committed display; fallback returns to selected equipment then title',async()=>{
  const app=boot(readyRaw([completedRecord]));app.allowWrites=true;app.failWrites=true;await openEditor(app);
  const radio=await change(app,'goggles','green');await app.fire(app.get('#character-form'),'submit');
  assert.equal(app.document.activeElement,app.get('#editor-error'));assert.equal(app.scene.appearance.goggles,'dark');assert.equal(radio.checked,true);assert.equal(app.get('#character-dialog').open,true);assert.equal(app.writes,0);
  await app.fire(app.get('#close-editor'),'click');app.get('#editor-error').hidden=true;
  await app.fire(app.get('#continue-editing'),'click');assert.equal(app.document.activeElement,radio);
  await app.fire(app.get('#close-editor'),'click');radio.isConnected=false;
  await app.fire(app.get('#continue-editing'),'click');assert.equal(app.document.activeElement,app.get('#editor-title'));
  app.get('#edit-character').hidden=true;await app.fire(app.get('#close-editor'),'click');await app.fire(app.get('#discard-editor'),'click');assert.equal(app.document.activeElement,app.get('#character-title'));
});
test('appearance first then completion keeps a reopened draft and its exact focused node',async()=>{
  const app=boot(readyRaw([{...completedRecord,status:'pending'}]));app.allowWrites=true;await app.fire(rowButtons(app)[0],'click');await openEditor(app);await change(app,'cap','green');await app.fire(app.get('#character-form'),'submit');
  await openEditor(app);const radio=await change(app,'suit','pink');await app.finish();
  assert.equal(app.get('#character-dialog').open,true);assert.equal(app.document.activeElement,radio);assert.equal(radio.checked,true);assert.match(app.get('#editor-completion').textContent,/400 XP.*레벨 3/);assert.equal(JSON.parse(app.storage.getItem()).character.suit,'dark');
});

test('edit entry is available only for a writable saved character',()=>{
  const ready=boot(readyRaw([]));assert.equal(ready.get('#edit-character').hidden,false);assert.equal(ready.get('#edit-character').disabled,false);
  const absent=boot(null);assert.equal(absent.get('#edit-character').hidden,true);
  const readOnly=boot(readyRaw([]),{supported:false});assert.equal(readOnly.get('#edit-character').hidden,false);assert.equal(readOnly.get('#edit-character').disabled,true);
});
test('failed appearance save retries the same draft once and preserves records and XP',async()=>{
  const app=boot(readyRaw([completedRecord]));app.allowWrites=true;app.failWrites=true;await openEditor(app);
  const radio=await change(app,'goggles','green');await app.fire(app.get('#character-form'),'submit');
  assert.equal(app.writes,0);assert.equal(app.document.activeElement,app.get('#editor-error'));assert.equal(radio.checked,true);
  assert.equal(app.windowHandlers.get('beforeunload').length,1);assert.equal(app.scene.appearance.goggles,'dark');
  app.failWrites=false;await app.fire(app.get('#character-form'),'submit');
  assert.equal(app.attempts.length,2);assert.deepEqual(app.attempts[0],app.attempts[1]);assert.equal(app.writes,1);
  const data=JSON.parse(app.storage.getItem());assert.deepEqual(data.records,[completedRecord]);assert.equal(model.summary(data.records).xp,400);
  assert.equal(data.character.goggles,'green');assert.equal(app.scene.appearance.goggles,'green');assert.match(app.get('#appearance-summary').textContent,/수경 초록/);
  assert.equal(app.get('#xp-label').textContent,'100 / 300 XP');assert.equal(app.get('#character-dialog').open,false);assert.equal(app.document.activeElement,app.get('#edit-character'));assert.equal(app.windowHandlers.get('beforeunload').length,0);
});

const chooseCap = async (app, value) => {
  const radio = app.get('#character-form').querySelectorAll('input').find(input=>input.name==='cap'&&input.value===value);
  radio.focus(); await app.fire(radio,'change'); return radio;
};
const recoverApp = async (app, prefix='editor') => {
  await app.fire(app.get(`#${prefix}-reload`),'click');
  await app.fire(app.get(`#${prefix}-recovery-accept`),'click');
};
test('explicit recovery cancels neutrally, preserves draft on failure, then reinitializes on success',async()=>{
  const app=boot(readyRaw([]));await app.fire(app.get('#edit-character'),'click');
  const green=await chooseCap(app,'green');app.raw='{broken';await app.emit('storage',{key:model.STORAGE_KEY});
  assert.equal(app.document.activeElement,green);assert.match(app.get('#preview-summary').textContent,/초록/);
  app.get('#editor-reload').focus();await app.fire(app.get('#editor-reload'),'click');
  assert.equal(app.get('#editor-body').inert,true);
  await app.fire(app.get('#editor-recovery-cancel'),'click');
  assert.equal(app.get('#editor-body').inert,false);assert.equal(app.document.activeElement,app.get('#editor-reload'));
  await recoverApp(app);
  assert.match(app.get('#preview-summary').textContent,/초록/);assert.equal(app.storage.getItem(),'{broken');
  assert.equal(app.document.activeElement,app.get('#editor-recovery-error'));assert.equal(app.get('#save-character').disabled,true);
  app.raw=readyRaw([completedRecord]);await recoverApp(app);
  assert.match(app.get('#preview-summary').textContent,/분홍/);assert.equal(app.get('#character-dialog').open,true);
  assert.equal(app.get('#editor-recovery').hidden,true);assert.equal(app.get('#record-count').textContent,1);
  assert.equal(app.writes,0);assert.equal(app.get('#editor-recovery-error').textContent,'');
});
test('recovery accepts unchanged payload and removes stale appearance, errors and playback for new state',async()=>{
  const app=boot(readyRaw([]));await app.fire(app.get('#edit-character'),'click');await chooseCap(app,'green');
  app.raw='{broken';await app.emit('focus');app.raw=readyRaw([]);await recoverApp(app);
  assert.match(app.get('#preview-summary').textContent,/분홍/);assert.equal(app.get('#editor-recovery').hidden,true);
  app.raw=null;await app.emit('focus');app.get('#character-feedback').textContent='old';app.get('#display-error').hidden=false;
  await recoverApp(app);
  assert.equal(app.get('#avatar').hidden,true);assert.equal(app.get('#appearance-summary').textContent,'');
  assert.equal(app.get('#display-error').hidden,true);assert.equal(app.get('#character-feedback').textContent,'');
  assert.equal(app.get('#editor-title').textContent,'내 캐릭터 만들기');assert.equal(app.get('#save-character').disabled,false);
  assert.equal(app.get('#session-distance').textContent,'0 / 0 m');assert.deepEqual(app.scene.appearance,character.DEFAULT_APPEARANCE);
});
test('record recovery retains entered values after access failure, then resets from latest record',async()=>{
  const app=boot(readyRaw([completedRecord]));await app.fire(rowButtons(app)[1],'click');
  const form=app.get('#record-form');form.elements.distance.value='750';form.elements.distance.focus();
  app.failReads=true;await app.emit('focus');await recoverApp(app,'record');
  assert.equal(form.elements.distance.value,'750');assert.equal(app.document.activeElement,app.get('#record-recovery-error'));
  assert.equal(app.get('.submit-button').disabled,true);
  app.failReads=false;app.raw=readyRaw([{...completedRecord,distance:500}]);await recoverApp(app,'record');
  assert.equal(form.elements.distance.value,500);assert.equal(app.get('#record-dialog').open,true);assert.equal(app.writes,0);
});
for(const kind of ['character','record','complete'])test(`recovery invalidates waiting ${kind}, blocks duplicate recovery and ignores late results`,async()=>{
  let release, hold=true, requests=0;
  const lockAdapter={request:async(_name,_options,callback)=>{requests++;if(hold)await new Promise(resolve=>release=resolve);return callback({});}};
  const pendingRecord={...completedRecord,status:'pending'};
  const app=boot(readyRaw(kind==='complete'?[pendingRecord]:[]),{lockAdapter});app.allowWrites=true;
  let saving;
  if(kind==='character'){
    await app.fire(app.get('#edit-character'),'click');await chooseCap(app,'green');saving=app.fire(app.get('#character-form'),'submit');
  } else if(kind==='record'){
    await app.fire(app.get('#main-action'),'click');const form=app.get('#record-form');form.elements.distance.value='1000';form.elements.minutes.value='30';saving=app.fire(form,'submit');
  }else{await app.fire(rowButtons(app)[0],'click');saving=app.finish();}
  await Promise.resolve();await Promise.resolve();
  const oldContext=app.played.at(-1)?.[1];app.raw=readyRaw([completedRecord]);await app.emit('focus');
  const prefix=kind==='character'?'editor':kind==='record'?'record':'home';
  assert.equal(app.get(`#${prefix}-reload`).disabled,false);
  await app.fire(app.get(`#${prefix}-reload`),'click');const recovery=app.fire(app.get(`#${prefix}-recovery-accept`),'click');
  assert.equal(app.scene.session,null);assert.equal(app.get(`#${prefix}-recovery-accept`).disabled,true);
  await app.fire(app.get(`#${prefix}-recovery-accept`),'click');hold=false;release();await saving;await recovery;
  assert.equal(requests,2);assert.equal(app.writes,0);assert.equal(app.get('#character-feedback').textContent,'');
  assert.equal(app.get('#session-badge').textContent,'READY');
  if(oldContext){await app.scene.onComplete(oldContext.id,oldContext);app.scene.onProgress(1000,1000,oldContext);}
  assert.equal(app.get('#session-badge').textContent,'READY');assert.equal(app.get('#session-distance').textContent,'0 / 0 m');
  assert.doesNotMatch(app.get('#storage-alert').textContent,/취소/);
});
test('recovered pending starts once from zero and ignores the older delayed startup task',async()=>{
  const app=boot(readyRaw([{...completedRecord,status:'pending'}]));
  app.raw=JSON.stringify({...JSON.parse(readyRaw([{...completedRecord,id:'latest',status:'pending'}])),revision:3});await app.emit('focus');
  await recoverApp(app,'home');await app.flushTimers();
  assert.equal(app.played.length,1);assert.equal(app.scene.session.id,'latest');assert.equal(app.scene.session.travelled,0);
  assert.match(app.get('#toast').textContent,/처음부터/);assert.equal(app.writes,0);
  await app.emit('storage',{key:model.STORAGE_KEY,newValue:'outdated'});
  assert.equal(app.get('#storage-alert').hidden,true);
});

test('open record editor becomes read-only when recovery restarts a pending swim',async()=>{
  const app=boot(readyRaw([completedRecord]));await app.fire(rowButtons(app)[1],'click');
  app.raw=readyRaw([{...completedRecord,status:'pending'}]);await app.emit('focus');await recoverApp(app,'record');await app.flushTimers();
  assert.equal(app.get('#record-dialog').open,true);assert.equal(app.scene.session.id,completedRecord.id);
  assert.equal(app.get('.submit-button').disabled,true);assert.equal(app.get('#record-form').elements.distance.disabled,true);
  assert.equal(app.get('#close-dialog').disabled,false);assert.match(app.get('#record-lock-reason').textContent,/수영 연출 중/);
});
test('failed recovery stops an active Scene without leaving SWIMMING or XP success labels',async()=>{
  const app=boot(readyRaw([{...completedRecord,status:'pending'}]));await app.fire(rowButtons(app)[0],'click');
  app.raw='{broken';await app.emit('focus');await recoverApp(app,'home');
  assert.equal(app.scene.session,null);assert.equal(app.get('#session-badge').textContent,'STOPPED');
  assert.match(app.get('#session-title').textContent,/중지/);assert.match(app.get('#session-detail').textContent,/복구하지 못해/);
  assert.equal(app.get('#pause').disabled,true);assert.equal(app.writes,0);
});

for (const failure of ['no-event conflict','write denial']) test(`character submit immediately exposes recovery after ${failure}`,async()=>{
  const app=boot(readyRaw([]));app.allowWrites=true;
  await app.fire(app.get('#edit-character'),'click');await chooseCap(app,'green');
  const changedRaw=readyRaw([completedRecord]);
  if(failure==='no-event conflict')app.raw=changedRaw;
  else app.failWrites='SecurityError';
  await app.fire(app.get('#character-form'),'submit');
  assert.equal(app.get('#editor-recovery').hidden,false);
  assert.equal(app.get('#editor-reload').disabled,false);
  assert.equal(app.get('#home-recovery').hidden,false);
  assert.equal(app.get('#save-character').disabled,true);
  assert.equal(app.get('#character-dialog').open,true);
  assert.match(app.get('#preview-summary').textContent,/초록/);
  assert.equal(app.document.activeElement,app.get('#editor-error'));
  assert.match(app.get('#editor-error').textContent,failure==='no-event conflict'?/다른 탭/:/저장 공간을 사용할 수 없/);
  assert.equal(app.storage.getItem(),failure==='no-event conflict'?changedRaw:readyRaw([]));
  assert.equal(app.writes,0);
  app.failWrites=false;await recoverApp(app);
  assert.equal(app.get('#editor-recovery').hidden,true);assert.match(app.get('#preview-summary').textContent,/분홍/);
});

test('explicit recovery reacquires localStorage after its getter permission is restored',async()=>{
  const app=boot(readyRaw([]),{denied:true});
  assert.equal(app.get('#main-action').disabled,true);assert.match(app.get('#storage-alert').textContent,/저장 공간을 사용할 수 없/);
  app.denied=false;await recoverApp(app,'home');
  assert.equal(app.get('#home-recovery').hidden,true);assert.equal(app.get('#main-action').disabled,false);
  assert.match(app.get('#appearance-summary').textContent,/분홍/);assert.equal(app.writes,0);
  app.allowWrites=true;await app.fire(app.get('#edit-character'),'click');await chooseCap(app,'green');await app.fire(app.get('#character-form'),'submit');
  assert.equal(app.writes,1);assert.equal(JSON.parse(app.storage.getItem()).character.cap,'green');
});
test('record recovery to new explains the creation path and leaves close enabled',async()=>{
  const app=boot(readyRaw([]));await app.fire(app.get('#main-action'),'click');app.get('#record-form').elements.distance.value='750';
  app.raw=null;await app.emit('focus');await recoverApp(app,'record');
  assert.equal(app.get('#record-form').elements.distance.value,'');assert.equal(app.get('.submit-button').disabled,true);
  assert.match(app.get('#record-blocked').textContent,/닫기 버튼.*내 캐릭터 만들기/);assert.equal(app.get('#close-dialog').disabled,false);
  await app.fire(app.get('#close-dialog'),'click');assert.equal(app.get('#record-dialog').open,false);assert.equal(app.get('#main-action').disabled,false);
  assert.equal(app.get('#main-action').textContent,'내 캐릭터 만들기');assert.equal(app.writes,0);
});
test('retry clears previous recovery error during the pending reload and removes old completion feedback',async()=>{
  let hold=false,release;
  const app=boot(readyRaw([]),{lockAdapter:{request:async(_name,_options,callback)=>{if(hold)await new Promise(resolve=>release=resolve);return callback({});}}});
  await app.fire(app.get('#edit-character'),'click');await chooseCap(app,'green');app.get('#editor-completion').textContent='old XP success';
  app.raw='{broken';await app.emit('focus');await recoverApp(app);
  assert.equal(app.get('#editor-completion').textContent,'');assert.match(app.get('#preview-summary').textContent,/초록/);
  assert.ok(app.get('#editor-recovery-error').textContent);
  hold=true;await app.fire(app.get('#editor-reload'),'click');const retry=app.fire(app.get('#editor-recovery-accept'),'click');
  await Promise.resolve();await Promise.resolve();
  assert.equal(app.get('#editor-recovery-error').textContent,'');assert.match(app.get('#editor-recovery-status').textContent,/불러오고/);
  assert.equal(app.get('#editor-completion').textContent,'');assert.match(app.get('#preview-summary').textContent,/초록/);
  hold=false;release();await retry;
});
test('home recovery confirmation Escape cancels only the confirmation and returns opener focus',async()=>{
  const app=boot('{broken');app.get('#home-reload').focus();await app.fire(app.get('#home-reload'),'click');
  assert.equal(app.get('#home-recovery-confirm').hidden,false);
  await app.fire(app.get('#home-recovery'),'keydown',{key:'Escape'});
  assert.equal(app.get('#home-recovery-confirm').hidden,true);assert.equal(app.get('#home-recovery').hidden,false);
  assert.equal(app.document.activeElement,app.get('#home-reload'));assert.equal(app.writes,0);
});
for(const prefix of ['editor','record'])for(const eventName of ['keydown','cancel'])test(`${prefix} recovery ${eventName} Escape keeps dialog and draft, clears inert and restores opener`,async()=>{
  const app=boot(readyRaw([]));
  if(prefix==='editor'){await app.fire(app.get('#edit-character'),'click');await chooseCap(app,'green');}
  else {await app.fire(app.get('#main-action'),'click');app.get('#record-form').elements.distance.value='750';}
  app.raw='{broken';await app.emit('focus');app.get(`#${prefix}-reload`).focus();await app.fire(app.get(`#${prefix}-reload`),'click');
  const dialog=app.get(prefix==='editor'?'#character-dialog':'#record-dialog');
  await app.fire(dialog,eventName,{key:'Escape'});
  assert.equal(app.get(`#${prefix}-recovery-confirm`).hidden,true);assert.equal(dialog.open,true);
  assert.equal(app.get('#editor-body').inert,false);assert.equal(app.get('#discard-confirmation').inert,false);assert.equal(app.get('#record-form').inert,false);
  assert.equal(app.document.activeElement,app.get(`#${prefix}-reload`));assert.equal(app.writes,0);
  if(prefix==='editor')assert.match(app.get('#preview-summary').textContent,/초록/);else assert.equal(app.get('#record-form').elements.distance.value,'750');
});
