/**
 * ai.js
 * ------------------------------------------------------------
 * منصة أ/ إسماعيل عماد التعليمية
 * تشغيل صفحة ai.html — المساعد الذكي.
 *
 * المكان: /js/ai.js
 *
 * المرجع:
 *   - الوثيقة الأصلية (بنود 56، 57، 58، 59، 60، 61، 62، 63، 64،
 *                       65، 66، 129، 141، 152، 199)
 *   - Master Design System (بنود 29، 33، 34، 35، 36، 39، 55)
 *
 * ⚠️ قواعد:
 *   - API Key في Worker فقط (بند 62).
 *   - حد الاستخدام في Worker (بند 63، 129).
 *   - السياق محدود (بند 65).
 *   - المحادثة في memory فقط.
 *   - كل النصوص بـ textContent (بند 124).
 *
 * ⚠️ حالة الملف:
 *   - WORKER_URL = PLACEHOLDER_WORKER_URL (البند 207).
 *   - sendAIMessage سترجع NETWORK_ERROR حتى بناء الـ Worker.
 *   - ستظهر رسالة خطأ في المحادثة.
 * ------------------------------------------------------------
 */

import {
  onReady,
  safeText,
  showToast
} from "./helpers.js";

import { requireStudent } from "./router.js";

import { sendAIMessage } from "./api.js";


import { barai } from "./barai/safe.js";

/* ============================================================
   01 — ثوابت
   ============================================================ */

/** الحد الأقصى لعدد الرسائل المُرسَلة للـ Worker (بند 65) */
const MAX_CONTEXT_MESSAGES = 20;

/** الحد الأقصى لطول الرسالة الواحدة */
const MAX_MESSAGE_LENGTH = 2000;

/** أكواد الأخطاء المتوقعة (بند 66) */
const AI_ERROR_MESSAGES = {
  UNAUTHORIZED:        "انتهت الجلسة. من فضلك سجّل الدخول مرة أخرى.",
  FORBIDDEN:           "غير مسموح بهذا الإجراء.",
  DAILY_LIMIT_REACHED: "تجاوزت الحد اليومي المسموح. حاول غدًا.",
  TIMEOUT:             "الخدمة تأخرت. حاول مرة أخرى.",
  NETWORK_ERROR:       "لا يوجد اتصال بالإنترنت. حاول مرة أخرى.",
  SERVER_ERROR:        "حدث خطأ مؤقت. حاول مرة أخرى."
};


/* ============================================================
   02 — المرجع للعناصر
   ============================================================ */

let subtitleEl       = null;
let conversationEl   = null;
let emptyEl          = null;
let suggestionsEl    = null;
let messagesEl       = null;
let inputEl          = null;
let sendBtn          = null;
let newChatBtn       = null;


/* ============================================================
   03 — الحالة
   ============================================================ */

/** محادثة الطالب والمساعد (في memory فقط) */
let messages = [];

/** هل الإرسال جارٍ الآن؟ */
let isSending = false;


/* ============================================================
   04 — تجميع العناصر
   ============================================================ */

function cacheElements() {
  subtitleEl     = document.getElementById("aiSubtitle");
  conversationEl = document.getElementById("aiConversation");
  emptyEl        = document.getElementById("aiEmpty");
  suggestionsEl  = document.getElementById("aiSuggestions");
  messagesEl     = document.getElementById("aiMessages");
  inputEl        = document.getElementById("aiInput");
  sendBtn        = document.getElementById("aiSendBtn");
  newChatBtn     = document.getElementById("newChatBtn");
}


/* ============================================================
   05 — إدارة العرض (Empty vs Messages)
   ============================================================ */

function showEmpty() {
  if (emptyEl) emptyEl.style.display = "";
  if (messagesEl) messagesEl.style.display = "none";
}

function showMessages() {
  if (emptyEl) emptyEl.style.display = "none";
  if (messagesEl) messagesEl.style.display = "";
}


/* ============================================================
   06 — إدارة Textarea
   ============================================================ */

/**
 * Auto-grow للـ textarea.
 */
function autoGrowTextarea() {
  if (!inputEl) return;
  inputEl.style.height = "auto";
  const maxHeight = 140;
  const newHeight = Math.min(inputEl.scrollHeight, maxHeight);
  inputEl.style.height = `${newHeight}px`;
}

/**
 * تفريغ الـ textarea.
 */
function clearInput() {
  if (!inputEl) return;
  inputEl.value = "";
  autoGrowTextarea();
}


/* ============================================================
   07 — إدارة حالة زر الإرسال
   ============================================================ */

function setSending(state) {
  isSending = !!state;
  if (!sendBtn) return;
  sendBtn.disabled = isSending;

  if (inputEl) {
    inputEl.disabled = isSending;
  }
}


/* ============================================================
   08 — عرض الرسائل
   ============================================================ */

/**
 * إنشاء عنصر رسالة.
 * @param {"user"|"assistant"|"error"} role
 * @param {string} text
 * @param {boolean} isTyping
 * @returns {HTMLElement}
 */
function createMessageElement(role, text, isTyping = false) {
  const wrapper = document.createElement("div");
  wrapper.className = "ai-msg ai-msg--" + role;

  // Avatar
  const avatar = document.createElement("div");
  avatar.className = "ai-msg-avatar";
  avatar.setAttribute("aria-hidden", "true");

  if (role === "user") {
    {
      const g = document.createElement("span");
      g.className = "icon icon-user";
      g.setAttribute("aria-hidden", "true");
      avatar.replaceChildren(g);
    }
  } else if (role === "assistant") {
    {
      const g = document.createElement("span");
      g.className = "icon icon-sparkles";
      g.setAttribute("aria-hidden", "true");
      avatar.replaceChildren(g);
    }
  } else {
    {
      const g = document.createElement("span");
      g.className = "icon icon-warning";
      g.setAttribute("aria-hidden", "true");
      avatar.replaceChildren(g);
    }
  }

  wrapper.appendChild(avatar);

  // Bubble
  const bubble = document.createElement("div");
  bubble.className = "ai-msg-bubble";

  if (isTyping) {
    // Typing indicator
    const typing = document.createElement("div");
    typing.className = "ai-typing";
    for (let i = 0; i < 3; i++) {
      const dot = document.createElement("span");
      dot.className = "ai-typing-dot";
      typing.appendChild(dot);
    }
    bubble.appendChild(typing);
  } else {
    bubble.textContent = safeText(text);
  }

  wrapper.appendChild(bubble);
  return wrapper;
}

/**
 * إضافة رسالة إلى نهاية المحادثة.
 * @param {HTMLElement} el
 * @returns {HTMLElement}
 */
function appendMessage(el) {
  if (!messagesEl) return el;
  messagesEl.appendChild(el);
  scrollToBottom();
  return el;
}

/**
 * تمرير لأخر المحادثة.
 */
function scrollToBottom() {
  if (conversationEl) {
    requestAnimationFrame(() => {
      conversationEl.scrollTop = conversationEl.scrollHeight;
    });
  }
}


/* ============================================================
   09 — إضافة رسالة إلى القائمة المنطقية
   ============================================================ */

/**
 * إضافة رسالة إلى مصفوفة messages.
 * @param {"user"|"assistant"} role
 * @param {string} content
 */
function addToHistory(role, content) {
  messages.push({
    role,
    content: safeText(content)
  });
}

/**
 * الحصول على سياق محدود (آخر MAX_CONTEXT_MESSAGES رسالة).
 * المرجع: بند 65 — حد أقصى للسياق.
 * @returns {Array}
 */
function getBoundedContext() {
  if (messages.length <= MAX_CONTEXT_MESSAGES) {
    return messages.slice();
  }
  return messages.slice(messages.length - MAX_CONTEXT_MESSAGES);
}


/* ============================================================
   10 — إرسال الرسالة
   ============================================================ */

async function handleSend() {
  if (isSending) return;

  const text = inputEl ? safeText(inputEl.value) : "";

  // تحقق أساسي
  if (!text) return;
  if (text.length > MAX_MESSAGE_LENGTH) {
    showToast("الرسالة طويلة جدًا.", "warning");
    return;
  }

  // 1) إضافة رسالة الطالب
  showMessages();
  appendMessage(createMessageElement("user", text));
  addToHistory("user", text);

  // 2) تفريغ الـ input
  clearInput();

  // برعي: بيضة العيد (تعريف نفسه) — عرض فقط
  try { if (/(اسمك\s*(ايه|إيه|اي)|مين\s*برعي|من\s*برعي)/.test(text.replace(/[؟?]/g, ""))) barai.notify("egg.intro"); } catch (e) { /* تجاهل */ }

  // 3) تعطيل الزر
  setSending(true);
  try { barai.ambient(".ai-header-icon", "think"); } catch (e) { /* تجاهل */ }

  // 4) Typing indicator
  const typingEl = appendMessage(createMessageElement("assistant", "", true));
  try { barai.inlineLine("ai.thinking", {}).then((l) => { if (l && typingEl && typingEl.isConnected) { const s = document.createElement("span"); s.textContent = l.text; s.style.cssText = "font-size:12px;margin-inline-start:8px"; typingEl.appendChild(s); } }); } catch (e) { /* تجاهل */ }

  // 5) إرسال للـ Worker
  let result = null;
  try {
    result = await sendAIMessage(getBoundedContext());
  } catch (err) {
    result = {
      success: false,
      error: {
        code: "SERVER_ERROR",
        message: AI_ERROR_MESSAGES.SERVER_ERROR
      }
    };
  }

  // 6) إزالة Typing indicator
  if (typingEl && typingEl.parentNode) {
    typingEl.parentNode.removeChild(typingEl);
  }

  setSending(false);
  try { barai.ambient(".ai-header-icon", "glasses"); } catch (e) { /* تجاهل */ }

  // 7) معالجة النتيجة
  if (!result || !result.success) {
    const code = (result && result.error && result.error.code) || "SERVER_ERROR";
    const msg = (result && result.error && result.error.message)
      || AI_ERROR_MESSAGES[code]
      || AI_ERROR_MESSAGES.SERVER_ERROR;

    const errorEl = createMessageElement("error", msg);
    appendMessage(errorEl);
    try {
      if (code === "DAILY_LIMIT_REACHED") barai.notify("ai.limit");
      else if (code !== "UNAUTHORIZED" && code !== "NETWORK_ERROR") barai.notify("ai.error");   // الجلسة/النت لهما رسالتهما الخاصة
    } catch (e) { /* تجاهل */ }

    // Toast إضافي للأخطاء المهمة
    if (code === "DAILY_LIMIT_REACHED" || code === "UNAUTHORIZED") {
      showToast(msg, "warning");
    }

    return;
  }

  // 8) استخراج رد المساعد
  const data = result.data || {};
  const assistantText = safeText(data.reply || data.message || data.content || "");

  if (!assistantText) {
    appendMessage(createMessageElement("error", "لم يصل رد من المساعد. حاول مرة أخرى."));
    return;
  }

  // 9) إضافة رد المساعد
  appendMessage(createMessageElement("assistant", assistantText));
  addToHistory("assistant", assistantText);

  // 10) تحديث الـ subtitle
  if (subtitleEl) {
    subtitleEl.textContent = "جاهز لسؤالك التالي";
  }
}


/* ============================================================
   11 — محادثة جديدة
   ============================================================ */

function handleNewChat() {
  if (isSending) return;

  // لو مفيش رسائل، مفيش حاجة نعملها
  if (messages.length === 0) {
    showToast("المحادثة فاضية بالفعل.", "info");
    return;
  }

  // تفريغ
  messages = [];
  if (messagesEl) messagesEl.replaceChildren();

  showEmpty();

  // رجّع الـ subtitle
  if (subtitleEl) subtitleEl.textContent = "جاهز أساعدك في مذاكرتك";

  // رجّع الـ focus
  if (inputEl) inputEl.focus();

  showToast("تم بدء محادثة جديدة", "success");
}


/* ============================================================
   12 — الأمثلة (Suggestions)
   ============================================================ */

function bindSuggestions() {
  if (!suggestionsEl) return;

  suggestionsEl.querySelectorAll(".ai-suggestion").forEach((btn) => {
    btn.addEventListener("click", () => {
      const text = safeText(btn.dataset.suggestion);
      if (!text || !inputEl) return;

      inputEl.value = text;
      autoGrowTextarea();
      inputEl.focus();

      // حرّك المؤشر لآخر النص
      inputEl.setSelectionRange(text.length, text.length);
    });
  });
}


/* ============================================================
   13 — ربط الأحداث
   ============================================================ */

function bindEvents() {
  // زر الإرسال
  if (sendBtn) {
    sendBtn.addEventListener("click", handleSend);
  }

  // Enter للإرسال (Shift + Enter = سطر جديد)
  if (inputEl) {
    inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    });

    // Auto-grow
    inputEl.addEventListener("input", autoGrowTextarea);
  }

  // زر "محادثة جديدة"
  if (newChatBtn) {
    newChatBtn.addEventListener("click", handleNewChat);
  }

  // Suggestions
  bindSuggestions();
}


/* ============================================================
   14 — التهيئة
   ============================================================ */

function init() {
  const session = requireStudent();
  if (!session) return;

  cacheElements();

  // الحالة الافتراضية
  messages = [];
  showEmpty();

  bindEvents();
  try { barai.notify("ai.open"); barai.ambientMount(".ai-header-icon", "glasses"); } catch (e) { /* تجاهل */ }

  // Auto-grow مبدئي
  autoGrowTextarea();

  // Focus مبدئي (على الديسكتوب فقط)
  const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (!isMobile && inputEl) {
    inputEl.focus();
  }
}


/* ============================================================
   15 — التشغيل
   ============================================================ */

onReady(init);