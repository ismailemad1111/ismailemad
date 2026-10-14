/**
 * page-transition.js
 * ------------------------------------------------------------
 * بطاقة الانتقال الذكية (الروبوت) — عرض فقط، بلا أي منطق أعمال.
 *
 * الفكرة: عند الضغط على رابط داخلي ينقل الطالب لصفحة أخرى،
 *   1) تُمنع النقرات المتكررة،
 *   2) تظهر بطاقة بها روبوت ورسالة تناسب الوجهة،
 *   3) نجلب ملف الصفحة الهدف (يسخّن كاش المتصفح) ونُسبق تحميل
 *      سكربتاتها وأنماطها، بالتوازي مع عرض البطاقة،
 *   4) ننتقل فور الجاهزية وبعد حدّ أدنى قصير (لا انتظار اصطناعي طويل)،
 *   5) عند الفشل (انقطاع/خطأ/مهلة) تظهر رسالة مع «إعادة المحاولة».
 *
 * المبادئ:
 *   - الوجهة الفعلية هي نفس href الأصلي — لا نغيّر أي رابط.
 *   - لا نعترض: نقرة بزر غير الأيسر، Ctrl/⌘/Shift/Alt، target=_blank،
 *     download، روابط خارجية، mailto/tel، روابط # فقط، أو أي نقرة
 *     منعها كود آخر (defaultPrevented)، أو data-no-transition.
 *   - إن فشل أي جزء تجميلي يعمل التنقل العادي للمتصفح.
 *   - ⚠️ ما يتحقق منه الجلب هو جاهزية ملف الصفحة (HTML) فقط. بيانات
 *     Firestore تُجلب داخل الصفحة الهدف نفسها بعد فتحها، وهي تعرض
 *     حالات التحميل/الخطأ الخاصة بها.
 * ------------------------------------------------------------
 */

/* ============================================================
   01 — الإعدادات والرسائل
   ============================================================ */

const MIN_SHOW_MS = 900;        // أقل مدة لعرض البطاقة عند سرعة الشبكة الجيدة
const MIN_SHOW_REDUCED_MS = 350; // مع prefers-reduced-motion
const SLOW_MS = 3500;           // بعدها تتغير رسالة الحالة
const TIMEOUT_MS = 15000;       // بعدها نعتبر التحميل فاشلًا
const MAX_WARM = 12;            // أقصى عدد موارد نُسبق تحميلها

/**
 * رسائل كل وجهة، بمفتاح اسم الملف بلا .html.
 * لإضافة وجهة جديدة: أضف سطرًا هنا فقط.
 */
const DESTINATIONS = {
  bank:          { name: "بنك مستر إسماعيل", text: "استعد لاكتشاف بنك الأسئلة والتدرب على أهم الأفكار." },
  lessons:       { name: "الدروس",           text: "خطوتك القادمة نحو فهم أعمق تبدأ من هنا." },
  exams:         { name: "الاختبارات",       text: "حان وقت اختبار فهمك وإظهار ما تعلمته." },
  exam:          { name: "الاختبار",         text: "حان وقت اختبار فهمك وإظهار ما تعلمته." },
  planner:       { name: "خطتك",             text: "لننظم خطواتك القادمة نحو إنجاز أفضل." },
  ai:            { name: "اسأل",             text: "أنا هنا لمساعدتك على الفهم والإجابة عن أسئلتك." },
  announcements: { name: "الرسائل والإعلانات", text: "دعنا نطّلع على آخر المستجدات الخاصة بك." },
  profile:       { name: "ملفي",             text: "هيا نراجع تقدمك وبياناتك الدراسية." },
  events:        { name: "الأحداث والألعاب", text: "جهّز نفسك للعب والمشاركة وجمع النقاط." },
  event:         { name: "الأحداث والألعاب", text: "جهّز نفسك للعب والمشاركة وجمع النقاط." },
  "event-play":  { name: "الأحداث والألعاب", text: "جهّز نفسك للعب والمشاركة وجمع النقاط." },
  index:         { name: "الرئيسية",         text: "نعود بك إلى الصفحة الرئيسية." }
};

const FALLBACK = { name: "", text: "لحظات ونجهّز لك الصفحة." };

const TEXT = {
  loading: "برعي بيجهّز لك الصفحة…",
  slow:    "النت أبطأ شوية من المعتاد… برعي لسه بيحمّل لك الصفحة.",
  error:   "برعي ما قدرش يفتح الصفحة. اتأكد من النت وجرّب تاني.",
  errorTitle: "الرحلة ما كملتش المرة دي",
  retry:   "جرّب تاني",
  cancel:  "البقاء هنا"
};


/* ============================================================
   02 — الروبوت «برعي»: الرسم في js/mascot.js (مصدر واحد للمنصة)
   ============================================================ */

import { mascotSVG } from "./mascot.js";

const ROBOT_SVG = mascotSVG("wave", "pt-robot");


/* ============================================================
   03 — الحالة وبناء الواجهة
   ============================================================ */

const state = {
  busy: false,
  url: null,
  key: null,
  runId: 0,              // يلغي أي محاولة سابقة عند الإلغاء/إعادة المحاولة
  controller: null,
  timers: [],
  lastFocus: null
};

let ui = null;

const reducedMotion = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

function buildUI() {
  if (ui) return ui;

  const overlay = document.createElement("div");
  overlay.className = "pt-overlay";
  overlay.hidden = true;

  const card = document.createElement("div");
  card.className = "pt-card";
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  card.setAttribute("aria-labelledby", "ptMsg");
  card.tabIndex = -1;
  card.innerHTML = `
    ${ROBOT_SVG}
    <span class="pt-chip" id="ptChip"></span>
    <p class="pt-msg" id="ptMsg" aria-hidden="true"></p>
    <p class="pt-sr" id="ptSr" role="status" aria-live="polite"></p>
    <p class="pt-status" id="ptStatus" aria-hidden="true"></p>
    <div class="pt-bar" aria-hidden="true"><span></span></div>
    <div class="pt-actions">
      <button type="button" class="pt-btn pt-btn-primary" id="ptRetry">${TEXT.retry}</button>
      <button type="button" class="pt-btn" id="ptCancel">${TEXT.cancel}</button>
    </div>`;

  overlay.appendChild(card);
  document.body.appendChild(overlay);

  ui = {
    overlay,
    card,
    chip:   card.querySelector("#ptChip"),
    msg:    card.querySelector("#ptMsg"),
    sr:     card.querySelector("#ptSr"),
    status: card.querySelector("#ptStatus"),
    retry:  card.querySelector("#ptRetry"),
    cancel: card.querySelector("#ptCancel")
  };

  ui.retry.addEventListener("click", () => {
    if (state.url) start(state.url, state.key);
  });
  ui.cancel.addEventListener("click", cancel);

  /* لا نترك لوحة المفاتيح محتجزة: Escape يُلغي دائمًا، وTab يبقى داخل البطاقة */
  overlay.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    } else if (e.key === "Tab") {
      const btns = ui.card.classList.contains("is-error") ? [ui.retry, ui.cancel] : [];
      if (!btns.length) { e.preventDefault(); return; }
      const first = btns[0], last = btns[btns.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  return ui;
}

/** يضع الرسالة كلمةً كلمة لتظهر تدريجيًا (التقسيم على مستوى الكلمة يحفظ اتصال الحروف العربية). */
function setMessage(text) {
  ui.msg.replaceChildren();
  text.split(/\s+/).filter(Boolean).forEach((word, i) => {
    const span = document.createElement("span");
    span.className = "pt-w";
    span.style.setProperty("--i", String(i));
    span.textContent = word;
    ui.msg.appendChild(span);
    ui.msg.appendChild(document.createTextNode(" "));
  });
  ui.sr.textContent = text;
}

function setStatus(text) {
  ui.status.textContent = text;
  ui.status.classList.remove("is-swap");
  void ui.status.offsetWidth;          // إعادة تشغيل حركة التبديل
  ui.status.classList.add("is-swap");
}

function show(dest) {
  buildUI();
  ui.card.classList.remove("is-error");
  ui.chip.textContent = dest.name;
  ui.chip.hidden = !dest.name;
  setMessage(dest.text);
  setStatus(TEXT.loading);

  if (ui.overlay.hidden) {
    state.lastFocus = document.activeElement;
    ui.overlay.hidden = false;
    document.documentElement.classList.add("pt-lock");
    requestAnimationFrame(() => requestAnimationFrame(() => ui.overlay.classList.add("is-open")));
    try { ui.card.focus({ preventScroll: true }); } catch (e) { /* تجاهل */ }
  }
}

function hide() {
  if (!ui || ui.overlay.hidden) return;
  ui.overlay.classList.remove("is-open");
  document.documentElement.classList.remove("pt-lock");
  const el = ui.overlay;
  setTimeout(() => { if (!state.busy) el.hidden = true; }, 280);
  const f = state.lastFocus;
  state.lastFocus = null;
  if (f && typeof f.focus === "function" && document.contains(f)) {
    try { f.focus({ preventScroll: true }); } catch (e) { /* تجاهل */ }
  }
}

function showError() {
  ui.card.classList.add("is-error");
  ui.chip.textContent = TEXT.errorTitle;
  ui.chip.hidden = false;
  setMessage(TEXT.error);
  ui.status.textContent = "";
  try { ui.retry.focus({ preventScroll: true }); } catch (e) { /* تجاهل */ }
}


/* ============================================================
   04 — التنقل
   ============================================================ */

function clearTimers() {
  state.timers.forEach(clearTimeout);
  state.timers = [];
}

function wait(ms, runId) {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(runId === state.runId), ms);
    state.timers.push(t);
  });
}

/** يُسبق تحميل سكربتات وأنماط الصفحة الهدف أثناء عرض البطاقة. */
function warm(html, baseUrl) {
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");   // inert: لا ينفّذ شيئًا
    const seen = new Set();
    const add = (rel, href, as) => {
      let abs;
      try { abs = new URL(href, baseUrl); } catch (e) { return; }
      if (abs.origin !== location.origin || seen.has(abs.href) || seen.size >= MAX_WARM) return;
      seen.add(abs.href);
      const l = document.createElement("link");
      l.rel = rel;
      l.href = abs.href;
      if (as) l.as = as;
      document.head.appendChild(l);
    };
    doc.querySelectorAll('script[type="module"][src]').forEach((s) => add("modulepreload", s.getAttribute("src")));
    doc.querySelectorAll('link[rel="stylesheet"][href]').forEach((s) => add("prefetch", s.getAttribute("href"), "style"));
  } catch (e) { /* تجميلي فقط */ }
}

async function start(url, key) {
  const runId = ++state.runId;
  clearTimers();
  if (state.controller) state.controller.abort();

  state.busy = true;
  state.url = url;
  state.key = key;

  show(DESTINATIONS[key] || FALLBACK);

  const began = performance.now();
  const minShow = reducedMotion() ? MIN_SHOW_REDUCED_MS : MIN_SHOW_MS;

  state.timers.push(setTimeout(() => {
    if (runId === state.runId && !ui.card.classList.contains("is-error")) setStatus(TEXT.slow);
  }, SLOW_MS));

  /* من file:// لا يمكن الجلب: ننتقل بعد الحد الأدنى فقط */
  const canFetch = /^https?:$/.test(location.protocol) && typeof fetch === "function";

  if (canFetch) {
    const controller = new AbortController();
    state.controller = controller;
    let timedOut = false;
    const hard = setTimeout(() => { timedOut = true; controller.abort(); }, TIMEOUT_MS);
    state.timers.push(hard);

    try {
      const res = await fetch(url, { credentials: "same-origin", signal: controller.signal });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const html = await res.text();
      if (runId !== state.runId) return;       // أُلغيت أثناء الجلب
      warm(html, res.url || url);
    } catch (err) {
      if (runId !== state.runId) return;       // إلغاء متعمّد: لا خطأ
      clearTimers();
      state.controller = null;
      showError();                             // انقطاع أو خطأ خادم أو مهلة
      return;
    }
    clearTimeout(hard);
  }

  /* لا نُجبر الطالب على الانتظار إن كانت الصفحة جاهزة: نكمل الحد الأدنى فقط */
  const remaining = Math.max(0, minShow - (performance.now() - began));
  if (!(await wait(remaining, runId))) return;

  clearTimers();
  state.controller = null;
  window.location.assign(url);
}

function cancel() {
  state.runId++;                 // يبطل أي استمرار لمحاولة جارية
  clearTimers();
  if (state.controller) state.controller.abort();
  state.controller = null;
  state.busy = false;
  state.url = null;
  hide();
}


/* ============================================================
   05 — اعتراض النقرات
   ============================================================ */

function destinationKey(url) {
  const last = url.pathname.split("/").filter(Boolean).pop() || "index";
  return last.replace(/\.html$/i, "");
}

/** يعيد {url,key} إن كانت النقرة تنقل لصفحة داخلية عادية، وإلا null. */
function resolveLink(e) {
  if (e.defaultPrevented) return null;
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return null;

  const a = e.target instanceof Element ? e.target.closest("a[href]") : null;
  if (!a || a.hasAttribute("data-no-transition") || a.hasAttribute("download")) return null;

  const target = (a.getAttribute("target") || "").toLowerCase();
  if (target && target !== "_self") return null;
  if ((a.getAttribute("rel") || "").toLowerCase().split(/\s+/).includes("external")) return null;

  const raw = a.getAttribute("href").trim();
  if (!raw || raw.startsWith("#") || /^(javascript|mailto|tel|sms|blob|data):/i.test(raw)) return null;

  let url;
  try { url = new URL(a.href, location.href); } catch (err) { return null; }
  if (!/^https?:$|^file:$/.test(url.protocol)) return null;
  if (url.origin !== location.origin) return null;

  /* نفس الصفحة بتغيير الـ hash فقط → سلوك المتصفح الطبيعي */
  if (url.pathname === location.pathname && url.search === location.search && url.hash) return null;

  return { url: url.href, key: destinationKey(url) };
}

function onClick(e) {
  /* بطاقة الانتقال معروضة: لا ننقل مرتين */
  if (state.busy) {
    if (e.target instanceof Element && e.target.closest("a[href]") && !e.target.closest(".pt-overlay")) {
      e.preventDefault();
    }
    return;
  }

  const link = resolveLink(e);
  if (!link) return;

  e.preventDefault();
  start(link.url, link.key);
}

/** العودة بزر الرجوع (bfcache) تعيد الصفحة كما كانت: نُزيل البطاقة ونفتح القفل. */
function onPageShow(e) {
  if (e.persisted || state.busy) cancel();
}

function init() {
  if (window.__ptInit) return;
  window.__ptInit = true;
  document.addEventListener("click", onClick);
  window.addEventListener("pageshow", onPageShow);
}

init();

export { DESTINATIONS };
