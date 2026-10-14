/* ============================================================
   js/backend/settings.js — إعدادات عامة يحتاجها الطالب
   ============================================================ */
import { route, ok, requireStudent, getDocData } from "./core.js";

route("GET", "/api/student/settings", async () => {
  requireStudent();
  const d = await getDocData("settings", "general");
  return ok({
    settings: {
      prayerEnabled: d ? d.prayerEnabled !== false : true
    }
  });
});
