/**
 * admin-bank.js
 * ------------------------------------------------------------
 * تشغيل صفحة admin/bank.html — إدارة بنك مستر إسماعيل.
 * لا يوجد حذف في أي مكان: الجوائز تُخفى، والسجلات التاريخية ثابتة.
 * رسائل النجاح لا تظهر إلا بعد أن يرد الباك إند بنجاح الحفظ في Firestore.
 * كل النصوص القادمة من قاعدة البيانات تُعرض بـ textContent.
 * ------------------------------------------------------------
 */

import { onReady, showToast, formatDate, debounce } from "./helpers.js";
import { requireAdmin } from "./router.js";
import { backendRequest } from "./backend/index.js";

const ORDER_STATUS = {
  pending:   { label: "قيد المراجعة", cls: "abk-chip--warn" },
  accepted:  { label: "مقبول", cls: "abk-chip--info" },
  ready:     { label: "جاهز للتسليم", cls: "abk-chip--info" },
  delivered: { label: "تم التسليم", cls: "abk-chip--ok" },
  rejected:  { label: "مرفوض", cls: "abk-chip--bad" }
};
const NEXT_ACTIONS = {
  pending:  [["accepted", "قبول"], ["rejected", "رفض"]],
  accepted: [["ready", "جاهز للتسليم"], ["delivered", "تم التسليم"], ["rejected", "رفض"]],
  ready:    [["delivered", "تم التسليم"], ["rejected", "رفض"]]
};
const TX_TYPE = { credit: "إضافة", debit: "خصم", purchase: "طلب جائزة", refund: "استرجاع" };
const BAN_STATE = {
  active:  { label: "ساري", cls: "abk-chip--bad" },
  expired: { label: "منتهي", cls: "" },
  lifted:  { label: "تم رفعه", cls: "abk-chip--ok" }
};
const MAX_IMAGE_CHARS = 240000;

const $ = (id) => document.getElementById(id);
const api = (endpoint, options) => backendRequest(endpoint, options);
const fmtNum = (n) => Number(n || 0).toLocaleString("en-US");
const show = (n, v) => { if (n) n.hidden = !v; };

function el(tag, opts = {}, children = []) {
  const n = document.createElement(tag);
  if (opts.class) n.className = opts.class;
  if (opts.text !== undefined) n.textContent = opts.text;
  if (opts.attrs) Object.entries(opts.attrs).forEach(([k, v]) => n.setAttribute(k, v));
  children.forEach((c) => { if (c) n.appendChild(c); });
  return n;
}
function btn(label, cls, onClick) {
  const b = el("button", { class: `abk-btn abk-btn--sm ${cls || ""}`.trim(), text: label, attrs: { type: "button" } });
  b.addEventListener("click", onClick);
  return b;
}
function chip(label, cls) { return el("span", { class: `abk-chip ${cls || ""}`.trim(), text: label }); }
function newKey() {
  if (crypto && crypto.randomUUID) return crypto.randomUUID().replace(/-/g, "");
  return (Math.random().toString(36).slice(2) + Date.now().toString(36) + "0000000000").slice(0, 24);
}
function setOverlay(id, open) {
  const o = $(id);
  o.classList.toggle("is-open", open);
  o.setAttribute("aria-hidden", open ? "false" : "true");
}
function failMsg(res, fallback) {
  return (res && res.error && res.error.message) || fallback;
}

const state = {
  rewards: [], students: [], orders: [], bans: [],
  loaded: { rewards: false, wallets: false, orders: false, bans: false },
  tab: "rewards",
  selectedStudent: null
};

/* ============================================================
   تحميل لكل قسم (حالات تحميل/فارغ/خطأ)
   ============================================================ */

function panelState(name, s) { // s: loading | list | empty | error
  const map = {
    rewards: ["abkRewardsLoading", "abkRewardsGrid", "abkRewardsEmpty", "abkRewardsError"],
    wallets: ["abkStudentsLoading", "abkStudentsList", "abkStudentsEmpty", "abkStudentsError"],
    orders:  ["abkOrdersLoading", "abkOrdersList", "abkOrdersEmpty", "abkOrdersError"],
    bans:    ["abkBansLoading", "abkBansList", "abkBansEmpty", "abkBansError"]
  }[name];
  ["loading", "list", "empty", "error"].forEach((k, i) => show($(map[i]), k === s));
}

async function load(name) {
  const endpoint = {
    rewards: "/api/admin/bank/rewards",
    wallets: "/api/admin/bank/students",
    orders: "/api/admin/bank/orders",
    bans: "/api/admin/bank/bans"
  }[name];
  if (!state.loaded[name]) panelState(name, "loading");
  const res = await api(endpoint);
  if (!res || !res.success) {
    if (!state.loaded[name]) panelState(name, "error");
    showToast(failMsg(res, "تعذر تحميل البيانات."), "error");
    return false;
  }
  if (name === "rewards") state.rewards = res.data.rewards;
  if (name === "wallets") state.students = res.data.students;
  if (name === "orders") state.orders = res.data.orders;
  if (name === "bans") state.bans = res.data.bans;
  state.loaded[name] = true;
  render(name);
  return true;
}

function render(name) {
  if (name === "rewards") renderRewards();
  if (name === "wallets") renderStudents();
  if (name === "orders") { renderOrders(); updateBadges(); }
  if (name === "bans") { renderBans(); updateBadges(); }
}

function updateBadges() {
  const pending = state.orders.filter((o) => o.status === "pending").length;
  const act = state.bans.filter((b) => b.state === "active").length;
  $("abkOrdersCount").textContent = String(pending); show($("abkOrdersCount"), pending > 0);
  $("abkBansCount").textContent = String(act); show($("abkBansCount"), act > 0);
}

/* ============================================================
   الجوائز
   ============================================================ */

function renderRewards() {
  const q = $("abkRewardSearch").value.trim();
  const f = $("abkRewardFilter").value;
  const rows = state.rewards.filter((r) =>
    (!q || r.name.includes(q)) &&
    (f === "all" || (f === "published" ? r.published : !r.published)));
  const grid = $("abkRewardsGrid");
  grid.replaceChildren();
  if (!rows.length) { panelState("rewards", "empty"); return; }
  rows.forEach((r) => {
    const media = el("div", { class: "abk-card-media" });
    if (r.imageUrl) media.appendChild(el("img", { attrs: { src: r.imageUrl, alt: r.name, loading: "lazy" } }));
    else media.appendChild(el("span", { class: "icon icon-trophy", attrs: { "aria-hidden": "true" } }));

    const chips = el("div", { class: "abk-chips" }, [
      chip(`${fmtNum(r.price)} فلوس`, "abk-chip--warn"),
      chip(r.published ? "منشورة" : "مخفية", r.published ? "abk-chip--ok" : ""),
      chip(r.requestable ? "متاحة للطلب" : "غير متاحة للطلب", r.requestable ? "abk-chip--info" : ""),
      chip(r.limited ? `المتبقي: ${fmtNum(r.stock)}` : "كمية مفتوحة", r.limited && r.stock === 0 ? "abk-chip--bad" : "")
    ]);
    const actions = el("div", { class: "abk-actions" }, [
      btn("تعديل", "", () => openReward(r)),
      btn(r.published ? "إخفاء" : "نشر", "", () => quickPatch(r, { published: !r.published },
        r.published ? "تم إخفاء الجائزة" : "تم نشر الجائزة")),
      btn(r.requestable ? "إيقاف الطلب" : "السماح بالطلب", "", () => quickPatch(r, { requestable: !r.requestable },
        r.requestable ? "تم إيقاف الطلب على الجائزة" : "أصبحت الجائزة متاحة للطلب"))
    ]);
    grid.appendChild(el("article", { class: "abk-card" }, [
      media,
      el("div", { class: "abk-card-body" }, [
        el("h3", { class: "abk-card-name", text: r.name }),
        r.description ? el("p", { class: "abk-card-desc", text: r.description }) : null,
        chips, actions
      ])
    ]));
  });
  panelState("rewards", "list");
}

async function quickPatch(r, patch, okMsg) {
  const res = await api(`/api/admin/bank/rewards/${encodeURIComponent(r.id)}`, { method: "PATCH", body: patch });
  if (!res.success) { showToast(failMsg(res, "تعذر الحفظ."), "error"); return; }
  showToast(okMsg + " ✅", "success");
  await load("rewards");
}

/* ----- نافذة الجائزة ----- */
let editing = null;       // الجائزة قيد التعديل أو null
let imageData = "";       // data URL الحالي
let rewardBusy = false;

function openReward(r) {
  editing = r || null;
  $("abkRewardTitle").textContent = r ? "تعديل جائزة" : "جائزة جديدة";
  $("abkRName").value = r ? r.name : "";
  $("abkRDesc").value = r ? r.description : "";
  $("abkRPrice").value = r ? r.price : "";
  $("abkRLimited").checked = r ? r.limited : false;
  $("abkRStock").value = r && r.limited ? r.stock : "";
  show($("abkRStockWrap"), $("abkRLimited").checked);
  $("abkRPublished").checked = r ? r.published : false;
  $("abkRRequestable").checked = r ? r.requestable : true;
  $("abkRImage").value = "";
  setImage(r ? r.imageUrl : "");
  show($("abkRewardError"), false);
  $("abkRSave").disabled = false; $("abkRSave").textContent = "حفظ";
  setOverlay("abkRewardOverlay", true);
  $("abkRName").focus();
}
function setImage(data) {
  imageData = data || "";
  const p = $("abkRPreview");
  if (imageData) p.src = imageData; else p.removeAttribute("src");
  show(p, !!imageData);
  show($("abkRImageClear"), !!imageData);
}

/** يصغّر الصورة ويحوّلها إلى JPEG data URL ضمن الحد المسموح */
function compressImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        let side = 640;
        for (let attempt = 0; attempt < 6; attempt++) {
          const ratio = Math.min(1, side / Math.max(img.width, img.height));
          const c = document.createElement("canvas");
          c.width = Math.max(1, Math.round(img.width * ratio));
          c.height = Math.max(1, Math.round(img.height * ratio));
          const ctx = c.getContext("2d");
          ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
          ctx.drawImage(img, 0, 0, c.width, c.height);
          for (const q of [0.82, 0.7, 0.55]) {
            const out = c.toDataURL("image/jpeg", q);
            if (out.length <= MAX_IMAGE_CHARS) { URL.revokeObjectURL(url); resolve(out); return; }
          }
          side = Math.round(side * 0.75);
        }
        reject(new Error("big"));
      } catch (e) { reject(e); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("bad")); };
    img.src = url;
  });
}

async function saveReward() {
  if (rewardBusy) return;
  const errBox = $("abkRewardError");
  const name = $("abkRName").value.trim();
  const priceRaw = $("abkRPrice").value.trim();
  const price = Number(priceRaw);
  const limited = $("abkRLimited").checked;
  const stockRaw = $("abkRStock").value.trim();
  const stock = Number(stockRaw);

  const problems = [];
  if (!name) problems.push("اكتب اسم الجائزة.");
  if (!priceRaw || !Number.isInteger(price) || price < 1) problems.push("السعر يجب أن يكون رقمًا صحيحًا أكبر من صفر.");
  if (limited && (!stockRaw || !Number.isInteger(stock) || stock < 0)) problems.push("الكمية يجب أن تكون رقمًا صحيحًا (0 أو أكثر).");
  if (problems.length) { errBox.textContent = problems.join(" "); show(errBox, true); return; }
  show(errBox, false);

  const body = {
    name, description: $("abkRDesc").value.trim(), price, imageUrl: imageData,
    limited, stock: limited ? stock : null,
    published: $("abkRPublished").checked, requestable: $("abkRRequestable").checked
  };

  rewardBusy = true;
  $("abkRSave").disabled = true; $("abkRSave").textContent = "جارٍ الحفظ…";
  const res = editing
    ? await api(`/api/admin/bank/rewards/${encodeURIComponent(editing.id)}`, { method: "PATCH", body })
    : await api("/api/admin/bank/rewards", { method: "POST", body });
  rewardBusy = false;

  if (!res.success) {
    errBox.textContent = failMsg(res, "تعذر حفظ الجائزة.");
    show(errBox, true);
    $("abkRSave").disabled = false; $("abkRSave").textContent = "حفظ";
    return;
  }
  setOverlay("abkRewardOverlay", false);
  showToast(editing ? "تم حفظ التعديلات ✅" : "تمت إضافة الجائزة ✅", "success");
  await load("rewards");
}

/* ============================================================
   أرصدة الطلاب
   ============================================================ */

function renderStudents() {
  const q = $("abkStudentSearch").value.trim();
  const rows = state.students.filter((s) => !q || s.fullName.includes(q) || s.code.includes(q)).slice(0, 60);
  const list = $("abkStudentsList");
  list.replaceChildren();
  if (!rows.length) { panelState("wallets", "empty"); return; }
  rows.forEach((s) => {
    const row = el("div", { class: "abk-row" }, [
      el("div", { class: "abk-row-main" }, [
        el("p", { class: "abk-row-title", text: s.fullName || "—" }),
        el("p", { class: "abk-row-sub", text: `الكود: ${s.code || "—"}` })
      ]),
      el("div", { class: "abk-row-side" }, [
        el("span", { class: "abk-num", text: fmtNum(s.balance) }),
        s.blockedUntil ? chip("ممنوع", "abk-chip--bad") : null,
        btn("إدارة الرصيد", "", () => selectStudent(s.id))
      ])
    ]);
    list.appendChild(row);
  });
  panelState("wallets", "list");
}

async function selectStudent(id) {
  const s = state.students.find((x) => x.id === id);
  if (!s) return;
  state.selectedStudent = s;
  $("abkDetailName").textContent = s.fullName;
  $("abkDetailSub").textContent = `الكود: ${s.code || "—"}` + (s.blockedUntil ? ` — ممنوع حتى ${formatDate(s.blockedUntil)}` : "");
  $("abkDetailBalance").textContent = fmtNum(s.balance);
  $("abkLedger").replaceChildren(el("p", { class: "abk-row-sub", text: "جارٍ تحميل السجل…" }));
  show($("abkStudentDetail"), true);
  $("abkStudentDetail").scrollIntoView({ behavior: "smooth", block: "start" });
  await loadLedger();
}

async function loadLedger() {
  const s = state.selectedStudent;
  if (!s) return;
  const res = await api(`/api/admin/bank/students/${encodeURIComponent(s.id)}/ledger`);
  const box = $("abkLedger");
  if (!res.success) {
    box.replaceChildren(el("p", { class: "abk-error", text: failMsg(res, "تعذر تحميل السجل.") }));
    return;
  }
  $("abkDetailBalance").textContent = fmtNum(res.data.balance);
  box.replaceChildren();
  if (!res.data.transactions.length) {
    box.appendChild(el("p", { class: "abk-row-sub", text: "لا توجد معاملات بعد." }));
    return;
  }
  res.data.transactions.forEach((t) => {
    box.appendChild(el("div", { class: "abk-row" }, [
      el("div", { class: "abk-row-main" }, [
        el("p", { class: "abk-row-title", text: TX_TYPE[t.type] || t.type }),
        el("p", { class: "abk-row-sub", text:
          `${t.reason} — ${formatDate(t.createdAt)} — الرصيد قبل: ${fmtNum(t.balanceBefore)} / بعد: ${fmtNum(t.balanceAfter)}` +
          (t.adminName ? ` — بواسطة ${t.adminName}` : "") })
      ]),
      el("div", { class: "abk-row-side" }, [
        el("span", { class: `abk-num ${t.amount >= 0 ? "is-plus" : "is-minus"}`, text: `${t.amount >= 0 ? "+" : "−"}${fmtNum(Math.abs(t.amount))}` })
      ])
    ]));
  });
}

/* ----- نافذة الإضافة/الخصم ----- */
let adjust = null; // { type, requestKey, busy }

function openAdjust(type) {
  const s = state.selectedStudent;
  if (!s) return;
  adjust = { type, requestKey: newKey(), busy: false };
  $("abkAdjustTitle").textContent = type === "credit" ? "إضافة رصيد" : "خصم رصيد";
  $("abkAdjustSub").textContent = `${s.fullName} — الرصيد الحالي ${$("abkDetailBalance").textContent}`;
  $("abkAAmount").value = ""; $("abkAReason").value = "";
  show($("abkAdjustError"), false);
  $("abkAConfirm").disabled = false; $("abkAConfirm").textContent = "تأكيد";
  setOverlay("abkAdjustOverlay", true);
  $("abkAAmount").focus();
}
async function confirmAdjust() {
  if (!adjust || adjust.busy) return;
  const s = state.selectedStudent;
  const amount = Number($("abkAAmount").value);
  const reason = $("abkAReason").value.trim();
  const err = $("abkAdjustError");
  if (!Number.isInteger(amount) || amount < 1) { err.textContent = "المبلغ يجب أن يكون رقمًا صحيحًا أكبر من صفر."; show(err, true); return; }
  if (reason.length < 3) { err.textContent = "اكتب سبب المعاملة (3 أحرف على الأقل)."; show(err, true); return; }
  show(err, false);

  adjust.busy = true;
  $("abkAConfirm").disabled = true; $("abkAConfirm").textContent = "جارٍ الحفظ…";
  const res = await api(`/api/admin/bank/students/${encodeURIComponent(s.id)}/adjust`, {
    method: "POST", body: { type: adjust.type, amount, reason, requestKey: adjust.requestKey }
  });
  adjust.busy = false;

  if (!res.success) {
    err.textContent = failMsg(res, "تعذر حفظ المعاملة.") +
      (res.error && res.error.code === "NETWORK_ERROR" ? " يمكنك إعادة المحاولة بأمان دون تكرار المعاملة." : "");
    show(err, true);
    $("abkAConfirm").disabled = false; $("abkAConfirm").textContent = "تأكيد";
    return;
  }
  setOverlay("abkAdjustOverlay", false);
  showToast(`${adjust.type === "credit" ? "تمت الإضافة" : "تم الخصم"} — الرصيد الجديد ${fmtNum(res.data.balance)} ✅`, "success");
  adjust = null;
  await load("wallets");
  const fresh = state.students.find((x) => x.id === s.id);
  if (fresh) state.selectedStudent = fresh;
  await loadLedger();
}

/* ============================================================
   نافذة السبب العامة (رفض طلب / رفع منع)
   ============================================================ */

let reasonCtx = null;
function askReason({ title, sub, confirmLabel, run }) {
  reasonCtx = { run, busy: false };
  $("abkReasonTitle").textContent = title;
  $("abkReasonSub").textContent = sub;
  $("abkReasonText").value = "";
  show($("abkReasonError"), false);
  $("abkReasonConfirm").textContent = confirmLabel || "تأكيد";
  $("abkReasonConfirm").disabled = false;
  setOverlay("abkReasonOverlay", true);
  $("abkReasonText").focus();
}
async function confirmReason() {
  if (!reasonCtx || reasonCtx.busy) return;
  const reason = $("abkReasonText").value.trim();
  const err = $("abkReasonError");
  if (reason.length < 3) { err.textContent = "اكتب السبب (3 أحرف على الأقل)."; show(err, true); return; }
  show(err, false);
  reasonCtx.busy = true;
  $("abkReasonConfirm").disabled = true;
  const res = await reasonCtx.run(reason);
  reasonCtx.busy = false;
  if (!res.success) {
    err.textContent = failMsg(res, "تعذر تنفيذ العملية.");
    show(err, true);
    $("abkReasonConfirm").disabled = false;
    return;
  }
  setOverlay("abkReasonOverlay", false);
  reasonCtx = null;
}

/* ============================================================
   الطلبات
   ============================================================ */

function renderOrders() {
  const f = $("abkOrderFilter").value;
  const q = $("abkOrderSearch").value.trim();
  const rows = state.orders.filter((o) =>
    (f === "all" || o.status === f) &&
    (!q || o.studentName.includes(q) || o.rewardName.includes(q) || o.studentCode.includes(q)));
  const list = $("abkOrdersList");
  list.replaceChildren();
  if (!rows.length) { panelState("orders", "empty"); return; }
  rows.forEach((o) => {
    const st = ORDER_STATUS[o.status] || { label: o.status, cls: "" };
    const actions = el("div", { class: "abk-actions" });
    (NEXT_ACTIONS[o.status] || []).forEach(([to, label]) => {
      actions.appendChild(btn(label, to === "rejected" ? "abk-btn--danger" : (to === "accepted" ? "abk-btn--primary" : ""),
        () => changeStatus(o, to)));
    });
    let sub = `${o.studentName} (كود ${o.studentCode || "—"}) — ${formatDate(o.createdAt)} — الرصيد: ${fmtNum(o.balanceBefore)} ← ${fmtNum(o.balanceAfter)}`;
    if (o.status === "rejected") sub += ` — سبب الرفض: ${o.rejectReason} (تم الاسترجاع)`;
    if (o.status === "delivered" && o.deliveredAt) sub += ` — سُلّمت في ${formatDate(o.deliveredAt)}`;
    list.appendChild(el("div", { class: "abk-row" }, [
      el("div", { class: "abk-row-main" }, [
        el("p", { class: "abk-row-title", text: o.rewardName }),
        el("p", { class: "abk-row-sub", text: sub }),
        actions
      ]),
      el("div", { class: "abk-row-side" }, [
        el("span", { class: "abk-num", text: `${fmtNum(o.price)}` }),
        chip(st.label, st.cls)
      ])
    ]));
  });
  panelState("orders", "list");
}

async function changeStatus(order, to) {
  if (to === "rejected") {
    askReason({
      title: "رفض الطلب",
      sub: `سيُسترجع ${fmtNum(order.price)} فلوس إلى رصيد ${order.studentName} تلقائيًا وتعود الكمية للمخزون. لا يمكن التراجع عن الرفض.`,
      confirmLabel: "رفض واسترجاع",
      run: async (reason) => {
        const res = await api(`/api/admin/bank/orders/${encodeURIComponent(order.id)}/status`, { method: "PATCH", body: { status: "rejected", reason } });
        if (res.success) { showToast("تم رفض الطلب واسترجاع المبلغ ✅", "success"); await refreshOrdersAndRewards(); }
        return res;
      }
    });
    return;
  }
  const res = await api(`/api/admin/bank/orders/${encodeURIComponent(order.id)}/status`, { method: "PATCH", body: { status: to } });
  if (!res.success) { showToast(failMsg(res, "تعذر تغيير الحالة."), "error"); await load("orders"); return; }
  showToast(`تم تغيير الحالة إلى «${ORDER_STATUS[to].label}» ✅`, "success");
  await load("orders");
}
async function refreshOrdersAndRewards() {
  await Promise.all([load("orders"), state.loaded.rewards ? load("rewards") : null, state.loaded.wallets ? load("wallets") : null]);
}

/* ============================================================
   المنع
   ============================================================ */

function renderBans() {
  const onlyActive = $("abkBanFilter").value === "active";
  const rows = state.bans.filter((b) => !onlyActive || b.state === "active");
  const list = $("abkBansList");
  list.replaceChildren();
  if (!rows.length) { panelState("bans", "empty"); return; }
  rows.forEach((b) => {
    const st = BAN_STATE[b.state] || BAN_STATE.expired;
    let sub = `السبب: رصيد غير كافٍ عند طلب «${b.rewardName}» (${fmtNum(b.price)}) برصيد ${fmtNum(b.balanceAtAttempt)} — ` +
      `من ${formatDate(b.startsAt)} إلى ${formatDate(b.endsAt)}`;
    if (b.state === "lifted") sub += ` — رُفع بواسطة ${b.liftedByName || "الأدمن"} في ${formatDate(b.liftedAt)}: ${b.liftReason}`;
    const side = el("div", { class: "abk-row-side" }, [chip(st.label, st.cls)]);
    if (b.state === "active") {
      side.appendChild(btn("رفع المنع", "", () => askReason({
        title: "رفع المنع",
        sub: `سيتمكن ${b.studentName} من الطلب فورًا. يبقى سجل المنع الأصلي محفوظًا مع سبب الرفع.`,
        confirmLabel: "رفع المنع",
        run: async (reason) => {
          const res = await api(`/api/admin/bank/bans/${encodeURIComponent(b.id)}/lift`, { method: "POST", body: { reason } });
          if (res.success) {
            showToast("تم رفع المنع ✅", "success");
            await Promise.all([load("bans"), state.loaded.wallets ? load("wallets") : null]);
          }
          return res;
        }
      })));
    }
    list.appendChild(el("div", { class: "abk-row" }, [
      el("div", { class: "abk-row-main" }, [
        el("p", { class: "abk-row-title", text: `${b.studentName} (كود ${b.studentCode || "—"})` }),
        el("p", { class: "abk-row-sub", text: sub })
      ]),
      side
    ]));
  });
  panelState("bans", "list");
}

/* ============================================================
   التبويبات والأحداث
   ============================================================ */

function switchTab(tab) {
  state.tab = tab;
  document.querySelectorAll(".abk-tab").forEach((b) => {
    const a = b.dataset.tab === tab;
    b.classList.toggle("is-active", a);
    b.setAttribute("aria-selected", a ? "true" : "false");
  });
  ["rewards", "wallets", "orders", "bans"].forEach((t) => show($(`abkPanel-${t}`), t === tab));
  show($("abkAddReward"), tab === "rewards");
  if (!state.loaded[tab]) load(tab);
}

function bindEvents() {
  document.querySelectorAll(".abk-tab").forEach((b) => b.addEventListener("click", () => switchTab(b.dataset.tab)));
  document.querySelectorAll("[data-retry]").forEach((b) => b.addEventListener("click", () => load(b.dataset.retry)));

  $("abkAddReward").addEventListener("click", () => openReward(null));
  $("abkRewardSearch").addEventListener("input", debounce(renderRewards, 200));
  $("abkRewardFilter").addEventListener("change", renderRewards);
  $("abkRLimited").addEventListener("change", () => show($("abkRStockWrap"), $("abkRLimited").checked));
  $("abkRImage").addEventListener("change", async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    try { setImage(await compressImage(f)); }
    catch (x) { e.target.value = ""; showToast("تعذر استخدام هذه الصورة. جرّب صورة أخرى.", "error"); }
  });
  $("abkRImageClear").addEventListener("click", () => { $("abkRImage").value = ""; setImage(""); });
  $("abkRCancel").addEventListener("click", () => { if (!rewardBusy) setOverlay("abkRewardOverlay", false); });
  $("abkRSave").addEventListener("click", saveReward);

  $("abkStudentSearch").addEventListener("input", debounce(renderStudents, 200));
  $("abkCreditBtn").addEventListener("click", () => openAdjust("credit"));
  $("abkDebitBtn").addEventListener("click", () => openAdjust("debit"));
  $("abkACancel").addEventListener("click", () => { if (!adjust || !adjust.busy) setOverlay("abkAdjustOverlay", false); });
  $("abkAConfirm").addEventListener("click", confirmAdjust);

  $("abkOrderFilter").addEventListener("change", renderOrders);
  $("abkOrderSearch").addEventListener("input", debounce(renderOrders, 200));
  $("abkBanFilter").addEventListener("change", renderBans);

  $("abkReasonCancel").addEventListener("click", () => { if (!reasonCtx || !reasonCtx.busy) setOverlay("abkReasonOverlay", false); });
  $("abkReasonConfirm").addEventListener("click", confirmReason);
}

async function init() {
  const session = requireAdmin();
  if (!session) return;
  bindEvents();
  await load("rewards");
  // تحميل هادئ للطلبات والمنع لعرض شارات العدد
  load("orders"); load("bans");
}

onReady(init);
