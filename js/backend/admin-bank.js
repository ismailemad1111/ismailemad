/* ============================================================
   js/backend/admin-bank.js — بنك مستر إسماعيل (جهة الإدارة)
   ------------------------------------------------------------
   - لا توجد أي مسارات حذف: الجوائز تُخفى فقط، والسجلات التاريخية ثابتة.
   - كل عملية مالية = Firestore Transaction واحدة، بمعرّفات ثابتة تمنع التكرار:
       إضافة/خصم يدوي  → bankTransactions/adm_{requestKey}
       استرجاع الرفض   → bankTransactions/{orderId}_refund
   - يتبع السياسة الموثقة في bank.js (الخصم عند الطلب، استرجاع كامل عند
     الرفض قبل التسليم، لا استرجاع بعد التسليم).
   ============================================================ */

import {
  fs, db, col, route, ok, bad, safeText, tsToMs, toPlain,
  requireAdmin, getDocData, listAll, queryDocs, ref
} from "./core.js";
import {
  KEY_PATTERN, ID_PATTERN, ORDER_STATUS_LABELS, ORDER_TRANSITIONS
} from "./bank.js";

const MAX_AMOUNT = 1000000;
const MAX_IMAGE_CHARS = 250000;

function byCreatedDesc(a, b) {
  return tsToMs(b.createdAt) - tsToMs(a.createdAt);
}

/* ---------------- التحقق من بيانات الجائزة ---------------- */

function parseInteger(value) {
  if (value === "" || value === null || value === undefined) return NaN;
  const n = Number(value);
  return Number.isInteger(n) ? n : NaN;
}

/**
 * يتحقق من الحقول المرسلة فقط (partial=true للتعديل) ويرجع حقولًا نظيفة.
 * current = المستند الحالي (للتعديل) لدمج الحقول وفحص التناسق.
 */
function validateReward(body, current = null) {
  const out = {};
  const has = (k) => Object.prototype.hasOwnProperty.call(body, k) && body[k] !== undefined;
  const partial = !!current;

  if (has("name") || !partial) {
    const name = safeText(body.name);
    if (!name || name.length > 100) bad("BAD_REQUEST", "اسم الجائزة مطلوب (حتى 100 حرف).");
    out.name = name;
  }
  if (has("description") || !partial) {
    const description = safeText(body.description);
    if (description.length > 1000) bad("BAD_REQUEST", "الوصف طويل (الحد 1000 حرف).");
    out.description = description;
  }
  if (has("price") || !partial) {
    const price = parseInteger(body.price);
    if (!Number.isInteger(price) || price < 1 || price > MAX_AMOUNT) {
      bad("BAD_REQUEST", `السعر يجب أن يكون رقمًا صحيحًا من 1 إلى ${MAX_AMOUNT}.`);
    }
    out.price = price;
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
  if (has("published") || !partial) out.published = body.published === true;
  if (has("requestable") || !partial) out.requestable = body.requestable === true;

  const limited = has("limited") ? body.limited === true : (partial ? current.limited === true : false);
  out.limited = limited;
  if (limited) {
    const rawStock = has("stock") ? body.stock : (partial ? current.stock : null);
    const stock = parseInteger(rawStock);
    if (!Number.isInteger(stock) || stock < 0 || stock > MAX_AMOUNT) {
      bad("BAD_REQUEST", "الكمية يجب أن تكون رقمًا صحيحًا من 0 فأكثر.");
    }
    out.stock = stock;
  } else {
    out.stock = null;
  }
  return out;
}

function adminReward(d) {
  return {
    id: d.id,
    name: safeText(d.name),
    description: safeText(d.description),
    imageUrl: safeText(d.imageUrl),
    price: Number(d.price) || 0,
    published: d.published === true,
    requestable: d.requestable === true,
    limited: d.limited === true,
    stock: d.limited === true ? (Number(d.stock) || 0) : null,
    createdAt: d.createdAt || null,
    updatedAt: d.updatedAt || null
  };
}

/* ---------------- الجوائز ---------------- */

route("GET", "/api/admin/bank/rewards", async () => {
  requireAdmin();
  const rows = await listAll("bankRewards");
  return ok(toPlain({ rewards: rows.map(adminReward).sort(byCreatedDesc) }));
});

route("POST", "/api/admin/bank/rewards", async ({ body }) => {
  const admin = requireAdmin();
  const data = validateReward(body);
  const created = await fs.addDoc(col("bankRewards"), {
    ...data,
    createdBy: admin.id,
    createdAt: fs.serverTimestamp(),
    updatedAt: fs.serverTimestamp()
  });
  return ok({ id: created.id });
});

route("PATCH", "/api/admin/bank/rewards/:id", async ({ params, body }) => {
  requireAdmin();
  const id = safeText(params.id);
  if (!ID_PATTERN.test(id)) bad("BAD_REQUEST", "معرّف الجائزة غير صحيح.");
  const rewardRef = ref("bankRewards", id);

  let found = true;
  await fs.runTransaction(db, async (tx) => {
    found = true;
    const snap = await tx.get(rewardRef);
    if (!snap.exists()) { found = false; return; }
    const current = snap.data();
    const patch = validateReward(body, current);
    // تحديث حقول محددة فقط؛ لا نستبدل المستند ولا نلمس createdAt/createdBy
    tx.update(rewardRef, { ...patch, updatedAt: fs.serverTimestamp() });
  });
  if (!found) bad("NOT_FOUND", "الجائزة غير موجودة.");
  return ok({ updated: true });
});

/* ---------------- الطلاب والأرصدة ---------------- */

route("GET", "/api/admin/bank/students", async () => {
  requireAdmin();
  const [students, wallets] = await Promise.all([listAll("students"), listAll("bankWallets")]);
  const byId = {};
  wallets.forEach((w) => { byId[w.id] = w; });

  const rows = students.map((s) => {
    const w = byId[s.id];
    const blockedMs = w ? tsToMs(w.blockedUntil) : 0;
    return {
      id: s.id,
      fullName: safeText(s.fullName),
      code: safeText(s.code),
      stage: safeText(s.stage),
      balance: w ? (Number(w.balance) || 0) : 0,
      hasWallet: !!w,
      blockedUntil: blockedMs > Date.now() ? new Date(blockedMs).toISOString() : null
    };
  });
  rows.sort((a, b) => a.fullName.localeCompare(b.fullName, "ar"));
  return ok({ students: rows });
});

route("GET", "/api/admin/bank/students/:id/ledger", async ({ params }) => {
  requireAdmin();
  const id = safeText(params.id);
  if (!ID_PATTERN.test(id)) bad("BAD_REQUEST", "معرّف الطالب غير صحيح.");
  const [wallet, txs] = await Promise.all([
    getDocData("bankWallets", id),
    queryDocs("bankTransactions", fs.where("studentId", "==", id))
  ]);
  return ok(toPlain({
    balance: wallet ? (Number(wallet.balance) || 0) : 0,
    transactions: txs.sort(byCreatedDesc).map((t) => ({
      id: t.id,
      type: safeText(t.type),
      amount: Number(t.amount) || 0,
      balanceBefore: Number(t.balanceBefore) || 0,
      balanceAfter: Number(t.balanceAfter) || 0,
      reason: safeText(t.reason),
      adminName: safeText(t.adminName),
      orderId: safeText(t.orderId),
      createdAt: t.createdAt || null
    }))
  }));
});

/**
 * إضافة/خصم يدوي. body: { type: "credit"|"debit", amount, reason, requestKey }
 * requestKey يثبّت المعاملة: إعادة الإرسال لا تكرر الإضافة أو الخصم.
 */
route("POST", "/api/admin/bank/students/:id/adjust", async ({ params, body }) => {
  const admin = requireAdmin();
  const studentId = safeText(params.id);
  const type = safeText(body.type);
  const amount = parseInteger(body.amount);
  const reason = safeText(body.reason);
  const requestKey = safeText(body.requestKey);

  if (!ID_PATTERN.test(studentId)) bad("BAD_REQUEST", "معرّف الطالب غير صحيح.");
  if (!["credit", "debit"].includes(type)) bad("BAD_REQUEST", "نوع العملية غير صحيح.");
  if (!Number.isInteger(amount) || amount < 1 || amount > MAX_AMOUNT) {
    bad("BAD_REQUEST", `المبلغ يجب أن يكون رقمًا صحيحًا من 1 إلى ${MAX_AMOUNT}.`);
  }
  if (reason.length < 3 || reason.length > 200) bad("BAD_REQUEST", "اكتب سبب المعاملة (3 إلى 200 حرف).");
  if (!KEY_PATTERN.test(requestKey)) bad("BAD_REQUEST", "مفتاح العملية غير صحيح. حدّث الصفحة.");

  const walletRef = ref("bankWallets", studentId);
  const studentRef = ref("students", studentId);
  const txRef = ref("bankTransactions", `adm_${requestKey}`);
  let outcome = null;

  await fs.runTransaction(db, async (tx) => {
    outcome = null;
    const txSnap = await tx.get(txRef);
    if (txSnap.exists()) {
      const t = txSnap.data();
      outcome = { duplicate: true, balance: Number(t.balanceAfter) || 0 };
      return;
    }
    const [walletSnap, studentSnap] = await Promise.all([tx.get(walletRef), tx.get(studentRef)]);
    if (!studentSnap.exists()) {
      outcome = { error: ["NOT_FOUND", "الطالب غير موجود."] };
      return;
    }
    const s = studentSnap.data();
    const before = walletSnap.exists() ? (Number(walletSnap.data().balance) || 0) : 0;
    const after = type === "credit" ? before + amount : before - amount;
    if (after < 0) {
      outcome = { error: ["INSUFFICIENT_BALANCE", `رصيد الطالب الحالي ${before} لا يكفي لخصم ${amount}.`] };
      return;
    }

    if (walletSnap.exists()) {
      tx.update(walletRef, { balance: after, updatedAt: fs.serverTimestamp() });
    } else {
      tx.set(walletRef, {
        studentId,
        studentName: safeText(s.fullName),
        studentCode: safeText(s.code),
        balance: after,
        blockedUntil: null,
        createdAt: fs.serverTimestamp(),
        updatedAt: fs.serverTimestamp()
      });
    }
    tx.set(txRef, {
      studentId,
      type,
      amount: type === "credit" ? amount : -amount,
      balanceBefore: before,
      balanceAfter: after,
      reason,
      adminId: admin.id,
      adminName: admin.name || admin.email || "",
      createdAt: fs.serverTimestamp()
    });
    outcome = { balance: after, before };
  });

  if (outcome && outcome.error) bad(outcome.error[0], outcome.error[1]);
  return ok({ balance: outcome.balance, duplicate: !!outcome.duplicate });
});

/* ---------------- الطلبات ---------------- */

route("GET", "/api/admin/bank/orders", async () => {
  requireAdmin();
  const rows = await listAll("bankOrders");
  const orders = rows.sort(byCreatedDesc).map((o) => ({
    id: o.id,
    studentId: safeText(o.studentId),
    studentName: safeText(o.studentName),
    studentCode: safeText(o.studentCode),
    stage: safeText(o.stage),
    rewardId: safeText(o.rewardId),
    rewardName: safeText(o.rewardName),
    price: Number(o.price) || 0,
    status: safeText(o.status),
    balanceBefore: Number(o.balanceBefore) || 0,
    balanceAfter: Number(o.balanceAfter) || 0,
    rejectReason: safeText(o.rejectReason),
    note: safeText(o.adminNote),
    createdAt: o.createdAt || null,
    updatedAt: o.updatedAt || null,
    deliveredAt: o.deliveredAt || null
  }));
  return ok(toPlain({ orders }));
});

/**
 * تغيير حالة طلب. body: { status, reason?, note? }
 * الرفض يسترجع المبلغ كاملًا (معاملة refund مستقلة) ويعيد الكمية للمخزون.
 * إعادة الضغط لا تكرر الاسترجاع (فحص الحالة + معرّف معاملة ثابت).
 */
route("PATCH", "/api/admin/bank/orders/:id/status", async ({ params, body }) => {
  const admin = requireAdmin();
  const orderId = safeText(params.id);
  const target = safeText(body.status);
  const reason = safeText(body.reason);
  const note = safeText(body.note);

  if (!ID_PATTERN.test(orderId)) bad("BAD_REQUEST", "معرّف الطلب غير صحيح.");
  if (!Object.prototype.hasOwnProperty.call(ORDER_STATUS_LABELS, target) || target === "pending") {
    bad("BAD_REQUEST", "الحالة غير صحيحة.");
  }
  if (target === "rejected" && (reason.length < 3 || reason.length > 200)) {
    bad("BAD_REQUEST", "اكتب سبب الرفض (3 إلى 200 حرف).");
  }
  if (note.length > 300) bad("BAD_REQUEST", "الملاحظة طويلة (الحد 300 حرف).");

  const orderRef = ref("bankOrders", orderId);
  const refundRef = ref("bankTransactions", `${orderId}_refund`);
  let outcome = null;

  await fs.runTransaction(db, async (tx) => {
    outcome = null;
    const orderSnap = await tx.get(orderRef);
    if (!orderSnap.exists()) {
      outcome = { error: ["NOT_FOUND", "الطلب غير موجود."] };
      return;
    }
    const o = orderSnap.data();
    const current = safeText(o.status);

    if (current === target) { // تكرار الضغط: لا تغيير ولا استرجاع مزدوج
      outcome = { unchanged: true, status: current };
      return;
    }
    const allowed = ORDER_TRANSITIONS[current] || [];
    if (!allowed.includes(target)) {
      outcome = {
        error: [
          "INVALID_TRANSITION",
          `لا يمكن تغيير الطلب من «${ORDER_STATUS_LABELS[current] || current}» إلى «${ORDER_STATUS_LABELS[target]}».`
        ]
      };
      return;
    }

    if (target !== "rejected") {
      const patch = { status: target, updatedAt: fs.serverTimestamp(), adminId: admin.id };
      if (note) patch.adminNote = note;
      if (target === "accepted") patch.acceptedAt = fs.serverTimestamp();
      if (target === "ready") patch.readyAt = fs.serverTimestamp();
      if (target === "delivered") patch.deliveredAt = fs.serverTimestamp();
      tx.update(orderRef, patch);
      outcome = { status: target };
      return;
    }

    /* ----- الرفض: استرجاع كامل ----- */
    const walletRef = ref("bankWallets", o.studentId);
    const rewardRef = ref("bankRewards", o.rewardId);
    const [refundSnap, walletSnap, rewardSnap] = await Promise.all([
      tx.get(refundRef), tx.get(walletRef), tx.get(rewardRef)
    ]);
    if (refundSnap.exists()) {
      outcome = { error: ["ALREADY_REFUNDED", "تم استرجاع مبلغ هذا الطلب من قبل."] };
      return;
    }
    const price = Number(o.price) || 0;
    const before = walletSnap.exists() ? (Number(walletSnap.data().balance) || 0) : 0;
    const after = before + price;

    if (walletSnap.exists()) {
      tx.update(walletRef, { balance: after, updatedAt: fs.serverTimestamp() });
    } else {
      tx.set(walletRef, {
        studentId: o.studentId,
        studentName: safeText(o.studentName),
        studentCode: safeText(o.studentCode),
        balance: after,
        blockedUntil: null,
        createdAt: fs.serverTimestamp(),
        updatedAt: fs.serverTimestamp()
      });
    }
    tx.set(refundRef, {
      studentId: o.studentId,
      type: "refund",
      amount: price,
      balanceBefore: before,
      balanceAfter: after,
      reason: `استرجاع طلب مرفوض (${safeText(o.rewardName)}): ${reason}`,
      orderId,
      rewardId: safeText(o.rewardId),
      adminId: admin.id,
      adminName: admin.name || admin.email || "",
      createdAt: fs.serverTimestamp()
    });
    if (rewardSnap.exists() && rewardSnap.data().limited === true) {
      tx.update(rewardRef, { stock: (Number(rewardSnap.data().stock) || 0) + 1 });
    }
    tx.update(orderRef, {
      status: "rejected",
      rejectReason: reason,
      rejectedAt: fs.serverTimestamp(),
      refundTxId: refundRef.id,
      updatedAt: fs.serverTimestamp(),
      adminId: admin.id,
      ...(note ? { adminNote: note } : {})
    });
    outcome = { status: "rejected", refunded: price, balance: after };
  });

  if (outcome && outcome.error) bad(outcome.error[0], outcome.error[1]);
  return ok(outcome || {});
});

/* ---------------- المنع ---------------- */

route("GET", "/api/admin/bank/bans", async () => {
  requireAdmin();
  const rows = await listAll("bankBans");
  const now = Date.now();
  const bans = rows.sort(byCreatedDesc).map((b) => {
    const endsMs = tsToMs(b.endsAt);
    let state = "expired";
    if (b.status === "lifted") state = "lifted";
    else if (endsMs > now) state = "active";
    return {
      id: b.id,
      studentId: safeText(b.studentId),
      studentName: safeText(b.studentName),
      studentCode: safeText(b.studentCode),
      reason: safeText(b.reason),
      rewardName: safeText(b.rewardName),
      price: Number(b.price) || 0,
      balanceAtAttempt: Number(b.balanceAtAttempt) || 0,
      startsAt: b.startsAt || null,
      endsAt: b.endsAt || null,
      state,
      liftedAt: b.liftedAt || null,
      liftedByName: safeText(b.liftedByName),
      liftReason: safeText(b.liftReason)
    };
  });
  return ok(toPlain({ bans }));
});

/** رفع منع يدويًا: يُسجَّل في نفس سجل المنع (status=lifted + السبب) ولا يُحذف الأصل */
route("POST", "/api/admin/bank/bans/:id/lift", async ({ params, body }) => {
  const admin = requireAdmin();
  const banId = safeText(params.id);
  const reason = safeText(body.reason);
  if (!ID_PATTERN.test(banId)) bad("BAD_REQUEST", "معرّف المنع غير صحيح.");
  if (reason.length < 3 || reason.length > 200) bad("BAD_REQUEST", "اكتب سبب رفع المنع (3 إلى 200 حرف).");

  const banRef = ref("bankBans", banId);
  let outcome = null;

  await fs.runTransaction(db, async (tx) => {
    outcome = null;
    const banSnap = await tx.get(banRef);
    if (!banSnap.exists()) {
      outcome = { error: ["NOT_FOUND", "سجل المنع غير موجود."] };
      return;
    }
    const b = banSnap.data();
    if (b.status === "lifted") {
      outcome = { unchanged: true };
      return;
    }
    const walletRef = ref("bankWallets", b.studentId);
    const walletSnap = await tx.get(walletRef);

    tx.update(banRef, {
      status: "lifted",
      liftedAt: fs.serverTimestamp(),
      liftedBy: admin.id,
      liftedByName: admin.name || admin.email || "",
      liftReason: reason
    });
    // نرفع المنع من المحفظة فقط إذا كان ما زال ساريًا (لا نمس منعًا آخر منتهيًا)
    if (walletSnap.exists() && tsToMs(walletSnap.data().blockedUntil) > Date.now()) {
      tx.update(walletRef, { blockedUntil: null, updatedAt: fs.serverTimestamp() });
    }
    outcome = { lifted: true };
  });

  if (outcome && outcome.error) bad(outcome.error[0], outcome.error[1]);
  return ok(outcome || {});
});

