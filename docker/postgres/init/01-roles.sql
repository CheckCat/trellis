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

-- Идемпотентность на переприменение: если роль уже существует (повторный
-- прогон дев-окружения), пароль всё равно синхронизируется с текущим окружением.
ALTER ROLE trellis_app WITH LOGIN PASSWORD :'app_password';
ALTER ROLE trellis_sandbox WITH LOGIN PASSWORD :'sandbox_password';
