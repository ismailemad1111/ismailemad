/**
 * events.js
 * ------------------------------------------------------------
 * تشغيل صفحة events.html — قائمة الأحداث والألعاب للطالب.
 * البيانات من Firestore عبر js/api.js. النصوص القادمة من قاعدة البيانات
 * تُعرض بـ textContent فقط. الحماية الفعلية في firestore.rules.
 * ------------------------------------------------------------
 */

import { onReady } from "./helpers.js";
import { requireStudent } from "./router.js";
import { getEvents } from "./api.js";
import { renderBottomNav } from "./components.js";
import {
  $, el, iconEl, show, errMsg, PHASE, TYPE_LABELS, STAGE_LABELS,
  phaseOf, fmtShort, toMs
} from "./event-utils.js";

import { barai } from "./barai/safe.js";

const state = {
  events: [],
  participations: {},
  filter: "all",
  loading: false,
  loaded: false,
  loadedAt: 0
};

const AUTO_REFRESH_AFTER_MS = 60000;

function setView(view) { // loading | list | empty | error
  show($("evSkeleton"), view === "loading");
  show($("evGrid"), view === "list");
  show($("evEmpty"), view === "empty");
  show($("evError"), view === "error");
}

function participationBadge(p) {
  if (!p) return null;
  if (p.status === "completed") return el("span", { class: "ev-badge is-done", text: "أكملت" });
  return el("span", { class: "ev-badge is-pending", text: "سجّلت مشاركتك" });
}

function buildCard(ev, p) {
  const phase = phaseOf(ev);
  const href = `event.html?id=${encodeURIComponent(ev.id)}`;

  const media = el("div", { class: "ev-media" });
  if (ev.imageUrl) {
    const img = el("img", { attrs: { src: ev.imageUrl, alt: "", loading: "lazy" } });
    media.appendChild(img);
  } else {
    media.appendChild(iconEl(ev.type === "game" ? "rocket" : "calendar"));
  }
  media.appendChild(el("span", { class: `ev-badge ${PHASE[phase].cls}`, text: PHASE[phase].label }));

  const metaDate = el("p", { class: "ev-meta" }, [
    iconEl("clock"),
    el("span", { text: `من ${fmtShort(ev.startAt)} إلى ${fmtShort(ev.endAt)}` })
  ]);

  const foot = el("div", { class: "ev-card-foot" }, [
    el("span", { class: "ev-badge is-type", text: TYPE_LABELS[ev.type] || TYPE_LABELS.activity }),
    participationBadge(p) || el("span", { class: "ev-link", text: "عرض التفاصيل" })
  ]);

  const body = el("div", { class: "ev-card-body" }, [
    el("h2", { class: "ev-card-title", text: ev.title }),
    ev.description ? el("p", { class: "ev-card-desc", text: ev.description }) : null,
    metaDate,
    ev.stage && ev.stage !== "all"
      ? el("p", { class: "ev-meta" }, [iconEl("graduation-cap"), el("span", { text: STAGE_LABELS[ev.stage] || ev.stage })])
      : null,
    foot
  ]);

  const card = el("a", { class: `ev-card${phase === "ended" ? " is-ended" : ""}`, attrs: { href } }, [media, body]);
  return card;
}

function counts() {
  const c = { all: state.events.length, live: 0, upcoming: 0, ended: 0 };
  state.events.forEach((e) => { c[phaseOf(e)] += 1; });
  return c;
}

function render() {
  const c = counts();
  $("evCountAll").textContent = c.all ? `(${c.all})` : "";
  $("evCountLive").textContent = c.live ? `(${c.live})` : "";
  $("evCountUpcoming").textContent = c.upcoming ? `(${c.upcoming})` : "";
  $("evCountEnded").textContent = c.ended ? `(${c.ended})` : "";

  const rank = { live: 0, upcoming: 1, ended: 2 };
  const rows = state.events
    .filter((e) => state.filter === "all" || phaseOf(e) === state.filter)
    .sort((a, b) => {
      const pa = rank[phaseOf(a)];
      const pb = rank[phaseOf(b)];
      if (pa !== pb) return pa - pb;
      // الجارية: الأقرب انتهاءً أولًا، القادمة: الأقرب بدءًا، المنتهية: الأحدث أولًا
      if (pa === 0) return toMs(a.endAt) - toMs(b.endAt);
      if (pa === 1) return toMs(a.startAt) - toMs(b.startAt);
      return toMs(b.endAt) - toMs(a.endAt);
    });

  $("evCount").textContent = state.events.length
    ? `${rows.length} من ${state.events.length} حدث`
    : "لا توجد أحداث";

  if (!rows.length) {
    const none = state.events.length === 0;
    $("evEmptyTitle").textContent = none ? "لا توجد أحداث الآن" : "لا توجد أحداث في هذا القسم";
    $("evEmptyText").textContent = none
      ? "سيعلن الأستاذ إسماعيل عن الأحداث والألعاب قريبًا. عد لاحقًا واضغط «تحديث»."
      : "جرّب قسمًا آخر من الأعلى.";
    setView("empty");
    return;
  }

  const grid = $("evGrid");
  grid.replaceChildren(...rows.map((e) => buildCard(e, state.participations[e.id])));
  setView("list");
}

async function load({ silent = false } = {}) {
  if (state.loading) return;
  state.loading = true;
  const btn = $("evRefreshBtn");
  btn.disabled = true;
  btn.classList.add("is-spinning");
  if (!silent && !state.loaded) setView("loading");

  const res = await getEvents();

  state.loading = false;
  btn.disabled = false;
  btn.classList.remove("is-spinning");

  if (!res || !res.success) {
    if (state.loaded) {
      // نُبقي القائمة الحالية ونكتفي برسالة
      $("evCount").textContent = errMsg(res, "تعذر التحديث. حاول مرة أخرى.");
      return;
    }
    $("evErrorText").textContent = errMsg(res, "تأكد من اتصالك بالإنترنت وحاول مرة أخرى.");
    setView("error");
    return;
  }

  state.events = (res.data && res.data.events) || [];
  state.participations = (res.data && res.data.participations) || {};
  state.loaded = true;
  state.loadedAt = Date.now();
  render();

  try {
    const live = state.events.filter((e) => e && e.id && phaseOf(e) === "live");
    if (live.length) {
      barai.fresh("events", live.map((e) => e.id)).then((ids) => { if (ids && ids.length) barai.notify("event.live", { id: ids[0], commit: { group: "events", ids } }); barai.settle(); });
    } else if (state.events.length === 0) barai.empty(document.getElementById("evEmpty"), "empty.events");
  } catch (e) { /* برعي تجميلي فقط */ }
}

function bind() {
  $("evRefreshBtn").addEventListener("click", () => load({ silent: true }));
  $("evRetryBtn").addEventListener("click", () => load());

  document.querySelectorAll(".ev-chip").forEach((b) => {
    b.addEventListener("click", () => {
      state.filter = b.dataset.filter;
      document.querySelectorAll(".ev-chip").forEach((x) => {
        const active = x === b;
        x.classList.toggle("is-active", active);
        x.setAttribute("aria-selected", active ? "true" : "false");
      });
      if (state.loaded) render();
    });
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || !state.loaded) return;
    if (Date.now() - state.loadedAt > AUTO_REFRESH_AFTER_MS) load({ silent: true });
  });
}

async function init() {
  const session = requireStudent();
  if (!session) return;

  const slot = $("bottomNavSlot");
  slot.replaceChildren();
  slot.appendChild(renderBottomNav());

  bind();
  await load();
}

onReady(init);
