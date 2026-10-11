import {validate,clone,id} from './core.js?v=0.1.5';
export class LocalStore {
  constructor(storage,key){this.storage=storage;this.key=key;}
  read(){const raw=this.storage.getItem(this.key);if(!raw)return null;const e=JSON.parse(raw);validate(e.data);if(typeof e.dirty!=='boolean')throw new Error('端末内データの保存状態が不正です。');return e;}
  write(envelope){validate(envelope.data);const raw=JSON.stringify(envelope);this.storage.setItem(this.key,raw);return envelope;}
  backup(data,label){
    const key=this.key+':backups';
    const list=JSON.parse(this.storage.getItem(key)||'[]');
    list.push({id:id(),label,at:new Date().toISOString(),data:clone(data)});
    this.storage.setItem(key,JSON.stringify(list.slice(-5)));
  }
  backups(){return JSON.parse(this.storage.getItem(this.key+':backups')||'[]');}
}
export const makeEnvelope = data => ({data,dirty:true,baseSha:null,remoteKey:null,lastSync:null});
