import { Router } from "express";
import { all, one, run, runc, transaction } from "../db.js";
import { auth, allow, ownCourse } from "../lib/auth.js";
import { int, sample } from "../lib/util.js";
import { enrolledCourseIds, gradeAndRecord, buildResult, applyProgress } from "../lib/attempts.js";
import { withOptions, publicQuestion } from "../lib/questions.js";
import { generateAutoQuizzes, quizQuestionIds, DEFAULT_QUIZ_CONFIG } from "../lib/quizgen.js";
import { teacherDefaults } from "./auth.js";

const r = Router();
const teacher = [auth, allow("teacher")];
const student = [auth, allow("student")];

const ownQuiz = (id, uid) => one("SELECT z.* FROM quizzes z JOIN courses c ON c.id=z.course_id WHERE z.id=? AND c.teacher_id=?", [id, uid]);
const quizRow = z => ({ ...z, published: !!z.published, auto: !!z.auto });

/* ----------------------------------------------------------------- teacher */

r.get("/teacher/courses/:id/quiz-stats", ...teacher, (req, res) => {
  const c = ownCourse(req.params.id, req.user.id);
  if (!c) return res.status(404).json({ error: "Course not found." });
  const by_chapter = all(`SELECT ch.id, ch.title, (SELECT COUNT(*) FROM questions q WHERE q.chapter_id=ch.id AND q.approval_status='approved') count
                          FROM chapters ch WHERE ch.course_id=? ORDER BY ch.position,ch.id`, [c.id]);
  res.json({
    approved: one("SELECT COUNT(*) n FROM questions WHERE course_id=? AND approval_status='approved'", [c.id]).n,
    pending: one("SELECT COUNT(*) n FROM questions WHERE course_id=? AND approval_status='pending'", [c.id]).n,
    unassigned: one("SELECT COUNT(*) n FROM questions WHERE course_id=? AND approval_status='approved' AND chapter_id IS NULL", [c.id]).n,
    by_chapter, defaults: teacherDefaults(req.user.id),
  });
});

r.post("/teacher/courses/:id/auto-quizzes", ...teacher, (req, res) => {
  const c = ownCourse(req.params.id, req.user.id);
  if (!c) return res.status(404).json({ error: "Course not found." });
  const out = generateAutoQuizzes({ course_id: c.id, user_id: req.user.id, config: req.body?.config || {}, publish: req.body?.publish !== false });
  res.json(out);
});

r.get("/teacher/quizzes", ...teacher, (req, res) => {
  const rows = all(`SELECT z.*, c.title course_title,
      (SELECT COUNT(*) FROM quiz_questions qq JOIN questions q ON q.id=qq.question_id WHERE qq.quiz_id=z.id AND q.approval_status='approved') stored_count,
      (SELECT COUNT(*) FROM quiz_attempts a WHERE a.quiz_id=z.id) attempts,
      (SELECT ROUND(AVG(a.score)) FROM quiz_attempts a WHERE a.quiz_id=z.id) avg_score
    FROM quizzes z JOIN courses c ON c.id=z.course_id WHERE c.teacher_id=? ${req.query.course_id ? "AND z.course_id=?" : ""} ORDER BY z.course_id, z.id`,
    req.query.course_id ? [req.user.id, int(req.query.course_id)] : [req.user.id]);
  res.json({ quizzes: rows.map(z => ({ ...quizRow(z), question_count: z.kind === "random" ? z.question_count : z.stored_count })) });
});

r.get("/teacher/quizzes/:id", ...teacher, (req, res) => {
  const z = ownQuiz(req.params.id, req.user.id);
  if (!z) return res.status(404).json({ error: "Quiz not found." });
  const rows = all("SELECT q.* FROM quiz_questions qq JOIN questions q ON q.id=qq.question_id WHERE qq.quiz_id=? ORDER BY qq.position", [z.id]);
  res.json({ quiz: quizRow(z), questions: withOptions(rows) });
});

function saveQuestionList(quizId, courseId, ids) {
  const valid = all(`SELECT id FROM questions WHERE course_id=? AND approval_status='approved' AND id IN (${ids.map(() => "?").join(",") || "NULL"})`, [courseId, ...ids]).map(x => x.id);
  const keep = ids.filter(i => valid.includes(i));
  runc("DELETE FROM quiz_questions WHERE quiz_id=?", [quizId]);
  keep.forEach((id, i) => run("INSERT INTO quiz_questions(quiz_id,question_id,position) VALUES(?,?,?)", [quizId, id, i]));
  return keep.length;
}

r.post("/teacher/quizzes", ...teacher, (req, res) => {
  const b = req.body || {};
  const course = ownCourse(b.course_id, req.user.id);
  if (!course) return res.status(404).json({ error: "Course not found." });
  const title = String(b.title || "").trim();
  if (!title) return res.status(400).json({ error: "Give the quiz a title." });
  let ids = (b.question_ids || []).map(Number).filter(Boolean);
  if (!ids.length && b.pick) {
    const where = ["course_id=?", "approval_status='approved'"], params = [course.id];
    if (b.pick.chapter_id) { where.push("chapter_id=?"); params.push(int(b.pick.chapter_id)); }
    if (["Easy", "Medium", "Hard"].includes(b.pick.difficulty)) { where.push("difficulty=?"); params.push(b.pick.difficulty); }
    ids = sample(all(`SELECT id FROM questions WHERE ${where.join(" AND ")}`, params), int(b.pick.count, 10)).map(x => x.id);
  }
  const mode = b.mode === "assessment" ? "assessment" : "practice";
  const quizId = transaction(() => {
    const id = run("INSERT INTO quizzes(course_id,chapter_id,title,kind,mode,question_count,duration_min,published,auto,created_by) VALUES(?,?,?,?,?,?,?,?,0,?)",
      [course.id, b.chapter_id || null, title, "custom", mode, ids.length, mode === "assessment" ? Math.max(1, int(b.duration_min, Math.ceil(ids.length * 1.5))) : 0, b.published === false ? 0 : 1, req.user.id]);
    const n = saveQuestionList(id, course.id, ids);
    runc("UPDATE quizzes SET question_count=? WHERE id=?", [n, id]);
    return id;
  });
  if (!one("SELECT COUNT(*) n FROM quiz_questions WHERE quiz_id=?", [quizId]).n) { runc("DELETE FROM quizzes WHERE id=?", [quizId]); return res.status(400).json({ error: "No approved questions matched. Pick some questions first." }); }
  res.json({ quiz: quizRow(one("SELECT * FROM quizzes WHERE id=?", [quizId])) });
});

r.patch("/teacher/quizzes/:id", ...teacher, (req, res) => {
  const z = ownQuiz(req.params.id, req.user.id);
  if (!z) return res.status(404).json({ error: "Quiz not found." });
  const b = req.body || {};
  const mode = b.mode ? (b.mode === "assessment" ? "assessment" : "practice") : z.mode;
  transaction(() => {
    runc("UPDATE quizzes SET title=?,mode=?,duration_min=?,published=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
      [String(b.title ?? z.title).trim() || z.title, mode, mode === "practice" ? 0 : Math.max(1, int(b.duration_min ?? z.duration_min, 15)), b.published === undefined ? z.published : b.published ? 1 : 0, z.id]);
    if (Array.isArray(b.question_ids)) { const n = saveQuestionList(z.id, z.course_id, b.question_ids.map(Number).filter(Boolean)); runc("UPDATE quizzes SET question_count=?, auto=0 WHERE id=?", [n, z.id]); }
  });
  res.json({ quiz: quizRow(one("SELECT * FROM quizzes WHERE id=?", [z.id])) });
});

r.delete("/teacher/quizzes/:id", ...teacher, (req, res) => {
  const z = ownQuiz(req.params.id, req.user.id);
  if (!z) return res.status(404).json({ error: "Quiz not found." });
  runc("DELETE FROM quizzes WHERE id=?", [z.id]);
  res.json({ success: true });
});

/* ----------------------------------------------------------------- student */

r.get("/quizzes", ...student, (req, res) => {
  const courses = enrolledCourseIds(req.user.id);
  const rows = all(`SELECT z.*, c.title course_title,
      (SELECT COUNT(*) FROM quiz_questions qq JOIN questions q ON q.id=qq.question_id WHERE qq.quiz_id=z.id AND q.approval_status='approved') stored_count,
      (SELECT COUNT(*) FROM quiz_attempts a WHERE a.quiz_id=z.id AND a.student_id=?) attempts,
      (SELECT MAX(a.score) FROM quiz_attempts a WHERE a.quiz_id=z.id AND a.student_id=?) best_score
    FROM quizzes z JOIN courses c ON c.id=z.course_id
    WHERE z.published=1 AND z.course_id IN (${courses.map(() => "?").join(",") || "NULL"}) ORDER BY z.course_id, z.id`, [req.user.id, req.user.id, ...courses]);
  res.json({ quizzes: rows.map(z => ({ id: z.id, course_id: z.course_id, course_title: z.course_title, title: z.title, kind: z.kind, mode: z.mode, chapter_id: z.chapter_id,
    duration_min: z.duration_min, question_count: z.kind === "random" ? z.question_count : z.stored_count, attempts: z.attempts, best_score: z.best_score })) });
});

r.get("/quizzes/:id/play", ...student, (req, res) => {
  const z = one("SELECT * FROM quizzes WHERE id=? AND published=1", [req.params.id]);
  if (!z || !enrolledCourseIds(req.user.id).includes(z.course_id)) return res.status(404).json({ error: "Quiz not found." });
  const ids = quizQuestionIds(z);
  const byId = new Map(withOptions(all(`SELECT * FROM questions WHERE id IN (${ids.map(() => "?").join(",") || "NULL"})`, ids)).map(q => [q.id, q]));
  res.json({ quiz: { id: z.id, title: z.title, kind: z.kind, mode: z.mode, duration_min: z.duration_min, course_id: z.course_id }, questions: ids.map(i => byId.get(i)).filter(Boolean).map(publicQuestion) });
});

r.post("/quizzes/:id/submit", ...student, (req, res) => {
  const b = req.body || {};
  res.json(gradeAndRecord({ user: req.user, quiz_id: int(req.params.id), question_ids: b.question_ids || [], answers: b.answers || {}, client_attempt_id: b.client_attempt_id, duration_sec: b.duration_sec }));
});

r.get("/attempts/:id", ...student, (req, res) => {
  const a = one("SELECT id FROM quiz_attempts WHERE id=? AND student_id=?", [req.params.id, req.user.id]);
  if (!a) return res.status(404).json({ error: "Attempt not found." });
  res.json(buildResult(a.id));
});

r.get("/quiz/history", ...student, (req, res) => res.json({ attempts: all("SELECT id,title,score,correct,total,long_count,created_at,offline FROM quiz_attempts WHERE student_id=? ORDER BY id DESC LIMIT 100", [req.user.id]) }));

/** Offline queue upload: attempts are graded here (authoritative) and progress is merged last-write-wins. */
r.post("/sync", ...student, (req, res) => {
  const attempts = [], failed = [];
  for (const a of (req.body?.attempts || []).slice(0, 100)) {
    try {
      const result = gradeAndRecord({ user: req.user, quiz_id: a.quiz_id ? int(a.quiz_id) : null, course_id: a.course_id ? int(a.course_id) : null, title: a.title,
        question_ids: a.question_ids || [], answers: a.answers || {}, client_attempt_id: a.client_attempt_id, duration_sec: a.duration_sec, offline: true });
      attempts.push({ client_attempt_id: a.client_attempt_id, ...result });
    } catch (e) { failed.push({ client_attempt_id: a.client_attempt_id, error: e.message }); }
  }
  const progress = applyProgress(req.user.id, req.body?.progress || []);
  res.json({ attempts, failed, progress });
});

export default r;
