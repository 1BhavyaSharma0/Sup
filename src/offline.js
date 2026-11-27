// IndexedDB storage for downloaded course packs and the queue of work done offline.
import { gradeAnswer, correctAnswerText, percent } from "../shared/grading.js";

let dbPromise;
const open = () => dbPromise ||= new Promise((resolve, reject) => {
  if (!("indexedDB" in window)) return reject(new Error("This browser does not support offline storage."));
  const req = indexedDB.open("learnsphere-offline", 1);
  req.onupgradeneeded = () => { const db = req.result; db.createObjectStore("packs", { keyPath: "courseId" }); db.createObjectStore("queue", { keyPath: "id", autoIncrement: true }); };
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const request = fn(t.objectStore(store));
    t.oncomplete = () => resolve(request?.result);
    t.onerror = t.onabort = () => reject(t.error);
  });
}

/* ---- course packs ---- */
export const savePack = (courseId, pack) => tx("packs", "readwrite", s => s.put({ courseId: Number(courseId), savedAt: new Date().toISOString(), size: JSON.stringify(pack).length, pack }));
export const getPack = async courseId => (await tx("packs", "readonly", s => s.get(Number(courseId))))?.pack || null;
export const listPacks = () => tx("packs", "readonly", s => s.getAll()).then(r => r || []);
export const deletePack = courseId => tx("packs", "readwrite", s => s.delete(Number(courseId)));

export async function setLocalProgress(courseId, topicId, completed, updated_at) {
  const rec = await tx("packs", "readonly", s => s.get(Number(courseId)));
  if (!rec) return;
  rec.pack.progress = { ...(rec.pack.progress || {}), [topicId]: { completed, updated_at } };
  await tx("packs", "readwrite", s => s.put(rec));
}

/* ---- queue of attempts / progress made offline ---- */
export const enqueue = (type, payload) => tx("queue", "readwrite", s => s.add({ type, payload, created: new Date().toISOString() }));
export const getQueue = () => tx("queue", "readonly", s => s.getAll()).then(r => r || []);
export async function removeQueue(ids) { const db = await open(); await new Promise((res, rej) => { const t = db.transaction("queue", "readwrite"); ids.forEach(id => t.objectStore("queue").delete(id)); t.oncomplete = res; t.onerror = () => rej(t.error); }); }
export const queueCount = () => tx("queue", "readonly", s => s.count()).then(n => n || 0);

export const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

export async function storageUsage() {
  try { const e = await navigator.storage.estimate(); return { used: e.usage || 0, quota: e.quota || 0 }; } catch { return null; }
}
export const fmtBytes = n => n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

/* ---- offline helpers built on a pack ---- */

/** Joins a public question with the answer key stored in the pack (if the teacher allowed it). */
export function withKey(pack, q) {
  const k = pack.answers?.[q.id];
  if (!k) return null;
  return { ...q, answer_text: k.answer_text, explanation: k.explanation, options: (q.options || []).map(o => ({ ...o, correct: k.correct_labels.includes(o.label) })) };
}

/** Provisional grading on the device. The server re-grades when the attempt syncs. */
export function gradeLocal(pack, questions, answers, meta = {}) {
  let correct = 0, graded = 0, longCount = 0;
  const hasKey = !!pack.answers;
  const reviewed = questions.map(q => {
    const full = withKey(pack, q);
    const given = answers[q.id] ?? "";
    const ok = full ? gradeAnswer(full, given) : null;
    if (full) { if (ok === null) longCount++; else { graded++; if (ok) correct++; } }
    return { question_id: q.id, question_text: q.question_text, question_type: q.question_type, your_answer: given, correct: ok, options: q.options || [],
      correct_answer: full ? correctAnswerText(full) : "", explanation: full?.explanation || "" };
  });
  return { provisional: true, hasKey, score: correct, total: graded, percentage: percent(correct, graded), long_count: longCount, reviewed, ...meta };
}
