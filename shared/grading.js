// Shared by the server (authoritative grading) and the browser (offline provisional grading).
// Keep this file dependency-free.

export const QUESTION_TYPES = ["mcq", "true_false", "short_answer", "long_answer"];
export const TYPE_LABELS = { mcq: "MCQ", true_false: "True / False", short_answer: "Short answer", long_answer: "Long answer" };

export const norm = s =>
  String(s ?? "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s.]/gu, " ").replace(/\s+/g, " ").trim().replace(/\.+$/, "");

const TF = { t: "true", true: "true", yes: "true", "1": "true", f: "false", false: "false", no: "false", "0": "false" };
export const normTF = s => TF[norm(s)] || "";

export const optLabel = o => o.label ?? o.option_label ?? "";
export const optText = o => o.text ?? o.option_text ?? "";
export const optCorrect = o => !!(o.correct ?? o.is_correct);

const asNumber = s => {
  const t = String(s ?? "").trim().replace(/,/g, "");
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null;
};

/** true = correct, false = wrong, null = cannot be auto-graded (long answers / no key). */
export function gradeAnswer(q, answer) {
  const type = q.question_type;
  if (type === "long_answer") return null;
  const given = String(answer ?? "").trim();
  if (type === "mcq") {
    const correct = (q.options || []).filter(optCorrect);
    if (!correct.length) return null;
    if (!given) return false;
    return correct.some(o => norm(given) === norm(optLabel(o)) || norm(given) === norm(optText(o)));
  }
  if (type === "true_false") {
    const expected = normTF(q.answer_text);
    if (!expected) return null;
    return normTF(given) === expected;
  }
  const alts = String(q.answer_text || "").split(/\s*(?:\|\||;;|\|)\s*/).map(s => s.trim()).filter(Boolean);
  if (!alts.length) return null;
  if (!given) return false;
  return alts.some(a => {
    const na = asNumber(a), ng = asNumber(given);
    return na !== null && ng !== null ? na === ng : norm(a) === norm(given);
  });
}

/** Human-readable correct answer for review screens. */
export function correctAnswerText(q) {
  if (q.question_type === "mcq") {
    const o = (q.options || []).find(optCorrect);
    return o ? `${optLabel(o)}. ${optText(o)}` : (q.answer_text || "");
  }
  return q.answer_text || "";
}

/** A question can only be published to students when it has what grading needs. */
export function answerProblem(q) {
  if (String(q.question_text || "").trim().length < 5) return "Question text is too short.";
  const opts = (q.options || []).filter(o => optText(o).trim());
  if (q.question_type === "mcq") {
    if (opts.length < 2) return "Add at least two options.";
    if (!opts.some(optCorrect)) return "Mark the correct option.";
  } else if (q.question_type === "true_false") {
    if (!normTF(q.answer_text)) return "Choose True or False as the answer.";
  } else if (q.question_type === "short_answer") {
    if (!String(q.answer_text || "").trim()) return "Add the expected answer.";
  }
  return null;
}

/** AI-suggested answers must be confirmed by the teacher before students can see the question. */
export const needsVerification = q => q.answer_source === "ai_suggested" && !q.answer_verified;

export function importStatus(q) {
  const problem = answerProblem(q);
  if (problem) return { status: "pending", reason: problem };
  if (needsVerification(q)) return { status: "pending", reason: "AI-suggested answer is not verified yet." };
  return { status: "approved", reason: null };
}

export const percent = (score, total) => (total ? Math.round((score / total) * 100) : 0);
