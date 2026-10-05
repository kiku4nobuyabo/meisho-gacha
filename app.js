import {seed} from './seed.js';
import {id,now,clone,createData,validate,apply,project,activeSeason,currentPool,generalSort} from './core.js';
import {LocalStore,makeEnvelope} from './storage.js';
import {GitHub,normalizeConfig,remoteKey,synchronize,ConflictError} from './sync.js';

const $=s=>document.querySelector(s), esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const app=$('#app'), dialog=$('#dialog'), body=$('#dialog-body');
const key='meisho-v1:'+location.pathname.replace(/index\.html$/,'');
const store=new LocalStore(localStorage,key);
let env,config,savedSettings,busy=false,syncError='',conflict=null,toastTimer,view={},fatal=false;
let deviceId;
const fmt=s=>new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(s));
const rateLabel=r=>({low:'低排出S',high:'高排出S',unknown:'区分未設定'}[r]);
const button=(action,label,cls='',extra='')=>`<button type="button" data-action="${action}" class="${cls}" ${extra}>${label}</button>`;
const notice=(text,type='')=>`<div class="notice ${type}">${esc(text)}</div>`;
const actionRow=(html)=>`<div class="dialog-actions">${html}</div>`;
const d=()=>env.data;
const known=()=>d().generals.filter(g=>g.rate!=='unknown').length;
const members=()=>new Set(currentPool(d())?.generals.map(g=>g.id)||[]);
const seedRateByName=new Map(seed.filter(g=>g.rate==='high'||g.rate==='low').map(g=>[g.name,g.rate]));
function migrateSeedRates(data){
  const n=clone(data);let changed=false;
  for(const g of n.generals){const rate=seedRateByName.get(g.name);if(g.rate==='unknown'&&rate){g.rate=rate;changed=true;}}
  if(changed){n.revision=id();n.updatedAt=now();validate(n);}
  return {data:n,changed};
}
function toast(message){$('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,4500);}
function show(title,html){$('#dialog-title').textContent=title;body.innerHTML=html;if(!dialog.open)dialog.showModal();dialog.scrollTop=0;}
function close(){dialog.close();view={};}
function download(data,name='meisho-backup'){const blob=new Blob([typeof data==='string'?data:JSON.stringify(data,null,2)],{type:'application/json;charset=utf-8'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`${name}-${now().replace(/[:.]/g,'-')}.json`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function statusHTML(){
  let text,level='';
  if(busy)text='保存・同期中…';
  else if(conflict){text='同期の競合あり · 記録は端末に保存済み';level='error';}
  else if(syncError){text=syncError;level='error';}
  else if(!config){text='この端末に保存中 · GitHub未接続';level='warning';}
  else if(env.dirty){text='未同期の記録があります';level='warning';}
  else text=`GitHub同期済み${env.lastSync?' · '+fmt(env.lastSync).slice(11):''}`;
  return `<div class="status-row"><div class="status" role="status"><i class="dot ${level}"></i><span>${esc(text)}</span></div>${button(conflict?'conflict':config?'sync':'github',conflict?'確認する':config?'同期':'接続設定','text-button',busy?'disabled':'')}</div>`;
}
function render(){
  if(fatal)return;
  const season=activeSeason(d()),p=currentPool(d()),s=project(d());
  if(!season){app.innerHTML=`<section class="panel"><div class="eyebrow">はじめての記録</div><h2>名将ガチャを、ひと目で。</h2><p class="help">引いたら「+1」または「Sが出た」。<br>S天井と低排出保証を、一緒に数えます。</p><div class="stack">${button('new-season','最初のシーズンを始める','primary')}${button('github','GitHubの記録を読み込む')}</div><p class="help">別の端末で記録済みなら、GitHubから読み込んでください。</p></section>${statusHTML()}<section class="panel"><h3>武将データ ${d().generals.length}人</h3><p class="help">添付一覧の名前・所属を登録済みです。排出区分と初期プールは、ゲーム内の一覧に合わせて設定してください。</p>${button('generals','武将を設定する','full')}</section>`;return;}
  const disabled=busy||!p||!!conflict;
  const recent=s.rows.slice(-6).reverse().map(e=>`<div class="log-row"><div><div class="log-time">${fmt(e.at)}</div><div class="log-main">${e.result==='S'?'S：'+esc(e.general.name):'+1'}${e.result==='S'?` <span class="pill ${e.general.rate==='low'?'low':''}">${rateLabel(e.general.rate)}</span>`:''}</div><div class="log-info">${e.result==='S'?`${e.interval}連目 · 高排出連続 ${e.streakAfter} / 5`:`シーズン通算 ${e.pullNumber}回目`}</div></div></div>`).join('');
  app.innerHTML=`<section class="panel input-panel"><div class="section-head"><div><div class="eyebrow">今日の名将ガチャ</div><h2>引いた結果を記録</h2></div><span class="season-label">${esc(season.name)}</span></div><div class="input-buttons"><button type="button" class="pull-button" data-action="normal" ${disabled?'disabled':''}><strong>+1</strong><span>S以外が出た</span></button><button type="button" class="pull-button s" data-action="choose-s" ${disabled?'disabled':''}><strong>Sが出た</strong><span>武将を選んで1回分記録</span></button></div><div class="input-foot"><span>どちらか一方だけでOK</span>${button('undo','↶ 直近1件を戻す','text-button',(!s.total||disabled)?'disabled':'')}</div>${!p?notice('初期排出プールを設定すると、記録を始められます。')+button('pool','初期排出プールを設定','primary full'):''}${p&&s.pity===29?notice('次は30回目。「Sが出た」から記録してください。','warning'):''}</section>${statusHTML()}<div class="counter-grid"><section class="panel counter"><h2>S天井</h2><div class="counter-number">${s.pity}<span>/ 30</span></div><p class="counter-caption">あと <strong>${30-s.pity}回</strong>でS確定</p><div class="progress" aria-hidden="true">${Array.from({length:30},(_,i)=>`<i class="${i<s.pity?'filled':''}"></i>`).join('')}</div></section><section class="panel counter ${s.streak===5?'guarantee':''}"><h2>低排出保証 · 高排出連続</h2><div class="counter-number">${s.streak}<span>/ 5</span></div><p class="counter-caption">${s.streak===5?'<strong>次のSは低排出確定</strong>':'低排出Sが出るとリセット'}</p><div class="streak-dots" aria-hidden="true">${Array.from({length:5},(_,i)=>`<i class="${i<s.streak?'filled':''}"></i>`).join('')}</div></section></div><div class="lower-grid"><section class="panel"><div class="section-head"><h2>直近の記録</h2>${button('history','すべて見る →','text-button')}</div>${recent||'<p class="empty">このシーズンの記録はまだありません。</p>'}</section><section class="panel"><div class="section-head"><h2>今シーズン</h2><span class="eyebrow">${esc(season.name)}</span></div><dl class="stats"><div><dt>総ガチャ回数</dt><dd>${s.total}<small>回</small></dd></div><div><dt>S排出数</dt><dd>${s.sCount}<small>体</small></dd></div><div><dt>高排出S</dt><dd>${s.high}<small>体</small></dd></div><div><dt>低排出S</dt><dd>${s.low}<small>体</small></dd></div></dl><p class="help">現在のプール：${p?esc(p.label)+' · '+p.generals.length+'人':'未設定'}</p>${p?button('current-pool','プールを見る →','text-button'):''}</section></div>`;
}
async function exclusive(fn){
  if(busy){toast('保存・同期が終わるまでお待ちください。');return false;}
  busy=true;render();
  const run=async()=>{const saved=store.read();if(saved)env=saved;return fn();};
  try{return navigator.locks?await navigator.locks.request(key,run):await run();}
  catch(e){toast(e.message||'処理できませんでした。');return false;}
  finally{busy=false;render();}
}
async function syncInside(){
  if(!config)return;
  try{env=store.write(await synchronize(env,new GitHub(config)));syncError='';conflict=null;}
  catch(e){if(e instanceof ConflictError){conflict=e.remote;syncError='';}else{syncError=e.message;}throw e;}
}
async function syncNow(quiet=false){return exclusive(async()=>{try{await syncInside();if(!quiet)toast('同期しました。');return true;}catch(e){if(!quiet)toast(e.message);return false;}});}
async function mutate(command,revision=d().revision){
  return exclusive(async()=>{
    if(conflict)throw new Error('先に同期の競合を確認してください。');
    if(env.data.revision!==revision)throw new Error('別の画面で記録が更新されました。内容を確認して操作し直してください。');
    const data=apply(d(),command,deviceId);
    const next={...env,data,dirty:true};
    store.write(next);env=next; // Only report success after durable local write.
    try{await syncInside();}catch(e){toast(e.message);}
    return true;
  });
}
function management(){show('管理',`<div class="stack">${[['seasons','シーズン管理'],['generals','武将管理'],['pool','排出プール管理'],['github','データ同期 / GitHub設定'],['backup','バックアップ / エクスポート']].map(([a,t])=>button(a,esc(t)+'<span>›</span>','menu-item')).join('')}</div><p class="help">記録日時は日本時間で表示します。</p>`);}
function seasonMenu(){show('シーズン管理',`<p class="help">現在：${esc(activeSeason(d())?.name||'未開始')}</p><div class="stack">${d().seasons.slice().reverse().map(s=>button('season-history',`${esc(s.name)} <span class="muted">${project(d(),s.id).total}回</span>`,'menu-item',`data-id="${esc(s.id)}"`)).join('')}</div>${actionRow(button('switch-confirm','シーズンを切り替える','primary'))}`);}
function switchConfirm(){show('シーズンを切り替えますか？',`<p>今のシーズンの履歴を残し、S天井・高排出連続を0から始めます。</p>${actionRow(button('seasons','NO · 戻る')+button('new-season','YES · 次へ','primary'))}`);}
function newSeason(){view={revision:d().revision};show('新しいシーズン名',`<form id="season-form"><label class="field">シーズン名<input name="name" maxlength="40" placeholder="例：S5、PK3" required autofocus autocomplete="off"></label><p class="help">名前を確定するとシーズンが切り替わり、初期排出プールの設定に進みます。</p>${actionRow(button(activeSeason(d())?'seasons':'close','キャンセル')+'<button class="primary" type="submit">シーズン名を確定</button>')}</form>`);}
function factions(list){return [...new Set(list.map(g=>g.faction))].sort((a,b)=>a.localeCompare(b,'ja'));}
function filterBar(list){return `<input id="general-search" type="search" placeholder="武将名・よみで検索" aria-label="武将名・よみで検索" autocomplete="off"><div class="filters">${['すべて',...factions(list)].map(f=>button('faction',esc(f),f===(view.faction||'すべて')?'selected':'',`data-value="${esc(f)}" aria-pressed="${f===(view.faction||'すべて')}"`)).join('')}</div>`;}
function filtered(list){const q=(view.query||'').trim().toLocaleLowerCase();return list.filter(g=>(!view.faction||view.faction==='すべて'||g.faction===view.faction)&&(!q||(g.name+g.reading).toLocaleLowerCase().includes(q))).sort(generalSort);}
function chooseS(){view={mode:'select',faction:'すべて',query:'',revision:d().revision,at:now()};const p=currentPool(d()),s=project(d());show('出たS武将を選ぶ',`<p class="help">${s.pity+1}連目として記録します。選択前ならキャンセルできます。</p>${s.streak===5?notice('次のSは低排出確定です。低排出Sを選んでください。','warning'):''}${filterBar(p.generals)}<div class="legend"><i></i>左端の色帯＝低排出S</div><div id="general-list" class="general-grid"></div>${actionRow(button('close','キャンセル'))}`);paintList();}
function generals(){view={mode:'db',faction:'すべて',query:''};show('武将管理',`<div class="row spread"><p class="help">${d().generals.length}人 · 区分設定済み ${known()}人</p>${button('add-general','＋ 武将を追加')}</div>${notice('初期97武将は高排出 / 低排出を設定済みです。新規追加武将や変更がある場合だけ編集してください。')}${button('batch-rates','高排出 / 低排出をまとめて設定','full')}${filterBar(d().generals)}<div id="general-list"></div>`);paintList();}
function batchRates(){view={mode:'batch',faction:'すべて',query:'',selected:new Set(),revision:d().revision};show('排出区分をまとめて設定',`<p class="help">同じ区分の武将を選択して、まとめて保存できます。</p>${filterBar(d().generals)}<div class="row">${button('select-visible','表示中を全選択')}${button('clear-selection','選択を解除')}</div><div id="pool-count" class="pool-count"></div><div id="general-list"></div><div class="dialog-actions">${button('set-high','高排出に設定','primary')}${button('set-low','低排出に設定')}</div>`);paintList();}
function editGeneral(gid){const g=d().generals.find(g=>g.id===gid)||{id:id(),name:'',reading:'',faction:'群雄',rate:'unknown',note:''};view={revision:d().revision,generalId:g.id};show(gid?'武将を編集':'武将を追加',`<form id="general-form"><label class="field">武将名<input name="name" value="${esc(g.name)}" maxlength="40" required></label><label class="field">よみ（五十音順に使用）<input name="reading" value="${esc(g.reading)}" maxlength="80" required><small>ひらがなで入力してください。初期データのよみも編集できます。</small></label><label class="field">所属<input name="faction" list="faction-options" value="${esc(g.faction)}" maxlength="30" required><datalist id="faction-options">${factions(d().generals).map(f=>`<option value="${esc(f)}">`).join('')}</datalist></label><label class="field">排出区分<select name="rate">${[['unknown','未設定'],['high','高排出S'],['low','低排出S']].map(([v,t])=>`<option value="${v}" ${g.rate===v?'selected':''}>${t}</option>`).join('')}</select></label><label class="check-row"><input name="active" type="checkbox" ${members().has(g.id)?'checked':''} ${!currentPool(d())?'disabled':''}>現在排出中</label><p class="help">${currentPool(d())?'ON/OFFや排出中の情報を変えると、新しい排出プール版も保存されます。':'最初のプールは「排出プール管理」で設定してください。新規武将はOFFです。'}</p><label class="field">補助情報（追加シーズンなど）<input name="note" value="${esc(g.note)}" maxlength="300" placeholder="例：S6追加"></label>${actionRow(button('generals','キャンセル')+'<button type="submit" class="primary">保存</button>')}</form>`);}
function poolEditor(){
  if(!activeSeason(d())){toast('先にシーズンを開始してください。');newSeason();return;}
  const p=currentPool(d());
  let initial=p?.generals.map(g=>g.id);
  if(!initial){const prev=d().pools.at(-1);initial=prev?.generals.map(g=>g.id)||[];}
  view={mode:'pool',faction:'すべて',query:'',selected:new Set(initial),revision:d().revision};
  show('排出プール管理',`<p class="help">${esc(activeSeason(d()).name)} · ${p?'変更を新しい版として保存します。':'初期プールを作成します。前シーズンの対象を候補として引き継いでいます。'}</p><label class="field">この版の名前<input id="pool-label" maxlength="80" value="${p?esc(fmt(now()).slice(0,10)+' プール更新'):'シーズン開始時プール'}"></label>${button('generals','武将・排出区分を設定する','full')}${filterBar(d().generals)}<div class="row">${button('select-visible','表示中を全選択')}${button('clear-selection','すべてOFF')}</div><div id="pool-count" class="pool-count"></div><div id="general-list"></div>${actionRow(button('close','キャンセル')+button('save-pool','この内容で更新','primary'))}`);paintList();
}
function paintList(){
  if(!$('#general-list'))return;
  const source=view.mode==='select'?currentPool(d()).generals:d().generals;
  const list=filtered(source),on=members();
  document.querySelectorAll('[data-action="faction"]').forEach(b=>{b.classList.toggle('selected',b.dataset.value===view.faction);b.setAttribute('aria-pressed',b.dataset.value===view.faction);});
  if(view.mode==='select')$('#general-list').innerHTML=list.map(g=>button('record-s',`<span class="general-name">${esc(g.name)}</span>`,`general-card ${g.rate==='low'?'low':''}`,`data-id="${esc(g.id)}" aria-label="${esc(g.name)} ${rateLabel(g.rate)}" ${project(d()).streak===5&&g.rate!=='low'?'disabled':''}`)).join('')||'<p class="empty">該当する武将はいません。</p>';
  else if(view.mode==='db')$('#general-list').innerHTML=list.map(g=>`<div class="db-row"><div><div class="db-name">${esc(g.name)}</div><small>${esc(g.faction)} · ${rateLabel(g.rate)} · ${on.has(g.id)?'排出ON':'OFF'}</small></div>${button('edit-general','編集','',`data-id="${esc(g.id)}"`)}</div>`).join('')||'<p class="empty">該当する武将はいません。</p>';
  else {
    $('#pool-count').textContent=`${view.selected.size}人を${view.mode==='pool'?'排出ON':'選択'} · 表示 ${list.length}人`;
    $('#general-list').innerHTML=list.map(g=>`<label class="pool-item"><input type="checkbox" data-general="${esc(g.id)}" ${view.selected.has(g.id)?'checked':''} ${view.mode==='pool'&&g.rate==='unknown'?'disabled':''}><span class="details"><strong>${esc(g.name)}</strong><small>${esc(g.faction)} · ${rateLabel(g.rate)}</small></span>${g.rate==='low'?'<span class="pill low">低排出</span>':''}</label>`).join('')||'<p class="empty">該当する武将はいません。</p>';
  }
}
function poolDetail(pid){const p=d().pools.find(p=>p.id===pid);if(!p)return;const season=d().seasons.find(s=>s.id===p.seasonId);show('記録時の排出プール',`<h3>${esc(season.name)} · ${esc(p.label)}</h3><p class="help">${fmt(p.createdAt)} · ${p.generals.length}人<br>保存当時の武将名・所属・排出区分です。</p>${factions(p.generals).map(f=>`<h3 class="notice">${esc(f)}</h3><div class="general-grid">${p.generals.filter(g=>g.faction===f).sort(generalSort).map(g=>`<div class="general-card ${g.rate==='low'?'low':''}"><span class="general-name">${esc(g.name)}</span></div>`).join('')}</div>`).join('')}<div class="legend"><i></i>低排出S</div>${actionRow(button('history','履歴へ'))}`);}
function history(sid=d().activeSeasonId,mode='S',limit=100){
  if(!sid){toast('まだシーズンがありません。');return;}
  view={mode:'history',sid,historyMode:mode,limit};const s=project(d(),sid);
  const options=d().seasons.slice().reverse().map(x=>`<option value="${esc(x.id)}" ${x.id===sid?'selected':''}>${esc(x.name)}</option>`).join('');
  const poolMap=new Map(d().pools.map(p=>[p.id,p]));
  const rows=(mode==='S'?s.rows.filter(e=>e.result==='S'):d().events.filter(e=>e.seasonId===sid)).slice().reverse();
  let content=rows.slice(0,limit).map(e=>{
    if(mode==='S')return `<article class="history-card"><div class="history-top"><small>${fmt(e.at)}</small><span class="pill ${e.general.rate==='low'?'low':''}">${rateLabel(e.general.rate)}</span></div><h3>${esc(e.general.name)}</h3><p>${e.interval}連目でS · 高排出連続 ${e.streakAfter} / 5</p><p>シーズン通算 ${e.pullNumber}回目 · ${esc(e.general.faction)}</p>${button('pool-detail',esc(poolMap.get(e.poolId).label)+' →','text-button',`data-id="${esc(e.poolId)}"`)}</article>`;
    const target=e.type==='undo'?d().events.find(x=>x.id===e.targetId):null;
    return `<div class="audit"><div class="log-time">${fmt(e.at)}</div><div class="${s.cancelled.has(e.id)?'strike':''}">${e.type==='undo'?'↶ 取消：'+(target?.result==='S'?'S '+esc(target.general.name):'+1'):e.result==='S'?'S：'+esc(e.general.name):'+1'}${s.cancelled.has(e.id)?'（取消済み）':''}</div></div>`;
  }).join('');
  show('履歴・集計',`<label class="field">シーズン<select id="history-season">${options}</select></label><dl class="stats"><div><dt>総ガチャ回数</dt><dd>${s.total}</dd></div><div><dt>S排出数</dt><dd>${s.sCount}</dd></div><div><dt>高排出S / 低排出S</dt><dd>${s.high} / ${s.low}</dd></div><div><dt>平均S間隔</dt><dd>${s.average===null?'—':s.average.toFixed(1)}<small>回</small></dd></div></dl><div class="filters">${button('history-s','S履歴',mode==='S'?'selected':'')}${button('history-all','操作ログ',mode==='all'?'selected':'')}${button('pool-history','プール履歴')}</div>${content||'<p class="empty">記録はまだありません。</p>'}${rows.length>limit?button('more-history','さらに100件表示','full'):''}`);
}
function poolHistory(){const sid=view.sid||d().activeSeasonId,pools=d().pools.filter(p=>p.seasonId===sid).reverse();show('排出プールの履歴',`<div class="stack">${pools.map(p=>button('pool-detail',`<span>${esc(p.label)}<br><small>${fmt(p.createdAt)} · ${p.generals.length}人</small></span>`,'menu-item',`data-id="${esc(p.id)}"`)).join('')||'<p class="empty">プールはまだありません。</p>'}</div>`);}
function undo(){const e=project(d()).rows.at(-1);if(!e)return;view={revision:d().revision,targetId:e.id};show('直近1件を戻しますか？',`<p class="log-time">${fmt(e.at)}</p><h3>${e.result==='S'?'S：'+esc(e.general.name):'+1'}</h3><p class="help">S天井・高排出連続・集計を、この操作の直前に戻します。取消の履歴は操作ログに残ります。</p>${actionRow(button('close','キャンセル')+button('confirm-undo','この記録を戻す','primary'))}`);}
function githubSettings(){
  const c=config||savedSettings||{};
  show('データ同期 / GitHub設定',`<p class="help">PC・スマホで同じ非公開リポジトリを指定します。トークンは端末ごとに設定してください。</p><form id="github-form"><label class="field">GitHubユーザー名（Owner）<input name="owner" value="${esc(c.owner)}" placeholder="your-name" required autocapitalize="off" spellcheck="false"></label><label class="field">記録用リポジトリ名<input name="repo" value="${esc(c.repo)}" placeholder="meisho-gacha-data" required autocapitalize="off" spellcheck="false"></label><label class="field">ブランチ<input name="branch" value="${esc(c.branch||'main')}" required autocapitalize="off" spellcheck="false"></label><label class="field">保存ファイル<input name="path" value="${esc(c.path||'data/record.json')}" required autocapitalize="off" spellcheck="false"></label><label class="field">アクセストークン<input name="token" type="password" autocomplete="off" placeholder="${c.token?'空欄なら保存済みトークンを使います':'github_pat_…'}" ${c.token?'':'required'}><small>Fine-grained token：対象リポジトリのみ / Contents: Read and write</small></label><label class="check-row"><input name="remember" type="checkbox" ${c.remember!==false?'checked':''}>この端末にトークンを保存する</label><p class="help">保存すると次回から自動同期します。トークンはこのブラウザ内に保存され、JSONバックアップや公開ファイルには入りません。共用端末では保存を外してください。</p>${actionRow(button('close','キャンセル')+'<button type="submit" class="primary">接続して確認</button>')}</form>${config?'<hr>'+button('disconnect','この端末の接続設定を解除','full'):''}<p class="help"><a href="./docs/SETUP.html" target="_blank" rel="noopener">セットアップ手順を開く ↗</a></p>`);
}
function summary(data){if(!data)return '<p>記録ファイルなし</p>';const season=activeSeason(data),s=project(data);return `<strong>${esc(season?.name||'未開始')}</strong><p>${data.seasons.length}シーズン / 操作ログ ${data.events.length}件</p><p>現シーズン ${s.total}回 / S ${s.sCount}体</p><p>S天井 ${s.pity}/30 · 高排出連続 ${s.streak}/5</p>`;}
function connectReview(c,r){view={mode:'connect',candidate:c,remote:r,revision:d().revision};show(r.data?'GitHubの記録を使いますか？':'記録ファイルを作成しますか？',`<div class="review-grid"><div><p class="eyebrow">この端末</p>${summary(d())}</div><div><p class="eyebrow">GitHub</p>${summary(r.data)}</div></div>${notice(r.data?'GitHubの記録を読み込みます。端末にある現在の記録は、復元用バックアップにも残します。':'指定先に記録ファイルはありません。この端末の記録を保存して、ほかの端末と共有します。')}${actionRow(button('github','キャンセル')+button('confirm-connect',r.data?'GitHubの記録を使う':'この端末の記録を保存','primary'))}`);}
async function confirmConnect(){
  const v=view;
  const ok=await exclusive(async()=>{
    if(d().revision!==v.revision)throw new Error('端末の記録が変わりました。接続をやり直してください。');
    const remote=new GitHub(v.candidate),r=await remote.read();
    if(r.sha!==v.remote.sha)throw new Error('GitHubの記録が更新されました。接続をやり直してください。');
    store.backup(d(),'GitHub接続前');
    let next;
    if(r.data){const migrated=migrateSeedRates(r.data);next={data:migrated.data,dirty:migrated.changed,baseSha:r.sha,remoteKey:remote.key,lastSync:now()};}
    else {const sha=await remote.write(d(),null);next={data:d(),dirty:false,baseSha:sha,remoteKey:remote.key,lastSync:now()};}
    env=store.write(next);saveConfig(v.candidate);conflict=null;syncError='';return true;
  });
  if(ok){close();toast('GitHubに接続しました。');}
}
function saveConfig(c){const saved={...c};if(!c.remember)delete saved.token;localStorage.setItem(key+':config',JSON.stringify(saved));if(c.remember)sessionStorage.removeItem(key+':token');else sessionStorage.setItem(key+':token',c.token);config=c;}
function conflictView(){if(!conflict){toast('競合はありません。');return;}view={mode:'conflict',remote:conflict,revision:d().revision};show('両方の記録を確認',`<p>同じ記録を別の端末でも更新したため、自動同期を止めています。</p><div class="review-grid"><div><p class="eyebrow">この端末</p>${summary(d())}</div><div><p class="eyebrow">GitHub</p>${summary(conflict.data)}</div></div>${notice('両方のJSONを先にまとめて保存してください。選ばなかった側の操作は自動では合流しません。必要な操作を選択後に記録し直してください。','warning')}${button('export-conflict','両方の記録をまとめて保存','primary full')}<label class="check-row"><input id="conflict-backed" type="checkbox">バックアップを保存した</label><div class="stack">${button('use-remote','GitHubの記録を使う','',!conflict.data?'disabled':'')}${button('use-local','この端末の記録でGitHubを置き換える','danger')}</div><p class="help">選択する前に、もう片方の端末では入力を止めてください。</p>`);}
async function resolveConflict(useLocal){
  const v=view;
  if(!$('#conflict-backed')?.checked){toast('先に両方の記録を保存してください。');return;}
  const ok=await exclusive(async()=>{
    if(d().revision!==v.revision)throw new Error('端末の記録が変わりました。確認し直してください。');
    const remote=new GitHub(config),r=await remote.read();
    if(r.sha!==v.remote.sha){conflict=r;throw new Error('GitHubが再度更新されました。「確認する」を開き直してください。');}
    store.backup(d(),'同期競合・端末側');if(r.data)store.backup(r.data,'同期競合・GitHub側');
    const next=useLocal?{...env,baseSha:await remote.write(d(),r.sha),dirty:false,lastSync:now()}:{...env,data:r.data,baseSha:r.sha,dirty:false,lastSync:now()};
    env=store.write(next);conflict=null;syncError='';return true;
  });if(ok){close();toast('同期を再開しました。');}
}
function backupMenu(){const backups=store.backups();show('バックアップ / エクスポート',`<div class="stack">${button('export','全シーズンをJSONで保存','primary')}${button('export-csv','S履歴をCSVで保存')}</div><p class="help">JSONには全シーズン・武将DB・全プール版・操作ログを含みます。トークンは含みません。</p><h3>JSONから復元</h3><label class="field">バックアップファイル<input id="import-file" type="file" accept=".json,application/json"></label><p class="help">内容を確認してから復元します。現在の記録を自動でバックアップします。</p><h3>この端末の復元用バックアップ</h3><p class="help">接続・インポート・競合解決の直前を最大5件保持します。</p><div class="stack">${backups.slice().reverse().map(b=>button('export-local-backup',`${esc(b.label)}<br><small>${fmt(b.at)}</small>`,'menu-item',`data-id="${esc(b.id)}"`)).join('')||'<p class="empty">まだありません。</p>'}</div>`);}
function csvExport(){const cells=v=>'"'+String(v??'').replace(/"/g,'""')+'"';const rows=[['シーズン','日時_日本時間','武将','所属','区分','S間隔','通算回数','高排出連続','プール名','プールID']];for(const season of d().seasons)for(const e of project(d(),season.id).rows.filter(x=>x.result==='S')){const p=d().pools.find(p=>p.id===e.poolId);rows.push([season.name,fmt(e.at),e.general.name,e.general.faction,rateLabel(e.general.rate),e.interval,e.pullNumber,e.streakAfter,p.label,p.id]);}const text='\uFEFF'+rows.map(r=>r.map(v=>cells(typeof v==='string'&&/^[=+@-]/.test(v)?"'"+v:v)).join(',')).join('\r\n');const a=document.createElement('a'),url=URL.createObjectURL(new Blob([text],{type:'text/csv;charset=utf-8'}));a.href=url;a.download='meisho-S-history.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function importReview(imported){validate(imported);imported=migrateSeedRates(imported).data;view={mode:'import',data:imported,revision:env?.data.revision};show('このバックアップを復元しますか？',`${summary(imported)}${notice('現在の記録をこの内容で置き換えます。全シーズンが復元対象です。GitHub接続中は、復元後の内容も同期されます。','warning')}${actionRow(button('close','キャンセル')+button('confirm-import','復元する','primary'))}`);}
async function prepareImport(file){
  if(!file)return;if(file.size>2000000)throw new Error('2MB以下のJSONを選んでください。');
  const value=JSON.parse(await file.text());
  if(value.format==='meisho-conflict-bundle-v1'){
    validate(value.local);if(value.github)validate(value.github);view={mode:'bundle',bundle:value};
    show('競合バックアップから選ぶ',`<div class="review-grid"><div><p class="eyebrow">保存時の端末側</p>${summary(value.local)}</div><div><p class="eyebrow">保存時のGitHub側</p>${summary(value.github)}</div></div>${actionRow(button('import-bundle-local','端末側を選ぶ','primary')+button('import-bundle-remote','GitHub側を選ぶ','',value.github?'':'disabled'))}`);
  }else importReview(value);
}
async function confirmImport(){const v=view;if(fatal){store.write(makeEnvelope(v.data));localStorage.removeItem(key+':config');sessionStorage.removeItem(key+':token');location.reload();return;}const ok=await exclusive(async()=>{if(d().revision!==v.revision)throw new Error('記録が更新されました。ファイルを選び直してください。');store.backup(d(),'インポート前');download(d(),'meisho-before-import');env=store.write({...env,data:v.data,dirty:true});conflict=null;try{await syncInside();}catch(e){toast(e.message);}return true;});if(ok){close();toast('バックアップを復元しました。');}}
const handlers={
  close,management,seasons:seasonMenu,'switch-confirm':switchConfirm,'new-season':newSeason,generals,'batch-rates':batchRates,'add-general':()=>editGeneral(), 'edit-general':b=>editGeneral(b.dataset.id),pool:poolEditor,
  normal:async()=>{if(project(d()).pity===29){chooseS();return;}if(await mutate({type:'normal',at:now()}))toast('+1を記録しました。');},
  'choose-s':chooseS,'record-s':async b=>{const v=view;if(await mutate({type:'S',generalId:b.dataset.id,at:v.at},v.revision)){close();toast('S武将を記録しました。');}},
  undo,'confirm-undo':async()=>{const v=view;if(await mutate({type:'undo',targetId:v.targetId},v.revision)){close();toast('直近1件を戻しました。');}},
  faction:b=>{view.faction=b.dataset.value;paintList();},
  'select-visible':()=>{filtered(d().generals).filter(g=>view.mode==='batch'||g.rate!=='unknown').forEach(g=>view.selected.add(g.id));paintList();},
  'clear-selection':()=>{view.selected.clear();paintList();},
  'set-high':()=>setRates('high'),'set-low':()=>setRates('low'),
  'save-pool':async()=>{const v=view,label=$('#pool-label').value.trim();if(await mutate({type:'pool',ids:[...v.selected],label},v.revision)){close();toast('排出プールを保存しました。');}},
  'current-pool':()=>poolDetail(currentPool(d()).id),'pool-detail':b=>poolDetail(b.dataset.id),history:()=>history(),'season-history':b=>history(b.dataset.id),'history-s':()=>history(view.sid,'S'),'history-all':()=>history(view.sid,'all'),'more-history':()=>history(view.sid,view.historyMode,view.limit+100),'pool-history':poolHistory,
  github:githubSettings,sync:()=>syncNow(), 'confirm-connect':confirmConnect,
  disconnect:async()=>{const ok=await exclusive(async()=>{localStorage.removeItem(key+':config');sessionStorage.removeItem(key+':token');config=null;savedSettings=null;env=store.write({...env,remoteKey:null,baseSha:null,dirty:true});syncError='';conflict=null;return true;});if(ok){close();toast('接続設定を解除しました。記録は端末に残っています。');}},
  conflict:conflictView,'export-conflict':()=>download({format:'meisho-conflict-bundle-v1',createdAt:now(),local:d(),github:conflict?.data},'meisho-conflict-both'),'use-remote':()=>resolveConflict(false),'use-local':()=>resolveConflict(true),
  backup:backupMenu,export:()=>download(d()),'export-csv':csvExport,'export-local-backup':b=>{const item=store.backups().find(x=>x.id===b.dataset.id);if(item)download(item.data,'meisho-recovery');},'confirm-import':confirmImport,'import-bundle-local':()=>importReview(view.bundle.local),'import-bundle-remote':()=>importReview(view.bundle.github),
  'export-raw':()=>download(localStorage.getItem(key),'meisho-recovery-raw')
};
async function setRates(rate){const v=view;if(await mutate({type:'rates',ids:[...v.selected],rate},v.revision)){generals();toast('排出区分を保存しました。');}}
document.addEventListener('click',async e=>{const b=e.target.closest('[data-action]');if(!b||b.disabled)return;if(busy){toast('保存・同期中です。少しお待ちください。');return;}try{await handlers[b.dataset.action]?.(b);}catch(err){toast(err.message);}});
$('#settings').addEventListener('click',()=>{if(!busy&&!fatal)management();});
$('#dialog-close').addEventListener('click',()=>{if(!busy)close();});
dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();});
document.addEventListener('input',e=>{if(e.target.id==='general-search'){view.query=e.target.value;paintList();}});
document.addEventListener('change',async e=>{try{if(e.target.dataset.general){if(e.target.checked)view.selected.add(e.target.dataset.general);else view.selected.delete(e.target.dataset.general);$('#pool-count').textContent=`${view.selected.size}人を${view.mode==='pool'?'排出ON':'選択'}`;}if(e.target.id==='history-season')history(e.target.value,view.historyMode);if(e.target.id==='import-file'||e.target.id==='recovery-file')await prepareImport(e.target.files[0]);}catch(err){toast(err.message);}});
document.addEventListener('submit',async e=>{
  e.preventDefault();if(busy)return;const form=e.target, f=new FormData(form),v=view;
  try{
    if(form.id==='season-form'){if(await mutate({type:'season',name:String(f.get('name')).trim()},v.revision))poolEditor();}
    if(form.id==='general-form'){
      const reading=String(f.get('reading')).trim();if(!/^[ぁ-ゖー\s]+$/.test(reading))throw new Error('よみはひらがなで入力してください。');
      const g={id:v.generalId,name:String(f.get('name')).trim(),reading,faction:String(f.get('faction')).trim(),rate:f.get('rate'),note:String(f.get('note')).trim()};
      if(await mutate({type:'general',general:g,active:f.get('active')==='on'},v.revision)){generals();toast('武将情報を保存しました。');}
    }
    if(form.id==='github-form'){
      const candidate={...normalizeConfig({owner:String(f.get('owner')),repo:String(f.get('repo')),branch:String(f.get('branch')),path:String(f.get('path')),token:String(f.get('token')).trim()||config?.token||''}),remember:f.get('remember')==='on'};
      form.elements.token.value='';
      await exclusive(async()=>{const remote=new GitHub(candidate);await remote.verify();connectReview(candidate,await remote.read());return true;});
    }
  }catch(err){toast(err.message);}
});
function initialize(){
  try{
    deviceId=localStorage.getItem(key+':device')||id();localStorage.setItem(key+':device',deviceId);
    env=store.read()||store.write(makeEnvelope(createData(seed)));
    const migrated=migrateSeedRates(env.data);
    if(migrated.changed)env=store.write({...env,data:migrated.data,dirty:true});
    const savedConfig=JSON.parse(localStorage.getItem(key+':config')||'null');savedSettings=savedConfig;
    if(savedConfig){const token=savedConfig.token||sessionStorage.getItem(key+':token');if(token)config={...savedConfig,token};else syncError='同期にはトークンの再入力が必要です。';}
    render();if(config)syncNow(true);
  }catch(e){fatal=true;app.innerHTML=`<section class="panel fatal"><h2>端末内の記録を読み込めませんでした</h2><p class="help">データを初期化せず停止しています。元データを保存してから、JSONバックアップを復元してください。</p>${notice(e.message,'error')}${button('export-raw','元データを保存','primary full')}<label class="field">正常なJSONバックアップ<input id="recovery-file" type="file" accept=".json,application/json"></label></section>`;}
}
window.addEventListener('storage',e=>{if(e.key===key&&!busy&&!fatal){try{env=store.read();render();if(dialog.open)toast('別のタブで記録が更新されました。編集中の画面は開き直してください。');}catch(err){syncError=err.message;render();}}});
async function refresh(){if(!fatal&&config&&!busy&&!dialog.open&&document.visibilityState==='visible')await syncNow(true);}
window.addEventListener('focus',refresh);window.addEventListener('online',refresh);document.addEventListener('visibilitychange',refresh);setInterval(refresh,45000);
window.addEventListener('beforeunload',e=>{if(busy){e.preventDefault();e.returnValue='';}});
initialize();
