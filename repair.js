// Purpose-built PK1/PK2 season repair. Never writes remote data or changes a passed object.
import {clone, id, now, validate, project} from './core.js';

/** Split the active source season at a Japan-local date/time supplied as a UTC ISO cutoff. */
export function splitSeasonAt(data, {sourceSeasonId, newSeasonName, cutoffISO}) {
  validate(data);
  const s=data.seasons.find(x=>x.id===sourceSeasonId);
  if(!s || data.activeSeasonId!==sourceSeasonId)throw new Error('修復元は現在のシーズンにしてください。');
  const target=newSeasonName?.trim();
  if(!target||target.length>40)throw new Error('移動先シーズン名を1～40文字で入力してください。');
  if(data.seasons.some(x=>x.name===target))throw new Error('移動先と同じシーズン名がすでにあります。');
  const cutoff=Date.parse(cutoffISO);
  if(!Number.isFinite(cutoff))throw new Error('移動開始日時が不正です。');
  const sourceEvents=data.events.filter(e=>e.seasonId===sourceSeasonId);
  const moved=sourceEvents.filter(e=>Date.parse(e.at)>=cutoff);
  const before=sourceEvents.filter(e=>Date.parse(e.at)<cutoff);
  if(!moved.some(e=>e.type==='pull'))throw new Error('指定日時以降の移動対象ガチャがありません。日時を確認してください。');
  if(!before.some(e=>e.type==='pull'))throw new Error('指定日時より前のPK1記録が見つかりません。対象のシーズンと日時を確認してください。');
  // The move must cut a single suffix in operation-log order. Never reorder event history.
  const first=sourceEvents.findIndex(e=>Date.parse(e.at)>=cutoff);
  if(sourceEvents.slice(first).some(e=>Date.parse(e.at)<cutoff))throw new Error('記録日時と操作順序が前後しています。自動修復を中止しました。JSONを確認してください。');
  // UNDOs cannot reference pulls from another season after migration.
  const beforePulls=new Set(before.filter(e=>e.type==='pull').map(e=>e.id));
  if(moved.some(e=>e.type==='undo'&&beforePulls.has(e.targetId)))throw new Error('移動範囲の取消にPK1側のガチャが含まれています。自動修復できません。JSONを確認してください。');
  // Grouped 5-pulls always need to be wholly inside or outside the suffix.
  const beforeBatches=new Set(before.filter(e=>e.batchId).map(e=>e.batchId));
  if(moved.some(e=>e.batchId&&beforeBatches.has(e.batchId)))throw new Error('5連記録の途中で日時が分かれます。切替日時を変更してください。');

  const n=clone(data);
  const seasonId=id();
  n.seasons.push({id:seasonId,name:target,createdAt:new Date(cutoff).toISOString(),initialGenerals:clone(n.generals)});

  // Cross-season pool references are forbidden. Copy each pool that a moved pull used,
  // keeping the immutable general snapshot and its original name and timestamp.
  const movedPoolIds=new Set(moved.filter(e=>e.type==='pull').map(e=>e.poolId));
  // Include pool edits after cutoff (even if no pull yet) so PK2's current pool stays correct.
  for(const pool of n.pools.filter(p=>p.seasonId===sourceSeasonId && Date.parse(p.createdAt)>=cutoff))movedPoolIds.add(pool.id);
  const map=new Map();
  const movedPools=[];
  for(const pool of n.pools.filter(p=>p.seasonId===sourceSeasonId)){
    if(!movedPoolIds.has(pool.id))continue;
    const newId=id();map.set(pool.id,newId);
    movedPools.push({...clone(pool),id:newId,seasonId});
  }
  // If the last PK1 pool was used in PK2, still leave the original intact.
  n.pools.push(...movedPools);
  for(const e of n.events){
    if(e.seasonId!==sourceSeasonId||Date.parse(e.at)<cutoff)continue;
    e.seasonId=seasonId;
    if(e.type==='pull')e.poolId=map.get(e.poolId);
  }
  // Original PK1 pool edits after cutoff are not part of its history: safely remove
  // them only when no remaining PK1 event uses the pool.
  const retainedPoolIds=new Set(n.events.filter(e=>e.seasonId===sourceSeasonId&&e.type==='pull').map(e=>e.poolId));
  n.pools=n.pools.filter(p=>!(p.seasonId===sourceSeasonId&&Date.parse(p.createdAt)>=cutoff&&!retainedPoolIds.has(p.id)));
  // An original pool created earlier than cutoff may still be the current PK1 pool; it is preserved.
  n.activeSeasonId=seasonId;
  n.revision=id();n.updatedAt=now();
  try{validate(n);}catch(err){throw new Error('分離後の天井・低排出保証・操作順序に矛盾が生じました。記録を変更せず中止しました。詳細: '+err.message);}
  const b=project(n,sourceSeasonId),a=project(n,seasonId);
  return {data:n,detail:{fromName:s.name,toName:target,cutoffISO,sourceSeasonId,seasonId,original:project(data,sourceSeasonId),before:b,after:a,movedPulls:moved.filter(e=>e.type==='pull').length,movedOperations:moved.length,copiedPools:movedPools.length}};
}
