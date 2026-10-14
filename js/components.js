/**
 * components.js
 * ------------------------------------------------------------
 * منصة أ/ إسماعيل عماد التعليمية
 * بناء المكونات الديناميكية بشكل موحد.
 *
 * المكان: /js/components.js
 *
 * المرجع:
 *   - Master Design System (بنود 12، 13، 15، 33، 34، 35، 36، 38،
 *                            39، 46، 47، 48، 49، 62، 64، 65، 66)
 *   - الوثيقة الأصلية (بنود 13، 15، 121، 122، 123، 160، 161)
 *
 * ⚠️ قواعد صارمة:
 *   - أي نص من المستخدم يمر عبر escapeHTML (بند 124).
 *   - كل زر يستخدم كلاسات components.css.
 *   - ممنوع inline styles إلا في قيم progress.
 *   - كل عنصر DOM حقيقي (ليس نص HTML).
 *
 * الاستخدام:
 *   import { renderBottomNav, createCard }
 *     from './js/components.js';
 * ------------------------------------------------------------
 */

import { escapeHTML, safeText, showToast } from "./helpers.js";
import { ROUTES, getCurrentPage } from "./router.js";


/* ============================================================
   01 — أدوات مساعدة داخلية
   ============================================================ */

/**
 * إنشاء عنصر HTML.
 * @param {string} tag
 * @param {Object} attrs - { class, id, href, ... }
 * @param {Array|Node|string} children
 * @returns {HTMLElement}
 */
/**
 * إنشاء عنصر أيقونة SVG (بدل الإيموجي).
 * الأيقونات مُعرّفة في /css/icons.css كـ mask-image، فبتاخد
 * لونها تلقائيًا من CSS (currentColor).
 * @param {string} name - اسم الأيقونة (مطابق لملف /icons/<name>.svg)
 * @param {string} extraClass - كلاسات إضافية (مثال: "icon-lg")
 * @returns {HTMLElement}
 */
function icon(name, extraClass = "") {
  const cls = extraClass ? `icon icon-${name} ${extraClass}` : `icon icon-${name}`;
  return el("span", { class: cls, "aria-hidden": "true" });
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);

  Object.entries(attrs).forEach(([key, value]) => {
    if (value === undefined || value === null) return;

    if (key === "class") {
      node.className = String(value);
    } else if (key === "text") {
      node.textContent = String(value);
    } else if (key.startsWith("on") && typeof value === "function") {
      const event = key.slice(2).toLowerCase();
      node.addEventListener(event, value);
    } else if (key === "dataset" && typeof value === "object") {
      Object.entries(value).forEach(([k, v]) => {
        node.dataset[k] = String(v);
      });
    } else {
      node.setAttribute(key, String(value));
    }
  });

  const arr = Array.isArray(children) ? children : [children];
  arr.forEach((child) => {
    if (child == null) return;
    if (typeof child === "string" || typeof child === "number") {
      node.appendChild(document.createTextNode(String(child)));
    } else if (child instanceof Node) {
      node.appendChild(child);
    }
  });

  return node;
}

/**
 * استبدال محتوى عنصر بمحتوى جديد.
 * @param {HTMLElement|string} target
 * @param {Node|Array<Node>|string} content
 */
export function mount(target, content) {
  const node = typeof target === "string" ? document.querySelector(target) : target;
  if (!node) return;

  node.replaceChildren();

  const arr = Array.isArray(content) ? content : [content];
  arr.forEach((child) => {
    if (child == null) return;
    if (typeof child === "string") {
      node.appendChild(document.createTextNode(child));
    } else if (child instanceof Node) {
      node.appendChild(child);
    }
  });
}


/* ============================================================
   02 — Layout: Header
   المرجع: Design System — بنود 13، 14
   ============================================================ */

/**
 * بناء الهيدر العام للصفحة.
 * @param {Object} options
 * @param {string} options.title - عنوان
 * @param {string} options.subtitle - وصف مختصر
 * @param {boolean} options.withBack - إظهار زر رجوع
 * @param {Array<HTMLElement>} options.actions - أزرار على الجانب
 * @returns {HTMLElement}
 */
export function renderHeader({
  title = "",
  subtitle = "",
  withBack = false,
  actions = []
} = {}) {
  const brandChildren = [];

  if (withBack) {
    const backBtn = el("button", {
      class: "app-header-back",
      type: "button",
      "aria-label": "رجوع",
      onClick: () => window.history.back()
    }, [
      icon("arrow-back", "app-header-back-icon")
    ]);
    brandChildren.push(backBtn);
  }

  const textBox = el("div", { class: "app-header-brand-text" });
  if (title) {
    textBox.appendChild(el("span", { class: "app-header-brand-title", text: title }));
  }
  if (subtitle) {
    textBox.appendChild(el("span", { class: "app-header-brand-subtitle text-muted text-xs", text: subtitle }));
  }
  if (title || subtitle) {
    brandChildren.push(textBox);
  }

  const brand = el("div", { class: "app-header-brand" }, brandChildren);
  const actionBox = el("div", { class: "app-header-actions" }, actions);

  return el("header", { class: "app-header" }, [brand, actionBox]);
}


/* ============================================================
   03 — Layout: Bottom Navigation
   المرجع: الوثيقة الأصلية — بنود 72، 73
   المرجع: Design System — بند 13
   القاعدة: 5 عناصر أساسية + الأيقونة النشطة بلون القسم.
   ============================================================ */

const NAV_ITEMS = [
  { id: "announcements", label: "الرسائل", href: ROUTES.ANNOUNCEMENTS, icon: "announcement", color: "nav-green"  },
  { id: "lessons",       label: "الدروس",  href: ROUTES.LESSONS,       icon: "video", color: "nav-blue"   },
  { id: "exams",         label: "الاختبارات", href: ROUTES.EXAMS,      icon: "exam-paper", color: "nav-green"  },
  { id: "bank",          label: "البنك",   href: ROUTES.BANK,         icon: "trophy", color: "nav-yellow" },
  { id: "planner",       label: "خطتك",   href: ROUTES.PLANNER,      icon: "calendar", color: "nav-yellow" },
  { id: "ai",            label: "اسأل",  href: ROUTES.AI,           icon: "sparkles", color: "nav-purple" }
];

/**
 * بناء شريط التنقل السفلي.
 * @param {Object} options
 * @param {Object} options.badges - { announcements: 3 }
 * @returns {HTMLElement}
 */
export function renderBottomNav({ badges = {} } = {}) {
  const current = getCurrentPage();

  const items = NAV_ITEMS.map((item) => {
    const isActive = current === item.href.split("/").pop();
    const classes = ["bottom-nav-item"];
    if (isActive) {
      classes.push("is-active", item.color);
    }

    const children = [
      icon(item.icon, "bottom-nav-icon"),
      el("span", { class: "bottom-nav-label", text: item.label })
    ];

    const badgeValue = badges[item.id];
    if (badgeValue && badgeValue > 0) {
      children.push(createBadge(String(badgeValue), "red"));
    }

    return el("a", {
      href: item.href,
      class: classes.join(" "),
      "aria-label": item.label
    }, children);
  });

  return el("nav", {
    class: "bottom-nav",
    role: "navigation",
    "aria-label": "التنقل الرئيسي"
  }, items);
}


/* ============================================================
   04 — Layout: Page Header
   المرجع: Design System — بنود 11، 13، 14
   ============================================================ */

/**
 * رأس داخلي للصفحة.
 * @param {string} title
 * @param {string} subtitle
 * @param {"blue"|"green"|"yellow"|"purple"|null} color
 * @returns {HTMLElement}
 */
export function renderPageHeader(title, subtitle = "", color = null) {
  const classes = ["page-header"];
  if (color) classes.push(`page-header-${color}`);

  const children = [];
  if (title) children.push(el("h1", { class: "page-header-title", text: safeText(title) }));
  if (subtitle) children.push(el("p", { class: "page-header-subtitle", text: safeText(subtitle) }));

  return el("div", { class: classes.join(" ") }, children);
}


/* ============================================================
   05 — Buttons
   المرجع: Design System — البند 10
   ============================================================ */

/**
 * إنشاء زر.
 * @param {Object} options
 * @param {string} options.label
 * @param {"primary"|"secondary"|"ai"|"highlight"|"danger"|"ghost"|"text"} options.variant
 * @param {"sm"|"lg"|"block"} options.size
 * @param {boolean} options.disabled
 * @param {Function} options.onClick
 * @returns {HTMLElement}
 */
export function createButton({
  label = "",
  variant = "primary",
  size = null,
  disabled = false,
  onClick = null
} = {}) {
  const classes = ["btn", `btn-${variant}`];
  if (size) classes.push(`btn-${size}`);

  return el("button", {
    type: "button",
    class: classes.join(" "),
    disabled: disabled ? true : null,
    onClick: onClick || undefined
  }, [escapeHTML(label)]);
}


/* ============================================================
   06 — Badge
   المرجع: Design System — البند 38
   ============================================================ */

/**
 * إنشاء Badge.
 * @param {string} text
 * @param {"red"|"green"|"blue"|"yellow"|"purple"|"orange"|"muted"} color
 * @returns {HTMLElement}
 */
export function createBadge(text, color = "red") {
  const classes = ["badge"];
  if (color && color !== "red") classes.push(`badge-${color}`);

  return el("span", { class: classes.join(" ") }, [escapeHTML(text)]);
}


/* ============================================================
   07 — Progress
   المرجع: Design System — البند 32
   ============================================================ */

/**
 * شريط تقدم أفقي.
 * @param {number} value - 0..100
 * @param {"green"|"blue"|"yellow"|"purple"|"red"} color
 * @returns {HTMLElement}
 */
export function createProgress(value, color = "green") {
  const v = Math.max(0, Math.min(100, Number(value) || 0));

  const bar = el("div", {
    class: `progress-bar progress-bar-${color}`
  });
  bar.style.width = `${v}%`;

  const wrapper = el("div", {
    class: "progress",
    role: "progressbar",
    "aria-valuemin": "0",
    "aria-valuemax": "100",
    "aria-valuenow": String(v)
  }, [bar]);

  return wrapper;
}


/* ============================================================
   08 — Cards
   المرجع: Design System — البنود 08، 09
   ============================================================ */

/**
 * بطاقة عامة.
 * @param {Object} options
 * @param {string} options.title
 * @param {string} options.text
 * @param {"soft"|"shadow"|"flat"|"dark"|null} options.variant
 * @param {boolean} options.clickable
 * @param {Function} options.onClick
 * @param {Array<HTMLElement>} options.actions
 * @returns {HTMLElement}
 */
export function createCard({
  title = "",
  text = "",
  variant = null,
  clickable = false,
  onClick = null,
  actions = []
} = {}) {
  const classes = ["card"];
  if (variant) classes.push(`card-${variant}`);
  if (clickable) classes.push("card-clickable");

  const children = [];
  if (title) children.push(el("h3", { class: "card-title", text: safeText(title) }));
  if (text)  children.push(el("p",  { class: "card-text",  text: safeText(text)  }));
  if (actions.length) children.push(el("div", { class: "card-actions" }, actions));

  const card = el("div", {
    class: classes.join(" "),
    role: clickable ? "button" : null,
    tabindex: clickable ? "0" : null,
    onClick: clickable && onClick ? onClick : undefined,
    onKeydown: clickable && onClick ? (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onClick(e);
      }
    } : undefined
  }, children);

  return card;
}


/* ============================================================
   09 — Stat Card
   المرجع: Design System — البند 31
   ============================================================ */

/**
 * بطاقة إحصائية.
 * @param {Object} options
 * @param {string} options.label
 * @param {string|number} options.value
 * @param {string} options.suffix - وحدة (ساعة، %، ...)
 * @param {"green"|"blue"|"yellow"|"purple"|"red"} options.color
 * @returns {HTMLElement}
 */
export function createStatCard({
  label = "",
  value = "",
  suffix = "",
  color = "green"
} = {}) {
  const valueRow = el("div", { class: "stat-card-value-row" }, [
    el("span", { class: "stat-card-value num", text: safeText(value) }),
    suffix ? el("span", { class: "stat-card-suffix text-muted text-sm", text: safeText(suffix) }) : null
  ]);

  return el("div", {
    class: `card card-soft stat-card stat-card-${color}`
  }, [
    el("span", { class: "stat-card-label text-muted text-sm", text: safeText(label) }),
    valueRow
  ]);
}


/* ============================================================
   10 — Tabs
   المرجع: الوثيقة الأصلية — بند 15
   ============================================================ */

/**
 * إنشاء تبويبات.
 * @param {Array<{id:string,label:string}>} tabs
 * @param {string} activeId
 * @param {Function} onChange - (id) => void
 * @returns {HTMLElement}
 */
export function createTabs(tabs, activeId, onChange) {
  const list = (tabs || []).map((tab) => {
    const isActive = tab.id === activeId;
    return el("button", {
      type: "button",
      class: `tab${isActive ? " is-active" : ""}`,
      "data-tab-id": tab.id,
      onClick: () => {
        if (typeof onChange === "function") onChange(tab.id);
      }
    }, [escapeHTML(tab.label)]);
  });

  return el("div", { class: "tabs", role: "tablist" }, list);
}


/* ============================================================
   11 — Modal
   المرجع: الوثيقة الأصلية — بند 161
   القاعدة: للعمليات التي يصعب التراجع عنها.
   ============================================================ */

/**
 * إنشاء وعرض Modal.
 * @param {Object} options
 * @param {string} options.title
 * @param {string} options.text
 * @param {Array<{label:string,variant:string,onClick:Function}>} options.actions
 * @returns {{ close: Function, element: HTMLElement }}
 */
export function createModal({ title = "", text = "", actions = [] } = {}) {
  const actionButtons = (actions || []).map((a) =>
    createButton({
      label: a.label,
      variant: a.variant || "primary",
      size: "block",
      onClick: () => {
        if (typeof a.onClick === "function") a.onClick();
        close();
      }
    })
  );

  const modal = el("div", { class: "modal", role: "dialog", "aria-modal": "true" }, [
    title ? el("h3", { class: "modal-title", text: safeText(title) }) : null,
    text  ? el("p",  { class: "modal-text",  text: safeText(text)  }) : null,
    el("div", { class: "modal-actions" }, actionButtons)
  ]);

  const overlay = el("div", { class: "modal-overlay" }, [modal]);

  // إغلاق عند النقر خارج الـ modal
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });

  // إغلاق عند Escape
  function onKey(e) {
    if (e.key === "Escape") close();
  }
  document.addEventListener("keydown", onKey);

  function close() {
    overlay.classList.remove("is-open");
    document.removeEventListener("keydown", onKey);
    setTimeout(() => overlay.remove(), 300);
  }

  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add("is-open"));

  return { close, element: overlay };
}


/* ============================================================
   12 — Toast
   المرجع: الوثيقة الأصلية — بند 160
   ============================================================ */

/**
 * عرض Toast.
 * واجهة مختصرة لـ showToast.
 * @param {string} message
 * @param {"success"|"error"|"warning"|"info"} type
 */
export function createToast(message, type = "info") {
  showToast(message, type);
}


/* ============================================================
   13 — Loading State
   المرجع: Design System — البند 34
   ============================================================ */

/**
 * مؤشر تحميل.
 * @param {"sm"|"lg"} size
 * @returns {HTMLElement}
 */
export function createLoading(size = null) {
  const classes = ["spinner"];
  if (size) classes.push(`spinner-${size}`);

  return el("div", { class: "loading-overlay" }, [
    el("div", { class: classes.join(" ") })
  ]);
}

/**
 * Skeleton loader لهياكل مختلفة.
 * @param {"text"|"title"|"card"} type
 * @returns {HTMLElement}
 */
export function createSkeleton(type = "text") {
  if (type === "card") {
    return el("div", { class: "skeleton skeleton-card" });
  }
  if (type === "title") {
    return el("div", { class: "skeleton skeleton-title" });
  }
  return el("div", { class: "skeleton skeleton-text" });
}

/**
 * مجموعة Skeleton لعرض قائمة (مثلاً، قائمة كروت).
 * @param {number} count
 * @returns {HTMLElement}
 */
export function createSkeletonList(count = 3) {
  const items = [];
  for (let i = 0; i < count; i++) {
    items.push(el("div", { class: "skeleton-row" }, [
      createSkeleton("title"),
      createSkeleton("text"),
      createSkeleton("text")
    ]));
  }
  return el("div", { class: "skeleton-list" }, items);
}


/* ============================================================
   14 — Empty State
   المرجع: Design System — البند 35
   ============================================================ */

/**
 * حالة "لا يوجد بيانات".
 * @param {Object} options
 * @param {string} options.icon - إيموجي أو رمز
 * @param {string} options.title
 * @param {string} options.text
 * @param {Object} options.action - { label, variant, onClick }
 * @returns {HTMLElement}
 */
export function createEmptyState({
  icon: iconName = "mail-empty",
  title = "لا يوجد شيء هنا",
  text = "",
  action = null
} = {}) {
  const children = [
    icon(iconName, "empty-state-icon"),
    el("h3", { class: "empty-state-title", text: safeText(title) })
  ];

  if (text) children.push(el("p", { class: "empty-state-text", text: safeText(text) }));

  if (action && action.label) {
    children.push(createButton({
      label: action.label,
      variant: action.variant || "primary",
      size: "sm",
      onClick: action.onClick
    }));
  }

  return el("div", { class: "empty-state" }, children);
}


/* ============================================================
   15 — Error State
   المرجع: Design System — البند 36
   القاعدة: لا تُعرض تفاصيل تقنية للطالب.
   ============================================================ */

/**
 * حالة خطأ.
 * @param {Object} options
 * @param {string} options.title
 * @param {string} options.text
 * @param {Function} options.onRetry
 * @returns {HTMLElement}
 */
export function createErrorState({
  title = "حدث خطأ",
  text = "حاول مرة أخرى.",
  onRetry = null
} = {}) {
  const children = [
    icon("warning", "error-state-icon"),
    el("h3", { class: "error-state-title", text: safeText(title) }),
    el("p",  { class: "error-state-text",  text: safeText(text)  })
  ];

  if (typeof onRetry === "function") {
    children.push(createButton({
      label: "حاول مرة أخرى",
      variant: "primary",
      size: "sm",
      onClick: onRetry
    }));
  }

  return el("div", { class: "error-state" }, children);
}


/* ============================================================
   16 — Announcement Card
   المرجع: الوثيقة الأصلية — بنود 25، 27، 28، 29، 30
   ============================================================ */

/**
 * بطاقة إعلان.
 * @param {Object} a - بيانات الإعلان
 * @param {Function} onReply
 * @returns {HTMLElement}
 */
export function createAnnouncementCard(a = {}, onReply = null) {
  const title = safeText(a.title);
  const body  = safeText(a.body);
  const date  = a.createdAt ? safeText(a.createdAt) : "";

  const head = el("div", { class: "announcement-head" }, [
    el("h3", { class: "announcement-title", text: title }),
    date ? el("span", { class: "announcement-date text-muted text-xs", text: date }) : null
  ]);

  const children = [head];

  if (body) children.push(el("p", { class: "announcement-body", text: body }));

  // رابط داخلي أو خارجي
  const link = safeText(a.linkTarget);
  if (link) {
    // التحقق من الخارجي (لا نسمح بروابط خارجية في href مباشرة هنا)
    const isExternal = /^https?:\/\//i.test(link);

    if (!isExternal && a.type === "internal_link") {
      // رابط داخلي
      children.push(createButton({
        label: "فتح",
        variant: "secondary",
        size: "sm",
        onClick: () => { window.location.href = link; }
      }));
    } else if (a.type === "external_link") {
      // الرابط الخارجي يُعالج عبر صفحة المحتوى (بند 29)
      children.push(createButton({
        label: "فتح المحتوى",
        variant: "secondary",
        size: "sm",
        onClick: () => { window.location.href = link; }
      }));
    }
  }

  // زر الرد
  if (typeof onReply === "function") {
    children.push(createButton({
      label: "الرد على المعلم",
      variant: "ghost",
      size: "sm",
      onClick: () => onReply(a)
    }));
  }

  return el("article", { class: "card card-soft announcement-card" }, children);
}


/* ============================================================
   17 — Lesson Card
   المرجع: الوثيقة الأصلية — بنود 32، 33
   ============================================================ */

/**
 * بطاقة درس.
 * @param {Object} lesson
 * @param {Function} onOpen
 * @returns {HTMLElement}
 */
export function createLessonCard(lesson = {}, onOpen = null) {
  const title = safeText(lesson.title);
  const kind  = lesson.kind === "audio" ? "صوت" : "فيديو";
  const iconName = lesson.kind === "audio" ? "headphones" : "video";

  return el("article", {
    class: "card card-soft lesson-card card-clickable",
    onClick: () => { if (typeof onOpen === "function") onOpen(lesson); }
  }, [
    el("div", { class: "lesson-card-head" }, [
      icon(iconName, "lesson-card-icon"),
      el("div", { class: "lesson-card-meta" }, [
        el("h3", { class: "lesson-card-title", text: title }),
        el("span", { class: "lesson-card-kind text-muted text-xs", text: kind })
      ])
    ]),
    createButton({
      label: "ابدأ",
      variant: lesson.kind === "audio" ? "primary" : "secondary",
      size: "sm",
      onClick: (e) => {
        e.stopPropagation();
        if (typeof onOpen === "function") onOpen(lesson);
      }
    })
  ]);
}


/* ============================================================
   18 — Exam Card
   المرجع: الوثيقة الأصلية — بنود 36، 23
   ============================================================ */

const EXAM_STATUS_LABELS = {
  available:        { text: "متاح",             color: "green"  },
  attempted:        { text: "تم الحل",           color: "muted"  },
  result_pending:   { text: "النتيجة قيد الانتظار", color: "yellow" },
  result_available: { text: "النتيجة متاحة",     color: "blue"   }
};

/**
 * بطاقة اختبار.
 * @param {Object} exam
 * @param {Function} onStart
 * @returns {HTMLElement}
 */
export function createExamCard(exam = {}, onStart = null) {
  const title = safeText(exam.title);
  const status = exam.status || "available";
  const label = EXAM_STATUS_LABELS[status] || EXAM_STATUS_LABELS.available;
  const questionsCount = Number(exam.questionsCount) || 0;

  const children = [
    el("div", { class: "exam-card-head" }, [
      el("h3", { class: "exam-card-title", text: title }),
      createBadge(label.text, label.color)
    ])
  ];

  if (questionsCount) {
    children.push(el("p", {
      class: "exam-card-meta text-muted text-sm",
      text: `${questionsCount} سؤال`
    }));
  }

  if (status === "available" && typeof onStart === "function") {
    children.push(createButton({
      label: "ابدأ الاختبار",
      variant: "primary",
      size: "block",
      onClick: () => onStart(exam)
    }));
  } else if (status === "attempted") {
    children.push(createButton({
      label: "تم أداء الامتحان",
      variant: "ghost",
      size: "block",
      disabled: true
    }));
  } else if (status === "result_pending") {
    children.push(createButton({
      label: "النتيجة قيد الانتظار",
      variant: "ghost",
      size: "block",
      disabled: true
    }));
  } else if (status === "result_available" && typeof onStart === "function") {
    children.push(createButton({
      label: "عرض النتيجة",
      variant: "secondary",
      size: "block",
      onClick: () => onStart(exam)
    }));
  }

  return el("article", { class: "card card-soft exam-card" }, children);
}