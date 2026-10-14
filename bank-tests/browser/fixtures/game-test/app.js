/* سكربت كلاسيكي: يجمع تشخيص العزل ويرسل النتيجة عند الضغط */
window.__diag = { origin: String(window.origin), locationOrigin: String(location.origin) };
function attempt(name, fn) { try { window.__diag[name] = "ALLOWED:" + String(fn()); } catch (e) { window.__diag[name] = "BLOCKED:" + e.name; } }
attempt("parentDocument", () => parent.document.title);
attempt("parentSessionStorage", () => parent.sessionStorage.getItem("am_session"));
attempt("ownSessionStorage", () => sessionStorage.getItem("am_session"));
attempt("ownLocalStorage", () => localStorage.length);
attempt("topLocation", () => (top.location.href = "/admin/index.html"));
attempt("windowOpen", () => String(window.open("/index.html")));
attempt("cookie", () => document.cookie);
window.__diag.cssApplied = null;
window.addEventListener("load", () => {
  window.__diag.cssApplied = getComputedStyle(document.getElementById("gTitle")).color;
  window.__diag.imgLoaded = document.getElementById("gImg").naturalWidth > 0;
  fetch("/game-test/data.json").then((r) => r.json()).then((j) => { window.__diag.fetchJson = j.ok === true; }).catch((e) => { window.__diag.fetchJson = "ERR:" + e.message; });
  fetch("/api/anything", { credentials: "include" }).then((r) => { window.__diag.fetchSelfOther = r.status; }).catch(() => { window.__diag.fetchSelfOther = "ERR"; });
  fetch("https://example.com/").then(() => { window.__diag.fetchExternal = "ALLOWED"; }).catch(() => { window.__diag.fetchExternal = "BLOCKED"; });
  document.fonts.load('16px "GT"').then((f) => { window.__diag.fontLoaded = f.length > 0 && f[0].status === "loaded"; }).catch(() => { window.__diag.fontLoaded = false; });
  document.getElementById("gStatus").textContent = "اللعبة جاهزة";
});
const send = (score) => parent.postMessage({ source: "mrismail-game", type: "complete", score }, "*");
document.getElementById("gWin").addEventListener("click", () => send(80));
document.getElementById("gBad").addEventListener("click", () => send(999999));
