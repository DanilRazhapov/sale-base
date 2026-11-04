import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

// Credentials arrive through stdin and are never included in result files.
const secrets = JSON.parse(await new Promise(resolve => {
  let input = ''; process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => input += chunk);
  process.stdin.on('end', () => resolve(input));
}));
const envText = await fs.readFile(new URL('../.env.local', import.meta.url), 'utf8');
const env = Object.fromEntries(envText.split(/\r?\n/).filter(x => /^[A-Z_]+=/.test(x)).map(x => {
  const i = x.indexOf('='); return [x.slice(0, i), x.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')];
}));
const base = env.VITE_SUPABASE_URL;
const key = env.VITE_SUPABASE_PUBLISHABLE_KEY;
const resumeId = process.argv[2];
if (resumeId && !/^\d{14}$/.test(resumeId)) throw new Error('Resume ID must contain 14 digits');
const runId = resumeId || new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const prefix = `ТЕСТ ${runId}`;
const dir = new URL(`../stress-results/${runId}/`, import.meta.url);
await fs.mkdir(dir, { recursive: true });
const report = resumeId ? JSON.parse(await fs.readFile(new URL('report.json', dir), 'utf8')) : { runId, prefix, startedAt: new Date().toISOString(), status: 'running', metrics: [], failures: [], stages: [], categories: [], products: [], sales: [], checks: {} };
if (report.status === 'passed') throw new Error('This run is already complete');
if (resumeId) {
  report.previousAttempts ??= [];
  report.previousAttempts.push({ status: report.status, finishedAt: report.finishedAt, failures: report.failures });
  report.failures = []; report.status = 'running'; delete report.finishedAt;
}
let ownerToken, cashierToken, store, createdShift = false, shiftId;
const save = () => fs.writeFile(new URL('report.json', dir), JSON.stringify(report, null, 2));
const log = (event, data = {}) => console.log(JSON.stringify({ event, ...data }));
async function api(label, path, body, token = key, method = 'POST') {
  const start = performance.now(); let status = 0;
  try {
    const response = await fetch(base + path, { method, headers: { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'return=representation' }, ...(method === 'GET' ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000) });
    status = response.status;
    const raw = await response.text(); let data;
    try { data = JSON.parse(raw); } catch { data = raw; }
    if (!response.ok) throw Object.assign(new Error(data?.error_description || data?.msg || data?.message || data?.error || String(raw)), { status });
    return data;
  } finally { report.metrics.push({ label, status, ms: Math.round(performance.now() - start) }); }
}
const terminal = (action, args = {}) => api(action, '/functions/v1/cashier-terminal', { action, ...(cashierToken ? { token: cashierToken } : {}), ...args });
const get = (table, query) => api(`read_${table}`, `/rest/v1/${table}?store_id=eq.${store.id}&${query}`, undefined, ownerToken, 'GET');
async function all(table, query) {
  const rows = [];
  for (let offset = 0; ; offset += 500) {
    const batch = await get(table, `${query}&order=id&offset=${offset}&limit=500`);
    rows.push(...batch); if (batch.length < 500) return rows;
  }
}
async function ownerLogin() {
  const login = await api('owner_login', '/auth/v1/token?grant_type=password', { email: secrets.email, password: secrets.password });
  ownerToken = login.access_token; return login.user.id;
}
function check(name, okay, detail) {
  report.checks[name] = { passed: Boolean(okay), ...detail };
}
async function pool(items, concurrency, worker) {
  let cursor = 0, stopped = false;
  const results = await Promise.allSettled(Array.from({ length: concurrency }, async () => {
    while (!stopped) {
      const index = cursor++; if (index >= items.length) return;
      try { await worker(items[index], index); }
      catch (error) { stopped = true; throw error; }
    }
  }));
  const failure = results.find(x => x.status === 'rejected');
  if (failure) throw failure.reason;
}
function stats(samples) {
  if (!samples.length) return null;
  const values = samples.map(x => x.ms).sort((a, b) => a - b);
  return { requests: values.length, errors: samples.filter(x => x.status < 200 || x.status >= 300).length, minMs: values[0], averageMs: Math.round(values.reduce((a, b) => a + b, 0) / values.length), p50Ms: values[Math.ceil(values.length * .5) - 1], p95Ms: values[Math.ceil(values.length * .95) - 1], maxMs: values.at(-1) };
}
try {
  log('started', { runId, reportDirectory: dir.pathname });
  const ownerId = await ownerLogin();
  const memberships = await api('owner_stores', `/rest/v1/store_members?select=stores!inner(id,name,is_active)&user_id=eq.${ownerId}&role=eq.owner&is_active=eq.true&stores.is_active=eq.true`, undefined, ownerToken, 'GET');
  const matching = memberships.map(x => x.stores).filter(x => x.name.trim().toLocaleLowerCase('ru') === secrets.storeName.trim().toLocaleLowerCase('ru'));
  if (matching.length !== 1) log('available_owner_stores', { stores: memberships.map(x => x.stores) });
  if (matching.length !== 1) throw new Error(`Expected exactly one ${secrets.storeName} store; got ${matching.length}`);
  store = matching[0]; report.store = store;
  const [cashiers, openShifts, categoriesBefore, productsBefore] = await Promise.all([
    get('cashiers', 'select=id,name,is_active&name=ilike.' + encodeURIComponent(secrets.cashierName)),
    get('cashier_shifts', 'select=id,cashier_id,opening_cash,opened_at&closed_at=is.null'),
    all('categories', 'select=id,name'), all('products', 'select=id,name,stock,price,is_active'),
    get('cashier_receipts', 'select=id&limit=1'),
  ]);
  if (cashiers.length !== 1 || !cashiers[0].is_active) throw new Error('Expected exactly one active named cashier in target store');
  if (openShifts.some(x => x.cashier_id !== cashiers[0].id)) throw new Error('Store has an open shift belonging to another cashier');
  report.baseline ??= { categoryCount: categoriesBefore.length, productCount: productsBefore.length, openShifts, cashier: cashiers[0] };
  await save(); log('preflight_ok', { store: store.name, ...report.baseline });

  await pool(Array.from({ length: 10 }, (_, i) => i), 3, async i => {
    if (report.categories[i]) return;
    const [category] = await api('create_category', '/rest/v1/categories', { store_id: store.id, name: `${prefix} категория ${String(i + 1).padStart(2, '0')}` }, ownerToken);
    report.categories[i] = category;
  });
  await save(); log('categories_created', { count: report.categories.length });
  await pool(Array.from({ length: 100 }, (_, i) => i), 5, async i => {
    if (report.products[i]) return;
    const product = await api('create_product', '/rest/v1/rpc/save_store_product', { p_store_id: store.id, p_product_id: null, p_updated_at: null, p_name: `${prefix} товар ${String(i + 1).padStart(3, '0')}`, p_category_id: report.categories[Math.floor(i / 10)].id, p_unit: 'шт', p_price: (1000 + (i % 25) * 75) / 100, p_stock: 100 }, ownerToken);
    report.products[i] = product;
  });
  await save(); log('products_created', { count: report.products.length });

  await api('owner_logout', '/auth/v1/logout?scope=local', {}, ownerToken); ownerToken = undefined;
  const login = await terminal('login', { name: secrets.cashierName, pin: secrets.pin });
  cashierToken = login.token;
  if (!cashierToken) throw new Error('Cashier login returned no session');
  let snapshot = (await terminal('snapshot')).data;
  if (snapshot.store.id !== store.id || snapshot.cashier.id !== report.baseline.cashier.id) throw new Error('Cashier logged into unexpected store or account');
  report.cashier = snapshot.cashier;
  const productMap = new Map(snapshot.products.map(p => [p.id, p]));
  if (report.products.some(p => !productMap.has(p.id))) throw new Error('Cashier catalog is missing test products');
  if (!snapshot.shift) {
    await terminal('open_shift', { opening_cash: 0 }); createdShift = true;
    snapshot = (await terminal('snapshot')).data;
  }
  if (!snapshot.shift || snapshot.shift.cashier_id !== snapshot.cashier.id) throw new Error('No own shift available');
  shiftId = snapshot.shift.id;
  report.shift = { id: shiftId, createdForTest: createdShift, openingCash: Number(snapshot.shift.opening_cash), revenueBefore: Number(snapshot.shift.revenue) };
  const plans = report.plans || Array.from({ length: 300 }, (_, i) => ({ index: i, request_id: randomUUID(), kind: 'sale', items: Array.from({ length: 1 + i % 3 }, (_, j) => {
    const p = report.products[(i + j * 17) % 100]; return { product_id: p.id, quantity: 1 + i % 2, expected_price: Number(p.price) };
  }) }));
  report.plans = plans; await save(); log('cashier_ready', { name: snapshot.cashier.name, shift: report.shift });
  for (const stage of [{ from: 0, to: 50, concurrency: 1 }, { from: 50, to: 150, concurrency: 3 }, { from: 150, to: 300, concurrency: 5 }]) {
    const start = performance.now(), metricStart = report.metrics.length;
    await pool(plans.slice(stage.from, stage.to), stage.concurrency, async plan => {
      if (report.sales.some(sale => sale.id === plan.request_id)) return;
      const { data } = await terminal('checkout', { request_id: plan.request_id, kind: plan.kind, items: plan.items });
      if (data?.id !== plan.request_id || data?.store_id !== store.id || data?.cashier_id !== snapshot.cashier.id) throw new Error('Unexpected checkout attribution');
      report.sales.push({ index: plan.index, id: data.id, total: Number(data.total), shiftId: data.shift_id });
      if (report.sales.length % 25 === 0) log('sales_progress', { completed: report.sales.length });
    });
    const seconds = (performance.now() - start) / 1000;
    const measured = { ...stage, seconds: Number(seconds.toFixed(3)), receiptsPerSecond: Number(((stage.to - stage.from) / seconds).toFixed(2)), ...stats(report.metrics.slice(metricStart).filter(x => x.label === 'checkout')) };
    report.stages.push(measured); await save(); log('stage_finished', measured);
  }
  for (const plan of [plans[0], ...plans.slice(-9)]) {
    const { data } = await api('checkout_replay', '/functions/v1/cashier-terminal', { action: 'checkout', token: cashierToken, request_id: plan.request_id, kind: plan.kind, items: plan.items });
    if (data?.id !== plan.request_id) throw new Error('Idempotency replay returned different ID');
  }
  report.idempotencyReplays = 10;
  const finalSnapshot = (await terminal('snapshot')).data;
  report.shift.revenueAfter = Number(finalSnapshot.shift?.revenue);
  report.expectedTotalCents = plans.reduce((sum, plan) => sum + plan.items.reduce((subtotal, item) => subtotal + Math.round(item.expected_price * 100) * item.quantity, 0), 0);
  check('shift_revenue', Math.round((report.shift.revenueAfter - report.shift.revenueBefore) * 100) === report.expectedTotalCents, { before: report.shift.revenueBefore, after: report.shift.revenueAfter, expectedTestRevenue: report.expectedTotalCents / 100 });
  if (createdShift && report.checks.shift_revenue.passed) {
    const closingCash = Number((report.shift.openingCash + report.shift.revenueAfter).toFixed(2));
    await terminal('close_shift', { shift_id: shiftId, closing_cash: closingCash }); report.shift.closedAfterTest = true; report.shift.closingCash = closingCash;
  }
  await terminal('logout'); cashierToken = undefined;
  await ownerLogin();
  const [categoriesAfter, productsAfter, receipts, movements, finalShift] = await Promise.all([
    all('categories', 'select=id,name'), all('products', 'select=id,name,category_id,price,stock,is_active'),
    all('cashier_receipts', `select=id,store_id,cashier_id,shift_id,total,kind,request_items&shift_id=eq.${shiftId}`),
    all('stock_movements', `select=id,product_id,quantity,direction,price_at_time,receipt_id,cashier_id,shift_id&shift_id=eq.${shiftId}`),
    get('cashier_shifts', `select=id,closed_at,closing_cash,expected_cash,automatically_closed&id=eq.${shiftId}`),
  ]);
  const receiptIds = new Set(plans.map(p => p.request_id));
  const testReceipts = receipts.filter(r => receiptIds.has(r.id));
  const testMovements = movements.filter(m => receiptIds.has(m.receipt_id));
  const receiptMap = new Map(testReceipts.map(r => [r.id, r]));
  const errors = [];
  for (const plan of plans) {
    const receipt = receiptMap.get(plan.request_id);
    if (!receipt || receipt.cashier_id !== report.cashier.id || receipt.kind !== 'sale') errors.push(`Receipt ${plan.index}: missing or incorrect cashier/kind`);
    const expected = plan.items.reduce((sum, i) => sum + Math.round(i.expected_price * 100) * i.quantity, 0);
    if (Math.round(Number(receipt?.total) * 100) !== expected) errors.push(`Receipt ${plan.index}: total mismatch`);
    const movementRows = testMovements.filter(m => m.receipt_id === plan.request_id);
    if (movementRows.length !== plan.items.length) errors.push(`Receipt ${plan.index}: movement count mismatch`);
    for (const item of plan.items) {
      const matches = movementRows.filter(m => m.product_id === item.product_id && Number(m.quantity) === item.quantity && m.direction === -1 && Number(m.price_at_time) === item.expected_price && m.cashier_id === report.cashier.id);
      if (matches.length !== 1) errors.push(`Receipt ${plan.index}: incorrect movement for ${item.product_id}`);
    }
  }
  const stockErrors = [];
  for (const original of report.products) {
    const expectedSold = plans.flatMap(p => p.items).filter(i => i.product_id === original.id).reduce((sum, i) => sum + i.quantity, 0);
    const current = productsAfter.find(p => p.id === original.id);
    if (!current || Number(current.stock) !== 100 - expectedSold || current.category_id !== original.category_id || Number(current.price) !== Number(original.price)) stockErrors.push({ product: original.name, expectedStock: 100 - expectedSold, actualStock: current?.stock });
  }
  check('categories_created', report.categories.length === 10 && report.categories.every(c => categoriesAfter.some(x => x.id === c.id && x.name === c.name)), { expected: 10, actual: report.categories.length });
  check('products_created', report.products.length === 100 && report.products.every(p => productsAfter.some(x => x.id === p.id)), { expected: 100, actual: report.products.length });
  check('receipts_exactly_300', testReceipts.length === 300 && report.sales.length === 300, { expected: 300, actual: testReceipts.length });
  check('receipt_totals_and_movements', errors.length === 0, { receiptCount: testReceipts.length, movementCount: testMovements.length, expectedMovementCount: plans.reduce((n, p) => n + p.items.length, 0), errors });
  check('stocks_and_catalog', stockErrors.length === 0, { productsChecked: 100, errors: stockErrors });
  check('test_receipts_total', testReceipts.reduce((sum, r) => sum + Math.round(Number(r.total) * 100), 0) === report.expectedTotalCents, { expected: report.expectedTotalCents / 100, actual: testReceipts.reduce((sum, r) => sum + Math.round(Number(r.total) * 100), 0) / 100 });
  check('no_negative_test_stocks', report.products.every(p => Number(productsAfter.find(x => x.id === p.id)?.stock) >= 0), {});
  if (createdShift) check('test_shift_closed', Boolean(finalShift[0]?.closed_at) && Math.round(Number(finalShift[0]?.expected_cash) * 100) === Math.round(Number(finalShift[0]?.closing_cash) * 100), { shift: finalShift[0] });
  report.totals = { categories: 10, products: 100, receipts: testReceipts.length, soldUnits: plans.flatMap(p => p.items).reduce((n, p) => n + p.quantity, 0), movements: testMovements.length, revenue: report.expectedTotalCents / 100 };
  report.status = Object.values(report.checks).every(x => x.passed) ? 'passed' : 'verification_failed';
  log('verification_finished', { status: report.status, totals: report.totals, checks: report.checks });
} catch (error) {
  report.status = 'failed'; report.failures.push({ message: error.message, status: error.status });
  log('failed', { message: error.message, status: error.status, categories: report.categories.filter(Boolean).length, products: report.products.filter(Boolean).length, sales: report.sales.length });
  process.exitCode = 1;
} finally {
  if (cashierToken) {
    try { await terminal('logout'); report.cashierLoggedOut = true; }
    catch (error) { report.failures.push({ cleanup: 'cashier_logout', message: error.message }); }
    cashierToken = undefined;
  }
  if (ownerToken) {
    try { await api('owner_logout', '/auth/v1/logout?scope=local', {}, ownerToken); }
    catch (error) { report.failures.push({ cleanup: 'owner_logout', message: error.message }); }
    ownerToken = undefined;
  }
  report.finishedAt = new Date().toISOString();
  report.checkoutStats = stats(report.metrics.filter(x => x.label === 'checkout'));
  report.requestStats = stats(report.metrics);
  await save(); log('report_saved', { runId, status: report.status, checkoutStats: report.checkoutStats, requestStats: report.requestStats });
}
