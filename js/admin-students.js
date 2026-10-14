/**
 * admin-students.js
 * ------------------------------------------------------------
 * منصة أ/ إسماعيل عماد التعليمية
 * تشغيل صفحة admin/students.html
 *
 * المكان: /js/admin-students.js
 *
 * المرجع:
 *   - الوثيقة الأصلية (بنود 77، 94، 107، 118، 138، 162، 163، 164)
 *   - Master Design System (بند 58)
 *
 * ⚠️ قواعد:
 *   - الحماية الحقيقية في Worker (بند 109).
 *   - الفلترة على الفرونت (بند 163).
 *   - البحث بـ debounce (بند 162).
 *   - لا نعرض بيانات الطالب لطالب آخر (بند 107).
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
  NOT_FOUND:     "NOT_FOUND"
};

const ERROR_MESSAGES = {
  NETWORK_ERROR: "لا يوجد اتصال بالإنترنت.",
  TIMEOUT:       "انتهت مدة الطلب.",
  SERVER_ERROR:  "حدث خطأ. حاول مرة أخرى.",
  UNAUTHORIZED:  "انتهت الجلسة.",
  NOT_FOUND:     "الطالب غير موجود."
};

const STAGE_NAMES = {
  grade_4: "الصف الرابع الابتدائي",
  grade_5: "الصف الخامس الابتدائي",
  grade_6: "الصف السادس الابتدائي",
  prep_1:  "الصف الأول الإعدادي",
  prep_2:  "الصف الثاني الإعدادي",
  prep_3:  "الصف الثالث الإعدادي",
  sec_1:   "الصف الأول الثانوي",
  sec_2:   "الصف الثاني الثانوي",
  sec_3:   "الصف الثالث الثانوي"
};

function getStageName(key) {
  const k = safeText(key);
  if (!k) return "—";
  return STAGE_NAMES[k] || k;
}

/**
 * تحديد المجموعة (ابتدائي / إعدادي / ثانوي).
 */
function getStageGroup(stageKey) {
  const k = safeText(stageKey);
  if (!k) return "";
  if (k.startsWith("grade_")) return "grade";
  if (k.startsWith("prep_"))  return "prep";
  if (k.startsWith("sec_"))   return "sec";
  return "";
}


/* ============================================================
   02 — المرجع للعناصر
   ============================================================ */

let headerSubEl      = null;
let refreshBtn       = null;

let statTotalEl      = null;
let statPrepEl       = null;
let statSecEl        = null;
let statGradeEl      = null;

let searchInput      = null;
let filtersEl        = null;

let skeletonEl       = null;
let listEl           = null;
let emptyEl          = null;
let errorEl          = null;
let retryBtn         = null;


/* ============================================================
   03 — الحالة
   ============================================================ */

let allStudents  = [];
let currentFilter = "all"; // all | grade | prep | sec
let currentSearch = "";
let isLoading = false;


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
  headerSubEl  = document.getElementById("studentsHeaderSub");
  refreshBtn   = document.getElementById("studentsRefreshBtn");

  statTotalEl  = document.getElementById("statStudentsTotal");
  statPrepEl   = document.getElementById("statStudentsPrep");
  statSecEl    = document.getElementById("statStudentsSec");
  statGradeEl  = document.getElementById("statStudentsGrade");

  searchInput  = document.getElementById("studentsSearchInput");
  filtersEl    = document.getElementById("studentsFilters");

  skeletonEl   = document.getElementById("studentsSkeleton");
  listEl       = document.getElementById("studentsList");
  emptyEl      = document.getElementById("studentsEmpty");
  errorEl      = document.getElementById("studentsError");
  retryBtn     = document.getElementById("studentsRetryBtn");
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
  const total = allStudents.length;
  const prep  = allStudents.filter((s) => getStageGroup(s && s.stage) === "prep").length;
  const sec   = allStudents.filter((s) => getStageGroup(s && s.stage) === "sec").length;
  const grade = allStudents.filter((s) => getStageGroup(s && s.stage) === "grade").length;

  if (statTotalEl) statTotalEl.textContent = String(total);
  if (statPrepEl)  statPrepEl.textContent  = String(prep);
  if (statSecEl)   statSecEl.textContent   = String(sec);
  if (statGradeEl) statGradeEl.textContent = String(grade);
}


/* ============================================================
   08 — الفلترة والبحث
   ============================================================ */

function getFilteredStudents() {
  let list = Array.isArray(allStudents) ? allStudents.slice() : [];

  // فلترة المرحلة
  if (currentFilter !== "all") {
    list = list.filter((s) => getStageGroup(s && s.stage) === currentFilter);
  }

  // البحث
  const q = safeText(currentSearch).toLowerCase();
  if (q) {
    list = list.filter((s) => {
      if (!s) return false;
      const name = safeText(s.fullName).toLowerCase();
      const code = safeText(s.code).toLowerCase();
      return name.includes(q) || code.includes(q);
    });
  }

  // ترتيب: الأحدث أولاً
  list.sort((a, b) => {
    const ta = toTime(a && a.joinedAt);
    const tb = toTime(b && b.joinedAt);
    return tb - ta;
  });

  return list;
}

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
   09 — بناء كارت الطالب
   المراجع: بنود 77، 94
   ============================================================ */

function createStudentCard(student) {
  const id        = safeText(student && student.id);
  const fullName  = safeText(student && student.fullName) || "طالب";
  const stage     = safeText(student && student.stage);
  const code      = safeText(student && student.code);
  const joinedAt  = student && student.joinedAt;

  const card = document.createElement("article");
  card.className = "student-card";
  card.dataset.studentId = id;

  // Avatar
  const avatar = document.createElement("div");
  avatar.className = "student-avatar";
  avatar.setAttribute("aria-hidden", "true");
  const initials = getInitials(fullName, 2);
  avatar.textContent = initials || "👤";

  // Body
  const body = document.createElement("div");
  body.className = "student-body";

  const nameEl = document.createElement("h3");
  nameEl.className = "student-name";
  nameEl.textContent = fullName;
  body.appendChild(nameEl);

  const meta = document.createElement("div");
  meta.className = "student-meta";

  if (stage) {
    const item = document.createElement("span");
    item.className = "student-meta-item";
    const icon = document.createElement("span");
    icon.textContent = "🎓";
    const text = document.createElement("span");
    text.textContent = getStageName(stage);
    item.appendChild(icon);
    item.appendChild(text);
    meta.appendChild(item);
  }

  if (code) {
    const item = document.createElement("span");
    item.className = "student-meta-item";
    const icon = document.createElement("span");
    icon.textContent = "🆔";
    const text = document.createElement("span");
    text.className = "num";
    text.textContent = code;
    item.appendChild(icon);
    item.appendChild(text);
    meta.appendChild(item);
  }

  if (joinedAt) {
    const item = document.createElement("span");
    item.className = "student-meta-item";
    const icon = document.createElement("span");
    icon.textContent = "📅";
    const text = document.createElement("span");
    text.textContent = formatDate(joinedAt) || "—";
    item.appendChild(icon);
    item.appendChild(text);
    meta.appendChild(item);
  }

  if (meta.childNodes.length > 0) {
    body.appendChild(meta);
  }

  // Action
  const actionBtn = document.createElement("button");
  actionBtn.type = "button";
  actionBtn.className = "student-action";
  actionBtn.textContent = "📄 الملف";
  actionBtn.addEventListener("click", () => openStudentModal(id));

  card.appendChild(avatar);
  card.appendChild(body);
  card.appendChild(actionBtn);

  return card;
}


/* ============================================================
   10 — عرض القائمة
   ============================================================ */

function renderStudents() {
  if (!listEl) return;

  const list = getFilteredStudents();

  if (list.length === 0) {
    // لو فيه بحث/فلترة → رسالة مختلفة
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
  list.forEach((student) => {
    listEl.appendChild(createStudentCard(student));
  });
  showList();
}


/* ============================================================
   11 — تحميل الطلاب
   المرجع: بند 94
   ============================================================ */

async function loadStudents() {
  if (isLoading) return;
  isLoading = true;

  showLoading();

  const result = await workerFetch("/api/admin/students");

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
  const list = Array.isArray(data.students) ? data.students : [];

  allStudents = list.filter((s) => s && s.id && s.fullName);

  if (headerSubEl) {
    headerSubEl.textContent = `${allStudents.length} طالب مسجّل`;
  }

  updateStats();
  renderStudents();
}


/* ============================================================
   12 — Modal ملف الطالب
   المرجع: بند 94
   ============================================================ */

let modalOverlay = null;

function ensureModal() {
  if (modalOverlay) return modalOverlay;

  const overlay = document.createElement("div");
  overlay.className = "adm-modal-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-hidden", "true");
  overlay.style.cssText = `
    position: fixed; inset: 0; z-index: 1000;
    display: flex; align-items: center; justify-content: center;
    padding: 20px; background: rgba(0,0,0,0.55);
    opacity: 0; visibility: hidden;
    transition: opacity 0.2s ease, visibility 0.2s ease;
  `;

  const modal = document.createElement("div");
  modal.style.cssText = `
    width: 100%; max-width: 440px; max-height: 88vh; overflow-y: auto;
    background: #FFFFFF; border-radius: 20px; padding: 22px 20px;
    box-shadow: 0 20px 50px rgba(0,0,0,0.28);
    transform: scale(0.95);
    transition: transform 0.2s ease;
  `;
  overlay.appendChild(modal);

  document.body.appendChild(overlay);

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeModal();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overlay.classList.contains("is-open")) {
      closeModal();
    }
  });

  modalOverlay = { overlay, modal };
  return modalOverlay;
}

function openModal() {
  const m = ensureModal();
  m.overlay.classList.add("is-open");
  m.overlay.setAttribute("aria-hidden", "false");
  m.modal.style.transform = "scale(1)";
  document.body.style.overflow = "hidden";
}

function closeModal() {
  if (!modalOverlay) return;
  modalOverlay.overlay.classList.remove("is-open");
  modalOverlay.overlay.setAttribute("aria-hidden", "true");
  modalOverlay.modal.style.transform = "scale(0.95)";
  document.body.style.overflow = "";
}

/**
 * عرض Modal بملف الطالب.
 * @param {string} studentId
 */
async function openStudentModal(studentId) {
  const cleanId = safeText(studentId);
  if (!cleanId) return;

  // 1) اعرض Modal مع Loading
  const m = ensureModal();
  m.modal.replaceChildren();

  const loading = document.createElement("div");
  loading.style.cssText = "text-align:center;padding:40px 0;";
  const spinner = document.createElement("div");
  spinner.className = "spinner";
  spinner.style.margin = "0 auto";
  const loadingText = document.createElement("p");
  loadingText.style.cssText = "margin-top:12px;font-size:13px;color:#777;";
  loadingText.textContent = "جارٍ التحميل...";
  loading.appendChild(spinner);
  loading.appendChild(loadingText);
  m.modal.appendChild(loading);

  openModal();

  // 2) جب تفاصيل الطالب
  const result = await workerFetch(`/api/admin/students/${encodeURIComponent(cleanId)}`);

  // لو فشل → نعرض رسالة
  if (!result || !result.success) {
    const msg = (result && result.error && result.error.message) || "تعذر تحميل بيانات الطالب.";
    m.modal.replaceChildren();

    const errBox = document.createElement("div");
    errBox.style.cssText = "text-align:center;padding:32px 20px;";
    errBox.innerHTML = "";

    const icon = document.createElement("div");
    icon.style.cssText = "font-size:36px;margin-bottom:10px;";
    icon.textContent = "⚠️";

    const title = document.createElement("h3");
    title.style.cssText = "margin:0 0 6px;font-size:16px;font-weight:800;color:var(--color-text);";
    title.textContent = "تعذر التحميل";

    const text = document.createElement("p");
    text.style.cssText = "margin:0;font-size:13px;color:#777;line-height:1.6;";
    text.textContent = msg;

    errBox.appendChild(icon);
    errBox.appendChild(title);
    errBox.appendChild(text);
    m.modal.appendChild(errBox);
    return;
  }

  // 3) اعرض البيانات
  const data = (result.data && typeof result.data === "object") ? result.data : {};
  const student = (data.student && typeof data.student === "object") ? data.student : {};
  const stats   = (data.stats && typeof data.stats === "object") ? data.stats : {};

  renderStudentModalContent(m.modal, student, stats);
}

function renderStudentModalContent(modal, student, stats) {
  modal.replaceChildren();

  const fullName = safeText(student.fullName) || "طالب";
  const stage    = safeText(student.stage);
  const code     = safeText(student.code);
  const joinedAt = student.joinedAt;

  // Header (Avatar + Name)
  const header = document.createElement("div");
  header.style.cssText = "text-align:center;margin-bottom:20px;";

  const avatar = document.createElement("div");
  avatar.style.cssText = `
    width:64px;height:64px;margin:0 auto 12px;
    display:flex;align-items:center;justify-content:center;
    border-radius:50%;background:var(--color-primary);
    color:#FFF;font-size:22px;font-weight:900;letter-spacing:1px;
  `;
  avatar.textContent = getInitials(fullName, 2) || "👤";

  const nameEl = document.createElement("h2");
  nameEl.style.cssText = "margin:0 0 6px;font-size:18px;font-weight:900;color:var(--color-text);";
  nameEl.textContent = fullName;

  const stageBadge = document.createElement("span");
  stageBadge.style.cssText = `
    display:inline-flex;align-items:center;gap:5px;
    padding:5px 12px;border-radius:999px;
    background:var(--color-purple-light);color:var(--color-purple-dark);
    font-size:12px;font-weight:700;
  `;
  const stageIcon = document.createElement("span");
  stageIcon.textContent = "🎓";
  const stageText = document.createElement("span");
  stageText.textContent = getStageName(stage);
  stageBadge.appendChild(stageIcon);
  stageBadge.appendChild(stageText);

  header.appendChild(avatar);
  header.appendChild(nameEl);
  header.appendChild(stageBadge);
  modal.appendChild(header);

  // Info rows
  const infoBox = document.createElement("div");
  infoBox.style.cssText = `
    padding:0 14px;margin-bottom:16px;
    background:var(--color-surface-soft);border-radius:14px;
  `;

  infoBox.appendChild(makeInfoRow("🆔", "الكود", code || "—", true));
  infoBox.appendChild(makeInfoRow("📅", "تاريخ الانضمام", formatDate(joinedAt) || "—", false));

  if (student.lastLogin) {
    infoBox.appendChild(makeInfoRow("🕐", "آخر دخول", formatDate(student.lastLogin) || "—", false));
  }

  modal.appendChild(infoBox);

  // Stats
  const statsTitle = document.createElement("h3");
  statsTitle.style.cssText = "margin:0 0 10px;font-size:14px;font-weight:800;color:var(--color-text);";
  statsTitle.textContent = "الإحصائيات";
  modal.appendChild(statsTitle);

  const statsGrid = document.createElement("div");
  statsGrid.style.cssText = "display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-bottom:16px;";

  statsGrid.appendChild(makeStatBox("📝", "اختبار", stats.attemptsCount || 0, "var(--color-primary)"));
  statsGrid.appendChild(makeStatBox("🎯", "إجابات صحيحة", stats.correctAnswers || 0, "var(--color-blue)"));
  statsGrid.appendChild(makeStatBox("⏱️", "ساعة مذاكرة", stats.studyHoursTotal || 0, "var(--color-yellow-dark)"));
  statsGrid.appendChild(makeStatBox("📚", "درس مكتمل", stats.completedLessons || 0, "var(--color-purple)"));

  modal.appendChild(statsGrid);

  // Average
  const avg = Math.max(0, Math.min(100, Math.round(Number(stats.averageScore) || 0)));
  const avgBox = document.createElement("div");
  avgBox.style.cssText = `
    padding:14px;margin-bottom:16px;
    background:var(--color-surface-soft);border-radius:14px;
  `;

  const avgHead = document.createElement("div");
  avgHead.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;";

  const avgLabel = document.createElement("span");
  avgLabel.style.cssText = "font-size:13px;font-weight:700;color:var(--color-text);";
  avgLabel.textContent = "متوسط الدرجات";

  const avgValue = document.createElement("span");
  avgValue.style.cssText = `
    font-family:Inter,sans-serif;font-size:18px;font-weight:900;
    color:var(--color-primary);direction:ltr;
  `;
  avgValue.textContent = `${avg}%`;

  avgHead.appendChild(avgLabel);
  avgHead.appendChild(avgValue);

  const avgBar = document.createElement("div");
  avgBar.style.cssText = "height:8px;border-radius:999px;background:var(--color-border);overflow:hidden;";
  const avgFill = document.createElement("div");
  avgFill.style.cssText = `height:100%;width:${avg}%;border-radius:999px;background:var(--color-primary);`;
  avgBar.appendChild(avgFill);

  avgBox.appendChild(avgHead);
  avgBox.appendChild(avgBar);
  modal.appendChild(avgBox);

  // Close Button
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.style.cssText = `
    width:100%;min-height:46px;
    border-radius:12px;border:none;
    background:var(--color-surface-soft);color:var(--color-text);
    font-family:Tajawal,sans-serif;font-size:14px;font-weight:800;
    cursor:pointer;
  `;
  closeBtn.textContent = "إغلاق";
  closeBtn.addEventListener("click", closeModal);
  modal.appendChild(closeBtn);
}

function makeInfoRow(icon, label, value, isMono) {
  const row = document.createElement("div");
  row.style.cssText = `
    display:flex;justify-content:space-between;align-items:center;
    padding:12px 0;border-bottom:1px solid var(--color-border);
  `;

  const labelEl = document.createElement("span");
  labelEl.style.cssText = "display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:#777;";

  const ic = document.createElement("span");
  ic.textContent = icon;
  ic.style.fontSize = "14px";

  const lt = document.createElement("span");
  lt.textContent = label;

  labelEl.appendChild(ic);
  labelEl.appendChild(lt);

  const valueEl = document.createElement("span");
  valueEl.style.cssText = `
    font-size:13px;font-weight:800;color:var(--color-text);
    ${isMono ? "font-family:Inter,sans-serif;direction:ltr;letter-spacing:0.5px;" : ""}
  `;
  valueEl.textContent = value;

  row.appendChild(labelEl);
  row.appendChild(valueEl);
  return row;
}

function makeStatBox(icon, label, value, color) {
  const box = document.createElement("div");
  box.style.cssText = `
    padding:12px;border-radius:12px;
    background:#FFF;border:1px solid var(--color-border);text-align:center;
  `;

  const ic = document.createElement("div");
  ic.style.fontSize = "18px";
  ic.textContent = icon;

  const val = document.createElement("div");
  val.style.cssText = `
    margin-top:4px;
    font-family:Inter,sans-serif;font-size:18px;font-weight:900;
    color:${color};direction:ltr;line-height:1.2;
  `;
  val.textContent = String(value);

  const lbl = document.createElement("div");
  lbl.style.cssText = "margin-top:2px;font-size:10px;font-weight:700;color:#777;";
  lbl.textContent = label;

  box.appendChild(ic);
  box.appendChild(val);
  box.appendChild(lbl);
  return box;
}


/* ============================================================
   13 — ربط الأحداث
   ============================================================ */

function bindEvents() {
  if (refreshBtn) refreshBtn.addEventListener("click", () => loadStudents());
  if (retryBtn)   retryBtn.addEventListener("click", () => loadStudents());

  // Search (بـ debounce)
  if (searchInput) {
    const debounced = debounce((value) => {
      currentSearch = value || "";
      renderStudents();
    }, 300);

    searchInput.addEventListener("input", (e) => {
      debounced(e.target.value);
    });
  }

  // Filters
  if (filtersEl) {
    filtersEl.querySelectorAll(".students-filter").forEach((btn) => {
      btn.addEventListener("click", () => {
        const stage = safeText(btn.dataset.stage) || "all";
        if (stage === currentFilter) return;

        currentFilter = stage;

        filtersEl.querySelectorAll(".students-filter").forEach((b) => {
          b.classList.toggle("is-active", b.dataset.stage === stage);
        });

        renderStudents();
      });
    });
  }
}


/* ============================================================
   14 — التهيئة
   ============================================================ */

async function init() {
  const session = requireAdmin();
  if (!session) return;

  cacheElements();
  bindEvents();

  await loadStudents();
}


/* ============================================================
   15 — التشغيل
   ============================================================ */

onReady(init);