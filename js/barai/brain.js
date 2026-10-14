/**
 * brain.js — عقل برعي: يستقبل أحداثًا ويقرر الظهور والتعبير والجملة.
 * ------------------------------------------------------------------
 * الصفحات تُرسل حدثًا فقط. التدفق:
 *   notify ⇒ مرشّح يدخل طابورًا ⇒ تنتهي النافذة (config.windowMs أو settle()) ⇒ engine.arbitrate
 *   ⇒ عرض الفائز (أو دمج أقوى اثنين) ⇒ commit (علامة «شوهد» + الذاكرة) عند العرض فقط ⇒ تتبّع تفاعل الطالب.
 * أي فشل هنا يُبتلع (لا يكسر الصفحة). لا كتابة في Firestore؛ كل تخزين محلي داخل try/catch.
 */
import { config } from "./config.js";
import { LINES, pickLine } from "./lines.js";
import { store } from "./store.js";
import { ui } from "./ui.js";
import { context, memory } from "./context.js";
import { arbitrate } from "./engine.js";

const page = () => (location.pathname.split("/").pop() || "index.html");
const reduceMotion = () => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } };

/**
 * القواعد. kind: bubble | moment | inline (يعيد السطر للصفحة).
 * line(d) ⇒ مفتاح أو مصفوفة مفاتيح بترتيب الأفضلية (الأخير هو الاحتياطي).
 * id(d) ⇒ يميّز المثيل داخل نفس الموقف (لتهدئة 24 ساعة لكل معرّف).
 * compoundable: يصلح للدمج مع موقف آخر قابل للتنفيذ في رسالة واحدة.
 */
const RULES = {
  "exam.new":        { kind: "bubble", compoundable: true, id: (d) => d.id, line: (d) => (d.count === 2 ? "exam.new.two" : d.count > 2 && d.count <= 10 ? "exam.new.many" : d.count > 10 ? "exam.new.lots" : "exam.new") },
  "exam.intro":      { kind: "bubble", line: () => "exam.intro" },
  "exam.result":     { kind: "inline", line: (d, ctx) => resultKeys(d, ctx) },
  "streak.milestone":{ kind: "bubble", id: (d) => String(d.count), line: () => "streak.milestone" },
  "lesson.completed":{ kind: "bubble", line: () => "lesson.completed" },
  "lesson.returning":{ kind: "bubble", line: () => "lesson.returning" },
  "planner.empty":   { kind: "bubble", line: () => "planner.empty" },
  "planner.taskDone":{ kind: "bubble", line: () => "planner.taskDone" },
  "planner.allDone": { kind: "moment", confetti: true, line: () => "planner.allDone" },
  "planner.overdue": { kind: "bubble", compoundable: true, line: () => "planner.overdue" },
  "time.lateNight":  { kind: "bubble", line: () => "time.lateNight" },
  "time.morning":    { kind: "bubble", line: () => "time.morning" },
  "time.friday":     { kind: "bubble", line: () => "time.friday" },
  "net.offline":     { kind: "bubble", critical: true, line: () => "net.offline", sticky: true },
  "net.slow":        { kind: "bubble", critical: true, line: () => "net.slow" },
  "net.back":        { kind: "bubble", critical: true, line: () => "net.back" },
  "net.failed":      { kind: "bubble", critical: true, line: () => "net.failed" },
  "error.generic":   { kind: "bubble", critical: true, line: () => "error.generic" },
  "page.notFound":   { kind: "inline", line: () => "page.notFound" },
  "login.first":     { kind: "bubble", ignoreFocus: true, line: () => "login.first" },
  "login.firstStep": { kind: "bubble", ignoreFocus: true, line: () => "login.firstStep" },
  "login.fail":      { kind: "bubble", critical: true, line: (d) => (d && d.kind === "password" ? "login.fail.password" : d && d.kind === "code" ? "login.fail.code" : "login.fail") },
  "login.success":   { kind: "bubble", line: () => "login.success" },
  "bank.orderStatus":{ kind: "bubble", compoundable: true, id: (d) => String(d.id || "") + ":" + String(d.status || ""), line: (d) => "bank.orderStatus." + String(d.status || "") },
  "bank.earned":     { kind: "bubble", id: (d) => String(d.id || d.balance || ""), line: (d) => (d.reason ? ["bank.earned.reason", "bank.earned"] : "bank.earned") },
  "bank.afford":     { kind: "bubble", compoundable: true, id: (d) => String(d.id || ""), line: () => "bank.afford" },
  "bank.near":       { kind: "bubble", id: (d) => String(d.id || ""), line: () => "bank.near" },
  "bank.newReward":  { kind: "bubble", compoundable: true, id: (d) => String(d.id || ""), line: () => "bank.newReward" },
  "bank.lowStock":   { kind: "bubble", id: (d) => String(d.id || ""), line: () => "bank.lowStock" },
  "bank.blocked":    { kind: "bubble", line: () => "bank.blocked" },
  "bank.welcome":    { kind: "bubble", line: () => "bank.welcome" },
  "bank.redeem":     { kind: "moment", confetti: true, line: () => "bank.redeem" },
  "bank.poor":       { kind: "bubble", line: () => "bank.poor" },
  "event.live":      { kind: "bubble", compoundable: true, id: (d) => d.id, line: () => "event.live" },
  "event.ended":     { kind: "bubble", id: (d) => d.id, line: () => "event.ended" },
  "ai.open":         { kind: "bubble", ignoreFocus: "empty", line: () => "ai.open" },
  "ai.thinking":     { kind: "inline", line: () => "ai.thinking" },
  "ai.limit":        { kind: "bubble", ignoreFocus: true, line: () => "ai.limit" },
  "ai.error":        { kind: "bubble", critical: true, line: () => "ai.error" },
  "announce.unread": { kind: "bubble", compoundable: true, line: () => "announce.unread" },
  "announce.onPage": { kind: "bubble", line: (d) => (memory.hinted("announce", "unread") ? ["announce.onPage.followup", "announce.onPage"] : "announce.onPage") },
  "announce.allRead":{ kind: "bubble", line: () => (memory.hinted("announce", "unread") ? ["announce.allRead.followup", "announce.allRead"] : "announce.allRead") },
  "egg.joke":        { kind: "bubble", critical: true, manual: true, line: () => "egg.joke" },
  "egg.intro":       { kind: "bubble", critical: true, manual: true, line: () => "egg.intro" }
};

/** مفاتيح تعليق نتيجة الاختبار: اتجاه الدرجات المحلي + ما قاله برعي قبل ذلك. */
function resultKeys(d, ctx) {
  if (d.pending) return ["exam.result.pending"];
  const total = Number(d.total), score = Number(d.score);
  if (!(total > 0) || !isFinite(score)) return null;
  const pct = (score / total) * 100;
  const tr = memory.scoreTrend();
  const hinted = d.examId && memory.hinted("exam", d.examId);
  const out = [];
  if (pct >= 100) out.push("exam.result.perfect");
  else if (pct >= 85) { if (hinted) out.push("exam.result.followup.great"); out.push("exam.result.great"); }
  else if (pct >= 50) {
    if (tr.lowRun >= 1) out.push("exam.result.comeback");
    else if (tr.last !== null && pct - tr.last >= config.trend.delta) out.push("exam.result.improved");
    else if (tr.trend === "up") out.push("exam.result.improved");
    if (hinted) out.push("exam.result.followup.ok");
    out.push("exam.result.ok");
  } else {
    if (tr.lowRun >= 2) out.push("exam.result.lowRun");
    if (hinted) out.push("exam.result.followup.low");
    out.push("exam.result.low");
  }
  return out;
}

/* ============================================================
   الحالة الداخلية
   ============================================================ */
let busyFlag = false;
let stickyEl = null;
let queue = [];               // مرشّحون في النافذة الحالية
let winTimer = null, winStart = 0, settled = false, flushing = false;
const retryTimers = new Set();
const decisions = [];         // آخر القرارات (للتشخيص ?barai=debug)

const eventCfg = (k) => config.events[k] || { tier: "contextual", cat: k.split(".")[0], imp: 0.5, urg: 0.5 };
const arr = (v) => (Array.isArray(v) ? v : [v]);

/** يختار الصيغة لمرشّح: نبرة السياق، عدم تكرار آخر 3، الاسم نادر. */
function chooseLine(lineKeys, d, ctx) {
  const nameOpen = !!(ctx.identity.firstName) && memory.nameGateOpen();
  const vars = Object.assign({}, d);
  if (!vars.name && nameOpen) vars.name = ctx.identity.firstName;
  for (const k of arr(lineKeys)) {
    if (!k || !LINES[k]) continue;
    const picked = pickLine(k, vars, { avoid: memory.lastLines(k), tones: ctx.tone && ctx.tone !== "normal" ? [ctx.tone] : [], preferName: nameOpen && Math.random() < config.name.preferChance });
    if (picked) return Object.assign(picked, { lineKey: k });
  }
  return null;
}

function buildCandidate(eventKey, d, ctx) {
  const rule = RULES[eventKey];
  const ec = eventCfg(eventKey);
  const keys = rule.line(d, ctx);
  if (!keys) return null;
  const picked = chooseLine(keys, d, ctx);
  if (!picked) return null;
  const idPart = rule.id ? rule.id(d) : "";
  return {
    event: eventKey, rule, cat: ec.cat, tier: ec.tier, imp: ec.imp, urg: ec.urg, flow: !!ec.flow,
    kind: rule.kind === "moment" ? "moment" : "bubble",
    cdKey: eventKey + (idPart ? ":" + idPart : ""),
    critical: ec.tier === "critical", manual: !!rule.manual,
    ignoreFocus: rule.manual ? true : rule.ignoreFocus,
    isNew: !!d.commit,
    phrase: !!rule.compoundable, data: d, picked, tries: 0
  };
}

/* ============================================================
   النافذة والتحكيم
   ============================================================ */
function enqueue(c, immediate) {
  queue = queue.filter((x) => x.cdKey !== c.cdKey).concat(c);   // نفس الموقف مرتين ⇒ آخر نسخة
  if (!winStart) winStart = Date.now();
  if (immediate || c.critical || c.manual || c.flow) { flush(); return; }
  scheduleFlush();
}

function scheduleFlush() {
  if (winTimer) clearTimeout(winTimer);
  const t = Date.now();
  let wait = Math.max(0, winStart + config.windowMs - t);
  if (settled) wait = Math.min(wait, config.settleMs);
  wait = Math.min(wait, Math.max(0, winStart + config.maxHoldMs - t));
  winTimer = setTimeout(flush, wait);
}

function flush() {
  if (winTimer) { clearTimeout(winTimer); winTimer = null; }
  if (flushing) return;
  flushing = true;
  try {
    const cands = queue; queue = []; winStart = 0;
    if (!cands.length) return;
    const ctx = context.snapshot({ busyFlag });
    const env = { level: store.getLevel(), ss: store.session.get(), reducedToday: store.isReducedToday(), mem: memory, now: Date.now(), page: page() };
    const res = arbitrate(cands, ctx, env, config);
    record(res, ctx);

    res.deferred.forEach((c) => {
      c.tries++;
      if (c.tries > config.maxTries) return;
      if (c.critical && c.tries >= 2) c.overrideBusy = true;
      const id = setTimeout(() => { retryTimers.delete(id); try { enqueue(c, false); } catch (e) { /* تجاهل */ } }, config.retryMs);
      retryTimers.add(id);
    });

    if (res.winner) show(res.winner, res.compound ? res.second : null, ctx);
  } catch (e) { /* تجاهل */ } finally { flushing = false; }
}

function record(res, ctx) {
  try {
    decisions.push({ t: Date.now(), page: page(), tone: ctx.tone, log: res.log.map((x) => ({ event: x.event, status: x.status, reason: x.reason || null, score: x.score === undefined ? null : x.score })) });
    if (decisions.length > 30) decisions.shift();
  } catch (e) { /* تجاهل */ }
}

/* ============================================================
   العرض + commit + التقاط التفاعل
   ============================================================ */
const compoundKey = (a, b) => "compound." + [a.cat, b.cat].sort().join("+");

function actionOf(c) {
  const d = c.data || {};
  return d.href && d.actionLabel ? { label: d.actionLabel, href: d.href } : null;
}

function commit(c, counts, ctx, now) {
  try {
    const d = c.data || {};
    if (d.commit && d.commit.group) store.markSeen(d.commit.group, d.commit.ids || []);     // «شوهد» فقط حين تظهر الرسالة فعلًا
    if (c.picked) memory.pushLine(c.picked.lineKey, c.picked.index);
    if (counts) {
      memory.recordShown(c.cat, now);
      memory.markKey(c.cdKey, now);
      store.markShown(c.cdKey);
    }
    memory.noteMessage(!!(c.picked && c.picked.usedName));
    /* ما قاله برعي ⇒ يُتابَع لاحقًا */
    if (c.event === "exam.new") (d.ids || [d.id]).filter(Boolean).forEach((id) => memory.hint("exam", id, { title: d.title || "" }));
    if (c.event === "announce.unread") memory.hint("announce", "unread", { n: d.count || 0 });
    if (c.event === "announce.allRead") memory.clearHint("announce", "unread");
    if (c.event === "announce.onPage") memory.clearHint("announce", "unread");
  } catch (e) { /* تجاهل */ }
}

function show(c, second, ctx) {
  const now = Date.now();
  const rule = c.rule;
  let text = c.picked.text, mood = c.picked.mood;
  let action = actionOf(c), secondary = null;
  let merged = null;

  if (second) {
    const ck = compoundKey(c, second);
    const cp = LINES[ck] ? chooseLine(ck, {}, ctx) : null;
    if (cp) {
      merged = second;
      text = cp.text; mood = c.picked.mood || cp.mood;
      const a2 = actionOf(second);
      if (!action && a2) { action = a2; } else if (a2 && action) secondary = a2;
      c.picked = Object.assign({}, c.picked, { lineKey: cp.lineKey, index: cp.index, usedName: cp.usedName, text });
    }
  }

  const counts = !c.critical && !c.manual;
  const common = {
    text, mood, key: c.cdKey, action, secondary,
    onInteract: () => { store.session.setClosedRun(0); store.session.set("ignoredRun", 0); },
    onAction: () => {
      store.session.setClosedRun(0); store.session.set("ignoredRun", 0);
      store.session.bump("acted");
      if (counts) { memory.recordAction(c.cat); if (merged) memory.recordAction(merged.cat); }
    },
    onTimeout: () => {
      if (rule.kind === "moment") return;     // اللحظات الاحتفالية لا تُعدّ «تجاهلًا»
      // اختفت وحدها = لم تُغلق (تنكسر سلسلة الإغلاق) لكن تُحسب «تجاهلًا»
      store.session.setClosedRun(0);
      store.session.set("ignoredRun", (Number(store.session.get().ignoredRun) || 0) + 1);
      if (counts) memory.recordTimeout(c.cat);
    },
    onDismiss: () => { /* اختفت بالتمرير: لا تُحتسب إغلاقًا ولا تجاهلًا */ },
    onClose: (why) => {
      if (rule.kind === "moment") ui.hideMoment(); else ui.hideBubble(why);
      store.session.set("ignoredRun", 0);
      const run = (Number(store.session.get().closedRun) || 0) + 1;   // مصدر واحد: sessionStorage
      store.session.setClosedRun(run);
      if (counts) { memory.recordClosed(c.cat, Date.now()); if (merged) memory.recordClosed(merged.cat, Date.now()); }
      if (run >= 2) store.reduceToday();
    }
  };

  if (rule.kind === "moment") ui.showMoment({ ...common, confetti: rule.confetti && !reduceMotion() });
  else {
    const el = ui.showBubble({ ...common, ttl: rule.sticky ? 3600000 : undefined, sticky: !!rule.sticky });
    if (!el) {                                   // المكان كله محجوب بعناصر مهمة (حقول/أزرار): تُؤجَّل ولا تُحتسب ظاهرة
      [c, merged].filter(Boolean).forEach((x) => { x.tries = (x.tries || 0) + 1; if (x.tries <= config.maxTries) { const id = setTimeout(() => { retryTimers.delete(id); try { enqueue(x, false); } catch (e) { /* تجاهل */ } }, config.retryMs); retryTimers.add(id); } });
      try { decisions[decisions.length - 1].shown = { event: c.event, blocked: "avoid" }; } catch (e) { /* تجاهل */ }
      return;
    }
    if (rule.sticky) stickyEl = el;
  }

  commit(c, counts, ctx, now);
  if (merged) commit(merged, counts, ctx, now);
  if (counts) {
    if (rule.kind === "moment") store.session.bump("moments");
    else { store.session.bump("bubbles"); store.session.bumpPage(page()); }
    store.session.setLastAt(now);
  }
  try { decisions[decisions.length - 1].shown = { event: c.event, merged: merged ? merged.event : null, text }; } catch (e) { /* تجاهل */ }
}

/* ============================================================
   الواجهة العامة
   ============================================================ */
export const brain = {
  setBusy(v) { busyFlag = !!v; if (busyFlag) ui.hideAll(); },

  /** يُرجع {text, mood} لأحداث inline، وإلا يضع مرشّحًا في الطابور ويعيد null. */
  notify(eventKey, data = {}) {
    try {
      const rule = RULES[eventKey];
      if (!rule) return null;
      context.init();
      const ctx = context.snapshot({ busyFlag });
      if (eventKey === "net.back" && stickyEl) { ui.hideBubble("net-back"); stickyEl = null; }
      if (rule.kind === "inline") {
        const keys = rule.line(data, ctx);
        const picked = keys ? chooseLine(keys, data, ctx) : null;
        if (picked) memory.pushLine(picked.lineKey, picked.index);
        if (eventKey === "exam.result") {
          if (!data.pending && data.total > 0 && isFinite(Number(data.score))) memory.pushScore((data.score / data.total) * 100);
          if (data.examId) memory.clearHint("exam", data.examId);
        }
        return picked;
      }
      const c = buildCandidate(eventKey, data, ctx);
      if (c) enqueue(c, false);
      return null;
    } catch (e) { return null; }
  },

  /** الصفحة انتهت من تحميل بياناتها: ننهي نافذة التحكيم بعد settleMs بدل الانتظار الكامل. */
  settle() {
    try { settled = true; if (queue.length) scheduleFlush(); } catch (e) { /* تجاهل */ }
  },

  /** حقائق ظاهرة في الصفحة (للسياق). */
  facts(f) { try { return context.facts(f); } catch (e) { return {}; } },

  /** جملة جاهزة للعرض المدمج (حالات فارغة…) دون ميزانية. */
  line(key, vars = {}) {
    try { const ctx = context.snapshot({ busyFlag }); return chooseLine(key, vars, ctx); } catch (e) { return null; }
  },

  /** موقف محدد مباشرة (يمر بنفس القواعد). */
  say(key, data = {}) {
    try {
      const evt = Object.keys(RULES).find((k) => { try { return arr(RULES[k].line(data, {})).includes(key); } catch (e) { return false; } }) || key;
      return this.notify(evt, data);
    } catch (e) { return null; }
  },

  mood(name) { try { return ui.setMood(name); } catch (e) { return false; } },
  dismiss() { try { ui.hideAll(); } catch (e) { /* تجاهل */ } },
  hasEvent(k) { return !!RULES[k]; },
  debug() { return { decisions: decisions.slice(), queue: queue.map((c) => c.event), memory: memory.raw() }; },
  /** للاختبارات: تفريغ الطابور فورًا. */
  flushNow() { flush(); }
};
