/* ============================================================
   admin-import-codes.js — رفع أكواد وكلمات مرور دفعة واحدة
   ------------------------------------------------------------
   يكتب في كوليكشن codes بنفس شكل زر «إنشاء أكواد» في لوحة الإدارة:
     code, password, status:"unused", studentId:null, stage, note,
     createdAt, expiresAt:null
   - يتخطى أي كود موجود بالفعل في قاعدة البيانات أو مكرر في القائمة.
   - الصفحة محمية بجلسة الأدمن مثل باقي صفحات الإدارة.
   ============================================================ */

import { requireAdmin } from "./router.js";
import {
  fs, ref, existingCodeSet, safeText, isValidStage, generatePassword, toLatinDigits,
  createStudentAccount
} from "./backend/core.js";

const CODE_LEN = 5;   // الكود 5 أرقام
const PASS_LEN = 6;   // كلمة المرور 6 أرقام

/** يرجع الرقم بطوله الصحيح (يُكمل الأصفار التي يحذفها Excel). null لو غير صالح */
function normalizeDigits(raw, len) {
  const s = toLatinDigits(raw).trim();
  if (!/^\d+$/.test(s) || s.length > len) return null;
  return s.padStart(len, "0");
}

const $ = (id) => document.getElementById(id);

const dataEl = $("data");
const fileEl = $("file");
const stageEl = $("stage");
const noteEl = $("note");
const autoPassEl = $("autoPass");
const btnCheck = $("btnCheck");
const btnUpload = $("btnUpload");
const msgEl = $("msg");
const problemsEl = $("problems");

function setMsg(text, type) {
  msgEl.textContent = text || "";
  msgEl.className = type || "";
}

function setBusy(busy) {
  btnCheck.disabled = busy;
  btnUpload.disabled = busy;
}

function unquote(s) {
  return String(s).trim().replace(/^["']+|["']+$/g, "").trim();
}

/** يحوّل النص إلى صفوف { line, code, password } */
function parseLines(text) {
  const rows = [];
  const lines = String(text || "").replace(/\r/g, "").split("\n");
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;

    let parts;
    if (/[,;\t]/.test(line)) {
      parts = line.split(/[,;\t]/);
    } else {
      const m = line.match(/^(\S+)\s+(.+)$/);
      parts = m ? [m[1], m[2]] : [line];
    }
    const code = unquote(parts[0] || "");
    const password = parts.length > 1 ? unquote(parts.slice(1).join(",")) : "";
    rows.push({ line: i + 1, code, password });
  });

  // تخطّي سطر العناوين (code,password / الكود,كلمة المرور)
  if (rows.length) {
    const first = rows[0].code.toLowerCase();
    if (first === "code" || first === "codes" || rows[0].code === "الكود" || rows[0].code === "كود") {
      rows.shift();
    }
  }
  return rows;
}

/** مراجعة الصفوف + مقارنتها بما هو موجود في Firestore */
async function analyze() {
  const rows = parseLines(dataEl.value);
  const autoPass = autoPassEl.checked;

  // نسأل فقط عن الأكواد الملصوقة (بدل تنزيل كل الأكواد الموجودة في كل مراجعة)
  const existing = await existingCodeSet(rows.map((r) => normalizeDigits(r.code, CODE_LEN)).filter(Boolean));

  const valid = [];
  const problems = [];
  let padded = 0;
  let dup = 0;
  const seen = new Set();

  rows.forEach((r) => {
    const code = normalizeDigits(r.code, CODE_LEN);
    if (!code) {
      problems.push(`سطر ${r.line}: الكود لازم يكون ${CODE_LEN} أرقام.`);
      return;
    }
    let password;
    if (!r.password) {
      if (autoPass) password = generatePassword();
      else { problems.push(`سطر ${r.line}: لا توجد كلمة مرور.`); return; }
    } else {
      password = normalizeDigits(r.password, PASS_LEN);
      if (!password) {
        problems.push(`سطر ${r.line}: كلمة المرور لازم تكون ${PASS_LEN} أرقام.`);
        return;
      }
      if (password !== toLatinDigits(r.password).trim()) padded += 1;
    }
    if (toLatinDigits(r.code).trim() !== code) padded += 1;
    if (existing.has(code) || seen.has(code)) { dup += 1; return; }
    seen.add(code);
    valid.push({ code, password });
  });

  return { total: rows.length, valid, dup, problems, padded };
}

function showStats(a) {
  $("sTotal").textContent = a.total;
  $("sValid").textContent = a.valid.length;
  $("sDup").textContent = a.dup;
  $("sBad").textContent = a.problems.length;

  problemsEl.textContent = "";
  a.problems.slice(0, 8).forEach((p) => {
    const li = document.createElement("li");
    li.textContent = p;
    problemsEl.appendChild(li);
  });
  if (a.problems.length > 8) {
    const li = document.createElement("li");
    li.textContent = `... و${a.problems.length - 8} أخطاء أخرى.`;
    problemsEl.appendChild(li);
  }
}

function errText(e) {
  const code = e && e.code ? String(e.code) : "";
  if (code === "permission-denied") return "لا توجد صلاحية. تأكد من نشر قواعد Firestore.";
  if (code === "unavailable") return "لا يوجد اتصال بالإنترنت.";
  return "حدث خطأ. حاول مرة أخرى.";
}

async function onCheck() {
  setBusy(true);
  setMsg("جارٍ المراجعة...");
  try {
    const a = await analyze();
    showStats(a);
    setMsg(
      a.valid.length
        ? `جاهز لرفع ${a.valid.length} كود.`
        : "لا توجد أكواد صالحة للرفع.",
      a.valid.length ? "ok" : "err"
    );
  } catch (e) {
    console.error(e);
    setMsg(errText(e), "err");
  } finally {
    setBusy(false);
  }
}

async function onUpload() {
  setBusy(true);
  setMsg("جارٍ المراجعة...");
  try {
    const a = await analyze();
    showStats(a);
    if (!a.valid.length) {
      setMsg("لا توجد أكواد صالحة للرفع.", "err");
      return;
    }

    const stageValue = safeText(stageEl.value);
    const stage = isValidStage(stageValue) ? stageValue : null;
    const note = safeText(noteEl.value) || null;

    // لكل كود: ننشئ حساب الدخول في Firebase Authentication ثم مستند الكود
    let done = 0;
    let taken = 0;
    let stopReason = null;
    for (const item of a.valid) {
      const acc = await createStudentAccount(item.code, item.password);
      if (!acc.ok) {
        if (acc.reason === "exists") { taken += 1; continue; }
        stopReason = acc.reason;
        break;
      }
      await fs.setDoc(ref("codes", item.code), {
        code: item.code,
        password: item.password,
        status: "unused",
        studentId: null,
        stage,
        note,
        createdAt: fs.serverTimestamp(),
        expiresAt: null
      });
      done += 1;
      if (done % 5 === 0) setMsg(`تم رفع ${done} من ${a.valid.length}...`);
    }

    if (stopReason) {
      const why = {
        throttled: "أوقف Firebase الإنشاء مؤقتًا لكثرة الطلبات. انتظر قليلًا ثم اضغط «رفع» مرة أخرى لإكمال الباقي.",
        disabled: "فعّل تسجيل الدخول بالبريد وكلمة المرور من Firebase ← Authentication ← Sign-in method.",
        network: "انقطع الاتصال. اضغط «رفع» مرة أخرى لإكمال الباقي.",
        error: "تعذر إنشاء حساب الدخول."
      }[stopReason] || "تعذر إنشاء حساب الدخول.";
      setMsg(`تم رفع ${done} كود فقط.\n${why}`, "err");
      return;
    }

    const extra = [];
    if (a.dup) extra.push(`${a.dup} مكرر تم تخطيه`);
    if (taken) extra.push(`${taken} كود محجوز مسبقًا في Firebase تم تخطيه`);
    if (a.problems.length) extra.push(`${a.problems.length} سطر فيه خطأ لم يُرفع`);
    if (a.padded) extra.push(`تم إكمال الأصفار الناقصة في ${a.padded} قيمة`);
    setMsg(
      `تم رفع ${done} كود بنجاح.` + (extra.length ? "\n" + extra.join(" — ") : ""),
      "ok"
    );
    dataEl.value = "";
    showStats({ total: 0, valid: [], dup: 0, problems: [] });
  } catch (e) {
    console.error(e);
    setMsg(errText(), "err");
  } finally {
    setBusy(false);
  }
}

fileEl.addEventListener("change", () => {
  const f = fileEl.files && fileEl.files[0];
  if (!f) return;
  const reader = new FileReader();
  reader.onload = () => {
    dataEl.value = String(reader.result || "");
    setMsg("تم تحميل الملف. اضغط «مراجعة».");
  };
  reader.onerror = () => setMsg("تعذر قراءة الملف.", "err");
  reader.readAsText(f, "utf-8");
});

btnCheck.addEventListener("click", onCheck);
btnUpload.addEventListener("click", onUpload);

(function init() {
  const session = requireAdmin();
  if (!session) return;
})();
