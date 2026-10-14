/**
 * memory.js — ذاكرة برعي المحلية (تفضيلات الطالب وفعالية الرسائل).
 * ------------------------------------------------------------------
 * - كل شيء محلي في localStorage (أو ذاكرة الصفحة إن لم يتوفر). لا كتابة في Firestore.
 * - لا بيانات شخصية: فئات، أعداد، أوقات، نسب مئوية بلا أسماء، ومعرّفات حالة.
 * - الملف نقي (بلا DOM): يستقبل «محوّل تخزين» {read, write} فيُختبر في Node.
 *
 * يخزن:
 *   cats      فعالية كل فئة موقف (لا كل جملة): ظهرت/نُفّذ إجراؤها/أُغلقت/اختفت وحدها
 *   recent    آخر الظهورات (للإرهاق)
 *   lines     آخر 3 صيغ استُخدمت لكل موقف (منع التكرار عبر الجلسات)
 *   nameSince عدد الرسائل منذ آخر استخدام للاسم (ليبقى الاسم نادرًا)
 *   scores    آخر الدرجات المئوية (بلا أسماء) لاتجاه التحسّن
 *   follow    «ما قاله برعي» لتفادي التكرار والمتابعة (امتحان نُبّه عليه، رسائل لُمّح لها)
 *   keys      آخر ظهور لكل مفتاح (تهدئة مخصصة أطول من 24 ساعة حيث يلزم)
 *   data      حالة صفحات (مثل حالات طلبات البنك التي رآها الطالب)
 *   visits    عدد الزيارات وأيامها (تواريخ فقط) — «أيام متتالية على هذا الجهاز»
 */
import { config as defaultConfig } from "./config.js";

const DAY = 86400000;

/** تاريخ محلي YYYY-MM-DD */
export function dayKeyOf(ms) {
  const d = new Date(ms);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function createMemory(adapter, cfg = defaultConfig) {
  const load = () => {
    let m;
    try { m = adapter.read(); } catch (e) { m = null; }
    return m && typeof m === "object" ? m : {};
  };
  const save = (m) => { try { adapter.write(m); } catch (e) { /* بدون تخزين */ } };
  const edit = (fn) => { const m = load(); const r = fn(m); save(m); return r; };
  const catOf = (m, cat) => { m.cats = m.cats || {}; return (m.cats[cat] = m.cats[cat] || { shown: 0, acted: 0, closed: 0, timeout: 0, penaltyUntil: 0 }); };

  const api = {
    raw: load,

    /* ===== فعالية الفئات ===== */
    cat(cat) { const m = load(); return Object.assign({ shown: 0, acted: 0, closed: 0, timeout: 0, penaltyUntil: 0 }, (m.cats || {})[cat]); },

    recordShown(cat, now = Date.now()) {
      edit((m) => {
        catOf(m, cat).shown++;
        m.recent = (m.recent || []).concat({ cat, t: now }).slice(-cfg.memory.maxRecent);
      });
    },
    recordAction(cat) { edit((m) => { catOf(m, cat).acted++; }); },
    recordTimeout(cat) { edit((m) => { catOf(m, cat).timeout++; }); },
    /** إغلاق بـ ×: إن تكرر بنسبة عالية تُخفَّض أوزان الفئة وتُمنع فترة. */
    recordClosed(cat, now = Date.now()) {
      edit((m) => {
        const c = catOf(m, cat);
        c.closed++;
        const rate = c.shown > 0 ? c.closed / c.shown : 0;
        if (c.closed >= cfg.memory.closedToPenalize && rate >= cfg.memory.closedRate) c.penaltyUntil = now + cfg.memory.penaltyMs;
      });
    },
    penalized(cat, now = Date.now()) { return api.cat(cat).penaltyUntil > now; },
    /** مضاعف وزن الفئة: <1 إن تُجوهلت كثيرًا، >1 إن تفاعل معها الطالب. */
    catMult(cat, now = Date.now()) {
      const c = api.cat(cat);
      if (c.penaltyUntil > now) return cfg.memory.penaltyMult;
      if (c.acted >= cfg.memory.boostActed && c.shown > 0 && c.acted / c.shown >= cfg.memory.boostRate) return cfg.memory.boostMult;
      return 1;
    },
    /** إرهاق الفئة + الإرهاق العام (يُخصم من نقاط المرشّح). */
    fatigue(cat, now = Date.now()) {
      const m = load();
      const f = cfg.fatigue;
      let v = 0;
      (m.recent || []).forEach((r) => {
        if (r.cat === cat && now - r.t <= f.categoryWindowMs) v += f.perCategory;
        if (now - r.t <= f.globalWindowMs) v += f.global;
      });
      return Math.min(f.max, v);
    },

    /* ===== تهدئة مخصصة لكل مفتاح (24 ساعة افتراضيًا أو أطول) ===== */
    keyShownAt(key) { return Number(((load().keys || {})[key])) || 0; },
    markKey(key, now = Date.now()) {
      edit((m) => {
        m.keys = m.keys || {};
        m.keys[key] = now;
        const ks = Object.keys(m.keys);
        if (ks.length > 120) ks.sort((a, b) => m.keys[a] - m.keys[b]).slice(0, ks.length - 120).forEach((k) => delete m.keys[k]);
      });
    },

    /* ===== عدم تكرار الصيغ عبر الجلسات ===== */
    lastLines(key) { return ((load().lines || {})[key]) || []; },
    pushLine(key, idx) {
      edit((m) => {
        m.lines = m.lines || {};
        const list = (m.lines[key] || []).filter((i) => i !== idx).concat(idx);
        m.lines[key] = list.slice(-cfg.memory.lastLinesPerKey);
      });
    },

    /* ===== الاسم الأول نادر (مرة تقريبًا كل N رسائل) ===== */
    nameGateOpen() { return (Number(load().nameSince) || 0) >= cfg.name.everyNth - 1; },
    noteMessage(usedName) { edit((m) => { m.nameSince = usedName ? 0 : (Number(m.nameSince) || 0) + 1; }); },

    /* ===== الدرجات المحلية (نسب فقط) واتجاهها ===== */
    pushScore(pct, now = Date.now()) {
      if (!isFinite(pct)) return;
      edit((m) => { m.scores = (m.scores || []).concat({ p: Math.round(pct), t: now }).slice(-10); });
    },
    scores() { return (load().scores || []).map((s) => s.p); },
    /** {trend:'up'|'down'|'flat'|null, lowRun, last, n} */
    scoreTrend() {
      const s = api.scores();
      const out = { trend: null, lowRun: 0, last: s.length ? s[s.length - 1] : null, n: s.length };
      for (let i = s.length - 1; i >= 0 && s[i] < cfg.trend.lowPct; i--) out.lowRun++;
      if (s.length >= 3) {
        const w = s.slice(-cfg.trend.window);
        const h = Math.floor(w.length / 2);
        const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
        const d = avg(w.slice(w.length - h)) - avg(w.slice(0, h));
        out.trend = d >= cfg.trend.delta ? "up" : d <= -cfg.trend.delta ? "down" : "flat";
      }
      return out;
    },

    /* ===== المتابعة (ما قاله برعي وما فعله الطالب بعده) ===== */
    hint(kind, id, extra) { edit((m) => { m.follow = m.follow || {}; const f = (m.follow[kind] = m.follow[kind] || {}); f[String(id)] = Object.assign({ t: Date.now() }, extra || {}); const ks = Object.keys(f); if (ks.length > 40) ks.sort((a, b) => f[a].t - f[b].t).slice(0, ks.length - 40).forEach((k) => delete f[k]); }); },
    hinted(kind, id) { return ((load().follow || {})[kind] || {})[String(id)] || null; },
    clearHint(kind, id) { edit((m) => { if (m.follow && m.follow[kind]) delete m.follow[kind][String(id)]; }); },
    anyHint(kind) { return Object.keys(((load().follow || {})[kind]) || {}).length > 0; },

    /* ===== حالة صفحات (مثل آخر حالة طلبات رآها الطالب) ===== */
    data(name) { return ((load().data || {})[name]) || null; },
    setData(name, value) { edit((m) => { m.data = m.data || {}; m.data[name] = value; }); },

    /* ===== الزيارات (محليًا) ===== */
    /** يُستدعى مرة لكل جلسة متصفح. يعيد {visits, awayDays, prevLast}. */
    startSession(now = Date.now()) {
      return edit((m) => {
        const v = (m.visits = m.visits || { n: 0, days: [], last: 0 });
        const prev = v.last || 0;
        v.n++;
        const dk = dayKeyOf(now);
        if (!v.days.includes(dk)) v.days = v.days.concat(dk).slice(-60);
        v.last = now;
        const away = prev ? Math.floor((now - prev) / DAY) : 0;
        return { visits: v.n, awayDays: away, prevLast: prev };
      });
    },
    visits() { return Number(((load().visits) || {}).n) || 0; },
    /** أيام متتالية على هذا الجهاز تنتهي اليوم (لا علاقة لها بعدّاد المنظّم). */
    consecutiveDays(now = Date.now()) {
      const days = new Set(((load().visits) || {}).days || []);
      let n = 0;
      for (let i = 0; i < 60; i++) {
        const d = new Date(now); d.setDate(d.getDate() - i);   // تاريخ محلي (آمن مع تغيير التوقيت الصيفي)
        if (days.has(dayKeyOf(d.getTime()))) n++; else break;
      }
      return n;
    }
  };
  return api;
}
