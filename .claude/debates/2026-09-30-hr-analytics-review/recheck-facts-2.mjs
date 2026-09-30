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
const days = (a,b) => Math.round((a-b)/86400000);
const employees = csv('employees.csv'), salary = csv('salary_history.csv'), departments = csv('departments.csv');
const depName = Object.fromEntries(departments.map(r=>[r.id, r['отдел']]));
const cut = new Date(Date.UTC(2025,11,31));
const act = employees.filter(e => d(e['дата приёма'])<=cut && (!d(e['дата увольнения']) || d(e['дата увольнения'])>=cut));
const lastSalary = {};
for (const s of salary) { const c = lastSalary[s['сотрудник_id']]; if (!c || d(s['действует с'])>d(c['действует с'])) lastSalary[s['сотрудник_id']]=s; }
// ИТ оклады
const it = act.filter(e=>depName[e['отдел_id']]==='ИТ').map(e=>+lastSalary[e.id]['оклад']).sort((a,b)=>a-b);
console.log('ИТ оклады:', it.join('; '));
console.log('ИТ avg:', (it.reduce((a,b)=>a+b,0)/it.length).toFixed(2), 'median:', (it[6]+it[7])/2);
console.log('выше среднего:', it.filter(x => x > it.reduce((a,b)=>a+b,0)/it.length).length, 'из', it.length);
// когорты по годам найма: дожитие до 90/180/365
for (const y of [2018,2019,2020,2021,2022,2023,2024]) {
  const coh = employees.filter(e=>d(e['дата приёма']).getUTCFullYear()===y);
  const surv = (n) => coh.filter(e => { const t = d(e['дата увольнения']); return !t || days(t, d(e['дата приёма'])) >= n; }).length;
  console.log(`когорта ${y}: n=${coh.length}, 90д=${surv(90)}, 180д=${surv(180)}, 365д=${surv(365)}`);
}
// нанятые 2023-2025 и ушедшие (для «11 из 65»?)
const h2325 = employees.filter(e=>{const y=d(e['дата приёма']).getUTCFullYear(); return y>=2023&&y<=2025;});
console.log('нанято 2023-2025:', h2325.length, 'из них уволено:', h2325.filter(e=>e['дата увольнения']).length);
// нанято в 2025
const h25 = employees.filter(e=>d(e['дата приёма']).getUTCFullYear()===2025);
console.log('нанято 2025:', h25.length, 'уволено из них:', h25.filter(e=>e['дата увольнения']).length);
// стаж: активные с датой приёма 2025 (новички), для forecast-experiments «17 человек»?
console.log('активных из нанятых 2025:', h25.filter(e=>!e['дата увольнения']).length);
// HR отдел: 6 человек, 1 увольнение => 16,7%
