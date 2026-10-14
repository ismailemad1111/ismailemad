/**
 * index.js
 * ------------------------------------------------------------
 * منصة أ/ إسماعيل عماد التعليمية
 * تشغيل الصفحة الرئيسية (Command Center).
 *
 * المكان: /js/index.js
 *
 * المرجع:
 *   - الوثيقة الأصلية (بنود 16، 25، 26، 35، 36، 67، 68، 69، 70،
 *                       72، 73، 138، 165، 204)
 *   - Master Design System (بنود 13، 14، 31، 32، 34، 35، 36، 50، 51، 61)
 *
 * ⚠️ قواعد:
 *   - لا نعرض أي بيانات وهمية (بند 165).
 *   - كل البيانات من Worker.
 *   - عند فشل التحميل → Empty State أو Error State.
 *
 * ⚠️ حالة الملف:
 *   - WORKER_URL = PLACEHOLDER_WORKER_URL (البند 207).
 *   - الدوال سترجع NETWORK_ERROR حتى بناء الـ Worker.
 *   - سيظهر Empty State بدلاً من البيانات.
 * ------------------------------------------------------------
 */

import {
  onReady,
  safeText,
  showToast,
  formatRelativeTime,
  escapeHTML
} from "./helpers.js";

import {
  requireStudent,
  ROUTES
} from "./router.js";

import { getCurrentStudent } from "./auth.js";

import {
  getAnnouncements,
  getExams,
  getStudentProfile,
  getPlannerTasks
} from "./api.js";

import {
  renderBottomNav,
  createStatCard,
  createBadge
} from "./components.js";


import { barai } from "./barai/safe.js";

/* ============================================================
   01 — المرجع للعناصر
   ============================================================ */

let greetingEl        = null;
let welcomeDateEl     = null;
let welcomeContextEl  = null;
let stageBadgeEl      = null;
let stageBadgeText    = null;

let heroSection       = null;
let heroAction        = null;
let heroIcon          = null;
let heroLabel         = null;
let heroTitle         = null;
let heroText          = null;
let heroCta           = null;

let progressHighlight = null;
let progressValueEl   = null;
let progressBarFillEl = null;

let statsRow        = null;
let todaySection    = null;
let todayListEl     = null;
let announcementsEl = null;
let examsEl         = null;
let bottomNavSlot   = null;


/* ============================================================
   02 — تجميع العناصر
   ============================================================ */

function cacheElements() {
  greetingEl      = document.getElementById("greeting");
  welcomeDateEl   = document.getElementById("welcomeDate");
  welcomeContextEl = document.getElementById("welcomeContext");
  stageBadgeEl    = document.getElementById("stageBadge");
  stageBadgeText  = document.getElementById("stageBadgeText");

  heroSection     = document.getElementById("heroSection");
  heroAction      = document.getElementById("heroAction");
  heroIcon        = document.getElementById("heroIcon");
  heroLabel       = document.getElementById("heroLabel");
  heroTitle       = document.getElementById("heroTitle");
  heroText        = document.getElementById("heroText");
  heroCta         = document.getElementById("heroCta");

  progressHighlight = document.getElementById("progressHighlight");
  progressValueEl   = document.getElementById("progressValue");
  progressBarFillEl = document.getElementById("progressBarFill");

  statsRow        = document.getElementById("statsRow");
  todaySection    = document.getElementById("todaySection");
  todayListEl     = document.getElementById("todayList");
  announcementsEl = document.getElementById("announcementsList");
  examsEl         = document.getElementById("examsList");
  bottomNavSlot   = document.getElementById("bottomNavSlot");
}


/* ============================================================
   03 — أسماء المراحل (عرض فقط)
   المرجع: الوثيقة الأصلية — بند 21
   ⚠️ القيم (grade_4 ...) مؤقتة — تُثبَّت مع Worker.
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

/**
 * الحصول على اسم المرحلة بالعربي.
 * @param {string} stageKey
 * @returns {string}
 */
function getStageName(stageKey) {
  const key = safeText(stageKey);
  if (!key) return "";
  return STAGE_NAMES[key] || key;
}


/* ============================================================
   04 — الترحيب
   المرجع: Master Design System — بند 44
   ============================================================ */

/**
 * تعبئة قسم الترحيب باسم الطالب ومرحلته.
 * @param {Object|null} student
 */
function renderGreeting(student) {
  // الاسم
  const fullName = student && student.fullName ? safeText(student.fullName) : "";
  const firstName = fullName ? fullName.split(/\s+/)[0] : "";

  if (greetingEl) {
    greetingEl.replaceChildren();

    if (firstName) {
      greetingEl.appendChild(document.createTextNode("أهلاً يا "));
      const nameSpan = document.createElement("span");
      nameSpan.className = "home-greeting-name";
      nameSpan.textContent = firstName;
      greetingEl.appendChild(nameSpan);
    } else {
      greetingEl.appendChild(document.createTextNode("أهلاً بيك"));
    }

    greetingEl.appendChild(document.createTextNode(" "));
    const waveIcon = document.createElement("span");
    waveIcon.className = "icon icon-wave";
    waveIcon.setAttribute("aria-hidden", "true");
    greetingEl.appendChild(waveIcon);
  }

  // المرحلة
  const stageName = student && student.stage ? getStageName(student.stage) : "";
  if (stageBadgeEl && stageBadgeText) {
    if (stageName) {
      stageBadgeText.textContent = stageName;
      stageBadgeEl.style.display = "";
    } else {
      stageBadgeEl.style.display = "none";
    }
  }

  // التاريخ (سياق هادئ بدل جملة تحفيزية عامة)
  if (welcomeDateEl) {
    welcomeDateEl.textContent = new Date().toLocaleDateString("ar-EG", {
      weekday: "long",
      day: "numeric",
      month: "long"
    });
  }
}


/**
 * سطر السياق الديناميكي تحت الترحيب — جملة واحدة قصيرة بتعكس
 * حالة الطالب النهارده (اختبار مستنيه / نتيجة جاهزة / مهام / يوم هادي).
 * بيتنادى بعد ما البيانات توصل من الـ Worker.
 * @param {Object} state - { exams, todayTasks }
 */
function renderWelcomeContext(state = {}) {
  if (!welcomeContextEl) return;

  const exams = Array.isArray(state.exams) ? state.exams : [];
  const todayTasks = Array.isArray(state.todayTasks) ? state.todayTasks : [];

  const hasAvailableExam = exams.some((e) => e && e.status === "available");
  const hasResult = exams.some((e) => e && e.status === "result_available");
  const pendingTasks = todayTasks.filter((t) => t && !t.done);

  let text;
  if (hasAvailableExam) {
    text = "عندك اختبار مستنيك.";
  } else if (hasResult) {
    text = "نتيجتك جاهزة.";
  } else if (pendingTasks.length > 0) {
    text = "عندك كام حاجة نخلّصهم النهارده.";
  } else {
    text = "يوم هادي النهارده.";
  }

  welcomeContextEl.textContent = text;
  welcomeContextEl.style.display = "";
}


/* ============================================================
   05 — Bottom Navigation
   المرجع: الوثيقة الأصلية — بنود 72، 73
   ============================================================ */

/**
 * بناء Bottom Nav وتركيبه في الـ slot.
 * @param {Object} badges
 */
function mountBottomNav(badges = {}) {
  if (!bottomNavSlot) return;

  bottomNavSlot.replaceChildren();

  const nav = renderBottomNav({ badges });
  bottomNavSlot.appendChild(nav);
}


/* ============================================================
   06 — Stats (نشاط الطالب)
   المرجع: Master Design System — البند 31
   ============================================================ */

/**
 * تعبئة صف الإحصائيات.
 * @param {Object} profile
 */
function renderStats(profile) {
  if (!statsRow) return;

  statsRow.replaceChildren();

  const stats = (profile && profile.stats) ? profile.stats : {};

  const items = [
    {
      label: "دروس مكتملة",
      value: safeText(stats.completedLessons) || "0",
      color: "green"
    },
    {
      label: "اختبارات",
      value: safeText(stats.attemptsCount) || "0",
      color: "blue"
    },
    {
      label: "ساعات مذاكرة",
      value: safeText(stats.studyHoursTotal) || "0",
      color: "yellow"
    }
  ];

  items.forEach((item) => {
    const el = document.createElement("div");
    el.className = "home-stat";

    const valueEl = document.createElement("div");
    valueEl.className = `home-stat-value is-${item.color}`;
    valueEl.textContent = item.value;

    const labelEl = document.createElement("div");
    labelEl.className = "home-stat-label";
    labelEl.textContent = item.label;

    el.appendChild(valueEl);
    el.appendChild(labelEl);
    statsRow.appendChild(el);
  });
}


/**
 * تعبئة شريط "متوسط الأداء" أعلى قسم التقدم.
 * بيظهر بس لو عند الطالب محاولة اختبار واحدة على الأقل،
 * عشان ما نعرضش 0% بشكل مضلل قبل أي بيانات حقيقية.
 * @param {Object|null} profile
 */
function renderProgressHighlight(profile) {
  if (!progressHighlight) return;

  const stats = (profile && profile.stats) ? profile.stats : {};
  const attempts = Number(stats.attemptsCount) || 0;

  if (attempts <= 0) {
    progressHighlight.style.display = "none";
    return;
  }

  const avg = Math.max(0, Math.min(100, Number(stats.averageScore) || 0));

  if (progressValueEl)   progressValueEl.textContent = `${avg}%`;
  if (progressBarFillEl) progressBarFillEl.style.width = `${avg}%`;

  progressHighlight.style.display = "";
}


/* ============================================================
   07 — Hero Action (أهم شيء جديد)
   المرجع: Master Design System — بنود 14، 50، 51
   ============================================================ */

/**
 * إظهار الـ Hero Action.
 * @param {Object} options
 * @param {"green"|"blue"|"purple"|"gold"} options.variant - نفس معنى الألوان في tokens.css
 * @param {string} options.icon
 * @param {string} options.label
 * @param {string} options.title
 * @param {string} options.text
 * @param {string} options.cta - فعل واضح بجانب السهم (مثال: "ابدأ")
 * @param {string} options.href
 */
function showHero({ variant = "green", icon = "icon-exam-paper", label = "", title = "", text = "", cta = "", href = "#" } = {}) {
  if (!heroSection || !heroAction) return;

  if (heroIcon) {
    heroIcon.replaceChildren();
    const iconSpan = document.createElement("span");
    iconSpan.className = `icon ${icon}`;
    iconSpan.setAttribute("aria-hidden", "true");
    heroIcon.appendChild(iconSpan);
  }
  if (heroLabel) heroLabel.textContent = label;
  if (heroTitle) heroTitle.textContent = title;
  if (heroText)  heroText.textContent  = text;
  if (heroCta)   heroCta.textContent   = cta;

  // إزالة الـ variants القديمة — كل حالة لازم تاخد class صريح (مفيش لون افتراضي)
  heroAction.classList.remove("hero-green", "hero-blue", "hero-purple", "hero-gold");
  heroAction.classList.add(`hero-${variant}`);

  heroAction.setAttribute("href", href);

  // إظهار القسم
  heroSection.style.display = "";
}

/**
 * إخفاء الـ Hero.
 */
function hideHero() {
  if (heroSection) heroSection.style.display = "none";
}


/* ============================================================
   08 — قائمة الإعلانات
   المرجع: الوثيقة الأصلية — بنود 25، 26
   ============================================================ */

/**
 * عرض "لا يوجد" في حاوية.
 * @param {HTMLElement} container
 * @param {string} text
 */
function renderEmpty(container, text) {
  if (!container) return;

  container.replaceChildren();

  const empty = document.createElement("div");
  empty.className = "home-empty";
  empty.textContent = text;
  container.appendChild(empty);
}

/**
 * تعبئة قائمة الإعلانات (آخر 3).
 * @param {Array<Object>} announcements
 */
function renderAnnouncementsList(announcements) {
  if (!announcementsEl) return;

  if (!Array.isArray(announcements) || announcements.length === 0) {
    renderEmpty(announcementsEl, "مفيش جديد دلوقتي.");
    return;
  }

  const items = announcements.slice(0, 3);

  announcementsEl.replaceChildren();

  items.forEach((a) => {
    const title = safeText(a && a.title) || "إعلان";
    const createdAt = a && a.createdAt ? a.createdAt : null;

    const item = document.createElement("a");
    item.className = "home-item" + (a && a.isRead === false ? " is-unread" : "");
    item.href = ROUTES.ANNOUNCEMENTS;

    const icon = document.createElement("div");
    icon.className = "home-item-icon";
    icon.setAttribute("aria-hidden", "true");
    const iconSpan = document.createElement("span");
    const annType = safeText(a && a.type);
    iconSpan.className = "icon " + (annType === "external_link" ? "icon-globe" : annType === "internal_link" ? "icon-link" : "icon-announcement");
    icon.appendChild(iconSpan);

    const body = document.createElement("div");
    body.className = "home-item-body";

    const titleEl = document.createElement("h3");
    titleEl.className = "home-item-title";
    titleEl.textContent = title;

    const metaEl = document.createElement("p");
    metaEl.className = "home-item-meta";
    metaEl.textContent = createdAt
      ? formatRelativeTime(createdAt)
      : "";

    body.appendChild(titleEl);
    body.appendChild(metaEl);

    item.appendChild(icon);
    item.appendChild(body);
    announcementsEl.appendChild(item);
  });
}


/* ============================================================
   08ب — مهام اليوم (المنظم)
   المرجع: js/planner.js — نفس منطق حساب week/day بالظبط،
   بيستخدم getPlannerTasks الموجودة أصلاً في api.js (بدون أي
   تعديل على الـ Worker أو عقد البيانات).
   ============================================================ */

const DAYS_KEYS = ["saturday", "sunday", "monday", "tuesday", "wednesday", "thursday", "friday"];

/**
 * مفتاح الأسبوع الحالي (بداية الأسبوع من السبت، YYYY-MM-DD).
 * @returns {string}
 */
function getHomeWeekKey() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const jsDay = today.getDay(); // 0 = Sunday
  const daysFromSaturday = (jsDay + 1) % 7;
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - daysFromSaturday);
  return weekStart.toISOString().split("T")[0];
}

/**
 * مفتاح يوم النهاردة (saturday/sunday/...).
 * @returns {string}
 */
function getHomeTodayKey() {
  const jsDay = new Date().getDay();
  const daysFromSaturday = (jsDay + 1) % 7;
  return DAYS_KEYS[daysFromSaturday];
}

/**
 * تعبئة قسم "اليوم" بمهام المنظم الخاصة باليوم الحالي.
 * @param {Array<Object>} tasks
 */
function renderTodayList(tasks) {
  if (!todaySection || !todayListEl) return;

  const items = Array.isArray(tasks) ? tasks.slice() : [];

  if (items.length === 0) {
    todayListEl.replaceChildren();

    const empty = document.createElement("div");
    empty.className = "home-today-empty";

    const title = document.createElement("p");
    title.className = "home-today-empty-title";
    title.textContent = "يومك هادي";

    const text = document.createElement("p");
    text.className = "home-today-empty-text";
    text.textContent = "مفيش حاجة متسجلة النهارده.";

    const link = document.createElement("a");
    link.className = "home-today-empty-link";
    link.href = ROUTES.PLANNER;
    link.textContent = "افتح خطتك";

    empty.appendChild(title);
    empty.appendChild(text);
    empty.appendChild(link);
    todayListEl.appendChild(empty);
    todaySection.style.display = "";
    return;
  }

  items.sort((a, b) => safeText(a && a.time).localeCompare(safeText(b && b.time)));

  todayListEl.replaceChildren();

  items.slice(0, 5).forEach((task) => {
    const row = document.createElement("div");
    row.className = "home-today-row";
    if (task && task.done) row.classList.add("is-done");

    const time = document.createElement("span");
    time.className = "home-today-time";
    time.textContent = safeText(task && task.time) || "—";

    const dot = document.createElement("span");
    dot.className = "home-today-dot";
    dot.setAttribute("aria-hidden", "true");

    const title = document.createElement("p");
    title.className = "home-today-title";
    title.textContent = safeText(task && task.title) || "مهمة";

    row.appendChild(time);
    row.appendChild(dot);
    row.appendChild(title);

    if (task && task.done) {
      const check = document.createElement("span");
      check.className = "icon icon-check-circle home-today-check";
      check.setAttribute("aria-hidden", "true");
      row.appendChild(check);
    }

    todayListEl.appendChild(row);
  });

  todaySection.style.display = "";
}


/* ============================================================
   09 — قائمة الاختبارات المتاحة
   المرجع: الوثيقة الأصلية — بنود 35، 36
   ============================================================ */

/**
 * تعبئة قائمة الاختبارات (آخر 2 متاحين).
 * @param {Array<Object>} exams
 */
function renderExamsList(exams) {
  if (!examsEl) return;

  if (!Array.isArray(exams) || exams.length === 0) {
    renderEmpty(examsEl, "مفيش اختبارات متاحة دلوقتي.");
    return;
  }

  // فلترة المتاح فقط، ثم آخر 2
  const available = exams
    .filter((e) => e && e.status === "available")
    .slice(0, 2);

  if (available.length === 0) {
    renderEmpty(examsEl, "مفيش اختبارات متاحة دلوقتي.");
    return;
  }

  examsEl.replaceChildren();

  available.forEach((exam) => {
    const title = safeText(exam.title) || "اختبار";
    const questionsCount = Number(exam.questionsCount) || 0;

    const item = document.createElement("a");
    item.className = "home-item";
    item.href = ROUTES.EXAMS;

    const icon = document.createElement("div");
    icon.className = "home-item-icon";
    icon.setAttribute("aria-hidden", "true");
    const iconSpan = document.createElement("span");
    iconSpan.className = "icon icon-exam-paper";
    icon.appendChild(iconSpan);

    const body = document.createElement("div");
    body.className = "home-item-body";

    const titleEl = document.createElement("h3");
    titleEl.className = "home-item-title";
    titleEl.textContent = title;

    const metaEl = document.createElement("p");
    metaEl.className = "home-item-meta";
    metaEl.textContent = questionsCount
      ? `${questionsCount} سؤال`
      : "جاهزة للحل";

    body.appendChild(titleEl);
    body.appendChild(metaEl);

    item.appendChild(icon);
    item.appendChild(body);
    examsEl.appendChild(item);
  });
}


/* ============================================================
   10 — تحديد Hero Action حسب البيانات
   المرجع: Master Design System — بنود 14، 51
   الأولوية: امتحان متاح > درس جديد > إعلان مهم
   ============================================================ */

/**
 * تحديد الـ Hero Action الأنسب.
 * @param {Object} data - { exams, announcements }
 * @returns {Object|null}
 */
function pickHeroAction(data) {
  const exams = Array.isArray(data.exams) ? data.exams : [];
  const announcements = Array.isArray(data.announcements) ? data.announcements : [];

  // 1) امتحان متاح (أعلى أولوية)
  const availableExam = exams.find((e) => e && e.status === "available");
  if (availableExam) {
    return {
      variant: "green",
      icon: "icon-exam-paper",
      label: "الأهم الآن",
      title: safeText(availableExam.title) || "اختبار متاح",
      text: "عندك اختبار مستنيك.",
      cta: "نبدأ",
      href: ROUTES.EXAMS
    };
  }

  // 2) اختبار نتيجته متاحة
  const resultExam = exams.find((e) => e && e.status === "result_available");
  if (resultExam) {
    return {
      variant: "blue",
      icon: "icon-target",
      label: "نتيجتك جاهزة",
      title: safeText(resultExam.title) || "نتيجة اختبار",
      text: "خلّصت الاختبار ده.",
      cta: "شوف النتيجة",
      href: ROUTES.EXAMS
    };
  }

  // 3) إعلان حديث (خلال 24 ساعة)
  const recentAnnouncement = announcements.find((a) => {
    if (!a || !a.createdAt) return false;
    const ts = (a.createdAt && typeof a.createdAt.toDate === "function")
      ? a.createdAt.toDate().getTime()
      : (a.createdAt instanceof Date ? a.createdAt.getTime() : null);
    if (!ts) return false;
    return (Date.now() - ts) < 24 * 60 * 60 * 1000;
  });

  if (recentAnnouncement) {
    return {
      variant: "gold",
      icon: "icon-announcement",
      label: "جديد",
      title: safeText(recentAnnouncement.title) || "إعلان جديد",
      text: "فيه حاجة جديدة عندك.",
      cta: "التفاصيل",
      href: ROUTES.ANNOUNCEMENTS
    };
  }

  // لا يوجد شيء عاجل
  return null;
}


/* ============================================================
   11 — التحميل
   ============================================================ */

/**
 * تحميل بيانات الصفحة الرئيسية.
 * @returns {Promise<Object>}
 */
async function loadHomeData() {
  // جلب متوازٍ (أسرع)
  const [announcementsRes, examsRes, profileRes, tasksRes] = await Promise.all([
    getAnnouncements(),
    getExams(),
    getStudentProfile(),
    getPlannerTasks({ week: getHomeWeekKey(), day: getHomeTodayKey() })
  ]);

  return {
    announcementsRes,
    examsRes,
    profileRes,
    tasksRes
  };
}

/**
 * معالجة النتائج وتعبئة الواجهة.
 * @param {Object} result
 */
function applyData(result) {
  const {
    announcementsRes,
    examsRes,
    profileRes,
    tasksRes
  } = result;

  // ------- Announcements -------
  const announcements = (announcementsRes && announcementsRes.success && announcementsRes.data && Array.isArray(announcementsRes.data.announcements))
    ? announcementsRes.data.announcements
    : [];

  renderAnnouncementsList(announcements);

  // ------- Exams -------
  const exams = (examsRes && examsRes.success && examsRes.data && Array.isArray(examsRes.data.exams))
    ? examsRes.data.exams
    : [];

  renderExamsList(exams);

  // برعي: مواقف الرئيسية من بيانات حقيقية (كل شيء محصّن ولا يمس منطق الصفحة)
  try {
    const avail = exams.filter((e) => e && e.status === "available" && e.id);
    barai.fresh("exams", avail.map((e) => e.id)).then((ids) => {
      if (ids && ids.length) {
        const first = avail.find((e) => String(e.id) === ids[0]);
        barai.notify("exam.new", { id: ids[0], ids, count: ids.length, title: safeText(first && first.title), commit: { group: "exams", ids },
          href: ids.length === 1 ? `exam.html?examId=${encodeURIComponent(ids[0])}` : "exams.html",
          actionLabel: ids.length === 1 ? "ادخل الامتحان" : "شوف الاختبارات" });
      }
    });
    const unread = announcements.filter((a) => a && a.isRead === false).length;
    if (unread > 0) barai.notify("announce.unread", { count: unread, href: "announcements.html", actionLabel: "افتح الرسائل" });
    if (/login\.html/.test(document.referrer || "")) {
      const nm = profileRes && profileRes.data && profileRes.data.student && profileRes.data.student.fullName;
      barai.notify("login.success", { name: nm ? String(nm).split(/\s+/)[0] : "" });
    }
    barai.settle();   // انتهى تحميل بيانات الصفحة: يختار برعي الأهم بين المرشّحين
  } catch (e) { /* برعي تجميلي فقط */ }

  // ------- Profile (stats) -------
  const profile = (profileRes && profileRes.success && profileRes.data)
    ? profileRes.data
    : null;

  renderStats(profile);
  renderProgressHighlight(profile);

  // ------- Today (مهام المنظم لليوم) -------
  const tasksByDay = (tasksRes && tasksRes.success && tasksRes.data && tasksRes.data.tasksByDay)
    ? tasksRes.data.tasksByDay
    : {};
  const todayTasks = Array.isArray(tasksByDay[getHomeTodayKey()])
    ? tasksByDay[getHomeTodayKey()].filter((t) => t && t.id && typeof t.title === "string")
    : [];

  renderTodayList(todayTasks);
  try { if (todayTasks.length === 0 && tasksRes && tasksRes.success) barai.notify("planner.empty", { href: "planner.html", actionLabel: "افتح خطتك" }); } catch (e) { /* تجاهل */ }

  // ------- سطر الترحيب الديناميكي -------
  renderWelcomeContext({ exams, todayTasks });

  // ------- Hero -------
  const hero = pickHeroAction({ exams, announcements });
  if (hero) showHero(hero);
  else hideHero();
}


/* ============================================================
   12 — معالجة الأخطاء
   ============================================================ */

/**
 * معالجة أخطاء تحميل البيانات.
 * @param {Error} err
 */
function handleLoadError(err) {
  // eslint-disable-next-line no-console
  console.error("[index] load error:", err);

  // Empty States موحدة
  renderEmpty(announcementsEl, "مش قادرين نجيب الإعلانات دلوقتي.");
  renderEmpty(examsEl, "مش قادرين نجيب الاختبارات دلوقتي.");
  if (todaySection) todaySection.style.display = "none";
  if (welcomeContextEl) welcomeContextEl.style.display = "none";

  // Stats افتراضية (0)
  renderStats(null);
  renderProgressHighlight(null);

  hideHero();

  showToast("حصلت مشكلة في تحميل البيانات. جرّب تاني.", "error");
}


/* ============================================================
   13 — التهيئة
   ============================================================ */

async function init() {
  // حماية الصفحة — بند 104
  const session = requireStudent();
  if (!session) return;

  cacheElements();

  // 1) بيانات الطالب من الجلسة (للعرض فقط)
  const student = getCurrentStudent() || session.student || null;
  renderGreeting(student);

  // 2) بناء Bottom Nav
  mountBottomNav();

  // 3) تحميل البيانات
  try {
    const result = await loadHomeData();
    applyData(result);
  } catch (err) {
    handleLoadError(err);
  }
}


/* ============================================================
   14 — التشغيل
   ============================================================ */

onReady(init);