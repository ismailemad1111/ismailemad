import assert from "node:assert/strict";

/* ---- بيئة المتصفح الوهمية ---- */
const mem = {};
globalThis.sessionStorage = {
  getItem: (k) => (k in mem ? mem[k] : null),
  setItem: (k, v) => { mem[k] = String(v); },
  removeItem: (k) => { delete mem[k]; }
};
globalThis.window = { location: { pathname: "/", search: "" } };

const ROOT = new URL("../manasa/js/", import.meta.url);
const { backendRequest } = await import(new URL("backend/index.js", ROOT).href);
const { store } = await import("./stubs/firestore.js");
const { authState } = await import("./stubs/auth.js");

const STU = "stuAAAA1111BBBB2222CCCC3333";
const STU2 = "stuDDDD4444EEEE5555FFFF6666";
const ADM = "admXXXX9999YYYY8888ZZZZ7777";
const HOUR = 3600000, DAY = 86400000;

function asStudent(uid = STU, stage = "sec_1", name = "طالب تجريبي") {
  authState.currentUser = { uid };
  mem.am_session = JSON.stringify({ role: "student", token: "t", student: { id: uid, code: "12345", stage, fullName: name } });
}
function asAdmin() {
  authState.currentUser = { uid: ADM };
  mem.am_session = JSON.stringify({ role: "admin", token: "t", admin: { id: ADM, name: "الأستاذ", email: "a@b.c" } });
}
const call = (m, p, body) => backendRequest(p, { method: m, body });

let passed = 0;
async function t(name, fn) {
  try { await fn(); passed++; console.log("  ✔", name); }
  catch (e) { console.error("  ✘", name, "\n    ", e && e.stack || e); process.exitCode = 1; }
}
const count = (c) => [...store.keys()].filter((k) => k.startsWith(c + "/")).length;

store.set(`students/${STU}`, { data: { fullName: "طالب تجريبي", stage: "sec_1", code: "12345", status: "active", studyHoursTotal: 7 }, version: 1 });
store.set(`students/${STU2}`, { data: { fullName: "طالب ثان", stage: "prep_1", code: "54321", status: "active", studyHoursTotal: 0 }, version: 1 });
store.set("settings/general", { data: { passingPercent: 50 }, version: 1 });
store.set("bankWallets/" + STU, { data: { balance: 99 }, version: 1 });
const untouched = () => JSON.stringify([store.get(`students/${STU}`).data, store.get("settings/general").data, store.get("bankWallets/" + STU).data]);
const untouchedBefore = untouched();

const now = Date.now();
const base = { title: "لعبة العلوم", description: "وصف", type: "game", gameFile: "game-science.html", stage: "all", status: "published", startAt: now - HOUR, endAt: now + DAY, scoreEnabled: true, maxScore: 100, imageUrl: "" };
const ids = {};

console.log("— الإدارة: التحقق —");
await t("الطالب لا يستطيع استدعاء مسارات الإدارة", async () => {
  asStudent();
  const r = await call("POST", "/api/admin/events", base);
  assert.equal(r.success, false);
  assert.equal(r.error.code, "UNAUTHORIZED");
  assert.equal(count("events"), 0);
});
await t("أسماء ملفات غير آمنة مرفوضة", async () => {
  asAdmin();
  for (const f of ["../secret.html", "index.html", "game-x.html/../a.html", "game-.html", "GAME-x.html", "game-a b.html", "game-x.js", "https://evil.com/game-x.html", "/game-x.html", "game-x.html?a=1", "admin/game-x.html", "game-x\\y.html", "", "game-" + "a".repeat(80) + ".html"]) {
    const r = await call("POST", "/api/admin/events", { ...base, gameFile: f });
    assert.equal(r.success, false, "gameFile=" + JSON.stringify(f));
  }
  assert.equal(count("events"), 0);
});
await t("تواريخ/حالات/مراحل/نقاط غير صحيحة مرفوضة", async () => {
  asAdmin();
  const bads = [
    { endAt: base.startAt }, { endAt: base.startAt - 1 }, { startAt: "abc" }, { startAt: undefined, endAt: undefined },
    { status: "weird" }, { type: "quiz" }, { stage: "grade_9" }, { title: "" }, { title: "x".repeat(121) },
    { maxScore: 0 }, { maxScore: 2.5 }, { maxScore: "" }, { imageUrl: "javascript:alert(1)" }, { description: "x".repeat(2001) }
  ];
  for (const b of bads) {
    const r = await call("POST", "/api/admin/events", { ...base, ...b });
    assert.equal(r.success, false, JSON.stringify(b));
  }
  assert.equal(count("events"), 0);
});

console.log("— الإدارة: الإنشاء والتعديل —");
await t("إنشاء لعبة بنقاط ونشاط عادي ومسودة ومرحلة أخرى وحدث قادم ومنتهٍ", async () => {
  asAdmin();
  const mk = async (k, o) => { const r = await call("POST", "/api/admin/events", { ...base, ...o }); assert.equal(r.success, true, k + JSON.stringify(r)); ids[k] = r.data.id; };
  await mk("game", {});
  await mk("activity", { title: "نشاط", type: "activity", gameFile: "", scoreEnabled: false, maxScore: null });
  await mk("noscore", { title: "لعبة بلا نقاط", gameFile: "game-plain.html", scoreEnabled: false, maxScore: null });
  await mk("draft", { title: "مسودة", status: "draft" });
  await mk("hidden", { title: "مخفي", status: "hidden" });
  await mk("prep", { title: "للإعدادي", stage: "prep_1" });
  await mk("upcoming", { title: "قادم", startAt: now + 2 * HOUR, endAt: now + DAY });
  await mk("ended", { title: "منتهٍ", startAt: now - 3 * DAY, endAt: now - DAY });
  const d = store.get(`events/${ids.activity}`).data;
  assert.equal(d.gameFile, ""); assert.equal(d.scoreEnabled, false); assert.equal(d.maxScore, null);
  // نشاط عادي لا يحمل نقاطًا حتى لو أُرسلت
  const r = await call("POST", "/api/admin/events", { ...base, type: "activity", gameFile: "game-x.html", scoreEnabled: true, maxScore: 5 });
  assert.equal(r.success, true);
  const d2 = store.get(`events/${r.data.id}`).data;
  assert.equal(d2.gameFile, ""); assert.equal(d2.scoreEnabled, false);
  await call("DELETE", `/api/admin/events/${r.data.id}`);
});
await t("قائمة الأدمن تعرض كل الحالات مع العدّادات", async () => {
  const r = await call("GET", "/api/admin/events");
  assert.equal(r.success, true);
  assert.equal(r.data.events.length, 8);
  assert.ok(r.data.events.every((e) => e.participants === 0));
});

console.log("— الطالب: العرض —");
await t("الطالب يرى المنشور المسموح فقط (لا مسودة/مخفي/مرحلة أخرى)", async () => {
  asStudent();
  const r = await call("GET", "/api/student/events");
  assert.equal(r.success, true, JSON.stringify(r));
  const titles = r.data.events.map((e) => e.title).sort();
  assert.deepEqual(titles, ["قادم", "لعبة العلوم", "لعبة بلا نقاط", "منتهٍ", "نشاط"].sort());
  const g = r.data.events.find((e) => e.id === ids.game);
  assert.equal(g.phase, "live"); assert.equal(g.gameFile, "game-science.html");
  assert.equal(r.data.events.find((e) => e.id === ids.upcoming).phase, "upcoming");
  assert.equal(r.data.events.find((e) => e.id === ids.ended).phase, "ended");
});
await t("طالب مرحلة أخرى يرى حدث مرحلته", async () => {
  asStudent(STU2, "prep_1", "طالب ثان");
  const r = await call("GET", "/api/student/events");
  assert.ok(r.data.events.some((e) => e.id === ids.prep));
  asStudent();
  const r2 = await call("GET", "/api/student/events");
  assert.ok(!r2.data.events.some((e) => e.id === ids.prep));
});
await t("تفاصيل مسودة/مخفي/مرحلة أخرى/معرّف سيئ = غير متاح", async () => {
  asStudent();
  for (const k of ["draft", "hidden", "prep"]) {
    const r = await call("GET", `/api/student/events/${ids[k]}`);
    assert.equal(r.success, false, k); assert.equal(r.error.code, "NOT_FOUND");
  }
  assert.equal((await call("GET", "/api/student/events/..%2Fx")).success, false);
  const ok1 = await call("GET", `/api/student/events/${ids.game}`);
  assert.equal(ok1.success, true); assert.equal(ok1.data.participation, null);
});

console.log("— الطالب: المشاركة —");
await t("حدث قادم/منتهٍ/مسودة لا يقبل المشاركة", async () => {
  asStudent();
  const a = await call("POST", `/api/student/events/${ids.upcoming}/join`);
  assert.equal(a.error.code, "EVENT_NOT_STARTED");
  const b = await call("POST", `/api/student/events/${ids.ended}/join`);
  assert.equal(b.error.code, "EVENT_ENDED");
  const c = await call("POST", `/api/student/events/${ids.draft}/join`);
  assert.equal(c.error.code, "NOT_FOUND");
  assert.equal(count("eventParticipations"), 0);
});
await t("الإنهاء بدون مشاركة مرفوض", async () => {
  const r = await call("POST", `/api/student/events/${ids.game}/complete`, { score: 10 });
  assert.equal(r.error.code, "NOT_JOINED");
});
await t("تسجيل المشاركة مرة واحدة + تكرار الطلب لا يكرر المستند", async () => {
  const r1 = await call("POST", `/api/student/events/${ids.game}/join`);
  assert.equal(r1.success, true, JSON.stringify(r1)); assert.equal(r1.data.outcome, "joined");
  const r2 = await call("POST", `/api/student/events/${ids.game}/join`);
  assert.equal(r2.success, true); assert.equal(r2.data.outcome, "already");
  const rs = await Promise.all([1, 2, 3].map(() => call("POST", `/api/student/events/${ids.game}/join`)));
  assert.ok(rs.every((x) => x.success));
  assert.equal(count("eventParticipations"), 1);
  const d = store.get(`eventParticipations/${ids.game}_${STU}`).data;
  assert.equal(d.studentId, STU); assert.equal(d.status, "started"); assert.equal(d.reviewStatus, "none"); assert.equal(d.score, null);
  assert.equal(d.studentName, "طالب تجريبي");
});
await t("إنهاء بنتيجة: تُحفظ مُبلَّغًا عنها قيد المراجعة والطالب لا يرى score", async () => {
  const r = await call("POST", `/api/student/events/${ids.game}/complete`, { score: 80 });
  assert.equal(r.success, true, JSON.stringify(r)); assert.equal(r.data.scoreRecorded, true);
  const d = store.get(`eventParticipations/${ids.game}_${STU}`).data;
  assert.equal(d.reportedScore, 80); assert.equal(d.reviewStatus, "pending"); assert.equal(d.score, null); assert.equal(d.status, "completed");
  assert.equal(r.data.participation.score, null);
  const again = await call("POST", `/api/student/events/${ids.game}/complete`, { score: 100 });
  assert.equal(again.data.outcome, "already");
  assert.equal(store.get(`eventParticipations/${ids.game}_${STU}`).data.reportedScore, 80, "لا تُستبدل النتيجة");
});
await t("نتيجة غير صالحة أو لعبة بلا نقاط: يُسجَّل الإكمال بلا نتيجة", async () => {
  asStudent(STU2, "prep_1", "طالب ثان");
  await call("POST", `/api/student/events/${ids.game}/join`);
  for (const [i, bad] of [999, -1, 5.5, "abc"].entries()) {
    // نعيد المشاركة في كل مرة بطالب جديد غير ممكن؛ نختبر مباشرة بحذف المستند
    store.delete(`eventParticipations/${ids.game}_${STU2}`);
    await call("POST", `/api/student/events/${ids.game}/join`);
    const r = await call("POST", `/api/student/events/${ids.game}/complete`, { score: bad });
    assert.equal(r.success, true); assert.equal(r.data.scoreRecorded, false, "score=" + bad);
    assert.equal(store.get(`eventParticipations/${ids.game}_${STU2}`).data.reportedScore, null);
    assert.equal(store.get(`eventParticipations/${ids.game}_${STU2}`).data.reviewStatus, "none");
  }
  await call("POST", `/api/student/events/${ids.noscore}/join`);
  const r = await call("POST", `/api/student/events/${ids.noscore}/complete`, { score: 50 });
  assert.equal(r.data.scoreRecorded, false);
  assert.equal(store.get(`eventParticipations/${ids.noscore}_${STU2}`).data.reportedScore, null);
});
await t("الطالب لا يستطيع استخدام مسارات الإدارة لتعديل نتيجته", async () => {
  asStudent();
  const r = await call("PATCH", `/api/admin/event-participations/${ids.game}_${STU}`, { reviewStatus: "approved", score: 100 });
  assert.equal(r.success, false); assert.equal(r.error.code, "UNAUTHORIZED");
  assert.equal(store.get(`eventParticipations/${ids.game}_${STU}`).data.score, null);
});

console.log("— الإدارة: المراجعة —");
await t("قائمة المشاركات وعدّادات الحدث", async () => {
  asAdmin();
  const r = await call("GET", `/api/admin/events/${ids.game}/participations`);
  assert.equal(r.success, true); assert.equal(r.data.participations.length, 2);
  const ev = (await call("GET", "/api/admin/events")).data.events.find((e) => e.id === ids.game);
  assert.equal(ev.participants, 2); assert.equal(ev.completed, 2); assert.equal(ev.pendingReview, 1);
});
await t("اعتماد النتيجة المُبلَّغ عنها + رفض + حدود النقاط", async () => {
  asAdmin();
  const id = `${ids.game}_${STU}`;
  assert.equal((await call("PATCH", `/api/admin/event-participations/${id}`, { reviewStatus: "approved", score: 101 })).success, false);
  assert.equal((await call("PATCH", `/api/admin/event-participations/${id}`, { reviewStatus: "bogus" })).success, false);
  assert.equal((await call("PATCH", `/api/admin/event-participations/${id}`, {})).success, false);
  const ok1 = await call("PATCH", `/api/admin/event-participations/${id}`, { reviewStatus: "approved" });
  assert.equal(ok1.success, true, JSON.stringify(ok1));
  let d = store.get(`eventParticipations/${id}`).data;
  assert.equal(d.score, 80); assert.equal(d.reviewStatus, "approved"); assert.equal(d.reviewedBy, ADM);
  const ed = await call("PATCH", `/api/admin/event-participations/${id}`, { score: 75, note: "تعديل" });
  assert.equal(ed.success, true);
  d = store.get(`eventParticipations/${id}`).data;
  assert.equal(d.score, 75); assert.equal(d.reviewStatus, "approved"); assert.equal(d.note, "تعديل");
  assert.equal((await call("PATCH", `/api/admin/event-participations/${id}`, { score: null })).success, false);
  // اعتماد بدون أي نتيجة مرفوض
  const id2 = `${ids.game}_${STU2}`;
  const none = await call("PATCH", `/api/admin/event-participations/${id2}`, { reviewStatus: "approved" });
  assert.equal(none.success, false);
  const man = await call("PATCH", `/api/admin/event-participations/${id2}`, { reviewStatus: "approved", score: 40 });
  assert.equal(man.success, true);
  const rej = await call("PATCH", `/api/admin/event-participations/${id2}`, { reviewStatus: "rejected" });
  assert.equal(rej.success, true);
  assert.equal(store.get(`eventParticipations/${id2}`).data.score, null);
  assert.equal((await call("PATCH", `/api/admin/event-participations/nope`, { note: "x" })).success, false);
  assert.equal((await call("PATCH", `/api/admin/event-participations/${ids.game}_zzz`, { note: "x" })).error.code, "NOT_FOUND");
});
await t("الطالب يرى النقاط المعتمدة فقط", async () => {
  asStudent();
  const r = await call("GET", `/api/student/events/${ids.game}`);
  assert.equal(r.data.participation.score, 75); assert.equal(r.data.participation.reviewStatus, "approved");
  asStudent(STU2, "prep_1", "طالب ثان");
  const r2 = await call("GET", `/api/student/events/${ids.game}`);
  assert.equal(r2.data.participation.score, null);
  const list = await call("GET", "/api/student/events");
  assert.ok(list.data.participations[ids.game]);
});
await t("تسجيل إكمال يدوي لنشاط عادي بواسطة الأدمن", async () => {
  asStudent();
  await call("POST", `/api/student/events/${ids.activity}/join`);
  asAdmin();
  const r = await call("PATCH", `/api/admin/event-participations/${ids.activity}_${STU}`, { status: "completed" });
  assert.equal(r.success, true);
  assert.equal(store.get(`eventParticipations/${ids.activity}_${STU}`).data.status, "completed");
});

console.log("— تعديل/إخفاء/حذف —");
await t("تعديل الحدث لا يمس المشاركات؛ إخفاؤه يخفيه عن الطالب", async () => {
  asAdmin();
  const before = JSON.stringify(store.get(`eventParticipations/${ids.game}_${STU}`).data);
  const r = await call("PATCH", `/api/admin/events/${ids.game}`, { title: "عنوان جديد", description: "جديد" });
  assert.equal(r.success, true);
  assert.equal(store.get(`events/${ids.game}`).data.title, "عنوان جديد");
  assert.equal(store.get(`events/${ids.game}`).data.gameFile, "game-science.html", "الحقول غير المرسلة تبقى");
  assert.equal(JSON.stringify(store.get(`eventParticipations/${ids.game}_${STU}`).data), before);
  assert.equal((await call("PATCH", `/api/admin/events/${ids.game}`, { gameFile: "../x.html" })).success, false);
  assert.equal((await call("PATCH", `/api/admin/events/${ids.game}`, { endAt: now - 10 * DAY })).success, false);
  assert.equal((await call("PATCH", `/api/admin/events/nope`, { title: "x" })).error.code, "NOT_FOUND");
  assert.equal((await call("PATCH", `/api/admin/events/${ids.game}`, { status: "hidden" })).success, true);
  asStudent();
  assert.equal((await call("GET", `/api/student/events/${ids.game}`)).error.code, "NOT_FOUND");
  assert.ok(!(await call("GET", "/api/student/events")).data.events.some((e) => e.id === ids.game));
  asAdmin();
  await call("PATCH", `/api/admin/events/${ids.game}`, { status: "published" });
});
await t("حذف حدث يحذف مشاركاته فقط ولا يمس غيره", async () => {
  asAdmin();
  const other = [...store.keys()].filter((k) => k.startsWith("eventParticipations/") && !k.startsWith(`eventParticipations/${ids.game}_`)).length;
  const r = await call("DELETE", `/api/admin/events/${ids.game}`);
  assert.equal(r.success, true); assert.equal(r.data.participationsDeleted, 2);
  assert.equal(store.has(`events/${ids.game}`), false);
  assert.equal([...store.keys()].filter((k) => k.startsWith(`eventParticipations/${ids.game}_`)).length, 0);
  assert.equal([...store.keys()].filter((k) => k.startsWith("eventParticipations/")).length, other);
  assert.equal((await call("DELETE", `/api/admin/events/${ids.game}`)).error.code, "NOT_FOUND");
});
console.log("— سلوك قواعد Firestore (permission-denied) والمرحلة المعتمدة —");
const { stats } = await import("./stubs/firestore.js");
await t("قواعد Firestore ترفض get لحدث غير مسموح (permission-denied) → الواجهة ترى «غير متاح» لا «انتهت الجلسة»", async () => {
  asAdmin();
  const r0 = await call("POST", "/api/admin/events", { ...base, title: "محجوب" });
  const evId = r0.data.id;
  asStudent();
  stats.denyGet.add(`events/${evId}`);
  try {
    const r = await call("GET", `/api/student/events/${evId}`);
    assert.equal(r.success, false); assert.equal(r.error.code, "NOT_FOUND");
    const j = await call("POST", `/api/student/events/${evId}/join`);   // داخل المعاملة: رسالة EVENT_UNAVAILABLE المفهومة
    assert.equal(j.success, false); assert.equal(j.error.code, "EVENT_UNAVAILABLE");
  } finally { stats.denyGet.delete(`events/${evId}`); }
  asAdmin(); await call("DELETE", `/api/admin/events/${evId}`);
});
await t("مرحلة الطالب للقائمة والانضمام تُقرأ من codes/{code} (كما تقارنها القواعد) لا من الجلسة", async () => {
  asAdmin();
  const r0 = await call("POST", "/api/admin/events", { ...base, title: "لمرحلة الكود", stage: "prep_2" });
  const evId = r0.data.id;
  // الجلسة تقول sec_1 لكن مستند الكود يقول prep_2
  store.set("codes/12345", { data: { status: "active", studentId: STU, stage: "prep_2" }, version: 1 });
  asStudent(STU, "sec_1");
  const list = await call("GET", "/api/student/events");
  assert.ok(list.data.events.some((e) => e.id === evId), "يجب أن يظهر حدث مرحلة الكود");
  const j = await call("POST", `/api/student/events/${evId}/join`);
  assert.equal(j.success, true, JSON.stringify(j));
  assert.equal(store.get(`eventParticipations/${evId}_${STU}`).data.stage, "prep_2");
  store.delete("codes/12345");
  asAdmin(); await call("DELETE", `/api/admin/events/${evId}`);
});
await t("لم تُمَس بيانات المنصة الموجودة", async () => {
  assert.equal(untouched(), untouchedBefore);
});

console.log(`\n${passed} اختبار نجح`);
