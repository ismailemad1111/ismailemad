/**
 * bank.js
 * ------------------------------------------------------------
 * منصة أ/ إسماعيل عماد التعليمية
 * تشغيل صفحة bank.html — بنك مستر إسماعيل (جهة الطالب)
 *
 * المبادئ:
 *   - كل البيانات (الجوائز/الأسعار/الصور/الرصيد/المنع) تأتي من Firestore عبر js/api.js.
 *   - الواجهة لا تنفّذ سياسة الرصيد أو المنع: التحقق الفعلي داخل المعاملة
 *     (js/backend/bank.js) وقواعد firestore.rules. الأزرار تحسين تجربة فقط.
 *   - كل النصوص القادمة من قاعدة البيانات تُعرض بـ textContent (بدون innerHTML).
 * ------------------------------------------------------------
 */

import { onReady, showToast, formatDate } from "./helpers.js";
import { requireStudent } from "./router.js";
import { getBank, getBankHistory, orderBankReward } from "./api.js";
import { renderBottomNav } from "./components.js";

import { barai } from "./barai/safe.js";

/* ============================================================
   01 — ثوابت وأدوات
   ============================================================ */

const RETRYABLE = new Set(["NETWORK_ERROR", "TIMEOUT"]);
const AUTO_REFRESH_AFTER_MS = 30000;

const ORDER_STATUS = {
  pending:   { label: "قيد المراجعة",   cls: "bk-badge--warn" },
  accepted:  { label: "مقبول",          cls: "bk-badge--info" },
  ready:     { label: "جاهز للتسليم",   cls: "bk-badge--info" },
  delivered: { label: "تم التسليم",     cls: "bk-badge--ok" },
  rejected:  { label: "مرفوض",          cls: "bk-badge--bad" }
};

const TX_TYPE = {
  credit:   "إضافة رصيد",
  debit:    "خصم",
  purchase: "طلب جائزة",
  refund:   "استرجاع"
};

const AVAILABILITY = {
  available:    { label: "متاحة",         cls: "bk-badge--ok" },
  unavailable:  { label: "غير متاحة",     cls: "bk-badge--off" },
  out_of_stock: { label: "نفدت الكمية",   cls: "bk-badge--bad" }
};

function $(id) { return document.getElementById(id); }

function el(tag, opts = {}, children = []) {
  const node = document.createElement(tag);
  if (opts.class) node.className = opts.class;
  if (opts.text !== undefined) node.textContent = opts.text;
  if (opts.attrs) Object.entries(opts.attrs).forEach(([k, v]) => node.setAttribute(k, v));
  children.forEach((c) => { if (c) node.appendChild(c); });
  return node;
}

function iconEl(name) {
  return el("span", { class: `icon icon-${name}`, attrs: { "aria-hidden": "true" } });
}

function fmtNum(n) {
  return Number(n || 0).toLocaleString("en-US");
}

function newRequestKey() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID().replace(/-/g, "");
  }
  return (Math.random().toString(36).slice(2) + Date.now().toString(36) + "0000000000").slice(0, 24);
}

function show(node, visible) {
  if (!node) return;
  node.hidden = !visible;
}


/* ============================================================
   02 — الحالة
   ============================================================ */

const state = {
  wallet: { balance: 0, isBlocked: false, blockedUntil: null },
  ban: null,
  rewards: [],
  loaded: false,
  loading: false,
  loadedAt: 0,
  tab: "rewards",
  pending: null          // { reward, requestKey, busy, finished }
};


/* ============================================================
   03 — تحميل البنك (الرصيد + الجوائز)
   ============================================================ */

async function loadBank({ silent = false } = {}) {
  if (state.loading) return;
  state.loading = true;

  const refreshBtn = $("bkRefreshBtn");
  refreshBtn.disabled = true;
  refreshBtn.classList.add("is-spinning");

  if (!silent && !state.loaded) {
    show($("bkSkeleton"), true);
    show($("bkGrid"), false);
    show($("bkEmpty"), false);
    show($("bkError"), false);
  }

  const res = await getBank();

  state.loading = false;
  refreshBtn.disabled = false;
  refreshBtn.classList.remove("is-spinning");

  if (!res || !res.success) {
    const msg = (res && res.error && res.error.message) || "تعذر تحميل البنك.";
    if (res && res.error && res.error.code === "UNAUTHORIZED") {
      showToast(msg, "warning");
    }
    if (state.loaded) {
      showToast(msg, "error"); // نُبقي ما عُرض سابقًا
    } else {
      $("bkErrorText").textContent = msg + " تأكد من اتصالك بالإنترنت وحاول مرة أخرى.";
      show($("bkSkeleton"), false);
      show($("bkError"), true);
    }
    return;
  }

  const data = res.data || {};
  state.wallet = data.wallet || state.wallet;
  state.ban = data.ban || null;
  state.rewards = Array.isArray(data.rewards) ? data.rewards : [];
  state.loaded = true;
  state.loadedAt = Date.now();

  renderBalance();
  renderBan();
  renderRewards();

  try { baraiBank().catch(() => {}); } catch (e) { /* برعي تجميلي فقط */ }
}

/* ------------------------------------------------------------
   برعي في البنك — كله من بيانات الصفحة نفسها (رصيد/جوائز/سجل)، بلا كتابة جديدة في Firestore.
   «شوهد» يُعلَّم عند ظهور الرسالة فقط (commit)، وأول زيارة تُحفظ خط أساس بصمت.
   بيانات غير متاحة فلا تُفعَّل: موعد انتهاء الامتحان، تفاصيل الأسئلة الخاطئة.
   ------------------------------------------------------------ */
let historyInFlight = null;
function historyOnce() {
  if (ordersCache) return Promise.resolve(ordersCache);          // جلب واحد يُعاد استخدامه (طلباتي/السجل)
  if (!historyInFlight) {
    historyInFlight = fetchHistory().then((h) => { if (h) { ordersCache = h; ledgerCache = h; } return h; })
      .finally(() => { historyInFlight = null; });
  }
  return historyInFlight;
}

const NOTE_MAX_REWARD_EVENTS = 3;

async function baraiBank() {
  const cfg = await import("./barai/config.js").then((m) => m.config || m.default || {}).catch(() => ({}));
  const nearRatio = Number(cfg.context && cfg.context.nearGapRatio) || 0.35;
  const lowStock = Number(cfg.context && cfg.context.lowStock) || 3;

  const bal = Number(state.wallet && state.wallet.balance);
  if (!isFinite(bal)) return;
  const blocked = !!(state.wallet.isBlocked && state.wallet.blockedUntil);
  const avail = state.rewards.filter((r) => r && r.availability === "available" && isFinite(Number(r.price)));
  const { prev } = await barai.balance(bal);

  /* لا جوائز أصلًا */
  if (!state.rewards.length) { barai.empty($("bkEmpty"), "empty.rewards"); }

  /* ممنوع من الطلب */
  if (blocked) barai.notify("bank.blocked", { date: formatDate(state.wallet.blockedUntil) });

  /* ترحيب أول زيارة للبنك (لا يُقال لمن هو ممنوع: رسالة المنع أهم) */
  if (!blocked && state.rewards.length) {
    const ids = await barai.fresh("bankWelcome", ["v1"]);
    if (ids.length) barai.notify("bank.welcome", { commit: { group: "bankWelcome", ids } });
  }

  /* الرصيد: زاد (مع التحقق أنه ليس استرجاع طلب مرفوض) أو صار صفرًا بعد إنفاق */
  if (prev !== null && bal > prev) {
    const h = await historyOnce().catch(() => null);
    const txs = h && Array.isArray(h.transactions) ? h.transactions : null;
    const last = txs && txs[0];
    if (!(last && last.type === "refund")) {
      const d = { amount: bal - prev };
      if (last && Number(last.balanceAfter) === bal && last.reason) d.reason = last.reason;
      barai.notify("bank.earned", d);
    }
  } else if (bal === 0 && prev !== null && prev > 0) {
    barai.notify("bank.poor");
  }

  if (!blocked) {
    /* يكفي لجائزة صار قادرًا عليها بعد زيادة الرصيد */
    if (prev !== null && bal > prev) {
      const now = avail.filter((r) => Number(r.price) > prev && Number(r.price) <= bal)
        .sort((a, b) => Number(b.price) - Number(a.price))[0];
      if (now) barai.notify("bank.afford", { id: now.id, reward: now.name });
    }
    /* قريب من جائزة: أصغر نقص ≤ نسبة من السعر */
    const near = avail.filter((r) => Number(r.price) > bal && (Number(r.price) - bal) <= nearRatio * Number(r.price))
      .sort((a, b) => (Number(a.price) - bal) - (Number(b.price) - bal))[0];
    if (near) barai.notify("bank.near", { id: near.id, reward: near.name, gap: fmtNum(Number(near.price) - bal) });

    /* كمية قليلة (جوائز محدودة فقط) */
    const low = avail.filter((r) => r.limited && Number(r.stock) > 0 && Number(r.stock) <= lowStock)
      .sort((a, b) => Number(a.stock) - Number(b.stock))[0];
    if (low) barai.notify("bank.lowStock", { id: low.id, reward: low.name, stock: fmtNum(low.stock) });
  }

  /* جوائز جديدة (خط أساس أول زيارة بصمت) */
  const rb = await barai.baseline("bankRewards", avail.map((r) => String(r.id)));
  if (!rb.first && rb.ids.length) {
    rb.ids.slice(0, NOTE_MAX_REWARD_EVENTS).forEach((id) => {
      const r = avail.find((x) => String(x.id) === id);
      if (r) barai.notify("bank.newReward", { id, reward: r.name, commit: { group: "bankRewards", ids: [id] } });
    });
  }

  /* تغيّر حالة طلب (خط أساس أول زيارة؛ «قيد المراجعة» لا تُعلَن لأنه هو من أرسلها) */
  const h2 = await historyOnce().catch(() => null);
  const orders = h2 && Array.isArray(h2.orders) ? h2.orders : null;
  if (orders) {
    const key = (o) => `${o.id}:${o.status}`;
    const ob = await barai.baseline("bankOrders", orders.map(key));
    if (!ob.first) {
      orders.filter((o) => o.status !== "pending" && ob.ids.includes(key(o))).slice(0, NOTE_MAX_REWARD_EVENTS).forEach((o) => {
        barai.notify("bank.orderStatus", { id: o.id, status: o.status, reward: o.rewardName || "الجائزة", commit: { group: "bankOrders", ids: [key(o)] } });
      });
    }
  }
  barai.settle();
}


/* ============================================================
   04 — العرض
   ============================================================ */

function renderBalance() {
  $("bkBalance").classList.remove("is-loading");
  $("bkBalanceValue").textContent = fmtNum(state.wallet.balance);
}

function renderBan() {
  const box = $("bkBan");
  if (!state.wallet.isBlocked || !state.wallet.blockedUntil) {
    show(box, false);
    return;
  }
  const until = formatDate(state.wallet.blockedUntil);
  let text = `لا يمكنك طلب أي جائزة حتى ${until}.`;
  if (state.ban) {
    text += ` السبب: طلبت جائزة «${state.ban.rewardName}» بسعر ${fmtNum(state.ban.price)} ورصيدك وقتها ${fmtNum(state.ban.balanceAtAttempt)} فقط، وهذا يخالف سياسة البنك.`;
  }
  $("bkBanText").textContent = text;
  show(box, true);
}

function rewardCard(r) {
  const media = el("div", { class: "bk-card-media" });
  if (r.imageUrl) {
    const img = el("img", { attrs: { src: r.imageUrl, alt: r.name, loading: "lazy" } });
    media.appendChild(img);
  } else {
    media.appendChild(iconEl("trophy"));
  }

  const av = AVAILABILITY[r.availability] || AVAILABILITY.unavailable;
  const priceEl = el("span", { class: "bk-price" }, [
    el("strong", { text: fmtNum(r.price) }),
    el("span", { text: "فلوس" })
  ]);
  const meta = el("div", { class: "bk-card-meta" }, [
    priceEl,
    el("span", { class: `bk-badge ${av.cls}`, text: av.label })
  ]);
  if (r.limited && r.availability === "available") {
    meta.appendChild(el("span", { class: "bk-stock", text: `المتبقي: ${fmtNum(r.stock)}` }));
  }

  const btn = el("button", { class: "bk-btn", attrs: { type: "button" } });
  btn.appendChild(iconEl("trophy"));
  if (r.availability === "available" && state.wallet.isBlocked) {
    btn.appendChild(el("span", { text: "طلب الجائزة" }));
    btn.disabled = true;
    btn.title = "أنت ممنوع حاليًا من طلب الجوائز";
  } else if (r.availability === "available") {
    btn.appendChild(el("span", { text: "طلب الجائزة" }));
    btn.addEventListener("click", () => openConfirm(r));
  } else {
    btn.appendChild(el("span", { text: av.label }));
    btn.disabled = true;
  }

  const body = el("div", { class: "bk-card-body" }, [
    el("h3", { class: "bk-card-name", text: r.name }),
    r.description ? el("p", { class: "bk-card-desc", text: r.description }) : null,
    meta,
    btn
  ]);
  return el("article", { class: "bk-card" }, [media, body]);
}

function renderRewards() {
  const grid = $("bkGrid");
  grid.replaceChildren();
  show($("bkSkeleton"), false);
  show($("bkError"), false);

  if (!state.rewards.length) {
    show(grid, false);
    show($("bkEmpty"), true);
    $("bkCount").textContent = "لا توجد جوائز";
    return;
  }
  state.rewards.forEach((r) => grid.appendChild(rewardCard(r)));
  show($("bkEmpty"), false);
  show(grid, true);
  $("bkCount").textContent = `${fmtNum(state.rewards.length)} ${state.rewards.length === 1 ? "جائزة" : "جوائز"} متاحة في البنك`;
}


/* ============================================================
   05 — نافذة التأكيد
   ============================================================ */

function setOverlay(id, open) {
  const o = $(id);
  o.classList.toggle("is-open", open);
  o.setAttribute("aria-hidden", open ? "false" : "true");
}

function summaryRow(label, value, extra = "") {
  return el("div", { class: `bk-summary-row ${extra}`.trim() }, [
    el("span", { text: label }),
    el("strong", { text: value })
  ]);
}

function openConfirm(reward) {
  if (state.pending && state.pending.busy) return;
  if (state.wallet.isBlocked) {
    showToast("أنت ممنوع حاليًا من طلب الجوائز.", "warning");
    return;
  }

  state.pending = { reward, requestKey: newRequestKey(), busy: false, finished: false };

  const balance = Number(state.wallet.balance) || 0;
  const after = balance - reward.price;
  const summary = $("bkConfirmSummary");
  summary.replaceChildren(
    el("div", { class: "bk-summary-row" }, [
      el("span", { text: "الجائزة" }),
      el("span", { text: reward.name, attrs: { style: "font-weight:700;text-align:end" } })
    ]),
    summaryRow("السعر", `${fmtNum(reward.price)} فلوس`),
    summaryRow("رصيدك الحالي", `${fmtNum(balance)} فلوس`),
    after >= 0
      ? summaryRow("رصيدك بعد الخصم", `${fmtNum(after)} فلوس`, "is-total")
      : summaryRow("النقص في رصيدك", `${fmtNum(-after)} فلوس`, "is-total")
  );

  const note = $("bkConfirmNote");
  if (after < 0) {
    note.textContent =
      "رصيدك الحالي أقل من سعر الجائزة. إذا أكدت الآن فلن يُخصم شيء، لكنك ستُمنع من طلب أي جائزة لمدة 30 يومًا.";
    note.classList.remove("bk-note--info");
    show(note, true);
  } else {
    show(note, false);
  }

  $("bkConfirmOk").hidden = false;
  $("bkConfirmOk").disabled = false;
  $("bkConfirmOk").textContent = "تأكيد الطلب";
  $("bkConfirmBack").disabled = false;
  $("bkConfirmBack").textContent = "العودة";

  setOverlay("bkConfirmOverlay", true);
  $("bkConfirmBack").focus();
}

function closeConfirm() {
  if (state.pending && state.pending.busy) return; // لا نغلق أثناء التنفيذ
  setOverlay("bkConfirmOverlay", false);
  state.pending = null;
}

function showConfirmMessage(text, kind) {
  const note = $("bkConfirmNote");
  note.textContent = text;
  note.classList.toggle("bk-note--info", kind === "info");
  show(note, true);
}

function showResult(title, text) {
  $("bkResultTitle").textContent = title;
  $("bkResultText").textContent = text;
  setOverlay("bkResultOverlay", true);
  $("bkResultClose").focus();
}

async function confirmOrder() {
  const p = state.pending;
  if (!p || p.busy || p.finished) return;

  p.busy = true;
  const okBtn = $("bkConfirmOk");
  const backBtn = $("bkConfirmBack");
  okBtn.disabled = true;
  backBtn.disabled = true;
  okBtn.textContent = "جارٍ تنفيذ الطلب…";
  showConfirmMessage("جارٍ حفظ طلبك. لا تغلق الصفحة.", "info");

  const res = await orderBankReward({
    rewardId: p.reward.id,
    requestKey: p.requestKey,
    expectedPrice: p.reward.price
  });

  p.busy = false;

  /* ----- نجاح ----- */
  if (res && res.success) {
    p.finished = true;
    setOverlay("bkConfirmOverlay", false);
    state.pending = null;

    if (res.data.outcome === "banned") {
      showResult("لم يتم تنفيذ الطلب", res.data.message || "رصيدك لا يكفي. تم منعك من طلب الجوائز لمدة 30 يومًا.");
    } else {
      try { barai.notify("bank.redeem"); } catch (e) { /* تجاهل */ }
      const o = res.data.order || {};
      showResult(
        "تم تسجيل طلبك",
        `طلبت «${o.rewardName || p.reward.name}» بسعر ${fmtNum(o.price || p.reward.price)} فلوس، ` +
        `ورصيدك الآن ${fmtNum(res.data.balance)} فلوس. ستجد حالة الطلب في تبويب «طلباتي».`
      );
    }
    ordersCache = null; ledgerCache = null;
    await loadBank({ silent: true });
    return;
  }

  /* ----- فشل ----- */
  const code = res && res.error && res.error.code;
  const msg = (res && res.error && res.error.message) || "تعذر تنفيذ الطلب.";

  if (RETRYABLE.has(code)) {
    // لم تتأكد النتيجة: نبقي نفس مفتاح الطلب فتكون إعادة المحاولة آمنة (لا خصم مزدوج)
    showConfirmMessage(`${msg} لم يتم تأكيد الطلب بعد، ويمكنك الضغط على «إعادة المحاولة» بأمان دون خصم مزدوج.`);
    okBtn.disabled = false;
    okBtn.textContent = "إعادة المحاولة";
    backBtn.disabled = false;
    return;
  }

  // خطأ نهائي: لا يوجد خصم. نحدّث البيانات حتى ترى الطالب الحالة الصحيحة
  p.finished = true;
  showConfirmMessage(msg);
  okBtn.hidden = true;
  backBtn.disabled = false;
  backBtn.textContent = "إغلاق";
  await loadBank({ silent: true });
}


/* ============================================================
   06 — طلباتي وسجل الرصيد
   ============================================================ */

let ordersCache = null;
let ledgerCache = null;

async function fetchHistory() {
  const res = await getBankHistory();
  if (!res || !res.success) return null;
  return res.data;
}

function rowEl({ title, sub, sideTop, sideBottom }) {
  return el("div", { class: "bk-row" }, [
    el("div", { class: "bk-row-main" }, [
      el("p", { class: "bk-row-title", text: title }),
      sub ? el("p", { class: "bk-row-sub", text: sub }) : null
    ]),
    el("div", { class: "bk-row-side" }, [sideTop, sideBottom])
  ]);
}

function renderOrders(data) {
  const list = $("bkOrdersList");
  list.replaceChildren();
  show($("bkOrdersLoading"), false);
  show($("bkOrdersError"), false);
  if (!data.orders.length) {
    show(list, false);
    show($("bkOrdersEmpty"), true);
    return;
  }
  show($("bkOrdersEmpty"), false);
  data.orders.forEach((o) => {
    const st = ORDER_STATUS[o.status] || { label: o.status, cls: "" };
    let sub = formatDate(o.createdAt);
    if (o.status === "rejected") {
      sub += o.rejectReason ? ` — سبب الرفض: ${o.rejectReason}` : "";
      sub += " — تم استرجاع المبلغ إلى رصيدك.";
    }
    list.appendChild(rowEl({
      title: o.rewardName || "جائزة",
      sub,
      sideTop: el("span", { class: "bk-amount", text: `${fmtNum(o.price)}` }),
      sideBottom: el("span", { class: `bk-badge ${st.cls}`, text: st.label })
    }));
  });
  show(list, true);
}

function renderLedger(data) {
  const list = $("bkLedgerList");
  list.replaceChildren();
  show($("bkLedgerLoading"), false);
  show($("bkLedgerError"), false);

  const items = [];
  data.transactions.forEach((t) => items.push({
    at: t.createdAt,
    node: rowEl({
      title: TX_TYPE[t.type] || "معاملة",
      sub: `${t.reason ? t.reason + " — " : ""}${formatDate(t.createdAt)} — الرصيد: ${fmtNum(t.balanceBefore)} ← ${fmtNum(t.balanceAfter)}`,
      sideTop: el("span", {
        class: `bk-amount ${t.amount >= 0 ? "is-plus" : "is-minus"}`,
        text: `${t.amount >= 0 ? "+" : "−"}${fmtNum(Math.abs(t.amount))}`
      })
    })
  }));
  data.bans.forEach((b) => {
    const lifted = b.status === "lifted";
    items.push({
      at: b.startsAt,
      node: rowEl({
        title: "منع من طلب الجوائز",
        sub: `بسبب طلب «${b.rewardName}» (${fmtNum(b.price)}) برصيد ${fmtNum(b.balanceAtAttempt)} — من ${formatDate(b.startsAt)} إلى ${formatDate(b.endsAt)}`,
        sideBottom: el("span", { class: `bk-badge ${lifted ? "bk-badge--ok" : "bk-badge--bad"}`, text: lifted ? "تم رفعه" : "منع" })
      })
    });
  });
  items.sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));

  if (!items.length) {
    show(list, false);
    show($("bkLedgerEmpty"), true);
    return;
  }
  show($("bkLedgerEmpty"), false);
  items.forEach((i) => list.appendChild(i.node));
  show(list, true);
}

async function loadOrdersTab() {
  if (ordersCache) { renderOrders(ordersCache); return; }
  show($("bkOrdersLoading"), true);
  show($("bkOrdersList"), false);
  show($("bkOrdersEmpty"), false);
  show($("bkOrdersError"), false);
  const data = await fetchHistory();
  if (!data) {
    show($("bkOrdersLoading"), false);
    show($("bkOrdersError"), true);
    return;
  }
  ordersCache = data; ledgerCache = data;
  renderOrders(data);
}

async function loadLedgerTab() {
  if (ledgerCache) { renderLedger(ledgerCache); return; }
  show($("bkLedgerLoading"), true);
  show($("bkLedgerList"), false);
  show($("bkLedgerEmpty"), false);
  show($("bkLedgerError"), false);
  const data = await fetchHistory();
  if (!data) {
    show($("bkLedgerLoading"), false);
    show($("bkLedgerError"), true);
    return;
  }
  ordersCache = data; ledgerCache = data;
  renderLedger(data);
}

function switchTab(tab) {
  state.tab = tab;
  document.querySelectorAll(".bk-tab").forEach((b) => {
    const active = b.dataset.tab === tab;
    b.classList.toggle("is-active", active);
    b.setAttribute("aria-selected", active ? "true" : "false");
  });
  show($("bkPanelRewards"), tab === "rewards");
  show($("bkPanelOrders"), tab === "orders");
  show($("bkPanelLedger"), tab === "ledger");
  if (tab === "orders") loadOrdersTab();
  if (tab === "ledger") loadLedgerTab();
  if (tab === "rewards" && state.loaded && Date.now() - state.loadedAt > AUTO_REFRESH_AFTER_MS) {
    loadBank({ silent: true });
  }
}


/* ============================================================
   07 — الأحداث والتشغيل
   ============================================================ */

function bindEvents() {
  $("bkRefreshBtn").addEventListener("click", () => {
    ordersCache = null; ledgerCache = null;
    loadBank({ silent: true });
  });
  $("bkRetryBtn").addEventListener("click", () => loadBank());
  $("bkOrdersRetry").addEventListener("click", () => { ordersCache = null; loadOrdersTab(); });
  $("bkLedgerRetry").addEventListener("click", () => { ledgerCache = null; loadLedgerTab(); });

  document.querySelectorAll(".bk-tab").forEach((b) => {
    b.addEventListener("click", () => switchTab(b.dataset.tab));
  });

  $("bkConfirmBack").addEventListener("click", closeConfirm);
  $("bkConfirmOk").addEventListener("click", confirmOrder);
  $("bkConfirmOverlay").addEventListener("click", (e) => {
    if (e.target === $("bkConfirmOverlay")) closeConfirm();
  });
  $("bkResultClose").addEventListener("click", () => setOverlay("bkResultOverlay", false));
  $("bkResultOverlay").addEventListener("click", (e) => {
    if (e.target === $("bkResultOverlay")) setOverlay("bkResultOverlay", false);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if ($("bkResultOverlay").classList.contains("is-open")) setOverlay("bkResultOverlay", false);
    else if ($("bkConfirmOverlay").classList.contains("is-open")) closeConfirm();
  });

  // تحديث تلقائي عند العودة للصفحة بعد فترة (الأسعار/الكميات قد تتغير)
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (state.tab !== "rewards" || !state.loaded) return;
    if (state.pending) return;
    if (Date.now() - state.loadedAt > AUTO_REFRESH_AFTER_MS) loadBank({ silent: true });
  });
}

async function init() {
  const session = requireStudent();
  if (!session) return;

  const slot = $("bottomNavSlot");
  slot.replaceChildren();
  slot.appendChild(renderBottomNav());

  bindEvents();
  await loadBank();
}

onReady(init);
