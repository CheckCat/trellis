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

-- CONNECT — ролям, не всем подряд.
REVOKE ALL ON DATABASE trellis FROM PUBLIC;
GRANT CONNECT ON DATABASE trellis TO trellis_app;
GRANT CONNECT ON DATABASE trellis TO trellis_sandbox;
