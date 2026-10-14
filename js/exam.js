/**
 * exam.js
 * ------------------------------------------------------------
 * منصة أ/ إسماعيل عماد التعليمية
 * تشغيل صفحة exam.html
 *
 * المكان: /js/exam.js
 *
 * المرجع:
 *   - الوثيقة الأصلية (بنود 37، 38، 39، 40، 41، 42، 43، 44، 45،
 *                       128، 183، 187)
 *   - Master Design System (بنود 22، 24، 25، 26، 27، 33، 34، 36)
 *
 * ⚠️ قواعد صارمة:
 *   - لا نطلب / لا نعرض correctIndex قبل الإرسال (بند 43).
 *   - التصحيح في Worker (بند 42).
 *   - منع المحاولة الثانية في Worker (بند 41، 128).
 *   - إرسال مرة واحدة فقط (بند 183، 187).
 *
 * ⚠️ حالة الملف:
 *   - WORKER_URL = PLACEHOLDER_WORKER_URL (البند 207).
 *   - جميع الدوال سترجع NETWORK_ERROR حتى بناء الـ Worker.
 *   - سيظهر Error State مع زر الرجوع للاختبارات.
 * ------------------------------------------------------------
 */

import { mascotEl, confettiBurst } from "./mascot.js";
import {
  onReady,
  safeText,
  showToast
} from "./helpers.js";

import {
  requireStudent,
  ROUTES
} from "./router.js";

import {
  startExam,
  submitExam,
  getExamResult
} from "./api.js";

import { validateExamAnswer } from "./validation.js";


import { barai } from "./barai/safe.js";

/* ============================================================
   01 — المرجع للعناصر
   ============================================================ */

// Header
let titleEl          = null;
let timerEl          = null;

// States
let loadingEl        = null;
let errorEl          = null;
let errorTitleEl     = null;
let errorTextEl      = null;

// Instructions
let instructionsEl   = null;
let instrTitleEl     = null;
let instrCountEl     = null;
let instrStageEl     = null;
let startBtn         = null;

// Questions
let questionsEl      = null;
let progressFillEl   = null;
let currentNumEl     = null;
let totalNumEl       = null;
let questionBadgeEl  = null;
let questionTextEl   = null;
let choicesEl        = null;
let prevBtn          = null;
let nextBtn          = null;

// Result
let resultEl         = null;
let resultIconEl     = null;
let resultTitleEl    = null;
let resultSubEl      = null;
let resultScoreEl    = null;
let resultScoreValEl = null;
let resultScoreLblEl = null;
let resultStatsEl    = null;
let resultCorrectEl  = null;
let resultWrongEl    = null;

// Confirmation Dialog
let confirmOverlay   = null;
let confirmSubmitBtn = null;
let confirmCancelBtn = null;


/* ============================================================
   02 — الحالة
   ============================================================ */

/** معرّف الاختبار من الرابط */
let examId = null;

/** "result" أو null */
let viewMode = null;

/** تفاصيل الاختبار الحالي (من Worker) */
let examData = null;

/** الأسئلة الحالية (من Worker — بدون correctIndex) */
let questions = [];

/** إجابات الطالب: index → choiceIndex / null */
let answers = [];

/** رقم السؤال الحالي (0-indexed) */
let currentIndex = 0;

/** هل الإرسال جارٍ الآن؟ */
let isSubmitting = false;

/** هل تم إرسال الاختبار بالفعل؟ */
let isSubmitted = false;


/* ============================================================
   03 — تجميع العناصر
   ============================================================ */

function cacheElements() {
  titleEl          = document.getElementById("examTitle");
  timerEl          = document.getElementById("examTimer");

  loadingEl        = document.getElementById("examLoading");
  errorEl          = document.getElementById("examError");
  errorTitleEl     = document.getElementById("examErrorTitle");
  errorTextEl      = document.getElementById("examErrorText");

  instructionsEl   = document.getElementById("examInstructions");
  instrTitleEl     = document.getElementById("instrTitle");
  instrCountEl     = document.getElementById("instrQuestionsCount");
  instrStageEl     = document.getElementById("instrStage");
  startBtn         = document.getElementById("examStartBtn");

  questionsEl      = document.getElementById("examQuestions");
  progressFillEl   = document.getElementById("examProgressFill");
  currentNumEl     = document.getElementById("examCurrentNum");
  totalNumEl       = document.getElementById("examTotalNum");
  questionBadgeEl  = document.getElementById("examQuestionBadge");
  questionTextEl   = document.getElementById("examQuestionText");
  choicesEl        = document.getElementById("examChoices");
  prevBtn          = document.getElementById("examPrevBtn");
  nextBtn          = document.getElementById("examNextBtn");

  resultEl         = document.getElementById("examResult");
  resultIconEl     = document.getElementById("resultIcon");
  resultTitleEl    = document.getElementById("resultTitle");
  resultSubEl      = document.getElementById("resultSub");
  resultScoreEl    = document.getElementById("resultScore");
  resultScoreValEl = document.getElementById("resultScoreValue");
  resultScoreLblEl = document.getElementById("resultScoreLabel");
  resultStatsEl    = document.getElementById("resultStats");
  resultCorrectEl  = document.getElementById("resultCorrect");
  resultWrongEl    = document.getElementById("resultWrong");

  confirmOverlay   = document.getElementById("examConfirmOverlay");
  confirmSubmitBtn = document.getElementById("confirmSubmitBtn");
  confirmCancelBtn = document.getElementById("confirmCancelBtn");
}


/* ============================================================
   04 — أدوات مساعدة
   ============================================================ */

/**
 * إخفاء كل المراحل.
 */
function hideAllStages() {
  if (loadingEl)      loadingEl.style.display = "none";
  if (errorEl)        errorEl.style.display = "none";
  if (instructionsEl) instructionsEl.style.display = "none";
  if (questionsEl)    questionsEl.style.display = "none";
  if (resultEl)       resultEl.style.display = "none";
}

/**
 * عرض حالة التحميل.
 */
function showLoading() {
  hideAllStages();
  if (loadingEl) loadingEl.style.display = "";
}

/**
 * عرض حالة الخطأ.
 * @param {string} title
 * @param {string} text
 */
function showError(title, text) {
  hideAllStages();
  if (errorTitleEl) errorTitleEl.textContent = title || "تعذر تحميل الاختبار";
  if (errorTextEl)  errorTextEl.textContent  = text  || "تأكد من الرابط أو حاول مرة أخرى.";
  if (errorEl)      errorEl.style.display = "";
}

/**
 * عرض مرحلة التعليمات.
 */
function showInstructions() {
  hideAllStages();
  try { barai.busy(false); barai.notify("exam.intro"); } catch (e) { /* تجاهل */ }
  if (instructionsEl) instructionsEl.style.display = "";
}

/**
 * عرض مرحلة الأسئلة.
 */
function showQuestions() {
  hideAllStages();
  try { barai.busy(true); } catch (e) { /* تجاهل */ }
  // CSS يخفي .exam-questions افتراضيًا (display:none) و"" لا تكفي لإظهارها — نفس مشكلة شاشة النتيجة
  if (questionsEl) questionsEl.style.display = "block";
}

/**
 * عرض مرحلة النتيجة.
 */
function showResult() {
  hideAllStages();
  try { barai.busy(false); } catch (e) { /* تجاهل */ }
  if (resultEl) resultEl.style.display = "block"; // CSS يخفيها افتراضيًا (.exam-result{display:none})، و"" لا تكفي لإظهارها
}

/**
 * أسماء المراحل.
 */
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
  return STAGE_NAMES[k] || k || "";
}


/* ============================================================
   05 — قراءة الرابط
   ============================================================ */

/**
 * قراءة `examId` و `view` من الرابط.
 */
function readURLParams() {
  try {
    const params = new URLSearchParams(window.location.search);
    examId = safeText(params.get("examId"));
    viewMode = safeText(params.get("view"));
  } catch (e) {
    examId = null;
    viewMode = null;
  }
}


/* ============================================================
   06 — تحميل تفاصيل الاختبار
   المرجع: الوثيقة الأصلية — بنود 37، 38، 41، 42
   ============================================================ */

async function loadExam() {
  if (!examId) {
    showError("الرابط غير صالح", "معرّف الاختبار غير موجود.");
    return;
  }

  showLoading();

  // نبدأ الاختبار عبر Worker (startExam).
  // الـ Worker يتحقق من:
  //   - هوية الطالب.
  //   - وجود الاختبار.
  //   - المرحلة.
  //   - عدم وجود محاولة سابقة.
  //   - then يرجّع الأسئلة (بدون correctIndex — بند 43).
  const result = await startExam(examId);

  if (!result || !result.success) {
    const code = result && result.error ? result.error.code : "SERVER_ERROR";
    const msg  = (result && result.error && result.error.message) || "";

    if (code === "ALREADY_ATTEMPTED") {
      showError(
        "تم أداء هذا الاختبار",
        "لا يمكن أداء الاختبار أكثر من مرة واحدة."
      );
      return;
    }

    if (code === "NOT_FOUND") {
      showError("الاختبار غير موجود", "تأكد من الرابط.");
      return;
    }

    if (code === "UNAUTHORIZED") {
      showError("انتهت الجلسة", "من فضلك سجّل الدخول مرة أخرى.");
      return;
    }

    showError("تعذر تحميل الاختبار", msg || "حاول مرة أخرى.");
    return;
  }

  const data = result.data || {};
  examData  = data.exam || {};
  questions = Array.isArray(data.questions) ? data.questions : [];

  if (questions.length === 0) {
    showError("لا توجد أسئلة", "الاختبار لا يحتوي على أسئلة حاليًا.");
    return;
  }

  // تجهيز مصفوفة الإجابات
  answers = new Array(questions.length).fill(null);

  // عرض التعليمات
  renderInstructions();
  showInstructions();
}


/* ============================================================
   07 — التعليمات
   المرجع: الوثيقة الأصلية — بند 37
   ============================================================ */

function renderInstructions() {
  const title = safeText(examData && examData.title) || "اختبار";

  if (titleEl) titleEl.textContent = title;
  if (instrTitleEl) instrTitleEl.textContent = title;
  if (instrCountEl) instrCountEl.textContent = String(questions.length);

  const stageName = examData && examData.stage
    ? getStageName(examData.stage)
    : "—";

  if (instrStageEl) instrStageEl.textContent = stageName;
}


/* ============================================================
   08 — مرحلة الأسئلة
   المرجع: الوثيقة الأصلية — بنود 38، 39
   ============================================================ */

/**
 * عرض السؤال الحالي.
 */
function renderQuestion() {
  const q = questions[currentIndex];
  if (!q) return;

  // Badge
  if (questionBadgeEl) {
    questionBadgeEl.textContent = `السؤال ${currentIndex + 1}`;
  }

  // نص السؤال
  if (questionTextEl) {
    questionTextEl.textContent = safeText(q.text);
  }

  // الاختيارات
  if (choicesEl) {
    choicesEl.replaceChildren();

    const choices = Array.isArray(q.choices) ? q.choices : [];
    const selected = answers[currentIndex];

    choices.forEach((choiceText, idx) => {
      const li = document.createElement("li");
      li.className = "exam-choice";
      li.setAttribute("role", "radio");
      li.setAttribute("tabindex", "0");
      li.setAttribute("aria-checked", selected === idx ? "true" : "false");
      if (selected === idx) li.classList.add("is-selected");
      li.dataset.choiceIndex = String(idx);

      const radio = document.createElement("span");
      radio.className = "exam-choice-radio";
      radio.setAttribute("aria-hidden", "true");

      const text = document.createElement("span");
      text.className = "exam-choice-text";
      text.textContent = safeText(choiceText);

      li.appendChild(radio);
      li.appendChild(text);

      const select = () => {
        answers[currentIndex] = idx;
        renderQuestion(); // re-render للاختيار النشط
      };

      li.addEventListener("click", select);
      li.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          select();
        }
      });

      choicesEl.appendChild(li);
    });
  }

  // Progress
  const total = questions.length;
  const percent = Math.round(((currentIndex + 1) / total) * 100);

  if (progressFillEl) progressFillEl.style.width = `${percent}%`;
  if (currentNumEl) currentNumEl.textContent = String(currentIndex + 1);
  if (totalNumEl)   totalNumEl.textContent   = String(total);

  // Prev button
  if (prevBtn) prevBtn.disabled = currentIndex === 0;

  // Next / Submit button
  if (nextBtn) {
    const isLast = currentIndex === total - 1;
    if (isLast) {
      nextBtn.textContent = "إرسال الاختبار";
      nextBtn.classList.remove("exam-nav-next");
      nextBtn.classList.add("exam-nav-submit");
    } else {
      nextBtn.textContent = "التالي →";
      nextBtn.classList.remove("exam-nav-submit");
      nextBtn.classList.add("exam-nav-next");
    }
  }
}

/**
 * الانتقال للسؤال السابق.
 */
function goPrev() {
  if (currentIndex > 0) {
    currentIndex -= 1;
    renderQuestion();
    scrollToTop();
  }
}

/**
 * الانتقال للسؤال التالي.
 */
function goNext() {
  if (currentIndex < questions.length - 1) {
    currentIndex += 1;
    renderQuestion();
    scrollToTop();
  }
}

/**
 * تمرير لأعلى الصفحة لرؤية السؤال.
 */
function scrollToTop() {
  window.scrollTo({ top: 0, behavior: "smooth" });
}


/* ============================================================
   09 — بدء الاختبار
   ============================================================ */

function handleStart() {
  if (!questions.length) return;

  currentIndex = 0;
  answers = new Array(questions.length).fill(null);

  renderQuestion();
  showQuestions();
}


/* ============================================================
   10 — نافذة التأكيد
   المرجع: الوثيقة الأصلية — بند 40
   ============================================================ */

function openConfirm() {
  if (!confirmOverlay) return;
  confirmOverlay.classList.add("is-open");
  confirmOverlay.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

function closeConfirm() {
  if (!confirmOverlay) return;
  confirmOverlay.classList.remove("is-open");
  confirmOverlay.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}


/* ============================================================
   11 — إرسال الاختبار
   المرجع: الوثيقة الأصلية — بنود 40، 42، 183، 187
   ============================================================ */

/**
 * التحقق من الإجابات قبل الإرسال.
 * @returns {boolean}
 */
function confirmAndSubmit() {
  // التحقق من الإجابات (UX)
  const { valid, errors, unanswered } = validateExamAnswer({
    answers,
    questionsCount: questions.length
  });

  if (!valid) {
    const count = unanswered.length;
    showToast(`لم تجب على ${count} سؤال.`, "warning");
    return false;
  }

  // فتح Confirmation Dialog
  openConfirm();
  return true;
}

/**
 * إرسال الإجابات فعليًا للـ Worker.
 */
async function doSubmit() {
  if (isSubmitting || isSubmitted) return;

  isSubmitting = true;

  if (confirmSubmitBtn) {
    confirmSubmitBtn.disabled = true;
    confirmSubmitBtn.textContent = "جارٍ الإرسال...";
  }

  const result = await submitExam(examId, answers);

  isSubmitting = false;

  if (confirmSubmitBtn) {
    confirmSubmitBtn.disabled = false;
    confirmSubmitBtn.textContent = "تأكيد الإرسال";
  }

  closeConfirm();

  if (!result || !result.success) {
    const code = result && result.error ? result.error.code : "SERVER_ERROR";
    const msg  = (result && result.error && result.error.message) || "";

    if (code === "ALREADY_ATTEMPTED") {
      showError(
        "تم أداء هذا الاختبار",
        "لا يمكن أداء الاختبار أكثر من مرة واحدة."
      );
      return;
    }

    if (code === "UNAUTHORIZED") {
      showError("انتهت الجلسة", "من فضلك سجّل الدخول مرة أخرى.");
      return;
    }

    showToast(msg || "تعذر إرسال الاختبار. حاول مرة أخرى.", "error");
    return;
  }

  // نجح الإرسال
  isSubmitted = true;

  const data = result.data || {};

  // عرض النتيجة حسب resultPolicy
  renderResult(data);
  showResult();
  window.scrollTo({ top: 0, behavior: "smooth" });
}


/* ============================================================
   12 — عرض النتيجة
   المرجع: الوثيقة الأصلية — بنود 44، 45
   ============================================================ */

/**
 * عرض شاشة النتيجة.
 * @param {Object} data - { resultVisible, score, correctCount, wrongCount, total, policy, message }
 */
/** جملة برعي أسفل العنوان (من بيانات النتيجة الحقيقية فقط). تُتجاهل بصمت لو تعطّل برعي. */
function showBaraiResultLine(payload) {
  try {
    barai.inlineLine("exam.result", payload).then((line) => {
      if (!line || !line.text) return;
      let p = document.getElementById("baraiResultLine");
      if (!p) {
        p = document.createElement("p");
        p.id = "baraiResultLine";
        p.className = "barai-result-line";
        const anchor = resultSubEl || resultTitleEl;
        if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(p, anchor.nextSibling);
      }
      p.textContent = line.text;
      if (resultIconEl) { resultIconEl.replaceChildren(mascotEl(line.mood)); }
    }).catch(() => {});
  } catch (e) { /* تجاهل */ }
}

function renderResult(data) {
  const policy = safeText(data.policy) || "immediate";
  const visible = data.resultVisible !== false && policy === "immediate";

  if (visible) {
    // ------- نتيجة فورية -------
    const sc  = Number(data.score) || 0;
    const tot = Number(data.total) || questions.length || 0;
    const pct = tot > 0 ? (sc / tot) * 100 : 0;

    // برعي يتفاعل مع الدرجة (عرض فقط — الدرجة نفسها من الخادم كما هي)
    let mood = "cheerUp";
    let heading = "كويس! كمّل وهتوصل للأحسن";
    if (pct >= 100) { mood = "starstruck"; heading = "برعي فخور بيك! أداء ممتاز"; }
    else if (pct >= 85) { mood = "cheer"; heading = "برعي فخور بيك! أداء ممتاز"; }
    else if (pct < 50) { mood = "sad"; heading = "ولا يهمك، برعي معاك. راجع أخطاءك وجرّب تاني"; }

    if (resultIconEl) {
      resultIconEl.replaceChildren(mascotEl(mood));
      resultIconEl.classList.add("has-mascot");
      resultIconEl.classList.remove("pending");
    }
    if (pct >= 85) confettiBurst();

    if (resultTitleEl) resultTitleEl.textContent = heading;

    const score    = Number(data.score) || 0;
    const total    = Number(data.total) || questions.length || 0;
    const correct  = Number(data.correctCount) || 0;
    const wrong    = Number(data.wrongCount) || 0;

    if (resultSubEl) {
      resultSubEl.textContent = `نتيجتك ${score} من ${total}`;
    }
    showBaraiResultLine({ score: sc, total: tot, examId });

    if (resultScoreEl) resultScoreEl.style.display = "";
    if (resultScoreValEl) resultScoreValEl.textContent = String(score);
    if (resultScoreLblEl) {
      resultScoreLblEl.textContent = total > 0 ? `من ${total}` : "درجتك";
    }

    if (resultStatsEl) resultStatsEl.style.display = "";
    if (resultCorrectEl) resultCorrectEl.textContent = String(correct);
    if (resultWrongEl)   resultWrongEl.textContent   = String(wrong);

  } else {
    // ------- نتيجة مؤجلة -------
    if (resultIconEl) {
      resultIconEl.replaceChildren(mascotEl("wait"));
      resultIconEl.classList.add("has-mascot");
      resultIconEl.classList.remove("pending");
    }

    if (resultTitleEl) resultTitleEl.textContent = "تم استلام إجاباتك";
    showBaraiResultLine({ pending: true, examId });

    if (resultSubEl) {
      resultSubEl.textContent = data.message ||
        "سيتم عرض النتيجة في الموعد المحدد من مستر إسماعيل.";
    }

    // إخفاء الدرجة والإحصائيات
    if (resultScoreEl) resultScoreEl.style.display = "none";
    if (resultStatsEl) resultStatsEl.style.display = "none";
  }
}


/* ============================================================
   13 — عرض النتيجة مباشرة (view=result)
   المرجع: الوثيقة الأصلية — بند 45
   ============================================================ */

async function loadResultDirectly() {
  showLoading();

  const result = await getExamResult(examId);

  if (!result || !result.success) {
    showError("تعذر تحميل النتيجة", "حاول مرة أخرى.");
    return;
  }

  const data = result.data || {};

  // لو النتيجة لسه مش متاحة
  if (data.resultVisible === false) {
    renderResult({
      resultVisible: false,
      policy: data.policy || "after_duration",
      message: data.message || "سيتم عرض النتيجة في الموعد المحدد."
    });
    showResult();
    return;
  }

  renderResult(data);
  showResult();
}


/* ============================================================
   14 — ربط الأحداث
   ============================================================ */

function bindEvents() {
  // زر البدء
  if (startBtn) {
    startBtn.addEventListener("click", handleStart);
  }

  // التنقل
  if (prevBtn) prevBtn.addEventListener("click", goPrev);
  if (nextBtn) {
    nextBtn.addEventListener("click", () => {
      const isLast = currentIndex === questions.length - 1;
      if (isLast) {
        confirmAndSubmit();
      } else {
        goNext();
      }
    });
  }

  // Confirmation Dialog
  if (confirmCancelBtn) {
    confirmCancelBtn.addEventListener("click", closeConfirm);
  }
  if (confirmSubmitBtn) {
    confirmSubmitBtn.addEventListener("click", doSubmit);
  }
  if (confirmOverlay) {
    confirmOverlay.addEventListener("click", (e) => {
      if (e.target === confirmOverlay) closeConfirm();
    });
  }

  // Escape
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && confirmOverlay && confirmOverlay.classList.contains("is-open")) {
      closeConfirm();
    }
  });
}


/* ============================================================
   15 — التهيئة
   ============================================================ */

async function init() {
  const session = requireStudent();
  if (!session) return;

  cacheElements();
  bindEvents();

  readURLParams();

  if (!examId) {
    showError("الرابط غير صالح", "معرّف الاختبار غير موجود.");
    return;
  }

  // view=result → عرض النتيجة مباشرة
  if (viewMode === "result") {
    await loadResultDirectly();
    return;
  }

  // الافتراضي → تحميل الاختبار وعرض التعليمات
  await loadExam();
}


/* ============================================================
   16 — التشغيل
   ============================================================ */

onReady(init);