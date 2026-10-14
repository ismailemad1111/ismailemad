/* ============================================================
   js/backend/planner.js — منظّم الدراسة + جلسات المذاكرة (جهة الطالب)
   planner/{studentId}_{week} = { studentId, week, tasksByDay }
   ============================================================ */

import {
  fs, db, col, route, ok, bad, safeText, clamp, randomToken,
  requireStudent, getDocData, ref
} from "./core.js";

function clone(v) {
  return JSON.parse(JSON.stringify(v || {}));
}

route("GET", "/api/planner/tasks", async ({ query }) => {
  const me = requireStudent();
  const key = safeText(query.week) || "current";
  const data = await getDocData("planner", `${me.id}_${key}`);
  return ok({ tasksByDay: (data && data.tasksByDay) || {} });
});

route("POST", "/api/planner/tasks", async ({ body }) => {
  const me = requireStudent();
  const title = safeText(body.title);
  const day = safeText(body.day);
  const time = safeText(body.time);
  const week = safeText(body.week);

  if (!title || title.length > 150) bad("BAD_REQUEST", "عنوان المهمة غير صالح.");
  if (!day || !time) bad("BAD_REQUEST", "اليوم والوقت مطلوبان.");
  if (!week) bad("BAD_REQUEST", "الأسبوع مطلوب.");

  const docRef = ref("planner", `${me.id}_${week}`);
  const task = {
    id: randomToken(),
    title,
    day,
    time,
    completed: false,
    createdAt: new Date().toISOString()
  };

  await fs.runTransaction(db, async (tx) => {
    const snap = await tx.get(docRef);
    const data = snap.exists() ? (snap.data() || {}) : {};
    const tasksByDay = clone(data.tasksByDay);
    if (!Array.isArray(tasksByDay[day])) tasksByDay[day] = [];
    tasksByDay[day].push(task);
    tasksByDay[day].sort((a, b) => (a.time || "").localeCompare(b.time || ""));
    tx.set(docRef, {
      studentId: me.id,
      week,
      tasksByDay,
      updatedAt: fs.serverTimestamp()
    }, { merge: true });
  });

  return ok({ task });
});

route("PATCH", "/api/planner/tasks/:id", async ({ params, body }) => {
  const me = requireStudent();
  const taskId = safeText(params.id);
  const week = safeText(body.week);
  if (!taskId) bad("BAD_REQUEST", "معرّف المهمة مطلوب.");
  if (!week) bad("BAD_REQUEST", "الأسبوع مطلوب.");

  const docRef = ref("planner", `${me.id}_${week}`);
  let found = false;

  await fs.runTransaction(db, async (tx) => {
    found = false;
    const snap = await tx.get(docRef);
    if (!snap.exists()) return;
    const tasksByDay = clone((snap.data() || {}).tasksByDay);

    for (const dayKey of Object.keys(tasksByDay)) {
      const list = tasksByDay[dayKey];
      if (!Array.isArray(list)) continue;
      const idx = list.findIndex((t) => t && t.id === taskId);
      if (idx >= 0) {
        if (typeof body.title === "string") list[idx].title = safeText(body.title);
        if (typeof body.time === "string") list[idx].time = safeText(body.time);
        if (typeof body.done === "boolean") {
          list[idx].completed = body.done;
          list[idx].completedAt = body.done ? new Date().toISOString() : null;
        }
        found = true;
        break;
      }
    }
    if (found) tx.update(docRef, { tasksByDay, updatedAt: fs.serverTimestamp() });
  });

  if (!found) bad("NOT_FOUND", "المهمة غير موجودة.");
  return ok({ updated: true });
});

route("DELETE", "/api/planner/tasks/:id", async ({ params, query }) => {
  const me = requireStudent();
  const taskId = safeText(params.id);
  const week = safeText(query.week);
  if (!taskId) bad("BAD_REQUEST", "معرّف المهمة مطلوب.");
  if (!week) bad("BAD_REQUEST", "الأسبوع مطلوب.");

  const docRef = ref("planner", `${me.id}_${week}`);
  let removed = false;

  await fs.runTransaction(db, async (tx) => {
    removed = false;
    const snap = await tx.get(docRef);
    if (!snap.exists()) return;
    const tasksByDay = clone((snap.data() || {}).tasksByDay);

    for (const dayKey of Object.keys(tasksByDay)) {
      const list = tasksByDay[dayKey];
      if (!Array.isArray(list)) continue;
      const before = list.length;
      tasksByDay[dayKey] = list.filter((t) => !(t && t.id === taskId));
      if (tasksByDay[dayKey].length < before) { removed = true; break; }
    }
    if (removed) tx.update(docRef, { tasksByDay, updatedAt: fs.serverTimestamp() });
  });

  if (!removed) bad("NOT_FOUND", "المهمة غير موجودة.");
  return ok({ deleted: true });
});

route("POST", "/api/planner/sessions", async ({ body }) => {
  const me = requireStudent();
  const durationMinutes = clamp(Number(body.durationMinutes), 1, 600);

  await fs.addDoc(col("studySessions"), {
    studentId: me.id,
    durationMinutes,
    date: new Date(),
    createdAt: fs.serverTimestamp()
  });

  try {
    const studentRef = ref("students", me.id);
    const added = durationMinutes / 60;
    await fs.runTransaction(db, async (tx) => {
      const snap = await tx.get(studentRef);
      if (!snap.exists()) return;
      const current = Number(snap.data().studyHoursTotal) || 0;
      tx.update(studentRef, { studyHoursTotal: current + added });
    });
  } catch (e) { /* لا يؤثر */ }

  return ok({ logged: true });
});
