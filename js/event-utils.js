/**
 * event-utils.js
 * ------------------------------------------------------------
 * أدوات مشتركة لصفحات الأحداث (الطالب والأدمن):
 *   - تسميات الحالات والأنواع والمراحل
 *   - تنسيق التواريخ
 *   - بناء رابط اللعبة بأمان + فحص وجود ملفها على الاستضافة
 *   - ضغط الصور (نفس آلية بنك مستر إسماعيل: data URL داخل Firestore)
 * ------------------------------------------------------------
 */

import { isValidGameFile } from "./backend/events.js";

export { isValidGameFile };

export const STAGE_LABELS = {
  all: "كل المراحل",
  grade_4: "الصف الرابع الابتدائي",
  grade_5: "الصف الخامس الابتدائي",
  grade_6: "الصف السادس الابتدائي",
  prep_1: "الصف الأول الإعدادي",
  prep_2: "الصف الثاني الإعدادي",
  prep_3: "الصف الثالث الإعدادي",
  sec_1: "الصف الأول الثانوي",
  sec_2: "الصف الثاني الثانوي",
  sec_3: "الصف الثالث الثانوي"
};

export const PHASE = {
  upcoming: { label: "قريبًا", cls: "is-upcoming" },
  live:     { label: "جارٍ الآن", cls: "is-live" },
  ended:    { label: "انتهى", cls: "is-ended" }
};

export const TYPE_LABELS = { game: "لعبة تفاعلية", activity: "نشاط" };

export const STATUS_LABELS = { draft: "مسودة", published: "منشور", hidden: "مخفي" };

export function toMs(v) {
  if (!v) return 0;
  const t = typeof v === "number" ? v : new Date(v).getTime();
  return Number.isFinite(t) ? t : 0;
}

export function fmtDateTime(v) {
  const ms = toMs(v);
  if (!ms) return "—";
  try {
    return new Intl.DateTimeFormat("ar-EG", {
      weekday: "long", day: "numeric", month: "long", year: "numeric",
      hour: "numeric", minute: "2-digit"
    }).format(new Date(ms));
  } catch (e) {
    return new Date(ms).toLocaleString();
  }
}

export function fmtShort(v) {
  const ms = toMs(v);
  if (!ms) return "—";
  try {
    return new Intl.DateTimeFormat("ar-EG", {
      day: "numeric", month: "short", hour: "numeric", minute: "2-digit"
    }).format(new Date(ms));
  } catch (e) {
    return new Date(ms).toLocaleString();
  }
}

/** مرحلة الحدث من وقت الجهاز (الحماية الفعلية وقت الخادم في القواعد) */
export function phaseOf(ev, now = Date.now()) {
  const s = toMs(ev.startAt);
  const e = toMs(ev.endAt);
  if (s && now < s) return "upcoming";
  if (e && now > e) return "ended";
  return "live";
}

/** وصف مدة مبسّط: "بعد 3 ساعات" / "متبقي يومان" */
export function relativeSpan(ms) {
  const abs = Math.abs(ms);
  const mins = Math.round(abs / 60000);
  if (mins < 1) return "أقل من دقيقة";
  if (mins < 60) return `${mins} دقيقة`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} ساعة`;
  return `${Math.round(hours / 24)} يومًا`;
}

/** datetime-local ⇄ ms (بتوقيت جهاز المستخدم) */
export function toLocalInput(v) {
  const ms = toMs(v);
  if (!ms) return "";
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
}
export function fromLocalInput(str) {
  if (!str) return NaN;
  const t = new Date(str).getTime();
  return Number.isFinite(t) ? t : NaN;
}

/**
 * رابط اللعبة داخل نفس الموقع فقط. يرجع null إن كان الاسم غير مقبول.
 * (الأسماء المقبولة game-*.html في الجذر؛ لا مسارات ولا مجلدات ولا بروتوكولات)
 */
export function gameUrl(file) {
  if (!isValidGameFile(file)) return null;
  try {
    // ملفات الألعاب في جذر الموقع دائمًا: صفحات الأدمن (admin/) تحسب الرابط من الجذر لا من admin/
    const dir = new URL("./", window.location.href).pathname.replace(/admin\/$/, "");
    const base = new URL(dir, window.location.origin);
    const u = new URL(file, base);
    if (u.origin !== window.location.origin) return null;
    if (u.pathname !== base.pathname + file) return null;
    return u.href;
  } catch (e) {
    return null;
  }
}

/**
 * هل ملف اللعبة منشور فعلًا؟
 * الاستضافة تعيد index.html لأي مسار غير موجود (rewrite)، لذلك لا يكفي فحص status:
 * نقارن المحتوى بصفحة مسار غير موجود قطعًا.
 * @returns {Promise<"ok"|"missing"|"network"|"invalid">}
 */
export async function probeGame(file) {
  const url = gameUrl(file);
  if (!url) return "invalid";
  let res;
  try {
    res = await fetch(url, { cache: "no-store" });
  } catch (e) {
    return "network";
  }
  if (!res.ok) return "missing";
  if (!/html/i.test(res.headers.get("content-type") || "")) return "missing";
  let text = "";
  try { text = await res.text(); } catch (e) { return "network"; }
  if (!text.trim()) return "missing";
  try {
    const probe = await fetch(gameUrl("game-__probe__.html"), { cache: "no-store" });
    if (probe.ok && (await probe.text()) === text) return "missing";
  } catch (e) {
    /* الفحص الإضافي اختياري */
  }
  return "ok";
}

export const GAME_MISSING_MESSAGE =
  "ملف اللعبة غير موجود على الموقع. يبدو أنه لم يُنشر بعد، تواصل مع المعلم.";

/** يصغّر الصورة ويحوّلها إلى JPEG data URL ضمن الحد المسموح */
export function compressImage(file, maxChars = 240000) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        let side = 960;
        for (let attempt = 0; attempt < 7; attempt++) {
          const ratio = Math.min(1, side / Math.max(img.width, img.height));
          const c = document.createElement("canvas");
          c.width = Math.max(1, Math.round(img.width * ratio));
          c.height = Math.max(1, Math.round(img.height * ratio));
          const ctx = c.getContext("2d");
          ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
          ctx.drawImage(img, 0, 0, c.width, c.height);
          for (const q of [0.82, 0.7, 0.55]) {
            const out = c.toDataURL("image/jpeg", q);
            if (out.length <= maxChars) { URL.revokeObjectURL(url); resolve(out); return; }
          }
          side = Math.round(side * 0.75);
        }
        URL.revokeObjectURL(url);
        reject(new Error("big"));
      } catch (e) { URL.revokeObjectURL(url); reject(e); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("bad")); };
    img.src = url;
  });
}

/* ---- DOM helpers (كل النصوص القادمة من قاعدة البيانات بـ textContent) ---- */

export const $ = (id) => document.getElementById(id);

export function el(tag, opts = {}, children = []) {
  const n = document.createElement(tag);
  if (opts.class) n.className = opts.class;
  if (opts.text !== undefined) n.textContent = opts.text;
  if (opts.attrs) Object.entries(opts.attrs).forEach(([k, v]) => n.setAttribute(k, v));
  children.forEach((c) => { if (c) n.appendChild(c); });
  return n;
}

export function iconEl(name) {
  return el("span", { class: `icon icon-${name}`, attrs: { "aria-hidden": "true" } });
}

export function show(node, visible) {
  if (node) node.hidden = !visible;
}

export function errMsg(res, fallback) {
  return (res && res.error && res.error.message) || fallback;
}
