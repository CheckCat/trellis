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
const T = csv('terminations.csv');
const byMonth = Array(12).fill(0);
for (const t of T) byMonth[d(t['дата увольнения']).getUTCMonth()]++;
console.log('по месяцам 2023-2025:', byMonth.join(', '), 'Σ', byMonth.reduce((a,b)=>a+b,0));
for (const y of [2023,2024,2025]) {
  const jan = T.filter(t=>{const dt=d(t['дата увольнения']); return dt.getUTCFullYear()===y && dt.getUTCMonth()===0;}).length;
  console.log(`январь ${y}:`, jan);
}
console.log('декабрь 2024:', T.filter(t=>{const dt=d(t['дата увольнения']); return dt.getUTCFullYear()===2024 && dt.getUTCMonth()===11;}).length);
// добровольные 2025
const t25 = T.filter(t=>d(t['дата увольнения']).getUTCFullYear()===2025);
console.log('добровольных 2025:', t25.filter(t=>t['добровольное']==='да').length, 'из', t25.length);
