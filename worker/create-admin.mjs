/* ============================================================
   create-admin.mjs — إنشاء حساب أدمن في Firestore بأمر واحد
   ------------------------------------------------------------
   الاستخدام (من مجلد worker):

     node create-admin.mjs <مسار-ملف-service-account.json> <البريد> "<الاسم>" "<كلمة-المرور>"

   مثال:
     node create-admin.mjs ~/sa.json teacher@example.com "أ/ إسماعيل" "MyStrongPass123"

   ما يفعله: يشفّر كلمة المرور (PBKDF2 بنفس صيغة الـ Worker) ويضيف
   مستندًا في كوليكشن admins. لا يحتاج npm install.
   لتغيير كلمة مرور أدمن موجود: احذف مستنده من admins ثم أعد الأمر.
   ============================================================ */

import { readFileSync } from "node:fs";
import { createSign, randomBytes, webcrypto } from "node:crypto";

const PBKDF2_ITERATIONS = 20000;

function b64url(input) {
  return Buffer.from(input).toString("base64url");
}

async function hashPassword(pwd) {
  const salt = randomBytes(16);
  const keyMaterial = await webcrypto.subtle.importKey(
    "raw", new TextEncoder().encode(pwd), "PBKDF2", false, ["deriveBits"]
  );
  const bits = await webcrypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITERATIONS },
    keyMaterial, 256
  );
  return `pbkdf2$${PBKDF2_ITERATIONS}$${salt.toString("base64")}$${Buffer.from(bits).toString("base64")}`;
}

async function getAccessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/datastore",
    aud: sa.token_uri || "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claim}`);
  const signature = signer.sign(sa.private_key).toString("base64url");

  const res = await fetch(sa.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claim}.${signature}`
    })
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error("فشل الحصول على إذن الوصول: " + JSON.stringify(data));
  }
  return data.access_token;
}

async function main() {
  const [saPath, emailArg, nameArg, passwordArg] = process.argv.slice(2);

  if (!saPath || !emailArg || !nameArg || !passwordArg) {
    console.error('الاستخدام: node create-admin.mjs <sa.json> <email> "<name>" "<password>"');
    process.exit(1);
  }

  const email = String(emailArg).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error("البريد الإلكتروني غير صحيح.");
    process.exit(1);
  }
  if (passwordArg.length < 6) {
    console.error("كلمة المرور يجب ألا تقل عن 6 أحرف.");
    process.exit(1);
  }

  const sa = JSON.parse(readFileSync(saPath, "utf8"));
  if (!sa.project_id || !sa.client_email || !sa.private_key) {
    console.error("ملف service account غير صحيح.");
    process.exit(1);
  }

  const token = await getAccessToken(sa);
  const base = `https://firestore.googleapis.com/v1/projects/${sa.project_id}/databases/(default)/documents`;
  const auth = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  // هل البريد موجود بالفعل؟
  const q = await fetch(`${base}:runQuery`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: "admins" }],
        where: { fieldFilter: {
          field: { fieldPath: "email" }, op: "EQUAL", value: { stringValue: email }
        } },
        limit: 1
      }
    })
  });
  const qData = await q.json();
  if (!q.ok) {
    throw new Error("فشل الاتصال بـ Firestore (هل أنشأت قاعدة البيانات؟): " + JSON.stringify(qData));
  }
  if (Array.isArray(qData) && qData.some((r) => r.document)) {
    console.error("يوجد أدمن بهذا البريد بالفعل. احذف مستنده من admins في Firebase Console ثم أعد المحاولة.");
    process.exit(1);
  }

  const passwordHash = await hashPassword(passwordArg);

  const res = await fetch(`${base}/admins`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      fields: {
        email: { stringValue: email },
        name: { stringValue: nameArg.trim() },
        passwordHash: { stringValue: passwordHash },
        status: { stringValue: "active" },
        createdAt: { timestampValue: new Date().toISOString() }
      }
    })
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error("فشل إنشاء الأدمن: " + JSON.stringify(data));
  }

  console.log("✅ تم إنشاء الأدمن بنجاح");
  console.log("   البريد:", email);
  console.log("   سجّل الدخول من: https://mrismailemad.com/admin/login");
}

main().catch((e) => {
  console.error("❌", e.message || e);
  process.exit(1);
});
