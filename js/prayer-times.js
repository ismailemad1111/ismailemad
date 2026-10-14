
/**
 * prayer-times.js
 * ------------------------------------------------------------
 * منصة أ/ إسماعيل عماد التعليمية
 * تشغيل قسم "مواقيت الصلاة" داخل planner.html
 *
 * المكان: /js/prayer-times.js
 *
 * ⚠️ قواعد:
 *   - سكريبت مستقل تمامًا (بدون import/export) — بيتحمّل كـ <script>
 *     عادي قبل planner.js مباشرة (بند التوثيق في planner.js).
 *   - بيتعامل بس مع العناصر الموجودة فعلًا في planner.html:
 *     #prayerSection, #prayerCity, #prayerHijriDate, #prayerGregorianDate,
 *     #prayerGrid, #prayerNextRow, #nextPrayerName, #countdownTimer,
 *     #prayerStatus, #hidePrayerCheckbox.
 *   - لو أي عنصر مش موجود، السكريبت يتوقف بهدوء (defensive) من غير أخطاء
 *     في الـ console — عشان لو planner.html اتغيّر مستقبلًا ما ينكسرش.
 *   - بدون أي نظام صلاة جديد أو واجهة جديدة: فقط تشغيل الواجهة الموجودة
 *     فعلًا في HTML/CSS.
 * ------------------------------------------------------------
 */

(function () {
  "use strict";

  var HIDE_PREF_KEY = "planner:hidePrayerSection";

  var PRAYERS = [
    { key: "Fajr", name: "الفجر", icon: "icon-moon" },
    { key: "Dhuhr", name: "الظهر", icon: "icon-sun" },
    { key: "Asr", name: "العصر", icon: "icon-cloud-sun" },
    { key: "Maghrib", name: "المغرب", icon: "icon-sunset" },
    { key: "Isha", name: "العشاء", icon: "icon-night-sky" }
  ];

  var countdownInterval = null;
  var currentTimings = null; // { Fajr, Dhuhr, Asr, Maghrib, Isha } كنصوص "HH:MM"

  function el(id) {
    return document.getElementById(id);
  }

  function setStatus(dotEl, textEl, mode, text) {
    if (dotEl) {
      dotEl.classList.remove(
        "prayer__status-dot--online",
        "prayer__status-dot--offline",
        "prayer__status-dot--loading"
      );
      dotEl.classList.add("prayer__status-dot--" + mode);
    }
    if (textEl) textEl.textContent = text;
  }

  // "HH:MM" (اليوم الحالي) → Date كاملة
  function timeStringToDate(hhmm, baseDate) {
    if (!hhmm || typeof hhmm !== "string") return null;
    var parts = hhmm.split(":");
    if (parts.length < 2) return null;
    var h = parseInt(parts[0], 10);
    var m = parseInt(parts[1], 10);
    if (isNaN(h) || isNaN(m)) return null;
    var d = new Date(baseDate.getTime());
    d.setHours(h, m, 0, 0);
    return d;
  }

  function formatCountdown(ms) {
    if (ms < 0) ms = 0;
    var totalSeconds = Math.floor(ms / 1000);
    var hh = Math.floor(totalSeconds / 3600);
    var mm = Math.floor((totalSeconds % 3600) / 60);
    var ss = totalSeconds % 60;
    function pad(n) { return n < 10 ? "0" + n : String(n); }
    return pad(hh) + ":" + pad(mm) + ":" + pad(ss);
  }

  function renderGrid(gridEl, timings, now) {
    if (!gridEl) return;
    gridEl.innerHTML = "";

    var todaysTimes = PRAYERS.map(function (p) {
      return { def: p, date: timeStringToDate(timings[p.key], now) };
    }).filter(function (t) { return t.date; });

    // حدد الحالية والقادمة
    var currentIndex = -1;
    for (var i = 0; i < todaysTimes.length; i++) {
      if (todaysTimes[i].date.getTime() <= now.getTime()) {
        currentIndex = i;
      }
    }
    var nextIndex = currentIndex + 1 < todaysTimes.length ? currentIndex + 1 : -1;

    todaysTimes.forEach(function (t, idx) {
      var item = document.createElement("div");
      item.className = "prayer-item-compact";
      if (idx === currentIndex) item.classList.add("prayer-item-compact--current");
      if (idx === nextIndex) item.classList.add("prayer-item-compact--next");

      var icon = document.createElement("span");
      icon.className = "prayer-item-compact__icon";
      var glyph = document.createElement("span");
      glyph.className = "icon " + t.def.icon;
      glyph.setAttribute("aria-hidden", "true");
      icon.appendChild(glyph);

      var name = document.createElement("span");
      name.className = "prayer-item-compact__name";
      name.textContent = t.def.name;

      var hours24 = t.date.getHours();
      var minutes = t.date.getMinutes();
      var period = hours24 >= 12 ? "م" : "ص";
      var hours12 = hours24 % 12;
      if (hours12 === 0) hours12 = 12;
      var minutesStr = minutes < 10 ? "0" + minutes : String(minutes);

      var time = document.createElement("span");
      time.className = "prayer-item-compact__time";
      time.textContent = hours12 + ":" + minutesStr;

      var periodEl = document.createElement("span");
      periodEl.className = "prayer-item-compact__period";
      periodEl.textContent = period;

      item.appendChild(icon);
      item.appendChild(name);
      item.appendChild(time);
      item.appendChild(periodEl);
      gridEl.appendChild(item);
    });

    return { todaysTimes: todaysTimes, nextIndex: nextIndex };
  }

  function startCountdown(nextNameEl, countdownEl) {
    if (countdownInterval) {
      clearInterval(countdownInterval);
      countdownInterval = null;
    }
    if (!currentTimings || !nextNameEl || !countdownEl) return;

    function tick() {
      var now = new Date();
      var todaysTimes = PRAYERS.map(function (p) {
        return { def: p, date: timeStringToDate(currentTimings[p.key], now) };
      }).filter(function (t) { return t.date; });

      var next = null;
      for (var i = 0; i < todaysTimes.length; i++) {
        if (todaysTimes[i].date.getTime() > now.getTime()) {
          next = todaysTimes[i];
          break;
        }
      }

      if (!next) {
        // كل صلوات اليوم عدّت — القادمة فعليًا فجر بكرة (نعرض الاسم بس،
        // من غير حساب دقيق لتوقيت الغد لتجنّب استدعاء API إضافي).
        nextNameEl.textContent = PRAYERS[0].name;
        countdownEl.textContent = "--:--:--";
        return;
      }

      nextNameEl.textContent = next.def.name;
      countdownEl.textContent = formatCountdown(next.date.getTime() - now.getTime());
    }

    tick();
    countdownInterval = setInterval(tick, 1000);
  }

  function formatGregorian(date) {
    try {
      return new Intl.DateTimeFormat("ar-EG", {
        year: "numeric",
        month: "long",
        day: "numeric"
      }).format(date);
    } catch (e) {
      return date.toDateString();
    }
  }

  function formatHijri(date) {
    try {
      return new Intl.DateTimeFormat("ar-SA-u-ca-islamic", {
        year: "numeric",
        month: "long",
        day: "numeric"
      }).format(date);
    } catch (e) {
      return "";
    }
  }

  function initHideToggle(sectionEl, checkboxEl) {
    if (!checkboxEl || !sectionEl) return;

    var hidden = false;
    try {
      hidden = window.localStorage.getItem(HIDE_PREF_KEY) === "1";
    } catch (e) {
      hidden = false;
    }

    checkboxEl.checked = hidden;
    sectionEl.classList.toggle("prayer-section--hidden", hidden);

    checkboxEl.addEventListener("change", function () {
      var isChecked = !!checkboxEl.checked;
      sectionEl.classList.toggle("prayer-section--hidden", isChecked);
      try {
        window.localStorage.setItem(HIDE_PREF_KEY, isChecked ? "1" : "0");
      } catch (e) {
        // تجاهل — تفضيل واجهة فقط، مش وظيفة أساسية
      }
    });
  }

  async function isPrayerEnabled() {
    // الافتراضي true للحفاظ على السلوك الحالي إذا تعذر الوصول للإعدادات.
    try {
      var session = null;
      try {
        session = JSON.parse(window.sessionStorage.getItem("am_session") || "null");
      } catch (e) {
        session = null;
      }

      if (!session || session.role !== "student" || !session.token) return true;

      var backend = await import("./backend/index.js");
      var result = await backend.backendRequest("/api/student/settings");
      if (!result || !result.success || !result.data || !result.data.settings) return true;

      return result.data.settings.prayerEnabled !== false;
    } catch (e) {
      return true;
    }
  }

  async function loadPrayerTimes() {
    var sectionEl = el("prayerSection");
    var gridEl = el("prayerGrid");
    var hijriEl = el("prayerHijriDate");
    var gregorianEl = el("prayerGregorianDate");
    var nextNameEl = el("nextPrayerName");
    var countdownEl = el("countdownTimer");
    var statusEl = el("prayerStatus");

    // لو القسم أصلًا مش موجود في الصفحة، ماينفعش نكمل.
    if (!sectionEl) return;

    // إعداد الإدارة له الأولوية: لو تم تعطيل القسم، لا نطلب مواقيت الصلاة أصلًا.
    var enabled = await isPrayerEnabled();
    if (!enabled) {
      sectionEl.classList.add("prayer-section--hidden");
      if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
      }
      return;
    }

    var dotEl = statusEl ? statusEl.querySelector(".prayer__status-dot") : null;
    var statusTextEl = statusEl ? statusEl.querySelector(".prayer__status-text") : null;

    setStatus(dotEl, statusTextEl, "loading", "جاري التحميل...");

    var now = new Date();
    if (gregorianEl) gregorianEl.textContent = formatGregorian(now);
    if (hijriEl) {
      var hijri = formatHijri(now);
      if (hijri) hijriEl.textContent = hijri;
    }

    var url = "https://api.aladhan.com/v1/timingsByCity?city=Cairo&country=Egypt&method=5";

    fetch(url)
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (data) {
        if (!data || !data.data || !data.data.timings) {
          throw new Error("بيانات غير صالحة");
        }
        var timings = data.data.timings;
        currentTimings = {
          Fajr: timings.Fajr,
          Dhuhr: timings.Dhuhr,
          Asr: timings.Asr,
          Maghrib: timings.Maghrib,
          Isha: timings.Isha
        };

        renderGrid(gridEl, currentTimings, new Date());
        startCountdown(nextNameEl, countdownEl);
        setStatus(dotEl, statusTextEl, "online", "متصل");
      })
      .catch(function () {
        setStatus(dotEl, statusTextEl, "offline", "تعذر الاتصال بخدمة المواقيت");
      });
  }

  function init() {
    var sectionEl = el("prayerSection");
    if (!sectionEl) return; // planner.html بس هو اللي فيه القسم ده

    initHideToggle(sectionEl, el("hidePrayerCheckbox"));
    loadPrayerTimes();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
