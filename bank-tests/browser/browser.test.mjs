/* اختبارات متصفح حقيقي (Playwright + Chromium) لنظام الأحداث والألعاب
   التشغيل (من داخل bank-tests/browser):
     PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers HEADER_MODE=last node browser.test.mjs
     HEADER_MODE=first ...   ← نفس الاختبارات مع عكس أولوية الترويسات (يجب أن تنجح بالتساوي)
   - لا يلمس Firebase الحقيقي: المحاكيات في bank-tests/stubs، والحالة تُحفظ في sessionStorage.
   - لعبة الاختبار game-test.html في fixtures/ (تُخدَّم كأنها في جذر الاستضافة ولا تدخل نشر المنصة). */
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { startServer } from "./server.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
function loadPw() {
  for (const p of [process.env.PW_MODULE, "playwright", "/home/claude/.npm-global/lib/node_modules/playwright"].filter(Boolean)) {
    try { return require(p); } catch (e) { /* next */ }
  }
  throw new Error("playwright غير مثبّت");
}
const { chromium } = loadPw();

const ROOT = path.resolve(here, "../../manasa");
const SHOTS = path.join(here, "screenshots");
const MODE = process.env.HEADER_MODE === "first" ? "first" : "last";
fs.mkdirSync(SHOTS, { recursive: true });

const STU = "stuAAAA1111BBBB2222CCCC3333", ADM = "admXXXX9999YYYY8888ZZZZ7777";
const H = 3600000, D = 86400000, now = Date.now();
const ev = (o) => ({ title: "حدث", description: "وصف الحدث", imageUrl: "", type: "game", gameFile: "game-test.html", stage: "all", status: "published",
  startAt: now - H, endAt: now + D, scoreEnabled: false, maxScore: null, ...o });
const EVENTS = {
  evLiveGame1: ev({ title: "لعبة العلوم (نتيجة)", scoreEnabled: true, maxScore: 100 }),
  evLiveGame2: ev({ title: "لعبة الرياضيات (نتيجة خارج الحد)", scoreEnabled: true, maxScore: 100 }),
  evLiveGame3: ev({ title: "لعبة الذاكرة (محاولة تزوير)", scoreEnabled: true, maxScore: 100 }),
  evLiveGameNS: ev({ title: "لعبة بلا نقاط" }),
  evMissing1: ev({ title: "لعبة ملفها غير منشور", gameFile: "game-nope.html" }),
  evActivity1: ev({ title: "نشاط القراءة", type: "activity", gameFile: "" }),
  evUpcoming1: ev({ title: "لعبة قادمة", startAt: now + 2 * D, endAt: now + 3 * D }),
  evEnded1: ev({ title: "لعبة منتهية", startAt: now - 3 * D, endAt: now - 2 * D }),
  evOtherStage: ev({ title: "حدث مرحلة أخرى", stage: "prep_1" }),
  evDraft1: ev({ title: "مسودة", status: "draft" })
};
const seedFor = (extra = {}) => [
  [`students/${STU}`, { version: 1, data: { fullName: "طالب تجريبي", stage: "sec_1", code: "12345", status: "active" } }],
  ...Object.entries(EVENTS).map(([id, d]) => [`events/${id}`, { version: 1, data: d }]),
  ...Object.entries(extra).map(([p, d]) => [p, { version: 1, data: d }])
];
const studentSession = { role: "student", token: "t", student: { id: STU, code: "12345", stage: "sec_1", fullName: "طالب تجريبي" } };
const adminSession = { role: "admin", token: "t", admin: { id: ADM, name: "الأستاذ", email: "a@b.c" } };

let passed = 0, failed = 0;
const problems = [];
async function t(name, fn) {
  try { await fn(); passed++; console.log("  ✔", name); }
  catch (e) { failed++; problems.push(name); console.error("  ✘", name, "\n     ", (e && e.message || e).toString().split("\n").slice(0, 6).join("\n      ")); }
}

const server = await startServer({ root: ROOT, cfgPath: process.env.FIREBASE_JSON || path.join(ROOT, "firebase.json"), headerMode: MODE, overlay: path.join(here, "fixtures") });
const browser = await chromium.launch({ args: ["--no-sandbox"] });
console.log(`خادم المحاكاة: ${server.url}  |  أولوية الترويسات: ${MODE === "last" ? "الأخيرة تفوز" : "الأولى تفوز"}`);

async function newCtx({ role, viewport, seed }) {
  const ctx = await browser.newContext({ viewport, locale: "ar-EG", timezoneId: "Africa/Cairo" });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com|www\.gstatic\.com/, (r) => r.abort());
  await ctx.addInitScript(({ seed, session, uid }) => {
    try {
      if (!sessionStorage.getItem("__seeded")) {
        sessionStorage.setItem("__seeded", "1");
        sessionStorage.setItem("__fs_store", JSON.stringify(seed));
        sessionStorage.setItem("am_session", JSON.stringify(session));
        sessionStorage.setItem("__auth_uid", uid);
      }
    } catch (e) { /* iframe معزول: لا sessionStorage */ }
  }, { seed, session: role === "admin" ? adminSession : studentSession, uid: role === "admin" ? ADM : STU });
  const page = await ctx.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|net::ERR_FAILED|CORS|Refused to|Blocked|sandbox/i.test(m.text())) page.errors.push("console: " + m.text()); });
  return { ctx, page };
}
const storeOf = (page) => page.evaluate(() => Object.fromEntries(JSON.parse(sessionStorage.getItem("__fs_store") || "[]")));
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, name + ".png"), fullPage: !/form|result|play|parts/.test(name) });
const M = { width: 390, height: 844 }, DK = { width: 1280, height: 800 };
const go = (page, p) => page.goto(server.url + p, { waitUntil: "domcontentloaded" });

/* ================= الطالب ================= */
console.log("— الطالب: قائمة الأحداث —");
{
  const { ctx, page } = await newCtx({ role: "student", viewport: M, seed: seedFor() });
  await t("القائمة تعرض أحداث المرحلة والكل فقط (لا مسودة ولا مرحلة أخرى)", async () => {
    await go(page, "/events");
    await page.waitForSelector(".ev-card");
    const titles = await page.$$eval(".ev-card .ev-card-title", (n) => n.map((x) => x.textContent));
    assert.equal(titles.length, 8 - 0 - 0, JSON.stringify(titles));
    assert.ok(!titles.includes("مسودة") && !titles.includes("حدث مرحلة أخرى"), JSON.stringify(titles));
  });
  await t("الفلاتر: جارية / قادمة / منتهية / الكل", async () => {
    const count = async (f) => { await page.click(`[data-filter="${f}"]`); return (await page.$$(".ev-card")).length; };
    assert.equal(await count("live"), 6);
    assert.equal(await count("upcoming"), 1);
    assert.equal(await count("ended"), 1);
    assert.equal(await count("all"), 8);
    assert.match((await page.textContent("#evCountLive")).trim(), /6/);
  });
  await t("لقطتا موبايل للقائمة + عدم وجود تمرير أفقي", async () => {
    await shot(page, "student-events-mobile");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 1, "overflow=" + overflow);
    assert.equal(await page.evaluate(() => document.documentElement.dir), "rtl");
  });
  await t("لا أخطاء JS في صفحة القائمة", async () => assert.deepEqual(page.errors, []));
  await ctx.close();
}
{
  const { ctx, page } = await newCtx({ role: "student", viewport: DK, seed: seedFor() });
  await go(page, "/events"); await page.waitForSelector(".ev-card");
  await t("لقطة ديسكتوب للقائمة", async () => { await shot(page, "student-events-desktop"); });
  await ctx.close();
}

console.log("— الطالب: صفحة التفاصيل وحالات الأزرار —");
{
  const { ctx, page } = await newCtx({ role: "student", viewport: M, seed: seedFor() });
  const detail = async (id) => { await go(page, `/event?id=${id}`); await page.waitForSelector("#evdHero:not([hidden]), #evdError:not([hidden])"); };
  const vis = (sel) => page.isVisible(sel);
  await t("لعبة جارية: زر «ابدأ اللعبة» يظهر ويرتبط بصفحة التشغيل", async () => {
    await detail("evLiveGame1");
    assert.equal(await vis("#evdPlay"), true);
    assert.match(await page.textContent("#evdPlayLabel"), /ابدأ اللعبة/);
    assert.match(await page.getAttribute("#evdPlay", "href"), /event-play\.html\?id=evLiveGame1/);
    assert.equal(await vis("#evdJoin"), false);
    await shot(page, "student-event-live-mobile");
  });
  await t("حدث قادم: زر معطّل «لم يبدأ بعد» وبلا رابط تشغيل", async () => {
    await detail("evUpcoming1");
    assert.equal(await vis("#evdPlay"), false);
    assert.match(await page.textContent("#evdDisabled"), /لم يبدأ بعد/);
    await shot(page, "student-event-upcoming-mobile");
  });
  await t("حدث منتهٍ: «انتهى الحدث»", async () => {
    await detail("evEnded1");
    assert.equal(await vis("#evdPlay"), false);
    assert.match(await page.textContent("#evdDisabled"), /انتهى الحدث/);
  });
  await t("نشاط عادي: زر «الدخول إلى الحدث» ثم يتحول إلى «مسجَّل» ويُنشأ مستند مشاركة", async () => {
    await detail("evActivity1");
    assert.equal(await vis("#evdJoin"), true);
    assert.equal(await vis("#evdPlay"), false);
    await page.click("#evdJoin");
    await page.waitForFunction(() => !document.getElementById("evdDisabled").hidden);
    assert.match(await page.textContent("#evdDisabled"), /مسجَّل/);
    const s = await storeOf(page);
    assert.equal(s[`eventParticipations/evActivity1_${STU}`].data.status, "started");
  });
  await t("حدث مرحلة أخرى ومسودة: «غير متاح»", async () => {
    for (const id of ["evOtherStage", "evDraft1"]) {
      await detail(id);
      assert.equal(await vis("#evdError"), true, id);
    }
  });
  await t("معرّف غير صالح في الرابط: رسالة مفهومة", async () => {
    await detail("bad$id");
    assert.match(await page.textContent("#evdErrorTitle"), /رابط غير صحيح/);
  });
  await t("لا أخطاء JS في صفحات التفاصيل", async () => assert.deepEqual(page.errors, []));
  await ctx.close();
}

console.log("— الطالب: تشغيل اللعبة داخل iframe معزول —");
async function playPage(id, viewport = M, seed = seedFor()) {
  const c = await newCtx({ role: "student", viewport, seed });
  const respHeaders = {};
  c.page.on("response", (r) => { const u = new URL(r.url()); if (/^\/game-test/.test(u.pathname)) respHeaders[u.pathname] = { status: r.status(), h: r.headers() }; });
  await go(c.page, `/event-play?id=${id}`);
  c.respHeaders = respHeaders;
  return c;
}
const gameFrame = async (page) => {
  await page.waitForSelector("iframe.ev-frame");
  const h = await page.$("iframe.ev-frame");
  const f = await h.contentFrame();
  await f.waitForFunction(() => document.getElementById("gStatus") && document.getElementById("gStatus").textContent === "اللعبة جاهزة", null, { timeout: 8000 });
  return f;
};
{
  const { ctx, page, respHeaders } = await playPage("evLiveGame1");
  let frame;
  await t("اللعبة تُحمَّل في iframe وتظهر شارة «جارٍ»، ومشاركة started تُسجَّل بعد فحص الملف", async () => {
    frame = await gameFrame(page);
    const s = await storeOf(page);
    assert.equal(s[`eventParticipations/evLiveGame1_${STU}`].data.status, "started");
    await page.waitForTimeout(300);
    assert.equal(await page.isVisible("#evpFinish"), false, "زر «أنهيت اللعبة» يجب أن يختفي في ألعاب النقاط");
    assert.equal(await page.isVisible("#evpError"), false);
    assert.equal(await page.isVisible("#evpLoading"), false);
    await shot(page, "student-play-mobile");
  });
  await t("iframe: sandbox بدون allow-same-origin، وترويسة CSP للعبة تحمل sandbox", async () => {
    const attr = await page.getAttribute("iframe.ev-frame", "sandbox");
    assert.equal(attr, "allow-scripts allow-pointer-lock");
    const main = Object.entries(respHeaders).find(([p, r]) => /^\/game-test(\.html)?$/.test(p) && r.status === 200);
    assert.ok(main, "لم تُلتقط استجابة صفحة اللعبة: " + JSON.stringify(Object.keys(respHeaders)));
    const csp = main[1].h["content-security-policy"] || "";
    assert.match(csp, /sandbox allow-scripts allow-pointer-lock/);
    assert.match(csp, /frame-ancestors 'self'/);
    assert.equal(main[1].h["x-frame-options"], "SAMEORIGIN");
    assert.equal(main[1].h["x-content-type-options"], "nosniff");
    assert.equal(main[1].h["access-control-allow-origin"], "*");
  });
  await t("العزل: أصل مجهول ولا وصول إلى parent.document ولا sessionStorage ولا localStorage ولا cookie", async () => {
    const d = await frame.evaluate(() => window.__diag);
    assert.equal(d.origin, "null");
    for (const k of ["parentDocument", "parentSessionStorage", "ownSessionStorage", "ownLocalStorage", "cookie", "topLocation"]) {
      assert.match(d[k], /^BLOCKED:/, `${k} = ${d[k]}`);
    }
    assert.ok(d.windowOpen === "ALLOWED:null" || /^BLOCKED/.test(d.windowOpen), "windowOpen = " + d.windowOpen); // null = لم تُفتح نافذة
    assert.ok(page.url().includes("/event-play"), "اللعبة لم تغيّر صفحة المنصة: " + page.url());
    const ss = await page.evaluate(() => sessionStorage.getItem("am_session"));
    assert.ok(ss && ss.includes("student"), "جلسة المنصة سليمة");
  });
  await t("توابع اللعبة تعمل من أصل مجهول: JS كلاسيكي، وحدة ES + import ديناميكي، CSS، صورة، JSON، خط، سكربت inline", async () => {
    await frame.waitForFunction(() => window.__diag && window.__diag.fetchExternal !== undefined && window.__diag.fetchJson !== undefined && window.__diag.fontLoaded !== undefined, null, { timeout: 8000 });
    const d = await frame.evaluate(() => ({ ...window.__diag, inline: window.__inlineRan }));
    assert.equal(d.cssApplied, "rgb(10, 120, 60)");
    assert.equal(d.imgLoaded, true);
    assert.equal(d.fetchJson, true, "fetch JSON: " + d.fetchJson);
    assert.equal(d.moduleRan, true);
    assert.equal(d.dynamicImport, 42);
    assert.equal(d.fontLoaded, true);
    assert.equal(d.inline, true);
  });
  await t("اللعبة لا تقرأ ردود المنصة ولا تتصل بمواقع خارجية (CORS/CSP)", async () => {
    const d = await frame.evaluate(() => window.__diag);
    assert.equal(d.fetchSelfOther, "ERR", "fetch إلى مسار المنصة: " + d.fetchSelfOther);
    assert.equal(d.fetchExternal, "BLOCKED");
  });
  await t("إرسال النتيجة عبر postMessage: رسالة «تم تسجيل نتيجتك» + reportedScore=80 بحالة pending", async () => {
    await frame.click("#gWin");
    await page.waitForSelector("#evpOverlay.is-open");
    assert.match(await page.textContent("#evpResultTitle"), /أحسنت! تم تسجيل نتيجتك/);
    assert.match(await page.textContent("#evpResultText"), /قيد المراجعة/);
    const p = (await storeOf(page))[`eventParticipations/evLiveGame1_${STU}`].data;
    assert.equal(p.status, "completed"); assert.equal(p.reportedScore, 80);
    assert.equal(p.reviewStatus, "pending"); assert.equal(p.score, null);
    await shot(page, "student-play-result-mobile");
  });
  await t("بعد الإكمال لا تُعاد المشاركة (فتح صفحة التشغيل مجددًا → «أكملت هذا الحدث»)", async () => {
    await go(page, "/event-play?id=evLiveGame1");
    await page.waitForSelector("#evpError:not([hidden])");
    assert.match(await page.textContent("#evpErrorTitle"), /أكملت هذا الحدث/);
    assert.equal(await page.$("iframe.ev-frame"), null);
  });
  await t("لا أخطاء JS في صفحة التشغيل", async () => assert.deepEqual(page.errors, []));
  await ctx.close();
}
{
  const { ctx, page } = await playPage("evLiveGame2");
  await t("نتيجة خارج الحد (999999): تُرفض وتُسجَّل المشاركة مكتملة بلا نقاط + رسالة مناسبة", async () => {
    const f = await gameFrame(page);
    await f.click("#gBad");
    await page.waitForSelector("#evpOverlay.is-open");
    assert.match(await page.textContent("#evpResultTitle"), /تم تسجيل إكمالك/);
    assert.match(await page.textContent("#evpResultText"), /لم نستطع قبول النتيجة/);
    const p = (await storeOf(page))[`eventParticipations/evLiveGame2_${STU}`].data;
    assert.equal(p.status, "completed"); assert.equal(p.reportedScore, null); assert.equal(p.reviewStatus, "none");
  });
  await ctx.close();
}
{
  const { ctx, page } = await playPage("evLiveGame3");
  await t("رسالة postMessage من صفحة المنصة نفسها (ليست من iframe) تُتجاهل", async () => {
    await gameFrame(page);
    await page.evaluate(() => window.postMessage({ source: "mrismail-game", type: "complete", score: 100 }, "*"));
    await page.waitForTimeout(600);
    assert.equal(await page.isVisible("#evpOverlay.is-open"), false);
    const p = (await storeOf(page))[`eventParticipations/evLiveGame3_${STU}`].data;
    assert.equal(p.status, "started");
  });
  await ctx.close();
}
{
  const { ctx, page } = await playPage("evLiveGameNS");
  await t("لعبة بلا نقاط: زر «أنهيت اللعبة» يسجّل الإكمال", async () => {
    await gameFrame(page);
    assert.equal(await page.isVisible("#evpFinish"), true);
    await page.click("#evpFinish");
    await page.waitForSelector("#evpOverlay.is-open");
    assert.match(await page.textContent("#evpResultText"), /شكرًا لمشاركتك/);
    const p = (await storeOf(page))[`eventParticipations/evLiveGameNS_${STU}`].data;
    assert.equal(p.status, "completed"); assert.equal(p.reviewStatus, "none");
  });
  await ctx.close();
}
{
  const { ctx, page } = await playPage("evMissing1");
  await t("لعبة ملفها غير موجود: رسالة مفهومة، لا iframe، ولا تُسجَّل مشاركة", async () => {
    await page.waitForSelector("#evpError:not([hidden])");
    assert.match(await page.textContent("#evpErrorTitle"), /اللعبة غير متاحة الآن/);
    assert.match(await page.textContent("#evpErrorText"), /ملف اللعبة غير موجود/);
    assert.equal(await page.$("iframe.ev-frame"), null);
    const s = await storeOf(page);
    assert.equal(s[`eventParticipations/evMissing1_${STU}`], undefined);
    await shot(page, "student-play-missing-mobile");
  });
  await ctx.close();
}
{
  const { ctx, page } = await playPage("evLiveGame1", DK, seedFor());
  await t("لقطة ديسكتوب لصفحة التشغيل", async () => { await gameFrame(page); await page.waitForTimeout(300); await shot(page, "student-play-desktop"); });
  await ctx.close();
}
await t("اللعبة تُفتح مباشرة بالرابط (ملف عام) وتحمل نفس الترويسات، وغير الموجودة تعود بـ index.html (rewrite)", async () => {
  const r = await fetch(server.url + "/game-test");
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-security-policy"), /sandbox/);
  const nope = await fetch(server.url + "/game-nope");
  assert.equal(nope.status, 200);
  assert.match(await nope.text(), /<html/);
});

/* ================= الأدمن ================= */
console.log("— الأدمن —");
const partSeed = {
  [`eventParticipations/evLiveGame1_${STU}`]: { eventId: "evLiveGame1", studentId: STU, studentName: "طالب تجريبي", studentCode: "12345", stage: "sec_1",
    status: "completed", reviewStatus: "pending", reportedScore: 80, score: null, startedAt: now - H, completedAt: now - H / 2, updatedAt: now - H / 2 }
};
{
  const { ctx, page } = await newCtx({ role: "admin", viewport: M, seed: seedFor(partSeed) });
  await go(page, "/admin/events");
  await t("صفحة الأدمن تعرض الأحداث (حالات: منشور/مسودة…)", async () => {
    await page.waitForSelector(".abk-card");
    assert.equal((await page.$$(".abk-card")).length, Object.keys(EVENTS).length);
    await shot(page, "admin-events-mobile");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 1, "overflow=" + overflow);
  });
  const fill = async (o) => {
    await page.click("#aevAdd"); await page.waitForSelector("#aevOverlay.is-open, #aevOverlay:not([hidden])");
    const dt = (ms) => new Date(ms + 2 * H).toISOString().slice(0, 16); // توقيت القاهرة ≈ UTC+2/3: القيمة المحلية للحقل
    await page.fill("#aevTitle", o.title);
    await page.fill("#aevStart", o.start || "2030-01-01T10:00");
    await page.fill("#aevEnd", o.end || "2030-01-08T10:00");
    await page.selectOption("#aevStatus", "published");
    await page.selectOption("#aevType", "game");
    if (o.file !== undefined) await page.fill("#aevGameFile", o.file);
  };
  await t("اسم ملف غير صالح مرفوض (بدون حفظ) مع رسالة خطأ", async () => {
    for (const bad of ["../secret.html", "index.html", "game-x.js", "game-a b.html", "https://evil.com/game-x.html"]) {
      await fill({ title: "حدث سيئ", file: bad });
      await page.click("#aevSave");
      await page.waitForTimeout(150);
      const err = (await page.textContent("#aevFormError")).trim();
      assert.ok(err.length > 3, "لا رسالة خطأ لـ " + bad);
      const s = await storeOf(page);
      assert.ok(!Object.entries(s).some(([k, v]) => k.startsWith("events/") && v.data.title === "حدث سيئ"), "حُفظ رغم الخطأ: " + bad);
      await page.click("#aevCancel");
    }
    await fill({ title: "حدث سيئ", file: "../secret.html" }); await page.click("#aevSave"); await page.waitForTimeout(150);
    await shot(page, "admin-form-error-mobile");
    await page.click("#aevCancel");
  });
  await t("زر «فحص وجود الملف»: موجود للعبة الاختبار، وغير موجود لـ game-nope", async () => {
    await fill({ title: "حدث فحص", file: "game-test.html" });
    await page.click("#aevCheckFile");
    await page.waitForFunction(() => { const x = document.getElementById("aevCheckResult").textContent.trim(); return x.length > 0 && !/جارٍ/.test(x); });
    const ok = (await page.textContent("#aevCheckResult")).trim();
    assert.match(ok, /^الملف منشور/, "نتيجة الفحص (موجود): " + ok);
    assert.ok(!/غير موجود/.test(ok));
    await page.fill("#aevGameFile", "game-nope.html");
    await page.click("#aevCheckFile");
    await page.waitForFunction((prev) => { const x = document.getElementById("aevCheckResult").textContent.trim(); return x !== prev && !/جارٍ/.test(x); }, ok);
    const miss = (await page.textContent("#aevCheckResult")).trim();
    assert.match(miss, /ملف اللعبة غير موجود/);
  });
  await t("إضافة حدث لعبة صحيح مع نقاط → يظهر في القائمة ويُحفظ في Firestore", async () => {
    await page.fill("#aevGameFile", "game-test.html");
    await page.setChecked("#aevScoreEnabled", true);
    await page.fill("#aevMaxScore", "50");
    await shot(page, "admin-form-mobile");
    await page.click("#aevSave");
    await page.waitForFunction(() => [...document.querySelectorAll(".abk-card-name")].some((n) => n.textContent === "حدث فحص"));
    const s = await storeOf(page);
    const e = Object.entries(s).find(([k, v]) => k.startsWith("events/") && v.data.title === "حدث فحص")[1].data;
    assert.equal(e.gameFile, "game-test.html"); assert.equal(e.maxScore, 50); assert.equal(e.scoreEnabled, true); assert.equal(e.type, "game");
  });
  await t("تبويب المشاركات: عرض المشاركة واعتماد النتيجة (80) → approved وscore=80", async () => {
    await page.click('.abk-tab[data-tab="parts"]');
    await page.selectOption("#aevPartEvent", "evLiveGame1"); await page.waitForTimeout(600);
    await page.waitForSelector("#aevPartsList .abk-row");
    assert.match(await page.textContent("#aevPartsList"), /طالب تجريبي/);
    await shot(page, "admin-parts-mobile");
    await page.click("text=اعتماد النتيجة");
    await page.waitForFunction(async () => JSON.parse(sessionStorage.getItem("__fs_store")).some(([k, v]) => k.startsWith("eventParticipations/") && v.data.reviewStatus === "approved"));
    const p = (await storeOf(page))[`eventParticipations/evLiveGame1_${STU}`].data;
    assert.equal(p.reviewStatus, "approved"); assert.equal(p.score, 80);
  });
  await t("الحذف: الإلغاء لا يحذف، والتأكيد يحذف الحدث", async () => {
    await page.click('.abk-tab[data-tab="events"]');
    await page.waitForSelector(".abk-card");
    const card = page.locator(".abk-card", { hasText: "حدث فحص" });
    await card.locator("button", { hasText: "حذف" }).click();
    await page.waitForSelector("#aevDelOverlay.is-open, #aevDelOverlay:not([hidden])");
    await page.click("#aevDelCancel");
    assert.ok(Object.values(await storeOf(page)).some((v) => v.data.title === "حدث فحص"), "حُذف بعد الإلغاء!");
    await card.locator("button", { hasText: "حذف" }).click();
    await page.click("#aevDelConfirm");
    await page.waitForFunction(() => ![...document.querySelectorAll(".abk-card-name")].some((n) => n.textContent === "حدث فحص"));
    assert.ok(!Object.values(await storeOf(page)).some((v) => v.data && v.data.title === "حدث فحص"));
  });
  await t("لا أخطاء JS في صفحة الأدمن", async () => assert.deepEqual(page.errors, []));
  await ctx.close();
}
{
  const { ctx, page } = await newCtx({ role: "admin", viewport: DK, seed: seedFor(partSeed) });
  await go(page, "/admin/events"); await page.waitForSelector(".abk-card");
  await t("لقطة ديسكتوب لصفحة الأدمن", async () => { await shot(page, "admin-events-desktop"); });
  await ctx.close();
}

/* ================= التنقل وصفحة الإعداد ================= */
console.log("— رابط الأحداث في البنك + تهيئة الكوليكشنات —");
{
  const { ctx, page } = await newCtx({ role: "student", viewport: M, seed: seedFor() });
  await t("صفحة البنك فيها رابط «الأحداث والألعاب» ظاهر ويفتح قائمة الأحداث", async () => {
    await go(page, "/bank");
    await page.waitForSelector("#bkEventsLink");
    assert.equal(await page.isVisible("#bkEventsLink"), true);
    await page.screenshot({ path: path.join(SHOTS, "student-bank-events-link-mobile.png") });
    await page.click("#bkEventsLink");
    await page.waitForURL(/\/events$/);
    await page.waitForSelector(".ev-card");
  });
  await ctx.close();
}
{
  const keep = { "settings/general": { x: 1 }, "settings/ai": { y: 2 }, [`admins/${ADM}`]: { status: "active", email: "a@b.c" } };
  const { ctx, page } = await newCtx({ role: "admin", viewport: M, seed: seedFor(keep) });
  await t("setup: زر «تهيئة كوليكشنات الأحداث فقط» ينشئ المفقود فقط ولا يلمس الأدمن/الإعدادات/الموجود", async () => {
    await go(page, "/setup");
    await page.waitForSelector("#btnEvents");
    await page.fill("#adminEmail", "a@b.c"); await page.fill("#adminName", "A"); await page.fill("#adminPass", "123456");
    const before = await storeOf(page);
    await page.click("#btnEvents");
    await page.waitForFunction(() => /انتهت تهيئة الأحداث|توقف التنفيذ/.test(document.body.innerText), null, { timeout: 8000 });
    const txt = await page.evaluate(() => document.body.innerText);
    assert.match(txt, /انتهت تهيئة الأحداث/, txt.slice(-300));
    const after = await storeOf(page);
    assert.equal(after["eventParticipations/_init"].data._placeholder, true);
    assert.equal(after["events/_init"], undefined, "events فيها مستندات: لا يُكتب شيء");
    for (const k of Object.keys(before)) assert.deepEqual(after[k], before[k], "تغيّر مستند موجود: " + k);
    const added = Object.keys(after).filter((k) => !(k in before));
    assert.deepEqual(added, ["eventParticipations/_init"]);
    // إعادة التشغيل لا تغيّر شيئًا
    await page.click("#btnEvents");
    await page.waitForFunction(() => (document.body.innerText.match(/انتهت تهيئة الأحداث/g) || []).length >= 1);
    await page.waitForTimeout(300);
    assert.deepEqual(Object.keys(await storeOf(page)).sort(), Object.keys(after).sort());
  });
  await t("المستند المؤقت لا يظهر في قائمة الأدمن ولا يُحسب حدثًا", async () => {
    await go(page, "/admin/events");
    await page.waitForSelector(".abk-card");
    assert.equal((await page.$$(".abk-card")).length, Object.keys(EVENTS).length);
  });
  await ctx.close();
}

await browser.close();
await server.close();
console.log(`\nالنتيجة (${MODE}): نجح ${passed} / فشل ${failed}`);
if (failed) { console.log("الفاشلة:", problems.join(" | ")); process.exit(1); }
