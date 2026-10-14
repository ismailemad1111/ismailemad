/* ============================================================
   js/backend/admin-events.js — الأحداث والألعاب (جهة الإدارة)
   ------------------------------------------------------------
   - إنشاء/تعديل/حذف الأحداث (الحذف بعد تأكيد في الواجهة، ويحذف مشاركات الحدث نفسه فقط).
   - مراجعة المشاركات: اعتماد/رفض/تعديل النقاط.
   - اسم ملف اللعبة يُتحقق منه هنا وفي firestore.rules (game-*.html في الجذر فقط).
   ============================================================ */

import {
  fs, db, col, route, ok, bad, safeText, tsToMs, toPlain,
  requireAdmin, listAll, queryDocs, ref, isValidStage, countDocs
} from "./core.js";
import {
  EVENT_ID_PATTERN, EVENT_STATUSES, EVENT_TYPES, isValidGameFile, eventPhase
} from "./events.js";

const MAX_IMAGE_CHARS = 250000;
const MAX_SCORE = 1000000;
const BATCH_SIZE = 400;

function checkId(id) {
  if (!EVENT_ID_PATTERN.test(safeText(id))) bad("BAD_REQUEST", "معرّف الحدث غير صحيح.");
}

/** يقبل ISO أو أرقام ms أو Date ويرجع ms أو NaN */
function parseTime(v) {
  if (v === null || v === undefined || v === "") return NaN;
  if (typeof v === "number") return v;
  const t = new Date(v).getTime();
  return t;
}

/** يتحقق من الحقول المرسلة (partial عند التعديل) ويرجع حقولًا نظيفة جاهزة للكتابة */
function validateEvent(body, current = null) {
  const out = {};
  const has = (k) => Object.prototype.hasOwnProperty.call(body, k) && body[k] !== undefined;
  const partial = !!current;

  if (has("title") || !partial) {
    const title = safeText(body.title);
    if (!title || title.length > 120) bad("BAD_REQUEST", "اسم الحدث مطلوب (حتى 120 حرفًا).");
    out.title = title;
  }
  if (has("description") || !partial) {
    const description = safeText(body.description);
    if (description.length > 2000) bad("BAD_REQUEST", "الوصف طويل (الحد 2000 حرف).");
    out.description = description;
  }
  if (has("imageUrl") || !partial) {
    const imageUrl = safeText(body.imageUrl);
    if (imageUrl) {
      if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(imageUrl)) {
        bad("BAD_REQUEST", "الصورة غير صالحة. اختر صورة JPG أو PNG أو WebP.");
      }
      if (imageUrl.length > MAX_IMAGE_CHARS) bad("BAD_REQUEST", "الصورة كبيرة جدًا.");
    }
    out.imageUrl = imageUrl;
  }

  /* التواريخ: تُدمج مع الحالية ثم يُفحص الترتيب */
  const startMs = has("startAt") ? parseTime(body.startAt) : (partial ? tsToMs(current.startAt) : NaN);
  const endMs = has("endAt") ? parseTime(body.endAt) : (partial ? tsToMs(current.endAt) : NaN);
  if (!Number.isFinite(startMs) || startMs <= 0) bad("BAD_REQUEST", "تاريخ ووقت البداية مطلوبان وبصيغة صحيحة.");
  if (!Number.isFinite(endMs) || endMs <= 0) bad("BAD_REQUEST", "تاريخ ووقت النهاية مطلوبان وبصيغة صحيحة.");
  if (endMs <= startMs) bad("BAD_REQUEST", "وقت النهاية يجب أن يكون بعد وقت البداية.");
  if (has("startAt") || has("endAt") || !partial) {
    out.startAt = fs.Timestamp.fromMillis(startMs);
    out.endAt = fs.Timestamp.fromMillis(endMs);
  }

  const status = has("status") ? safeText(body.status) : (partial ? current.status : "draft");
  if (!EVENT_STATUSES.includes(status)) bad("BAD_REQUEST", "حالة النشر غير صحيحة.");
  out.status = status;

  const type = has("type") ? safeText(body.type) : (partial ? current.type : "activity");
  if (!EVENT_TYPES.includes(type)) bad("BAD_REQUEST", "نوع الحدث غير صحيح.");
  out.type = type;

  const stage = has("stage") ? safeText(body.stage) : (partial ? (current.stage || "all") : "all");
  if (stage !== "all" && !isValidStage(stage)) bad("BAD_REQUEST", "المرحلة غير صحيحة.");
  out.stage = stage;

  /* ملف اللعبة */
  let gameFile = has("gameFile") ? safeText(body.gameFile) : (partial ? safeText(current.gameFile) : "");
  if (type === "game") {
    if (!gameFile) bad("BAD_REQUEST", "اكتب اسم ملف اللعبة، مثل game-science.html.");
    if (!isValidGameFile(gameFile)) {
      bad("BAD_REQUEST", "اسم ملف اللعبة غير مقبول. يجب أن يبدأ بـ game- وينتهي بـ .html بلا مسارات أو مسافات (مثل game-science.html).");
    }
  } else {
    gameFile = "";
  }
  out.gameFile = gameFile;

  /* النقاط (للألعاب فقط) */
  const scoreEnabled = type === "game" && (has("scoreEnabled") ? body.scoreEnabled === true : (partial ? current.scoreEnabled === true : false));
  out.scoreEnabled = scoreEnabled;
  if (scoreEnabled) {
    const raw = has("maxScore") ? body.maxScore : (partial ? current.maxScore : null);
    const n = raw === "" || raw === null || raw === undefined ? NaN : Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > MAX_SCORE) {
      bad("BAD_REQUEST", `الحد الأقصى للنقاط يجب أن يكون رقمًا صحيحًا من 1 إلى ${MAX_SCORE}.`);
    }
    out.maxScore = n;
  } else {
    out.maxScore = null;
  }

  return out;
}

function adminEvent(d, stats) {
  const s = stats || { total: 0, completed: 0, pending: 0 };
  return {
    id: d.id,
    title: safeText(d.title),
    description: safeText(d.description),
    imageUrl: safeText(d.imageUrl),
    startAt: d.startAt || null,
    endAt: d.endAt || null,
    status: safeText(d.status) || "draft",
    type: d.type === "game" ? "game" : "activity",
    stage: safeText(d.stage) || "all",
    gameFile: safeText(d.gameFile),
    scoreEnabled: d.scoreEnabled === true,
    maxScore: d.scoreEnabled === true ? (Number(d.maxScore) || 0) : null,
    phase: eventPhase(d),
    participants: s.total,
    completed: s.completed,
    pendingReview: s.pending,
    createdAt: d.createdAt || null,
    updatedAt: d.updatedAt || null
  };
}

/* ---------------- الأحداث ---------------- */

route("GET", "/api/admin/events", async () => {
  requireAdmin();
  const events = await listAll("events");
  // إحصاء المشاركات لكل حدث بـ count() (3 استعلامات تجميعية لكل حدث) بدل تنزيل كل المشاركات
  const stats = {};
  await Promise.all(events.map(async (e) => {
    const byEvent = fs.where("eventId", "==", e.id);
    const [total, completed, pending] = await Promise.all([
      countDocs("eventParticipations", byEvent),
      countDocs("eventParticipations", byEvent, fs.where("status", "==", "completed")),
      countDocs("eventParticipations", byEvent, fs.where("reviewStatus", "==", "pending"))
    ]);
    stats[e.id] = { total, completed, pending };
  }));
  const rows = events
    .map((e) => adminEvent(e, stats[e.id]))
    .sort((a, b) => tsToMs(b.startAt) - tsToMs(a.startAt));
  return ok(toPlain({ events: rows }));
});

route("POST", "/api/admin/events", async ({ body }) => {
  const admin = requireAdmin();
  const data = validateEvent(body);
  const created = await fs.addDoc(col("events"), {
    ...data,
    createdBy: admin.id,
    createdAt: fs.serverTimestamp(),
    updatedAt: fs.serverTimestamp()
  });
  return ok({ id: created.id });
});

route("PATCH", "/api/admin/events/:id", async ({ params, body }) => {
  requireAdmin();
  const id = safeText(params.id);
  checkId(id);
  const evRef = ref("events", id);

  let found = true;
  await fs.runTransaction(db, async (tx) => {
    found = true;
    const snap = await tx.get(evRef);
    if (!snap.exists()) { found = false; return; }
    const patch = validateEvent(body, snap.data());
    // حقول محددة فقط؛ المشاركات لا تُمَس ولا يتغير createdAt/createdBy
    tx.update(evRef, { ...patch, updatedAt: fs.serverTimestamp() });
  });
  if (!found) bad("NOT_FOUND", "الحدث غير موجود.");
  return ok({ updated: true });
});

/** حذف الحدث ومشاركاته هو فقط (الواجهة تطلب تأكيدًا صريحًا قبل الاستدعاء) */
route("DELETE", "/api/admin/events/:id", async ({ params }) => {
  requireAdmin();
  const id = safeText(params.id);
  checkId(id);

  const evSnap = await fs.getDoc(ref("events", id));
  if (!evSnap.exists()) bad("NOT_FOUND", "الحدث غير موجود.");

  const parts = await queryDocs("eventParticipations", fs.where("eventId", "==", id));
  const refs = parts.map((p) => ref("eventParticipations", p.id));
  for (let i = 0; i < refs.length; i += BATCH_SIZE) {
    const batch = fs.writeBatch(db);
    refs.slice(i, i + BATCH_SIZE).forEach((r) => batch.delete(r));
    await batch.commit();
  }
  await fs.deleteDoc(ref("events", id));
  return ok({ deleted: true, participationsDeleted: refs.length });
});

/* ---------------- المشاركات والنتائج ---------------- */

function adminParticipation(p) {
  return {
    id: p.id,
    eventId: safeText(p.eventId),
    studentId: safeText(p.studentId),
    studentName: safeText(p.studentName),
    studentCode: safeText(p.studentCode),
    stage: safeText(p.stage),
    status: p.status === "completed" ? "completed" : "started",
    reviewStatus: safeText(p.reviewStatus) || "none",
    reportedScore: p.reportedScore === undefined ? null : p.reportedScore,
    score: p.score === undefined ? null : p.score,
    note: safeText(p.note),
    startedAt: p.startedAt || null,
    completedAt: p.completedAt || null,
    reviewedAt: p.reviewedAt || null
  };
}

route("GET", "/api/admin/events/:id/participations", async ({ params }) => {
  requireAdmin();
  const id = safeText(params.id);
  checkId(id);
  const rows = await queryDocs("eventParticipations", fs.where("eventId", "==", id));
  rows.sort((a, b) => tsToMs(b.startedAt) - tsToMs(a.startedAt));
  return ok(toPlain({ participations: rows.map(adminParticipation) }));
});

/**
 * مراجعة مشاركة. body (أي مجموعة من):
 *   reviewStatus: "approved" | "rejected" | "pending"
 *   score: عدد صحيح 0..maxScore أو null
 *   status: "started" | "completed"   (لتسجيل إتمام الأنشطة غير المبرمجة يدويًا)
 *   note: نص (حتى 300)
 * الاعتماد يتطلب score (أو reportedScore موجود فيُستخدم) عندما تكون النقاط مفعّلة.
 */
route("PATCH", "/api/admin/event-participations/:id", async ({ params, body }) => {
  const admin = requireAdmin();
  const id = safeText(params.id);
  if (!/^[A-Za-z0-9]{1,40}_[A-Za-z0-9]{1,128}$/.test(id)) bad("BAD_REQUEST", "معرّف المشاركة غير صحيح.");
  const pRef = ref("eventParticipations", id);

  let notFound = false;
  await fs.runTransaction(db, async (tx) => {
    notFound = false;
    const pSnap = await tx.get(pRef);
    if (!pSnap.exists()) { notFound = true; return; }
    const p = pSnap.data();
    const evSnap = await tx.get(ref("events", p.eventId));
    const ev = evSnap.exists() ? evSnap.data() : null;
    const maxScore = ev && ev.scoreEnabled === true ? Number(ev.maxScore) : MAX_SCORE;

    const has = (k) => Object.prototype.hasOwnProperty.call(body, k) && body[k] !== undefined;
    const patch = {};

    if (has("status")) {
      const s = safeText(body.status);
      if (s !== "started" && s !== "completed") bad("BAD_REQUEST", "حالة المشاركة غير صحيحة.");
      patch.status = s;
      patch.completedAt = s === "completed" ? (p.completedAt || fs.serverTimestamp()) : null;
    }

    let score = p.score === undefined ? null : p.score;
    if (has("score")) {
      if (body.score === null || body.score === "") {
        score = null;
      } else {
        const n = Number(body.score);
        if (!Number.isInteger(n) || n < 0 || n > maxScore) {
          bad("BAD_REQUEST", `النقاط يجب أن تكون رقمًا صحيحًا من 0 إلى ${maxScore}.`);
        }
        score = n;
      }
      patch.score = score;
    }

    if (has("reviewStatus")) {
      const r = safeText(body.reviewStatus);
      if (!["approved", "rejected", "pending"].includes(r)) bad("BAD_REQUEST", "حالة المراجعة غير صحيحة.");
      if (r === "approved") {
        if (score === null) {
          const reported = p.reportedScore;
          if (Number.isInteger(reported) && reported >= 0 && reported <= maxScore) {
            score = reported;
            patch.score = reported;
          } else {
            bad("BAD_REQUEST", "اكتب النقاط قبل الاعتماد (لا توجد نتيجة مُبلَّغ عنها).");
          }
        }
        patch.reviewedAt = fs.serverTimestamp();
        patch.reviewedBy = admin.id;
      } else if (r === "rejected") {
        patch.score = null;
        patch.reviewedAt = fs.serverTimestamp();
        patch.reviewedBy = admin.id;
      }
      patch.reviewStatus = r;
    } else if (has("score") && p.reviewStatus === "approved") {
      // تعديل نقاط معتمدة سابقًا يبقى معتمدًا لكن مع توقيع المراجِع
      if (score === null) bad("BAD_REQUEST", "لا يمكن مسح نقاط معتمدة. اعتمد قيمة جديدة أو ارفض النتيجة.");
      patch.reviewedAt = fs.serverTimestamp();
      patch.reviewedBy = admin.id;
    }

    if (has("note")) {
      const note = safeText(body.note);
      if (note.length > 300) bad("BAD_REQUEST", "الملاحظة طويلة (الحد 300 حرف).");
      patch.note = note;
    }

    if (Object.keys(patch).length === 0) bad("BAD_REQUEST", "لا توجد تغييرات.");
    tx.update(pRef, { ...patch, updatedAt: fs.serverTimestamp() });
  });

  if (notFound) bad("NOT_FOUND", "المشاركة غير موجودة.");
  return ok({ updated: true });
});
