#!/usr/bin/env node
// Генератор данных ООО «Ромашка» — единственный источник сквозного примера
// курса. Из одного прогона рождаются и sandbox/seed.sql (песочница SQL-модуля),
// и data/*.csv (файлы для Excel и DataLens): расхождение между ними невозможно
// по построению.
//
// Детерминизм обязателен (см. courses/README.md): PRNG с фиксированным зерном,
// ни Date.now(), ни Math.random(). Повторный запуск даёт байт-в-байт тот же
// результат. Дата среза данных — 2025-12-31.
//
// Запуск: node courses/hr-analytics/tools/generate-data.mjs

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// ---------- PRNG (mulberry32) ----------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20251231);
const randInt = (a, b) => a + Math.floor(rand() * (b - a + 1));
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
function weighted(pairs) {
  const total = pairs.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [v, w] of pairs) {
    r -= w;
    if (r <= 0) return v;
  }
  return pairs[pairs.length - 1][0];
}

// ---------- даты ----------
const DAY = 86400000;
const d = (y, m, day) => new Date(Date.UTC(y, m - 1, day));
const iso = (dt) => dt.toISOString().slice(0, 10);
const ru = (dt) => {
  const [y, m, day] = iso(dt).split("-");
  return `${day}.${m}.${y}`;
};
const addDays = (dt, n) => new Date(dt.getTime() + n * DAY);
const daysBetween = (a, b) => Math.round((b.getTime() - a.getTime()) / DAY);
const END = d(2025, 12, 31);

// ---------- имена ----------
const SURNAMES = [
  "Иванов", "Петров", "Сидоров", "Кузнецов", "Смирнов", "Попов", "Васильев",
  "Соколов", "Михайлов", "Новиков", "Федоров", "Морозов", "Волков", "Алексеев",
  "Лебедев", "Семенов", "Егоров", "Павлов", "Козлов", "Степанов", "Николаев",
  "Орлов", "Андреев", "Макаров", "Никитин", "Захаров", "Зайцев", "Соловьев",
  "Борисов", "Яковлев", "Григорьев", "Романов", "Воробьев", "Сергеев", "Фролов",
  "Александров", "Дмитриев", "Королев", "Гусев", "Киселев", "Ильин", "Максимов",
  "Поляков", "Сорокин", "Виноградов", "Ковалев", "Белов", "Медведев", "Антонов",
  "Тарасов", "Жуков", "Баранов", "Филиппов", "Комаров", "Давыдов", "Беляев",
  "Герасимов", "Богданов", "Осипов", "Сафронов", "Мельников", "Щербаков",
  "Блинов", "Колесников", "Карпов", "Афанасьев", "Власов", "Маслов", "Исаков",
  "Тихонов", "Аксенов", "Гаврилов", "Родионов", "Котов", "Горбунов", "Кудряшов",
  "Быков", "Зуев", "Третьяков", "Савельев", "Панов", "Рыбаков", "Суворов",
  "Абрамов", "Воронов", "Мухин", "Архипов", "Трофимов", "Мартынов", "Емельянов",
];
const MALE_NAMES = [
  "Александр", "Дмитрий", "Максим", "Сергей", "Андрей", "Алексей", "Артём",
  "Илья", "Кирилл", "Михаил", "Никита", "Матвей", "Роман", "Егор", "Иван",
  "Денис", "Евгений", "Данил", "Тимофей", "Владислав", "Игорь", "Владимир",
  "Павел", "Руслан", "Марк", "Константин", "Олег", "Ярослав", "Антон", "Николай",
];
const FEMALE_NAMES = [
  "Анастасия", "Мария", "Дарья", "Анна", "Елизавета", "Полина", "Виктория",
  "Екатерина", "Софья", "Александра", "Валерия", "Вероника", "Арина", "Алина",
  "Милана", "Диана", "Маргарита", "Ольга", "Татьяна", "Наталья", "Ирина",
  "Светлана", "Юлия", "Елена", "Ксения", "Алёна", "Вера", "Людмила", "Оксана",
  "Галина",
];
const MALE_PATRONYMICS = [
  "Александрович", "Дмитриевич", "Сергеевич", "Андреевич", "Алексеевич",
  "Михайлович", "Иванович", "Владимирович", "Николаевич", "Павлович",
  "Олегович", "Игоревич", "Викторович", "Юрьевич", "Анатольевич", "Борисович",
  "Валерьевич", "Геннадьевич", "Петрович", "Константинович",
];
const FEMALE_PATRONYMICS = MALE_PATRONYMICS.map((p) => p.slice(0, -2) + "на");

const usedNames = new Set();
function makeName(sex) {
  for (let i = 0; i < 200; i++) {
    const s = pick(SURNAMES) + (sex === "ж" ? "а" : "");
    const n = sex === "ж" ? pick(FEMALE_NAMES) : pick(MALE_NAMES);
    const p = sex === "ж" ? pick(FEMALE_PATRONYMICS) : pick(MALE_PATRONYMICS);
    const full = `${s} ${n} ${p}`;
    if (!usedNames.has(full)) {
      usedNames.add(full);
      return full;
    }
  }
  throw new Error("не хватило имён");
}

// ---------- справочник отделов ----------
// start — численность на 2023-01-01; growth/quits — по годам.
// Сюжет курса: Продажи и Склад текут (~30%), ИТ стабильна (~7%).
const DEPTS = [
  {
    id: 1, name: "Продажи", start: 20,
    growth: { 2023: 1, 2024: 0, 2025: 1 }, quits: { 2023: 6, 2024: 6, 2025: 7 },
    femaleShare: 0.45, fill: [25, 60],
    positions: [
      { t: "менеджер по продажам", w: 70, s: [65, 90] },
      { t: "старший менеджер по продажам", w: 25, s: [85, 105] },
      { t: "руководитель отдела продаж", head: true, s: [140, 150] },
    ],
  },
  {
    id: 2, name: "Маркетинг", start: 7,
    growth: { 2023: 0, 2024: 1, 2025: 0 }, quits: { 2023: 1, 2024: 1, 2025: 1 },
    femaleShare: 0.7, fill: [30, 70],
    positions: [
      { t: "маркетолог", w: 60, s: [70, 95] },
      { t: "контент-менеджер", w: 40, s: [60, 80], pt: true },
      { t: "руководитель отдела маркетинга", head: true, s: [125, 135] },
    ],
  },
  {
    id: 3, name: "Производство", start: 36,
    growth: { 2023: 1, 2024: 0, 2025: 1 }, quits: { 2023: 6, 2024: 7, 2025: 6 },
    femaleShare: 0.3, fill: [20, 50],
    positions: [
      { t: "оператор линии", w: 55, s: [55, 70] },
      { t: "наладчик", w: 20, s: [65, 85] },
      { t: "технолог", w: 13, s: [75, 95] },
      { t: "мастер смены", w: 12, s: [85, 100] },
      { t: "начальник производства", head: true, s: [145, 155] },
    ],
  },
  {
    id: 4, name: "Склад и логистика", start: 17,
    growth: { 2023: 0, 2024: 1, 2025: 0 }, quits: { 2023: 5, 2024: 4, 2025: 5 },
    femaleShare: 0.25, fill: [20, 50],
    positions: [
      { t: "кладовщик", w: 50, s: [50, 65] },
      { t: "комплектовщик", w: 30, s: [48, 60] },
      { t: "водитель погрузчика", w: 20, s: [55, 70] },
      { t: "заведующий складом", head: true, s: [95, 105] },
    ],
  },
  {
    id: 5, name: "ИТ", start: 11,
    growth: { 2023: 1, 2024: 1, 2025: 1 }, quits: { 2023: 1, 2024: 1, 2025: 1 },
    femaleShare: 0.3, fill: [60, 120],
    positions: [
      { t: "программист 1С", w: 45, s: [120, 180] },
      { t: "системный администратор", w: 25, s: [95, 140] },
      { t: "аналитик данных", w: 30, s: [110, 170] },
      { t: "руководитель ИТ-отдела", head: true, s: [210, 230] },
    ],
  },
  {
    id: 6, name: "Финансы", start: 8,
    growth: { 2023: 0, 2024: 0, 2025: 0 }, quits: { 2023: 1, 2024: 1, 2025: 1 },
    femaleShare: 0.8, fill: [40, 80],
    positions: [
      { t: "бухгалтер", w: 65, s: [70, 95] },
      { t: "экономист", w: 35, s: [80, 110] },
      { t: "главный бухгалтер", head: true, s: [155, 165] },
    ],
  },
  {
    id: 7, name: "HR", start: 5,
    growth: { 2023: 0, 2024: 1, 2025: 0 }, quits: { 2023: 1, 2024: 0, 2025: 1 },
    femaleShare: 0.85, fill: [30, 60],
    positions: [
      { t: "рекрутер", w: 40, s: [60, 85] },
      { t: "специалист по кадровому делопроизводству", w: 40, s: [60, 80] },
      { t: "HR-менеджер", w: 20, s: [80, 100] },
      { t: "директор по персоналу", head: true, s: [145, 155] },
    ],
  },
  {
    id: 8, name: "Администрация", start: 6,
    growth: { 2023: 0, 2024: 0, 2025: 0 }, quits: { 2023: 0, 2024: 1, 2025: 1 },
    femaleShare: 0.6, fill: [30, 60],
    positions: [
      { t: "офис-менеджер", w: 40, s: [55, 70], pt: true },
      { t: "юрист", w: 30, s: [90, 120], pt: true },
      { t: "специалист по охране труда", w: 30, s: [65, 85], pt: true },
      { t: "генеральный директор", head: true, s: [290, 310] },
    ],
  },
];

// Сезонность увольнений: пики в январе–феврале и июле–августе.
const QUIT_MONTH_WEIGHTS = [
  [1, 12], [2, 11], [3, 8], [4, 7], [5, 6], [6, 7],
  [7, 10], [8, 10], [9, 8], [10, 7], [11, 7], [12, 7],
];
// Наём: весна и осень активнее.
const HIRE_MONTH_WEIGHTS = [
  [1, 6], [2, 8], [3, 10], [4, 10], [5, 8], [6, 7],
  [7, 6], [8, 7], [9, 10], [10, 10], [11, 9], [12, 5],
];

// ---------- генерация сотрудников ----------
const employees = []; // {id, name, sex, birth, deptId, position, hire, term, fte, salaryRange}
let nextEmpId = 101;

function pickPosition(dept, { allowHead }) {
  if (allowHead) {
    const head = dept.positions.find((p) => p.head);
    if (head && !employees.some((e) => e.deptId === dept.id && e.position === head.t)) {
      return head;
    }
  }
  const regular = dept.positions.filter((p) => !p.head);
  return weighted(regular.map((p) => [p, p.w]));
}

function makeEmployee(dept, hireDate, { allowHead = false } = {}) {
  const pos = pickPosition(dept, { allowHead });
  const sex = rand() < dept.femaleShare ? "ж" : "м";
  const ageAtHire = pos.head ? randInt(35, 52) : randInt(21, 55);
  const birth = addDays(hireDate, -(ageAtHire * 365 + randInt(0, 364)));
  const fte = pos.pt && rand() < 0.4 ? 0.5 : 1.0;
  const emp = {
    id: nextEmpId++,
    name: makeName(sex),
    sex,
    birth,
    deptId: dept.id,
    position: pos.t,
    hire: hireDate,
    term: null,
    fte,
    salaryRange: pos.s,
    head: !!pos.head,
  };
  employees.push(emp);
  return emp;
}

// Стартовый состав (на 2023-01-01): наняты в 2018–2022.
for (const dept of DEPTS) {
  const head = makeEmployee(dept, d(randInt(2018, 2019), randInt(1, 12), randInt(1, 28)), { allowHead: true });
  void head;
  for (let i = 1; i < dept.start; i++) {
    makeEmployee(dept, d(randInt(2018, 2022), randInt(1, 12), randInt(1, 28)));
  }
}

// Три года движения: в каждом году сначала наймы, потом увольнения
// (уволиться может и нанятый в этом же году — ранняя текучесть).
const terminations = []; // {empId, date, reason, voluntary}

function termReason(tenureDays) {
  if (tenureDays <= 100) {
    return rand() < 0.5
      ? { reason: "не прошёл испытательный срок", voluntary: false }
      : { reason: "по собственному желанию", voluntary: true };
  }
  const r = weighted([
    ["по собственному желанию", 68],
    ["соглашение сторон", 12],
    ["истечение срочного договора", 10],
    ["инициатива работодателя", 10],
  ]);
  return { reason: r, voluntary: r === "по собственному желанию" };
}

for (const year of [2023, 2024, 2025]) {
  for (const dept of DEPTS) {
    const hires = (dept.quits[year] ?? 0) + (dept.growth[year] ?? 0);
    const newcomers = [];
    for (let i = 0; i < hires; i++) {
      const month = weighted(HIRE_MONTH_WEIGHTS);
      const emp = makeEmployee(dept, d(year, month, randInt(1, 28)));
      newcomers.push(emp);
    }
    let quitsLeft = dept.quits[year] ?? 0;
    // Часть увольнений — ранние, из нанятых в этом же году (адаптация хромает
    // в Продажах и на Складе).
    const earlyShare = dept.id === 1 || dept.id === 4 ? 0.4 : 0.15;
    for (const emp of newcomers) {
      if (quitsLeft === 0) break;
      if (rand() < earlyShare && daysBetween(emp.hire, d(year, 12, 1)) > 45) {
        const tenure = randInt(21, 95);
        const term = addDays(emp.hire, tenure);
        if (term.getUTCFullYear() === year) {
          emp.term = term;
          const { reason, voluntary } = termReason(tenure);
          terminations.push({ empId: emp.id, date: term, reason, voluntary });
          quitsLeft--;
        }
      }
    }
    // Остальные увольнения — из давно работающих, с сезонностью по месяцам.
    const pool = employees.filter(
      (e) => e.deptId === dept.id && !e.term && !e.head && daysBetween(e.hire, d(year, 1, 1)) > 60,
    );
    while (quitsLeft > 0 && pool.length > 0) {
      // Молодой стаж уходит чаще: вес 3 при стаже < 1 года, 2 — до 3 лет, 1 — дольше.
      const withWeights = pool.map((e) => {
        const tenureYears = daysBetween(e.hire, d(year, 6, 30)) / 365;
        return [e, tenureYears < 1 ? 3 : tenureYears < 3 ? 2 : 1];
      });
      const emp = weighted(withWeights);
      pool.splice(pool.indexOf(emp), 1);
      const month = weighted(QUIT_MONTH_WEIGHTS);
      let term = d(year, month, randInt(1, 28));
      if (term <= addDays(emp.hire, 21)) term = addDays(emp.hire, randInt(30, 120));
      if (term.getUTCFullYear() !== year || term > END) continue;
      emp.term = term;
      const { reason, voluntary } = termReason(daysBetween(emp.hire, term));
      terminations.push({ empId: emp.id, date: term, reason, voluntary });
      quitsLeft--;
    }
  }
}

// ---------- зарплаты ----------
// База — уровень 2023 года (диапазоны в справочнике — уровень 2025;
// дефлируем), затем индексации 2024-04-01 и 2025-04-01.
const salaryHistory = []; // {empId, from, salary}
let nextSalId = 1;
const round500 = (x) => Math.round(x / 500) * 500;

for (const emp of employees) {
  const [lo, hi] = emp.salaryRange;
  const level2025 = (lo + rand() * (hi - lo)) * 1000;
  const base = round500(level2025 / 1.15);
  const startFrom = emp.hire < d(2023, 1, 1) ? d(2023, 1, 1) : emp.hire;
  salaryHistory.push({ id: nextSalId++, empId: emp.id, from: startFrom, salary: base });
  let current = base;
  for (const [year, pct] of [[2024, 0.08], [2025, 0.07]]) {
    const raiseDate = d(year, 4, 1);
    if (emp.hire >= addDays(raiseDate, -90)) continue; // недавно нанятым не индексируют
    if (emp.term && emp.term < raiseDate) continue;
    const itBoost = emp.deptId === 5 ? 0.03 : 0;
    const chance = emp.deptId === 5 ? 0.9 : 0.75;
    if (rand() < chance) {
      current = round500(current * (1 + pct + itBoost));
      salaryHistory.push({ id: nextSalId++, empId: emp.id, from: raiseDate, salary: current });
    }
  }
}

// ---------- вакансии и отклики ----------
const vacancies = []; // {id, deptId, position, opened, closed, hiredEmpId}
const applications = []; // {id, vacId, name, source, applied, stage}
let nextVacId = 1;
let nextAppId = 1;

const SOURCES = [
  ["hh.ru", 55],
  ["реферал", 15],
  ["телеграм-канал", 20],
  ["сайт компании", 10],
];
const deptById = (id) => DEPTS.find((x) => x.id === id);

function makeApplications(vac, { hiredEmp, totalOverride } = {}) {
  const dept = deptById(vac.deptId);
  const base =
    dept.id === 3 || dept.id === 4 ? randInt(15, 30)
    : dept.id === 1 ? randInt(12, 25)
    : dept.id === 5 ? randInt(5, 12)
    : randInt(8, 18);
  const total = totalOverride ?? base;
  const nScreen = Math.max(2, Math.round(total * (0.4 + rand() * 0.15)));
  const nInterview = Math.max(1, Math.round(nScreen * (0.4 + rand() * 0.15)));
  const nOffer = hiredEmp ? Math.min(nInterview, rand() < 0.3 ? 2 : 1) : rand() < 0.5 ? 1 : 0;
  const spanDays = Math.max(14, Math.min(45, daysBetween(vac.opened, vac.closed ?? END)));
  for (let i = 0; i < total; i++) {
    let stage = "отклик";
    if (i < nScreen) stage = "скрининг";
    if (i < nInterview) stage = "интервью";
    if (i < nOffer) stage = "оффер";
    const isHired = hiredEmp && i === 0;
    if (isHired) stage = "нанят";
    const sex = rand() < 0.5 ? "ж" : "м";
    const name = isHired ? hiredEmp.name : makeName(sex);
    const applied = addDays(vac.opened, isHired ? randInt(1, Math.min(14, spanDays)) : randInt(0, spanDays));
    applications.push({
      id: nextAppId++,
      vacId: vac.id,
      name,
      source: weighted(SOURCES),
      applied,
      stage,
    });
  }
}

// Закрытые вакансии — под каждый наём с 2024-01-01.
for (const emp of employees.filter((e) => e.hire >= d(2024, 1, 1) && !e.head)) {
  const dept = deptById(emp.deptId);
  const fillDays = randInt(dept.fill[0], dept.fill[1]);
  const vac = {
    id: nextVacId++,
    deptId: emp.deptId,
    position: emp.position,
    opened: addDays(emp.hire, -fillDays),
    closed: emp.hire,
    hiredEmpId: emp.id,
  };
  vacancies.push(vac);
  makeApplications(vac, { hiredEmp: emp });
}
// Открытые на конец 2025 года.
for (const [deptId, position, opened] of [
  [1, "менеджер по продажам", d(2025, 11, 10)],
  [3, "оператор линии", d(2025, 12, 1)],
  [5, "аналитик данных", d(2025, 10, 6)],
  [4, "кладовщик", d(2025, 12, 15)],
]) {
  const vac = { id: nextVacId++, deptId, position, opened, closed: null, hiredEmpId: null };
  vacancies.push(vac);
  makeApplications(vac, {});
}

// ---------- ats_raw: грязная выгрузка для уроков про чистку ----------
// Берём отклики трёх вакансий 2025 года и портим их ДЕТЕРМИНИРОВАННО:
// дубли, регистр, лишние пробелы, три формата дат, разнобой источников.
const MONTHS_RU = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];
function phoneFor(appId, style) {
  const tail = String(9000000 + ((appId * 7919) % 1000000)).padStart(7, "0");
  const code = 900 + (appId % 90);
  const p1 = tail.slice(0, 3), p2 = tail.slice(3, 5), p3 = tail.slice(5, 7);
  if (style === 0) return `+7 (${code}) ${p1}-${p2}-${p3}`;
  if (style === 1) return `8${code}${p1}${p2}${p3}`;
  return `+7${code}${p1}${p2}${p3}`;
}
function messyDate(dt, style) {
  if (style === 0) return iso(dt);
  if (style === 1) return ru(dt);
  return `${dt.getUTCDate()} ${MONTHS_RU[dt.getUTCMonth()]} ${dt.getUTCFullYear()}`;
}
const SOURCE_MESS = {
  "hh.ru": ["hh.ru", "HH", "HeadHunter", "hh"],
  "реферал": ["реферал", "Реферал", "рекомендация"],
  "телеграм-канал": ["телеграм", "Telegram", "тг-канал"],
  "сайт компании": ["сайт", "Сайт компании", "careers"],
};
const atsVacs = [];
for (const wanted of [
  [1, "менеджер по продажам"],
  [4, "кладовщик"],
  [5, "программист 1С"],
]) {
  const vac = vacancies.find(
    (v) => v.deptId === wanted[0] && v.position === wanted[1] && v.opened >= d(2025, 1, 1),
  ) ?? vacancies.find((v) => v.deptId === wanted[0] && v.position === wanted[1]);
  if (vac) atsVacs.push(vac);
}
const atsRows = [];
for (const vac of atsVacs) {
  const apps = applications.filter((a) => a.vacId === vac.id);
  for (const app of apps) {
    const style = app.id % 3;
    let fio = app.name;
    if (app.id % 7 === 0) fio = fio.toUpperCase();
    if (app.id % 5 === 0) fio = `  ${fio}`;
    if (app.id % 11 === 0) fio = fio.replace(/ /g, "  ");
    const vacName =
      app.id % 4 === 0 ? vac.position : vac.position.charAt(0).toUpperCase() + vac.position.slice(1);
    atsRows.push({
      fio,
      telefon: phoneFor(app.id, style),
      data: messyDate(app.applied, style),
      vak: app.id % 9 === 0 ? `${vacName} ` : vacName,
      ist: app.id % 13 === 0 ? "" : pick(SOURCE_MESS[app.source]),
      etap: app.id % 10 === 0 ? "" : app.stage,
    });
  }
}
// Полные дубли: три строки повторяются как есть (кроме индекса 0, чтобы дубль
// не был первым же рядом со своим оригиналом).
const dupIdx = [2, 9, 17].filter((i) => i < atsRows.length);
for (const i of dupIdx) atsRows.push({ ...atsRows[i] });
// Почти-дубли: тот же человек и телефон, но ФИО в другом регистре.
for (const i of [4, 12].filter((i) => i < atsRows.length)) {
  atsRows.push({ ...atsRows[i], fio: atsRows[i].fio.trim().toLowerCase() });
}

// ---------- контрольные суммы в консоль ----------
const activeAt = (dt) => employees.filter((e) => e.hire <= dt && (!e.term || e.term >= dt));
console.log("Всего сотрудников в данных:", employees.length);
console.log("Активных на 2025-12-31:", activeAt(END).length);
for (const year of [2023, 2024, 2025]) {
  const t = terminations.filter((x) => x.date.getUTCFullYear() === year).length;
  console.log(`Увольнений за ${year}:`, t);
}
console.log("Вакансий:", vacancies.length, "Откликов:", applications.length);
console.log("Строк в ats_raw:", atsRows.length);

// ---------- seed.sql ----------
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const lines = [];
lines.push(`-- ООО «Ромашка» — данные песочницы курса «HR-аналитика с нуля».
-- Файл СГЕНЕРИРОВАН скриптом tools/generate-data.mjs — не редактируйте руками,
-- меняйте генератор и перезапускайте его. Данные детерминированы (fixed seed),
-- дата среза — 2025-12-31. Те же данные лежат в data/*.csv для Excel/DataLens.
--
-- Соглашение о датах: termination_date — последний рабочий день; сотрудник
-- числится на дату D, если hire_date <= D и (termination_date is null или
-- termination_date >= D).

create table departments (
    id integer primary key,
    name text not null unique
);

create table employees (
    id integer primary key,
    full_name text not null,
    sex text not null check (sex in ('м', 'ж')),
    birth_date date not null,
    department_id integer not null references departments (id),
    position text not null,
    hire_date date not null,
    termination_date date,
    fte numeric(3, 2) not null default 1.00
);

create table terminations (
    id integer primary key,
    employee_id integer not null references employees (id),
    term_date date not null,
    reason text not null,
    voluntary boolean not null
);

create table vacancies (
    id integer primary key,
    department_id integer not null references departments (id),
    position text not null,
    opened_on date not null,
    closed_on date,
    hired_employee_id integer references employees (id)
);

create table applications (
    id integer primary key,
    vacancy_id integer not null references vacancies (id),
    candidate_name text not null,
    source text not null,
    applied_on date not null,
    stage text not null check (stage in ('отклик', 'скрининг', 'интервью', 'оффер', 'нанят'))
);

create table salary_history (
    id integer primary key,
    employee_id integer not null references employees (id),
    valid_from date not null,
    monthly_salary integer not null
);

-- «Сырая» выгрузка из ATS: без ключей и типов, с дублями и разнобоем
-- форматов — материал уроков про качество данных. Грязь только здесь,
-- остальные таблицы чистые.
create table ats_raw (
    fio text,
    telefon text,
    data_otklika text,
    vakansiya text,
    istochnik text,
    etap text
);
`);

function insertBlock(table, cols, rows) {
  if (rows.length === 0) return;
  lines.push(`insert into ${table} (${cols.join(", ")}) values`);
  lines.push(rows.map((r) => `    (${r.join(", ")})`).join(",\n") + ";");
  lines.push("");
}

insertBlock("departments", ["id", "name"], DEPTS.map((x) => [x.id, q(x.name)]));
insertBlock(
  "employees",
  ["id", "full_name", "sex", "birth_date", "department_id", "position", "hire_date", "termination_date", "fte"],
  employees.map((e) => [
    e.id, q(e.name), q(e.sex), q(iso(e.birth)), e.deptId, q(e.position),
    q(iso(e.hire)), e.term ? q(iso(e.term)) : "null", e.fte.toFixed(2),
  ]),
);
insertBlock(
  "terminations",
  ["id", "employee_id", "term_date", "reason", "voluntary"],
  terminations
    .slice()
    .sort((a, b) => a.date - b.date || a.empId - b.empId)
    .map((t, i) => [i + 1, t.empId, q(iso(t.date)), q(t.reason), t.voluntary]),
);
insertBlock(
  "vacancies",
  ["id", "department_id", "position", "opened_on", "closed_on", "hired_employee_id"],
  vacancies.map((v) => [
    v.id, v.deptId, q(v.position), q(iso(v.opened)),
    v.closed ? q(iso(v.closed)) : "null", v.hiredEmpId ?? "null",
  ]),
);
insertBlock(
  "applications",
  ["id", "vacancy_id", "candidate_name", "source", "applied_on", "stage"],
  applications.map((a) => [a.id, a.vacId, q(a.name), q(a.source), q(iso(a.applied)), q(a.stage)]),
);
insertBlock(
  "salary_history",
  ["id", "employee_id", "valid_from", "monthly_salary"],
  salaryHistory.map((s) => [s.id, s.empId, q(iso(s.from)), s.salary]),
);
insertBlock(
  "ats_raw",
  ["fio", "telefon", "data_otklika", "vakansiya", "istochnik", "etap"],
  atsRows.map((r) => [q(r.fio), q(r.telefon), q(r.data), q(r.vak), q(r.ist), q(r.etap)]),
);

mkdirSync(join(ROOT, "sandbox"), { recursive: true });
writeFileSync(join(ROOT, "sandbox", "seed.sql"), lines.join("\n"));

// ---------- CSV для Excel и DataLens ----------
// Разделитель `;` и BOM — русский Excel открывает двойным щелчком;
// даты дд.мм.гггг, дробные с запятой, булево «да/нет».
mkdirSync(join(ROOT, "data"), { recursive: true });
function writeCsv(name, header, rows) {
  const esc = (v) => {
    const s = String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = rows.map((r) => r.map(esc).join(";")).join("\n");
  writeFileSync(join(ROOT, "data", name), "﻿" + header.join(";") + "\n" + body + "\n");
}
const deptName = (id) => deptById(id).name;
writeCsv("departments.csv", ["id", "отдел"], DEPTS.map((x) => [x.id, x.name]));
writeCsv(
  "employees.csv",
  ["id", "ФИО", "пол", "дата рождения", "отдел_id", "должность", "дата приёма", "дата увольнения", "ставка"],
  employees.map((e) => [
    e.id, e.name, e.sex, ru(e.birth), e.deptId, e.position, ru(e.hire),
    e.term ? ru(e.term) : "", e.fte === 1 ? "1" : "0,5",
  ]),
);
writeCsv(
  "terminations.csv",
  ["id", "сотрудник_id", "дата увольнения", "основание", "добровольное"],
  terminations
    .slice()
    .sort((a, b) => a.date - b.date || a.empId - b.empId)
    .map((t, i) => [i + 1, t.empId, ru(t.date), t.reason, t.voluntary ? "да" : "нет"]),
);
writeCsv(
  "vacancies.csv",
  ["id", "отдел", "должность", "открыта", "закрыта", "нанят_id"],
  vacancies.map((v) => [
    v.id, deptName(v.deptId), v.position, ru(v.opened), v.closed ? ru(v.closed) : "", v.hiredEmpId ?? "",
  ]),
);
writeCsv(
  "applications.csv",
  ["id", "вакансия_id", "кандидат", "источник", "дата отклика", "этап"],
  applications.map((a) => [a.id, a.vacId, a.name, a.source, ru(a.applied), a.stage]),
);
writeCsv(
  "salary_history.csv",
  ["id", "сотрудник_id", "действует с", "оклад"],
  salaryHistory.map((s) => [s.id, s.empId, ru(s.from), s.salary]),
);
writeCsv(
  "ats_raw.csv",
  ["ФИО", "телефон", "дата отклика", "вакансия", "источник", "этап"],
  atsRows.map((r) => [r.fio, r.telefon, r.data, r.vak, r.ist, r.etap]),
);

console.log("Записано: sandbox/seed.sql и data/*.csv");
