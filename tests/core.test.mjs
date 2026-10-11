import test from 'node:test';
import assert from 'node:assert/strict';
import {createData,apply,project,currentPool,validate,clone,generalSort} from '../core.js';
import {seed} from '../seed.js';
const high={id:'high',name:'高排出武将',reading:'こうはいしゅつぶしょう',faction:'群雄',rate:'high',note:''};
const low={id:'low',name:'低排出武将',reading:'ていはいしゅつぶしょう',faction:'織田',rate:'low',note:''};
export function ready(){let d=createData([high,low]);d=apply(d,{type:'season',name:'S5'});return apply(d,{type:'pool',ids:['high','low'],label:'開始時'});}
const pull=(d,rate='high')=>apply(d,{type:'S',generalId:rate},'phone');
const normal=d=>apply(d,{type:'normal'},'pc');
const undo=d=>apply(d,{type:'undo',targetId:project(d).rows.at(-1).id});
test('supplied names remain 97 unique generals with 42 low and 55 high rates',()=>{assert.equal(seed.length,97);assert.equal(new Set(seed.map(g=>g.name)).size,97);assert.equal(seed.filter(g=>g.rate==='low').length,42);assert.equal(seed.filter(g=>g.rate==='high').length,55);assert.ok(seed.every(g=>g.rate!=='unknown'));assert.ok(seed.every(g=>g.reading));assert.deepEqual(createData(seed).pools,[]);});
test('cannot log before starting a season and saving its initial pool',()=>{assert.throws(()=>normal(createData(seed)));let d=apply(createData(seed),{type:'season',name:'S5'});assert.throws(()=>normal(d));d=apply(d,{type:'pool',ids:[seed[0].id],label:'初期'});assert.equal(currentPool(d).generals.length,1);});
test('29 ordinary pulls; 30th must be S; S counts exactly once and resets',()=>{let d=ready();for(let i=0;i<29;i++)d=normal(d);assert.equal(project(d).pity,29);assert.throws(()=>normal(d),/30回目/);d=pull(d);assert.equal(project(d).total,30);assert.equal(project(d).rows.at(-1).interval,30);assert.equal(project(d).pity,0);});
test('early S resets pity immediately, including S on consecutive pulls',()=>{let d=ready();for(let i=0;i<7;i++)d=normal(d);d=pull(d);d=pull(d,'low');assert.equal(project(d).total,9);assert.deepEqual(project(d).rows.filter(e=>e.result==='S').map(e=>e.interval),[8,1]);assert.equal(project(d).average,4.5);});
test('high x5 forces low; normal pulls do not change streak',()=>{let d=ready();for(let i=0;i<5;i++)d=pull(d);assert.equal(project(d).streak,5);d=normal(d);assert.equal(project(d).streak,5);assert.throws(()=>pull(d),/低排出確定/);d=pull(d,'low');assert.equal(project(d).streak,0);assert.equal(project(d).low,1);assert.equal(project(d).high,5);});
test('UNDO of S restores both counters, totals and acquisition history',()=>{let d=ready();for(let i=0;i<5;i++)d=pull(d);for(let i=0;i<17;i++)d=normal(d);const before=project(d);d=pull(d,'low');d=undo(d);const after=project(d);for(const k of ['pity','streak','total','sCount','high','low','average'])assert.equal(after[k],before[k]);assert.deepEqual(after.rows,before.rows);assert.equal(d.events.at(-1).type,'undo');});
test('repeated UNDO, undo normal, re-record and reload',()=>{let d=ready();d=normal(d);d=pull(d);d=undo(d);d=undo(d);assert.equal(project(d).total,0);assert.throws(()=>apply(d,{type:'undo',targetId:'none'}));d=normal(d);d=pull(d,'low');d=validate(JSON.parse(JSON.stringify(d)));assert.equal(project(d).total,2);assert.equal(project(d).low,1);assert.equal(project(d).pity,0);});
test('UNDO refuses stale target to avoid deleting another tab’s record',()=>{let d=normal(ready());const target=project(d).rows.at(-1).id;d=normal(d);assert.throws(()=>apply(d,{type:'undo',targetId:target}),/変わりました/);});
test('pool changes and DB edits cannot rewrite prior S identity or category',()=>{let d=pull(ready());const originalPool=clone(currentPool(d)),originalS=clone(project(d).rows[0]);d=apply(d,{type:'general',general:{...high,name:'改名済み',rate:'low'},active:true});assert.equal(d.pools.length,2);assert.deepEqual(d.pools[0],originalPool);assert.deepEqual(project(d).rows[0],originalS);d=pull(d);assert.equal(project(d).low,1);assert.equal(project(d).high,1);});
test('new general defaults to OFF; pool explicitly activates it',()=>{let d=ready();const g={...low,id:'new',name:'新規武将',reading:'しんきぶしょう'};d=apply(d,{type:'general',general:g,active:false});assert.ok(!currentPool(d).generals.some(x=>x.id==='new'));assert.throws(()=>apply(d,{type:'S',generalId:'new'}));d=apply(d,{type:'pool',ids:['high','new'],label:'解放'});assert.equal(currentPool(d).generals.length,2);assert.equal(d.pools[0].generals.length,2);});
test('new season resets both counters, retains old season and freezes initial DB',()=>{let d=ready();d=pull(d);d=normal(d);const oldId=d.activeSeasonId,oldProjection=project(d),oldDB=clone(d.generals);d=apply(d,{type:'season',name:'PK3'});assert.equal(project(d).pity,0);assert.equal(project(d).streak,0);assert.equal(project(d).total,0);assert.equal(currentPool(d),undefined);assert.deepEqual(project(d,oldId),oldProjection);assert.deepEqual(d.seasons[1].initialGenerals,oldDB);assert.throws(()=>normal(d));assert.throws(()=>apply(d,{type:'season',name:'PK3'}));});
test('bulk classification creates a new pool snapshot for active members',()=>{let d=ready();d=pull(d);d=apply(d,{type:'rates',ids:['high'],rate:'low'});assert.equal(currentPool(d).generals.find(g=>g.id==='high').rate,'low');assert.equal(project(d).high,1);assert.equal(d.pools[0].generals[0].rate,'high');});
test('sorting is based on kana and source faction labels are preserved',()=>{const oda=seed.filter(g=>g.faction==='織田').sort(generalSort);assert.equal(oda[0].name,'明智秀満');assert.ok(oda.findIndex(g=>g.name==='織田信長')<oda.findIndex(g=>g.name==='柴田勝家'));});
test('malformed imports rejected: version, duplicates, missing pool, altered S, impossible counter',()=>{const valid=pull(ready());const cases=[d=>d.schemaVersion=99,d=>d.generals.push(d.generals[0]),d=>d.events[0].poolId='missing',d=>d.events[0].general.rate='low',d=>d.events[0].at='broken',d=>d.activeSeasonId='none'];for(const f of cases){const d=clone(valid);f(d);assert.throws(()=>validate(d));}let d=ready();for(let i=0;i<29;i++)d=normal(d);const e=clone(d.events.at(-1));e.id='impossible';d.events.push(e);assert.throws(()=>validate(d),/30回目/);});
test('JSON export / import round-trip reproduces state and archived snapshots',()=>{let d=ready();for(let i=0;i<4;i++)d=normal(d);d=pull(d);d=undo(d);d=pull(d,'low');const restored=validate(JSON.parse(JSON.stringify(d)));assert.deepEqual(restored,d);assert.deepEqual(project(restored),project(d));});

test('one +5 records five consecutive S-free pulls as one batch, preserves original JSON format',()=>{
  let d=ready();d=apply(d,{type:'normal5'},'phone');
  const state=project(d), events=d.events;
  assert.equal(state.total,5);assert.equal(state.pity,5);assert.equal(state.sCount,0);
  assert.equal(events.length,5);assert.equal(new Set(events.map(e=>e.batchId)).size,1);
  assert.ok(events.every(e=>e.result==='normal'&&e.type==='pull'));
  assert.deepEqual(validate(JSON.parse(JSON.stringify(d))),d);
  const restored=apply(d,{type:'normal'},'pc');
  assert.equal(project(restored).total,6);assert.equal(project(restored).pity,6);
});
test('+5 respects 30-pull guarantee, and does not alter streak',()=>{
  let d=ready();for(let i=0;i<24;i++)d=normal(d);
  d=apply(d,{type:'normal5'});
  assert.equal(project(d).pity,29);
  assert.throws(()=>apply(d,{type:'normal5'}),/S天井30回目/);
  assert.throws(()=>normal(d),/30回目/);
  d=pull(d);assert.equal(project(d).total,30);assert.equal(project(d).pity,0);
  d=apply(d,{type:'normal5'});assert.equal(project(d).total,35);
  assert.equal(project(d).streak,1);
});
test('one undo cancels entire +5 batch and then can undo older single entry',()=>{
  let d=normal(ready());d=apply(d,{type:'normal5'});
  assert.equal(project(d).total,6);
  d=undo(d);assert.equal(project(d).total,1);assert.equal(project(d).pity,1);
  assert.equal(d.events.filter(e=>e.type==='undo').length,5);
  d=undo(d);assert.equal(project(d).total,0);
  assert.deepEqual(validate(JSON.parse(JSON.stringify(d))),d);
});
test('batch history validation refuses incomplete or interleaved groups',()=>{
  const d=apply(ready(),{type:'normal5'});
  const missing=clone(d);missing.events.pop();assert.throws(()=>validate(missing),/5連の履歴/);
  const injected=clone(d);injected.events.splice(2,0,{...injected.events[1],id:'other',batchId:undefined});assert.throws(()=>validate(injected),/5連の履歴/);
});
