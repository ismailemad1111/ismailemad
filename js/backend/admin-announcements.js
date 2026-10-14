/* ============================================================
   js/backend/admin-announcements.js — الإدارة: طلبات الاشتراك والإعلانات
   (التحقق من روابط الإعلانات يتم هنا قبل الحفظ)
   ============================================================ */

import {
  fs, db, col, route, ok, bad, safeText, isValidStage, tsToMs, toPlain,
  requireAdmin, getDocData, queryDocs, listAll, ref, countDocs
} from "./core.js";

/* ---------------- التحقق من رابط الإعلان ---------------- */

const ANNOUNCEMENT_TYPES = ["text", "internal_link", "external_link"];
const ANNOUNCEMENT_LINK_MAX = 2048;

// مسار داخلي: [/]segment(/segment)*[.html][?query][#hash]
const INTERNAL_LINK_RE =
  /^\/?[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*(?:\.html)?(?:\?[A-Za-z0-9_\-=&%.,]*)?(?:#[A-Za-z0-9_\-=&%.,]*)?$/;

function validateAnnouncementLink(type, rawLink) {
  if (type === "text") return { ok: true, value: null };

  if (rawLink !== null && rawLink !== undefined && typeof rawLink !== "string") {
    return { ok: false, message: "الرابط غير صالح." };
  }
  const link = safeText(rawLink);

  if (!link) return { ok: false, message: "الرابط مطلوب لهذا النوع من الإعلانات." };
  if (link.length > ANNOUNCEMENT_LINK_MAX) {
    return { ok: false, message: "الرابط طويل جدًا." };
  }
  // مسافات / محارف تحكم / backslash (تُستخدم للتحايل على المتصفحات)
  if (/[\u0000-\u0020\u007F\\]/.test(link)) {
    return { ok: false, message: "الرابط يحتوي على محارف غير مسموحة." };
  }

  if (type === "internal_link") {
    if (link.startsWith("//")) {
      return { ok: false, message: "الرابط الداخلي يجب ألا يبدأ بـ //." };
    }
    if (/^[A-Za-z][A-Za-z0-9+.\-]*:/.test(link)) {
      return { ok: false, message: "الرابط الداخلي يجب أن يكون مسارًا داخل المنصة دون بروتوكول." };
    }
    if (!INTERNAL_LINK_RE.test(link)) {
      return { ok: false, message: "صيغة الرابط الداخلي غير صحيحة (مثال: exams.html)." };
    }
    return { ok: true, value: link };
  }

  if (type === "external_link") {
    if (!/^https?:\/\//i.test(link)) {
      return { ok: false, message: "الرابط الخارجي يجب أن يبدأ بـ http:// أو https://." };
    }
    let u;
    try { u = new URL(link); } catch (e) {
      return { ok: false, message: "الرابط الخارجي غير صالح." };
    }
    if ((u.protocol !== "http:" && u.protocol !== "https:") || !u.hostname) {
      return { ok: false, message: "الرابط الخارجي غير صالح." };
    }
    if (u.username || u.password) {
      return { ok: false, message: "الرابط الخارجي يجب ألا يحتوي على بيانات دخول." };
    }
    return { ok: true, value: link };
  }

  return { ok: false, message: "نوع الإعلان غير صحيح." };
}

/* ---------------- طلبات الاشتراك ---------------- */

route("GET", "/api/admin/requests", async () => {
  requireAdmin();
  const rows = await listAll("subscriptionRequests");
  const requests = rows.map((d) => ({
    id: d.id,
    fullName: safeText(d.fullName),
    phone: safeText(d.phone),
    stage: safeText(d.stage),
    lessonGroupId: safeText(d.lessonGroupId),
    lessonGroupName: safeText(d.lessonGroupName),
    status: safeText(d.status) || "pending",
    note: d.note || null,
    createdAt: d.createdAt || null,
    updatedAt: d.updatedAt || null
  }));
  requests.sort((a, b) => tsToMs(b.createdAt) - tsToMs(a.createdAt));
  return ok(toPlain({ requests }));
});

route("PATCH", "/api/admin/requests/:id", async ({ params, body }) => {
  requireAdmin();
  const id = safeText(params.id);
  if (!id) bad("BAD_REQUEST", "معرّف الطلب مطلوب.");

  const newStatus = safeText(body.status);
  if (!["pending", "contacted", "approved", "rejected", "completed"].includes(newStatus)) {
    bad("BAD_REQUEST", "الحالة غير صحيحة.");
  }

  const existing = await getDocData("subscriptionRequests", id);
  if (!existing) bad("NOT_FOUND", "الطلب غير موجود.");

  const update = { status: newStatus, updatedAt: fs.serverTimestamp() };
  if (typeof body.note === "string") update.note = safeText(body.note) || null;

  await fs.updateDoc(ref("subscriptionRequests", id), update);
  return ok({ updated: true });
});

/* ---------------- الإعلانات ---------------- */

route("GET", "/api/admin/announcements", async () => {
  requireAdmin();
  const rows = await listAll("announcements");
  // عدد الردود لكل إعلان بـ count() بدل تنزيل كل الردود (دقيق وكامل)
  const counts = {};
  await Promise.all(rows.map(async (d) => {
    counts[d.id] = await countDocs("announcementReplies", fs.where("announcementId", "==", d.id));
  }));

  const announcements = rows.map((d) => ({
    id: d.id,
    title: safeText(d.title),
    body: safeText(d.body),
    type: safeText(d.type) || "text",
    targetType: safeText(d.targetType) || "all",
    targetValue: d.targetValue || null,
    linkTarget: d.linkTarget || null,
    createdAt: d.createdAt || null,
    repliesCount: counts[d.id] || 0
  }));
  announcements.sort((a, b) => tsToMs(b.createdAt) - tsToMs(a.createdAt));
  return ok(toPlain({ announcements }));
});

route("POST", "/api/admin/announcements", async ({ body }) => {
  requireAdmin();
  const title = safeText(body.title);
  const text = safeText(body.body);
  const type = safeText(body.type) || "text";
  const targetType = safeText(body.targetType) || "all";
  const targetValue = body.targetValue || null;

  if (!title || title.length > 150) bad("BAD_REQUEST", "العنوان غير صالح.");
  if (!text || text.length > 5000) bad("BAD_REQUEST", "النص غير صالح.");
  if (!["all", "stage", "student"].includes(targetType)) bad("BAD_REQUEST", "نوع الجمهور غير صحيح.");
  if (!ANNOUNCEMENT_TYPES.includes(type)) bad("BAD_REQUEST", "نوع الإعلان غير صحيح.");
  if (targetType === "stage" && !isValidStage(targetValue)) bad("BAD_REQUEST", "المرحلة غير صحيحة.");
  if (targetType === "student" && !targetValue) bad("BAD_REQUEST", "معرّف الطالب مطلوب.");

  const linkCheck = validateAnnouncementLink(type, body.linkTarget);
  if (!linkCheck.ok) bad("BAD_REQUEST", linkCheck.message);
  const linkTarget = linkCheck.value;

  const finalTarget = targetType === "all" ? null : targetValue;
  const created = await fs.addDoc(col("announcements"), {
    title,
    body: text,
    type,
    targetType,
    targetValue: finalTarget,
    linkTarget,
    createdAt: fs.serverTimestamp()
  });

  return ok({
    announcement: {
      id: created.id,
      title,
      body: text,
      type,
      targetType,
      targetValue: finalTarget,
      linkTarget,
      createdAt: new Date().toISOString(),
      repliesCount: 0
    }
  });
});

route("PATCH", "/api/admin/announcements/:id", async ({ params, body }) => {
  requireAdmin();
  const id = safeText(params.id);
  if (!id) bad("BAD_REQUEST", "المعرّف مطلوب.");

  const existing = await getDocData("announcements", id);
  if (!existing) bad("NOT_FOUND", "الإعلان غير موجود.");

  const update = {};
  if (typeof body.title === "string") update.title = safeText(body.title);
  if (typeof body.body === "string") update.body = safeText(body.body);
  if (typeof body.type === "string") update.type = safeText(body.type);
  if (typeof body.targetType === "string") update.targetType = safeText(body.targetType);
  if (typeof body.targetValue === "string" || body.targetValue === null) update.targetValue = body.targetValue;

  if (typeof body.type === "string" && !ANNOUNCEMENT_TYPES.includes(update.type)) {
    bad("BAD_REQUEST", "نوع الإعلان غير صحيح.");
  }

  if (body.type !== undefined || body.linkTarget !== undefined) {
    const finalType = typeof body.type === "string" ? update.type : (safeText(existing.type) || "text");
    const rawLink = body.linkTarget !== undefined ? body.linkTarget : existing.linkTarget;
    const linkCheck = validateAnnouncementLink(finalType, rawLink);
    if (!linkCheck.ok) bad("BAD_REQUEST", linkCheck.message);
    update.linkTarget = linkCheck.value;
  }

  update.updatedAt = fs.serverTimestamp();
  await fs.updateDoc(ref("announcements", id), update);
  return ok({ updated: true });
});

route("DELETE", "/api/admin/announcements/:id", async ({ params }) => {
  requireAdmin();
  const id = safeText(params.id);
  if (!id) bad("BAD_REQUEST", "المعرّف مطلوب.");

  const existing = await getDocData("announcements", id);
  if (!existing) bad("NOT_FOUND", "الإعلان غير موجود.");

  await fs.deleteDoc(ref("announcements", id));

  try {
    const replies = await queryDocs("announcementReplies", fs.where("announcementId", "==", id));
    if (replies.length) {
      const batch = fs.writeBatch(db);
      replies.forEach((r) => batch.delete(ref("announcementReplies", r.id)));
      await batch.commit();
    }
  } catch (e) { /* لا يؤثر */ }

  return ok({ deleted: true });
});

route("GET", "/api/admin/announcements/:id/replies", async ({ params }) => {
  requireAdmin();
  const id = safeText(params.id);
  if (!id) bad("BAD_REQUEST", "المعرّف مطلوب.");

  const rows = await queryDocs("announcementReplies", fs.where("announcementId", "==", id));
  const replies = rows.map((d) => ({
    id: d.id,
    studentId: d.studentId,
    studentName: safeText(d.studentName),
    message: safeText(d.message),
    createdAt: d.createdAt || null
  }));
  replies.sort((a, b) => tsToMs(b.createdAt) - tsToMs(a.createdAt));
  return ok(toPlain({ replies }));
});
