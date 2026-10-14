/* ============================================================
   js/backend/auth.js — الدخول (طالب / أدمن) عبر Firebase Authentication
   ------------------------------------------------------------
   الطالب:
     يكتب الكود (5 أرقام) وكلمة المرور (6 أرقام). المنصة تحوّل الكود إلى
     بريد وهمي <الكود>@students.mrismailemad.com وتسجّل الدخول به.
     حساب الدخول يُنشئه الأدمن مع الكود (من صفحة الأكواد أو رفع الأكواد).

   codes/{الكود}:           ← رقم المستند هو الكود نفسه (5 أرقام)
     code, password, status (unused | active | disabled), studentId,
     stage, note, createdAt, activatedAt, expiresAt

   students/{uid}:          ← رقم المستند هو uid الطالب في Authentication

   الأدمن:
     يدخل ببريده الحقيقي وكلمة مروره، ويلزم وجود مستند admins/{uid}.
   ============================================================ */

import {
  fs, fa, auth, db, route, ok, fail, bad, safeText, isEmail,
  isValidStage, isStudentPassword, tsToMs, nowMs, randomToken, toPlain,
  toLatinDigits, ref, getDocData, studentEmail, authErrorInfo
} from "./core.js";
import { getSession } from "../router.js";

function codeStatus(codeData) {
  if (codeData.status) return String(codeData.status);
  return codeData.studentId ? "active" : "unused";
}

function studentPayload(id, d, code, lastLogin) {
  return toPlain({
    id,
    fullName: d.fullName || "",
    stage: d.stage || "",
    code,
    joinedAt: d.joinedAt || null,
    lastLogin: lastLogin || d.lastLogin || null,
    status: d.status || "active"
  });
}

async function signOutQuietly() {
  try { await fa.signOut(auth); } catch (e) { /* لا يهم */ }
}

route("GET", "/api/ping", async () => {
  return ok({ pong: true, backend: "firestore-client", time: new Date().toISOString() });
});

/* ------------------------------------------------------------
   POST /api/auth/login  (دخول عادي + أول دخول)
   ------------------------------------------------------------ */
route("POST", "/api/auth/login", async ({ body }) => {
  const code = toLatinDigits(safeText(body.code));
  const password = typeof body.password === "string" ? toLatinDigits(body.password) : "";
  const isFirstLogin = body.firstLogin === true;
  const fullName = safeText(body.fullName);
  const stage = safeText(body.stage);

  if (!/^\d{5}$/.test(code)) bad("INVALID_CODE", "الكود يجب أن يكون 5 أرقام.");
  if (!isStudentPassword(password)) bad("INVALID_PASSWORD", "كلمة المرور يجب أن تكون 6 أرقام.");

  /* 1) التحقق من الكود وكلمة المرور عند Firebase Authentication */
  let cred;
  try {
    cred = await fa.signInWithEmailAndPassword(auth, studentEmail(code), password);
  } catch (e) {
    const info = authErrorInfo(e);
    bad(info.code, info.message);
  }
  const uid = cred.user.uid;

  const stop = async (c, m) => { await signOutQuietly(); bad(c, m); };

  /* 2) مستند الكود (رقمه = الكود نفسه) */
  const codeRef = ref("codes", code);
  const codeData = await getDocData("codes", code);
  if (!codeData) await stop("INVALID_CODE", "الكود غير صحيح.");

  const status = codeStatus(codeData);
  if (status === "disabled") await stop("CODE_DISABLED", "هذا الكود غير مفعّل.");

  const exp = tsToMs(codeData.expiresAt);
  if (exp > 0 && exp < nowMs()) await stop("CODE_EXPIRED", "انتهت صلاحية هذا الكود.");

  /* ----- كود جديد: يحتاج أول دخول ----- */
  if (status === "unused") {
    if (!isFirstLogin) {
      return fail("FIRST_LOGIN_REQUIRED", "هذه أول مرة يتم فيها استخدام الكود.");
    }
    if (!fullName || fullName.length < 3) bad("BAD_REQUEST", "من فضلك أدخل الاسم الكامل.");
    if (fullName.length > 100) bad("BAD_REQUEST", "الاسم طويل جدًا.");
    if (!isValidStage(stage)) bad("STAGE_REQUIRED", "اختر المرحلة الدراسية.");

    const studentRef = ref("students", uid);
    const joinedAt = new Date();
    let outcome = null;

    await fs.runTransaction(db, async (tx) => {
      const fresh = await tx.get(codeRef);
      const fd = fresh.exists() ? fresh.data() : null;
      if (!fd) { outcome = ["INVALID_CODE", "الكود غير صحيح."]; return; }
      if (codeStatus(fd) === "disabled") { outcome = ["CODE_DISABLED", "هذا الكود غير مفعّل."]; return; }
      if (codeStatus(fd) !== "unused") {
        outcome = ["ALREADY_ACTIVATED", "تم تفعيل هذا الكود بالفعل. سجّل الدخول بكلمة المرور."];
        return;
      }
      tx.set(studentRef, {
        fullName,
        stage,
        code,
        joinedAt,
        studyHoursTotal: 0,
        lastLogin: joinedAt,
        status: "active"
      });
      tx.update(codeRef, {
        status: "active",
        studentId: uid,
        stage,
        activatedAt: fs.serverTimestamp()
      });
    });

    if (outcome) await stop(outcome[0], outcome[1]);

    const student = studentPayload(
      uid,
      { fullName, stage, joinedAt, status: "active" },
      code,
      joinedAt
    );
    return ok({ token: randomToken(), refreshToken: randomToken(), student });
  }

  /* ----- كود مفعّل: دخول عادي ----- */
  if (safeText(codeData.studentId) !== uid) {
    await stop("INVALID_CODE", "هذا الكود غير مرتبط بحسابك.");
  }

  const studentData = await getDocData("students", uid);
  if (!studentData) await stop("INVALID_CODE", "هذا الكود غير مرتبط بأي حساب.");
  if (studentData.status === "disabled") await stop("CODE_DISABLED", "هذا الحساب غير مفعّل.");

  try {
    await fs.updateDoc(ref("students", uid), { lastLogin: fs.serverTimestamp() });
  } catch (e) {
    /* فشل تحديث آخر دخول لا يمنع الدخول */
  }

  const student = studentPayload(uid, studentData, code, new Date());
  return ok({ token: randomToken(), refreshToken: randomToken(), student });
});

/* ------------------------------------------------------------
   POST /api/auth/logout
   ------------------------------------------------------------ */
route("POST", "/api/auth/logout", async () => {
  await signOutQuietly();
  return ok({});
});

/* ------------------------------------------------------------
   POST /api/auth/admin
   ------------------------------------------------------------ */
route("POST", "/api/auth/admin", async ({ body }) => {
  const email = safeText(body.email).toLowerCase();
  const password = body.password;

  if (!email || !isEmail(email)) bad("BAD_REQUEST", "البريد الإلكتروني غير صحيح.");
  if (typeof password !== "string" || !password) bad("BAD_REQUEST", "كلمة المرور مطلوبة.");

  let cred;
  try {
    cred = await fa.signInWithEmailAndPassword(auth, email, password);
  } catch (e) {
    const info = authErrorInfo(e);
    if (info.code === "RATE_LIMITED" || info.code === "NETWORK_ERROR" || info.code === "SERVER_ERROR") {
      bad(info.code, info.message);
    }
    bad("INVALID_PASSWORD", "بيانات الدخول غير صحيحة.");
  }

  const uid = cred.user.uid;
  let admin = null;
  try {
    admin = await getDocData("admins", uid);
  } catch (e) {
    admin = null;
  }
  if (!admin || admin.status === "disabled") {
    await signOutQuietly();
    bad("INVALID_PASSWORD", "بيانات الدخول غير صحيحة.");
  }

  try {
    await fs.updateDoc(ref("admins", uid), { lastLogin: fs.serverTimestamp() });
  } catch (e) { /* لا يمنع الدخول */ }

  return ok({
    token: randomToken(),
    refreshToken: randomToken(),
    admin: { id: uid, name: admin.name || "", email }
  });
});

/* ------------------------------------------------------------
   POST /api/auth/refresh — الجلسة تُجدَّد تلقائيًا من Firebase
   ------------------------------------------------------------ */
route("POST", "/api/auth/refresh", async () => {
  const s = getSession();
  if (!s || !s.token || !auth.currentUser) {
    bad("UNAUTHORIZED", "انتهت الجلسة. يرجى تسجيل الدخول مرة أخرى.");
  }
  return ok({ token: randomToken(), refreshToken: randomToken() });
});
