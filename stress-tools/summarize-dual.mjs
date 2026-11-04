import fs from 'node:fs/promises';
const runId=process.argv[2];
if(!/^\d{14}$/.test(runId||'')) throw new Error('Supply run ID');
const dir=new URL(`../stress-results/dual-${runId}/`,import.meta.url);
const r=JSON.parse(await fs.readFile(new URL('report.json',dir),'utf8'));
const before=JSON.parse(await fs.readFile(new URL('database-before.json',dir),'utf8')).rows[0].snapshot;
const after=JSON.parse(await fs.readFile(new URL('database-after.json',dir),'utf8')).rows[0].snapshot;
const size=(snapshot,name)=>snapshot.tables.find(t=>t.schema==='public'&&t.table===name)?.bytes||0;
const orderTables=['cashier_receipts','stock_movements'];
const orderBytesBefore=orderTables.reduce((n,t)=>n+size(before,t),0);
const orderBytesAfter=orderTables.reduce((n,t)=>n+size(after,t),0);
const confirmed=r.actors.reduce((n,a)=>n+(a.verification?.receipts||0),0);
const historyBytesPerReceipt=(orderBytesAfter-orderBytesBefore)/Math.max(confirmed,1);
const previousQueries=new Map(before.queries.map(q=>[q.queryid,q]));
const queryDeltas=after.queries.map(q=>({operation:q.operation,calls:q.calls-(previousQueries.get(q.queryid)?.calls||0),executionMs:q.total_exec_time-(previousQueries.get(q.queryid)?.total_exec_time||0)})).filter(x=>x.calls>0);
const sql=Object.fromEntries(['checkout','snapshot'].map(operation=>{
  const rows=queryDeltas.filter(q=>q.operation===operation),calls=rows.reduce((n,q)=>n+q.calls,0),ms=rows.reduce((n,q)=>n+q.executionMs,0);
  return[operation,{calls,totalExecutionMs:Math.round(ms),averageExecutionMs:calls?Number((ms/calls).toFixed(2)):null}];
}));
const perActor=r.actors.map(a=>{
  const rows=r.metrics.filter(m=>m.actor===a.index&&m.label==='snapshot_after_sale');
  const allBodySizes=rows.map(x=>x.responseBytes);
  const wire=rows.filter(x=>x.compressedBodyBytes!==null);
  return{index:a.index,name:a.cashier.name,store:a.store.name,receipts:a.verification?.receipts,movements:a.verification?.movements,revenue:a.verification?.revenue,averageDecodedSnapshotBytes:Math.round(allBodySizes.reduce((n,x)=>n+x,0)/Math.max(rows.length,1)),contentLengthSamples:wire.length,averageContentLengthBytes:wire.length?Math.round(wire.reduce((n,x)=>n+x.compressedBodyBytes,0)/wire.length):null};
});
const dailyModels=[100,500,1000].map(receiptsPerCashier=>{
  const receiptsPerDay=receiptsPerCashier*2;
  const maximumIdlePollsPerDay=2*8*3600/15;
  const monthlyInvocationsEstimate=30*(receiptsPerDay*2+maximumIdlePollsPerDay);
  const decodedSnapshotBytesPerDay=perActor.reduce((n,a)=>n+a.averageDecodedSnapshotBytes*(receiptsPerCashier+8*3600/15),0);
  return{receiptsPerCashier,receiptsPerDay,monthlyInvocationsEstimate,monthlyDecodedSnapshotGB:Number((30*decodedSnapshotBytesPerDay/1e9).toFixed(3)),monthlyHistoryGrowthMB:Number((30*receiptsPerDay*historyBytesPerReceipt/1e6).toFixed(2)),approxDaysTo500MB:historyBytesPerReceipt>0?Number(((500e6-after.database_bytes)/(receiptsPerDay*historyBytesPerReceipt)).toFixed(1)):null};
});
r.capacityAnalysis={databaseBytesBefore:before.database_bytes,databaseBytesAfter:after.database_bytes,databaseDeltaBytes:after.database_bytes-before.database_bytes,historyTableBytesBefore:orderBytesBefore,historyTableBytesAfter:orderBytesAfter,historyBytesPerReceipt:Number(historyBytesPerReceipt.toFixed(2)),deadlocksDelta:after.database_stats.deadlocks-before.database_stats.deadlocks,sql,perActor,dailyModels,notes:['Monthly estimates assume two cashiers, 8-hour shifts and 30 working days. Idle polling is an upper estimate because the UI skips refresh while busy.','Decoded JSON byte counts are application payload sizes, not actual Supabase billable egress. Compression, other services and users can change billing.','Physical table growth includes indexes, page allocation, initial stock movements and dead tuples; retention estimates are rough and cannot predict exact quota dates.','Database statistics cover the entire project and may include concurrent unrelated activity.','No CPU, RAM, WAL disk utilization or month-to-date quota meter was measured.']};
await fs.writeFile(new URL('report.json',dir),JSON.stringify(r,null,2));
const mb=n=>(n/1e6).toFixed(2),f=n=>Number(n).toLocaleString('ru-RU');
const lines=[
'# Стресс-тест двух кассиров: SaleBase / Supabase', '',
`Результат: **${r.status==='passed'?'пройден':r.status}**. Дата: 1 ноября 2026 года (Бишкек, UTC+6).`, '',
`По ${perActor.map(a=>a.receipts).join(' и ')} новых чеков на кассира; всего ${confirmed}. Нагрузочная часть заняла ${r.loadSeconds} с.`,
'Параллельные кассы работали в двух магазинах одного Supabase-проекта. Второй магазин согласован с пользователем: текущее приложение разрешает только одну открытую смену на магазин.', '',
'## Результаты по кассирам', '',
'| Кассир | Магазин | Чеков | Строк списаний | Выручка |',
'| --- | --- | ---: | ---: | ---: |',
...perActor.map(a=>`| ${a.name} | ${a.store} | ${a.receipts} | ${a.movements} | ${f(a.revenue)} |`),'',
'Для каждого кассира создано 10 новых тестовых категорий и 100 товаров с начальным остатком 1000 единиц. Чеки содержали 1, 3, 5, 10 или 20 разных товаров; включены весовые количества до трёх знаков и округление сумм до копеек. Префикс: `'+r.prefix+'`.', '',
'## Этапы нагрузки', '',
'| Этап | Потоков всего | Новых чеков | Время, с | Чеков/с | Продажа среднее / p95 / p99, мс | Обновление среднее / p95, мс | Ошибки продажи / обновления |',
'| --- | ---: | ---: | ---: | ---: | --- | --- | --- |',
...r.stages.map(s=>`| ${s.name} | ${s.perCashierConcurrency*2} | ${s.totalReceipts} | ${s.seconds} | ${s.receiptsPerSecond} | ${s.checkout.averageMs} / ${s.checkout.p95Ms} / ${s.checkout.p99Ms} | ${s.refresh.averageMs} / ${s.refresh.p95Ms} | ${s.checkout.errors} / ${s.refresh.errors} |`),'',
'Первый этап — по одному последовательному потоку на кассира, без пауз человека между чеками. После каждого сохранения запрашивался полный снимок каталога/смены, как в интерфейсе. Последующие этапы — искусственные всплески с 4 и 10 параллельными потоками на одну PIN-сессию; это проверка запаса под нагрузкой, а не буквальная скорость работы двух людей.',
`Всего запросов checkout: ${r.checkoutStats.requests}; ошибок: ${r.checkoutStats.errors}; среднее ${r.checkoutStats.averageMs} мс, p95 ${r.checkoutStats.p95Ms} мс, p99 ${r.checkoutStats.p99Ms} мс, максимум ${r.checkoutStats.maxMs} мс.`,
`Обновлений после продажи: ${r.refreshStats.requests}; ошибок: ${r.refreshStats.errors}; p95 ${r.refreshStats.p95Ms} мс. Максимум одновременно выполнявшихся HTTP-запросов: ${r.maxActiveRequests}.`, '',
'## Целостность данных', '',
`Пройдено ${Object.values(r.checks).filter(c=>c.passed).length} из ${Object.keys(r.checks).length} проверок.`,
'Каждый тестовый чек повторно прочитан под владельцем: проверены кассир, магазин/смена, состав и сумма. Для каждой позиции проверены списание, количество, цена, направление и связь с чеком. Все 200 конечных остатков сверены с ожидаемыми значениями в тысячных долях. Проверен прирост выручки обеих смен.',
`Выполнено ${r.idempotencyReplays||0} повторов прежних request_id: итоговые количества чеков и списаний остались правильными. Все реальные продажи выполнялись через штатную Edge Function; прямых вставок продаж в БД не было.`, '',
'## База данных', '',
`Размер БД: ${mb(before.database_bytes)} → ${mb(after.database_bytes)} МБ, прирост ${mb(after.database_bytes-before.database_bytes)} МБ.`,
`Таблицы чеков и движений вместе с индексами: ${mb(orderBytesBefore)} → ${mb(orderBytesAfter)} МБ. Грубое выделение места на один чек в этом прогоне: ${Math.round(historyBytesPerReceipt)} байт.`,
`Изменение счётчика взаимоблокировок: ${r.capacityAnalysis.deadlocksDelta}.`,
`Среднее время SQL-вызова checkout по pg_stat_statements: ${sql.checkout.averageExecutionMs} мс; snapshot: ${sql.snapshot.averageExecutionMs} мс. HTTP-задержки выше включают сеть, Edge Function и прочие накладные расходы. Статистика SQL относится ко всему проекту за интервал, а не только к тестовому клиенту.`, '',
'## Ограничения Supabase Free и модель повседневной работы', '',
'На дату проверки Free включает 500 МБ БД, 5 ГБ некэшированного исходящего трафика за расчётный цикл и 500 000 вызовов Edge Functions. Источники: [тарифы](https://supabase.com/pricing), [вызовы функций](https://supabase.com/docs/guides/functions/pricing), [исходящий трафик](https://supabase.com/docs/guides/platform/manage-your-usage/egress).',
`Этот прогон отправил ${r.edgeInvocations} запросов к Edge Functions — примерно ${(100*r.edgeInvocations/500000).toFixed(2)}% месячной квоты, без учёта прочей работы проекта.`,
'Следующие оценки — сценарии для двух кассиров, 8-часового рабочего дня и 30 дней в месяц. Вызовы включают по два запроса на чек и верхнюю оценку фоновых обновлений каждые 15 секунд; реальный интерфейс пропускает фоновый запрос во время операции.', '',
'| Чеков/день на кассира | Вызовов функций/месяц, оценка | Прирост истории/месяц, МБ, оценка | Дней до 500 МБ при текущем размере, грубо | JSON снимков/месяц без сжатия, ГБ |',
'| ---: | ---: | ---: | ---: | ---: |',
...dailyModels.map(m=>`| ${m.receiptsPerCashier} | ${f(m.monthlyInvocationsEstimate)} | ${m.monthlyHistoryGrowthMB} | ${m.approxDaysTo500MB} | ${m.monthlyDecodedSnapshotGB} |`),'',
'Оценка размера истории основана на одном прогоне и физических размерах таблиц/индексов. На неё влияют начальные движения, выделение страниц и мёртвые версии строк; сроки не являются точной датой достижения квоты.',
'Колонка JSON — декодированный объём тел ответов, а не фактический оплачиваемый egress. Она показывает стоимость полного перечитывания каталога; сжатие и другие сервисы меняют месячный счётчик. У первого магазина каталог больше: кроме новых товаров в нём остались товары прошлого теста.',
'Важно для этого приложения: сохранение чека и обновление снимка повторно суммируют историю движений смены; по мере роста истории полезно следить за задержками. Касса перечитывает весь каталог после каждого чека и раз в 15 секунд в простое, поэтому число товаров влияет на трафик.', '',
'## Область вывода и оставленные данные', '',
'Прохождение теста подтверждает указанную интенсивность и корректность данных на текущем небольшом объёме истории. Это не многодневный тест: CPU, память, WAL/свободный диск, текущие месячные квоты, интерфейс браузера и дальнейший рост данных не измерялись.',
'Тестовые магазины/каталоги/чеки оставлены в базе. Обе PIN-сессии завершены. Новая тестовая смена второго магазина закрыта с проверенной расчётной суммой; ранее открытая смена «Аллигатора» сохранена открытой. Выручка теста входит в учёт магазинов. Схема и бизнес-логика приложения не менялись.',
'Пароли, PIN и токены в результаты не записывались.', '',
'Артефакты: [полный отчёт JSON](report.json), [БД до](database-before.json), [БД после](database-after.json).',
];
await fs.writeFile(new URL('summary.md',dir),lines.join('\n')+'\n');
console.log(JSON.stringify({status:r.status,loadSeconds:r.loadSeconds,actors:perActor,checkout:r.checkoutStats,refresh:r.refreshStats,capacity:r.capacityAnalysis},null,2));
