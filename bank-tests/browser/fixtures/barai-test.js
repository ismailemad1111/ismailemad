import { MOOD_NAMES, mascotSVG } from "/js/mascot.js";
window.__MOODS = MOOD_NAMES;
const g = document.getElementById("gallery");
if (location.hash === "#gallery") MOOD_NAMES.forEach((m) => { const d = document.createElement("div"); d.style.cssText = "text-align:center;font:12px sans-serif"; d.innerHTML = mascotSVG(m, "").replace('class="mascot', 'style="width:80px;height:80px" class="mascot') + "<div>" + m + "</div>"; g.appendChild(d); });
await import("/js/barai/index.js");
window.__ready = true;
