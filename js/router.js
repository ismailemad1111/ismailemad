/**
 * router.js
 * ------------------------------------------------------------
 * منصة أ/ إسماعيل عماد التعليمية
 * إدارة التنقل والحماية (Frontend-only).
 *
 * المكان: /js/router.js
 *
 * المرجع:
 *   - الوثيقة الأصلية (بنود 61، 104، 105، 106، 107، 132، 204)
 *   - Master Design System (بند 61)
 *
 * ⚠️ تحذير صريح:
 *   - هذا الملف "ليس حماية حقيقية".
 *   - هو فقط لتحسين تجربة المستخدم (UX) وتوجيهه.
 *   - الحماية الفعلية من:
 *       1. Firestore Security Rules (بند 108).
 *       2. Cloudflare Worker (بند 109).
 *   - الفرونت إند لا يُعتبر مصدر ثقة أبدًا (بند 104).
 *
 * الاستخدام في أي صفحة محمية:
 *   import { requireAuth, requireStudent, requireAdmin }
 *     from './js/router.js';
 *
 *   // في أول الصفحة
 *   requireStudent();
 * ------------------------------------------------------------
 */

import { safeQuerySelector } from "./helpers.js";


/* ============================================================
   01 — مسارات المنصة
   المرجع: الوثيقة الأصلية — بند 7 + بند 193
   القاعدة: المسارات معرّفة بشكل مركزي، لا يتم تكرارها.
   ============================================================ */

/**
 * خريطة المسارات الأساسية في المنصة.
 * تُستخدم في التوجيه (redirect) وفي بناء الروابط (deep navigation).
 */
export const ROUTES = {
  // صفحة عامة (لا تحتاج تسجيل دخول)
  HOME:          "index.html",
  LOGIN:         "login.html",
  SUBSCRIBE:     "subscribe.html",

  // صفحات الطالب
  ANNOUNCEMENTS: "announcements.html",
  LESSONS:       "lessons.html",
  EXAMS:         "exams.html",
  PLANNER:       "planner.html",
  AI:            "ai.html",
  PROFILE:       "profile.html",
  BANK:          "bank.html",
  EVENTS:        "events.html",
  EVENT:         "event.html",
  EVENT_PLAY:    "event-play.html",

  // صفحات الإدارة
  ADMIN_LOGIN:       "admin/login.html",
  ADMIN_HOME:        "admin/index.html",
  ADMIN_CODES:       "admin/codes.html",
  ADMIN_STUDENTS:    "admin/students.html",
  ADMIN_REQUESTS:    "admin/requests.html",
  ADMIN_ANNOUNCEMENTS: "admin/announcements.html",
  ADMIN_LESSONS:     "admin/lessons.html",
  ADMIN_EXAMS:       "admin/exams.html",
  ADMIN_RESULTS:     "admin/results.html",
  ADMIN_SETTINGS:    "admin/settings.html",
  ADMIN_STATISTICS:  "admin/statistics.html",
  ADMIN_BANK:        "admin/bank.html",
  ADMIN_EVENTS:      "admin/events.html"
};


/* ============================================================
   02 — إدارة الجلسة (Client-side فقط)
   المرجع: الوثيقة الأصلية — بنود 105، 106
   القاعدة: التخزين هنا مؤقت ولا يُعتمد عليه أمنيًا.
   ============================================================ */

const SESSION_KEY = "am_session";

/**
 * حفظ بيانات الجلسة بعد تسجيل الدخول.
 * ⚠️ هذا تخزين محلي فقط — غير موثوق أمنيًا.
 * @param {Object} session
 */
export function setSession(session) {
  try {
    if (!session) {
      sessionStorage.removeItem(SESSION_KEY);
      return;
    }
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch (e) {
    // تجاهل أخطاء التخزين (private mode / ممتلئ)
  }
}

/**
 * قراءة بيانات الجلسة.
 * @returns {Object|null}
 */
export function getSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

/**
 * حذف الجلسة.
 * المرجع: الوثيقة الأصلية — بند 106
 */
export function clearSession() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch (e) {
    // تجاهل
  }
}


/* ============================================================
   03 — التوجيه
   المرجع: الوثيقة الأصلية — بند 61 (أقل عدد خطوات)
   ============================================================ */

/**
 * الانتقال إلى صفحة داخلية.
 * @param {string} path - مسار داخلي (من ROUTES)
 * @param {Object} query - باراميترات إضافية في الرابط
 */
export function navigateTo(path, query = {}) {
  if (!path) return;

  let url = path;

  const params = new URLSearchParams();
  Object.entries(query).forEach(([k, v]) => {
    if (v !== undefined && v !== null) params.append(k, v);
  });

  const qs = params.toString();
  if (qs) url += `?${qs}`;

  window.location.href = url;
}

/**
 * إعادة التحميل بعد الانتقال لصفحة معينة.
 * @param {string} path
 */
export function redirectTo(path) {
  window.location.replace(path);
}


/* ============================================================
   04 — قراءة الـ redirect من الرابط
   المرجع: الوثيقة الأصلية — بند 204 (final flow)
   الاستخدام: لو الطالب حاول يفتح صفحة محمية، نوجّهه لـ Login
   مع ?redirect=الصفحة-الأصلية، وبعد الدخول نرجّعه.
   ============================================================ */

/**
 * قراءة قيمة redirect من الرابط.
 * @returns {string|null}
 */
export function getRedirectTarget() {
  try {
    const params = new URLSearchParams(window.location.search);
    const target = params.get("redirect");
    if (!target) return null;

    // حماية أساسية: نمنع redirect خارجي أو javascript:
    if (
      target.startsWith("http://") ||
      target.startsWith("https://") ||
      target.startsWith("//") ||
      target.toLowerCase().startsWith("javascript:")
    ) {
      return null;
    }

    return target;
  } catch (e) {
    return null;
  }
}


/* ============================================================
   05 — الحماية (Client-side)
   المرجع: الوثيقة الأصلية — بنود 104، 105، 107
   القاعدة: هذه الحماية UX فقط. ليست أمنًا حقيقيًا.
   ============================================================ */

/**
 * تتأكد من وجود جلسة طالب صالحة.
 * لو مفيش، توجّهه لـ login.html مع redirect للصفحة الحالية.
 * @returns {Object|null} - الجلسة إن وُجدت
 */
export function requireStudent() {
  const session = getSession();

  if (!session || session.role !== "student") {
    const current = window.location.pathname.split("/").pop() || "";
    const target = current ? `${current}${window.location.search}` : "";
    const url = target
      ? `${ROUTES.LOGIN}?redirect=${encodeURIComponent(target)}`
      : ROUTES.LOGIN;

    redirectTo(url);
    return null;
  }

  return session;
}

/**
 * تتأكد من أن المستخدم إداري (Admin).
 * لو مفيش جلسة إدارية، توجّهه لـ admin/login.html.
 * @returns {Object|null}
 */
export function requireAdmin() {
  const session = getSession();

  if (!session || session.role !== "admin") {
    const current = window.location.pathname.split("/").pop() || "";
    // login.html موجود داخل مجلد admin نفسه؛ لذلك يجب أن يكون redirect نسبيًا له مباشرة.
    const target = current ? `${current}${window.location.search}` : "";
    const url = target
      ? `${ROUTES.ADMIN_LOGIN}?redirect=${encodeURIComponent(target)}`
      : ROUTES.ADMIN_LOGIN;

    redirectTo(url);
    return null;
  }

  return session;
}

/**
 * تتأكد أن المستخدم "غير مسجّل" (لصفحات login / subscribe).
 * لو مسجّل طالب، توجّهه للـ HOME.
 * لو مسجّل أدمن، توجّهه للـ admin home.
 */
export function requireGuest() {
  const session = getSession();
  if (!session) return;

  if (session.role === "student") {
    redirectTo(ROUTES.HOME);
    return;
  }

  if (session.role === "admin") {
    redirectTo(ROUTES.ADMIN_HOME);
  }
}


/* ============================================================
   06 — تسجيل الخروج
   المرجع: الوثيقة الأصلية — بند 106
   ============================================================ */

/**
 * إنهاء الجلسة والتوجيه للـ Login.
 * @param {"student"|"admin"} role
 */
export function logout(role = "student") {
  clearSession();

  if (role === "admin") {
    redirectTo(ROUTES.ADMIN_LOGIN);
  } else {
    redirectTo(ROUTES.LOGIN);
  }
}


/* ============================================================
   07 — أدوات مساعدة للتنقل
   ============================================================ */

/**
 * قراءة اسم الصفحة الحالية (بدون query string).
 * @returns {string}
 */
export function getCurrentPage() {
  const path = window.location.pathname;
  const parts = path.split("/");
  return parts[parts.length - 1] || "";
}

/**
 * هل الصفحة الحالية هي المطلوبة؟
 * @param {string} route
 * @returns {boolean}
 */
export function isCurrentPage(route) {
  return getCurrentPage() === route;
}

/**
 * تفعيل رابط "نشط" في الـ Bottom Navigation.
 * المرجع: الوثيقة الأصلية — بند 73
 */
export function markActiveNav() {
  const current = getCurrentPage();
  const items = document.querySelectorAll(".bottom-nav-item");

  items.forEach((item) => {
    const href = item.getAttribute("href") || "";
    const target = href.split("/").pop().split("?")[0];

    if (target === current) {
      item.classList.add("is-active");
    } else {
      item.classList.remove("is-active");
    }
  });
}