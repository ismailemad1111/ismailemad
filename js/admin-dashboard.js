/**
 * admin-dashboard.js
 * ------------------------------------------------------------
 * منصة أ/ إسماعيل عماد التعليمية
 * تشغيل صفحة admin/index.html
 *
 * المكان: /js/admin-dashboard.js
 *
 * المرجع:
 *   - الوثيقة الأصلية (بنود 89، 91، 102، 104، 106، 114، 130)
 *   - Master Design System (بنود 34، 38، 58)
 *
 * ⚠️ قواعد:
 *   - الصفحة محمية بـ requireAdmin (للـ UX).
 *   - الحماية الحقيقية في Worker (بند 109).
 *   - البيانات من Worker (بند 102).
 *   - مفيش fake data (بند 165).
 *
 * ⚠️ حالة الملف:
 *   - WORKER_URL = PLACEHOLDER_WORKER_URL (البند 207).
 *   - workerFetch سترجع NETWORK_ERROR حتى بناء الـ Worker.
 *   - الإحصائيات ستظهر بأصفار.
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
  formatDate
} from "./helpers.js";

import {
  requireAdmin,
  getSession,
  logout
} from "./router.js";


/* ============================================================
   01 — ثوابت
   ============================================================ */

const REQUEST_TIMEOUT_MS = 15000;

const ERRORS = {
  NETWORK_ERROR: "NETWORK_ERROR",
  TIMEOUT:       "TIMEOUT",
  SERVER_ERROR:  "SERVER_ERROR",
  UNAUTHORIZED:  "UNAUTHORIZED"
};

const ERROR_MESSAGES = {
  NETWORK_ERROR: "لا يوجد اتصال بالإنترنت. حاول مرة أخرى.",
  TIMEOUT:       "انتهت مدة الطلب. حاول مرة أخرى.",
  SERVER_ERROR:  "حدث خطأ. حاول مرة أخرى.",
  UNAUTHORIZED:  "انتهت الجلسة. من فضلك سجّل الدخول مرة أخرى."
};


/* ============================================================
   02 — المرجع للعناصر
   ============================================================ */

let headerSubEl         = null;
let greetingEl          = null;
let dateEl              = null;
let logoutBtn           = null;

let statsSkeletonEl     = null;
let statsGridEl         = null;

let statStudentsEl      = null;
let statCodesEl         = null;
let statRequestsEl      = null;
let statRequestsBadgeEl = null;
let statAnnouncementsEl = null;
let statExamsEl         = null;
let statResultsEl       = null;


/* ============================================================
   03 — الحالة
   ============================================================ */

let isLoading = false;


/* ============================================================
   04 — طلب HTTP موحد (مؤقت — سيُدمج في api.js لاحقًا)
   ============================================================ */

/**
 * إرسال طلب إلى الـ Worker.
 * @param {string} endpoint
 * @param {Object} options
 * @returns {Promise<Object>}
 */
import { backendRequest } from "./backend/index.js";
async function workerFetch(endpoint, options = {}) {
  // بدون Worker: التنفيذ داخل المتصفح عبر Firestore (js/backend/)
  return backendRequest(endpoint, options);
}


/* ============================================================
   05 — تجميع العناصر
   ============================================================ */

function cacheElements() {
  headerSubEl         = document.getElementById("admHeaderSub");
  greetingEl          = document.getElementById("admGreeting");
  dateEl              = document.getElementById("admDate");
  logoutBtn           = document.getElementById("admLogoutBtn");

  statsSkeletonEl     = document.getElementById("admStatsSkeleton");
  statsGridEl         = document.getElementById("admStatsGrid");

  statStudentsEl      = document.getElementById("admStatStudents");
  statCodesEl         = document.getElementById("admStatCodes");
  statRequestsEl      = document.getElementById("admStatRequests");
  statRequestsBadgeEl = document.getElementById("admStatRequestsBadge");
  statAnnouncementsEl = document.getElementById("admStatAnnouncements");
  statExamsEl         = document.getElementById("admStatExams");
  statResultsEl       = document.getElementById("admStatResults");
}


/* ============================================================
   06 — Welcome
   ============================================================ */

/**
 * تحية حسب الوقت.
 */
function getGreeting() {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12)  return "صباح الخير ☀️";
  if (hour >= 12 && hour < 17) return "مساء الخير 🌤️";
  if (hour >= 17 && hour < 21) return "مساء الخير 🌆";
  return "تصبح على خير 🌙";
}

function renderWelcome() {
  const session = getSession();
  const admin = (session && session.admin) ? session.admin : null;

  const adminName = (admin && admin.name) ? safeText(admin.name).split(/\s+/)[0] : "";

  const greeting = getGreeting();
  if (greetingEl) {
    greetingEl.textContent = adminName
      ? `${greeting}، ${adminName}`
      : greeting;
  }

  if (dateEl) {
    const today = new Date();
    try {
      dateEl.textContent = today.toLocaleDateString("ar-EG", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric"
      });
    } catch (e) {
      dateEl.textContent = "";
    }
  }

  // Header sub
  if (headerSubEl && adminName) {
    headerSubEl.textContent = `مرحبًا، ${adminName}`;
  }
}


/* ============================================================
   07 — إدارة حالات العرض
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
   08 — عرض الإحصائيات
   المرجع: الوثيقة الأصلية — بند 102
   ============================================================ */

/**
 * تعبئة الإحصائيات.
 * @param {Object} stats
 */
function renderStats(stats) {
  const data = (stats && typeof stats === "object") ? stats : {};

  const students      = Number(data.studentsCount)      || 0;
  const codes         = Number(data.codesCount)         || 0;
  const requests      = Number(data.requestsCount)      || 0;
  const pendingReqs   = Number(data.pendingRequests)    || 0;
  const announcements = Number(data.announcementsCount) || 0;
  const exams         = Number(data.examsCount)         || 0;
  const results       = Number(data.attemptsCount)      || 0;

  if (statStudentsEl)      statStudentsEl.textContent      = String(students);
  if (statCodesEl)         statCodesEl.textContent         = String(codes);
  if (statRequestsEl)      statRequestsEl.textContent      = String(requests);
  if (statAnnouncementsEl) statAnnouncementsEl.textContent = String(announcements);
  if (statExamsEl)         statExamsEl.textContent         = String(exams);
  if (statResultsEl)       statResultsEl.textContent       = String(results);

  // Badge على طلبات الاشتراك
  if (statRequestsBadgeEl) {
    if (pendingReqs > 0) {
      statRequestsBadgeEl.textContent = pendingReqs > 99 ? "99+" : String(pendingReqs);
      statRequestsBadgeEl.style.display = "";
    } else {
      statRequestsBadgeEl.style.display = "none";
    }
  }

  showStatsGrid();
}


/* ============================================================
   09 — تحميل الإحصائيات
   ============================================================ */

async function loadStats() {
  if (isLoading) return;
  isLoading = true;

  showStatsSkeleton();

  const result = await workerFetch("/api/admin/statistics?scope=summary");

  isLoading = false;

  // فشل → أصفار
  if (!result || !result.success) {
    const code = (result && result.error && result.error.code) || ERRORS.SERVER_ERROR;

    // لو 401 → يخرج
    if (code === ERRORS.UNAUTHORIZED) {
      showToast(ERROR_MESSAGES.UNAUTHORIZED, "warning");
      setTimeout(() => logout("admin"), 1500);
      return;
    }

    // غير كده → أصفار
    renderStats(null);

    const msg = (result && result.error && result.error.message)
      || ERROR_MESSAGES[code]
      || ERROR_MESSAGES.SERVER_ERROR;

    if (code === ERRORS.NETWORK_ERROR || code === ERRORS.SERVER_ERROR) {
      showToast(msg, "error");
    }
    return;
  }

  // نجاح
  const data = (result.data && typeof result.data === "object") ? result.data : {};
  renderStats(data.stats || data);
}


/* ============================================================
   10 — تسجيل الخروج
   المرجع: الوثيقة الأصلية — بند 106
   ============================================================ */

function handleLogout() {
  const confirmed = window.confirm("هل تريد تسجيل الخروج من لوحة التحكم؟");
  if (!confirmed) return;

  try {
    logout("admin");
  } catch (e) {
    showToast("تعذر تسجيل الخروج. حاول مرة أخرى.", "error");
  }
}


/* ============================================================
   11 — ربط الأحداث
   ============================================================ */

function bindEvents() {
  if (logoutBtn) {
    logoutBtn.addEventListener("click", handleLogout);
  }
}


/* ============================================================
   12 — التهيئة
   ============================================================ */

async function init() {
  // حماية
  const session = requireAdmin();
  if (!session) return;

  cacheElements();

  // 1) الترحيب
  renderWelcome();

  // 2) ربط الأحداث
  bindEvents();

  // 3) تحميل الإحصائيات
  await loadStats();
}


/* ============================================================
   13 — التشغيل
   ============================================================ */

onReady(init);