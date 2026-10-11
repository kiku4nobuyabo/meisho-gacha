import test from 'node:test';
import assert from 'node:assert/strict';
import {createData,apply,clone} from '../core.js';
import {GitHub,encode,decode,remoteKey,synchronize,ConflictError,normalizeConfig} from '../sync.js';
import {LocalStore,makeEnvelope} from '../storage.js';
const c={owner:'test-user',repo:'private-data',branch:'main',path:'data/record.json',token:'test-placeholder'};
const makeRemote=(data,sha='sha-1')=>({key:remoteKey(c),data,sha,writes:0,async read(){return {data:clone(this.data),sha:this.sha};},async write(d,expected){assert.equal(expected,this.sha);this.data=clone(d);this.sha='sha-'+(++this.writes+1);return this.sha;}});
const envelope=(data,remote,dirty=false)=>({...makeEnvelope(data),remoteKey:remote.key,baseSha:remote.sha,dirty});
const season=d=>apply(d,{type:'season',name:'S5'});
test('Unicode base64 preserves Japanese / emoji / non-BMP characters',()=>{const txt='織田信長・立花誾千代 🏯\n'+JSON.stringify(createData());assert.equal(decode(encode(txt)),txt);});
test('PC writes and smartphone fetches same data; old SHA used for update',async()=>{const base=createData(),remote=makeRemote(base);const pc=envelope(season(base),remote,true);const saved=await synchronize(pc,remote);assert.equal(saved.dirty,false);assert.equal(remote.writes,1);const phone=await synchronize(envelope(base,{...remote,sha:'sha-1'}),remote);assert.deepEqual(phone.data,pc.data);assert.equal(phone.baseSha,saved.baseSha);});
test('simultaneous edits conflict without overwriting either device',async()=>{const base=createData(),remote=makeRemote(base);const pc=envelope(season(base),remote,true);let phoneData=apply(base,{type:'season',name:'S6'});const phone=envelope(phoneData,remote,true);await synchronize(pc,remote);await assert.rejects(synchronize(phone,remote),ConflictError);assert.equal(remote.data.seasons[0].name,'S5');assert.equal(phone.data.seasons[0].name,'S6');assert.equal(remote.writes,1);});
test('lost response after successful PUT recovers without duplicate commits',async()=>{const data=season(createData()),remote=makeRemote(data,'sha-2');const local=envelope(data,remote,true);local.baseSha='sha-1';const result=await synchronize(local,remote);assert.equal(result.dirty,false);assert.equal(remote.writes,0);assert.equal(result.baseSha,'sha-2');});
test('offline failure leaves local dirty data and base SHA intact',async()=>{const data=season(createData()),remote=makeRemote(createData());remote.read=async()=>{throw new TypeError('offline');};const local=envelope(data,remote,true),before=clone(local);await assert.rejects(synchronize(local,remote),/offline/);assert.deepEqual(local,before);});
test('remote deletion and unrelated dataset never silently reset local records',async()=>{const localData=createData(),remote=makeRemote(null,null);const local=envelope(localData,remote);await assert.rejects(synchronize(local,remote),ConflictError);remote.data=createData();remote.sha='other';await assert.rejects(synchronize(local,remote),ConflictError);});
test('GET-PUT race results in conflict instead of overwrite',async()=>{const base=createData(),remote=makeRemote(base);remote.write=async()=>{remote.data=season(base);remote.sha='raced';const e=new Error('409');e.status=409;throw e;};await assert.rejects(synchronize(envelope(season(base),remote,true),remote),e=>e instanceof ConflictError&&e.remote.sha==='raced');});
test('config cannot switch remote destination silently or inject path traversal',async()=>{const remote=makeRemote(createData());const local=envelope(remote.data,remote);local.remoteKey='other';await assert.rejects(synchronize(local,remote),/一致/);assert.throws(()=>normalizeConfig({...c,path:'../record.json'}));assert.throws(()=>normalizeConfig({...c,owner:'https://evil.test'}));});
test('GitHub Contents API uses private repo, SHA, branch, valid utf8 and scoped token header',async()=>{const data=season(createData()),calls=[];const mock=async(url,options)=>{calls.push({url,options});if(options.method==='PUT')return {ok:true,json:async()=>({content:{sha:'saved'}})};if(url.includes('/branches/'))return {ok:true,json:async()=>({name:'main'})};if(url.includes('/contents/'))return {ok:true,json:async()=>({type:'file',encoding:'base64',content:encode(JSON.stringify(data)),sha:'old'})};return {ok:true,json:async()=>({private:true})};};const api=new GitHub(c,mock);await api.verify();const r=await api.read();assert.deepEqual(r.data,data);assert.equal(await api.write(data,r.sha),'saved');const req=calls.at(-1);assert.equal(req.options.headers.Authorization,'Bearer test-placeholder');assert.equal(req.options.cache,'no-store');const body=JSON.parse(req.options.body);assert.equal(body.sha,'old');assert.equal(body.branch,'main');assert.deepEqual(JSON.parse(decode(body.content)),data);assert.ok(!body.content.includes('test-placeholder'));});
test('public data repo is rejected; 404 is absent only after repository and branch verified',async()=>{const publicApi=new GitHub(c,async()=>({ok:true,json:async()=>({private:false})}));await assert.rejects(publicApi.verify(),/非公開/);let checks=0;const api=new GitHub(c,async url=>{if(url.includes('/contents/'))return {ok:false,status:404};checks++;return {ok:true,json:async()=>({private:true})};});assert.deepEqual(await api.read(),{sha:null,data:null});assert.equal(checks,2);const bad=new GitHub(c,async()=>({ok:false,status:404}));await assert.rejects(bad.read(),/権限/);});
test('local write failure never returns successful persistence; corruption is not initialized away',()=>{const values=new Map(),memory={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)};const s=new LocalStore(memory,'test');const env=makeEnvelope(createData());s.write(env);assert.deepEqual(s.read(),env);const failing=new LocalStore({...memory,setItem:()=>{throw new Error('quota');}},'test');assert.throws(()=>failing.write({...env,dirty:false}),/quota/);assert.deepEqual(s.read(),env);values.set('test','corrupted');assert.throws(()=>s.read());assert.equal(values.get('test'),'corrupted');});
test('recovery backups bounded at five, preserve original content',()=>{const memory=new Map(),store=new LocalStore({getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v)},'app');const d=createData();for(let i=0;i<7;i++)store.backup(d,'b'+i);assert.equal(store.backups().length,5);assert.equal(store.backups()[0].label,'b2');assert.deepEqual(store.backups()[4].data,d);});

// A slow GitHub round-trip must not erase an extra pull made after the request starts.
// The next sync should publish both pulls as one current snapshot.
test('late GitHub response never overwrites a newer locally stored pull',async()=>{
  const {mergeSyncResult}=await import('../sync-merge.js');
  let base=createData();base=apply(base,{type:'season',name:'S5'});
  const remote=makeRemote(base),original=envelope(base,remote,false);
  const first=apply(base,{type:'season',name:'PK3'});
  const snapshot={...original,data:first,dirty:true};
  const pending=synchronize(snapshot,remote);
  const later=apply(first,{type:'season',name:'PK4'});
  const current={...snapshot,data:later,dirty:true};
  const saved=mergeSyncResult(snapshot,current,await pending);
  assert.equal(saved.data.seasons.length,3);
  assert.equal(saved.dirty,true);
  assert.equal(saved.baseSha,remote.sha);
  const finished=await synchronize(saved,remote);
  assert.equal(finished.dirty,false);
  assert.deepEqual(remote.data,later);
  assert.equal(remote.writes,2);
});
test('remote changes during a clean sync plus a new local pull become a conflict, not an overwrite',async()=>{
  const {mergeSyncResult}=await import('../sync-merge.js');
  const base=createData(),remote=makeRemote(base),snapshot=envelope(base,remote,false);
  const current={...snapshot,data:apply(base,{type:'season',name:'local'}),dirty:true};
  remote.data=apply(base,{type:'season',name:'remote'});
  remote.sha='remote-revision';
  const result=await synchronize(snapshot,remote);
  assert.throws(()=>mergeSyncResult(snapshot,current,result),e=>e.name==='ConflictError');
  assert.equal(current.data.seasons[0].name,'local');
});
