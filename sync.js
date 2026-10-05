import {validate} from './core.js';
export function normalizeConfig(c){
  const n={owner:c.owner.trim(),repo:c.repo.trim(),branch:c.branch.trim()||'main',path:c.path.trim()||'data/record.json',token:c.token.trim()};
  if(!/^[A-Za-z0-9-]+$/.test(n.owner)||!/^[A-Za-z0-9_.-]+$/.test(n.repo)||!n.token)throw new Error('所有者・リポジトリ名・トークンを入力してください。');
  if(!/^[A-Za-z0-9_./-]+\.json$/.test(n.path)||n.path.startsWith('/')||n.path.split('/').some(s=>!s||s==='.'||s==='..'))throw new Error('保存先は data/record.json のような相対パスにしてください。');
  if(n.branch.length>200||/[\x00-\x20?~^:*\[\\]/.test(n.branch))throw new Error('ブランチ名を確認してください。');
  return n;
}
export const remoteKey = c => JSON.stringify([c.owner.toLowerCase(),c.repo.toLowerCase(),c.branch,c.path]);
export const encode = text => {const bytes=new TextEncoder().encode(text);let out='';for(let i=0;i<bytes.length;i+=8192)out+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(out);};
export const decode = text => new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(atob(text.replace(/\s/g,'')),c=>c.charCodeAt(0)));
export class ConflictError extends Error {
  constructor(remote){super('別の端末から更新されています。両方の記録を確認してください。');this.name='ConflictError';this.remote=remote;}
}
export class GitHub {
  constructor(config,fetcher=null){this.config=normalizeConfig(config);this.fetcher=fetcher||globalThis.fetch.bind(globalThis);this.key=remoteKey(this.config);}
  get root(){const c=this.config;return `https://api.github.com/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}`;}
  get file(){return `${this.root}/contents/${this.config.path.split('/').map(encodeURIComponent).join('/')}`;}
  async request(url,options={}){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
    try{
      const response=await this.fetcher(url,{cache:'no-store',...options,signal:controller.signal,headers:{Accept:'application/vnd.github+json',Authorization:`Bearer ${this.config.token}`,'X-GitHub-Api-Version':'2022-11-28',...(options.body?{'Content-Type':'application/json'}:{}),...options.headers}});
      if(response.ok)return response.json();
      const e=new Error(response.status===401?'トークンが無効または期限切れです。':response.status===403?'GitHubへのアクセスが拒否されました。権限・利用制限を確認してください。':response.status===404?'リポジトリ・ブランチ・権限を確認してください。':response.status===409||response.status===422?'GitHubの更新が競合しました。もう一度同期してください。':`GitHubとの通信に失敗しました（${response.status}）。`);e.status=response.status;throw e;
    }catch(e){if(e.name==='AbortError')throw new Error('同期がタイムアウトしました。記録は端末に保存されています。');throw e;}finally{clearTimeout(timer);}
  }
  async verify(){
    const repo=await this.request(this.root);
    if(!repo.private)throw new Error('記録用には非公開（Private）リポジトリを指定してください。');
    await this.request(`${this.root}/branches/${encodeURIComponent(this.config.branch)}`);
    return repo;
  }
  async read(){
    let f;
    try{f=await this.request(`${this.file}?ref=${encodeURIComponent(this.config.branch)}`);}catch(e){if(e.status===404){await this.verify();return {sha:null,data:null};}throw e;}
    if(f.type!=='file'||f.encoding!=='base64'||typeof f.content!=='string'||!f.sha)throw new Error('保存先JSONの形式またはサイズを確認してください（v0.1は1MB未満）。');
    return {sha:f.sha,data:validate(JSON.parse(decode(f.content)))};
  }
  async write(data,sha){
    validate(data);const text=JSON.stringify(data,null,2)+'\n';
    if(new TextEncoder().encode(text).length>950000)throw new Error('データがv0.1の同期サイズ上限に近づきました。JSONを保存して拡張してください。');
    const body={message:'Update gacha record',content:encode(text),branch:this.config.branch};if(sha)body.sha=sha;
    const r=await this.request(this.file,{method:'PUT',body:JSON.stringify(body)});
    if(!r.content?.sha)throw new Error('保存結果を確認できませんでした。再同期してください。');
    return r.content.sha;
  }
}
export async function synchronize(envelope,remote){
  if(envelope.remoteKey!==remote.key)throw new Error('同期先が一致しません。GitHub設定から接続し直してください。');
  const r=await remote.read(), synced=()=>new Date().toISOString();
  // Recover from a lost PUT response without duplicating the operation.
  if(r.data&&JSON.stringify(r.data)===JSON.stringify(envelope.data))return {...envelope,baseSha:r.sha,dirty:false,lastSync:synced()};
  if(!envelope.dirty){
    if(!r.data)throw new ConflictError(r);
    if(r.data.datasetId!==envelope.data.datasetId)throw new ConflictError(r);
    return {...envelope,data:r.data,baseSha:r.sha,lastSync:synced()};
  }
  if(r.sha!==envelope.baseSha || (r.data&&r.data.datasetId!==envelope.data.datasetId))throw new ConflictError(r);
  let sha;
  try {sha=await remote.write(envelope.data,r.sha);}catch(e){if(e.status===409||e.status===422)throw new ConflictError(await remote.read());throw e;}
  return {...envelope,baseSha:sha,dirty:false,lastSync:synced()};
}
