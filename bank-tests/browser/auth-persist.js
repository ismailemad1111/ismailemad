/* غلاف لمحاكي Auth: المستخدم الحالي يأتي من sessionStorage.__auth_uid */
import { authState } from "/__stubs/auth.js";
export * from "/__stubs/auth.js";
try { const uid = sessionStorage.getItem("__auth_uid"); authState.currentUser = uid ? { uid } : null; } catch (e) { /* sandboxed */ }

/* صفحة setup.html: تسجيل دخول الأدمن في الاختبارات يعيد المستخدم المخزَّن دون كلمة مرور حقيقية */
export const signInWithEmailAndPassword = async () => { const f = sessionStorage.getItem("__auth_fail"); if (f) { const e = new Error(f); e.code = f; throw e; } const uid = sessionStorage.getItem("__auth_uid") || "admXXXX9999YYYY8888ZZZZ7777"; authState.currentUser = { uid }; return { user: { uid } }; };
