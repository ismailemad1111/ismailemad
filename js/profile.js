/**
 * profile.js
 * ------------------------------------------------------------
 * منصة أ/ إسماعيل عماد التعليمية
 * تشغيل صفحة profile.html
 *
 * المكان: /js/profile.js
 *
 * المرجع:
 *   - الوثيقة الأصلية (بنود 67، 68، 69، 70، 71، 104، 106، 138، 165)
 *   - Master Design System (بنود 30، 31، 32، 38)
 *
 * ⚠️ قواعد:
 *   - الصفحة Read-only (بند 71).
 *   - البيانات الأساسية من sessionStorage (بند 104).
 *   - الإحصائيات من Worker.
 *   - مفيش fake data (بند 165).
 *
 * ⚠️ حالة الملف:
 *   - WORKER_URL = PLACEHOLDER_WORKER_URL (البند 207).
 *   - getStudentProfile سترجع NETWORK_ERROR حتى بناء الـ Worker.
 *   - الإحصائيات ستظهر بأصفار.
 * ------------------------------------------------------------
 */

import {
  onReady,
  safeText,
  showToast,
  formatDate,
  getInitials
} from "./helpers.js";

import {
  requireStudent,
  logout
} from "./router.js";

import { getCurrentStudent } from "./auth.js";

import { getStudentProfile } from "./api.js";

import { renderBottomNav } from "./components.js";


/* ============================================================
   01 — المرجع للعناصر
   ============================================================ */

let subtitleEl         = null;

let avatarEl           = null;
let nameEl             = null;
let stageTextEl        = null;

let codeEl             = null;
let joinDateEl         = null;
let accountStatusEl    = null;

let statsSkeletonEl    = null;
let statsGridEl        = null;

let statAttemptsEl     = null;
let statCorrectEl      = null;
let statStudyHoursEl   = null;
let statLessonsEl      = null;

let averageValueEl     = null;
let averageFillEl      = null;

let logoutBtnEl        = null;
let bottomNavSlot      = null;


/* ============================================================
   02 — أسماء المراحل
   ============================================================ */

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
  if (!k) return "";
  return STAGE_NAMES[k] || k;
}


/* ============================================================
   03 — تجميع العناصر
   ============================================================ */

function cacheElements() {
  subtitleEl       = document.getElementById("pfSubtitle");

  avatarEl         = document.getElementById("pfAvatar");
  nameEl           = document.getElementById("pfName");
  stageTextEl      = document.getElementById("pfStageText");

  codeEl           = document.getElementById("pfCode");
  joinDateEl       = document.getElementById("pfJoinDate");
  accountStatusEl  = document.getElementById("pfAccountStatus");

  statsSkeletonEl  = document.getElementById("pfStatsSkeleton");
  statsGridEl      = document.getElementById("pfStatsGrid");

  statAttemptsEl   = document.getElementById("pfStatAttempts");
  statCorrectEl    = document.getElementById("pfStatCorrect");
  statStudyHoursEl = document.getElementById("pfStatStudyHours");
  statLessonsEl    = document.getElementById("pfStatLessons");

  averageValueEl   = document.getElementById("pfAverageValue");
  averageFillEl    = document.getElementById("pfAverageFill");

  logoutBtnEl      = document.getElementById("pfLogoutBtn");
  bottomNavSlot    = document.getElementById("bottomNavSlot");
}


/* ============================================================
   04 — Profile Card
   المرجع: الوثيقة الأصلية — بنود 68، 69
   ⚠️ البيانات هنا من sessionStorage — للعرض فقط (بند 104).
   ============================================================ */

function renderProfileHeader(student) {
  if (!student) return;

  const fullName = safeText(student.fullName);
  const stageKey = safeText(student.stage);
  const code     = safeText(student.code);

  // الاسم
  if (nameEl) {
    nameEl.textContent = fullName || "—";
  }

  // Avatar — أول حرفين
  if (avatarEl) {
    const initials = getInitials(fullName, 2);
    if (initials) {
      avatarEl.textContent = initials;
    } else {
      {
      const g = document.createElement("span");
      g.className = "icon icon-user";
      g.setAttribute("aria-hidden", "true");
      avatarEl.replaceChildren(g);
    }
    }
  }

  // المرحلة
  if (stageTextEl) {
    const stageName = getStageName(stageKey);
    stageTextEl.textContent = stageName || "—";
  }

  // الكود
  if (codeEl) {
    codeEl.textContent = code || "—";
  }

  // Subtitle
  if (subtitleEl && fullName) {
    subtitleEl.textContent = `أهلاً، ${fullName.split(/\s+/)[0]}`;
  }
}


/* ============================================================
   05 — حالات العرض
   المرجع: Master Design System — بند 34
   ============================================================ */

function showStatsSkeleton() {
  if (statsSkeletonEl) statsSkeletonEl.style.display = "";
  if (statsGridEl)     statsGridEl.style.display = "none";
}

function showStatsGrid() {
  if (statsSkeletonEl) statsSkeletonEl.style.display = "none";
  if (statsGridEl)     statsGridEl.style.display = "";
}


/* ============================================================
   06 — عرض الإحصائيات
   المرجع: الوثيقة الأصلية — بنود 70، 138
   ⚠️ مفيش fake data (بند 165). القيم الافتراضية = 0.
   ============================================================ */

/**
 * تعبئة الإحصائيات.
 * @param {Object} data - من Worker
 */
function renderStats(data) {
  const stats = (data && typeof data === "object") ? data : {};

  const attempts   = Number(stats.attemptsCount)    || 0;
  const correct    = Number(stats.correctAnswers)   || 0;
  const studyHours = Number(stats.studyHoursTotal)  || 0;
  const lessons    = Number(stats.completedLessons) || 0;
  const avg        = Number(stats.averageScore)     || 0;

  if (statAttemptsEl)   statAttemptsEl.textContent   = String(attempts);
  if (statCorrectEl)    statCorrectEl.textContent    = String(correct);
  if (statStudyHoursEl) statStudyHoursEl.textContent = formatHours(studyHours);
  if (statLessonsEl)    statLessonsEl.textContent    = String(lessons);

  // Average
  const safeAvg = Math.max(0, Math.min(100, Math.round(avg)));

  if (averageValueEl) averageValueEl.textContent = `${safeAvg}%`;
  if (averageFillEl)  averageFillEl.style.width  = `${safeAvg}%`;

  showStatsGrid();
}

/**
 * تنسيق ساعات المذاكرة (يقبل كسور).
 * @param {number} hours
 * @returns {string}
 */
function formatHours(hours) {
  const h = Number(hours) || 0;
  if (h === 0) return "0";
  if (Number.isInteger(h)) return String(h);
  return h.toFixed(1);
}


/* ============================================================
   07 — حساب fallback من الاسم لو الـ sessionStorage فاضي
   ============================================================ */

/**
 * يبني كائن student من جلسة العرض.
 * @param {Object|null} session
 * @returns {Object|null}
 */
function buildStudentFromSession(session) {
  if (!session) return null;

  // 1) أولوية: من getCurrentStudent (auth.js)
  const current = getCurrentStudent();
  if (current && (current.fullName || current.code || current.stage)) {
    return current;
  }

  // 2) بديل: من session.student
  if (session.student && typeof session.student === "object") {
    return session.student;
  }

  return null;
}


/* ============================================================
   08 — تحميل البروفايل والإحصائيات
   ============================================================ */

async function loadProfile() {
  showStatsSkeleton();

  const result = await getStudentProfile();

  // لو فشل — نعرض أصفار
  if (!result || !result.success) {
    renderStats(null);
    return;
  }

  const data = (result.data && typeof result.data === "object") ? result.data : {};

  // لو الـ Worker رجّع student (بيانات إضافية) → نحدّث الـ header
  if (data.student && typeof data.student === "object") {
    renderProfileHeader(data.student);
  }

  // إحصائيات
  renderStats(data.stats || data);

  // لو الـ Worker رجّع تاريخ الانضمام → نحدّثه
  if (data.joinedAt && joinDateEl) {
    const formatted = formatDate(data.joinedAt);
    if (formatted) joinDateEl.textContent = formatted;
  }

  // حالة الحساب
  if (accountStatusEl && data.status) {
    const s = safeText(data.status);
    if (s === "active")        accountStatusEl.textContent = "نشط";
    else if (s === "disabled") accountStatusEl.textContent = "معطّل";
    else                       accountStatusEl.textContent = s;
  }
}


/* ============================================================
   09 — تاريخ الانضمام (fallback)
   ============================================================ */

function renderJoinDateFallback(student) {
  if (!joinDateEl) return;
  const raw = student && student.joinedAt;
  const formatted = formatDate(raw);
  if (formatted) {
    joinDateEl.textContent = formatted;
  } else {
    joinDateEl.textContent = "—";
  }
}

function renderAccountStatusFallback() {
  if (!accountStatusEl) return;
  // الحالة الافتراضية للطالب المسجّل = نشط
  accountStatusEl.textContent = "نشط";
}


/* ============================================================
   10 — Bottom Navigation
   ============================================================ */

function mountBottomNav() {
  if (!bottomNavSlot) return;
  bottomNavSlot.replaceChildren();
  bottomNavSlot.appendChild(renderBottomNav());
}


/* ============================================================
   11 — تسجيل الخروج
   المرجع: الوثيقة الأصلية — بند 106
   ============================================================ */

function handleLogout() {
  const confirmed = window.confirm("هل تريد تسجيل الخروج من المنصة؟");
  if (!confirmed) return;

  try {
    logout("student");
  } catch (e) {
    showToast("تعذر تسجيل الخروج. حاول مرة أخرى.", "error");
  }
}


/* ============================================================
   12 — ربط الأحداث
   ============================================================ */

function bindEvents() {
  if (logoutBtnEl) {
    logoutBtnEl.addEventListener("click", handleLogout);
  }
}


/* ============================================================
   13 — التهيئة
   ============================================================ */

async function init() {
  // الحماية
  const session = requireStudent();
  if (!session) return;

  cacheElements();

  // 1) بناء Bottom Nav
  mountBottomNav();

  // 2) ربط الأحداث
  bindEvents();

  // 3) عرض البروفايل من sessionStorage
  const student = buildStudentFromSession(session);
  if (student) {
    renderProfileHeader(student);
    renderJoinDateFallback(student);
  } else if (nameEl) {
    nameEl.textContent = "—";
    if (avatarEl) {
      const g = document.createElement("span");
      g.className = "icon icon-user";
      g.setAttribute("aria-hidden", "true");
      avatarEl.replaceChildren(g);
    }
  }

  // 4) حالة الحساب الافتراضية
  renderAccountStatusFallback();

  // 5) تحميل الإحصائيات من Worker
  await loadProfile();
}


/* ============================================================
   14 — التشغيل
   ============================================================ */

onReady(init);