/* ============================================================
   js/backend/ai.js — المساعد الذكي (جهة الطالب)
   ------------------------------------------------------------
   الإعداد من مستند Firestore:  settings/ai
     apiKey   : مفتاح المزوّد (نص)         ← مطلوب
     provider : "gemini" | "openai"         (الافتراضي gemini)
     model    : اسم النموذج                 (اختياري)
     dailyLimit : الحد اليومي لكل طالب      (الافتراضي 20)
     maxOutputTokens : (الافتراضي 1000)
   وتفعيل/تعطيل الخدمة من settings/general ← aiEnabled.

   ⚠️ المفتاح داخل Firestore يستطيع أي شخص قراءته. استخدم مفتاح
   Gemini المجاني (لا توجد فاتورة) وليس مفتاحًا مدفوعًا.
   ============================================================ */

import {
  fs, db, route, ok, bad, safeText, clamp,
  requireStudent, getDocData, ref
} from "./core.js";

const AI_MAX_MESSAGES = 20;
const AI_MAX_MESSAGE_CHARS = 4000;
const AI_ALLOWED_ROLES = new Set(["user", "assistant"]);
const AI_DEFAULT_MAX_OUTPUT_TOKENS = 1000;
const AI_TIMEOUT_MS = 55000;

function validateMessages(list) {
  if (!Array.isArray(list)) bad("BAD_REQUEST", "قائمة الرسائل غير صحيحة.");
  if (list.length === 0) bad("BAD_REQUEST", "لا يمكن إرسال رسالة فارغة.");
  if (list.length > AI_MAX_MESSAGES) {
    bad("BAD_REQUEST", `الحد الأقصى ${AI_MAX_MESSAGES} رسالة في الطلب الواحد.`);
  }
  const messages = [];
  for (let i = 0; i < list.length; i++) {
    const m = list[i];
    if (!m || typeof m !== "object" || Array.isArray(m)) {
      bad("BAD_REQUEST", `الرسالة رقم ${i + 1} غير صحيحة.`);
    }
    if (typeof m.role !== "string" || !AI_ALLOWED_ROLES.has(m.role)) {
      bad("BAD_REQUEST", `نوع الرسالة رقم ${i + 1} غير مسموح.`);
    }
    if (typeof m.content !== "string") {
      bad("BAD_REQUEST", `محتوى الرسالة رقم ${i + 1} غير صحيح.`);
    }
    const content = m.content.trim();
    if (!content) bad("BAD_REQUEST", `الرسالة رقم ${i + 1} فارغة.`);
    if (content.length > AI_MAX_MESSAGE_CHARS) {
      bad("BAD_REQUEST", `الرسالة رقم ${i + 1} أطول من الحد المسموح (${AI_MAX_MESSAGE_CHARS} حرف).`);
    }
    messages.push({ role: m.role, content });
  }
  return messages;
}

route("POST", "/api/ai/chat", async ({ body }) => {
  const me = requireStudent();
  const messages = validateMessages(body.messages);

  const general = await getDocData("settings", "general");
  if (general && general.aiEnabled === false) {
    bad("AI_DISABLED", "خدمة الذكاء الاصطناعي متوقفة حاليًا.");
  }

  const cfg = (await getDocData("settings", "ai")) || {};
  const apiKey = safeText(cfg.apiKey);
  if (!apiKey) bad("SERVER_ERROR", "خدمة AI غير مفعّلة حاليًا (لم يُضبط المفتاح).");

  const provider = (safeText(cfg.provider) || "gemini").toLowerCase();
  if (provider !== "gemini" && provider !== "openai") {
    bad("SERVER_ERROR", "مزود AI غير مدعوم.");
  }
  const dailyLimit = clamp(parseInt(cfg.dailyLimit || "20", 10), 1, 500);
  const maxOutputTokens = clamp(
    parseInt(cfg.maxOutputTokens || String(AI_DEFAULT_MAX_OUTPUT_TOKENS), 10) || AI_DEFAULT_MAX_OUTPUT_TOKENS,
    50, 2000
  );

  /* ---- حجز حصة اليوم (Transaction) ---- */
  // اليوم بحسب توقيت القاهرة، حتى لا يتغير الحد اليومي عند منتصف الليل UTC.
  const cairoParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date());
  const cairo = Object.fromEntries(cairoParts.map((p) => [p.type, p.value]));
  const dayKey = `${cairo.year}-${cairo.month}-${cairo.day}`;
  const usageRef = ref("aiUsage", `${me.id}_${dayKey}`);
  let reserved = false;
  let limitReached = false;

  await fs.runTransaction(db, async (tx) => {
    const snap = await tx.get(usageRef);
    const current = snap.exists() ? Number(snap.data().count) || 0 : 0;
    if (current >= dailyLimit) { limitReached = true; return; }
    tx.set(usageRef, {
      studentId: me.id,
      date: dayKey,
      count: current + 1,
      updatedAt: fs.serverTimestamp()
    }, { merge: true });
    reserved = true;
  });

  if (limitReached) bad("DAILY_LIMIT_REACHED", "تجاوزت الحد اليومي المسموح.");

  const release = async () => {
    if (!reserved) return;
    try {
      await fs.runTransaction(db, async (tx) => {
        const snap = await tx.get(usageRef);
        if (!snap.exists()) return;
        const count = Number(snap.data().count) || 0;
        tx.update(usageRef, { count: Math.max(0, count - 1), updatedAt: fs.serverTimestamp() });
      });
      reserved = false;
    } catch (e) { /* لا يؤثر */ }
  };

  /* ---- بناء طلب المزوّد ---- */
  let url = "";
  const headers = { "Content-Type": "application/json" };
  let payload = {};

  if (provider === "openai") {
    url = "https://api.openai.com/v1/chat/completions";
    headers["Authorization"] = `Bearer ${apiKey}`;
    payload = {
      model: safeText(cfg.model) || "gpt-4o-mini",
      messages: [
        { role: "system", content: "أنت مساعد تعليمي عربي للمنصة. اشرح بلغة بسيطة." },
        ...messages
      ],
      temperature: 0.7,
      max_tokens: maxOutputTokens
    };
  } else {
    const model = safeText(cfg.model) || "gemini-2.5-flash";
    url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    payload = {
      systemInstruction: { parts: [{ text: "أنت مساعد تعليمي عربي للمنصة. اشرح بلغة بسيطة." }] },
      contents: messages.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }]
      })),
      generationConfig: { maxOutputTokens }
    };
  }

  /* ---- النداء ---- */
  let res;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  try {
    res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal
    });
  } catch (e) {
    clearTimeout(timer);
    await release();
    if (e && e.name === "AbortError") bad("TIMEOUT", "الخدمة تأخرت. حاول مرة أخرى.");
    bad("SERVER_ERROR", "خطأ في الاتصال بمزود AI.");
  }
  clearTimeout(timer);

  if (!res.ok) {
    let detail = "";
    try { detail = await res.text(); } catch (e) { /* تجاهل */ }
    console.error("[ai] provider error", res.status, detail.slice(0, 500));
    await release();
    bad("SERVER_ERROR", `خطأ من مزود AI (${res.status}).`);
  }

  let data;
  try {
    data = await res.json();
  } catch (e) {
    await release();
    bad("SERVER_ERROR", "استجابة AI غير صالحة.");
  }

  let reply = "";
  if (provider === "openai") {
    reply = safeText(data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content);
  } else {
    const parts = data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
    reply = safeText(Array.isArray(parts) ? parts.map((p) => p.text || "").join("") : "");
  }

  if (!reply) {
    await release();
    bad("SERVER_ERROR", "لم يصل رد من AI.");
  }

  return ok({ reply: reply.slice(0, AI_MAX_MESSAGE_CHARS) });
});
