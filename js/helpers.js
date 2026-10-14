/**
 * helpers.js
 * ------------------------------------------------------------
 * منصة أ/ إسماعيل عماد التعليمية
 * أدوات مساعدة عامة (بدون مكتبات خارجية).
 *
 * المكان: /js/helpers.js
 *
 * المرجع:
 *   - الوثيقة الأصلية (بنود 121، 124، 125، 126، 140، 160، 162)
 *   - Master Design System (بنود 36، 55)
 *
 * الاستخدام في أي صفحة:
 *   import { formatDate, showToast } from './js/helpers.js';
 * ------------------------------------------------------------
 */


/* ============================================================
   01 — التواريخ والأوقات
   المرجع: الوثيقة الأصلية — بند 140
   ============================================================ */

/**
 * تنسيق التاريخ بالعربية.
 * @param {Date|Object|number|string} value - التاريخ (Date / Firestore Timestamp / number / string)
 * @param {Object} options - خيارات إضافية
 * @returns {string} - التاريخ منسّق أو "" لو القيمة غير صحيحة
 */
export function formatDate(value, options = {}) {
  const date = toDate(value);
  if (!date) return "";

  const defaults = {
    year: "numeric",
    month: "long",
    day: "numeric"
  };

  try {
    return new Intl.DateTimeFormat("ar-EG", { ...defaults, ...options }).format(date);
  } catch (e) {
    return "";
  }
}

/**
 * تنسيق الوقت بالعربية.
 * @param {Date|Object|number|string} value
 * @returns {string}
 */
export function formatTime(value) {
  const date = toDate(value);
  if (!date) return "";

  try {
    return new Intl.DateTimeFormat("ar-EG", {
      hour: "2-digit",
      minute: "2-digit"
    }).format(date);
  } catch (e) {
    return "";
  }
}

/**
 * الوقت النسبي (قبل 5 دقائق، قبل ساعتين، ...).
 * @param {Date|Object|number|string} value
 * @returns {string}
 */
export function formatRelativeTime(value) {
  const date = toDate(value);
  if (!date) return "";

  const diff = Date.now() - date.getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours   = Math.floor(minutes / 60);
  const days    = Math.floor(hours / 24);

  if (seconds < 60) return "الآن";
  if (minutes < 60) return `قبل ${minutes} دقيقة`;
  if (hours   < 24) return `قبل ${hours} ساعة`;
  if (days    < 7)  return `قبل ${days} يوم`;

  return formatDate(date);
}

/**
 * تحويل أي قيمة تاريخ إلى Date (يدعم Firestore Timestamp).
 * @param {Date|Object|number|string} value
 * @returns {Date|null}
 */
export function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;

  // Firestore Timestamp
  if (typeof value.toDate === "function") {
    try {
      return value.toDate();
    } catch (e) {
      return null;
    }
  }

  // number (milliseconds)
  if (typeof value === "number") {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }

  // string
  if (typeof value === "string") {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }

  return null;
}


/* ============================================================
   02 — الأرقام
   ============================================================ */

/**
 * تنسيق الأرقام (فواصل الآلاف).
 * @param {number|string} value
 * @returns {string}
 */
export function formatNumber(value) {
  const num = Number(value);
  if (isNaN(num)) return "";
  return new Intl.NumberFormat("ar-EG").format(num);
}

/**
 * حصر رقم بين حدين.
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}


/* ============================================================
   03 — الحماية من XSS
   المرجع: الوثيقة الأصلية — بند 124
   القاعدة: أي نص قادم من المستخدم لا يتم إدخاله في HTML
   بطريقة تسمح بتنفيذ JavaScript.
   ============================================================ */

/**
 * تهريب الأحرف الخطرة في النص قبل إدخاله في HTML.
 * @param {string} text
 * @returns {string}
 */
export function escapeHTML(text) {
  if (text == null) return "";

  const str = String(text);
  const map = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  };

  return str.replace(/[&<>"']/g, (ch) => map[ch]);
}

/**
 * تنظيف النص من الفراغات الزائدة.
 * @param {string} text
 * @returns {string}
 */
export function safeText(text) {
  if (text == null) return "";
  return String(text).trim();
}


/* ============================================================
   04 — التحقق
   المرجع: الوثيقة الأصلية — بنود 125، 126
   ============================================================ */

/**
 * تحقق من صيغة البريد الإلكتروني.
 * @param {string} email
 * @returns {boolean}
 */
export function validateEmail(email) {
  if (!email) return false;
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(String(email).trim());
}

/**
 * تحقق من أن الرابط من نطاق YouTube.
 * المرجع: الوثيقة الأصلية — بند 125
 * @param {string} url
 * @returns {boolean}
 */
export function validateYouTubeURL(url) {
  return extractYouTubeID(url) !== null;
}

/**
 * استخراج معرّف فيديو YouTube من أي شكل من أشكال الروابط.
 * يدعم:
 *   - youtube.com/watch?v=ID
 *   - youtu.be/ID
 *   - youtube.com/embed/ID
 *   - youtube.com/shorts/ID
 * @param {string} url
 * @returns {string|null}
 */
export function extractYouTubeID(url) {
  if (!url) return null;

  try {
    const parsed = new URL(String(url).trim());
    const host = parsed.hostname.replace(/^www\./, "");

    // youtu.be/ID
    if (host === "youtu.be") {
      const id = parsed.pathname.slice(1).split("/")[0];
      return id || null;
    }

    // youtube.com/...
    if (host === "youtube.com" || host === "m.youtube.com") {
      // /watch?v=ID
      if (parsed.pathname === "/watch") {
        const id = parsed.searchParams.get("v");
        return id || null;
      }

      // /embed/ID أو /shorts/ID أو /v/ID
      const parts = parsed.pathname.split("/").filter(Boolean);
      if (parts.length >= 2 && ["embed", "shorts", "v"].includes(parts[0])) {
        return parts[1] || null;
      }
    }

    return null;
  } catch (e) {
    return null;
  }
}


/* ============================================================
   05 — الأدوات العامة
   ============================================================ */

/**
 * تأخير استدعاء الدالة حتى يتوقف المستخدم عن الكتابة.
 * تُستخدم في البحث (الوثيقة الأصلية — بند 162).
 * @param {Function} fn
 * @param {number} wait - مدة الانتظار بالميلي ثانية
 * @returns {Function}
 */
export function debounce(fn, wait = 300) {
  let timeoutId = null;

  return function (...args) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn.apply(this, args), wait);
  };
}

/**
 * انتظار تحميل الصفحة.
 * @param {Function} callback
 */
export function onReady(callback) {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", callback);
  } else {
    callback();
  }
}

/**
 * انتقاء آمن لعنصر من الصفحة.
 * @param {string} selector
 * @returns {Element|null}
 */
export function safeQuerySelector(selector) {
  try {
    return document.querySelector(selector);
  } catch (e) {
    return null;
  }
}

/**
 * أول حرف من كل كلمة في الاسم (للأفاتار).
 * @param {string} name
 * @param {number} max - عدد الحروف
 * @returns {string}
 */
export function getInitials(name, max = 2) {
  if (!name) return "";
  const parts = String(name).trim().split(/\s+/).slice(0, max);
  return parts.map((p) => p[0]).join("").toUpperCase();
}


/* ============================================================
   06 — Toast
   المرجع: الوثيقة الأصلية — بند 160
   القاعدة: رسائل مختصرة + مفهومة + بدون تفاصيل تقنية.
   ============================================================ */

/**
 * عرض Toast على الشاشة.
 * @param {string} message
 * @param {string} type - "success" | "error" | "warning" | "info"
 * @param {number} duration - مدة العرض بالميلي ثانية
 */
export function showToast(message, type = "info", duration = 3000) {
  if (!message) return;

  // احصل على أو أنشئ حاوية الـ Toast
  let container = document.querySelector(".toast-container");
  if (!container) {
    container = document.createElement("div");
    container.className = "toast-container";
    document.body.appendChild(container);
  }

  // أنشئ عنصر الـ Toast
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = String(message);

  container.appendChild(toast);

  // إظهار بحركة
  requestAnimationFrame(() => {
    toast.classList.add("is-visible");
  });

  // إخفاء بعد المدة
  setTimeout(() => {
    toast.classList.remove("is-visible");
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, duration);
}