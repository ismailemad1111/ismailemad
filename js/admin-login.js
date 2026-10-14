/**
 * admin-login.js
 * ------------------------------------------------------------
 * منصة أ/ إسماعيل عماد التعليمية
 * تشغيل صفحة admin/login.html — دخول الإدارة.
 *
 * المكان: /js/admin-login.js
 *
 * المرجع:
 *   - الوثيقة الأصلية (بنود 89، 90، 91، 104، 114، 130، 205)
 *   - Master Design System (بند 58)
 *
 * ⚠️ قواعد:
 *   - نظام الإدارة مستقل عن نظام الطالب (بند 89).
 *   - كل التحقق الحقيقي في Worker (بند 109).
 *   - الفرونت للـ UX فقط (بند 126).
 *   - لا تخزين كلمة المرور.
 *
 * ⚠️ حالة الملف:
 *   - WORKER_URL = PLACEHOLDER_WORKER_URL (البند 207).
 *   - loginAdmin سترجع NETWORK_ERROR حتى بناء الـ Worker.
 * ------------------------------------------------------------
 */

import {
  onReady,
  safeText,
  showToast,
  validateEmail
} from "./helpers.js";

import {
  getSession,
  getRedirectTarget,
  ROUTES
} from "./router.js";

import {
  loginAdmin,
  AUTH_ERRORS
} from "./auth.js";


/* ============================================================
   01 — المرجع للعناصر
   ============================================================ */

let loginForm     = null;
let emailInput    = null;
let passwordInput = null;
let submitBtn     = null;


/* ============================================================
   02 — الحالة
   ============================================================ */

let isSubmitting = false;


/* ============================================================
   03 — تجميع العناصر
   ============================================================ */

function cacheElements() {
  loginForm     = document.getElementById("adminLoginForm");
  emailInput    = document.getElementById("adminEmail");
  passwordInput = document.getElementById("adminPassword");
  submitBtn     = document.getElementById("adminSubmitBtn");
}


/* ============================================================
   04 — حالة زر الإرسال
   المرجع: الوثيقة الأصلية — بند 122
   ============================================================ */

function setSubmitting(state) {
  isSubmitting = !!state;

  if (!submitBtn) return;

  submitBtn.disabled = isSubmitting;

  if (isSubmitting) {
    submitBtn.classList.add("is-loading");
    submitBtn.setAttribute("aria-busy", "true");
  } else {
    submitBtn.classList.remove("is-loading");
    submitBtn.removeAttribute("aria-busy");
  }
}


/* ============================================================
   05 — عرض / إخفاء الأخطاء
   ============================================================ */

function showFieldError(field, message) {
  if (!field) return;

  field.classList.add("is-error");

  const group = field.closest(".form-group") || field.parentElement;
  if (!group) return;

  let errorEl = group.querySelector(".form-error");
  if (!errorEl) {
    errorEl = document.createElement("span");
    errorEl.className = "form-error";
    errorEl.style.cssText = "display:block;margin-top:6px;font-size:12px;font-weight:600;color:var(--color-red);";
    group.appendChild(errorEl);
  }
  errorEl.textContent = String(message || "");
}

function clearFieldError(field) {
  if (!field) return;

  field.classList.remove("is-error");

  const group = field.closest(".form-group") || field.parentElement;
  if (!group) return;

  const errorEl = group.querySelector(".form-error");
  if (errorEl) errorEl.remove();
}

function clearAllErrors() {
  clearFieldError(emailInput);
  clearFieldError(passwordInput);
}


/* ============================================================
   06 — التحقق (Frontend UX)
   المرجع: الوثيقة الأصلية — بنود 121، 126
   ============================================================ */

function validateForm() {
  const errors = {};

  const email    = emailInput ? safeText(emailInput.value) : "";
  const password = passwordInput ? String(passwordInput.value) : "";

  if (!email) {
    errors.email = "من فضلك أدخل البريد الإلكتروني.";
  } else if (!validateEmail(email)) {
    errors.email = "صيغة البريد الإلكتروني غير صحيحة.";
  }

  if (!password) {
    errors.password = "من فضلك أدخل كلمة المرور.";
  }

  return { valid: Object.keys(errors).length === 0, errors };
}


/* ============================================================
   07 — التوجيه بعد النجاح
   ============================================================ */

function redirectAfterLogin() {
  const target = getRedirectTarget();

  if (target) {
    // لو redirect داخلي (admin/xxx)
    window.location.replace(target);
    return;
  }

  // الافتراضي: لوحة التحكم
  window.location.replace("index.html");
}


/* ============================================================
   08 — إرسال النموذج
   المرجع: الوثيقة الأصلية — بنود 90، 130، 205
   ============================================================ */

async function handleSubmit(event) {
  if (event) event.preventDefault();

  if (isSubmitting) return;

  clearAllErrors();

  const { valid, errors } = validateForm();

  if (!valid) {
    if (errors.email)    showFieldError(emailInput, errors.email);
    if (errors.password) showFieldError(passwordInput, errors.password);

    if (errors.email && emailInput) emailInput.focus();
    else if (errors.password && passwordInput) passwordInput.focus();

    return;
  }

  const email = safeText(emailInput.value);
  const password = String(passwordInput.value);

  setSubmitting(true);

  const result = await loginAdmin(email, password);

  setSubmitting(false);

  if (result && result.success) {
    showToast("تم تسجيل الدخول بنجاح ✅", "success");
    // تأخير بسيط لعرض الـ Toast
    setTimeout(() => redirectAfterLogin(), 400);
    return;
  }

  // ---------- معالجة الفشل ----------
  const code = (result && result.error && result.error.code) || AUTH_ERRORS.SERVER_ERROR;
  const message = (result && result.error && result.error.message) || "";

  switch (code) {
    case AUTH_ERRORS.INVALID_PASSWORD:
    case "INVALID_CREDENTIALS":
      showFieldError(emailInput, "بيانات الدخول غير صحيحة.");
      showFieldError(passwordInput, "بيانات الدخول غير صحيحة.");
      showToast("البريد أو كلمة المرور غير صحيحة.", "error");
      break;

    case AUTH_ERRORS.UNAUTHORIZED:
    case AUTH_ERRORS.FORBIDDEN:
      showToast(message || "غير مصرح لك بالدخول إلى لوحة التحكم.", "error");
      break;

    case AUTH_ERRORS.NETWORK_ERROR:
      showToast(message || "لا يوجد اتصال بالإنترنت.", "error");
      break;

    case AUTH_ERRORS.TIMEOUT:
      showToast(message || "انتهت مدة الطلب. حاول مرة أخرى.", "warning");
      break;

    case AUTH_ERRORS.SERVER_ERROR:
    default:
      showToast(message || "حدث خطأ. حاول مرة أخرى.", "error");
      break;
  }
}


/* ============================================================
   09 — تنظيف الأخطاء عند الكتابة
   ============================================================ */

function bindFieldCleanup() {
  [emailInput, passwordInput].forEach((field) => {
    if (!field) return;
    field.addEventListener("input", () => clearFieldError(field));
  });
}


/* ============================================================
   10 — التحقق من وجود جلسة سارية
   ============================================================ */

function checkExistingSession() {
  const session = getSession();

  // لو فيه جلسة إدارية سارية → نوجهه للوحة التحكم مباشرة
  if (session && session.role === "admin" && session.token) {
    window.location.replace("index.html");
    return true;
  }

  return false;
}


/* ============================================================
   11 — التهيئة
   ============================================================ */

function init() {
  // 1) لو فيه جلسة إدارية سارية → نوجهه
  if (checkExistingSession()) return;

  // 2) تجميع العناصر
  cacheElements();

  // 3) لو العناصر الأساسية ناقصة → نتوقف
  if (!loginForm || !emailInput || !passwordInput || !submitBtn) {
    return;
  }

  // 4) ربط الأحداث
  loginForm.addEventListener("submit", handleSubmit);
  bindFieldCleanup();

  // 5) تركيز على أول حقل (ديسكتوب فقط)
  const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (!isMobile && emailInput) {
    emailInput.focus();
  }
}


/* ============================================================
   12 — التشغيل
   ============================================================ */

onReady(init);