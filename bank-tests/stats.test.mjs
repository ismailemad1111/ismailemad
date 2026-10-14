/* مقارنة النسخة الأصلية بالمعدّلة على نفس البيانات (محاكي Firestore في الذاكرة):
   - النتائج يجب أن تتطابق تمامًا (deepEqual)
   - ويُقاس عدد المستندات المقروءة (docsRead) وقراءات الـ aggregate (aggReads)
   تشغيل: node --import ./register.mjs stats.test.mjs
   يحتاج نسخة المشروع الأصلية في OLD_ROOT (افتراضيًا ../manasa_backup_original) للمقارنة. */
import assert from "node:assert/strict";
import fs from "node:fs";

const mem = {};
globalThis.sessionStorage = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } };
globalThis.window = { location: { pathname: "/", search: "" } };

const NEW_ROOT = new URL("../manasa/js/", import.meta.url);
const OLD_ROOT = new URL((process.env.OLD_ROOT || "../manasa_backup_original") + "/js/", import.meta.url);
const hasOld = fs.existsSync(new URL("backend/index.js", OLD_ROOT));
const { backendRequest: newReq } = await import(new URL("backend/index.js", NEW_ROOT).href);
const { backendRequest: oldReq } = hasOld ? await import(new URL("backend/index.js", OLD_ROOT).href) : {};
const { store, stats } = await import("./stubs/firestore.js");
const { authState } = await import("./stubs/auth.js");

const ADM = "admXXXX9999YYYY8888ZZZZ7777";
authState.currentUser = { uid: ADM };
mem.am_session = JSON.stringify({ role: "admin", token: "t", admin: { id: ADM, name: "x", email: "a@b.c" } });

/* ---- بيانات اصطناعية (في الذاكرة فقط، لا صلة بقاعدة بيانات حقيقية) ---- */
const STAGES = ["grade_4", "grade_5", "grade_6", "prep_1", "prep_2", "prep_3", "sec_1", "sec_2", "sec_3"];
let seed = 7; const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed >> 8) % n; };
const put = (path, data) => store.set(path, { data, version: 1 });
const T = (ms) => ({ toMillis: () => ms, toDate: () => new Date(ms) });
const NS = 120, NA = 400, NSESS = 300, NAI = 150;
put("settings/general", { passingPercent: 60 });
for (let i = 0; i < NS; i++) put(`students/s${i}`, { fullName: `طالب ${i}`, stage: STAGES[i % 9], code: String(10000 + i), status: "active", joinedAt: T(1e12 + i * 1000) });
put("students/_init", { _placeholder: true, note: "x", createdAt: T(1) });          // مستند مؤقت بجوار بيانات حقيقية
for (let i = 0; i < NS + 10; i++) put(`codes/${10000 + i}`, { code: String(10000 + i), status: i < NS ? "active" : "unused", studentId: i < NS ? `s${i}` : null, stage: STAGES[i % 9], createdAt: T(1e12 + i) });
put("codes/_init", { _placeholder: true });
const NE = 6;
for (let i = 0; i < NE; i++) put(`exams/e${i}`, { title: `اختبار ${i}`, stage: STAGES[i], status: i % 3 === 2 ? "draft" : "published", questions: [1, 2, 3], createdAt: T(1e12 + i) });
for (let i = 0; i < NA; i++) {
  const sid = i % 17 === 0 ? `ghost${i}` : `s${rnd(NS)}`;          // بعض المحاولات لطلاب بلا مستند
  const total = 10 + (i % 3) * 5, score = rnd(total + 1);
  const d = { examId: `e${rnd(NE)}`, studentId: sid, stage: "sec_1", score, total, percent: Math.round(score / total * 100), correctCount: score, wrongCount: total - score, resultVisible: i % 5 !== 0, attemptedAt: T(1.1e12 + i * 997) };
  if (i % 41 === 0) delete d.percent;                                // بيانات قديمة ينقصها الحقل
  put(`examAttempts/a${i}`, d);
}
put("exams/e9", { title: "اختبار بلا محاولات", stage: "sec_1", status: "published", questions: [1], createdAt: T(1e12) });
for (let i = 0; i < 20; i++) put(`subscriptionRequests/r${i}`, { fullName: `ولي ${i}`, status: ["pending", "contacted", "approved"][i % 3], createdAt: T(1e12 + i) });
for (let i = 0; i < 5; i++) put(`announcements/n${i}`, { title: `إعلان ${i}`, body: "نص", targetType: "all", createdAt: T(1e12 + i) });
for (let i = 0; i < 23; i++) put(`announcementReplies/p${i}`, { announcementId: `n${i % 4}`, studentId: `s${i}`, createdAt: T(1e12 + i) });
for (let i = 0; i < NSESS; i++) put(`studySessions/ss${i}`, { studentId: `s${rnd(NS)}`, durationMinutes: 5 + rnd(90), date: "2026-10-01" });
for (let i = 0; i < NAI; i++) put(`aiUsage/s${rnd(NS)}_d${i}`, { studentId: `s${rnd(40)}`, count: 1 + rnd(9), date: "2026-10-01" });
for (let i = 0; i < 3; i++) put(`events/ev${i}`, { title: `حدث ${i}`, type: "activity", stage: "all", status: "published", startAt: T(1e12 + i), endAt: T(2e12), createdAt: T(1e12 + i) });
for (let i = 0; i < 40; i++) put(`eventParticipations/ev${i % 3}_s${i}`, { eventId: `ev${i % 3}`, studentId: `s${i}`, status: i % 2 ? "completed" : "joined", reviewStatus: i % 4 === 0 ? "pending" : "none" });

const snapshot = () => JSON.stringify([...store.entries()].map(([k, v]) => [k, v.data]));
const before = snapshot();
const norm = (x) => JSON.parse(JSON.stringify(x));
const measure = async (req, method, path) => {
  const d0 = stats.docsRead, a0 = stats.aggReads, q0 = stats.aggQueries;
  const r = await req(path, { method });
  return { r: norm(r), docs: stats.docsRead - d0, agg: stats.aggReads - a0, aggQ: stats.aggQueries - q0 };
};

let passed = 0; const rows = [];
async function t(name, path, { pick = (o) => o, newPath = path } = {}) {
  try {
    const n = await measure(newReq, "GET", newPath);
    assert.equal(n.r.success, true, JSON.stringify(n.r));
    let line = { name, newDocs: n.docs, newAgg: n.agg, newAggQ: n.aggQ };
    if (hasOld) {
      const o = await measure(oldReq, "GET", path);
      assert.equal(o.r.success, true);
      assert.deepEqual(norm(pick(n.r.data)), norm(pick(o.r.data)), name + ": النتيجة تختلف عن النسخة الأصلية");
      line = { ...line, oldDocs: o.docs };
    }
    rows.push(line); passed++; console.log("  ✔", name);
  } catch (e) { console.error("  ✘", name, "\n    ", e && e.message || e); process.exitCode = 1; }
}

console.log(`— مقارنة الأصلي/المعدّل (${hasOld ? "مع النسخة الأصلية" : "بدون نسخة أصلية: فحوص مستقلة فقط"}) —`);
await t("الإحصائيات الكاملة (صفحة الإحصائيات)", "/api/admin/statistics");
await t("الإحصائيات: كروت الأعداد (لوحة الإدارة) = stats الأصلية", "/api/admin/statistics", { newPath: "/api/admin/statistics?scope=summary", pick: (d) => d.stats });
await t("قائمة الامتحانات + عدّاد المحاولات", "/api/admin/exams");
await t("النتائج لاختبار محدد", "/api/admin/results?examId=e1");
await t("النتائج لاختبار بلا محاولات (العنوان يظهر)", "/api/admin/results?examId=e9");
await t("النتائج لكل الاختبارات", "/api/admin/results");
await t("قائمة الإعلانات + عدد الردود", "/api/admin/announcements");
await t("قائمة الأحداث + إحصاء المشاركات", "/api/admin/events");

await (async () => {
  try {
    // فحوص مستقلة (لا تعتمد على النسخة الأصلية)
    const full = norm(await newReq("/api/admin/statistics", { method: "GET" })).data;
    assert.equal(full.stats.examsCount, 4 + 1, "الامتحانات المنشورة فقط");
    assert.equal(full.stats.studentsCount, NS, "المستند المؤقت لا يُعدّ طالبًا");
    assert.equal(full.stats.codesCount, NS + 10, "المستند المؤقت لا يُعدّ كودًا");
    assert.equal(Object.values(full.stageDistribution).reduce((a, b) => a + b, 0), NS);
    const mins = [...store].filter(([k]) => k.startsWith("studySessions/")).reduce((a, [, v]) => a + v.data.durationMinutes, 0);
    assert.equal(full.stats.studyHoursTotal, Math.round(mins / 60 * 10) / 10);
    assert.equal(full.usage.studySessionsCount, NSESS);
    const summary = norm(await newReq("/api/admin/statistics?scope=summary", { method: "GET" })).data;
    assert.deepEqual(summary.stats, full.stats, "ملخص اللوحة = stats الصفحة الكاملة");
    assert.deepEqual(Object.keys(summary), ["stats"]);
    passed++; console.log("  ✔ فحوص مستقلة: المستند المؤقت، توزيع المراحل، ساعات المذاكرة، تطابق الملخص");
  } catch (e) { console.error("  ✘ فحوص مستقلة\n    ", e.message); process.exitCode = 1; }
})();

await (async () => {
  try {
    // استيراد الأكواد: البحث المحدد عن الأكواد الملصوقة = نفس نتيجة قراءة كل الأكواد
    const core = await import(new URL("backend/core.js", NEW_ROOT).href);
    put("codes/55555", { code: 55555, status: "unused" });               // كود مخزّن رقمًا
    const pasted = ["10000", "10005", "55555", "99999", "01234", "10139", "10140", "10000"];
    const d0 = stats.docsRead;
    const targeted = await core.existingCodeSet(pasted);
    const targetedDocs = stats.docsRead - d0;
    const all = new Set((await core.listAll("codes")).map((c) => core.safeText(c.code)));
    const expected = new Set(pasted.filter((c) => all.has(c)));
    assert.deepEqual([...targeted].filter((c) => pasted.includes(c)).sort(), [...expected].sort());
    assert.ok(targeted.has("55555") && !targeted.has("99999") && !targeted.has("01234"));
    store.delete("codes/55555");
    passed++; console.log(`  ✔ استيراد الأكواد: بحث محدد يطابق قراءة الكل (قُرئ ${targetedDocs} مستندًا بدل ${NS + 11})`);
  } catch (e) { console.error("  ✘ استيراد الأكواد\n    ", e.message); process.exitCode = 1; }
})();

await (async () => {
  try {
    assert.equal(snapshot(), before, "تغيّرت بيانات في المخزن!");
    passed++; console.log("  ✔ لم تُكتب/تُعدّل/تُحذف أي بيانات أثناء كل الاختبارات (مقارنة لقطة كاملة قبل/بعد)");
  } catch (e) { console.error("  ✘", e.message); process.exitCode = 1; }
})();

console.log("\nالقراءات (محاكاة: مستندات مُرجَعة = قراءات؛ aggregate = قراءة لكل 1000 مدخل بحد أدنى 1):");
for (const r of rows) console.log(`  ${r.name}\n     قبل: ${r.oldDocs ?? "-"} مستند | بعد: ${r.newDocs} مستند + ${r.newAgg} قراءة aggregate (${r.newAggQ} استعلام تجميعي)`);
console.log(`\n${passed} اختبار نجح`);
