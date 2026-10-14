/**
 * worker/index.js
 * ------------------------------------------------------------
 * منصة أ/ إسماعيل عماد التعليمية
 * Cloudflare Worker — نقطة الدخول الرئيسية
 *
 * المكان: /worker/index.js
 *
 * المرجع:
 *   - الوثيقة الأصلية (بنود 6، 42، 43، 62، 63، 64، 74–88،
 *                       104–114، 127–131، 141، 143، 183–188)
 *
 * ⚠️ قواعد صارمة:
 *   - لا Secrets في الكود (بند 62، 143).
 *   - التصحيح في Worker (بند 42).
 *   - correctIndex ما يُبعتش للطالب (بند 43).
 *   - كل الطلبات الحساسة تمر من هنا (بند 6، 109).
 *   - Idempotency على العمليات الحساسة (بند 183).
 *
 * ⚠️ Endpoints:
 *   GET    /api/ping
 *   POST   /api/auth/login
 *   POST   /api/auth/logout
 *   POST   /api/auth/admin
 *   POST   /api/auth/refresh
 *   GET    /api/lessons
 *   POST   /api/lessons/:id/open
 *   GET    /api/announcements
 *   GET    /api/announcements/unread-count
 *   POST   /api/announcements/:id/read
 *   POST   /api/announcements/reply
 *   GET    /api/exams
 *   POST   /api/exams/start
 *   POST   /api/exams/submit
 *   GET    /api/exams/result
 *   GET    /api/planner/tasks
 *   POST   /api/planner/tasks
 *   PATCH  /api/planner/tasks/:id
 *   DELETE /api/planner/tasks/:id
 *   POST   /api/planner/sessions
 *   POST   /api/ai/chat
 *   GET    /api/student/profile
 *   GET    /api/lesson-groups
 *   POST   /api/subscription-requests
 *   GET    /api/admin/statistics
 *   GET    /api/admin/codes
 *   POST   /api/admin/codes/create
 *   PATCH  /api/admin/codes/:id
 *   GET    /api/admin/students
 *   GET    /api/admin/students/:id
 *   GET    /api/admin/requests
 *   PATCH  /api/admin/requests/:id
 *   GET    /api/admin/announcements
 *   POST   /api/admin/announcements
 *   PATCH  /api/admin/announcements/:id
 *   DELETE /api/admin/announcements/:id
 *   GET    /api/admin/announcements/:id/replies
 *   GET    /api/admin/lessons
 *   POST   /api/admin/lessons
 *   PATCH  /api/admin/lessons/:id
 *   DELETE /api/admin/lessons/:id
 *   GET    /api/admin/exams
 *   POST   /api/admin/exams
 *   PATCH  /api/admin/exams/:id
 *   PATCH  /api/admin/exams/:id/publish
 *   DELETE /api/admin/exams/:id
 *   GET    /api/admin/results
 *   GET    /api/admin/settings
 *   PATCH  /api/admin/settings
 *   GET    /api/admin/lesson-groups
 *   POST   /api/admin/lesson-groups
 *   PATCH  /api/admin/lesson-groups/:id
 *   DELETE /api/admin/lesson-groups/:id
 * ------------------------------------------------------------
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";

// Firestore REST implementation for Cloudflare Workers.
// لا يعتمد على firebase-admin أو gRPC/Node runtime.
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";


/* ============================================================
   01 — Firestore REST Init
   ============================================================ */

let firestoreClient = null;

const FieldValue = {
  serverTimestamp() { return { __firestoreSentinel: "serverTimestamp" }; }
};

function base64Url(bytes) {
  let binary = "";
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) binary += String.fromCharCode(arr[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function utf8Base64Url(text) {
  return base64Url(new TextEncoder().encode(text));
}

function pemToArrayBuffer(pem) {
  const b64 = pem.replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function deepClone(value) {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date) return new Date(value.getTime());
  if (Array.isArray(value)) return value.map(deepClone);
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = deepClone(v);
  return out;
}

function toFirestoreValue(value) {
  if (value && value.__firestoreSentinel === "serverTimestamp") return null;
  if (value === null) return { nullValue: null };
  if (value === undefined) return null;
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "number") {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (typeof value === "bigint") return { integerValue: value.toString() };
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(toFirestoreValue).filter(Boolean) } };
  }
  if (typeof value === "object") {
    const fields = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined || (v && v.__firestoreSentinel)) continue;
      const fv = toFirestoreValue(v);
      if (fv) fields[k] = fv;
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(value) };
}

function fromFirestoreValue(v) {
  if (!v) return null;
  if ("nullValue" in v) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("integerValue" in v) {
    const n = Number(v.integerValue);
    return Number.isSafeInteger(n) ? n : BigInt(v.integerValue);
  }
  if ("doubleValue" in v) return Number(v.doubleValue);
  if ("timestampValue" in v) return new Date(v.timestampValue);
  if ("bytesValue" in v) return v.bytesValue;
  if ("referenceValue" in v) return v.referenceValue;
  if ("geoPointValue" in v) return {
    latitude: Number(v.geoPointValue.latitude),
    longitude: Number(v.geoPointValue.longitude)
  };
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(fromFirestoreValue);
  if ("mapValue" in v) return fromFirestoreFields(v.mapValue.fields || {});
  return null;
}

function fromFirestoreFields(fields = {}) {
  const out = {};
  for (const [k, v] of Object.entries(fields)) out[k] = fromFirestoreValue(v);
  return out;
}

function randomId() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 20);
}

function pathEncode(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

class FirestoreDocSnapshot {
  constructor(ref, raw) {
    this.ref = ref;
    this.id = ref.id;
    this.exists = !!raw;
    this._raw = raw;
  }
  data() { return this.exists ? fromFirestoreFields(this._raw.fields || {}) : undefined; }
}

class FirestoreDocRef {
  constructor(client, collection, id) {
    this.client = client;
    this.collectionName = collection;
    this.id = id || randomId();
  }
  get path() { return `${this.collectionName}/${this.id}`; }
  async get() { return this.client.getDoc(this); }
  async set(data, options = {}) { return this.client.setDoc(this, data, options); }
  async update(data) { return this.client.updateDoc(this, data); }
  async delete() { return this.client.deleteDoc(this); }
  async create(data) { return this.client.createDoc(this, data); }
}

class FirestoreQuery {
  constructor(client, collection, filters = [], order = null, lim = null) {
    this.client = client; this.collectionName = collection; this.filters = filters; this.order = order; this.lim = lim;
  }
  where(field, op, value) { return new FirestoreQuery(this.client, this.collectionName, [...this.filters, [field, op, value]], this.order, this.lim); }
  orderBy(field, dir = "asc") { return new FirestoreQuery(this.client, this.collectionName, this.filters, { field, dir }, this.lim); }
  limit(n) { return new FirestoreQuery(this.client, this.collectionName, this.filters, this.order, n); }
  async get() { return this.client.query(this); }
}

class FirestoreWriteBatch {
  constructor(client) { this.client = client; this.writes = []; }
  set(ref, data, options = {}) { this.writes.push({ type: "set", ref, data, options }); return this; }
  update(ref, data) { this.writes.push({ type: "update", ref, data }); return this; }
  delete(ref) { this.writes.push({ type: "delete", ref }); return this; }
  async commit() { return this.client.commitBatch(this.writes); }
}

class FirestoreTransaction {
  constructor(client, tx) { this.client = client; this.tx = tx; this.writes = []; }
  async get(ref) { return this.client.getDoc(ref, this.tx); }
  set(ref, data, options = {}) { this.writes.push({ type: "set", ref, data, options }); return this; }
  update(ref, data) { this.writes.push({ type: "update", ref, data }); return this; }
  delete(ref) { this.writes.push({ type: "delete", ref }); return this; }
}

class FirestoreREST {
  constructor(serviceAccount) {
    this.projectId = serviceAccount.project_id;
    this.clientEmail = serviceAccount.client_email;
    this.privateKeyPem = serviceAccount.private_key;
    if (!this.projectId || !this.clientEmail || !this.privateKeyPem) throw new Error("Invalid FIREBASE_SERVICE_ACCOUNT");
    this.base = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(this.projectId)}/databases/(default)/documents`;
    this.token = null;
    this.tokenExp = 0;
    this.keyPromise = null;
  }

  collection(name) { return new FirestoreCollection(this, name); }
  batch() { return new FirestoreWriteBatch(this); }

  async getAccessToken() {
    const now = Math.floor(Date.now() / 1000);
    if (this.token && this.tokenExp > now + 60) return this.token;
    if (!this.keyPromise) {
      this.keyPromise = crypto.subtle.importKey(
        "pkcs8", pemToArrayBuffer(this.privateKeyPem),
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]
      );
    }
    const header = utf8Base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const payload = utf8Base64Url(JSON.stringify({
      iss: this.clientEmail,
      scope: "https://www.googleapis.com/auth/datastore",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600
    }));
    const input = `${header}.${payload}`;
    const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", await this.keyPromise, new TextEncoder().encode(input));
    const assertion = `${input}.${base64Url(sig)}`;
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${encodeURIComponent(assertion)}`
    });
    if (!res.ok) throw new Error(`Google OAuth failed (${res.status})`);
    const data = await res.json();
    this.token = data.access_token;
    this.tokenExp = now + Number(data.expires_in || 3600);
    return this.token;
  }

  async request(url, options = {}) {
    const token = await this.getAccessToken();
    const headers = { ...(options.headers || {}), Authorization: `Bearer ${token}` };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    const res = await fetch(url, { ...options, headers });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Firestore REST ${res.status}: ${text.slice(0, 500)}`);
    }
    if (res.status === 204) return null;
    return res.json();
  }

  async getDoc(ref, transactionId = null) {
    try {
      if (transactionId) {
        const raw = await this.request(`${this.base.replace(/\/documents$/, "")}:batchGet`, {
          method: "POST",
          body: JSON.stringify({
            documents: [`${this.base}/${pathEncode(ref.path)}`],
            transaction: transactionId
          })
        });
        const row = Array.isArray(raw) ? raw[0] : null;
        return new FirestoreDocSnapshot(ref, row?.found || null);
      }
      const raw = await this.request(`${this.base}/${pathEncode(ref.path)}`);
      return new FirestoreDocSnapshot(ref, raw);
    } catch (e) {
      if (String(e.message).includes("Firestore REST 404")) return new FirestoreDocSnapshot(ref, null);
      throw e;
    }
  }

  _fieldsAndTransforms(data) {
    const fields = {};
    const transforms = [];
    for (const [k, v] of Object.entries(data || {})) {
      if (v && v.__firestoreSentinel === "serverTimestamp") {
        transforms.push({ fieldPath: k, setToServerValue: "REQUEST_TIME" });
      } else if (v !== undefined) {
        fields[k] = toFirestoreValue(v);
      }
    }
    return { fields, transforms };
  }

  _write(ref, data, options = {}, update = false) {
    const { fields, transforms } = this._fieldsAndTransforms(data);
    const document = { name: `${this.base}/${pathEncode(ref.path)}`, fields };
    const body = { document };
    if (transforms.length) body.transforms = transforms;
    if (options.merge || update) {
      const maskFields = Object.keys(fields);
      if (maskFields.length) body.updateMask = { fieldPaths: maskFields };
      if (transforms.length && !maskFields.length) body.updateMask = { fieldPaths: [] };
    }
    return body;
  }

  async createDoc(ref, data) {
    // Atomic create: Firestore will reject the write if this document ID
    // already exists. This is required for one-attempt-only operations where
    // a query-then-set sequence is vulnerable to concurrent requests.
    const { fields, transforms } = this._fieldsAndTransforms(data);
    const update = {
      name: `${this.base}/${pathEncode(ref.path)}`,
      fields
    };
    const write = {
      update,
      currentDocument: { existing: false }
    };
    if (transforms.length) write.updateTransforms = transforms;

    try {
      await this._commitWrites([write]);
      return new FirestoreDocSnapshot(ref, update);
    } catch (err) {
      // Keep the wrapper API consistent with Firestore's ALREADY_EXISTS
      // semantic so callers can handle duplicate creates explicitly.
      if (/Firestore REST 409/i.test(String(err?.message || err))) {
        const existsErr = new Error("Firestore document already exists");
        existsErr.code = 6;
        throw existsErr;
      }
      throw err;
    }
  }

  async setDoc(ref, data, options = {}, transactionId = null) {
    const body = this._write(ref, data, options, !!options.merge);
    let url = `${this.base}/${pathEncode(ref.path)}`;
    const qs = [];
    if (options.merge && body.updateMask?.fieldPaths?.length) qs.push(`updateMask.fieldPaths=${body.updateMask.fieldPaths.map(encodeURIComponent).join("&updateMask.fieldPaths=")}`);
    if (transactionId) qs.push(`transaction=${encodeURIComponent(transactionId)}`);
    if (qs.length) url += `?${qs.join("&")}`;
    await this.request(url, { method: "PATCH", body: JSON.stringify(body.document) });
    if (body.transforms.length) {
      await this._commitWrites([{ update: body.document, updateTransforms: body.transforms }], transactionId);
    }
    return new FirestoreDocSnapshot(ref, body.document);
  }

  async updateDoc(ref, data, transactionId = null) {
    const { fields, transforms } = this._fieldsAndTransforms(data);
    const document = { name: `${this.base}/${pathEncode(ref.path)}`, fields };
    if (transactionId) {
      this._queueOnly = this._queueOnly || [];
      return this._queueOnly;
    }
    const qs = Object.keys(fields).map(k => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join("&");
    let url = `${this.base}/${pathEncode(ref.path)}${qs ? `?${qs}` : ""}`;
    if (!transforms.length) { await this.request(url, { method: "PATCH", body: JSON.stringify(document) }); }
    else { await this._commitWrites([{ update: document, updateMask: { fieldPaths: Object.keys(fields) }, updateTransforms: transforms }]); }
    return;
  }

  async deleteDoc(ref) {
    await this.request(`${this.base}/${pathEncode(ref.path)}`, { method: "DELETE" });
  }

  _fieldFilter(field, op, value) {
    const ops = { "==": "EQUAL", "<": "LESS_THAN", "<=": "LESS_THAN_OR_EQUAL", ">": "GREATER_THAN", ">=": "GREATER_THAN_OR_EQUAL", "!=": "NOT_EQUAL", "array-contains": "ARRAY_CONTAINS" };
    return { fieldFilter: { field: { fieldPath: field }, op: ops[op] || "EQUAL", value: toFirestoreValue(value) } };
  }

  async query(q, transactionId = null) {
    const filters = q.filters.map(([f, op, v]) => this._fieldFilter(f, op, v));
    const structuredQuery = { from: [{ collectionId: q.collectionName }] };
    if (filters.length === 1) structuredQuery.where = filters[0];
    else if (filters.length > 1) structuredQuery.where = { compositeFilter: { op: "AND", filters } };
    if (q.order) structuredQuery.orderBy = [{ field: { fieldPath: q.order.field }, direction: String(q.order.dir).toUpperCase() === "DESC" ? "DESCENDING" : "ASCENDING" }];
    if (q.lim) structuredQuery.limit = Number(q.lim);
    const body = { structuredQuery };
    if (transactionId) body.transaction = transactionId;
    const raw = await this.request(`${this.base}:runQuery`, { method: "POST", body: JSON.stringify(body) });
    const docs = [];
    for (const row of raw) {
      if (!row.document) continue;
      const name = row.document.name || "";
      const id = name.split("/").pop();
      docs.push(new FirestoreDocSnapshot(new FirestoreDocRef(this, q.collectionName, id), row.document));
    }
    return { empty: docs.length === 0, docs, size: docs.length };
  }

  async _commitWrites(writes, transaction = null) {
    const body = { writes };
    if (transaction) body.transaction = transaction;
    return this.request(`${this.base.replace(/\/documents$/, "")}:commit`, { method: "POST", body: JSON.stringify(body) });
  }

  _toWrite(w) {
    if (w.type === "delete") return { delete: `${this.base}/${pathEncode(w.ref.path)}` };
    const { fields, transforms } = this._fieldsAndTransforms(w.data);
    const write = { update: { name: `${this.base}/${pathEncode(w.ref.path)}`, fields } };
    if (w.type === "update" || w.options?.merge) write.updateMask = { fieldPaths: Object.keys(fields) };
    if (transforms.length) write.updateTransforms = transforms;
    return write;
  }

  async commitBatch(items) {
    const writes = items.map(w => this._toWrite(w));
    if (!writes.length) return [];
    // Firestore batchWrite accepts up to 500 writes, matching the existing admin UI limit.
    for (let i = 0; i < writes.length; i += 500) await this._commitWrites(writes.slice(i, i + 500));
    return [];
  }

  async runTransaction(callback) {
    // Firestore may abort a transaction when a document read inside it
    // changes before commit. Retry the whole transaction so concurrent
    // planner/usage/study-hour updates are re-read instead of losing data.
    const maxAttempts = 5;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const begin = await this.request(`${this.base.replace(/\/documents$/, "")}:beginTransaction`, {
        method: "POST",
        body: JSON.stringify({ options: { readWrite: {} } })
      });
      const tx = new FirestoreTransaction(this, begin.transaction);

      try {
        const result = await callback(tx);

        if (tx.writes.length) {
          await this._commitWrites(tx.writes.map(w => this._toWrite(w)), begin.transaction);
        } else {
          await this.request(`${this.base.replace(/\/documents$/, "")}:rollback`, {
            method: "POST",
            body: JSON.stringify({ transaction: begin.transaction })
          }).catch(() => {});
        }

        return result;
      } catch (e) {
        const message = String(e?.message || e);
        const retryable = /Firestore REST 409|ABORTED|Transaction.*aborted/i.test(message);

        if (!retryable || attempt === maxAttempts) throw e;

        await this.request(`${this.base.replace(/\/documents$/, "")}:rollback`, {
          method: "POST",
          body: JSON.stringify({ transaction: begin.transaction })
        }).catch(() => {});
      }
    }

    throw new Error("Firestore transaction failed after retries");
  }
}

class FirestoreCollection {
  constructor(client, name) { this.client = client; this.name = name; }
  doc(id) { return new FirestoreDocRef(this.client, this.name, id); }
  where(field, op, value) { return new FirestoreQuery(this.client, this.name).where(field, op, value); }
  orderBy(field, dir = "asc") { return new FirestoreQuery(this.client, this.name).orderBy(field, dir); }
  limit(n) { return new FirestoreQuery(this.client, this.name).limit(n); }
  async add(data) { const ref = this.doc(); await ref.set(data); return ref; }
  get() { return new FirestoreQuery(this.client, this.name).get(); }
}

function initFirebase(env) {
  if (firestoreClient) return firestoreClient;
  const raw = env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT secret is missing");
  let serviceAccount;
  try { serviceAccount = typeof raw === "string" ? JSON.parse(raw) : raw; }
  catch { throw new Error("FIREBASE_SERVICE_ACCOUNT is not valid JSON"); }
  firestoreClient = new FirestoreREST(serviceAccount);
  return firestoreClient;
}

/* ============================================================
   02 — Helpers — Response
   ============================================================ */

function ok(data = {}, extra = {}) {
  return { success: true, data, ...extra };
}

function fail(code, message) {
  return {
    success: false,
    error: { code: code || "SERVER_ERROR", message: message || "حدث خطأ." }
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer"
    }
  });
}


/* ============================================================
   03 — Helpers — Validation
   ============================================================ */

function safeText(v) {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function isEmail(v) {
  const s = safeText(v);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function isYouTubeUrl(v) {
  const s = safeText(v);
  if (!s) return false;
  try {
    const u = new URL(s);
    const host = u.hostname.replace(/^www\./, "");
    return (
      host === "youtu.be" ||
      host === "youtube.com" ||
      host === "m.youtube.com" ||
      host === "youtube-nocookie.com"
    );
  } catch {
    return false;
  }
}

function isValidCode(v) {
  const s = safeText(v);
  return s.length >= 3 && s.length <= 64 && !/\s/.test(s);
}

function isValidPassword(v) {
  const s = v === null || v === undefined ? "" : String(v);
  return s.length >= 6 && s.length <= 200;
}

function isValidStage(v) {
  const allowed = [
    "grade_4", "grade_5", "grade_6",
    "prep_1", "prep_2", "prep_3",
    "sec_1", "sec_2", "sec_3"
  ];
  return allowed.includes(safeText(v));
}

function clamp(n, min, max) {
  const v = Number(n);
  if (isNaN(v)) return min;
  return Math.min(Math.max(v, min), max);
}

function nowMs() {
  return Date.now();
}


/* ============================================================
   04 — Helpers — JWT
   ============================================================ */

function signStudentToken(env, student) {
  const days = clamp(parseInt(env.JWT_EXPIRY_STUDENT_DAYS || "7", 10), 1, 30);
  const payload = {
    sub: student.id,
    role: "student",
    code: student.code || null,
    stage: student.stage || null
  };
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: `${days}d` });
}

function signAdminToken(env, admin) {
  const hours = clamp(parseInt(env.JWT_EXPIRY_ADMIN_HOURS || "1", 10), 1, 24);
  const payload = {
    sub: admin.id,
    role: "admin",
    email: admin.email || null
  };
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: `${hours}h` });
}

function signRefreshToken(env, identity) {
  const days = clamp(parseInt(env.JWT_REFRESH_EXPIRY_DAYS || "30", 10), 1, 90);
  const payload = {
    sub: identity.id,
    role: identity.role,
    type: "refresh",
    ...(identity.role === "student"
      ? { code: identity.code || null, stage: identity.stage || null }
      : { email: identity.email || null })
  };
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: `${days}d` });
}

function verifyToken(env, token) {
  try {
    return jwt.verify(token, env.JWT_SECRET);
  } catch (e) {
    return null;
  }
}

function getBearerToken(c) {
  const auth = c.req.header("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  return auth.slice(7).trim() || null;
}

async function requireStudent(c) {
  const token = getBearerToken(c);
  if (!token) throw new HTTPException(401, { message: "UNAUTHORIZED" });
  const payload = verifyToken(c.env, token);
  if (!payload || payload.role !== "student") {
    throw new HTTPException(401, { message: "UNAUTHORIZED" });
  }

  // C8 — Fix: صحة توقيع الـ JWT لوحدها مش كافية. توقيع JWT صحيح معناه
  // بس إن التوكن ده اتصدر فعلاً من السيرفر واللي جواه (sub/role/...)
  // ماتغيّرش — مش إنه لسه "سليم الاستخدام" دلوقتي. لو الإدارة عطّلت
  // حساب الطالب بعد ما اتصدر التوكن، كان التوكن القديم فاضل شغال عادي
  // لحد ما ينتهي طبيعيًا (لحد 30 يوم افتراضيًا حسب JWT_EXPIRY_STUDENT_DAYS).
  const db = getDb(c);

  const studentSnap = await db.collection("students").doc(payload.sub).get();
  if (!studentSnap.exists) {
    throw new HTTPException(401, { message: "UNAUTHORIZED" });
  }
  // فحص احترازي (defense in depth) — لو حد مستقبلًا حط منطق بيحدّث
  // status على وثيقة الطالب نفسها.
  if (studentSnap.data().status === "disabled") {
    throw new HTTPException(401, { message: "UNAUTHORIZED" });
  }

  // ⚠️ اكتشاف مهم أثناء إصلاح C8: حقل `status` على وثيقة الطالب بيتحدد
  // "active" مرة واحدة بس وقت الإنشاء (First Login)، ومفيش أي route في
  // السيستم كله بيحدّثه بعد كده لـ "disabled" — يعني الفحص فوق ده كان
  // (ولسه) عمليًا ميت. الآلية الفعلية الوحيدة لتعطيل حساب طالب في
  // النظام هي تعطيل *الكود* بتاعه من لوحة الإدارة
  // (`PATCH /api/admin/codes/:id` → status="disabled"، من زرار "🚫 تعطيل"
  // في admin-codes.js). فعشان الإصلاح يبقى فعّال فعليًا (مش بس نظريًا)،
  // لازم نتحقق من حالة الكود نفسه هنا، مش بس وثيقة الطالب.
  const codeSnap = await db.collection("codes")
    .where("code", "==", payload.code)
    .limit(1)
    .get();

  if (codeSnap.empty) {
    throw new HTTPException(401, { message: "UNAUTHORIZED" });
  }

  const codeData = codeSnap.docs[0].data();

  // إصلاح: التحقق كان بيرفض "disabled" بس. الكود لازم يكون "active" فعلاً
  // (رفض unused/أي حالة تانية)، ومرتبط بنفس الطالب صاحب الـ JWT، وغير
  // منتهي الصلاحية — وإلا JWT قديم لوحده يبقى كافي للدخول حتى لو الكود
  // اتغيّرت حالته أو ارتبط بطالب تاني أو انتهت صلاحيته.
  if (codeData.status !== "active") {
    throw new HTTPException(401, { message: "UNAUTHORIZED" });
  }
  if (safeText(codeData.studentId) !== payload.sub) {
    throw new HTTPException(401, { message: "UNAUTHORIZED" });
  }
  if (codeData.expiresAt && tsToMs(codeData.expiresAt) > 0 && tsToMs(codeData.expiresAt) < nowMs()) {
    throw new HTTPException(401, { message: "UNAUTHORIZED" });
  }

  return payload;
}

async function requireAdmin(c) {
  const token = getBearerToken(c);
  if (!token) throw new HTTPException(401, { message: "UNAUTHORIZED" });
  const payload = verifyToken(c.env, token);
  if (!payload || payload.role !== "admin") {
    throw new HTTPException(403, { message: "FORBIDDEN" });
  }

  // C8 — نفس المنطق المطبّق على requireStudent: نتحقق من حالة حساب
  // الأدمن في Firestore *في كل طلب* (مش بس وقت الـ login)، عشان تعطيل
  // حساب أدمن يبقى فعّال فورًا مش بعد ما التوكن ينتهي طبيعيًا (JWT_EXPIRY_ADMIN_HOURS).
  const db = getDb(c);
  const adminSnap = await db.collection("admins").doc(payload.sub).get();
  if (!adminSnap.exists || adminSnap.data().status === "disabled") {
    throw new HTTPException(401, { message: "UNAUTHORIZED" });
  }

  return payload;
}


/* ============================================================
   05 — Helpers — Codes
   ============================================================ */

function generateCodeString() {
  // 8 أحرف — A-Z + 0-9 (بدون الأحرف الملبسة O/0/I/1)
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < 8; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

function generatePassword() {
  // 10 أحرف
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let out = "";
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < 10; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

/* ------------------------------------------------------------
   تشفير كلمات المرور — PBKDF2-SHA256 عبر WebCrypto (أصلي وسريع).
   السبب: bcryptjs بطيء جدًا داخل Worker (يتجاوز حد المعالجة في الخطة
   المجانية فيفشل الطلب). الصيغة المخزنة:
       pbkdf2$<iterations>$<salt-base64>$<hash-base64>
   عدد التكرارات مخزَّن داخل الـ hash نفسه، فيمكن رفعه لاحقًا دون ترحيل.
   الـ hashes القديمة بصيغة bcrypt ($2a$/$2b$/$2y$) تظل مقبولة.
   ------------------------------------------------------------ */
const PBKDF2_ITERATIONS = 20000;

function bytesToB64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function pbkdf2Derive(pwd, saltBytes, iterations) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(String(pwd)),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: saltBytes, iterations },
    keyMaterial,
    256
  );
  return new Uint8Array(bits);
}

async function hashPassword(pwd) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2Derive(pwd, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${bytesToB64(salt)}$${bytesToB64(hash)}`;
}

async function verifyPassword(pwd, stored) {
  try {
    const str = String(stored || "");

    if (str.startsWith("pbkdf2$")) {
      const parts = str.split("$");
      if (parts.length !== 4) return false;
      const iterations = parseInt(parts[1], 10);
      if (!Number.isInteger(iterations) || iterations < 1000 || iterations > 100000) return false;
      const expected = b64ToBytes(parts[3]);
      const actual = await pbkdf2Derive(pwd, b64ToBytes(parts[2]), iterations);
      if (expected.length !== actual.length) return false;
      let diff = 0;
      for (let i = 0; i < actual.length; i++) diff |= expected[i] ^ actual[i];
      return diff === 0;
    }

    // توافق مع hashes قديمة بصيغة bcrypt
    if (/^\$2[aby]\$/.test(str)) {
      return await bcrypt.compare(String(pwd), str);
    }
    return false;
  } catch {
    return false;
  }
}


/* ============================================================
   06 — Helpers — Firestore
   ============================================================ */

function tsToMs(v) {
  if (!v) return 0;
  if (typeof v.toMillis === "function") return v.toMillis();
  if (typeof v.toDate === "function") {
    try { return v.toDate().getTime(); } catch { return 0; }
  }
  if (typeof v === "number") return v;
  if (v instanceof Date) return v.getTime();
  if (typeof v === "string") {
    const t = new Date(v).getTime();
    return isNaN(t) ? 0 : t;
  }
  return 0;
}

async function getDocData(database, collection, id) {
  if (!id) return null;
  const snap = await database.collection(collection).doc(id).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...snap.data() };
}


/* ============================================================
   07 — Helpers — User (Student) Mapping
   ============================================================ */

function mapStudent(doc, codeData = null) {
  if (!doc) return null;
  const d = doc;
  return {
    id: d.id,
    fullName: d.fullName || "",
    stage: d.stage || "",
    code: d.code || (codeData ? codeData.code : null),
    joinedAt: d.joinedAt || null,
    lastLogin: d.lastLogin || null,
    status: d.status || "active"
  };
}


/* ============================================================
   08 — Hono App
   ============================================================ */

const app = new Hono();


/* ============================================================
   09 — Middleware — Error Handler
   ============================================================ */

app.onError((err, c) => {
  // HTTPException
  if (err instanceof HTTPException) {
    const code =
      err.status === 401 ? "UNAUTHORIZED" :
      err.status === 403 ? "FORBIDDEN" :
      err.status === 404 ? "NOT_FOUND" :
      err.status === 429 ? "DAILY_LIMIT_REACHED" :
      "BAD_REQUEST";
    return jsonResponse(fail(code, err.message || "خطأ."), err.status);
  }

  // Logs (بدون كشف للمستخدم)
  console.error("[Worker Error]", err && err.stack ? err.stack : err);

  return jsonResponse(fail("SERVER_ERROR", "حدث خطأ. حاول مرة أخرى."), 500);
});


/* ============================================================
   09.5 — Middleware — Security headers (كل استجابات الـ API)
   ------------------------------------------------------------
   تُسجَّل قبل CORS ليشمل ذلك استجابات OPTIONS والأخطاء و404 أيضًا.
   ============================================================ */

app.use("*", async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "no-referrer");
  c.header("Cache-Control", "no-store");
});


/* ============================================================
   10 — Middleware — CORS
   ============================================================ */

app.use("*", async (c, next) => {
  const env = c.env;
  const rawOrigins = safeText(env.ALLOWED_ORIGINS);
  const allowed = rawOrigins
    ? rawOrigins.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  const origin = c.req.header("Origin") || "";
  const corsOptions = {
    origin: (o) => {
      if (!o) return "";
      if (allowed.includes(o)) return o;
      return "";
    },
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: false,
    maxAge: 86400
  };

  const corsMiddleware = cors(corsOptions);
  return corsMiddleware(c, next);
});


/* ============================================================
   11 — Middleware — Request ID + Logging
   ============================================================ */

app.use("*", async (c, next) => {
  c.set("requestId", crypto.randomUUID());
  c.set("startTime", nowMs());
  await next();
  const ms = nowMs() - (c.get("startTime") || nowMs());
  // Logs مختصرة (بند 115)
  console.log(
    `[${c.get("requestId")}] ${c.req.method} ${c.req.path} — ${ms}ms`
  );
});


/* ============================================================
   12 — Helper — initialize Firestore For Request
   ============================================================ */

function getDb(c) {
  return initFirebase(c.env);
}


/* ============================================================
   13 — Helper — Paginated List
   ============================================================ */

async function listDocs(database, collectionName, opts = {}) {
  const { where = null, orderBy = null, limit = 200 } = opts;
  let ref = database.collection(collectionName);
  if (where && Array.isArray(where)) {
    for (const [field, op, value] of where) {
      ref = ref.where(field, op, value);
    }
  }
  if (orderBy) {
    ref = ref.orderBy(orderBy.field, orderBy.dir || "desc");
  }
  if (limit) ref = ref.limit(clamp(limit, 1, 1000));
  const snap = await ref.get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}


/* ============================================================
   14 — Route — PING
   ============================================================ */

app.get("/api/ping", (c) => {
  return jsonResponse(ok({
    pong: true,
    version: c.env.WORKER_VERSION || "1.0.0",
    environment: c.env.ENVIRONMENT || "production",
    time: new Date().toISOString()
  }));
});


/* ============================================================
   14.5 — Helper — Authentication Rate Limit
   ============================================================ */

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function getClientIp(c) {
  return safeText(c.req.header("CF-Connecting-IP")) ||
    safeText(c.req.header("X-Forwarded-For")).split(",")[0].trim() ||
    "unknown";
}

/**
 * Rate limit عام يعتمد على Firestore (معاملة ذرّية) في نفس مجموعة loginRateLimits.
 * نافذة ثابتة مدتها windowMs لكل (scope + IP + subject).
 * المفتاح SHA-256 فلا يظهر IP ولا البريد/الكود داخل اسم الوثيقة،
 * ولا نخزن في الوثيقة إلا العدّاد ووقت الانتهاء.
 * @returns {Promise<{blocked:boolean, retryAfterSec:number}>}
 */
async function checkRateLimit(c, db, { scope, subject = "", limit, windowMs = 10 * 60 * 1000 }) {
  const ip = getClientIp(c);
  const now = Date.now();
  const bucket = Math.floor(now / windowMs);
  const key = await sha256Hex(`${scope}|${ip}|${subject}|${bucket}`);
  const ref = db.collection("loginRateLimits").doc(key);
  let blocked = false;

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const count = snap.exists ? Number(snap.data().count) || 0 : 0;
    if (count >= limit) {
      blocked = true;
      return;
    }
    tx.set(ref, {
      count: count + 1,
      bucket,
      updatedAt: FieldValue.serverTimestamp(),
      // يسمح بتفعيل Firestore TTL على هذا الحقل لاحقًا (اختياري) دون بنية جديدة.
      expiresAt: new Date((bucket + 2) * windowMs)
    }, { merge: true });
  });

  const retryAfterSec = Math.max(1, Math.ceil(((bucket + 1) * windowMs - now) / 1000));
  return { blocked, retryAfterSec };
}

function rateLimitedResponse(message, retryAfterSec) {
  const res = jsonResponse(fail("RATE_LIMITED", message), 429);
  res.headers.set("Retry-After", String(retryAfterSec));
  return res;
}

/** طلاب: 10 محاولات / 10 دقائق لكل (IP + code) — السلوك السابق كما هو. */
async function enforceLoginRateLimit(c, db, code) {
  const r = await checkRateLimit(c, db, { scope: "student", subject: code, limit: 10 });
  if (r.blocked) {
    return rateLimitedResponse("محاولات تسجيل الدخول كثيرة. حاول بعد قليل.", r.retryAfterSec);
  }
  return null;
}

/** إدارة: 5 محاولات / 10 دقائق لكل (IP + email). */
async function enforceAdminLoginRateLimit(c, db, email) {
  const r = await checkRateLimit(c, db, { scope: "admin", subject: email || "missing", limit: 5 });
  if (r.blocked) {
    return rateLimitedResponse("محاولات تسجيل الدخول كثيرة. حاول بعد قليل.", r.retryAfterSec);
  }
  return null;
}

/** اشتراكات عامة: 5 طلبات / 10 دقائق لكل IP. */
async function enforceSubscriptionRateLimit(c, db) {
  const r = await checkRateLimit(c, db, { scope: "subscription", limit: 5 });
  if (r.blocked) {
    return rateLimitedResponse("تم إرسال طلبات كثيرة. حاول مرة أخرى بعد قليل.", r.retryAfterSec);
  }
  return null;
}

/* ============================================================
   15 — Route — AUTH — Student Login (Returning + First)
   ============================================================ */

app.post("/api/auth/login", async (c) => {
  const db = getDb(c);
  const body = await c.req.json().catch(() => ({}));

  const code = safeText(body.code);

  const rateLimitResponse = await enforceLoginRateLimit(c, db, code || "missing");
  if (rateLimitResponse) return rateLimitResponse;
  const password = body.password;
  const fullName = safeText(body.fullName);
  const stage = safeText(body.stage);
  const isFirstLogin = body.firstLogin === true;

  // تحقق أساسي
  if (!isValidCode(code)) {
    return jsonResponse(fail("INVALID_CODE", "الكود غير صحيح."), 400);
  }
  if (!isValidPassword(password)) {
    return jsonResponse(fail("INVALID_PASSWORD", "كلمة المرور غير صحيحة."), 400);
  }

  // ابحث عن الكود
  const codesSnap = await db.collection("codes")
    .where("code", "==", code)
    .limit(1)
    .get();

  if (codesSnap.empty) {
    return jsonResponse(fail("INVALID_CODE", "الكود غير صحيح."), 401);
  }

  const codeDoc = codesSnap.docs[0];
  const codeData = codeDoc.data();

  // تحقق من حالة الكود
  if (codeData.status === "disabled") {
    return jsonResponse(fail("CODE_DISABLED", "هذا الكود غير مفعّل."), 403);
  }

  if (codeData.expiresAt && tsToMs(codeData.expiresAt) > 0 && tsToMs(codeData.expiresAt) < nowMs()) {
    return jsonResponse(fail("CODE_EXPIRED", "انتهت صلاحية هذا الكود."), 403);
  }

  // تحقق من كلمة المرور
  const okPass = await verifyPassword(password, codeData.passwordHash);
  if (!okPass) {
    return jsonResponse(fail("INVALID_PASSWORD", "كلمة المرور غير صحيحة."), 401);
  }

  // الحالة: unused → First Login مطلوب
  if (codeData.status === "unused" && !isFirstLogin) {
    return jsonResponse(
      fail("FIRST_LOGIN_REQUIRED", "هذه أول مرة يتم فيها استخدام الكود."),
      200
    );
  }

  // First Login: تحقق من الاسم والمرحلة
  if (codeData.status === "unused" && isFirstLogin) {
    if (!fullName || fullName.length < 3) {
      return jsonResponse(fail("BAD_REQUEST", "من فضلك أدخل الاسم الكامل."), 400);
    }
    if (!isValidStage(stage)) {
      return jsonResponse(fail("STAGE_REQUIRED", "اختر المرحلة الدراسية."), 400);
    }

    // معرّف الطالب يتحدد هنا (auto-ID فقط — مجرد توليد ID، مفيش أي كتابة
    // فعلية للـ Firestore في هذا السطر). الكتابة الحقيقية (tx.set) بتتم
    // *جوه* الـ transaction بس، تحت.
    const studentRef = db.collection("students").doc();
    const joinedAt = new Date();

    // C7 — Fix: First Login كان check-then-act مش ذري:
    // (1) قراءة status="unused" فوق (سطر ~519) ثم (2) إنشاء الطالب
    // و(3) تحديث الكود، من غير أي قفل بين الخطوات. طلبين First Login
    // متزامنين لنفس الكود (double-click، تبويبين مفتوحين، إعادة محاولة
    // بعد timeout ظاهري) كانوا ممكن يعدّوا (1) سوا فيشتغل الاتنين على
    // إنشاء طالبَين منفصلين، وآخر update على codeDoc بس هو اللي يفضل
    // (يعني طالب واحد يتيه الكود بتاعه أو الكود يتربط بطالب مش هو).
    //
    // الحل: نجمع (إعادة التحقق من الحالة + إنشاء الطالب + ربط الكود)
    // جوه Firestore transaction واحدة. الـ transaction بتعيد قراءة
    // codeDoc.ref *جوه* نفسها (مش هتعتمد على codeData القديمة)، وFirestore
    // بيرفض commit أي transaction لو الوثيقة اتغيّرت من حد تاني بعد ما
    // اتقرت جوها (optimistic concurrency) ويعيد تشغيل الـ callback تلقائيًا
    // (retry) بقراءة جديدة. يعني لو طلبين اتسابقوا: واحد بس ينجح فعليًا
    // (يشوف status="unused" ويكتب)، والتاني هيعيد القراءة عند الـ retry
    // فيلاقي status اتغيّر ويرجع من غير ما يكتب أي حاجة.
    let raceOutcome = null; // null = نجح الإنشاء عادي، وإلا {code,message,status}

    try {
      await db.runTransaction(async (tx) => {
        const freshSnap = await tx.get(codeDoc.ref);
        const freshData = freshSnap.exists ? freshSnap.data() : null;

        if (!freshData) {
          raceOutcome = { code: "INVALID_CODE", message: "الكود غير صحيح.", status: 401 };
          return;
        }
        if (freshData.status === "disabled") {
          raceOutcome = { code: "CODE_DISABLED", message: "هذا الكود غير مفعّل.", status: 403 };
          return;
        }
        if (freshData.expiresAt && tsToMs(freshData.expiresAt) > 0 && tsToMs(freshData.expiresAt) < nowMs()) {
          raceOutcome = { code: "CODE_EXPIRED", message: "انتهت صلاحية هذا الكود.", status: 403 };
          return;
        }
        if (freshData.status !== "unused") {
          // طلب First Login متزامن تاني كسب السباق وفعّل الكود بالفعل
          // في اللحظة اللي بين القراءة الأولى (فوق) ولحظة دخولنا الـ transaction.
          raceOutcome = {
            code: "ALREADY_ACTIVATED",
            message: "تم تفعيل هذا الكود بالفعل. سجّل الدخول بكلمة المرور.",
            status: 409
          };
          return;
        }

        tx.set(studentRef, {
          fullName,
          stage,
          code,
          joinedAt,
          studyHoursTotal: 0,
          lastLogin: joinedAt,
          status: "active"
        });

        tx.update(codeDoc.ref, {
          status: "active",
          studentId: studentRef.id,
          stage,
          activatedAt: FieldValue.serverTimestamp()
        });
      });
    } catch (txErr) {
      console.error("[First Login Transaction Error]", txErr && txErr.stack ? txErr.stack : txErr);
      return jsonResponse(fail("SERVER_ERROR", "حدث خطأ. حاول مرة أخرى."), 500);
    }

    if (raceOutcome) {
      return jsonResponse(fail(raceOutcome.code, raceOutcome.message), raceOutcome.status);
    }

    const token = signStudentToken(c.env, {
      id: studentRef.id,
      code,
      stage
    });
    const refreshToken = signRefreshToken(c.env, {
      id: studentRef.id,
      role: "student",
      code,
      stage
    });

    return jsonResponse(ok({
      token,
      refreshToken,
      student: {
        id: studentRef.id,
        fullName,
        stage,
        code,
        joinedAt,
        lastLogin: joinedAt,
        status: "active"
      }
    }));
  }

  // Returning Login (status = active)
  const studentId = safeText(codeData.studentId);
  if (!studentId) {
    return jsonResponse(fail("SERVER_ERROR", "هذا الكود غير مرتبط بأي حساب."), 500);
  }

  const studentRef = db.collection("students").doc(studentId);
  const studentSnap = await studentRef.get();
  if (!studentSnap.exists) {
    return jsonResponse(fail("INVALID_CODE", "هذا الكود غير مرتبط بأي حساب."), 401);
  }

  const studentData = studentSnap.data();

  if (studentData.status === "disabled") {
    return jsonResponse(fail("CODE_DISABLED", "هذا الحساب غير مفعّل."), 403);
  }

  // حدّث lastLogin
  await studentRef.update({
    lastLogin: FieldValue.serverTimestamp()
  });

  const token = signStudentToken(c.env, {
    id: studentId,
    code,
    stage: studentData.stage
  });
  const refreshToken = signRefreshToken(c.env, {
    id: studentId,
    role: "student",
    code,
    stage: studentData.stage
  });

  return jsonResponse(ok({
    token,
    refreshToken,
    student: {
      id: studentId,
      fullName: studentData.fullName || "",
      stage: studentData.stage || "",
      code,
      joinedAt: studentData.joinedAt || null,
      lastLogin: new Date(),
      status: studentData.status || "active"
    }
  }));
});


/* ============================================================
   16 — Route — AUTH — Logout
   ============================================================ */

app.post("/api/auth/logout", async (c) => {
  // JWT مش فيه session state على السيرفر.
  // الـ logout من الفرونت: يمسح التوكن.
  return jsonResponse(ok({ loggedOut: true }));
});


/* ============================================================
   17 — Route — AUTH — Admin Login
   ============================================================ */

app.post("/api/auth/admin", async (c) => {
  const db = getDb(c);
  const body = await c.req.json().catch(() => ({}));

  const email = safeText(body.email).toLowerCase();
  const password = body.password;

  // حد المحاولات قبل أي بحث أو مقارنة كلمة مرور (لا نسجل كلمة المرور).
  const adminRateLimited = await enforceAdminLoginRateLimit(c, db, email);
  if (adminRateLimited) return adminRateLimited;

  if (!email || !isEmail(email)) {
    return jsonResponse(fail("BAD_REQUEST", "البريد الإلكتروني غير صحيح."), 400);
  }
  if (!isValidPassword(password)) {
    return jsonResponse(fail("BAD_REQUEST", "كلمة المرور غير صحيحة."), 400);
  }

  // ابحث عن الأدمن
  const adminsSnap = await db.collection("admins")
    .where("email", "==", email)
    .limit(1)
    .get();

  if (adminsSnap.empty) {
    return jsonResponse(fail("INVALID_PASSWORD", "بيانات الدخول غير صحيحة."), 401);
  }

  const adminDoc = adminsSnap.docs[0];
  const adminData = adminDoc.data();

  // نفس الرسالة العامة للحساب المعطّل حتى لا نكشف وجود البريد.
  const okPass = await verifyPassword(password, adminData.passwordHash);
  if (!okPass || adminData.status === "disabled") {
    return jsonResponse(fail("INVALID_PASSWORD", "بيانات الدخول غير صحيحة."), 401);
  }

  // حدّث lastLogin
  try {
    await adminDoc.ref.update({ lastLogin: FieldValue.serverTimestamp() });
  } catch (e) {
    // ignore
  }

  const token = signAdminToken(c.env, {
    id: adminDoc.id,
    email
  });
  const refreshToken = signRefreshToken(c.env, {
    id: adminDoc.id,
    role: "admin",
    email
  });

  return jsonResponse(ok({
    token,
    refreshToken,
    admin: {
      id: adminDoc.id,
      name: adminData.name || "",
      email
    }
  }));
});


/* ============================================================
   18 — Route — AUTH — Refresh Token
   ============================================================ */

app.post("/api/auth/refresh", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const refreshToken = safeText(body.refreshToken) || getBearerToken(c);
  if (!refreshToken) {
    return jsonResponse(fail("UNAUTHORIZED", "مطلوب تسجيل دخول."), 401);
  }

  let payload;
  try {
    payload = jwt.verify(refreshToken, c.env.JWT_SECRET);
  } catch (e) {
    return jsonResponse(fail("UNAUTHORIZED", "انتهت الجلسة."), 401);
  }

  if (!payload || payload.type !== "refresh") {
    return jsonResponse(fail("UNAUTHORIZED", "انتهت الجلسة."), 401);
  }

  const db = getDb(c);
  let newToken;
  let newRefreshToken;

  if (payload.role === "student") {
    const studentSnap = await db.collection("students").doc(payload.sub).get();
    if (!studentSnap.exists || studentSnap.data().status === "disabled") {
      return jsonResponse(fail("UNAUTHORIZED", "انتهت الجلسة."), 401);
    }

    const codeSnap = await db.collection("codes")
      .where("code", "==", payload.code)
      .limit(1)
      .get();
    if (codeSnap.empty) {
      return jsonResponse(fail("UNAUTHORIZED", "انتهت الجلسة."), 401);
    }

    const codeData = codeSnap.docs[0].data();
    if (
      codeData.status !== "active" ||
      safeText(codeData.studentId) !== payload.sub ||
      (codeData.expiresAt && tsToMs(codeData.expiresAt) > 0 && tsToMs(codeData.expiresAt) < nowMs())
    ) {
      return jsonResponse(fail("UNAUTHORIZED", "انتهت الجلسة."), 401);
    }

    const stage = studentSnap.data().stage || payload.stage || null;
    newToken = signStudentToken(c.env, {
      id: payload.sub,
      code: payload.code,
      stage
    });
    newRefreshToken = signRefreshToken(c.env, {
      id: payload.sub,
      role: "student",
      code: payload.code,
      stage
    });
  } else if (payload.role === "admin") {
    const adminSnap = await db.collection("admins").doc(payload.sub).get();
    if (!adminSnap.exists || adminSnap.data().status === "disabled") {
      return jsonResponse(fail("UNAUTHORIZED", "انتهت الجلسة."), 401);
    }

    const email = adminSnap.data().email || payload.email || null;
    newToken = signAdminToken(c.env, {
      id: payload.sub,
      email
    });
    newRefreshToken = signRefreshToken(c.env, {
      id: payload.sub,
      role: "admin",
      email
    });
  } else {
    return jsonResponse(fail("FORBIDDEN", "دور غير معروف."), 403);
  }

  return jsonResponse(ok({
    token: newToken,
    refreshToken: newRefreshToken
  }));
});


/* ============================================================
   19 — Route — Lessons (Student)
   ============================================================ */

app.get("/api/lessons", async (c) => {
  const student = await requireStudent(c);
  const db = getDb(c);

  const kind = safeText(c.req.query("kind"));

  // اقرا الطالب للتحقق من المرحلة
  const studentSnap = await db.collection("students").doc(student.sub).get();
  if (!studentSnap.exists) {
    return jsonResponse(fail("UNAUTHORIZED", "الحساب غير موجود."), 401);
  }
  const studentData = studentSnap.data();
  const stage = safeText(studentData.stage);
  if (!isValidStage(stage)) {
    return jsonResponse(ok({ lessons: [] }));
  }

  // فلترة حسب المرحلة (بند 34)
  let ref = db.collection("lessons").where("stage", "==", stage);
  if (kind === "video" || kind === "audio") {
    ref = ref.where("kind", "==", kind);
  }

  const snap = await ref.limit(100).get();
  const lessons = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((l) => l && l.id && l.youtubeUrl)
    .map((l) => ({
      id: l.id,
      title: safeText(l.title),
      kind: l.kind === "audio" ? "audio" : "video",
      youtubeUrl: safeText(l.youtubeUrl),
      stage: l.stage,
      createdAt: l.createdAt || null
    }));

  // ترتيب: الأحدث أولاً
  lessons.sort((a, b) => tsToMs(b.createdAt) - tsToMs(a.createdAt));

  return jsonResponse(ok({ lessons }));
});


app.post("/api/lessons/:id/open", async (c) => {
  const student = await requireStudent(c);
  const db = getDb(c);
  const lessonId = safeText(c.req.param("id"));
  if (!lessonId) return jsonResponse(fail("BAD_REQUEST", "معرّف الدرس مطلوب."), 400);

  const studentSnap = await db.collection("students").doc(student.sub).get();
  if (!studentSnap.exists) return jsonResponse(fail("UNAUTHORIZED", "الحساب غير موجود."), 401);
  const stage = safeText(studentSnap.data().stage);

  const lessonSnap = await db.collection("lessons").doc(lessonId).get();
  if (!lessonSnap.exists) return jsonResponse(fail("NOT_FOUND", "الدرس غير موجود."), 404);
  const lesson = lessonSnap.data();
  if (safeText(lesson.stage) !== stage || !isYouTubeUrl(lesson.youtubeUrl)) {
    return jsonResponse(fail("FORBIDDEN", "غير مسموح بهذا الدرس."), 403);
  }

  const progressRef = db.collection("lessonProgress").doc(`${student.sub}_${lessonId}`);
  await progressRef.set({
    studentId: student.sub,
    lessonId,
    stage,
    title: safeText(lesson.title),
    lastOpenedAt: FieldValue.serverTimestamp(),
    completed: true,
    completedAt: FieldValue.serverTimestamp()
  }, { merge: true });

  return jsonResponse(ok({ opened: true, completed: true, lessonId }));
});

/* ============================================================
   20 — Route — Announcements (Student)
   ============================================================ */

app.get("/api/announcements", async (c) => {
  const student = await requireStudent(c);
  const db = getDb(c);

  const studentSnap = await db.collection("students").doc(student.sub).get();
  if (!studentSnap.exists) {
    return jsonResponse(fail("UNAUTHORIZED", "الحساب غير موجود."), 401);
  }
  const studentData = studentSnap.data();
  const stage = safeText(studentData.stage);

  // جلب: all + stage + student
  const results = [];

  const [allSnap, stageSnap, studentSnap2] = await Promise.all([
    db.collection("announcements").where("targetType", "==", "all").limit(50).get(),
    stage
      ? db.collection("announcements")
          .where("targetType", "==", "stage")
          .where("targetValue", "==", stage)
          .limit(50)
          .get()
      : Promise.resolve({ docs: [] }),
    db.collection("announcements")
      .where("targetType", "==", "student")
      .where("targetValue", "==", student.sub)
      .limit(50)
      .get()
  ]);

  allSnap.docs.forEach((d) => results.push({ id: d.id, ...d.data() }));
  stageSnap.docs.forEach((d) => results.push({ id: d.id, ...d.data() }));
  studentSnap2.docs.forEach((d) => results.push({ id: d.id, ...d.data() }));

  // ترتيب: الأحدث أولاً
  results.sort((a, b) => tsToMs(b.createdAt) - tsToMs(a.createdAt));

  // حالة القراءة الخاصة بالطالب الحالي.
  const readSnap = await db.collection("announcementReads")
    .where("studentId", "==", student.sub)
    .limit(500)
    .get();
  const readIds = new Set(readSnap.docs.map((d) => safeText(d.data().announcementId)));

  const announcements = results.map((a) => ({
    id: a.id,
    title: safeText(a.title),
    body: safeText(a.body),
    type: safeText(a.type) || "text",
    targetType: safeText(a.targetType) || "all",
    targetValue: a.targetValue || null,
    linkTarget: a.linkTarget || null,
    createdAt: a.createdAt || null,
    isRead: readIds.has(a.id)
  }));

  return jsonResponse(ok({ announcements }));
});

app.get("/api/announcements/unread-count", async (c) => {
  const student = await requireStudent(c);
  const db = getDb(c);
  const studentSnap = await db.collection("students").doc(student.sub).get();
  if (!studentSnap.exists) return jsonResponse(fail("UNAUTHORIZED", "الحساب غير موجود."), 401);
  const stage = safeText(studentSnap.data().stage);

  const [allSnap, stageSnap, studentSnap2, readsSnap] = await Promise.all([
    db.collection("announcements").where("targetType", "==", "all").limit(50).get(),
    stage ? db.collection("announcements").where("targetType", "==", "stage").where("targetValue", "==", stage).limit(50).get() : Promise.resolve({ docs: [] }),
    db.collection("announcements").where("targetType", "==", "student").where("targetValue", "==", student.sub).limit(50).get(),
    db.collection("announcementReads").where("studentId", "==", student.sub).limit(500).get()
  ]);

  const ids = new Set();
  [allSnap, stageSnap, studentSnap2].forEach((snap) => snap.docs.forEach((d) => ids.add(d.id)));
  const readIds = new Set(readsSnap.docs.map((d) => safeText(d.data().announcementId)));
  let count = 0;
  ids.forEach((id) => { if (!readIds.has(id)) count += 1; });

  return jsonResponse(ok({ count }));
});

app.post("/api/announcements/:id/read", async (c) => {
  const student = await requireStudent(c);
  const db = getDb(c);
  const announcementId = safeText(c.req.param("id"));
  if (!announcementId) return jsonResponse(fail("BAD_REQUEST", "معرّف الإعلان مطلوب."), 400);

  const annSnap = await db.collection("announcements").doc(announcementId).get();
  if (!annSnap.exists) return jsonResponse(fail("NOT_FOUND", "الإعلان غير موجود."), 404);
  const ann = annSnap.data();
  const studentSnap = await db.collection("students").doc(student.sub).get();
  const stage = studentSnap.exists ? safeText(studentSnap.data().stage) : "";
  const targetType = safeText(ann.targetType) || "all";
  const allowed = targetType === "all" ||
    (targetType === "stage" && safeText(ann.targetValue) === stage) ||
    (targetType === "student" && safeText(ann.targetValue) === student.sub);
  if (!allowed) return jsonResponse(fail("FORBIDDEN", "غير مسموح بهذا الإعلان."), 403);

  const ref = db.collection("announcementReads").doc(`${student.sub}_${announcementId}`);
  await ref.set({
    studentId: student.sub,
    announcementId,
    readAt: FieldValue.serverTimestamp()
  }, { merge: true });

  return jsonResponse(ok({ read: true }));
});

app.post("/api/announcements/reply", async (c) => {
  const student = await requireStudent(c);
  const db = getDb(c);

  const body = await c.req.json().catch(() => ({}));
  const announcementId = safeText(body.announcementId);
  const message = safeText(body.message);

  if (!announcementId) {
    return jsonResponse(fail("BAD_REQUEST", "معرّف الإعلان مطلوب."), 400);
  }
  if (!message || message.length < 2 || message.length > 2000) {
    return jsonResponse(fail("BAD_REQUEST", "الرد غير صالح."), 400);
  }

  // تحقق من وجود الإعلان
  const annRef = db.collection("announcements").doc(announcementId);
  const annSnap = await annRef.get();
  if (!annSnap.exists) {
    return jsonResponse(fail("NOT_FOUND", "الإعلان غير موجود."), 404);
  }
  const annData = annSnap.data();

  // اقرا اسم الطالب
  const studentSnap = await db.collection("students").doc(student.sub).get();
  const studentName = studentSnap.exists
    ? safeText(studentSnap.data().fullName)
    : "طالب";

  // إصلاح: كان بيتحقق بس من وجود الإعلان، من غير أي تحقق إن الطالب
  // الحالي فعلًا من الجمهور المستهدَف (audience) — يعني أي طالب يعرف
  // announcementId كان يقدر يرد على إعلان مخصص لطالب تاني أو لمرحلة
  // مختلفة. نفس منطق الـ audience المستخدم أصلًا في GET /api/announcements
  // (targetType: all / stage / student).
  const targetType = safeText(annData.targetType) || "all";
  let allowed = false;
  if (targetType === "all") {
    allowed = true;
  } else if (targetType === "stage") {
    const studentStage = studentSnap.exists ? safeText(studentSnap.data().stage) : "";
    allowed = !!studentStage && studentStage === safeText(annData.targetValue);
  } else if (targetType === "student") {
    allowed = safeText(annData.targetValue) === student.sub;
  }

  if (!allowed) {
    return jsonResponse(fail("FORBIDDEN", "غير مسموح لك بالرد على هذا الإعلان."), 403);
  }

  await db.collection("announcementReplies").add({
    announcementId,
    studentId: student.sub,
    studentName,
    message,
    createdAt: FieldValue.serverTimestamp()
  });

  return jsonResponse(ok({ created: true }));
});


/* ============================================================
   21 — Route — Exams (Student)
   ============================================================ */

app.get("/api/exams", async (c) => {
  const student = await requireStudent(c);
  const db = getDb(c);

  const studentSnap = await db.collection("students").doc(student.sub).get();
  if (!studentSnap.exists) {
    return jsonResponse(fail("UNAUTHORIZED", "الحساب غير موجود."), 401);
  }
  const stage = safeText(studentSnap.data().stage);
  if (!isValidStage(stage)) {
    return jsonResponse(ok({ exams: [] }));
  }

  // جلب الاختبارات المنشورة لمرحلة الطالب
  const examsSnap = await db.collection("exams")
    .where("stage", "==", stage)
    .limit(100)
    .get();

  // جلب محاولات الطالب
  const attemptsSnap = await db.collection("examAttempts")
    .where("studentId", "==", student.sub)
    .limit(200)
    .get();

  const attemptsByExam = {};
  attemptsSnap.docs.forEach((d) => {
    const data = d.data();
    attemptsByExam[data.examId] = data;
  });

  const exams = examsSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((e) => e && e.id && e.status === "published")
    .map((e) => {
      const attempt = attemptsByExam[e.id];
      let status = "available";
      if (attempt) {
        const visible = attempt.resultVisible === true;
        status = visible ? "result_available" : "result_pending";
      }
      return {
        id: e.id,
        title: safeText(e.title),
        stage: e.stage,
        questionsCount: Array.isArray(e.questions) ? e.questions.length : 0,
        status
      };
    });

  // ترتيب: الأحدث أولاً
  exams.sort((a, b) => 0);

  return jsonResponse(ok({ exams }));
});

app.post("/api/exams/start", async (c) => {
  const student = await requireStudent(c);
  const db = getDb(c);

  const body = await c.req.json().catch(() => ({}));
  const examId = safeText(body.examId);
  if (!examId) {
    return jsonResponse(fail("BAD_REQUEST", "معرّف الاختبار مطلوب."), 400);
  }

  // تحقق من الطالب
  const studentSnap = await db.collection("students").doc(student.sub).get();
  if (!studentSnap.exists) {
    return jsonResponse(fail("UNAUTHORIZED", "الحساب غير موجود."), 401);
  }
  const stage = safeText(studentSnap.data().stage);

  // تحقق من الاختبار
  const examSnap = await db.collection("exams").doc(examId).get();
  if (!examSnap.exists) {
    return jsonResponse(fail("NOT_FOUND", "الاختبار غير موجود."), 404);
  }
  const exam = examSnap.data();

  if (exam.status !== "published") {
    return jsonResponse(fail("NOT_FOUND", "الاختبار غير متاح."), 404);
  }
  if (exam.stage !== stage) {
    return jsonResponse(fail("FORBIDDEN", "هذا الاختبار ليس لمرحلتك."), 403);
  }

  // منع المحاولة الثانية (بند 41، 128)
  const existingSnap = await db.collection("examAttempts")
    .where("examId", "==", examId)
    .where("studentId", "==", student.sub)
    .limit(1)
    .get();

  if (!existingSnap.empty) {
    return jsonResponse(
      fail("ALREADY_ATTEMPTED", "تم أداء هذا الاختبار بالفعل."),
      409
    );
  }

  // الأسئلة — بدون correctIndex (بند 43)
  const questions = Array.isArray(exam.questions) ? exam.questions : [];
  const safeQuestions = questions.map((q) => ({
    text: safeText(q.text),
    choices: Array.isArray(q.choices) ? q.choices.map((c) => safeText(c)) : []
    // ❌ لا correctIndex
  }));

  return jsonResponse(ok({
    exam: {
      id: examId,
      title: safeText(exam.title),
      stage: exam.stage,
      questionsCount: safeQuestions.length,
      resultPolicy: safeText(exam.resultPolicy) || "immediate",
      resultTime: exam.resultTime || null
    },
    questions: safeQuestions
  }));
});

app.post("/api/exams/submit", async (c) => {
  const student = await requireStudent(c);
  const db = getDb(c);

  const body = await c.req.json().catch(() => ({}));
  const examId = safeText(body.examId);
  const answers = Array.isArray(body.answers) ? body.answers : null;

  if (!examId || !answers) {
    return jsonResponse(fail("BAD_REQUEST", "بيانات الاختبار غير مكتملة."), 400);
  }

  // تحقق من الطالب
  const studentSnap = await db.collection("students").doc(student.sub).get();
  if (!studentSnap.exists) {
    return jsonResponse(fail("UNAUTHORIZED", "الحساب غير موجود."), 401);
  }
  const studentData = studentSnap.data();
  const stage = safeText(studentData.stage);

  // تحقق من الاختبار
  const examRef = db.collection("exams").doc(examId);
  const examSnap = await examRef.get();
  if (!examSnap.exists) {
    return jsonResponse(fail("NOT_FOUND", "الاختبار غير موجود."), 404);
  }
  const exam = examSnap.data();

  if (exam.status !== "published" || exam.stage !== stage) {
    return jsonResponse(fail("FORBIDDEN", "غير مسموح."), 403);
  }

  // منع المحاولة الثانية + Idempotency (بند 183، 187)
  // ملحوظة (C6): الـ query دي مجرد فحص سريع/مبكر لتوفير باقي المعالجة
  // (التصحيح إلخ) لو واضح إن فيه محاولة موجودة أصلاً. هي مش الحماية
  // الحقيقية من الـ race condition — الحماية الفعلية بقت في
  // attemptRef.create() تحت (ID حتمي + create ذرية)، لأن query + set()
  // عاديين ممكن يعدّيهم طلبين متزامنين مع بعض قبل ما أي واحد يكتب.
  const existingSnap = await db.collection("examAttempts")
    .where("examId", "==", examId)
    .where("studentId", "==", student.sub)
    .limit(1)
    .get();

  if (!existingSnap.empty) {
    return jsonResponse(
      fail("ALREADY_ATTEMPTED", "تم أداء هذا الاختبار بالفعل."),
      409
    );
  }

  // التصحيح (بند 42) — في Worker، مش الفرونت
  const questions = Array.isArray(exam.questions) ? exam.questions : [];
  if (questions.length === 0) {
    return jsonResponse(fail("SERVER_ERROR", "الاختبار لا يحتوي على أسئلة."), 500);
  }

  let correctCount = 0;
  let wrongCount = 0;
  const normalizedAnswers = [];

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const a = answers[i];
    const correctIdx = Number(q.correctIndex);
    const chosen = (typeof a === "number") ? a : -1;

    normalizedAnswers.push(chosen);

    if (!isNaN(correctIdx) && chosen === correctIdx) {
      correctCount += 1;
    } else {
      wrongCount += 1;
    }
  }

  const total = questions.length;
  const score = correctCount;
  const percent = total > 0 ? Math.round((score / total) * 100) : 0;

  // تحديد ظهور النتيجة بناءً على السياسة
  // نحسب visibleAt وقت إنشاء المحاولة ونخزّنه مع كل محاولة، عشان
  // endpoint النتيجة يقدر يعتمد عليه لاحقًا (visibleAt <= now) بدل
  // ما يفضل معلّق على resultVisible المحسوبة مرة واحدة بس وقت الإنشاء.
  const policy = safeText(exam.resultPolicy) || "immediate";
  const attemptedAt = new Date();
  let visibleAt = attemptedAt; // افتراضيًا (immediate) النتيجة ظاهرة من لحظة الإنشاء
  let resultVisible = false;

  if (policy === "immediate") {
    resultVisible = true;
    visibleAt = attemptedAt;
  } else if (policy === "after_datetime" && exam.resultTime) {
    visibleAt = new Date(tsToMs(exam.resultTime));
    resultVisible = visibleAt.getTime() <= attemptedAt.getTime();
  } else if (policy === "after_duration") {
    const durationMin = clamp(Number(exam.resultDurationMinutes) || 0, 0, 10080);
    visibleAt = new Date(attemptedAt.getTime() + durationMin * 60 * 1000);
    resultVisible = visibleAt.getTime() <= attemptedAt.getTime();
  } else {
    // سياسة غير معروفة → نتصرف زي immediate عشان محدش يفضل معلّق للأبد
    resultVisible = true;
    visibleAt = attemptedAt;
  }

  // أنشئ المحاولة — C6: ID حتمي (examId_studentId) + create() الذرية بدل
  // doc() العشوائي + set(). create() في Firestore بترفض تلقائيًا (تطلع
  // exception بكود ALREADY_EXISTS) لو الوثيقة بنفس الـ ID موجودة أصلاً،
  // فمفيش احتمال يتعمل مستندين لنفس الطالب+الاختبار حتى مع طلبين
  // متزامنين تمامًا (على عكس query-then-set اللي فوق، اللي ممكن يعدّيه
  // طلبين سوا قبل ما أي واحد يكتب).
  const attemptId = `${examId}_${student.sub}`;
  const attemptRef = db.collection("examAttempts").doc(attemptId);

  try {
    await attemptRef.create({
      examId,
      studentId: student.sub,
      stage,
      answers: normalizedAnswers,
      score,
      total,
      percent,
      correctCount,
      wrongCount,
      resultVisible,
      policy,
      visibleAt,
      attemptedAt,
      createdAt: attemptedAt
    });
  } catch (err) {
    if (err && err.code === 6 /* ALREADY_EXISTS (gRPC status code) */) {
      return jsonResponse(
        fail("ALREADY_ATTEMPTED", "تم أداء هذا الاختبار بالفعل."),
        409
      );
    }
    throw err;
  }

  // الرد للفرونت — حسب نتيجة التصحيح
  if (resultVisible) {
    return jsonResponse(ok({
      policy,
      resultVisible: true,
      score,
      total,
      percent,
      correctCount,
      wrongCount
    }));
  }

  return jsonResponse(ok({
    policy,
    resultVisible: false,
    message: "تم استلام إجاباتك. ستظهر النتيجة في الموعد المحدد."
  }));
});

app.get("/api/exams/result", async (c) => {
  const student = await requireStudent(c);
  const db = getDb(c);

  const examId = safeText(c.req.query("examId"));
  if (!examId) {
    return jsonResponse(fail("BAD_REQUEST", "معرّف الاختبار مطلوب."), 400);
  }

  const snap = await db.collection("examAttempts")
    .where("examId", "==", examId)
    .where("studentId", "==", student.sub)
    .limit(1)
    .get();

  if (snap.empty) {
    return jsonResponse(fail("NOT_FOUND", "لا توجد محاولة لهذا الاختبار."), 404);
  }

  const attempt = snap.docs[0].data();

  // تحقق من وقت الظهور: نعتمد على visibleAt المخزّن مع المحاولة وقت إنشائها
  // (مش على resultVisible المحسوبة مرة واحدة بس وقت الإنشاء، اللي كانت بتفضل
  // false للأبد حتى بعد ما الوقت المحدد يعدي — بند C5).
  let visible = attempt.resultVisible === true;
  if (!visible && attempt.visibleAt) {
    if (tsToMs(attempt.visibleAt) <= nowMs()) visible = true;
  }

  // لو بقت ظاهرة دلوقتي ومكنتش متسجّلة كده في الوثيقة، حدّثها عشان
  // القراءات الجاية تبقى أسرع ومتعتمدش على إعادة الحساب كل مرة.
  if (visible && attempt.resultVisible !== true) {
    try {
      await snap.docs[0].ref.update({ resultVisible: true });
    } catch (e) {
      // تجاهل فشل التحديث؛ الرد للطالب سليم برضه
    }
  }

  if (!visible) {
    return jsonResponse(ok({
      resultVisible: false,
      policy: attempt.policy || "after_duration",
      message: "تم استلام إجاباتك، وستظهر النتيجة في الموعد المحدد."
    }));
  }

  return jsonResponse(ok({
    resultVisible: true,
    policy: attempt.policy || "immediate",
    score: Number(attempt.score) || 0,
    total: Number(attempt.total) || 0,
    percent: Number(attempt.percent) || 0,
    correctCount: Number(attempt.correctCount) || 0,
    wrongCount: Number(attempt.wrongCount) || 0
  }));
});


/* ============================================================
   22 — Route — Planner (Student)
   ============================================================ */

app.get("/api/planner/tasks", async (c) => {
  const student = await requireStudent(c);
  const db = getDb(c);

  const week = safeText(c.req.query("week")); // YYYY-MM-DD

  // ابحث عن وثيقة الـ planner للطالب
  const key = week || "current";
  const docId = `${student.sub}_${key}`;
  const ref = db.collection("planner").doc(docId);
  const snap = await ref.get();

  if (!snap.exists) {
    return jsonResponse(ok({ tasksByDay: {} }));
  }

  const data = snap.data() || {};
  return jsonResponse(ok({ tasksByDay: data.tasksByDay || {} }));
});

app.post("/api/planner/tasks", async (c) => {
  const student = await requireStudent(c);
  const db = getDb(c);

  const body = await c.req.json().catch(() => ({}));
  const title = safeText(body.title);
  const day = safeText(body.day);
  const time = safeText(body.time);
  const week = safeText(body.week);

  if (!title || title.length > 150) {
    return jsonResponse(fail("BAD_REQUEST", "عنوان المهمة غير صالح."), 400);
  }
  if (!day || !time) {
    return jsonResponse(fail("BAD_REQUEST", "اليوم والوقت مطلوبان."), 400);
  }
  if (!week) {
    return jsonResponse(fail("BAD_REQUEST", "الأسبوع مطلوب."), 400);
  }

  const docId = `${student.sub}_${week}`;
  const ref = db.collection("planner").doc(docId);
  const taskId = crypto.randomUUID();
  const task = {
    id: taskId,
    title,
    day,
    time,
    completed: false,
    createdAt: new Date().toISOString()
  };

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? (snap.data() || {}) : {};
    const tasksByDay = deepClone(data.tasksByDay || {});

    if (!Array.isArray(tasksByDay[day])) tasksByDay[day] = [];
    tasksByDay[day].push(task);
    tasksByDay[day].sort((a, b) => (a.time || "").localeCompare(b.time || ""));

    tx.set(ref, {
      studentId: student.sub,
      week,
      tasksByDay,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
  });

  return jsonResponse(ok({ task }));
});

app.patch("/api/planner/tasks/:id", async (c) => {
  const student = await requireStudent(c);
  const db = getDb(c);

  const taskId = safeText(c.req.param("id"));
  const body = await c.req.json().catch(() => ({}));
  const week = safeText(body.week);

  if (!taskId) {
    return jsonResponse(fail("BAD_REQUEST", "معرّف المهمة مطلوب."), 400);
  }
  if (!week) {
    return jsonResponse(fail("BAD_REQUEST", "الأسبوع مطلوب."), 400);
  }

  const docId = `${student.sub}_${week}`;
  const ref = db.collection("planner").doc(docId);

  let found = false;
  await db.runTransaction(async (tx) => {
    found = false;
    const snap = await tx.get(ref);
    if (!snap.exists) return;

    const data = snap.data() || {};
    const tasksByDay = deepClone(data.tasksByDay || {});

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

    if (found) {
      tx.update(ref, {
        tasksByDay,
        updatedAt: FieldValue.serverTimestamp()
      });
    }
  });

  if (!found) {
    return jsonResponse(fail("NOT_FOUND", "المهمة غير موجودة."), 404);
  }

  return jsonResponse(ok({ updated: true }));
});

app.delete("/api/planner/tasks/:id", async (c) => {
  const student = await requireStudent(c);
  const db = getDb(c);

  const taskId = safeText(c.req.param("id"));
  const week = safeText(c.req.query("week"));

  if (!taskId) {
    return jsonResponse(fail("BAD_REQUEST", "معرّف المهمة مطلوب."), 400);
  }
  if (!week) {
    return jsonResponse(fail("BAD_REQUEST", "الأسبوع مطلوب."), 400);
  }

  const docId = `${student.sub}_${week}`;
  const ref = db.collection("planner").doc(docId);

  let removed = false;
  await db.runTransaction(async (tx) => {
    removed = false;
    const snap = await tx.get(ref);
    if (!snap.exists) return;

    const data = snap.data() || {};
    const tasksByDay = deepClone(data.tasksByDay || {});

    for (const dayKey of Object.keys(tasksByDay)) {
      const list = tasksByDay[dayKey];
      if (!Array.isArray(list)) continue;
      const before = list.length;
      tasksByDay[dayKey] = list.filter((t) => !(t && t.id === taskId));
      if (tasksByDay[dayKey].length < before) {
        removed = true;
        break;
      }
    }

    if (removed) {
      tx.update(ref, {
        tasksByDay,
        updatedAt: FieldValue.serverTimestamp()
      });
    }
  });

  if (!removed) {
    return jsonResponse(fail("NOT_FOUND", "المهمة غير موجودة."), 404);
  }

  return jsonResponse(ok({ deleted: true }));
});

app.post("/api/planner/sessions", async (c) => {
  const student = await requireStudent(c);
  const db = getDb(c);

  const body = await c.req.json().catch(() => ({}));
  const durationMinutes = clamp(Number(body.durationMinutes), 1, 600);

  await db.collection("studySessions").add({
    studentId: student.sub,
    durationMinutes,
    date: new Date(),
    createdAt: FieldValue.serverTimestamp()
  });

  // حدّث studyHoursTotal داخل transaction حتى لا تضيع زيادة
  // عند وجود جلستين متزامنتين لنفس الطالب.
  try {
    const studentRef = db.collection("students").doc(student.sub);
    const added = durationMinutes / 60;
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(studentRef);
      if (!snap.exists) return;
      const current = Number(snap.data().studyHoursTotal) || 0;
      tx.update(studentRef, { studyHoursTotal: current + added });
    });
  } catch (e) {
    // preserve existing behavior: failure to update the aggregate must not
    // make an otherwise logged study session fail.
  }

  return jsonResponse(ok({ logged: true }));
});


/* ============================================================
   23 — Route — AI (Student)
   ============================================================ */

// حدود طلب الذكاء الاصطناعي (المهمة 04) — قيم ثابتة.
const AI_MAX_MESSAGES = 20;              // أقصى عدد رسائل في الطلب
const AI_MAX_MESSAGE_CHARS = 4000;       // أقصى طول للرسالة الواحدة (حرف)
const AI_MAX_BODY_BYTES = 256 * 1024;    // أقصى حجم لجسم الطلب (256KB)
const AI_ALLOWED_ROLES = new Set(["user", "assistant"]); // "system" مرفوض عمدًا
const AI_DEFAULT_MAX_OUTPUT_TOKENS = 1000;

/**
 * يقرأ جسم طلب الـAI ويتحقق منه بالكامل دون أي استهلاك للحصة.
 * يعيد { error: Response } عند الرفض، أو { messages } (منظّفة) عند النجاح.
 */
async function readAndValidateAiBody(c) {
  const bad = (code, msg, status = 400) => ({ error: jsonResponse(fail(code, msg), status) });

  // 1) حجم الجسم: فحص الترويسة أولًا (رفض مبكر) ثم الحجم الفعلي.
  const declared = Number(c.req.header("Content-Length"));
  if (Number.isFinite(declared) && declared > AI_MAX_BODY_BYTES) {
    return bad("PAYLOAD_TOO_LARGE", "حجم الطلب كبير جدًا.", 413);
  }
  let raw = "";
  try { raw = await c.req.text(); } catch { return bad("BAD_REQUEST", "تعذّر قراءة الطلب."); }
  if (new TextEncoder().encode(raw).length > AI_MAX_BODY_BYTES) {
    return bad("PAYLOAD_TOO_LARGE", "حجم الطلب كبير جدًا.", 413);
  }

  // 2) JSON صالح وكائن
  let body;
  try { body = JSON.parse(raw); } catch { return bad("BAD_REQUEST", "صيغة الطلب غير صحيحة."); }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return bad("BAD_REQUEST", "صيغة الطلب غير صحيحة.");
  }

  // 3) قائمة الرسائل
  const list = body.messages;
  if (!Array.isArray(list)) return bad("BAD_REQUEST", "قائمة الرسائل غير صحيحة.");
  if (list.length === 0) return bad("BAD_REQUEST", "لا يمكن إرسال رسالة فارغة.");
  if (list.length > AI_MAX_MESSAGES) {
    return bad("BAD_REQUEST", `الحد الأقصى ${AI_MAX_MESSAGES} رسالة في الطلب الواحد.`);
  }

  // 4) كل رسالة: كائن + role مسموح + content نص غير فارغ وضمن الحد
  const messages = [];
  for (let i = 0; i < list.length; i++) {
    const m = list[i];
    if (!m || typeof m !== "object" || Array.isArray(m)) {
      return bad("BAD_REQUEST", `الرسالة رقم ${i + 1} غير صحيحة.`);
    }
    if (typeof m.role !== "string" || !AI_ALLOWED_ROLES.has(m.role)) {
      return bad("BAD_REQUEST", `نوع الرسالة رقم ${i + 1} غير مسموح.`);
    }
    if (typeof m.content !== "string") {
      return bad("BAD_REQUEST", `محتوى الرسالة رقم ${i + 1} غير صحيح.`);
    }
    const content = m.content.trim();
    if (!content) return bad("BAD_REQUEST", `الرسالة رقم ${i + 1} فارغة.`);
    if (content.length > AI_MAX_MESSAGE_CHARS) {
      return bad("BAD_REQUEST", `الرسالة رقم ${i + 1} أطول من الحد المسموح (${AI_MAX_MESSAGE_CHARS} حرف).`);
    }
    // نمرّر role وcontent فقط — أي حقول إضافية تُسقط.
    messages.push({ role: m.role, content });
  }

  return { messages };
}

app.post("/api/ai/chat", async (c) => {
  const student = await requireStudent(c);

  // التحقق من الطلب أولًا: أي طلب غير صالح يُرفض هنا قبل أي قراءة من
  // Firestore أو حجز للحصة اليومية أو اتصال بمزود AI.
  const parsed = await readAndValidateAiBody(c);
  if (parsed.error) return parsed.error;
  const messages = parsed.messages;

  const db = getDb(c);

  // إصلاح: setting "aiEnabled" الموجود في لوحة الإدارة (settings/general)
  // ماكانش بيتقرا هنا خالص، يعني زرار إيقاف AI في الإدارة مكانش بيأثر
  // فعليًا على الـ endpoint. نفس منطق القراءة المستخدم في
  // GET /api/admin/settings (d.aiEnabled !== false → الافتراضي true).
  const settingsSnap = await db.collection("settings").doc("general").get();
  const aiEnabled = settingsSnap.exists ? settingsSnap.data().aiEnabled !== false : true;
  if (!aiEnabled) {
    return jsonResponse(fail("AI_DISABLED", "خدمة الذكاء الاصطناعي متوقفة حاليًا."), 403);
  }

  const env = c.env;
  const apiKey = env.AI_API_KEY;
  const provider = (env.AI_PROVIDER || "openai").toLowerCase();

  if (!apiKey) {
    return jsonResponse(fail("SERVER_ERROR", "خدمة AI غير مفعّلة حاليًا."), 500);
  }

  // حد يومي بسيط (Firestore).
  // مهم: الحجز نفسه يتم داخل transaction حتى لا تتجاوز الطلبات المتزامنة
  // الـDaily Limit بسبب نمط read → check → write.
  const dayKey = new Date().toISOString().slice(0, 10);
  const usageId = `${student.sub}_${dayKey}`;
  const usageRef = db.collection("aiUsage").doc(usageId);
  const dailyLimit = clamp(parseInt(env.AI_DAILY_LIMIT_STUDENT || "20", 10), 1, 200);

  let reserved = false;
  try {
    await db.runTransaction(async (tx) => {
      const usageSnap = await tx.get(usageRef);
      const currentCount = usageSnap.exists ? Number(usageSnap.data().count) || 0 : 0;

      if (currentCount >= dailyLimit) {
        throw new Error("AI_DAILY_LIMIT_REACHED");
      }

      tx.set(usageRef, {
        studentId: student.sub,
        date: dayKey,
        count: currentCount + 1,
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
      reserved = true;
    });
  } catch (e) {
    if (String(e?.message || e) === "AI_DAILY_LIMIT_REACHED") {
      return jsonResponse(
        fail("DAILY_LIMIT_REACHED", "تجاوزت الحد اليومي المسموح."),
        429
      );
    }
    throw e;
  }

  // إذا فشل طلب AI بعد الحجز، حرر الحصة المحجوزة حتى لا يُستهلك
  // الحد اليومي بسبب طلب فاشل. عملية التحرير نفسها transaction-safe.
  const releaseAiReservation = async () => {
    if (!reserved) return;
    try {
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(usageRef);
        if (!snap.exists) return;
        const count = Number(snap.data().count) || 0;
        tx.update(usageRef, {
          count: Math.max(0, count - 1),
          updatedAt: FieldValue.serverTimestamp()
        });
      });
      reserved = false;
    } catch (e) {
      // لا نفشل طلب العميل مرة ثانية بسبب فشل التعويض.
    }
  };

  // حد مخرجات النموذج (OpenAI: max_tokens، Gemini: maxOutputTokens)
  const maxOutputTokens = clamp(
    parseInt(env.AI_MAX_OUTPUT_TOKENS || String(AI_DEFAULT_MAX_OUTPUT_TOKENS), 10) || AI_DEFAULT_MAX_OUTPUT_TOKENS,
    50, 2000
  );

  // حدّد المزود
  let providerUrl = "";
  let model = "";
  let payload = {};

  if (provider === "openai") {
    providerUrl = "https://api.openai.com/v1/chat/completions";
    model = env.AI_MODEL || "gpt-4o-mini";
    payload = {
      model,
      messages: [
        { role: "system", content: "أنت مساعد تعليمي عربي للمنصة. اشرح بلغة بسيطة." },
        ...messages
      ],
      temperature: 0.7,
      max_tokens: maxOutputTokens
    };
  } else if (provider === "gemini") {
    model = env.AI_MODEL || "gemini-1.5-flash";
    providerUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    payload = {
      contents: messages.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }]
      })),
      generationConfig: { maxOutputTokens: maxOutputTokens }
    };
  } else {
    await releaseAiReservation();
    return jsonResponse(fail("SERVER_ERROR", "مزود AI غير مدعوم."), 500);
  }

  // طلب للـ AI
  let aiRes;
  try {
    const controller = new AbortController();
    const to = setTimeout(() => controller.abort(), 55000);

    const headers = { "Content-Type": "application/json" };
    if (provider === "openai") {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    aiRes = await fetch(providerUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    clearTimeout(to);
  } catch (e) {
    if (e && e.name === "AbortError") {
      await releaseAiReservation();
      return jsonResponse(fail("TIMEOUT", "الخدمة تأخرت. حاول مرة أخرى."), 504);
    }
    await releaseAiReservation();
    return jsonResponse(fail("SERVER_ERROR", "خطأ في الاتصال بمزود AI."), 500);
  }

  if (!aiRes.ok) {
    await releaseAiReservation();
    return jsonResponse(fail("SERVER_ERROR", "خطأ من مزود AI."), 500);
  }

  let aiData;
  try {
    aiData = await aiRes.json();
  } catch (e) {
    await releaseAiReservation();
    return jsonResponse(fail("SERVER_ERROR", "استجابة AI غير صالحة."), 500);
  }

  // استخرج الرد
  let reply = "";
  if (provider === "openai") {
    reply = safeText(aiData.choices?.[0]?.message?.content);
  } else if (provider === "gemini") {
    reply = safeText(aiData.candidates?.[0]?.content?.parts?.[0]?.text);
  }

  if (!reply) {
    await releaseAiReservation();
    return jsonResponse(fail("SERVER_ERROR", "لم يصل رد من AI."), 500);
  }

  // الحصة تم حجزها بالفعل atomically قبل استدعاء مزود AI.
  reserved = false;
  // الرد يعود لاحقًا ضمن سجل المحادثة، فلا يتجاوز حد طول الرسالة.
  return jsonResponse(ok({ reply: reply.slice(0, AI_MAX_MESSAGE_CHARS) }));
});


/* ============================================================
   24 — Route — Student Profile
   ============================================================ */

app.get("/api/student/profile", async (c) => {
  const student = await requireStudent(c);
  const db = getDb(c);

  const studentSnap = await db.collection("students").doc(student.sub).get();
  if (!studentSnap.exists) {
    return jsonResponse(fail("UNAUTHORIZED", "الحساب غير موجود."), 401);
  }
  const s = studentSnap.data();

  // إحصائيات
  const attemptsSnap = await db.collection("examAttempts")
    .where("studentId", "==", student.sub)
    .limit(500)
    .get();

  const attempts = attemptsSnap.docs.map((d) => d.data());
  const attemptsCount = attempts.length;

  let correctTotal = 0;
  let totalScore = 0;
  let totalQ = 0;
  attempts.forEach((a) => {
    correctTotal += Number(a.correctCount) || 0;
    totalScore += Number(a.score) || 0;
    totalQ += Number(a.total) || 0;
  });

  const averageScore = totalQ > 0 ? Math.round((totalScore / totalQ) * 100) : 0;

  // عدد الدروس التي فتحها الطالب/سُجّل إكمالها.
  const progressSnap = await db.collection("lessonProgress")
    .where("studentId", "==", student.sub)
    .where("completed", "==", true)
    .limit(500)
    .get();
  const completedLessons = progressSnap.size;

  return jsonResponse(ok({
    student: {
      id: student.sub,
      fullName: s.fullName || "",
      stage: s.stage || "",
      code: s.code || student.code || null,
      joinedAt: s.joinedAt || null,
      lastLogin: s.lastLogin || null,
      status: s.status || "active"
    },
    stats: {
      attemptsCount,
      correctAnswers: correctTotal,
      studyHoursTotal: Math.round((Number(s.studyHoursTotal) || 0) * 10) / 10,
      completedLessons,
      averageScore
    }
  }));
});


/* ============================================================
   25 — Route — Lesson Groups (Public for Subscribe)
   ============================================================ */

app.get("/api/lesson-groups", async (c) => {
  const db = getDb(c);
  const stage = safeText(c.req.query("stage"));
  if (!isValidStage(stage)) {
    return jsonResponse(ok({ groups: [] }));
  }

  const snap = await db.collection("lessonGroups")
    .where("stage", "==", stage)
    .where("active", "==", true)
    .limit(100)
    .get();

  const groups = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((g) => g && g.id)
    .map((g) => ({
      id: g.id,
      name: safeText(g.name),
      stage: g.stage
    }));

  return jsonResponse(ok({ groups }));
});


/* ============================================================
   26 — Route — Subscription Requests (Public)
   ============================================================ */

app.post("/api/subscription-requests", async (c) => {
  const db = getDb(c);

  // حد 5 طلبات / 10 دقائق لكل IP (لا نسجل أي بيانات شخصية).
  const subRateLimited = await enforceSubscriptionRateLimit(c, db);
  if (subRateLimited) return subRateLimited;

  const body = await c.req.json().catch(() => ({}));
  const stage = safeText(body.stage);
  const lessonGroupId = safeText(body.lessonGroupId);
  const info = (body.studentInformation && typeof body.studentInformation === "object")
    ? body.studentInformation
    : {};

  const fullName = safeText(info.fullName);
  const phone = safeText(info.phone);

  if (!isValidStage(stage)) {
    return jsonResponse(fail("BAD_REQUEST", "اختر المرحلة."), 400);
  }
  if (!lessonGroupId) {
    return jsonResponse(fail("BAD_REQUEST", "اختر مجموعة الدرس."), 400);
  }
  if (!fullName || fullName.length < 3) {
    return jsonResponse(fail("BAD_REQUEST", "الاسم غير صالح."), 400);
  }
  if (!phone || !/^[0-9+\-\s]{6,20}$/.test(phone)) {
    return jsonResponse(fail("BAD_REQUEST", "رقم الهاتف غير صحيح."), 400);
  }

  // إصلاح: setting "subscriptionsEnabled" الموجود في لوحة الإدارة
  // (settings/general) ماكانش بيتقرا هنا خالص، يعني الـ endpoint كان
  // بيقبل الطلبات حتى لو الإدارة أوقفت الاشتراكات من اللوحة. نفس منطق
  // القراءة المستخدم في GET /api/admin/settings.
  const settingsSnap = await db.collection("settings").doc("general").get();
  const subscriptionsEnabled = settingsSnap.exists
    ? settingsSnap.data().subscriptionsEnabled !== false
    : true;
  if (!subscriptionsEnabled) {
    return jsonResponse(fail("SUBSCRIPTIONS_DISABLED", "الاشتراكات متوقفة حاليًا."), 403);
  }

  // تحقق من مجموعة الدرس
  const groupSnap = await db.collection("lessonGroups").doc(lessonGroupId).get();
  if (!groupSnap.exists) {
    return jsonResponse(fail("NOT_FOUND", "مجموعة الدرس غير موجودة."), 404);
  }
  const groupData = groupSnap.data();
  if (groupData.stage !== stage || groupData.active === false) {
    return jsonResponse(fail("BAD_REQUEST", "مجموعة الدرس غير متاحة."), 400);
  }

  const ref = await db.collection("subscriptionRequests").add({
    stage,
    lessonGroupId,
    lessonGroupName: safeText(groupData.name),
    fullName,
    phone,
    status: "pending",
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  });

  return jsonResponse(ok({ requestId: ref.id, status: "pending" }));
});


/* ============================================================
   27 — Route — Admin — Statistics
   ============================================================ */

app.get("/api/admin/statistics", async (c) => {
  await requireAdmin(c);
  const db = getDb(c);

  const [studentsSnap, codesSnap, examsSnap, attemptsSnap, requestsSnap, announcementsSnap, sessionsSnap, aiUsageSnap] = await Promise.all([
    db.collection("students").limit(2000).get(),
    db.collection("codes").limit(2000).get(),
    db.collection("exams").limit(500).get(),
    db.collection("examAttempts").limit(5000).get(),
    db.collection("subscriptionRequests").limit(500).get(),
    db.collection("announcements").limit(500).get(),
    db.collection("studySessions").limit(5000).get(),
    db.collection("aiUsage").limit(5000).get()
  ]);

  // students
  const students = studentsSnap.docs.map((d) => d.data());
  const studentsCount = students.length;

  // stage distribution
  const stageDistribution = {
    grade_4: 0, grade_5: 0, grade_6: 0,
    prep_1: 0, prep_2: 0, prep_3: 0,
    sec_1: 0, sec_2: 0, sec_3: 0
  };
  students.forEach((s) => {
    const k = safeText(s.stage);
    if (k in stageDistribution) stageDistribution[k] += 1;
  });

  // codes
  const codes = codesSnap.docs.map((d) => d.data());
  const codesCount = codes.length;

  // exams
  const exams = examsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const examsCount = exams.filter((e) => e.status === "published").length;

  // attempts + performance
  const attempts = attemptsSnap.docs.map((d) => d.data());
  const attemptsCount = attempts.length;

  let sumPercent = 0;
  let totalScore = 0;
  let totalQ = 0;
  let passCount = 0;
  let failCount = 0;
  const passingPercent = clamp(parseInt(c.env.DEFAULT_PASSING_PERCENT || "50", 10), 1, 100);

  attempts.forEach((a) => {
    const p = Number(a.percent) || 0;
    sumPercent += p;
    totalScore += Number(a.score) || 0;
    totalQ += Number(a.total) || 0;
    if (p >= passingPercent) passCount += 1;
    else failCount += 1;
  });

  const averageScore = attemptsCount > 0 ? Math.round(sumPercent / attemptsCount) : 0;

  // study hours
  const sessions = sessionsSnap.docs.map((d) => d.data());
  let studyMinutes = 0;
  sessions.forEach((s) => {
    studyMinutes += Number(s.durationMinutes) || 0;
  });
  const studyHoursTotal = Math.round((studyMinutes / 60) * 10) / 10;

  // subscription requests
  const requests = requestsSnap.docs.map((d) => d.data());
  const requestsCount = requests.length;
  const pendingRequests = requests.filter((r) => r.status === "pending").length;

  // announcements
  const announcementsCount = announcementsSnap.size;

  // AI usage: كل وثيقة تمثل طالبًا/يومًا، لذلك نجمع الرسائل ونحسب الطلاب الفريدين.
  const aiUsage = aiUsageSnap.docs.map((d) => d.data());
  const aiMessagesCount = aiUsage.reduce((sum, row) => sum + (Number(row.count) || 0), 0);
  const aiActiveStudents = new Set(aiUsage.map((row) => safeText(row.studentId)).filter(Boolean)).size;

  // top students
  const best = {};
  attempts.forEach((a) => {
    const sid = safeText(a.studentId);
    const score = Number(a.score) || 0;
    if (!sid) return;
    if (!best[sid] || score > best[sid].score) {
      best[sid] = { score, percent: Number(a.percent) || 0 };
    }
  });

  const topIds = Object.keys(best)
    .map((id) => ({ id, ...best[id] }))
    .sort((a, b) => b.percent - a.percent)
    .slice(0, 5);

  // جلب أسماء أفضل الطلاب
  const topStudents = [];
  for (const t of topIds) {
    try {
      const snap = await db.collection("students").doc(t.id).get();
      if (snap.exists) {
        topStudents.push({
          id: t.id,
          name: safeText(snap.data().fullName),
          score: t.score,
          percent: t.percent
        });
      }
    } catch (e) { /* ignore */ }
  }

  return jsonResponse(ok({
    stats: {
      studentsCount,
      codesCount,
      examsCount,
      attemptsCount,
      studyHoursTotal,
      aiMessagesCount,
      requestsCount,
      pendingRequests,
      announcementsCount
    },
    stageDistribution,
    performance: {
      averageScore,
      passCount,
      failCount,
      passingPercent
    },
    topStudents,
    usage: {
      aiMessagesCount,
      aiActiveStudents,
      studySessionsCount: sessions.length,
      averageSessionMinutes: sessions.length > 0
        ? Math.round(studyMinutes / sessions.length)
        : 0
    }
  }));
});


/* ============================================================
   28 — Route — Admin — Codes
   ============================================================ */

app.get("/api/admin/codes", async (c) => {
  await requireAdmin(c);
  const db = getDb(c);

  const snap = await db.collection("codes").limit(500).get();
  const codes = [];

  for (const doc of snap.docs) {
    const d = doc.data();
    let studentName = null;
    if (d.studentId) {
      try {
        const s = await db.collection("students").doc(d.studentId).get();
        if (s.exists) studentName = safeText(s.data().fullName);
      } catch (e) { /* ignore */ }
    }

    codes.push({
      id: doc.id,
      code: safeText(d.code),
      status: safeText(d.status) || "unused",
      stage: d.stage || null,
      studentId: d.studentId || null,
      studentName,
      createdAt: d.createdAt || null,
      expiresAt: d.expiresAt || null,
      note: d.note || null
    });
  }

  // ترتيب: الأحدث أولاً
  codes.sort((a, b) => tsToMs(b.createdAt) - tsToMs(a.createdAt));

  return jsonResponse(ok({ codes }));
});

app.post("/api/admin/codes/create", async (c) => {
  await requireAdmin(c);
  const db = getDb(c);

  const body = await c.req.json().catch(() => ({}));
  const count = clamp(Number(body.count), 1, 500);
  const stage = safeText(body.stage);
  const note = safeText(body.note) || null;

  if (!isValidStage(stage)) {
    return jsonResponse(fail("BAD_REQUEST", "المرحلة غير صحيحة."), 400);
  }

  const created = [];
  const batch = db.batch();

  for (let i = 0; i < count; i++) {
    const code = generateCodeString();
    const password = generatePassword();
    const passwordHash = await hashPassword(password);
    const ref = db.collection("codes").doc();

    batch.set(ref, {
      code,
      passwordHash,
      status: "unused",
      studentId: null,
      stage,
      note,
      createdAt: FieldValue.serverTimestamp(),
      expiresAt: null
    });

    created.push({
      id: ref.id,
      code,
      password, // ← مرة واحدة فقط
      stage,
      status: "unused"
    });
  }

  await batch.commit();

  return jsonResponse(ok({ codes: created }));
});

app.patch("/api/admin/codes/:id", async (c) => {
  await requireAdmin(c);
  const db = getDb(c);

  const id = safeText(c.req.param("id"));
  if (!id) {
    return jsonResponse(fail("BAD_REQUEST", "معرّف الكود مطلوب."), 400);
  }

  const body = await c.req.json().catch(() => ({}));
  const newStatus = safeText(body.status);
  if (!["unused", "active", "disabled"].includes(newStatus)) {
    return jsonResponse(fail("BAD_REQUEST", "حالة الكود غير صحيحة."), 400);
  }

  const ref = db.collection("codes").doc(id);
  const snap = await ref.get();
  if (!snap.exists) {
    return jsonResponse(fail("NOT_FOUND", "الكود غير موجود."), 404);
  }

  // إصلاح: كود مرتبط بطالب (studentId موجود) ما ينفعش يرجع "unused" —
  // ده كان بيحصل لما الإدارة تعمل "إعادة تفعيل" لكود معطّل ومرتبط بطالب
  // (زرار "✅ تفعيل" كان بيبعت status="unused" بدل "active")، فيدخل
  // الطالب الأصلي في تدفق "أول تفعيل" تاني أو يتفتح الكود لطالب جديد
  // يستخدم نفس الكود من الأول. "unused" مسموحة فقط للكود اللي لسه
  // مالوش studentId خالص.
  const existingData = snap.data();
  if (newStatus === "unused" && safeText(existingData.studentId)) {
    return jsonResponse(
      fail("BAD_REQUEST", "لا يمكن تحويل كود مرتبط بطالب إلى حالة (متاح)."),
      400
    );
  }

  await ref.update({
    status: newStatus,
    updatedAt: FieldValue.serverTimestamp()
  });

  return jsonResponse(ok({ updated: true, status: newStatus }));
});


/* ============================================================
   29 — Route — Admin — Students
   ============================================================ */

app.get("/api/admin/students", async (c) => {
  await requireAdmin(c);
  const db = getDb(c);

  const snap = await db.collection("students").limit(1000).get();
  const students = snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      fullName: safeText(data.fullName),
      stage: safeText(data.stage),
      code: safeText(data.code),
      joinedAt: data.joinedAt || null,
      lastLogin: data.lastLogin || null,
      status: safeText(data.status) || "active",
      studyHoursTotal: Number(data.studyHoursTotal) || 0
    };
  });

  students.sort((a, b) => tsToMs(b.joinedAt) - tsToMs(a.joinedAt));

  return jsonResponse(ok({ students }));
});

app.get("/api/admin/students/:id", async (c) => {
  await requireAdmin(c);
  const db = getDb(c);

  const id = safeText(c.req.param("id"));
  if (!id) {
    return jsonResponse(fail("BAD_REQUEST", "معرّف الطالب مطلوب."), 400);
  }

  const snap = await db.collection("students").doc(id).get();
  if (!snap.exists) {
    return jsonResponse(fail("NOT_FOUND", "الطالب غير موجود."), 404);
  }
  const s = snap.data();

  const attemptsSnap = await db.collection("examAttempts")
    .where("studentId", "==", id)
    .limit(500)
    .get();

  const attempts = attemptsSnap.docs.map((d) => d.data());
  let totalScore = 0;
  let totalQ = 0;
  let correctTotal = 0;

  attempts.forEach((a) => {
    totalScore += Number(a.score) || 0;
    totalQ += Number(a.total) || 0;
    correctTotal += Number(a.correctCount) || 0;
  });

  const averageScore = totalQ > 0 ? Math.round((totalScore / totalQ) * 100) : 0;

  return jsonResponse(ok({
    student: {
      id,
      fullName: safeText(s.fullName),
      stage: safeText(s.stage),
      code: safeText(s.code),
      joinedAt: s.joinedAt || null,
      lastLogin: s.lastLogin || null,
      status: safeText(s.status) || "active"
    },
    stats: {
      attemptsCount: attempts.length,
      correctAnswers: correctTotal,
      studyHoursTotal: Math.round((Number(s.studyHoursTotal) || 0) * 10) / 10,
      completedLessons: 0,
      averageScore
    }
  }));
});


/* ============================================================
   30 — Route — Admin — Requests
   ============================================================ */

app.get("/api/admin/requests", async (c) => {
  await requireAdmin(c);
  const db = getDb(c);

  const snap = await db.collection("subscriptionRequests")
    .limit(500)
    .get();

  const requests = snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      fullName: safeText(data.fullName),
      phone: safeText(data.phone),
      stage: safeText(data.stage),
      lessonGroupId: safeText(data.lessonGroupId),
      lessonGroupName: safeText(data.lessonGroupName),
      status: safeText(data.status) || "pending",
      note: data.note || null,
      createdAt: data.createdAt || null,
      updatedAt: data.updatedAt || null
    };
  });

  requests.sort((a, b) => tsToMs(b.createdAt) - tsToMs(a.createdAt));

  return jsonResponse(ok({ requests }));
});

app.patch("/api/admin/requests/:id", async (c) => {
  await requireAdmin(c);
  const db = getDb(c);

  const id = safeText(c.req.param("id"));
  if (!id) {
    return jsonResponse(fail("BAD_REQUEST", "معرّف الطلب مطلوب."), 400);
  }

  const body = await c.req.json().catch(() => ({}));
  const newStatus = safeText(body.status);
  const allowed = ["pending", "contacted", "approved", "rejected", "completed"];
  if (!allowed.includes(newStatus)) {
    return jsonResponse(fail("BAD_REQUEST", "الحالة غير صحيحة."), 400);
  }

  const ref = db.collection("subscriptionRequests").doc(id);
  const snap = await ref.get();
  if (!snap.exists) {
    return jsonResponse(fail("NOT_FOUND", "الطلب غير موجود."), 404);
  }

  const update = {
    status: newStatus,
    updatedAt: FieldValue.serverTimestamp()
  };
  if (typeof body.note === "string") {
    update.note = safeText(body.note) || null;
  }

  await ref.update(update);

  return jsonResponse(ok({ updated: true }));
});


/* ============================================================
   30b — Helper — Announcement Link Validation (server-side)
   ------------------------------------------------------------
   التحقق من linkTarget في الخادم بحسب نوع الإعلان، دون الاعتماد
   على تحقق الواجهة.
   - text          : لا يحتاج رابطًا → يُخزَّن null.
   - internal_link : مسار داخلي نسبي فقط (مثل exams.html أو
                     lessons.html?stage=sec_1 أو /exams.html).
                     مرفوض: أي scheme (javascript: / data: / http(s): ...)
                     والروابط التي تبدأ بـ // والمسافات والـ \ و ..
   - external_link : عنوان مطلق ببروتوكول http أو https فقط.
   ============================================================ */

const ANNOUNCEMENT_TYPES = ["text", "internal_link", "external_link"];
const ANNOUNCEMENT_LINK_MAX = 2048;

// مسار داخلي: [/]segment(/segment)*[.html][?query][#hash]
const INTERNAL_LINK_RE =
  /^\/?[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*(?:\.html)?(?:\?[A-Za-z0-9_\-=&%.,]*)?(?:#[A-Za-z0-9_\-=&%.,]*)?$/;

function validateAnnouncementLink(type, rawLink) {
  if (type === "text") return { ok: true, value: null };

  if (rawLink !== null && rawLink !== undefined && typeof rawLink !== "string") {
    return { ok: false, message: "الرابط غير صالح." };
  }
  const link = safeText(rawLink);

  if (!link) return { ok: false, message: "الرابط مطلوب لهذا النوع من الإعلانات." };
  if (link.length > ANNOUNCEMENT_LINK_MAX) {
    return { ok: false, message: "الرابط طويل جدًا." };
  }
  // مسافات / محارف تحكم / backslash (تُستخدم للتحايل على المتصفحات)
  if (/[\u0000-\u0020\u007F\\]/.test(link)) {
    return { ok: false, message: "الرابط يحتوي على محارف غير مسموحة." };
  }

  if (type === "internal_link") {
    if (link.startsWith("//")) {
      return { ok: false, message: "الرابط الداخلي يجب ألا يبدأ بـ //." };
    }
    if (/^[A-Za-z][A-Za-z0-9+.\-]*:/.test(link)) {
      return { ok: false, message: "الرابط الداخلي يجب أن يكون مسارًا داخل المنصة دون بروتوكول." };
    }
    if (!INTERNAL_LINK_RE.test(link)) {
      return { ok: false, message: "صيغة الرابط الداخلي غير صحيحة (مثال: exams.html)." };
    }
    return { ok: true, value: link };
  }

  if (type === "external_link") {
    if (!/^https?:\/\//i.test(link)) {
      return { ok: false, message: "الرابط الخارجي يجب أن يبدأ بـ http:// أو https://." };
    }
    let u;
    try { u = new URL(link); } catch (e) {
      return { ok: false, message: "الرابط الخارجي غير صالح." };
    }
    if ((u.protocol !== "http:" && u.protocol !== "https:") || !u.hostname) {
      return { ok: false, message: "الرابط الخارجي غير صالح." };
    }
    if (u.username || u.password) {
      return { ok: false, message: "الرابط الخارجي يجب ألا يحتوي على بيانات دخول." };
    }
    return { ok: true, value: link };
  }

  return { ok: false, message: "نوع الإعلان غير صحيح." };
}


/* ============================================================
   31 — Route — Admin — Announcements
   ============================================================ */

app.get("/api/admin/announcements", async (c) => {
  await requireAdmin(c);
  const db = getDb(c);

  const snap = await db.collection("announcements").limit(500).get();
  const announcements = [];

  for (const doc of snap.docs) {
    const d = doc.data();
    // عدد الردود
    let repliesCount = 0;
    try {
      const r = await db.collection("announcementReplies")
        .where("announcementId", "==", doc.id)
        .limit(500)
        .get();
      repliesCount = r.size;
    } catch (e) { /* ignore */ }

    announcements.push({
      id: doc.id,
      title: safeText(d.title),
      body: safeText(d.body),
      type: safeText(d.type) || "text",
      targetType: safeText(d.targetType) || "all",
      targetValue: d.targetValue || null,
      linkTarget: d.linkTarget || null,
      createdAt: d.createdAt || null,
      repliesCount
    });
  }

  announcements.sort((a, b) => tsToMs(b.createdAt) - tsToMs(a.createdAt));

  return jsonResponse(ok({ announcements }));
});

app.post("/api/admin/announcements", async (c) => {
  await requireAdmin(c);
  const db = getDb(c);

  const body = await c.req.json().catch(() => ({}));
  const title = safeText(body.title);
  const text = safeText(body.body);
  const type = safeText(body.type) || "text";
  const targetType = safeText(body.targetType) || "all";
  const targetValue = body.targetValue || null;

  if (!title || title.length > 150) {
    return jsonResponse(fail("BAD_REQUEST", "العنوان غير صالح."), 400);
  }
  if (!text || text.length > 5000) {
    return jsonResponse(fail("BAD_REQUEST", "النص غير صالح."), 400);
  }
  if (!["all", "stage", "student"].includes(targetType)) {
    return jsonResponse(fail("BAD_REQUEST", "نوع الجمهور غير صحيح."), 400);
  }
  if (!ANNOUNCEMENT_TYPES.includes(type)) {
    return jsonResponse(fail("BAD_REQUEST", "نوع الإعلان غير صحيح."), 400);
  }
  if (targetType === "stage" && !isValidStage(targetValue)) {
    return jsonResponse(fail("BAD_REQUEST", "المرحلة غير صحيحة."), 400);
  }
  if (targetType === "student" && !targetValue) {
    return jsonResponse(fail("BAD_REQUEST", "معرّف الطالب مطلوب."), 400);
  }

  // التحقق من الرابط في الخادم بحسب نوع الإعلان
  const linkCheck = validateAnnouncementLink(type, body.linkTarget);
  if (!linkCheck.ok) {
    return jsonResponse(fail("BAD_REQUEST", linkCheck.message), 400);
  }
  const linkTarget = linkCheck.value;

  const ref = await db.collection("announcements").add({
    title,
    body: text,
    type,
    targetType,
    targetValue: targetType === "all" ? null : targetValue,
    linkTarget,
    createdAt: FieldValue.serverTimestamp()
  });

  return jsonResponse(ok({
    announcement: {
      id: ref.id,
      title,
      body: text,
      type,
      targetType,
      targetValue: targetType === "all" ? null : targetValue,
      linkTarget,
      createdAt: new Date(),
      repliesCount: 0
    }
  }));
});

app.patch("/api/admin/announcements/:id", async (c) => {
  await requireAdmin(c);
  const db = getDb(c);

  const id = safeText(c.req.param("id"));
  if (!id) return jsonResponse(fail("BAD_REQUEST", "المعرّف مطلوب."), 400);

  const body = await c.req.json().catch(() => ({}));
  const ref = db.collection("announcements").doc(id);
  const snap = await ref.get();
  if (!snap.exists) return jsonResponse(fail("NOT_FOUND", "الإعلان غير موجود."), 404);

  const update = {};
  if (typeof body.title === "string") update.title = safeText(body.title);
  if (typeof body.body === "string") update.body = safeText(body.body);
  if (typeof body.type === "string") update.type = safeText(body.type);
  if (typeof body.targetType === "string") update.targetType = safeText(body.targetType);
  if (typeof body.targetValue === "string" || body.targetValue === null) update.targetValue = body.targetValue;

  // التحقق من النوع والرابط معًا على الحالة النهائية (المرسَلة + الموجودة)
  if (typeof body.type === "string" && !ANNOUNCEMENT_TYPES.includes(update.type)) {
    return jsonResponse(fail("BAD_REQUEST", "نوع الإعلان غير صحيح."), 400);
  }
  if (body.type !== undefined || body.linkTarget !== undefined) {
    const existing = snap.data() || {};
    const finalType = typeof body.type === "string"
      ? update.type
      : (safeText(existing.type) || "text");
    const rawLink = body.linkTarget !== undefined ? body.linkTarget : existing.linkTarget;
    const linkCheck = validateAnnouncementLink(finalType, rawLink);
    if (!linkCheck.ok) {
      return jsonResponse(fail("BAD_REQUEST", linkCheck.message), 400);
    }
    update.linkTarget = linkCheck.value;
  }
  update.updatedAt = FieldValue.serverTimestamp();

  await ref.update(update);
  return jsonResponse(ok({ updated: true }));
});

app.delete("/api/admin/announcements/:id", async (c) => {
  await requireAdmin(c);
  const db = getDb(c);

  const id = safeText(c.req.param("id"));
  if (!id) return jsonResponse(fail("BAD_REQUEST", "المعرّف مطلوب."), 400);

  const ref = db.collection("announcements").doc(id);
  const snap = await ref.get();
  if (!snap.exists) return jsonResponse(fail("NOT_FOUND", "الإعلان غير موجود."), 404);

  await ref.delete();

  // حذف الردود المرتبطة
  try {
    const replies = await db.collection("announcementReplies")
      .where("announcementId", "==", id)
      .limit(500)
      .get();
    const batch = db.batch();
    replies.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  } catch (e) { /* ignore */ }

  return jsonResponse(ok({ deleted: true }));
});

app.get("/api/admin/announcements/:id/replies", async (c) => {
  await requireAdmin(c);
  const db = getDb(c);

  const id = safeText(c.req.param("id"));
  if (!id) return jsonResponse(fail("BAD_REQUEST", "المعرّف مطلوب."), 400);

  const snap = await db.collection("announcementReplies")
    .where("announcementId", "==", id)
    .limit(500)
    .get();

  const replies = snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      studentId: data.studentId,
      studentName: safeText(data.studentName),
      message: safeText(data.message),
      createdAt: data.createdAt || null
    };
  });

  replies.sort((a, b) => tsToMs(b.createdAt) - tsToMs(a.createdAt));

  return jsonResponse(ok({ replies }));
});


/* ============================================================
   32 — Route — Admin — Lessons
   ============================================================ */

app.get("/api/admin/lessons", async (c) => {
  await requireAdmin(c);
  const db = getDb(c);

  const snap = await db.collection("lessons").limit(500).get();
  const lessons = snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      title: safeText(data.title),
      kind: safeText(data.kind) || "video",
      youtubeUrl: safeText(data.youtubeUrl),
      stage: safeText(data.stage),
      createdAt: data.createdAt || null
    };
  });

  lessons.sort((a, b) => tsToMs(b.createdAt) - tsToMs(a.createdAt));

  return jsonResponse(ok({ lessons }));
});

app.post("/api/admin/lessons", async (c) => {
  await requireAdmin(c);
  const db = getDb(c);

  const body = await c.req.json().catch(() => ({}));
  const title = safeText(body.title);
  const kind = safeText(body.kind);
  const youtubeUrl = safeText(body.youtubeUrl);
  const stage = safeText(body.stage);

  if (!title || title.length > 150) {
    return jsonResponse(fail("BAD_REQUEST", "العنوان غير صالح."), 400);
  }
  if (!["video", "audio"].includes(kind)) {
    return jsonResponse(fail("BAD_REQUEST", "نوع الدرس غير صحيح."), 400);
  }
  if (!isYouTubeUrl(youtubeUrl)) {
    return jsonResponse(fail("BAD_REQUEST", "رابط YouTube غير صالح."), 400);
  }
  if (!isValidStage(stage)) {
    return jsonResponse(fail("BAD_REQUEST", "المرحلة غير صحيحة."), 400);
  }

  const ref = await db.collection("lessons").add({
    title,
    kind,
    youtubeUrl,
    stage,
    createdAt: FieldValue.serverTimestamp()
  });

  return jsonResponse(ok({
    lesson: {
      id: ref.id,
      title,
      kind,
      youtubeUrl,
      stage,
      createdAt: new Date()
    }
  }));
});

app.patch("/api/admin/lessons/:id", async (c) => {
  await requireAdmin(c);
  const db = getDb(c);

  const id = safeText(c.req.param("id"));
  if (!id) return jsonResponse(fail("BAD_REQUEST", "المعرّف مطلوب."), 400);

  const body = await c.req.json().catch(() => ({}));
  const ref = db.collection("lessons").doc(id);
  const snap = await ref.get();
  if (!snap.exists) return jsonResponse(fail("NOT_FOUND", "الدرس غير موجود."), 404);

  const update = {};
  if (typeof body.title === "string") update.title = safeText(body.title);
  if (typeof body.kind === "string" && ["video", "audio"].includes(body.kind)) update.kind = body.kind;
  if (typeof body.youtubeUrl === "string" && isYouTubeUrl(body.youtubeUrl)) update.youtubeUrl = safeText(body.youtubeUrl);
  if (typeof body.stage === "string" && isValidStage(body.stage)) update.stage = body.stage;
  update.updatedAt = FieldValue.serverTimestamp();

  await ref.update(update);
  return jsonResponse(ok({ updated: true }));
});

app.delete("/api/admin/lessons/:id", async (c) => {
  await requireAdmin(c);
  const db = getDb(c);

  const id = safeText(c.req.param("id"));
  if (!id) return jsonResponse(fail("BAD_REQUEST", "المعرّف مطلوب."), 400);

  const ref = db.collection("lessons").doc(id);
  const snap = await ref.get();
  if (!snap.exists) return jsonResponse(fail("NOT_FOUND", "الدرس غير موجود."), 404);

  await ref.delete();
  return jsonResponse(ok({ deleted: true }));
});


/* ============================================================
   33 — Route — Admin — Exams
   ============================================================ */

app.get("/api/admin/exams", async (c) => {
  await requireAdmin(c);
  const db = getDb(c);

  const snap = await db.collection("exams").limit(500).get();

  // attempts count لكل اختبار
  const exams = [];
  for (const doc of snap.docs) {
    const d = doc.data();
    let attemptsCount = 0;
    try {
      const a = await db.collection("examAttempts")
        .where("examId", "==", doc.id)
        .limit(2000)
        .get();
      attemptsCount = a.size;
    } catch (e) { /* ignore */ }

    exams.push({
      id: doc.id,
      title: safeText(d.title),
      stage: safeText(d.stage),
      status: safeText(d.status) || "draft",
      resultPolicy: safeText(d.resultPolicy) || "immediate",
      resultTime: d.resultTime || null,
      resultDurationMinutes: Number(d.resultDurationMinutes) || 0,
      questionsCount: Array.isArray(d.questions) ? d.questions.length : 0,
      attemptsCount,
      createdAt: d.createdAt || null
    });
  }

  exams.sort((a, b) => tsToMs(b.createdAt) - tsToMs(a.createdAt));

  return jsonResponse(ok({ exams }));
});

app.post("/api/admin/exams", async (c) => {
  await requireAdmin(c);
  const db = getDb(c);

  const body = await c.req.json().catch(() => ({}));
  const validation = validateExamPayload(body);
  if (!validation.ok) {
    return jsonResponse(fail("BAD_REQUEST", validation.error), 400);
  }

  const ref = await db.collection("exams").add({
    title: validation.title,
    stage: validation.stage,
    resultPolicy: validation.resultPolicy,
    resultTime: validation.resultTime,
    resultDurationMinutes: validation.resultDurationMinutes,
    questions: validation.questions,
    status: "draft",
    createdAt: FieldValue.serverTimestamp()
  });

  return jsonResponse(ok({
    exam: {
      id: ref.id,
      title: validation.title,
      stage: validation.stage,
      status: "draft",
      resultPolicy: validation.resultPolicy,
      resultTime: validation.resultTime,
      resultDurationMinutes: validation.resultDurationMinutes,
      questionsCount: validation.questions.length,
      attemptsCount: 0,
      createdAt: new Date()
    }
  }));
});

app.patch("/api/admin/exams/:id", async (c) => {
  await requireAdmin(c);
  const db = getDb(c);

  const id = safeText(c.req.param("id"));
  if (!id) return jsonResponse(fail("BAD_REQUEST", "المعرّف مطلوب."), 400);

  const body = await c.req.json().catch(() => ({}));
  const validation = validateExamPayload(body, { requireStatus: false });
  if (!validation.ok) {
    return jsonResponse(fail("BAD_REQUEST", validation.error), 400);
  }

  const ref = db.collection("exams").doc(id);
  const snap = await ref.get();
  if (!snap.exists) return jsonResponse(fail("NOT_FOUND", "الاختبار غير موجود."), 404);

  await ref.update({
    title: validation.title,
    stage: validation.stage,
    resultPolicy: validation.resultPolicy,
    resultTime: validation.resultTime,
    resultDurationMinutes: validation.resultDurationMinutes,
    questions: validation.questions,
    updatedAt: FieldValue.serverTimestamp()
  });

  return jsonResponse(ok({ updated: true }));
});

app.patch("/api/admin/exams/:id/publish", async (c) => {
  await requireAdmin(c);
  const db = getDb(c);

  const id = safeText(c.req.param("id"));
  if (!id) return jsonResponse(fail("BAD_REQUEST", "المعرّف مطلوب."), 400);

  const body = await c.req.json().catch(() => ({}));
  const status = safeText(body.status);
  if (!["draft", "published"].includes(status)) {
    return jsonResponse(fail("BAD_REQUEST", "الحالة غير صحيحة."), 400);
  }

  const ref = db.collection("exams").doc(id);
  const snap = await ref.get();
  if (!snap.exists) return jsonResponse(fail("NOT_FOUND", "الاختبار غير موجود."), 404);

  const exam = snap.data();

  // تحقق قبل النشر (بند 100)
  if (status === "published") {
    if (!exam.title || !isValidStage(exam.stage)) {
      return jsonResponse(fail("BAD_REQUEST", "بيانات الاختبار ناقصة."), 400);
    }
    if (!Array.isArray(exam.questions) || exam.questions.length === 0) {
      return jsonResponse(fail("BAD_REQUEST", "الاختبار لا يحتوي على أسئلة."), 400);
    }
  }

  await ref.update({
    status,
    publishedAt: status === "published" ? FieldValue.serverTimestamp() : null,
    updatedAt: FieldValue.serverTimestamp()
  });

  return jsonResponse(ok({ updated: true, status }));
});

app.delete("/api/admin/exams/:id", async (c) => {
  await requireAdmin(c);
  const db = getDb(c);

  const id = safeText(c.req.param("id"));
  if (!id) return jsonResponse(fail("BAD_REQUEST", "المعرّف مطلوب."), 400);

  const ref = db.collection("exams").doc(id);
  const snap = await ref.get();
  if (!snap.exists) return jsonResponse(fail("NOT_FOUND", "الاختبار غير موجود."), 404);

  await ref.delete();

  // حذف المحاولات المرتبطة
  try {
    const attempts = await db.collection("examAttempts")
      .where("examId", "==", id)
      .limit(1000)
      .get();
    const batch = db.batch();
    attempts.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  } catch (e) { /* ignore */ }

  return jsonResponse(ok({ deleted: true }));
});


/* ============================================================
   34 — Helper — Validate Exam Payload
   ============================================================ */

function validateExamPayload(body, opts = {}) {
  const { requireStatus = false } = opts;

  const title = safeText(body.title);
  const stage = safeText(body.stage);
  const policy = safeText(body.resultPolicy) || "immediate";
  const resultTime = body.resultTime || null;
  const resultDurationMinutes = clamp(Number(body.resultDurationMinutes) || 0, 0, 10080);
  const questions = Array.isArray(body.questions) ? body.questions : [];

  if (!title || title.length > 150) return { ok: false, error: "العنوان غير صالح." };
  if (!isValidStage(stage)) return { ok: false, error: "المرحلة غير صحيحة." };
  if (!["immediate", "after_duration", "after_datetime"].includes(policy)) {
    return { ok: false, error: "سياسة النتيجة غير صحيحة." };
  }
  if (policy === "after_datetime" && !resultTime) {
    return { ok: false, error: "حدد وقت ظهور النتيجة." };
  }
  if (policy === "after_duration" && resultDurationMinutes <= 0) {
    return { ok: false, error: "حدد مدة ظهور النتيجة." };
  }
  if (questions.length < 1) {
    return { ok: false, error: "يجب إضافة سؤال واحد على الأقل." };
  }

  const safeQuestions = [];
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const text = safeText(q.text);
    const choices = Array.isArray(q.choices) ? q.choices.map((c) => safeText(c)) : [];
    const correctIndex = Number(q.correctIndex);

    if (!text) return { ok: false, error: `السؤال ${i + 1}: نص السؤال ناقص.` };
    if (choices.length < 3 || choices.length > 4) {
      return { ok: false, error: `السؤال ${i + 1}: يجب 3 أو 4 اختيارات.` };
    }
    if (choices.some((c) => !c)) {
      return { ok: false, error: `السؤال ${i + 1}: يوجد اختيار فارغ.` };
    }
    if (isNaN(correctIndex) || correctIndex < 0 || correctIndex >= choices.length) {
      return { ok: false, error: `السؤال ${i + 1}: الإجابة الصحيحة غير محددة.` };
    }

    safeQuestions.push({ text, choices, correctIndex });
  }

  return {
    ok: true,
    title,
    stage,
    resultPolicy: policy,
    resultTime: policy === "after_datetime" ? resultTime : null,
    resultDurationMinutes: policy === "after_duration" ? resultDurationMinutes : 0,
    questions: safeQuestions
  };
}


/* ============================================================
   35 — Route — Admin — Results
   ============================================================ */

app.get("/api/admin/results", async (c) => {
  await requireAdmin(c);
  const db = getDb(c);

  const examId = safeText(c.req.query("examId"));
  const passingPercent = clamp(parseInt(c.env.DEFAULT_PASSING_PERCENT || "50", 10), 1, 100);

  let ref = db.collection("examAttempts");
  if (examId) ref = ref.where("examId", "==", examId);

  const snap = await ref.limit(2000).get();

  const results = [];
  for (const doc of snap.docs) {
    const d = doc.data();
    let examTitle = "";
    let studentName = "";

    try {
      if (d.examId) {
        const e = await db.collection("exams").doc(d.examId).get();
        if (e.exists) examTitle = safeText(e.data().title);
      }
    } catch (e) { /* ignore */ }

    try {
      if (d.studentId) {
        const s = await db.collection("students").doc(d.studentId).get();
        if (s.exists) studentName = safeText(s.data().fullName);
      }
    } catch (e) { /* ignore */ }

    results.push({
      id: doc.id,
      examId: d.examId,
      examTitle,
      studentId: d.studentId,
      studentName,
      stage: safeText(d.stage),
      score: Number(d.score) || 0,
      total: Number(d.total) || 0,
      percent: Number(d.percent) || 0,
      correctCount: Number(d.correctCount) || 0,
      wrongCount: Number(d.wrongCount) || 0,
      resultVisible: d.resultVisible === true,
      attemptedAt: d.attemptedAt || null
    });
  }

  results.sort((a, b) => tsToMs(b.attemptedAt) - tsToMs(a.attemptedAt));

  let examTitle = "";
  if (examId) {
    try {
      const e = await db.collection("exams").doc(examId).get();
      if (e.exists) examTitle = safeText(e.data().title);
    } catch (e) { /* ignore */ }
  }

  return jsonResponse(ok({
    results,
    passingPercent,
    examTitle
  }));
});


/* ============================================================
   36 — Route — Admin — Settings
   ============================================================ */

app.get("/api/admin/settings", async (c) => {
  await requireAdmin(c);
  const db = getDb(c);

  const ref = db.collection("settings").doc("general");
  const snap = await ref.get();

  if (!snap.exists) {
    return jsonResponse(ok({
      settings: {
        academicYear: "",
        platformName: "منصة أ/ إسماعيل عماد",
        subscriptionsEnabled: true,
        prayerEnabled: true,
        aiEnabled: true
      }
    }));
  }

  const d = snap.data();
  return jsonResponse(ok({
    settings: {
      academicYear: safeText(d.academicYear),
      platformName: safeText(d.platformName),
      subscriptionsEnabled: d.subscriptionsEnabled !== false,
      prayerEnabled: d.prayerEnabled !== false,
      aiEnabled: d.aiEnabled !== false
    }
  }));
});

app.patch("/api/admin/settings", async (c) => {
  await requireAdmin(c);
  const db = getDb(c);

  const body = await c.req.json().catch(() => ({}));

  const update = {
    updatedAt: FieldValue.serverTimestamp()
  };

  if (typeof body.academicYear === "string" || body.academicYear === null) {
    update.academicYear = safeText(body.academicYear) || "";
  }
  if (typeof body.platformName === "string") {
    update.platformName = safeText(body.platformName);
  }
  if (typeof body.subscriptionsEnabled === "boolean") {
    update.subscriptionsEnabled = body.subscriptionsEnabled;
  }
  if (typeof body.prayerEnabled === "boolean") {
    update.prayerEnabled = body.prayerEnabled;
  }
  if (typeof body.aiEnabled === "boolean") {
    update.aiEnabled = body.aiEnabled;
  }

  await db.collection("settings").doc("general").set(update, { merge: true });

  return jsonResponse(ok({ updated: true }));
});


/* ============================================================
   37 — Route — Student/Public — General Settings
   ============================================================ */

// إعدادات العرض العامة التي يحتاجها الطالب فقط.
// لا نُرجع أي بيانات إدارية حساسة هنا.
app.get("/api/student/settings", async (c) => {
  await requireStudent(c);
  const db = getDb(c);

  const snap = await db.collection("settings").doc("general").get();

  return jsonResponse(ok({
    settings: {
      prayerEnabled: snap.exists ? snap.data().prayerEnabled !== false : true
    }
  }));
});


/* ============================================================
   38 — Route — Admin — Lesson Groups
   ============================================================ */

app.get("/api/admin/lesson-groups", async (c) => {
  await requireAdmin(c);
  const db = getDb(c);

  const snap = await db.collection("lessonGroups").limit(500).get();
  const groups = snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      name: safeText(data.name),
      stage: safeText(data.stage),
      active: data.active !== false,
      createdAt: data.createdAt || null
    };
  });

  groups.sort((a, b) => tsToMs(b.createdAt) - tsToMs(a.createdAt));

  return jsonResponse(ok({ groups }));
});

app.post("/api/admin/lesson-groups", async (c) => {
  await requireAdmin(c);
  const db = getDb(c);

  const body = await c.req.json().catch(() => ({}));
  const name = safeText(body.name);
  const stage = safeText(body.stage);
  const active = body.active !== false;

  if (!name || name.length > 80) {
    return jsonResponse(fail("BAD_REQUEST", "اسم المجموعة غير صالح."), 400);
  }
  if (!isValidStage(stage)) {
    return jsonResponse(fail("BAD_REQUEST", "المرحلة غير صحيحة."), 400);
  }

  const ref = await db.collection("lessonGroups").add({
    name,
    stage,
    active,
    createdAt: FieldValue.serverTimestamp()
  });

  return jsonResponse(ok({
    group: {
      id: ref.id,
      name,
      stage,
      active,
      createdAt: new Date()
    }
  }));
});

app.patch("/api/admin/lesson-groups/:id", async (c) => {
  await requireAdmin(c);
  const db = getDb(c);

  const id = safeText(c.req.param("id"));
  if (!id) return jsonResponse(fail("BAD_REQUEST", "المعرّف مطلوب."), 400);

  const body = await c.req.json().catch(() => ({}));
  const ref = db.collection("lessonGroups").doc(id);
  const snap = await ref.get();
  if (!snap.exists) return jsonResponse(fail("NOT_FOUND", "المجموعة غير موجودة."), 404);

  const update = {};
  if (typeof body.name === "string") update.name = safeText(body.name);
  if (typeof body.stage === "string" && isValidStage(body.stage)) update.stage = body.stage;
  if (typeof body.active === "boolean") update.active = body.active;
  update.updatedAt = FieldValue.serverTimestamp();

  await ref.update(update);
  return jsonResponse(ok({ updated: true }));
});

app.delete("/api/admin/lesson-groups/:id", async (c) => {
  await requireAdmin(c);
  const db = getDb(c);

  const id = safeText(c.req.param("id"));
  if (!id) return jsonResponse(fail("BAD_REQUEST", "المعرّف مطلوب."), 400);

  const ref = db.collection("lessonGroups").doc(id);
  const snap = await ref.get();
  if (!snap.exists) return jsonResponse(fail("NOT_FOUND", "المجموعة غير موجودة."), 404);

  await ref.delete();
  return jsonResponse(ok({ deleted: true }));
});


/* ============================================================
   38 — Not Found
   ============================================================ */

app.notFound((c) => {
  return jsonResponse(fail("NOT_FOUND", "المسار غير موجود."), 404);
});


/* ============================================================
   39 — Export
   ============================================================ */

export default {
  async fetch(request, env, ctx) {
    // تأكد من تهيئة Firebase مرة واحدة
    try {
      initFirebase(env);
    } catch (e) {
      console.error("[Firebase Init Error]", e && e.message);
      return jsonResponse(
        fail("SERVER_ERROR", "خطأ في تهيئة الخدمة."),
        500
      );
    }

    return app.fetch(request, env, ctx);
  }
};