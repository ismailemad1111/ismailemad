/* ============================================================
   js/backend/admin-core.js — الإدارة: الإحصاءات، الأكواد، الطلاب
   ============================================================ */

import {
  fs, db, col, route, ok, fail, bad, safeText, clamp, isValidStage, tsToMs, toPlain,
  generateCodeString, generatePassword, createStudentAccount,
  requireAdmin, getDocData, queryDocs, listAll, ref,
  countDocs, sumField, getDocsByIds, STAGES
} from "./core.js";

/* ---------------- GET /api/admin/statistics ----------------
   scope=summary  → كروت الأعداد فقط (لوحة الإدارة الرئيسية تستخدم data.stats وحدها)
                    وكلها aggregate بلا تنزيل أي مستند.
   بدون scope    → صفحة الإحصائيات الكاملة. أعداد المراحل والامتحانات والطلبات
                    والإعلانات والأكواد وجلسات المذاكرة صارت aggregate. تبقى قراءة كاملة
                    لـ examAttempts و aiUsage لأن «أفضل الطلاب» (أعلى درجة لكل طالب)
                    و«الطلاب الفريدون الذين استخدموا AI» لا يُحسبان بدقة بـ count/sum. */

async function summaryCounts() {
  const [
    studentsCount, codesCount, examsCount, requestsCount, pendingRequests,
    announcementsCount, studySessionsCount, studyMinutes
  ] = await Promise.all([
    countDocs("students"),
    countDocs("codes"),
    countDocs("exams", fs.where("status", "==", "published")),
    countDocs("subscriptionRequests"),
    countDocs("subscriptionRequests", fs.where("status", "==", "pending")),
    countDocs("announcements"),
    countDocs("studySessions"),
    sumField("studySessions", "durationMinutes")
  ]);
  return {
    studentsCount, codesCount, examsCount, requestsCount, pendingRequests,
    announcementsCount, studySessionsCount, studyMinutes
  };
}

route("GET", "/api/admin/statistics", async ({ query }) => {
  requireAdmin();

  if (safeText(query && query.scope) === "summary") {
    const [c, attemptsCount, aiMessagesCount] = await Promise.all([
      summaryCounts(),
      countDocs("examAttempts"),
      sumField("aiUsage", "count")
    ]);
    return ok({
      stats: {
        studentsCount: c.studentsCount,
        codesCount: c.codesCount,
        examsCount: c.examsCount,
        attemptsCount,
        studyHoursTotal: Math.round((c.studyMinutes / 60) * 10) / 10,
        aiMessagesCount,
        requestsCount: c.requestsCount,
        pendingRequests: c.pendingRequests,
        announcementsCount: c.announcementsCount
      }
    });
  }

  const [c, attempts, aiUsage, general, ...stageCounts] = await Promise.all([
    summaryCounts(),
    listAll("examAttempts"),
    listAll("aiUsage"),
    getDocData("settings", "general"),
    ...STAGES.map((st) => countDocs("students", fs.where("stage", "==", st)))
  ]);

  const stageDistribution = {};
  STAGES.forEach((st, i) => { stageDistribution[st] = stageCounts[i]; });

  const passingPercent = clamp(
    parseInt((general && general.passingPercent) || "50", 10), 1, 100
  );
  let sumPercent = 0;
  let passCount = 0;
  let failCount = 0;
  attempts.forEach((a) => {
    const p = Number(a.percent) || 0;
    sumPercent += p;
    if (p >= passingPercent) passCount += 1;
    else failCount += 1;
  });
  const averageScore = attempts.length > 0 ? Math.round(sumPercent / attempts.length) : 0;

  const studyHoursTotal = Math.round((c.studyMinutes / 60) * 10) / 10;

  const aiMessagesCount = aiUsage.reduce((sum, row) => sum + (Number(row.count) || 0), 0);
  const aiActiveStudents = new Set(
    aiUsage.map((row) => safeText(row.studentId)).filter(Boolean)
  ).size;

  const best = {};
  attempts.forEach((a) => {
    const sid = safeText(a.studentId);
    const score = Number(a.score) || 0;
    if (!sid) return;
    if (!best[sid] || score > best[sid].score) {
      best[sid] = { score, percent: Number(a.percent) || 0 };
    }
  });
  // نفس منطق النسخة السابقة: أفضل 5 ثم استبعاد من لا مستند له.
  // نقرأ مستندات هؤلاء الخمسة فقط بدل كل الطلاب.
  const top5 = Object.keys(best)
    .map((id) => ({ id, ...best[id] }))
    .sort((a, b) => b.percent - a.percent)
    .slice(0, 5);
  const topDocs = await getDocsByIds("students", top5.map((t) => t.id));
  const topStudents = top5
    .filter((t) => topDocs[t.id])
    .map((t) => ({
      id: t.id,
      name: safeText(topDocs[t.id].fullName),
      score: t.score,
      percent: t.percent
    }));

  return ok({
    stats: {
      studentsCount: c.studentsCount,
      codesCount: c.codesCount,
      examsCount: c.examsCount,
      attemptsCount: attempts.length,
      studyHoursTotal,
      aiMessagesCount,
      requestsCount: c.requestsCount,
      pendingRequests: c.pendingRequests,
      announcementsCount: c.announcementsCount
    },
    stageDistribution,
    performance: { averageScore, passCount, failCount, passingPercent },
    topStudents,
    usage: {
      aiMessagesCount,
      aiActiveStudents,
      studySessionsCount: c.studySessionsCount,
      averageSessionMinutes: c.studySessionsCount > 0 ? Math.round(c.studyMinutes / c.studySessionsCount) : 0
    }
  });
});

/* ---------------- الأكواد ---------------- */

route("GET", "/api/admin/codes", async () => {
  requireAdmin();
  const [rows, students] = await Promise.all([listAll("codes"), listAll("students")]);
  const names = {};
  students.forEach((s) => { names[s.id] = safeText(s.fullName); });

  const codes = rows.map((d) => ({
    id: d.id,
    code: safeText(d.code),
    password: d.password === undefined || d.password === null ? null : String(d.password),
    status: safeText(d.status) || (d.studentId ? "active" : "unused"),
    stage: d.stage || null,
    studentId: d.studentId || null,
    studentName: d.studentId ? (names[d.studentId] || null) : null,
    createdAt: d.createdAt || null,
    expiresAt: d.expiresAt || null,
    note: d.note || null
  }));
  codes.sort((a, b) => tsToMs(b.createdAt) - tsToMs(a.createdAt));
  return ok(toPlain({ codes }));
});

route("POST", "/api/admin/codes/create", async ({ body }) => {
  requireAdmin();
  const count = clamp(Number(body.count), 1, 500);
  const stage = safeText(body.stage);
  const note = safeText(body.note) || null;
  if (!isValidStage(stage)) bad("BAD_REQUEST", "المرحلة غير صحيحة.");

  // الأكواد الموجودة (رقم مستند الكود = الكود نفسه)
  const existing = new Set((await listAll("codes")).map((c) => safeText(c.code) || c.id));

  const created = [];
  let stopReason = null;
  let guard = 0;

  while (created.length < count && !stopReason) {
    if (guard++ > count * 20 + 200) { stopReason = "exhausted"; break; }

    const code = generateCodeString();
    if (existing.has(code)) continue;
    existing.add(code);

    const password = generatePassword();

    // حساب الدخول (بريد وهمي من الكود) في Firebase Authentication
    const acc = await createStudentAccount(code, password);
    if (!acc.ok) {
      if (acc.reason === "exists") continue;   // الكود محجوز من قبل، نجرّب غيره
      stopReason = acc.reason;
      break;
    }

    await fs.setDoc(ref("codes", code), {
      code,
      password,
      status: "unused",
      studentId: null,
      stage,
      note,
      createdAt: fs.serverTimestamp(),
      expiresAt: null
    });
    created.push({ id: code, code, password, stage, status: "unused" });
  }

  if (!created.length && stopReason) {
    return fail("SERVER_ERROR", provisionMessage(stopReason, 0));
  }

  const out = { codes: created };
  if (created.length < count) {
    out.partial = true;
    out.message = provisionMessage(stopReason || "exhausted", created.length);
  }
  return ok(out);
});

export function provisionMessage(reason, done) {
  const tail = done ? ` تم إنشاء ${done} كود فقط.` : "";
  switch (reason) {
    case "throttled":
      return "أوقف Firebase الإنشاء مؤقتًا لكثرة الطلبات. انتظر قليلًا ثم أكمل." + tail;
    case "disabled":
      return "فعّل تسجيل الدخول بالبريد وكلمة المرور من Firebase ← Authentication ← Sign-in method." + tail;
    case "network":
      return "انقطع الاتصال أثناء الإنشاء." + tail;
    case "exhausted":
      return "لا توجد أكواد متاحة كافية." + tail;
    default:
      return "تعذر إنشاء حساب الدخول." + tail;
  }
}


route("PATCH", "/api/admin/codes/:id", async ({ params, body }) => {
  requireAdmin();
  const id = safeText(params.id);
  if (!id) bad("BAD_REQUEST", "معرّف الكود مطلوب.");

  const newStatus = safeText(body.status);
  if (!["unused", "active", "disabled"].includes(newStatus)) {
    bad("BAD_REQUEST", "حالة الكود غير صحيحة.");
  }

  const existing = await getDocData("codes", id);
  if (!existing) bad("NOT_FOUND", "الكود غير موجود.");
  if (newStatus === "unused" && safeText(existing.studentId)) {
    bad("BAD_REQUEST", "لا يمكن تحويل كود مرتبط بطالب إلى حالة (متاح).");
  }

  await fs.updateDoc(ref("codes", id), {
    status: newStatus,
    updatedAt: fs.serverTimestamp()
  });
  return ok({ updated: true, status: newStatus });
});

/* ---------------- الطلاب ---------------- */

route("GET", "/api/admin/students", async () => {
  requireAdmin();
  const rows = await listAll("students");
  const students = rows.map((d) => ({
    id: d.id,
    fullName: safeText(d.fullName),
    stage: safeText(d.stage),
    code: safeText(d.code),
    joinedAt: d.joinedAt || null,
    lastLogin: d.lastLogin || null,
    status: safeText(d.status) || "active",
    studyHoursTotal: Number(d.studyHoursTotal) || 0
  }));
  students.sort((a, b) => tsToMs(b.joinedAt) - tsToMs(a.joinedAt));
  return ok(toPlain({ students }));
});

route("GET", "/api/admin/students/:id", async ({ params }) => {
  requireAdmin();
  const id = safeText(params.id);
  if (!id) bad("BAD_REQUEST", "معرّف الطالب مطلوب.");

  const s = await getDocData("students", id);
  if (!s) bad("NOT_FOUND", "الطالب غير موجود.");

  const [attempts, progress] = await Promise.all([
    queryDocs("examAttempts", fs.where("studentId", "==", id)),
    queryDocs("lessonProgress", fs.where("studentId", "==", id))
  ]);
  let totalScore = 0;
  let totalQ = 0;
  let correctTotal = 0;
  attempts.forEach((a) => {
    totalScore += Number(a.score) || 0;
    totalQ += Number(a.total) || 0;
    correctTotal += Number(a.correctCount) || 0;
  });
  const averageScore = totalQ > 0 ? Math.round((totalScore / totalQ) * 100) : 0;

  return ok(toPlain({
    student: {
      id,
      fullName: safeText(s.fullName),
      stage: safeText(s.stage),
      code: safeText(s.code),
      joinedAt: s.joinedAt || null,
      lastLogin: s.lastLogin || null,
      status: safeText(s.status) || "active"
    },
    stats: {
      attemptsCount: attempts.length,
      correctAnswers: correctTotal,
      studyHoursTotal: Math.round((Number(s.studyHoursTotal) || 0) * 10) / 10,
      completedLessons: progress.filter((p) => p.completed === true).length,
      averageScore
    }
  }));
});
