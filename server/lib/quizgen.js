import { all, one, run, runc, transaction } from "../db.js";
import { sample, shuffle } from "./util.js";

export const DEFAULT_QUIZ_CONFIG = { quick: 10, chapter: 20, full: 50, random: 15 };

function stratified(byChapter, n) {
  const lists = [...byChapter.values()].map(shuffle);
  const out = [];
  while (out.length < n && lists.some(l => l.length)) for (const l of lists) if (l.length && out.length < n) out.push(l.shift());
  return out;
}

function upsertQuiz({ course_id, chapter_id = null, kind, title, mode, count, ids, publish, user_id, duration }) {
  const existing = one("SELECT id FROM quizzes WHERE course_id=? AND kind=? AND auto=1 AND COALESCE(chapter_id,0)=COALESCE(?,0)", [course_id, kind, chapter_id]);
  let id;
  if (existing) {
    id = existing.id;
    runc("UPDATE quizzes SET title=?,mode=?,question_count=?,duration_min=?,published=?,updated_at=CURRENT_TIMESTAMP WHERE id=?", [title, mode, count, duration, publish ? 1 : 0, id]);
    runc("DELETE FROM quiz_questions WHERE quiz_id=?", [id]);
  } else {
    id = run("INSERT INTO quizzes(course_id,chapter_id,title,kind,mode,question_count,duration_min,published,auto,created_by) VALUES(?,?,?,?,?,?,?,?,1,?)",
      [course_id, chapter_id, title, kind, mode, count, duration, publish ? 1 : 0, user_id]);
  }
  ids.forEach((qid, i) => run("INSERT INTO quiz_questions(quiz_id,question_id,position) VALUES(?,?,?)", [id, qid, i]));
  return id;
}

/**
 * Creates/refreshes the four preset quizzes for a course from its APPROVED questions.
 * Quick Practice and Random Practice are untimed; Chapter Test and Full Assessment are timed.
 */
export function generateAutoQuizzes({ course_id, user_id, config = {}, publish = true }) {
  const cfg = { ...DEFAULT_QUIZ_CONFIG, ...Object.fromEntries(Object.entries(config).map(([k, v]) => [k, Math.max(0, parseInt(v, 10) || 0)])) };
  const pool = all("SELECT id,chapter_id FROM questions WHERE course_id=? AND approval_status='approved'", [course_id]);
  const chapters = all("SELECT id,title FROM chapters WHERE course_id=? ORDER BY position,id", [course_id]);
  const created = [], notes = [];
  if (!pool.length) return { quizzes: [], notes: ["No approved questions yet, so no quizzes were created."] };
  const minutes = n => Math.max(5, Math.ceil(n * 1.5));

  transaction(() => {
    const add = (opts, wanted) => {
      const count = opts.ids.length;
      if (count < wanted) notes.push(`${opts.title}: only ${count} approved question${count === 1 ? "" : "s"} available (wanted ${wanted}).`);
      created.push(upsertQuiz({ course_id, user_id, publish, count, ...opts }));
    };
    if (cfg.quick) add({ kind: "quick", title: "Quick Practice", mode: "practice", duration: 0, ids: sample(pool, cfg.quick).map(q => q.id) }, cfg.quick);
    if (cfg.chapter) for (const ch of chapters) {
      const inCh = pool.filter(q => q.chapter_id === ch.id);
      if (inCh.length < 3) { if (inCh.length) notes.push(`Chapter "${ch.title}" has only ${inCh.length} question(s); chapter test skipped.`); continue; }
      const ids = sample(inCh, cfg.chapter).map(q => q.id);
      add({ kind: "chapter", chapter_id: ch.id, title: `Chapter Test: ${ch.title}`, mode: "assessment", duration: minutes(ids.length), ids }, cfg.chapter);
    }
    if (cfg.full) {
      const by = new Map(chapters.map(c => [c.id, []])); by.set(null, []);
      for (const q of pool) (by.get(q.chapter_id) || by.get(null)).push(q.id);
      const ids = stratified(new Map([...by].filter(([, v]) => v.length)), cfg.full);
      add({ kind: "full", title: "Full Assessment", mode: "assessment", duration: minutes(ids.length), ids }, cfg.full);
    }
    if (cfg.random) add({ kind: "random", title: "Random Practice", mode: "practice", duration: 0, ids: sample(pool, cfg.random).map(q => q.id) }, cfg.random);
  });
  return { quizzes: created, notes };
}

/** Random Practice is re-drawn on every play; every other quiz uses its stored question list. */
export function quizQuestionIds(quiz) {
  if (quiz.kind === "random") {
    const pool = all("SELECT id FROM questions WHERE course_id=? AND approval_status='approved'", [quiz.course_id]).map(r => r.id);
    return sample(pool, quiz.question_count);
  }
  return all(
    `SELECT qq.question_id id FROM quiz_questions qq JOIN questions q ON q.id=qq.question_id
     WHERE qq.quiz_id=? AND q.approval_status='approved' ORDER BY qq.position`, [quiz.id]).map(r => r.id);
}
