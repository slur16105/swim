// Never imported by the production application. A memory adapter isolates all
// fixture writes from real browser data, while exercising the real app modules.
if (!import.meta.env.DEV) throw new Error('Development fixture only');
const query = new URLSearchParams(location.search);
const scenario = query.get('scenario') ?? 'new';
const record = { id:'fixture-record', date:'2026-01-01', stroke:'자유형', distance:1000, minutes:30, status:'complete', note:'preserved' };
if (['pending','paused'].includes(scenario)) record.status='pending';
const seed = scenario === 'v1' ? JSON.stringify({version:1,cap:'pink',records:[record]})
  : scenario === 'corrupt' ? '{broken'
  : ['ready','pending','paused','replay'].includes(scenario) ? JSON.stringify({version:2,revision:3,character:{cap:'green',goggles:'pink',suit:'orange'},records:[record]}) : null;
let raw = seed, writes = 0, failWrites = false, failDisplay = false, blocked = false, failReads = false;
const memory = { getItem:() => { if (scenario === 'denied' || failReads) throw new Error('denied'); return raw; }, setItem:(_key,value) => { if (failWrites) throw new DOMException('fixture','QuotaExceededError'); raw=value; writes++; } };
Object.defineProperty(window,'localStorage',{configurable:true,value:memory});
if (scenario === 'unsupported') Object.defineProperty(navigator,'locks',{configurable:true,value:undefined});
const draw = CanvasRenderingContext2D.prototype.drawImage;
CanvasRenderingContext2D.prototype.drawImage = function(...args) { if(failDisplay && ['avatar','preview-avatar'].includes(this.canvas.id)) throw new Error('fixture display failure'); return draw.apply(this,args); };
const html = new DOMParser().parseFromString(await (await fetch('/index.html')).text(),'text/html');
html.querySelectorAll('script').forEach(script=>script.remove());
document.body.replaceChildren(...document.importNode(html.body,true).childNodes);
const panel = document.createElement('details'); panel.id='fixture-controls'; panel.style.cssText='margin:16px auto 140px;max-width:448px;padding:16px;border:2px dashed #0066b3;background:#fff';
panel.innerHTML='<summary>개발 검증 도구 · 메모리 저장만 사용</summary><p id="fixture-status"></p><button id="fixture-quota">저장 실패 켜기</button> <button id="fixture-display">표시 실패 켜기</button> <button id="fixture-lock">잠금 지연 켜기</button> <button id="fixture-external">외부 변경 감지</button> <button id="fixture-corrupt">손상 주입</button> <button id="fixture-denied">읽기 차단 전환</button> <button id="fixture-stale">이전 완료 콜백</button> <button id="fixture-read">검증 결과 읽기</button><pre id="fixture-result" style="white-space:pre-wrap;overflow-wrap:anywhere"></pre>';
document.body.append(panel);
const q = id=>document.getElementById(id);
q('fixture-status').textContent=`시나리오: ${scenario}. 실제 사용자 저장소는 읽거나 쓰지 않습니다. 새로고침하면 시드로 돌아갑니다.`;
q('fixture-quota').onclick=()=>{failWrites=!failWrites;q('fixture-quota').textContent=`저장 실패 ${failWrites?'끄기':'켜기'}`;};
q('fixture-display').onclick=()=>{failDisplay=!failDisplay;q('fixture-display').textContent=`표시 실패 ${failDisplay?'끄기':'켜기'}`;};
let release;
q('fixture-lock').onclick=async()=>{ if(blocked){release?.();blocked=false;} else {blocked=true;navigator.locks.request('lane-club:write',()=>new Promise(resolve=>release=resolve));} q('fixture-lock').textContent=`잠금 지연 ${blocked?'끄기':'켜기'}`; };
q('fixture-read').onclick=()=>{q('fixture-result').textContent=JSON.stringify({scenario,writes,raw,activeElement:document.activeElement.id,character:document.querySelector('#appearance-summary').textContent,level:document.querySelector('#level-chip').textContent,xp:document.querySelector('#xp-label').textContent,feedback:document.querySelector('#character-feedback').textContent,dialogOpen:!!document.querySelector('dialog[open]'),pageOverflow:document.documentElement.scrollWidth>innerWidth},null,2);};
// Instrument the real Scene only in this development fixture.
const { PoolScene } = await import('/src/game/PoolScene.js');
let scene, playCalls=0, completion, capturedContext;
const originalCreate=PoolScene.prototype.create, originalPlay=PoolScene.prototype.play;
PoolScene.prototype.create=function(){
  scene=this;const complete=this.onComplete;
  this.onComplete=(...args)=>(completion=complete(...args));
  return originalCreate.call(this);
};
PoolScene.prototype.play=function(...args){capturedContext=args[1];playCalls++;return originalPlay.apply(this,args);};
const observe=()=>({playCalls,appearance:scene?.appearance,session:scene?.session ? structuredClone(scene.session):null,x:scene?.swimmer?.x,y:scene?.swimmer?.y,angle:scene?.swimmer?.angle,speed:scene?.speed,paused:scene?.paused});
const read=q('fixture-read').onclick;
q('fixture-read').onclick=()=>{read();q('fixture-result').textContent=JSON.stringify({...JSON.parse(q('fixture-result').textContent),scene:observe()},null,2);};
window.swimFixture={observe,get writes(){return writes;},get data(){return JSON.parse(raw);},
  set failWrites(value){failWrites=value;},
  set failReads(value){failReads=value;},
  external(value){raw=typeof value==='string'||value===null?value:JSON.stringify(value);window.dispatchEvent(new StorageEvent('storage',{key:'lane-club:v1'}));},
  staleComplete(){return capturedContext && scene.onComplete(capturedContext.id,capturedContext);},

  async finish(){if(!scene?.session)return;scene.session.travelled=scene.session.distance-1;scene.paused=false;scene.update(performance.now(),80);await completion;},
  pause(){if(scene?.session&&!scene.paused)q('pause').click();},
};
q('fixture-external').onclick=()=>window.swimFixture.external({version:2,revision:99,character:{cap:'pink',goggles:'green',suit:'pink'},records:[{...record,status:'complete'}]});
q('fixture-corrupt').onclick=()=>window.swimFixture.external('{broken');
q('fixture-denied').onclick=()=>{failReads=!failReads;q('fixture-denied').textContent=`읽기 차단 ${failReads?'끄기':'켜기'}`;window.dispatchEvent(new Event('focus'));};
q('fixture-stale').onclick=()=>window.swimFixture.staleComplete();
await import('/src/main.js');
if(scenario==='replay'){
  const start=()=>{const button=document.querySelector('#record-list button');if(button&&!button.disabled)button.click();else setTimeout(start,50);};start();
}

if(scenario==='paused'){
  const pause=()=>{if(scene?.session&&!q('pause').disabled)window.swimFixture.pause();else setTimeout(pause,50);};pause();
}
