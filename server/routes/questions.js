import { Router } from "express";
import { all, one, runc, transaction } from "../db.js";
import { auth, allow, ownCourse } from "../lib/auth.js";
import { int, sample } from "../lib/util.js";
import { enrolledCourseIds, gradeAndRecord } from "../lib/attempts.js";
import { withOptions, publicQuestion, answerPayload, cleanQuestionInput, insertQuestion, replaceOptions, problemFor, ownQuestion } from "../lib/questions.js";
import { QUESTION_TYPES } from "../../shared/grading.js";

const r = Router();
const teacher = [auth, allow("teacher")];
const student = [auth, allow("student")];

/** Checks that the course belongs to the teacher and the chapter belongs to that course. */
export function scopeError(userId, course_id, chapter_id) {
  if (course_id && !ownCourse(course_id, userId)) return "That course is not yours.";
  if (chapter_id) {
    const ch = one("SELECT course_id FROM chapters WHERE id=?", [chapter_id]);
    if (!ch || (course_id && ch.course_id !== Number(course_id))) return "That chapter does not belong to the selected course.";
  }
  return null;
}

/* ----------------------------------------------------------------- teacher question bank */

r.get("/teacher/questions", ...teacher, (req, res) => {
  const { course_id, chapter_id, status, type, difficulty, q } = req.query;
  const page = Math.max(1, int(req.query.page, 1)), limit = Math.min(100, Math.max(5, int(req.query.limit, 20)));
  const where = ["created_by=?"], params = [req.user.id];
  if (course_id) { where.push("course_id=?"); params.push(int(course_id)); }
  if (chapter_id === "none") where.push("chapter_id IS NULL"); else if (chapter_id) { where.push("chapter_id=?"); params.push(int(chapter_id)); }
  if (["approved", "pending"].includes(status)) { where.push("approval_status=?"); params.push(status); }
  if (QUESTION_TYPES.includes(type)) { where.push("question_type=?"); params.push(type); }
  if (["Easy", "Medium", "Hard"].includes(difficulty)) { where.push("difficulty=?"); params.push(difficulty); }
  if (q) { where.push("question_text LIKE ?"); params.push(`%${String(q).slice(0, 100)}%`); }
  const W = where.join(" AND ");
  const total = one(`SELECT COUNT(*) n FROM questions WHERE ${W}`, params).n;
  const rows = all(`SELECT * FROM questions WHERE ${W} ORDER BY id DESC LIMIT ? OFFSET ?`, [...params, limit, (page - 1) * limit]);
  const counts = one("SELECT SUM(approval_status='approved') approved, SUM(approval_status='pending') pending FROM questions WHERE created_by=?", [req.user.id]);
  res.json({ questions: withOptions(rows), total, page, pages: Math.max(1, Math.ceil(total / limit)), counts: { approved: counts.approved || 0, pending: counts.pending || 0 } });
});

r.post("/teacher/questions", ...teacher, (req, res) => {
  const b = req.body || {}, q = cleanQuestionInput(b);
  const err = scopeError(req.user.id, b.course_id, b.chapter_id);
  if (err) return res.status(400).json({ error: err });
  if (!b.course_id) return res.status(400).json({ error: "Choose a course for this question." });
  const reason = problemFor(q);
  if (reason && b.save_as_pending !== true) return res.status(400).json({ error: reason });
  const id = insertQuestion(q, { course_id: b.course_id, chapter_id: b.chapter_id, user_id: req.user.id, status: reason ? "pending" : "approved" });
  res.json({ question: withOptions([one("SELECT * FROM questions WHERE id=?", [id])])[0], status: reason ? "pending" : "approved", reason });
});

r.patch("/teacher/questions/:id", ...teacher, (req, res) => {
  const cur = ownQuestion(req.params.id, req.user.id);
  if (!cur) return res.status(404).json({ error: "Question not found." });
  const b = req.body || {};
  const base = withOptions([cur])[0];
  const q = cleanQuestionInput(b, base);
  const course_id = b.course_id ?? cur.course_id, chapter_id = b.chapter_id === undefined ? cur.chapter_id : b.chapter_id;
  const err = scopeError(req.user.id, course_id, chapter_id);
  if (err) return res.status(400).json({ error: err });
  const wants = b.approval_status ?? cur.approval_status;
  const reason = problemFor(q);
  if (reason && wants === "approved" && b.approval_status === "approved") return res.status(400).json({ error: reason });
  const status = reason ? "pending" : wants;
  transaction(() => {
    runc(`UPDATE questions SET question_text=?,question_type=?,difficulty=?,answer_text=?,answer_source=?,answer_verified=?,explanation=?,marks=?,course_id=?,chapter_id=?,approval_status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`,
      [q.question_text, q.question_type, q.difficulty, q.answer_text, q.answer_source, q.answer_verified ? 1 : 0, q.explanation, q.marks, course_id, chapter_id || null, status, cur.id]);
    replaceOptions(cur.id, q.options);
  });
  res.json({ question: withOptions([one("SELECT * FROM questions WHERE id=?", [cur.id])])[0], status, reason });
});

r.delete("/teacher/questions/:id", ...teacher, (req, res) => {
  const n = runc("DELETE FROM questions WHERE id=? AND created_by=?", [req.params.id, req.user.id]); // options + quiz links cascade
  res.status(n ? 200 : 404).json(n ? { success: true } : { error: "Question not found." });
});

r.post("/teacher/questions/bulk", ...teacher, (req, res) => {
  const { action, chapter_id, difficulty } = req.body || {};
  const ids = (req.body?.ids || []).map(Number).filter(Boolean).slice(0, 500);
  const rows = withOptions(all(`SELECT * FROM questions WHERE created_by=? AND id IN (${ids.map(() => "?").join(",") || "NULL"})`, [req.user.id, ...ids]));
  const out = { changed: 0, skipped: [] };
  transaction(() => {
    for (const q of rows) {
      if (action === "delete") out.changed += runc("DELETE FROM questions WHERE id=?", [q.id]);
      else if (action === "unpublish") out.changed += runc("UPDATE questions SET approval_status='pending' WHERE id=?", [q.id]);
      else if (action === "approve") {
        const reason = problemFor({ ...q, answer_verified: !!q.answer_verified });
        if (reason) out.skipped.push({ id: q.id, reason }); else out.changed += runc("UPDATE questions SET approval_status='approved' WHERE id=?", [q.id]);
      } else if (action === "move") {
        const err = scopeError(req.user.id, q.course_id, chapter_id);
        if (err) { out.skipped.push({ id: q.id, reason: err }); continue; }
        out.changed += runc("UPDATE questions SET chapter_id=? WHERE id=?", [chapter_id || null, q.id]);
      } else if (action === "difficulty" && ["Easy", "Medium", "Hard"].includes(difficulty)) out.changed += runc("UPDATE questions SET difficulty=? WHERE id=?", [difficulty, q.id]);
    }
  });
  res.json(out);
});

/* ----------------------------------------------------------------- student question bank & practice */

r.get("/questions", ...student, (req, res) => {
  const courses = enrolledCourseIds(req.user.id);
  const cid = req.query.course_id ? int(req.query.course_id) : null;
  if (cid && !courses.includes(cid)) return res.status(403).json({ error: "Enroll in this course to see its questions." });
  const scope = cid ? [cid] : courses;
  const where = [`approval_status='approved'`, `course_id IN (${scope.map(() => "?").join(",") || "NULL"})`], params = [...scope];
  if (req.query.chapter_id) { where.push("chapter_id=?"); params.push(int(req.query.chapter_id)); }
  if (QUESTION_TYPES.includes(req.query.type)) { where.push("question_type=?"); params.push(req.query.type); }
  if (["Easy", "Medium", "Hard"].includes(req.query.difficulty)) { where.push("difficulty=?"); params.push(req.query.difficulty); }
  if (req.query.q) { where.push("question_text LIKE ?"); params.push(`%${String(req.query.q).slice(0, 100)}%`); }
  const questions = withOptions(all(`SELECT * FROM questions WHERE ${where.join(" AND ")} ORDER BY id DESC LIMIT 500`, params));
  res.json({ questions: questions.map(publicQuestion) });
});

// Answers are fetched one at a time, after the student asks for them.
r.get("/questions/:id/answer", ...student, (req, res) => {
  const q = one("SELECT * FROM questions WHERE id=? AND approval_status='approved'", [req.params.id]);
  if (!q || !enrolledCourseIds(req.user.id).includes(q.course_id)) return res.status(404).json({ error: "Question not found." });
  res.json(answerPayload(withOptions([q])[0]));
});

r.get("/practice", ...student, (req, res) => {
  const courses = enrolledCourseIds(req.user.id);
  const cid = req.query.course_id ? int(req.query.course_id) : null;
  if (cid && !courses.includes(cid)) return res.status(403).json({ error: "Enroll in this course first." });
  const scope = cid ? [cid] : courses;
  const where = [`approval_status='approved'`, `course_id IN (${scope.map(() => "?").join(",") || "NULL"})`], params = [...scope];
  if (req.query.chapter_id) { where.push("chapter_id=?"); params.push(int(req.query.chapter_id)); }
  if (["Easy", "Medium", "Hard"].includes(req.query.difficulty)) { where.push("difficulty=?"); params.push(req.query.difficulty); }
  const rows = withOptions(all(`SELECT * FROM questions WHERE ${where.join(" AND ")}`, params));
  res.json({ questions: sample(rows, Math.min(50, Math.max(1, int(req.query.count, 10)))).map(publicQuestion), available: rows.length });
});

r.post("/practice/submit", ...student, (req, res) => {
  const b = req.body || {};
  res.json(gradeAndRecord({ user: req.user, course_id: b.course_id ? int(b.course_id) : null, title: String(b.title || "Practice session").slice(0, 120),
    question_ids: b.question_ids || [], answers: b.answers || {}, client_attempt_id: b.client_attempt_id, duration_sec: b.duration_sec }));
});

export default r;
