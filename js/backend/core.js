/* ============================================================
   js/backend/core.js
   ------------------------------------------------------------
   بديل الـ Worker: "باك إند داخل المتصفح" يتكلم مع Firestore مباشرة.

   الفكرة: صفحات المنصة تنادي workerRequest/workerFetch كأسماء توافقية قديمة بشكل:
        (endpoint, { method, body, query }) → { success, data | error }
   وهذا الملف ينفّذ نفس العقد (نفس المسارات ونفس شكل الرد)، فلا يتغير
   منطق أي صفحة.

   ملاحظات:
   - لا يوجد Firebase Authentication. الدخول بالتحقق من كود/كلمة مرور
     مخزّنين في Firestore، والجلسة في sessionStorage.
   - قواعد Firestore مفتوحة (انظر firestore.rules) — أي شخص يملك
     مفتاح المشروع العام يستطيع القراءة والكتابة. قرار مقصود للإطلاق
     السريع، ويُحسَّن لاحقًا.
   ============================================================ */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import * as fs from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import * as fa from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { FIREBASE_CONFIG } from "../../env.js";
import { getSession } from "../router.js";

export { fs, fa };

/* ---------- الدخول عبر Firebase Authentication ----------
   الطالب يكتب كود (5 أرقام) + كلمة مرور (6 أرقام) فقط، والمنصة تحوّل الكود
   تلقائيًا إلى بريد وهمي: <الكود>@students.mrismailemad.com
   (لا تُرسل رسائل لهذا البريد أبدًا). نفس النطاق مكتوب في firestore.rules. */
export const STUDENT_EMAIL_DOMAIN = "students.mrismailemad.com";
export function studentEmail(code) {
  return `${String(code).trim()}@${STUDENT_EMAIL_DOMAIN}`;
}

/* ---------- تهيئة Firestore ---------- */

const app = initializeApp(FIREBASE_CONFIG);

/* الجلسة تبقى في تبويب المتصفح فقط (نفس سلوك sessionStorage السابق) */
export const auth = fa.initializeAuth(app, {
  persistence: fa.browserSessionPersistence
});

let _authReady = null;
/** ينتظر استعادة حالة الدخول عند فتح الصفحة */
export function authReady() {
  if (!_authReady) {
    _authReady = typeof auth.authStateReady === "function"
      ? auth.authStateReady()
      : Promise.resolve();
  }
  return _authReady;
}

/** تحويل أخطاء Firebase Auth إلى رسائل عربية */
export function authErrorInfo(err) {
  const code = err && err.code ? String(err.code) : "";
  if (code === "auth/too-many-requests") {
    return { code: "RATE_LIMITED", message: "محاولات كثيرة. انتظر قليلًا ثم حاول مرة أخرى." };
  }
  if (code === "auth/network-request-failed") {
    return { code: "NETWORK_ERROR", message: "لا يوجد اتصال بالإنترنت. حاول مرة أخرى." };
  }
  if (code === "auth/operation-not-allowed") {
    return { code: "SERVER_ERROR", message: "تسجيل الدخول بالبريد غير مفعّل في Firebase. فعّله من Authentication ← Sign-in method." };
  }
  if (code === "auth/user-disabled") {
    return { code: "CODE_DISABLED", message: "هذا الحساب غير مفعّل." };
  }
  return { code: "INVALID_PASSWORD", message: "الكود أو كلمة المرور غير صحيحة." };
}

/* إنشاء حساب دخول لطالب بدون إخراج الأدمن من حسابه:
   نستخدم نسخة Firebase ثانية معزولة في الذاكرة. */
let provisioner = null;
export async function createStudentAccount(code, password) {
  try {
    if (!provisioner) {
      const papp = initializeApp(FIREBASE_CONFIG, "provisioner");
      provisioner = fa.initializeAuth(papp, { persistence: fa.inMemoryPersistence });
    }
    const cred = await fa.createUserWithEmailAndPassword(provisioner, studentEmail(code), password);
    await fa.signOut(provisioner);
    return { ok: true, uid: cred.user.uid };
  } catch (e) {
    const c = e && e.code ? String(e.code) : "";
    if (c === "auth/email-already-in-use") return { ok: false, reason: "exists" };
    if (c === "auth/too-many-requests") return { ok: false, reason: "throttled" };
    if (c === "auth/operation-not-allowed") return { ok: false, reason: "disabled" };
    if (c === "auth/network-request-failed") return { ok: false, reason: "network" };
    return { ok: false, reason: "error", code: c };
  }
}

export const db = fs.initializeFirestore(app, {
  // أثبت على شبكات الموبايل والشبكات التي تحجب WebSockets
  experimentalAutoDetectLongPolling: true,
  ignoreUndefinedProperties: true
});

/* ---------- أخطاء وردود بنفس عقد الـ Worker ---------- */

export class ApiError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

export function ok(data = {}, extra = {}) {
  return { success: true, data, ...extra };
}

export function fail(code, message) {
  return {
    success: false,
    error: { code: code || "SERVER_ERROR", message: message || "حدث خطأ." }
  };
}

/** يرمي خطأ يتحول تلقائيًا إلى fail(...) */
export function bad(code, message) {
  throw new ApiError(code, message);
}

/* ---------- مساعدات عامة (مطابقة لما في الـ Worker) ---------- */

export function safeText(v) {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

export function isEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(safeText(v));
}

export function isValidCode(v) {
  return /^\d{5}$/.test(safeText(v));
}

export function isValidPassword(v) {
  const s = v === null || v === undefined ? "" : String(v);
  return s.length >= 1 && s.length <= 200;
}

/** كلمة مرور الطالب: 6 أرقام بالضبط */
export function isStudentPassword(v) {
  return /^\d{6}$/.test(v === null || v === undefined ? "" : String(v));
}

export const STAGES = [
  "grade_4", "grade_5", "grade_6",
  "prep_1", "prep_2", "prep_3",
  "sec_1", "sec_2", "sec_3"
];

export function isValidStage(v) {
  return STAGES.includes(safeText(v));
}

export function clamp(n, min, max) {
  const v = Number(n);
  if (isNaN(v)) return min;
  return Math.min(Math.max(v, min), max);
}

export function nowMs() {
  return Date.now();
}

export function tsToMs(v) {
  if (!v) return 0;
  if (typeof v.toMillis === "function") return v.toMillis();
  if (typeof v.toDate === "function") {
    try { return v.toDate().getTime(); } catch (e) { return 0; }
  }
  if (typeof v === "number") return v;
  if (v instanceof Date) return v.getTime();
  if (typeof v === "string") {
    const t = new Date(v).getTime();
    return isNaN(t) ? 0 : t;
  }
  return 0;
}

export function randomToken() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID().replace(/-/g, "") + Date.now().toString(36);
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function randomFrom(alphabet, length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

/** كود أرقام فقط (5 خانات) */
export function generateCodeString() {
  return randomFrom("0123456789", 5);
}

/** يحوّل الأرقام العربية/الفارسية (٠-٩ / ۰-۹) إلى أرقام لاتينية */
export function toLatinDigits(v) {
  return String(v === null || v === undefined ? "" : v)
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06F0));
}

/** كلمة مرور أرقام فقط (6 خانات) */
export function generatePassword() {
  return randomFrom("0123456789", 6);
}

/** يحوّل Timestamp/Date إلى نص ISO (مثل JSON القادم من الـ Worker) */
export function toPlain(value) {
  if (value === null || value === undefined) return value;
  if (typeof value.toDate === "function") {
    try { return value.toDate().toISOString(); } catch (e) { return null; }
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(toPlain);
  if (typeof value === "object") {
    const out = {};
    for (const k of Object.keys(value)) out[k] = toPlain(value[k]);
    return out;
  }
  return value;
}

/* ---------- مساعدات Firestore ---------- */

export function col(name) {
  return fs.collection(db, name);
}

export function ref(name, id) {
  return fs.doc(db, name, String(id));
}

/** مستند واحد → { id, ...data } أو null */
export async function getDocData(name, id) {
  if (!id) return null;
  const snap = await fs.getDoc(ref(name, id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/** استعلام → مصفوفة { id, ...data } (يُفضَّل ≤ شرط تساوٍ واحد لتفادي الفهارس) */
export async function queryDocs(name, ...constraints) {
  const snap = await fs.getDocs(fs.query(col(name), ...constraints));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((d) => d._placeholder !== true);
}

/** كل مستندات كوليكشن */
export async function listAll(name) {
  const snap = await fs.getDocs(col(name));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((d) => d._placeholder !== true);
}

/* ---------- قراءات اقتصادية (تجميعية) ----------
   count() و sum() يُحسبان على خوادم Firestore ولا يُنزّلان المستندات:
   التكلفة قراءة واحدة لكل 1000 مدخل فهرس (بحد أدنى قراءة واحدة للاستعلام)
   بدل قراءة كل مستند. لا تكتب شيئًا في قاعدة البيانات. */

/**
 * عدد المستندات الحقيقية المطابقة. بدون شروط: يُطرح المستند المؤقت (_placeholder)
 * ليطابق عدّ listAll(). مع الشروط: المستند المؤقت لا يحمل هذه الحقول فلا يطابق.
 */
export async function countDocs(name, ...constraints) {
  if (typeof fs.getCountFromServer !== "function") {
    // SDK قديم بلا count(): نرجع للسلوك السابق (قراءة كاملة)
    return (await queryDocs(name, ...constraints)).length;
  }
  const total = async (...c) =>
    (await fs.getCountFromServer(fs.query(col(name), ...c))).data().count;
  if (constraints.length) return total(...constraints);
  const [all, temp] = await Promise.all([
    total(),
    total(fs.where("_placeholder", "==", true))
  ]);
  return Math.max(0, all - temp);
}

/**
 * مجموع حقل رقمي. المستندات التي ينقصها الحقل أو قيمته غير رقمية لا تُحتسب
 * (النسخة القديمة كانت تحسبها صفرًا، فالنتيجة واحدة طالما الحقل يُكتب رقمًا).
 */
export async function sumField(name, field, ...constraints) {
  const snap = await fs.getAggregateFromServer(
    fs.query(col(name), ...constraints),
    { total: fs.sum(field) }
  );
  return Number(snap.data().total) || 0;
}

/** مستندات بمعرّفات محددة فقط (دفعات ≤ 30 بالاستعلام in) → { id: data } */
export async function getDocsByIds(name, ids) {
  const uniq = [...new Set((ids || []).map((v) => String(v === null || v === undefined ? "" : v)).filter((v) => v && !v.includes("/")))];
  const out = {};
  for (let i = 0; i < uniq.length; i += 30) {
    const chunk = uniq.slice(i, i + 30);
    const snap = await fs.getDocs(fs.query(col(name), fs.where(fs.documentId(), "in", chunk)));
    snap.docs.forEach((d) => { out[d.id] = { id: d.id, ...d.data() }; });
  }
  return out;
}

/**
 * أي من هذه الأكواد موجود فعلًا في codes (بحقل code)؟ → Set من النصوص.
 * يقرأ المطابق فقط بدل كل الأكواد. الحقل قد يكون نصًا أو رقمًا فنبحث بالصيغتين،
 * ثم تُطبَّع القيم المرجعة بـ safeText كما كان يفعل الكود القديم.
 */
export async function existingCodeSet(codes) {
  const out = new Set();
  const uniq = [...new Set((codes || []).map((c) => safeText(c)).filter(Boolean))];
  const chunks = [];
  for (let i = 0; i < uniq.length; i += 15) chunks.push(uniq.slice(i, i + 15));
  await Promise.all(chunks.map(async (chunk) => {
    const vals = chunk.flatMap((c) => (/^\d+$/.test(c) && c.length < 16 ? [c, Number(c)] : [c]));
    const docs = await queryDocs("codes", fs.where("code", "in", vals));
    docs.forEach((d) => out.add(safeText(d.code)));
  }));
  return out;
}

/** بيانات الطالب الحالي من Firestore (أو UNAUTHORIZED إن لم يوجد) */
export async function loadStudent(student) {
  const d = await getDocData("students", student.id);
  if (!d) bad("UNAUTHORIZED", "الحساب غير موجود.");
  return d;
}

export function isYouTubeUrl(v) {
  const s = safeText(v);
  if (!s) return false;
  try {
    const u = new URL(s);
    const host = u.hostname.replace(/^www\./, "");
    return (
      host === "youtu.be" ||
      host === "youtube.com" ||
      host === "m.youtube.com" ||
      host === "youtube-nocookie.com"
    );
  } catch (e) {
    return false;
  }
}

/** قيم البحث الممكنة لحقل قد يُخزَّن نصًا أو رقمًا (مثل كود 123456) */
export function lookupVariants(value) {
  const s = safeText(value);
  const out = [s];
  if (/^\d+$/.test(s) && s.length < 16) out.push(Number(s));
  if (s !== s.toUpperCase()) out.push(s.toUpperCase());
  return out;
}

/* ---------- الجلسة ---------- */

export function requireStudent() {
  const s = getSession();
  if (!s || s.role !== "student" || !s.token || !s.student || !s.student.id) {
    bad("UNAUTHORIZED", "انتهت الجلسة. يرجى تسجيل الدخول مرة أخرى.");
  }
  if (!auth.currentUser || auth.currentUser.uid !== s.student.id) {
    bad("UNAUTHORIZED", "انتهت الجلسة. يرجى تسجيل الدخول مرة أخرى.");
  }
  return {
    id: s.student.id,
    code: s.student.code || "",
    stage: s.student.stage || "",
    fullName: s.student.fullName || ""
  };
}

export function requireAdmin() {
  const s = getSession();
  if (!s || s.role !== "admin" || !s.token || !s.admin || !s.admin.id) {
    bad("UNAUTHORIZED", "انتهت الجلسة. يرجى تسجيل الدخول مرة أخرى.");
  }
  if (!auth.currentUser || auth.currentUser.uid !== s.admin.id) {
    bad("UNAUTHORIZED", "انتهت الجلسة. يرجى تسجيل الدخول مرة أخرى.");
  }
  return { id: s.admin.id, email: s.admin.email || "", name: s.admin.name || "" };
}

/* ---------- الموجّه (Router) ---------- */

const routes = [];

/**
 * route("GET", "/api/admin/codes/:id", async (ctx) => ok(...))
 * ctx = { params, query, body }
 */
export function route(method, pattern, handler) {
  const keys = [];
  const source = pattern.replace(/:([A-Za-z0-9_]+)/g, (_, k) => {
    keys.push(k);
    return "([^/]+)";
  });
  routes.push({
    method: method.toUpperCase(),
    regex: new RegExp("^" + source + "/?$"),
    keys,
    handler
  });
}

function explainFirestoreError(err) {
  const code = err && err.code ? String(err.code) : "";
  if (code === "permission-denied") {
    return fail(
      "UNAUTHORIZED",
      "انتهت الجلسة أو لا توجد صلاحية. سجّل الدخول مرة أخرى."
    );
  }
  if (code === "unavailable" || code === "deadline-exceeded") {
    return fail("NETWORK_ERROR", "لا يوجد اتصال بالإنترنت. حاول مرة أخرى.");
  }
  if (code === "failed-precondition") {
    return fail(
      "SERVER_ERROR",
      "قاعدة البيانات تحتاج إعدادًا إضافيًا (فهرس أو قاعدة بيانات غير مُنشأة)."
    );
  }
  return fail("SERVER_ERROR", "حدث خطأ. حاول مرة أخرى.");
}

/**
 * نقطة الدخول الوحيدة: تستبدل fetch(WORKER_URL + endpoint).
 */
export async function backendRequest(endpoint, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  try {
    await authReady();
    const url = new URL(String(endpoint), "http://local");
    const query = {};
    url.searchParams.forEach((v, k) => { query[k] = v; });
    if (options.query && typeof options.query === "object") {
      Object.entries(options.query).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== "") query[k] = String(v);
      });
    }

    const path = url.pathname;
    for (const r of routes) {
      if (r.method !== method) continue;
      const m = r.regex.exec(path);
      if (!m) continue;

      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });

      const body = options.body && typeof options.body === "object" ? options.body : {};
      const result = await r.handler({ params, query, body });
      return result;
    }

    console.warn("[backend] مسار غير منفَّذ:", method, path);
    return fail("SERVER_ERROR", "هذه الميزة غير متاحة بعد.");
  } catch (err) {
    if (err instanceof ApiError) return fail(err.code, err.message);
    console.error("[backend]", method, endpoint, err);
    return explainFirestoreError(err);
  }
}
