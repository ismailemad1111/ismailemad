/**
 * admin-requests.js
 * ------------------------------------------------------------
 * منصة أ/ إسماعيل عماد التعليمية
 * تشغيل صفحة admin/requests.html
 *
 * المكان: /js/admin-requests.js
 *
 * المرجع:
 *   - الوثيقة الأصلية (بنود 24، 86، 95، 132، 137، 162، 163)
 *   - Master Design System (بند 58)
 *
 * ⚠️ قواعد:
 *   - الحماية الحقيقية في Worker (بند 109).
 *   - الفلترة على الفرونت (بند 163).
 *   - البحث بـ debounce (بند 162).
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
  NOT_FOUND:     "الطلب غير موجود.",
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

const STATUS_LABELS = {
  pending:   { text: "جديد",            cls: "req-status--pending"   },
  contacted: { text: "تم التواصل",      cls: "req-status--contacted" },
  approved:  { text: "تمت الموافقة",    cls: "req-status--approved"  },
  rejected:  { text: "مرفوض",           cls: "req-status--rejected"  },
  completed: { text: "مكتمل",           cls: "req-status--completed" }
};

function getStageName(key) {
  const k = safeText(key);
  return STAGE_NAMES[k] || "—";
}


/* ============================================================
   02 — المرجع للعناصر
   ============================================================ */

let headerSubEl     = null;
let refreshBtn      = null;

let statsRowEl      = null;
let statAllEl       = null;
let statPendingEl   = null;
let statContactedEl = null;
let statCompletedEl = null;

let searchInput     = null;

let skeletonEl      = null;
let listEl          = null;
let emptyEl         = null;
let errorEl         = null;
let retryBtn        = null;

// Modal
let statusModalEl   = null;
let statusModalSub  = null;
let statusSelectEl  = null;
let statusNoteEl    = null;
let statusCancelBtn = null;
let statusConfirmBtn = null;


/* ============================================================
   03 — الحالة
   ============================================================ */

let allRequests = [];
let currentFilter = "all";
let currentSearch = "";
let isLoading = false;

let editingRequestId = null;
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
  headerSubEl      = document.getElementById("requestsHeaderSub");
  refreshBtn       = document.getElementById("requestsRefreshBtn");

  statsRowEl       = document.getElementById("reqStats");
  statAllEl        = document.getElementById("statReqAll");
  statPendingEl    = document.getElementById("statReqPending");
  statContactedEl  = document.getElementById("statReqContacted");
  statCompletedEl  = document.getElementById("statReqCompleted");

  searchInput      = document.getElementById("requestsSearchInput");

  skeletonEl       = document.getElementById("requestsSkeleton");
  listEl           = document.getElementById("requestsList");
  emptyEl          = document.getElementById("requestsEmpty");
  errorEl          = document.getElementById("requestsError");
  retryBtn         = document.getElementById("requestsRetryBtn");

  statusModalEl    = document.getElementById("statusModal");
  statusModalSub   = document.getElementById("statusModalSub");
  statusSelectEl   = document.getElementById("statusSelect");
  statusNoteEl     = document.getElementById("statusNote");
  statusCancelBtn  = document.getElementById("statusCancelBtn");
  statusConfirmBtn = document.getElementById("statusConfirmBtn");
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
  const total     = allRequests.length;
  const pending   = allRequests.filter((r) => r && r.status === "pending").length;
  const contacted = allRequests.filter((r) => r && r.status === "contacted").length;
  const completed = allRequests.filter((r) => r && r.status === "completed").length;

  if (statAllEl)       statAllEl.textContent       = String(total);
  if (statPendingEl)   statPendingEl.textContent   = String(pending);
  if (statContactedEl) statContactedEl.textContent = String(contacted);
  if (statCompletedEl) statCompletedEl.textContent = String(completed);
}


/* ============================================================
   08 — الفلترة والبحث
   ============================================================ */

function getFilteredRequests() {
  let list = Array.isArray(allRequests) ? allRequests.slice() : [];

  if (currentFilter !== "all") {
    list = list.filter((r) => r && r.status === currentFilter);
  }

  const q = safeText(currentSearch).toLowerCase();
  if (q) {
    list = list.filter((r) => {
      if (!r) return false;
      const name  = safeText(r.fullName).toLowerCase();
      const phone = safeText(r.phone).toLowerCase();
      return name.includes(q) || phone.includes(q);
    });
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
   09 — بناء كارت الطلب
   ============================================================ */

function createRequestCard(request) {
  const id       = safeText(request && request.id);
  const fullName = safeText(request && request.fullName) || "طالب";
  const phone    = safeText(request && request.phone);
  const stage    = safeText(request && request.stage);
  const group    = safeText(request && request.lessonGroupName);
  const status   = safeText(request && request.status) || "pending";
  const createdAt = request && request.createdAt;

  const statusMeta = STATUS_LABELS[status] || STATUS_LABELS.pending;

  const card = document.createElement("article");
  card.className = "req-card" + (status === "pending" ? " is-pending" : "");
  card.dataset.requestId = id;

  // ---------- Head ----------
  const head = document.createElement("div");
  head.className = "req-card-head";

  const avatar = document.createElement("div");
  avatar.className = "req-avatar";
  avatar.setAttribute("aria-hidden", "true");
  avatar.textContent = getInitials(fullName, 2) || "👤";

  const body = document.createElement("div");
  body.className = "req-card-body";

  const nameEl = document.createElement("h3");
  nameEl.className = "req-name";
  nameEl.textContent = fullName;
  body.appendChild(nameEl);

  const meta = document.createElement("div");
  meta.className = "req-meta";

  if (stage) {
    const item = document.createElement("span");
    item.className = "req-meta-item";
    const ic = document.createElement("span"); ic.textContent = "🎓";
    const tx = document.createElement("span"); tx.textContent = getStageName(stage);
    item.appendChild(ic); item.appendChild(tx);
    meta.appendChild(item);
  }

  if (group) {
    const item = document.createElement("span");
    item.className = "req-meta-item";
    const ic = document.createElement("span"); ic.textContent = "📚";
    const tx = document.createElement("span"); tx.textContent = group;
    item.appendChild(ic); item.appendChild(tx);
    meta.appendChild(item);
  }

  if (createdAt) {
    const item = document.createElement("span");
    item.className = "req-meta-item";
    const ic = document.createElement("span"); ic.textContent = "📅";
    const tx = document.createElement("span"); tx.textContent = formatDate(createdAt) || "—";
    item.appendChild(ic); item.appendChild(tx);
    meta.appendChild(item);
  }

  body.appendChild(meta);

  const badge = document.createElement("span");
  badge.className = `req-status ${statusMeta.cls}`;
  badge.textContent = statusMeta.text;

  head.appendChild(avatar);
  head.appendChild(body);
  head.appendChild(badge);

  card.appendChild(head);

  // ---------- Actions ----------
  const actions = document.createElement("div");
  actions.className = "req-actions";

  if (phone) {
    const callBtn = document.createElement("a");
    callBtn.className = "req-action-btn req-action-btn--phone";
    callBtn.href = `tel:${phone}`;
    callBtn.textContent = `📞 ${phone}`;
    actions.appendChild(callBtn);
  }

  const updateBtn = document.createElement("button");
  updateBtn.type = "button";
  updateBtn.className = "req-action-btn";
  updateBtn.textContent = "🔄 تحديث الحالة";
  updateBtn.addEventListener("click", () => openStatusModal(id, fullName, status));
  actions.appendChild(updateBtn);

  card.appendChild(actions);

  return card;
}


/* ============================================================
   10 — عرض القائمة
   ============================================================ */

function renderRequests() {
  if (!listEl) return;

  const list = getFilteredRequests();

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
      text.className = "adm-state-text"; text.textContent = "جرّب تعديل الفلتر أو نص البحث.";
      empty.appendChild(icon); empty.appendChild(title); empty.appendChild(text);
      listEl.appendChild(empty);
      showList();
      return;
    }
    showEmpty();
    return;
  }

  listEl.replaceChildren();
  list.forEach((r) => listEl.appendChild(createRequestCard(r)));
  showList();
}


/* ============================================================
   11 — تحميل الطلبات
   ============================================================ */

async function loadRequests() {
  if (isLoading) return;
  isLoading = true;

  showLoading();

  const result = await workerFetch("/api/admin/requests");

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
  const list = Array.isArray(data.requests) ? data.requests : [];

  allRequests = list.filter((r) => r && r.id);

  if (headerSubEl) {
    headerSubEl.textContent = `${allRequests.length} طلب`;
  }

  updateStats();
  renderRequests();
}


/* ============================================================
   12 — Modal تحديث الحالة
   ============================================================ */

function openStatusModal(requestId, name, currentStatus) {
  const cleanId = safeText(requestId);
  if (!cleanId || !statusModalEl) return;

  editingRequestId = cleanId;

  if (statusModalSub) {
    statusModalSub.textContent = `الطلب: ${safeText(name)}`;
  }

  if (statusSelectEl) {
    statusSelectEl.value = currentStatus || "pending";
  }

  if (statusNoteEl) statusNoteEl.value = "";

  statusModalEl.classList.add("is-open");
  statusModalEl.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

function closeStatusModal() {
  if (!statusModalEl) return;
  statusModalEl.classList.remove("is-open");
  statusModalEl.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
  editingRequestId = null;
}

async function handleSaveStatus() {
  if (isSaving || !editingRequestId) return;

  const newStatus = safeText(statusSelectEl ? statusSelectEl.value : "");
  const note      = safeText(statusNoteEl ? statusNoteEl.value : "");

  if (!newStatus) {
    showToast("اختر الحالة الجديدة.", "warning");
    return;
  }

  isSaving = true;
  if (statusConfirmBtn) {
    statusConfirmBtn.disabled = true;
    statusConfirmBtn.textContent = "جارٍ الحفظ...";
  }

  const result = await workerFetch(`/api/admin/requests/${encodeURIComponent(editingRequestId)}`, {
    method: "PATCH",
    body: {
      status: newStatus,
      note: note || null
    }
  });

  isSaving = false;
  if (statusConfirmBtn) {
    statusConfirmBtn.disabled = false;
    statusConfirmBtn.textContent = "حفظ";
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

  // نجاح — تحديث محلي
  const request = allRequests.find((r) => r && r.id === editingRequestId);
  if (request) {
    request.status = newStatus;
    if (note) request.note = note;
  }

  updateStats();
  renderRequests();
  closeStatusModal();

  showToast("تم تحديث الحالة ✅", "success");
}


/* ============================================================
   13 — Stats Row — النقر للفلترة
   ============================================================ */

function bindStatsClick() {
  if (!statsRowEl) return;

  statsRowEl.querySelectorAll(".req-stat").forEach((stat) => {
    stat.addEventListener("click", () => {
      const status = safeText(stat.dataset.status) || "all";
      if (status === currentFilter) return;

      currentFilter = status;

      statsRowEl.querySelectorAll(".req-stat").forEach((s) => {
        s.classList.toggle("is-active", s.dataset.status === status);
      });

      renderRequests();
    });
  });
}


/* ============================================================
   14 — ربط الأحداث
   ============================================================ */

function bindEvents() {
  if (refreshBtn) refreshBtn.addEventListener("click", () => loadRequests());
  if (retryBtn)   retryBtn.addEventListener("click", () => loadRequests());

  if (searchInput) {
    const debounced = debounce((value) => {
      currentSearch = value || "";
      renderRequests();
    }, 300);

    searchInput.addEventListener("input", (e) => {
      debounced(e.target.value);
    });
  }

  if (statusCancelBtn) statusCancelBtn.addEventListener("click", closeStatusModal);
  if (statusConfirmBtn) statusConfirmBtn.addEventListener("click", handleSaveStatus);

  if (statusModalEl) {
    statusModalEl.addEventListener("click", (e) => {
      if (e.target === statusModalEl) closeStatusModal();
    });
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && statusModalEl && statusModalEl.classList.contains("is-open")) {
      closeStatusModal();
    }
  });

  bindStatsClick();
}


/* ============================================================
   15 — التهيئة
   ============================================================ */

async function init() {
  const session = requireAdmin();
  if (!session) return;

  cacheElements();
  bindEvents();

  await loadRequests();
}


/* ============================================================
   16 — التشغيل
   ============================================================ */

onReady(init);