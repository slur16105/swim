import test from 'node:test';
import assert from 'node:assert/strict';
import { createCharacterEditor } from '../src/ui/editor.js';
import { DEFAULT_APPEARANCE } from '../src/character.js';

// Exercise the real editor's event handlers and state transitions. Native dialog,
// radio navigation and visual overflow are verified in the browser separately.
function harness(save) {
  const nodes = new Map(), all = [];
  let document;
  function element(tag='div') {
    const handlers = new Map();
    const item = { tag, style:{}, children:[], disabled:false, hidden:false, isConnected:true,
      setAttribute(){}, append(...children){this.children.push(...children);},
      addEventListener(name,handler){handlers.set(name,handler);},
      async fire(name,event={}){return handlers.get(name)?.({preventDefault(){},...event});},
      focus(){document.activeElement=this;}, showModal(){this.open=true;}, close(){this.open=false;},
      querySelectorAll(selector){return all.filter(node=>selector.includes('input') && node.tag==='input' || selector.includes('button') && node.tag==='button');},
      // Missing canvas context deliberately exercises the supported preview fallback.
      getContext(){return null;},
    };
    all.push(item);return item;
  }
  const get = selector => {if(!nodes.has(selector)) nodes.set(selector,element(selector.includes('avatar')?'canvas':selector.includes('character-form')?'form':selector.includes('dialog')?'dialog':selector.match(/close|cancel|continue|discard-editor|retry|save-character/)?'button':'div'));return nodes.get(selector);};
  document={querySelector:get,createElement:element,activeElement:null};
  const previous=globalThis.document;globalThis.document=document;
  const trigger=element('button');trigger.focus();
  const saved=[];
  const editor=createCharacterEditor({save,canSave:()=>true,onSaved:()=>saved.push(true),errorMessage:code=>code});
  editor.open();
  return {editor,get,document,trigger,saved,radios:all.filter(node=>node.tag==='input'),restore(){globalThis.document=previous;}};
}
test('default appearance can save, preview failure keeps summary, saving locks editing/close/duplicate', async () => {
  let resolve,calls=0,input;
  const app=harness(value=>{calls++;input=value;return new Promise(done=>resolve=done);});
  try {
    assert.equal(app.get('#preview-error').hidden,false);assert.match(app.get('#preview-summary').textContent,/수모 주황/);
    const pending=app.get('#character-form').fire('submit');
    await app.get('#character-form').fire('submit');await app.get('#close-editor').fire('click');
    assert.equal(calls,1);assert.equal(app.get('#character-dialog').open,true);assert.ok(app.radios.every(radio=>radio.disabled));
    resolve({ok:true});await pending;
    assert.deepEqual(input,DEFAULT_APPEARANCE);assert.equal(app.get('#character-dialog').open,false);assert.equal(app.saved.length,1);
  } finally {app.restore();}
});
test('dirty close replaces editor body, Escape resumes selection, discard restores opener', async () => {
  const app=harness(async()=>({ok:true}));
  try {
    const pink=app.radios.find(radio=>radio.name==='cap' && radio.value==='pink');pink.focus();await pink.fire('change');
    await app.get('#character-dialog').fire('cancel');
    assert.equal(app.get('#editor-body').hidden,true);assert.equal(app.get('#discard-confirmation').hidden,false);
    assert.equal(app.document.activeElement,app.get('#continue-editing'));
    await app.get('#character-dialog').fire('cancel');
    assert.equal(app.get('#editor-body').hidden,false);assert.equal(app.document.activeElement,pink);
    await app.get('#close-editor').fire('click');await app.get('#discard-editor').fire('click');
    assert.equal(app.get('#character-dialog').open,false);assert.equal(app.document.activeElement,app.trigger);assert.equal(app.saved.length,0);
  } finally {app.restore();}
});
test('quota failure retains chosen draft and error focus; retry uses exactly the same choice', async () => {
  const calls=[];const app=harness(async value=>{calls.push(value);return calls.length===1?{ok:false,code:'QUOTA'}:{ok:true};});
  try {
    await app.radios.find(radio=>radio.name==='suit' && radio.value==='pink').fire('change');
    await app.get('#character-form').fire('submit');
    assert.equal(app.get('#character-dialog').open,true);assert.equal(app.document.activeElement,app.get('#editor-error'));assert.equal(app.get('#editor-error').textContent,'QUOTA');
    assert.ok(app.radios.every(radio=>!radio.disabled));assert.match(app.get('#preview-summary').textContent,/수영복 분홍/);
    await app.get('#character-form').fire('submit');assert.deepEqual(calls[0],calls[1]);assert.equal(app.saved.length,1);
  } finally {app.restore();}
});
test('unchanged default closes immediately without a discard confirmation', async () => {
  const app=harness(async()=>({ok:true}));
  try {await app.get('#close-editor').fire('click');assert.equal(app.get('#character-dialog').open,false);assert.equal(app.document.activeElement,app.trigger);} finally {app.restore();}
});
test('Escape keydown prevents native close on dirty confirmation, resume, and repeated saving attempts',async()=>{
  let resolve;
  const app=harness(()=>new Promise(done=>resolve=done));
  try {
    const pink=app.radios.find(radio=>radio.name==='cap'&&radio.value==='pink');pink.focus();await pink.fire('change');
    let prevented=0;const escape={key:'Escape',preventDefault(){prevented++;}};
    await app.get('#character-dialog').fire('keydown',escape);
    assert.equal(prevented,1);assert.equal(app.get('#discard-confirmation').hidden,false);assert.equal(app.get('#character-dialog').open,true);
    await app.get('#character-dialog').fire('keydown',escape);
    assert.equal(prevented,2);assert.equal(app.get('#editor-body').hidden,false);assert.equal(app.get('#character-dialog').open,true);assert.equal(app.document.activeElement,pink);
    const pending=app.get('#character-form').fire('submit');
    await app.get('#character-dialog').fire('keydown',escape);await app.get('#character-dialog').fire('keydown',escape);
    assert.equal(prevented,4);assert.equal(app.get('#character-dialog').open,true);assert.equal(app.get('#discard-confirmation').hidden,true);
    resolve({ok:false,code:'QUOTA'});await pending;
  }finally{app.restore();}
});
