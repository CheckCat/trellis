-- Пилотный курс "Основы SQL" — данные песочницы.
-- Выполняется от sandbox-роли при подключении курса и при каждом сбросе
-- песочницы (core-инвариант: seed- и check-запросы курса, как и запросы
-- пользователя, идут только от роли песочницы, никогда от роли приложения).
--
-- Одна небольшая таблица books — её достаточно, чтобы пройти весь пилотный
-- курс (SELECT, WHERE, INSERT, UPDATE) без лишней сложности.

create table books (
    id serial primary key,
    title text not null,
    author text not null,
    published_year integer not null,
    in_stock boolean not null default true
);

insert into books (title, author, published_year, in_stock) values
    ('Война и мир', 'Лев Толстой', 1869, true),
    ('Преступление и наказание', 'Фёдор Достоевский', 1866, true),
    ('Отцы и дети', 'Иван Тургенев', 1862, false),
    ('Евгений Онегин', 'Александр Пушкин', 1833, true),
    ('Мёртвые души', 'Николай Гоголь', 1842, false);
