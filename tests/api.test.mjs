// End-to-end API test: runs the real Express app against a throwaway database.
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ls-"));
process.env.DATA_DIR = path.join(tmp, "data"); process.env.UPLOAD_DIR = path.join(tmp, "up");
process.env.NO_LISTEN = "1"; process.env.JWT_SECRET = "test-secret-0123456789-abcdefghijklmnopqrstu"; process.env.TEACHER_INVITE_CODE = "INVITE-123";
const { app } = await import("../server/index.js");
const server = app.listen(0); const base = `http://localhost:${server.address().port}/api`;

const call = async (method, url, { token, body, form } = {}) => {
  const res = await fetch(base + url, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, body: form || (body ? JSON.stringify(body) : undefined) });
  return { status: res.status, data: await res.json().catch(() => ({})) };
};
const login = async (email, password) => (await call("POST", "/auth/login", { body: { email, password } })).data.token;
const T = await login("teacher@learnsphere.dev", "teacher123"), S = await login("student@learnsphere.dev", "student123");

// --- security ---
assert.equal((await call("POST", "/auth/register", { body: { name: "Eve", email: "eve@x.io", password: "password1", role: "teacher" } })).status, 403, "teacher signup needs invite code");
assert.equal((await call("POST", "/auth/register", { body: { name: "Eve", email: "eve@x.io", password: "password1", role: "teacher", invite_code: "INVITE-123" } })).status, 200);
assert.equal((await call("GET", "/teacher/questions", { token: S })).status, 403, "students cannot use teacher APIs");

// --- students never receive answers before attempting ---
const qs = (await call("GET", "/questions", { token: S })).data.questions;
assert.ok(qs.length >= 12);
assert.ok(qs.every(q => !("answer_text" in q) && !("explanation" in q) && (q.options || []).every(o => !("correct" in o))), "no answer leakage");

// --- upload a multi-section paper (TXT) -> drafts ---
const paper = `Section A: Multiple Choice\n1. Which is a supervised learning algorithm?\nA) K-Means\nB) Linear Regression\nC) Apriori\nD) DBSCAN\n2. Which statement best describes machine learning? A) Fixed rules B) Learning patterns from data C) A database D) A language\nSection B: Short Answer\n3. Define regularisation. [2 marks]\nAns: A technique that penalises model complexity to reduce overfitting.\n4. What is a decision tree?\nSection C: Long Answer\n5. Explain the bias-variance trade-off with an example. (5 marks)\nAnswer Key\n1. B  2. B\n`;
const form = new FormData(); form.append("documents", new Blob([paper]), "paper1.txt"); form.append("documents", new Blob([paper.replace("1. Which is", "1. Which one is")]), "paper2.txt");
const courseId = (await call("GET", "/courses", { token: T })).data.courses.find(c => c.title.startsWith("Machine")).id;
form.append("course_id", String(courseId));
const up = await call("POST", "/teacher/documents", { token: T, form });
assert.equal(up.status, 200); assert.equal(up.data.documents.length, 2); assert.equal(up.data.questions.length, 10);
const dups = up.data.questions.filter(q => q.duplicate_of);
assert.ok(dups.length >= 4, "duplicates across the two papers and the bank are flagged: " + dups.length);
assert.ok(up.data.questions.some(q => q.suggested_chapter_id), "chapters are suggested");
const first = up.data.questions.find(q => q.source_file === "paper1.txt" && q.question_text.startsWith("Which is"));
assert.equal(first.options.find(o => o.correct).label, "B", "answer key extracted");

// --- fake file content is rejected ---
const bad = new FormData(); bad.append("documents", new Blob(["MZ\x00\x00 not a pdf"]), "evil.pdf");
assert.equal((await call("POST", "/teacher/documents", { token: T, form: bad })).data.errors.length, 1);

// --- import: ready ones approved, incomplete ones stay pending, AI answers need verification ---
const drafts = up.data.questions.filter(q => q.source_file === "paper1.txt").map(q => ({ ...q, chapter_id: q.suggested_chapter_id }));
drafts.push({ question_text: "Name one regularisation technique.", question_type: "short_answer", answer_text: "L2", answer_source: "ai_suggested", answer_verified: false, options: [] });
const imp = await call("POST", "/teacher/import", { token: T, body: { course_id: courseId, questions: drafts, document_ids: up.data.documents.map(d => d.id), auto_quizzes: { enabled: true, config: { quick: 5, chapter: 3, full: 8, random: 4 } } } });
assert.equal(imp.status, 200); assert.equal(imp.data.skipped, 0);
assert.equal(imp.data.pending, 2, "short answer without key + unverified AI answer stay pending");
assert.ok(imp.data.imported >= 3);
const pendingIds = (await call("GET", "/teacher/questions?status=pending", { token: T })).data.questions;
assert.equal(pendingIds.length, 2);
assert.equal((await call("PATCH", `/teacher/questions/${pendingIds[0].id}`, { token: T, body: { approval_status: "approved" } })).status, 400, "cannot approve without an answer");
const fixed = await call("PATCH", `/teacher/questions/${pendingIds.find(q => q.answer_source === "ai_suggested").id}`, { token: T, body: { answer_verified: true, answer_source: "teacher", approval_status: "approved" } });
assert.equal(fixed.data.status, "approved");
assert.ok(!(await call("GET", "/questions", { token: S })).data.questions.some(q => q.question_text.startsWith("What is a decision tree")), "pending hidden from students");

// --- quizzes ---
const quizzes = (await call("GET", "/quizzes", { token: S })).data.quizzes;
const kinds = new Set(quizzes.map(q => q.kind));
for (const k of ["quick", "chapter", "full", "random"]) assert.ok(kinds.has(k), "auto quiz " + k);
const quick = quizzes.find(q => q.kind === "quick" && q.course_id === courseId);
const play = (await call("GET", `/quizzes/${quick.id}/play`, { token: S })).data;
assert.ok(play.questions.length > 0 && play.questions.every(q => !("answer_text" in q)));

// --- offline pack + idempotent sync + server-authoritative grading ---
const pack = (await call("GET", `/courses/${courseId}/pack`, { token: S })).data;
assert.ok(pack.questions.length && pack.answers && pack.quizzes.length);
const answers = Object.fromEntries(play.questions.map(q => [q.id, q.question_type === "mcq" ? "A" : "x"]));
const attempt = { client_attempt_id: "abc-123", quiz_id: quick.id, question_ids: play.questions.map(q => q.id), answers, duration_sec: 61 };
const prog = { topic_id: pack.chapters[0].topics[0].id, completed: true, updated_at: new Date().toISOString() };
const s1 = await call("POST", "/sync", { token: S, body: { attempts: [attempt], progress: [prog] } });
const s2 = await call("POST", "/sync", { token: S, body: { attempts: [attempt], progress: [prog] } });
assert.equal(s1.data.attempts[0].attempt_id, s2.data.attempts[0].attempt_id, "same offline attempt is stored once");
assert.equal(s2.data.attempts[0].duplicate, true);
assert.equal((await call("GET", "/quiz/history", { token: S })).data.attempts.length, 1);
assert.equal(s1.data.progress.applied, 1);
const stale = await call("POST", "/progress", { token: S, body: { topic_id: prog.topic_id, completed: false, updated_at: new Date(Date.now() - 86400000).toISOString() } });
assert.equal(stale.data.skipped, 1, "older progress never overwrites newer");

// --- teacher insights ---
const perf = (await call("GET", `/teacher/performance?course_id=${courseId}`, { token: T })).data;
assert.equal(perf.summary.attempts, 1); assert.equal(perf.students.length, 1);
assert.equal((await call("GET", "/stats/student", { token: S })).data.totals.attempts, 1);

// --- deleting a chapter must not break questions or quizzes ---
const course = (await call("GET", `/courses/${courseId}`, { token: T })).data;
assert.equal((await call("DELETE", `/chapters/${course.chapters[0].id}`, { token: T })).status, 200);
assert.equal((await call("DELETE", `/courses/${courseId}`, { token: T })).status, 200);
console.log("api tests passed");
server.close(); process.exit(0);
