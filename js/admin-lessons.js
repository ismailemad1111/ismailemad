/**
 * admin-lessons.js
 * ------------------------------------------------------------
 * منصة أ/ إسماعيل عماد التعليمية
 * تشغيل صفحة admin/lessons.html
 *
 * المكان: /js/admin-lessons.js
 *
 * المرجع:
 *   - الوثيقة الأصلية (بنود 31، 32، 33، 34، 80، 81، 98، 125)
 *   - Master Design System (بند 58)
 *
 * ⚠️ قواعد:
 *   - الحماية الحقيقية في Worker (بند 109).
 *   - التحقق من روابط YouTube (بند 125).
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
  extractYouTubeID,
  validateYouTubeURL
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
  NOT_FOUND:     "الدرس غير موجود.",
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


/* ============================================================
   02 — المرجع للعناصر
   ============================================================ */

let headerSubEl    = null;
let createBtn      = null;

let statsRowEl     = null;
let statAllEl      = null;
let statVideoEl    = null;
let statAudioEl    = null;

let searchInput    = null;
let stageFiltersEl = null;

let skeletonEl     = null;
let listEl         = null;
let emptyEl        = null;
let errorEl        = null;
let retryBtn       = null;

// Modal
let lsModalEl      = null;
let lsModalTitleEl = null;
let lsModalSubEl   = null;
let lsTitleInput   = null;
let lsKindSel      = null;
let lsStageSel     = null;
let lsUrlInput     = null;
let lsPreviewEl    = null;
let lsCancelBtn    = null;
let lsConfirmBtn   = null;


/* ============================================================
   03 — الحالة
   ============================================================ */

let allLessons = [];
let currentKind = "all";     // all | video | audio
let currentStage = "all";    // all | grade_4 | ...
let currentSearch = "";
let isLoading = false;

let editingId = null;
let isSaving = false;
let previewVideoId = null;


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
  headerSubEl    = document.getElementById("lsHeaderSub");
  createBtn      = document.getElementById("lsCreateBtn");

  statsRowEl     = document.getElementById("lsStats");
  statAllEl      = document.getElementById("statLsAll");
  statVideoEl    = document.getElementById("statLsVideo");
  statAudioEl    = document.getElementById("statLsAudio");

  searchInput    = document.getElementById("lsSearchInput");
  stageFiltersEl = document.getElementById("lsStageFilters");

  skeletonEl     = document.getElementById("lsSkeleton");
  listEl         = document.getElementById("lsList");
  emptyEl        = document.getElementById("lsEmpty");
  errorEl        = document.getElementById("lsError");
  retryBtn       = document.getElementById("lsRetryBtn");

  lsModalEl      = document.getElementById("lsModal");
  lsModalTitleEl = document.getElementById("lsModalTitle");
  lsModalSubEl   = document.getElementById("lsModalSub");
  lsTitleInput   = document.getElementById("lsTitleInput");
  lsKindSel      = document.getElementById("lsKindSelect");
  lsStageSel     = document.getElementById("lsStageSelect");
  lsUrlInput     = document.getElementById("lsUrlInput");
  lsPreviewEl    = document.getElementById("lsPreview");
  lsCancelBtn    = document.getElementById("lsCancelBtn");
  lsConfirmBtn   = document.getElementById("lsConfirmBtn");
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
  const total = allLessons.length;
  const video = allLessons.filter((l) => l && l.kind === "video").length;
  const audio = allLessons.filter((l) => l && l.kind === "audio").length;

  if (statAllEl)   statAllEl.textContent   = String(total);
  if (statVideoEl) statVideoEl.textContent = String(video);
  if (statAudioEl) statAudioEl.textContent = String(audio);
}


/* ============================================================
   08 — الفلترة والبحث
   ============================================================ */

function getFilteredLessons() {
  let list = Array.isArray(allLessons) ? allLessons.slice() : [];

  // فلترة النوع
  if (currentKind !== "all") {
    list = list.filter((l) => l && l.kind === currentKind);
  }

  // فلترة المرحلة
  if (currentStage !== "all") {
    list = list.filter((l) => l && l.stage === currentStage);
  }

  // البحث بالعنوان
  const q = safeText(currentSearch).toLowerCase();
  if (q) {
    list = list.filter((l) => {
      if (!l) return false;
      const title = safeText(l.title).toLowerCase();
      return title.includes(q);
    });
  }

  // ترتيب: الأحدث أولاً
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
   09 — بناء كارت الدرس
   ============================================================ */

function createLessonCard(lesson) {
  const id        = safeText(lesson && lesson.id);
  const title     = safeText(lesson && lesson.title) || "درس";
  const kind      = safeText(lesson && lesson.kind) || "video";
  const stage     = safeText(lesson && lesson.stage);
  const url       = safeText(lesson && lesson.youtubeUrl);
  const createdAt = lesson && lesson.createdAt;
  const videoId   = extractYouTubeID(url);

  const card = document.createElement("article");
  card.className = "lesson-card";
  card.dataset.lessonId = id;

  // ---------- Top ----------
  const top = document.createElement("div");
  top.className = "lesson-card-top";

  // Thumbnail
  const thumb = document.createElement("div");
  thumb.className = "lesson-thumb";

  if (kind === "video" && videoId) {
    const img = document.createElement("img");
    img.src = `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
    img.alt = title;
    img.loading = "lazy";
    img.referrerPolicy = "no-referrer";
    img.onerror = () => {
      // لو فشل تحميل الصورة → نعرض icon
      thumb.replaceChildren();
      const icon = document.createElement("div");
      icon.className = "lesson-thumb-icon";
      icon.textContent = "🎥";
      thumb.appendChild(icon);
    };
    thumb.appendChild(img);

    const playIcon = document.createElement("div");
    playIcon.className = "lesson-thumb-icon";
    playIcon.textContent = "▶️";
    playIcon.style.background = "transparent";
    playIcon.style.fontSize = "30px";
    playIcon.style.textShadow = "0 0 6px rgba(0,0,0,0.6)";
    thumb.appendChild(playIcon);

  } else {
    const icon = document.createElement("div");
    icon.className = "lesson-thumb-icon";
    icon.textContent = kind === "audio" ? "🎧" : "🎥";
    thumb.appendChild(icon);
  }

  // Body
  const body = document.createElement("div");
  body.className = "lesson-body";

  const titleEl = document.createElement("h3");
  titleEl.className = "lesson-title";
  titleEl.textContent = title;
  body.appendChild(titleEl);

  const badges = document.createElement("div");
  badges.className = "lesson-badges";

  const kindBadge = document.createElement("span");
  kindBadge.className = kind === "audio"
    ? "lesson-badge lesson-badge--kind-audio"
    : "lesson-badge lesson-badge--kind-video";
  kindBadge.textContent = kind === "audio" ? "🎧 صوت" : "🎥 فيديو";
  badges.appendChild(kindBadge);

  if (stage) {
    const sBadge = document.createElement("span");
    sBadge.className = "lesson-badge lesson-badge--stage";
    sBadge.textContent = getStageName(stage);
    badges.appendChild(sBadge);
  }

  body.appendChild(badges);

  if (createdAt) {
    const meta = document.createElement("div");
    meta.className = "lesson-meta";
    const item = document.createElement("span");
    item.className = "lesson-meta-item";
    const ic = document.createElement("span"); ic.textContent = "📅";
    const tx = document.createElement("span"); tx.textContent = formatDate(createdAt) || "—";
    item.appendChild(ic); item.appendChild(tx);
    meta.appendChild(item);
    body.appendChild(meta);
  }

  top.appendChild(thumb);
  top.appendChild(body);
  card.appendChild(top);

  // ---------- Actions ----------
  const actions = document.createElement("div");
  actions.className = "lesson-actions";

  // معاينة (فتح YouTube في تاب جديد)
  if (videoId) {
    const previewBtn = document.createElement("a");
    previewBtn.className = "lesson-action-btn lesson-action-btn--info";
    previewBtn.href = `https://www.youtube.com/watch?v=${videoId}`;
    previewBtn.target = "_blank";
    previewBtn.rel = "noopener noreferrer";
    previewBtn.textContent = "👁️ معاينة";
    actions.appendChild(previewBtn);
  }

  // تعديل
  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.className = "lesson-action-btn";
  editBtn.textContent = "✏️ تعديل";
  editBtn.addEventListener("click", () => openLessonModal(lesson));
  actions.appendChild(editBtn);

  // حذف
  const delBtn = document.createElement("button");
  delBtn.type = "button";
  delBtn.className = "lesson-action-btn lesson-action-btn--danger";
  delBtn.textContent = "🗑️ حذف";
  delBtn.addEventListener("click", () => handleDelete(id, title));
  actions.appendChild(delBtn);

  card.appendChild(actions);

  return card;
}


/* ============================================================
   10 — عرض القائمة
   ============================================================ */

function renderLessons() {
  if (!listEl) return;

  const list = getFilteredLessons();

  if (list.length === 0) {
    if (currentSearch || currentKind !== "all" || currentStage !== "all") {
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
  list.forEach((l) => listEl.appendChild(createLessonCard(l)));
  showList();
}


/* ============================================================
   11 — تحميل الدروس
   ============================================================ */

async function loadLessons() {
  if (isLoading) return;
  isLoading = true;

  showLoading();

  const result = await workerFetch("/api/admin/lessons");

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
  const list = Array.isArray(data.lessons) ? data.lessons : [];

  allLessons = list.filter((l) => l && l.id);

  if (headerSubEl) {
    headerSubEl.textContent = `${allLessons.length} درس`;
  }

  updateStats();
  renderLessons();
}


/* ============================================================
   12 — Preview
   ============================================================ */

function updatePreview() {
  if (!lsPreviewEl || !lsUrlInput) return;

  const url = safeText(lsUrlInput.value);
  const videoId = extractYouTubeID(url);

  lsPreviewEl.replaceChildren();

  if (!videoId) {
    previewVideoId = null;
    const placeholder = document.createElement("span");
    placeholder.setAttribute("aria-hidden", "true");
    placeholder.textContent = "🎬";
    lsPreviewEl.appendChild(placeholder);
    return;
  }

  previewVideoId = videoId;

  // Thumbnail preview (أسرع وأخف من iframe)
  const img = document.createElement("img");
  img.src = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
  img.alt = "معاينة الفيديو";
  img.style.width = "100%";
  img.style.height = "100%";
  img.style.objectFit = "cover";
  img.referrerPolicy = "no-referrer";
  img.onerror = () => {
    lsPreviewEl.replaceChildren();
    const placeholder = document.createElement("span");
    placeholder.setAttribute("aria-hidden", "true");
    placeholder.textContent = "🎬";
    lsPreviewEl.appendChild(placeholder);
  };
  lsPreviewEl.appendChild(img);
}


/* ============================================================
   13 — Create/Edit Modal
   ============================================================ */

function openLessonModal(existing) {
  if (!lsModalEl) return;

  editingId = existing ? safeText(existing.id) : null;

  // Reset
  if (lsTitleInput) lsTitleInput.value = existing ? safeText(existing.title) : "";
  if (lsKindSel)    lsKindSel.value    = existing ? safeText(existing.kind) : "video";
  if (lsStageSel)   lsStageSel.value   = existing ? safeText(existing.stage) : "";
  if (lsUrlInput)   lsUrlInput.value   = existing ? safeText(existing.youtubeUrl) : "";

  // Titles
  if (lsModalTitleEl) lsModalTitleEl.textContent = existing ? "تعديل الدرس" : "درس جديد";
  if (lsModalSubEl)   lsModalSubEl.textContent   = existing
    ? "عدّل بيانات الدرس ثم احفظ."
    : "سيظهر الدرس للطلاب حسب المرحلة.";

  if (lsConfirmBtn) lsConfirmBtn.textContent = existing ? "حفظ" : "إضافة";

  // Preview
  updatePreview();

  // فتح
  lsModalEl.classList.add("is-open");
  lsModalEl.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";

  setTimeout(() => {
    if (lsTitleInput) lsTitleInput.focus();
  }, 150);
}

function closeLessonModal() {
  if (!lsModalEl) return;
  lsModalEl.classList.remove("is-open");
  lsModalEl.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
  editingId = null;
  previewVideoId = null;
}


/* ============================================================
   14 — التحقق
   ============================================================ */

function collectLessonData() {
  const title = safeText(lsTitleInput ? lsTitleInput.value : "");
  const kind  = safeText(lsKindSel ? lsKindSel.value : "");
  const stage = safeText(lsStageSel ? lsStageSel.value : "");
  const url   = safeText(lsUrlInput ? lsUrlInput.value : "");

  const errors = {};

  if (!title) {
    errors.title = "من فضلك أدخل عنوان الدرس.";
  } else if (title.length > 150) {
    errors.title = "العنوان طويل جدًا.";
  }

  if (!kind || !["video", "audio"].includes(kind)) {
    errors.kind = "نوع الدرس غير صحيح.";
  }

  if (!stage) {
    errors.stage = "من فضلك اختر المرحلة.";
  }

  if (!url) {
    errors.url = "من فضلك أدخل رابط YouTube.";
  } else if (!validateYouTubeURL(url)) {
    errors.url = "الرابط ليس رابط YouTube صحيحًا.";
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    data: {
      title,
      kind,
      stage,
      youtubeUrl: url
    }
  };
}


/* ============================================================
   15 — حفظ (إنشاء / تعديل)
   ============================================================ */

async function handleSaveLesson() {
  if (isSaving) return;

  const { valid, errors, data } = collectLessonData();

  if (!valid) {
    const firstError = Object.values(errors)[0];
    showToast(firstError || "تحقق من البيانات.", "warning");
    return;
  }

  isSaving = true;
  if (lsConfirmBtn) {
    lsConfirmBtn.disabled = true;
    lsConfirmBtn.textContent = editingId ? "جارٍ الحفظ..." : "جارٍ الإضافة...";
  }

  let result;
  if (editingId) {
    result = await workerFetch(`/api/admin/lessons/${encodeURIComponent(editingId)}`, {
      method: "PATCH",
      body: data
    });
  } else {
    result = await workerFetch("/api/admin/lessons", {
      method: "POST",
      body: data
    });
  }

  isSaving = false;
  if (lsConfirmBtn) {
    lsConfirmBtn.disabled = false;
    lsConfirmBtn.textContent = editingId ? "حفظ" : "إضافة";
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
  const savedItem = (result.data && result.data.lesson) ? result.data.lesson : null;

  if (savedItem && savedItem.id) {
    if (editingId) {
      const idx = allLessons.findIndex((l) => l && l.id === editingId);
      if (idx >= 0) allLessons[idx] = savedItem;
    } else {
      allLessons.unshift(savedItem);
    }
  }

  updateStats();
  renderLessons();
  closeLessonModal();

  showToast(editingId ? "تم الحفظ ✅" : "تمت الإضافة ✅", "success");
}


/* ============================================================
   16 — حذف درس
   ============================================================ */

async function handleDelete(id, title) {
  const cleanId = safeText(id);
  if (!cleanId) return;

  const confirmed = window.confirm(`متأكد من حذف الدرس: "${title}"؟`);
  if (!confirmed) return;

  const result = await workerFetch(`/api/admin/lessons/${encodeURIComponent(cleanId)}`, {
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

  allLessons = allLessons.filter((l) => l && l.id !== cleanId);
  updateStats();
  renderLessons();

  showToast("تم الحذف", "success");
}


/* ============================================================
   17 — Stats Row Clickable
   ============================================================ */

function bindStatsClick() {
  if (!statsRowEl) return;

  statsRowEl.querySelectorAll(".ls-stat").forEach((stat) => {
    stat.addEventListener("click", () => {
      const kind = safeText(stat.dataset.kind) || "all";
      if (kind === currentKind) return;

      currentKind = kind;

      statsRowEl.querySelectorAll(".ls-stat").forEach((s) => {
        s.classList.toggle("is-active", s.dataset.kind === kind);
      });

      renderLessons();
    });
  });
}


/* ============================================================
   18 — Stage Filters
   ============================================================ */

function bindStageFilters() {
  if (!stageFiltersEl) return;

  stageFiltersEl.querySelectorAll(".ls-filter").forEach((btn) => {
    btn.addEventListener("click", () => {
      const stage = safeText(btn.dataset.stage) || "all";
      if (stage === currentStage) return;

      currentStage = stage;

      stageFiltersEl.querySelectorAll(".ls-filter").forEach((b) => {
        b.classList.toggle("is-active", b.dataset.stage === stage);
      });

      renderLessons();
    });
  });
}


/* ============================================================
   19 — ربط الأحداث
   ============================================================ */

function bindEvents() {
  if (createBtn) createBtn.addEventListener("click", () => openLessonModal(null));
  if (retryBtn)  retryBtn.addEventListener("click", () => loadLessons());

  // Search (بـ debounce)
  if (searchInput) {
    const debounced = debounce((value) => {
      currentSearch = value || "";
      renderLessons();
    }, 300);

    searchInput.addEventListener("input", (e) => {
      debounced(e.target.value);
    });
  }

  // Modal actions
  if (lsCancelBtn)  lsCancelBtn.addEventListener("click", closeLessonModal);
  if (lsConfirmBtn) lsConfirmBtn.addEventListener("click", handleSaveLesson);

  if (lsModalEl) {
    lsModalEl.addEventListener("click", (e) => {
      if (e.target === lsModalEl) closeLessonModal();
    });
  }

  // Preview live update
  if (lsUrlInput) {
    lsUrlInput.addEventListener("input", debounce(updatePreview, 300));
  }

  // Escape
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && lsModalEl && lsModalEl.classList.contains("is-open")) {
      closeLessonModal();
    }
  });

  // Bind filters
  bindStatsClick();
  bindStageFilters();
}


/* ============================================================
   20 — التهيئة
   ============================================================ */

async function init() {
  const session = requireAdmin();
  if (!session) return;

  cacheElements();
  bindEvents();

  await loadLessons();
}


/* ============================================================
   21 — التشغيل
   ============================================================ */

onReady(init);