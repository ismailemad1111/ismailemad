/**
 * admin-codes.js
 * ------------------------------------------------------------
 * منصة أ/ إسماعيل عماد التعليمية
 * تشغيل صفحة admin/codes.html
 *
 * المكان: /js/admin-codes.js
 *
 * المرجع:
 *   - الوثيقة الأصلية (بنود 74، 75، 76، 92، 93، 118، 132، 133، 162، 163، 164، 175)
 *   - Master Design System (بند 58)
 *
 * ⚠️ قواعد:
 *   - الحماية الحقيقية في Worker (بند 109).
 *   - لا نعرض كلمة المرور بعد الإنشاء الأولي إلا في نافذة مخصصة.
 *   - الفلترة على الفرونت (بند 163).
 *   - البحث بـ debounce (بند 162).
 *
 * ⚠️ حالة الملف:
 *   - WORKER_URL = PLACEHOLDER_WORKER_URL (البند 207).
 *   - workerFetch سترجع NETWORK_ERROR حتى بناء الـ Worker.
 *   - ستظهر حالة Empty / Error State.
 *
 * ⚠️ ملاحظة تقنية:
 *   - workerFetch محلية مؤقتًا.
 *   - ستنتقل إلى api.js عند المراجعة النهائية.
 * ------------------------------------------------------------
 */


import {
  onReady,
  safeText,
  showToast,
  debounce,
  formatDate,
  escapeHTML
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
  BAD_REQUEST:   "BAD_REQUEST"
};

const ERROR_MESSAGES = {
  NETWORK_ERROR: "لا يوجد اتصال بالإنترنت.",
  TIMEOUT:       "انتهت مدة الطلب.",
  SERVER_ERROR:  "حدث خطأ. حاول مرة أخرى.",
  UNAUTHORIZED:  "انتهت الجلسة.",
  BAD_REQUEST:   "البيانات المُرسَلة غير صحيحة."
};

const STAGE_NAMES = {
  grade_4: "الصف الرابع الابتدائي",
  grade_5: "الصف الخامس الابتدائي",
  grade_6: "الصف السادس الابتدائي",
  prep_1:  "الأول الإعدادي",
  prep_2:  "الثاني الإعدادي",
  prep_3:  "الثالث الإعدادي",
  sec_1:   "الأول الثانوي",
  sec_2:   "الثاني الثانوي",
  sec_3:   "الثالث الثانوي"
};

const STATUS_LABELS = {
  unused:   { text: "متاح",   cls: "code-status--unused"   },
  active:   { text: "مستخدم", cls: "code-status--active"   },
  disabled: { text: "معطل",   cls: "code-status--disabled" }
};


/* ============================================================
   02 — المرجع للعناصر
   ============================================================ */

let headerSubEl       = null;
let refreshBtn        = null;

let statAllEl         = null;
let statUnusedEl      = null;
let statActiveEl      = null;
let statDisabledEl    = null;

let searchInput       = null;
let filtersEl         = null;

let createBtn         = null;
let exportBtn         = null;

let skeletonEl        = null;
let listEl            = null;
let emptyEl           = null;
let errorEl           = null;
let retryBtn          = null;

let createModalEl     = null;
let createCountEl     = null;
let createStageEl     = null;
let createNoteEl      = null;
let createCancelBtn   = null;
let createConfirmBtn  = null;


/* ============================================================
   03 — الحالة
   ============================================================ */

/** كل الأكواد القادمة من الـ Worker */
let allCodes = [];

/** الفلتر الحالي */
let currentFilter = "all";

/** نص البحث الحالي */
let currentSearch = "";

/** حالة التحميل */
let isLoading = false;

/** حالة الإنشاء */
let isCreating = false;


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
  headerSubEl       = document.getElementById("codesHeaderSub");
  refreshBtn        = document.getElementById("codesRefreshBtn");

  statAllEl         = document.getElementById("statAll");
  statUnusedEl      = document.getElementById("statUnused");
  statActiveEl      = document.getElementById("statActive");
  statDisabledEl    = document.getElementById("statDisabled");

  searchInput       = document.getElementById("codesSearchInput");
  filtersEl         = document.getElementById("codesFilters");

  createBtn         = document.getElementById("codesCreateBtn");
  exportBtn         = document.getElementById("codesExportBtn");

  skeletonEl        = document.getElementById("codesSkeleton");
  listEl            = document.getElementById("codesList");
  emptyEl           = document.getElementById("codesEmpty");
  errorEl           = document.getElementById("codesError");
  retryBtn          = document.getElementById("codesRetryBtn");

  createModalEl     = document.getElementById("createModal");
  createCountEl     = document.getElementById("createCount");
  createStageEl     = document.getElementById("createStage");
  createNoteEl      = document.getElementById("createNote");
  createCancelBtn   = document.getElementById("createCancelBtn");
  createConfirmBtn  = document.getElementById("createConfirmBtn");
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
  const total    = allCodes.length;
  const unused   = allCodes.filter((c) => c && c.status === "unused").length;
  const active   = allCodes.filter((c) => c && c.status === "active").length;
  const disabled = allCodes.filter((c) => c && c.status === "disabled").length;

  if (statAllEl)      statAllEl.textContent      = String(total);
  if (statUnusedEl)   statUnusedEl.textContent   = String(unused);
  if (statActiveEl)   statActiveEl.textContent   = String(active);
  if (statDisabledEl) statDisabledEl.textContent = String(disabled);
}


/* ============================================================
   08 — الفلترة والبحث
   ============================================================ */

function getFilteredCodes() {
  let list = Array.isArray(allCodes) ? allCodes.slice() : [];

  // 1) فلترة الحالة
  if (currentFilter !== "all") {
    list = list.filter((c) => c && c.status === currentFilter);
  }

  // 2) البحث
  const q = safeText(currentSearch).toLowerCase();
  if (q) {
    list = list.filter((c) => {
      if (!c) return false;
      const code = safeText(c.code).toLowerCase();
      const studentName = safeText(c.studentName).toLowerCase();
      return code.includes(q) || studentName.includes(q);
    });
  }

  // 3) ترتيب: الأحدث أولاً
  list.sort((a, b) => {
    const ta = toTime(a.createdAt);
    const tb = toTime(b.createdAt);
    return tb - ta;
  });

  return list;
}

/**
 * تحويل تاريخ إلى milliseconds.
 */
function toTime(value) {
  if (!value) return 0;
  if (typeof value.toDate === "function") {
    try { return value.toDate().getTime(); } catch (e) { return 0; }
  }
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const t = new Date(value).getTime();
    return isNaN(t) ? 0 : t;
  }
  return 0;
}


/* ============================================================
   09 — بناء كارت الكود
   المراجع: بنود 74 → 76
   ============================================================ */

function createCodeCard(item) {
  const id       = safeText(item && item.id);
  const code     = safeText(item && item.code);
  const status   = safeText(item && item.status) || "unused";
  const stage    = safeText(item && item.stage);
  const student  = safeText(item && item.studentName);
  const createdAt = item && item.createdAt;
  const note     = safeText(item && item.note);

  const statusMeta = STATUS_LABELS[status] || STATUS_LABELS.unused;

  // Card
  const card = document.createElement("article");
  card.className = "code-card";
  if (status === "disabled") card.classList.add("is-disabled");
  card.dataset.codeId = id;

  // ---------- Head ----------
  const head = document.createElement("div");
  head.className = "code-card-head";

  const valueEl = document.createElement("div");
  valueEl.className = "code-card-value";
  valueEl.textContent = code || "—";

  const badge = document.createElement("span");
  badge.className = `code-status ${statusMeta.cls}`;
  badge.textContent = statusMeta.text;

  head.appendChild(valueEl);
  head.appendChild(badge);

  card.appendChild(head);

  // ---------- Meta ----------
  const meta = document.createElement("div");
  meta.className = "code-card-meta";

  if (stage) {
    const stageItem = document.createElement("span");
    stageItem.className = "code-card-meta-item";
    stageItem.innerHTML = "";
    const icon = document.createElement("span");
    icon.textContent = "🎓";
    const text = document.createElement("span");
    text.textContent = STAGE_NAMES[stage] || stage;
    stageItem.appendChild(icon);
    stageItem.appendChild(text);
    meta.appendChild(stageItem);
  }

  if (student) {
    const studentItem = document.createElement("span");
    studentItem.className = "code-card-meta-item";
    const icon = document.createElement("span");
    icon.textContent = "👤";
    const text = document.createElement("span");
    text.textContent = student;
    studentItem.appendChild(icon);
    studentItem.appendChild(text);
    meta.appendChild(studentItem);
  }

  if (createdAt) {
    const dateItem = document.createElement("span");
    dateItem.className = "code-card-meta-item";
    const icon = document.createElement("span");
    icon.textContent = "📅";
    const text = document.createElement("span");
    const formatted = formatDate(createdAt) || "—";
    text.textContent = formatted;
    dateItem.appendChild(icon);
    dateItem.appendChild(text);
    meta.appendChild(dateItem);
  }

  if (note) {
    const noteItem = document.createElement("span");
    noteItem.className = "code-card-meta-item";
    const icon = document.createElement("span");
    icon.textContent = "📝";
    const text = document.createElement("span");
    text.textContent = note;
    noteItem.appendChild(icon);
    noteItem.appendChild(text);
    meta.appendChild(noteItem);
  }

  if (meta.childNodes.length > 0) {
    card.appendChild(meta);
  }

  // ---------- Actions ----------
  const actions = document.createElement("div");
  actions.className = "code-card-actions";

  // نسخ
  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "code-action-btn";
  copyBtn.textContent = "📋 نسخ";
  copyBtn.addEventListener("click", () => handleCopy(code));
  actions.appendChild(copyBtn);

  // تعطيل / تفعيل
  if (status === "active" || status === "unused") {
    const disableBtn = document.createElement("button");
    disableBtn.type = "button";
    disableBtn.className = "code-action-btn code-action-btn--danger";
    disableBtn.textContent = "🚫 تعطيل";
    disableBtn.addEventListener("click", () => handleToggleStatus(id, "disabled"));
    actions.appendChild(disableBtn);
  } else if (status === "disabled") {
    // إصلاح: كان دايمًا بيبعت "unused" عند إعادة التفعيل، حتى لو الكود
    // كان مرتبط بطالب فعليًا (studentId موجود) — ده كان بيرجّع كود
    // الطالب لحالة "أول استخدام" من جديد بدل ما يرجّعه لنفس الطالب.
    // لو الكود مرتبط بطالب، إعادة التفعيل الصحيحة هي "active" (يرجع
    // لنفس الطالب)، وإلا (مالوش studentId خالص) يرجع "unused" زي ما هو.
    const reactivateStatus = safeText(item && item.studentId) ? "active" : "unused";
    const enableBtn = document.createElement("button");
    enableBtn.type = "button";
    enableBtn.className = "code-action-btn code-action-btn--success";
    enableBtn.textContent = "✅ تفعيل";
    enableBtn.addEventListener("click", () => handleToggleStatus(id, reactivateStatus));
    actions.appendChild(enableBtn);
  }

  card.appendChild(actions);

  return card;
}


/* ============================================================
   10 — عرض القائمة
   ============================================================ */

function renderCodes() {
  if (!listEl) return;

  const list = getFilteredCodes();

  if (list.length === 0) {
    // لو فيه بحث أو فلتر نشط → رسالة مختلفة
    if (currentSearch || currentFilter !== "all") {
      listEl.replaceChildren();
      const empty = document.createElement("div");
      empty.className = "adm-state";
      const icon = document.createElement("div");
      icon.className = "adm-state-icon";
      icon.textContent = "🔍";
      const title = document.createElement("h3");
      title.className = "adm-state-title";
      title.textContent = "لا توجد نتائج مطابقة";
      const text = document.createElement("p");
      text.className = "adm-state-text";
      text.textContent = "جرّب تعديل الفلتر أو نص البحث.";
      empty.appendChild(icon);
      empty.appendChild(title);
      empty.appendChild(text);
      listEl.appendChild(empty);
      showList();
      return;
    }

    showEmpty();
    return;
  }

  listEl.replaceChildren();
  list.forEach((item) => {
    listEl.appendChild(createCodeCard(item));
  });

  showList();
}


/* ============================================================
   11 — تحميل الأكواد
   المرجع: بند 92
   ============================================================ */

async function loadCodes() {
  if (isLoading) return;
  isLoading = true;

  showLoading();

  const result = await workerFetch("/api/admin/codes");

  isLoading = false;

  if (!result || !result.success) {
    const code = (result && result.error && result.error.code) || ERRORS.SERVER_ERROR;

    if (code === ERRORS.UNAUTHORIZED) {
      showToast(ERROR_MESSAGES.UNAUTHORIZED, "warning");
      setTimeout(() => {
        window.location.href = "login.html";
      }, 1500);
      return;
    }

    showError();
    return;
  }

  const data = (result.data && typeof result.data === "object") ? result.data : {};
  const list = Array.isArray(data.codes) ? data.codes : [];

  // فلترة أساسية
  allCodes = list.filter((c) => c && c.id && c.code);

  // تحديث الـ header
  if (headerSubEl) {
    headerSubEl.textContent = `${allCodes.length} كود في النظام`;
  }

  updateStats();
  renderCodes();
}


/* ============================================================
   12 — نسخ كود
   ============================================================ */

async function handleCopy(code) {
  const text = safeText(code);
  if (!text) return;

  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      showToast("تم نسخ الكود ✅", "success");
      return;
    }
  } catch (e) { /* fallback */ }

  // Fallback قديم
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    showToast("تم نسخ الكود ✅", "success");
  } catch (e) {
    showToast("تعذر نسخ الكود.", "error");
  }
}


/* ============================================================
   13 — تعطيل / تفعيل كود
   المرجع: بنود 75، 76، 92
   ============================================================ */

async function handleToggleStatus(codeId, newStatus) {
  const cleanId = safeText(codeId);
  if (!cleanId) return;

  const confirmText = newStatus === "disabled"
    ? "هل تريد تعطيل هذا الكود؟ لن يتمكن الطالب من الدخول به."
    : "هل تريد إعادة تفعيل هذا الكود؟";

  if (!window.confirm(confirmText)) return;

  // Optimistic UI
  const item = allCodes.find((c) => c && c.id === cleanId);
  if (!item) return;

  const oldStatus = item.status;
  item.status = newStatus;

  updateStats();
  renderCodes();

  const result = await workerFetch(`/api/admin/codes/${encodeURIComponent(cleanId)}`, {
    method: "PATCH",
    body: { status: newStatus }
  });

  if (!result || !result.success) {
    // rollback
    item.status = oldStatus;
    updateStats();
    renderCodes();

    const msg = (result && result.error && result.error.message) || "تعذر التحديث.";
    showToast(msg, "error");
    return;
  }

  showToast(
    newStatus === "disabled" ? "تم تعطيل الكود" : "تم تفعيل الكود",
    "success"
  );
}


/* ============================================================
   14 — إنشاء أكواد
   المرجع: بند 93
   ============================================================ */

function openCreateModal() {
  if (!createModalEl) return;

  // reset
  if (createCountEl) createCountEl.value = "10";
  if (createStageEl) createStageEl.value = "";
  if (createNoteEl)  createNoteEl.value = "";

  createModalEl.classList.add("is-open");
  createModalEl.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";

  setTimeout(() => {
    if (createCountEl) {
      createCountEl.focus();
      createCountEl.select();
    }
  }, 150);
}

function closeCreateModal() {
  if (!createModalEl) return;
  createModalEl.classList.remove("is-open");
  createModalEl.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

async function handleCreate() {
  if (isCreating) return;

  const count = Number(createCountEl ? createCountEl.value : 0);
  const stage = safeText(createStageEl ? createStageEl.value : "");
  const note  = safeText(createNoteEl ? createNoteEl.value : "");

  // تحقق
  if (!count || count < 1 || count > 500) {
    showToast("عدد الأكواد يجب أن يكون من 1 إلى 500.", "warning");
    return;
  }

  if (!stage) {
    showToast("اختر المرحلة الدراسية.", "warning");
    return;
  }

  isCreating = true;
  if (createConfirmBtn) {
    createConfirmBtn.disabled = true;
    createConfirmBtn.textContent = "جارٍ الإنشاء...";
  }

  const result = await workerFetch("/api/admin/codes/create", {
    method: "POST",
    body: {
      count,
      stage,
      note: note || null
    }
  });

  isCreating = false;
  if (createConfirmBtn) {
    createConfirmBtn.disabled = false;
    createConfirmBtn.textContent = "إنشاء";
  }

  if (!result || !result.success) {
    const code = (result && result.error && result.error.code) || ERRORS.SERVER_ERROR;
    const msg = (result && result.error && result.error.message) || ERROR_MESSAGES[code];

    if (code === ERRORS.UNAUTHORIZED) {
      showToast(ERROR_MESSAGES.UNAUTHORIZED, "warning");
      setTimeout(() => { window.location.href = "login.html"; }, 1500);
      return;
    }

    showToast(msg, "error");
    return;
  }

  // نجاح — نضيف الأكواد الجديدة
  const data = (result.data && typeof result.data === "object") ? result.data : {};
  const newCodes = Array.isArray(data.codes) ? data.codes : [];

  if (newCodes.length > 0) {
    // نضيفهم في الأول
    allCodes = [...newCodes, ...allCodes];

    // ملاحظة أمنية: كلمات المرور تُعرض في نافذة مخصصة
    // (تُنفَّذ في مرحلة التحسين لاحقًا) — الآن نعرض toast واضح
    showToast(
      `تم إنشاء ${newCodes.length} كود بنجاح. اعرضهم الآن من نافذة الكلمات.`,
      "success",
      5000
    );

    updateStats();
    renderCodes();
  }

  if (data.partial && data.message) {
    showToast(data.message, "warning", 9000);
  }

  closeCreateModal();
}


/* ============================================================
   15 — التصدير (CSV)
   المرجع: بند 162 (اختياري)
   ============================================================ */

function handleExport() {
  const list = getFilteredCodes();

  if (!list.length) {
    showToast("لا يوجد شيء للتصدير.", "warning");
    return;
  }

  const headers = ["الكود", "الحالة", "المرحلة", "الطالب", "التاريخ", "ملاحظة"];

  const rows = list.map((c) => {
    const status = STATUS_LABELS[safeText(c.status)] || { text: "" };
    return [
      safeText(c.code),
      status.text,
      STAGE_NAMES[safeText(c.stage)] || safeText(c.stage),
      safeText(c.studentName),
      formatDate(c.createdAt) || "",
      safeText(c.note)
    ];
  });

  const csv = [headers, ...rows]
    .map((row) => row.map(csvCell).join(","))
    .join("\n");

  // BOM لدعم العربية في Excel
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `codes-${Date.now()}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showToast("تم تصدير الملف ✅", "success");
}

function csvCell(text) {
  const value = String(text == null ? "" : text);
  const escaped = value.replace(/"/g, '""');
  return `"${escaped}"`;
}


/* ============================================================
   16 — ربط الأحداث
   ============================================================ */

function bindEvents() {
  // تحديث
  if (refreshBtn) refreshBtn.addEventListener("click", () => loadCodes());

  // إنشاء
  if (createBtn) createBtn.addEventListener("click", openCreateModal);
  if (createCancelBtn) createCancelBtn.addEventListener("click", closeCreateModal);
  if (createConfirmBtn) createConfirmBtn.addEventListener("click", handleCreate);

  // إغلاق عند النقر على overlay
  if (createModalEl) {
    createModalEl.addEventListener("click", (e) => {
      if (e.target === createModalEl) closeCreateModal();
    });
  }

  // Escape
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && createModalEl && createModalEl.classList.contains("is-open")) {
      closeCreateModal();
    }
  });

  // تصدير
  if (exportBtn) exportBtn.addEventListener("click", handleExport);

  // بحث (بـ debounce)
  if (searchInput) {
    const debounced = debounce((value) => {
      currentSearch = value || "";
      renderCodes();
    }, 300);

    searchInput.addEventListener("input", (e) => {
      debounced(e.target.value);
    });
  }

  // فلترة
  if (filtersEl) {
    filtersEl.querySelectorAll(".codes-filter").forEach((btn) => {
      btn.addEventListener("click", () => {
        const status = safeText(btn.dataset.status) || "all";
        if (status === currentFilter) return;

        currentFilter = status;

        // تحديث الـ UI
        filtersEl.querySelectorAll(".codes-filter").forEach((b) => {
          b.classList.toggle("is-active", b.dataset.status === status);
        });

        renderCodes();
      });
    });
  }

  // إعادة المحاولة
  if (retryBtn) retryBtn.addEventListener("click", () => loadCodes());

  // Enter في عدد الأكواد
  if (createCountEl) {
    createCountEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleCreate();
      }
    });
  }
}


/* ============================================================
   17 — التهيئة
   ============================================================ */

async function init() {
  // حماية
  const session = requireAdmin();
  if (!session) return;

  cacheElements();
  bindEvents();

  await loadCodes();
}


/* ============================================================
   18 — التشغيل
   ============================================================ */

onReady(init);