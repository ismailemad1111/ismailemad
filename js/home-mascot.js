/**
 * home-mascot.js — حضور «برعي» في الصفحة الرئيسية (عرض فقط).
 *   1) يقف في ترويسة الترحيب.
 *   2) يظهر بجانب رسائل الحالات الفارغة التي يرسمها index.js، دون تعديل منطقه.
 * إن فشل أي جزء تبقى الصفحة كما هي.
 */
import { mascotEl } from "./mascot.js";

function mountHeader() {
  const welcome = document.querySelector(".home-welcome");
  if (!welcome || welcome.querySelector(".home-mascot")) return;

  const wrap = document.createElement("div");
  wrap.className = "home-mascot";
  wrap.setAttribute("aria-hidden", "true");
  wrap.appendChild(mascotEl("wave"));

  const name = document.createElement("span");
  name.className = "home-mascot-name";
  name.textContent = "برعي";
  wrap.appendChild(name);

  welcome.appendChild(wrap);
  bindEasterEgg(wrap);
  // نعاس بلا نص بعد 60 ثانية بلا لمس، ويستيقظ عند أول لمسة (يحترم «صامت» و«تقليل الحركة»)
  wrap.dataset.baraiAmbient = "wave";
  import("./barai/safe.js").then((m) => m.barai.ambientSleep(wrap)).catch(() => {});
}

/** بيضة العيد: 5 ضغطات على برعي خلال 4 ثوانٍ → دورة كاملة ونكتة. */
function bindEasterEgg(wrap) {
  let taps = [];
  wrap.style.cursor = "pointer";
  wrap.addEventListener("click", () => {
    try {
      const now = Date.now();
      taps = taps.filter((t) => now - t < 4000).concat(now);
      if (taps.length < 5) return;
      taps = [];
      const svg = wrap.querySelector(".mascot");
      if (svg) { svg.classList.remove("rb-spin-once"); void svg.getBoundingClientRect(); svg.classList.add("rb-spin-once"); }
      import("./barai/safe.js").then((m) => m.barai.notify("egg.joke")).catch(() => {});
    } catch (e) { /* تجاهل */ }
  });
}

/** يضيف برعي النعسان إلى كل حالة فارغة ظهرت (مرة واحدة لكل عنصر). */
function decorateEmpties(root) {
  root.querySelectorAll(".home-empty:not([data-mascot]), .home-today-empty:not([data-mascot])").forEach((box) => {
    box.setAttribute("data-mascot", "1");
    const inner = document.createElement("div");
    inner.className = "mascot-empty-text";
    while (box.firstChild) inner.appendChild(box.firstChild);
    box.classList.add("mascot-empty");
    box.appendChild(mascotEl("sleepy"));
    box.appendChild(inner);
  });
}

try {
  mountHeader();
  decorateEmpties(document);

  const targets = ["announcementsList", "examsList", "todayList"]
    .map((id) => document.getElementById(id))
    .filter(Boolean);

  const mo = new MutationObserver(() => {
    mo.disconnect();                       // نمنع حلقة التعديل الذاتي
    decorateEmpties(document);
    targets.forEach((t) => mo.observe(t, { childList: true }));
  });
  targets.forEach((t) => mo.observe(t, { childList: true }));
} catch (e) { /* تجميلي فقط */ }
