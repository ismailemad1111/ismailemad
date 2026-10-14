/* اختبارات قواعد Firestore لـ events و eventParticipations
   ⚠️ لم تُنفَّذ في بيئة التطوير (تنزيل Emulator كان محجوبًا) — شغّلها على جهازك:
       cd bank-tests/rules && npm i && npm test
   (يتطلب Java 11+ ؛ الأمر يشغّل Firestore Emulator ثم الاختبارات ثم يغلقه)

   كل اختبار يطبع اسمه؛ أي فشل يعني أن القاعدة لا تتصرف كما صُمِّمت. الاختبارات المسمّاة [معلومة]
   لا تفشل أبدًا: تُظهر فقط هل يقبل Firestore نمطًا معينًا من الاستعلامات (مثل in) لتحسم الشك. */
import { test, before, after, beforeEach } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, query, where, serverTimestamp, Timestamp } from "firebase/firestore";

const here = path.dirname(fileURLToPath(import.meta.url));
const RULES = fs.readFileSync(path.resolve(here, "../../manasa/firestore.rules"), "utf8");
const STU = "stuAAAA1111BBBB2222CCCC3333", STU2 = "stuDDDD4444EEEE5555FFFF6666", ADM = "admXXXX9999YYYY8888ZZZZ7777";
const MAIL = (c) => `${c}@students.mrismailemad.com`;
const HOUR = 3600e3, DAY = 24 * HOUR, MIN = 60e3;
const ts = (ms) => Timestamp.fromMillis(Date.now() + ms);

let env;
before(async () => { env = await initializeTestEnvironment({ projectId: "demo-manasa", firestore: { rules: RULES } }); });
after(async () => { await env.cleanup(); });

const baseEvent = (o = {}) => ({
  title: "لعبة العلوم", description: "", imageUrl: "", startAt: ts(-HOUR), endAt: ts(DAY), status: "published", type: "game",
  stage: "all", gameFile: "game-science.html", scoreEnabled: true, maxScore: 100, createdBy: ADM, createdAt: ts(-DAY), updatedAt: ts(-DAY), ...o
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "admins", ADM), { status: "active" });
    await setDoc(doc(db, "codes", "12345"), { status: "active", studentId: STU, stage: "sec_1" });
    await setDoc(doc(db, "codes", "54321"), { status: "active", studentId: STU2, stage: "prep_1" });
    await setDoc(doc(db, "students", STU), { fullName: "طالب تجريبي", stage: "sec_1", code: "12345", status: "active" });
    await setDoc(doc(db, "students", STU2), { fullName: "طالب ثان", stage: "prep_1", code: "54321", status: "active" });
    await setDoc(doc(db, "events", "evAll"), baseEvent());
    await setDoc(doc(db, "events", "evSec1"), baseEvent({ title: "للثانوي", stage: "sec_1" }));
    await setDoc(doc(db, "events", "evPrep1"), baseEvent({ title: "للإعدادي", stage: "prep_1" }));
    await setDoc(doc(db, "events", "evDraft"), baseEvent({ status: "draft" }));
    await setDoc(doc(db, "events", "evHidden"), baseEvent({ status: "hidden" }));
    await setDoc(doc(db, "events", "evUpcoming"), baseEvent({ startAt: ts(HOUR), endAt: ts(DAY) }));
    await setDoc(doc(db, "events", "evEnded"), baseEvent({ startAt: ts(-3 * DAY), endAt: ts(-2 * DAY) }));
    await setDoc(doc(db, "events", "evNoScore"), baseEvent({ scoreEnabled: false, maxScore: null }));
    await setDoc(doc(db, "events", "evActivity"), baseEvent({ type: "activity", gameFile: "", scoreEnabled: false, maxScore: null }));
    await setDoc(doc(db, "events", "evGrace"), baseEvent({ startAt: ts(-DAY), endAt: ts(-5 * MIN) }));      // انتهى قبل 5 دقائق (ضمن مهلة 10 دقائق)
    await setDoc(doc(db, "events", "evLate"), baseEvent({ startAt: ts(-DAY), endAt: ts(-30 * MIN) }));      // انتهى قبل 30 دقيقة (خارج المهلة)
  });
});

const stu = (uid = STU, code = "12345") => env.authenticatedContext(uid, { email: MAIL(code) }).firestore();
const adm = () => env.authenticatedContext(ADM, { email: "admin@example.com" }).firestore();
const anon = () => env.unauthenticatedContext().firestore();
const seedPart = (eventId, o = {}, uid = STU) => env.withSecurityRulesDisabled(async (ctx) => {
  await setDoc(doc(ctx.firestore(), "eventParticipations", `${eventId}_${uid}`), {
    eventId, studentId: uid, studentName: "طالب تجريبي", studentCode: "12345", stage: "sec_1", status: "started", reviewStatus: "none",
    reportedScore: null, score: null, startedAt: ts(-HOUR), completedAt: null, updatedAt: ts(-HOUR), ...o });
});
const newPart = (eventId, o = {}, uid = STU) => ({
  eventId, studentId: uid, studentName: "طالب تجريبي", studentCode: "12345", stage: "sec_1", status: "started", reviewStatus: "none",
  reportedScore: null, score: null, startedAt: serverTimestamp(), completedAt: null, updatedAt: serverTimestamp(), ...o });
const finish = (o = {}) => ({ status: "completed", completedAt: serverTimestamp(), reportedScore: 80, reviewStatus: "pending", updatedAt: serverTimestamp(), ...o });
const pRef = (db, eventId, uid = STU) => doc(db, "eventParticipations", `${eventId}_${uid}`);

/* ---------- (أ) استعلامات الطالب عن الأحداث ---------- */
test("[أ] قائمة الطالب: status=published و stage=all ← مسموحة", async () => {
  await assertSucceeds(getDocs(query(collection(stu(), "events"), where("status", "==", "published"), where("stage", "==", "all"))));
});
test("[أ] قائمة الطالب: status=published و stage=مرحلته (sec_1) ← مسموحة (المقارنة بقيمة من مستند الكود)", async () => {
  await assertSucceeds(getDocs(query(collection(stu(), "events"), where("status", "==", "published"), where("stage", "==", "sec_1"))));
});
test("[أ] قائمة الطالب: stage=مرحلة غيره ← مرفوضة", async () => {
  await assertFails(getDocs(query(collection(stu(), "events"), where("status", "==", "published"), where("stage", "==", "prep_1"))));
});
test("[أ] قائمة الطالب بلا قيد stage أو بلا status ← مرفوضة", async () => {
  await assertFails(getDocs(query(collection(stu(), "events"), where("status", "==", "published"))));
  await assertFails(getDocs(query(collection(stu(), "events"), where("stage", "==", "all"))));
  await assertFails(getDocs(collection(stu(), "events")));
});
test("[أ] قائمة الطالب: status=draft أو hidden ← مرفوضة", async () => {
  await assertFails(getDocs(query(collection(stu(), "events"), where("status", "==", "draft"), where("stage", "==", "all"))));
  await assertFails(getDocs(query(collection(stu(), "events"), where("status", "==", "hidden"), where("stage", "==", "all"))));
});
test("[معلومة] استعلام واحد بـ stage in ['all', مرحلتي] — هل يقبله Firestore؟ (الباك إند لا يعتمد عليه؛ يستخدم استعلامين)", async () => {
  let r;
  try { await getDocs(query(collection(stu(), "events"), where("status", "==", "published"), where("stage", "in", ["all", "sec_1"]))); r = "مقبول"; }
  catch (e) { r = "مرفوض (" + (e.code || e.message) + ")"; }
  console.log("      → نتيجة استعلام in:", r);
});
test("get لحدث: منشور للكل أو لمرحلتي ← يُقبل؛ مسودة/مخفي/مرحلة أخرى/زائر ← يُرفض", async () => {
  await assertSucceeds(getDoc(doc(stu(), "events", "evAll")));
  await assertSucceeds(getDoc(doc(stu(), "events", "evSec1")));
  for (const id of ["evDraft", "evHidden", "evPrep1"]) await assertFails(getDoc(doc(stu(), "events", id)));
  await assertFails(getDoc(doc(anon(), "events", "evAll")));
});
test("كود موقوف أو منتهٍ: لا يقرأ الطالب شيئًا", async () => {
  await env.withSecurityRulesDisabled(async (ctx) => { await updateDoc(doc(ctx.firestore(), "codes", "12345"), { status: "disabled" }); });
  await assertFails(getDoc(doc(stu(), "events", "evAll")));
});
test("الطالب لا يكتب في events إطلاقًا؛ الأدمن يكتب حدثًا صالحًا فقط", async () => {
  await assertFails(setDoc(doc(stu(), "events", "x1"), baseEvent()));
  await assertFails(updateDoc(doc(stu(), "events", "evAll"), { title: "x" }));
  await assertFails(deleteDoc(doc(stu(), "events", "evAll")));
  await assertSucceeds(setDoc(doc(adm(), "events", "ok1"), baseEvent()));
  for (const bad of [
    { gameFile: "../x.html" }, { gameFile: "index.html" }, { gameFile: "game-a/b.html" }, { gameFile: "https://e.com/game-x.html" },
    { type: "activity" }, { endAt: ts(-2 * DAY) }, { maxScore: 0 }, { maxScore: 2.5 }, { status: "weird" }, { stage: "grade_9" }, { title: "" }, { extra: 1 }
  ]) await assertFails(setDoc(doc(adm(), "events", "bad1"), baseEvent(bad)));
  await assertSucceeds(deleteDoc(doc(adm(), "events", "ok1")));
});

/* ---------- (ب) إنشاء المشاركة وحدود الوقت ---------- */
test("[ب] إنشاء مشاركة: حدث جارٍ ومنشور (للكل ولمرحلتي) ← مسموح", async () => {
  await assertSucceeds(setDoc(pRef(stu(), "evAll"), newPart("evAll")));
  await assertSucceeds(setDoc(pRef(stu(), "evSec1"), newPart("evSec1")));
  await assertSucceeds(setDoc(pRef(stu(), "evActivity"), newPart("evActivity")));
});
test("[ب] إنشاء مشاركة: قادم/منتهٍ/مسودة/مخفي/مرحلة أخرى/غير موجود ← مرفوض", async () => {
  for (const id of ["evUpcoming", "evEnded", "evDraft", "evHidden", "evPrep1", "evNope"]) await assertFails(setDoc(pRef(stu(), id), newPart(id)));
});
test("[ب] إنشاء مشاركة: انتحال طالب آخر / معرّف غير مطابق / حقول زائدة أو قيم غير ابتدائية ← مرفوض", async () => {
  const d = stu();
  await assertFails(setDoc(pRef(d, "evAll", STU2), newPart("evAll", {}, STU2)));                         // مستند طالب آخر
  await assertFails(setDoc(doc(d, "eventParticipations", "evAll_wrong"), newPart("evAll")));              // معرّف غير مطابق
  await assertFails(setDoc(pRef(d, "evAll"), newPart("evAll", { studentId: STU2 })));
  await assertFails(setDoc(pRef(d, "evAll"), newPart("evAll", { studentName: "اسم مزوّر" })));
  await assertFails(setDoc(pRef(d, "evAll"), newPart("evAll", { studentCode: "99999" })));
  await assertFails(setDoc(pRef(d, "evAll"), newPart("evAll", { stage: "sec_3" })));
  await assertFails(setDoc(pRef(d, "evAll"), newPart("evAll", { status: "completed" })));
  await assertFails(setDoc(pRef(d, "evAll"), newPart("evAll", { reviewStatus: "approved" })));
  await assertFails(setDoc(pRef(d, "evAll"), newPart("evAll", { reportedScore: 100 })));
  await assertFails(setDoc(pRef(d, "evAll"), newPart("evAll", { score: 100 })));
  await assertFails(setDoc(pRef(d, "evAll"), newPart("evAll", { startedAt: ts(-DAY) })));               // وقت مزوّر (ليس request.time)
  await assertFails(setDoc(pRef(d, "evAll"), newPart("evAll", { bonus: 1 })));
});
test("[ب] المشاركة تُنشأ مرة واحدة: الإنشاء الثاني (استبدال) ← مرفوض لأنه update لا create", async () => {
  await assertSucceeds(setDoc(pRef(stu(), "evAll"), newPart("evAll")));
  await assertFails(setDoc(pRef(stu(), "evAll"), newPart("evAll")));
});

/* ---------- (ب) إكمال المشاركة ---------- */
test("[ب] إكمال بنتيجة ضمن الحد ← مسموح ويبقى pending", async () => {
  await seedPart("evAll");
  await assertSucceeds(updateDoc(pRef(stu(), "evAll"), finish()));
});
test("[ب] إكمال بلا نتيجة (reviewStatus=none) ← مسموح؛ ولعبة بلا نقاط لا تقبل نتيجة", async () => {
  await seedPart("evAll"); await seedPart("evNoScore");
  await assertSucceeds(updateDoc(pRef(stu(), "evAll"), finish({ reportedScore: null, reviewStatus: "none" })));
  await assertFails(updateDoc(pRef(stu(), "evNoScore"), finish()));
});
test("[ب] إكمال: نتيجة فوق الحد/سالبة/كسرية/ReviewStatus معتمد/تعديل score/ملاحظة ← مرفوض", async () => {
  await seedPart("evAll");
  const d = stu();
  for (const bad of [{ reportedScore: 101 }, { reportedScore: -1 }, { reportedScore: 5.5 }, { reviewStatus: "approved" }, { reviewStatus: "none" },
                     { score: 100 }, { note: "x" }, { completedAt: ts(-DAY) }, { status: "started" }])
    await assertFails(updateDoc(pRef(d, "evAll"), finish(bad)));
});
test("[ب] إكمال مرتين ← الثاني مرفوض؛ وبعد الاعتماد لا يغيّر الطالب شيئًا", async () => {
  await seedPart("evAll");
  await assertSucceeds(updateDoc(pRef(stu(), "evAll"), finish()));
  await assertFails(updateDoc(pRef(stu(), "evAll"), finish({ reportedScore: 99 })));
  await assertSucceeds(updateDoc(pRef(adm(), "evAll"), { reviewStatus: "approved", score: 80 }));
  await assertFails(updateDoc(pRef(stu(), "evAll"), { score: 100 }));
});
test("[ب] حدود الوقت عند الإكمال: ضمن مهلة 10 دقائق بعد النهاية ← مسموح، وبعدها ← مرفوض", async () => {
  await seedPart("evGrace"); await seedPart("evLate");
  await assertSucceeds(updateDoc(pRef(stu(), "evGrace"), finish()));
  await assertFails(updateDoc(pRef(stu(), "evLate"), finish()));
});
test("[ب] طالب آخر لا يكمل مشاركة غيره", async () => {
  await seedPart("evAll");
  await assertFails(updateDoc(pRef(stu(STU2, "54321"), "evAll", STU), finish()));
});

/* ---------- القراءة والحذف والأدمن ---------- */
test("قراءة المشاركات: الطالب مشاركاته فقط (get وlist بشرط studentId)، الأدمن الكل", async () => {
  await seedPart("evAll"); await seedPart("evSec1", {}, STU);
  await assertSucceeds(getDoc(pRef(stu(), "evAll")));
  await assertFails(getDoc(pRef(stu(STU2, "54321"), "evAll", STU)));
  await assertSucceeds(getDocs(query(collection(stu(), "eventParticipations"), where("studentId", "==", STU))));
  await assertFails(getDocs(collection(stu(), "eventParticipations")));
  await assertFails(getDocs(query(collection(stu(), "eventParticipations"), where("studentId", "==", STU2))));
  await assertSucceeds(getDocs(collection(adm(), "eventParticipations")));
});
test("الطالب لا يحذف مشاركته؛ الأدمن يحذف", async () => {
  await seedPart("evAll");
  await assertFails(deleteDoc(pRef(stu(), "evAll")));
  await assertSucceeds(deleteDoc(pRef(adm(), "evAll")));
});

/* ---------- مستند التهيئة المؤقت (setup.js) ---------- */
test("setup: الأدمن ينشئ _init المؤقت (مفاتيح محدودة) في events وeventParticipations، والطالب لا يراه ولا يكتبه", async () => {
  const ph = { _placeholder: true, note: "مؤقت", createdAt: serverTimestamp() };
  await assertSucceeds(setDoc(doc(adm(), "events", "_init"), ph));
  await assertSucceeds(setDoc(doc(adm(), "eventParticipations", "_init"), ph));
  await assertFails(setDoc(doc(adm(), "events", "_init2"), { ...ph, extra: 1 }));            // مفاتيح زائدة
  await assertFails(setDoc(doc(adm(), "events", "_init3"), { _placeholder: false, note: "x", createdAt: serverTimestamp() }));
  await assertFails(setDoc(doc(stu(), "events", "_init4"), ph));
  await assertFails(getDoc(doc(stu(), "events", "_init")));                                 // بلا status: لا يُقرأ
  await assertFails(updateDoc(doc(adm(), "events", "_init"), { title: "x" }));              // التحديث يتطلب حدثًا صالحًا
  await assertSucceeds(deleteDoc(doc(adm(), "events", "_init")));                           // حذف المؤقت (زر «حذف المستندات المؤقتة»)
});
