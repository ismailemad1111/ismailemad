/**
 * config.js — كل أوزان «ذكاء برعي» وعتباته وحدوده في مكان واحد.
 * ------------------------------------------------------------------
 * القاعدة الذهبية: الذكاء = اختيار الشيء الصحيح في اللحظة الصحيحة، وليس كثرة الكلام.
 * لذلك سقوف الظهور (الميزانية/التهدئة/الصفحة الواحدة) محفوظة هنا بنفس قيم الجولة السابقة،
 * وأي تكيّف يتحرك داخل [min, max] فقط.
 *
 * وصفة الضبط السريعة (كل رقم قابل للتعديل دون لمس بقية الكود):
 *   - يظهر برعي كثيرًا؟      ↓ budget.few.base  /  ↑ cooldownMs.few  /  ↑ minScore
 *   - لا يظهر أبدًا تقريبًا؟  ↓ minScore  /  ↓ windowMs  /  راجع debug (?barai=debug) لسبب الرفض
 *   - رسالة معينة تتقدّم دائمًا؟ عدّل imp/urg لها في EVENTS أو tiers.<tier>.base
 *   - تريد أن يتكيّف أسرع مع تجاهل الطالب؟ ↓ memory.closedToPenalize / ↓ adaptive.ignoredToShrink
 */
export const config = {
  /* ---------- نافذة التحكيم ---------- */
  windowMs: 2500,      // يجمع المرشّحين هذه المدة ثم يختار الأفضل (بدل «أول من يصل»)
  settleMs: 250,       // بعد barai.settle() (انتهاء تحميل بيانات الصفحة) نُنهي النافذة بعد هذه المدة
  maxHoldMs: 4000,     // لا ننتظر أكثر من هذا بعد أول مرشّح
  idleTimeoutMs: 1500, // مهلة requestIdleCallback للعرض (لا عمل ثقيل أثناء التحميل)
  retryMs: 2500,       // إعادة المحاولة إن كان الطالب مشغولًا (كتابة/فيديو…)
  maxTries: 3,

  /* ---------- الميزانية (سقف الظهور) ---------- */
  budget: {
    few:  { base: 3, min: 1, max: 4 },   // «قليل» (الافتراضي)
    many: { base: 6, min: 2, max: 7 },   // «كثير»
    reducedTo: 1                          // بعد إغلاقين متتاليين بلا تفاعل: باقي اليوم
  },
  /** تكيّف الميزانية داخل الجلسة */
  adaptive: {
    actedToGrow: 2,        // نقرتان على زر إجراء ⇒ فقاعة إضافية واحدة (حتى max)
    grow: 1,
    ignoredToShrink: 2,    // فقاعتان اختفتا وحدهما بلا أي تفاعل ⇒ ننزل إلى ignoredCap
    ignoredCap: 2
  },
  cooldownMs: { few: 90000, many: 45000, reducedMul: 3 },
  sameKeyMs: 24 * 60 * 60 * 1000,   // نفس الموقف لا يتكرر قبل مرور هذه المدة
  pageLimit: 1,                      // فقاعة تلقائية واحدة للصفحة (الأحداث «اللحظية» flow مستثناة من الصفحة والتهدئة)
  momentsMax: 2,

  /* ---------- الدرجات (كلها تُقارن ببعضها) ---------- */
  tiers: {
    critical:   { base: 100, rank: 0 },  // انقطاع النت، خطأ يمنع العمل
    actionable: { base: 60,  rank: 1 },  // قابل للتنفيذ الآن
    celebrate:  { base: 50,  rank: 2 },  // احتفالي
    contextual: { base: 28,  rank: 3 },  // سياقي (وقت/يوم/غياب)
    ambient:    { base: 10,  rank: 4 }   // محيطي بلا نص
  },
  minScore: 3,           // أقل نقاط للعرض (ما دونها ⇒ «ضعيف»). المواقف السياقية الخفيفة (جمعة/صباح/تخطيط فارغ) تسجّل 4–7 قبل الخصم

  /* ---------- الإرهاق وتكلفة المقاطعة ---------- */
  fatigue: {
    perCategory: 12, categoryWindowMs: 6 * 3600000,   // كل ظهور لنفس الفئة خلال 6 ساعات يخصم 12
    global: 5, globalWindowMs: 30 * 60000,            // كل ظهور خلال 30 دقيقة يخصم 5
    max: 40
  },
  interrupt: {
    base: 1,
    scrolling: 10, scrollMs: 1200,       // الطالب يمرّر الآن
    typing: 14, typingMs: 3000,          // كتب قبل لحظات
    idleBonus: -1, idleMs: 6000,         // ساكن ⇒ المقاطعة أرخص
    justLanded: 5, landedMs: 1500        // الصفحة لتوّها فُتحت
  },

  /* ---------- الذاكرة والتكيّف ---------- */
  memory: {
    closedToPenalize: 3,      // 3 إغلاقات بـ × على الأقل…
    closedRate: 0.6,          // …وبنسبة ≥ 60% من الظهور
    penaltyMult: 0.5,         // ⇒ وزن الفئة ×0.5
    penaltyMs: 3 * 24 * 3600000,   // …ومنعها هذه المدة
    boostActed: 2,            // نقر الإجراء مرتين فأكثر بنسبة ≥ 50%
    boostRate: 0.5,
    boostMult: 1.15,
    lastLinesPerKey: 3,       // لا تكرار آخر 3 صيغ لكل موقف عبر الجلسات
    maxRecent: 40
  },

  /* ---------- الاسم الأول: نادر ---------- */
  name: { everyNth: 4, preferChance: 0.65 },   // مرة تقريبًا كل 4 رسائل

  /* ---------- الرسائل المدمجة ---------- */
  compound: {
    enabled: true,
    minScore: 22,      // الثاني يجب أن يكون قويًا
    minRatio: 0.45     // ونقاطه ≥ 45% من الأول
  },

  /* ---------- اتجاه الدرجات (محليًا) ---------- */
  trend: { window: 8, delta: 8, lowPct: 50 },   // تحسّن/تراجع = فرق ≥ 8 نقاط مئوية بين النصفين

  /* ---------- سياق الجلسة ---------- */
  context: {
    idleSleepMs: 60000,        // نعاس برعي بعد 60 ثانية بلا لمس (الرئيسية)
    returningAwayDays: 3,      // «وحشتنا» بعد 3 أيام غياب
    nearGapRatio: 0.35,        // «باقي لك X» إن كان النقص ≤ 35% من السعر
    lowStock: 3,
    poorRatio: 0.35,
    shortTextLen: 70           // نص قصير للنت الضعيف/الليل
  },

  /* ---------- ثوابت أخرى ---------- */
  avoid: { selector: "[data-barai-avoid]", gap: 8 },
  bubble: { minTtl: 4000, maxTtl: 7000, perChar: 55, base: 2500, scrollDismiss: 90 },

  /* ---------- أوزان كل موقف (الأهمية × الإلحاح) ----------
     tier: الدرجة، cat: الفئة (للإرهاق والتكيّف)، imp/urg ∈ (0..1]
     flow: ناتج مباشرة عن فعل الطالب الآن ⇒ يتجاوز تهدئة الصفحة والتهدئة الزمنية (لكن لا الميزانية ولا «صامت»)  */
  events: {
    "exam.new":         { tier: "actionable", cat: "exam",     imp: 0.90, urg: 0.80 },
    "exam.intro":       { tier: "contextual", cat: "exam",     imp: 0.50, urg: 0.90, flow: true },
    "exam.result":      { tier: "celebrate",  cat: "exam",     imp: 0.80, urg: 0.90 },
    "announce.unread":  { tier: "actionable", cat: "announce", imp: 0.75, urg: 0.70 },
    "announce.onPage":  { tier: "contextual", cat: "announce", imp: 0.50, urg: 0.50 },
    "announce.allRead": { tier: "contextual", cat: "announce", imp: 0.35, urg: 0.40 },
    "event.live":       { tier: "actionable", cat: "event",    imp: 0.70, urg: 0.90 },
    "event.ended":      { tier: "contextual", cat: "event",    imp: 0.30, urg: 0.30 },
    "planner.empty":    { tier: "contextual", cat: "planner",  imp: 0.45, urg: 0.45 },
    "planner.overdue":  { tier: "actionable", cat: "planner",  imp: 0.70, urg: 0.65 },
    "planner.taskDone": { tier: "celebrate",  cat: "planner",  imp: 0.40, urg: 0.80, flow: true },
    "planner.allDone":  { tier: "celebrate",  cat: "planner",  imp: 0.85, urg: 0.95, flow: true },
    "streak.milestone": { tier: "celebrate",  cat: "streak",   imp: 0.80, urg: 0.70 },
    "lesson.completed": { tier: "celebrate",  cat: "lesson",   imp: 0.50, urg: 0.80, flow: true },
    "lesson.returning": { tier: "contextual", cat: "lesson",   imp: 0.65, urg: 0.60 },
    "time.lateNight":   { tier: "contextual", cat: "time",     imp: 0.70, urg: 0.75 },
    "time.morning":     { tier: "contextual", cat: "time",     imp: 0.45, urg: 0.45 },
    "time.friday":      { tier: "contextual", cat: "time",     imp: 0.40, urg: 0.40 },
    "login.first":      { tier: "contextual", cat: "login",    imp: 0.50, urg: 0.50 },
    "login.firstStep":  { tier: "actionable", cat: "login",    imp: 0.80, urg: 0.90, flow: true },
    "login.success":    { tier: "celebrate",  cat: "login",    imp: 0.60, urg: 0.70 },
    "bank.orderStatus": { tier: "actionable", cat: "bank",     imp: 0.90, urg: 0.75 },
    "bank.earned":      { tier: "celebrate",  cat: "bank",     imp: 0.75, urg: 0.80 },
    "bank.afford":      { tier: "actionable", cat: "bank",     imp: 0.65, urg: 0.55 },
    "bank.near":        { tier: "actionable", cat: "bank",     imp: 0.55, urg: 0.45 },
    "bank.newReward":   { tier: "actionable", cat: "bank",     imp: 0.55, urg: 0.50 },
    "bank.lowStock":    { tier: "actionable", cat: "bank",     imp: 0.45, urg: 0.55 },
    "bank.blocked":     { tier: "contextual", cat: "bank",     imp: 0.70, urg: 0.60 },
    "bank.welcome":     { tier: "contextual", cat: "bank",     imp: 0.65, urg: 0.60 },
    "bank.poor":        { tier: "contextual", cat: "bank",     imp: 0.30, urg: 0.30 },
    "bank.redeem":      { tier: "celebrate",  cat: "bank",     imp: 0.90, urg: 1.00, flow: true },
    "ai.open":          { tier: "contextual", cat: "ai",       imp: 0.40, urg: 0.60, flow: true },
    "ai.limit":         { tier: "actionable", cat: "ai",       imp: 0.70, urg: 0.90, flow: true },
    "ai.error":         { tier: "critical",   cat: "error",    imp: 1, urg: 1 },
    "net.offline":      { tier: "critical",   cat: "net",      imp: 1, urg: 1 },
    "net.slow":         { tier: "critical",   cat: "net",      imp: 1, urg: 1 },
    "net.back":         { tier: "critical",   cat: "net",      imp: 1, urg: 1 },
    "net.failed":       { tier: "critical",   cat: "net",      imp: 1, urg: 1 },
    "error.generic":    { tier: "critical",   cat: "error",    imp: 1, urg: 1 },
    "login.fail":       { tier: "critical",   cat: "login",    imp: 1, urg: 1 },
    "egg.joke":         { tier: "critical",   cat: "egg",      imp: 1, urg: 1 },
    "egg.intro":        { tier: "critical",   cat: "egg",      imp: 1, urg: 1 }
  }
};

export default config;
