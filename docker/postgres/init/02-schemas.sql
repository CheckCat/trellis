-- Модель прав: схема ядра под ролью приложения, схема песочницы под
-- sandbox-ролью, взаимная изоляция между ними, никакого мусора в public.

-- public никому не доступен: ни для создания объектов, ни даже для CONNECT-по-умолчанию.
REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM trellis_app;
REVOKE ALL ON SCHEMA public FROM trellis_sandbox;

-- Схемы, каждая во владении своей роли.
CREATE SCHEMA IF NOT EXISTS core AUTHORIZATION trellis_app;
CREATE SCHEMA IF NOT EXISTS sandbox AUTHORIZATION trellis_sandbox;

-- Явная взаимная изоляция (defensive: CREATE SCHEMA не грантит PUBLIC
-- ничего по умолчанию, но фиксируем инвариант явно, а не полагаемся на
-- умолчания Postgres).
REVOKE ALL ON SCHEMA core FROM trellis_sandbox;
REVOKE ALL ON SCHEMA sandbox FROM trellis_app;

-- Единственное расширение прав sandbox-роли за пределы владения своей
-- схемой: CREATE на уровне БД, нужен для DROP SCHEMA sandbox CASCADE +
-- CREATE SCHEMA sandbox при "сбросе песочницы" (задача 008). Больше ничего
-- sandbox-роли на уровне базы не выдаётся.
GRANT CREATE ON DATABASE trellis TO trellis_sandbox;

-- search_path по умолчанию — каждая роль видит только свою схему без
-- явной квалификации.
ALTER ROLE trellis_app SET search_path = core;
ALTER ROLE trellis_sandbox SET search_path = sandbox;

-- trellis_sandbox is the role the user's own practice SQL runs under
-- (never trellis_app) — an accidental `pg_sleep(1e9)` or a runaway
-- cartesian join in the practice editor is the *expected* failure mode
-- there, not an edge case, and would otherwise hold a pool connection
-- forever. Bounds chosen as generous-but-finite for an interactive
-- single-query editor, not tuned against any particular course's queries:
-- 30s is well above what a legitimate exercise on course-sized seed data
-- should ever take, and 60s idle-in-transaction reclaims a connection left
-- mid-transaction (tab closed, browser crashed) without cutting off normal
-- think-time inside an explicit transaction. trellis_app is deliberately
-- NOT bounded here — schema migrations (task-005) are allowed to take as
-- long as they need.
ALTER ROLE trellis_sandbox SET statement_timeout = '30s';
ALTER ROLE trellis_sandbox SET idle_in_transaction_session_timeout = '60s';

-- CONNECT — ролям, не всем подряд.
REVOKE ALL ON DATABASE trellis FROM PUBLIC;
GRANT CONNECT ON DATABASE trellis TO trellis_app;
GRANT CONNECT ON DATABASE trellis TO trellis_sandbox;
