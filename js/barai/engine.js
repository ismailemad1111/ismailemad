/**
 * engine.js — محرك القرار (نقي بلا DOM، يُختبر في Node).
 * ------------------------------------------------------------------
 * بدل «أول حدث يصل يستهلك الفقاعة»: الأحداث تدخل طابور مرشّحين لنافذة قصيرة، ثم:
 *   1) بوّابات (gates): صامت، ميزانية، تهدئة، صفحة واحدة، نفس الموقف خلال 24 ساعة، الطالب مشغول…
 *   2) نقاط:  الدرجة × الأهمية × الإلحاح × ملاءمة السياق × الجِدّة × وزن الفئة المتكيّف
 *             − الإرهاق − تكلفة المقاطعة
 *   3) اختيار مرشّح واحد (أو دمج أقوى اثنين في رسالة واحدة) وتسجيل سبب رفض البقية.
 * لا يعرف المحرك شيئًا عن الواجهة؛ brain.js ينفّذ القرار.
 */
import { config as defaultConfig } from "./config.js";

/* ============================================================
   ملاءمة السياق: كل دالة تعيد رقمًا ≥ 0 (1 = محايد، 0 = غير مناسب إطلاقًا)
   ============================================================ */
export const RELEVANCE = {
  "time.lateNight": (c) => (c.isNight ? 1.2 : 0),
  "time.morning":   (c) => (c.partOfDay === "morning" ? 1 : 0),
  "time.friday":    (c) => (c.dow === 5 && !c.isNight ? 1 : 0),
  "lesson.returning": (c, d, cfg) => (c.daysAway >= cfg.context.returningAwayDays ? Math.min(1.3, 0.9 + c.daysAway / 20) : 0),
  "planner.empty":  (c) => (c.isNight ? 0.5 : 1),
  "exam.new":       (c) => (c.isNight ? 0.75 : 1),
  "event.live":     (c) => (c.isNight ? 0.6 : 1),
  "announce.allRead": (c) => (c.isNew ? 0.5 : 1),
  "bank.afford":    (c, d) => (d && d.balance > 0 ? 1 : 0),
  "bank.near":      (c, d) => (d && d.gap > 0 ? 1 : 0),
  "bank.welcome":   (c) => (c.visits <= 3 ? 1.1 : 0.7),
  "bank.poor":      (c) => (c.isNight ? 0 : 1),
  "streak.milestone": (c) => (c.isNight ? 0.8 : 1)
};

/** نبرة الجملة المناسبة للسياق: تؤثر في اختيار الصيغة (لا في المحتوى الحقيقي). */
export function toneOf(ctx) {
  if (!ctx) return "normal";
  if (ctx.net && ctx.net.slow) return "slow";
  if (ctx.isNight) return "night";
  if (ctx.scores && ctx.scores.last !== null && ctx.scores.lowRun >= 1 && ctx.sessionPage !== "bank.html") return "gentle";
  if (ctx.isNew || ctx.daysAway >= 3) return "welcome";
  return "normal";
}

/* ============================================================
   البوابات
   ============================================================ */

/** حدود الظهور الحالية (الميزانية التكيّفية + التهدئة). */
export function limitsFor(level, ss, reducedToday, cfg = defaultConfig) {
  const key = level === "many" ? "many" : "few";
  const b = cfg.budget[key];
  let budget = b.base;
  if ((ss.acted || 0) >= cfg.adaptive.actedToGrow) budget = Math.min(b.max, budget + cfg.adaptive.grow);
  if ((ss.ignoredRun || 0) >= cfg.adaptive.ignoredToShrink) budget = Math.max(b.min, Math.min(budget, cfg.adaptive.ignoredCap));
  let cooldown = cfg.cooldownMs[key];
  if (reducedToday) { budget = Math.min(budget, cfg.budget.reducedTo); cooldown *= cfg.cooldownMs.reducedMul; }
  return { budget, cooldown };
}

/** لماذا لا يمكن مقاطعة الطالب الآن؟ null = يمكن. */
export function busyReason(rule, ctx) {
  if (rule.overrideBusy) return null;   // حرج وتأجّل مرتين: يُعرض رغم الانشغال
  const b = (ctx && ctx.busy) || {};
  if (b.flag) return "busy:exam";
  if (b.media) return "busy:media";
  if (b.overlay) return "busy:transition";
  if (b.typing) {
    if (rule.ignoreFocus === true) return null;
    if (rule.ignoreFocus === "empty" && !b.typingHasValue) return null;
    return "busy:typing";
  }
  return null;
}

/**
 * بوابات المرشّح. يعيد سبب الرفض أو null.
 * env: {level, ss, reducedToday, mem, now, page}
 */
export function gate(c, ctx, env, cfg = defaultConfig) {
  const { level, ss, reducedToday, mem, now, page } = env;
  if (level === "silent") return "silent";
  if (c.manual) return null;
  if (c.tier !== "critical") {
    if (mem.penalized(c.cat, now) && !c.flow) return "penalized";
    const lim = limitsFor(level, ss, reducedToday, cfg);
    if (c.kind === "moment") { if ((ss.moments || 0) >= cfg.momentsMax) return "moments-cap"; }
    else {
      if ((ss.bubbles || 0) >= lim.budget) return "budget";
      if (!c.flow && (((ss.pages || {})[page]) || 0) >= cfg.pageLimit) return "page-limit";
    }
    if (!c.flow && ss.lastAt && now - ss.lastAt < lim.cooldown) return "cooldown";
    const lastKey = mem.keyShownAt(c.cdKey);
    const cd = c.cooldownMs || cfg.sameKeyMs;
    if (lastKey && now - lastKey < cd) return "same-key";
  }
  return null;
}

/* ============================================================
   النقاط
   ============================================================ */

export function interruptCost(ctx, cfg = defaultConfig) {
  const k = cfg.interrupt;
  let v = k.base;
  if (ctx.scrollAgoMs !== undefined && ctx.scrollAgoMs < k.scrollMs) v += k.scrolling;
  if (ctx.typingAgoMs !== undefined && ctx.typingAgoMs < k.typingMs) v += k.typing;
  if (ctx.idleMs !== undefined && ctx.idleMs >= k.idleMs) v += k.idleBonus;
  if (ctx.pageAgeMs !== undefined && ctx.pageAgeMs < k.landedMs) v += k.justLanded;
  return Math.max(0, v);
}

/** نقاط مرشّح واحد مع تفصيل الأجزاء (للتشخيص). */
export function scoreCandidate(c, ctx, mem, cfg = defaultConfig, now = Date.now()) {
  const tierBase = (cfg.tiers[c.tier] || cfg.tiers.contextual).base;
  const relFn = RELEVANCE[c.event];
  let rel = relFn ? relFn(ctx, c.data || {}, cfg) : 1;
  if (typeof c.relevance === "number") rel *= c.relevance;
  if (ctx.net && ctx.net.slow && c.tier !== "critical") rel *= 0.85;
  const nov = c.isNew ? 1.15 : (mem.keyShownAt(c.cdKey) ? 0.9 : 1.05);
  const mult = mem.catMult(c.cat, now);
  const fat = mem.fatigue(c.cat, now);
  const intr = interruptCost(ctx, cfg);
  const base = tierBase * c.imp * c.urg * rel * nov * mult;
  const score = base - fat - intr;
  return { score: Math.round(score * 100) / 100, parts: { tierBase, imp: c.imp, urg: c.urg, rel: Math.round(rel * 100) / 100, nov, mult, fatigue: fat, interrupt: intr } };
}

/* ============================================================
   التحكيم
   ============================================================ */

/**
 * يختار من المرشّحين.
 * @param {Array} cands  مرشّحون: {event, key, cat, tier, kind, imp, urg, cdKey, data, phrase?, flow?, ignoreFocus?, ...}
 * @returns {{winner, second, compound, log, deferred}}
 */
export function arbitrate(cands, ctx, env, cfg = defaultConfig) {
  const log = [];
  const live = [];
  const deferred = [];      // مشغول الآن (كتابة/فيديو/اختبار…): يُعاد لاحقًا ولا يُسقَط
  const now = env.now;

  for (const c of cands) {
    const g = gate(c, ctx, env, cfg);
    if (g) { log.push({ event: c.event, status: "rejected", reason: g }); continue; }
    const b = busyReason(c, ctx);
    if (b) { deferred.push(c); log.push({ event: c.event, status: "deferred", reason: b }); continue; }
    const sc = scoreCandidate(c, ctx, env.mem, cfg, now);
    const row = { event: c.event, score: sc.score, parts: sc.parts, c };
    if (sc.score < cfg.minScore) { log.push({ event: c.event, status: "rejected", reason: "below-min", score: sc.score, parts: sc.parts }); continue; }
    live.push(row);
  }

  /* فئة واحدة تمثّل نفسها بأقوى مرشّح (لا فقاعتين متشابهتين) */
  live.sort((a, b) => b.score - a.score);
  const seenCat = new Set();
  const uniq = [];
  for (const r of live) {
    if (seenCat.has(r.c.cat)) { log.push({ event: r.c.event, status: "rejected", reason: "same-category", score: r.score }); continue; }
    seenCat.add(r.c.cat);
    uniq.push(r);
  }
  if (!uniq.length) return { winner: null, second: null, compound: false, log, deferred };

  const top = uniq[0];
  let second = null;
  if (cfg.compound.enabled && uniq.length > 1 && top.c.kind === "bubble") {
    const s = uniq[1];
    const ok = s.c.kind === "bubble" && top.c.phrase && s.c.phrase
      && top.c.tier === "actionable" && s.c.tier === "actionable"
      && s.score >= cfg.compound.minScore && s.score >= top.score * cfg.compound.minRatio
      ;
    if (ok) second = s;
  }
  uniq.forEach((r, i) => {
    if (i === 0) log.push({ event: r.c.event, status: "chosen", score: r.score, parts: r.parts, compoundWith: second ? second.c.event : null });
    else if (second && r === second) log.push({ event: r.c.event, status: "merged", score: r.score, parts: r.parts });
    else log.push({ event: r.c.event, status: "rejected", reason: "lower-score", score: r.score, parts: r.parts });
  });

  return { winner: top.c, second: second ? second.c : null, compound: !!second, log, deferred };
}
