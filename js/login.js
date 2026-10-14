/**
 * login.js
 * ------------------------------------------------------------
 * منصة أ/ إسماعيل عماد التعليمية
 * تشغيل صفحة login.html
 *
 * المكان: /js/login.js
 *
 * المرجع:
 *   - الوثيقة الأصلية (بنود 17، 18، 19، 104، 105، 106، 114، 204)
 *   - Master Design System (بنود 33، 34، 36، 44، 55)
 *
 * ⚠️ قواعد:
 *   - كل التحقق الحقيقي في Worker.
 *   - التحقق هنا للـ UX فقط.
 *   - كلمة المرور لا تُخزَّن في الفرونت.
 *
 * ⚠️ حالة الملف:
 *   - WORKER_URL = PLACEHOLDER_WORKER_URL (البند 207).
 *   - الدوال سترجع NETWORK_ERROR حتى بناء الـ Worker.
 *   - هذا سلوك متوقع ومقصود.
 * ------------------------------------------------------------
 */

import { onReady, safeText, showToast } from "./helpers.js";
import {
  requireGuest,
  getRedirectTarget,
  navigateTo,
  ROUTES
} from "./router.js";
import {
  loginStudent,
  firstLoginStudent,
  AUTH_ERRORS
} from "./auth.js";
import {
  validateLoginForm,
  validateFirstLoginForm,
  showFieldError,
  clearFieldError,
  clearFormErrors
} from "./validation.js";


import { barai } from "./barai/safe.js";

/* ============================================================
   01 — المراجع للعناصر (تُملأ عند الجاهزية)
   ============================================================ */

let loginForm = null;
let codeInput = null;
let passwordInput = null;
let firstLoginSection = null;
let fullNameInput = null;
let stageSelect = null;
let submitBtn = null;
let loginTitleEl = null;
let loginSubtitleEl = null;
let credsStepEl = null;
let stepsBoxEl = null;
let summaryCodeEl = null;
let editCodeBtn = null;

/** حالة "أول مرة" — بتتحول true لما الـ Worker يطلبها */
let isFirstLoginMode = false;

/** حالة الإرسال — لمنع الإرسال المزدوج */
let isSubmitting = false;


/* ============================================================
   02 — تجميع العناصر
   ============================================================ */

function cacheElements() {
  loginForm         = document.getElementById("loginForm");
  codeInput         = document.getElementById("codeInput");
  passwordInput     = document.getElementById("passwordInput");
  firstLoginSection = document.getElementById("firstLoginSection");
  fullNameInput     = document.getElementById("fullNameInput");
  stageSelect       = document.getElementById("stageSelect");
  submitBtn         = document.getElementById("submitBtn");
  loginTitleEl      = document.getElementById("loginTitle");
  loginSubtitleEl   = document.getElementById("loginSubtitle");
  credsStepEl       = document.getElementById("credsStep");
  stepsBoxEl        = document.getElementById("loginSteps");
  summaryCodeEl     = document.getElementById("summaryCode");
  editCodeBtn       = document.getElementById("editCodeBtn");
}


/* ============================================================
   03 — الخطوتان: (1) الكود وكلمة المرور  ←→  (2) الاسم والمرحلة
   ------------------------------------------------------------
   المبدأ: «ينتقل» الطالب ولا «ينزل»:
     - الخطوة 2 تحلّ محل الخطوة 1 في نفس الموضع (تبديل + تلاشٍ ≤ 250ms).
     - ارتفاع الصندوق يتحرك بانتقال قصير بدل قفزة.
     - التركيز على حقل الاسم بعد انتهاء الانتقال (لا مؤقت ثابت)، دون تمرير
       تلقائي؛ وإن لزم تمرير فلأقرب موضع يُظهر الحقول فوق لوحة المفاتيح.
     - لا يلمس هذا القسم أي منطق دخول: عرض وتركيز فقط.
   ============================================================ */

const HEAD_CREDS = {
  title: "تسجيل الدخول",
  sub: "أدخل الكود وكلمة المرور للدخول إلى حسابك"
};
const HEAD_INFO = {
  title: "أكمل بياناتك",
  sub: "هذه أول مرة يتم فيها استخدام الكود. من فضلك أكمل بياناتك."
};

const LEAVE_MS = 110;   // خروج الخطوة القديمة
const ENTER_MS = 140;   // دخول الخطوة الجديدة + حركة الارتفاع (المجموع ≤ 250ms)
let stepTimer = null;

function reduceMotion() {
  try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; }
}

function setHead(h) {
  if (loginTitleEl) loginTitleEl.textContent = h.title;
  if (loginSubtitleEl) loginSubtitleEl.textContent = h.sub;
}

/** يبدّل بين خطوتين في نفس الموضع. done() بعد انتهاء الانتقال فعليًا. */
function swapSteps(from, to, done) {
  if (stepTimer) { clearTimeout(stepTimer); stepTimer = null; }
  const finish = () => {
    stepTimer = null;
    [from, to].forEach((n) => n && n.classList.remove("is-leaving", "is-entering"));
    if (stepsBoxEl) { stepsBoxEl.style.height = ""; stepsBoxEl.classList.remove("is-resizing"); }
    if (done) done();
  };
  const show = (n) => { if (n === firstLoginSection) n.classList.add("is-visible"); else n.hidden = false; };
  const hide = (n) => { if (n === firstLoginSection) n.classList.remove("is-visible"); else n.hidden = true; };

  if (!from || !to || !stepsBoxEl || reduceMotion()) {
    if (from) hide(from);
    if (to) show(to);
    finish();
    return;
  }

  const h1 = stepsBoxEl.offsetHeight;
  from.classList.add("is-leaving");
  stepTimer = setTimeout(() => {
    hide(from);
    from.classList.remove("is-leaving");
    show(to);
    to.classList.add("is-entering");
    const h2 = stepsBoxEl.offsetHeight;           // الارتفاع الطبيعي الجديد
    stepsBoxEl.style.height = h1 + "px";
    stepsBoxEl.classList.add("is-resizing");
    void stepsBoxEl.offsetHeight;                  // reflow
    requestAnimationFrame(() => {
      stepsBoxEl.style.height = h2 + "px";
      to.classList.remove("is-entering");
    });
    stepTimer = setTimeout(finish, ENTER_MS + 40);
  }, LEAVE_MS);
}

/** نافذة الرؤية الفعلية (تراعي لوحة المفاتيح عبر visualViewport). */
function viewportBox() {
  const vv = window.visualViewport;
  if (vv) return { top: vv.offsetTop, height: vv.height };
  return { top: 0, height: window.innerHeight };
}

/**
 * يجعل الحقول المطلوبة ظاهرة بأقل تمرير ممكن (أقرب موضع):
 *  - إن اتسعت المجموعة (الاسم ← زر المتابعة) داخل الرؤية: تظهر كلها.
 *  - وإلا يظهر حقل الاسم في أعلى المجال.
 * لا يتحرك شيء إن كانت ظاهرة أصلًا.
 */
function ensureStepVisible(firstEl, lastEl) {
  const first = firstEl || (fullNameInput && fullNameInput.closest(".form-group"));
  const last = lastEl || submitBtn;
  if (!first) return;
  const vb = viewportBox();
  const viewTop = vb.top + 8;
  const viewBottom = vb.top + vb.height - 8;
  const a = first.getBoundingClientRect();
  const b = (last || first).getBoundingClientRect();
  let delta = 0;
  if (b.bottom - a.top <= viewBottom - viewTop) {
    if (b.bottom > viewBottom) delta = b.bottom - viewBottom;
    else if (a.top < viewTop) delta = a.top - viewTop;
  } else if (a.top < viewTop || a.bottom > viewBottom) {
    delta = a.top - viewTop;
  }
  if (Math.abs(delta) > 1) {
    window.scrollBy({ top: delta, left: 0, behavior: reduceMotion() ? "auto" : "smooth" });
  }
}

function focusField(el, group) {
  if (!el) return;
  try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
  ensureStepVisible(group || el.closest(".form-group"), submitBtn);
}

/**
 * الانتقال إلى الخطوة 2 (الاسم والمرحلة).
 * - الكود المُدخَل يتحول إلى سطر ملخّص (القيم تبقى في الحقول المخفية).
 * - بعد انتهاء الانتقال: تركيز الاسم + إتاحة الفقاعة الترحيبية.
 */
function showFirstLoginSection() {
  if (!firstLoginSection) return;
  if (isFirstLoginMode) { focusField(fullNameInput); return; }

  isFirstLoginMode = true;
  if (loginForm) loginForm.dataset.step = "info";
  if (summaryCodeEl && codeInput) summaryCodeEl.textContent = String(codeInput.value || "").trim();
  setHead(HEAD_INFO);

  swapSteps(credsStepEl, firstLoginSection, () => {
    if (!isFirstLoginMode) return;
    focusField(fullNameInput);
    try { barai.notify("login.firstStep"); } catch (e) { /* تجاهل */ }
  });
}

/**
 * الرجوع إلى الخطوة 1 (رابط «تعديل» أو خطأ يخص الكود/كلمة المرور).
 * القيم المكتوبة تبقى كما هي.
 * @param {{focus?: "code"|"password"|null}} opts
 */
function hideFirstLoginSection(opts = {}) {
  if (!firstLoginSection) return;
  if (!isFirstLoginMode) return;
  isFirstLoginMode = false;
  if (loginForm) loginForm.dataset.step = "creds";
  setHead(HEAD_CREDS);

  swapSteps(firstLoginSection, credsStepEl, () => {
    if (isFirstLoginMode) return;
    const target = opts.focus === "password" ? passwordInput : opts.focus === null ? null : codeInput;
    if (target) focusField(target, null);
  });
}

/** مع ظهور/اختفاء لوحة المفاتيح: أبقِ الحقل النشط وزر المتابعة ظاهرين. */
let vvTimer = null;
function bindViewportWatch() {
  const vv = window.visualViewport;
  if (!vv) return;
  vv.addEventListener("resize", () => {
    if (!isFirstLoginMode) return;
    const a = document.activeElement;
    if (!a || !(a === fullNameInput || a === stageSelect)) return;
    clearTimeout(vvTimer);
    vvTimer = setTimeout(() => ensureStepVisible(fullNameInput.closest(".form-group"), submitBtn), 120);
  });
}


/* ============================================================
   04 — تفعيل / تعطيل زر الإرسال
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
   05 — معالجة الأخطاء
   المرجع: الوثيقة الأصلية — بند 114
   القعتمد على error.code وليس نص الرسالة.
   ============================================================ */

/**
 * عرض خطأ حقل معيّن.
 * @param {"code"|"password"|"fullName"|"stage"} field
 * @param {string} message
 */
function showErrorOnField(field, message) {
  if (field === "code" && codeInput) {
    showFieldError(codeInput, message);
    return;
  }
  if (field === "password" && passwordInput) {
    showFieldError(passwordInput, message);
    return;
  }
  if (field === "fullName" && fullNameInput) {
    showFieldError(fullNameInput, message);
    return;
  }
  if (field === "stage" && stageSelect) {
    showFieldError(stageSelect, message);
    return;
  }
}

/**
 * مواقف برعي لكل كود: برعي يتعاطف فقط مع خطأ كتابة حقيقي من الطالب.
 *   INVALID_CODE / INVALID_PASSWORD ⇒ login.fail  (الطالب أخطأ فعلًا)
 *   FIRST_LOGIN_REQUIRED            ⇒ ليس خطأً: خطوة طبيعية (login.firstStep بعد انتهاء الانتقال)
 *   NETWORK_ERROR / TIMEOUT         ⇒ net.failed   (موقف نظام، ليس خطأ الطالب؛ ولا شيء لو الجهاز بلا اتصال: net.offline يغطيه)
 *   SERVER_ERROR / غير معروف        ⇒ error.generic
 *   حالات الحساب (معطل/منتهٍ/مستخدم/جلسة/صلاحية/مرحلة): الـ Toast وحده يكفي
 */
function baraiForLoginError(code) {
  try {
    switch (code) {
      case AUTH_ERRORS.INVALID_CODE:     barai.notify("login.fail", { kind: "code" }); break;
      case AUTH_ERRORS.INVALID_PASSWORD: barai.notify("login.fail", { kind: "password" }); break;
      case AUTH_ERRORS.NETWORK_ERROR:
      case AUTH_ERRORS.TIMEOUT:
        if (navigator.onLine !== false) barai.notify("net.failed");
        break;
      case AUTH_ERRORS.SERVER_ERROR: barai.notify("error.generic"); break;
      case AUTH_ERRORS.FIRST_LOGIN_REQUIRED:
      case AUTH_ERRORS.CODE_DISABLED:
      case AUTH_ERRORS.CODE_EXPIRED:
      case AUTH_ERRORS.ALREADY_ACTIVATED:
      case AUTH_ERRORS.STAGE_REQUIRED:
      case AUTH_ERRORS.UNAUTHORIZED:
      case AUTH_ERRORS.FORBIDDEN:
        break;
      default: barai.notify("error.generic");
    }
  } catch (e) { /* برعي تجميلي فقط */ }
}

/** أخطاء تخص حقلًا من الخطوة 1: لو كان الطالب في الخطوة 2 نرجعه إليها ليرى الخطأ. */
const STEP1_ERRORS = new Set([
  AUTH_ERRORS.INVALID_CODE,
  AUTH_ERRORS.INVALID_PASSWORD,
  AUTH_ERRORS.CODE_DISABLED,
  AUTH_ERRORS.CODE_EXPIRED,
  AUTH_ERRORS.ALREADY_ACTIVATED
]);

/**
 * معالجة أخطاء Worker.
 * @param {Object} error - { code, message }
 */
function handleWorkerError(error) {
  const code = error && error.code ? error.code : AUTH_ERRORS.SERVER_ERROR;
  const message = error && error.message
    ? error.message
    : "حدث خطأ. حاول مرة أخرى.";

  baraiForLoginError(code);

  if (isFirstLoginMode && STEP1_ERRORS.has(code)) {
    hideFirstLoginSection({ focus: code === AUTH_ERRORS.INVALID_PASSWORD ? "password" : "code" });
  }

  switch (code) {

    // كود غلط
    case AUTH_ERRORS.INVALID_CODE:
      showErrorOnField("code", message || "الكود غير صحيح.");
      showToast(message || "الكود غير صحيح.", "error");
      break;

    // كلمة المرور غلط
    case AUTH_ERRORS.INVALID_PASSWORD:
      showErrorOnField("password", message || "كلمة المرور غير صحيحة.");
      showToast(message || "كلمة المرور غير صحيحة.", "error");
      break;

    // كود معطل
    case AUTH_ERRORS.CODE_DISABLED:
      showToast(message || "هذا الكود غير مفعّل. تواصل مع الإدارة.", "warning");
      break;

    // كود منتهي
    case AUTH_ERRORS.CODE_EXPIRED:
      showToast(message || "انتهت صلاحية هذا الكود.", "warning");
      break;

    // كود مستخدم بالفعل (بس محاولة First Login جديدة)
    case AUTH_ERRORS.ALREADY_ACTIVATED:
      showToast(message || "هذا الكود مستخدم بالفعل.", "error");
      break;

    // Worker طلب First Login
    case AUTH_ERRORS.FIRST_LOGIN_REQUIRED:
      showFirstLoginSection();
      showToast(
        message || "هذه أول مرة يتم فيها استخدام الكود. أكمل بياناتك.",
        "info",
        4000
      );
      break;

    // مرحلة ناقصة
    case AUTH_ERRORS.STAGE_REQUIRED:
      showErrorOnField("stage", message || "من فضلك اختر المرحلة.");
      break;

    // جلسة انتهت (مش متوقعة في login)
    case AUTH_ERRORS.UNAUTHORIZED:
      showToast(message || "انتهت الجلسة. حاول مرة أخرى.", "warning");
      break;

    // غير مسموح
    case AUTH_ERRORS.FORBIDDEN:
      showToast(message || "غير مسموح بهذا الإجراء.", "error");
      break;

    // شبكة
    case AUTH_ERRORS.NETWORK_ERROR:
      showToast(message || "لا يوجد اتصال بالإنترنت. حاول مرة أخرى.", "error");
      break;

    // Timeout
    case AUTH_ERRORS.TIMEOUT:
      showToast(message || "انتهت مدة الطلب. حاول مرة أخرى.", "warning");
      break;

    // خطأ خادم
    case AUTH_ERRORS.SERVER_ERROR:
    default:
      showToast(message || "حدث خطأ. حاول مرة أخرى.", "error");
      break;
  }
}


/* ============================================================
   06 — التوجيه بعد النجاح
   المرجع: الوثيقة الأصلية — بند 204
   ============================================================ */

/**
 * التوجيه بعد تسجيل دخول ناجح.
 * - إن وُجد ?redirect= → يوجّهه.
 * - وإلا → للصفحة الرئيسية.
 */
function redirectAfterLogin() {
  const target = getRedirectTarget();

  if (target) {
    // توجيه للرابط المطلوب
    window.location.replace(target);
    return;
  }

  // توجيه للـ Home
  navigateTo(ROUTES.HOME);
}


/* ============================================================
   07 — إرسال النموذج
   ============================================================ */

/**
 * معالجة إرسال النموذج.
 * @param {Event} event
 */
async function handleSubmit(event) {
  if (event) event.preventDefault();

  // منع الإرسال المزدوج (بند 184)
  if (isSubmitting) return;

  // مسح الأخطاء القديمة
  clearFormErrors(loginForm);

  // قراءة القيم
  const code     = codeInput ? codeInput.value : "";
  const password = passwordInput ? passwordInput.value : "";

  // ==========================================================
  // المرحلة 1: التحقق في الفرونت
  // ==========================================================

  if (isFirstLoginMode) {
    // ---------- First Login ----------
    const fullName = fullNameInput ? fullNameInput.value : "";
    const stage    = stageSelect ? stageSelect.value : "";

    const { valid, errors } = validateFirstLoginForm({
      code,
      password,
      fullName,
      stage
    });

    if (!valid) {
      if (errors.code)     showErrorOnField("code", errors.code);
      if (errors.password) showErrorOnField("password", errors.password);
      if (errors.fullName) showErrorOnField("fullName", errors.fullName);
      if (errors.stage)    showErrorOnField("stage", errors.stage);

      // خطأ في الكود/كلمة المرور وهما مخفيان في الخطوة 2: نرجع للخطوة 1 ليراه الطالب
      if (errors.code || errors.password) {
        hideFirstLoginSection({ focus: errors.code ? "code" : "password" });
        return;
      }

      // ركّز على أول حقل فيه خطأ
      if (errors.code && codeInput) codeInput.focus();
      else if (errors.password && passwordInput) passwordInput.focus();
      else if (errors.fullName && fullNameInput) fullNameInput.focus();
      else if (errors.stage && stageSelect) stageSelect.focus();

      return;
    }

    // ---------- إرسال First Login ----------
    setSubmitting(true);

    const result = await firstLoginStudent({
      code: safeText(code),
      password: String(password),
      fullName: safeText(fullName),
      stage: safeText(stage)
    });

    setSubmitting(false);

    if (result && result.success) {
      showToast("تم تسجيل الدخول بنجاح", "success");
      // تأخير بسيط لعرض الـ Toast
      setTimeout(() => redirectAfterLogin(), 400);
      return;
    }

    // فشل
    handleWorkerError(result && result.error ? result.error : null);
    return;
  }

  // ==========================================================
  // المرحلة 2: Returning Login (الوضع العادي)
  // ==========================================================

  const { valid, errors } = validateLoginForm({ code, password });

  if (!valid) {
    if (errors.code)     showErrorOnField("code", errors.code);
    if (errors.password) showErrorOnField("password", errors.password);

    if (errors.code && codeInput) codeInput.focus();
    else if (errors.password && passwordInput) passwordInput.focus();

    return;
  }

  setSubmitting(true);

  const result = await loginStudent(safeText(code), String(password));

  setSubmitting(false);

  if (result && result.success) {
    showToast("تم تسجيل الدخول بنجاح", "success");
    setTimeout(() => redirectAfterLogin(), 400);
    return;
  }

  // فشل
  handleWorkerError(result && result.error ? result.error : null);
}


/* ============================================================
   08 — تنظيف الأخطاء عند الكتابة
   ============================================================ */

/**
 * عند الكتابة في حقل، نزيل رسالة الخطأ الخاصة به.
 */
function bindFieldCleanup() {
  const fields = [codeInput, passwordInput, fullNameInput, stageSelect];

  fields.forEach((field) => {
    if (!field) return;

    const eventName = field.tagName === "SELECT" ? "change" : "input";

    field.addEventListener(eventName, () => {
      clearFieldError(field);
    });
  });
}


/* ============================================================
   09 — التهيئة
   ============================================================ */

function init() {
  try { barai.fresh("login", ["first"]).then((ids) => { if (ids && ids.length) barai.notify("login.first", { commit: { group: "login", ids } }); }); } catch (e) { /* تجاهل */ }
  // 1) لو مسجّل بالفعل → توجيه
  requireGuest();

  // 2) تجميع العناصر
  cacheElements();

  // 3) لو الصفحة ناقصة عناصر أساسية، نوقف بهدوء
  if (!loginForm || !codeInput || !passwordInput || !submitBtn) {
    return;
  }

  // 4) ربط أحداث الإرسال
  loginForm.addEventListener("submit", handleSubmit);
  if (editCodeBtn) editCodeBtn.addEventListener("click", () => hideFirstLoginSection({ focus: "code" }));
  bindViewportWatch();
  bindAmbient();

  // 5) تنظيف الأخطاء عند الكتابة
  bindFieldCleanup();

  // 6) تركيز تلقائي على حقل الكود (تجربة أفضل)
  //    (لكن ليس على الموبايل حتى لا تُفتح لوحة المفاتيح تلقائيًا)
  const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (!isMobile && codeInput) {
    codeInput.focus();
  }
}


/* ============================================================
   09b — برعي الهادئ: يغطي عينيه عند الكتابة في كلمة المرور (بلا نص)
   ============================================================ */

function bindAmbient() {
  try {
    if (!passwordInput) return;
    barai.ambientMount("baraiAmbient", "wave");
    passwordInput.addEventListener("focus", () => barai.ambient("baraiAmbient", "cover"));
    passwordInput.addEventListener("blur", () => barai.ambient("baraiAmbient", "wave"));
  } catch (e) { /* تجميلي فقط */ }
}


/* ============================================================
   10 — التشغيل
   ============================================================ */

onReady(init);