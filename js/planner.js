/**
 * planner.js
 * ------------------------------------------------------------
 * منصة أ/ إسماعيل عماد التعليمية
 * تشغيل صفحة planner.html
 *
 * المكان: /js/planner.js
 *
 * المرجع:
 *   - الوثيقة الأصلية (بنود 46، 47، 48، 49، 50، 51، 52، 53، 54، 55،
 *                       140، 158، 160، 161)
 *   - Master Design System (بنود 11، 13، 31، 32، 33، 34، 35، 36، 39، 55)
 *
 * ⚠️ قواعد:
 *   - المصدر الأساسي للمهام هو Worker (بند 54).
 *   - لا نستخدم LocalStorage كمصدر أساسي.
 *   - كل النصوص من المستخدم تمر عبر textContent (بند 124).
 *   - prayer-times.js مستقل تمامًا.
 *
 * ⚠️ حالة الملف:
 *   - WORKER_URL = PLACEHOLDER_WORKER_URL (البند 207).
 *   - كل الدوال سترجع NETWORK_ERROR حتى بناء الـ Worker.
 *   - ستظهر Empty State بدون بيانات.
 * ------------------------------------------------------------
 */

import {
  onReady,
  safeText,
  showToast,
  formatDate
} from "./helpers.js";

import {
  requireStudent
} from "./router.js";

import { getCurrentStudent } from "./auth.js";

import {
  getPlannerTasks,
  createTask,
  updateTask,
  deleteTask,
  logStudySession
} from "./api.js";

import { renderBottomNav } from "./components.js";


import { barai } from "./barai/safe.js";

/* ============================================================
   01 — ثوابت
   ============================================================ */

const DAYS_AR = ["السبت", "الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة"];

// مفاتيح الأيام (بنفس أسماء backend المتوقعة)
const DAYS_KEYS = ["saturday", "sunday", "monday", "tuesday", "wednesday", "thursday", "friday"];

// اقتباسات يومية (بند 47 من Design System)
const QUOTES = [
  { text: "رحلة الألف ميل تبدأ بخطوة",           author: "لاو تزو" },
  { text: "النجاح هو مجموع الجهود الصغيرة",      author: "روبرت كولير" },
  { text: "خطط لعملك واعمل على خطتك",            author: "نابليون هيل" },
  { text: "من فشل في التخطيط، خطط للفشل",        author: "بنجامين فرانكلين" },
  { text: "الانضباط هو الجسر بين الأهداف والإنجاز", author: "جيم رون" },
  { text: "العلم في الصغر كالنقش على الحجر",      author: "مثل عربي" },
  { text: "الأمس تاريخ، والغد لغز، واليوم هدية", author: "حكمة صينية" }
];


/* ============================================================
   02 — الحالة
   ============================================================ */

let currentStudent = null;

/** الأسبوع الحالي (offset من الأسبوع الحالي) */
let weekOffset = 0;

/** اليوم المختار */
let selectedDayKey = null;

/** كل المهام: { dayKey: [task, ...] } */
let tasksByDay = {};

/** هل نعرض المهام المكتملة؟ */
let showCompleted = true;

/** المهمة الجاري تعديلها */
let editingTaskId = null;
let editingTaskDay = null;

/** منع التحميل المزدوج */
let isLoading = false;
let isSaving = false;


/* ============================================================
   03 — المرجع للعناصر
   ============================================================ */

let subtitleEl         = null;
let welcomeGreetingEl  = null;
let welcomeDateEl      = null;
let weeklyTotalEl      = null;
let weeklyDoneEl       = null;

let daySelectorEl      = null;
let prevWeekBtn        = null;
let nextWeekBtn        = null;

let progressTitleEl    = null;
let progressPercentEl  = null;
let progressFillEl     = null;
let doneCountEl        = null;
let totalCountEl       = null;
let streakNumEl        = null;

let taskDaySelectEl    = null;
let taskTimeEl         = null;
let taskInputEl        = null;
let addTaskBtn         = null;

let quickChipsEls      = null;

let taskListTitleEl    = null;
let toggleCompletedBtn = null;
let taskListEl         = null;

let quoteTextEl        = null;
let quoteAuthorEl      = null;

let editModalEl        = null;
let editTaskInputEl    = null;
let editCancelBtn      = null;
let editSaveBtn        = null;

let bottomNavSlot      = null;


/* ============================================================
   04 — تجميع العناصر
   ============================================================ */

function cacheElements() {
  subtitleEl         = document.getElementById("plSubtitle");

  welcomeGreetingEl  = document.getElementById("welcomeGreeting");
  welcomeDateEl      = document.getElementById("welcomeDate");
  weeklyTotalEl      = document.getElementById("weeklyTotal");
  weeklyDoneEl       = document.getElementById("weeklyDone");

  daySelectorEl      = document.getElementById("daySelector");
  prevWeekBtn        = document.getElementById("prevWeekBtn");
  nextWeekBtn        = document.getElementById("nextWeekBtn");

  progressTitleEl    = document.getElementById("progressTitle");
  progressPercentEl  = document.getElementById("progressPercent");
  progressFillEl     = document.getElementById("progressFill");
  doneCountEl        = document.getElementById("doneCount");
  totalCountEl       = document.getElementById("totalCount");
  streakNumEl        = document.getElementById("streakNum");

  taskDaySelectEl    = document.getElementById("taskDaySelect");
  taskTimeEl         = document.getElementById("taskTime");
  taskInputEl        = document.getElementById("taskInput");
  addTaskBtn         = document.getElementById("addTaskBtn");

  quickChipsEls      = document.querySelectorAll(".pl-chip");

  taskListTitleEl    = document.getElementById("taskListTitle");
  toggleCompletedBtn = document.getElementById("toggleCompletedBtn");
  taskListEl         = document.getElementById("taskList");

  quoteTextEl        = document.getElementById("dailyQuote");
  quoteAuthorEl      = document.getElementById("quoteAuthor");

  editModalEl        = document.getElementById("editModal");
  editTaskInputEl    = document.getElementById("editTaskInput");
  editCancelBtn      = document.getElementById("editCancelBtn");
  editSaveBtn        = document.getElementById("editSaveBtn");

  bottomNavSlot      = document.getElementById("bottomNavSlot");
}


/* ============================================================
   05 — التواريخ والأسابيع
   المرجع: الوثيقة الأصلية — بنود 48، 49، 140
   ============================================================ */

/**
 * بداية الأسبوع الحالي (السبت) + offset.
 * @param {number} offset
 * @returns {Date}
 */
function getWeekStart(offset = 0) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // JS: Sunday=0, Monday=1, ..., Saturday=6
  // نبدأ الأسبوع من السبت → نحوّل
  const jsDay = today.getDay(); // 0..6 (0 = Sunday)
  // السبت = 6 في JS
  const daysFromSaturday = (jsDay + 1) % 7; // السبت = 0، الأحد = 1، ...

  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - daysFromSaturday + offset * 7);

  return weekStart;
}

/**
 * تاريخ يوم معين في الأسبوع الحالي.
 * @param {number} dayIndex 0..6
 * @returns {Date}
 */
function getDateForDay(dayIndex) {
  const weekStart = getWeekStart(weekOffset);
  const date = new Date(weekStart);
  date.setDate(weekStart.getDate() + dayIndex);
  return date;
}

/**
 * هل اليوم هو "اليوم الحقيقي"؟
 * @param {number} dayIndex
 * @returns {boolean}
 */
function isToday(dayIndex) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = getDateForDay(dayIndex);
  return d.toDateString() === today.toDateString();
}

/**
 * مفتاح يوم النهاردة (saturday/sunday/...).
 * @returns {string}
 */
function getTodayKey() {
  const today = new Date();
  const jsDay = today.getDay(); // 0 = Sunday
  const daysFromSaturday = (jsDay + 1) % 7;
  return DAYS_KEYS[daysFromSaturday];
}

/**
 * مفتاح الأسبوع الحالي المعروض (YYYY-MM-DD لبداية الأسبوع).
 * يُستخدم في كل طلبات create/update/delete حتى لا يعتمد الـ Worker
 * على fallback ضمني زي "current" (بند C4).
 */
function getCurrentWeekKey() {
  return getWeekStart(weekOffset).toISOString().split("T")[0];
}

/**
 * وصف الأسبوع (للعرض).
 * @returns {string}
 */
function getWeekRangeLabel() {
  if (weekOffset === 0) return "هذا الأسبوع";
  if (weekOffset === -1) return "الأسبوع السابق";
  if (weekOffset === 1) return "الأسبوع القادم";
  const start = getWeekStart(weekOffset);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return `${formatShortDate(start)} — ${formatShortDate(end)}`;
}

function formatShortDate(date) {
  try {
    return date.toLocaleDateString("ar-EG", { day: "numeric", month: "short" });
  } catch (e) {
    return "";
  }
}


/* ============================================================
   06 — Welcome
   ============================================================ */

/**
 * تحية حسب الوقت.
 */
function getGreeting() {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12)  return "صباح الخير";
  if (hour >= 12 && hour < 17) return "مساء الخير";
  if (hour >= 17 && hour < 21) return "مساء الخير";
  return "تصبح على خير";
}

function renderWelcome() {
  const studentName = currentStudent && currentStudent.fullName
    ? safeText(currentStudent.fullName).split(/\s+/)[0]
    : "";

  const greeting = getGreeting();
  if (welcomeGreetingEl) {
    welcomeGreetingEl.textContent = studentName
      ? `${greeting}، ${studentName}`
      : greeting;
  }

  if (welcomeDateEl) {
    const today = new Date();
    try {
      welcomeDateEl.textContent = today.toLocaleDateString("ar-EG", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric"
      });
    } catch (e) {
      welcomeDateEl.textContent = "";
    }
  }
}


/* ============================================================
   07 — Week Selector
   المرجع: الوثيقة الأصلية — بند 48
   ============================================================ */

function renderDaySelector() {
  if (!daySelectorEl) return;

  daySelectorEl.replaceChildren();

  DAYS_KEYS.forEach((key, index) => {
    const date = getDateForDay(index);
    const dayNum = date.getDate();

    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "pl-day-chip";
    chip.setAttribute("role", "tab");
    chip.setAttribute("aria-selected", key === selectedDayKey ? "true" : "false");

    if (key === selectedDayKey) chip.classList.add("is-active");
    if (isToday(index))        chip.classList.add("is-today");

    const nameEl = document.createElement("span");
    nameEl.className = "pl-day-chip__name";
    nameEl.textContent = DAYS_AR[index].slice(0, 3);

    const dateEl = document.createElement("span");
    dateEl.className = "pl-day-chip__date";
    dateEl.textContent = String(dayNum);

    chip.appendChild(nameEl);
    chip.appendChild(dateEl);

    chip.addEventListener("click", () => {
      selectedDayKey = key;
      renderDaySelector();
      renderTaskList();
      updateProgress();
      updateTaskListTitle();
    });

    daySelectorEl.appendChild(chip);
  });

  // أظهر اليوم المحدد بالكامل داخل الشريط (كان يظهر مقطوعًا عند الحافة)
  try {
    const active = daySelectorEl.querySelector(".is-active");
    if (active) daySelectorEl.scrollLeft += active.getBoundingClientRect().left + active.offsetWidth / 2
      - (daySelectorEl.getBoundingClientRect().left + daySelectorEl.clientWidth / 2);
  } catch (e) { /* تجاهل */ }
}

/**
 * تعبئة الـ select الخاص باليوم في "إضافة مهمة".
 */
function renderTaskDaySelect() {
  if (!taskDaySelectEl) return;

  taskDaySelectEl.replaceChildren();

  DAYS_KEYS.forEach((key, index) => {
    const opt = document.createElement("option");
    opt.value = key;
    const isTodayFlag = isToday(index);
    opt.textContent = isTodayFlag
      ? `${DAYS_AR[index]} (اليوم)`
      : DAYS_AR[index];
    if (key === selectedDayKey) opt.selected = true;
    taskDaySelectEl.appendChild(opt);
  });
}


/* ============================================================
   08 — Progress + Streak
   المرجع: Master Design System — بنود 31، 32
   ============================================================ */

function updateWeeklyStats() {
  let total = 0;
  let done = 0;

  DAYS_KEYS.forEach((k) => {
    const list = Array.isArray(tasksByDay[k]) ? tasksByDay[k] : [];
    total += list.length;
    done += list.filter((t) => t && t.completed).length;
  });

  if (weeklyTotalEl) weeklyTotalEl.textContent = String(total);
  if (weeklyDoneEl)  weeklyDoneEl.textContent  = String(done);
}

function updateProgress() {
  const tasks = Array.isArray(tasksByDay[selectedDayKey]) ? tasksByDay[selectedDayKey] : [];
  const total = tasks.length;
  const completed = tasks.filter((t) => t && t.completed).length;
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

  if (progressPercentEl) progressPercentEl.textContent = `${percent}%`;
  if (progressFillEl)    progressFillEl.style.width = `${percent}%`;
  if (doneCountEl)       doneCountEl.textContent = String(completed);
  if (totalCountEl)      totalCountEl.textContent = String(total);

  let title = "ابدأ العمل";
  if (total === 0) title = "لا توجد مهام";
  else if (percent === 100) title = "كل المهام مكتملة!";
  else if (percent >= 75) title = "أوشكت على الانتهاء";
  else if (percent >= 50) title = "في منتصف الطريق";
  else if (completed > 0) title = "بداية جيدة";

  if (progressTitleEl) progressTitleEl.textContent = title;
}

function updateStreak() {
  const streak = calculateStreak();
  if (streakNumEl) streakNumEl.textContent = String(streak);
  try { if ([3, 5, 7, 10].includes(streak)) barai.notify("streak.milestone", { count: streak }); } catch (e) { /* تجاهل */ }
}

/**
 * حساب Streak — أيام متتالية أكمل فيها الطالب كل مهامه.
 * @returns {number}
 */
function calculateStreak() {
  let streak = 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let i = 0; i < 30; i++) {
    const checkDate = new Date(today);
    checkDate.setDate(today.getDate() - i);

    const jsDay = checkDate.getDay();
    const daysFromSaturday = (jsDay + 1) % 7;
    const key = DAYS_KEYS[daysFromSaturday];

    const dayTasks = Array.isArray(tasksByDay[key]) ? tasksByDay[key] : [];

    // لو مفيش مهام النهاردة → منكسرش، نتجاهل
    if (dayTasks.length === 0) {
      if (i === 0) continue;
      break;
    }

    const allDone = dayTasks.every((t) => t && t.completed);
    if (allDone) {
      streak++;
    } else {
      if (i === 0) continue;
      break;
    }
  }

  return streak;
}


/* ============================================================
   09 — Task List
   المرجع: الوثيقة الأصلية — بنود 50، 52، 53، 158
   ============================================================ */

function updateTaskListTitle() {
  if (!taskListTitleEl) return;
  const idx = DAYS_KEYS.indexOf(selectedDayKey);
  const dayName = idx >= 0 ? DAYS_AR[idx] : "";
  taskListTitleEl.textContent = dayName ? `مهام ${dayName}` : "مهام اليوم";
}

function renderTaskList() {
  if (!taskListEl) return;

  const tasks = Array.isArray(tasksByDay[selectedDayKey]) ? tasksByDay[selectedDayKey] : [];

  // فلترة المكتملة حسب الاختيار
  let displayTasks = showCompleted ? tasks : tasks.filter((t) => !t.completed);

  // ترتيب: غير مكتملة أولاً، ثم حسب الوقت
  displayTasks = [...displayTasks].sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    return (a.time || "00:00").localeCompare(b.time || "00:00");
  });

  taskListEl.replaceChildren();

  if (displayTasks.length === 0) {
    taskListEl.appendChild(createEmptyState(tasks.length));
    return;
  }

  displayTasks.forEach((task) => {
    taskListEl.appendChild(createTaskElement(task));
  });
}

function createEmptyState(dayTasksCount) {
  const wrap = document.createElement("div");
  wrap.className = "pl-empty";

  const icon = document.createElement("div");
  icon.className = "pl-empty-icon";
  icon.setAttribute("aria-hidden", "true");
  const emptyGlyph = document.createElement("span");
  emptyGlyph.className = "icon icon-xl " + (dayTasksCount > 0 ? "icon-check-circle" : "icon-mail-empty");
  icon.appendChild(emptyGlyph);

  const title = document.createElement("h4");
  title.className = "pl-empty-title";
  title.textContent = dayTasksCount > 0
    ? "كل المهام مكتملة!"
    : "لا توجد مهام لهذا اليوم";

  const text = document.createElement("p");
  text.className = "pl-empty-text";
  text.textContent = dayTasksCount > 0
    ? "أنت رائع، استمر في الإنجاز."
    : "أضف مهمتك الأولى وابدأ الإنجاز.";

  wrap.appendChild(icon);
  wrap.appendChild(title);
  wrap.appendChild(text);

  return wrap;
}

function createTaskElement(task) {
  const id = safeText(task && task.id);
  const text = safeText(task && task.title);
  const time = safeText(task && task.time) || "00:00";
  const completed = !!task.completed;

  const item = document.createElement("div");
  item.className = "pl-task" + (completed ? " is-completed" : "");
  item.dataset.taskId = id;

  // زر الإكمال
  const check = document.createElement("button");
  check.type = "button";
  check.className = "pl-task-check";
  check.setAttribute("aria-label", completed ? "إلغاء الإكمال" : "إكمال");
  check.textContent = completed ? "✓" : "";
  check.addEventListener("click", () => handleToggleTask(id));
  item.appendChild(check);

  // الوقت
  const timeEl = document.createElement("span");
  timeEl.className = "pl-task-time";
  timeEl.textContent = time;
  item.appendChild(timeEl);

  // النص
  const textEl = document.createElement("span");
  textEl.className = "pl-task-text";
  textEl.textContent = text;
  item.appendChild(textEl);

  // الأزرار
  const actions = document.createElement("div");
  actions.className = "pl-task-actions";

  // زر جلسة مذاكرة
  const sessionBtn = document.createElement("button");
  sessionBtn.type = "button";
  sessionBtn.className = "pl-task-action";
  sessionBtn.title = "تسجيل جلسة مذاكرة";
  sessionBtn.setAttribute("aria-label", "تسجيل جلسة مذاكرة");
  const sessionGlyph = document.createElement("span");
  sessionGlyph.className = "icon icon-clock";
  sessionGlyph.setAttribute("aria-hidden", "true");
  sessionBtn.appendChild(sessionGlyph);
  sessionBtn.addEventListener("click", () => handleStartSession(task));
  actions.appendChild(sessionBtn);

  // زر التعديل
  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.className = "pl-task-action";
  editBtn.title = "تعديل";
  editBtn.setAttribute("aria-label", "تعديل");
  const editGlyph = document.createElement("span");
  editGlyph.className = "icon icon-pencil";
  editGlyph.setAttribute("aria-hidden", "true");
  editBtn.appendChild(editGlyph);
  editBtn.addEventListener("click", () => openEditModal(id, selectedDayKey, text));
  actions.appendChild(editBtn);

  // زر الحذف
  const delBtn = document.createElement("button");
  delBtn.type = "button";
  delBtn.className = "pl-task-action is-delete";
  delBtn.title = "حذف";
  delBtn.setAttribute("aria-label", "حذف");
  const delGlyph = document.createElement("span");
  delGlyph.className = "icon icon-trash";
  delGlyph.setAttribute("aria-hidden", "true");
  delBtn.appendChild(delGlyph);
  delBtn.addEventListener("click", () => handleDeleteTask(id, text));
  actions.appendChild(delBtn);

  item.appendChild(actions);

  return item;
}


/* ============================================================
   10 — إضافة مهمة
   المرجع: الوثيقة الأصلية — بند 51
   ============================================================ */

async function handleAddTask() {
  if (isSaving) return;

  const text = taskInputEl ? safeText(taskInputEl.value) : "";
  const time = taskTimeEl ? safeText(taskTimeEl.value) : "";
  const day  = taskDaySelectEl ? safeText(taskDaySelectEl.value) : selectedDayKey;

  if (!text) {
    showToast("اكتب المهمة أولاً.", "warning");
    if (taskInputEl) taskInputEl.focus();
    return;
  }

  if (text.length > 150) {
    showToast("المهمة طويلة جدًا.", "warning");
    return;
  }

  if (!time) {
    showToast("حدد وقت المهمة.", "warning");
    return;
  }

  isSaving = true;
  if (addTaskBtn) addTaskBtn.disabled = true;

  const result = await createTask({
    title: text,
    day,
    time,
    week: getCurrentWeekKey()
  });

  isSaving = false;
  if (addTaskBtn) addTaskBtn.disabled = false;

  if (!result || !result.success) {
    const msg = (result && result.error && result.error.message) || "تعذر إضافة المهمة.";
    showToast(msg, "error");
    return;
  }

  // نجاح — نضيف محليًا
  const newTask = (result.data && result.data.task) ? result.data.task : null;

  if (newTask) {
    if (!Array.isArray(tasksByDay[day])) tasksByDay[day] = [];
    tasksByDay[day].push(newTask);

    // لو أضفنا في يوم غير المختار → ننتقل له
    if (day !== selectedDayKey) {
      selectedDayKey = day;
      renderDaySelector();
      updateTaskListTitle();
    }

    renderTaskList();
    updateProgress();
    updateWeeklyStats();
    updateStreak();
    renderTaskDaySelect();
  }

  if (taskInputEl) taskInputEl.value = "";
  if (taskTimeEl)  taskTimeEl.value = "08:00";
  if (taskInputEl) taskInputEl.focus();

  showToast("تمت إضافة المهمة", "success");
}


/* ============================================================
   11 — إكمال مهمة
   المرجع: الوثيقة الأصلية — بند 53
   ============================================================ */

async function handleToggleTask(taskId) {
  const cleanId = safeText(taskId);
  if (!cleanId) return;

  // نلاقي المهمة
  let task = null;
  let dayKey = null;

  for (const k of DAYS_KEYS) {
    const list = Array.isArray(tasksByDay[k]) ? tasksByDay[k] : [];
    const found = list.find((t) => t && t.id === cleanId);
    if (found) { task = found; dayKey = k; break; }
  }

  if (!task) return;

  const newDone = !task.completed;

  // تحديث متفائل (Optimistic UI)
  task.completed = newDone;
  renderTaskList();
  updateProgress();
  updateWeeklyStats();
  updateStreak();

  // إرسال للـ Worker
  const result = await updateTask(cleanId, { done: newDone, week: getCurrentWeekKey() });

  if (!result || !result.success) {
    // rollback
    task.completed = !newDone;
    renderTaskList();
    updateProgress();
    updateWeeklyStats();
    updateStreak();

    const msg = (result && result.error && result.error.message) || "تعذر التحديث.";
    showToast(msg, "error");
    return;
  }

  // رسالة تشجيعية لو أكمل كل مهام اليوم
  if (newDone && dayKey) {
    const list = Array.isArray(tasksByDay[dayKey]) ? tasksByDay[dayKey] : [];
    const allDone = list.length > 0 && list.every((t) => t && t.completed);
    if (allDone) { showToast("أحسنت! أكملت كل مهام اليوم", "success"); try { barai.notify("planner.allDone"); } catch (e) { /* تجاهل */ } }
    else { try { barai.notify("planner.taskDone"); } catch (e) { /* تجاهل */ } }
  }
}


/* ============================================================
   12 — حذف مهمة
   المرجع: الوثيقة الأصلية — بند 52 + 161
   ============================================================ */

async function handleDeleteTask(taskId, taskText) {
  const cleanId = safeText(taskId);
  if (!cleanId) return;

  const confirmed = window.confirm(`متأكد من حذف: "${taskText}"؟`);
  if (!confirmed) return;

  // حذف متفائل
  let removedTask = null;
  let removedDay = null;

  for (const k of DAYS_KEYS) {
    const list = Array.isArray(tasksByDay[k]) ? tasksByDay[k] : [];
    const idx = list.findIndex((t) => t && t.id === cleanId);
    if (idx >= 0) {
      removedTask = list[idx];
      removedDay = k;
      list.splice(idx, 1);
      break;
    }
  }

  if (!removedTask) return;

  renderTaskList();
  updateProgress();
  updateWeeklyStats();
  updateStreak();

  const result = await deleteTask(cleanId, getCurrentWeekKey());

  if (!result || !result.success) {
    // rollback
    if (!Array.isArray(tasksByDay[removedDay])) tasksByDay[removedDay] = [];
    tasksByDay[removedDay].push(removedTask);
    renderTaskList();
    updateProgress();
    updateWeeklyStats();
    updateStreak();

    const msg = (result && result.error && result.error.message) || "تعذر الحذف.";
    showToast(msg, "error");
    return;
  }

  showToast("تم الحذف", "success");
}


/* ============================================================
   13 — تعديل مهمة
   المرجع: الوثيقة الأصلية — بند 52
   ============================================================ */

function openEditModal(taskId, dayKey, currentText) {
  const cleanId = safeText(taskId);
  if (!cleanId || !editModalEl) return;

  editingTaskId = cleanId;
  editingTaskDay = dayKey;

  if (editTaskInputEl) editTaskInputEl.value = currentText || "";

  editModalEl.classList.add("is-open");
  editModalEl.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";

  setTimeout(() => {
    if (editTaskInputEl) {
      editTaskInputEl.focus();
      editTaskInputEl.select();
    }
  }, 150);
}

function closeEditModal() {
  if (!editModalEl) return;
  editModalEl.classList.remove("is-open");
  editModalEl.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
  editingTaskId = null;
  editingTaskDay = null;
}

async function saveEditTask() {
  if (!editingTaskId || !editingTaskDay || isSaving) return;

  const newText = editTaskInputEl ? safeText(editTaskInputEl.value) : "";
  if (!newText) {
    showToast("المهمة لا يمكن أن تكون فارغة.", "warning");
    return;
  }

  isSaving = true;

  const list = Array.isArray(tasksByDay[editingTaskDay]) ? tasksByDay[editingTaskDay] : [];
  const task = list.find((t) => t && t.id === editingTaskId);
  if (!task) {
    isSaving = false;
    closeEditModal();
    return;
  }

  const oldText = task.title;
  task.title = newText;

  renderTaskList();
  closeEditModal();

  const result = await updateTask(editingTaskId, { title: newText, week: getCurrentWeekKey() });

  isSaving = false;

  if (!result || !result.success) {
    task.title = oldText;
    renderTaskList();
    const msg = (result && result.error && result.error.message) || "تعذر التعديل.";
    showToast(msg, "error");
    return;
  }

  showToast("تم التعديل", "success");
}


/* ============================================================
   14 — جلسة مذاكرة
   المرجع: الوثيقة الأصلية — بند 55
   ============================================================ */

async function handleStartSession(task) {
  // مؤقتًا: نسأل الطالب عن المدة
  const input = window.prompt("مدة الجلسة بالدقائق:", "25");
  if (input === null) return;

  const minutes = Number(input);
  if (!minutes || minutes <= 0 || minutes > 300) {
    showToast("المدة غير صحيحة.", "warning");
    return;
  }

  const result = await logStudySession(minutes);

  if (!result || !result.success) {
    const msg = (result && result.error && result.error.message) || "تعذر تسجيل الجلسة.";
    showToast(msg, "error");
    return;
  }

  showToast(`تم تسجيل جلسة ${minutes} دقيقة`, "success");
}


/* ============================================================
   15 — الاقتباس اليومي
   ============================================================ */

function renderDailyQuote() {
  if (!quoteTextEl || !quoteAuthorEl) return;

  // نختار اقتباس بناءً على اليوم (ثابت خلال اليوم)
  const today = new Date();
  const seed = today.getFullYear() * 1000 + today.getMonth() * 50 + today.getDate();
  const quote = QUOTES[seed % QUOTES.length];

  quoteTextEl.textContent = `"${quote.text}"`;
  quoteAuthorEl.textContent = `— ${quote.author}`;
}


/* ============================================================
   16 — تحميل المهام
   المرجع: الوثيقة الأصلية — بنود 48، 49، 54
   ============================================================ */

async function loadTasks() {
  if (isLoading) return;
  isLoading = true;

  // إعادة ضبط الحالة
  tasksByDay = {};
  DAYS_KEYS.forEach((k) => { tasksByDay[k] = []; });

  // عرض مؤقت
  renderTaskList();
  updateProgress();
  updateWeeklyStats();

  // طلب من الـ Worker
  const weekStartDate = getWeekStart(weekOffset);
  const weekKey = weekStartDate.toISOString().split("T")[0];

  const result = await getPlannerTasks({ week: weekKey });

  isLoading = false;

  if (!result || !result.success) {
    const msg = (result && result.error && result.error.message) || "تعذر تحميل المهام.";
    showToast(msg, "error");
    return;
  }

  const data = (result.data && result.data.tasksByDay) ? result.data.tasksByDay : {};

  DAYS_KEYS.forEach((k) => {
    if (Array.isArray(data[k])) {
      tasksByDay[k] = data[k].filter((t) => t && t.id && typeof t.title === "string");
    } else {
      tasksByDay[k] = [];
    }
  });

  renderTaskList();
  updateProgress();
  updateWeeklyStats();
  updateStreak();
}


/* ============================================================
   17 — تبديل الأسبوع
   المرجع: الوثيقة الأصلية — بند 49
   ============================================================ */

function goPrevWeek() {
  weekOffset -= 1;
  const todayKey = getTodayKey();
  selectedDayKey = weekOffset === 0 ? todayKey : DAYS_KEYS[0];
  afterWeekChange();
}

function goNextWeek() {
  weekOffset += 1;
  const todayKey = getTodayKey();
  selectedDayKey = weekOffset === 0 ? todayKey : DAYS_KEYS[0];
  afterWeekChange();
}

function afterWeekChange() {
  if (subtitleEl) subtitleEl.textContent = getWeekRangeLabel();
  renderDaySelector();
  renderTaskDaySelect();
  updateTaskListTitle();
  loadTasks();
}


/* ============================================================
   18 — Bottom Navigation
   ============================================================ */

function mountBottomNav() {
  if (!bottomNavSlot) return;
  bottomNavSlot.replaceChildren();
  bottomNavSlot.appendChild(renderBottomNav());
}


/* ============================================================
   19 — ربط الأحداث
   ============================================================ */

function bindEvents() {
  // تبديل الأسبوع
  if (prevWeekBtn) prevWeekBtn.addEventListener("click", goPrevWeek);
  if (nextWeekBtn) nextWeekBtn.addEventListener("click", goNextWeek);

  // إضافة مهمة
  if (addTaskBtn) addTaskBtn.addEventListener("click", handleAddTask);

  if (taskInputEl) {
    taskInputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleAddTask();
      }
    });
  }

  // اختيار اليوم في الـ select
  if (taskDaySelectEl) {
    taskDaySelectEl.addEventListener("change", () => {
      const key = safeText(taskDaySelectEl.value);
      if (key && DAYS_KEYS.includes(key)) {
        selectedDayKey = key;
        renderDaySelector();
        renderTaskList();
        updateProgress();
        updateTaskListTitle();
      }
    });
  }

  // Quick chips
  if (quickChipsEls && quickChipsEls.length) {
    quickChipsEls.forEach((chip) => {
      chip.addEventListener("click", () => {
        const quick = safeText(chip.dataset.quick);
        if (quick && taskInputEl) {
          taskInputEl.value = quick;
          taskInputEl.focus();
        }
      });
    });
  }

  // إخفاء/إظهار المكتملة
  if (toggleCompletedBtn) {
    toggleCompletedBtn.addEventListener("click", () => {
      showCompleted = !showCompleted;
      toggleCompletedBtn.textContent = showCompleted
        ? "إخفاء المكتملة"
        : "إظهار الكل";
      renderTaskList();
    });
  }

  // Modal
  if (editCancelBtn) editCancelBtn.addEventListener("click", closeEditModal);
  if (editSaveBtn)   editSaveBtn.addEventListener("click", saveEditTask);

  if (editTaskInputEl) {
    editTaskInputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        saveEditTask();
      }
      if (e.key === "Escape") {
        closeEditModal();
      }
    });
  }

  if (editModalEl) {
    editModalEl.addEventListener("click", (e) => {
      if (e.target === editModalEl) closeEditModal();
    });
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && editModalEl && editModalEl.classList.contains("is-open")) {
      closeEditModal();
    }
  });
}


/* ============================================================
   20 — التهيئة
   ============================================================ */

async function init() {
  const session = requireStudent();
  if (!session) return;

  cacheElements();

  currentStudent = getCurrentStudent() || session.student || null;

  // الشهر الحالي
  weekOffset = 0;
  selectedDayKey = getTodayKey();

  // رندر
  renderWelcome();
  renderDaySelector();
  renderTaskDaySelect();
  updateTaskListTitle();
  renderDailyQuote();
  mountBottomNav();
  bindEvents();

  if (subtitleEl) subtitleEl.textContent = getWeekRangeLabel();

  // تحميل المهام
  await loadTasks();
}


/* ============================================================
   21 — التشغيل
   ============================================================ */

onReady(init);