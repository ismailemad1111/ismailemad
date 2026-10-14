/* ============================================================
   js/backend/events.js — الأحداث والألعاب التفاعلية (جهة الطالب)
   ------------------------------------------------------------
   الكوليكشنات (جديدة، ولا تلمس أي بيانات موجودة):
     events/{auto}                       الحدث (يديره الأدمن)
     eventParticipations/{eventId}_{uid} مشاركة الطالب (مستند واحد لكل طالب/حدث)

   الألعاب ملفات HTML في جذر المشروع (game-*.html) يضعها صاحب المنصة بنفسه؛
   الحدث يخزّن اسم الملف فقط. لا يُنسخ محتوى اللعبة إلى Firestore.

   الثقة في النتائج:
     - اللعبة (كود غير موثوق) قد ترسل نتيجة، لكنها تُحفظ كـ reportedScore
       بحالة مراجعة pending، ولا تصبح score معتمدة إلا باعتماد الأدمن.
     - قواعد Firestore تمنع الطالب من كتابة score / reviewStatus المعتمدة.
   ============================================================ */

import {
  fs, db, route, ok, bad, safeText, tsToMs, toPlain,
  requireStudent, loadStudent, getDocData, queryDocs, ref
} from "./core.js";

/** اسم ملف اللعبة: game-<حروف/أرقام/_/-> .html في الجذر فقط (لا مسارات ولا مجلدات) */
export const GAME_FILE_PATTERN = /^game-[A-Za-z0-9_-]{1,60}\.html$/;
/** معرّفات Firestore التلقائية */
export const EVENT_ID_PATTERN = /^[A-Za-z0-9]{1,40}$/;

export const EVENT_STATUSES = ["draft", "published", "hidden"];
export const EVENT_TYPES = ["game", "activity"];
export const GRACE_MS = 10 * 60 * 1000; // مهلة إنهاء اللعبة بعد نهاية الحدث (تطابق القواعد)

export function isValidGameFile(v) {
  return typeof v === "string" && GAME_FILE_PATTERN.test(v);
}

/** مرحلة الحدث بالنسبة للوقت: upcoming | live | ended */
export function eventPhase(ev, now = Date.now()) {
  const s = tsToMs(ev.startAt);
  const e = tsToMs(ev.endAt);
  if (s && now < s) return "upcoming";
  if (e && now > e) return "ended";
  return "live";
}

/** الحدث كما يراه الطالب */
export function publicEvent(d, now = Date.now()) {
  return {
    id: d.id,
    title: safeText(d.title),
    description: safeText(d.description),
    imageUrl: safeText(d.imageUrl),
    type: d.type === "game" ? "game" : "activity",
    stage: safeText(d.stage) || "all",
    gameFile: d.type === "game" && isValidGameFile(d.gameFile) ? d.gameFile : "",
    scoreEnabled: d.scoreEnabled === true,
    maxScore: d.scoreEnabled === true ? (Number(d.maxScore) || 0) : null,
    startAt: d.startAt || null,
    endAt: d.endAt || null,
    phase: eventPhase(d, now)
  };
}

/** مشاركة الطالب كما يراها: النقاط المعتمدة فقط تُعرض كنتيجة */
export function publicParticipation(p) {
  if (!p) return null;
  const approved = p.reviewStatus === "approved";
  return {
    id: p.id,
    eventId: safeText(p.eventId),
    status: p.status === "completed" ? "completed" : "started",
    reviewStatus: safeText(p.reviewStatus) || "none",
    reportedScore: p.reportedScore === undefined ? null : p.reportedScore,
    score: approved && p.score !== undefined && p.score !== null ? Number(p.score) : null,
    startedAt: p.startedAt || null,
    completedAt: p.completedAt || null
  };
}

function byStartDesc(a, b) {
  return tsToMs(b.startAt) - tsToMs(a.startAt);
}

function checkEventId(id) {
  if (!EVENT_ID_PATTERN.test(safeText(id))) bad("BAD_REQUEST", "معرّف الحدث غير صحيح.");
}

/** الحدث متاح للطالب؟ (منشور + مرحلته تناسبه) */
function visibleToStudent(ev, st) {
  if (!ev || ev.status !== "published") return false;
  const stage = safeText(ev.stage) || "all";
  return stage === "all" || stage === st.stage;
}

function participationId(eventId, uid) {
  return `${eventId}_${uid}`;
}

/** مرحلة الطالب كما تقرؤها قواعد Firestore (codes/{code}.stage). تعود لمرحلة الجلسة إن تعذّرت القراءة. */
async function ruleStage(st) {
  try {
    const c = st.code ? await getDocData("codes", st.code) : null;
    const s = c && safeText(c.stage);
    if (s) return s;
  } catch (e) { /* نعتمد مرحلة الجلسة */ }
  return st.stage;
}

/** قراءة حدث: القواعد ترفض get للمسودة/المخفي/مرحلة أخرى بـ permission-denied — نعاملها كـ "غير متاح" لا كانتهاء جلسة */
async function readEventForStudent(id) {
  try {
    return await getDocData("events", id);
  } catch (e) {
    if (e && String(e.code) === "permission-denied") return null;
    throw e;
  }
}

/* ------------------------------------------------------------
   GET /api/student/events — الأحداث المنشورة المسموحة + مشاركاتي
   (استعلامان بالمساواة فقط: مرحلتي + الكل، فلا حاجة لفهارس)
   ------------------------------------------------------------ */
route("GET", "/api/student/events", async () => {
  const st = requireStudent();
  const now = Date.now();
  const stage = await ruleStage(st);

  const [forAll, forMyStage, mine] = await Promise.all([
    queryDocs("events", fs.where("status", "==", "published"), fs.where("stage", "==", "all")),
    stage
      ? queryDocs("events", fs.where("status", "==", "published"), fs.where("stage", "==", stage))
      : Promise.resolve([]),
    queryDocs("eventParticipations", fs.where("studentId", "==", st.id))
  ]);

  const seen = new Set();
  const events = [...forAll, ...forMyStage]
    .filter((d) => (seen.has(d.id) ? false : (seen.add(d.id), true)))
    .sort(byStartDesc)
    .map((d) => publicEvent(d, now));

  const participations = {};
  mine.forEach((p) => { participations[p.eventId] = publicParticipation(p); });

  return ok(toPlain({ events, participations, serverNow: now }));
});

/* ------------------------------------------------------------
   GET /api/student/events/:id — تفاصيل حدث + مشاركتي فيه
   ------------------------------------------------------------ */
route("GET", "/api/student/events/:id", async ({ params }) => {
  const st = requireStudent();
  checkEventId(params.id);

  const ev = await readEventForStudent(params.id);
  if (!visibleToStudent(ev, { ...st, stage: await ruleStage(st) })) bad("NOT_FOUND", "هذا الحدث غير متاح.");

  const part = await getDocData("eventParticipations", participationId(params.id, st.id));
  return ok(toPlain({
    event: publicEvent(ev),
    participation: publicParticipation(part)
  }));
});

/* ------------------------------------------------------------
   POST /api/student/events/:id/join — تسجيل المشاركة (مرة واحدة)
   النتيجة: data.outcome = "joined" | "already"
   ------------------------------------------------------------ */
route("POST", "/api/student/events/:id/join", async ({ params }) => {
  const st = requireStudent();
  checkEventId(params.id);

  const evRef = ref("events", params.id);
  const pRef = ref("eventParticipations", participationId(params.id, st.id));
  // الاسم والمرحلة من مستند الطالب الحالي (لا من الجلسة) لتطابق قواعد Firestore
  const me = await loadStudent(st);
  const stage = await ruleStage(st);
  const stForEvent = { ...st, stage };

  let outcome = null;
  try {
    await fs.runTransaction(db, async (tx) => {
      outcome = null;
      const evSnap = await tx.get(evRef);
      const pSnap = await tx.get(pRef);

      if (pSnap.exists()) {
        outcome = { kind: "already", part: { id: pSnap.id, ...pSnap.data() } };
        return;
      }
      const ev = evSnap.exists() ? { id: evSnap.id, ...evSnap.data() } : null;
      if (!visibleToStudent(ev, stForEvent)) {
        outcome = { kind: "error", code: "NOT_FOUND", message: "هذا الحدث غير متاح." };
        return;
      }
      const phase = eventPhase(ev);
      if (phase === "upcoming") {
        outcome = { kind: "error", code: "EVENT_NOT_STARTED", message: "لم يبدأ هذا الحدث بعد." };
        return;
      }
      if (phase === "ended") {
        outcome = { kind: "error", code: "EVENT_ENDED", message: "انتهى هذا الحدث." };
        return;
      }

      tx.set(pRef, {
        eventId: params.id,
        studentId: st.id,
        studentName: me.fullName || "",
        studentCode: st.code || "",
        stage: stage || me.stage || "",   // = codes/{code}.stage (تقارنه القواعد)
        status: "started",
        reviewStatus: "none",
        reportedScore: null,
        score: null,
        startedAt: fs.serverTimestamp(),
        completedAt: null,
        updatedAt: fs.serverTimestamp()
      });
      outcome = { kind: "joined" };
    });
  } catch (e) {
    const code = e && e.code ? String(e.code) : "";
    if (code === "permission-denied") {
      bad(
        "EVENT_UNAVAILABLE",
        "تعذر تسجيل مشاركتك. قد يكون الحدث انتهى أو أُخفي، أو أن وقت جهازك غير مضبوط. حدّث الصفحة وحاول مرة أخرى."
      );
    }
    throw e;
  }

  if (!outcome) bad("SERVER_ERROR", "لم تكتمل العملية. حاول مرة أخرى.");
  if (outcome.kind === "error") bad(outcome.code, outcome.message);

  const part = await getDocData("eventParticipations", participationId(params.id, st.id));
  return ok(toPlain({
    outcome: outcome.kind,
    participation: publicParticipation(part)
  }));
});

/* ------------------------------------------------------------
   POST /api/student/events/:id/complete — إنهاء النشاط (مرة واحدة)
   body: { score? }  — النتيجة (إن وُجدت) تُحفظ "مُبلَّغًا عنها" وتنتظر اعتماد الأدمن
   ------------------------------------------------------------ */
route("POST", "/api/student/events/:id/complete", async ({ params, body }) => {
  const st = requireStudent();
  checkEventId(params.id);

  const evRef = ref("events", params.id);
  const pRef = ref("eventParticipations", participationId(params.id, st.id));
  const rawScore = body.score;

  let outcome = null;
  try {
    await fs.runTransaction(db, async (tx) => {
      outcome = null;
      const pSnap = await tx.get(pRef);
      const evSnap = await tx.get(evRef);

      if (!pSnap.exists()) {
        outcome = { kind: "error", code: "NOT_JOINED", message: "سجّل مشاركتك في الحدث أولًا." };
        return;
      }
      if (pSnap.data().status === "completed") {
        outcome = { kind: "already" };
        return;
      }
      if (!evSnap.exists()) {
        outcome = { kind: "error", code: "NOT_FOUND", message: "هذا الحدث غير متاح." };
        return;
      }
      const ev = evSnap.data();
      if (Date.now() > tsToMs(ev.endAt) + GRACE_MS) {
        outcome = { kind: "error", code: "EVENT_ENDED", message: "انتهى هذا الحدث ولم تعد النتيجة تُسجَّل." };
        return;
      }

      /* النتيجة: تُقبل فقط إن كانت اللعبة مفعّلة للنقاط وكانت عددًا صحيحًا ضمن الحد */
      let reported = null;
      if (ev.scoreEnabled === true && rawScore !== undefined && rawScore !== null && rawScore !== "") {
        const n = Number(rawScore);
        if (Number.isInteger(n) && n >= 0 && n <= Number(ev.maxScore)) reported = n;
      }

      tx.update(pRef, {
        status: "completed",
        completedAt: fs.serverTimestamp(),
        reportedScore: reported,
        reviewStatus: reported === null ? "none" : "pending",
        updatedAt: fs.serverTimestamp()
      });
      outcome = { kind: "completed", scoreRecorded: reported !== null };
    });
  } catch (e) {
    const code = e && e.code ? String(e.code) : "";
    if (code === "permission-denied") {
      bad("EVENT_UNAVAILABLE", "تعذر حفظ نتيجتك. قد يكون الحدث انتهى. حدّث الصفحة وحاول مرة أخرى.");
    }
    throw e;
  }

  if (!outcome) bad("SERVER_ERROR", "لم تكتمل العملية. حاول مرة أخرى.");
  if (outcome.kind === "error") bad(outcome.code, outcome.message);

  const part = await getDocData("eventParticipations", participationId(params.id, st.id));
  return ok(toPlain({
    outcome: outcome.kind,
    scoreRecorded: outcome.scoreRecorded === true,
    participation: publicParticipation(part)
  }));
});
