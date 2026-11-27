import { all, one, run, runc } from "../db.js";
import { answerProblem, needsVerification, optCorrect, QUESTION_TYPES } from "../../shared/grading.js";

export const mapOption = o => ({ id: o.id, label: o.option_label, text: o.option_text, correct: !!o.is_correct });

export function loadOptions(questionIds) {
  if (!questionIds.length) return new Map();
  const rows = all(`SELECT * FROM options WHERE question_id IN (${questionIds.map(() => "?").join(",")}) ORDER BY id`, questionIds);
  const map = new Map();
  for (const r of rows) { if (!map.has(r.question_id)) map.set(r.question_id, []); map.get(r.question_id).push(mapOption(r)); }
  return map;
}

export function withOptions(rows) {
  const opts = loadOptions(rows.map(r => r.id));
  return rows.map(r => ({ ...r, answer_verified: !!r.answer_verified, options: opts.get(r.id) || [] }));
}

/** What a student may see before answering: no answers, no explanation. */
export const publicQuestion = q => ({
  id: q.id, course_id: q.course_id, chapter_id: q.chapter_id, question_text: q.question_text, question_type: q.question_type,
  difficulty: q.difficulty, marks: q.marks || 1, options: (q.options || []).map(o => ({ id: o.id, label: o.label, text: o.text })),
});

export const answerPayload = q => ({
  question_id: q.id, answer_text: q.answer_text || "", explanation: q.explanation || "",
  correct_labels: (q.options || []).filter(optCorrect).map(o => o.label),
});

export function cleanQuestionInput(b, base = {}) {
  const type = QUESTION_TYPES.includes(b.question_type) ? b.question_type : (base.question_type || "mcq");
  const options = type === "mcq" ? (b.options ?? base.options ?? []).filter(o => String(o.text ?? "").trim()).map((o, i) => ({
    label: String(o.label || String.fromCharCode(65 + i)).slice(0, 2).toUpperCase(), text: String(o.text).trim(), correct: !!o.correct,
  })) : [];
  let answer_text = String(b.answer_text ?? base.answer_text ?? "").trim();
  if (type === "mcq") answer_text = options.find(o => o.correct)?.label || "";
  if (type === "true_false") answer_text = /^t/i.test(answer_text) ? "True" : /^f/i.test(answer_text) ? "False" : "";
  const diff = ["Easy", "Medium", "Hard"].includes(b.difficulty) ? b.difficulty : (base.difficulty || "Medium");
  return {
    question_text: String(b.question_text ?? base.question_text ?? "").replace(/\s+/g, " ").trim(),
    question_type: type, difficulty: diff, options, answer_text,
    answer_source: b.answer_source ?? base.answer_source ?? "teacher",
    answer_verified: b.answer_verified ?? base.answer_verified ?? true,
    explanation: String(b.explanation ?? base.explanation ?? "").trim(),
    marks: Math.min(20, Math.max(1, parseInt(b.marks ?? base.marks ?? 1, 10) || 1)),
  };
}

export function insertQuestion(q, { course_id, chapter_id, topic_id = null, user_id, status, source_document = null }) {
  const id = run(
    `INSERT INTO questions(course_id,chapter_id,topic_id,question_text,question_type,difficulty,answer_text,answer_source,answer_verified,explanation,marks,source_document,approval_status,created_by,updated_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`,
    [course_id || null, chapter_id || null, topic_id, q.question_text, q.question_type, q.difficulty, q.answer_text, q.answer_source,
     q.answer_verified ? 1 : 0, q.explanation, q.marks, source_document, status, user_id]);
  q.options.forEach((o, i) => run("INSERT INTO options(question_id,option_label,option_text,is_correct) VALUES(?,?,?,?)", [id, o.label || String.fromCharCode(65 + i), o.text, o.correct ? 1 : 0]));
  return id;
}

export function replaceOptions(id, options) {
  runc("DELETE FROM options WHERE question_id=?", [id]);
  options.forEach((o, i) => run("INSERT INTO options(question_id,option_label,option_text,is_correct) VALUES(?,?,?,?)", [id, o.label || String.fromCharCode(65 + i), o.text, o.correct ? 1 : 0]));
}

export const problemFor = q => answerProblem(q) || (needsVerification(q) ? "AI-suggested answer is not verified yet." : null);
export const approvedPool = (course_id, chapter_id) => withOptions(all(
  `SELECT * FROM questions WHERE approval_status='approved' AND course_id=? ${chapter_id ? "AND chapter_id=?" : ""} ORDER BY id`, chapter_id ? [course_id, chapter_id] : [course_id]));
export const ownQuestion = (id, userId) => one("SELECT * FROM questions WHERE id=? AND created_by=?", [id, userId]);
