/**
 * event.js
 * ------------------------------------------------------------
 * تشغيل صفحة event.html — تفاصيل حدث واحد وزر الدخول/اللعبة.
 * ------------------------------------------------------------
 */

import { onReady, showToast } from "./helpers.js";
import { requireStudent } from "./router.js";
import { getEvent, joinEvent } from "./api.js";
import { renderBottomNav } from "./components.js";
import {
  $, el, iconEl, show, errMsg, PHASE, TYPE_LABELS, STAGE_LABELS,
  phaseOf, fmtDateTime, relativeSpan, toMs, gameUrl
} from "./event-utils.js";

const ID_PATTERN = /^[A-Za-z0-9]{1,40}$/;

const state = { id: "", event: null, participation: null, busy: false, timer: 0 };

function showError(title, text) {
  show($("evdSkeleton"), false);
  show($("evdHero"), false);
  $("evdErrorTitle").textContent = title;
  $("evdErrorText").textContent = text;
  show($("evdError"), true);
}

function note(text, kind) {
  const n = $("evdNote");
  n.textContent = text || "";
  n.className = `ev-callout${kind ? ` is-${kind}` : ""}`;
  show(n, !!text);
}

function disabledButton(text) {
  const b = $("evdDisabled");
  b.textContent = text;
  show(b, !!text);
}

/** يحدّث الأزرار والملاحظات حسب مرحلة الحدث ومشاركة الطالب */
function renderActions() {
  const ev = state.event;
  const p = state.participation;
  const phase = phaseOf(ev);
  const now = Date.now();

  show($("evdPlay"), false);
  show($("evdJoin"), false);
  disabledButton("");
  note("");

  // النقاط المعتمدة
  const scoreFact = $("evdScoreFact");
  if (ev.scoreEnabled) {
    show(scoreFact, true);
    if (p && p.score !== null && p.score !== undefined) {
      $("evdScore").textContent = `${p.score} من ${ev.maxScore}`;
    } else if (p && p.reviewStatus === "pending") {
      $("evdScore").textContent = "نتيجتك قيد المراجعة";
    } else if (p && p.reviewStatus === "rejected") {
      $("evdScore").textContent = "لم تُعتمد النتيجة";
    } else {
      $("evdScore").textContent = `حتى ${ev.maxScore} نقطة`;
    }
  } else {
    show(scoreFact, false);
  }

  if (p && p.status === "completed") {
    note(
      ev.scoreEnabled
        ? "أكملت هذا الحدث. تظهر نقاطك هنا بعد اعتماد الأستاذ لها."
        : "أكملت هذا الحدث. شكرًا لمشاركتك!",
      "ok"
    );
    disabledButton("أكملت الحدث");
    return;
  }

  if (phase === "upcoming") {
    note(`يبدأ هذا الحدث بعد ${relativeSpan(toMs(ev.startAt) - now)}.`);
    disabledButton("لم يبدأ بعد");
    return;
  }
  if (phase === "ended") {
    note(p ? "انتهى هذا الحدث قبل أن تُكمله." : "انتهى هذا الحدث.", "bad");
    disabledButton("انتهى الحدث");
    return;
  }

  // الحدث جارٍ
  if (ev.type === "game" && ev.gameFile && gameUrl(ev.gameFile)) {
    const play = $("evdPlay");
    play.href = `event-play.html?id=${encodeURIComponent(ev.id)}`;
    $("evdPlayLabel").textContent = p ? "متابعة اللعبة" : "ابدأ اللعبة";
    show(play, true);
    note(`ينتهي الحدث بعد ${relativeSpan(toMs(ev.endAt) - now)}.`);
    return;
  }
  if (ev.type === "game") {
    note("هذه اللعبة غير مهيّأة بعد. تواصل مع المعلم.", "bad");
    disabledButton("اللعبة غير متاحة");
    return;
  }

  // نشاط عادي
  if (p) {
    note("تم تسجيل مشاركتك في هذا الحدث.", "ok");
    disabledButton("مسجَّل");
  } else {
    show($("evdJoin"), true);
    note(`ينتهي الحدث بعد ${relativeSpan(toMs(ev.endAt) - now)}.`);
  }
}

function renderEvent() {
  const ev = state.event;
  const phase = phaseOf(ev);

  const media = $("evdMedia");
  media.replaceChildren();
  if (ev.imageUrl) {
    media.appendChild(el("img", { attrs: { src: ev.imageUrl, alt: "" } }));
  } else {
    media.appendChild(iconEl(ev.type === "game" ? "rocket" : "calendar"));
  }

  $("evdBadges").replaceChildren(
    el("span", { class: `ev-badge ${PHASE[phase].cls}`, text: PHASE[phase].label }),
    el("span", { class: "ev-badge is-type", text: TYPE_LABELS[ev.type] || TYPE_LABELS.activity })
  );
  $("evdTitle").textContent = ev.title;
  const desc = $("evdDesc");
  desc.textContent = ev.description || "";
  show(desc, !!ev.description);

  $("evdStart").textContent = fmtDateTime(ev.startAt);
  $("evdEnd").textContent = fmtDateTime(ev.endAt);
  $("evdStage").textContent = STAGE_LABELS[ev.stage] || STAGE_LABELS.all;
  document.title = `${ev.title} — منصة أ/ إسماعيل عماد`;

  show($("evdSkeleton"), false);
  show($("evdError"), false);
  show($("evdHero"), true);
  renderActions();
}

async function load() {
  const res = await getEvent(state.id);
  if (!res || !res.success) {
    const code = res && res.error && res.error.code;
    if (code === "NOT_FOUND") {
      showError("هذا الحدث غير متاح", "قد يكون الحدث غير منشور أو غير مخصص لمرحلتك.");
    } else {
      showError("تعذر تحميل الحدث", errMsg(res, "تأكد من اتصالك بالإنترنت وحاول مرة أخرى."));
    }
    return;
  }
  state.event = res.data.event;
  state.participation = res.data.participation;
  renderEvent();

  // تحديث الأزرار والعدّاد كل دقيقة (بدء/انتهاء الحدث أثناء فتح الصفحة)
  clearInterval(state.timer);
  state.timer = setInterval(() => { if (state.event) renderActions(); }, 60000);
}

async function onJoin() {
  if (state.busy) return;
  state.busy = true;
  const b = $("evdJoin");
  b.disabled = true;
  b.textContent = "جارٍ التسجيل…";

  const res = await joinEvent(state.id);

  state.busy = false;
  b.disabled = false;
  b.textContent = "الدخول إلى الحدث";

  if (!res || !res.success) {
    showToast(errMsg(res, "تعذر تسجيل مشاركتك. حاول مرة أخرى."), "error");
    return;
  }
  state.participation = res.data.participation;
  showToast(res.data.outcome === "already" ? "أنت مسجَّل بالفعل في هذا الحدث." : "تم تسجيل مشاركتك.", "success");
  renderActions();
}

async function init() {
  const session = requireStudent();
  if (!session) return;

  const slot = $("bottomNavSlot");
  slot.replaceChildren();
  slot.appendChild(renderBottomNav());

  const id = new URLSearchParams(window.location.search).get("id") || "";
  if (!ID_PATTERN.test(id)) {
    showError("رابط غير صحيح", "افتح الحدث من قائمة الأحداث.");
    return;
  }
  state.id = id;
  $("evdJoin").addEventListener("click", onJoin);
  await load();
}

onReady(init);
