-- Роли приложения и песочницы.
-- Пароли передаются psql-переменными (-v app_password=... -v sandbox_password=...)
-- из 00-init.sh; здесь plain-text паролей нет.
-- LOGIN, без SUPERUSER/CREATEROLE/CREATEDB — минимум привилегий на уровне роли.
--
-- Postgres не умеет CREATE ROLE IF NOT EXISTS, идемпотентность делаем через
-- \gexec (генерируем CREATE ROLE только если роли ещё нет и выполняем
-- результат). ВАЖНО: :'var' не интерполируется psql-клиентом внутри
-- dollar-quoted тела (DO $$ ... $$) — там переменная ушла бы в запрос
-- буквально как ":'app_password'" и Postgres упал бы с syntax error.
-- Поэтому подстановку делаем только на верхнем уровне SQL, как здесь.

-- quote_literal() обязателен: :'var' даёт psql-клиентскую подстановку
-- (кавычки — синтаксис литерала, не часть значения), после разбора SELECT'ом
-- в текстовом значении их уже нет — quote_literal() возвращает их обратно,
-- иначе \gexec выполнит CREATE ROLE с паролем без кавычек и упадёт.
SELECT 'CREATE ROLE trellis_app LOGIN PASSWORD ' || quote_literal(:'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'trellis_app') \gexec

SELECT 'CREATE ROLE trellis_sandbox LOGIN PASSWORD ' || quote_literal(:'sandbox_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'trellis_sandbox') \gexec

-- ВАЖНО (реальность, не намерение): эти ALTER ROLE не дают "идемпотентность
-- на переприменение" в рантайме — официальный postgres-образ выполняет
-- /docker-entrypoint-initdb.d ТОЛЬКО когда volume пуст (первая инициализация
-- кластера), повторного прогона при обычном рестарте/пересоздании
-- контейнера не бывает. Смена APP_DB_PASSWORD/SANDBOX_DB_PASSWORD в .env
-- после первого запуска НЕ доедет до фактического пароля роли в уже
-- существующем volume — эти строки исполнятся ещё раз только если volume
-- `trellis_pgdata` пересоздать с нуля (`docker compose down -v`), то есть
-- вместе с потерей всех данных. Смысл ALTER здесь — сделать первую
-- инициализацию идентичной что для "роли ещё нет" (CREATE ROLE выше), что
-- для гипотетического ручного повторного запуска этого файла против того
-- же volume (например, при восстановлении из бэкапа кластера) — не
-- подстраховка от смены пароля в .env на живом стенде. Про
-- пользовательский сценарий "я сменил пароль в .env, а бэкенд не
-- подключается" — см. .env.example и task-018 (ротация паролей — будущая
-- задача, здесь не решается).
ALTER ROLE trellis_app WITH LOGIN PASSWORD :'app_password';
ALTER ROLE trellis_sandbox WITH LOGIN PASSWORD :'sandbox_password';
