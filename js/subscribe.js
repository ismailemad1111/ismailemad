/**
 * subscribe.js
 * ------------------------------------------------------------
 * منصة أ/ إسماعيل عماد التعليمية
 * تشغيل صفحة subscribe.html
 *
 * المكان: /js/subscribe.js
 *
 * المرجع:
 *   - الوثيقة الأصلية (بنود 20، 21، 22، 23، 24، 86، 87، 137، 204)
 *   - Master Design System (بنود 33، 34، 36، 43، 55)
 *
 * ⚠️ قواعد:
 *   - كل التحقق الحقيقي في Worker.
 *   - التحقق هنا للـ UX فقط.
 *   - lessonGroups تُحمَّل من Worker حسب المرحلة.
 *
 * ⚠️ حالة الملف:
 *   - WORKER_URL = PLACEHOLDER_WORKER_URL (البند 207).
 *   - الدوال سترجع NETWORK_ERROR حتى بناء الـ Worker.
 *   - هذا سلوك متوقع ومقصود.
 *
 * ⚠️ ملاحظة تقنية:
 *   - الـ Endpointين (lesson-groups + subscription-requests)
 *     سينتقلان إلى api.js في مرحلة لاحقة.
 *   - الآن نستدعيهما مباشرة للحفاظ على وحدة كل ملف.
 * ------------------------------------------------------------
 */

import { onReady, safeText, showToast } from "./helpers.js";
import { requireGuest, ROUTES } from "./router.js";


/* ============================================================
   01 — ثوابت
   ============================================================ */

const REQUEST_TIMEOUT_MS = 15000;

/** أكواد الأخطاء المتوقعة */
const ERRORS = {
  NETWORK_ERROR: "NETWORK_ERROR",
  TIMEOUT:       "TIMEOUT",
  SERVER_ERROR:  "SERVER_ERROR",
  BAD_REQUEST:   "BAD_REQUEST"
};

/** رسائل عربية موحدة */
const ERROR_MESSAGES = {
  NETWORK_ERROR: "لا يوجد اتصال بالإنترنت. حاول مرة أخرى.",
  TIMEOUT:       "انتهت مدة الطلب. حاول مرة أخرى.",
  SERVER_ERROR:  "حدث خطأ. حاول مرة أخرى.",
  BAD_REQUEST:   "بيانات غير مكتملة."
};


/* ============================================================
   02 — المرجع للعناصر
   ============================================================ */

let subscribePage       = null;
let subscribeForm       = null;
let subscribeCard       = null;
let subscribeSuccess    = null;
let stageSelect         = null;
let groupSelect         = null;
let groupsHint          = null;
let fullNameInput       = null;
let phoneInput          = null;
let submitBtn           = null;

/** حالة الإرسال — لمنع الإرسال المزدوج */
let isSubmitting = false;

/** حالة تحميل المجموعات */
let isLoadingGroups = false;


/* ============================================================
   03 — طلب HTTP موحد (مؤقت — سيُدمج في api.js لاحقًا)
   ============================================================ */

/**
 * إرسال طلب إلى الـ Worker.
 * @param {string} endpoint
 * @param {Object} options
 * @returns {Promise<Object>}
 */
import { backendRequest } from "./backend/index.js";
async function workerFetch(endpoint, options = {}) {
  // بدون Worker: التنفيذ داخل المتصفح عبر Firestore (js/backend/)
  return backendRequest(endpoint, options);
}


/* ============================================================
   04 — تجميع العناصر
   ============================================================ */

function cacheElements() {
  subscribePage    = document.getElementById("subscribePage");
  subscribeForm    = document.getElementById("subscribeForm");
  subscribeCard    = document.getElementById("subscribeCard");
  subscribeSuccess = document.getElementById("subscribeSuccess");
  stageSelect      = document.getElementById("stageSelect");
  groupSelect      = document.getElementById("groupSelect");
  groupsHint       = document.getElementById("groupsHint");
  fullNameInput    = document.getElementById("fullNameInput");
  phoneInput       = document.getElementById("phoneInput");
  submitBtn        = document.getElementById("subscribeSubmitBtn");
}


/* ============================================================
   05 — إدارة حالة قائمة المجموعات
   المرجع: الوثيقة الأصلية — بند 22
   ============================================================ */

/**
 * إعادة ضبط قائمة المجموعات.
 * @param {string} hintText
 * @param {boolean} isError
 */
function resetGroupsSelect(hintText = "اختر المرحلة لعرض مجموعات الدرس المتاحة.", isError = false) {
  if (!groupSelect) return;

  groupSelect.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "اختر المرحلة أولًا";
  groupSelect.appendChild(placeholder);

  groupSelect.disabled = true;
  groupSelect.value = "";

  if (groupsHint) {
    groupsHint.textContent = hintText;
    groupsHint.classList.toggle("is-error", !!isError);
  }
}

/**
 * عرض مجموعات الدرس في القائمة.
 * @param {Array<{id:string,name:string}>} groups
 */
function renderGroupsOptions(groups) {
  if (!groupSelect) return;

  groupSelect.innerHTML = "";

  if (!Array.isArray(groups) || groups.length === 0) {
    // لا توجد مجموعات لهذه المرحلة (بند 22)
    resetGroupsSelect("لا توجد مجموعات متاحة حاليًا لهذه المرحلة.", false);
    return;
  }

  // Placeholder
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "اختر مجموعة الدرس";
  groupSelect.appendChild(placeholder);

  // المجموعات
  groups.forEach((g) => {
    const name = safeText(g && g.name);
    const id   = safeText(g && g.id);
    if (!id || !name) return;

    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = name;
    groupSelect.appendChild(opt);
  });

  groupSelect.disabled = false;

  if (groupsHint) {
    groupsHint.textContent = "اختر مجموعة الدرس المناسبة.";
    groupsHint.classList.remove("is-error");
  }
}

/**
 * تحميل مجموعات الدرس حسب المرحلة.
 * @param {string} stage
 */
async function loadLessonGroups(stage) {
  const cleanStage = safeText(stage);

  if (!cleanStage) {
    resetGroupsSelect();
    return;
  }

  if (isLoadingGroups) return;
  isLoadingGroups = true;

  resetGroupsSelect("جارٍ تحميل مجموعات الدرس...", false);

  const result = await workerFetch(
    `/api/lesson-groups?stage=${encodeURIComponent(cleanStage)}`
  );

  isLoadingGroups = false;

  if (!result || !result.success) {
    const code = result && result.error ? result.error.code : ERRORS.SERVER_ERROR;
    const message = (result && result.error && result.error.message)
      || ERROR_MESSAGES[code]
      || ERROR_MESSAGES.SERVER_ERROR;

    resetGroupsSelect("تعذر تحميل المجموعات. حاول مرة أخرى.", true);
    showToast(message, "error");
    return;
  }

  const groups = (result.data && Array.isArray(result.data.groups))
    ? result.data.groups
    : [];

  renderGroupsOptions(groups);
}


/* ============================================================
   06 — إدارة حالة زر الإرسال
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
   07 — التحقق من النموذج (Frontend UX)
   المرجع: الوثيقة الأصلية — بند 23 + بند 126
   ============================================================ */

/**
 * التحقق من النموذج قبل الإرسال.
 * @returns {{valid:boolean, errors:Object}}
 */
function validateForm() {
  const errors = {};

  const stage    = stageSelect ? safeText(stageSelect.value) : "";
  const groupId  = groupSelect ? safeText(groupSelect.value) : "";
  const fullName = fullNameInput ? safeText(fullNameInput.value) : "";
  const phone    = phoneInput ? safeText(phoneInput.value) : "";

  if (!stage) {
    errors.stage = "من فضلك اختر المرحلة الدراسية.";
  }

  if (!groupId) {
    errors.lessonGroupId = "من فضلك اختر مجموعة الدرس.";
  }

  if (!fullName) {
    errors.fullName = "من فضلك أدخل الاسم الكامل.";
  } else if (fullName.length < 3) {
    errors.fullName = "الاسم قصير جدًا.";
  } else if (fullName.length > 100) {
    errors.fullName = "الاسم طويل جدًا.";
  }

  if (!phone) {
    errors.phone = "من فضلك أدخل رقم الهاتف.";
  } else if (!/^[0-9+\-\s]{6,20}$/.test(phone)) {
    errors.phone = "رقم الهاتف غير صحيح.";
  }

  return { valid: Object.keys(errors).length === 0, errors };
}

/**
 * عرض خطأ تحت حقل معيّن.
 * @param {HTMLElement} field
 * @param {string} message
 */
function showFieldError(field, message) {
  if (!field) return;

  field.classList.add("is-error");

  const group = field.closest(".form-group") || field.parentElement;
  if (!group) return;

  let errorEl = group.querySelector(".form-error");
  if (!errorEl) {
    errorEl = document.createElement("span");
    errorEl.className = "form-error";
    group.appendChild(errorEl);
  }

  errorEl.textContent = String(message || "");
}

/**
 * إزالة خطأ الحقل.
 * @param {HTMLElement} field
 */
function clearFieldError(field) {
  if (!field) return;

  field.classList.remove("is-error");

  const group = field.closest(".form-group") || field.parentElement;
  if (!group) return;

  const errorEl = group.querySelector(".form-error");
  if (errorEl) errorEl.remove();
}

/**
 * إزالة كل الأخطاء.
 */
function clearAllErrors() {
  [stageSelect, groupSelect, fullNameInput, phoneInput].forEach((f) => {
    if (f) clearFieldError(f);
  });
}


/* ============================================================
   08 — إرسال الطلب
   المرجع: الوثيقة الأصلية — بنود 23، 24، 137
   ============================================================ */

/**
 * معالجة إرسال النموذج.
 * @param {Event} event
 */
async function handleSubmit(event) {
  if (event) event.preventDefault();

  if (isSubmitting) return;

  clearAllErrors();

  // التحقق في الفرونت
  const { valid, errors } = validateForm();

  if (!valid) {
    if (errors.stage)         showFieldError(stageSelect, errors.stage);
    if (errors.lessonGroupId) showFieldError(groupSelect, errors.lessonGroupId);
    if (errors.fullName)      showFieldError(fullNameInput, errors.fullName);
    if (errors.phone)         showFieldError(phoneInput, errors.phone);

    // التركيز على أول حقل فيه خطأ
    if (errors.stage && stageSelect) stageSelect.focus();
    else if (errors.lessonGroupId && groupSelect) groupSelect.focus();
    else if (errors.fullName && fullNameInput) fullNameInput.focus();
    else if (errors.phone && phoneInput) phoneInput.focus();

    return;
  }

  // البيانات النهائية
  const payload = {
    stage: safeText(stageSelect.value),
    lessonGroupId: safeText(groupSelect.value),
    studentInformation: {
      fullName: safeText(fullNameInput.value),
      phone: safeText(phoneInput.value)
    }
  };

  setSubmitting(true);

  const result = await workerFetch("/api/subscription-requests", {
    method: "POST",
    body: payload
  });

  setSubmitting(false);

  if (result && result.success) {
    showSuccessState();
    return;
  }

  const code = result && result.error ? result.error.code : ERRORS.SERVER_ERROR;
  const message = (result && result.error && result.error.message)
    || ERROR_MESSAGES[code]
    || ERROR_MESSAGES.SERVER_ERROR;

  showToast(message, "error");
}


/* ============================================================
   09 — شاشة النجاح
   المرجع: الوثيقة الأصلية — بند 23 (Request Created)
   ============================================================ */

/**
 * إخفاء النموذج وإظهار شاشة النجاح.
 */
function showSuccessState() {
  if (subscribeCard) {
    subscribeCard.style.display = "none";
  }

  if (subscribeSuccess) {
    subscribeSuccess.classList.add("is-visible");
    subscribeSuccess.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  showToast("تم إرسال طلبك بنجاح", "success");
}


/* ============================================================
   10 — ربط الأحداث
   ============================================================ */

function bindEvents() {
  // تغيير المرحلة → تحميل المجموعات
  if (stageSelect) {
    stageSelect.addEventListener("change", () => {
      clearFieldError(stageSelect);
      loadLessonGroups(stageSelect.value);
    });
  }

  // اختيار مجموعة → إزالة خطأ الحقل
  if (groupSelect) {
    groupSelect.addEventListener("change", () => {
      clearFieldError(groupSelect);
    });
  }

  // الكتابة في الحقول → إزالة الأخطاء
  [fullNameInput, phoneInput].forEach((field) => {
    if (!field) return;
    field.addEventListener("input", () => clearFieldError(field));
  });

  // إرسال النموذج
  if (subscribeForm) {
    subscribeForm.addEventListener("submit", handleSubmit);
  }
}


/* ============================================================
   11 — التهيئة
   ============================================================ */

function init() {
  // منع الدخول لطالب مسجّل بالفعل (مش محتاج يشترك)
  requireGuest();

  cacheElements();

  // لو العناصر الأساسية مش موجودة → نوقف بهدوء
  if (!subscribeForm || !stageSelect || !groupSelect || !submitBtn) {
    return;
  }

  // إعادة ضبط قائمة المجموعات في البداية
  resetGroupsSelect();

  bindEvents();
}


/* ============================================================
   12 — التشغيل
   ============================================================ */

onReady(init);