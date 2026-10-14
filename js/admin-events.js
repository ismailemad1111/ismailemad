/**
 * admin-events.js
 * ------------------------------------------------------------
 * تشغيل صفحة admin/events.html — إدارة الأحداث والألعاب والمشاركات.
 * رسائل النجاح لا تظهر إلا بعد أن يرد الباك إند بنجاح الحفظ في Firestore.
 * كل النصوص القادمة من قاعدة البيانات تُعرض بـ textContent.
 * ------------------------------------------------------------
 */

import { onReady, showToast, debounce } from "./helpers.js";
import { requireAdmin } from "./router.js";
import { backendRequest } from "./backend/index.js";
import {
  $, el, iconEl, show, errMsg, PHASE, TYPE_LABELS, STATUS_LABELS, STAGE_LABELS,
  fmtShort, toLocalInput, fromLocalInput, probeGame, isValidGameFile, compressImage,
  GAME_MISSING_MESSAGE
} from "./event-utils.js";

const api = (endpoint, options) => backendRequest(endpoint, options);

const STATUS_CHIP = { draft: "abk-chip--warn", published: "abk-chip--ok", hidden: "" };
const PHASE_CHIP = { upcoming: "abk-chip--warn", live: "abk-chip--ok", ended: "" };
const REVIEW = {
  none:     { label: "بلا نتيجة", cls: "" },
  pending:  { label: "نتيجة قيد المراجعة", cls: "abk-chip--warn" },
  approved: { label: "معتمدة", cls: "abk-chip--ok" },
  rejected: { label: "مرفوضة", cls: "abk-chip--bad" }
};

const state = {
  events: [],
  eventsLoaded: false,
  tab: "events",
  partEventId: "",
  parts: [],
  partsLoadedFor: ""
};

function btn(label, cls, onClick) {
  const b = el("button", { class: `abk-btn abk-btn--sm ${cls || ""}`.trim(), text: label, attrs: { type: "button" } });
  b.addEventListener("click", onClick);
  return b;
}
function chip(label, cls) { return el("span", { class: `abk-chip ${cls || ""}`.trim(), text: label }); }
function setOverlay(id, open) {
  const o = $(id);
  o.classList.toggle("is-open", open);
  o.setAttribute("aria-hidden", open ? "false" : "true");
}
function showFormError(id, msg) {
  const b = $(id);
  b.textContent = msg || "";
  show(b, !!msg);
}
function eventById(id) { return state.events.find((e) => e.id === id) || null; }

/* ============================================================
   قائمة الأحداث
   ============================================================ */

function eventsView(v) { // loading | list | empty | error
  show($("aevLoading"), v === "loading");
  show($("aevGrid"), v === "list");
  show($("aevEmpty"), v === "empty");
  show($("aevError"), v === "error");
}

async function loadEvents() {
  eventsView("loading");
  const res = await api("/api/admin/events");
  if (!res || !res.success) {
    $("aevErrorText").textContent = errMsg(res, "تأكد من اتصالك وحاول مرة أخرى.");
    eventsView("error");
    return;
  }
  state.events = res.data.events || [];
  state.eventsLoaded = true;
  updatePendingBadge();
  fillPartEventSelect();
  renderEvents();
}

function updatePendingBadge() {
  const n = state.events.reduce((a, e) => a + (e.pendingReview || 0), 0);
  const b = $("aevPendingCount");
  b.textContent = String(n);
  show(b, n > 0);
}

function buildEventCard(ev) {
  const media = el("div", { class: "abk-card-media" });
  if (ev.imageUrl) media.appendChild(el("img", { attrs: { src: ev.imageUrl, alt: "", loading: "lazy" } }));
  else media.appendChild(iconEl(ev.type === "game" ? "rocket" : "calendar"));

  const chips = el("div", { class: "abk-chips" }, [
    chip(STATUS_LABELS[ev.status] || ev.status, STATUS_CHIP[ev.status]),
    chip(PHASE[ev.phase].label, PHASE_CHIP[ev.phase]),
    chip(TYPE_LABELS[ev.type] || TYPE_LABELS.activity, "abk-chip--info")
  ]);

  const lines = [
    el("p", { class: "abk-row-sub", text: `من ${fmtShort(ev.startAt)} إلى ${fmtShort(ev.endAt)}` }),
    el("p", { class: "abk-row-sub", text: `المرحلة: ${STAGE_LABELS[ev.stage] || ev.stage}` })
  ];
  if (ev.type === "game") {
    const f = el("p", { class: "abk-row-sub" });
    f.appendChild(document.createTextNode("الملف: "));
    f.appendChild(el("span", { class: "aev-file", text: ev.gameFile }));
    lines.push(f);
  }
  lines.push(el("p", {
    class: "abk-row-sub",
    text: `المشاركون: ${ev.participants} — المكتملون: ${ev.completed}` +
      (ev.pendingReview ? ` — بانتظار المراجعة: ${ev.pendingReview}` : "")
  }));

  const toggle = ev.status === "published"
    ? btn("إخفاء", "", () => quickStatus(ev, "hidden"))
    : btn("نشر", "abk-btn--primary", () => quickStatus(ev, "published"));

  const actions = el("div", { class: "abk-actions" }, [
    btn("تعديل", "", () => openForm(ev)),
    toggle,
    btn("المشاركات", "", () => openParticipations(ev.id)),
    btn("حذف", "abk-btn--danger", () => openDelete(ev))
  ]);

  return el("article", { class: "abk-card" }, [
    media,
    el("div", { class: "abk-card-body" }, [
      el("h3", { class: "abk-card-name", text: ev.title }),
      chips,
      ev.description ? el("p", { class: "abk-card-desc", text: ev.description }) : null,
      ...lines,
      actions
    ])
  ]);
}

function renderEvents() {
  const q = $("aevSearch").value.trim().toLowerCase();
  const f = $("aevFilter").value;
  const rows = state.events.filter((e) => {
    if (f !== "all" && e.status !== f) return false;
    if (q && !`${e.title} ${e.gameFile}`.toLowerCase().includes(q)) return false;
    return true;
  });
  if (!rows.length) {
    const none = state.events.length === 0;
    $("aevEmptyTitle").textContent = none ? "لا توجد أحداث" : "لا توجد نتائج مطابقة";
    $("aevEmptyText").textContent = none ? "اضغط زر + لإضافة أول حدث للطلاب." : "غيّر البحث أو التصفية.";
    eventsView("empty");
    return;
  }
  $("aevGrid").replaceChildren(...rows.map(buildEventCard));
  eventsView("list");
}

async function quickStatus(ev, status) {
  const res = await api(`/api/admin/events/${encodeURIComponent(ev.id)}`, { method: "PATCH", body: { status } });
  if (!res || !res.success) { showToast(errMsg(res, "تعذر تغيير حالة النشر."), "error"); return; }
  showToast(status === "published" ? "تم نشر الحدث." : "تم إخفاء الحدث.", "success");
  await loadEvents();
}

/* ============================================================
   نموذج الحدث (إضافة / تعديل)
   ============================================================ */

let editing = null;
let formBusy = false;
let imageData = "";

function setImage(data) {
  imageData = data || "";
  const p = $("aevPreview");
  if (imageData) p.src = imageData; else p.removeAttribute("src");
  show(p, !!imageData);
  show($("aevImageClear"), !!imageData);
}

function syncFormVisibility() {
  const isGame = $("aevType").value === "game";
  show($("aevGameWrap"), isGame);
  show($("aevMaxWrap"), isGame && $("aevScoreEnabled").checked);
}

function setCheck(text, kind) {
  const c = $("aevCheckResult");
  c.textContent = text || "";
  c.className = `aev-check${kind ? ` is-${kind}` : ""}`;
}

function openForm(ev) {
  editing = ev || null;
  formBusy = false;
  $("aevFormTitle").textContent = ev ? "تعديل الحدث" : "حدث جديد";
  showFormError("aevFormError", "");
  $("aevTitle").value = ev ? ev.title : "";
  $("aevDesc").value = ev ? ev.description : "";
  $("aevImage").value = "";
  setImage(ev ? ev.imageUrl : "");

  // افتراضيًا: يبدأ بعد ساعة وينتهي بعد أسبوع
  const now = Date.now();
  $("aevStart").value = toLocalInput(ev ? ev.startAt : now + 3600000);
  $("aevEnd").value = toLocalInput(ev ? ev.endAt : now + 7 * 86400000);
  $("aevStatus").value = ev ? ev.status : "draft";
  $("aevType").value = ev ? ev.type : "activity";
  $("aevStage").value = ev ? ev.stage : "all";
  $("aevGameFile").value = ev ? ev.gameFile : "";
  $("aevScoreEnabled").checked = ev ? ev.scoreEnabled : false;
  $("aevMaxScore").value = ev && ev.scoreEnabled ? String(ev.maxScore) : "";
  setCheck("");
  syncFormVisibility();
  $("aevSave").disabled = false;
  $("aevSave").textContent = "حفظ";
  setOverlay("aevOverlay", true);
  $("aevTitle").focus();
}

async function checkGameFile() {
  const name = $("aevGameFile").value.trim();
  if (!name) { setCheck("اكتب اسم الملف أولًا.", "bad"); return; }
  if (!isValidGameFile(name)) {
    setCheck("الاسم غير مقبول: يجب أن يبدأ بـ game- وينتهي بـ .html بلا مسارات أو مسافات.", "bad");
    return;
  }
  setCheck("جارٍ الفحص…", "wait");
  const r = await probeGame(name);
  if (r === "ok") setCheck("الملف منشور ويمكن الوصول إليه.", "ok");
  else if (r === "missing") setCheck(GAME_MISSING_MESSAGE.replace("تواصل مع المعلم.", "ضعه في جذر المشروع وانشر الموقع."), "bad");
  else if (r === "network") setCheck("تعذر الفحص الآن (الاتصال).", "bad");
  else setCheck("الاسم غير مقبول.", "bad");
}

function collectForm() {
  const isGame = $("aevType").value === "game";
  const startMs = fromLocalInput($("aevStart").value);
  const endMs = fromLocalInput($("aevEnd").value);
  const gameFile = $("aevGameFile").value.trim();
  const scoreEnabled = isGame && $("aevScoreEnabled").checked;
  const maxRaw = $("aevMaxScore").value.trim();
  const max = Number(maxRaw);

  const problems = [];
  const title = $("aevTitle").value.trim();
  if (!title) problems.push("اكتب اسم الحدث.");
  if (!Number.isFinite(startMs)) problems.push("اختر تاريخ ووقت البداية.");
  if (!Number.isFinite(endMs)) problems.push("اختر تاريخ ووقت النهاية.");
  if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs <= startMs) problems.push("وقت النهاية يجب أن يكون بعد وقت البداية.");
  if (isGame) {
    if (!gameFile) problems.push("اكتب اسم ملف اللعبة.");
    else if (!isValidGameFile(gameFile)) problems.push("اسم ملف اللعبة غير مقبول (game-*.html بلا مسارات).");
  }
  if (scoreEnabled && (!maxRaw || !Number.isInteger(max) || max < 1)) problems.push("اكتب الحد الأقصى للنقاط (رقم صحيح أكبر من صفر).");
  if (problems.length) return { problems };

  return {
    body: {
      title,
      description: $("aevDesc").value.trim(),
      imageUrl: imageData,
      startAt: startMs,
      endAt: endMs,
      status: $("aevStatus").value,
      type: $("aevType").value,
      stage: $("aevStage").value,
      gameFile: isGame ? gameFile : "",
      scoreEnabled,
      maxScore: scoreEnabled ? max : null
    }
  };
}

async function saveForm() {
  if (formBusy) return;
  const { problems, body } = collectForm();
  if (problems) { showFormError("aevFormError", problems.join(" ")); return; }
  showFormError("aevFormError", "");

  formBusy = true;
  $("aevSave").disabled = true;
  $("aevSave").textContent = "جارٍ الحفظ…";

  const res = editing
    ? await api(`/api/admin/events/${encodeURIComponent(editing.id)}`, { method: "PATCH", body })
    : await api("/api/admin/events", { method: "POST", body });

  formBusy = false;
  $("aevSave").disabled = false;
  $("aevSave").textContent = "حفظ";

  if (!res || !res.success) { showFormError("aevFormError", errMsg(res, "تعذر الحفظ. حاول مرة أخرى.")); return; }

  setOverlay("aevOverlay", false);
  showToast(editing ? "تم حفظ التعديلات." : "تمت إضافة الحدث.", "success");
  await loadEvents();
}

/* ============================================================
   حذف حدث
   ============================================================ */

let delCtx = null;

function openDelete(ev) {
  delCtx = { ev, busy: false };
  showFormError("aevDelError", "");
  $("aevDelText").textContent =
    `سيُحذف الحدث «${ev.title}» نهائيًا مع ${ev.participants} مشاركة/نتيجة مسجّلة فيه. لا يمكن التراجع. ` +
    "إذا أردت فقط إيقاف ظهوره للطلاب فاستخدم «إخفاء» بدل الحذف.";
  $("aevDelConfirm").disabled = false;
  $("aevDelConfirm").textContent = "حذف نهائي";
  setOverlay("aevDelOverlay", true);
}

async function confirmDelete() {
  if (!delCtx || delCtx.busy) return;
  delCtx.busy = true;
  $("aevDelConfirm").disabled = true;
  $("aevDelConfirm").textContent = "جارٍ الحذف…";
  const res = await api(`/api/admin/events/${encodeURIComponent(delCtx.ev.id)}`, { method: "DELETE" });
  const ctx = delCtx;
  ctx.busy = false;
  $("aevDelConfirm").disabled = false;
  $("aevDelConfirm").textContent = "حذف نهائي";
  if (!res || !res.success) { showFormError("aevDelError", errMsg(res, "تعذر الحذف. حاول مرة أخرى.")); return; }
  setOverlay("aevDelOverlay", false);
  delCtx = null;
  if (state.partEventId === ctx.ev.id) { state.partEventId = ""; state.parts = []; state.partsLoadedFor = ""; }
  showToast("تم حذف الحدث.", "success");
  await loadEvents();
}

/* ============================================================
   المشاركات والنتائج
   ============================================================ */

function fillPartEventSelect() {
  const sel = $("aevPartEvent");
  const keep = state.partEventId;
  sel.replaceChildren(el("option", { text: "— اختر حدثًا —", attrs: { value: "" } }),
    ...state.events.map((e) => el("option", {
      text: `${e.title}${e.pendingReview ? ` (${e.pendingReview} بانتظار المراجعة)` : ""}`,
      attrs: { value: e.id }
    })));
  sel.value = state.events.some((e) => e.id === keep) ? keep : "";
}

function partsView(v) { // idle | loading | list | empty | error
  show($("aevPartsLoading"), v === "loading");
  show($("aevPartsList"), v === "list");
  show($("aevPartsEmpty"), v === "idle" || v === "empty");
  show($("aevPartsError"), v === "error");
}

async function loadParts(force = false) {
  const id = state.partEventId;
  show($("aevPartSummary"), false);
  if (!id) {
    $("aevPartsEmptyTitle").textContent = "اختر حدثًا لعرض مشاركاته";
    partsView("idle");
    return;
  }
  if (!force && state.partsLoadedFor === id) { renderParts(); return; }
  partsView("loading");
  const res = await api(`/api/admin/events/${encodeURIComponent(id)}/participations`);
  if (state.partEventId !== id) return; // تغيّر الاختيار أثناء التحميل
  if (!res || !res.success) {
    $("aevPartsErrorText").textContent = errMsg(res, "تأكد من اتصالك وحاول مرة أخرى.");
    partsView("error");
    return;
  }
  state.parts = res.data.participations || [];
  state.partsLoadedFor = id;
  renderParts();
}

function partMatches(p, f, q) {
  if (f === "pending" && p.reviewStatus !== "pending") return false;
  if (f === "completed" && p.status !== "completed") return false;
  if (f === "started" && p.status !== "started") return false;
  if (q && !`${p.studentName} ${p.studentCode}`.toLowerCase().includes(q)) return false;
  return true;
}

function renderParts() {
  const ev = eventById(state.partEventId);
  const f = $("aevPartFilter").value;
  const q = $("aevPartSearch").value.trim().toLowerCase();
  const rows = state.parts.filter((p) => partMatches(p, f, q));

  const total = state.parts.length;
  const done = state.parts.filter((p) => p.status === "completed").length;
  const pend = state.parts.filter((p) => p.reviewStatus === "pending").length;
  const summary = $("aevPartSummary");
  summary.textContent = `إجمالي المشاركين: ${total} — المكتملون: ${done}` +
    (ev && ev.scoreEnabled ? ` — نتائج بانتظار المراجعة: ${pend}` : "") +
    (ev && ev.type === "game" && !ev.scoreEnabled ? " — هذه اللعبة لا ترسل نقاطًا (تُسجَّل المشاركة وحالتها فقط)." : "");
  show(summary, true);

  if (!rows.length) {
    $("aevPartsEmptyTitle").textContent = total ? "لا توجد مشاركات مطابقة" : "لا توجد مشاركات في هذا الحدث بعد";
    partsView("empty");
    return;
  }

  $("aevPartsList").replaceChildren(...rows.map((p) => buildPartRow(p, ev)));
  partsView("list");
}

function buildPartRow(p, ev) {
  const review = REVIEW[p.reviewStatus] || REVIEW.none;
  const scoring = !!(ev && ev.scoreEnabled);

  const subs = [
    `بدأ: ${fmtShort(p.startedAt)}` + (p.completedAt ? ` — أكمل: ${fmtShort(p.completedAt)}` : ""),
    p.stage ? `المرحلة: ${STAGE_LABELS[p.stage] || p.stage}` : ""
  ].filter(Boolean);

  const chips = el("div", { class: "abk-chips" }, [
    chip(p.status === "completed" ? "مكتملة" : "لم تكتمل", p.status === "completed" ? "abk-chip--ok" : "abk-chip--warn"),
    scoring ? chip(review.label, review.cls) : null
  ]);

  const side = el("div", { class: "abk-row-side" });
  if (scoring) {
    const lines = [];
    if (p.score !== null && p.score !== undefined) lines.push(`معتمدة: ${p.score} / ${ev.maxScore}`);
    if (p.reportedScore !== null && p.reportedScore !== undefined) lines.push(`مُبلَّغ عنها من اللعبة: ${p.reportedScore}`);
    lines.forEach((t) => side.appendChild(el("span", { class: "aev-score", text: t })));
  }
  const actions = el("div", { class: "abk-actions", attrs: { style: "margin-top:0" } });
  if (scoring && p.reviewStatus === "pending" && Number.isInteger(p.reportedScore)) {
    actions.appendChild(btn("اعتماد النتيجة", "abk-btn--primary", () => quickApprove(p)));
  }
  actions.appendChild(btn("مراجعة", "", () => openReview(p, ev)));
  side.appendChild(actions);

  return el("div", { class: "abk-row" }, [
    el("div", { class: "abk-row-main" }, [
      el("p", { class: "abk-row-title", text: `${p.studentName || "طالب"} (كود ${p.studentCode || "—"})` }),
      ...subs.map((t) => el("p", { class: "abk-row-sub", text: t })),
      p.note ? el("p", { class: "abk-row-sub", text: `ملاحظة: ${p.note}` }) : null,
      chips
    ]),
    side
  ]);
}

async function patchPart(id, body) {
  return api(`/api/admin/event-participations/${encodeURIComponent(id)}`, { method: "PATCH", body });
}

async function refreshAfterReview() {
  await loadParts(true);
  // تحديث العدّادات (بانتظار المراجعة) بصمت
  const res = await api("/api/admin/events");
  if (res && res.success) {
    state.events = res.data.events || [];
    updatePendingBadge();
    fillPartEventSelect();
    renderEvents();
  }
}

async function quickApprove(p) {
  const res = await patchPart(p.id, { reviewStatus: "approved", score: p.reportedScore });
  if (!res || !res.success) { showToast(errMsg(res, "تعذر اعتماد النتيجة."), "error"); return; }
  showToast("تم اعتماد النتيجة.", "success");
  await refreshAfterReview();
}

let revCtx = null;

function openReview(p, ev) {
  const scoring = !!(ev && ev.scoreEnabled);
  revCtx = { p, ev, busy: false, scoring };
  showFormError("aevRevError", "");
  $("aevRevSub").textContent = `${p.studentName || "طالب"} (كود ${p.studentCode || "—"})`;
  $("aevRevStatus").value = p.status;
  show($("aevRevScoreWrap"), scoring);
  if (scoring) {
    $("aevRevScore").max = String(ev.maxScore);
    $("aevRevScore").value = p.score !== null && p.score !== undefined ? String(p.score) : "";
    $("aevRevReview").value = ["pending", "approved", "rejected"].includes(p.reviewStatus) ? p.reviewStatus : "pending";
    $("aevRevReported").textContent = Number.isInteger(p.reportedScore)
      ? `النتيجة المُبلَّغ عنها من اللعبة: ${p.reportedScore} (غير موثوقة حتى تعتمدها). الحد الأقصى ${ev.maxScore}.`
      : `لم ترسل اللعبة نتيجة. الحد الأقصى ${ev.maxScore}.`;
  }
  $("aevRevNote").value = p.note || "";
  $("aevRevSave").disabled = false;
  $("aevRevSave").textContent = "حفظ";
  setOverlay("aevRevOverlay", true);
}

async function saveReview() {
  if (!revCtx || revCtx.busy) return;
  const { p, ev, scoring } = revCtx;
  const body = {};
  const newStatus = $("aevRevStatus").value;
  if (newStatus !== p.status) body.status = newStatus;

  if (scoring) {
    const raw = $("aevRevScore").value.trim();
    const review = $("aevRevReview").value;
    const oldScore = p.score === null || p.score === undefined ? "" : String(p.score);
    if (raw !== oldScore) {
      if (raw === "") body.score = null;
      else {
        const n = Number(raw);
        if (!Number.isInteger(n) || n < 0 || n > ev.maxScore) {
          showFormError("aevRevError", `النقاط يجب أن تكون رقمًا صحيحًا من 0 إلى ${ev.maxScore}.`);
          return;
        }
        body.score = n;
      }
    }
    if (review !== p.reviewStatus) body.reviewStatus = review;
    if (review === "approved" && raw === "" && !Number.isInteger(p.reportedScore)) {
      showFormError("aevRevError", "اكتب النقاط قبل الاعتماد.");
      return;
    }
    if (review === "approved" && raw === "" && Number.isInteger(p.reportedScore)) {
      body.reviewStatus = "approved"; // يستخدم الباك إند النتيجة المُبلَّغ عنها
    }
  }
  const note = $("aevRevNote").value.trim();
  if (note !== (p.note || "")) body.note = note;

  if (Object.keys(body).length === 0) { setOverlay("aevRevOverlay", false); return; }

  showFormError("aevRevError", "");
  revCtx.busy = true;
  $("aevRevSave").disabled = true;
  $("aevRevSave").textContent = "جارٍ الحفظ…";
  const res = await patchPart(p.id, body);
  revCtx.busy = false;
  $("aevRevSave").disabled = false;
  $("aevRevSave").textContent = "حفظ";
  if (!res || !res.success) { showFormError("aevRevError", errMsg(res, "تعذر الحفظ. حاول مرة أخرى.")); return; }
  setOverlay("aevRevOverlay", false);
  revCtx = null;
  showToast("تم حفظ المراجعة.", "success");
  await refreshAfterReview();
}

/* ============================================================
   التبويبات والأحداث
   ============================================================ */

function openParticipations(eventId) {
  state.partEventId = eventId;
  $("aevPartEvent").value = eventId;
  switchTab("parts");
}

function switchTab(tab) {
  state.tab = tab;
  document.querySelectorAll(".abk-tab").forEach((b) => {
    const a = b.dataset.tab === tab;
    b.classList.toggle("is-active", a);
    b.setAttribute("aria-selected", a ? "true" : "false");
  });
  show($("aevPanel-events"), tab === "events");
  show($("aevPanel-parts"), tab === "parts");
  show($("aevAdd"), tab === "events");
  if (tab === "parts") loadParts();
}

function bindEvents() {
  document.querySelectorAll(".abk-tab").forEach((b) => b.addEventListener("click", () => switchTab(b.dataset.tab)));
  $("aevRetry").addEventListener("click", loadEvents);
  $("aevAdd").addEventListener("click", () => openForm(null));
  $("aevSearch").addEventListener("input", debounce(renderEvents, 200));
  $("aevFilter").addEventListener("change", renderEvents);

  $("aevType").addEventListener("change", syncFormVisibility);
  $("aevScoreEnabled").addEventListener("change", syncFormVisibility);
  $("aevCheckFile").addEventListener("click", checkGameFile);
  $("aevGameFile").addEventListener("input", () => setCheck(""));
  $("aevImage").addEventListener("change", async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    try { setImage(await compressImage(f)); }
    catch (x) { e.target.value = ""; showToast("تعذر استخدام هذه الصورة. جرّب صورة أخرى.", "error"); }
  });
  $("aevImageClear").addEventListener("click", () => { $("aevImage").value = ""; setImage(""); });
  $("aevCancel").addEventListener("click", () => { if (!formBusy) setOverlay("aevOverlay", false); });
  $("aevSave").addEventListener("click", saveForm);

  $("aevDelCancel").addEventListener("click", () => { if (!delCtx || !delCtx.busy) setOverlay("aevDelOverlay", false); });
  $("aevDelConfirm").addEventListener("click", confirmDelete);

  $("aevPartEvent").addEventListener("change", () => { state.partEventId = $("aevPartEvent").value; loadParts(); });
  $("aevPartFilter").addEventListener("change", () => { if (state.partsLoadedFor) renderParts(); });
  $("aevPartSearch").addEventListener("input", debounce(() => { if (state.partsLoadedFor) renderParts(); }, 200));
  $("aevPartsRetry").addEventListener("click", () => loadParts(true));

  $("aevRevCancel").addEventListener("click", () => { if (!revCtx || !revCtx.busy) setOverlay("aevRevOverlay", false); });
  $("aevRevSave").addEventListener("click", saveReview);

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!formBusy && $("aevOverlay").classList.contains("is-open")) setOverlay("aevOverlay", false);
    if ((!delCtx || !delCtx.busy) && $("aevDelOverlay").classList.contains("is-open")) setOverlay("aevDelOverlay", false);
    if ((!revCtx || !revCtx.busy) && $("aevRevOverlay").classList.contains("is-open")) setOverlay("aevRevOverlay", false);
  });
}

async function init() {
  const session = requireAdmin();
  if (!session) return;
  bindEvents();
  await loadEvents();
}

onReady(init);
