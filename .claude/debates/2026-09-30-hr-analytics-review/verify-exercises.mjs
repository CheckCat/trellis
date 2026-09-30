// Адвокат C: пересчёт эталонов answer-практик и проверка ties в ordered SQL-заданиях
// по courses/hr-analytics/data/*.csv (";" + BOM, даты дд.мм.гггг).
import { readFileSync } from "node:fs";

const DIR = "/Users/vadim/Documents/Pet/trellis/courses/hr-analytics/data/";

function csv(name) {
  let text = readFileSync(DIR + name, "utf8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  const header = lines[0].split(";");
  return lines.slice(1).map((l) => {
    const cells = l.split(";");
    const row = {};
    header.forEach((h, i) => (row[h] = cells[i] ?? ""));
    row.__raw = l;
    return row;
  });
}
function d(s) {
  // дд.мм.гггг -> Date (UTC)
  if (!s) return null;
  const [dd, mm, yyyy] = s.split(".").map(Number);
  return Date.UTC(yyyy, mm - 1, dd);
}
const DAY = 86400000;
const D = (y, m, day) => Date.UTC(y, m - 1, day);

const employees = csv("employees.csv");
const terminations = csv("terminations.csv");
const departments = csv("departments.csv");
const vacancies = csv("vacancies.csv");
const applications = csv("applications.csv");
const atsRaw = csv("ats_raw.csv");
const salaries = csv("salary_history.csv");

console.log("== columns ==");
console.log("employees:", Object.keys(employees[0]).join(","));
console.log("terminations:", Object.keys(terminations[0]).join(","));
console.log("departments:", Object.keys(departments[0]).join(","));
console.log("vacancies:", Object.keys(vacancies[0]).join(","));
console.log("applications:", Object.keys(applications[0]).join(","));
console.log("ats_raw:", Object.keys(atsRaw[0]).join(","));
console.log("salary_history:", Object.keys(salaries[0]).join(","));

const r1 = (x) => Math.round(x * 10) / 10;
const activeAt = (e, at) => d(e["дата приёма"]) <= at && (!e["дата увольнения"] || d(e["дата увольнения"]) >= at);

// ---------- excel-formulas ----------
const active = employees.filter((e) => !e["дата увольнения"]);
console.log("\n== excel-formulas ==");
console.log("active-count:", active.length, "(expected 120)");
console.log("active-dept3:", active.filter((e) => e["отдел_id"] === "3").length, "(expected 38)");
console.log("active-fte-sum:", active.reduce((s, e) => s + Number(e["ставка"].replace(",", ".")), 0), "(expected 118.5)");

// ---------- metrics-turnover-practice ----------
console.log("\n== metrics-turnover-practice ==");
const monthEnds = [...Array(12)].map((_, i) => D(2025, i + 1, new Date(Date.UTC(2025, i + 1, 0)).getUTCDate()));
const hc = monthEnds.map((at) => employees.filter((e) => activeAt(e, at)).length);
console.log("month-end headcounts 2025:", hc.join(","));
const avgHc = hc.reduce((a, b) => a + b, 0) / 12;
console.log("avg-headcount:", avgHc, "(expected 119.6 ±0.2)");
const t2025 = terminations.filter((t) => d(t["дата увольнения"]) >= D(2025, 1, 1) && d(t["дата увольнения"]) <= D(2025, 12, 31));
console.log("terminations 2025:", t2025.length, "(README: 23)");
console.log("turnover:", r1((t2025.length / avgHc) * 100), "(expected 19.2 ±0.3)");
const hcJan1 = employees.filter((e) => activeAt(e, D(2025, 1, 1))).length;
const hcDec31 = employees.filter((e) => activeAt(e, D(2025, 12, 31))).length;
const simplified = r1((t2025.length / ((hcJan1 + hcDec31) / 2)) * 100);
console.log("simplified turnover (HC jan1", hcJan1, "+ dec31", hcDec31, ")/2:", simplified, "-> passes ±0.3 of 19.2?", Math.abs(simplified - 19.2) <= 0.3);
const vol2025 = t2025.filter((t) => t["добровольное"] === "да" || t["основание"] === "по собственному желанию");
console.log("voluntary count:", vol2025.length, "по собственному:", t2025.filter((t) => t["основание"] === "по собственному желанию").length);
console.log("voluntary-turnover:", r1((vol2025.length / avgHc) * 100), "(expected 12.5 ±0.3)");
console.log("voluntary-share:", r1((t2025.filter((t) => t["основание"] === "по собственному желанию").length / t2025.length) * 100), "(expected 65.2 ±0.5)");

// ---------- excel-cleaning (ats_raw) ----------
console.log("\n== excel-cleaning ==");
console.log("rows-total:", atsRaw.length, "(expected 47)");
const seen = new Map();
atsRaw.forEach((r) => seen.set(r.__raw, (seen.get(r.__raw) ?? 0) + 1));
let dupRemoved = 0;
for (const [, n] of seen) dupRemoved += n - 1;
console.log("duplicate-rows removed by Excel dedup:", dupRemoved, "(expected 3)");
console.log("empty-stage:", atsRaw.filter((r) => r["этап"].trim() === "").length, "(expected 7)");

// ---------- excel-practice-hiring ----------
console.log("\n== excel-practice-hiring ==");
const closed2025 = vacancies.filter((v) => v["закрыта"] && d(v["закрыта"]) >= D(2025, 1, 1) && d(v["закрыта"]) <= D(2025, 12, 31));
console.log("closed-2025:", closed2025.length, "(expected 26)");
const days = closed2025.map((v) => (d(v["закрыта"]) - d(v["открыта"])) / DAY);
console.log("avg-days-to-close:", r1(days.reduce((a, b) => a + b, 0) / days.length), "(expected 44.6 ±0.5)");
const closedIds = new Set(closed2025.map((v) => v.id));
const appsOnClosed = applications.filter((a) => closedIds.has(a["вакансия_id"]));
console.log("apps-on-closed:", appsOnClosed.length, "(expected 500); applications total rows:", applications.length);

// ---------- excel-practice-turnover / viz-practice-turnover ----------
console.log("\n== terminations 2025 by dept / month ==");
const empById = new Map(employees.map((e) => [e.id, e]));
const deptById = new Map(departments.map((x) => [x.id, x["отдел"]]));
const byDept = {};
t2025.forEach((t) => {
  const e = empById.get(t["сотрудник_id"]);
  const name = deptById.get(e["отдел_id"]);
  byDept[name] = (byDept[name] ?? 0) + 1;
});
console.log("by dept:", JSON.stringify(byDept));
const byMonth = {};
t2025.forEach((t) => { const m = t["дата увольнения"].slice(3); byMonth[m] = (byMonth[m] ?? 0) + 1; });
console.log("by month:", JSON.stringify(byMonth), "(jan expected 4)");

// ---------- viz-practice-recruiting ----------
console.log("\n== viz-practice-recruiting ==");
const perDeptTtf = {};
closed2025.forEach((v) => {
  const dep = v["отдел"];
  (perDeptTtf[dep] ??= []).push((d(v["закрыта"]) - d(v["открыта"])) / DAY);
});
const deptAvg = Object.entries(perDeptTtf).map(([k, arr]) => [k, r1(arr.reduce((a, b) => a + b, 0) / arr.length), arr.length]);
deptAvg.sort((a, b) => b[1] - a[1]);
console.log("per-dept avg ttf (closed 2025):", JSON.stringify(deptAvg));
const ties = deptAvg.filter((x, i, a) => a.some((y, j) => j !== i && y[1] === x[1]));
console.log("TIES in rounded avg (sql-recruiting-query ordered:true, order by 2 desc):", JSON.stringify(ties));
console.log("offer-and-beyond:", appsOnClosed.filter((a) => ["оффер", "нанят"].includes(a["этап"])).length, "(expected 33)");
console.log("stage counts on closed-2025:", JSON.stringify(appsOnClosed.reduce((m, a) => ((m[a["этап"]] = (m[a["этап"]] ?? 0) + 1), m), {})));

// ---------- sql-order-limit ties ----------
console.log("\n== sql-order-limit (top-10 hire_date desc) ==");
const sorted = [...employees].sort((a, b) => d(b["дата приёма"]) - d(a["дата приёма"]));
console.log(sorted.slice(0, 13).map((e, i) => `${i + 1}. ${e["дата приёма"]} ${e["ФИО"]}`).join("\n"));
const tenth = sorted[9]["дата приёма"], eleventh = sorted[10]["дата приёма"];
console.log("boundary tie (10th vs 11th same date)?", tenth === eleventh, `(${tenth} vs ${eleventh})`);
const dupInTop = sorted.slice(0, 10).filter((e, i, a) => a.some((y, j) => j !== i && y["дата приёма"] === e["дата приёма"]));
console.log("duplicate dates inside top-10:", dupInTop.length);

// ---------- capstone-metrics: dept turnover both methods ----------
console.log("\n== capstone-metrics dept turnover ==");
for (const dep of ["Продажи", "ИТ"]) {
  const depId = departments.find((x) => x["отдел"] === dep).id;
  const depEmp = employees.filter((e) => e["отдел_id"] === depId);
  const hcm = monthEnds.map((at) => depEmp.filter((e) => activeAt(e, at)).length);
  const avg = hcm.reduce((a, b) => a + b, 0) / 12;
  const terms = t2025.filter((t) => empById.get(t["сотрудник_id"])["отдел_id"] === depId).length;
  const j1 = depEmp.filter((e) => activeAt(e, D(2025, 1, 1))).length;
  const d31 = depEmp.filter((e) => activeAt(e, D(2025, 12, 31))).length;
  console.log(`${dep}: terms=${terms} avgHC=${avg.toFixed(2)} turnover=${r1((terms / avg) * 100)} | simplified=(${j1}+${d31})/2 -> ${r1((terms / ((j1 + d31) / 2)) * 100)}`);
}
const itClosed = closed2025.filter((v) => v["отдел"] === "ИТ");
console.log("ttf-it:", r1(itClosed.map((v) => (d(v["закрыта"]) - d(v["открыта"])) / DAY).reduce((a, b) => a + b, 0) / itClosed.length), "(expected 91.5 ±1)");

// ---------- forecast cohorts ----------
console.log("\n== forecast-practice-cohorts ==");
for (const y of [2023, 2024]) {
  const cohort = employees.filter((e) => d(e["дата приёма"]) >= D(y, 1, 1) && d(e["дата приёма"]) <= D(y, 12, 31));
  const kept = cohort.filter((e) => !e["дата увольнения"] || (d(e["дата увольнения"]) - d(e["дата приёма"])) / DAY >= 365);
  console.log(`${y}: hired=${cohort.length} kept=${kept.length}`);
}

// ---------- salaries: Финансы (metrics-stats-basics) ----------
console.log("\n== metrics-stats-basics (Финансы, активные, последний оклад) ==");
const finId = departments.find((x) => x["отдел"] === "Финансы").id;
const finActive = active.filter((e) => e["отдел_id"] === finId);
const lastSalary = (empId) => {
  const rows = salaries.filter((s) => s["сотрудник_id"] === empId).sort((a, b) => d(b["действует с"]) - d(a["действует с"]));
  return rows.length ? Number(rows[0]["оклад"]) : null;
};
const finSal = finActive.map((e) => lastSalary(e.id)).sort((a, b) => a - b);
console.log("salaries:", finSal.join(";"));
const mean = finSal.reduce((a, b) => a + b, 0) / finSal.length;
const median = finSal.length % 2 ? finSal[(finSal.length - 1) / 2] : (finSal[finSal.length / 2 - 1] + finSal[finSal.length / 2]) / 2;
console.log("mean:", mean, "(expected 94625 ±50) median:", median, "(expected 87250 ±50)");

// ---------- sql-modify: id 132 ----------
console.log("\n== sql-modify id=132 ==");
const e132 = employees.find((e) => e.id === "132");
console.log(JSON.stringify(e132));
console.log("in terminations?", terminations.some((t) => t["сотрудник_id"] === "132"));

// ---------- metrics-practice-set: 8 vacancies id 26-33 ----------
console.log("\n== metrics-practice-set (vacancies id 26..33) ==");
const v8 = vacancies.filter((v) => Number(v.id) >= 26 && Number(v.id) <= 33);
console.log(v8.map((v) => `${v.id}:${v["открыта"]}->${v["закрыта"]}=${(d(v["закрыта"]) - d(v["открыта"])) / DAY}d`).join(" "));
console.log("avg-ttf:", r1(v8.map((v) => (d(v["закрыта"]) - d(v["открыта"])) / DAY).reduce((a, b) => a + b, 0) / v8.length), "(expected 49.9 ±0.5)");
