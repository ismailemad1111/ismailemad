/**
 * admin-statistics.js
 * ------------------------------------------------------------
 * منصة أ/ إسماعيل عماد التعليمية
 * تشغيل صفحة admin/statistics.html
 *
 * المكان: /js/admin-statistics.js
 *
 * المرجع:
 *   - الوثيقة الأصلية (بنود 102، 138، 175)
 *   - Master Design System (بند 58)
 *
 * ⚠️ قواعد:
 *   - الإحصائيات من بيانات حقيقية (بند 102).
 *   - مفيش fake data (بند 165).
 *   - الحماية الحقيقية في Worker (بند 109).
 *
 * ⚠️ حالة الملف:
 *   - WORKER_URL = PLACEHOLDER_WORKER_URL (البند 207).
 *   - workerFetch سترجع NETWORK_ERROR حتى بناء الـ Worker.
 * ------------------------------------------------------------
 */


import {
  onReady,
  safeText,
  showToast
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
  UNAUTHORIZED:  "UNAUTHORIZED"
};

const ERROR_MESSAGES = {
  NETWORK_ERROR: "لا يوجد اتصال بالإنترنت.",
  TIMEOUT:       "انتهت مدة الطلب.",
  SERVER_ERROR:  "حدث خطأ. حاول مرة أخرى.",
  UNAUTHORIZED:  "انتهت الجلسة."
};

const STAGE_KEYS = [
  "grade_4", "grade_5", "grade_6",
  "prep_1",  "prep_2",  "prep_3",
  "sec_1",   "sec_2",   "sec_3"
];

const STAGE_NAMES = {
  grade_4: "الرابع الابتدائي",
  grade_5: "الخامس الابتدائي",
  grade_6: "السادس الابتدائي",
  prep_1:   "الأول الإعدادي",
  prep_2:  "الثاني الإعدادي",
  prep_3:  "الثالث الإعدادي",
  sec_1:   "الأول الثانوي",
  sec_2:   "الثاني الثانوي",
  sec_3:   "الثالث الثانوي"
};

/** ألوان المراحل */
const STAGE_COLORS = {
  grade_4: "blue",
  grade_5: "blue",
  grade_6: "blue",
  prep_1:  "green",
  prep_2:  "green",
  prep_3:  "green",
  sec_1:   "purple",
  sec_2:   "purple",
  sec_3:   "purple"
};


/* ============================================================
   02 — المرجع للعناصر
   ============================================================ */

let headerSubEl    = null;
let refreshBtn     = null;

let skeletonEl     = null;
let errorEl        = null;
let retryBtn       = null;
let contentEl      = null;

let mainStatsEl    = null;
let stageDistEl    = null;
let perfCardEl     = null;
let topListEl      = null;
let usageCardEl    = null;


/* ============================================================
   03 — الحالة
   ============================================================ */

let stats = {};
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
  headerSubEl = document.getElementById("statHeaderSub");
  refreshBtn  = document.getElementById("statRefreshBtn");

  skeletonEl  = document.getElementById("statSkeleton");
  errorEl     = document.getElementById("statError");
  retryBtn    = document.getElementById("statRetryBtn");
  contentEl   = document.getElementById("statContent");

  mainStatsEl = document.getElementById("mainStats");
  stageDistEl = document.getElementById("stageDistribution");
  perfCardEl  = document.getElementById("performanceCard");
  topListEl   = document.getElementById("topStudents");
  usageCardEl = document.getElementById("usageCard");
}


/* ============================================================
   06 — حالات الصفحة
   ============================================================ */

function showLoading() {
  if (skeletonEl) skeletonEl.style.display = "";
  if (errorEl)    errorEl.style.display = "none";
  if (contentEl)  contentEl.style.display = "none";
}

function showContent() {
  if (skeletonEl) skeletonEl.style.display = "none";
  if (errorEl)    errorEl.style.display = "none";
  if (contentEl)  contentEl.style.display = "";
}

function showError() {
  if (skeletonEl) skeletonEl.style.display = "none";
  if (errorEl)    errorEl.style.display = "";
  if (contentEl)  contentEl.style.display = "none";
}


/* ============================================================
   07 — أدوات مساعدة
   ============================================================ */

function num(v) {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

function createMainStat({ icon, color, value, label, suffix }) {
  const box = document.createElement("div");
  box.className = "main-stat";

  const head = document.createElement("div");
  head.className = "main-stat-head";

  const iconBox = document.createElement("div");
  iconBox.className = `main-stat-icon main-stat-icon--${color}`;
  iconBox.setAttribute("aria-hidden", "true");
  iconBox.textContent = icon;

  head.appendChild(iconBox);
  box.appendChild(head);

  const valueRow = document.createElement("div");
  valueRow.style.cssText = "display:flex;align-items:baseline;";

  const valueEl = document.createElement("span");
  valueEl.className = "main-stat-value";
  valueEl.textContent = String(value);
  valueRow.appendChild(valueEl);

  if (suffix) {
    const suffixEl = document.createElement("span");
    suffixEl.className = "main-stat-suffix";
    suffixEl.textContent = suffix;
    valueRow.appendChild(suffixEl);
  }

  box.appendChild(valueRow);

  const labelEl = document.createElement("div");
  labelEl.className = "main-stat-label";
  labelEl.textContent = label;
  box.appendChild(labelEl);

  return box;
}


/* ============================================================
   08 — Main Stats
   ============================================================ */

function renderMainStats(data) {
  if (!mainStatsEl) return;

  const s = data.stats || data;

  const items = [
    {
      icon: "👥",
      color: "green",
      value: num(s.studentsCount),
      label: "طالب"
    },
    {
      icon: "🔑",
      color: "blue",
      value: num(s.codesCount),
      label: "كود"
    },
    {
      icon: "📝",
      color: "purple",
      value: num(s.examsCount),
      label: "اختبار"
    },
    {
      icon: "🎯",
      color: "orange",
      value: num(s.attemptsCount),
      label: "محاولة"
    },
    {
      icon: "⏱️",
      color: "yellow",
      value: num(s.studyHoursTotal),
      label: "ساعة مذاكرة"
    },
    {
      icon: "✨",
      color: "purple",
      value: num(s.aiMessagesCount),
      label: "رسالة AI"
    }
  ];

  mainStatsEl.replaceChildren();
  items.forEach((item) => mainStatsEl.appendChild(createMainStat(item)));
}


/* ============================================================
   09 — Stage Distribution
   ============================================================ */

function renderStageDistribution(data) {
  if (!stageDistEl) return;

  const dist = (data.stageDistribution && typeof data.stageDistribution === "object")
    ? data.stageDistribution
    : {};

  let total = 0;
  STAGE_KEYS.forEach((k) => { total += num(dist[k]); });

  stageDistEl.replaceChildren();

  if (total === 0) {
    const empty = document.createElement("p");
    empty.style.cssText = "text-align:center;font-size:13px;color:var(--color-text-muted);margin:12px 0;";
    empty.textContent = "لا توجد بيانات توزيع بعد.";
    stageDistEl.appendChild(empty);
    return;
  }

  STAGE_KEYS.forEach((key) => {
    const count = num(dist[key]);
    const percent = Math.round((count / total) * 100);

    const row = document.createElement("div");
    row.className = "chart-row";

    const labelEl = document.createElement("span");
    labelEl.className = "chart-label";
    labelEl.textContent = STAGE_NAMES[key] || key;

    const track = document.createElement("div");
    track.className = "chart-bar-track";

    const fill = document.createElement("div");
    const color = STAGE_COLORS[key] || "purple";
    fill.className = `chart-bar-fill chart-bar-fill--${color}`;
    fill.style.width = `${percent}%`;

    track.appendChild(fill);

    const valueEl = document.createElement("span");
    valueEl.className = "chart-value";
    valueEl.textContent = String(count);

    row.appendChild(labelEl);
    row.appendChild(track);
    row.appendChild(valueEl);
    stageDistEl.appendChild(row);
  });
}


/* ============================================================
   10 — Performance
   ============================================================ */

function renderPerformance(data) {
  if (!perfCardEl) return;

  const perf = (data.performance && typeof data.performance === "object")
    ? data.performance
    : {};

  const avg = Math.max(0, Math.min(100, Math.round(num(perf.averageScore))));
  const passCount = num(perf.passCount);
  const failCount = num(perf.failCount);
  const totalAttempts = passCount + failCount;
  const passPercent = totalAttempts > 0 ? Math.round((passCount / totalAttempts) * 100) : 0;

  perfCardEl.replaceChildren();

  // ---- Average block ----
  const avgBox = document.createElement("div");
  avgBox.className = "perf-avg";

  const avgHead = document.createElement("div");
  avgHead.className = "perf-avg-head";

  const avgLabel = document.createElement("span");
  avgLabel.className = "perf-avg-label";
  avgLabel.textContent = "متوسط الدرجات";

  const avgValue = document.createElement("span");
  avgValue.className = "perf-avg-value";
  avgValue.textContent = `${avg}%`;

  avgHead.appendChild(avgLabel);
  avgHead.appendChild(avgValue);
  avgBox.appendChild(avgHead);

  const avgBar = document.createElement("div");
  avgBar.className = "perf-avg-bar";
  const avgFill = document.createElement("div");
  avgFill.className = "perf-avg-fill";
  avgFill.style.width = `${avg}%`;
  avgBar.appendChild(avgFill);
  avgBox.appendChild(avgBar);

  perfCardEl.appendChild(avgBox);

  // ---- Pass/Fail block ----
  const statsRow = document.createElement("div");
  statsRow.style.cssText = "display:grid;grid-template-columns:repeat(3,1fr);gap:10px;";

  statsRow.appendChild(makeSmallStat("✅", "ناجح", passCount, "var(--color-green-dark)"));
  statsRow.appendChild(makeSmallStat("❌", "راسب", failCount, "var(--color-red-dark)"));
  statsRow.appendChild(makeSmallStat("📊", "نسبة النجاح", `${passPercent}%`, "var(--color-blue-dark)"));

  perfCardEl.appendChild(statsRow);
}

function makeSmallStat(icon, label, value, color) {
  const box = document.createElement("div");
  box.style.cssText = "padding:12px;border-radius:12px;background:var(--color-surface-soft);text-align:center;";

  const ic = document.createElement("div");
  ic.style.fontSize = "18px";
  ic.textContent = icon;

  const val = document.createElement("div");
  val.style.cssText = `margin-top:4px;font-family:Inter,sans-serif;font-size:18px;font-weight:900;direction:ltr;line-height:1.2;color:${color};`;
  val.textContent = String(value);

  const lbl = document.createElement("div");
  lbl.style.cssText = "margin-top:2px;font-size:11px;font-weight:700;color:var(--color-text-muted);";
  lbl.textContent = label;

  box.appendChild(ic);
  box.appendChild(val);
  box.appendChild(lbl);
  return box;
}


/* ============================================================
   11 — Top Students
   ============================================================ */

function renderTopStudents(data) {
  if (!topListEl) return;

  const list = Array.isArray(data.topStudents) ? data.topStudents : [];

  topListEl.replaceChildren();

  if (list.length === 0) {
    const empty = document.createElement("div");
    empty.className = "adm-state";
    empty.style.padding = "28px 20px";
    const icon = document.createElement("div");
    icon.className = "adm-state-icon"; icon.textContent = "🏆";
    const title = document.createElement("h3");
    title.className = "adm-state-title"; title.textContent = "لا توجد بيانات بعد";
    const text = document.createElement("p");
    text.className = "adm-state-text"; text.textContent = "سيظهر هنا أفضل الطلاب بعد أداء الاختبارات.";
    empty.appendChild(icon); empty.appendChild(title); empty.appendChild(text);
    topListEl.appendChild(empty);
    return;
  }

  list.slice(0, 5).forEach((student, idx) => {
    const name = safeText(student && student.name) || "طالب";
    const score = num(student && student.score);

    const item = document.createElement("div");
    item.className = "top-item";

    const rank = document.createElement("div");
    rank.className = "top-rank";
    rank.textContent = String(idx + 1);

    const nameEl = document.createElement("div");
    nameEl.className = "top-name";
    nameEl.textContent = name;

    const scoreEl = document.createElement("div");
    scoreEl.className = "top-score";
    scoreEl.textContent = String(score);

    item.appendChild(rank);
    item.appendChild(nameEl);
    item.appendChild(scoreEl);
    topListEl.appendChild(item);
  });
}


/* ============================================================
   12 — Usage
   ============================================================ */

function renderUsage(data) {
  if (!usageCardEl) return;

  const usage = (data.usage && typeof data.usage === "object")
    ? data.usage
    : {};

  usageCardEl.replaceChildren();

  const grid = document.createElement("div");
  grid.style.cssText = "display:grid;grid-template-columns:repeat(2,1fr);gap:10px;";

  grid.appendChild(makeSmallStat("✨", "رسائل AI", num(usage.aiMessagesCount), "var(--color-purple-dark)"));
  grid.appendChild(makeSmallStat("👤", "طلاب استخدموا AI", num(usage.aiActiveStudents), "var(--color-blue-dark)"));
  grid.appendChild(makeSmallStat("⏱️", "جلسات مذاكرة", num(usage.studySessionsCount), "var(--color-yellow-dark)"));
  grid.appendChild(makeSmallStat("⏳", "متوسط الدقائق", num(usage.averageSessionMinutes), "var(--color-green-dark)"));

  usageCardEl.appendChild(grid);
}


/* ============================================================
   13 — تحميل الإحصائيات
   ============================================================ */

async function loadStatistics() {
  if (isLoading) return;
  isLoading = true;

  showLoading();

  const result = await workerFetch("/api/admin/statistics");

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
  stats = data;

  // عنوان الـ header
  if (headerSubEl) {
    const studentsCount = num((data.stats && data.stats.studentsCount) || data.studentsCount);
    headerSubEl.textContent = studentsCount > 0
      ? `${studentsCount} طالب في المنصة`
      : "تحليلات المنصة";
  }

  // render
  renderMainStats(data);
  renderStageDistribution(data);
  renderPerformance(data);
  renderTopStudents(data);
  renderUsage(data);

  showContent();
}


/* ============================================================
   14 — ربط الأحداث
   ============================================================ */

function bindEvents() {
  if (refreshBtn) refreshBtn.addEventListener("click", () => loadStatistics());
  if (retryBtn)   retryBtn.addEventListener("click", () => loadStatistics());
}


/* ============================================================
   15 — التهيئة
   ============================================================ */

async function init() {
  const session = requireAdmin();
  if (!session) return;

  cacheElements();
  bindEvents();

  await loadStatistics();
}


/* ============================================================
   16 — التشغيل
   ============================================================ */

onReady(init);