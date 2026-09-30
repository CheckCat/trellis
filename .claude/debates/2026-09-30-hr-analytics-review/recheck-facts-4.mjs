import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const root = join(dirname(fileURLToPath(import.meta.url)), '../../../courses/hr-analytics/data');
function csv(name) {
  const raw = readFileSync(join(root, name), 'utf8').replace(/^﻿/, '');
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const header = lines[0].split(';');
  return lines.slice(1).map((l) => { const c = l.split(';'); const r = {}; header.forEach((h,i)=>r[h]=c[i]??''); return r; });
}
const d = (s) => { const m = s && s.match(/^(\d{2})\.(\d{2})\.(\d{4})$/); return m ? new Date(Date.UTC(+m[3], +m[2]-1, +m[1])) : null; };
const employees = csv('employees.csv'), departments = csv('departments.csv'), vacancies = csv('vacancies.csv');
const depName = Object.fromEntries(departments.map(r=>[r.id, r['отдел']]));
// сравнение termination_date is null vs convention on 2025-12-31
const nullActive = employees.filter(e=>!e['дата увольнения']);
console.log('term is null:', nullActive.length);
const lastTerm = employees.filter(e=>e['дата увольнения']).map(e=>e['дата увольнения']).sort((a,b)=>d(a)-d(b)).pop();
console.log('последняя дата увольнения в данных:', lastTerm);
// группы отдел×пол по is null
const g = {};
for (const e of nullActive) { const k = depName[e['отдел_id']]+' '+e['пол']; g[k]=(g[k]||0)+1; }
console.log(JSON.stringify(g, null, 0));
// таблица practice-set: 8 вакансий — сверка дат с vacancies.csv id 26-33
for (const v of vacancies.filter(v=>+v.id>=26&&+v.id<=33)) console.log(v.id, v['должность'], v['открыта'], v['закрыта'], 'дней:', Math.round((d(v['закрыта'])-d(v['открыта']))/86400000));
