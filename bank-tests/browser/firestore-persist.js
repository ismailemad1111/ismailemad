/* غلاف لمحاكي Firestore: يحفظ المخزن في sessionStorage بين الصفحات (لاختبارات المتصفح فقط) */
import * as base from "/__stubs/firestore.js";
export * from "/__stubs/firestore.js";
const KEY = "__fs_store";
const enc = (v) => (v && typeof v.toMillis === "function" ? { __ts: v.toMillis() } : v);
const dec = (v) => (v && typeof v === "object" && "__ts" in v ? base.Timestamp.fromMillis(v.__ts) : v);
try {
  const raw = sessionStorage.getItem(KEY);
  if (raw) for (const [p, e] of JSON.parse(raw)) base.store.set(p, { version: e.version, data: Object.fromEntries(Object.entries(e.data).map(([k, v]) => [k, dec(v)])) });
} catch (e) { /* sandboxed */ }
function save() {
  try {
    sessionStorage.setItem(KEY, JSON.stringify([...base.store].map(([p, e]) => [p, { version: e.version, data: Object.fromEntries(Object.entries(e.data).map(([k, v]) => [k, enc(v)])) }])));
  } catch (e) { /* ignore */ }
}
const wrap = (fn) => async (...a) => { const r = await fn(...a); save(); return r; };
export const setDoc = wrap(base.setDoc);
export const updateDoc = wrap(base.updateDoc);
export const addDoc = wrap(base.addDoc);
export const deleteDoc = wrap(base.deleteDoc);
export const runTransaction = wrap(base.runTransaction);
export const writeBatch = (...a) => { const b = base.writeBatch(...a); const c = b.commit.bind(b); b.commit = async () => { const r = await c(); save(); return r; }; return b; };
