/**
 * exams.js
 * ------------------------------------------------------------
 * منصة أ/ إسماعيل عماد التعليمية
 * تشغيل صفحة exams.html
 *
 * المكان: /js/exams.js
 *
 * المرجع:
 *   - الوثيقة الأصلية (بنود 35، 36، 37، 40، 41، 44، 45، 84، 128،
 *                       136، 150، 163، 183)
 *   - Master Design System (بنود 22، 23، 24، 25، 26، 27، 33،
 *                            34، 35، 36، 38، 51)
 *
 * ⚠️ قواعد:
 *   - الفلترة على الفرونت فقط (بند 163).
 *   - حالة الاختبار تُحدَّد من Worker (بند 44، 45).
 *   - لا نفتح الاختبار في نفس الصفحة — التوجيه لـ exam.html.
 *
 * ⚠️ حالة الملف:
 *   - WORKER_URL = PLACEHOLDER_WORKER_URL (البند 207).
 *   - getExams سترجع NETWORK_ERROR حتى بناء الـ Worker.
 *   - سيظهر Error State مع زر إعادة المحاولة.
 * ------------------------------------------------------------
 */

import {
  onReady,
  safeText,
  showToast
} from "./helpers.js";

import {
  requireStudent,
  ROUTES
} from "./router.js";

import { getExams } from "./api.js";

import { renderBottomNav } from "./components.js";


import { barai } from "./barai/safe.js";

/* ============================================================
   01 — المرجع للعناصر
   ============================================================ */

let subtitleEl     = null;
let filtersEl      = null;
let skeletonEl     = null;
let listEl         = null;
let emptyEl        = null;
let emptyTitleEl   = null;
let emptyTextEl    = null;
let errorEl        = null;
let retryBtn       = null;
let bottomNavSlot  = null;


/* ============================================================
   02 — الحالة
   ============================================================ */

/** كل الاختبارات القادمة من الـ Worker */
let allExams = [];

/** الفلتر النشط حاليًا */
let currentFilter = "all"; // "all" | "available" | "done"

/** حالة التحميل */
let isLoading = false;


/* ============================================================
   03 — تجميع العناصر
   ============================================================ */

function cacheElements() {
  subtitleEl    = document.getElementById("exSubtitle");
  filtersEl     = document.querySelector(".ex-filters");
  skeletonEl    = document.getElementById("exSkeleton");
  listEl        = document.getElementById("exList");
  emptyEl       = document.getElementById("exEmpty");
  emptyTitleEl  = document.getElementById("exEmptyTitle");
  emptyTextEl   = document.getElementById("exEmptyText");
  errorEl       = document.getElementById("exError");
  retryBtn      = document.getElementById("exRetryBtn");
  bottomNavSlot = document.getElementById("bottomNavSlot");
}


/* ============================================================
   04 — حالات الصفحة
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
  // نص Empty يتغير حسب الفلتر
  if (emptyTitleEl && emptyTextEl) {
    if (currentFilter === "available") {
      emptyTitleEl.textContent = "لا توجد اختبارات متاحة";
      emptyTextEl.textContent  = "هيظهر هنا أي اختبار جديد لمستر إسماعيل.";
    } else if (currentFilter === "done") {
      emptyTitleEl.textContent = "لم تؤدِّ أي اختبار بعد";
      emptyTextEl.textContent  = "ابدأ أول اختبار من قسم 'متاح'.";
    } else {
      emptyTitleEl.textContent = "لا توجد اختبارات";
      emptyTextEl.textContent  = "هيظهر هنا أي اختبار جديد لمستر إسماعيل.";
    }
  }

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
   05 — حالات الاختبار
   المرجع: Master Design System — بند 23
   ============================================================ */

/**
 * ترجمة حالة الاختبار إلى بيانات العرض.
 * @param {string} status
 * @returns {{ label:string, className:string }}
 */
function getStatusMeta(status) {
  const s = safeText(status);
  if (s === "available")        return { label: "متاح",           className: "ex-status-available" };
  if (s === "attempted")        return { label: "تم الحل",         className: "ex-status-attempted" };
  if (s === "result_pending")   return { label: "قيد الانتظار",   className: "ex-status-pending"   };
  if (s === "result_available") return { label: "النتيجة متاحة",  className: "ex-status-result"    };
  return { label: "—", className: "ex-status-attempted" };
}


/* ============================================================
   06 — بناء كارت الاختبار
   المرجع: Master Design System — بنود 23، 24، 25، 26، 27
   ============================================================ */

/**
 * بناء كارت اختبار.
 * @param {Object} exam
 * @returns {HTMLElement}
 */
function createExamCard(exam) {
  const id              = safeText(exam && exam.id);
  const title           = safeText(exam && exam.title) || "اختبار";
  const status          = safeText(exam && exam.status) || "available";
  const questionsCount  = Number(exam && exam.questionsCount) || 0;

  const statusMeta = getStatusMeta(status);

  // Card
  const card = document.createElement("article");
  card.className = "ex-card";
  if (status === "available")        card.classList.add("is-available");
  if (status === "result_available") card.classList.add("is-result-available");
  card.dataset.examId = id;

  // ---------- Head ----------
  const head = document.createElement("div");
  head.className = "ex-card-head";

  const iconBox = document.createElement("div");
  iconBox.className = "ex-card-icon";
  iconBox.setAttribute("aria-hidden", "true");
  const iconGlyph = document.createElement("span");
  iconGlyph.className = "icon " + (status === "result_available" ? "icon-target" : "icon-exam-paper");
  iconGlyph.setAttribute("aria-hidden", "true");
  iconBox.appendChild(iconGlyph);

  const body = document.createElement("div");
  body.className = "ex-card-body";

  const titleEl = document.createElement("h3");
  titleEl.className = "ex-card-title";
  titleEl.textContent = title;

  const metaEl = document.createElement("p");
  metaEl.className = "ex-card-meta";
  metaEl.textContent = questionsCount > 0
    ? `${questionsCount} سؤال`
    : "";

  body.appendChild(titleEl);
  if (questionsCount > 0) body.appendChild(metaEl);

  const badge = document.createElement("span");
  badge.className = `ex-status ${statusMeta.className}`;
  badge.textContent = statusMeta.label;

  head.appendChild(iconBox);
  head.appendChild(body);
  head.appendChild(badge);

  card.appendChild(head);

  // ---------- Actions ----------
  const actions = document.createElement("div");
  actions.className = "ex-card-actions";

  if (status === "available") {
    // زر "ابدأ الاختبار" → يوجه لـ exam.html?examId=...
    const startBtn = document.createElement("a");
    startBtn.className = "ex-action ex-action-start";
    startBtn.textContent = "ابدأ الاختبار";
    startBtn.href = buildExamURL(id, null);
    actions.appendChild(startBtn);

  } else if (status === "attempted") {
    // زر معطل
    const disabledBtn = document.createElement("button");
    disabledBtn.type = "button";
    disabledBtn.className = "ex-action ex-action-disabled";
    disabledBtn.disabled = true;
    disabledBtn.textContent = "تم أداء الامتحان";
    actions.appendChild(disabledBtn);

  } else if (status === "result_pending") {
    // زر معطل + نص واضح (بند 26)
    const disabledBtn = document.createElement("button");
    disabledBtn.type = "button";
    disabledBtn.className = "ex-action ex-action-disabled";
    disabledBtn.disabled = true;
    disabledBtn.textContent = "النتيجة قيد الانتظار";
    actions.appendChild(disabledBtn);

  } else if (status === "result_available") {
    // زر "عرض النتيجة" → يوجه لـ exam.html?examId=...&view=result
    const resultBtn = document.createElement("a");
    resultBtn.className = "ex-action ex-action-result";
    resultBtn.textContent = "عرض النتيجة";
    resultBtn.href = buildExamURL(id, "result");
    actions.appendChild(resultBtn);
  }

  card.appendChild(actions);

  return card;
}


/* ============================================================
   07 — بناء رابط exam.html
   المرجع: الوثيقة الأصلية — بند 61 (أقل خطوات)
   ============================================================ */

/**
 * بناء رابط صفحة الاختبار.
 * @param {string} examId
 * @param {"result"|null} view
 * @returns {string}
 */
function buildExamURL(examId, view = null) {
  const cleanId = safeText(examId);
  if (!cleanId) return "#";

  let url = `exam.html?examId=${encodeURIComponent(cleanId)}`;
  if (view) url += `&view=${encodeURIComponent(view)}`;
  return url;
}


/* ============================================================
   08 — الفلترة
   المرجع: الوثيقة الأصلية — بند 163
   ============================================================ */

/**
 * فلترة الاختبارات حسب الفلتر الحالي.
 * @returns {Array<Object>}
 */
function getFilteredExams() {
  const list = Array.isArray(allExams) ? allExams : [];

  if (currentFilter === "available") {
    return list.filter((e) => e && e.status === "available");
  }

  if (currentFilter === "done") {
    return list.filter((e) => {
      const s = e && e.status;
      return s === "attempted" ||
             s === "result_pending" ||
             s === "result_available";
    });
  }

  // all
  return list;
}


/* ============================================================
   09 — عرض الاختبارات
   المرجع: الوثيقة الأصلية — بنود 35، 36
   ============================================================ */

function renderExams() {
  if (!listEl) return;

  const filtered = getFilteredExams();

  if (filtered.length === 0) {
    showEmpty();
    return;
  }

  listEl.replaceChildren();

  filtered.forEach((exam) => {
    listEl.appendChild(createExamCard(exam));
  });

  showList();
}


/* ============================================================
   10 — الفلاتر (UI)
   ============================================================ */

/**
 * تحديث شكل الفلاتر حسب الفلتر النشط.
 * @param {string} filter
 */
function updateFiltersUI(filter) {
  if (!filtersEl) return;

  filtersEl.querySelectorAll(".ex-filter").forEach((btn) => {
    const isActive = btn.dataset.filter === filter;
    btn.classList.toggle("is-active", isActive);
    btn.setAttribute("aria-selected", isActive ? "true" : "false");
  });
}

/**
 * ربط أحداث الفلاتر.
 */
function bindFilterEvents() {
  if (!filtersEl) return;

  filtersEl.querySelectorAll(".ex-filter").forEach((btn) => {
    btn.addEventListener("click", () => {
      const filter = safeText(btn.dataset.filter);
      if (!filter || filter === currentFilter) return;

      currentFilter = filter;
      updateFiltersUI(filter);
      renderExams();
    });
  });
}


/* ============================================================
   11 — تحميل الاختبارات
   المرجع: الوثيقة الأصلية — بنود 35، 36
   ============================================================ */

async function loadExams() {
  if (isLoading) return;
  isLoading = true;

  showLoading();

  const result = await getExams();

  isLoading = false;

  if (!result || !result.success) {
    showError();
    return;
  }

  const list = (result.data && Array.isArray(result.data.exams))
    ? result.data.exams
    : [];

  // فلترة أساسية: نتجاهل أي عنصر مش صالح
  allExams = list.filter((e) => e && typeof e === "object" && e.id);

  // تحديث الـ subtitle
  if (subtitleEl) {
    const availableCount = allExams.filter((e) => e.status === "available").length;
    if (availableCount > 0) {
      subtitleEl.textContent = `${availableCount} اختبار متاح`;
    } else if (allExams.length > 0) {
      subtitleEl.textContent = `${allExams.length} اختبار`;
    } else {
      subtitleEl.textContent = "اختبر نفسك وقيس مستواك";
    }
  }

  // عرض حسب الفلتر الحالي
  renderExams();

  // برعي: امتحان جديد لم يره الطالب على هذا الجهاز (محسوب محليًا من بيانات حقيقية)
  try {
    const avail = allExams.filter((e) => e.status === "available");
    barai.fresh("exams", avail.map((e) => e.id)).then((ids) => {
      if (!ids || !ids.length) return;
      try { barai.ambientMount(".ex-header-icon", "shiver"); } catch (e) { /* تجاهل */ }
      const first = avail.find((e) => String(e.id) === ids[0]);
      barai.notify("exam.new", {
        id: ids[0], ids, count: ids.length, title: safeText(first && first.title), commit: { group: "exams", ids },
        ...(ids.length === 1 ? { href: buildExamURL(ids[0], null), actionLabel: "ادخل الامتحان" } : {})
      });
    });
    if (allExams.length === 0) barai.empty(emptyEl, "empty.exams");
    barai.settle();
  } catch (e) { /* برعي تجميلي فقط */ }
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
   13 — ربط الأحداث العامة
   ============================================================ */

function bindEvents() {
  if (retryBtn) {
    retryBtn.addEventListener("click", () => {
      loadExams();
    });
  }
}


/* ============================================================
   14 — التهيئة
   ============================================================ */

async function init() {
  // حماية
  const session = requireStudent();
  if (!session) return;

  cacheElements();

  mountBottomNav();
  bindFilterEvents();
  bindEvents();

  // الفلتر الافتراضي
  currentFilter = "all";
  updateFiltersUI(currentFilter);

  await loadExams();
}


/* ============================================================
   15 — التشغيل
   ============================================================ */

onReady(init);