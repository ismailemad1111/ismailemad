/**
 * debug.js — لوحة تشخيص برعي (تظهر فقط مع ?barai=debug في الرابط).
 * تعرض سبب قبول/رفض كل مرشّح (نقاط وأجزاؤها)، ذاكرة الفئات والإرهاق، وسياق الجلسة الحالي،
 * وتسمح بمسح الذاكرة. لا تُحمَّل في الاستخدام العادي ولا تغيّر سلوك برعي.
 */
import { config } from "./config.js";
import { brain } from "./brain.js";
import { context, memory } from "./context.js";
import { store } from "./store.js";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function render(root) {
  const d = brain.debug();
  const ctx = context.snapshot();
  const ss = store.session.get();
  const m = memory.raw();
  const rows = d.decisions.slice(-6).reverse().map((x) => {
    const lines = x.log.map((l) => `<li class="s-${esc(l.status)}"><b>${esc(l.event)}</b> — ${esc(l.status)}${l.reason ? " (" + esc(l.reason) + ")" : ""}${l.score !== null ? " · " + l.score : ""}</li>`).join("");
    const shown = x.shown ? `<div class="shown">ظهرت: ${esc(x.shown.event)}${x.shown.merged ? " + " + esc(x.shown.merged) : ""}${x.shown.blocked ? " (محجوبة: " + esc(x.shown.blocked) + ")" : ""}</div>` : "";
    return `<section><h4>${new Date(x.t).toLocaleTimeString("ar-EG")} · ${esc(x.page)} · نبرة: ${esc(x.tone)}</h4>${shown}<ul>${lines || "<li>لا مرشّحين</li>"}</ul></section>`;
  }).join("");
  const cats = Object.entries(m.cats || {}).map(([k, v]) => `${esc(k)}: ظهر ${v.shown} · نُفّذ ${v.acted} · أُغلق ${v.closed} · اختفى ${v.timeout}${v.penaltyUntil > Date.now() ? " · محظور" : ""}`).join("<br>") || "—";
  root.querySelector(".bd-body").innerHTML = `
    <p><b>الجلسة:</b> فقاعات ${ss.bubbles || 0} · لحظات ${ss.moments || 0} · نفّذ ${ss.acted || 0} · تجاهل متتالٍ ${ss.ignoredRun || 0} · إغلاق متتالٍ ${ss.closedRun || 0}</p>
    <p><b>المستوى:</b> ${esc(store.getLevel())} · <b>مخفَّف اليوم:</b> ${store.isReducedToday() ? "نعم" : "لا"} · <b>نافذة:</b> ${config.windowMs}ms · <b>حد أدنى:</b> ${config.minScore}</p>
    <p><b>السياق:</b> ${esc(ctx.partOfDay)} · نبرة ${esc(ctx.tone)} · زيارات ${ctx.visits} · غياب ${ctx.daysAway} يوم · خمول ${Math.round(ctx.idleMs / 1000)}ث · اتجاه الدرجات ${esc(ctx.scores.trend || "—")}</p>
    <p><b>طابور الانتظار:</b> ${esc(d.queue.join("، ") || "فارغ")}</p>
    <p><b>الفئات:</b><br>${cats}</p>
    <h3>آخر القرارات</h3>${rows || "<p>لا قرارات بعد.</p>"}`;
}

export function mountDebug() {
  if (document.getElementById("baraiDebug")) return;
  const root = document.createElement("div");
  root.id = "baraiDebug";
  root.setAttribute("dir", "rtl");
  root.innerHTML = `<style>
    #baraiDebug{position:fixed;top:8px;inset-inline:8px;max-height:60vh;overflow:auto;z-index:2600;background:#17191D;color:#F4F4F5;font:12px/1.6 system-ui,sans-serif;border-radius:12px;padding:10px;box-shadow:0 8px 28px rgba(0,0,0,.4)}
    #baraiDebug h3,#baraiDebug h4{margin:8px 0 4px;font-size:13px} #baraiDebug ul{margin:0;padding-inline-start:16px}
    #baraiDebug .s-chosen{color:#7CE3B0} #baraiDebug .s-rejected{color:#FF8B97} #baraiDebug .s-deferred{color:#FFD84D} #baraiDebug .s-merged{color:#6CC8FF}
    #baraiDebug button{min-height:32px;margin-inline-end:6px;border:0;border-radius:8px;padding:0 12px;font:inherit;font-weight:700;cursor:pointer}
  </style><div><button data-a="refresh">تحديث</button><button data-a="reset">مسح الذاكرة</button><button data-a="close">إغلاق</button></div><div class="bd-body"></div>`;
  root.addEventListener("click", (e) => {
    const a = e.target && e.target.dataset && e.target.dataset.a;
    if (a === "close") root.remove();
    else if (a === "refresh") render(root);
    else if (a === "reset") { try { localStorage.removeItem("barai:v1"); sessionStorage.removeItem("barai:session"); } catch (x) { /* تجاهل */ } render(root); }
  });
  document.body.appendChild(root);
  render(root);
  setInterval(() => { if (root.isConnected) render(root); }, 3000);
}
