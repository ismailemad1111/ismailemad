/**
 * admin-exams.js
 * ------------------------------------------------------------
 * منصة أ/ إسماعيل عماد التعليمية
 * تشغيل صفحة admin/exams.html
 *
 * المكان: /js/admin-exams.js
 *
 * المرجع:
 *   - الوثيقة الأصلية (بنود 82، 83، 99، 100، 136، 173)
 *   - Master Design System (بنود 24، 25، 58)
 *
 * ⚠️ قواعد:
 *   - correctIndex بيانات حساسة (بند 43).
 *   - التحقق قبل النشر (بند 100).
 *   - الحد الأدنى 3 اختيارات، الأقصى 4 (بند 25 من DS).
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
  showToast,
  debounce,
  formatDate
} from "./helpers.js";

import {
  requireAdmin,
  getSession
} from "./router.js";


/* ============================================================
   01 — ثوابت
   ============================================================ */

const REQUEST_TIMEOUT_MS = 20000;

const MIN_CHOICES = 3;
const MAX_CHOICES = 4;
const MAX_QUESTIONS = 100;

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
  NOT_FOUND:     "الاختبار غير موجود.",
  BAD_REQUEST:   "البيانات المُرسَلة غير صحيحة."
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

const POLICY_LABELS = {
  immediate:       { text: "فورية",      cls: "exam-badge--immediate" },
  after_duration:  { text: "بعد مدة",    cls: "exam-badge--delayed" },
  after_datetime:  { text: "وقت محدد",   cls: "exam-badge--delayed" }
};

function getPolicyLabel(p) {
  const k = safeText(p);
  return POLICY_LABELS[k] || POLICY_LABELS.immediate;
}


/* ============================================================
   02 — المرجع للعناصر
   ============================================================ */

let headerSubEl     = null;
let createBtn       = null;

let statsRowEl      = null;
let statAllEl       = null;
let statPublishedEl = null;
let statDraftEl     = null;

let searchInput     = null;
let stageFiltersEl  = null;

let skeletonEl      = null;
let listEl          = null;
let emptyEl         = null;
let errorEl         = null;
let retryBtn        = null;

// Modal
let exModalEl       = null;
let exModalTitleEl  = null;
let exModalSubEl    = null;
let exTitleInput    = null;
let exStageSel      = null;
let exPolicySel     = null;
let exResultTimeGrp = null;
let exResultTimeInput = null;
let qBuilderListEl  = null;
let qBuilderCountEl = null;
let qAddQuestionBtn = null;
let exCancelBtn     = null;
let exConfirmBtn    = null;


/* ============================================================
   03 — الحالة
   ============================================================ */

let allExams = [];
let currentFilter = "all"; // all | published | draft
let currentStage = "all";
let currentSearch = "";
let isLoading = false;

let editingId = null;         // null = إنشاء جديد
let isSaving = false;

/** الأسئلة الحالية (مصفوفة) */
let questions = [];

/** آخر رقم سؤال (للـ ID) */
let questionCounter = 0;


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
  headerSubEl     = document.getElementById("exHeaderSub");
  createBtn       = document.getElementById("exCreateBtn");

  statsRowEl      = document.getElementById("exStats");
  statAllEl       = document.getElementById("statExAll");
  statPublishedEl = document.getElementById("statExPublished");
  statDraftEl     = document.getElementById("statExDraft");

  searchInput     = document.getElementById("exSearchInput");
  stageFiltersEl  = document.getElementById("exStageFilters");

  skeletonEl      = document.getElementById("exSkeleton");
  listEl          = document.getElementById("exList");
  emptyEl         = document.getElementById("exEmpty");
  errorEl         = document.getElementById("exError");
  retryBtn        = document.getElementById("exRetryBtn");

  exModalEl       = document.getElementById("exModal");
  exModalTitleEl  = document.getElementById("exModalTitle");
  exModalSubEl    = document.getElementById("exModalSub");
  exTitleInput    = document.getElementById("exTitleInput");
  exStageSel      = document.getElementById("exStageSelect");
  exPolicySel     = document.getElementById("exPolicySelect");
  exResultTimeGrp = document.getElementById("exResultTimeGroup");
  exResultTimeInput = document.getElementById("exResultTimeInput");
  qBuilderListEl  = document.getElementById("qBuilderList");
  qBuilderCountEl = document.getElementById("qBuilderCount");
  qAddQuestionBtn = document.getElementById("qAddQuestionBtn");
  exCancelBtn     = document.getElementById("exCancelBtn");
  exConfirmBtn    = document.getElementById("exConfirmBtn");
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
  const total     = allExams.length;
  const published = allExams.filter((e) => e && e.status === "published").length;
  const draft     = allExams.filter((e) => e && e.status !== "published").length;

  if (statAllEl)       statAllEl.textContent       = String(total);
  if (statPublishedEl) statPublishedEl.textContent = String(published);
  if (statDraftEl)     statDraftEl.textContent     = String(draft);
}


/* ============================================================
   08 — الفلترة والبحث
   ============================================================ */

function getFilteredExams() {
  let list = Array.isArray(allExams) ? allExams.slice() : [];

  if (currentFilter === "published") {
    list = list.filter((e) => e && e.status === "published");
  } else if (currentFilter === "draft") {
    list = list.filter((e) => e && e.status !== "published");
  }

  if (currentStage !== "all") {
    list = list.filter((e) => e && e.stage === currentStage);
  }

  const q = safeText(currentSearch).toLowerCase();
  if (q) {
    list = list.filter((e) => {
      if (!e) return false;
      const title = safeText(e.title).toLowerCase();
      return title.includes(q);
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
   09 — بناء كارت الاختبار
   ============================================================ */

function createExamCard(exam) {
  const id          = safeText(exam && exam.id);
  const title       = safeText(exam && exam.title) || "اختبار";
  const stage       = safeText(exam && exam.stage);
  const status      = safeText(exam && exam.status) || "draft";
  const policy      = safeText(exam && exam.resultPolicy) || "immediate";
  const qCount      = Number(exam && exam.questionsCount) || 0;
  const createdAt   = exam && exam.createdAt;
  const attemptsCnt = Number(exam && exam.attemptsCount) || 0;

  const isPublished = status === "published";
  const policyMeta  = getPolicyLabel(policy);

  const card = document.createElement("article");
  card.className = "exam-card";
  card.dataset.examId = id;

  // Head
  const head = document.createElement("div");
  head.className = "exam-card-head";

  const body = document.createElement("div");
  body.className = "exam-card-body";

  const titleEl = document.createElement("h3");
  titleEl.className = "exam-card-title";
  titleEl.textContent = title;
  body.appendChild(titleEl);

  const badges = document.createElement("div");
  badges.className = "exam-badges";

  if (stage) {
    const sBadge = document.createElement("span");
    sBadge.className = "exam-badge";
    sBadge.textContent = getStageName(stage);
    badges.appendChild(sBadge);
  }

  if (qCount > 0) {
    const qBadge = document.createElement("span");
    qBadge.className = "exam-badge exam-badge--questions";
    qBadge.textContent = `${qCount} سؤال`;
    badges.appendChild(qBadge);
  }

  const pBadge = document.createElement("span");
  pBadge.className = `exam-badge ${policyMeta.cls}`;
  pBadge.textContent = `النتيجة: ${policyMeta.text}`;
  badges.appendChild(pBadge);

  body.appendChild(badges);

  const meta = document.createElement("div");
  meta.className = "exam-meta";

  if (createdAt) {
    const item = document.createElement("span");
    item.className = "exam-meta-item";
    const ic = document.createElement("span"); ic.textContent = "📅";
    const tx = document.createElement("span"); tx.textContent = formatDate(createdAt) || "—";
    item.appendChild(ic); item.appendChild(tx);
    meta.appendChild(item);
  }

  if (attemptsCnt > 0) {
    const item = document.createElement("span");
    item.className = "exam-meta-item";
    const ic = document.createElement("span"); ic.textContent = "🎯";
    const tx = document.createElement("span"); tx.textContent = `${attemptsCnt} محاولة`;
    item.appendChild(ic); item.appendChild(tx);
    meta.appendChild(item);
  }

  if (meta.childNodes.length > 0) body.appendChild(meta);

  const statusBadge = document.createElement("span");
  statusBadge.className = isPublished ? "exam-status exam-status--published" : "exam-status exam-status--draft";
  statusBadge.textContent = isPublished ? "منشور" : "مسودة";

  head.appendChild(body);
  head.appendChild(statusBadge);
  card.appendChild(head);

  // Actions
  const actions = document.createElement("div");
  actions.className = "exam-actions";

  // Publish / Unpublish
  const publishBtn = document.createElement("button");
  publishBtn.type = "button";
  publishBtn.className = `exam-action-btn ${isPublished ? "" : "exam-action-btn--primary"}`;
  publishBtn.textContent = isPublished ? "🚫 إلغاء النشر" : "🚀 نشر";
  publishBtn.addEventListener("click", () => handleTogglePublish(id, status));
  actions.appendChild(publishBtn);

  // Results
  const resultsBtn = document.createElement("a");
  resultsBtn.className = "exam-action-btn exam-action-btn--info";
  resultsBtn.href = `results.html?examId=${encodeURIComponent(id)}`;
  resultsBtn.textContent = "📊 النتائج";
  actions.appendChild(resultsBtn);

  // Edit
  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.className = "exam-action-btn";
  editBtn.textContent = "✏️ تعديل";
  editBtn.addEventListener("click", () => openExamModal(exam));
  actions.appendChild(editBtn);

  // Delete
  const delBtn = document.createElement("button");
  delBtn.type = "button";
  delBtn.className = "exam-action-btn exam-action-btn--danger";
  delBtn.textContent = "🗑️ حذف";
  delBtn.addEventListener("click", () => handleDelete(id, title));
  actions.appendChild(delBtn);

  card.appendChild(actions);

  return card;
}


/* ============================================================
   10 — عرض القائمة
   ============================================================ */

function renderExams() {
  if (!listEl) return;

  const list = getFilteredExams();

  if (list.length === 0) {
    if (currentSearch || currentFilter !== "all" || currentStage !== "all") {
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
  list.forEach((e) => listEl.appendChild(createExamCard(e)));
  showList();
}


/* ============================================================
   11 — تحميل الاختبارات
   ============================================================ */

async function loadExams() {
  if (isLoading) return;
  isLoading = true;

  showLoading();

  const result = await workerFetch("/api/admin/exams");

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
  const list = Array.isArray(data.exams) ? data.exams : [];

  allExams = list.filter((e) => e && e.id);

  if (headerSubEl) {
    headerSubEl.textContent = `${allExams.length} اختبار`;
  }

  updateStats();
  renderExams();
}


/* ============================================================
   12 — Question Builder — إدارة الأسئلة
   ============================================================ */

/**
 * إنشاء سؤال جديد.
 * @returns {Object} { id, text, choices, correctIndex }
 */
function createQuestionModel() {
  questionCounter += 1;
  return {
    id: `q_${questionCounter}_${Date.now()}`,
    text: "",
    choices: ["", "", ""], // 3 اختيارات افتراضية (الحد الأدنى)
    correctIndex: 0
  };
}

/**
 * إيجاد السؤال من خلال الـ ID.
 */
function findQuestion(id) {
  return questions.find((q) => q.id === id);
}

/**
 * بناء عنصر سؤال في الواجهة.
 * @param {Object} q
 * @param {number} index - ترتيب السؤال (0-based)
 * @returns {HTMLElement}
 */
function createQuestionElement(q, index) {
  const item = document.createElement("div");
  item.className = "q-item";
  item.dataset.questionId = q.id;

  // Head
  const head = document.createElement("div");
  head.className = "q-item-head";

  const num = document.createElement("span");
  num.className = "q-item-number";
  num.textContent = `سؤال ${index + 1}`;

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "q-remove-btn";
  removeBtn.title = "حذف السؤال";
  removeBtn.textContent = "✕";
  removeBtn.addEventListener("click", () => handleRemoveQuestion(q.id));

  head.appendChild(num);
  head.appendChild(removeBtn);
  item.appendChild(head);

  // نص السؤال
  const textField = document.createElement("div");
  textField.className = "q-field";

  const textLabel = document.createElement("label");
  textLabel.className = "q-field-label";
  textLabel.textContent = "نص السؤال";

  const textInput = document.createElement("input");
  textInput.type = "text";
  textInput.className = "q-input";
  textInput.value = safeText(q.text);
  textInput.placeholder = "اكتب السؤال هنا...";
  textInput.maxLength = 500;
  textInput.addEventListener("input", (e) => {
    q.text = e.target.value;
  });

  textField.appendChild(textLabel);
  textField.appendChild(textInput);
  item.appendChild(textField);

  // الاختيارات
  const choicesField = document.createElement("div");
  choicesField.className = "q-field";

  const choicesLabel = document.createElement("label");
  choicesLabel.className = "q-field-label";
  choicesLabel.textContent = "الاختيارات (اختر الإجابة الصحيحة)";

  const choicesList = document.createElement("div");
  choicesList.className = "q-choices-list";

  q.choices.forEach((choice, idx) => {
    choicesList.appendChild(createChoiceRow(q, idx));
  });

  choicesField.appendChild(choicesLabel);
  choicesField.appendChild(choicesList);

  // زر إضافة اختيار
  const addChoiceBtn = document.createElement("button");
  addChoiceBtn.type = "button";
  addChoiceBtn.className = "q-add-choice";
  addChoiceBtn.innerHTML = "";
  const ic = document.createElement("span"); ic.textContent = "➕";
  const tx = document.createElement("span"); tx.textContent = "إضافة اختيار";
  addChoiceBtn.appendChild(ic);
  addChoiceBtn.appendChild(tx);
  addChoiceBtn.disabled = q.choices.length >= MAX_CHOICES;
  addChoiceBtn.addEventListener("click", () => handleAddChoice(q.id));

  choicesField.appendChild(addChoiceBtn);
  item.appendChild(choicesField);

  return item;
}

/**
 * بناء صف اختيار.
 */
function createChoiceRow(q, choiceIndex) {
  const row = document.createElement("div");
  row.className = "q-choice-row";
  if (q.correctIndex === choiceIndex) row.classList.add("is-correct");

  // Radio
  const radio = document.createElement("div");
  radio.className = "q-choice-radio";
  radio.setAttribute("role", "radio");
  radio.setAttribute("aria-checked", q.correctIndex === choiceIndex ? "true" : "false");
  radio.setAttribute("tabindex", "0");

  const inner = document.createElement("span");
  inner.className = "q-choice-radio-inner";
  radio.appendChild(inner);

  const selectAsCorrect = () => {
    q.correctIndex = choiceIndex;
    refreshQuestionElement(q.id);
  };

  radio.addEventListener("click", selectAsCorrect);
  radio.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      selectAsCorrect();
    }
  });

  // Input
  const input = document.createElement("input");
  input.type = "text";
  input.className = "q-choice-input";
  input.value = safeText(q.choices[choiceIndex]);
  input.placeholder = `الاختيار ${choiceIndex + 1}`;
  input.maxLength = 200;
  input.addEventListener("input", (e) => {
    q.choices[choiceIndex] = e.target.value;
  });

  // Remove
  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "q-choice-remove";
  removeBtn.title = "حذف الاختيار";
  removeBtn.textContent = "✕";
  removeBtn.disabled = q.choices.length <= MIN_CHOICES;
  removeBtn.style.opacity = q.choices.length <= MIN_CHOICES ? "0.3" : "1";
  removeBtn.addEventListener("click", () => handleRemoveChoice(q.id, choiceIndex));

  row.appendChild(radio);
  row.appendChild(input);
  row.appendChild(removeBtn);

  return row;
}

/**
 * إعادة بناء عنصر سؤال (بعد تعديل).
 */
function refreshQuestionElement(qId) {
  const q = findQuestion(qId);
  if (!q || !qBuilderListEl) return;

  const oldEl = qBuilderListEl.querySelector(`[data-question-id="${qId}"]`);
  if (!oldEl) return;

  const index = questions.indexOf(q);
  const newEl = createQuestionElement(q, index);
  oldEl.replaceWith(newEl);
}

/**
 * إضافة سؤال جديد.
 */
function handleAddQuestion() {
  if (questions.length >= MAX_QUESTIONS) {
    showToast("لا يمكن إضافة أكثر من " + MAX_QUESTIONS + " سؤال.", "warning");
    return;
  }

  const q = createQuestionModel();
  questions.push(q);

  // أضف للـ DOM
  if (qBuilderListEl) {
    const index = questions.length - 1;
    qBuilderListEl.appendChild(createQuestionElement(q, index));
  }

  updateQuestionsCount();

  // scroll للسؤال الجديد
  if (qBuilderListEl && qBuilderListEl.lastElementChild) {
    qBuilderListEl.lastElementChild.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

/**
 * حذف سؤال.
 */
function handleRemoveQuestion(qId) {
  const idx = questions.findIndex((q) => q.id === qId);
  if (idx < 0) return;

  // لو آخر سؤال
  if (questions.length === 1) {
    const confirmed = window.confirm("هذا هو السؤال الوحيد. هل تريد حذفه؟");
    if (!confirmed) return;
  }

  questions.splice(idx, 1);

  // rebuild list
  renderQuestionsBuilder();
}

/**
 * إضافة اختيار.
 */
function handleAddChoice(qId) {
  const q = findQuestion(qId);
  if (!q) return;

  if (q.choices.length >= MAX_CHOICES) {
    showToast(`الحد الأقصى ${MAX_CHOICES} اختيارات.`, "warning");
    return;
  }

  q.choices.push("");
  refreshQuestionElement(qId);
}

/**
 * حذف اختيار.
 */
function handleRemoveChoice(qId, choiceIndex) {
  const q = findQuestion(qId);
  if (!q) return;

  if (q.choices.length <= MIN_CHOICES) {
    showToast(`الحد الأدنى ${MIN_CHOICES} اختيارات.`, "warning");
    return;
  }

  q.choices.splice(choiceIndex, 1);

  // لو الإجابة الصحيحة كانت في المحذوف
  if (q.correctIndex === choiceIndex) {
    q.correctIndex = 0;
  } else if (q.correctIndex > choiceIndex) {
    q.correctIndex -= 1;
  }

  refreshQuestionElement(qId);
}

/**
 * إعادة بناء كل الـ builder (بعد حذف سؤال).
 */
function renderQuestionsBuilder() {
  if (!qBuilderListEl) return;

  qBuilderListEl.replaceChildren();
  questions.forEach((q, idx) => {
    qBuilderListEl.appendChild(createQuestionElement(q, idx));
  });

  updateQuestionsCount();
}

/**
 * تحديث عدد الأسئلة.
 */
function updateQuestionsCount() {
  if (qBuilderCountEl) {
    qBuilderCountEl.textContent = `${questions.length} سؤال`;
  }
}


/* ============================================================
   13 — Modal — فتح / إغلاق
   ============================================================ */

function openExamModal(existing) {
  if (!exModalEl) return;

  editingId = existing ? safeText(existing.id) : null;

  // Reset
  if (exTitleInput) exTitleInput.value = existing ? safeText(existing.title) : "";
  if (exStageSel)   exStageSel.value   = existing ? safeText(existing.stage) : "";
  if (exPolicySel)  exPolicySel.value  = existing ? safeText(existing.resultPolicy) : "immediate";
  if (exResultTimeInput) {
    exResultTimeInput.value = existing && existing.resultTime
      ? safeText(existing.resultTime)
      : "";
  }

  // Questions
  questions = [];
  questionCounter = 0;

  if (existing && Array.isArray(existing.questions)) {
    existing.questions.forEach((q) => {
      questionCounter += 1;
      questions.push({
        id: `q_${questionCounter}_${Date.now()}`,
        text: safeText(q.text),
        choices: Array.isArray(q.choices) ? q.choices.map((c) => safeText(c)) : ["", "", ""],
        correctIndex: Number(q.correctIndex) || 0
      });
    });
  }

  // لو مفيش أسئلة (اختبار جديد) → نضيف سؤال افتراضي
  if (questions.length === 0) {
    questions.push(createQuestionModel());
  }

  // Titles
  if (exModalTitleEl) exModalTitleEl.textContent = existing ? "تعديل الاختبار" : "اختبار جديد";
  if (exModalSubEl)   exModalSubEl.textContent   = existing
    ? "عدّل بيانات الاختبار ثم احفظ."
    : "سيظهر الاختبار للطلاب بعد النشر.";

  if (exConfirmBtn) exConfirmBtn.textContent = existing ? "حفظ" : "حفظ كمسودة";

  // Result time
  toggleResultTimeField();

  // Render Questions
  renderQuestionsBuilder();

  // Open
  exModalEl.classList.add("is-open");
  exModalEl.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";

  setTimeout(() => {
    if (exTitleInput) exTitleInput.focus();
  }, 150);
}

function closeExamModal() {
  if (!exModalEl) return;
  exModalEl.classList.remove("is-open");
  exModalEl.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
  editingId = null;
  questions = [];
  questionCounter = 0;
}


/* ============================================================
   14 — حقول ديناميكية
   ============================================================ */

function toggleResultTimeField() {
  if (!exPolicySel || !exResultTimeGrp) return;

  const v = safeText(exPolicySel.value);
  if (v === "immediate") {
    exResultTimeGrp.style.display = "none";
  } else {
    exResultTimeGrp.style.display = "";
  }
}


/* ============================================================
   15 — التحقق
   ============================================================ */

function collectExamData() {
  const title  = safeText(exTitleInput ? exTitleInput.value : "");
  const stage  = safeText(exStageSel ? exStageSel.value : "");
  const policy = safeText(exPolicySel ? exPolicySel.value : "immediate");
  const resultTime = safeText(exResultTimeInput ? exResultTimeInput.value : "");

  const errors = {};

  // العنوان
  if (!title) {
    errors.title = "من فضلك أدخل عنوان الاختبار.";
  } else if (title.length > 150) {
    errors.title = "العنوان طويل جدًا.";
  }

  // المرحلة
  if (!stage) {
    errors.stage = "من فضلك اختر المرحلة.";
  }

  // السياسة
  if (!["immediate", "after_duration", "after_datetime"].includes(policy)) {
    errors.policy = "سياسة النتيجة غير صحيحة.";
  }

  // وقت النتيجة
  if (policy !== "immediate" && !resultTime) {
    errors.resultTime = "من فضلك حدد وقت ظهور النتيجة.";
  }

  // الأسئلة
  if (questions.length < 1) {
    errors.questions = "يجب إضافة سؤال واحد على الأقل.";
  } else {
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const idx = i + 1;

      if (!safeText(q.text)) {
        errors.questions = `السؤال ${idx}: نص السؤال ناقص.`;
        break;
      }

      if (!Array.isArray(q.choices) || q.choices.length < MIN_CHOICES) {
        errors.questions = `السؤال ${idx}: يجب أن يحتوي ${MIN_CHOICES} اختيارات على الأقل.`;
        break;
      }

      if (q.choices.length > MAX_CHOICES) {
        errors.questions = `السؤال ${idx}: الحد الأقصى ${MAX_CHOICES} اختيارات.`;
        break;
      }

      const hasEmpty = q.choices.some((c) => !safeText(c));
      if (hasEmpty) {
        errors.questions = `السؤال ${idx}: يوجد اختيار فارغ.`;
        break;
      }

      const ci = Number(q.correctIndex);
      if (isNaN(ci) || ci < 0 || ci >= q.choices.length) {
        errors.questions = `السؤال ${idx}: الإجابة الصحيحة غير محددة.`;
        break;
      }
    }
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    data: {
      title,
      stage,
      resultPolicy: policy,
      resultTime: policy !== "immediate" ? resultTime : null,
      questions: questions.map((q) => ({
        text: safeText(q.text),
        choices: q.choices.map((c) => safeText(c)),
        correctIndex: Number(q.correctIndex)
      }))
    }
  };
}


/* ============================================================
   16 — حفظ (إنشاء / تعديل)
   ============================================================ */

async function handleSaveExam() {
  if (isSaving) return;

  const { valid, errors, data } = collectExamData();

  if (!valid) {
    const firstError = Object.values(errors)[0];
    showToast(firstError || "تحقق من البيانات.", "warning");
    return;
  }

  isSaving = true;
  if (exConfirmBtn) {
    exConfirmBtn.disabled = true;
    exConfirmBtn.textContent = editingId ? "جارٍ الحفظ..." : "جارٍ الحفظ...";
  }

  let result;
  if (editingId) {
    result = await workerFetch(`/api/admin/exams/${encodeURIComponent(editingId)}`, {
      method: "PATCH",
      body: data
    });
  } else {
    result = await workerFetch("/api/admin/exams", {
      method: "POST",
      body: data
    });
  }

  isSaving = false;
  if (exConfirmBtn) {
    exConfirmBtn.disabled = false;
    exConfirmBtn.textContent = editingId ? "حفظ" : "حفظ كمسودة";
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
  const savedItem = (result.data && result.data.exam) ? result.data.exam : null;

  if (savedItem && savedItem.id) {
    if (editingId) {
      const idx = allExams.findIndex((e) => e && e.id === editingId);
      if (idx >= 0) allExams[idx] = savedItem;
    } else {
      allExams.unshift(savedItem);
    }
  }

  updateStats();
  renderExams();
  closeExamModal();

  showToast(editingId ? "تم الحفظ ✅" : "تم إنشاء الاختبار كمسودة ✅", "success");
}


/* ============================================================
   17 — نشر / إلغاء نشر
   ============================================================ */

async function handleTogglePublish(examId, currentStatus) {
  const cleanId = safeText(examId);
  if (!cleanId) return;

  const isPublished = currentStatus === "published";
  const newStatus = isPublished ? "draft" : "published";

  const confirmText = isPublished
    ? "هل تريد إلغاء نشر الاختبار؟ لن يظهر للطلاب."
    : "هل تريد نشر الاختبار؟ سيظهر للطلاب في مرحلتهم.";

  if (!window.confirm(confirmText)) return;

  const result = await workerFetch(`/api/admin/exams/${encodeURIComponent(cleanId)}/publish`, {
    method: "PATCH",
    body: { status: newStatus }
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

  // تحديث محلي
  const exam = allExams.find((e) => e && e.id === cleanId);
  if (exam) exam.status = newStatus;

  updateStats();
  renderExams();

  showToast(isPublished ? "تم إلغاء النشر" : "تم النشر ✅", "success");
}


/* ============================================================
   18 — حذف
   ============================================================ */

async function handleDelete(id, title) {
  const cleanId = safeText(id);
  if (!cleanId) return;

  const confirmed = window.confirm(`متأكد من حذف الاختبار: "${title}"؟\nسيتم حذف جميع النتائج المرتبطة به.`);
  if (!confirmed) return;

  const result = await workerFetch(`/api/admin/exams/${encodeURIComponent(cleanId)}`, {
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

  allExams = allExams.filter((e) => e && e.id !== cleanId);
  updateStats();
  renderExams();

  showToast("تم الحذف", "success");
}


/* ============================================================
   19 — Stats Row Clickable
   ============================================================ */

function bindStatsClick() {
  if (!statsRowEl) return;

  statsRowEl.querySelectorAll(".ex-stat").forEach((stat) => {
    stat.addEventListener("click", () => {
      const status = safeText(stat.dataset.status) || "all";
      if (status === currentFilter) return;

      currentFilter = status;

      statsRowEl.querySelectorAll(".ex-stat").forEach((s) => {
        s.classList.toggle("is-active", s.dataset.status === status);
      });

      renderExams();
    });
  });
}


/* ============================================================
   20 — Stage Filters
   ============================================================ */

function bindStageFilters() {
  if (!stageFiltersEl) return;

  stageFiltersEl.querySelectorAll(".ex-filter").forEach((btn) => {
    btn.addEventListener("click", () => {
      const stage = safeText(btn.dataset.stage) || "all";
      if (stage === currentStage) return;

      currentStage = stage;

      stageFiltersEl.querySelectorAll(".ex-filter").forEach((b) => {
        b.classList.toggle("is-active", b.dataset.stage === stage);
      });

      renderExams();
    });
  });
}


/* ============================================================
   21 — ربط الأحداث
   ============================================================ */

function bindEvents() {
  if (createBtn) createBtn.addEventListener("click", () => openExamModal(null));
  if (retryBtn)  retryBtn.addEventListener("click", () => loadExams());

  // Search (بـ debounce)
  if (searchInput) {
    const debounced = debounce((value) => {
      currentSearch = value || "";
      renderExams();
    }, 300);

    searchInput.addEventListener("input", (e) => {
      debounced(e.target.value);
    });
  }

  // Modal actions
  if (exCancelBtn)  exCancelBtn.addEventListener("click", closeExamModal);
  if (exConfirmBtn) exConfirmBtn.addEventListener("click", handleSaveExam);

  if (exModalEl) {
    exModalEl.addEventListener("click", (e) => {
      if (e.target === exModalEl) closeExamModal();
    });
  }

  // Policy change → إظهار/إخفاء وقت النتيجة
  if (exPolicySel) {
    exPolicySel.addEventListener("change", toggleResultTimeField);
  }

  // Add question
  if (qAddQuestionBtn) {
    qAddQuestionBtn.addEventListener("click", handleAddQuestion);
  }

  // Escape
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && exModalEl && exModalEl.classList.contains("is-open")) {
      closeExamModal();
    }
  });

  // Bind filters
  bindStatsClick();
  bindStageFilters();
}


/* ============================================================
   22 — التهيئة
   ============================================================ */

async function init() {
  const session = requireAdmin();
  if (!session) return;

  cacheElements();
  bindEvents();

  await loadExams();
}


/* ============================================================
   23 — التشغيل
   ============================================================ */

onReady(init);