// Domain model: counters are projections of immutable pull/undo events.
export const SCHEMA = 1;
export const id = () => crypto.randomUUID();
export const now = () => new Date().toISOString();
export const clone = value => structuredClone(value);
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const str = (s, max=100) => typeof s === 'string' && s.trim().length > 0 && s.length <= max;
const date = s => typeof s === 'string' && Number.isFinite(Date.parse(s));
const unique = list => new Set(list.map(x=>x.id)).size === list.length;
export function createData(generals=[]) {
  return {schemaVersion:SCHEMA,datasetId:id(),revision:id(),createdAt:now(),updatedAt:now(),activeSeasonId:null,generals:clone(generals),seasons:[],pools:[],events:[]};
}
export const activeSeason = d => d.seasons.find(s=>s.id === d.activeSeasonId);
export const currentPool = (d, sid=d.activeSeasonId) => d.pools.filter(p=>p.seasonId===sid).at(-1);
export const generalSort = (a,b) => a.reading.localeCompare(b.reading,'ja') || a.name.localeCompare(b.name,'ja');
export function project(d, sid=d.activeSeasonId) {
  const stack=[]; const cancelled=new Set();
  for (const e of d.events.filter(e=>e.seasonId===sid)) {
    if(e.type==='pull') stack.push(e);
    else {
      assert(stack.at(-1)?.id===e.targetId,'UNDOの対象と履歴の順序が一致しません。');
      cancelled.add(stack.pop().id);
    }
  }
  let pity=0,streak=0,high=0,low=0,sCount=0,intervalTotal=0;
  const rows=stack.map((e,i)=>{
    pity++;
    assert(pity<=30,'S天井30回を超える履歴があります。');
    const interval=pity;
    if(e.result==='S') {
      assert(e.general.rate==='low' || streak<5,'低排出保証と矛盾する履歴があります。');
      sCount++; intervalTotal+=interval;
      if(e.general.rate==='low'){low++;streak=0;}else{high++;streak++;}
      pity=0;
    } else assert(pity<30,'30回目が通常ガチャになっています。');
    return {...e,pullNumber:i+1,interval,streakAfter:streak,pityAfter:pity};
  });
  return {pity,streak,high,low,sCount,total:stack.length,average:sCount?intervalTotal/sCount:null,rows,cancelled};
}
export function validate(d) {
  assert(d && d.schemaVersion===SCHEMA,'対応していないデータ形式です。v0.1のJSONを選んでください。');
  assert(str(d.datasetId)&&str(d.revision)&&date(d.createdAt)&&date(d.updatedAt),'データの識別情報が不正です。');
  for(const key of ['generals','seasons','pools','events']) {
    assert(Array.isArray(d[key]) && unique(d[key]),`${key}に重複または形式不正があります。`);
    for(const x of d[key]) assert(x&&str(x.id),`${key}のIDが不正です。`);
  }
  const validGeneral = g => assert(str(g.name,40)&&str(g.faction,30)&&str(g.reading,80)&&['high','low','unknown'].includes(g.rate)&&typeof g.note==='string'&&g.note.length<=300,'武将情報が不正です。');
  d.generals.forEach(validGeneral);
  assert(d.activeSeasonId===null ? d.seasons.length===0 : d.seasons.at(-1)?.id===d.activeSeasonId,'現在シーズンが不正です。');
  const seasons=new Map(d.seasons.map(s=>[s.id,s]));
  for(const s of d.seasons){assert(str(s.name,40)&&date(s.createdAt)&&Array.isArray(s.initialGenerals),'シーズン情報が不正です。');s.initialGenerals.forEach(validGeneral);}
  const pools=new Map(d.pools.map(p=>[p.id,p]));
  for(const p of d.pools){
    assert(seasons.has(p.seasonId)&&str(p.label,80)&&date(p.createdAt)&&Array.isArray(p.generals)&&unique(p.generals),'排出プールが不正です。');
    p.generals.forEach(g=>{validGeneral(g);assert(str(g.id)&&['high','low'].includes(g.rate),'排出プールの区分が未設定です。');});
  }
  const batches=new Map();
  for(const [i,e] of d.events.entries())if(e.type==='pull'&&e.batchId){
    assert(str(e.batchId),'5連の識別情報が不正です。');
    if(!batches.has(e.batchId))batches.set(e.batchId,[]);
    batches.get(e.batchId).push({e,i});
  }
  for(const group of batches.values()){
    assert(group.length===5&&group.every(({e,i},j)=>e.result==='normal'&&i===group[0].i+j&&e.seasonId===group[0].e.seasonId&&e.poolId===group[0].e.poolId),'5連の履歴が不正です。');
  }
  let seasonOrder=-1;
  for(const e of d.events){
    const order=d.seasons.findIndex(s=>s.id===e.seasonId);
    assert(order>=seasonOrder && order>=0,'シーズンをまたぐ操作順序が不正です。');seasonOrder=order;
    assert(date(e.at)&&str(e.deviceId)&&['pull','undo'].includes(e.type),'操作情報が不正です。');
    if(e.type==='pull'){
      const p=pools.get(e.poolId);
      assert(p?.seasonId===e.seasonId&&['normal','S'].includes(e.result),'操作と排出プールが一致しません。');
      if(e.result==='S') {
        validGeneral(e.general);
        const g=p.generals.find(g=>g.id===e.general.id);
        assert(g&&JSON.stringify(g)===JSON.stringify(e.general),'S武将と記録時の排出プールが一致しません。');
      }
    }else assert(str(e.targetId),'UNDO対象が不正です。');
  }
  d.seasons.forEach(s=>project(d,s.id));
  return d;
}
export function apply(d,command,deviceId='local') {
  const n=clone(d), at=command.at||now();
  switch(command.type) {
    case 'season': {
      assert(str(command.name,40),'シーズン名を1〜40文字で入力してください。');
      assert(!n.seasons.some(s=>s.name===command.name.trim()),'同名のシーズンがすでにあります。');
      const s={id:id(),name:command.name.trim(),createdAt:at,initialGenerals:clone(n.generals)};
      n.seasons.push(s);n.activeSeasonId=s.id;break;
    }
    case 'general': {
      const g=clone(command.general), index=n.generals.findIndex(x=>x.id===g.id);
      assert(!n.generals.some(x=>x.name===g.name&&x.id!==g.id),'同名の武将がすでにあります。');
      if(index<0)n.generals.push(g);else n.generals[index]=g;
      const p=currentPool(n);
      if(p && typeof command.active==='boolean') {
        const old=p.generals.find(x=>x.id===g.id);
        const members=p.generals.filter(x=>x.id!==g.id);
        if(command.active){assert(g.rate!=='unknown','排出ONにする前に高排出／低排出を選んでください。');members.push(clone(g));}
        if((!!old)!==command.active || (old&&command.active&&JSON.stringify(old)!==JSON.stringify(g))) {
          assert(members.length>0,'排出プールを空にはできません。');
          n.pools.push({id:id(),seasonId:n.activeSeasonId,label:`武将情報更新：${g.name}`,createdAt:at,generals:members});
        }
      }
      break;
    }
    case 'rates': {
      assert(['high','low'].includes(command.rate)&&command.ids.length>0,'武将と区分を選んでください。');
      assert(command.ids.every(gid=>n.generals.some(g=>g.id===gid)),'対象武将が見つかりません。');
      n.generals.forEach(g=>{if(command.ids.includes(g.id))g.rate=command.rate;});
      const p=currentPool(n);
      if(p&&p.generals.some(g=>command.ids.includes(g.id)&&g.rate!==command.rate)) {
        const members=clone(p.generals);members.forEach(g=>{if(command.ids.includes(g.id))g.rate=command.rate;});
        n.pools.push({id:id(),seasonId:n.activeSeasonId,label:'排出区分の更新',createdAt:at,generals:members});
      }
      break;
    }
    case 'pool': {
      assert(activeSeason(n),'先にシーズンを開始してください。');
      assert(Array.isArray(command.ids)&&command.ids.length>0,'排出する武将を1人以上選んでください。');
      assert(new Set(command.ids).size===command.ids.length,'武将が重複しています。');
      const generals=command.ids.map(gid=>n.generals.find(g=>g.id===gid));
      assert(generals.every(g=>g&&g.rate!=='unknown'),'排出ONにする武将の高排出／低排出を設定してください。');
      assert(str(command.label,80),'プール名を入力してください。');
      n.pools.push({id:id(),seasonId:n.activeSeasonId,label:command.label.trim(),createdAt:at,generals:clone(generals)});break;
    }
    case 'normal': case 'normal5': case 'S': {
      const p=currentPool(n), state=project(n);
      assert(p,'初期排出プールを保存してください。');
      if(command.type==='normal5') {
        assert(state.pity<=24,'この5連にはS天井30回目が含まれます。+1と「Sが出た」で順番に記録してください。');
        const batchId=id();
        for(let i=0;i<5;i++)n.events.push({id:id(),type:'pull',at,deviceId,seasonId:n.activeSeasonId,poolId:p.id,result:'normal',batchId});
        break;
      }
      const e={id:id(),type:'pull',at,deviceId,seasonId:n.activeSeasonId,poolId:p.id,result:command.type};
      if(command.type==='normal') assert(state.pity<29,'次は30回目でS確定です。「Sが出た」から記録してください。');
      else {
        const g=p.generals.find(g=>g.id===command.generalId);
        assert(g,'この武将は現在の排出プールに含まれていません。');
        assert(g.rate==='low'||state.streak<5,'次のSは低排出確定です。武将・区分・直前の記録を確認してください。');
        e.general=clone(g);
      }
      n.events.push(e);break;
    }
    case 'undo': {
      const last=project(n).rows.at(-1);
      assert(last,'戻せる記録がありません。');
      assert(last.id===command.targetId,'直近の記録が変わりました。確認し直してください。');
      const rows=project(n).rows;
      const targets=last.batchId?rows.slice(-5).filter(e=>e.batchId===last.batchId).reverse():[last];
      for(const target of targets)n.events.push({id:id(),type:'undo',at,deviceId,seasonId:n.activeSeasonId,targetId:target.id});
      break;
    }
    default: throw new Error('未対応の操作です。');
  }
  n.revision=id();n.updatedAt=now();return validate(n);
}
