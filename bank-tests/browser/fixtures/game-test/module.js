/* وحدة ES: تحميلها من أصل مجهول يتطلب CORS (Access-Control-Allow-Origin) */
window.__diag = window.__diag || {};
window.__diag.moduleRan = true;
import("/game-test/module2.js").then((m) => { window.__diag.dynamicImport = m.v; }).catch((e) => { window.__diag.dynamicImport = "ERR:" + e.message; });
