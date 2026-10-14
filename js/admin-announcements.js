/**
 * admin-announcements.js
 * ------------------------------------------------------------
 * منصة أ/ إسماعيل عماد التعليمية
 * تشغيل صفحة admin/announcements.html
 *
 * المكان: /js/admin-announcements.js
 *
 * المرجع:
 *   - الوثيقة الأصلية (بنود 25، 26، 27، 28، 29، 30، 78، 79، 96، 97، 124، 161)
 *   - Master Design System (بند 58)
 *
 * ⚠️ قواعد:
 *   - كل نص في textContent (بند 124).
 *   - الحماية الحقيقية في Worker (بند 109).
 *   - الحذف يحتاج تأكيد (بند 161).
 *
 * ⚠️ حالة الملف:
 *   - WORKER_URL = PLACEHOLDER_WORKER_URL (البند 207).
 *   - workerFetch سترجع NETWORK_ERROR حتى بناء الـ Worker.
 * ------------------------------------------------------------
 */


import {
  onReady,
  safeText,
  showToast,
  formatDate
} from "./helpers.js";

import {
  requireAdmin,
  getSession
} from "./router.js";


/* ============================================================
   01 — ثوابت
   ============================================================ */

const REQUEST_TIMEOUT_MS = 20000;

const ERRORS = {
  NETWORK_ERROR: "NETWORK_ERROR",
  TIMEOUT:       "TIMEOUT",
  SERVER_ERROR:  "SERVER_ERROR",
  UNAUTHORIZED:  "UNAUTHORIZED",
  NOT_FOUND:     "NOT_FOUND",
  BAD_REQUEST:   "BAD_REQUEST"
};

const ERROR_MESSAGES = {
  NETWORK_ERROR: "لا يوجد اتصال بالإنترنت.",
  TIMEOUT:       "انتهت مدة الطلب.",
  SERVER_ERROR:  "حدث خطأ. حاول مرة أخرى.",
  UNAUTHORIZED:  "انتهت الجلسة.",
  NOT_FOUND:     "العنصر غير موجود.",
  BAD_REQUEST:   "البيانات المُرسَلة غير صحيحة."
};

const STAGE_NAMES = {
  grade_4: "الرابع الابتدائي",
  grade_5: "الخامس الابتدائي",
  grade_6: "السادس الابتدائي",
  prep_1:  "الأول الإعدادي",
  prep_2:  "الثاني الإعدادي",
  prep_3:  "الثالث الإعدادي",
  sec_1:   "الأول الثانوي",
  sec_2:   "الثاني الثانوي",
  sec_3:   "الثالث الثانوي"
};

function getStageName(key) {
  const k = safeText(key);
  return STAGE_NAMES[k] || "—";
}

const AUDIENCE_LABELS = {
  all:     { text: "للجميع",    cls: "ann-badge--audience-all" },
  stage:   { text: "لمرحلة",    cls: "ann-badge--audience-stage" },
  student: { text: "لطالب",     cls: "ann-badge--audience-student" }
};

const TYPE_LABELS = {
  text:          { text: "نص",    cls: "ann-badge--type-text" },
  internal_link: { text: "رابط داخلي", cls: "ann-badge--type-link" },
  external_link: { text: "رابط خارجي", cls: "ann-badge--type-link" }
};


/* ============================================================
   02 — المرجع للعناصر
   ============================================================ */

let headerSubEl      = null;
let createBtn        = null;

let statsRowEl       = null;
let statAllEl        = null;
let statBroadcastEl  = null;
let statStageEl      = null;
let statStudentEl    = null;

let skeletonEl       = null;
let listEl           = null;
let emptyEl          = null;
let errorEl          = null;
let retryBtn         = null;

// Create/Edit Modal
let annModalEl       = null;
let annModalTitleEl  = null;
let annModalSubEl    = null;
let annTitleInput    = null;
let annBodyInput     = null;
let annAudienceSel   = null;
let annStageGroupEl  = null;
let annStageSel      = null;
let annStudentGroupEl = null;
let annStudentInput  = null;
let annTypeSel       = null;
let annLinkGroupEl   = null;
let annLinkInput     = null;
let annLinkHintEl    = null;
let annCancelBtn     = null;
let annConfirmBtn    = null;

// Replies Modal
let repliesModalEl   = null;
let repliesModalSub  = null;
let repliesListEl    = null;
let repliesCloseBtn  = null;


/* ============================================================
   03 — الحالة
   ============================================================ */

let allAnnouncements = [];
let currentFilter = "all"; // all | all-only | stage | student
let isLoading = false;

let editingId = null;   // null = إنشاء جديد
let isSaving = false;


/* ============================================================
   04 — طلب HTTP موحد
   ============================================================ */

import { backendRequest } from "./backend/index.js";
async function workerFetch(endpoint, options = {}) {
  // بدون Worker: التنفيذ داخل المتصفح عبر Firestore (js/backend/)
  return backendRequest(endpoint, options);
}


/* ============================================================
   05 — تجميع العناصر
   ============================================================ */

function cacheElements() {
  headerSubEl      = document.getElementById("annHeaderSub");
  createBtn        = document.getElementById("annCreateBtn");

  statsRowEl       = document.getElementById("annStats");
  statAllEl        = document.getElementById("statAnnAll");
  statBroadcastEl  = document.getElementById("statAnnBroadcast");
  statStageEl      = document.getElementById("statAnnStage");
  statStudentEl    = document.getElementById("statAnnStudent");

  skeletonEl       = document.getElementById("annSkeleton");
  listEl           = document.getElementById("annList");
  emptyEl          = document.getElementById("annEmpty");
  errorEl          = document.getElementById("annError");
  retryBtn         = document.getElementById("annRetryBtn");

  annModalEl       = document.getElementById("annModal");
  annModalTitleEl  = document.getElementById("annModalTitle");
  annModalSubEl    = document.getElementById("annModalSub");
  annTitleInput    = document.getElementById("annTitleInput");
  annBodyInput     = document.getElementById("annBodyInput");
  annAudienceSel   = document.getElementById("annAudienceSelect");
  annStageGroupEl  = document.getElementById("annStageGroup");
  annStageSel      = document.getElementById("annStageSelect");
  annStudentGroupEl = document.getElementById("annStudentGroup");
  annStudentInput  = document.getElementById("annStudentInput");
  annTypeSel       = document.getElementById("annTypeSelect");
  annLinkGroupEl   = document.getElementById("annLinkGroup");
  annLinkInput     = document.getElementById("annLinkInput");
  annLinkHintEl    = document.getElementById("annLinkHint");
  annCancelBtn     = document.getElementById("annCancelBtn");
  annConfirmBtn    = document.getElementById("annConfirmBtn");

  repliesModalEl   = document.getElementById("repliesModal");
  repliesModalSub  = document.getElementById("repliesModalSub");
  repliesListEl    = document.getElementById("repliesList");
  repliesCloseBtn  = document.getElementById("repliesCloseBtn");
}


/* ============================================================
   06 — حالات الصفحة
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
   07 — إحصائيات
   ============================================================ */

function updateStats() {
  const total     = allAnnouncements.length;
  const broadcast = allAnnouncements.filter((a) => a && a.targetType === "all").length;
  const stage     = allAnnouncements.filter((a) => a && a.targetType === "stage").length;
  const student   = allAnnouncements.filter((a) => a && a.targetType === "student").length;

  if (statAllEl)       statAllEl.textContent       = String(total);
  if (statBroadcastEl) statBroadcastEl.textContent = String(broadcast);
  if (statStageEl)     statStageEl.textContent     = String(stage);
  if (statStudentEl)   statStudentEl.textContent   = String(student);
}


/* ============================================================
   08 — الفلترة
   ============================================================ */

function getFilteredAnnouncements() {
  let list = Array.isArray(allAnnouncements) ? allAnnouncements.slice() : [];

  if (currentFilter === "all-only") {
    list = list.filter((a) => a && a.targetType === "all");
  } else if (currentFilter === "stage") {
    list = list.filter((a) => a && a.targetType === "stage");
  } else if (currentFilter === "student") {
    list = list.filter((a) => a && a.targetType === "student");
  }

  list.sort((a, b) => {
    const ta = toTime(a && a.createdAt);
    const tb = toTime(b && b.createdAt);
    return tb - ta;
  });

  return list;
}

function toTime(v) {
  if (!v) return 0;
  if (typeof v.toDate === "function") { try { return v.toDate().getTime(); } catch (e) { return 0; } }
  if (v instanceof Date) return v.getTime();
  if (typeof v === "number") return v;
  if (typeof v === "string") { const t = new Date(v).getTime(); return isNaN(t) ? 0 : t; }
  return 0;
}


/* ============================================================
   09 — بناء كارت الإعلان
   ============================================================ */

function createAnnouncementCard(item) {
  const id         = safeText(item && item.id);
  const title      = safeText(item && item.title) || "إعلان";
  const body       = safeText(item && item.body);
  const targetType = safeText(item && item.targetType) || "all";
  const targetVal  = safeText(item && item.targetValue);
  const type       = safeText(item && item.type) || "text";
  const createdAt  = item && item.createdAt;
  const repliesCnt = Number(item && item.repliesCount) || 0;

  const audMeta  = AUDIENCE_LABELS[targetType] || AUDIENCE_LABELS.all;
  const typeMeta = TYPE_LABELS[type] || TYPE_LABELS.text;

  const card = document.createElement("article");
  card.className = "ann-card";
  card.dataset.announcementId = id;

  // Head
  const head = document.createElement("div");
  head.className = "ann-card-head";

  const bodyBox = document.createElement("div");
  bodyBox.className = "ann-card-body";

  const titleEl = document.createElement("h3");
  titleEl.className = "ann-card-title";
  titleEl.textContent = title;
  bodyBox.appendChild(titleEl);

  if (body) {
    const textEl = document.createElement("p");
    textEl.className = "ann-card-text";
    textEl.textContent = body;
    bodyBox.appendChild(textEl);
  }

  // Badges
  const badges = document.createElement("div");
  badges.className = "ann-badges";

  const audBadge = document.createElement("span");
  audBadge.className = `ann-badge ${audMeta.cls}`;
  audBadge.textContent = audMeta.text;
  badges.appendChild(audBadge);

  // إضافة المرحلة/الطالب في badge
  if (targetType === "stage" && targetVal) {
    const sBadge = document.createElement("span");
    sBadge.className = "ann-badge ann-badge--audience-stage";
    sBadge.textContent = getStageName(targetVal);
    badges.appendChild(sBadge);
  } else if (targetType === "student" && targetVal) {
    const sBadge = document.createElement("span");
    sBadge.className = "ann-badge ann-badge--audience-student";
    sBadge.textContent = `كود: ${targetVal}`;
    badges.appendChild(sBadge);
  }

  const tBadge = document.createElement("span");
  tBadge.className = `ann-badge ${typeMeta.cls}`;
  tBadge.textContent = typeMeta.text;
  badges.appendChild(tBadge);

  bodyBox.appendChild(badges);

  // Meta
  const meta = document.createElement("div");
  meta.className = "ann-meta";

  if (createdAt) {
    const dateItem = document.createElement("span");
    dateItem.className = "ann-meta-item";
    const ic = document.createElement("span"); ic.textContent = "📅";
    const tx = document.createElement("span"); tx.textContent = formatDate(createdAt) || "—";
    dateItem.appendChild(ic); dateItem.appendChild(tx);
    meta.appendChild(dateItem);
  }

  if (repliesCnt > 0) {
    const repliesItem = document.createElement("span");
    repliesItem.className = "ann-meta-item";
    const ic = document.createElement("span"); ic.textContent = "💬";
    const tx = document.createElement("span"); tx.textContent = `${repliesCnt} رد`;
    repliesItem.appendChild(ic); repliesItem.appendChild(tx);
    meta.appendChild(repliesItem);
  }

  bodyBox.appendChild(meta);

  head.appendChild(bodyBox);
  card.appendChild(head);

  // Actions
  const actions = document.createElement("div");
  actions.className = "ann-actions";

  // Replies
  const repliesBtn = document.createElement("button");
  repliesBtn.type = "button";
  repliesBtn.className = "ann-action-btn ann-action-btn--info";
  repliesBtn.textContent = "💬 الردود";
  repliesBtn.addEventListener("click", () => openRepliesModal(id, title));
  actions.appendChild(repliesBtn);

  // Edit
  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.className = "ann-action-btn";
  editBtn.textContent = "✏️ تعديل";
  editBtn.addEventListener("click", () => openAnnModal(item));
  actions.appendChild(editBtn);

  // Delete
  const delBtn = document.createElement("button");
  delBtn.type = "button";
  delBtn.className = "ann-action-btn ann-action-btn--danger";
  delBtn.textContent = "🗑️ حذف";
  delBtn.addEventListener("click", () => handleDelete(id, title));
  actions.appendChild(delBtn);

  card.appendChild(actions);

  return card;
}


/* ============================================================
   10 — عرض القائمة
   ============================================================ */

function renderAnnouncements() {
  if (!listEl) return;

  const list = getFilteredAnnouncements();

  if (list.length === 0) {
    showEmpty();
    return;
  }

  listEl.replaceChildren();
  list.forEach((a) => listEl.appendChild(createAnnouncementCard(a)));
  showList();
}


/* ============================================================
   11 — تحميل الإعلانات
   ============================================================ */

async function loadAnnouncements() {
  if (isLoading) return;
  isLoading = true;

  showLoading();

  const result = await workerFetch("/api/admin/announcements");

  isLoading = false;

  if (!result || !result.success) {
    const code = (result && result.error && result.error.code) || ERRORS.SERVER_ERROR;
    if (code === ERRORS.UNAUTHORIZED) {
      showToast(ERROR_MESSAGES.UNAUTHORIZED, "warning");
      setTimeout(() => { window.location.href = "login.html"; }, 1500);
      return;
    }
    showError();
    return;
  }

  const data = (result.data && typeof result.data === "object") ? result.data : {};
  const list = Array.isArray(data.announcements) ? data.announcements : [];

  allAnnouncements = list.filter((a) => a && a.id);

  if (headerSubEl) {
    headerSubEl.textContent = `${allAnnouncements.length} إعلان`;
  }

  updateStats();
  renderAnnouncements();
}


/* ============================================================
   12 — Dynamic Fields (الجمهور + النوع)
   ============================================================ */

function toggleAudienceFields() {
  if (!annAudienceSel) return;
  const v = safeText(annAudienceSel.value);

  if (annStageGroupEl) {
    annStageGroupEl.classList.toggle("is-hidden", v !== "stage");
  }
  if (annStudentGroupEl) {
    annStudentGroupEl.classList.toggle("is-hidden", v !== "student");
  }
}

function toggleLinkFields() {
  if (!annTypeSel) return;
  const v = safeText(annTypeSel.value);

  if (annLinkGroupEl) {
    annLinkGroupEl.classList.toggle("is-hidden", v === "text");
  }

  if (annLinkHintEl) {
    if (v === "internal_link") {
      annLinkHintEl.textContent = "الرابط الداخلي: مسار داخل المنصة (مثل exams.html).";
    } else if (v === "external_link") {
      annLinkHintEl.textContent = "الرابط الخارجي: يجب أن يبدأ بـ http:// أو https://.";
    } else {
      annLinkHintEl.textContent = "";
    }
  }
}


/* ============================================================
   13 — Create/Edit Modal
   ============================================================ */

function openAnnModal(existing) {
  if (!annModalEl) return;

  editingId = existing ? safeText(existing.id) : null;

  // Reset
  if (annTitleInput) annTitleInput.value = existing ? safeText(existing.title) : "";
  if (annBodyInput)  annBodyInput.value  = existing ? safeText(existing.body)  : "";
  if (annAudienceSel) annAudienceSel.value = existing ? safeText(existing.targetType) : "all";
  if (annStageSel)   annStageSel.value   = existing ? safeText(existing.targetValue) : "";
  if (annStudentInput) annStudentInput.value = existing && existing.targetType === "student" ? safeText(existing.targetValue) : "";
  if (annTypeSel)    annTypeSel.value    = existing ? safeText(existing.type) : "text";
  if (annLinkInput)  annLinkInput.value  = existing ? safeText(existing.linkTarget) : "";

  // Titles
  if (annModalTitleEl) annModalTitleEl.textContent = existing ? "تعديل الإعلان" : "إعلان جديد";
  if (annModalSubEl)   annModalSubEl.textContent   = existing
    ? "عدّل بيانات الإعلان ثم احفظ."
    : "سيصل الإعلان للجمهور المحدد.";

  if (annConfirmBtn) annConfirmBtn.textContent = existing ? "حفظ" : "نشر";

  // إظهار الحقول المناسبة
  toggleAudienceFields();
  toggleLinkFields();

  // فتح
  annModalEl.classList.add("is-open");
  annModalEl.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";

  setTimeout(() => {
    if (annTitleInput) annTitleInput.focus();
  }, 150);
}

function closeAnnModal() {
  if (!annModalEl) return;
  annModalEl.classList.remove("is-open");
  annModalEl.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
  editingId = null;
}


/* ============================================================
   14 — التحقق من بيانات الإعلان
   ============================================================ */

function collectAnnouncementData() {
  const title = safeText(annTitleInput ? annTitleInput.value : "");
  const body  = safeText(annBodyInput ? annBodyInput.value : "");
  const targetType = safeText(annAudienceSel ? annAudienceSel.value : "all");
  const type  = safeText(annTypeSel ? annTypeSel.value : "text");

  let targetValue = "";
  if (targetType === "stage") {
    targetValue = safeText(annStageSel ? annStageSel.value : "");
  } else if (targetType === "student") {
    targetValue = safeText(annStudentInput ? annStudentInput.value : "");
  }

  let linkTarget = "";
  if (type !== "text") {
    linkTarget = safeText(annLinkInput ? annLinkInput.value : "");
  }

  const errors = {};

  if (!title) {
    errors.title = "من فضلك أدخل العنوان.";
  } else if (title.length > 150) {
    errors.title = "العنوان طويل جدًا.";
  }

  if (!body) {
    errors.body = "من فضلك أدخل نص الإعلان.";
  } else if (body.length > 5000) {
    errors.body = "النص طويل جدًا.";
  }

  if (targetType !== "all" && !targetValue) {
    errors.target = "من فضلك حدد القيمة المستهدفة.";
  }

  if (type !== "text") {
    if (!linkTarget) {
      errors.link = "من فضلك أدخل الرابط.";
    } else if (type === "internal_link" && /^https?:\/\//i.test(linkTarget)) {
      errors.link = "الرابط الداخلي يجب ألا يبدأ بـ http.";
    } else if (type === "external_link" && !/^https?:\/\//i.test(linkTarget)) {
      errors.link = "الرابط الخارجي يجب أن يبدأ بـ http:// أو https://.";
    }
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    data: {
      title,
      body,
      targetType,
      targetValue: targetValue || null,
      type,
      linkTarget: linkTarget || null
    }
  };
}


/* ============================================================
   15 — حفظ (إنشاء / تعديل)
   ============================================================ */

async function handleSaveAnnouncement() {
  if (isSaving) return;

  const { valid, errors, data } = collectAnnouncementData();

  if (!valid) {
    const firstError = Object.values(errors)[0];
    showToast(firstError || "تحقق من البيانات.", "warning");
    return;
  }

  isSaving = true;
  if (annConfirmBtn) {
    annConfirmBtn.disabled = true;
    annConfirmBtn.textContent = editingId ? "جارٍ الحفظ..." : "جارٍ النشر...";
  }

  let result;
  if (editingId) {
    // تعديل
    result = await workerFetch(`/api/admin/announcements/${encodeURIComponent(editingId)}`, {
      method: "PATCH",
      body: data
    });
  } else {
    // إنشاء
    result = await workerFetch("/api/admin/announcements", {
      method: "POST",
      body: data
    });
  }

  isSaving = false;
  if (annConfirmBtn) {
    annConfirmBtn.disabled = false;
    annConfirmBtn.textContent = editingId ? "حفظ" : "نشر";
  }

  if (!result || !result.success) {
    const code = (result && result.error && result.error.code) || ERRORS.SERVER_ERROR;
    const msg  = (result && result.error && result.error.message) || ERROR_MESSAGES[code];

    if (code === ERRORS.UNAUTHORIZED) {
      showToast(ERROR_MESSAGES.UNAUTHORIZED, "warning");
      setTimeout(() => { window.location.href = "login.html"; }, 1500);
      return;
    }

    showToast(msg, "error");
    return;
  }

  // تحديث محلي
  const savedItem = (result.data && result.data.announcement) ? result.data.announcement : null;

  if (savedItem && savedItem.id) {
    if (editingId) {
      // تعديل
      const idx = allAnnouncements.findIndex((a) => a && a.id === editingId);
      if (idx >= 0) allAnnouncements[idx] = savedItem;
    } else {
      // إضافة
      allAnnouncements.unshift(savedItem);
    }
  }

  updateStats();
  renderAnnouncements();
  closeAnnModal();

  showToast(editingId ? "تم الحفظ ✅" : "تم النشر ✅", "success");
}


/* ============================================================
   16 — حذف إعلان
   ============================================================ */

async function handleDelete(id, title) {
  const cleanId = safeText(id);
  if (!cleanId) return;

  const confirmed = window.confirm(`متأكد من حذف الإعلان: "${title}"؟`);
  if (!confirmed) return;

  const result = await workerFetch(`/api/admin/announcements/${encodeURIComponent(cleanId)}`, {
    method: "DELETE"
  });

  if (!result || !result.success) {
    const code = (result && result.error && result.error.code) || ERRORS.SERVER_ERROR;
    const msg  = (result && result.error && result.error.message) || ERROR_MESSAGES[code];

    if (code === ERRORS.UNAUTHORIZED) {
      showToast(ERROR_MESSAGES.UNAUTHORIZED, "warning");
      setTimeout(() => { window.location.href = "login.html"; }, 1500);
      return;
    }

    showToast(msg, "error");
    return;
  }

  // تحديث محلي
  allAnnouncements = allAnnouncements.filter((a) => a && a.id !== cleanId);
  updateStats();
  renderAnnouncements();

  showToast("تم الحذف", "success");
}


/* ============================================================
   17 — Modal الردود
   ============================================================ */

async function openRepliesModal(announcementId, title) {
  const cleanId = safeText(announcementId);
  if (!cleanId || !repliesModalEl) return;

  if (repliesModalSub) repliesModalSub.textContent = `الردود على: ${safeText(title)}`;

  if (repliesListEl) {
    repliesListEl.replaceChildren();

    const loading = document.createElement("div");
    loading.style.cssText = "text-align:center;padding:32px 0;";
    const spinner = document.createElement("div");
    spinner.className = "spinner";
    spinner.style.margin = "0 auto";
    loading.appendChild(spinner);
    repliesListEl.appendChild(loading);
  }

  repliesModalEl.classList.add("is-open");
  repliesModalEl.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";

  const result = await workerFetch(
    `/api/admin/announcements/${encodeURIComponent(cleanId)}/replies`
  );

  if (!repliesListEl) return;
  repliesListEl.replaceChildren();

  if (!result || !result.success) {
    const msg = (result && result.error && result.error.message) || "تعذر تحميل الردود.";
    const errBox = document.createElement("div");
    errBox.style.cssText = "text-align:center;padding:24px 12px;";
    const icon = document.createElement("div");
    icon.style.cssText = "font-size:32px;margin-bottom:8px;";
    icon.textContent = "⚠️";
    const text = document.createElement("p");
    text.style.cssText = "margin:0;font-size:13px;color:#777;line-height:1.6;";
    text.textContent = msg;
    errBox.appendChild(icon);
    errBox.appendChild(text);
    repliesListEl.appendChild(errBox);
    return;
  }

  const data = (result.data && typeof result.data === "object") ? result.data : {};
  const list = Array.isArray(data.replies) ? data.replies : [];

  if (list.length === 0) {
    const empty = document.createElement("div");
    empty.style.cssText = "text-align:center;padding:32px 12px;";
    const icon = document.createElement("div");
    icon.style.cssText = "font-size:36px;margin-bottom:8px;";
    icon.textContent = "💬";
    const title = document.createElement("h3");
    title.style.cssText = "margin:0 0 6px;font-size:14px;font-weight:800;color:var(--color-text);";
    title.textContent = "لا توجد ردود";
    const text = document.createElement("p");
    text.style.cssText = "margin:0;font-size:12px;color:#777;line-height:1.6;";
    text.textContent = "لم يقم أي طالب بالرد على هذا الإعلان بعد.";
    empty.appendChild(icon);
    empty.appendChild(title);
    empty.appendChild(text);
    repliesListEl.appendChild(empty);
    return;
  }

  // ترتيب: الأحدث أولاً
  list.sort((a, b) => toTime(b && b.createdAt) - toTime(a && a.createdAt));

  list.forEach((reply) => {
    const name = safeText(reply && reply.studentName) || "طالب";
    const message = safeText(reply && reply.message);
    const createdAt = reply && reply.createdAt;

    const item = document.createElement("div");
    item.className = "reply-item";

    const nameEl = document.createElement("h4");
    nameEl.className = "reply-item-name";
    nameEl.textContent = name;
    item.appendChild(nameEl);

    const textEl = document.createElement("p");
    textEl.className = "reply-item-text";
    textEl.textContent = message;
    item.appendChild(textEl);

    if (createdAt) {
      const dateEl = document.createElement("span");
      dateEl.className = "reply-item-date";
      dateEl.textContent = formatDate(createdAt) || "";
      item.appendChild(dateEl);
    }

    repliesListEl.appendChild(item);
  });
}

function closeRepliesModal() {
  if (!repliesModalEl) return;
  repliesModalEl.classList.remove("is-open");
  repliesModalEl.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}


/* ============================================================
   18 — Stats Row — النقر للفلترة
   ============================================================ */

function bindStatsClick() {
  if (!statsRowEl) return;

  statsRowEl.querySelectorAll(".ann-stat").forEach((stat) => {
    stat.addEventListener("click", () => {
      const aud = safeText(stat.dataset.audience) || "all";
      if (aud === currentFilter) return;

      currentFilter = aud;

      statsRowEl.querySelectorAll(".ann-stat").forEach((s) => {
        s.classList.toggle("is-active", s.dataset.audience === aud);
      });

      renderAnnouncements();
    });
  });
}


/* ============================================================
   19 — ربط الأحداث
   ============================================================ */

function bindEvents() {
  // إنشاء
  if (createBtn) createBtn.addEventListener("click", () => openAnnModal(null));

  // تحديث / إعادة
  if (retryBtn) retryBtn.addEventListener("click", () => loadAnnouncements());

  // Modal Actions
  if (annCancelBtn)  annCancelBtn.addEventListener("click", closeAnnModal);
  if (annConfirmBtn) annConfirmBtn.addEventListener("click", handleSaveAnnouncement);

  // إغلاق Modal عند النقر على overlay
  if (annModalEl) {
    annModalEl.addEventListener("click", (e) => {
      if (e.target === annModalEl) closeAnnModal();
    });
  }

  // Dynamic fields
  if (annAudienceSel) annAudienceSel.addEventListener("change", toggleAudienceFields);
  if (annTypeSel)     annTypeSel.addEventListener("change", toggleLinkFields);

  // Replies Modal
  if (repliesCloseBtn) repliesCloseBtn.addEventListener("click", closeRepliesModal);
  if (repliesModalEl) {
    repliesModalEl.addEventListener("click", (e) => {
      if (e.target === repliesModalEl) closeRepliesModal();
    });
  }

  // Escape
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (annModalEl && annModalEl.classList.contains("is-open")) closeAnnModal();
      if (repliesModalEl && repliesModalEl.classList.contains("is-open")) closeRepliesModal();
    }
  });

  // Stats click
  bindStatsClick();
}


/* ============================================================
   20 — التهيئة
   ============================================================ */

async function init() {
  const session = requireAdmin();
  if (!session) return;

  cacheElements();

  // تفعيل الحقول الديناميكية في البداية
  toggleAudienceFields();
  toggleLinkFields();

  bindEvents();

  await loadAnnouncements();
}


/* ============================================================
   21 — التشغيل
   ============================================================ */

onReady(init);