import { Router } from "express";
import { all, one, run, runc, transaction } from "../db.js";
import { auth, allow, ownCourse } from "../lib/auth.js";
import { wrap, int } from "../lib/util.js";
import { enrolledCourseIds, applyProgress } from "../lib/attempts.js";
import { withOptions, publicQuestion, answerPayload } from "../lib/questions.js";
import { quizQuestionIds } from "../lib/quizgen.js";
import { upload, removeFile } from "../lib/upload.js";
import { extractText, verifyFileType } from "../lib/extract.js";
import path from "path";

const r = Router();
const teacher = [auth, allow("teacher")];
const student = [auth, allow("student")];

function courseProgress(studentId, ids) {
  const map = new Map();
  for (const id of ids) {
    const total = one("SELECT COUNT(*) n FROM topics t JOIN chapters c ON c.id=t.chapter_id WHERE c.course_id=?", [id]).n;
    const done = one("SELECT COUNT(*) n FROM progress p JOIN topics t ON t.id=p.topic_id JOIN chapters c ON c.id=t.chapter_id WHERE p.student_id=? AND p.completed=1 AND c.course_id=?", [studentId, id]).n;
    map.set(id, { total, done, percent: total ? Math.round((done / total) * 100) : 0 });
  }
  return map;
}
export { courseProgress };

/* ----------------------------------------------------------------- courses */

r.get("/courses", auth, (req, res) => {
  const base = `SELECT c.*, u.name teacher_name,
    (SELECT COUNT(*) FROM chapters ch WHERE ch.course_id=c.id) chapter_count,
    (SELECT COUNT(*) FROM enrollments e WHERE e.course_id=c.id) student_count,
    (SELECT COUNT(*) FROM questions q WHERE q.course_id=c.id AND q.approval_status='approved') question_count,
    (SELECT COUNT(*) FROM quizzes z WHERE z.course_id=c.id AND z.published=1) quiz_count
    FROM courses c LEFT JOIN users u ON u.id=c.teacher_id`;
  if (req.user.role === "teacher") return res.json({ courses: all(`${base} WHERE c.teacher_id=? ORDER BY c.id DESC`, [req.user.id]) });
  const enrolled = new Set(all("SELECT course_id FROM enrollments WHERE student_id=?", [req.user.id]).map(x => x.course_id));
  const courses = all(`${base} WHERE c.published=1 ORDER BY c.id DESC`);
  const prog = courseProgress(req.user.id, courses.filter(c => enrolled.has(c.id)).map(c => c.id));
  res.json({ courses: courses.map(c => ({ ...c, enrolled: enrolled.has(c.id), progress: prog.get(c.id)?.percent || 0 })) });
});

const courseFields = b => ({
  title: String(b.title || "").trim(), description: String(b.description || "").trim(),
  category: String(b.category || "General").trim() || "General", level: ["Beginner", "Intermediate", "Advanced"].includes(b.level) ? b.level : "Beginner",
});

r.post("/courses", ...teacher, (req, res) => {
  const f = courseFields(req.body || {});
  if (!f.title) return res.status(400).json({ error: "Course title is required." });
  const id = run("INSERT INTO courses(title,description,category,level,teacher_id,published) VALUES(?,?,?,?,?,?)", [f.title, f.description, f.category, f.level, req.user.id, req.body.published === false ? 0 : 1]);
  res.json({ course: one("SELECT * FROM courses WHERE id=?", [id]) });
});

r.patch("/courses/:id", ...teacher, (req, res) => {
  const c = ownCourse(req.params.id, req.user.id);
  if (!c) return res.status(404).json({ error: "Course not found." });
  const b = req.body || {}, f = courseFields({ ...c, ...b });
  runc("UPDATE courses SET title=?,description=?,category=?,level=?,published=?,offline_answers=? WHERE id=?",
    [f.title || c.title, f.description, f.category, f.level, b.published === undefined ? c.published : b.published ? 1 : 0, b.offline_answers === undefined ? c.offline_answers : b.offline_answers ? 1 : 0, c.id]);
  res.json({ course: one("SELECT * FROM courses WHERE id=?", [c.id]) });
});

r.delete("/courses/:id", ...teacher, (req, res) => {
  const c = ownCourse(req.params.id, req.user.id);
  if (!c) return res.status(404).json({ error: "Course not found." });
  transaction(() => {
    runc("DELETE FROM questions WHERE course_id=?", [c.id]);   // options + quiz links cascade
    runc("DELETE FROM courses WHERE id=?", [c.id]);            // chapters, topics, quizzes, enrollments cascade
  });
  res.json({ success: true });
});

r.get("/courses/:id", auth, (req, res) => {
  const course = one("SELECT c.*, u.name teacher_name FROM courses c LEFT JOIN users u ON u.id=c.teacher_id WHERE c.id=?", [req.params.id]);
  const isOwner = course && req.user.role === "teacher" && course.teacher_id === req.user.id;
  if (!course || (!isOwner && !(req.user.role === "student" && course.published))) return res.status(404).json({ error: "Course not found." });
  const chapters = all("SELECT * FROM chapters WHERE course_id=? ORDER BY position,id", [course.id]).map(ch => ({
    ...ch, topics: all("SELECT * FROM topics WHERE chapter_id=? ORDER BY position,id", [ch.id]),
  }));
  const out = { course, chapters };
  if (req.user.role === "student") {
    out.enrolled = !!one("SELECT id FROM enrollments WHERE student_id=? AND course_id=?", [req.user.id, course.id]);
    out.completed = all("SELECT p.topic_id FROM progress p JOIN topics t ON t.id=p.topic_id JOIN chapters c ON c.id=t.chapter_id WHERE p.student_id=? AND p.completed=1 AND c.course_id=?", [req.user.id, course.id]).map(x => x.topic_id);
  } else {
    out.stats = {
      students: one("SELECT COUNT(*) n FROM enrollments WHERE course_id=?", [course.id]).n,
      approved: one("SELECT COUNT(*) n FROM questions WHERE course_id=? AND approval_status='approved'", [course.id]).n,
      pending: one("SELECT COUNT(*) n FROM questions WHERE course_id=? AND approval_status='pending'", [course.id]).n,
      quizzes: one("SELECT COUNT(*) n FROM quizzes WHERE course_id=?", [course.id]).n,
    };
  }
  res.json(out);
});

r.post("/courses/:id/enroll", ...student, (req, res) => {
  const c = one("SELECT id FROM courses WHERE id=? AND published=1", [req.params.id]);
  if (!c) return res.status(404).json({ error: "Course not found." });
  runc("INSERT OR IGNORE INTO enrollments(student_id,course_id) VALUES(?,?)", [req.user.id, c.id]);
  res.json({ success: true });
});
r.delete("/courses/:id/enroll", ...student, (req, res) => { runc("DELETE FROM enrollments WHERE student_id=? AND course_id=?", [req.user.id, req.params.id]); res.json({ success: true }); });

/* ----------------------------------------------------------------- chapters & topics (teacher) */

const ownChapter = (id, uid) => one("SELECT ch.* FROM chapters ch JOIN courses c ON c.id=ch.course_id WHERE ch.id=? AND c.teacher_id=?", [id, uid]);
const ownTopic = (id, uid) => one("SELECT t.* , ch.course_id FROM topics t JOIN chapters ch ON ch.id=t.chapter_id JOIN courses c ON c.id=ch.course_id WHERE t.id=? AND c.teacher_id=?", [id, uid]);

function move(table, id, scopeCol, scopeVal, direction) {
  const rows = all(`SELECT id, position FROM ${table} WHERE ${scopeCol}=? ORDER BY position,id`, [scopeVal]);
  const i = rows.findIndex(x => x.id === id), j = direction === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= rows.length) return;
  const order = rows.map(x => x.id); [order[i], order[j]] = [order[j], order[i]];
  order.forEach((rid, idx) => runc(`UPDATE ${table} SET position=? WHERE id=?`, [idx + 1, rid]));
}

r.post("/chapters", ...teacher, (req, res) => {
  const { course_id, title } = req.body || {};
  if (!ownCourse(course_id, req.user.id)) return res.status(404).json({ error: "Course not found." });
  if (!String(title || "").trim()) return res.status(400).json({ error: "Chapter title is required." });
  const pos = (one("SELECT MAX(position) m FROM chapters WHERE course_id=?", [course_id]).m || 0) + 1;
  const id = run("INSERT INTO chapters(course_id,title,position) VALUES(?,?,?)", [course_id, String(title).trim(), pos]);
  res.json({ chapter: one("SELECT * FROM chapters WHERE id=?", [id]) });
});
r.patch("/chapters/:id", ...teacher, (req, res) => {
  const ch = ownChapter(req.params.id, req.user.id);
  if (!ch) return res.status(404).json({ error: "Chapter not found." });
  if (req.body?.title) runc("UPDATE chapters SET title=? WHERE id=?", [String(req.body.title).trim(), ch.id]);
  if (["up", "down"].includes(req.body?.move)) move("chapters", ch.id, "course_id", ch.course_id, req.body.move);
  res.json({ success: true });
});
r.delete("/chapters/:id", ...teacher, (req, res) => {
  const ch = ownChapter(req.params.id, req.user.id);
  if (!ch) return res.status(404).json({ error: "Chapter not found." });
  transaction(() => {
    runc("UPDATE questions SET chapter_id=NULL, topic_id=NULL WHERE chapter_id=?", [ch.id]);
    runc("UPDATE quizzes SET chapter_id=NULL WHERE chapter_id=?", [ch.id]);
    runc("DELETE FROM chapters WHERE id=?", [ch.id]);
  });
  res.json({ success: true });
});

r.post("/topics", ...teacher, (req, res) => {
  const { chapter_id, title, content } = req.body || {};
  if (!ownChapter(chapter_id, req.user.id)) return res.status(404).json({ error: "Chapter not found." });
  if (!String(title || "").trim()) return res.status(400).json({ error: "Topic title is required." });
  const pos = (one("SELECT MAX(position) m FROM topics WHERE chapter_id=?", [chapter_id]).m || 0) + 1;
  const id = run("INSERT INTO topics(chapter_id,title,content,position) VALUES(?,?,?,?)", [chapter_id, String(title).trim(), String(content || ""), pos]);
  res.json({ topic: one("SELECT * FROM topics WHERE id=?", [id]) });
});
r.patch("/topics/:id", ...teacher, (req, res) => {
  const t = ownTopic(req.params.id, req.user.id);
  if (!t) return res.status(404).json({ error: "Topic not found." });
  const b = req.body || {};
  runc("UPDATE topics SET title=?, content=? WHERE id=?", [String(b.title ?? t.title).trim() || t.title, b.content ?? t.content, t.id]);
  if (["up", "down"].includes(b.move)) move("topics", t.id, "chapter_id", t.chapter_id, b.move);
  res.json({ topic: one("SELECT * FROM topics WHERE id=?", [t.id]) });
});
r.delete("/topics/:id", ...teacher, (req, res) => {
  const t = ownTopic(req.params.id, req.user.id);
  if (!t) return res.status(404).json({ error: "Topic not found." });
  transaction(() => { runc("UPDATE questions SET topic_id=NULL WHERE topic_id=?", [t.id]); runc("DELETE FROM topics WHERE id=?", [t.id]); });
  res.json({ success: true });
});

// Turn an uploaded handout into topic notes.
r.post("/teacher/notes/import", ...teacher, upload.single("document"), wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Choose a document to import." });
  try {
    const ch = ownChapter(req.body.chapter_id, req.user.id);
    if (!ch) return res.status(404).json({ error: "Chapter not found." });
    const ext = path.extname(req.file.originalname).toLowerCase().slice(1);
    if (!verifyFileType(req.file.path, ext)) return res.status(400).json({ error: "The file content does not match its extension." });
    const { text } = await extractText(req.file);
    if (text.trim().length < 20) return res.status(422).json({ error: "No readable text was found. Scanned documents need the OCR processor." });
    const content = text.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
    const title = String(req.body.title || req.file.originalname.replace(/\.[^.]+$/, "")).slice(0, 120);
    const pos = (one("SELECT MAX(position) m FROM topics WHERE chapter_id=?", [ch.id]).m || 0) + 1;
    const id = run("INSERT INTO topics(chapter_id,title,content,position) VALUES(?,?,?,?)", [ch.id, title, content, pos]);
    res.json({ topic: one("SELECT * FROM topics WHERE id=?", [id]) });
  } finally { removeFile(req.file.path); }
}));

/* ----------------------------------------------------------------- progress & offline pack (students) */

r.post("/progress", ...student, (req, res) => {
  const { topic_id, completed, updated_at } = req.body || {};
  const out = applyProgress(req.user.id, [{ topic_id, completed: !!completed, updated_at }]);
  if (!out.applied && !out.skipped) return res.status(400).json({ error: "Could not save progress." });
  res.json({ success: true, ...out });
});

/** Everything a student needs to study one course with no connection. */
r.get("/courses/:id/pack", ...student, (req, res) => {
  const id = int(req.params.id);
  if (!enrolledCourseIds(req.user.id).includes(id)) return res.status(403).json({ error: "Enroll in this course to download it." });
  const course = one("SELECT id,title,description,category,level,offline_answers FROM courses WHERE id=?", [id]);
  const chapters = all("SELECT * FROM chapters WHERE course_id=? ORDER BY position,id", [id]).map(ch => ({ ...ch, topics: all("SELECT * FROM topics WHERE chapter_id=? ORDER BY position,id", [ch.id]) }));
  const questions = withOptions(all("SELECT * FROM questions WHERE course_id=? AND approval_status='approved' ORDER BY id", [id]));
  const poolIds = questions.map(q => q.id);
  const quizzes = all("SELECT * FROM quizzes WHERE course_id=? AND published=1 ORDER BY id", [id]).map(z => ({
    id: z.id, title: z.title, kind: z.kind, mode: z.mode, chapter_id: z.chapter_id, duration_min: z.duration_min, question_count: z.question_count,
    question_ids: z.kind === "random" ? poolIds : quizQuestionIds(z),
  }));
  const progress = Object.fromEntries(all("SELECT p.topic_id,p.completed,p.updated_at FROM progress p JOIN topics t ON t.id=p.topic_id JOIN chapters c ON c.id=t.chapter_id WHERE p.student_id=? AND c.course_id=?", [req.user.id, id])
    .map(p => [p.topic_id, { completed: !!p.completed, updated_at: new Date(p.updated_at.replace(" ", "T") + "Z").toISOString() }]));
  res.json({
    version: new Date().toISOString(), course: { ...course, offline_answers: !!course.offline_answers }, chapters,
    questions: questions.map(publicQuestion),
    answers: course.offline_answers ? Object.fromEntries(questions.map(q => [q.id, answerPayload(q)])) : null,
    quizzes, progress,
  });
});

export default r;
