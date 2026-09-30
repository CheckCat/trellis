// Адвокат A (план): структурная сверка manifest.yaml <-> skills.yaml.
// Запуск: node .claude/debates/2026-09-30-hr-analytics-review/check-plan-structure.mjs
// (из корня репо; использует yaml из корневых node_modules)
import { parse } from 'yaml';
import fs from 'fs';

const dir = 'courses/hr-analytics/';
const sk = parse(fs.readFileSync(dir + 'skills.yaml', 'utf8'));
const mf = parse(fs.readFileSync(dir + 'manifest.yaml', 'utf8'));

const modLessons = Object.fromEntries(mf.modules.map((m) => [m.id, m.lessons.map((l) => l.id)]));
const order = mf.modules.flatMap((m) => modLessons[m.id]);
const pos = Object.fromEntries(order.map((id, i) => [id, i]));
const les = Object.fromEntries(sk.lessons.map((l) => [l.id, l]));

// 1. Совпадение множеств id
console.log('in skills not manifest:', Object.keys(les).filter((x) => pos[x] === undefined));
console.log('in manifest not skills:', order.filter((x) => !les[x]));

// 2. Часы: сумма уроков против бюджета модуля
const budgets = Object.fromEntries(sk.modules.map((m) => [m.id, m.budget_hours]));
let tot = 0;
for (const m of mf.modules) {
  const s = modLessons[m.id].reduce((a, l) => a + (les[l]?.hours || 0), 0);
  tot += s;
  if (s > budgets[m.id]) console.log('BUDGET OVERRUN:', m.id, s, '>', budgets[m.id]);
}
console.log('total lesson hours:', tot, '| total budget:', sk.modules.reduce((a, m) => a + m.budget_hours, 0));

// 3. Порядок: requires урока всегда раньше него; skill-пререквизит преподан раньше
for (const l of sk.lessons)
  for (const r of l.requires || [])
    if (pos[r] === undefined || pos[r] >= pos[l.id]) console.log('REQ ORDER VIOLATION:', l.id, '->', r);
const taughtAt = {};
for (const l of sk.lessons)
  for (const s of l.teaches || []) {
    if (taughtAt[s]) console.log('SKILL TAUGHT TWICE:', s);
    taughtAt[s] = l.id;
  }
const skills = Object.fromEntries(sk.skills.map((s) => [s.id, s]));
console.log('skills never taught:', Object.keys(skills).filter((s) => !taughtAt[s]));
console.log('taught undeclared:', Object.keys(taughtAt).filter((s) => !skills[s]));
for (const [sid, s] of Object.entries(skills))
  for (const r of s.requires || [])
    if (taughtAt[sid] && taughtAt[r] && pos[taughtAt[r]] >= pos[taughtAt[sid]])
      console.log('SKILL PREREQ ORDER VIOLATION:', sid, '@', taughtAt[sid], '->', r, '@', taughtAt[r]);

// 4. verify в skills.yaml против фактического содержимого урока в манифесте
for (const m of mf.modules)
  for (const l of m.lessons) {
    const v = les[l.id]?.verify;
    const p = l.practice;
    const ptype = p ? p.type || 'sql' : null;
    let expect;
    if (ptype === 'answer') expect = 'answer';
    else if (ptype === 'sql') expect = p.expected !== undefined ? 'sql-result' : 'sql-state';
    else if (l.quiz) expect = 'quiz';
    else expect = 'self';
    if (v !== expect) console.log('VERIFY MISMATCH:', l.id, 'skills:', v, 'manifest:', expect);
  }

// 5. Замыкание requires: покрывает ли оно уроки, чьи конструкции реально
// использует эталон/поле практики (кандидаты найдены чтением уроков)
function closure(ids) {
  const seen = new Set();
  const st = [...ids];
  while (st.length) {
    const x = st.pop();
    if (seen.has(x)) continue;
    seen.add(x);
    for (const r of les[x]?.requires || []) st.push(r);
  }
  return seen;
}
const cases = [
  ['metrics-practice-set', 'metrics-engagement', 'поле enps требует формулу eNPS'],
  ['sql-dates', 'sql-group-by', 'эталон: group by 1'],
  ['sql-dates', 'sql-aggregates', 'эталон: count(*)'],
  ['sql-dates', 'sql-order-limit', 'эталон: order by 1, ordered: true'],
  ['sql-recruiting-query', 'sql-order-limit', 'эталон: order by 2 desc, ordered: true'],
  ['sql-final-practice', 'sql-order-limit', 'эталон: order by, ordered: true'],
  ['capstone-data', 'sql-order-limit', 'эталон: order by d.name, ordered: true'],
  ['forecast-practice-cohorts', 'sql-dates', 'эталон: extract(year ...), termination_date - hire_date'],
  ['forecast-practice-cohorts', 'sql-case-null', 'эталон: case when ... then 1 else 0 end'],
];
for (const [lesson, needed, why] of cases) {
  const ok = closure(les[lesson].requires || []).has(needed);
  console.log(`${ok ? 'OK   ' : 'MISS '} ${lesson} -> ${needed} (${why})`);
}
