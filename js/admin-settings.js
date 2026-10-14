/**
 * admin-settings.js
 * ------------------------------------------------------------
 * منصة أ/ إسماعيل عماد التعليمية
 * تشغيل صفحة admin/settings.html
 *
 * المكان: /js/admin-settings.js
 *
 * المرجع:
 *   - الوثيقة الأصلية (بنود 87، 88، 103، 180)
 *   - Master Design System (بند 58)
 *
 * ⚠️ قواعد:
 *   - لا Secrets في الإعدادات (بند 103).
 *   - التحقق والصلاحيات داخل طبقة Firestore المحلية (بند 109).
 *   - كل نص في textContent (بند 124).
 *
 * ⚠️ حالة الملف:
 *   - لا يعتمد الملف على Worker خارجي.
 *   - workerFetch تستدعي طبقة Firestore المحلية.
 * ------------------------------------------------------------
 */


import {
  onReady,
  safeText,
  showToast,
  formatDate
} from "./helpers.js";

import {
  requireAdmin,
  getSession
} from "./router.js";


/* ============================================================
   01 — ثوابت
   ============================================================ */

const REQUEST_TIMEOUT_MS = 20000;

const ERRORS = {
  NETWORK_ERROR: "NETWORK_ERROR",
  TIMEOUT:       "TIMEOUT",
  SERVER_ERROR:  "SERVER_ERROR",
  UNAUTHORIZED:  "UNAUTHORIZED",
  NOT_FOUND:     "NOT_FOUND",
  BAD_REQUEST:   "BAD_REQUEST"
};

const ERROR_MESSAGES = {
  NETWORK_ERROR: "لا يوجد اتصال بالإنترنت.",
  TIMEOUT:       "انتهت مدة الطلب.",
  SERVER_ERROR:  "حدث خطأ. حاول مرة أخرى.",
  UNAUTHORIZED:  "انتهت الجلسة.",
  NOT_FOUND:     "العنصر غير موجود.",
  BAD_REQUEST:   "البيانات المُرسَلة غير صحيحة."
};

const STAGE_NAMES = {
  grade_4: "الرابع الابتدائي",
  grade_5: "الخامس الابتدائي",
  grade_6: "السادس الابتدائي",
  prep_1:  "الأول الإعدادي",
  prep_2:  "الثاني الإعدادي",
  prep_3:  "الثالث الإعدادي",
  sec_1:   "الأول الثانوي",
  sec_2:   "الثاني الثانوي",
  sec_3:   "الثالث الثانوي"
};

function getStageName(key) {
  const k = safeText(key);
  return STAGE_NAMES[k] || "—";
}


/* ============================================================
   02 — المرجع للعناصر
   ============================================================ */

let headerSubEl       = null;

let tabsEl            = null;

// Groups Panel
let addGroupBtn       = null;
let groupsSkeletonEl  = null;
let groupsListEl      = null;
let groupsEmptyEl     = null;
let groupsErrorEl     = null;
let groupsRetryBtn    = null;

// General Panel
let generalFormEl     = null;
let academicYearEl    = null;
let platformNameEl    = null;
let passingPercentEl   = null;
let subscriptionsSw   = null;
let prayerSw          = null;
let aiSw              = null;
let saveGeneralBtn    = null;

// Group Modal
let groupModalEl      = null;
let groupModalTitleEl = null;
let groupModalSubEl   = null;
let groupNameInput    = null;
let groupStageSel     = null;
let groupActiveSw     = null;
let groupCancelBtn    = null;
let groupConfirmBtn   = null;


/* ============================================================
   03 — الحالة
   ============================================================ */

let groups = [];
let settings = {};
let isLoadingGroups = false;
let isLoadingSettings = false;

let editingGroupId = null;
let isSavingGroup = false;
let isSavingSettings = false;

// حالة عامة للـ switches
let switchesState = {
  subscriptions: true,
  prayer: true,
  ai: true
};

let groupActiveState = true;


/* ============================================================
   04 — طلب HTTP موحد
   ============================================================ */

import { backendRequest } from "./backend/index.js";
async function workerFetch(endpoint, options = {}) {
  // بدون Worker: التنفيذ داخل المتصفح عبر Firestore (js/backend/)
  return backendRequest(endpoint, options);
}


/* ============================================================
   05 — تجميع العناصر
   ============================================================ */

function cacheElements() {
  headerSubEl       = document.getElementById("stHeaderSub");
  tabsEl            = document.querySelector(".st-tabs");
  passingPercentEl  = document.getElementById("stPassingPercent");

  addGroupBtn       = document.getElementById("stAddGroupBtn");
  groupsSkeletonEl  = document.getElementById("stGroupsSkeleton");
  groupsListEl      = document.getElementById("stGroupsList");
  groupsEmptyEl     = document.getElementById("stGroupsEmpty");
  groupsErrorEl     = document.getElementById("stGroupsError");
  groupsRetryBtn    = document.getElementById("stGroupsRetryBtn");

  generalFormEl     = document.getElementById("stGeneralForm");
  academicYearEl    = document.getElementById("stAcademicYear");
  platformNameEl    = document.getElementById("stPlatformName");
  subscriptionsSw   = document.getElementById("stSubscriptionsSwitch");
  prayerSw          = document.getElementById("stPrayerSwitch");
  aiSw              = document.getElementById("stAISwitch");
  saveGeneralBtn    = document.getElementById("stSaveGeneralBtn");

  groupModalEl      = document.getElementById("stGroupModal");
  groupModalTitleEl = document.getElementById("stGroupModalTitle");
  groupModalSubEl   = document.getElementById("stGroupModalSub");
  groupNameInput    = document.getElementById("stGroupNameInput");
  groupStageSel     = document.getElementById("stGroupStageSelect");
  groupActiveSw     = document.getElementById("stGroupActiveSwitch");
  groupCancelBtn    = document.getElementById("stGroupCancelBtn");
  groupConfirmBtn   = document.getElementById("stGroupConfirmBtn");
}


/* ============================================================
   06 — Tabs
   ============================================================ */

function switchTab(tabKey) {
  if (!tabsEl) return;

  tabsEl.querySelectorAll(".st-tab").forEach((tab) => {
    const isActive = tab.dataset.tab === tabKey;
    tab.classList.toggle("is-active", isActive);
    tab.setAttribute("aria-selected", isActive ? "true" : "false");
  });

  document.querySelectorAll(".st-panel").forEach((panel) => {
    const isActive = panel.dataset.panel === tabKey;
    panel.classList.toggle("is-active", isActive);
  });
}

function bindTabs() {
  if (!tabsEl) return;

  tabsEl.querySelectorAll(".st-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      const key = safeText(tab.dataset.tab);
      if (key) switchTab(key);
    });
  });
}


/* ============================================================
   07 — Groups States
   ============================================================ */

function showGroupsLoading() {
  if (groupsSkeletonEl) groupsSkeletonEl.style.display = "";
  if (groupsListEl)     groupsListEl.style.display = "none";
  if (groupsEmptyEl)    groupsEmptyEl.style.display = "none";
  if (groupsErrorEl)    groupsErrorEl.style.display = "none";
}
function showGroupsList() {
  if (groupsSkeletonEl) groupsSkeletonEl.style.display = "none";
  if (groupsListEl)     groupsListEl.style.display = "";
  if (groupsEmptyEl)    groupsEmptyEl.style.display = "none";
  if (groupsErrorEl)    groupsErrorEl.style.display = "none";
}
function showGroupsEmpty() {
  if (groupsSkeletonEl) groupsSkeletonEl.style.display = "none";
  if (groupsListEl)     groupsListEl.style.display = "none";
  if (groupsEmptyEl)    groupsEmptyEl.style.display = "";
  if (groupsErrorEl)    groupsErrorEl.style.display = "none";
}
function showGroupsError() {
  if (groupsSkeletonEl) groupsSkeletonEl.style.display = "none";
  if (groupsListEl)     groupsListEl.style.display = "none";
  if (groupsEmptyEl)    groupsEmptyEl.style.display = "none";
  if (groupsErrorEl)    groupsErrorEl.style.display = "";
}


/* ============================================================
   08 — بناء كارت مجموعة
   ============================================================ */

function createGroupCard(group) {
  const id      = safeText(group && group.id);
  const name    = safeText(group && group.name) || "مجموعة";
  const stage   = safeText(group && group.stage);
  const active  = group && group.active !== false;
  const createdAt = group && group.createdAt;

  const card = document.createElement("article");
  card.className = "st-group" + (active ? "" : " is-inactive");
  card.dataset.groupId = id;

  // Icon
  const icon = document.createElement("div");
  icon.className = "st-group-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = "📚";

  // Body
  const body = document.createElement("div");
  body.className = "st-group-body";

  const nameEl = document.createElement("h3");
  nameEl.className = "st-group-name";
  nameEl.textContent = name;
  body.appendChild(nameEl);

  const meta = document.createElement("div");
  meta.className = "st-group-meta";

  if (stage) {
    const sBadge = document.createElement("span");
    sBadge.className = "st-group-badge";
    const ic = document.createElement("span"); ic.textContent = "🎓";
    const tx = document.createElement("span"); tx.textContent = getStageName(stage);
    sBadge.appendChild(ic); sBadge.appendChild(tx);
    meta.appendChild(sBadge);
  }

  if (!active) {
    const aBadge = document.createElement("span");
    aBadge.className = "st-group-badge st-group-badge--inactive";
    aBadge.textContent = "معطلة";
    meta.appendChild(aBadge);
  }

  if (createdAt) {
    const dItem = document.createElement("span");
    dItem.style.cssText = "display:inline-flex;align-items:center;gap:3px;";
    const ic = document.createElement("span"); ic.textContent = "📅";
    const tx = document.createElement("span"); tx.textContent = formatDate(createdAt) || "—";
    dItem.appendChild(ic); dItem.appendChild(tx);
    meta.appendChild(dItem);
  }

  body.appendChild(meta);
  card.appendChild(icon);
  card.appendChild(body);

  // Actions
  const actions = document.createElement("div");
  actions.className = "st-group-actions";

  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.className = "st-group-btn";
  editBtn.title = "تعديل";
  editBtn.textContent = "✏️";
  editBtn.addEventListener("click", () => openGroupModal(group));
  actions.appendChild(editBtn);

  const delBtn = document.createElement("button");
  delBtn.type = "button";
  delBtn.className = "st-group-btn is-danger";
  delBtn.title = "حذف";
  delBtn.textContent = "🗑️";
  delBtn.addEventListener("click", () => handleDeleteGroup(id, name));
  actions.appendChild(delBtn);

  card.appendChild(actions);

  return card;
}


/* ============================================================
   09 — عرض Groups
   ============================================================ */

function renderGroups() {
  if (!groupsListEl) return;

  if (!Array.isArray(groups) || groups.length === 0) {
    showGroupsEmpty();
    return;
  }

  // ترتيب: الأحدث أولاً
  const sorted = [...groups].sort((a, b) => {
    return toTime(b && b.createdAt) - toTime(a && a.createdAt);
  });

  groupsListEl.replaceChildren();
  sorted.forEach((g) => groupsListEl.appendChild(createGroupCard(g)));
  showGroupsList();
}

function toTime(v) {
  if (!v) return 0;
  if (typeof v.toDate === "function") { try { return v.toDate().getTime(); } catch (e) { return 0; } }
  if (v instanceof Date) return v.getTime();
  if (typeof v === "number") return v;
  if (typeof v === "string") { const t = new Date(v).getTime(); return isNaN(t) ? 0 : t; }
  return 0;
}


/* ============================================================
   10 — تحميل Groups
   ============================================================ */

async function loadGroups() {
  if (isLoadingGroups) return;
  isLoadingGroups = true;

  showGroupsLoading();

  const result = await workerFetch("/api/admin/lesson-groups");

  isLoadingGroups = false;

  if (!result || !result.success) {
    const code = (result && result.error && result.error.code) || ERRORS.SERVER_ERROR;
    if (code === ERRORS.UNAUTHORIZED) {
      showToast(ERROR_MESSAGES.UNAUTHORIZED, "warning");
      setTimeout(() => { window.location.href = "login.html"; }, 1500);
      return;
    }
    showGroupsError();
    return;
  }

  const data = (result.data && typeof result.data === "object") ? result.data : {};
  const list = Array.isArray(data.groups) ? data.groups : [];

  groups = list.filter((g) => g && g.id);

  if (headerSubEl) {
    headerSubEl.textContent = `${groups.length} مجموعة دروس`;
  }

  renderGroups();
}


/* ============================================================
   11 — Group Modal
   ============================================================ */

function setGroupActiveSwitch(on) {
  groupActiveState = !!on;
  if (!groupActiveSw) return;
  groupActiveSw.classList.toggle("is-on", groupActiveState);
  groupActiveSw.setAttribute("aria-checked", groupActiveState ? "true" : "false");
}

function openGroupModal(existing) {
  if (!groupModalEl) return;

  editingGroupId = existing ? safeText(existing.id) : null;

  if (groupNameInput) groupNameInput.value = existing ? safeText(existing.name) : "";
  if (groupStageSel)  groupStageSel.value  = existing ? safeText(existing.stage) : "";

  setGroupActiveSwitch(existing ? (existing.active !== false) : true);

  if (groupModalTitleEl) groupModalTitleEl.textContent = existing ? "تعديل المجموعة" : "مجموعة جديدة";
  if (groupModalSubEl)   groupModalSubEl.textContent   = existing
    ? "عدّل بيانات المجموعة ثم احفظ."
    : "حدد اسم المجموعة والمرحلة المرتبطة.";

  if (groupConfirmBtn) groupConfirmBtn.textContent = existing ? "حفظ" : "إضافة";

  groupModalEl.classList.add("is-open");
  groupModalEl.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";

  setTimeout(() => {
    if (groupNameInput) groupNameInput.focus();
  }, 150);
}

function closeGroupModal() {
  if (!groupModalEl) return;
  groupModalEl.classList.remove("is-open");
  groupModalEl.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
  editingGroupId = null;
}


/* ============================================================
   12 — حفظ Group
   ============================================================ */

async function handleSaveGroup() {
  if (isSavingGroup) return;

  const name = safeText(groupNameInput ? groupNameInput.value : "");
  const stage = safeText(groupStageSel ? groupStageSel.value : "");
  const active = groupActiveState;

  if (!name) {
    showToast("من فضلك أدخل اسم المجموعة.", "warning");
    return;
  }

  if (name.length > 80) {
    showToast("اسم المجموعة طويل جدًا.", "warning");
    return;
  }

  if (!stage) {
    showToast("من فضلك اختر المرحلة.", "warning");
    return;
  }

  isSavingGroup = true;
  if (groupConfirmBtn) {
    groupConfirmBtn.disabled = true;
    groupConfirmBtn.textContent = editingGroupId ? "جارٍ الحفظ..." : "جارٍ الإضافة...";
  }

  const body = { name, stage, active };

  let result;
  if (editingGroupId) {
    result = await workerFetch(`/api/admin/lesson-groups/${encodeURIComponent(editingGroupId)}`, {
      method: "PATCH",
      body
    });
  } else {
    result = await workerFetch("/api/admin/lesson-groups", {
      method: "POST",
      body
    });
  }

  isSavingGroup = false;
  if (groupConfirmBtn) {
    groupConfirmBtn.disabled = false;
    groupConfirmBtn.textContent = editingGroupId ? "حفظ" : "إضافة";
  }

  if (!result || !result.success) {
    const code = (result && result.error && result.error.code) || ERRORS.SERVER_ERROR;
    const msg  = (result && result.error && result.error.message) || ERROR_MESSAGES[code];

    if (code === ERRORS.UNAUTHORIZED) {
      showToast(ERROR_MESSAGES.UNAUTHORIZED, "warning");
      setTimeout(() => { window.location.href = "login.html"; }, 1500);
      return;
    }

    showToast(msg, "error");
    return;
  }

  const saved = (result.data && result.data.group) ? result.data.group : null;

  if (saved && saved.id) {
    if (editingGroupId) {
      const idx = groups.findIndex((g) => g && g.id === editingGroupId);
      if (idx >= 0) groups[idx] = saved;
    } else {
      groups.unshift(saved);
    }
  }

  renderGroups();
  closeGroupModal();

  showToast(editingGroupId ? "تم الحفظ ✅" : "تمت الإضافة ✅", "success");
}


/* ============================================================
   13 — حذف Group
   ============================================================ */

async function handleDeleteGroup(id, name) {
  const cleanId = safeText(id);
  if (!cleanId) return;

  const confirmed = window.confirm(`متأكد من حذف المجموعة: "${name}"؟`);
  if (!confirmed) return;

  const result = await workerFetch(`/api/admin/lesson-groups/${encodeURIComponent(cleanId)}`, {
    method: "DELETE"
  });

  if (!result || !result.success) {
    const code = (result && result.error && result.error.code) || ERRORS.SERVER_ERROR;
    const msg  = (result && result.error && result.error.message) || ERROR_MESSAGES[code];

    if (code === ERRORS.UNAUTHORIZED) {
      showToast(ERROR_MESSAGES.UNAUTHORIZED, "warning");
      setTimeout(() => { window.location.href = "login.html"; }, 1500);
      return;
    }

    showToast(msg, "error");
    return;
  }

  groups = groups.filter((g) => g && g.id !== cleanId);
  renderGroups();

  showToast("تم الحذف", "success");
}


/* ============================================================
   14 — General Settings
   ============================================================ */

function setSwitch(el, on, key) {
  switchesState[key] = !!on;
  if (!el) return;
  el.classList.toggle("is-on", !!on);
  el.setAttribute("aria-checked", on ? "true" : "false");
}

function bindSwitch(el, key) {
  if (!el) return;

  const toggle = () => {
    const newValue = !switchesState[key];
    setSwitch(el, newValue, key);
  };

  el.addEventListener("click", toggle);
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggle();
    }
  });
}

function renderSettings() {
  if (academicYearEl) {
    academicYearEl.value = safeText(settings.academicYear);
  }
  if (platformNameEl) {
    platformNameEl.value = safeText(settings.platformName);
  }
  if (passingPercentEl) {
    passingPercentEl.value = String(Number(settings.passingPercent) || 50);
  }

  setSwitch(subscriptionsSw, settings.subscriptionsEnabled !== false, "subscriptions");
  setSwitch(prayerSw,        settings.prayerEnabled !== false,        "prayer");
  setSwitch(aiSw,            settings.aiEnabled !== false,            "ai");
}

async function loadSettings() {
  if (isLoadingSettings) return;
  isLoadingSettings = true;

  const result = await workerFetch("/api/admin/settings");

  isLoadingSettings = false;

  if (!result || !result.success) {
    const code = (result && result.error && result.error.code) || ERRORS.SERVER_ERROR;
    if (code === ERRORS.UNAUTHORIZED) {
      showToast(ERROR_MESSAGES.UNAUTHORIZED, "warning");
      setTimeout(() => { window.location.href = "login.html"; }, 1500);
      return;
    }

    // لو فشل → إعدادات افتراضية
    settings = {
      academicYear: "",
      platformName: "",
      subscriptionsEnabled: true,
      prayerEnabled: true,
      aiEnabled: true,
      passingPercent: 50
    };
    renderSettings();
    return;
  }

  const data = (result.data && typeof result.data === "object") ? result.data : {};
  settings = (data.settings && typeof data.settings === "object") ? data.settings : data;

  renderSettings();
}

async function handleSaveSettings(event) {
  if (event) event.preventDefault();

  if (isSavingSettings) return;

  const academicYear = safeText(academicYearEl ? academicYearEl.value : "");
  const platformName = safeText(platformNameEl ? platformNameEl.value : "");
  const passingPercent = Number(passingPercentEl ? passingPercentEl.value : 50);

  // تحقق بسيط
  if (academicYear && !/^\d{4}-\d{4}$/.test(academicYear)) {
    showToast("صيغة السنة الدراسية يجب أن تكون YYYY-YYYY.", "warning");
    return;
  }

  if (platformName && platformName.length > 80) {
    showToast("اسم المنصة طويل جدًا.", "warning");
    return;
  }

  if (!Number.isInteger(passingPercent) || passingPercent < 1 || passingPercent > 100) {
    showToast("نسبة النجاح يجب أن تكون بين 1 و100.", "warning");
    return;
  }

  isSavingSettings = true;
  if (saveGeneralBtn) {
    saveGeneralBtn.disabled = true;
    saveGeneralBtn.textContent = "جارٍ الحفظ...";
  }

  const body = {
    academicYear: academicYear || null,
    platformName: platformName || null,
    subscriptionsEnabled: switchesState.subscriptions,
    prayerEnabled: switchesState.prayer,
    aiEnabled: switchesState.ai,
    passingPercent
  };

  const result = await workerFetch("/api/admin/settings", {
    method: "PATCH",
    body
  });

  isSavingSettings = false;
  if (saveGeneralBtn) {
    saveGeneralBtn.disabled = false;
    saveGeneralBtn.textContent = "حفظ الإعدادات";
  }

  if (!result || !result.success) {
    const code = (result && result.error && result.error.code) || ERRORS.SERVER_ERROR;
    const msg  = (result && result.error && result.error.message) || ERROR_MESSAGES[code];

    if (code === ERRORS.UNAUTHORIZED) {
      showToast(ERROR_MESSAGES.UNAUTHORIZED, "warning");
      setTimeout(() => { window.location.href = "login.html"; }, 1500);
      return;
    }

    showToast(msg, "error");
    return;
  }

  // تحديث محلي
  settings = { ...settings, ...body };

  showToast("تم حفظ الإعدادات ✅", "success");
}


/* ============================================================
   15 — ربط الأحداث
   ============================================================ */

function bindEvents() {
  // Tabs
  bindTabs();

  // Add Group
  if (addGroupBtn) addGroupBtn.addEventListener("click", () => openGroupModal(null));

  // Retry Groups
  if (groupsRetryBtn) groupsRetryBtn.addEventListener("click", () => loadGroups());

  // Group Modal
  if (groupCancelBtn)  groupCancelBtn.addEventListener("click", closeGroupModal);
  if (groupConfirmBtn) groupConfirmBtn.addEventListener("click", handleSaveGroup);

  if (groupModalEl) {
    groupModalEl.addEventListener("click", (e) => {
      if (e.target === groupModalEl) closeGroupModal();
    });
  }

  // Group Active Switch
  bindSwitch(groupActiveSw, "groupActive");
  // ملاحظة: Switch المجموعة بيستخدم groupActiveState وليس switchesState
  if (groupActiveSw) {
    // إعادة ربط للاستخدام الخاص
    groupActiveSw.onclick = null;
    groupActiveSw.onkeydown = null;
  }

  // General Form
  if (generalFormEl) {
    generalFormEl.addEventListener("submit", handleSaveSettings);
  }

  // 3 switches
  bindSwitch(subscriptionsSw, "subscriptions");
  bindSwitch(prayerSw,        "prayer");
  bindSwitch(aiSw,            "ai");

  // Escape
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && groupModalEl && groupModalEl.classList.contains("is-open")) {
      closeGroupModal();
    }
  });
}


/* ============================================================
   16 — التهيئة
   ============================================================ */

async function init() {
  const session = requireAdmin();
  if (!session) return;

  cacheElements();
  bindEvents();

  // تحميل متوازي
  await Promise.all([
    loadGroups(),
    loadSettings()
  ]);
}


/* ============================================================
   17 — التشغيل
   ============================================================ */

onReady(init);