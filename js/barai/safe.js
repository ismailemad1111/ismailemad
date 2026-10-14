/**
 * safe.js — واجهة آمنة لبرعي تستوردها صفحات المنصة.
 * تحمّل برعي بـ import() ديناميكي: إن فشل التحميل أو أي استدعاء تبقى الصفحة تعمل (كل شيء no-op).
 */
let mod = null;
const ready = import("./index.js").then((m) => { mod = m.barai; return mod; }).catch(() => null);
const call = (name, args, fallback) => { try { return mod ? mod[name](...args) : fallback; } catch (e) { return fallback; } };
const later = (name, args) => ready.then((m) => { try { return m ? m[name](...args) : null; } catch (e) { return null; } }).catch(() => null);

export const barai = {
  /** يُرسل حدثًا (لا ينتظر). */
  notify: (k, d) => { later("notify", [k, d]); },
  say: (k, d) => { later("say", [k, d]); },
  busy: (v) => { later("busy", [v]); },
  mood: (m) => { later("mood", [m]); },
  /** يعيد Promise<{text,mood}|null> لأحداث inline. */
  inlineLine: (k, d) => ready.then((m) => { try { return m ? m.notify(k, d) : null; } catch (e) { return null; } }).catch(() => null),
  /** يضيف برعي داخل حاوية. */
  inline: (c, k, o) => { later("inline", [c, k, o]); },
  empty: (el, k) => { later("empty", [el, k]); },
  /** مؤشر تحميل طويل؛ يعيد دالة إيقاف فورًا. */
  loading: (host) => { let stop = () => {}; let off = false; ready.then((m) => { if (m && !off) { try { stop = m.loading(host); } catch (e) { /* تجاهل */ } } }); return () => { off = true; try { stop(); } catch (e) { /* تجاهل */ } }; },
  fresh: (group, ids) => ready.then((m) => { try { return m ? m.fresh(group, ids) : []; } catch (e) { return []; } }).catch(() => []),
  baseline: (group, ids) => ready.then((m) => { try { return m ? m.baseline(group, ids) : { first: true, ids: [] }; } catch (e) { return { first: true, ids: [] }; } }).catch(() => ({ first: true, ids: [] })),
  balance: (now) => ready.then((m) => { try { return m ? m.balance(now) : { prev: null, now }; } catch (e) { return { prev: null, now }; } }).catch(() => ({ prev: null, now })),
  /** الصفحة انتهت من تحميل بياناتها (ينهي نافذة التحكيم مبكرًا). */
  settle: () => { later("settle", []); },
  /** حقائق ظاهرة في الصفحة للسياق. */
  facts: (f) => { later("facts", [f]); },
  /** برعي الهادئ: ambientMount(host, mood) يركّبه، ambient(host, mood) يبدّل التعبير، ambientSleep(host) نعاس بعد 60ث خمول. */
  ambientMount: (h, m) => { later("ambientMount", [h, m]); },
  ambient: (h, m) => { later("ambient", [h, m]); },
  ambientSleep: (h, o) => { later("ambientSleep", [h, o]); },
  mascotReady: ready
};
