-- Песочница курса «Senior Backend на Node.js» — данные операторской
-- платформы «Пульт». Выполняется от sandbox-роли при каждой попытке.
--
-- Детерминированность обязательна: все даты — литералы, никаких
-- default now(). Прогресс последовательностей воспроизводится, потому
-- что seed выполняется с нуля перед каждой попыткой.

create table departments (
    id   serial primary key,
    name text not null,
    city text not null
);

create table operators (
    id            serial primary key,
    department_id integer not null references departments (id),
    full_name     text not null,
    role          text not null check (role in ('operator', 'senior', 'supervisor', 'auditor')),
    hired_on      date not null
);

create table customers (
    id        serial primary key,
    full_name text not null,
    city      text not null,
    segment   text not null check (segment in ('mass', 'premium'))
);

create table accounts (
    id          serial primary key,
    customer_id integer not null references customers (id),
    number      text not null unique,
    currency    char(3) not null,
    balance     numeric(14, 2) not null,
    status      text not null check (status in ('active', 'closed')),
    opened_on   date not null
);

create table cards (
    id          serial primary key,
    account_id  integer not null references accounts (id),
    pan_masked  text not null,
    status      text not null check (status in ('active', 'blocked', 'reissue')),
    daily_limit numeric(12, 2) not null,
    issued_on   date not null
);

create table cases (
    id          serial primary key,
    customer_id integer not null references customers (id),
    assignee_id integer references operators (id),
    topic       text not null check (topic in
                  ('card-blocked', 'disputed-operation', 'missing-transfer', 'limits', 'reissue')),
    status      text not null check (status in ('open', 'in_progress', 'resolved', 'closed')),
    priority    integer not null,
    version     integer not null default 1,
    created_at  timestamptz not null,
    closed_at   timestamptz
);

create table case_events (
    id         serial primary key,
    case_id    integer not null references cases (id),
    kind       text not null,
    actor_id   integer references operators (id),
    payload    jsonb not null default '{}'::jsonb,
    created_at timestamptz not null
);

create table outbox (
    id           serial primary key,
    topic        text not null,
    payload      jsonb not null,
    created_at   timestamptz not null,
    published_at timestamptz
);

create table jobs (
    id       serial primary key,
    kind     text not null,
    status   text not null check (status in ('queued', 'running', 'done', 'failed')),
    priority integer not null,
    run_at   timestamptz not null,
    attempts integer not null default 0,
    payload  jsonb not null default '{}'::jsonb
);

insert into departments (name, city) values
    ('Контакт-центр',        'Москва'),      -- 1
    ('Отделения: Москва',    'Москва'),      -- 2
    ('Отделения: Казань',    'Казань'),      -- 3
    ('Контроль и аудит',     'Москва');      -- 4

insert into operators (department_id, full_name, role, hired_on) values
    (1, 'Анна Соколова',      'operator',   '2023-04-10'),  -- 1
    (1, 'Дмитрий Ежов',       'operator',   '2024-01-15'),  -- 2
    (1, 'Мария Климова',      'senior',     '2021-09-01'),  -- 3
    (1, 'Игорь Балашов',      'supervisor', '2019-06-20'),  -- 4
    (2, 'Ольга Чернова',      'operator',   '2024-07-01'),  -- 5
    (2, 'Пётр Лукин',         'operator',   '2022-11-14'),  -- 6
    (2, 'Наталья Фомина',     'supervisor', '2018-03-05'),  -- 7
    (3, 'Айрат Гареев',       'operator',   '2023-08-21'),  -- 8
    (3, 'Лилия Сафина',       'senior',     '2020-02-17'),  -- 9
    (3, 'Марат Валиев',       'supervisor', '2017-10-30'),  -- 10
    (4, 'Виктор Орлов',       'auditor',    '2016-05-12'),  -- 11
    (1, 'Ксения Ильина',      'operator',   '2025-02-03');  -- 12

insert into customers (full_name, city, segment) values
    ('Егор Костин',        'Москва',  'mass'),     -- 1
    ('Светлана Мирова',    'Москва',  'premium'),  -- 2
    ('Тимур Хасанов',      'Казань',  'mass'),     -- 3
    ('Дарья Полякова',     'Тверь',   'mass'),     -- 4
    ('Николай Агеев',      'Москва',  'mass'),     -- 5
    ('Алсу Нигматуллина',  'Казань',  'premium'),  -- 6
    ('Павел Абрамов',       'Москва',  'mass'),     -- 7
    ('Инга Верещагина',    'Пермь',   'mass'),     -- 8
    ('Роман Донцов',       'Москва',  'premium'),  -- 9
    ('Юлия Малкова',       'Казань',  'mass'),     -- 10
    ('Степан Ярцев',       'Москва',  'mass'),     -- 11
    ('Гульнара Зарипова',  'Казань',  'mass'),     -- 12
    ('Владимир Клюев',     'Тверь',   'mass'),     -- 13
    ('Оксана Демина',      'Москва',  'premium'),  -- 14
    ('Фёдор Тучков',       'Москва',  'mass');     -- 15

insert into accounts (customer_id, number, currency, balance, status, opened_on) values
    (1,  '40817810100000000101', 'RUB', 125340.50,  'active', '2022-03-14'),  -- 1
    (1,  '40817840100000000102', 'USD', 2100.00,    'active', '2023-06-02'),  -- 2
    (2,  '40817810100000000201', 'RUB', 987000.00,  'active', '2020-01-20'),  -- 3
    (2,  '40817810100000000202', 'RUB', 15000.25,   'closed', '2018-05-11'),  -- 4
    (3,  '40817810100000000301', 'RUB', 43210.00,   'active', '2023-09-30'),  -- 5
    (4,  '40817810100000000401', 'RUB', 780.10,     'active', '2024-04-25'),  -- 6
    (5,  '40817810100000000501', 'RUB', 56900.00,   'active', '2021-12-08'),  -- 7
    (6,  '40817810100000000601', 'RUB', 1250000.00, 'active', '2019-08-19'),  -- 8
    (6,  '40817840100000000602', 'USD', 18000.00,   'active', '2021-02-27'),  -- 9
    (7,  '40817810100000000701', 'RUB', 8420.90,    'active', '2024-10-03'),  -- 10
    (8,  '40817810100000000801', 'RUB', 31000.00,   'active', '2022-07-15'),  -- 11
    (9,  '40817810100000000901', 'RUB', 452300.75,  'active', '2020-11-23'),  -- 12
    (10, '40817810100000001001', 'RUB', 12.40,      'active', '2025-01-17'),  -- 13
    (11, '40817810100000001101', 'RUB', 74500.00,   'active', '2023-03-06'),  -- 14
    (12, '40817810100000001201', 'RUB', 990.00,     'active', '2024-08-29'),  -- 15
    (13, '40817810100000001301', 'RUB', 26700.35,   'active', '2021-06-10'),  -- 16
    (14, '40817810100000001401', 'RUB', 640200.00,  'active', '2019-04-02'),  -- 17
    (14, '40817840100000001402', 'USD', 5300.00,    'closed', '2020-09-14'),  -- 18
    (15, '40817810100000001501', 'RUB', 4890.00,    'active', '2024-12-01');  -- 19

insert into cards (account_id, pan_masked, status, daily_limit, issued_on) values
    (1,  '2200 12** **** 4401', 'active',  150000.00, '2024-03-14'),  -- 1
    (1,  '2200 12** **** 4402', 'blocked', 150000.00, '2022-03-20'),  -- 2
    (3,  '2200 12** **** 4403', 'active',  500000.00, '2023-01-25'),  -- 3
    (5,  '2200 12** **** 4404', 'active',  100000.00, '2023-10-05'),  -- 4
    (6,  '2200 12** **** 4405', 'reissue', 50000.00,  '2024-04-25'),  -- 5
    (7,  '2200 12** **** 4406', 'active',  150000.00, '2022-01-30'),  -- 6
    (8,  '2200 12** **** 4407', 'active',  1000000.00,'2023-08-19'),  -- 7
    (10, '2200 12** **** 4408', 'active',  100000.00, '2024-10-03'),  -- 8
    (11, '2200 12** **** 4409', 'blocked', 150000.00, '2022-07-21'),  -- 9
    (12, '2200 12** **** 4410', 'active',  300000.00, '2021-11-23'),  -- 10
    (13, '2200 12** **** 4411', 'active',  50000.00,  '2025-01-17'),  -- 11
    (14, '2200 12** **** 4412', 'active',  150000.00, '2023-03-06'),  -- 12
    (15, '2200 12** **** 4413', 'active',  50000.00,  '2024-08-29'),  -- 13
    (16, '2200 12** **** 4414', 'active',  100000.00, '2021-06-15'),  -- 14
    (17, '2200 12** **** 4415', 'active',  500000.00, '2022-04-02'),  -- 15
    (19, '2200 12** **** 4416', 'active',  50000.00,  '2024-12-01');  -- 16

-- Обращения. Времена — февраль-март 2026, все литералами.
insert into cases (customer_id, assignee_id, topic, status, priority, version, created_at, closed_at) values
    (1,  1,    'card-blocked',       'in_progress', 2, 3, '2026-03-02T09:15:00Z', null),                     -- 1
    (2,  3,    'disputed-operation', 'open',        1, 1, '2026-03-03T10:40:00Z', null),                     -- 2
    (3,  8,    'missing-transfer',   'resolved',    2, 4, '2026-02-20T14:05:00Z', null),                     -- 3
    (4,  null, 'limits',             'open',        3, 1, '2026-03-05T08:30:00Z', null),                     -- 4
    (5,  2,    'card-blocked',       'closed',      2, 5, '2026-02-11T11:00:00Z', '2026-02-12T16:45:00Z'),   -- 5
    (6,  9,    'reissue',            'in_progress', 1, 2, '2026-03-01T12:20:00Z', null),                     -- 6
    (7,  1,    'disputed-operation', 'open',        2, 1, '2026-03-04T15:55:00Z', null),                     -- 7
    (8,  null, 'missing-transfer',   'open',        1, 1, '2026-03-05T09:10:00Z', null),                     -- 8
    (9,  3,    'limits',             'closed',      3, 2, '2026-02-15T10:00:00Z', '2026-02-15T13:30:00Z'),   -- 9
    (10, 8,    'card-blocked',       'open',        2, 1, '2026-03-05T11:45:00Z', null),                     -- 10
    (11, 2,    'reissue',            'in_progress', 2, 2, '2026-02-27T16:35:00Z', null),                     -- 11
    (12, null, 'card-blocked',       'open',        1, 1, '2026-03-06T08:05:00Z', null),                     -- 12
    (13, 6,    'disputed-operation', 'closed',      2, 3, '2026-02-08T09:25:00Z', '2026-02-10T18:00:00Z'),   -- 13
    (14, 3,    'limits',             'open',        1, 1, '2026-03-06T10:50:00Z', null),                     -- 14
    (15, 5,    'missing-transfer',   'in_progress', 2, 2, '2026-03-02T13:15:00Z', null),                     -- 15
    (1,  6,    'limits',             'closed',      3, 2, '2026-01-28T12:00:00Z', '2026-01-29T10:20:00Z'),   -- 16
    (6,  9,    'disputed-operation', 'open',        1, 1, '2026-03-06T14:40:00Z', null),                     -- 17
    (2,  null, 'card-blocked',       'open',        2, 1, '2026-03-07T09:00:00Z', null),                     -- 18
    (9,  1,    'missing-transfer',   'open',        2, 1, '2026-03-07T09:30:00Z', null),                     -- 19
    (3,  8,    'limits',             'in_progress', 3, 2, '2026-03-03T17:10:00Z', null);                     -- 20

insert into case_events (case_id, kind, actor_id, payload, created_at) values
    (1,  'created',    null, '{"channel":"chat"}',                  '2026-03-02T09:15:00Z'),
    (1,  'assigned',   4,    '{"assignee":1}',                      '2026-03-02T09:20:00Z'),
    (1,  'status',     1,    '{"to":"in_progress"}',                '2026-03-02T09:25:00Z'),
    (2,  'created',    null, '{"channel":"phone"}',                 '2026-03-03T10:40:00Z'),
    (2,  'assigned',   4,    '{"assignee":3}',                      '2026-03-03T10:47:00Z'),
    (3,  'created',    null, '{"channel":"chat"}',                  '2026-02-20T14:05:00Z'),
    (3,  'assigned',   10,   '{"assignee":8}',                      '2026-02-20T14:12:00Z'),
    (3,  'status',     8,    '{"to":"in_progress"}',                '2026-02-20T14:30:00Z'),
    (3,  'status',     8,    '{"to":"resolved"}',                   '2026-02-21T10:00:00Z'),
    (4,  'created',    null, '{"channel":"office"}',                '2026-03-05T08:30:00Z'),
    (5,  'created',    null, '{"channel":"chat"}',                  '2026-02-11T11:00:00Z'),
    (5,  'assigned',   4,    '{"assignee":2}',                      '2026-02-11T11:06:00Z'),
    (5,  'status',     2,    '{"to":"in_progress"}',                '2026-02-11T11:10:00Z'),
    (5,  'status',     2,    '{"to":"resolved"}',                   '2026-02-12T15:00:00Z'),
    (5,  'status',     2,    '{"to":"closed"}',                     '2026-02-12T16:45:00Z'),
    (6,  'created',    null, '{"channel":"chat"}',                  '2026-03-01T12:20:00Z'),
    (6,  'assigned',   10,   '{"assignee":9}',                      '2026-03-01T12:24:00Z'),
    (6,  'status',     9,    '{"to":"in_progress"}',                '2026-03-01T12:31:00Z'),
    (7,  'created',    null, '{"channel":"phone"}',                 '2026-03-04T15:55:00Z'),
    (7,  'assigned',   4,    '{"assignee":1}',                      '2026-03-04T16:02:00Z'),
    (8,  'created',    null, '{"channel":"chat"}',                  '2026-03-05T09:10:00Z'),
    (9,  'created',    null, '{"channel":"office"}',                '2026-02-15T10:00:00Z'),
    (9,  'assigned',   4,    '{"assignee":3}',                      '2026-02-15T10:05:00Z'),
    (9,  'status',     3,    '{"to":"closed"}',                     '2026-02-15T13:30:00Z'),
    (10, 'created',    null, '{"channel":"chat"}',                  '2026-03-05T11:45:00Z'),
    (10, 'assigned',   10,   '{"assignee":8}',                      '2026-03-05T11:52:00Z'),
    (11, 'created',    null, '{"channel":"phone"}',                 '2026-02-27T16:35:00Z'),
    (11, 'assigned',   4,    '{"assignee":2}',                      '2026-02-27T16:41:00Z'),
    (11, 'status',     2,    '{"to":"in_progress"}',                '2026-02-27T16:50:00Z'),
    (12, 'created',    null, '{"channel":"chat"}',                  '2026-03-06T08:05:00Z'),
    (13, 'created',    null, '{"channel":"office"}',                '2026-02-08T09:25:00Z'),
    (13, 'assigned',   7,    '{"assignee":6}',                      '2026-02-08T09:31:00Z'),
    (13, 'status',     6,    '{"to":"in_progress"}',                '2026-02-08T09:44:00Z'),
    (13, 'status',     6,    '{"to":"closed"}',                     '2026-02-10T18:00:00Z'),
    (14, 'created',    null, '{"channel":"chat"}',                  '2026-03-06T10:50:00Z'),
    (14, 'assigned',   4,    '{"assignee":3}',                      '2026-03-06T10:57:00Z'),
    (15, 'created',    null, '{"channel":"phone"}',                 '2026-03-02T13:15:00Z'),
    (15, 'assigned',   7,    '{"assignee":5}',                      '2026-03-02T13:22:00Z'),
    (15, 'status',     5,    '{"to":"in_progress"}',                '2026-03-02T13:29:00Z'),
    (16, 'created',    null, '{"channel":"chat"}',                  '2026-01-28T12:00:00Z'),
    (16, 'assigned',   7,    '{"assignee":6}',                      '2026-01-28T12:04:00Z'),
    (16, 'status',     6,    '{"to":"closed"}',                     '2026-01-29T10:20:00Z'),
    (17, 'created',    null, '{"channel":"chat"}',                  '2026-03-06T14:40:00Z'),
    (17, 'assigned',   10,   '{"assignee":9}',                      '2026-03-06T14:46:00Z'),
    (18, 'created',    null, '{"channel":"phone"}',                 '2026-03-07T09:00:00Z'),
    (19, 'created',    null, '{"channel":"chat"}',                  '2026-03-07T09:30:00Z'),
    (19, 'assigned',   4,    '{"assignee":1}',                      '2026-03-07T09:36:00Z'),
    (20, 'created',    null, '{"channel":"office"}',                '2026-03-03T17:10:00Z'),
    (20, 'assigned',   10,   '{"assignee":8}',                      '2026-03-03T17:15:00Z'),
    (20, 'status',     8,    '{"to":"in_progress"}',                '2026-03-03T17:20:00Z');

insert into outbox (topic, payload, created_at, published_at) values
    ('case.created',  '{"caseId":18}', '2026-03-07T09:00:00Z', '2026-03-07T09:00:02Z'),
    ('case.created',  '{"caseId":19}', '2026-03-07T09:30:00Z', '2026-03-07T09:30:01Z'),
    ('case.assigned', '{"caseId":19,"assignee":1}', '2026-03-07T09:36:00Z', null);

insert into jobs (kind, status, priority, run_at, attempts, payload) values
    ('notify-sms',      'queued',  5,  '2026-03-07T10:00:00Z', 0, '{"caseId":18}'),   -- 1
    ('notify-sms',      'queued',  5,  '2026-03-07T10:00:05Z', 0, '{"caseId":19}'),   -- 2
    ('registry-export', 'queued',  1,  '2026-03-07T10:01:00Z', 0, '{"day":"2026-03-06"}'), -- 3
    ('notify-push',     'running', 5,  '2026-03-07T09:58:00Z', 1, '{"caseId":17}'),   -- 4
    ('notify-sms',      'done',    5,  '2026-03-06T18:00:00Z', 1, '{"caseId":14}'),   -- 5
    ('registry-export', 'failed',  1,  '2026-03-06T10:01:00Z', 3, '{"day":"2026-03-05"}'), -- 6
    ('notify-sms',      'queued',  9,  '2026-03-07T09:59:00Z', 0, '{"caseId":12}'),   -- 7
    ('mass-reassign',   'queued',  3,  '2026-03-07T10:05:00Z', 0, '{"from":2,"to":12}'), -- 8
    ('notify-push',     'queued',  5,  '2026-03-07T10:02:00Z', 0, '{"caseId":10}'),   -- 9
    ('notify-sms',      'queued',  5,  '2026-03-07T10:03:00Z', 0, '{"caseId":8}');    -- 10
