import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

// Credentials are supplied on stdin. Reports contain no passwords, PINs or tokens.
const secrets = JSON.parse(await new Promise(resolve => {
  let input = ''; process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => input += chunk);
  process.stdin.on('end', () => resolve(input));
}));
const runId = process.argv[2];
if (!/^\d{14}$/.test(runId || '')) throw new Error('Supply a unique 14-digit run ID');
const dir = new URL(`../stress-results/dual-${runId}/`, import.meta.url);
await fs.mkdir(dir, { recursive: true });
const reportFile = new URL('report.json', dir);
try { await fs.access(reportFile); throw new Error('Run already exists; refusing duplicate operations'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const envText = await fs.readFile(new URL('../.env.local', import.meta.url), 'utf8');
const env = Object.fromEntries(envText.split(/\r?\n/).filter(x => /^[A-Z_]+=/.test(x)).map(x => {
  const i = x.indexOf('='); return [x.slice(0, i), x.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')];
}));
const base = env.VITE_SUPABASE_URL, key = env.VITE_SUPABASE_PUBLISHABLE_KEY;
const report = { runId, prefix: `СТРЕСС ${runId}`, startedAt: new Date().toISOString(), status: 'running', mode: 'two_cashiers_two_stores', metrics: [], actors: [], stages: [], failures: [], checks: {}, safetyStops: [] };
const tokens = new Map();
let ownerToken, currentStage = 'setup', activeRequests = 0, maxActiveRequests = 0;
let checkoutAttempts = 0, checkoutFailures = 0;
let loadFailure;
const save = () => fs.writeFile(reportFile, JSON.stringify(report, null, 2));
const log = (event, detail = {}) => console.log(JSON.stringify({ event, ...detail }));
function stats(rows) {
  if (!rows.length) return { requests: 0, errors: 0 };
  const sorted = rows.map(x => x.ms).sort((a,b) => a-b);
  return { requests: rows.length, errors: rows.filter(x => x.status < 200 || x.status >= 300).length, averageMs: Math.round(sorted.reduce((a,b) => a+b, 0)/rows.length), p50Ms: sorted[Math.ceil(sorted.length*.5)-1], p95Ms: sorted[Math.ceil(sorted.length*.95)-1], p99Ms: sorted[Math.ceil(sorted.length*.99)-1], maxMs: sorted.at(-1), decodedResponseBytes: rows.reduce((n,x) => n + (x.responseBytes || 0), 0) };
}
async function api(label, path, body, token = key, method = 'POST', actor = null) {
  const start = performance.now(), startedAt = new Date().toISOString(), stage = currentStage;
  let status = 0, responseBytes = 0, compressedBodyBytes = null;
  activeRequests++; maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
  try {
    const response = await fetch(base + path, { method, headers: { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'return=representation' }, ...(method === 'GET' ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000) });
    status = response.status;
    const raw = await response.text(); responseBytes = Buffer.byteLength(raw);
    if (response.headers.has('content-length')) compressedBodyBytes = Number(response.headers.get('content-length'));
    let data; try { data = JSON.parse(raw); } catch { data = raw; }
    if (!response.ok) throw Object.assign(new Error(data?.error_description || data?.msg || data?.message || data?.error || String(raw).slice(0,300)), { status });
    return data;
  } finally {
    activeRequests--;
    report.metrics.push({ label, actor, stage, status, ms: Math.round(performance.now()-start), startedAt, responseBytes, compressedBodyBytes });
  }
}
const terminal = (actor, action, args = {}, label = action) => api(label, '/functions/v1/cashier-terminal', { action, ...(tokens.get(actor.index) ? { token: tokens.get(actor.index) } : {}), ...args }, key, 'POST', actor.index);
const get = (storeId, table, query) => api(`read_${table}`, `/rest/v1/${table}?store_id=eq.${storeId}&${query}`, undefined, ownerToken, 'GET');
async function all(storeId, table, query) {
  const rows = [];
  for (let offset=0; ; offset+=500) {
    const batch = await get(storeId,table,`${query}&order=id&offset=${offset}&limit=500`);
    rows.push(...batch); if (batch.length<500) return rows;
  }
}
async function ownerLogin() {
  const login = await api('owner_login','/auth/v1/token?grant_type=password',{email:secrets.email,password:secrets.password});
  ownerToken = login.access_token; return login.user.id;
}
async function pool(items, concurrency, worker) {
  let cursor=0, stopped=false;
  const results = await Promise.allSettled(Array.from({length:concurrency},async()=>{
    while(!stopped) {
      const i=cursor++; if(i>=items.length) return;
      try { await worker(items[i],i); } catch(error) { stopped=true; throw error; }
    }
  }));
  const failed=results.find(x=>x.status==='rejected'); if(failed) throw failed.reason;
}
const centsFor = item => Math.floor((Math.round(item.expected_price*100)*Math.round(item.quantity*1000)+500)/1000);
function check(name, passed, detail={}) { report.checks[name] = {passed:Boolean(passed),...detail}; }
async function snapshot(actor, label='snapshot') {
  const {data}=await terminal(actor,'snapshot',{},label);
  if(data?.store?.id!==actor.store.id || data?.cashier?.id!==actor.cashier.id) throw new Error('Unexpected cashier/store in snapshot');
  return data;
}
async function sale(actor, plan) {
  if (loadFailure) throw loadFailure;
  let receipt;
  for(let attempt=1; attempt<=3; attempt++) {
    checkoutAttempts++;
    try {
      ({data:receipt}=await terminal(actor,'checkout',{request_id:plan.request_id,kind:'sale',items:plan.items}));
      break;
    } catch(error) {
      checkoutFailures++;
      report.failures.push({operation:'checkout',actor:actor.index,index:plan.index,attempt,status:error.status||0,message:error.message});
      const retryable=!error.status || error.status===429 || error.status>=500;
      if(!retryable || attempt===3 || (checkoutAttempts>=50 && checkoutFailures/checkoutAttempts>.1)) {
        report.safetyStops.push({checkoutAttempts,checkoutFailures,reason:error.message}); throw error;
      }
      // Reuse the same request UUID after uncertain responses, preventing duplicate sales.
      await new Promise(resolve=>setTimeout(resolve,attempt*500));
    }
  }
  const expected=plan.items.reduce((n,item)=>n+centsFor(item),0);
  if(receipt?.id!==plan.request_id || receipt?.cashier_id!==actor.cashier.id || receipt?.store_id!==actor.store.id || receipt?.shift_id!==actor.shift.id || Math.round(Number(receipt?.total)*100)!==expected) throw new Error('Unexpected receipt attribution or total');
  actor.sales.push({index:plan.index,id:receipt.id,total:Number(receipt.total)});
  await snapshot(actor,'snapshot_after_sale');
  if(actor.sales.length%100===0) log('sales_progress',{actor:actor.index,cashier:actor.cashier.name,completed:actor.sales.length});
}

try {
  log('started',{runId,directory:dir.pathname}); await save();
  const ownerId=await ownerLogin();
  const memberships=await api('owner_stores',`/rest/v1/store_members?select=stores!inner(id,name,is_active)&user_id=eq.${ownerId}&role=eq.owner&is_active=eq.true&stores.is_active=eq.true`,undefined,ownerToken,'GET');
  const stores=memberships.map(x=>x.stores).filter(s=>s.name.trim().toLocaleLowerCase('ru')==='бибика');
  if(stores.length!==1) throw new Error('Expected exactly one БИБИКА store');
  const firstStore=stores[0];
  const cashiers=await get(firstStore.id,'cashiers','select=id,name,is_active&name=ilike.'+encodeURIComponent(secrets.cashierName));
  if(cashiers.length!==1 || !cashiers[0].is_active) throw new Error('Expected one active Аллигатор cashier');
  const openShifts=await get(firstStore.id,'cashier_shifts','select=id,cashier_id,opened_at&closed_at=is.null');
  if(openShifts.some(s=>s.cashier_id!==cashiers[0].id)) throw new Error('Existing shift belongs to another cashier');
  const secondStoreName=`ТЕСТ Касса 2 ${runId}`;
  const {store:secondStore}=await api('create_store','/functions/v1/create-store',{name:secondStoreName,address:'Тестовая точка для нагрузочной проверки Supabase. Не реальный адрес.'},ownerToken);
  if(!secondStore?.id) throw new Error('Store creation returned no ID; inspect store list before repeating');
  report.createdTestStore=secondStore; await save();
  const {cashier:secondCashier}=await api('create_cashier','/functions/v1/create-cashier',{store_id:secondStore.id,name:`ТЕСТ Крокодил ${runId}`,pin:secrets.secondPin},ownerToken);
  if(!secondCashier?.id) throw new Error('Cashier creation returned no ID; inspect cashier list before repeating');
  report.actors=[{index:0,store:firstStore,cashier:cashiers[0],categories:[],products:[],sales:[]},{index:1,store:secondStore,cashier:secondCashier,categories:[],products:[],sales:[]}];
  await save(); log('second_cashier_created',{name:secondCashier.name,store:secondStore.name});
  for(const actor of report.actors) {
    await pool(Array.from({length:10},(_,i)=>i),5,async i=>{
      const [category]=await api('create_category','/rest/v1/categories',{store_id:actor.store.id,name:`${report.prefix} категория ${String(i+1).padStart(2,'0')}`},ownerToken,'POST',actor.index);
      actor.categories[i]=category;
    });
    await pool(Array.from({length:100},(_,i)=>i),5,async i=>{
      const p=await api('create_product','/rest/v1/rpc/save_store_product',{p_store_id:actor.store.id,p_product_id:null,p_updated_at:null,p_name:`${report.prefix} товар ${String(i+1).padStart(3,'0')}`,p_category_id:actor.categories[Math.floor(i/10)].id,p_unit:i%4===0?'кг':'шт',p_price:(125+(i*137)%10000)/100,p_stock:1000},ownerToken,'POST',actor.index);
      actor.products[i]=p;
    });
    await save(); log('catalog_created',{actor:actor.index,categories:actor.categories.length,products:actor.products.length});
  }
  await api('owner_logout','/auth/v1/logout?scope=local',{},ownerToken); ownerToken=undefined;
  for(const actor of report.actors) {
    const {token}=await terminal(actor,'login',{name:actor.cashier.name,pin:actor.index===0?secrets.pin:secrets.secondPin});
    if(!token) throw new Error('Cashier login returned no token'); tokens.set(actor.index,token);
    let initial=await snapshot(actor);
    if(!initial.shift) {
      await terminal(actor,'open_shift',{opening_cash:0}); actor.createdShift=true;
      initial=await snapshot(actor);
    }
    if(!initial.shift || initial.shift.cashier_id!==actor.cashier.id) throw new Error('Cashier has no own open shift');
    actor.shift={...initial.shift,revenueBefore:Number(initial.shift.revenue)};
    if(actor.products.some(p=>!initial.products.some(x=>x.id===p.id && Number(x.stock)===1000))) throw new Error('Initial test stock/catalog mismatch');
    actor.plans=Array.from({length:1000},(_,i)=>({index:i,request_id:randomUUID(),items:Array.from({length:[1,3,5,10,20][i%5]},(_,j)=>{
      const p=actor.products[(i*7+j*13)%100];
      const quantity=p.unit==='кг'?[.125,.375,.75,1.25][(i+j)%4]:1+(i+j)%3;
      return {product_id:p.id,quantity,expected_price:Number(p.price)};
    })}));
    actor.expectedTotalCents=actor.plans.reduce((n,p)=>n+p.items.reduce((s,item)=>s+centsFor(item),0),0);
    log('cashier_ready',{actor:actor.index,name:actor.cashier.name,store:actor.store.name,shiftId:actor.shift.id});
  }
  await save();
  report.loadStartedAt=new Date().toISOString();
  const loadStart=performance.now();
  for(const stage of [{name:'two_cashiers',from:0,to:200,perCashierConcurrency:1},{name:'burst_8',from:200,to:500,perCashierConcurrency:4},{name:'burst_20',from:500,to:1000,perCashierConcurrency:10}]) {
    currentStage=stage.name;
    const start=performance.now(),metricStart=report.metrics.length;
    const outcomes=await Promise.allSettled(report.actors.map(actor=>pool(actor.plans.slice(stage.from,stage.to),stage.perCashierConcurrency,async p=>{
      try { await sale(actor,p); } catch(error) { loadFailure=error; throw error; }
    })));
    const failed=outcomes.find(x=>x.status==='rejected'); if(failed) throw failed.reason;
    const seconds=(performance.now()-start)/1000;
    const metrics=report.metrics.slice(metricStart);
    const result={...stage,totalReceipts:(stage.to-stage.from)*2,seconds:Number(seconds.toFixed(3)),receiptsPerSecond:Number(((stage.to-stage.from)*2/seconds).toFixed(2)),checkout:stats(metrics.filter(x=>x.label==='checkout')),refresh:stats(metrics.filter(x=>x.label==='snapshot_after_sale')),perActor:report.actors.map(a=>({index:a.index,checkout:stats(metrics.filter(x=>x.actor===a.index && x.label==='checkout')),refresh:stats(metrics.filter(x=>x.actor===a.index && x.label==='snapshot_after_sale'))}))};
    report.stages.push(result); await save(); log('stage_finished',result);
  }
  report.loadSeconds=Number(((performance.now()-loadStart)/1000).toFixed(3));
  report.loadFinishedAt=new Date().toISOString();
  currentStage='idempotency';
  for(const actor of report.actors) {
    await pool([...actor.plans.slice(0,5),...actor.plans.slice(-5)],2,async plan=>{
      const {data}=await terminal(actor,'checkout',{request_id:plan.request_id,kind:'sale',items:plan.items},'checkout_replay');
      if(data?.id!==plan.request_id) throw new Error('Idempotency request returned wrong receipt');
    });
    const end=await snapshot(actor,'snapshot_final');
    actor.shift.revenueAfter=Number(end.shift?.revenue);
    check(`actor_${actor.index}_shift_revenue`,Math.round((actor.shift.revenueAfter-actor.shift.revenueBefore)*100)===actor.expectedTotalCents,{before:actor.shift.revenueBefore,after:actor.shift.revenueAfter,expectedTestRevenue:actor.expectedTotalCents/100});
    if(actor.createdShift && report.checks[`actor_${actor.index}_shift_revenue`].passed) {
      const closingCash=Number((Number(actor.shift.opening_cash)+actor.shift.revenueAfter).toFixed(2));
      await terminal(actor,'close_shift',{shift_id:actor.shift.id,closing_cash:closingCash}); actor.closedTestShift=true;
    }
    await terminal(actor,'logout'); tokens.delete(actor.index); actor.loggedOut=true;
  }
  currentStage='verification'; await ownerLogin();
  for(const actor of report.actors) {
    const [categories,products,receipts,movements,shifts]=await Promise.all([
      all(actor.store.id,'categories','select=id,name'),all(actor.store.id,'products','select=id,name,stock,price,unit,category_id,is_active'),
      all(actor.store.id,'cashier_receipts',`select=id,cashier_id,shift_id,kind,total,request_items&shift_id=eq.${actor.shift.id}`),
      all(actor.store.id,'stock_movements',`select=id,product_id,receipt_id,quantity,direction,price_at_time,cashier_id&shift_id=eq.${actor.shift.id}`),
      get(actor.store.id,'cashier_shifts',`select=id,closed_at,closing_cash,expected_cash&id=eq.${actor.shift.id}`),
    ]);
    const receiptMap=new Map(receipts.map(x=>[x.id,x])),movementMap=new Map();
    for(const m of movements) { if(!movementMap.has(m.receipt_id)) movementMap.set(m.receipt_id,[]); movementMap.get(m.receipt_id).push(m); }
    const stockSold=new Map(),errors=[]; let testMovements=0,totalCents=0,receiptCount=0;
    for(const plan of actor.plans) {
      const receipt=receiptMap.get(plan.request_id),rows=movementMap.get(plan.request_id)||[];
      const expected=plan.items.reduce((n,item)=>n+centsFor(item),0);
      if(receipt) { receiptCount++; totalCents+=Math.round(Number(receipt.total)*100); }
      const canonical=items=>items.map(i=>[i.product_id,Number(i.quantity),Number(i.expected_price)]).sort((a,b)=>a[0].localeCompare(b[0]));
      if(!receipt || receipt.cashier_id!==actor.cashier.id || receipt.kind!=='sale' || Math.round(Number(receipt.total)*100)!==expected || JSON.stringify(canonical(receipt.request_items))!==JSON.stringify(canonical(plan.items))) errors.push({receipt:plan.index,reason:'receipt_content'});
      if(rows.length!==plan.items.length) errors.push({receipt:plan.index,reason:'movement_count'});
      testMovements+=rows.length;
      for(const item of plan.items) {
        stockSold.set(item.product_id,(stockSold.get(item.product_id)||0)+Math.round(item.quantity*1000));
        if(rows.filter(m=>m.product_id===item.product_id && Math.round(Number(m.quantity)*1000)===Math.round(item.quantity*1000) && m.direction===-1 && Number(m.price_at_time)===item.expected_price && m.cashier_id===actor.cashier.id).length!==1) errors.push({receipt:plan.index,reason:'movement_content',product:item.product_id});
      }
    }
    const stockErrors=[];
    for(const original of actor.products) {
      const current=products.find(p=>p.id===original.id),expected=1000000-(stockSold.get(original.id)||0);
      if(!current || Math.round(Number(current.stock)*1000)!==expected || expected<0 || Number(current.price)!==Number(original.price) || current.unit!==original.unit || current.category_id!==original.category_id || !current.is_active) stockErrors.push({product:original.id,expectedStock:expected/1000,actualStock:current?.stock});
    }
    check(`actor_${actor.index}_catalog`,actor.categories.length===10 && actor.categories.every(c=>categories.some(x=>x.id===c.id&&x.name===c.name)) && actor.products.length===100,{categories:actor.categories.length,products:actor.products.length});
    check(`actor_${actor.index}_1000_receipts`,receiptCount===1000 && actor.sales.length===1000,{expected:1000,actual:receiptCount});
    check(`actor_${actor.index}_totals_and_movements`,errors.length===0 && totalCents===actor.expectedTotalCents,{errors,actualRevenue:totalCents/100,expectedRevenue:actor.expectedTotalCents/100,movements:testMovements});
    check(`actor_${actor.index}_stock`,stockErrors.length===0,{checkedProducts:100,errors:stockErrors});
    if(actor.createdShift) check(`actor_${actor.index}_closed_test_shift`,Boolean(shifts[0]?.closed_at)&&Math.round(Number(shifts[0]?.closing_cash)*100)===Math.round(Number(shifts[0]?.expected_cash)*100),{shift:shifts[0]});
    actor.verification={receipts:receiptCount,movements:testMovements,revenue:totalCents/100,stockErrors:stockErrors.length};
    log('actor_verified',{actor:actor.index,...actor.verification});
  }
  report.idempotencyReplays=20;
  report.status=Object.values(report.checks).every(x=>x.passed)?'passed':'verification_failed';
} catch(error) {
  report.status='failed'; report.failures.push({operation:currentStage,status:error.status||0,message:error.message}); process.exitCode=1;
  log('failed',{stage:currentStage,status:error.status,message:error.message});
} finally {
  currentStage='cleanup';
  for(const actor of report.actors) {
    if(tokens.has(actor.index)) {
      try { await terminal(actor,'logout'); actor.loggedOut=true; } catch(error) { report.failures.push({operation:'logout',actor:actor.index,message:error.message}); }
      tokens.delete(actor.index);
    }
  }
  if(ownerToken) { try { await api('owner_logout','/auth/v1/logout?scope=local',{},ownerToken); } catch(error) { report.failures.push({operation:'owner_logout',message:error.message}); } ownerToken=undefined; }
  report.finishedAt=new Date().toISOString();
  report.maxActiveRequests=maxActiveRequests;
  report.checkoutStats=stats(report.metrics.filter(x=>x.label==='checkout'));
  report.refreshStats=stats(report.metrics.filter(x=>x.label==='snapshot_after_sale'));
  report.allRequestStats=stats(report.metrics);
  report.edgeInvocations=report.metrics.filter(x=>['login','snapshot','open_shift','checkout','snapshot_after_sale','checkout_replay','snapshot_final','close_shift','logout','create_store','create_cashier'].includes(x.label)).length;
  await save(); log('report_saved',{status:report.status,runId,checkout:report.checkoutStats,refresh:report.refreshStats,edgeInvocations:report.edgeInvocations,actors:report.actors.map(a=>({name:a.cashier.name,sales:a.sales.length,verification:a.verification}))});
}
