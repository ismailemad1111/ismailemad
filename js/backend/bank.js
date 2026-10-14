/* ============================================================
   js/backend/bank.js — بنك مستر إسماعيل (جهة الطالب)
   ------------------------------------------------------------
   الكوليكشنات (كلها جديدة، ولا تلمس أي بيانات موجودة):
     bankRewards/{auto}            الجوائز
     bankWallets/{uid}             محفظة الطالب (رصيد + منع)
     bankOrders/{uid}_{مفتاح}      طلبات الجوائز (سعر وقت الطلب)
     bankTransactions/{...}        سجل الإضافات والخصومات والاسترجاع
     bankBans/{uid}_{مفتاح}        سجل المنع (تاريخي، لا يُحذف)

   السياسة المالية الموحدة:
     1) الخصم يتم فور تأكيد الطالب (داخل Transaction واحدة مع إنشاء الطلب).
     2) الرفض قبل التسليم = استرجاع كامل كمعاملة refund مستقلة + إعادة الكمية.
     3) بعد "تم التسليم" لا استرجاع ولا رفض.
     4) رصيد غير كافٍ عند التأكيد = لا خصم، سجل محاولة، ومنع 30 يومًا.

   منع التكرار: مفتاح الطلب (requestKey) يُولَّد مرة واحدة لكل نافذة تأكيد،
   ومعرّف مستند الطلب = {uid}_{requestKey}. إعادة الإرسال بنفس المفتاح
   تقرأ الطلب الموجود ولا تكتب شيئًا.
   ============================================================ */

import {
  fs, db, route, ok, bad, safeText, tsToMs, toPlain,
  requireStudent, getDocData, queryDocs, ref
} from "./core.js";

export const BAN_DAYS = 30;
export const DAY_MS = 24 * 60 * 60 * 1000;
export const KEY_PATTERN = /^[A-Za-z0-9]{8,64}$/;
export const ID_PATTERN = /^[A-Za-z0-9_-]{1,120}$/;

export const ORDER_STATUS_LABELS = {
  pending: "قيد المراجعة",
  accepted: "مقبول",
  ready: "جاهز للتسليم",
  delivered: "تم التسليم",
  rejected: "مرفوض"
};

/** التنقلات المسموحة لحالة الطلب (delivered / rejected نهائيتان) */
export const ORDER_TRANSITIONS = {
  pending: ["accepted", "rejected"],
  accepted: ["ready", "delivered", "rejected"],
  ready: ["delivered", "rejected"],
  delivered: [],
  rejected: []
};

export function fmtArabicDate(ms) {
  try {
    return new Date(ms).toLocaleDateString("ar-EG", {
      year: "numeric", month: "long", day: "numeric"
    });
  } catch (e) {
    return new Date(ms).toISOString().slice(0, 10);
  }
}

/** حالة الجائزة المعروضة للطالب */
export function rewardAvailability(d) {
  if (d.requestable !== true) return "unavailable";
  if (d.limited === true && !(Number(d.stock) >= 1)) return "out_of_stock";
  return "available";
}

export function publicReward(d) {
  return {
    id: d.id,
    name: safeText(d.name),
    description: safeText(d.description),
    imageUrl: safeText(d.imageUrl),
    price: Number(d.price) || 0,
    limited: d.limited === true,
    stock: d.limited === true ? (Number(d.stock) || 0) : null,
    requestable: d.requestable === true,
    availability: rewardAvailability(d),
    createdAt: d.createdAt || null
  };
}

function walletPayload(w) {
  const blockedMs = w ? tsToMs(w.blockedUntil) : 0;
  return {
    exists: !!w,
    balance: w ? (Number(w.balance) || 0) : 0,
    blockedUntil: blockedMs > 0 ? new Date(blockedMs).toISOString() : null,
    isBlocked: blockedMs > Date.now()
  };
}

function byCreatedDesc(a, b) {
  return tsToMs(b.createdAt) - tsToMs(a.createdAt);
}

/** محفظة الطالب: تُنشأ فارغة (رصيد 0) إن لم تكن موجودة — آمنة لإعادة التشغيل */
async function ensureWallet(st) {
  const wref = ref("bankWallets", st.id);
  await fs.runTransaction(db, async (tx) => {
    const snap = await tx.get(wref);
    if (snap.exists()) return;
    tx.set(wref, {
      studentId: st.id,
      studentName: st.fullName || "",
      studentCode: st.code || "",
      balance: 0,
      blockedUntil: null,
      createdAt: fs.serverTimestamp(),
      updatedAt: fs.serverTimestamp()
    });
  });
}

/* ------------------------------------------------------------
   GET /api/student/bank — الرصيد + الجوائز المنشورة + حالة المنع
   ------------------------------------------------------------ */
route("GET", "/api/student/bank", async () => {
  const st = requireStudent();

  const [rows, wallet] = await Promise.all([
    queryDocs("bankRewards", fs.where("published", "==", true)),
    getDocData("bankWallets", st.id)
  ]);

  const rewards = rows.map(publicReward).sort(byCreatedDesc);
  const w = walletPayload(wallet);

  let ban = null;
  if (w.isBlocked) {
    const bans = await queryDocs("bankBans", fs.where("studentId", "==", st.id));
    const active = bans
      .filter((b) => b.status === "active" && tsToMs(b.endsAt) > Date.now())
      .sort((a, b) => tsToMs(b.createdAt) - tsToMs(a.createdAt))[0];
    if (active) {
      ban = {
        id: active.id,
        reason: safeText(active.reason),
        rewardName: safeText(active.rewardName),
        price: Number(active.price) || 0,
        balanceAtAttempt: Number(active.balanceAtAttempt) || 0,
        startsAt: active.startsAt || null,
        endsAt: active.endsAt || null
      };
    }
  }

  return ok(toPlain({ wallet: w, ban, rewards }));
});

/* ------------------------------------------------------------
   GET /api/student/bank/history — طلباتي + سجل الرصيد + المنع
   ------------------------------------------------------------ */
route("GET", "/api/student/bank/history", async () => {
  const st = requireStudent();
  const [orders, txs, bans] = await Promise.all([
    queryDocs("bankOrders", fs.where("studentId", "==", st.id)),
    queryDocs("bankTransactions", fs.where("studentId", "==", st.id)),
    queryDocs("bankBans", fs.where("studentId", "==", st.id))
  ]);

  return ok(toPlain({
    orders: orders.sort(byCreatedDesc).slice(0, 50).map((o) => ({
      id: o.id,
      rewardName: safeText(o.rewardName),
      price: Number(o.price) || 0,
      status: safeText(o.status),
      rejectReason: safeText(o.rejectReason),
      createdAt: o.createdAt || null,
      updatedAt: o.updatedAt || null
    })),
    transactions: txs.sort(byCreatedDesc).slice(0, 50).map((t) => ({
      id: t.id,
      type: safeText(t.type),
      amount: Number(t.amount) || 0,
      balanceBefore: Number(t.balanceBefore) || 0,
      balanceAfter: Number(t.balanceAfter) || 0,
      reason: safeText(t.reason),
      createdAt: t.createdAt || null
    })),
    bans: bans.sort(byCreatedDesc).slice(0, 20).map((b) => ({
      id: b.id,
      rewardName: safeText(b.rewardName),
      price: Number(b.price) || 0,
      balanceAtAttempt: Number(b.balanceAtAttempt) || 0,
      status: safeText(b.status),
      startsAt: b.startsAt || null,
      endsAt: b.endsAt || null,
      liftedAt: b.liftedAt || null
    }))
  }));
});

/* ------------------------------------------------------------
   POST /api/student/bank/order — تأكيد طلب جائزة
   body: { rewardId, requestKey, expectedPrice }
   النتيجة: data.outcome = "ordered" | "already" | "banned"
   ------------------------------------------------------------ */
route("POST", "/api/student/bank/order", async ({ body }) => {
  const st = requireStudent();
  const rewardId = safeText(body.rewardId);
  const requestKey = safeText(body.requestKey);
  const expectedPrice = body.expectedPrice === undefined || body.expectedPrice === null
    ? null
    : Number(body.expectedPrice);

  if (!ID_PATTERN.test(rewardId)) bad("BAD_REQUEST", "الجائزة غير صحيحة.");
  if (!KEY_PATTERN.test(requestKey)) bad("BAD_REQUEST", "تعذر تجهيز الطلب. حدّث الصفحة وحاول مرة أخرى.");

  const orderId = `${st.id}_${requestKey}`;
  const orderRef = ref("bankOrders", orderId);
  const banRef = ref("bankBans", orderId);
  const txRef = ref("bankTransactions", `${orderId}_purchase`);
  const walletRef = ref("bankWallets", st.id);
  const rewardRef = ref("bankRewards", rewardId);

  await ensureWallet(st);

  let outcome = null;

  try {
    await fs.runTransaction(db, async (tx) => {
      outcome = null; // قد تُعاد المحاولة تلقائيًا عند التعارض

      /* ----- كل القراءات أولًا ----- */
      const orderSnap = await tx.get(orderRef);
      if (orderSnap.exists()) {
        const o = orderSnap.data();
        outcome = {
          kind: "already",
          order: { id: orderId, rewardName: o.rewardName, price: o.price, status: o.status },
          balance: Number(o.balanceAfter) || 0
        };
        return;
      }
      const banSnap = await tx.get(banRef);
      if (banSnap.exists()) {
        outcome = { kind: "banned", endsAtMs: tsToMs(banSnap.data().endsAt), replay: true };
        return;
      }

      const walletSnap = await tx.get(walletRef);
      const rewardSnap = await tx.get(rewardRef);

      /* ----- التحقق من البيانات الفعلية ----- */
      if (!walletSnap.exists()) {
        outcome = { kind: "error", code: "NOT_FOUND", message: "محفظتك غير جاهزة. حدّث الصفحة وحاول مرة أخرى." };
        return;
      }
      if (!rewardSnap.exists() || rewardSnap.data().published !== true) {
        outcome = { kind: "error", code: "REWARD_UNAVAILABLE", message: "هذه الجائزة لم تعد متاحة." };
        return;
      }

      const w = walletSnap.data();
      const r = rewardSnap.data();
      const now = Date.now();

      const blockedMs = tsToMs(w.blockedUntil);
      if (blockedMs > now) {
        outcome = {
          kind: "error",
          code: "BANK_BLOCKED",
          message: `أنت ممنوع من طلب الجوائز حتى ${fmtArabicDate(blockedMs)}.`
        };
        return;
      }
      if (r.requestable !== true) {
        outcome = { kind: "error", code: "REWARD_UNAVAILABLE", message: "هذه الجائزة غير متاحة للطلب حاليًا." };
        return;
      }
      if (r.limited === true && !(Number(r.stock) >= 1)) {
        outcome = { kind: "error", code: "OUT_OF_STOCK", message: "نفدت كمية هذه الجائزة." };
        return;
      }

      const price = Number(r.price);
      if (!Number.isInteger(price) || price < 1) {
        outcome = { kind: "error", code: "REWARD_UNAVAILABLE", message: "سعر الجائزة غير صالح. تواصل مع المعلم." };
        return;
      }
      if (expectedPrice !== null && expectedPrice !== price) {
        outcome = {
          kind: "error",
          code: "PRICE_CHANGED",
          message: `تغيّر سعر الجائزة إلى ${price}. راجع السعر الجديد ثم أعد الطلب.`
        };
        return;
      }

      const balance = Number(w.balance) || 0;

      if (balance < price) {
        /* ----- رصيد غير كافٍ: لا خصم، سجل محاولة + منع 30 يومًا ----- */
        const endsAt = fs.Timestamp.fromMillis(now + BAN_DAYS * DAY_MS);
        tx.set(banRef, {
          studentId: st.id,
          studentName: st.fullName || "",
          studentCode: st.code || "",
          reason: "insufficient_balance",
          rewardId,
          rewardName: safeText(r.name),
          price,
          balanceAtAttempt: balance,
          startsAt: fs.serverTimestamp(),
          endsAt,
          status: "active",
          createdAt: fs.serverTimestamp()
        });
        tx.update(walletRef, {
          blockedUntil: endsAt,
          updatedAt: fs.serverTimestamp(),
          lastBanId: orderId
        });
        outcome = { kind: "banned", endsAtMs: now + BAN_DAYS * DAY_MS };
        return;
      }

      /* ----- رصيد كافٍ: طلب + خصم + معاملة + مخزون (ذريًا) ----- */
      const balanceAfter = balance - price;
      tx.set(orderRef, {
        studentId: st.id,
        studentName: st.fullName || "",
        studentCode: st.code || "",
        stage: st.stage || "",
        rewardId,
        rewardName: safeText(r.name),
        price,
        quantity: 1,
        status: "pending",
        balanceBefore: balance,
        balanceAfter,
        purchaseTxId: txRef.id,
        createdAt: fs.serverTimestamp(),
        updatedAt: fs.serverTimestamp()
      });
      tx.update(walletRef, {
        balance: balanceAfter,
        updatedAt: fs.serverTimestamp(),
        lastOrderId: orderId
      });
      tx.set(txRef, {
        studentId: st.id,
        type: "purchase",
        amount: -price,
        balanceBefore: balance,
        balanceAfter,
        reason: `طلب جائزة: ${safeText(r.name)}`,
        orderId,
        rewardId,
        createdAt: fs.serverTimestamp()
      });
      if (r.limited === true) {
        tx.update(rewardRef, { stock: Number(r.stock) - 1 });
      }

      outcome = {
        kind: "ordered",
        order: { id: orderId, rewardName: safeText(r.name), price, status: "pending" },
        balance: balanceAfter
      };
    });
  } catch (e) {
    const code = e && e.code ? String(e.code) : "";
    if (code === "permission-denied") {
      bad(
        "REWARD_UNAVAILABLE",
        "تعذر تنفيذ الطلب. قد تكون الجائزة أُخفيت أو تغيّرت بياناتها، أو أن وقت جهازك غير مضبوط. حدّث الصفحة وحاول مرة أخرى."
      );
    }
    throw e; // يتحول إلى رسالة اتصال/خطأ عام في backendRequest
  }

  if (!outcome) bad("SERVER_ERROR", "لم تكتمل العملية. حاول مرة أخرى.");

  if (outcome.kind === "error") bad(outcome.code, outcome.message);

  if (outcome.kind === "banned") {
    return ok({
      outcome: "banned",
      blockedUntil: new Date(outcome.endsAtMs).toISOString(),
      message:
        "رصيدك لا يكفي لهذه الجائزة، لذلك لم يُخصم أي رصيد، " +
        `ومنعك البنك من طلب الجوائز حتى ${fmtArabicDate(outcome.endsAtMs)} وفق سياسة البنك.`
    });
  }

  return ok({
    outcome: outcome.kind === "already" ? "already" : "ordered",
    order: outcome.order,
    balance: outcome.balance
  });
});
