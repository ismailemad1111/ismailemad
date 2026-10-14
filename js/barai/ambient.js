/**
 * ambient.js — حضور برعي الهادئ: تعبيرات بلا نص ولا فقاعة ولا احتساب في ميزانية الظهور.
 * ------------------------------------------------------------------
 * - يُركَّب داخل عنصر موجود في الصفحة (مربع أيقونة الترويسة، أو حاوية فارغة) بدل أي نص.
 * - المستوى «صامت» ⇒ لا يظهر شيء (تبقى الأيقونة الأصلية).
 * - مع «تقليل الحركة» يتوقف التحريك بقواعد mascot.css (التعبير يتبدّل فقط).
 * - كل شيء محصّن: الفشل ⇒ تبقى الصفحة كما هي.
 */
import { mascotEl } from "../mascot.js";
import { store } from "./store.js";
import { context } from "./context.js";

const hostOf = (h) => {
  try { return typeof h === "string" ? (document.getElementById(h) || document.querySelector(h)) : h; } catch (e) { return null; }
};
const svgOf = (el) => el && el.querySelector(":scope > .mascot");

export const ambient = {
  /** يركّب برعي داخل host (id أو محدّد CSS أو عنصر). يعيد العنصر أو null. */
  mount(host, mood = "wave") {
    try {
      const el = hostOf(host);
      if (!el) return null;
      if (store.getLevel() === "silent") return null;
      const old = svgOf(el);
      if (old) { old.replaceWith(mascotEl(mood)); }
      else { el.classList.add("barai-ambient-on"); el.appendChild(mascotEl(mood)); }
      el.dataset.baraiAmbient = mood;
      return el;
    } catch (e) { return null; }
  },

  /** يبدّل التعبير إن كان برعي مُركَّبًا في host (وإلا لا شيء). */
  set(host, mood) {
    try {
      const el = hostOf(host);
      if (!el || !svgOf(el)) return false;
      if (el.dataset.baraiAmbient === mood) return true;
      svgOf(el).replaceWith(mascotEl(mood));
      el.dataset.baraiAmbient = mood;
      return true;
    } catch (e) { return false; }
  },

  /** يعيد التعبير الحالي أو null. */
  mood(host) { try { const el = hostOf(host); return el && svgOf(el) ? el.dataset.baraiAmbient || null : null; } catch (e) { return null; } },

  /** نعاس بعد ms من عدم اللمس (الافتراضي 60 ثانية)، ويستيقظ عند أول لمسة. يعيد دالة إيقاف. */
  sleepOnIdle(host, { ms = 60000, awake = "wave", sleepy = "sleepy", everyMs = 4000 } = {}) {
    try {
      const el = hostOf(host);
      if (!el) return () => {};
      const wake = () => { if (el.dataset.baraiAmbient === sleepy) ambient.set(el, awake); };
      const evs = ["pointerdown", "touchstart", "keydown", "wheel", "scroll"];
      evs.forEach((e) => window.addEventListener(e, wake, { passive: true }));
      const timer = setInterval(() => {
        try {
          if (document.visibilityState !== "visible" || !el.isConnected || store.getLevel() === "silent") return;
          if (context.lastInputAgo() >= ms && el.dataset.baraiAmbient === awake) ambient.set(el, sleepy);
        } catch (e) { /* تجاهل */ }
      }, everyMs);
      return () => { clearInterval(timer); evs.forEach((e) => window.removeEventListener(e, wake)); };
    } catch (e) { return () => {}; }
  }
};
