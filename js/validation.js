/**
 * validation.js
 * ------------------------------------------------------------
 * منصة أ/ إسماعيل عماد التعليمية
 * التحقق من صحة النماذج في الفرونت (UX فقط).
 *
 * المكان: /js/validation.js
 *
 * المرجع:
 *   - الوثيقة الأصلية (بنود 121، 126، 173)
 *   - Master Design System (بنود 33، 55، 62)
 *
 * ⚠️ تحذير أساسي (بند 126):
 *   - هذا التحقق للـ UX فقط، وليس للحماية.
 *   - الحماية الحقيقية في Worker (بند 109) + Firestore Rules (بند 108).
 *   - أي قاعدة هنا يجب أن تكون موجودة في Worker أيضًا.
 *
 * الاستخدام:
 *   import { validateLoginForm, showFieldError }
 *     from './js/validation.js';
 *
 *   const { valid, errors } = validateLoginForm({ code, password });
 *   if (!valid) { ... }
 * ------------------------------------------------------------
 */

import { safeText, validateEmail, validateYouTubeURL } from "./helpers.js";


/* ============================================================
   01 — Helpers: عرض وإخفاء أخطاء الحقول
   المرجع: الوثيقة الأصلية — بند 121
   ============================================================ */

/**
 * عرض رسالة خطأ أسفل الحقل.
 * @param {HTMLElement|string} input
 * @param {string} message
 */
export function showFieldError(input, message) {
  const field = typeof input === "string" ? document.querySelector(input) : input;
  if (!field) return;

  field.classList.add("is-error");

  // البحث عن عنصر الخطأ التابع
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
 * إخفاء رسالة الخطأ من حقل.
 * @param {HTMLElement|string} input
 */
export function clearFieldError(input) {
  const field = typeof input === "string" ? document.querySelector(input) : input;
  if (!field) return;

  field.classList.remove("is-error");

  const group = field.closest(".form-group") || field.parentElement;
  if (!group) return;

  const errorEl = group.querySelector(".form-error");
  if (errorEl) errorEl.remove();
}

/**
 * إخفاء كل أخطاء النموذج.
 * @param {HTMLElement|string} form
 */
export function clearFormErrors(form) {
  const formEl = typeof form === "string" ? document.querySelector(form) : form;
  if (!formEl) return;

  formEl.querySelectorAll(".is-error").forEach((el) => el.classList.remove("is-error"));
  formEl.querySelectorAll(".form-error").forEach((el) => el.remove());
}

/**
 * هل النموذج صالح (بدون أخطاء)؟
 * @param {Object} errors
 * @returns {boolean}
 */
export function isFormValid(errors) {
  if (!errors || typeof errors !== "object") return true;
  return Object.keys(errors).length === 0;
}


/* ============================================================
   02 — Validators مساعدة (Helpers)
   ============================================================ */

/**
 * التحقق من صيغة الكود.
 * القاعدة: غير فارغ، بدون فراغات (يقبل الأرقام).
 * @param {string} code
 * @returns {boolean}
 */
export function isValidCodeFormat(code) {
  return /^\d{5}$/.test(latinDigits(safeText(code)));
}

/**
 * التحقق من صيغة كلمة المرور.
 * القاعدة: غير فارغة (تقبل الأرقام).
 * @param {string} password
 * @returns {boolean}
 */
export function isValidPasswordFormat(password) {
  const p = latinDigits(password == null ? "" : String(password));
  return /^\d{6}$/.test(p);
}

/** يحوّل الأرقام العربية إلى لاتينية قبل الفحص */
function latinDigits(v) {
  return String(v)
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06F0));
}


/* ============================================================
   03 — Login Form (Returning)
   المرجع: الوثيقة الأصلية — بند 19
   ============================================================ */

/**
 * التحقق من نموذج تسجيل الدخول (Returning Login).
 * @param {Object} data
 * @param {string} data.code
 * @param {string} data.password
 * @returns {{valid:boolean, errors:Object}}
 */
export function validateLoginForm({ code = "", password = "" } = {}) {
  const errors = {};

  const cleanCode = safeText(code);
  const cleanPass = password == null ? "" : String(password);

  if (!cleanCode) {
    errors.code = "من فضلك أدخل الكود.";
  } else if (!isValidCodeFormat(cleanCode)) {
    errors.code = "الكود يجب أن يكون 5 أرقام.";
  }

  if (!cleanPass) {
    errors.password = "من فضلك أدخل كلمة المرور.";
  } else if (!isValidPasswordFormat(cleanPass)) {
    errors.password = "كلمة المرور يجب أن تكون 6 أرقام.";
  }

  return { valid: Object.keys(errors).length === 0, errors };
}


/* ============================================================
   04 — First Login Form
   المرجع: الوثيقة الأصلية — بند 18
   ============================================================ */

/**
 * التحقق من نموذج تسجيل الدخول الأول.
 * @param {Object} data
 * @param {string} data.code
 * @param {string} data.password
 * @param {string} data.fullName
 * @param {string} data.stage
 * @returns {{valid:boolean, errors:Object}}
 */
export function validateFirstLoginForm({
  code = "",
  password = "",
  fullName = "",
  stage = ""
} = {}) {
  const errors = {};

  const cleanCode = safeText(code);
  const cleanPass = password == null ? "" : String(password);
  const cleanName = safeText(fullName);
  const cleanStage = safeText(stage);

  if (!cleanCode) {
    errors.code = "من فضلك أدخل الكود.";
  } else if (!isValidCodeFormat(cleanCode)) {
    errors.code = "الكود يجب أن يكون 5 أرقام.";
  }

  if (!cleanPass) {
    errors.password = "من فضلك أدخل كلمة المرور.";
  } else if (!isValidPasswordFormat(cleanPass)) {
    errors.password = "كلمة المرور يجب أن تكون 6 أرقام.";
  }

  if (!cleanName) {
    errors.fullName = "من فضلك أدخل الاسم الكامل.";
  } else if (cleanName.length < 3) {
    errors.fullName = "الاسم قصير جدًا.";
  } else if (cleanName.length > 100) {
    errors.fullName = "الاسم طويل جدًا.";
  }

  if (!cleanStage) {
    errors.stage = "من فضلك اختر المرحلة الدراسية.";
  }

  return { valid: Object.keys(errors).length === 0, errors };
}


/* ============================================================
   05 — Subscription Form
   المرجع: الوثيقة الأصلية — بنود 20، 21، 22، 23، 86
   ⚠️ الحقول النهائية محددة في بند 86، لكن قابلة للتوسع.
   ============================================================ */

/**
 * التحقق من نموذج طلب الاشتراك.
 * @param {Object} data
 * @param {string} data.stage
 * @param {string} data.lessonGroupId
 * @param {Object} [data.studentInformation]
 * @returns {{valid:boolean, errors:Object}}
 */
export function validateSubscriptionForm({
  stage = "",
  lessonGroupId = "",
  studentInformation = {}
} = {}) {
  const errors = {};

  const cleanStage = safeText(stage);
  const cleanGroup = safeText(lessonGroupId);

  if (!cleanStage) {
    errors.stage = "من فضلك اختر المرحلة الدراسية.";
  }

  if (!cleanGroup) {
    errors.lessonGroupId = "من فضلك اختر مجموعة الدرس.";
  }

  // التحقق من المعلومات الشخصية إن وُجدت
  const info = studentInformation && typeof studentInformation === "object"
    ? studentInformation
    : {};

  const fullName = safeText(info.fullName);
  if (!fullName) {
    errors.fullName = "من فضلك أدخل الاسم الكامل.";
  } else if (fullName.length < 3) {
    errors.fullName = "الاسم قصير جدًا.";
  }

  const phone = safeText(info.phone);
  if (phone) {
    // لو موجود، تحقق من الصيغة
    if (!/^[0-9+\-\s]{6,20}$/.test(phone)) {
      errors.phone = "رقم الهاتف غير صحيح.";
    }
  }

  const email = safeText(info.email);
  if (email && !validateEmail(email)) {
    errors.email = "البريد الإلكتروني غير صحيح.";
  }

  return { valid: Object.keys(errors).length === 0, errors };
}


/* ============================================================
   06 — Task Form (Planner)
   المرجع: الوثيقة الأصلية — بنود 51، 52
   ============================================================ */

/**
 * التحقق من نموذج إضافة/تعديل مهمة.
 * @param {Object} data
 * @param {string} data.title
 * @param {string} data.day
 * @param {string} data.time
 * @param {string} [data.subject]
 * @returns {{valid:boolean, errors:Object}}
 */
export function validateTaskForm({ title = "", day = "", time = "", subject = "" } = {}) {
  const errors = {};

  const cleanTitle = safeText(title);
  const cleanDay   = safeText(day);
  const cleanTime  = safeText(time);
  const cleanSubj  = safeText(subject);

  if (!cleanTitle) {
    errors.title = "من فضلك اكتب اسم المهمة.";
  } else if (cleanTitle.length > 120) {
    errors.title = "اسم المهمة طويل جدًا.";
  }

  if (!cleanDay) {
    errors.day = "من فضلك اختر اليوم.";
  }

  if (!cleanTime) {
    errors.time = "من فضلك اختر الوقت.";
  } else if (!/^\d{1,2}:\d{2}/.test(cleanTime)) {
    errors.time = "صيغة الوقت غير صحيحة.";
  }

  if (cleanSubj && cleanSubj.length > 60) {
    errors.subject = "اسم المادة طويل جدًا.";
  }

  return { valid: Object.keys(errors).length === 0, errors };
}


/* ============================================================
   07 — Announcement Reply Form
   المرجع: الوثيقة الأصلية — بند 30
   ============================================================ */

/**
 * التحقق من نموذج الرد على إعلان.
 * @param {Object} data
 * @param {string} data.message
 * @returns {{valid:boolean, errors:Object}}
 */
export function validateAnnouncementReply({ message = "" } = {}) {
  const errors = {};
  const cleanMsg = safeText(message);

  if (!cleanMsg) {
    errors.message = "لا يمكن إرسال رد فارغ.";
  } else if (cleanMsg.length < 2) {
    errors.message = "الرد قصير جدًا.";
  } else if (cleanMsg.length > 2000) {
    errors.message = "الرد طويل جدًا.";
  }

  return { valid: Object.keys(errors).length === 0, errors };
}


/* ============================================================
   08 — Exam Answer Validation
   المرجع: الوثيقة الأصلية — بنود 38، 39، 40
   ============================================================ */

/**
 * التحقق من إجابات الاختبار قبل الإرسال.
 * @param {Object} data
 * @param {Array<number|null>} data.answers - إجابة لكل سؤال
 * @param {number} data.questionsCount
 * @returns {{valid:boolean, errors:Object, unanswered:Array<number>}}
 */
export function validateExamAnswer({ answers = [], questionsCount = 0 } = {}) {
  const errors = {};
  const unanswered = [];

  if (!Array.isArray(answers)) {
    errors.answers = "بيانات الإجابات غير صحيحة.";
    return { valid: false, errors, unanswered };
  }

  if (questionsCount <= 0) {
    errors.answers = "عدد الأسئلة غير صحيح.";
    return { valid: false, errors, unanswered };
  }

  for (let i = 0; i < questionsCount; i++) {
    const a = answers[i];
    if (a === null || a === undefined || a === "") {
      unanswered.push(i + 1);
    }
  }

  if (unanswered.length > 0) {
    errors.answers = `لم تجب على ${unanswered.length} سؤال.`;
  }

  return { valid: unanswered.length === 0, errors, unanswered };
}


/* ============================================================
   09 — Lesson Form (Admin)
   المرجع: الوثيقة الأصلية — بنود 80، 81، 98، 125
   ============================================================ */

/**
 * التحقق من نموذج درس (يستخدم في لوحة الإدارة).
 * @param {Object} data
 * @param {string} data.title
 * @param {"video"|"audio"} data.kind
 * @param {string} data.youtubeUrl
 * @param {string} data.stage
 * @returns {{valid:boolean, errors:Object}}
 */
export function validateLessonForm({
  title = "",
  kind = "",
  youtubeUrl = "",
  stage = ""
} = {}) {
  const errors = {};

  const cleanTitle = safeText(title);
  const cleanKind  = safeText(kind);
  const cleanUrl   = safeText(youtubeUrl);
  const cleanStage = safeText(stage);

  if (!cleanTitle) {
    errors.title = "من فضلك أدخل عنوان الدرس.";
  } else if (cleanTitle.length > 150) {
    errors.title = "العنوان طويل جدًا.";
  }

  if (!cleanKind) {
    errors.kind = "من فضلك اختر نوع الدرس.";
  } else if (!["video", "audio"].includes(cleanKind)) {
    errors.kind = "نوع الدرس غير صحيح.";
  }

  if (!cleanUrl) {
    errors.youtubeUrl = "من فضلك أدخل رابط الفيديو/الصوت.";
  } else if (!validateYouTubeURL(cleanUrl)) {
    errors.youtubeUrl = "الرابط ليس رابط YouTube صحيحًا.";
  }

  if (!cleanStage) {
    errors.stage = "من فضلك اختر المرحلة.";
  }

  return { valid: Object.keys(errors).length === 0, errors };
}


/* ============================================================
   10 — Exam Form (Admin)
   المرجع: الوثيقة الأصلية — بنود 82، 83، 99، 100
   ============================================================ */

/**
 * التحقق من نموذج اختبار (يستخدم في لوحة الإدارة).
 * @param {Object} data
 * @param {string} data.title
 * @param {string} data.stage
 * @param {Array<Object>} data.questions
 * @param {"immediate"|"after_duration"|"after_datetime"} data.resultPolicy
 * @param {*} data.resultTime
 * @returns {{valid:boolean, errors:Object}}
 */
export function validateExamForm({
  title = "",
  stage = "",
  questions = [],
  resultPolicy = "",
  resultTime = null
} = {}) {
  const errors = {};

  const cleanTitle = safeText(title);
  const cleanStage = safeText(stage);
  const cleanPolicy = safeText(resultPolicy);

  if (!cleanTitle) {
    errors.title = "من فضلك أدخل عنوان الاختبار.";
  } else if (cleanTitle.length > 150) {
    errors.title = "العنوان طويل جدًا.";
  }

  if (!cleanStage) {
    errors.stage = "من فضلك اختر المرحلة.";
  }

  if (!Array.isArray(questions) || questions.length < 1) {
    errors.questions = "يجب إضافة سؤال واحد على الأقل.";
  } else {
    const questionErrors = [];

    questions.forEach((q, i) => {
      const qIndex = i + 1;

      if (!safeText(q?.text)) {
        questionErrors.push(`السؤال ${qIndex}: نص السؤال ناقص.`);
        return;
      }

      if (!Array.isArray(q.choices) || q.choices.length < 3) {
        questionErrors.push(`السؤال ${qIndex}: يجب أن يحتوي 3 اختيارات على الأقل.`);
        return;
      }

      // التحقق من عدم وجود اختيارات فارغة
      const hasEmpty = q.choices.some((c) => !safeText(c));
      if (hasEmpty) {
        questionErrors.push(`السؤال ${qIndex}: يوجد اختيار فارغ.`);
        return;
      }

      // التحقق من وجود إجابة صحيحة
      const ci = Number(q.correctIndex);
      if (isNaN(ci) || ci < 0 || ci >= q.choices.length) {
        questionErrors.push(`السؤال ${qIndex}: الإجابة الصحيحة غير محددة.`);
      }
    });

    if (questionErrors.length > 0) {
      errors.questions = questionErrors[0]; // أول خطأ فقط للعرض
    }
  }

  if (!cleanPolicy) {
    errors.resultPolicy = "من فضلك اختر سياسة ظهور النتيجة.";
  } else if (!["immediate", "after_duration", "after_datetime"].includes(cleanPolicy)) {
    errors.resultPolicy = "سياسة النتيجة غير صحيحة.";
  } else if (cleanPolicy !== "immediate" && !resultTime) {
    errors.resultTime = "من فضلك حدد موعد ظهور النتيجة.";
  }

  return { valid: Object.keys(errors).length === 0, errors };
}


/* ============================================================
   11 — Announcement Form (Admin)
   المرجع: الوثيقة الأصلية — بنود 26، 27، 28، 29، 96
   ============================================================ */

/**
 * التحقق من نموذج إعلان (يستخدم في لوحة الإدارة).
 * @param {Object} data
 * @param {string} data.title
 * @param {string} data.body
 * @param {"all"|"stage"|"student"} data.targetType
 * @param {string} [data.targetValue]
 * @param {"text"|"internal_link"|"external_link"} data.type
 * @param {string} [data.linkTarget]
 * @returns {{valid:boolean, errors:Object}}
 */
export function validateAnnouncementForm({
  title = "",
  body = "",
  targetType = "",
  targetValue = "",
  type = "text",
  linkTarget = ""
} = {}) {
  const errors = {};

  const cleanTitle = safeText(title);
  const cleanBody  = safeText(body);
  const cleanTarget = safeText(targetType);
  const cleanTargetValue = safeText(targetValue);
  const cleanType = safeText(type);
  const cleanLink = safeText(linkTarget);

  if (!cleanTitle) {
    errors.title = "من فضلك أدخل عنوان الإعلان.";
  } else if (cleanTitle.length > 150) {
    errors.title = "العنوان طويل جدًا.";
  }

  if (!cleanBody) {
    errors.body = "من فضلك أدخل نص الإعلان.";
  } else if (cleanBody.length > 5000) {
    errors.body = "النص طويل جدًا.";
  }

  if (!cleanTarget) {
    errors.targetType = "من فضلك اختر جمهور الإعلان.";
  } else if (!["all", "stage", "student"].includes(cleanTarget)) {
    errors.targetType = "نوع الجمهور غير صحيح.";
  } else if (cleanTarget !== "all" && !cleanTargetValue) {
    errors.targetValue = "من فضلك اختر القيمة المستهدفة.";
  }

  if (!cleanType) {
    errors.type = "من فضلك اختر نوع الإعلان.";
  } else if (!["text", "internal_link", "external_link"].includes(cleanType)) {
    errors.type = "نوع الإعلان غير صحيح.";
  } else if (cleanType !== "text" && !cleanLink) {
    errors.linkTarget = "من فضلك أدخل الرابط.";
  } else if (cleanType === "internal_link" && cleanLink) {
    // منع الروابط الخارجية في الروابط الداخلية
    if (/^https?:\/\//i.test(cleanLink)) {
      errors.linkTarget = "الرابط الداخلي يجب ألا يبدأ بـ http:// أو https://.";
    }
  } else if (cleanType === "external_link" && cleanLink) {
    // يجب أن يكون رابطًا صحيحًا
    if (!/^https?:\/\//i.test(cleanLink)) {
      errors.linkTarget = "الرابط الخارجي يجب أن يبدأ بـ http:// أو https://.";
    }
  }

  return { valid: Object.keys(errors).length === 0, errors };
}