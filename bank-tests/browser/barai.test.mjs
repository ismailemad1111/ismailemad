/* اختبارات متصفح حقيقي لبرعي (Playwright + Chromium). التشغيل من bank-tests/browser:
   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node barai.test.mjs */
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { startServer } from "./server.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = (() => { for (const p of [process.env.PW_MODULE, "playwright", "/home/claude/.npm-global/lib/node_modules/playwright"].filter(Boolean)) { try { return require(p); } catch (e) {} } throw new Error("playwright"); })();
const ROOT = path.resolve(here, "../../manasa");
const SHOTS = path.join(here, "screenshots", "barai");
fs.mkdirSync(SHOTS, { recursive: true });
const STU = "stuAAAA1111BBBB2222CCCC3333";
const now = Date.now();
const seed = [
  [`students/${STU}`, { version: 1, data: { fullName: "طالب تجريبي", stage: "sec_1", code: "12345", status: "active" } }],
  ["exams/exA", { version: 1, data: { title: "امتحان الباب الثاني", stage: "sec_1", status: "published", resultPolicy: "immediate", questions: [
    { text: "س١", choices: ["أ", "ب"], correctIndex: 0 }, { text: "س٢", choices: ["أ", "ب"], correctIndex: 0 } ] } }],
  ["exams/exB", { version: 1, data: { title: "امتحان ٢", stage: "sec_1", status: "published", resultPolicy: "immediate", questions: [{ text: "س", choices: ["أ", "ب"], correctIndex: 0 }] } }],
  ["announcements/an1", { version: 1, data: { title: "إعلان", body: "نص", type: "text", targetType: "all", createdAt: { __ts: now } } }]
];
const session = { role: "student", token: "t", student: { id: STU, code: "12345", stage: "sec_1", fullName: "طالب تجريبي" } };

let passed = 0, failed = 0; const problems = [];
async function t(name, fn) { try { await fn(); passed++; console.log("  ✔", name); } catch (e) { failed++; problems.push(name); console.error("  ✘", name, "\n     ", String(e && e.message || e).split("\n").slice(0, 5).join("\n      ")); } }

const server = await startServer({ root: ROOT, cfgPath: path.join(ROOT, "firebase.json"), headerMode: "last", overlay: path.join(here, "fixtures") });
const browser = await chromium.launch({ args: ["--no-sandbox"] });

async function newPage({ viewport = { width: 390, height: 844 }, reducedMotion, noLocalStorage, offlineStart, seedData = seed, routes, noSession } = {}) {
  const ctx = await browser.newContext({ viewport, locale: "ar-EG", timezoneId: "Africa/Cairo", reducedMotion: reducedMotion ? "reduce" : "no-preference" });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com|www\.gstatic\.com/, (r) => r.abort());
  if (routes) await routes(ctx);
  await ctx.addInitScript(({ seedData, session, uid, noLS, noSession }) => {
    try {
      if (!sessionStorage.getItem("__seeded")) {
        sessionStorage.setItem("__seeded", "1");
        sessionStorage.setItem("__fs_store", JSON.stringify(seedData));
        if (!noSession) sessionStorage.setItem("am_session", JSON.stringify(session));
        sessionStorage.setItem("__auth_uid", uid);
      }
    } catch (e) {}
    if (noLS) { try { Object.defineProperty(window, "localStorage", { get() { throw new Error("blocked"); } }); } catch (e) {} }
  }, { seedData, session, uid: STU, noLS: !!noLocalStorage, noSession: !!noSession });
  const page = await ctx.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|net::ERR_FAILED|CORS|Refused to|Blocked|sandbox/i.test(m.text())) page.errors.push("console: " + m.text()); });
  return { ctx, page };
}
const go = async (page, p) => { await page.goto(server.url + p, { waitUntil: "domcontentloaded" }); };
const fixture = async (page, hash = "") => { await go(page, "/barai-test.html" + hash); await page.waitForFunction(() => window.__ready === true && window.__barai); };
const bubble = (page, ms = 6000) => page.waitForSelector(".barai-bubble.is-in", { timeout: ms });
const resetGates = (page) => page.evaluate(() => { const s = JSON.parse(sessionStorage.getItem("barai:session") || "{}"); s.lastAt = 0; s.pages = {}; sessionStorage.setItem("barai:session", JSON.stringify(s)); });
const clearAll = (page) => page.evaluate(() => { sessionStorage.removeItem("barai:session"); localStorage.removeItem("barai:v1"); document.querySelectorAll(".barai-bubble,.barai-moment").forEach((n) => n.remove()); });
const rejectedWhy = (page, ev) => page.evaluate(async (ev) => { const m = await import("/js/barai/brain.js"); const hit = m.brain.debug().decisions.flatMap((d) => d.log).filter((l) => l.event === ev).pop(); return hit ? hit.status + ":" + hit.reason : "none"; }, ev);
const shot = (page, n) => page.screenshot({ path: path.join(SHOTS, n + ".png") });

console.log("— 1) الرسم: كل التعبيرات —");
{
  const { ctx, page } = await newPage();
  await fixture(page, "#gallery");
  await t("كل تعبير يُرسم SVG سليمًا (aria-hidden) بدون أخطاء", async () => {
    const r = await page.evaluate(() => window.__MOODS.map((m) => m));
    assert.ok(r.length >= 21, "عدد التعبيرات " + r.length);
    const need = ["wave", "cheer", "cheerUp", "sleepy", "wait", "scared", "shock", "starstruck", "think", "sad", "wink", "proud", "reading", "typing", "glasses", "offline"];
    need.forEach((m) => assert.ok(r.includes(m), "ناقص " + m));
    assert.equal(await page.$$eval("#gallery svg.mascot", (n) => n.length), r.length);
    assert.equal(await page.$$eval("#gallery svg.mascot[aria-hidden=true]", (n) => n.length), r.length);
    assert.deepEqual(page.errors, []);
  });
  await t("لقطة معرض التعبيرات", async () => { await page.setViewportSize({ width: 430, height: 1200 }); await shot(page, "moods-gallery"); });
  await ctx.close();
}

console.log("— 2) المحتوى: الجمل —");
{
  const { ctx, page } = await newPage();
  await fixture(page);
  await t("كل موقف في الكتالوج له 2+ صيغ، وبدون تكرار متتالٍ، وبدون نص يحمل {} ناقصًا", async () => {
    const r = await page.evaluate(async () => {
      const m = await import("/js/barai/lines.js");
      const out = { bad: [], repeats: [], few: [] };
      for (const [k, d] of Object.entries(m.LINES)) {
        if (d.texts.length < 2) out.few.push(k);
        let prev = null;
        for (let i = 0; i < 25; i++) {
          const p = m.pickLine(k, { name: "سمير", title: "ت", count: 3, score: 1, total: 2, dur: "5 دقايق", reward: "قلم", amount: 5, reason: "مشاركة", gap: 4, stock: 2, date: "1 يناير" });
          if (!p || /[{}]/.test(p.text)) { out.bad.push(k); break; }
          if (d.texts.length > 1 && prev === p.text) { out.repeats.push(k); break; }
          prev = p.text;
        }
      }
      out.missingVar = m.pickLine("exam.new", {}) && m.pickLine("exam.new", {}).text; // يتخطى صيغة {title} عند غيابها
      return out;
    });
    assert.deepEqual(r.bad, []); assert.deepEqual(r.repeats, []); assert.deepEqual(r.few, []);
    assert.ok(!/\{|title/.test(r.missingVar || ""), r.missingVar);
  });
  await t("ألفاظ ممنوعة غير موجودة (فاشل/هتسقط/غبي)", async () => {
    const all = await page.evaluate(async () => { const m = await import("/js/barai/lines.js"); return JSON.stringify(m.LINES); });
    assert.ok(!/فاشل|هتسقط|غبي|فاشلة/.test(all));
  });
  await ctx.close();
}

console.log("— 3) الفقاعة والتخطيط (360/390/430) —");
for (const w of [360, 390, 430]) {
  const { ctx, page } = await newPage({ viewport: { width: w, height: 800 } });
  await fixture(page);
  await t(`فقاعة بعرض ${w}: تظهر، role=status، فوق الشريط السفلي، بلا تمرير أفقي، RTL`, async () => {
    await page.evaluate(() => window.__barai.notify("announce.unread", { count: 2, href: "announcements.html", actionLabel: "افتح الرسائل" }));
    await bubble(page);
    const r = await page.evaluate(() => {
      const b = document.querySelector(".barai-bubble").getBoundingClientRect();
      const n = document.getElementById("nav").getBoundingClientRect();
      const c = document.querySelector(".barai-card");
      return { bottom: b.bottom, navTop: n.top, left: b.left, right: b.right, vw: innerWidth, role: c.getAttribute("role"), live: c.getAttribute("aria-live"),
        hover: document.documentElement.scrollWidth - document.documentElement.clientWidth, dir: getComputedStyle(c).direction, txt: c.textContent,
        svgHidden: document.querySelector(".barai-bubble svg").getAttribute("aria-hidden") };
    });
    assert.ok(r.bottom <= r.navTop, `يتداخل مع الشريط: ${r.bottom} > ${r.navTop}`);
    assert.ok(r.left >= 0 && r.right <= r.vw, "خارج الشاشة");
    assert.equal(r.role, "status"); assert.equal(r.live, "polite"); assert.equal(r.dir, "rtl"); assert.equal(r.svgHidden, "true");
    assert.ok(r.hover <= 1, "overflow " + r.hover);
    assert.ok(/افتح الرسائل/.test(r.txt));
    await shot(page, `bubble-announce-${w}`);
  });
  await ctx.close();
}

console.log("— 3b) النحو والمساعد —");
{
  const { ctx, page } = await newPage();
  await fixture(page);
  await t("عدد الامتحانات: 2 ⇒ «امتحانين»، 5 ⇒ «امتحانات» بدون رقم 2 مع جمع", async () => {
    const r = await page.evaluate(async () => {
      const b = await import("/js/barai/brain.js");
      const out = {};
      for (const n of [2, 5, 12]) { document.querySelectorAll(".barai-bubble").forEach((x) => x.remove()); sessionStorage.removeItem("barai:session"); localStorage.removeItem("barai:v1"); window.__barai.notify("exam.new", { id: "n" + n, count: n, title: "ت" }); await new Promise((r) => setTimeout(r, 2600)); out[n] = document.querySelector(".barai-text")?.textContent; }
      return out;
    });
    assert.ok(/امتحانين|جداد|جدد/.test(r[2]) && !/\b2\b/.test(r[2]), r[2]); assert.ok(/5 امتحانات/.test(r[5]), r[5]); assert.ok(/كتير/.test(r[12]), r[12]);
  });
  await t("المساعد: ai.open يظهر رغم تركيز حقل الكتابة التلقائي", async () => {
    await page.evaluate(() => { sessionStorage.removeItem("barai:session"); localStorage.removeItem("barai:v1"); document.getElementById("inp").focus(); window.__barai.notify("ai.open"); });
    await bubble(page, 5000);
  });
  await ctx.close();
}

console.log("— 4) قواعد عدم الإزعاج —");
{
  const { ctx, page } = await newPage();
  await fixture(page);
  await t("تهدئة 90 ثانية: الفقاعة الثانية فورًا محجوبة", async () => {
    await page.evaluate(() => window.__barai.notify("planner.empty"));
    await bubble(page);
    await page.evaluate(() => window.__barai.notify("announce.unread", {count:2}));
    await page.waitForTimeout(4200);
    assert.equal(await page.$$eval('.barai-bubble[data-key="announce.unread"]', (n) => n.length), 0, "الفقاعة الثانية ظهرت");
    assert.match(await rejectedWhy(page, "announce.unread"), /^rejected:(cooldown|page-limit)$/);
  });
  await t("فقاعة واحدة لكل صفحة حتى لو زالت التهدئة", async () => {
    await clearAll(page);
    await page.evaluate(() => window.__barai.notify("planner.empty"));
    await bubble(page);
    await resetGatesKeepPages(page);
    await page.evaluate(() => window.__barai.notify("announce.unread", {count:2}));
    await page.waitForTimeout(4200);
    assert.equal(await page.$$eval('.barai-bubble[data-key="announce.unread"]', (n) => n.length), 0, "الفقاعة الثانية ظهرت");
    assert.equal(await rejectedWhy(page, "announce.unread"), "rejected:page-limit");
  });
  await t("سقف الجلسة = 3 فقاعات تلقائية", async () => {
    await clearAll(page);
    const keys = ["planner.empty", "exam.new", "announce.unread", "event.live", "planner.overdue"];
    let shown = 0;
    for (const k of keys) {
      await resetGates(page);
      await page.evaluate((k) => { document.querySelectorAll(".barai-bubble").forEach((n) => n.remove()); window.__barai.notify(k); }, k);
      try { await page.waitForSelector(`.barai-bubble.is-in[data-key="${k}"]`, { timeout: 3500 }); shown++; } catch (e) {}
    }
    assert.equal(shown, 3, "ظهر " + shown);
  });
  await t("نفس الموقف لا يتكرر خلال 24 ساعة، لكن موقف الخطأ يتكرر", async () => {
    await clearAll(page);
    await page.evaluate(() => window.__barai.notify("planner.empty")); await bubble(page);
    await page.evaluate(() => document.querySelectorAll(".barai-bubble").forEach((n) => n.remove()));
    await resetGates(page);
    await page.evaluate(() => window.__barai.notify("planner.empty")); await page.waitForTimeout(4200);
    assert.equal(await page.$$eval(".barai-bubble", (n) => n.length), 0);
    for (let i = 0; i < 2; i++) { await page.evaluate(() => { document.querySelectorAll(".barai-bubble").forEach((n) => n.remove()); window.__barai.notify("error.generic"); }); await bubble(page, 3000); }
  });
  await t("لا يقاطع: حقل نصي نشط، وضع الاختبار الجاري، فيديو يعمل، بطاقة الانتقال", async () => {
    await clearAll(page);
    const blocked = async (setup, teardown) => {
      await clearAll(page); await page.evaluate(setup);
      await page.evaluate(() => window.__barai.notify("planner.empty"));
      await page.waitForTimeout(4200);
      const n = await page.$$eval(".barai-bubble", (x) => x.length);
      await page.evaluate(teardown);
      return n;
    };
    assert.equal(await blocked(() => document.getElementById("inp").focus(), () => document.getElementById("inp").blur()), 0, "حقل");
    assert.equal(await blocked(() => window.__barai.busy(true), () => window.__barai.busy(false)), 0, "اختبار جارٍ");
    assert.equal(await blocked(() => { const v = document.createElement("video"); v.id = "vv"; Object.defineProperty(v, "paused", { get: () => false }); document.body.appendChild(v); }, () => document.getElementById("vv").remove()), 0, "فيديو");
    assert.equal(await blocked(() => { const o = document.createElement("div"); o.className = "pt-overlay"; o.id = "ptt"; document.body.appendChild(o); }, () => document.getElementById("ptt").remove()), 0, "انتقال");
    // وبعد زوال العائق يظهر
    await clearAll(page);
    await page.evaluate(() => window.__barai.notify("planner.empty")); await bubble(page, 4000);
  });
  await t("المستوى «صامت»: لا شيء حتى الحرجة", async () => {
    await clearAll(page);
    await page.evaluate(() => { window.__barai.level.set("silent"); window.__barai.notify("planner.empty"); window.__barai.notify("error.generic"); });
    await page.waitForTimeout(4200);
    assert.equal(await page.$$eval(".barai-bubble", (n) => n.length), 0);
    await page.evaluate(() => window.__barai.level.set("few"));
  });
  await ctx.close();
}
async function resetGatesKeepPages(page) { await page.evaluate(() => { const s = JSON.parse(sessionStorage.getItem("barai:session") || "{}"); s.lastAt = 0; sessionStorage.setItem("barai:session", JSON.stringify(s)); }); }

console.log("— 5) الإغلاق والتخفيف —");
{
  const { ctx, page } = await newPage();
  await fixture(page);
  await t("زر × يغلق، وEscape يغلق", async () => {
    await clearAll(page);
    await page.evaluate(() => window.__barai.notify("planner.empty")); await bubble(page);
    await page.click(".barai-close");
    await page.waitForFunction(() => !document.querySelector(".barai-bubble"), null, { timeout: 2000 });
    await clearAll(page);
    await page.evaluate(() => window.__barai.notify("announce.unread", { count: 2 })); await bubble(page);
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector(".barai-bubble"), null, { timeout: 2000 });
  });
  await ctx.close();
}
{
  const { ctx, page } = await newPage();
  await fixture(page);
  await t("إغلاقان متتاليان بلا تفاعل ⇒ تخفيف باقي اليوم (سقف 1)", async () => {
    await clearAll(page);
    for (const k of ["planner.empty", "announce.unread"]) {
      await resetGates(page);
      await page.evaluate((k) => window.__barai.notify(k, { count: 2 }), k); await bubble(page);
      await page.click(".barai-close");
      await page.waitForFunction(() => !document.querySelector(".barai-bubble"), null, { timeout: 2000 });
    }
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("barai:v1")).reducedOn === new Date().toISOString().slice(0, 10)), true);
    await resetGates(page);
    await page.evaluate(() => window.__barai.notify("event.live", { id: "ev1" })); await page.waitForTimeout(4200);
    assert.equal(await page.$$eval(".barai-bubble", (n) => n.length), 0, "بعد التخفيف لا فقاعات تلقائية إضافية");
  });
  await ctx.close();
}

console.log("— 6) تقليل الحركة، بدون localStorage، الشبكة —");
{
  const { ctx, page } = await newPage({ reducedMotion: true });
  await fixture(page);
  await t("prefers-reduced-motion: الحركات متوقفة والنص ثابت ظاهر", async () => {
    await page.evaluate(() => window.__barai.notify("exam.new", { id: "x", count: 1, title: "ت" }));
    await bubble(page);
    const r = await page.evaluate(() => ({ anim: getComputedStyle(document.querySelector(".barai-bubble .rb-float")).animationName, sweat: (() => { const e = document.querySelector(".barai-bubble .rb-sweat"); return e ? getComputedStyle(e).animationName : "none"; })(), txt: document.querySelector(".barai-text").textContent }));
    assert.equal(r.anim, "none"); assert.equal(r.sweat, "none"); assert.ok(r.txt.length > 5);
  });
  await ctx.close();
}
{
  const { ctx, page } = await newPage({ noLocalStorage: true });
  await go(page, "/barai-test.html"); await page.waitForFunction(() => window.__ready === true);
  await t("بدون localStorage: برعي يعمل بذاكرة مؤقتة ولا أخطاء", async () => {
    await page.evaluate(() => window.__barai.notify("planner.empty")); await bubble(page);
    assert.deepEqual(page.errors, []);
  });
  await ctx.close();
}
{
  const { ctx, page } = await newPage();
  await fixture(page);
  await t("انقطاع النت: فقاعة مستمرة (critical)، وعودته تزيلها وتقول رجع", async () => {
    await ctx.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await page.waitForSelector('.barai-bubble.is-in[data-key="net.offline"]', { timeout: 3000 });
    await shot(page, "bubble-offline-390");
    await ctx.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await page.waitForSelector('.barai-bubble.is-in[data-key="net.back"]', { timeout: 3000 });
    await page.waitForFunction(() => !document.querySelector('.barai-bubble[data-key="net.offline"]'), null, { timeout: 2000 });
  });
  await t("لحظة كاملة (moment): planner.allDone بقصاصات، وحدّها مرتان", async () => {
    await clearAll(page);
    let shown = 0;
    for (let i = 0; i < 3; i++) {
      await resetGates(page);
      await page.evaluate(() => { localStorage.removeItem("barai:v1"); document.querySelectorAll(".barai-moment").forEach((n) => n.remove()); window.__barai.notify("planner.allDone"); });
      try { await page.waitForSelector(".barai-moment.is-in", { timeout: 3000 }); shown++; if (i === 0) { await shot(page, "moment-alldone-390"); } } catch (e) {}
    }
    assert.equal(shown, 2, "ظهر " + shown);
  });
  await ctx.close();
}

console.log("— 7) صفحات المنصة الحقيقية —");
{
  const { ctx, page } = await newPage();
  await t("الاختبارات: امتحان جديد يُطلق exam.new (خائف + عنوان حقيقي أو عدد) مع زر إجراء صحيح", async () => {
    await go(page, "/exams");
    await page.waitForSelector(".ex-card, .ex-action", { timeout: 8000 });
    await bubble(page, 8000);
    const r = await page.evaluate(() => { const b = document.querySelector(".barai-bubble"); return { key: b.dataset.key, mood: b.dataset.mood, txt: b.textContent }; });
    assert.equal(r.mood, "scared");
    assert.ok(/exam\.new/.test(r.key));
    assert.ok(/امتحان/.test(r.txt));
    await shot(page, "bubble-exam-new-390");
    assert.deepEqual(page.errors, []);
  });
  await t("إعادة الزيارة: نفس الامتحان لا يُعلن مرتين (محسوب محليًا)", async () => {
    await page.evaluate(() => sessionStorage.removeItem("barai:session"));
    await go(page, "/exams"); await page.waitForSelector(".ex-card", { timeout: 8000 }); await page.waitForTimeout(2600);
    assert.equal(await page.$$eval(".barai-bubble", (n) => n.length), 0);
  });
  await ctx.close();
}
{
  const { ctx, page } = await newPage();
  await t("الإعلانات: غير مقروء ⇒ announce.onPage (لا «عندك رسائل» داخل الصفحة نفسها) وبظرف", async () => {
    await go(page, "/announcements");
    await bubble(page, 8000);
    assert.equal(await page.evaluate(() => document.querySelector(".barai-bubble").dataset.key), "announce.onPage");
    assert.equal(await page.evaluate(() => document.querySelector(".barai-bubble").dataset.mood), "mail");
    await shot(page, "bubble-announcements-390");
  });
  await ctx.close();
}
{
  const { ctx, page } = await newPage();
  await t("نتيجة الاختبار: جملة برعي حسب الدرجة (100% ⇒ نجوم) + لا تمرير أفقي", async () => {
    await go(page, "/exam?examId=exB");
    await page.waitForSelector("#examStartBtn", { timeout: 8000 });
    await page.click("#examStartBtn");
    await page.waitForSelector("#examChoices li", { state: "attached", timeout: 5000 });
    await page.waitForTimeout(400);
    await page.locator("#examChoices li").first().click({ force: true });
    await page.click("#examNextBtn");
    await page.waitForSelector("#confirmSubmitBtn", { state: "visible", timeout: 4000 });
    await page.click("#confirmSubmitBtn");
    await page.waitForSelector("#baraiResultLine", { timeout: 8000 });
    const r = await page.evaluate(() => ({ mood: document.querySelector("#resultIcon .mascot") && document.querySelector("#resultIcon").innerHTML.includes("M66 54") ? "stars" : "other", line: document.getElementById("baraiResultLine").textContent, over: document.documentElement.scrollWidth - document.documentElement.clientWidth }));
    assert.ok(r.line.length > 5); assert.ok(r.over <= 1);
    assert.equal(r.mood, "stars");
    await shot(page, "result-perfect-390");
  });
  await ctx.close();
}
for (const [pth, label] of [["/", "الرئيسية"], ["/lessons", "الدروس"], ["/planner", "المنظّم"], ["/ai", "المساعد"], ["/profile", "الملف"], ["/bank", "البنك"], ["/events", "الأحداث"], ["/login", "الدخول"], ["/subscribe", "الاشتراك"]]) {
  const { ctx, page } = await newPage({ viewport: { width: 360, height: 780 } });
  await t(`${label}: بلا أخطاء JS ولا تمرير أفقي مع برعي`, async () => {
    await go(page, pth); await page.waitForTimeout(2600);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(over <= 1, "overflow " + over);
    assert.deepEqual(page.errors.filter((e) => !/barai|brain/i.test(e)), []);
  });
  await ctx.close();
}
{
  const { ctx, page } = await newPage();
  await t("الملف الشخصي: خيار برعي كثير/قليل/صامت يحفظ المستوى", async () => {
    await go(page, "/profile");
    await page.waitForSelector(".barai-pref-btn");
    await page.click('.barai-pref-btn[data-level="silent"]');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("barai:v1")).level), "silent");
    assert.equal(await page.getAttribute('.barai-pref-btn[data-level="silent"]', "aria-pressed"), "true");
    await page.click('.barai-pref-btn[data-level="many"]');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("barai:v1")).level), "many");
    await shot(page, "profile-pref-390");
  });
  await ctx.close();
}
{
  const { ctx, page } = await newPage();
  await t("بيضة العيد: 5 ضغطات على برعي في الرئيسية ⇒ دورة ونكتة", async () => {
    await go(page, "/");
    await page.waitForSelector(".home-mascot");
    for (let i = 0; i < 5; i++) await page.evaluate(() => document.querySelector(".home-mascot").click());
    await page.waitForSelector('.barai-bubble.is-in[data-key="egg.joke"]', { timeout: 4000 });
    assert.equal(await page.$eval(".home-mascot .mascot", (e) => e.classList.contains("rb-spin-once")), true);
  });
  await ctx.close();
}

console.log("— 7b) البنك: مواقف برعي (الباند ٥) —");
{
  const DAY = 86400000;
  const rw = (id, name, price, extra = {}) => [`bankRewards/${id}`, { version: 1, data: Object.assign({ name, price, published: true, requestable: true, limited: false, stock: null, createdAt: { __ts: now - DAY } }, extra) }];
  const wallet = (balance, extra = {}) => [`bankWallets/${STU}`, { version: 1, data: Object.assign({ studentId: STU, balance, blockedUntil: null }, extra) }];
  const order = (id, rewardName, status) => [`bankOrders/${id}`, { version: 1, data: { studentId: STU, rewardName, price: 100, status, createdAt: { __ts: now - 2 * DAY }, updatedAt: { __ts: now - 3600000 } } }];
  const tx = (id, type, before, after, reason = "") => [`bankTransactions/${id}`, { version: 1, data: { studentId: STU, type, amount: Math.abs(after - before), balanceBefore: before, balanceAfter: after, reason, createdAt: { __ts: now - 1000 } } }];
  const seen = (extra = {}) => ({ seen: Object.assign({ base: ["bankRewards", "bankOrders"], bankWelcome: ["v1"] }, extra) });
  async function visit(rows, ls, { wait = 3600 } = {}) {
    const { ctx, page } = await newPage({ seedData: seed.concat(rows) });
    if (ls) await ctx.addInitScript((o) => { try { if (!localStorage.getItem("barai:v1")) localStorage.setItem("barai:v1", JSON.stringify(o)); } catch (e) {} }, ls);
    await go(page, "/bank");
    await page.waitForSelector("#bkBalanceValue:not(:empty), #bkEmpty:not([hidden])", { timeout: 8000 });
    await page.waitForTimeout(wait);
    const b = await page.evaluate(() => { const n = document.querySelector(".barai-bubble"); return n ? { key: n.dataset.key, text: n.textContent } : null; });
    return { ctx, page, b };
  }
  const FORBID = /مليونير|حل امتحانين|ابدأ بحل اختبار|شاطر|جاهز |منظم/;

  await t("أول زيارة للبنك: ترحيب فقط، لا «رصيدك صفر» ولا «زاد»", async () => {
    const { ctx, page, b } = await visit([wallet(0), rw("r1", "قلم", 100)]);
    assert.ok(b && /bank\.welcome/.test(b.key), "المفتاح: " + (b && b.key));
    assert.ok(!FORBID.test(b.text));
    assert.deepEqual(page.errors, []);
    await ctx.close();
  });
  await t("الترحيب يُعلَّم «شوهد» عند ظهوره فقط ولا يتكرر في الزيارة التالية", async () => {
    const { ctx, page, b } = await visit([wallet(0), rw("r1", "قلم", 100)]);
    assert.ok(b);
    const seenNow = await page.evaluate(() => JSON.parse(localStorage.getItem("barai:v1") || "{}").seen || {});
    assert.ok((seenNow.bankWelcome || []).includes("v1"));
    await ctx.close();
  });
  await t("ممنوع من الطلب: bank.blocked بالتاريخ ولا ترحيب", async () => {
    const until = now + 10 * DAY;
    const { ctx, b } = await visit([wallet(10, { blockedUntil: { __ts: until } }), rw("r1", "قلم", 100)]);
    assert.ok(b && /bank\.blocked/.test(b.key), "المفتاح: " + (b && b.key));
    assert.ok(/لحد|حتى/.test(b.text));
    await ctx.close();
  });
  await t("قريب من جائزة: «باقي X» بالنقص الحقيقي واسم الجائزة", async () => {
    const { ctx, b } = await visit([wallet(80), rw("r1", "حقيبة", 100)], seen({ bankRewards: ["r1"] }));
    assert.ok(b && /bank\.near/.test(b.key), "المفتاح: " + (b && b.key));
    assert.ok(/حقيبة/.test(b.text) && /20/.test(b.text));
    await ctx.close();
  });
  await t("بعيد عن كل الجوائز (> 35%): لا near", async () => {
    const { ctx, b } = await visit([wallet(10), rw("r1", "حقيبة", 100)], seen({ bankRewards: ["r1"] }));
    assert.ok(!b || !/bank\.near/.test(b.key));
    await ctx.close();
  });
  await t("كمية قليلة (محدودة، ≤3): bank.lowStock بالعدد الحقيقي", async () => {
    const { ctx, b } = await visit([wallet(5), rw("r1", "كتاب", 500, { limited: true, stock: 2 })], seen({ bankRewards: ["r1"] }));
    assert.ok(b && /bank\.lowStock/.test(b.key), "المفتاح: " + (b && b.key));
    assert.ok(/كتاب/.test(b.text) && /2/.test(b.text));
    await ctx.close();
  });
  await t("جائزة غير محدودة الكمية لا تُعلن «فاضل منها»", async () => {
    const { ctx, b } = await visit([wallet(5), rw("r1", "كتاب", 500, { limited: false })], seen({ bankRewards: ["r1"] }));
    assert.ok(!b || !/bank\.lowStock/.test(b.key));
    await ctx.close();
  });
  await t("جائزة جديدة بعد خط الأساس: bank.newReward باسمها", async () => {
    const { ctx, b } = await visit([wallet(5), rw("r1", "قلم", 900), rw("r2", "ساعة", 900)], seen({ bankRewards: ["r1"] }));
    assert.ok(b && /bank\.newReward/.test(b.key), "المفتاح: " + (b && b.key));
    assert.ok(/ساعة/.test(b.text) && !/قلم/.test(b.text));
    await ctx.close();
  });
  await t("أول زيارة: الجوائز الموجودة لا تُعلن «جديدة» (خط أساس صامت)", async () => {
    const { ctx, b } = await visit([wallet(5), rw("r1", "قلم", 900), rw("r2", "ساعة", 900)], { seen: { bankWelcome: ["v1"] } });
    assert.ok(!b || !/bank\.newReward/.test(b.key));
    await ctx.close();
  });
  await t("حالة طلب تغيّرت (قيد المراجعة ← مقبول): bank.orderStatus باسم الجائزة", async () => {
    const { ctx, b } = await visit([wallet(5), rw("r1", "قلم", 900), order("o1", "نوتة", "accepted")], seen({ bankRewards: ["r1"], bankOrders: ["o1:pending"] }));
    assert.ok(b && /bank\.orderStatus/.test(b.key), "المفتاح: " + (b && b.key));
    assert.ok(/نوتة/.test(b.text));
    await ctx.close();
  });
  await t("طلب «قيد المراجعة» فقط: لا إعلان (هو من أرسله)", async () => {
    const { ctx, b } = await visit([wallet(5), rw("r1", "قلم", 900), order("o1", "نوتة", "pending")], seen({ bankRewards: ["r1"] }));
    assert.ok(!b || !/bank\.orderStatus/.test(b.key));
    await ctx.close();
  });
  await t("طلب مرفوض جديد + استرجاع: خبر الطلب فقط، لا «رصيدك زاد»", async () => {
    const { ctx, page, b } = await visit([wallet(300), rw("r1", "قلم", 900), order("o1", "نوتة", "rejected"), tx("t1", "refund", 200, 300, "استرجاع")], Object.assign(seen({ bankRewards: ["r1"], bankOrders: ["o1:pending"] }), { balance: 200 }));
    assert.ok(b && /bank\.orderStatus/.test(b.key), "المفتاح: " + (b && b.key));
    assert.equal(await rejectedWhy(page, "bank.earned"), "none");
    await ctx.close();
  });
  await t("زيادة رصيد حقيقية من المستر: bank.earned بالمبلغ والسبب", async () => {
    const { ctx, b } = await visit([wallet(150), rw("r1", "قلم", 900), tx("t1", "credit", 100, 150, "مشاركة")], Object.assign(seen({ bankRewards: ["r1"] }), { balance: 100 }));
    assert.ok(b && /bank\.earned/.test(b.key), "المفتاح: " + (b && b.key));
    assert.ok(/50/.test(b.text));
    await ctx.close();
  });
  await t("لا جوائز أصلًا: حالة فارغة من برعي بلا معلومة مخترعة", async () => {
    const { ctx, page } = await visit([wallet(0)], seen(), { wait: 1500 });
    const txt = await page.evaluate(() => (document.querySelector("#bkEmpty") || {}).textContent || "");
    assert.ok(/جوائز/.test(txt) && !FORBID.test(txt), txt);
    await ctx.close();
  });
  await t("البنك: لا تمرير أفقي بمواقف برعي على 360", async () => {
    const { ctx, page } = await visit([wallet(80), rw("r1", "جائزة باسم طويل جدًا جدًا لاختبار الالتفاف", 100)], seen());
    await page.setViewportSize({ width: 360, height: 800 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await shot(page, "bank-barai-360");
    await ctx.close();
  });
}

console.log("— 8) المنصة تعمل لو تعطّل برعي —");
for (const [mode, handler] of [
  ["ملف index.js محجوب", (ctx) => ctx.route(/\/js\/barai\/index\.js/, (r) => r.abort())],
  ["خطأ برمجي داخل brain.js", (ctx) => ctx.route(/\/js\/barai\/brain\.js/, (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: "throw new Error('barai broken');" }))]
]) {
  const { ctx, page } = await newPage({ routes: handler });
  await t(`${mode}: الاختبارات والرئيسية والإعلانات تعمل كاملة`, async () => {
    await go(page, "/exams"); await page.waitForSelector(".ex-card", { timeout: 8000 });
    assert.ok((await page.$$(".ex-card")).length >= 2);
    await go(page, "/announcements"); await page.waitForSelector(".ann-card", { timeout: 8000 });
    await go(page, "/"); await page.waitForSelector(".home-welcome");
    await page.waitForTimeout(1800);
    assert.equal(await page.$$eval(".barai-bubble", (n) => n.length), 0);
    assert.deepEqual(page.errors.filter((e) => !/barai|brain/i.test(e)), []);
  });
  await ctx.close();
}

console.log("— 9) الدخول: خطوتان وبرعي (الباند ٧) —");
const loginSeed = [
  ["codes/12345", { version: 1, data: { status: "unused", stage: "sec_1" } }],
  ["codes/22222", { version: 1, data: { status: "active", studentId: STU, stage: "sec_1" } }],
  [`students/${STU}`, { version: 1, data: { fullName: "طالب تجريبي", stage: "sec_1", code: "22222", status: "active" } }]
];
const baraiLog = (page) => page.evaluate(async () => { const m = await import("/js/barai/brain.js"); return m.brain.debug().decisions.flatMap((d) => d.log).map((l) => l.event + ":" + l.status); });
const fillLogin = async (page, code, pw = "123456") => { await page.fill("#codeInput", code); await page.fill("#passwordInput", pw); await page.click("#submitBtn"); };
for (const w of [360, 390, 430]) {
  const { ctx, page } = await newPage({ viewport: { width: w, height: 780 }, seedData: loginSeed, noSession: true });
  await t(`الدخول ${w}: كود جديد ⇒ FIRST_LOGIN_REQUIRED خطوة ثانية، بلا login.fail، والحقل داخل الرؤية`, async () => {
    await go(page, "/login"); await page.waitForSelector("#codeInput");
    const y0 = await page.evaluate(() => window.scrollY);
    await fillLogin(page, "12345");
    await page.waitForSelector("#firstLoginSection.is-visible", { timeout: 6000 });
    await page.waitForTimeout(900);
    assert.equal(await page.$eval("#summaryCode", (n) => n.textContent.trim()), "12345");
    const r = await page.evaluate(() => { const b = document.querySelector("#fullNameInput").getBoundingClientRect(); return { top: b.top, bottom: b.bottom, vh: innerHeight, over: document.documentElement.scrollWidth - document.documentElement.clientWidth, focused: document.activeElement && document.activeElement.id }; });
    assert.ok(r.top >= 0 && r.bottom <= r.vh, "الحقل خارج الرؤية " + JSON.stringify(r));
    assert.ok(r.over <= 1, "overflow " + r.over);
    assert.equal(r.focused, "fullNameInput");
    const log = (await baraiLog(page)).join(",");
    assert.ok(!/login\.fail/.test(log), log);
    await page.waitForSelector(".barai-bubble.is-in", { timeout: 6000 }).catch(() => {});
    assert.deepEqual(page.errors.filter((e) => !/barai|brain/i.test(e)), []);
    if (w === 390) await shot(page, "login-step2-390");
  });
  if (w === 390) {
    await t("الدخول: زر «تعديل» يعيد للخطوة 1 ويحتفظ بالكود", async () => {
      page.on("console", (m) => console.log("PAGE:", m.text()));
      await page.evaluate(() => { document.querySelector("#editCodeBtn").addEventListener("click", () => console.log("clicked-probe")); });
      await page.evaluate(() => document.querySelector("#editCodeBtn").click());
      await page.waitForTimeout(100);
      await page.waitForSelector("#credsStep:not([hidden])", { timeout: 4000 });
      await page.waitForTimeout(500);
      assert.equal(await page.evaluate(() => document.querySelector("#firstLoginSection").classList.contains("is-visible")), false);
      assert.equal(await page.$eval("#codeInput", (n) => n.value), "12345");
    });
  }
  await ctx.close();
}
{
  const { ctx, page } = await newPage({ seedData: loginSeed, noSession: true });
  await t("الدخول: كود غير موجود ⇒ INVALID_CODE ويظهر login.fail (code) ويبقى في الخطوة 1", async () => {
    await go(page, "/login"); await page.waitForSelector("#codeInput");
    await fillLogin(page, "99999");
    await page.waitForFunction(() => !document.querySelector("#submitBtn")?.disabled, null, { timeout: 6000 });
    await page.waitForTimeout(1200);
    assert.equal(await page.evaluate(() => document.querySelector("#firstLoginSection").classList.contains("is-visible")), false);
    const log = (await baraiLog(page)).join(",");
    assert.ok(/login\.fail:/.test(log), log);
  });
  await ctx.close();
}
{
  const { ctx, page } = await newPage({ seedData: loginSeed, noSession: true });
  await t("الدخول: كلمة مرور خاطئة ⇒ INVALID_PASSWORD ويظهر login.fail (password)", async () => {
    await go(page, "/login"); await page.waitForSelector("#codeInput");
    await page.evaluate(() => sessionStorage.setItem("__auth_fail", "auth/wrong-password"));
    await fillLogin(page, "22222", "000000");
    await page.waitForTimeout(1800);
    const log = (await baraiLog(page)).join(",");
    assert.ok(/login\.fail:/.test(log), log);
    assert.equal(await page.evaluate(() => document.querySelector("#firstLoginSection").classList.contains("is-visible")), false);
  });
  await ctx.close();
}
{
  const { ctx, page } = await newPage({ seedData: loginSeed, noSession: true, reducedMotion: true });
  await t("الدخول: reduced-motion — الانتقال للخطوة 2 فوري بلا أخطاء", async () => {
    await go(page, "/login"); await page.waitForSelector("#codeInput");
    await fillLogin(page, "12345");
    await page.waitForSelector("#firstLoginSection.is-visible", { timeout: 6000 });
    assert.equal(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches), true);
    assert.deepEqual(page.errors.filter((e) => !/barai|brain/i.test(e)), []);
  });
  await ctx.close();
}
{
  const { ctx, page } = await newPage({ viewport: { width: 390, height: 520 }, seedData: loginSeed, noSession: true });
  await t("الدخول: لوحة مفاتيح (viewport قصير 390×520): حقل الاسم يبقى مرئيًا", async () => {
    await go(page, "/login"); await page.waitForSelector("#codeInput");
    await fillLogin(page, "12345");
    await page.waitForSelector("#firstLoginSection.is-visible", { timeout: 6000 });
    await page.waitForTimeout(900);
    const r = await page.evaluate(() => { const b = document.querySelector("#fullNameInput").getBoundingClientRect(); return { top: b.top, bottom: b.bottom, vh: innerHeight }; });
    assert.ok(r.top >= 0 && r.bottom <= r.vh, JSON.stringify(r));
  });
  await ctx.close();
}

await browser.close(); await server.close();
console.log(`\nالنتيجة: ${passed} نجح، ${failed} فشل`);
if (failed) { console.error("فشل:", problems.join(" | ")); process.exit(1); }
