/* خادم محلي يحاكي Firebase Hosting لاختبارات المتصفح.
   - cleanUrls + trailingSlashBehavior REMOVE + ignore + rewrites (** → /index.html بحالة 200)
   - ترويسات firebase.json بنفس ترتيبها. عند تكرار نفس الترويسة في أكثر من قاعدة:
       headerMode = "last"  (آخر قاعدة تفوز — السلوك المُلاحَظ حسب firebase-tools#9467)
       headerMode = "first" (أول قاعدة تفوز)
     نختبر الوضعين لإثبات أن النتيجة لا تتوقف على الترتيب.
   - يعيد كتابة استيرادات gstatic إلى المحاكيات في bank-tests/stubs. */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
function loadMinimatch() {
  const tries = ["minimatch", "/usr/lib/node_modules/npm/node_modules/minimatch", "/usr/local/lib/node_modules/npm/node_modules/minimatch"];
  for (const t of tries) { try { const m = require(t); return m.minimatch || m; } catch (e) { /* next */ } }
  throw new Error("minimatch غير موجود: شغّل npm i minimatch داخل bank-tests/browser");
}
export const minimatch = loadMinimatch();
const MM = { dot: true };

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png",
  ".jpg": "image/jpeg", ".woff2": "font/woff2", ".woff": "font/woff", ".txt": "text/plain; charset=utf-8" };
const GS = /https:\/\/www\.gstatic\.com\/firebasejs\/10\.14\.1\/firebase-(app|auth|firestore)\.js/g;

export function matchHeaders(cfg, urlPath, mode = "last") {
  const out = new Map(); // lower-key -> {key, value, from}
  const hit = [];
  (cfg.hosting.headers || []).forEach((rule, i) => {
    if (!minimatch(urlPath, rule.source, MM)) return;
    hit.push(i);
    for (const h of rule.headers) {
      const k = h.key.toLowerCase();
      if (mode === "first" && out.has(k)) continue;
      out.set(k, { key: h.key, value: h.value, from: i });
    }
  });
  return { headers: out, hit };
}

export async function startServer({ root, cfgPath, headerMode = "last", port = 0, overlay = null }) {
  const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  const ignore = cfg.hosting.ignore || [];
  const stubsDir = path.resolve(here, "../stubs");
  const log = [];

  const isIgnored = (rel) => ignore.some((p) => minimatch(rel, p, MM));
  const fileFor = (urlPath) => {
    const rel = decodeURIComponent(urlPath).replace(/^\/+/, "");
    if (rel.includes("..")) return null;
    if (!rel || isIgnored(rel)) return null;
    for (const dir of [overlay, root]) {   // overlay = ملفات اختبار لا تُنشر (مثل game-test.html)
      if (!dir) continue;
      const full = path.join(dir, rel);
      if (full.startsWith(dir) && fs.existsSync(full) && fs.statSync(full).isFile()) return full;
    }
    return null;
  };

  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    let p = u.pathname;
    log.push(req.method + " " + req.url);

    /* محاكيات Firebase (ليست جزءًا من الاستضافة الحقيقية) */
    const sm = /^\/__stubs\/(.+)$/.exec(p);
    if (sm) {
      const f = path.join(sm[1].startsWith("browser/") ? here : stubsDir, sm[1].replace(/^browser\//, ""));
      if (!fs.existsSync(f)) { res.writeHead(404); return res.end("no stub"); }
      res.writeHead(200, { "content-type": MIME[".js"], "access-control-allow-origin": "*" });
      return res.end(fs.readFileSync(f));
    }

    if (cfg.hosting.trailingSlashBehavior === "REMOVE" && p.length > 1 && p.endsWith("/")) {
      res.writeHead(301, { location: p.slice(0, -1) + u.search }); return res.end();
    }
    if (cfg.hosting.cleanUrls && p.endsWith(".html") && fileFor(p)) {
      res.writeHead(301, { location: p.slice(0, -5).replace(/\/index$/, "") + u.search }); return res.end();
    }

    let file = fileFor(p) || (cfg.hosting.cleanUrls && p !== "/" ? fileFor(p + ".html") : null) || (p === "/" ? fileFor("/index.html") : null);
    let status = 200;
    if (!file) { file = path.join(root, "index.html"); } // rewrite ** → /index.html (200)

    let body = fs.readFileSync(file);
    const ext = path.extname(file);
    if (ext === ".js") body = Buffer.from(body.toString("utf8").replace(GS, (_, n) => `/__stubs/${n === "firestore" || n === "auth" ? "browser/" + n + "-persist" : n}.js`));
    const { headers } = matchHeaders(cfg, p, headerMode);
    const h = { "content-type": MIME[ext] || "application/octet-stream" };
    for (const v of headers.values()) h[v.key] = v.value;
    res.writeHead(status, h);
    res.end(body);
  });

  await new Promise((r) => server.listen(port, "127.0.0.1", r));
  const addr = server.address();
  return { url: `http://127.0.0.1:${addr.port}`, log, close: () => new Promise((r) => server.close(r)), cfg };
}
