/**
 * admin-results.js
 * ------------------------------------------------------------
 * منصة أ/ إسماعيل عماد التعليمية
 * تشغيل صفحة admin/results.html
 *
 * المكان: /js/admin-results.js
 *
 * المرجع:
 *   - الوثيقة الأصلية (بنود 84، 101، 138، 162، 163، 164)
 *   - Master Design System (بند 58)
 *
 * ⚠️ قواعد:
 *   - الحماية الحقيقية في Worker (بند 109).
 *   - الفلترة على الفرونت (بند 163).
 *   - البحث بـ debounce (بند 162).
 *   - دعم ?examId= من الرابط.
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
  debounce,
  formatDate,
  getInitials
} from "./helpers.js";

import {
  requireAdmin,
  getSession
} from "./router.js";


/* ============================================================
   01 — ثوابت
   ============================================================ */

const REQUEST_TIMEOUT_MS = 20000;

/** نسبة النجاح الافتراضية (لو مش موجودة من Worker) */
const DEFAULT_PASSING_PERCENT = 50;

const ERRORS = {
  NETWORK_ERROR: "NETWORK_ERROR",
  TIMEOUT:       "TIMEOUT",
  SERVER_ERROR:  "SERVER_ERROR",
  UNAUTHORIZED:  "UNAUTHORIZED",
  NOT_FOUND:     "NOT_FOUND"
};

const ERROR_MESSAGES = {
  NETWORK_ERROR: "لا يوجد اتصال بالإنترنت.",
  TIMEOUT:       "انتهت مدة الطلب.",
  SERVER_ERROR:  "حدث خطأ. حاول مرة أخرى.",
  UNAUTHORIZED:  "انتهت الجلسة.",
  NOT_FOUND:     "المحاولة غير موجودة."
};

const STAGE_NAMES = {
  grade_4: "رابعة ابتدائي",
  grade_5: "خامسة ابتدائي",
  grade_6: "سادسة ابتدائي",
  prep_1:  "أولى إعدادي",
  prep_2:  "ثانية إعدادي",
  prep_3:  "ثالثة إعدادي",
  sec_1:   "أولى ثانوي",
  sec_2:   "ثانية ثانوي",
  sec_3:   "ثالثة ثانوي"
};

function getStageName(key) {
  const k = safeText(key);
  return STAGE_NAMES[k] || "—";
}


/* ============================================================
   02 — المرجع للعناصر
   ============================================================ */

let headerSubEl      = null;
let refreshBtn       = null;

let filterInfoEl     = null;
let filterInfoTextEl = null;
let filterInfoClearBtn = null;

let statAllEl        = null;
let statAvgEl        = null;
let statTopEl        = null;
let statPassEl       = null;

let searchInput      = null;
let filtersEl        = null;

let skeletonEl       = null;
let listEl           = null;
let emptyEl          = null;
let errorEl          = null;
let retryBtn         = null;

// Details Modal
let detailsModalEl   = null;
let detailsSubEl     = null;
let detailsContentEl = null;
let detailsCloseBtn  = null;


/* ============================================================
   03 — الحالة
   ============================================================ */

let allResults = [];
/** ترقيم من الخادم (يبقى false إن رجع الخادم للتحميل الكامل) */
let isPaged = false;
let hasMore = false;
let nextCursor = null;
let serverSummary = null;   // { total, avgPercent, topScore, passCount } لكل النتائج لا للمحمّل فقط
let isLoadingMore = false;
let loadGen = 0;            // يُلغي ردود الصفحات التالية القديمة بعد إعادة تحميل/تغيير الفلتر
let loadMoreWrapEl = null;
let loadMoreBtnEl = null;
let currentFilter = "all";  // all | pass | fail | pending
let currentSearch = "";
let isLoading = false;

/** معرّف الاختبار من الرابط (لو موجود) */
let filterExamId = null;
let filterExamTitle = "";

/** نسبة النجاح (تُحدَّد من Worker أو الافتراضي) */
let passingPercent = DEFAULT_PASSING_PERCENT;


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
  headerSubEl       = document.getElementById("rsHeaderSub");
  buildLoadMore();
  refreshBtn        = document.getElementById("rsRefreshBtn");

  filterInfoEl      = document.getElementById("rsFilterInfo");
  filterInfoTextEl  = document.getElementById("rsFilterInfoText");
  filterInfoClearBtn = document.getElementById("rsFilterInfoClearBtn");

  statAllEl         = document.getElementById("statRsAll");
  statAvgEl         = document.getElementById("statRsAvg");
  statTopEl         = document.getElementById("statRsTop");
  statPassEl        = document.getElementById("statRsPass");

  searchInput       = document.getElementById("rsSearchInput");
  filtersEl         = document.getElementById("rsFilters");

  skeletonEl        = document.getElementById("rsSkeleton");
  listEl            = document.getElementById("rsList");
  emptyEl           = document.getElementById("rsEmpty");
  errorEl           = document.getElementById("rsError");
  retryBtn          = document.getElementById("rsRetryBtn");

  detailsModalEl    = document.getElementById("rsDetailsModal");
  detailsSubEl      = document.getElementById("rsDetailsSub");
  detailsContentEl  = document.getElementById("rsDetailsContent");
  detailsCloseBtn   = document.getElementById("rsDetailsCloseBtn");
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
   07 — قراءة ?examId= من الرابط
   ============================================================ */

function readURLParams() {
  try {
    const params = new URLSearchParams(window.location.search);
    filterExamId = safeText(params.get("examId")) || null;
    filterExamTitle = safeText(params.get("examTitle")) || "";
  } catch (e) {
    filterExamId = null;
    filterExamTitle = "";
  }
}

/**
 * تحديث Banner الفلتر.
 */
function renderFilterBanner() {
  if (!filterInfoEl) return;

  if (!filterExamId) {
    filterInfoEl.classList.add("is-hidden");
    return;
  }

  filterInfoEl.classList.remove("is-hidden");

  if (filterInfoTextEl) {
    const title = filterExamTitle || "اختبار";
    filterInfoTextEl.textContent = `يتم عرض نتائج: ${title}`;
  }
}


/* ============================================================
   08 — إحصائيات
   ============================================================ */

function updateStats() {
  if (isPaged && serverSummary) {
    // إجماليات كل النتائج من الخادم (aggregate)، لا من الصفحات المحمّلة فقط
    if (statAllEl)  statAllEl.textContent  = String(serverSummary.total);
    if (statAvgEl)  statAvgEl.textContent  = `${serverSummary.avgPercent}%`;
    if (statTopEl)  statTopEl.textContent  = String(serverSummary.topScore);
    if (statPassEl) statPassEl.textContent = String(serverSummary.passCount);
    return;
  }
  const total = allResults.length;

  if (total === 0) {
    if (statAllEl)  statAllEl.textContent  = "0";
    if (statAvgEl)  statAvgEl.textContent  = "0%";
    if (statTopEl)  statTopEl.textContent  = "0";
    if (statPassEl) statPassEl.textContent = "0";
    return;
  }

  // متوسط النسب
  let sumPercent = 0;
  let topScore = 0;
  let passCount = 0;

  allResults.forEach((r) => {
    const percent = calcPercent(r);
    sumPercent += percent;

    const score = Number(r && r.score) || 0;
    if (score > topScore) topScore = score;

    if (percent >= passingPercent) passCount++;
  });

  const avg = Math.round(sumPercent / total);

  if (statAllEl)  statAllEl.textContent  = String(total);
  if (statAvgEl)  statAvgEl.textContent  = `${avg}%`;
  if (statTopEl)  statTopEl.textContent  = String(topScore);
  if (statPassEl) statPassEl.textContent = String(passCount);
}

/**
 * حساب النسبة المئوية لمحاولة.
 */
function calcPercent(r) {
  if (!r) return 0;
  // إن كان الحقل percent موجود من Worker
  const p = Number(r.percent);
  if (!isNaN(p) && p > 0) return Math.round(p);

  const score = Number(r.score) || 0;
  const total = Number(r.total) || 0;
  if (total === 0) return 0;
  return Math.round((score / total) * 100);
}

/**
 * حساب الدرجة العليا (للنسبة المئوية).
 */
function calcTopPercent() {
  let top = 0;
  allResults.forEach((r) => {
    const p = calcPercent(r);
    if (p > top) top = p;
  });
  return top;
}


/* ============================================================
   09 — الفلترة والبحث
   ============================================================ */

function getFilteredResults() {
  let list = Array.isArray(allResults) ? allResults.slice() : [];

  // فلتر الحالة
  if (currentFilter === "pass") {
    list = list.filter((r) => calcPercent(r) >= passingPercent);
  } else if (currentFilter === "fail") {
    list = list.filter((r) => calcPercent(r) < passingPercent);
  } else if (currentFilter === "pending") {
    list = list.filter((r) => r && r.resultVisible === false);
  }

  // بحث
  const q = safeText(currentSearch).toLowerCase();
  if (q) {
    list = list.filter((r) => {
      if (!r) return false;
      const name = safeText(r.studentName).toLowerCase();
      const exam = safeText(r.examTitle).toLowerCase();
      return name.includes(q) || exam.includes(q);
    });
  }

  // ترتيب: الأحدث أولاً
  list.sort((a, b) => {
    const ta = toTime(a && a.attemptedAt);
    const tb = toTime(b && b.attemptedAt);
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
   10 — بناء كارت النتيجة
   ============================================================ */

function createResultCard(result) {
  const id            = safeText(result && result.id);
  const studentName   = safeText(result && result.studentName) || "طالب";
  const examTitle     = safeText(result && result.examTitle) || "اختبار";
  const stage         = safeText(result && result.stage);
  const score         = Number(result && result.score) || 0;
  const total         = Number(result && result.total) || 0;
  const attemptedAt   = result && result.attemptedAt;
  const resultVisible = result && result.resultVisible !== false;

  const percent = calcPercent(result);
  const isPass = resultVisible && percent >= passingPercent;
  const isFail = resultVisible && !isPass;
  const isPending = !resultVisible;

  const card = document.createElement("article");
  card.className = "result-card";
  card.dataset.resultId = id;

  // Head
  const head = document.createElement("div");
  head.className = "result-card-head";

  // Score Circle
  const scoreBox = document.createElement("div");
  scoreBox.className = "result-score";
  if (isPass) scoreBox.classList.add("is-pass");
  if (isFail) scoreBox.classList.add("is-fail");

  const scoreValue = document.createElement("div");
  scoreValue.className = "result-score-value";
  scoreValue.textContent = isPending ? "—" : `${score}/${total}`;

  const scorePercent = document.createElement("div");
  scorePercent.className = "result-score-percent";
  scorePercent.textContent = isPending ? "قيد" : `${percent}%`;

  scoreBox.appendChild(scoreValue);
  scoreBox.appendChild(scorePercent);

  // Body
  const body = document.createElement("div");
  body.className = "result-body";

  const nameEl = document.createElement("h3");
  nameEl.className = "result-student-name";
  nameEl.textContent = studentName;
  body.appendChild(nameEl);

  const examEl = document.createElement("p");
  examEl.className = "result-exam-title";
  examEl.textContent = examTitle;
  body.appendChild(examEl);

  // Badges
  const badges = document.createElement("div");
  badges.className = "result-badges";

  if (stage) {
    const sBadge = document.createElement("span");
    sBadge.className = "result-badge result-badge--stage";
    sBadge.textContent = getStageName(stage);
    badges.appendChild(sBadge);
  }

  if (isPending) {
    const pBadge = document.createElement("span");
    pBadge.className = "result-badge result-badge--pending";
    pBadge.textContent = "⏳ قيد الانتظار";
    badges.appendChild(pBadge);
  } else {
    const vBadge = document.createElement("span");
    vBadge.className = "result-badge result-badge--visible";
    vBadge.textContent = "✅ متاحة";
    badges.appendChild(vBadge);
  }

  body.appendChild(badges);

  // Meta
  if (attemptedAt) {
    const meta = document.createElement("div");
    meta.className = "result-meta";
    meta.style.marginTop = "8px";

    const item = document.createElement("span");
    item.className = "result-meta-item";
    const ic = document.createElement("span"); ic.textContent = "🕐";
    const tx = document.createElement("span"); tx.textContent = formatDate(attemptedAt) || "—";
    item.appendChild(ic); item.appendChild(tx);
    meta.appendChild(item);
    body.appendChild(meta);
  }

  head.appendChild(scoreBox);
  head.appendChild(body);
  card.appendChild(head);

  // Actions
  const actions = document.createElement("div");
  actions.className = "result-actions";

  // Details
  const detailsBtn = document.createElement("button");
  detailsBtn.type = "button";
  detailsBtn.className = "result-action-btn result-action-btn--info";
  detailsBtn.textContent = "👁️ تفاصيل";
  detailsBtn.addEventListener("click", () => openDetailsModal(result));
  actions.appendChild(detailsBtn);

  // Student
  const studentBtn = document.createElement("a");
  studentBtn.className = "result-action-btn";
  studentBtn.href = `students.html?id=${encodeURIComponent(safeText(result.studentId))}`;
  studentBtn.textContent = "👤 الطالب";
  actions.appendChild(studentBtn);

  card.appendChild(actions);

  return card;
}


/* ============================================================
   11 — عرض القائمة
   ============================================================ */

function renderResults() {
  if (!listEl) return;

  const list = getFilteredResults();

  if (list.length === 0) {
    if (currentSearch || currentFilter !== "all") {
      listEl.replaceChildren();
      const empty = document.createElement("div");
      empty.className = "adm-state";
      const icon = document.createElement("div");
      icon.className = "adm-state-icon"; icon.textContent = "🔍";
      const title = document.createElement("h3");
      title.className = "adm-state-title"; title.textContent = "لا توجد نتائج مطابقة";
      const text = document.createElement("p");
      text.className = "adm-state-text"; text.textContent = "جرّب تعديل الفلتر أو البحث.";
      empty.appendChild(icon); empty.appendChild(title); empty.appendChild(text);
      listEl.appendChild(empty);
      showList();
      return;
    }
    showEmpty();
    return;
  }

  listEl.replaceChildren();
  list.forEach((r) => listEl.appendChild(createResultCard(r)));
  showList();
}


/* ============================================================
   12 — تحميل النتائج
   ============================================================ */

const PAGE_SIZE = 100;

function resultsEndpoint(cursor) {
  const params = new URLSearchParams();
  if (filterExamId) params.set("examId", filterExamId);
  params.set("limit", String(PAGE_SIZE));
  if (cursor) params.set("cursor", cursor);
  return `/api/admin/results?${params.toString()}`;
}

function buildLoadMore() {
  if (loadMoreWrapEl || !document.getElementById("rsList")) return;
  loadMoreWrapEl = document.createElement("div");
  loadMoreWrapEl.style.cssText = "display:none;text-align:center;margin:16px 0;";
  loadMoreBtnEl = document.createElement("button");
  loadMoreBtnEl.type = "button";
  loadMoreBtnEl.className = "result-action-btn";
  loadMoreBtnEl.textContent = "تحميل المزيد";
  loadMoreBtnEl.addEventListener("click", () => { loadMore(); });
  loadMoreWrapEl.appendChild(loadMoreBtnEl);
  document.getElementById("rsList").insertAdjacentElement("afterend", loadMoreWrapEl);
}

function updateLoadMore() {
  if (!loadMoreWrapEl) return;
  const show = isPaged && hasMore;
  loadMoreWrapEl.style.display = show ? "" : "none";
  if (loadMoreBtnEl) {
    loadMoreBtnEl.disabled = isLoadingMore;
    loadMoreBtnEl.textContent = isLoadingMore ? "جاري التحميل..." : "تحميل المزيد";
  }
}

function updateHeaderSub() {
  if (!headerSubEl) return;
  if (isPaged && serverSummary) {
    headerSubEl.textContent = hasMore
      ? `${serverSummary.total} محاولة (معروض ${allResults.length})`
      : `${serverSummary.total} محاولة`;
  } else {
    headerSubEl.textContent = `${allResults.length} محاولة`;
  }
}

async function loadResults() {
  if (isLoading) return;
  isLoading = true;

  showLoading();

  // صفحة جديدة: نبدأ من الأول (لا نعرض بيانات تحميل سابق)
  loadGen += 1;
  isPaged = false; hasMore = false; nextCursor = null; serverSummary = null; allResults = [];
  updateLoadMore();

  const result = await workerFetch(resultsEndpoint(null));

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
  const list = Array.isArray(data.results) ? data.results : [];

  allResults = list.filter((r) => r && r.id);
  isPaged = data.paged === true && !!data.summary;
  hasMore = isPaged && data.hasMore === true;
  nextCursor = hasMore ? (data.nextCursor || null) : null;
  serverSummary = isPaged ? data.summary : null;

  // passingPercent من Worker (اختياري)
  if (typeof data.passingPercent === "number") {
    passingPercent = data.passingPercent;
  }

  // examTitle من Worker (لو مش موجود في الرابط)
  if (filterExamId && data.examTitle && !filterExamTitle) {
    filterExamTitle = safeText(data.examTitle);
    renderFilterBanner();
  }

  updateHeaderSub();
  updateStats();
  renderResults();
  updateLoadMore();
}

/** يجلب الدفعة التالية ويضيفها (بدون تكرار). يرجع true عند النجاح. */
async function fetchNextPage() {
  if (!isPaged || !hasMore || !nextCursor) return true;
  const gen = loadGen;
  const result = await workerFetch(resultsEndpoint(nextCursor));
  if (gen !== loadGen) return false;   // أُعيد تحميل الصفحة أثناء الطلب: نتجاهل هذا الرد
  if (!result || !result.success) {
    const code = (result && result.error && result.error.code) || ERRORS.SERVER_ERROR;
    if (code === ERRORS.UNAUTHORIZED) {
      showToast(ERROR_MESSAGES.UNAUTHORIZED, "warning");
      setTimeout(() => { window.location.href = "login.html"; }, 1500);
    } else {
      showToast("تعذر تحميل المزيد. حاول مرة أخرى.", "error");
    }
    return false;
  }
  const data = (result.data && typeof result.data === "object") ? result.data : {};
  const seen = new Set(allResults.map((r) => r.id));
  (Array.isArray(data.results) ? data.results : []).forEach((r) => {
    if (r && r.id && !seen.has(r.id)) { allResults.push(r); seen.add(r.id); }
  });
  hasMore = data.hasMore === true;
  nextCursor = hasMore ? (data.nextCursor || null) : null;
  return true;
}

async function loadMore() {
  if (isLoadingMore || isLoading) return;
  isLoadingMore = true; updateLoadMore();
  const okPage = await fetchNextPage();
  isLoadingMore = false;
  if (okPage) { updateHeaderSub(); renderResults(); }
  updateLoadMore();
}

/**
 * البحث والفلاتر (ناجح/راسب/قيد الانتظار) تعمل على القائمة المحمّلة؛ فإن بقي نتائج غير محمّلة
 * نحمّلها أولًا حتى لا تظهر نتيجة ناقصة على أنها كاملة.
 */
async function ensureAllLoaded() {
  if (!isPaged || !hasMore || isLoadingMore || isLoading) return;
  isLoadingMore = true; updateLoadMore();
  showToast("جاري تحميل باقي النتائج ليشمل البحث/الفلتر كل المحاولات...", "info");
  let okPage = true;
  while (hasMore && okPage) okPage = await fetchNextPage();
  isLoadingMore = false;
  updateHeaderSub();
  updateLoadMore();
}


/* ============================================================
   13 — Details Modal
   ============================================================ */

function openDetailsModal(result) {
  if (!detailsModalEl || !detailsContentEl) return;

  const studentName = safeText(result && result.studentName) || "طالب";
  const examTitle   = safeText(result && result.examTitle) || "اختبار";
  const score       = Number(result && result.score) || 0;
  const total       = Number(result && result.total) || 0;
  const correct     = Number(result && result.correctCount) || 0;
  const wrong       = Number(result && result.wrongCount) || 0;
  const percent     = calcPercent(result);
  const attemptedAt = result && result.attemptedAt;
  const resultVisible = result && result.resultVisible !== false;

  if (detailsSubEl) {
    detailsSubEl.textContent = `${studentName} — ${examTitle}`;
  }

  // بناء المحتوى
  detailsContentEl.replaceChildren();

  // Score block
  const scoreBox = document.createElement("div");
  scoreBox.style.cssText = `
    padding:18px;border-radius:16px;text-align:center;
    background:${resultVisible ? "var(--color-green-light)" : "var(--color-yellow-light)"};
    margin-bottom:16px;
  `;

  const scoreVal = document.createElement("div");
  scoreVal.style.cssText = `
    font-family:Inter,sans-serif;font-size:32px;font-weight:900;
    direction:ltr;line-height:1;
    color:${resultVisible ? "var(--color-green-dark)" : "var(--color-yellow-dark)"};
  `;
  scoreVal.textContent = resultVisible ? `${score}/${total}` : "—";

  const scoreLbl = document.createElement("div");
  scoreLbl.style.cssText = `
    margin-top:6px;font-size:13px;font-weight:700;
    color:${resultVisible ? "var(--color-green-dark)" : "var(--color-yellow-dark)"};
  `;
  scoreLbl.textContent = resultVisible
    ? `النسبة: ${percent}%`
    : "النتيجة قيد الانتظار";

  scoreBox.appendChild(scoreVal);
  scoreBox.appendChild(scoreLbl);
  detailsContentEl.appendChild(scoreBox);

  // Info Grid
  const infoGrid = document.createElement("div");
  infoGrid.style.cssText = "display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-bottom:16px;";

  // Correct
  infoGrid.appendChild(makeInfoBox(
    "✅",
    "إجابات صحيحة",
    resultVisible ? correct : "—",
    "var(--color-green-dark)"
  ));

  // Wrong
  infoGrid.appendChild(makeInfoBox(
    "❌",
    "إجابات خاطئة",
    resultVisible ? wrong : "—",
    "var(--color-red-dark)"
  ));

  detailsContentEl.appendChild(infoGrid);

  // Details rows
  const rows = document.createElement("div");
  rows.style.cssText = "padding:0 14px;background:var(--color-surface-soft);border-radius:14px;";

  rows.appendChild(makeInfoRow("👤", "الطالب", studentName));
  rows.appendChild(makeInfoRow("📝", "الاختبار", examTitle));
  if (attemptedAt) {
    rows.appendChild(makeInfoRow("🕐", "وقت المحاولة", formatDate(attemptedAt) || "—"));
  }

  detailsContentEl.appendChild(rows);

  // Open
  detailsModalEl.classList.add("is-open");
  detailsModalEl.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

function closeDetailsModal() {
  if (!detailsModalEl) return;
  detailsModalEl.classList.remove("is-open");
  detailsModalEl.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

function makeInfoBox(icon, label, value, color) {
  const box = document.createElement("div");
  box.style.cssText = `
    padding:14px;border-radius:12px;
    background:var(--color-surface-soft);text-align:center;
  `;

  const ic = document.createElement("div");
  ic.style.fontSize = "20px";
  ic.textContent = icon;

  const val = document.createElement("div");
  val.style.cssText = `
    margin-top:4px;font-family:Inter,sans-serif;
    font-size:20px;font-weight:900;direction:ltr;line-height:1.2;
    color:${color};
  `;
  val.textContent = String(value);

  const lbl = document.createElement("div");
  lbl.style.cssText = "margin-top:2px;font-size:11px;font-weight:700;color:var(--color-text-muted);";
  lbl.textContent = label;

  box.appendChild(ic);
  box.appendChild(val);
  box.appendChild(lbl);
  return box;
}

function makeInfoRow(icon, label, value) {
  const row = document.createElement("div");
  row.style.cssText = `
    display:flex;justify-content:space-between;align-items:center;
    padding:12px 0;border-bottom:1px solid var(--color-border);
  `;
  row.style.borderBottom = "1px solid var(--color-border)";
  if (row.parentElement === null) {
    // last child fix
  }

  const labelEl = document.createElement("span");
  labelEl.style.cssText = "display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:var(--color-text-muted);";

  const ic = document.createElement("span");
  ic.textContent = icon;
  ic.style.fontSize = "14px";

  const lt = document.createElement("span");
  lt.textContent = label;

  labelEl.appendChild(ic);
  labelEl.appendChild(lt);

  const valueEl = document.createElement("span");
  valueEl.style.cssText = "font-size:13px;font-weight:800;color:var(--color-text);text-align:left;";
  valueEl.textContent = value;

  row.appendChild(labelEl);
  row.appendChild(valueEl);
  return row;
}


/* ============================================================
   14 — ربط الأحداث
   ============================================================ */

function bindEvents() {
  if (refreshBtn) refreshBtn.addEventListener("click", () => loadResults());
  if (retryBtn)   retryBtn.addEventListener("click", () => loadResults());

  // Search (بـ debounce)
  if (searchInput) {
    const debounced = debounce(async (value) => {
      currentSearch = value || "";
      if (currentSearch) await ensureAllLoaded();
      renderResults();
    }, 300);

    searchInput.addEventListener("input", (e) => {
      debounced(e.target.value);
    });
  }

  // Filters
  if (filtersEl) {
    filtersEl.querySelectorAll(".rs-filter").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const filter = safeText(btn.dataset.filter) || "all";
        if (filter === currentFilter) return;

        currentFilter = filter;

        filtersEl.querySelectorAll(".rs-filter").forEach((b) => {
          b.classList.toggle("is-active", b.dataset.filter === filter);
        });

        if (filter !== "all") await ensureAllLoaded();
        renderResults();
      });
    });
  }

  // Details Modal
  if (detailsCloseBtn) detailsCloseBtn.addEventListener("click", closeDetailsModal);
  if (detailsModalEl) {
    detailsModalEl.addEventListener("click", (e) => {
      if (e.target === detailsModalEl) closeDetailsModal();
    });
  }

  // Escape
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && detailsModalEl && detailsModalEl.classList.contains("is-open")) {
      closeDetailsModal();
    }
  });

  // Filter clear
  if (filterInfoClearBtn) {
    filterInfoClearBtn.addEventListener("click", () => {
      // إزالة ?examId= من الرابط
      filterExamId = null;
      filterExamTitle = "";
      renderFilterBanner();

      // تحديث الرابط بدون examId
      try {
        const url = new URL(window.location.href);
        url.searchParams.delete("examId");
        url.searchParams.delete("examTitle");
        window.history.replaceState({}, "", url.toString());
      } catch (e) {}

      // إعادة التحميل
      loadResults();
    });
  }
}


/* ============================================================
   15 — التهيئة
   ============================================================ */

async function init() {
  const session = requireAdmin();
  if (!session) return;

  cacheElements();

  // قراءة ?examId=
  readURLParams();
  renderFilterBanner();

  bindEvents();

  await loadResults();
}


/* ============================================================
   16 — التشغيل
   ============================================================ */

onReady(init);