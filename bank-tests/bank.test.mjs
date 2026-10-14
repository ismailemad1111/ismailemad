import assert from "node:assert/strict";

/* ---- بيئة المتصفح الوهمية ---- */
const mem = {};
globalThis.sessionStorage = {
  getItem: (k) => (k in mem ? mem[k] : null),
  setItem: (k, v) => { mem[k] = String(v); },
  removeItem: (k) => { delete mem[k]; }
};
globalThis.window = { location: { pathname: "/", search: "" } };

const ROOT = new URL("../manasa/js/", import.meta.url);
const { backendRequest } = await import(new URL("backend/index.js", ROOT).href);
const { store, stats } = await import("./stubs/firestore.js");
const { authState } = await import("./stubs/auth.js");

const STU = "stuAAAA1111BBBB2222CCCC3333";
const STU2 = "stuDDDD4444EEEE5555FFFF6666";
const ADM = "admXXXX9999YYYY8888ZZZZ7777";
const DAY = 86400000;

function asStudent(uid = STU, name = "طالب تجريبي") {
  authState.currentUser = { uid };
  mem.am_session = JSON.stringify({ role: "student", token: "t", student: { id: uid, code: "12345", stage: "sec_1", fullName: name } });
}
function asAdmin() {
  authState.currentUser = { uid: ADM };
  mem.am_session = JSON.stringify({ role: "admin", token: "t", admin: { id: ADM, name: "الأستاذ", email: "a@b.c" } });
}
const key = () => Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
const call = (m, p, body) => backendRequest(p, { method: m, body });

let passed = 0;
async function t(name, fn) {
  try { await fn(); passed++; console.log("  ✔", name); }
  catch (e) { console.error("  ✘", name, "\n    ", e && e.stack || e); process.exitCode = 1; }
}
const wallet = (uid = STU) => store.get(`bankWallets/${uid}`)?.data;
const snapshotCounts = () => ["bankOrders", "bankTransactions", "bankBans"].map((c) => [...store.keys()].filter((k) => k.startsWith(c + "/")).length);

/* ---- بيانات أولية: طالب موجود مسبقًا (يجب ألا تتأثر) ---- */
const stuDoc = { fullName: "طالب تجريبي", stage: "sec_1", code: "12345", status: "active", studyHoursTotal: 7 };
store.set(`students/${STU}`, { data: { ...stuDoc }, version: 1 });
store.set(`students/${STU2}`, { data: { ...stuDoc, fullName: "طالب ثان", code: "54321" }, version: 1 });
store.set("settings/general", { data: { passingPercent: 50 }, version: 1 });
const settingsBefore = JSON.stringify(store.get("settings/general").data);

let rewardId, limitedId;

console.log("— الجوائز —");
await t("إضافة جائزة ونشرها وظهورها للطالب", async () => {
  asAdmin();
  const r = await call("POST", "/api/admin/bank/rewards", { name: "قلم ذهبي", description: "جائزة", price: 50, published: true, requestable: true, limited: true, stock: 2, imageUrl: "" });
  assert.equal(r.success, true, JSON.stringify(r));
  rewardId = r.data.id;
  const hidden = await call("POST", "/api/admin/bank/rewards", { name: "مخفية", price: 10, published: false, requestable: true, limited: false });
  assert.equal(hidden.success, true);
  asStudent();
  const list = await call("GET", "/api/student/bank");
  assert.equal(list.success, true);
  assert.deepEqual(list.data.rewards.map((x) => x.name), ["قلم ذهبي"]);
  assert.equal(list.data.rewards[0].availability, "available");
  assert.equal(list.data.wallet.balance, 0);
});
await t("التحقق: سعر سالب/كسري/غير رقمي وكمية سالبة مرفوضة", async () => {
  asAdmin();
  for (const bad of [-5, 0, 2.5, "abc", ""]) {
    const r = await call("POST", "/api/admin/bank/rewards", { name: "x", price: bad, published: true, requestable: true, limited: false });
    assert.equal(r.success, false, "price " + bad);
  }
  const r = await call("POST", "/api/admin/bank/rewards", { name: "x", price: 5, published: true, requestable: true, limited: true, stock: -1 });
  assert.equal(r.success, false);
  const r2 = await call("POST", "/api/admin/bank/rewards", { name: "x", price: 5, imageUrl: "javascript:alert(1)", published: true, requestable: true, limited: false });
  assert.equal(r2.success, false);
});
await t("تعديل السعر والوصف لا يغيّر حقولًا أخرى", async () => {
  asAdmin();
  const before = { ...store.get(`bankRewards/${rewardId}`).data };
  const r = await call("PATCH", `/api/admin/bank/rewards/${rewardId}`, { price: 60, description: "وصف جديد" });
  assert.equal(r.success, true);
  const after = store.get(`bankRewards/${rewardId}`).data;
  assert.equal(after.price, 60); assert.equal(after.description, "وصف جديد");
  assert.equal(after.name, before.name); assert.equal(after.stock, 2); assert.equal(after.limited, true);
  assert.equal(after.createdBy, before.createdBy);
  await call("PATCH", `/api/admin/bank/rewards/${rewardId}`, { price: 50 });
  assert.equal((await call("PATCH", "/api/admin/bank/rewards/nope", { price: 5 })).success, false);
});

console.log("— الرصيد اليدوي —");
await t("إضافة رصيد، وتكرار نفس المفتاح لا يضيف مرتين", async () => {
  asAdmin();
  const k = key();
  const r1 = await call("POST", `/api/admin/bank/students/${STU}/adjust`, { type: "credit", amount: 100, reason: "مكافأة تفوق", requestKey: k });
  assert.equal(r1.success, true, JSON.stringify(r1));
  const r2 = await call("POST", `/api/admin/bank/students/${STU}/adjust`, { type: "credit", amount: 100, reason: "مكافأة تفوق", requestKey: k });
  assert.equal(r2.success, true); assert.equal(r2.data.duplicate, true);
  assert.equal(wallet().balance, 100);
  const led = await call("GET", `/api/admin/bank/students/${STU}/ledger`);
  assert.equal(led.data.transactions.length, 1);
  assert.equal(led.data.transactions[0].balanceBefore, 0); assert.equal(led.data.transactions[0].balanceAfter, 100);
});
await t("خصم يدوي بسبب، ومنع الرصيد السالب، وسبب مطلوب", async () => {
  asAdmin();
  const d = await call("POST", `/api/admin/bank/students/${STU}/adjust`, { type: "debit", amount: 30, reason: "تصحيح خطأ", requestKey: key() });
  assert.equal(d.success, true); assert.equal(wallet().balance, 70);
  const over = await call("POST", `/api/admin/bank/students/${STU}/adjust`, { type: "debit", amount: 500, reason: "خطأ", requestKey: key() });
  assert.equal(over.success, false); assert.equal(over.error.code, "INSUFFICIENT_BALANCE"); assert.equal(wallet().balance, 70);
  const noReason = await call("POST", `/api/admin/bank/students/${STU}/adjust`, { type: "debit", amount: 1, reason: "", requestKey: key() });
  assert.equal(noReason.success, false);
  const frac = await call("POST", `/api/admin/bank/students/${STU}/adjust`, { type: "credit", amount: 1.5, reason: "xxxx", requestKey: key() });
  assert.equal(frac.success, false);
  const none = await call("POST", `/api/admin/bank/students/nobody/adjust`, { type: "credit", amount: 5, reason: "xxxx", requestKey: key() });
  assert.equal(none.error.code, "NOT_FOUND");
  // إضافة لطالب بلا محفظة تُنشئها
  const w2 = await call("POST", `/api/admin/bank/students/${STU2}/adjust`, { type: "credit", amount: 10, reason: "بداية", requestKey: key() });
  assert.equal(w2.success, true); assert.equal(wallet(STU2).balance, 10);
});

console.log("— طلب الجائزة —");
let order1;
await t("طلب برصيد كافٍ: طلب + خصم + معاملة + مخزون، بالسعر وقت الطلب", async () => {
  asStudent();
  const k = key();
  const r = await call("POST", "/api/student/bank/order", { rewardId, requestKey: k, expectedPrice: 50 });
  assert.equal(r.success, true, JSON.stringify(r));
  assert.equal(r.data.outcome, "ordered"); assert.equal(r.data.balance, 20);
  order1 = `${STU}_${k}`;
  const o = store.get(`bankOrders/${order1}`).data;
  assert.equal(o.price, 50); assert.equal(o.status, "pending"); assert.equal(o.balanceBefore, 70); assert.equal(o.balanceAfter, 20);
  assert.equal(o.rewardName, "قلم ذهبي");
  assert.equal(wallet().balance, 20);
  assert.equal(store.get(`bankRewards/${rewardId}`).data.stock, 1);
  const tx = store.get(`bankTransactions/${order1}_purchase`).data;
  assert.equal(tx.amount, -50); assert.equal(tx.balanceBefore, 70); assert.equal(tx.balanceAfter, 20);
  // تغيير سعر الجائزة لاحقًا لا يغيّر الطلب التاريخي
  asAdmin(); await call("PATCH", `/api/admin/bank/rewards/${rewardId}`, { price: 80, name: "قلم جديد" });
  assert.equal(store.get(`bankOrders/${order1}`).data.price, 50);
  assert.equal(store.get(`bankOrders/${order1}`).data.rewardName, "قلم ذهبي");
  await call("PATCH", `/api/admin/bank/rewards/${rewardId}`, { price: 50, name: "قلم ذهبي" });
});
await t("إعادة إرسال نفس الطلب (ضغط مكرر) لا تكتب ولا تخصم", async () => {
  asStudent();
  const k = order1.split("_")[1];
  const before = { commits: stats.commits, counts: snapshotCounts(), bal: wallet().balance, stock: store.get(`bankRewards/${rewardId}`).data.stock };
  const r = await call("POST", "/api/student/bank/order", { rewardId, requestKey: k, expectedPrice: 50 });
  assert.equal(r.success, true); assert.equal(r.data.outcome, "already");
  assert.equal(stats.commits, before.commits);
  assert.deepEqual(snapshotCounts(), before.counts);
  assert.equal(wallet().balance, before.bal);
  assert.equal(store.get(`bankRewards/${rewardId}`).data.stock, before.stock);
});
await t("تغيّر السعر قبل التأكيد: لا خصم ولا منع", async () => {
  asAdmin(); await call("PATCH", `/api/admin/bank/rewards/${rewardId}`, { price: 70 });
  asStudent();
  const c = snapshotCounts(), b = wallet().balance;
  const r = await call("POST", "/api/student/bank/order", { rewardId, requestKey: key(), expectedPrice: 50 });
  assert.equal(r.success, false); assert.equal(r.error.code, "PRICE_CHANGED");
  assert.deepEqual(snapshotCounts(), c); assert.equal(wallet().balance, b); assert.equal(wallet().blockedUntil, null);
  asAdmin(); await call("PATCH", `/api/admin/bank/rewards/${rewardId}`, { price: 50 });
});
await t("انقطاع الاتصال أثناء الحفظ: لا شيء يُحفظ، وإعادة المحاولة بنفس المفتاح تنجح مرة واحدة", async () => {
  asAdmin(); await call("POST", `/api/admin/bank/students/${STU}/adjust`, { type: "credit", amount: 80, reason: "رصيد للاختبار", requestKey: key() });
  asStudent();
  const k = key(); const b = wallet().balance; const c = snapshotCounts();
  stats.failNextCommit = 1;
  const r1 = await call("POST", "/api/student/bank/order", { rewardId, requestKey: k, expectedPrice: 50 });
  assert.equal(r1.success, false); assert.equal(r1.error.code, "NETWORK_ERROR");
  assert.equal(wallet().balance, b); assert.deepEqual(snapshotCounts(), c);
  const r2 = await call("POST", "/api/student/bank/order", { rewardId, requestKey: k, expectedPrice: 50 });
  assert.equal(r2.success, true); assert.equal(r2.data.outcome, "ordered");
  const r3 = await call("POST", "/api/student/bank/order", { rewardId, requestKey: k, expectedPrice: 50 });
  assert.equal(r3.data.outcome, "already");
  assert.equal(wallet().balance, b - 50);
});
await t("نفاد الكمية: رفض بدون خصم أو منع", async () => {
  assert.equal(store.get(`bankRewards/${rewardId}`).data.stock, 0);
  asAdmin(); await call("POST", `/api/admin/bank/students/${STU}/adjust`, { type: "credit", amount: 200, reason: "رصيد كبير", requestKey: key() });
  asStudent(); const b = wallet().balance, c = snapshotCounts();
  const r = await call("POST", "/api/student/bank/order", { rewardId, requestKey: key(), expectedPrice: 50 });
  assert.equal(r.success, false); assert.equal(r.error.code, "OUT_OF_STOCK");
  assert.equal(wallet().balance, b); assert.deepEqual(snapshotCounts(), c); assert.equal(wallet().blockedUntil, null);
  const list = await call("GET", "/api/student/bank");
  assert.equal(list.data.rewards[0].availability, "out_of_stock");
});

console.log("— الرفض والاسترجاع —");
await t("رفض طلب: استرجاع كامل كمعاملة مستقلة + إعادة الكمية، والتكرار لا يكرر الاسترجاع", async () => {
  asAdmin();
  const b = wallet().balance;
  const bad0 = await call("PATCH", `/api/admin/bank/orders/${order1}/status`, { status: "rejected", reason: "" });
  assert.equal(bad0.success, false);
  const r = await call("PATCH", `/api/admin/bank/orders/${order1}/status`, { status: "rejected", reason: "الجائزة غير متوفرة" });
  assert.equal(r.success, true, JSON.stringify(r));
  assert.equal(wallet().balance, b + 50);
  const refund = store.get(`bankTransactions/${order1}_refund`).data;
  assert.equal(refund.type, "refund"); assert.equal(refund.amount, 50); assert.equal(refund.balanceBefore, b); assert.equal(refund.balanceAfter, b + 50);
  assert.equal(store.get(`bankRewards/${rewardId}`).data.stock, 1);
  assert.equal(store.get(`bankOrders/${order1}`).data.status, "rejected");
  // ضغط مكرر + محاولة من تبويبين
  const [a1, a2] = await Promise.all([
    call("PATCH", `/api/admin/bank/orders/${order1}/status`, { status: "rejected", reason: "الجائزة غير متوفرة" }),
    call("PATCH", `/api/admin/bank/orders/${order1}/status`, { status: "rejected", reason: "الجائزة غير متوفرة" })
  ]);
  assert.equal(a1.success && a2.success, true);
  assert.equal(wallet().balance, b + 50);
  assert.equal(store.get(`bankRewards/${rewardId}`).data.stock, 1);
  const after = await call("PATCH", `/api/admin/bank/orders/${order1}/status`, { status: "accepted" });
  assert.equal(after.success, false); assert.equal(after.error.code, "INVALID_TRANSITION");
});
await t("مسار التسليم الكامل، ولا رفض/استرجاع بعد التسليم", async () => {
  asStudent();
  const k = key(); const r = await call("POST", "/api/student/bank/order", { rewardId, requestKey: k, expectedPrice: 50 });
  assert.equal(r.success, true, JSON.stringify(r));
  const id = `${STU}_${k}`;
  asAdmin();
  for (const s of ["accepted", "ready", "delivered"]) {
    const x = await call("PATCH", `/api/admin/bank/orders/${id}/status`, { status: s });
    assert.equal(x.success, true, s + JSON.stringify(x));
  }
  const bal = wallet().balance;
  const rej = await call("PATCH", `/api/admin/bank/orders/${id}/status`, { status: "rejected", reason: "محاولة متأخرة" });
  assert.equal(rej.success, false); assert.equal(wallet().balance, bal);
  assert.ok(store.get(`bankOrders/${id}`).data.deliveredAt);
  const skip = await call("PATCH", `/api/admin/bank/orders/${id}/status`, { status: "pending" });
  assert.equal(skip.success, false);
});

console.log("— المنع 30 يومًا —");
let banId;
await t("رصيد غير كافٍ: لا خصم، رصيد غير سالب، سجل منع 30 يومًا", async () => {
  asStudent(STU2, "طالب ثان");
  const list0 = await call("GET", "/api/student/bank");
  assert.equal(list0.data.wallet.isBlocked, false);
  asAdmin(); await call("PATCH", `/api/admin/bank/rewards/${rewardId}`, { stock: 5 });
  asStudent(STU2, "طالب ثان");
  const k = key(); const t0 = Date.now();
  const r = await call("POST", "/api/student/bank/order", { rewardId, requestKey: k, expectedPrice: 50 });
  assert.equal(r.success, true, JSON.stringify(r)); assert.equal(r.data.outcome, "banned");
  assert.equal(wallet(STU2).balance, 10);
  const ban = store.get(`bankBans/${STU2}_${k}`).data;
  banId = `${STU2}_${k}`;
  assert.equal(ban.balanceAtAttempt, 10); assert.equal(ban.price, 50); assert.equal(ban.reason, "insufficient_balance");
  const span = ban.endsAt.toMillis() - ban.startsAt.toMillis();
  assert.ok(Math.abs(span - 30 * DAY) < 5000, "ban length " + span);
  assert.ok(wallet(STU2).blockedUntil.toMillis() >= t0 + 30 * DAY - 5000);
  // لا طلب ولا معاملة شراء
  assert.equal(store.has(`bankOrders/${STU2}_${k}`), false);
  assert.equal(store.has(`bankTransactions/${STU2}_${k}_purchase`), false);
  // إعادة الإرسال بنفس المفتاح: لا منع ثانٍ
  const commits = stats.commits;
  const again = await call("POST", "/api/student/bank/order", { rewardId, requestKey: k, expectedPrice: 50 });
  assert.equal(again.data.outcome, "banned"); assert.equal(stats.commits, commits);
});
await t("طوال المنع: كل طلب جديد مرفوض حتى لو أصبح الرصيد كافيًا (الفحص من البيانات لا من الزر)", async () => {
  asAdmin(); await call("POST", `/api/admin/bank/students/${STU2}/adjust`, { type: "credit", amount: 500, reason: "تجربة المنع", requestKey: key() });
  asStudent(STU2, "طالب ثان"); const b = wallet(STU2).balance, c = snapshotCounts();
  const r = await call("POST", "/api/student/bank/order", { rewardId, requestKey: key(), expectedPrice: 50 });
  assert.equal(r.success, false); assert.equal(r.error.code, "BANK_BLOCKED");
  assert.equal(wallet(STU2).balance, b); assert.deepEqual(snapshotCounts(), c);
  const view = await call("GET", "/api/student/bank");
  assert.equal(view.data.wallet.isBlocked, true); assert.ok(view.data.ban && view.data.ban.endsAt);
});
await t("الإدارة ترى المنع، وترفعه بسبب دون حذف السجل الأصلي", async () => {
  asAdmin();
  const list = await call("GET", "/api/admin/bank/bans");
  const row = list.data.bans.find((x) => x.id === banId);
  assert.equal(row.state, "active"); assert.equal(row.studentName, "طالب ثان");
  const startsBefore = store.get(`bankBans/${banId}`).data.startsAt.toMillis();
  const noReason = await call("POST", `/api/admin/bank/bans/${banId}/lift`, { reason: "" });
  assert.equal(noReason.success, false);
  const lift = await call("POST", `/api/admin/bank/bans/${banId}/lift`, { reason: "ظرف خاص" });
  assert.equal(lift.success, true);
  const b = store.get(`bankBans/${banId}`).data;
  assert.equal(b.status, "lifted"); assert.equal(b.liftReason, "ظرف خاص"); assert.equal(b.liftedBy, ADM);
  assert.equal(b.startsAt.toMillis(), startsBefore); assert.ok(b.endsAt);
  assert.equal(wallet(STU2).blockedUntil, null);
  const again = await call("POST", `/api/admin/bank/bans/${banId}/lift`, { reason: "ظرف خاص" });
  assert.equal(again.success, true);
  asStudent(STU2, "طالب ثان");
  const ok2 = await call("POST", "/api/student/bank/order", { rewardId, requestKey: key(), expectedPrice: 50 });
  assert.equal(ok2.data.outcome, "ordered");
});

console.log("— التزامن —");
await t("طلبان متزامنان برصيد يكفي أحدهما فقط: لا رصيد سالب ولا خصم مزدوج", async () => {
  asAdmin();
  const cur = wallet().balance;
  await call("POST", `/api/admin/bank/students/${STU}/adjust`, { type: "debit", amount: cur, reason: "تصفير للاختبار", requestKey: key() });
  await call("POST", `/api/admin/bank/students/${STU}/adjust`, { type: "credit", amount: 50, reason: "رصيد يكفي مرة", requestKey: key() });
  await call("PATCH", `/api/admin/bank/rewards/${rewardId}`, { stock: 9 });
  asStudent();
  const [a, b] = await Promise.all([
    call("POST", "/api/student/bank/order", { rewardId, requestKey: key(), expectedPrice: 50 }),
    call("POST", "/api/student/bank/order", { rewardId, requestKey: key(), expectedPrice: 50 })
  ]);
  const outs = [a, b].map((x) => x.success ? x.data.outcome : x.error.code).sort();
  assert.deepEqual(outs, ["banned", "ordered"]);
  assert.equal(wallet().balance, 0);
  assert.ok(stats.retries > 0, "تأكد أن التعارض حدث فعلًا");
});

console.log("— سلامة الدفتر والبيانات —");
await t("رصيد كل محفظة = مجموع معاملاتها (لا خصم بلا سجل ولا العكس)", async () => {
  const sums = {};
  for (const [path, e] of store) {
    if (!path.startsWith("bankTransactions/")) continue;
    sums[e.data.studentId] = (sums[e.data.studentId] || 0) + e.data.amount;
  }
  for (const [path, e] of store) {
    if (!path.startsWith("bankWallets/")) continue;
    assert.ok(e.data.balance >= 0, "negative balance " + path);
    assert.equal(e.data.balance, sums[e.data.studentId] || 0, "ledger mismatch " + path);
  }
  // كل طلب غير مرفوض له معاملة شراء، وكل مرفوض له استرجاع واحد
  for (const [path, e] of store) {
    if (!path.startsWith("bankOrders/")) continue;
    assert.ok(store.has(`bankTransactions/${path.split("/")[1]}_purchase`));
    assert.equal(store.has(`bankTransactions/${path.split("/")[1]}_refund`), e.data.status === "rejected");
  }
});
await t("إخفاء الجائزة يحافظ على الطلبات القديمة، ولا توجد مسارات حذف", async () => {
  asAdmin();
  const orders = [...store.keys()].filter((k) => k.startsWith("bankOrders/")).length;
  await call("PATCH", `/api/admin/bank/rewards/${rewardId}`, { published: false });
  assert.equal([...store.keys()].filter((k) => k.startsWith("bankOrders/")).length, orders);
  asStudent();
  assert.equal((await call("GET", "/api/student/bank")).data.rewards.length, 0);
  const r = await call("POST", "/api/student/bank/order", { rewardId, requestKey: key(), expectedPrice: 50 });
  assert.equal(r.success, false); assert.equal(r.error.code, "REWARD_UNAVAILABLE");
  asAdmin();
  assert.equal((await call("DELETE", `/api/admin/bank/rewards/${rewardId}`)).success, false);
  assert.equal(store.has(`bankRewards/${rewardId}`), true);
});
await t("الصلاحيات: الطالب لا ينفذ مسارات الإدارة، والأدمن لا ينفذ مسارات الطالب", async () => {
  asStudent();
  const a = await call("POST", `/api/admin/bank/students/${STU}/adjust`, { type: "credit", amount: 5, reason: "xxxx", requestKey: key() });
  assert.equal(a.success, false); assert.equal(a.error.code, "UNAUTHORIZED");
  asAdmin();
  const b = await call("POST", "/api/student/bank/order", { rewardId, requestKey: key() });
  assert.equal(b.success, false); assert.equal(b.error.code, "UNAUTHORIZED");
});
await t("بيانات المنصة القديمة لم تُمس (الطالب وإعدادات المنصة)", async () => {
  assert.deepEqual(store.get(`students/${STU}`).data, stuDoc);
  assert.equal(JSON.stringify(store.get("settings/general").data), settingsBefore);
});

console.log(`\n${passed} اختبارًا نجح${process.exitCode ? " — وفيه إخفاقات" : ""}`);
