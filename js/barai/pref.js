/**
 * pref.js — اختيار مستوى ظهور برعي في الملف الشخصي: كثير / قليل / صامت.
 * ملف مستقل: لو فشل لا يتأثر الملف الشخصي.
 */
import { store } from "./store.js";
import { mascotEl } from "../mascot.js";

try {
  const host = document.getElementById("baraiPref");
  if (host) {
    const OPTS = [["many", "كثير"], ["few", "قليل"], ["silent", "صامت"]];
    const seg = document.createElement("div");
    seg.className = "barai-pref-seg";
    seg.setAttribute("role", "group");
    seg.setAttribute("aria-label", "مستوى ظهور برعي");
    const paint = () => {
      const cur = store.getLevel();
      seg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.level === cur)));
    };
    OPTS.forEach(([v, label]) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "barai-pref-btn"; b.dataset.level = v; b.textContent = label;
      b.addEventListener("click", () => { store.setLevel(v); paint(); });
      seg.appendChild(b);
    });
    host.appendChild(mascotEl("wave"));
    host.appendChild(seg);
    paint();
  }
} catch (e) { /* تجاهل */ }
