import { Router } from "express";
import { all, one, run, transaction } from "../db.js";
import { auth, allow, ownCourse } from "../lib/auth.js";
import { wrap, int, rateLimit } from "../lib/util.js";
import { enrolledCourseIds } from "../lib/attempts.js";
import { courseProgress } from "./content.js";
import { askAI, generateQuestions, aiStatus } from "../lib/ai.js";
import { cleanQuestionInput, insertQuestion } from "../lib/questions.js";

const r = Router();
const teacher = [auth, allow("teacher")];
const student = [auth, allow("student")];
const day = s => String(s).slice(0, 10);

function streakFor(studentId) {
  const days = new Set([
    ...all("SELECT created_at d FROM quiz_attempts WHERE student_id=?", [studentId]).map(x => day(x.d)),
    ...all("SELECT updated_at d FROM progress WHERE student_id=? AND completed=1", [studentId]).map(x => day(x.d)),
  ]);
  let n = 0; const d = new Date();
  if (!days.has(d.toISOString().slice(0, 10))) d.setUTCDate(d.getUTCDate() - 1);   // today may not be done yet
  while (days.has(d.toISOString().slice(0, 10))) { n++; d.setUTCDate(d.getUTCDate() - 1); }
  return n;
}

r.get("/health", (_, res) => res.json({ status: "ok", app: "LearnSphere AI", ai: aiStatus(), processor: !!process.env.PROCESSOR_URL }));

r.get("/dashboard", auth, (req, res) => {
  if (req.user.role === "teacher") {
    const uid = req.user.id;
    return res.json({
      role: "teacher",
      courses: all("SELECT c.*, (SELECT COUNT(*) FROM enrollments e WHERE e.course_id=c.id) student_count, (SELECT COUNT(*) FROM questions q WHERE q.course_id=c.id AND q.approval_status='approved') question_count FROM courses c WHERE teacher_id=? ORDER BY id DESC", [uid]),
      documents: all("SELECT id,file_name,status,question_count,created_at FROM documents WHERE teacher_id=? ORDER BY id DESC LIMIT 5", [uid]),
      pending: one("SELECT COUNT(*) n FROM questions WHERE created_by=? AND approval_status='pending'", [uid]).n,
      approved: one("SELECT COUNT(*) n FROM questions WHERE created_by=? AND approval_status='approved'", [uid]).n,
      students: one("SELECT COUNT(DISTINCT e.student_id) n FROM enrollments e JOIN courses c ON c.id=e.course_id WHERE c.teacher_id=?", [uid]).n,
      quizzes: one("SELECT COUNT(*) n FROM quizzes z JOIN courses c ON c.id=z.course_id WHERE c.teacher_id=?", [uid]).n,
      activity: all(`SELECT a.id, a.title, a.score, a.created_at, u.name student_name FROM quiz_attempts a JOIN users u ON u.id=a.student_id JOIN courses c ON c.id=a.course_id
                     WHERE c.teacher_id=? ORDER BY a.id DESC LIMIT 6`, [uid]),
    });
  }
  const ids = enrolledCourseIds(req.user.id);
  const prog = courseProgress(req.user.id, ids);
  const courses = ids.length ? all(`SELECT * FROM courses WHERE id IN (${ids.map(() => "?").join(",")}) ORDER BY id DESC`, ids).map(c => ({ ...c, progress: prog.get(c.id)?.percent || 0 })) : [];
  const nextQuiz = ids.length ? one(`SELECT z.id, z.title, c.title course_title, z.question_count,
      (SELECT COUNT(*) FROM quiz_attempts a WHERE a.quiz_id=z.id AND a.student_id=?) attempts
      FROM quizzes z JOIN courses c ON c.id=z.course_id WHERE z.published=1 AND z.course_id IN (${ids.map(() => "?").join(",")})
      ORDER BY attempts ASC, z.id ASC LIMIT 1`, [req.user.id, ...ids]) : null;
  res.json({
    role: "student", courses, next_quiz: nextQuiz, streak: streakFor(req.user.id),
    attempts: all("SELECT id,title,score,correct,total,created_at FROM quiz_attempts WHERE student_id=? ORDER BY id DESC LIMIT 5", [req.user.id]),
    stats: one("SELECT COUNT(*) attempts, COALESCE(AVG(score),0) avg_score FROM quiz_attempts WHERE student_id=?", [req.user.id]),
    completed: one("SELECT COUNT(*) n FROM progress WHERE student_id=? AND completed=1", [req.user.id]).n,
  });
});

r.get("/stats/student", ...student, (req, res) => {
  const uid = req.user.id;
  const ids = enrolledCourseIds(uid), prog = courseProgress(uid, ids);
  const totals = one("SELECT COUNT(*) attempts, COALESCE(ROUND(AVG(score)),0) avg_score, COALESCE(MAX(score),0) best_score, COALESCE(SUM(duration_sec),0) seconds FROM quiz_attempts WHERE student_id=?", [uid]);
  res.json({
    totals: { ...totals, minutes: Math.round(totals.seconds / 60), topics_done: one("SELECT COUNT(*) n FROM progress WHERE student_id=? AND completed=1", [uid]).n },
    streak: streakFor(uid),
    history: all("SELECT id,title,score,created_at FROM quiz_attempts WHERE student_id=? ORDER BY id DESC LIMIT 20", [uid]).reverse(),
    per_course: ids.length ? all(`SELECT c.id, c.title, (SELECT COUNT(*) FROM quiz_attempts a WHERE a.student_id=? AND a.course_id=c.id) attempts,
        (SELECT ROUND(AVG(a.score)) FROM quiz_attempts a WHERE a.student_id=? AND a.course_id=c.id) avg_score FROM courses c WHERE c.id IN (${ids.map(() => "?").join(",")})`, [uid, uid, ...ids]).map(c => ({ ...c, progress: prog.get(c.id)?.percent || 0 })) : [],
    weak_areas: all(`SELECT COALESCE(ch.title,'Unassigned') title, COUNT(*) answered, SUM(CASE WHEN aa.correct=1 THEN 1 ELSE 0 END) hits
        FROM attempt_answers aa JOIN quiz_attempts a ON a.id=aa.attempt_id JOIN questions q ON q.id=aa.question_id LEFT JOIN chapters ch ON ch.id=q.chapter_id
        WHERE a.student_id=? AND aa.correct IS NOT NULL GROUP BY ch.id HAVING COUNT(*)>=3 ORDER BY (1.0*SUM(CASE WHEN aa.correct=1 THEN 1 ELSE 0 END)/COUNT(*)) ASC LIMIT 5`, [uid])
      .map(w => ({ title: w.title, answered: w.answered, accuracy: Math.round((w.hits / w.answered) * 100) })),
  });
});

r.get("/teacher/performance", ...teacher, (req, res) => {
  const uid = req.user.id;
  let ids = all("SELECT id FROM courses WHERE teacher_id=?", [uid]).map(c => c.id);
  if (req.query.course_id) { if (!ownCourse(req.query.course_id, uid)) return res.status(404).json({ error: "Course not found." }); ids = [int(req.query.course_id)]; }
  if (!ids.length) return res.json({ empty: true });
  const IN = ids.map(() => "?").join(",");
  const enrolled = all(`SELECT DISTINCT u.id, u.name, u.email FROM enrollments e JOIN users u ON u.id=e.student_id WHERE e.course_id IN (${IN})`, ids);
  const totalTopics = one(`SELECT COUNT(*) n FROM topics t JOIN chapters c ON c.id=t.chapter_id WHERE c.course_id IN (${IN})`, ids).n;
  const students = enrolled.map(s => {
    const a = one(`SELECT COUNT(*) attempts, ROUND(AVG(score)) avg_score, MAX(created_at) last_active FROM quiz_attempts WHERE student_id=? AND course_id IN (${IN})`, [s.id, ...ids]);
    const done = one(`SELECT COUNT(*) n FROM progress p JOIN topics t ON t.id=p.topic_id JOIN chapters c ON c.id=t.chapter_id WHERE p.student_id=? AND p.completed=1 AND c.course_id IN (${IN})`, [s.id, ...ids]).n;
    return { ...s, ...a, topics_done: done, topics_total: totalTopics, completion: totalTopics ? Math.round((done / totalTopics) * 100) : 0 };
  }).sort((x, y) => (y.last_active || "").localeCompare(x.last_active || ""));
  const sum = one(`SELECT COUNT(*) attempts, COALESCE(ROUND(AVG(score)),0) avg_score FROM quiz_attempts WHERE course_id IN (${IN})`, ids);
  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 19).replace("T", " ");
  const bucket = (lo, hi) => one(`SELECT COUNT(*) n FROM quiz_attempts WHERE course_id IN (${IN}) AND score>=? AND score<=?`, [...ids, lo, hi]).n;
  res.json({
    summary: { students: enrolled.length, attempts: sum.attempts, avg_score: sum.avg_score,
      active_week: new Set(all(`SELECT DISTINCT student_id FROM quiz_attempts WHERE course_id IN (${IN}) AND created_at>=?`, [...ids, weekAgo]).map(x => x.student_id)).size,
      avg_completion: students.length ? Math.round(students.reduce((t, s) => t + s.completion, 0) / students.length) : 0 },
    distribution: [["0–39%", bucket(0, 39)], ["40–59%", bucket(40, 59)], ["60–79%", bucket(60, 79)], ["80–100%", bucket(80, 100)]].map(([label, count]) => ({ label, count })),
    quizzes: all(`SELECT z.id, z.title, c.title course_title, COUNT(a.id) attempts, ROUND(AVG(a.score)) avg_score, COUNT(DISTINCT a.student_id) students
        FROM quizzes z JOIN courses c ON c.id=z.course_id LEFT JOIN quiz_attempts a ON a.quiz_id=z.id WHERE z.course_id IN (${IN}) GROUP BY z.id ORDER BY z.course_id, z.id`, ids),
    chapters: all(`SELECT COALESCE(ch.title,'Unassigned') title, COUNT(*) answered, ROUND(100.0*SUM(CASE WHEN aa.correct=1 THEN 1 ELSE 0 END)/COUNT(*)) accuracy
        FROM attempt_answers aa JOIN questions q ON q.id=aa.question_id LEFT JOIN chapters ch ON ch.id=q.chapter_id
        WHERE aa.correct IS NOT NULL AND q.course_id IN (${IN}) GROUP BY ch.id ORDER BY accuracy ASC`, ids),
    hardest: all(`SELECT q.id, q.question_text, COUNT(*) answered, ROUND(100.0*SUM(CASE WHEN aa.correct=1 THEN 1 ELSE 0 END)/COUNT(*)) accuracy
        FROM attempt_answers aa JOIN questions q ON q.id=aa.question_id WHERE aa.correct IS NOT NULL AND q.course_id IN (${IN})
        GROUP BY q.id HAVING COUNT(*)>=2 ORDER BY accuracy ASC, answered DESC LIMIT 8`, ids),
    students,
  });
});

/* ----------------------------------------------------------------- AI */

const aiLimiter = rateLimit({ windowMs: 60_000, max: 20, message: "You're asking quickly. Give it a few seconds." });

r.post("/ai/ask", auth, aiLimiter, wrap(async (req, res) => {
  const { prompt, topic_id, course_id } = req.body || {};
  if (!String(prompt || "").trim()) return res.status(400).json({ error: "Write a question first." });
  const readable = cid => req.user.role === "teacher" ? !!ownCourse(cid, req.user.id) : enrolledCourseIds(req.user.id).includes(cid);
  let context = "";
  if (topic_id) {
    const t = one("SELECT t.title,t.content,c.course_id FROM topics t JOIN chapters c ON c.id=t.chapter_id WHERE t.id=?", [int(topic_id)]);
    if (t && readable(t.course_id)) context = `${t.title}\n${t.content}`;
  } else if (course_id && readable(int(course_id))) {
    context = all("SELECT t.title,t.content FROM topics t JOIN chapters c ON c.id=t.chapter_id WHERE c.course_id=? ORDER BY c.position,t.position", [int(course_id)]).map(t => `## ${t.title}\n${t.content}`).join("\n\n");
  }
  res.json({ ...(await askAI({ prompt: String(prompt).slice(0, 2000), context })), grounded: !!context });
}));

r.post("/teacher/ai/generate-questions", ...teacher, aiLimiter, wrap(async (req, res) => {
  const t = one("SELECT t.*, c.course_id FROM topics t JOIN chapters c ON c.id=t.chapter_id JOIN courses co ON co.id=c.course_id WHERE t.id=? AND co.teacher_id=?", [int(req.body?.topic_id), req.user.id]);
  if (!t) return res.status(404).json({ error: "Topic not found." });
  const out = await generateQuestions({ title: t.title, content: t.content || "", count: Math.min(10, int(req.body?.count, 5)) });
  if (!out.configured) return res.status(503).json({ error: "No AI provider is configured on the server, so questions were not generated." });
  let added = 0;
  transaction(() => {
    for (const g of out.questions) {
      const type = ["mcq", "true_false", "short_answer"].includes(g.question_type) ? g.question_type : "short_answer";
      const options = type === "mcq" ? (g.options || []).slice(0, 5).map((text, i) => ({ label: String.fromCharCode(65 + i), text: String(text), correct: String(g.answer || "").trim().toUpperCase().startsWith(String.fromCharCode(65 + i)) })) : [];
      const q = cleanQuestionInput({ question_text: g.question_text, question_type: type, options, answer_text: type === "mcq" ? "" : String(g.answer || ""), explanation: g.explanation, answer_source: "ai_suggested", answer_verified: false });
      if (q.question_text.length < 5) continue;
      insertQuestion(q, { course_id: t.course_id, chapter_id: t.chapter_id, topic_id: t.id, user_id: req.user.id, status: "pending" });
      added++;
    }
  });
  res.json({ added, notice: "Draft questions were added to your bank as PENDING. Review and verify each answer before approving." });
}));

export default r;
