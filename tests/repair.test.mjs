import test from 'node:test';
import assert from 'node:assert/strict';
import {createData, apply, clone, project, validate, currentPool} from '../core.js';
import {splitSeasonAt} from '../repair.js';
const high={id:'h',name:'高排出',reading:'こうはいしゅつ',faction:'織田',rate:'high',note:''};
const low={id:'l',name:'低排出',reading:'ていはいしゅつ',faction:'豊臣',rate:'low',note:''};
const cutoffISO='2026-10-10T02:00:00.000Z';
const before='2026-10-05T04:00:00.000Z';
const after='2026-10-10T07:00:00.000Z';
const command=(d,type,at,extra={})=>apply(d,{type,at,...extra});
const options=d=>({sourceSeasonId:d.activeSeasonId,newSeasonName:'PK2',cutoffISO});
function fixture(){
  let d=createData([high,low]);
  d=command(d,'season',before,{name:'PK1'});
  d=command(d,'pool',before,{label:'PK1開始',ids:['h','l']});
  d=command(d,'normal5',before);
  d=command(d,'S',before,{generalId:'h'});
  d=command(d,'normal',after);
  d=command(d,'normal5',after);
  d=command(d,'S',after,{generalId:'l'});
  return d;
}
test('splits Oct 5 PK1 from Oct 10 PK2, preserves IDs and S identity; resets independent counters',()=>{
  const original=fixture(); const saved=clone(original);const pk1=original.activeSeasonId;
  const result=splitSeasonAt(original,options(original));const n=result.data, newId=n.activeSeasonId;
  assert.deepEqual(original,saved);assert.notEqual(pk1,newId);
  assert.deepEqual(n.seasons.map(s=>s.name),['PK1','PK2']);
  assert.equal(project(n,pk1).total,6);assert.equal(project(n,pk1).sCount,1);
  assert.equal(project(n,newId).total,7);assert.equal(project(n,newId).sCount,1);
  assert.equal(project(n,pk1).streak,1);assert.equal(project(n,newId).streak,0);
  assert.equal(project(n,newId).pity,0);
  assert.deepEqual(n.events.map(e=>e.id),original.events.map(e=>e.id));
  assert.deepEqual(n.events.map(e=>e.at),original.events.map(e=>e.at));
  assert.deepEqual(project(n,newId).rows.filter(e=>e.result==='S').map(e=>e.general),[low]);
  assert.notEqual(n.events.at(-1).poolId,original.events.at(-1).poolId);
  assert.deepEqual(n.pools.find(p=>p.id===n.events.at(-1).poolId).generals, original.pools[0].generals);
  assert.equal(n.datasetId,original.datasetId);assert.notEqual(n.revision,original.revision);
  assert.deepEqual(validate(JSON.parse(JSON.stringify(n))),n);
  assert.equal(result.detail.movedPulls,7);
});
test('retains a new PK2-only pool and does not falsely assign it to PK1',()=>{
  let d=fixture();const originalId=d.activeSeasonId;
  d=command(d,'pool','2026-10-11T02:00:00.000Z',{label:'PK2追加プール',ids:['l']});
  const n=splitSeasonAt(d,options(d)).data;
  assert.deepEqual(n.pools.filter(p=>p.seasonId===originalId).map(p=>p.label),['PK1開始']);
  assert.deepEqual(n.pools.filter(p=>p.seasonId===n.activeSeasonId).map(p=>p.label),['PK1開始','PK2追加プール']);
  assert.equal(currentPool(n).label,'PK2追加プール');
  assert.equal(n.pools.length,3);
});
test('undo of 5-pull batch inside PK2 remains valid after move',()=>{
  let d=fixture();
  d=command(d,'normal5','2026-10-11T02:00:00.000Z');
  d=command(d,'undo','2026-10-11T02:01:00.000Z',{targetId:project(d).rows.at(-1).id});
  const n=splitSeasonAt(d,options(d)).data;
  assert.equal(project(n).total,7);
  assert.equal(n.events.filter(e=>e.type==='undo'&&e.seasonId===n.activeSeasonId).length,5);
  validate(n);
});
test('reject crossing UNDO and refuse to change source',()=>{
  let d=fixture();
  // force after-date undo of earlier PK1 operations after undoing all PK2 entries
  for(let i=0;i<3;i++)d=command(d,'undo','2026-10-10T08:00:00.000Z',{targetId:project(d).rows.at(-1).id});
  d=command(d,'undo','2026-10-10T08:00:00.000Z',{targetId:project(d).rows.at(-1).id});
  const prior=clone(d);
  assert.throws(()=>splitSeasonAt(d,options(d)),/取消/);
  assert.deepEqual(d,prior);
});
test('reject overlapping names, unsupported source, no pulls after cutoff, no pulls before cutoff',()=>{
  const d=fixture();
  assert.throws(()=>splitSeasonAt(d,{...options(d),newSeasonName:'PK1'}),/同じ/);
  assert.throws(()=>splitSeasonAt(d,{...options(d),sourceSeasonId:'x'}),/現在のシーズン/);
  assert.throws(()=>splitSeasonAt(d,{...options(d),cutoffISO:'2026-10-12T00:00:00.000Z'}),/移動対象/);
  assert.throws(()=>splitSeasonAt(d,{...options(d),cutoffISO:'2026-10-01T00:00:00.000Z'}),/PK1記録/);
});
test('reject when reset counters produce invalid separated PK2 instead of silently changing event contents',()=>{
  let d=createData([high,low]); d=command(d,'season',before,{name:'PK1'});d=command(d,'pool',before,{label:'A',ids:['h','l']});
  for(let i=0;i<29;i++)d=command(d,'normal',before);
  // first S after date has interval=30 originally; after splitting, normal + S are still valid
  d=command(d,'S',after,{generalId:'h'});
  const n=splitSeasonAt(d,options(d)).data;
  assert.equal(project(n).rows.at(-1).interval,1);
  assert.equal(project(n,n.seasons[0].id).pity,29);
});
