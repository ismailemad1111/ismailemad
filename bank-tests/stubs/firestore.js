/* محاكي Firestore بسيط في الذاكرة: يدعم المعاملات مع كشف التعارض (إعادة المحاولة) */
export class Timestamp {
  constructor(ms) { this._ms = ms; }
  static fromMillis(ms) { return new Timestamp(ms); }
  static now() { return new Timestamp(Date.now()); }
  toMillis() { return this._ms; }
  toDate() { return new Date(this._ms); }
}
const SERVER_TS = { __serverTs: true };
export const serverTimestamp = () => SERVER_TS;

export const store = new Map();     // path -> { data, version }
export const stats = { commits: 0, retries: 0, failNextCommit: 0, commitLog: [], denyGet: new Set(), docsRead: 0, aggQueries: 0, aggReads: 0 }; // denyGet: مسارات ترفضها "القواعد" بـ permission-denied
let idCounter = 0;

class DocRef { constructor(path) { this.path = path; this.id = path.split("/").pop(); } }
class ColRef { constructor(name) { this.name = name; } }

export const initializeFirestore = () => ({ __db: true });
export const doc = (db, name, id) => new DocRef(`${name}/${id}`);
export const collection = (db, name) => new ColRef(name);
export const where = (field, op, value) => ({ field, op, value });
export const query = (c, ...constraints) => ({ col: c, constraints });
export const limit = (n) => ({ limit: n });
export const documentId = () => ({ __docId: true });
export const orderBy = (field, dir = "asc") => ({ orderBy: field, dir });
export const startAfter = (snap) => ({ startAfter: snap });
export const sum = (field) => ({ __agg: "sum", field });

function resolve(data, now) {
  const out = {};
  for (const [k, v] of Object.entries(data)) {
    out[k] = v === SERVER_TS ? Timestamp.fromMillis(now) : v;
  }
  return out;
}
class Snap {
  constructor(id, data) { this.id = id; this._d = data; }
  exists() { return this._d !== undefined; }
  data() { return this._d ? { ...this._d } : undefined; }
}
export async function getDoc(r) {
  await Promise.resolve();
  if (stats.denyGet.has(r.path)) throw Object.assign(new Error("Missing or insufficient permissions."), { code: "permission-denied" });
  const e = store.get(r.path);
  return new Snap(r.id, e ? e.data : undefined);
}
const num = (v) => (v && typeof v.toMillis === "function" ? v.toMillis() : v);
const kind = (v) => (v && typeof v.toMillis === "function" ? "ts" : typeof v);
/* مقارنة بنفس منطق Firestore: لا مقارنة بين أنواع مختلفة (النتيجة null = لا تطابق) */
function cmp(a, b) {
  if (a === undefined || a === null || kind(a) !== kind(b)) return null;
  const x = num(a), y = num(b);
  return x < y ? -1 : x > y ? 1 : 0;
}
function matches(id, d, c) {
  return c.every((x) => {
    const v = x.field && x.field.__docId ? id : d[x.field];
    if (x.op === "==") return v === x.value;
    if (x.op === "in") return x.value.includes(v);
    if (x.op === ">=") return cmp(v, x.value) !== null && cmp(v, x.value) >= 0;
    return true;
  });
}
function run(q) {
  const name = q.name || q.col.name;
  const cons = (q.constraints || []).filter((c) => c.field);
  const out = [];
  for (const [path, e] of store) {
    if (!path.startsWith(name + "/")) continue;
    const id = path.slice(name.length + 1);
    if (!matches(id, e.data, cons)) continue;
    out.push(new Snap(id, e.data));
  }
  // orderBy / startAfter / limit (محاكاة سلوك Firestore: المستند الذي ينقصه حقل الترتيب يُستبعد)
  const all = q.constraints || [];
  const orders = all.filter((c) => c.orderBy !== undefined);
  let rows = out;
  if (orders.length) {
    const val = (s, o) => (o.orderBy && o.orderBy.__docId ? s.id : s._d[o.orderBy]);
    rows = rows.filter((s) => orders.every((o) => o.orderBy.__docId || (s._d[o.orderBy] !== undefined && s._d[o.orderBy] !== null)));
    rows.sort((a, b) => {
      for (const o of orders) {
        const va = num(val(a, o)), vb = num(val(b, o));
        if (va === vb) continue;
        return (va < vb ? -1 : 1) * (o.dir === "desc" ? -1 : 1);
      }
      return 0;
    });
    const sa = all.find((c) => c.startAfter);
    if (sa) {
      const i = rows.findIndex((s) => s.id === sa.startAfter.id);
      rows = i >= 0 ? rows.slice(i + 1) : rows;
    }
  }
  const lim = all.find((c) => typeof c.limit === "number");
  if (lim) rows = rows.slice(0, lim.limit);
  return rows;
}
export async function getDocs(q) {
  await Promise.resolve();
  const out = run(q);
  stats.docsRead += out.length;   // كل مستند يعود = قراءة مفوترة
  return { docs: out };
}
/* aggregate: لا مستندات تعود؛ الفوترة قراءة واحدة لكل 1000 مدخل (حد أدنى 1) */
export async function getCountFromServer(q) {
  await Promise.resolve();
  const n = run(q).length;
  stats.aggQueries++; stats.aggReads += Math.max(1, Math.ceil(n / 1000));
  return { data: () => ({ count: n }) };
}
export async function getAggregateFromServer(q, spec) {
  await Promise.resolve();
  const docs = run(q);
  stats.aggQueries++; stats.aggReads += Math.max(1, Math.ceil(docs.length / 1000));
  const out = {};
  for (const [k, a] of Object.entries(spec)) {
    out[k] = docs.reduce((acc, d) => (typeof d._d[a.field] === "number" ? acc + d._d[a.field] : acc), 0);
  }
  return { data: () => out };
}
function write(path, data, merge) {
  const prev = store.get(path);
  store.set(path, { data: merge ? { ...prev.data, ...data } : data, version: (prev ? prev.version : 0) + 1 });
}
export async function setDoc(r, data) { write(r.path, resolve(data, Date.now()), false); }
export async function updateDoc(r, data) {
  if (!store.has(r.path)) throw Object.assign(new Error("not-found"), { code: "not-found" });
  write(r.path, resolve(data, Date.now()), true);
}
export async function addDoc(c, data) {
  const r = new DocRef(`${c.name}/auto${++idCounter}${Math.random().toString(36).slice(2, 8)}`);
  write(r.path, resolve(data, Date.now()), false);
  return r;
}
export async function deleteDoc(r) { store.delete(r.path); }
export const writeBatch = () => {
  const ops = [];
  return {
    delete(r) { ops.push(r); return this; },
    async commit() { ops.forEach((r) => store.delete(r.path)); }
  };
};

export async function runTransaction(db, fn) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const reads = new Map();   // path -> version seen
    const writes = [];
    const tx = {
      async get(r) {
        await Promise.resolve(); await Promise.resolve();
        if (stats.denyGet.has(r.path)) throw Object.assign(new Error("Missing or insufficient permissions."), { code: "permission-denied" });
        const e = store.get(r.path);
        reads.set(r.path, e ? e.version : 0);
        return new Snap(r.id, e ? e.data : undefined);
      },
      set(r, data) { writes.push({ op: "set", r, data }); return tx; },
      update(r, data) { writes.push({ op: "update", r, data }); return tx; }
    };
    const result = await fn(tx);
    // ---- commit (متزامن = ذري) ----
    let conflict = false;
    for (const [path, v] of reads) {
      const e = store.get(path);
      if ((e ? e.version : 0) !== v) conflict = true;
    }
    if (conflict) { stats.retries++; continue; }
    if (writes.length === 0) return result;   // معاملة قراءة فقط: لا تكتب شيئًا (كما في Firestore)
    if (stats.failNextCommit > 0) {
      stats.failNextCommit--;
      throw Object.assign(new Error("unavailable"), { code: "unavailable", name: "FirebaseError" });
    }
    const now = Date.now();
    // تحقق مسبق: set لا يكتب فوق مستند موجود (محاكاة create في القواعد) و update يتطلب وجوده
    for (const w of writes) {
      const exists = store.has(w.r.path);
      if (w.op === "set" && exists) throw new Error("TEST: set over existing doc " + w.r.path);
      if (w.op === "update" && !exists) throw new Error("TEST: update of missing doc " + w.r.path);
    }
    for (const w of writes) {
      if (w.op === "set") write(w.r.path, resolve(w.data, now), false);
      else write(w.r.path, resolve(w.data, now), true);
    }
    stats.commits++;
    stats.commitLog.push(writes.map((w) => `${w.op}:${w.r.path}`));
    return result;
  }
  throw new Error("transaction exceeded retries");
}
