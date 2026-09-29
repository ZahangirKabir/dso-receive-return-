/* Billing-free canonical daily ledger. No images are stored in financial records. */
(function(global){'use strict';
const clone=x=>x==null?x:JSON.parse(JSON.stringify(x));
const cents=x=>Math.round((Number(x)||0)*100);
function id(s){const v=String(s||'').replace(/[০-৯]/g,c=>'০১২৩৪৫৬৭৮৯'.indexOf(c)).toUpperCase().replace(/[^A-Z0-9]/g,'');return v.length>=6&&v.length<=40&&/\d/.test(v)?v:'';}
function identity(s){return id(s.transactionId)?String(s.bankName||'').trim().toUpperCase()+':'+id(s.transactionId):null;}
function same(a,b){return !!(a.img&&a.img===b.img)||!!(identity(a)&&identity(a)===identity(b));}
function balance(r){const sum=a=>(a||[]).reduce((n,x)=>n+cents(x.amount),0);return cents(r.emReceived)+cents(r.cashReceived)+sum(r.dsoReceivedList)-cents(r.emReturn)-cents(r.cashDeposit)-cents(r.bankDeposit)-sum(r.dsoTransferList);}
function sync(account){
 if(!account.report)return account;
 const r=account.report,requests=account.requests||{};
 // Unlinked legacy manual slips are retained rather than silently deleted.
 const legacy=(r.slips||[]).filter(s=>!s.requestKey);
 const slips=[...legacy],submitted={},approved={};
 for(const [key,q] of Object.entries(requests)){
  if(q.status==='rejected'||q.status==='rejecting')continue;
  submitted[key]=true;if(q.status==='approved')approved[key]=true;
  for(const slip of q.slips||[])if(!slips.some(old=>same(old,slip)))slips.push({...slip,requestKey:key});
 }
 r.slips=slips;r.submittedSlipRequests=submitted;r.approvedSlipRequests=approved;
 r.bankDeposit=(slips.reduce((n,s)=>n+cents(s.amt??s.amount),0)+(account.legacyBankOffsetCents||0))/100;
 r.bankName=[...new Set(slips.map(s=>s.bankName).filter(Boolean))].join(', ');
 return account;
}
function snapshot(key,value){return {key,val:()=>clone(value),exists:()=>value!=null,numChildren:()=>Object.keys(value||{}).length,forEach(fn){for(const [k,v] of Object.entries(value||{}))if(fn(snapshot(k,v))===true)return true;return false;},child(path){let v=value;for(const p of path.split('/'))v=v?.[p];return snapshot(path.split('/').pop(),v??null);}};}
function create(raw,options={}){
 const locations=new Map(),assetCache=new Map();let ready;
 const today=()=>{const p=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Dhaka',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const v=k=>p.find(x=>x.type===k).value;return `${v('year')}-${v('month')}-${v('day')}`;};
 function accountKey(date,user){if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^\d+$/.test(String(user)))throw Error('সঠিক তারিখ ও DSO ID প্রয়োজন।');return date+'_'+user;}
 async function enabled(){if(!ready)ready=raw.ref('appConfig/ledgerSchemaVersion').once('value').then(s=>{if(s.val()!==1)throw Error('নতুন হিসাব চালু করতে Admin-কে migration.html দিয়ে একবার সেটআপ করতে বলুন।');return true;}).catch(e=>{ready=null;throw e;});return ready;}
 function learn(key,a){if(a?.reportKey)locations.set('collections/'+a.reportKey,key);for(const k of Object.keys(a?.requests||{}))locations.set('bankSlipRequests/'+k,key);}
 async function locate(root,key){const cache=locations.get(root+'/'+key);if(cache)return cache;
 const m=root==='collections'?key.match(/^daily_(\d{4}-\d{2}-\d{2})_(\d+)$/):key.match(/^(\d+)_(\d{4}-\d{2}-\d{2})_/);
 if(m){const k=root==='collections'?accountKey(m[1],m[2]):accountKey(m[2],m[1]);locations.set(root+'/'+key,k);return k;}
 const s=await raw.ref('ledgerLocations/'+root+'/'+key).once('value');if(!s.val())throw Error('এই পুরোনো হিসাবের পরিচয় পাওয়া যায়নি; migration যাচাই করুন।');locations.set(root+'/'+key,s.val());return s.val();}
 function entity(a,root,key){return root==='collections'?(a?.reportKey===key?a.report:null):a?.requests?.[key]||null;}
 function pathGet(x,parts){for(const p of parts)x=x?.[p];return x??null;}
 function pathSet(x,parts,v){if(!parts.length)return v;let n=x;for(const p of parts.slice(0,-1))n=n[p]||(n[p]={});if(v===null)delete n[parts.at(-1)];else n[parts.at(-1)]=v;return x;}
 class Ref{
  constructor(path,opts={}){this.path=path;this.parts=path.split('/');this.root=this.parts[0];this.key=this.parts.at(-1);this.opts=opts;this.listeners=[];}
  child(p){return new Ref(this.path+'/'+p,this.opts);}
  query(k,v){return new Ref(this.path,{...this.opts,[k]:v});}
  orderByChild(v){return this.query('order',v);}orderByKey(){return this.query('order','$key');}
  equalTo(v,key){return this.query('equal',[v,key]);}startAt(v,key){return this.query('start',[v,key]);}endAt(v,key){return this.query('end',[v,key]);}
  limitToLast(v){return this.query('last',v);}limitToFirst(v){return this.query('first',v);}
  async source(){await enabled();if(this.parts.length>1)return raw.ref('ledgerAccounts/'+await locate(this.root,this.parts[1]));
   let q=raw.ref('ledgerAccounts');const o=this.opts;
   if(o.userDates)return q.orderByKey().startAt(o.userDates[1]+'_').endAt(o.userDates[2]+'_\uf8ff');
   // A DSO's deposit status and submission checks need only today's account.
   if(this.root==='bankSlipRequests'&&o.order==='userId'&&o.equal){return raw.ref('ledgerAccounts/'+accountKey(today(),o.equal[0]));}
   if(o.order&&o.order!=='$key')q=q.orderByChild(o.order);else q=q.orderByKey();
   if(o.equal)q=q.equalTo(...o.equal);
   if(o.start)q=q.startAt(o.start[0]);if(o.end)q=q.endAt(o.end[0]);
   // Request pages load the selected date's small metadata, never image blobs.
   if(this.root==='collections'){if(o.last)q=q.limitToLast(o.last);if(o.first)q=q.limitToFirst(o.first);}
   return q;
  }
  project(s){if(this.parts.length>1){const a=s.val();learn(s.key,a);return snapshot(this.key,pathGet(entity(a,this.root,this.parts[1]),this.parts.slice(2)));}
   const out={};const add=(k,a)=>{if(!a||(this.opts.userDates&&String(a.userId)!==String(this.opts.userDates[0])))return;learn(k,a);if(this.root==='collections'){if(a.report)out[a.reportKey]=a.report;}else Object.assign(out,a.requests||{});};
   if(this.root==='bankSlipRequests'&&this.opts.order==='userId'&&this.opts.equal)add(s.key,s.val());else s.forEach(c=>add(c.key,c.val()));
   return snapshot(this.root,out);
  }
  async once(event,success,failure){try{if(event!=='value')throw Error('Unsupported ledger event');const q=await this.source();const s=this.project(await q.once('value'));success?.(s);return s;}catch(e){failure?.(e);throw e;}}
  on(event,fn,error){const state={event,fn,cancel:false,previous:null,q:null,handler:null};this.listeners.push(state);
   this.source().then(q=>{if(state.cancel)return;state.q=q;state.handler=s=>{if(state.cancel)return;const next=this.project(s);if(event==='value')fn(next);else{const now=next.val()||{},before=state.previous||{};for(const [k,v] of Object.entries(now)){if(event==='child_added'&&!(k in before))fn(snapshot(k,v));if(event==='child_changed'&&k in before&&JSON.stringify(v)!==JSON.stringify(before[k]))fn(snapshot(k,v));}if(event==='child_removed')for(const k of Object.keys(before))if(!(k in now))fn(snapshot(k,before[k]));state.previous=now;}};q.on('value',state.handler,error);}).catch(e=>{if(!state.cancel)error?.(e);});return fn;
  }
  off(event,fn){for(const l of this.listeners)if((!event||l.event===event)&&(!fn||l.fn===fn)){l.cancel=true;l.q?.off('value',l.handler);}this.listeners=this.listeners.filter(l=>!l.cancel);}
  async transaction(update,complete,applyLocally=false){try{await enabled();const key=this.parts[1],ak=await locate(this.root,key);const [date,userId]=ak.split('_');
   const result=await raw.ref('ledgerAccounts/'+ak).transaction(current=>{
    const a=clone(current)||{date,userId,requests:{}};const old=entity(a,this.root,key);const value=update(clone(pathGet(old,this.parts.slice(2))));if(value===undefined)return;
    const next=pathSet(clone(old)||{},this.parts.slice(2),value);
    if(this.root==='collections'){
     if(a.reportKey&&a.reportKey!==key&&a.report&&next!==null)throw Error('একই দিনের দ্বিতীয় রিপোর্ট গ্রহণযোগ্য নয়।');
     const isNew=!old;a.reportKey=key;a.report=next;
     const beforeBank=cents(next?.bankDeposit);sync(a);
     if(next&&isNew){a.report.initialSlipRequestsKnown=true;a.report.initialSlipRequests=clone(a.report.submittedSlipRequests||{});if(balance(a.report)!==0)throw Error('স্লিপের টাকা পরিবর্তিত হয়েছে; নতুন হিসাব মিলিয়ে Submit করুন।');}
     if(next&&!isNew&&this.parts.length===2&&cents(a.report.bankDeposit)!==beforeBank)throw Error('Bank Slip-এর টাকার সঙ্গে রিপোর্টের Amount মেলেনি।');
     if(next?.approvalStatus==='approved'&&(balance(a.report)!==0||Object.values(a.requests||{}).some(r=>r.status!=='approved'&&r.status!=='rejected')))throw Error('সব Slip Approved ও হিসাব সমান না হলে রিপোর্ট Approved হবে না।');
    }else{
     if(next===null)delete a.requests[key];else{
      if(String(next.userId)!==userId||next.date!==date)throw Error('স্লিপের DSO/তারিখ মেলেনি।');
      if(!old&&next.status!=='rejected'&&Object.values(a.requests||{}).some(r=>r.status!=='rejected'&&(r.slips||[]).some(s=>(next.slips||[]).some(t=>same(s,t)))))throw Error('এই ছবি বা Transaction ID আগে জমা হয়েছে।');
      next.slips=(next.slips||[]).map(s=>({...s,requestKey:key}));next.amount=next.slips.reduce((n,s)=>n+cents(s.amt??s.amount),0)/100;a.requests[key]=next;
     }
     sync(a);if(a.report)a.report.approvalStatus='pending';
    }
    return a;
   },undefined,applyLocally);
   learn(ak,result.snapshot.val());const out={committed:result.committed,snapshot:snapshot(this.key,pathGet(entity(result.snapshot.val(),this.root,key),this.parts.slice(2)))};complete?.(null,out.committed,out.snapshot);return out;
  }catch(e){complete?.(e,false,null);throw e;}}
  async set(v){return this.transaction(()=>v);}
  async update(v){return this.transaction(old=>{const out=clone(old)||{};for(const [k,x] of Object.entries(v))pathSet(out,k.split('/'),x);return out;});}
  async remove(){return this.set(null);}
 }
 const db={ref(path=''){const root=path.split('/')[0];return root==='collections'||root==='bankSlipRequests'?new Ref(path):raw.ref(path);}};
 async function thumbnail(data){if(!global.document?.createElement)return '';return new Promise(resolve=>{let done=false;const img=new Image();const finish=v=>{if(done)return;done=true;clearTimeout(timer);resolve(v);};const timer=setTimeout(()=>finish(''),8000);img.onerror=()=>finish('');img.onload=()=>{try{const scale=Math.min(1,160/img.naturalWidth,160/img.naturalHeight);const c=document.createElement('canvas');c.width=Math.max(1,Math.round(img.naturalWidth*scale));c.height=Math.max(1,Math.round(img.naturalHeight*scale));const context=c.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,c.width,c.height);context.drawImage(img,0,0,c.width,c.height);finish(c.toDataURL('image/jpeg',0.65));}catch(_){finish('');}};img.src=data;});}
 async function putImage(data){if(!/^data:image\//.test(data))return data;const bytes=new TextEncoder().encode(data);const [hash,small]=await Promise.all([crypto.subtle.digest('SHA-256',bytes),thumbnail(data)]);const key=[...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join('');const r=await raw.ref('slipImages/'+key).transaction(v=>v===null?{data,...(small?{thumbnail:small}:{})}:undefined,undefined,false);if(!r.snapshot.val()?.data)throw Error('স্লিপের ছবি সেভ হয়নি।');return 'rtdb:'+key;}
 async function imageData(value,small=false){if(!String(value).startsWith('rtdb:'))return value;const key=value.slice(5);if(!/^[a-f0-9]{64}$/.test(key))throw Error('স্লিপের ছবির পরিচয় সঠিক নয়।');const cacheKey=key+(small?':thumbnail':':data');if(assetCache.has(cacheKey))return assetCache.get(cacheKey);const result=raw.ref('slipImages/'+key+'/'+(small?'thumbnail':'data')).once('value').then(async s=>{if(!s.val()&&small)return imageData(value,false);if(!s.val())throw Error('স্লিপের ছবি পাওয়া যায়নি।');return s.val();}).catch(e=>{assetCache.delete(cacheKey);throw e;});assetCache.set(cacheKey,result);if(assetCache.size>12)assetCache.delete(assetCache.keys().next().value);return result;}
 return {database:db,raw,enabled,putImage,imageData,accountKey,requestsForDate:(date)=>new Ref('bankSlipRequests',{order:'date',equal:[date]}),collectionsRange:(user,start,end)=>new Ref('collections',{userDates:[String(user),start,end]}),reset:()=>{ready=null;}};
}
global.PortalLedger={create,sync,balance,same,snapshot};
})(typeof window!=='undefined'?window:globalThis);
