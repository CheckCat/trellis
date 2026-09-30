#!/usr/bin/env node
// Пересчёт «Ключевых чисел» курса hr-analytics по data/*.csv.
// Запуск: node recheck-facts.mjs  (из любого каталога)
// CSV: `;`-разделитель, BOM, даты дд.мм.гггг.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../../courses/hr-analytics/data');

function csv(name) {
  const raw = readFileSync(join(root, name), 'utf8').replace(/^﻿/, '');
  const lines = raw.split(/\r?\n/).filter((l) => l.length > 0);
  const header = lines[0].split(';');
  return lines.slice(1).map((l) => {
    const cells = l.split(';');
    const row = {};
    header.forEach((h, i) => (row[h] = cells[i] ?? ''));
    return row;
  });
}

function d(s) {
  // дд.мм.гггг -> Date (UTC midnight)
  if (!s) return null;
  const m = s.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!m) return null;
  return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
}
const D = (iso) => new Date(iso + 'T00:00:00Z');
const days = (a, b) => Math.round((a - b) / 86400000);

const employees = csv('employees.csv');
const terminations = csv('terminations.csv');
const departments = csv('departments.csv');
const vacancies = csv('vacancies.csv');
const applications = csv('applications.csv');
const salary = csv('salary_history.csv');
const ats = csv('ats_raw.csv');

const depName = Object.fromEntries(departments.map((r) => [r.id, r['отдел']]));

const activeOn = (date) =>
  employees.filter((e) => {
    const h = d(e['дата приёма']);
    const t = d(e['дата увольнения']);
    return h <= date && (t === null || t >= date);
  });

const out = [];
const log = (k, v) => { out.push(`${k}: ${v}`); console.log(`${k}: ${v}`); };

log('employees total', employees.length);
const cut = D('2025-12-31');
const act = activeOn(cut);
log('active 2025-12-31', act.length);
log('FTE 2025-12-31', act.reduce((s, e) => s + Number(e['ставка'].replace(',', '.')), 0));

// численность на конец каждого месяца 2025
const monthEnds = [...Array(12)].map((_, i) => new Date(Date.UTC(2025, i + 1, 0)));
const hcMonths = monthEnds.map((m) => activeOn(m).length);
log('HC month-ends 2025', hcMonths.join(', '));
const avgHC = hcMonths.reduce((a, b) => a + b, 0) / 12;
log('avg HC 2025', avgHC.toFixed(4));

// увольнения по годам (по terminations.csv)
for (const y of [2023, 2024, 2025]) {
  const n = terminations.filter((t) => d(t['дата увольнения']).getUTCFullYear() === y).length;
  log(`terminations ${y}`, n);
}
const term25 = terminations.filter((t) => d(t['дата увольнения']).getUTCFullYear() === 2025);
log('turnover 2025 %', ((term25.length / avgHC) * 100).toFixed(2));

// упрощённая формула
const hcJan1 = activeOn(D('2025-01-01')).length;
log('HC 2025-01-01', hcJan1);
log('turnover simplified %', ((term25.length / ((hcJan1 + act.length) / 2)) * 100).toFixed(2));

// текучесть по отделам 2025
const empById = Object.fromEntries(employees.map((e) => [e.id, e]));
const termByDep = {};
for (const t of term25) {
  const dep = depName[empById[t['сотрудник_id']]['отдел_id']];
  termByDep[dep] = (termByDep[dep] || 0) + 1;
}
const depAvgHC = {};
for (const m of monthEnds) {
  for (const e of activeOn(m)) {
    const dep = depName[e['отдел_id']];
    depAvgHC[dep] = (depAvgHC[dep] || 0) + 1 / 12;
  }
}
for (const dep of Object.keys(depAvgHC).sort()) {
  log(`turnover 2025 ${dep} %`, (((termByDep[dep] || 0) / depAvgHC[dep]) * 100).toFixed(2) + ` (терм ${termByDep[dep] || 0} / ср. ${depAvgHC[dep].toFixed(2)})`);
}

// основания 2025
const reasons = {};
for (const t of term25) reasons[t['основание']] = (reasons[t['основание']] || 0) + 1;
log('reasons 2025', JSON.stringify(reasons));

// ранняя текучесть (<90 дней)
const early = term25.filter((t) => days(d(t['дата увольнения']), d(empById[t['сотрудник_id']]['дата приёма'])) < 90);
log('early turnover 2025', `${early.length} из ${term25.length} (${((early.length / term25.length) * 100).toFixed(1)}%)`);

// time-to-fill 2025
const closed25 = vacancies.filter((v) => v['закрыта'] && d(v['закрыта']).getUTCFullYear() === 2025);
const ttf = closed25.map((v) => days(d(v['закрыта']), d(v['открыта'])));
log('time-to-fill 2025', `avg ${(ttf.reduce((a, b) => a + b, 0) / ttf.length).toFixed(2)} по ${ttf.length} вакансиям`);
const ttfDep = {};
for (const v of closed25) (ttfDep[v['отдел']] ||= []).push(days(d(v['закрыта']), d(v['открыта'])));
for (const dep of Object.keys(ttfDep).sort())
  log(`ttf ${dep}`, (ttfDep[dep].reduce((a, b) => a + b, 0) / ttfDep[dep].length).toFixed(2) + ` (n=${ttfDep[dep].length})`);

// воронка 2025: заявки по вакансиям, закрытым в 2025; этап — максимальный достигнутый
const closedIds = new Set(closed25.map((v) => v.id));
const apps25 = applications.filter((a) => closedIds.has(a['вакансия_id']));
const stageOrder = ['отклик', 'скрининг', 'интервью', 'оффер', 'нанят'];
const byStage = {};
for (const a of apps25) byStage[a['этап']] = (byStage[a['этап']] || 0) + 1;
log('apps by max stage', JSON.stringify(byStage));
const cum = stageOrder.map((s, i) => stageOrder.slice(i).reduce((n, s2) => n + (byStage[s2] || 0), 0));
log('funnel cumulative', cum.join(' → '));

// источники нанятых 2025
const srcHired = {};
for (const a of apps25.filter((a) => a['этап'] === 'нанят')) srcHired[a['источник']] = (srcHired[a['источник']] || 0) + 1;
log('sources of hired', JSON.stringify(srcHired));

// оклады активных на 2025-12-31: последняя запись salary_history
const lastSalary = {};
for (const s of salary) {
  const cur = lastSalary[s['сотрудник_id']];
  if (!cur || d(s['действует с']) > d(cur['действует с'])) lastSalary[s['сотрудник_id']] = s;
}
const sal = act.map((e) => Number(lastSalary[e.id]['оклад'])).sort((a, b) => a - b);
const median = (arr) => (arr.length % 2 ? arr[(arr.length - 1) / 2] : (arr[arr.length / 2 - 1] + arr[arr.length / 2]) / 2);
log('salary avg', (sal.reduce((a, b) => a + b, 0) / sal.length).toFixed(2));
log('salary median', median(sal));
// P90: percentile_cont(0.9) как в Postgres
const idx = 0.9 * (sal.length - 1);
const lo = Math.floor(idx), hi = Math.ceil(idx);
log('salary P90 (cont)', sal[lo] + (sal[hi] - sal[lo]) * (idx - lo));
log('salary min/max', `${sal[0]} / ${sal[sal.length - 1]}`);

// Финансы
const fin = act.filter((e) => depName[e['отдел_id']] === 'Финансы').map((e) => Number(lastSalary[e.id]['оклад'])).sort((a, b) => a - b);
log('Финансы оклады', fin.join('; '));
log('Финансы avg/median', `${(fin.reduce((a, b) => a + b, 0) / fin.length).toFixed(2)} / ${median(fin)}`);

// удержание когорт (365 дней)
for (const y of [2023, 2024]) {
  const coh = employees.filter((e) => d(e['дата приёма']).getUTCFullYear() === y);
  const kept = coh.filter((e) => {
    const t = d(e['дата увольнения']);
    return t === null || days(t, d(e['дата приёма'])) >= 365;
  });
  log(`retention cohort ${y}`, `${kept.length} из ${coh.length} (${((kept.length / coh.length) * 100).toFixed(1)}%)`);
}

// ats_raw
log('ats rows', ats.length);
const norm = ats.map((r) => JSON.stringify(r));
log('ats full dups', ats.length - new Set(norm).size);
const phones = new Set(ats.map((r) => r['телефон'].replace(/\D/g, '')));
log('ats unique phones', phones.size);
log('ats empty stage', ats.filter((r) => !r['этап'].trim()).length);

// по отделам на 2025-12-31
const depHC = {};
for (const e of act) depHC[depName[e['отдел_id']]] = (depHC[depName[e['отдел_id']]] || 0) + 1;
log('HC by dept 2025-12-31', JSON.stringify(depHC));

// 2024: среднесписочная и текучесть
const monthEnds24 = [...Array(12)].map((_, i) => new Date(Date.UTC(2024, i + 1, 0)));
const hc24 = monthEnds24.map((m) => activeOn(m).length);
const avg24 = hc24.reduce((a, b) => a + b, 0) / 12;
const term24 = terminations.filter((t) => d(t['дата увольнения']).getUTCFullYear() === 2024).length;
log('avg HC 2024 / turnover 2024', `${avg24.toFixed(2)} / ${((term24 / avg24) * 100).toFixed(2)}%`);

// увольнения янв-2025; Продажи Q1-2025
log('terms Jan 2025', term25.filter((t) => d(t['дата увольнения']).getUTCMonth() === 0).length);
log('terms Продажи Q1 2025', term25.filter((t) => {
  const e = empById[t['сотрудник_id']];
  return depName[e['отдел_id']] === 'Продажи' && d(t['дата увольнения']).getUTCMonth() <= 2;
}).length);

// 8 первых вакансий, закрытых в 2025 (id 26–33)
const v8 = vacancies.filter((v) => +v.id >= 26 && +v.id <= 33);
const v8d = v8.map((v) => days(d(v['закрыта']), d(v['открыта'])));
log('vacancies 26-33 avg days', (v8d.reduce((a, b) => a + b, 0) / v8d.length).toFixed(2) + ` (n=${v8d.length})`);

// privacy-anonymization: группы отдел×пол среди работающих
const groups = {};
for (const e of act) {
  const k = depName[e['отдел_id']] + '|' + e['пол'];
  groups[k] = (groups[k] || 0) + 1;
}
const sizes = Object.values(groups);
log('groups dep×sex', `${sizes.length} групп; <5: ${sizes.filter((n) => n < 5).length}; min: ${Math.min(...sizes)}`);

// оклад руководителя отдела продаж; Попова Ольга Михайловна
const head = act.find((e) => e['должность'] === 'руководитель отдела продаж');
log('оклад рук. продаж', head ? `${head['ФИО']}: ${lastSalary[head.id]['оклад']}` : 'не найден');
const popova = employees.find((e) => e['ФИО'].startsWith('Попова Ольга'));
log('Попова', popova ? `${popova['ФИО']}, ${depName[popova['отдел_id']]}, ${lastSalary[popova.id]['оклад']}` : 'не найдена');

// сотрудник 132
const e132 = empById['132'];
log('id 132', e132 ? `${e132['должность']}, ${depName[e132['отдел_id']]}, уволен: ${e132['дата увольнения'] || 'нет'}; в terminations: ${terminations.some((t) => t['сотрудник_id'] === '132')}` : 'нет');
