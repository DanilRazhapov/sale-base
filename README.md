# SaleBase

React + TypeScript + Vite. Интерфейс владельца и рабочее место кассира размещаются на Cloudflare Pages. База, авторизация владельца и Edge Functions остаются в Supabase.

## Локальная разработка

Все команды выполняются из `frontend`:

```powershell
npm ci
Copy-Item .env.example .env.local
```

Заполните `.env.local` значениями своего проекта Supabase:

```dotenv
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
```

```powershell
npm run dev
```

Версия Node.js для сборки указана в `.node-version`.

## Стили: Tailwind CSS

Все страницы используют Tailwind CSS v4 и официальный плагин `@tailwindcss/vite`.
Классы раскладки и адаптивности находятся в JSX; общие классы полей, кнопок и заголовков — в `src/lib/ui.ts`.
Палитры находятся в `src/styles/themes/light.css` и `dark.css`. Тёмная тема включается автоматически через `prefers-color-scheme: dark`, включая нативные поля и выпадающие списки. При смене темы браузера цвета обновляются без перезагрузки.
`tailwind.config.js` связывает семантические цвета (`surface`, `ink`, `line`, `brand`, `action`, статусы) с переменными палитры. Для новых цветов добавляйте переменную в обе темы; не используйте фиксированные цвета и наборы `dark:` в JSX.
Стили элементов локализованы в `src/styles/components.css` (общие элементы), `auth.css` (авторизация), `cashier.css` (касса) и `store.css` (кабинет и товары). В JSX используйте именованные классы этих компонентов. Светлая и тёмная темы используют одну структуру компонентов и разные значения переменных.
Для условных стилей используйте полные имена классов (например, `max-sm:hidden`), а не собирайте их из частей: Tailwind должен видеть класс при сборке.

## Cloudflare Pages через Git

При подключении репозитория задайте:

| Настройка | Значение |
| --- | --- |
| Root directory | `frontend` |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Конфигурация Wrangler | `frontend/wrangler.jsonc` |
| Имя Pages-проекта | `salebase` |

В настройках переменных окружения сборки добавьте `VITE_SUPABASE_URL` и `VITE_SUPABASE_PUBLISHABLE_KEY` для Production и Preview. Используйте значения из своего Supabase-проекта.

Vite встраивает эти значения в JavaScript во время сборки. Переменные `[vars]` в Wrangler не заменяют переменные окружения сборки. После изменения значений требуется новая сборка. При отсутствии обязательных переменных `npm run build` завершится с понятной ошибкой.

Publishable key предназначен для браузера. Секретный ключ и `service_role` в `VITE_*` не добавляются. `.env.local` не нужно коммитить.

## Cloudflare Pages через Wrangler

Сначала соберите приложение с заполненным `.env.local`:

```powershell
npm run build
npx wrangler login
```

Если Pages-проект ещё не создан:

```powershell
npx wrangler pages project create salebase
```

Публикация готовой сборки:

```powershell
npx wrangler pages deploy dist --project-name salebase
```

Проверка готовой сборки локально в окружении Pages:

```powershell
npx wrangler pages dev dist
```

`wrangler.toml` задаёт имя проекта, папку `dist` и дату совместимости. Сам Wrangler не запускает Vite-сборку перед `pages deploy`.

## Маршруты приложения

Cloudflare Pages автоматически обслуживает SPA при отсутствии корневого `404.html`. Благодаря этому прямое открытие и обновление `/cashier/`, `/owner` и `/store/:storeId` передаётся React Router. Не добавляйте `404.html` в `public`, если хотите сохранить это поведение.

## Supabase

Публикация на Pages не применяет SQL-миграции и не публикует Edge Functions. Для них отдельно выполняются:

```powershell
npx supabase db push
npx supabase functions deploy create-store
npx supabase functions deploy create-cashier
npx supabase functions deploy cashier-terminal
```

Если используется подтверждение почты или перенаправление после авторизации, настройте адрес опубликованного сайта в Supabase Auth → URL Configuration.

Документация Cloudflare: [Wrangler для Pages](https://developers.cloudflare.com/pages/functions/wrangler-configuration/), [настройки сборки](https://developers.cloudflare.com/pages/configuration/build-configuration/), [маршрутизация SPA](https://developers.cloudflare.com/pages/configuration/serving-pages/).
## Разделение владельца и кассира

- `/login` — выбор рабочего места; `/login/owner` — почта и пароль владельца; `/login/cashier` — имя и PIN кассира.
- `src/pages/owner` содержит кабинет владельца и его авторизацию, `src/pages/cashier` — вход кассира и кассу, `src/pages/auth` — выбор роли.
- `src/auth` хранит состояние авторизации и проверки маршрутов. Кассир не попадает в кабинет владельца; владелец перед входом в кассу должен выйти из своего аккаунта.
- Кассовый API не принимает авторизацию владельца. PIN-сессии не предоставляют прав Supabase Auth.
- Миграция `20261030090000_single_cashier_session.sql` разрешает только одну действующую сессию на аккаунт кассира. Повторный вход возвращает 409, не отзывая первую сессию. После явного выхода или 12 часов можно войти снова; выход сам по себе не закрывает смену.
- Закрытие вкладки не завершает серверную сессию. До выхода или истечения срока новый вход будет отклонён. Владение именем/PIN не позволяет определить, какой именно человек ими пользуется.

Миграции `20261031010000_cashier_shift_lifecycle.sql` и `20261031010100_schedule_shift_expiry.sql` исправляют жизненный цикл смен:

- Блокировка кассира безвозвратно отзывает его сессии и сразу закрывает открытую смену (миграция `20261031020000_close_shift_on_cashier_block.sql`). После разблокировки кассир входит с именем/PIN и открывает новую смену; старый токен больше не работает. Миграция также закрывает оставшиеся открытыми смены уже заблокированных кассиров.
- Смена закрывается через 12 часов **с момента открытия смены**. Задание Supabase Cron проверяет сроки каждую минуту, даже без открытой кассы; вход и запросы действующей сессии также проверяют просроченные смены. После срока продажи запрещены.
- Автозакрытие сохраняет расчётную сумму, а фактические наличные остаются неизвестными. В истории вместо фактической суммы показывается «Автозакрытие · не пересчитано», разница не рассчитывается.
- Миграция сразу закрывает уже просроченные смены. Планировщик требует расширение `pg_cron`, которое устанавливает вторая миграция ([Supabase Cron](https://supabase.com/docs/guides/cron/install)). В PGlite нет фоновых заданий: тесты вызывают функцию закрытия напрямую; запуск Cron проверяется на PostgreSQL/Supabase.

Для включения ограничения на сервере примените миграции и обновите `cashier-terminal` командами выше. Публикация фронтенда сама этого не делает.

Проверки:

```powershell
npm run build
npm run lint
.\node_modules\.bin\deno.cmd test --config supabase/tests/deno.json --node-modules-dir=none --allow-read --allow-env --allow-ffi --allow-sys supabase/tests
```
