-- Lesson progress: a row exists only for a *completed* lesson. "Not
-- started" is the absence of a row, not a status value — the product model
-- (task-005 brief) does not keep attempt history, only pass/fail-by-row.
--
-- Deliberately no foreign key to any "courses" table: courses are files on
-- disk (content packages under courses/), never rows in this database.
-- Progress for a course that is not currently installed locally (e.g. after
-- re-import, or before a course is (re)added) must still be representable
-- here — a FK would make that impossible.
create table if not exists core.lesson_progress (
    course_id text not null,
    lesson_id text not null,
    status text not null check (status in ('completed')),
    course_version text,
    completed_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (course_id, lesson_id)
);

-- Tracks which migration files (by filename stem) have been applied. This
-- table is itself created by the first migration that runs, which is why
-- migrate.ts tolerates it not existing yet on a completely fresh database.
create table if not exists core.schema_migrations (
    version text primary key,
    applied_at timestamptz not null default now()
);
