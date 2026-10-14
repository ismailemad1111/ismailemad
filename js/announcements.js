/**
 * announcements.js
 * ------------------------------------------------------------
 * منصة أ/ إسماعيل عماد التعليمية
 * تشغيل صفحة announcements.html
 *
 * المكان: /js/announcements.js
 *
 * المرجع:
 *   - الوثيقة الأصلية (بنود 25، 26، 27، 28، 29، 30، 79، 124، 148، 160)
 *   - Master Design System (بنود 15، 16، 17، 33، 34، 35، 36، 42، 55)
 *
 * ⚠️ قواعد:
 *   - كل نص من المستخدم يمر عبر escapeHTML (بند 124).
 *   - الرد لا يظهر إلا للمعلم/الإدارة (بند 30).
 *   - التحقق الحقيقي في Worker.
 *
 * ⚠️ حالة الملف:
 *   - WORKER_URL = PLACEHOLDER_WORKER_URL (البند 207).
 *   - getAnnouncements سترجع NETWORK_ERROR حتى بناء الـ Worker.
 *   - سيظهر Error State مع زر إعادة المحاولة.
 * ------------------------------------------------------------
 */

import {
  onReady,
  safeText,
  showToast,
  formatRelativeTime,
  escapeHTML
} from "./helpers.js";

import { requireStudent } from "./router.js";

import {
  getAnnouncements,
  markAnnouncementRead,
  replyToAnnouncement
} from "./api.js";

import { renderBottomNav } from "./components.js";

import { validateAnnouncementReply } from "./validation.js";


import { barai } from "./barai/safe.js";

/* ============================================================
   01 — المرجع للعناصر
   ============================================================ */

// Header
let subtitleEl         = null;

// States
let skeletonEl         = null;
let listEl             = null;
let emptyEl            = null;
let errorEl            = null;
let retryBtn           = null;

// Bottom Nav
let bottomNavSlot      = null;

// Reply Sheet
let replyOverlay       = null;
let replySheet         = null;
let replyCloseBtn      = null;
let replyCancelBtn     = null;
let replySendBtn       = null;
let replyTextarea      = null;
let replyErrorEl       = null;


/* ============================================================
   02 — الحالة
   ============================================================ */

/** الإعلانات الحالية */
let announcements = [];

/** الإعلان الذي نرد عليه حاليًا */
let currentReplyAnnouncementId = null;

/** حالة الإرسال */
let isSendingReply = false;


/* ============================================================
   03 — تجميع العناصر
   ============================================================ */

function cacheElements() {
  subtitleEl     = document.getElementById("annSubtitle");

  skeletonEl     = document.getElementById("annSkeleton");
  listEl         = document.getElementById("annList");
  emptyEl        = document.getElementById("annEmpty");
  errorEl        = document.getElementById("annError");
  retryBtn       = document.getElementById("annRetryBtn");

  bottomNavSlot  = document.getElementById("bottomNavSlot");

  replyOverlay   = document.getElementById("replyOverlay");
  replySheet     = document.getElementById("replySheet");
  replyCloseBtn  = document.getElementById("replyCloseBtn");
  replyCancelBtn = document.getElementById("replyCancelBtn");
  replySendBtn   = document.getElementById("replySendBtn");
  replyTextarea  = document.getElementById("replyTextarea");
  replyErrorEl   = document.getElementById("replyError");
}


/* ============================================================
   04 — إدارة الحالات (Loading / List / Empty / Error)
   المرجع: Master Design System — بنود 34، 35، 36
   ============================================================ */

function showLoading() {
  if (skeletonEl) skeletonEl.style.display = "";
  if (listEl)     listEl.style.display = "none";
  if (emptyEl)    emptyEl.style.display = "none";
  if (errorEl)    errorEl.style.display = "none";
}

function showList() {
  if (skeletonEl) skeletonEl.style.display = "none";
  if (listEl)     listEl.style.display = "";
  if (emptyEl)    emptyEl.style.display = "none";
  if (errorEl)    errorEl.style.display = "none";
}

function showEmpty() {
  if (skeletonEl) skeletonEl.style.display = "none";
  if (listEl)     listEl.style.display = "none";
  if (emptyEl)    emptyEl.style.display = "";
  if (errorEl)    errorEl.style.display = "none";
}

function showError() {
  if (skeletonEl) skeletonEl.style.display = "none";
  if (listEl)     listEl.style.display = "none";
  if (emptyEl)    emptyEl.style.display = "none";
  if (errorEl)    errorEl.style.display = "";
}


/* ============================================================
   05 — أيقونة الإعلان حسب النوع
   المرجع: Design System — البند 41
   ============================================================ */

function getAnnouncementIcon(a) {
  const type = safeText(a && a.type);
  if (type === "external_link") return "icon-globe";
  if (type === "internal_link") return "icon-link";
  return "icon-announcement";
}


/* ============================================================
   06 — عرض إعلان واحد
   المرجع: الوثيقة الأصلية — بنود 25، 27، 28، 29، 30
   ============================================================ */

/**
 * بناء كارت إعلان.
 * @param {Object} a
 * @returns {HTMLElement}
 */
function createAnnouncementCard(a) {
  const id        = safeText(a && a.id);
  const title     = safeText(a && a.title) || "إعلان";
  const body      = safeText(a && a.body) || "";
  const type      = safeText(a && a.type) || "text";
  const linkTarget= safeText(a && a.linkTarget) || "";
  const createdAt = a && a.createdAt ? a.createdAt : null;
  const isUnread  = !!(a && a.isRead === false);

  // ----- Card -----
  const card = document.createElement("article");
  card.className = "ann-card" + (isUnread ? " is-unread" : "");
  card.dataset.announcementId = id;

  // بمجرد تفاعل الطالب مع الإعلان نعتبره مقروءًا.
  const markRead = () => {
    if (!id || !isUnread) return;
    markAnnouncementRead(id).catch(() => {});
    card.classList.remove("is-unread");
  };
  card.addEventListener("click", markRead, { once: true });

  // ----- Head -----
  const head = document.createElement("div");
  head.className = "ann-card-head";

  const iconBox = document.createElement("div");
  iconBox.className = "ann-card-icon";
  iconBox.setAttribute("aria-hidden", "true");
  const iconGlyph = document.createElement("span");
  iconGlyph.className = "icon " + getAnnouncementIcon(a);
  iconGlyph.setAttribute("aria-hidden", "true");
  iconBox.appendChild(iconGlyph);

  const meta = document.createElement("div");
  meta.className = "ann-card-meta";

  const titleEl = document.createElement("h2");
  titleEl.className = "ann-card-title";
  titleEl.textContent = title;

  const dateEl = document.createElement("p");
  dateEl.className = "ann-card-date";
  dateEl.textContent = createdAt ? formatRelativeTime(createdAt) : "";

  meta.appendChild(titleEl);
  meta.appendChild(dateEl);

  head.appendChild(iconBox);
  head.appendChild(meta);

  card.appendChild(head);

  // ----- Body -----
  if (body) {
    const bodyEl = document.createElement("div");
    bodyEl.className = "ann-card-body";
    // نستخدم textContent لضمان عدم تنفيذ HTML (بند 124)
    bodyEl.textContent = body;
    card.appendChild(bodyEl);
  }

  // ----- Actions -----
  const actions = document.createElement("div");
  actions.className = "ann-card-actions";

  // 1) زر الفتح حسب النوع
  if (type === "internal_link" && linkTarget) {
    const openBtn = document.createElement("a");
    openBtn.className = "ann-action-btn ann-action-primary";
    openBtn.href = linkTarget;
    openBtn.textContent = "فتح";
    actions.appendChild(openBtn);
  } else if (type === "external_link" && linkTarget) {
    // بند 29: الرابط الخارجي يوجه لصفحة المحتوى/الدروس
    // لكن بشكل عام نفتحه في تاب جديد بأمان
    const openBtn = document.createElement("a");
    openBtn.className = "ann-action-btn ann-action-primary";
    openBtn.href = linkTarget;
    openBtn.target = "_blank";
    openBtn.rel = "noopener noreferrer";
    openBtn.textContent = "فتح المحتوى";
    actions.appendChild(openBtn);
  }

  // 2) زر الرد على المعلم (بند 30)
  const replyBtn = document.createElement("button");
  replyBtn.type = "button";
  replyBtn.className = "ann-action-btn ann-action-secondary";
  replyBtn.textContent = "الرد على المعلم";
  replyBtn.addEventListener("click", () => {
    openReplySheet(id);
  });
  actions.appendChild(replyBtn);

  card.appendChild(actions);

  return card;
}


/* ============================================================
   07 — عرض كل الإعلانات
   المرجع: الوثيقة الأصلية — بنود 25، 26
   ============================================================ */

function renderAnnouncements() {
  if (!listEl) return;

  listEl.replaceChildren();

  announcements.forEach((a) => {
    listEl.appendChild(createAnnouncementCard(a));
  });
}


/* ============================================================
   08 — تحميل الإعلانات
   المرجع: الوثيقة الأصلية — بند 26
   ============================================================ */

async function loadAnnouncements() {
  showLoading();

  const result = await getAnnouncements();

  if (!result || !result.success) {
    showError();
    return;
  }

  const list = (result.data && Array.isArray(result.data.announcements))
    ? result.data.announcements
    : [];

  announcements = list;

  if (announcements.length === 0) {
    showEmpty();
    try { barai.empty(emptyEl, "empty.announcements"); } catch (e) { /* تجاهل */ }
    return;
  }

  // تحديث الـ subtitle بعدد الإعلانات
  if (subtitleEl) {
    subtitleEl.textContent = `عندك ${announcements.length} إعلان`;
  }

  renderAnnouncements();
  showList();

  try {
    const unread = announcements.filter((a) => a && a.isRead === false).length;
    if (unread > 0) barai.notify("announce.onPage", { count: unread });   // داخل الصفحة نفسها لا «عندك رسائل جديدة»
    else barai.notify("announce.allRead");
  } catch (e) { /* برعي تجميلي فقط */ }
}


/* ============================================================
   09 — إدارة الـ Reply Sheet
   المرجع: Design System — بند 17
   ============================================================ */

/**
 * إظهار خطأ داخل الـ sheet.
 * @param {string} message
 */
function showReplyError(message) {
  if (!replyErrorEl) return;
  replyErrorEl.textContent = String(message || "");
  replyErrorEl.classList.add("is-visible");
}

/**
 * إخفاء خطأ الـ sheet.
 */
function clearReplyError() {
  if (!replyErrorEl) return;
  replyErrorEl.textContent = "";
  replyErrorEl.classList.remove("is-visible");
}

/**
 * فتح Bottom Sheet للرد على إعلان معيّن.
 * @param {string} announcementId
 */
function openReplySheet(announcementId) {
  const cleanId = safeText(announcementId);
  if (!cleanId) return;

  currentReplyAnnouncementId = cleanId;

  if (replyTextarea) replyTextarea.value = "";
  clearReplyError();

  if (replyOverlay) {
    replyOverlay.classList.add("is-open");
    replyOverlay.setAttribute("aria-hidden", "false");
  }

  // قفل تمرير الصفحة الخلفية
  document.body.style.overflow = "hidden";

  // تركيز على الـ textarea بعد فتح الـ sheet
  if (replyTextarea) {
    setTimeout(() => {
      replyTextarea.focus();
    }, 250);
  }
}

/**
 * إغلاق Bottom Sheet.
 */
function closeReplySheet() {
  if (!replyOverlay) return;

  replyOverlay.classList.remove("is-open");
  replyOverlay.setAttribute("aria-hidden", "true");

  currentReplyAnnouncementId = null;

  clearReplyError();

  // استرجاع تمرير الصفحة
  document.body.style.overflow = "";
}


/* ============================================================
   10 — إرسال الرد
   المرجع: الوثيقة الأصلية — بند 30
   ============================================================ */

async function handleSendReply() {
  if (isSendingReply) return;

  clearReplyError();

  const announcementId = currentReplyAnnouncementId;
  const message = replyTextarea ? replyTextarea.value : "";

  if (!announcementId) {
    showReplyError("تعذر تحديد الإعلان. حاول مرة أخرى.");
    return;
  }

  // التحقق في الفرونت (UX فقط)
  const { valid, errors } = validateAnnouncementReply({ message });

  if (!valid) {
    showReplyError(errors.message || "تحقق من الرد.");
    return;
  }

  // تعطيل الزر أثناء الإرسال
  isSendingReply = true;
  if (replySendBtn) {
    replySendBtn.disabled = true;
    replySendBtn.textContent = "جارٍ الإرسال...";
  }

  const result = await replyToAnnouncement(announcementId, safeText(message));

  isSendingReply = false;
  if (replySendBtn) {
    replySendBtn.disabled = false;
    replySendBtn.textContent = "إرسال";
  }

  if (result && result.success) {
    showToast("تم إرسال ردك بنجاح", "success");
    closeReplySheet();
    return;
  }

  const code = result && result.error ? result.error.code : null;
  const fallback = "تعذر إرسال الرد. حاول مرة أخرى.";
  const errorMessage =
    (result && result.error && result.error.message) ||
    fallback;

  showReplyError(errorMessage);

  // Toast فقط لو الخطأ شبكة/سيرفر (مش validation)
  if (
    code === "NETWORK_ERROR" ||
    code === "TIMEOUT" ||
    code === "SERVER_ERROR"
  ) {
    showToast(errorMessage, "error");
  }
}


/* ============================================================
   11 — ربط الأحداث
   ============================================================ */

function bindEvents() {
  // زر إعادة المحاولة في حالة الخطأ
  if (retryBtn) {
    retryBtn.addEventListener("click", () => {
      loadAnnouncements();
    });
  }

  // فتح/إغلاق الـ Reply Sheet
  if (replyCloseBtn)  replyCloseBtn.addEventListener("click", closeReplySheet);
  if (replyCancelBtn) replyCancelBtn.addEventListener("click", closeReplySheet);
  if (replySendBtn)   replySendBtn.addEventListener("click", handleSendReply);

  // إغلاق عند النقر على الـ overlay (خارج الـ sheet)
  if (replyOverlay) {
    replyOverlay.addEventListener("click", (e) => {
      if (e.target === replyOverlay) closeReplySheet();
    });
  }

  // إغلاق بـ Escape
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && replyOverlay && replyOverlay.classList.contains("is-open")) {
      closeReplySheet();
    }
  });

  // إخفاء الخطأ عند الكتابة
  if (replyTextarea) {
    replyTextarea.addEventListener("input", () => {
      clearReplyError();
    });
  }
}


/* ============================================================
   12 — Bottom Navigation
   ============================================================ */

function mountBottomNav() {
  if (!bottomNavSlot) return;
  bottomNavSlot.replaceChildren();
  bottomNavSlot.appendChild(renderBottomNav());
}


/* ============================================================
   13 — التهيئة
   ============================================================ */

async function init() {
  // الحماية
  const session = requireStudent();
  if (!session) return;

  cacheElements();

  mountBottomNav();
  bindEvents();

  await loadAnnouncements();
}


/* ============================================================
   14 — التشغيل
   ============================================================ */

onReady(init);