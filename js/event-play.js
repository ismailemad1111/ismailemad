/**
 * event-play.js
 * ------------------------------------------------------------
 * تشغيل صفحة event-play.html — تشغيل لعبة حدث داخل iframe معزول.
 *
 * العزل:
 *   <iframe sandbox="allow-scripts allow-pointer-lock"> بدون allow-same-origin:
 *   اللعبة تعمل بأصل مجهول (opaque origin) فلا تصل إلى جلسة الطالب ولا Firebase
 *   ولا sessionStorage للمنصة، ولا تستطيع تغيير صفحة المنصة أو فتح نوافذ.
 *
 * النتائج:
 *   اللعبة قد ترسل رسالة postMessage (انظر README). المنصة تقبلها فقط من
 *   نافذة الـ iframe نفسها، وتحفظ النقاط "مُبلَّغًا عنها" بحالة مراجعة؛
 *   النقاط المعتمدة يضعها الأدمن وحده (قواعد Firestore تمنع الطالب منها).
 * ------------------------------------------------------------
 */

import { onReady, showToast } from "./helpers.js";
import { requireStudent } from "./router.js";
import { getEvent, joinEvent, completeEvent } from "./api.js";
import {
  $, el, show, errMsg, PHASE, phaseOf, gameUrl, probeGame, GAME_MISSING_MESSAGE
} from "./event-utils.js";

const ID_PATTERN = /^[A-Za-z0-9]{1,40}$/;
const MESSAGE_SOURCE = "mrismail-game";

const state = {
  id: "",
  event: null,
  participation: null,
  frame: null,
  finishing: false,
  finished: false
};

function fail(title, text) {
  show($("evpLoading"), false);
  show($("evpFrameWrap"), false);
  show($("evpFoot"), false);
  $("evpErrorTitle").textContent = title;
  $("evpErrorText").textContent = text;
  $("evpErrorBack").href = state.id ? `event.html?id=${encodeURIComponent(state.id)}` : "events.html";
  show($("evpError"), true);
}

function openResult(title, text) {
  $("evpResultTitle").textContent = title;
  $("evpResultText").textContent = text;
  const o = $("evpOverlay");
  o.classList.add("is-open");
  o.setAttribute("aria-hidden", "false");
}

/** إنهاء المشاركة (مرة واحدة) — score اختياري */
async function finish(score) {
  if (state.finishing || state.finished) return;
  state.finishing = true;
  const btn = $("evpFinish");
  btn.disabled = true;

  const res = await completeEvent(state.id, score);

  state.finishing = false;
  if (!res || !res.success) {
    btn.disabled = false;
    showToast(errMsg(res, "تعذر حفظ إكمالك. حاول مرة أخرى."), "error");
    return;
  }

  state.finished = true;
  state.participation = res.data.participation;
  if (state.frame) state.frame.remove();
  show($("evpFrameWrap"), false);
  show($("evpFoot"), false);

  if (res.data.scoreRecorded) {
    openResult("أحسنت! تم تسجيل نتيجتك", "نتيجتك الآن قيد المراجعة، وستظهر نقاطك بعد اعتماد الأستاذ لها.");
  } else if (state.event.scoreEnabled && score !== undefined && score !== null) {
    openResult("تم تسجيل إكمالك", "لم نستطع قبول النتيجة المرسلة من اللعبة، وسيراجع الأستاذ مشاركتك.");
  } else {
    openResult("تم تسجيل إكمالك", "شكرًا لمشاركتك في هذا الحدث.");
  }
}

/** رسائل اللعبة: تُقبل فقط من نافذة الـ iframe نفسها وبشكل رسالة معروف */
function onMessage(e) {
  if (!state.frame || e.source !== state.frame.contentWindow) return;
  const d = e.data;
  if (!d || typeof d !== "object" || d.source !== MESSAGE_SOURCE) return;
  if (d.type !== "complete") return;

  let score;
  if (d.score !== undefined && d.score !== null) {
    const n = Number(d.score);
    if (Number.isFinite(n)) score = Math.round(n);
  }
  finish(score);
}

function mountFrame(url) {
  const frame = document.createElement("iframe");
  frame.className = "ev-frame";
  frame.title = state.event.title;
  // بدون allow-same-origin عمدًا (انظر التعليق أعلى الملف)
  frame.setAttribute("sandbox", "allow-scripts allow-pointer-lock");
  frame.setAttribute("referrerpolicy", "no-referrer");
  frame.setAttribute("allow", "fullscreen");
  frame.setAttribute("loading", "eager");
  frame.src = url;
  state.frame = frame;

  const wrap = $("evpFrameWrap");
  wrap.replaceChildren(frame);
  show(wrap, true);
}

async function start() {
  const ev = state.event;
  const p = state.participation;

  $("evpName").textContent = ev.title;
  document.title = `${ev.title} — منصة أ/ إسماعيل عماد`;

  if (ev.type !== "game" || !ev.gameFile) {
    fail("هذا الحدث ليس لعبة", "افتح تفاصيل الحدث للمشاركة فيه.");
    return;
  }
  const url = gameUrl(ev.gameFile);
  if (!url) {
    fail("اللعبة غير مهيّأة", "اسم ملف اللعبة غير صحيح. تواصل مع المعلم.");
    return;
  }

  if (p && p.status === "completed") {
    fail("أكملت هذا الحدث", "سُجّلت مشاركتك بالفعل ولا يمكن إعادتها.");
    return;
  }

  const phase = phaseOf(ev);
  if (phase === "upcoming") {
    fail("لم يبدأ الحدث بعد", "ارجع إلى تفاصيل الحدث لمعرفة موعد البداية.");
    return;
  }
  if (phase === "ended") {
    fail("انتهى الحدث", "لم تعد المشاركة في هذا الحدث متاحة.");
    return;
  }

  // لا نسجّل مشاركة قبل التأكد أن ملف اللعبة منشور فعلًا
  const probe = await probeGame(ev.gameFile);
  if (probe === "missing" || probe === "invalid") {
    fail("اللعبة غير متاحة الآن", GAME_MISSING_MESSAGE);
    return;
  }
  if (probe === "network") {
    fail("تعذر تحميل اللعبة", "تأكد من اتصالك بالإنترنت وحاول مرة أخرى.");
    return;
  }

  if (!p) {
    const res = await joinEvent(state.id);
    if (!res || !res.success) {
      fail("تعذر تسجيل مشاركتك", errMsg(res, "حاول مرة أخرى بعد قليل."));
      return;
    }
    state.participation = res.data.participation;
    if (state.participation && state.participation.status === "completed") {
      fail("أكملت هذا الحدث", "سُجّلت مشاركتك بالفعل ولا يمكن إعادتها.");
      return;
    }
  }

  const badge = $("evpBadge");
  badge.textContent = PHASE.live.label;
  show(badge, true);

  show($("evpLoading"), false);
  show($("evpError"), false);
  mountFrame(url);

  $("evpNote").textContent = ev.scoreEnabled
    ? "عند انتهاء اللعبة تُسجَّل نتيجتك تلقائيًا وتنتظر اعتماد الأستاذ."
    : "عند الانتهاء من اللعبة اضغط «أنهيت اللعبة» لتسجيل إكمالك.";
  show($("evpFoot"), true);
  // زر الإنهاء اليدوي لا يظهر مع الألعاب التي تُرسل نقاطًا؛ هناك تُسجَّل النتيجة من اللعبة نفسها
  show($("evpFinish"), !ev.scoreEnabled);
}

async function init() {
  const session = requireStudent();
  if (!session) return;

  const id = new URLSearchParams(window.location.search).get("id") || "";
  if (!ID_PATTERN.test(id)) {
    fail("رابط غير صحيح", "افتح اللعبة من تفاصيل الحدث.");
    return;
  }
  state.id = id;
  $("evpBack").href = `event.html?id=${encodeURIComponent(id)}`;

  window.addEventListener("message", onMessage);
  $("evpFinish").addEventListener("click", () => finish());

  const res = await getEvent(id);
  if (!res || !res.success) {
    const code = res && res.error && res.error.code;
    if (code === "NOT_FOUND") fail("هذا الحدث غير متاح", "قد يكون الحدث غير منشور أو غير مخصص لمرحلتك.");
    else fail("تعذر تحميل الحدث", errMsg(res, "تأكد من اتصالك بالإنترنت وحاول مرة أخرى."));
    return;
  }
  state.event = res.data.event;
  state.participation = res.data.participation;
  await start();
}

onReady(init);
