/**
 * index.js — نقطة تهيئة برعي. تُضاف بسطر واحد لكل صفحة طالب:
 *   <link rel="stylesheet" href="css/barai.css" />
 *   <script type="module" src="js/barai/index.js"></script>
 * واجهة الاستخدام: import { barai } from "./barai/index.js"
 * فشل برعي لا يكسر الصفحة: كل دالة محصّنة، والاستيراد الفاشل يُتعامل معه من الصفحات بـ import ديناميكي.
 */
import { brain } from "./brain.js";
import { ui } from "./ui.js";
import { store } from "./store.js";
import { ambient } from "./ambient.js";
import { mascotEl } from "../mascot.js";

const isAdmin = /\/admin(\/|$)/.test(location.pathname);
const base = (location.pathname.split("/").pop() || "index.html");
const safe = (fn, fb = null) => (...a) => { try { return fn(...a); } catch (e) { return fb; } };

export const barai = {
  notify: safe((k, d) => (isAdmin ? null : brain.notify(k, d))),
  say: safe((k, d) => (isAdmin ? null : brain.say(k, d))),
  mood: safe((m) => brain.mood(m), false),
  line: safe((k, v) => brain.line(k, v)),
  busy: safe((v) => brain.setBusy(v)),
  dismiss: safe(() => brain.dismiss()),
  level: { get: safe(() => store.getLevel(), "few"), set: safe((l) => store.setLevel(l)) },
  /** يضيف برعي وجملة داخل حاوية (حالة فارغة / تحميل). */
  inline: safe((container, key, opts = {}) => {
    if (!container) return null;
    const l = brain.line(key, opts.vars || {});
    return l ? ui.inline(container, { text: l.text, mood: opts.mood || l.mood, size: opts.size }) : null;
  }),
  /** يضيف برعي + جملة متغيرة أعلى حالة فارغة موجودة (مرة واحدة لكل عنصر). */
  empty: safe((el, key) => {
    if (!el || el.dataset.barai || isAdmin) return null;
    const l = brain.line(key || "empty.generic");
    if (!l) return null;
    el.dataset.barai = "1";
    const row = ui.inline(document.createElement("div"), { text: l.text, mood: l.mood });
    el.insertBefore(row, el.firstChild);
    return row;
  }),
  /** مؤشر تحميل طويل: بعد 3 ثوانٍ يظهر برعي صغيرًا داخل host. يعيد دالة إيقاف. */
  loading: safe((host) => {
    if (!host || isAdmin) return () => {};
    let node = null;
    const t = setTimeout(() => { node = barai.inline(host, "loading.long", { size: "xs" }); }, 3000);
    return () => { clearTimeout(t); if (node) node.remove(); };
  }, () => {}),
  /** معرّفات لم يرها الطالب من قبل على هذا الجهاز. لا تُعلَّم «مرئية» هنا: تُعلَّم فقط حين تظهر الرسالة فعلًا
   *  (مرّر commit:{group,ids} داخل بيانات notify). */
  fresh: safe((group, ids) => (ids || []).map(String).filter((i) => !store.hasSeen(group, i)), []),
  /** خط أساس أول زيارة: أول استدعاء لمجموعة يعلّم كل المعرّفات «مرئية» بصمت ويعيد first:true بلا معرّفات؛
   *  بعدها يعيد المعرّفات الجديدة فقط (لا تُعلَّم مرئية إلا حين تظهر الرسالة عبر commit). */
  baseline: safe((group, ids) => {
    const list = (ids || []).map(String);
    if (!store.hasSeen("base", group)) { store.markSeen("base", [group]); store.markSeen(group, list); return { first: true, ids: [] }; }
    return { first: false, ids: list.filter((i) => !store.hasSeen(group, i)) };
  }, { first: true, ids: [] }),
  /** الصفحة انتهت من تحميل بياناتها ⇒ تُنهى نافذة التحكيم بعد قليل. */
  settle: safe(() => brain.settle()),
  /** حقائق ظاهرة في الصفحة للسياق (رصيد، عدد امتحانات…). */
  facts: safe((f) => brain.facts(f), {}),
  /** رصيد البنك: يعيد {prev, now} ويحفظ الجديد. */
  balance: safe((now) => { const prev = store.getBalance(); store.setBalance(now); return { prev, now }; }, { prev: null, now: null }),
  /** برعي الهادئ (بلا نص) داخل عنصر: ambientMount(host, mood) ثم ambient(host, mood) لتبديل التعبير. */
  ambientMount: safe((host, mood) => (isAdmin ? null : ambient.mount(host, mood))),
  ambient: safe((host, mood) => (isAdmin ? false : ambient.set(host, mood)), false),
  ambientSleep: safe((host, opts) => (isAdmin ? () => {} : ambient.sleepOnIdle(host, opts)), () => {}),
  mascotEl
};

function setupGlobal() {
  if (isAdmin) return;
  try { window.__barai = barai; } catch (e) { /* تجاهل */ }
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") barai.dismiss(); });
  window.addEventListener("offline", () => barai.notify("net.offline"));
  window.addEventListener("online", () => barai.notify("net.back"));
  if (navigator.onLine === false) barai.notify("net.offline");

  // مواقف الوقت والسياق: الرئيسية فقط، حسب ساعة الجهاز (بيانات حقيقية)
  if (base === "index.html" || base === "") {
    const last = store.getLastVisit();
    const now = new Date(), h = now.getHours();
    const ctxKey = last && Date.now() - last > 3 * 86400000 ? "lesson.returning"
      : h < 5 ? "time.lateNight" : now.getDay() === 5 ? "time.friday" : (h >= 5 && h < 10) ? "time.morning" : null;
    // يدخل نافذة التحكيم مع بيانات الصفحة (امتحان/إعلان) فيختار المحرّك الأهم بدل «أول من يصل»
    if (ctxKey) setTimeout(() => barai.notify(ctxKey), 1000);
    store.touchVisit();
  }
}
try { setupGlobal(); } catch (e) { /* تجاهل */ }
// لوحة التشخيص: فقط مع ?barai=debug
try { if (!isAdmin && /[?&]barai=debug\b/.test(location.search)) import("./debug.js").then((m) => (document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", () => m.mountDebug()) : m.mountDebug())).catch(() => {}); } catch (e) { /* تجاهل */ }
export default barai;
