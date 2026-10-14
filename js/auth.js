/**
 * auth.js
 * ------------------------------------------------------------
 * منصة أ/ إسماعيل عماد التعليمية
 * نظام المصادقة في الفرونت إند.
 *
 * المكان: /js/auth.js
 *
 * المرجع:
 *   - الوثيقة الأصلية (بنود 18، 19، 62، 90، 104، 105، 106، 107،
 *                       111، 112، 113، 114، 143، 204، 205)
 *
 * ⚠️ قواعد صارمة:
 *   - الفرونت إند لا يُعتبر مصدر ثقة (بند 104).
 *   - كلمة المرور لا تُخزَّن في الفرونت (بند 62).
 *   - كل التحقق يتم في Worker (بند 109).
 *   - الحماية الفعلية من Firestore Rules + Worker (بند 108، 109).
 *
 * ⚠️ حالة الملف الحالية:
 *   - WORKER_URL = PLACEHOLDER_WORKER_URL (البند 207).
 *   - الدوال سترجع NETWORK_ERROR حتى يتم بناء الـ Worker.
 *   - هذا سلوك متوقع ومقصود، وليس خطأً.
 *
 * Endpoints المستهدفة:
 *   POST /api/auth/login     ← Student Login (Returning + First)
 *   POST /api/auth/logout    ← Student Logout
 *   POST /api/auth/admin     ← Admin Login
 *   POST /api/auth/refresh   ← Refresh Token
 * ------------------------------------------------------------
 */

import {
  setSession,
  getSession,
  clearSession
} from "./router.js";

import { safeText } from "./helpers.js";


/* ============================================================
   01 — ثوابت
   المرجع: الوثيقة الأصلية — بنود 112، 113، 114
   ============================================================ */

/**
 * أكواد الأخطاء الموحدة (بند 114).
 * الفرونت يعتمد على الكود، وليس على نص الرسالة.
 */
export const AUTH_ERRORS = {
  INVALID_CODE:        "INVALID_CODE",
  INVALID_PASSWORD:    "INVALID_PASSWORD",
  CODE_DISABLED:       "CODE_DISABLED",
  CODE_EXPIRED:        "CODE_EXPIRED",
  ALREADY_ACTIVATED:   "ALREADY_ACTIVATED",
  FIRST_LOGIN_REQUIRED:"FIRST_LOGIN_REQUIRED",
  STAGE_REQUIRED:      "STAGE_REQUIRED",
  UNAUTHORIZED:        "UNAUTHORIZED",
  FORBIDDEN:           "FORBIDDEN",
  NETWORK_ERROR:       "NETWORK_ERROR",
  TIMEOUT:             "TIMEOUT",
  SERVER_ERROR:        "SERVER_ERROR"
};

/**
 * رسائل الأخطاء المعروضة للطالب.
 * المرجع: Master Design System — بند 36 + الوثيقة الأصلية — بند 142
 * القاعدة: لا تُعرض تفاصيل تقنية.
 */
const AUTH_ERROR_MESSAGES = {
  INVALID_CODE:          "الكود غير صحيح.",
  INVALID_PASSWORD:      "كلمة المرور غير صحيحة.",
  CODE_DISABLED:         "هذا الكود غير مفعّل. تواصل مع الإدارة.",
  CODE_EXPIRED:          "انتهت صلاحية هذا الكود.",
  ALREADY_ACTIVATED:     "هذا الكود مستخدم بالفعل.",
  FIRST_LOGIN_REQUIRED:  "هذه أول مرة يتم فيها استخدام الكود. أدخل بياناتك.",
  STAGE_REQUIRED:        "يجب اختيار المرحلة الدراسية.",
  UNAUTHORIZED:          "انتهت الجلسة. يرجى تسجيل الدخول مرة أخرى.",
  FORBIDDEN:             "غير مسموح بهذا الإجراء.",
  NETWORK_ERROR:         "لا يوجد اتصال بالإنترنت. حاول مرة أخرى.",
  TIMEOUT:               "انتهت مدة الطلب. حاول مرة أخرى.",
  SERVER_ERROR:          "حدث خطأ. حاول مرة أخرى."
};

/**
 * ترجمة كود الخطأ إلى رسالة عربية.
 * @param {string} code
 * @returns {string}
 */
export function getErrorMessage(code) {
  return AUTH_ERROR_MESSAGES[code] || AUTH_ERROR_MESSAGES.SERVER_ERROR;
}


/* ============================================================
   02 — طلب HTTP موحّد للـ Worker
   المرجع: الوثيقة الأصلية — بنود 112، 113، 114
   ============================================================ */

const REQUEST_TIMEOUT_MS = 15000; // 15 ثانية

/**
 * إرسال طلب إلى الـ Worker.
 * - يضيف الـ Authorization تلقائيًا إن وُجد Token.
 * - يوحّد معالجة الأخطاء.
 * - يفرض Timeout.
 *
 * @param {string} endpoint - مسار الـ API (مثل "/api/auth/login")
 * @param {Object} options
 * @param {string} options.method - GET / POST / ...
 * @param {Object} options.body - البيانات المُرسَلة
 * @returns {Promise<Object>} - { success, data } أو { success:false, error }
 */
import { backendRequest } from "./backend/index.js";
async function workerRequest(endpoint, options = {}) {
  // بدون Worker: التنفيذ داخل المتصفح عبر Firestore (js/backend/)
  return backendRequest(endpoint, options);
}


/* ============================================================
   03 — تسجيل دخول الطالب
   المرجع: الوثيقة الأصلية — بنود 18، 19، 204
   ============================================================ */

/**
 * تسجيل دخول طالب (Returning Login).
 * الكود + كلمة المرور فقط (بند 19).
 *
 * @param {string} code
 * @param {string} password
 * @returns {Promise<Object>} - { success, data: { token, student } } أو { success:false, error }
 */
export async function loginStudent(code, password) {
  const cleanCode = safeText(code);
  const cleanPass = password == null ? "" : String(password);

  // تحقق أساسي (Frontend UX فقط)
  if (!cleanCode || !cleanPass) {
    return {
      success: false,
      error: {
        code: AUTH_ERRORS.INVALID_CODE,
        message: AUTH_ERROR_MESSAGES.INVALID_CODE
      }
    };
  }

  const result = await workerRequest("/api/auth/login", {
    method: "POST",
    body: {
      code: cleanCode,
      password: cleanPass
    }
  });

  if (result.success && result.data && result.data.token) {
    // تخزين الجلسة في الفرونت
    setSession({
      role: "student",
      token: result.data.token,
      refreshToken: result.data.refreshToken || null,
      student: result.data.student || null,
      createdAt: Date.now()
    });
  }

  return result;
}


/* ============================================================
   04 — تسجيل دخول أول مرة (First Login)
   المرجع: الوثيقة الأصلية — بند 18
   ============================================================ */

/**
 * تسجيل دخول أول مرة (First Login).
 * الكود + كلمة المرور + الاسم الكامل + المرحلة (بند 18).
 *
 * @param {Object} payload
 * @param {string} payload.code
 * @param {string} payload.password
 * @param {string} payload.fullName
 * @param {string} payload.stage
 * @returns {Promise<Object>}
 */
export async function firstLoginStudent({ code, password, fullName, stage }) {
  const cleanCode = safeText(code);
  const cleanPass = password == null ? "" : String(password);
  const cleanName = safeText(fullName);
  const cleanStage = safeText(stage);

  // تحقق أساسي
  if (!cleanCode || !cleanPass) {
    return {
      success: false,
      error: {
        code: AUTH_ERRORS.INVALID_CODE,
        message: AUTH_ERROR_MESSAGES.INVALID_CODE
      }
    };
  }
  if (!cleanName) {
    return {
      success: false,
      error: {
        code: AUTH_ERRORS.SERVER_ERROR,
        message: "من فضلك أدخل الاسم الكامل."
      }
    };
  }
  if (!cleanStage) {
    return {
      success: false,
      error: {
        code: AUTH_ERRORS.STAGE_REQUIRED,
        message: AUTH_ERROR_MESSAGES.STAGE_REQUIRED
      }
    };
  }

  const result = await workerRequest("/api/auth/login", {
    method: "POST",
    body: {
      code: cleanCode,
      password: cleanPass,
      fullName: cleanName,
      stage: cleanStage,
      firstLogin: true
    }
  });

  if (result.success && result.data && result.data.token) {
    setSession({
      role: "student",
      token: result.data.token,
      refreshToken: result.data.refreshToken || null,
      student: result.data.student || null,
      createdAt: Date.now()
    });
  }

  return result;
}


/* ============================================================
   05 — تسجيل دخول الإدارة
   المرجع: الوثيقة الأصلية — بنود 90، 205
   ============================================================ */

/**
 * تسجيل دخول الإدارة.
 *
 * @param {string} email - أو أي معرّف يعتمده نظام الإدارة
 * @param {string} password
 * @returns {Promise<Object>}
 */
export async function loginAdmin(email, password) {
  const cleanEmail = safeText(email);
  const cleanPass = password == null ? "" : String(password);

  if (!cleanEmail || !cleanPass) {
    return {
      success: false,
      error: {
        code: AUTH_ERRORS.INVALID_PASSWORD,
        message: "بيانات الدخول غير مكتملة."
      }
    };
  }

  const result = await workerRequest("/api/auth/admin", {
    method: "POST",
    body: {
      email: cleanEmail,
      password: cleanPass
    }
  });

  if (result.success && result.data && result.data.token) {
    setSession({
      role: "admin",
      token: result.data.token,
      refreshToken: result.data.refreshToken || null,
      admin: result.data.admin || null,
      createdAt: Date.now()
    });
  }

  return result;
}


/* ============================================================
   06 — تسجيل الخروج
   المرجع: الوثيقة الأصلية — بند 106
   ============================================================ */

/**
 * تسجيل الخروج.
 * - إرسال طلب للـ Worker لإنهاء الجلسة (إن أمكن).
 * - حذف الجلسة من الفرونت.
 *
 * @returns {Promise<void>}
 */
export async function logout() {
  const session = getSession();

  // محاولة إبلاغ الـ Worker (لا يعطل تسجيل الخروج إن فشل)
  if (session && session.token) {
    try {
      await workerRequest("/api/auth/logout", { method: "POST" });
    } catch (e) {
      // تجاهل — الأهم محليًا
    }
  }

  // مسح الجلسة دائمًا
  clearSession();
}


/* ============================================================
   07 — تجديد الـ Token
   المرجع: الوثيقة الأصلية — بند 105 (Token expiration)
   ============================================================ */

/**
 * طلب تجديد الـ Token من الـ Worker.
 * يُستخدم عند استقبال 401 من أي طلب لاحق.
 *
 * @returns {Promise<boolean>} - true إن نجح التجديد
 */
export async function refreshToken() {
  const session = getSession();
  if (!session || !session.token) return false;

  if (!session.refreshToken) {
    clearSession();
    return false;
  }

  const result = await workerRequest("/api/auth/refresh", {
    method: "POST",
    authToken: session.refreshToken
  });

  if (result.success && result.data && result.data.token) {
    setSession({
      ...session,
      token: result.data.token,
      refreshToken: result.data.refreshToken || session.refreshToken
    });
    return true;
  }

  // فشل التجديد → مسح الجلسة
  clearSession();
  return false;
}


/* ============================================================
   08 — حالة المصادقة
   ============================================================ */

/**
 * هل المستخدم مسجّل كطالب؟
 * @returns {boolean}
 */
export function isStudentLoggedIn() {
  const session = getSession();
  return !!(session && session.role === "student" && session.token);
}

/**
 * هل المستخدم مسجّل كأدمن؟
 * @returns {boolean}
 */
export function isAdminLoggedIn() {
  const session = getSession();
  return !!(session && session.role === "admin" && session.token);
}

/**
 * الحصول على بيانات الطالب المخزنة محليًا.
 * ⚠️ هذه البيانات للعرض فقط، وليست مصدر ثقة (بند 104).
 * @returns {Object|null}
 */
export function getCurrentStudent() {
  const session = getSession();
  if (!session || session.role !== "student") return null;
  return session.student || null;
}