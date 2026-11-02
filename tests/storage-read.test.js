import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspectSnapshot, decode, createStore, summary, levelInfo } from '../src/model.js';
import { readSnapshot } from '../src/storage.js';
import { CHARACTER_CATALOG, DEFAULT_APPEARANCE, isAppearance } from '../src/character.js';
const record = { id:'one', date:'2026-11-01', stroke:'자유형', distance:1000, minutes:40, status:'complete', extra:{note:'보존'} };
const v1 = cap => ({version:1,cap,records:[record,{...record,id:'two',status:'pending'}]});
const v2 = () => ({version:2,revision:7,character:{...DEFAULT_APPEARANCE},records:[record]});
const inspect = value => inspectSnapshot(JSON.stringify(value));
function storage(raw) { return {getItem:()=>raw,setItem:()=>assert.fail('읽기에서 쓰기 금지'),removeItem:()=>assert.fail('읽기에서 삭제 금지')}; }
test('키 부재만 신규이며 빈 문자열과 JSON 비객체는 보호한다',()=>{
  assert.deepEqual(inspectSnapshot(null),{status:'new',data:{version:2,revision:0,character:null,records:[]},raw:null,sourceVersion:null});
  for(const raw of ['', ' ', '{broken','null','[]','false','42','"text"']) {
    const result=readSnapshot(storage(raw));assert.equal(result.status,'protected');assert.equal(result.code,'CORRUPT');assert.equal(result.raw,raw);assert.equal(result.data,null);
  }
  assert.throws(()=>decode(''));assert.throws(()=>createStore(storage('')));
});
test('세 v1 수모·기록 순서·부가값·XP를 쓰기 없이 보존한다',()=>{
  for(const cap of ['orange','pink','green']) {
    const input=v1(cap),before=structuredClone(input),raw=JSON.stringify(input);
    const result=readSnapshot(storage(raw));
    assert.equal(result.status,'ready');assert.equal(result.sourceVersion,1);assert.equal(result.raw,raw);
    assert.deepEqual(result.data.character,{cap,goggles:'dark',suit:'dark'});assert.equal(result.data.revision,0);
    assert.deepEqual(result.data.records,input.records);assert.deepEqual(input,before);
    assert.deepEqual(summary(result.data.records),summary(input.records));assert.equal(levelInfo(summary(result.data.records).xp).current,100);
    assert.deepEqual(createStore(storage(raw)).get(),input);
  }
});
test('유효 v2의 신규·생성 상태와 revision을 보존한다',()=>{
  for(const data of [v2(),{version:2,revision:19,character:null,records:[]}]) {
    const result=inspect(data);assert.deepEqual(result.data,data);assert.equal(result.sourceVersion,2);assert.equal(result.status,data.character?'ready':'new');
  }
});
test('손상 구조·revision·외형·기록과 미지원 버전을 구분한다',()=>{
  const corrupt=[{}, {...v2(),revision:-1},{...v2(),revision:1.5},{...v2(),revision:Number.MAX_SAFE_INTEGER+1},{...v2(),revision:'7'},
    {...v2(),character:null},{...v2(),character:{cap:'orange',goggles:'dark'}},{...v2(),character:{...DEFAULT_APPEARANCE,suit:'#ffffff'}},
    {...v2(),records:null},{...v2(),records:[record,record]}, {...v2(),records:[null]},
    ...[{id:''},{id:42},{status:'unknown'},{distance:26},{distance:'1000'},{minutes:0},{date:'2026-02-30'},{stroke:'none'}].map(change=>({...v2(),records:[{...record,...change}]}))];
  for(const value of corrupt)assert.equal(inspect(value).code,'CORRUPT',JSON.stringify(value));
  for(const version of [0,3,'1'])assert.equal(inspect({...v1('orange'),version}).code,'UNSUPPORTED_VERSION');
});
test('저장소 접근 차단과 잘못된 기존 앱 쓰기는 원문을 유지한다',()=>{
  assert.deepEqual(readSnapshot({getItem(){throw Error('denied');}}),{status:'protected',data:null,raw:null,sourceVersion:null,code:'STORAGE_UNAVAILABLE'});
  let raw=JSON.stringify(v1('pink')),writes=0;const adapter={getItem:()=>raw,setItem:(_,value)=>{writes++;raw=value;}};
  const store=createStore(adapter),before=raw;assert.throws(()=>store.save({...store.get(),records:[null]}));assert.equal(raw,before);assert.equal(writes,0);
  store.save({...store.get(),cap:'green'});assert.equal(writes,1);assert.equal(JSON.parse(raw).version,1);assert.deepEqual(JSON.parse(raw).records,v1('pink').records);
  const copy=store.get();copy.records[0].extra.note='변경';assert.equal(store.get().records[0].extra.note,'보존');
});
test('카탈로그는 불변이며 27개 허용 조합만 검증한다',()=>{
  for(const cap of Object.keys(CHARACTER_CATALOG.cap))for(const goggles of Object.keys(CHARACTER_CATALOG.goggles))for(const suit of Object.keys(CHARACTER_CATALOG.suit))assert.equal(isAppearance({cap,goggles,suit}),true);
  for(const value of [null,[],{}, {...DEFAULT_APPEARANCE,cap:'toString'},{...DEFAULT_APPEARANCE,suit:'#244b42'}])assert.equal(isAppearance(value),false);
  assert.throws(()=>{CHARACTER_CATALOG.cap.orange.color='#000000';});assert.throws(()=>{DEFAULT_APPEARANCE.cap='pink';});
});
test('v2·미지원·손상 읽기는 원문을 보존하고 구형 writer를 열지 않는다',()=>{
  const values=[v2(),{version:2,revision:4,character:null,records:[]},{...v2(),version:3},{...v2(),revision:-1}];
  for(const value of values){
    const raw=JSON.stringify(value),adapter=storage(raw),result=readSnapshot(adapter);
    assert.equal(result.raw,raw);assert.equal(adapter.getItem(),raw);
    assert.throws(()=>decode(raw));assert.throws(()=>createStore(adapter));assert.equal(adapter.getItem(),raw);
  }
});
test('잘못된 v1 수모와 저장 기록을 보호한다',()=>{
  for(const cap of [undefined,null,'unknown','toString']){
    const raw=JSON.stringify(v1(cap));assert.equal(readSnapshot(storage(raw)).code,'CORRUPT');assert.throws(()=>createStore(storage(raw)));
  }
  for(const bad of [{...record,id:'  '},{...record,minutes:'40'},[],{}, {...record,date:undefined},{...record,distance:undefined}]){
    for(const base of [v1('orange'),v2()])assert.equal(readSnapshot(storage(JSON.stringify({...base,records:[bad]}))).code,'CORRUPT');
  }
});
