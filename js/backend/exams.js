/* ============================================================
   js/backend/exams.js — الاختبارات (جهة الطالب)
   التصحيح يتم في المتصفح. المحاولة الواحدة تُفرض بمعرّف ثابت
   `${examId}_${studentId}` داخل Transaction.
   ============================================================ */

import {
  fs, db, route, ok, bad, safeText, isValidStage, clamp, tsToMs, nowMs, toPlain,
  requireStudent, loadStudent, getDocData, queryDocs, ref
} from "./core.js";

function attemptId(examId, studentId) {
  return `${examId}_${studentId}`;
}

/* ---------------- GET /api/exams ---------------- */
route("GET", "/api/exams", async () => {
  const me = requireStudent();
  const student = await loadStudent(me);
  const stage = safeText(student.stage);
  if (!isValidStage(stage)) return ok({ exams: [] });

  const [exams, attempts] = await Promise.all([
    queryDocs("exams", fs.where("stage", "==", stage), fs.where("status", "==", "published")),
    queryDocs("examAttempts", fs.where("studentId", "==", me.id))
  ]);

  const byExam = {};
  attempts.forEach((a) => { byExam[a.examId] = a; });

  const list = exams
    .filter((e) => e && e.id && e.status === "published")
    .map((e) => {
      const attempt = byExam[e.id];
      let status = "available";
      if (attempt) {
        status = attempt.resultVisible === true ? "result_available" : "result_pending";
      }
      return {
        id: e.id,
        title: safeText(e.title),
        stage: e.stage,
        questionsCount: Array.isArray(e.questions) ? e.questions.length : 0,
        status
      };
    });

  return ok({ exams: list });
});

/* ---------------- POST /api/exams/start ---------------- */
route("POST", "/api/exams/start", async ({ body }) => {
  const me = requireStudent();
  const examId = safeText(body.examId);
  if (!examId) bad("BAD_REQUEST", "معرّف الاختبار مطلوب.");

  const student = await loadStudent(me);
  const stage = safeText(student.stage);

  const exam = await getDocData("exams", examId);
  if (!exam) bad("NOT_FOUND", "الاختبار غير موجود.");
  if (exam.status !== "published") bad("NOT_FOUND", "الاختبار غير متاح.");
  if (exam.stage !== stage) bad("FORBIDDEN", "هذا الاختبار ليس لمرحلتك.");

  const existing = await getDocData("examAttempts", attemptId(examId, me.id));
  if (existing) bad("ALREADY_ATTEMPTED", "تم أداء هذا الاختبار بالفعل.");

  const questions = Array.isArray(exam.questions) ? exam.questions : [];
  // لا نمرّر correctIndex للواجهة
  const safeQuestions = questions.map((q) => ({
    text: safeText(q.text),
    choices: Array.isArray(q.choices) ? q.choices.map((c) => safeText(c)) : []
  }));

  return ok(toPlain({
    exam: {
      id: examId,
      title: safeText(exam.title),
      stage: exam.stage,
      questionsCount: safeQuestions.length,
      resultPolicy: safeText(exam.resultPolicy) || "immediate",
      resultTime: exam.resultTime || null
    },
    questions: safeQuestions
  }));
});

/* ---------------- POST /api/exams/submit ---------------- */
route("POST", "/api/exams/submit", async ({ body }) => {
  const me = requireStudent();
  const examId = safeText(body.examId);
  const answers = Array.isArray(body.answers) ? body.answers : null;
  if (!examId || !answers) bad("BAD_REQUEST", "بيانات الاختبار غير مكتملة.");

  const student = await loadStudent(me);
  const stage = safeText(student.stage);

  const exam = await getDocData("exams", examId);
  if (!exam) bad("NOT_FOUND", "الاختبار غير موجود.");
  if (exam.status !== "published" || exam.stage !== stage) bad("FORBIDDEN", "غير مسموح.");

  const questions = Array.isArray(exam.questions) ? exam.questions : [];
  if (questions.length === 0) bad("SERVER_ERROR", "الاختبار لا يحتوي على أسئلة.");

  let correctCount = 0;
  let wrongCount = 0;
  const normalizedAnswers = [];
  for (let i = 0; i < questions.length; i++) {
    const correctIdx = Number(questions[i].correctIndex);
    const a = answers[i];
    const chosen = typeof a === "number" ? a : -1;
    normalizedAnswers.push(chosen);
    if (!isNaN(correctIdx) && chosen === correctIdx) correctCount += 1;
    else wrongCount += 1;
  }

  const total = questions.length;
  const score = correctCount;
  const percent = total > 0 ? Math.round((score / total) * 100) : 0;

  const policy = safeText(exam.resultPolicy) || "immediate";
  const attemptedAt = new Date();
  let visibleAt = attemptedAt;
  let resultVisible = false;

  if (policy === "immediate") {
    resultVisible = true;
  } else if (policy === "after_datetime" && exam.resultTime) {
    visibleAt = new Date(tsToMs(exam.resultTime));
    resultVisible = visibleAt.getTime() <= attemptedAt.getTime();
  } else if (policy === "after_duration") {
    const durationMin = clamp(Number(exam.resultDurationMinutes) || 0, 0, 10080);
    visibleAt = new Date(attemptedAt.getTime() + durationMin * 60 * 1000);
    resultVisible = visibleAt.getTime() <= attemptedAt.getTime();
  } else {
    resultVisible = true;
  }

  const attemptRef = ref("examAttempts", attemptId(examId, me.id));
  let already = false;

  await fs.runTransaction(db, async (tx) => {
    const snap = await tx.get(attemptRef);
    if (snap.exists()) { already = true; return; }
    tx.set(attemptRef, {
      examId,
      studentId: me.id,
      stage,
      answers: normalizedAnswers,
      score,
      total,
      percent,
      correctCount,
      wrongCount,
      resultVisible,
      policy,
      visibleAt,
      attemptedAt,
      createdAt: attemptedAt
    });
  });

  if (already) bad("ALREADY_ATTEMPTED", "تم أداء هذا الاختبار بالفعل.");

  if (resultVisible) {
    return ok({ policy, resultVisible: true, score, total, percent, correctCount, wrongCount });
  }
  return ok({
    policy,
    resultVisible: false,
    message: "تم استلام إجاباتك. ستظهر النتيجة في الموعد المحدد."
  });
});

/* ---------------- GET /api/exams/result ---------------- */
route("GET", "/api/exams/result", async ({ query }) => {
  const me = requireStudent();
  const examId = safeText(query.examId);
  if (!examId) bad("BAD_REQUEST", "معرّف الاختبار مطلوب.");

  const attempt = await getDocData("examAttempts", attemptId(examId, me.id));
  if (!attempt) bad("NOT_FOUND", "لا توجد محاولة لهذا الاختبار.");

  let visible = attempt.resultVisible === true;
  if (!visible && attempt.visibleAt && tsToMs(attempt.visibleAt) <= nowMs()) visible = true;

  if (visible && attempt.resultVisible !== true) {
    try {
      await fs.updateDoc(ref("examAttempts", attempt.id), { resultVisible: true });
    } catch (e) { /* لا يؤثر */ }
  }

  if (!visible) {
    return ok({
      resultVisible: false,
      policy: attempt.policy || "after_duration",
      message: "تم استلام إجاباتك، وستظهر النتيجة في الموعد المحدد."
    });
  }

  return ok({
    resultVisible: true,
    policy: attempt.policy || "immediate",
    score: Number(attempt.score) || 0,
    total: Number(attempt.total) || 0,
    percent: Number(attempt.percent) || 0,
    correctCount: Number(attempt.correctCount) || 0,
    wrongCount: Number(attempt.wrongCount) || 0
  });
});
