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

Версия Node.js для сборки указана в `.node-version`. Стили страниц находятся в `src/css`, глобальный файл стилей — `src/index.css`.

## Cloudflare Pages через Git

При подключении репозитория задайте:

| Настройка | Значение |
| --- | --- |
| Root directory | `frontend` |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Конфигурация Wrangler | `frontend/wrangler.toml` |
| Имя Pages-проекта | `salebase` |

Если проект в Cloudflare называется иначе, измените `name` в `wrangler.toml`.

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
