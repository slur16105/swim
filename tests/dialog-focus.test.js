import test from 'node:test';
import assert from 'node:assert/strict';
import { handleDialogTab } from '../src/ui/dialog-focus.js';
function fixture() {
  const document={activeElement:null};
  const node=options=>({tabIndex:0,disabled:false,visible:true,hiddenAncestor:false,
    matches(){return this.disabled;},closest(){return this.hiddenAncestor;},getClientRects(){return this.visible?[{}]:[];},focus(){document.activeElement=this;},...options});
  const title=node({tabIndex:-1}),first=node(),radio=node({type:'radio',name:'cap',checked:false}),selected=node({type:'radio',name:'cap',checked:true}),last=node(),hidden=node({hiddenAncestor:true}),disabled=node({disabled:true});
  const nodes=[title,first,radio,selected,last,hidden,disabled];
  const dialog={ownerDocument:document,querySelectorAll:()=>nodes};
  let prevented=0;
  const tab=shiftKey=>{handleDialogTab({key:'Tab',shiftKey,preventDefault(){prevented++;}},dialog,title);};
  return{document,title,first,selected,last,hidden,disabled,nodes,tab,get prevented(){return prevented;}};
}
test('Tab wraps visible enabled boundaries and title starts at first or last',()=>{
  const f=fixture();f.title.focus();f.tab(false);assert.equal(f.document.activeElement,f.first);
  f.title.focus();f.tab(true);assert.equal(f.document.activeElement,f.last);
  f.last.focus();f.tab(false);assert.equal(f.document.activeElement,f.first);
  f.first.focus();f.tab(true);assert.equal(f.document.activeElement,f.last);assert.equal(f.prevented,4);
  f.selected.focus();f.tab(false);assert.equal(f.prevented,4); // native navigation within the dialog
});
test('dirty confirmation excludes hidden editor content and wraps only its visible actions',()=>{
  const f=fixture();for(const node of f.nodes)node.hiddenAncestor=true;
  f.title.hiddenAncestor=false;f.first.hiddenAncestor=false;f.last.hiddenAncestor=false;
  f.first.focus();f.tab(true);assert.equal(f.document.activeElement,f.last);
  f.last.focus();f.tab(false);assert.equal(f.document.activeElement,f.first);
});
test('saving with no visible enabled tab stop retains focus on the title',()=>{
  const f=fixture();for(const node of f.nodes)node.disabled=true;f.title.disabled=false;
  f.tab(false);assert.equal(f.document.activeElement,f.title);f.tab(true);assert.equal(f.document.activeElement,f.title);assert.equal(f.prevented,2);
});
test('collapsed details and hidden elements are excluded and radio groups use the checked stop',()=>{
  const f=fixture();f.last.visible=false;f.selected.focus();f.tab(false);assert.equal(f.document.activeElement,f.first);
  f.first.focus();f.tab(true);assert.equal(f.document.activeElement,f.selected);
});
