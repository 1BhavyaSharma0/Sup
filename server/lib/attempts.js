import { all, one, run, transaction } from "../db.js";
import { gradeAnswer, correctAnswerText, percent } from "../../shared/grading.js";
import { withOptions } from "./questions.js";
import { quizQuestionIds } from "./quizgen.js";

export const enrolledCourseIds = studentId =>
  all("SELECT e.course_id id FROM enrollments e JOIN courses c ON c.id=e.course_id WHERE e.student_id=? AND c.published=1", [studentId]).map(r => r.id);

export function buildResult(attemptId) {
  const a = one("SELECT * FROM quiz_attempts WHERE id=?", [attemptId]);
  if (!a) return null;
  const rows = all("SELECT * FROM attempt_answers WHERE attempt_id=? ORDER BY id", [attemptId]);
  const qs = new Map(withOptions(all(`SELECT * FROM questions WHERE id IN (${rows.map(() => "?").join(",") || "NULL"})`, rows.map(r => r.question_id))).map(q => [q.id, q]));
  const reviewed = rows.map(r => {
    const q = qs.get(r.question_id);
    return {
      question_id: r.question_id, question_text: q?.question_text || "(question removed)", question_type: q?.question_type || "short_answer",
      your_answer: r.answer || "", correct: r.correct === null ? null : !!r.correct,
      correct_answer: q ? correctAnswerText(q) : "", explanation: q?.explanation || "",
      options: q ? q.options.map(o => ({ label: o.label, text: o.text })) : [],
    };
  });
  return {
    attempt_id: a.id, quiz_id: a.quiz_id, title: a.title, score: a.correct, total: a.total, percentage: a.score,
    long_count: a.long_count, duration_sec: a.duration_sec, offline: !!a.offline, created_at: a.created_at, reviewed,
  };
}

/**
 * Authoritative grading. Idempotent on (student, client_attempt_id) so an offline attempt
 * that is synced twice is stored once.
 */
export function gradeAndRecord({ user, quiz_id = null, course_id = null, title, question_ids = [], answers = {}, client_attempt_id = null, duration_sec = 0, offline = false }) {
  if (client_attempt_id) {
    const dup = one("SELECT id FROM quiz_attempts WHERE student_id=? AND client_attempt_id=?", [user.id, String(client_attempt_id)]);
    if (dup) return { ...buildResult(dup.id), duplicate: true };
  }
  const allowedCourses = new Set(enrolledCourseIds(user.id));
  let allowedIds = null;
  if (quiz_id) {
    const quiz = one("SELECT * FROM quizzes WHERE id=? AND published=1", [quiz_id]);
    if (!quiz || !allowedCourses.has(quiz.course_id)) throw Object.assign(new Error("This quiz is not available to you."), { status: 403 });
    course_id = quiz.course_id; title = title || quiz.title;
    allowedIds = quiz.kind === "random"
      ? new Set(all("SELECT id FROM questions WHERE course_id=? AND approval_status='approved'", [quiz.course_id]).map(r => r.id))
      : new Set(quizQuestionIds(quiz));
  }
  const ids = [...new Set((question_ids.length ? question_ids : Object.keys(answers)).map(Number).filter(Boolean))].slice(0, 100);
  const qs = withOptions(all(`SELECT * FROM questions WHERE approval_status='approved' AND id IN (${ids.map(() => "?").join(",") || "NULL"})`, ids))
    .filter(q => allowedCourses.has(q.course_id) && (!allowedIds || allowedIds.has(q.id)));
  if (!qs.length) throw Object.assign(new Error("None of these questions are available."), { status: 400 });

  let correct = 0, graded = 0, longCount = 0;
  const graded_rows = qs.map(q => {
    const given = answers[q.id] ?? answers[String(q.id)] ?? "";
    const ok = gradeAnswer(q, given);
    if (ok === null) longCount++; else { graded++; if (ok) correct++; }
    return { q, given: String(given), ok };
  });
  const pct = percent(correct, graded);
  const attemptId = transaction(() => {
    const id = run(
      `INSERT INTO quiz_attempts(student_id,course_id,quiz_id,title,score,correct,total,long_count,answers_json,client_attempt_id,duration_sec,offline)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
      [user.id, course_id || qs[0].course_id, quiz_id, title || "Practice session", pct, correct, graded, longCount, JSON.stringify(answers),
       client_attempt_id ? String(client_attempt_id) : null, Math.max(0, Math.min(86400, Number(duration_sec) || 0)), offline ? 1 : 0]);
    for (const r of graded_rows) run("INSERT INTO attempt_answers(attempt_id,question_id,answer,correct) VALUES(?,?,?,?)", [id, r.q.id, r.given.slice(0, 5000), r.ok === null ? null : r.ok ? 1 : 0]);
    return id;
  });
  return buildResult(attemptId);
}

export function applyProgress(userId, items) {
  const out = { applied: 0, skipped: 0 };
  const allowed = new Set(enrolledCourseIds(userId));
  transaction(() => {
    for (const p of items.slice(0, 500)) {
      const topic = one("SELECT t.id, c.course_id FROM topics t JOIN chapters c ON c.id=t.chapter_id WHERE t.id=?", [Number(p.topic_id)]);
      if (!topic || !allowed.has(topic.course_id)) { out.skipped++; continue; }
      const when = p.updated_at && !isNaN(Date.parse(p.updated_at)) ? new Date(p.updated_at) : new Date();
      const stamp = when.toISOString().slice(0, 19).replace("T", " ");
      const existing = one("SELECT id, updated_at FROM progress WHERE student_id=? AND topic_id=?", [userId, topic.id]);
      if (existing) {
        if (existing.updated_at && new Date(existing.updated_at.replace(" ", "T") + "Z") > when) { out.skipped++; continue; } // newer data wins
        run("UPDATE progress SET completed=?, updated_at=? WHERE id=?", [p.completed ? 1 : 0, stamp, existing.id]);
      } else run("INSERT INTO progress(student_id,topic_id,completed,updated_at) VALUES(?,?,?,?)", [userId, topic.id, p.completed ? 1 : 0, stamp]);
      out.applied++;
    }
  });
  return out;
}
