# Деплой кассы в Cloudflare Workers

Из каталога `frontend`:

```powershell
npm run deploy:cashier
```

Команда сначала собирает приложение, затем публикует Worker с конфигурацией
`cashier/.deploy/wrangler.json`. Сборка переносит в неё только две публичные
настройки из окружения Vite: `VITE_SUPABASE_URL` и
`VITE_SUPABASE_PUBLISHABLE_KEY`. Для локального запуска они читаются из
`frontend/.env.local`, в Cloudflare Builds — из переменных сборки.
Эта конфигурация также содержит путь к `worker.ts` и каталогу статики `dist`.

В Cloudflare Builds при Root directory `cashier`:

| Настройка | Значение |
| --- | --- |
| Build command | `npm --prefix .. ci && npm --prefix .. run build:cashier` |
| Deploy command | `npm --prefix .. run deploy:cashier` |

Если Root directory указывает на `frontend` (или корень репозитория, содержащий
`package.json`), уберите `--prefix ..` из обеих команд.

Не публикуйте `.deploy` в git. Используйте только публичный Supabase ключ;
`service_role` и `sb_secret_*` здесь недопустимы. Для ручного деплоя через
исходный `cashier/wrangler.jsonc` переменные по-прежнему нужно задавать как
runtime bindings самостоятельно: переменные сборки автоматически туда не переходят.

Проверка сборки и передачи настроек без публикации и запросов к рабочей базе:

```powershell
npm run build:cashier
node stress-tools/cashier-env-check.mjs
```

`CASHIER_ENV_MISSING` означает, что запущенный обработчик не получил настройки.
Этот ответ возникает до обращения к Supabase. Отдельный ответ 401 на `snapshot`
без cookie кассира ожидаем при первом входе и не объясняет 503 на `device`.
