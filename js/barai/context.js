/**
 * context.js — نموذج السياق: يجمع إشارات حقيقية ومحلية ويُنتج «لقطة سياق» (Context Snapshot).
 * ------------------------------------------------------------------
 * - كل الإشارات محلية: الوقت، مسار الصفحات في الجلسة، الخمول، الشبكة، الرؤية، درجات هذا الجهاز…
 * - لا كتابة في Firestore، ولا تخزين اسم أو أي معلومة شخصية (الاسم الأول يُقرأ وقت التشغيل من
 *   جلسة المتصفح الموجودة ولا يُخزَّن).
 * - بيانات المنصة الظاهرة في الصفحة تُمرَّر من الصفحة عبر barai.facts({...}).
 * - كل قراءة محصّنة؛ الفشل ⇒ قيم محايدة (لا يكسر شيئًا).
 */
import { config } from "./config.js";
import { store } from "./store.js";
import { createMemory } from "./memory.js";
import { toneOf } from "./engine.js";

export const memory = createMemory(store.memAdapter, config);

const page = () => (location.pathname.split("/").pop() || "index.html");
const now = () => Date.now();

/* ---------- حالة تفاعل حيّة (تُحدَّث بأحداث خفيفة passive) ---------- */
const live = { start: now(), lastInput: now(), lastScroll: 0, lastKey: 0, hiddenAt: 0, returnedAt: 0, facts: {}, bound: false };
let sessionInfo = null;

function bindLive() {
  if (live.bound) return;
  live.bound = true;
  try {
    const touch = () => { live.lastInput = now(); };
    ["pointerdown", "touchstart", "keydown", "mousemove", "wheel"].forEach((ev) => window.addEventListener(ev, touch, { passive: true }));
    window.addEventListener("scroll", () => { live.lastScroll = now(); live.lastInput = now(); }, { passive: true });
    window.addEventListener("keydown", () => { live.lastKey = now(); }, { passive: true });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") live.hiddenAt = now();
      else if (live.hiddenAt) { live.returnedAt = now(); }
    });
  } catch (e) { /* تجاهل */ }
}

/** مسار الصفحات داخل الجلسة (أسماء الصفحات فقط). */
function trackTrail() {
  try {
    const trail = (store.session.getField("trail", []) || []).slice(-9);
    const p = page();
    if (trail[trail.length - 1] !== p) trail.push(p);
    store.session.set("trail", trail.slice(-10));
    return trail.slice(-10);
  } catch (e) { return [page()]; }
}

/** يبدأ الجلسة مرة واحدة: عدد الزيارات + أيام الغياب (محليًا). */
function ensureSession() {
  if (sessionInfo) return sessionInfo;
  try {
    let st = store.session.getField("started", 0);
    let info = store.session.getField("visitInfo", null);
    if (!st || !info) {
      info = memory.startSession(now());
      store.session.set("started", now());
      store.session.set("visitInfo", info);
      st = now();
    }
    sessionInfo = { started: st, visits: info.visits, awayDays: info.awayDays };
  } catch (e) { sessionInfo = { started: live.start, visits: 1, awayDays: 0 }; }
  return sessionInfo;
}

export function readSessionIdentity() {
  try {
    const raw = sessionStorage.getItem("am_session");
    const s = raw ? JSON.parse(raw) : null;
    const st = s && s.student;
    const first = st && st.fullName ? String(st.fullName).trim().split(/\s+/)[0] : "";
    return { firstName: first || "", stage: (st && st.stage) || "" };
  } catch (e) { return { firstName: "", stage: "" }; }
}

function partOfDay(h) {
  if (h < 5) return "lateNight";
  if (h < 10) return "morning";
  if (h < 17) return "day";
  if (h < 23) return "evening";
  return "night";
}

function netInfo() {
  const out = { online: true, type: null, saveData: false, slow: false };
  try {
    out.online = navigator.onLine !== false;
    const c = navigator.connection || navigator.mozConnection;
    if (c) {
      out.type = c.effectiveType || null;
      out.saveData = !!c.saveData;
      out.slow = out.saveData || /^(slow-2g|2g)$/.test(out.type || "");
    }
  } catch (e) { /* تجاهل */ }
  return out;
}

function busyInfo(flag) {
  const out = { flag: !!flag, typing: false, typingHasValue: false, media: false, overlay: false };
  try {
    const a = document.activeElement;
    if (a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable)) {
      out.typing = true;
      out.typingHasValue = !!(a.value && String(a.value).length) || (a.isContentEditable && !!a.textContent);
    }
    out.media = Array.from(document.querySelectorAll("video,audio")).some((m) => !m.paused && !m.ended);
    const ov = document.querySelector(".pt-overlay");
    out.overlay = !!(ov && !ov.hidden);
  } catch (e) { /* تجاهل */ }
  return out;
}

export const context = {
  init() { bindLive(); ensureSession(); trackTrail(); },

  /** صفحات تُمرّر حقائق المنصة الظاهرة لديها (امتحانات، رصيد، مهام…). */
  facts(partial) {
    try { if (partial && typeof partial === "object") Object.assign(live.facts, partial); } catch (e) { /* تجاهل */ }
    return live.facts;
  },
  clearFacts() { live.facts = {}; },

  lastInputAgo() { return now() - live.lastInput; },

  /** لقطة السياق الكاملة. */
  snapshot({ busyFlag = false } = {}) {
    const t = now();
    const d = new Date(t);
    const h = d.getHours();
    const sess = ensureSession();
    const trail = (store.session.getField("trail", []) || []);
    const last3 = trail.slice(-3);
    const backAndForth = last3.length === 3 && last3[0] === last3[2] && last3[0] !== last3[1];
    const ss = store.session.get();
    const sc = memory.scoreTrend();
    const id = readSessionIdentity();
    let reduced = false;
    try { reduced = matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { /* تجاهل */ }

    const ctx = {
      now: t, hour: h, dow: d.getDay(),
      partOfDay: partOfDay(h),
      isNight: h >= 23 || h < 5,
      sessionPage: page(),
      sessionAgeMs: t - sess.started,
      pageAgeMs: t - live.start,
      visits: sess.visits,
      isNew: sess.visits <= 1,
      daysAway: sess.awayDays,
      consecutiveDays: memory.consecutiveDays(t),        // «أيام متتالية على هذا الجهاز» (ليس عدّاد المنظّم)
      trail, backAndForth,
      idleMs: t - live.lastInput,
      scrollAgoMs: live.lastScroll ? t - live.lastScroll : 1e9,
      typingAgoMs: live.lastKey ? t - live.lastKey : 1e9,
      returnedFromHidden: !!live.returnedAt && t - live.returnedAt < 8000,
      net: netInfo(),
      reducedMotion: reduced,
      identity: id,
      facts: live.facts,
      scores: sc,
      session: { bubbles: ss.bubbles || 0, moments: ss.moments || 0, acted: ss.acted || 0, ignoredRun: ss.ignoredRun || 0, closedRun: ss.closedRun || 0 },
      busy: busyInfo(busyFlag)
    };
    ctx.tone = toneOf(ctx);
    return ctx;
  }
};
