/**
 * home-motion.js
 * ------------------------------------------------------------
 * ظهور متدرّج خفيف لأقسام الصفحة الرئيسية عند التمرير (عرض فقط).
 *
 * - يستخدم IntersectionObserver ويظهر كل عنصر مرة واحدة.
 * - لا يفعّل الإخفاء الأولي (html.hm-js) إلا بعد التأكد من دعم
 *   المتصفح، ومع prefers-reduced-motion لا يفعّله إطلاقًا.
 * - شبكة أمان: بعد 2.5 ثانية يُظهَر أي عنصر لم يظهر بعد.
 * ------------------------------------------------------------
 */

(function () {
  try {
    if (!("IntersectionObserver" in window)) return;
    if (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const targets = Array.from(document.querySelectorAll(
      ".home-section:not(:has(.home-tools-panel)), .home-subsection"
    ));
    if (!targets.length) return;

    const root = document.documentElement;
    root.classList.add("hm-js");

    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-in");
        io.unobserve(entry.target);
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });

    targets.forEach((el, i) => {
      el.classList.add("hm-reveal");
      el.style.setProperty("--hm-delay", Math.min(i, 3) * 60 + "ms");
      io.observe(el);
    });

    setTimeout(() => {
      targets.forEach((el) => el.classList.add("is-in"));
      io.disconnect();
    }, 2500);
  } catch (e) {
    document.documentElement.classList.remove("hm-js");
  }
})();
