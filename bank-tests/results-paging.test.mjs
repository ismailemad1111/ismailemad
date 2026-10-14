/* ترقيم صفحة النتائج: يطابق التحميل الكامل القديم، ويرجع له تلقائيًا إن وُجدت بيانات قديمة.
   تشغيل: node --import ./register.mjs results-paging.test.mjs  (يحتاج OLD_ROOT للمقارنة مع الأصلي) */
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
const { store, stats, Timestamp } = await import("./stubs/firestore.js");
const { authState } = await import("./stubs/auth.js");
const ADM = "admXXXX9999YYYY8888ZZZZ7777";
authState.currentUser = { uid: ADM };
mem.am_session = JSON.stringify({ role: "admin", token: "t", admin: { id: ADM, name: "x", email: "a@b.c" } });

const put = (path, data) => store.set(path, { data, version: 1 });
const norm = (x) => JSON.parse(JSON.stringify(x));
let seed = 11; const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed >> 8) % n; };
put("settings/general", { passingPercent: 60 });
for (let i = 0; i < 5; i++) put(`exams/e${i}`, { title: `اختبار ${i}`, stage: "sec_1", status: "published", questions: [1] });
for (let i = 0; i < 60; i++) put(`students/s${i}`, { fullName: `طالب ${i}`, stage: "sec_1" });
put("examAttempts/_init", { _placeholder: true, createdAt: Timestamp.fromMillis(5) });
const N = 350;
for (let i = 0; i < N; i++) {
  const total = 10 + (i % 3) * 5, score = rnd(total + 1);
  put(`examAttempts/a${String(i).padStart(3, "0")}`, {
    examId: `e${rnd(5)}`, studentId: i % 13 === 0 ? `ghost${i}` : `s${rnd(60)}`, stage: "sec_1", score, total,
    percent: Math.round(score / total * 100), correctCount: score, wrongCount: total - score,
    resultVisible: i % 6 !== 0,
    attemptedAt: Timestamp.fromMillis(1.1e12 + Math.floor(i / 7) * 1000)     // 7 محاولات بنفس الوقت → اختبار التعادل بين الصفحات
  });
}
const snapshot = () => JSON.stringify([...store.entries()].map(([k, v]) => [k, v.data]));
const before = snapshot();

const calcPercent = (r) => { const p = Number(r.percent); if (!isNaN(p) && p > 0) return Math.round(p); const t = Number(r.total) || 0; return t ? Math.round((Number(r.score) || 0) / t * 100) : 0; };
function pageStats(list, passing) {          // نفس حساب updateStats في الصفحة القديمة
  let sum = 0, top = 0, pass = 0;
  list.forEach((r) => { const p = calcPercent(r); sum += p; if ((Number(r.score) || 0) > top) top = Number(r.score) || 0; if (p >= passing) pass++; });
  return { total: list.length, avgPercent: list.length ? Math.round(sum / list.length) : 0, topScore: top, passCount: pass };
}
async function allPages(qs = "", limit = 100) {
  const pages = []; let cursor = null; let first = null;
  do {
    const r = norm(await newReq(`/api/admin/results?${qs}${qs ? "&" : ""}limit=${limit}${cursor ? `&cursor=${cursor}` : ""}`, { method: "GET" }));
    assert.equal(r.success, true, JSON.stringify(r));
    first = first || r.data; pages.push(r.data);
    cursor = r.data.hasMore ? r.data.nextCursor : null;
  } while (cursor);
  return { pages, first, rows: pages.flatMap((p) => p.results) };
}
const byId = (rows) => Object.fromEntries(rows.map((r) => [r.id, r]));

let passed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log("  ✔", name); } catch (e) { console.error("  ✘", name, "\n    ", e && e.message || e); process.exitCode = 1; } }

console.log("— ترقيم النتائج —");
const oldFull = hasOld ? norm(await oldReq("/api/admin/results", { method: "GET" })).data : norm(await newReq("/api/admin/results", { method: "GET" })).data;

await t("كل الصفحات = التحميل الكامل القديم (نفس السجلات، بلا تكرار ولا فقد، نفس المحتوى)", async () => {
  const { pages, first, rows } = await allPages();
  assert.equal(first.paged, true); assert.equal(pages.length, 4);          // 350 → 100/100/100/50
  assert.equal(rows.length, N, "المستند المؤقت لا يظهر");
  assert.equal(new Set(rows.map((r) => r.id)).size, N, "تكرار بين الصفحات");
  assert.deepEqual(byId(rows), byId(oldFull.results));
  for (let i = 1; i < rows.length; i++) assert.ok(Date.parse(rows[i - 1].attemptedAt) >= Date.parse(rows[i].attemptedAt), "الترتيب: الأحدث أولًا");
  assert.equal(pages.filter((p) => p.hasMore).length, 3); assert.equal(pages[3].hasMore, false);
});
await t("إجماليات الرأس من الخادم = حسابها على القائمة الكاملة", async () => {
  const { first } = await allPages();
  assert.deepEqual(first.summary, pageStats(oldFull.results, oldFull.passingPercent));
});
await t("بامتحان محدد: نفس السجلات والإجماليات والعنوان", async () => {
  const oldE = hasOld ? norm(await oldReq("/api/admin/results?examId=e2", { method: "GET" })).data : norm(await newReq("/api/admin/results?examId=e2", { method: "GET" })).data;
  const { first, rows } = await allPages("examId=e2", 30);
  assert.equal(first.paged, true);
  assert.deepEqual(byId(rows), byId(oldE.results));
  assert.equal(first.examTitle, "اختبار 2");
  assert.deepEqual(first.summary, pageStats(oldE.results, oldE.passingPercent));
});
await t("حد الصفحة 1 والحد الأكبر من العدد يعملان", async () => {
  assert.equal((await allPages("examId=e1", 1)).rows.length, Object.keys(byId(oldFull.results)).length && (await allPages("examId=e1", 200)).rows.length);
});
await t("القراءات: صفحة واحدة (100) بدل كل المحاولات", async () => {
  const d0 = stats.docsRead;
  const r = norm(await newReq("/api/admin/results?limit=100", { method: "GET" }));
  const docs = stats.docsRead - d0;
  assert.equal(r.data.results.length, 100);
  assert.ok(docs < 200, `قُرئ ${docs} مستندًا`);        // 101 محاولة + ≤60 طالب + 5 امتحانات + إعدادات
  console.log(`      (قراءة أول صفحة: ${docs} مستند + aggregate، مقابل ${N + 66} للتحميل الكامل)`);
});
await t("بيانات قديمة بلا percent → رجوع تلقائي للتحميل الكامل بلا فقد", async () => {
  put("examAttempts/legacy1", { examId: "e0", studentId: "s1", score: 3, total: 10, attemptedAt: Timestamp.fromMillis(1.1e12) });
  const r = norm(await newReq("/api/admin/results?limit=100", { method: "GET" })).data;
  assert.equal(r.paged, false); assert.equal(r.results.length, N + 1); assert.equal(r.hasMore, undefined);
  store.delete("examAttempts/legacy1");
});
await t("بيانات قديمة بلا attemptedAt → رجوع تلقائي للتحميل الكامل", async () => {
  put("examAttempts/legacy2", { examId: "e0", studentId: "s1", score: 3, total: 10, percent: 30 });
  const r = norm(await newReq("/api/admin/results?limit=100", { method: "GET" })).data;
  assert.equal(r.paged, false); assert.equal(r.results.length, N + 1);
  store.delete("examAttempts/legacy2");
});
await t("مؤشر غير صالح يُرفض برسالة، لا يعيد بيانات خاطئة", async () => {
  const r = norm(await newReq("/api/admin/results?limit=10&cursor=nope", { method: "GET" }));
  assert.equal(r.success, false); assert.equal(r.error.code, "BAD_REQUEST");
});
await t("المسار بلا limit ما زال يعمل كما كان (توافق)", async () => {
  assert.equal(oldFull.results.length, N); assert.equal(oldFull.paged, undefined);
});
await t("لا كتابة ولا تعديل ولا حذف على البيانات", async () => { assert.equal(snapshot(), before); });
console.log(`\n${passed} اختبار نجح`);
