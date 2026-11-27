import { Router } from "express";
import path from "path";
import { all, one, run, runc, transaction } from "../db.js";
import { auth, allow } from "../lib/auth.js";
import { wrap, rateLimit, int } from "../lib/util.js";
import { upload, removeFile } from "../lib/upload.js";
import { extractText, detectQuestions, verifyFileType } from "../lib/extract.js";
import { markDuplicates, suggestChapters } from "../lib/similarity.js";
import { suggestAnswers } from "../lib/ai.js";
import { cleanQuestionInput, insertQuestion } from "../lib/questions.js";
import { generateAutoQuizzes } from "../lib/quizgen.js";
import { importStatus } from "../../shared/grading.js";
import { scopeError } from "./questions.js";

const r = Router();
const teacher = [auth, allow("teacher")];
const limiter = rateLimit({ windowMs: 60_000, max: 15, message: "Too many uploads. Please wait a minute." });

function chaptersWithNotes(courseId) {
  return all("SELECT id,title FROM chapters WHERE course_id=? ORDER BY position,id", [courseId]).map(ch => ({ ...ch, topics: all("SELECT title,content FROM topics WHERE chapter_id=?", [ch.id]) }));
}
const existingQuestions = uid => all("SELECT id,question_text FROM questions WHERE created_by=? ORDER BY id DESC LIMIT 5000", [uid]);

function analyze(uid, drafts, course_id) {
  let out = markDuplicates(drafts, existingQuestions(uid));
  if (course_id) out = suggestChapters(out, chaptersWithNotes(course_id));
  return out;
}

/** One or many files -> merged list of draft questions. Nothing is published here. */
r.post("/teacher/documents", ...teacher, limiter, upload.array("documents", 10), wrap(async (req, res) => {
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: "Choose at least one document to upload." });
  const course_id = req.body.course_id ? int(req.body.course_id) : null;
  if (course_id && scopeError(req.user.id, course_id)) return res.status(400).json({ error: "That course is not yours." });

  const documents = [], errors = [];
  let drafts = [];
  for (const file of files) {
    try {
      const ext = path.extname(file.originalname).toLowerCase().slice(1);
      if (!verifyFileType(file.path, ext)) throw new Error("The file content does not match its extension.");
      const { text, ocr_used, scanned, method } = await extractText(file);
      const found = detectQuestions(text);
      const id = run("INSERT INTO documents(teacher_id,file_name,stored_name,extracted_text,status,course_id,ocr_used) VALUES(?,?,?,?,?,?,?)",
        [req.user.id, file.originalname, file.filename, text.slice(0, 500_000), found.length ? "review" : "no_questions", course_id, ocr_used ? 1 : 0]);
      let warning = null;
      if (!found.length) warning = scanned && !ocr_used ? "This looks like a scanned PDF. Start the Python processor with Tesseract to read scanned pages." : "No numbered questions were detected in this file.";
      documents.push({ id, file_name: file.originalname, question_count: found.length, ocr_used, method, warning });
      drafts.push(...found.map(q => ({ ...q, document_id: id, source_file: file.originalname })));
    } catch (e) { errors.push({ file_name: file.originalname, error: e.message || "Could not process this document." }); }
    finally { removeFile(file.path); }   // only the extracted text is kept, never the original file
  }
  drafts = analyze(req.user.id, drafts.map((q, i) => ({ ...q, temp_id: i })), course_id);
  transaction(() => {
    for (const d of documents) {
      const mine = drafts.filter(q => q.document_id === d.id);
      runc("UPDATE documents SET question_count=?, draft_json=? WHERE id=?", [mine.length, mine.length ? JSON.stringify(mine) : null, d.id]);
    }
  });
  res.json({ documents, errors, questions: drafts });
}));

r.get("/teacher/documents", ...teacher, (req, res) => {
  res.json({ documents: all("SELECT id,file_name,status,question_count,ocr_used,course_id,created_at,(draft_json IS NOT NULL) has_draft FROM documents WHERE teacher_id=? ORDER BY id DESC LIMIT 100", [req.user.id]) });
});

r.get("/teacher/documents/:id", ...teacher, (req, res) => {
  const d = one("SELECT * FROM documents WHERE id=? AND teacher_id=?", [req.params.id, req.user.id]);
  if (!d) return res.status(404).json({ error: "Document not found." });
  let questions = []; try { questions = d.draft_json ? JSON.parse(d.draft_json) : []; } catch {}
  res.json({ document: { id: d.id, file_name: d.file_name, status: d.status, course_id: d.course_id }, questions: markDuplicates(questions, existingQuestions(req.user.id).filter(e => e.id)) });
});

r.delete("/teacher/documents/:id", ...teacher, (req, res) => {
  const d = one("SELECT * FROM documents WHERE id=? AND teacher_id=?", [req.params.id, req.user.id]);
  if (!d) return res.status(404).json({ error: "Document not found." });
  runc("DELETE FROM documents WHERE id=?", [d.id]);
  res.json({ success: true });
});

// Save the review in progress so it survives a page refresh.
r.put("/teacher/drafts", ...teacher, (req, res) => {
  const drafts = Array.isArray(req.body?.questions) ? req.body.questions : [];
  const byDoc = new Map();
  for (const q of drafts) if (q.document_id) byDoc.set(q.document_id, [...(byDoc.get(q.document_id) || []), q]);
  transaction(() => { for (const [id, list] of byDoc) runc("UPDATE documents SET draft_json=?, question_count=? WHERE id=? AND teacher_id=? AND status<>'imported'", [JSON.stringify(list), list.length, id, req.user.id]); });
  res.json({ saved: drafts.length });
});

r.post("/teacher/drafts/analyze", ...teacher, (req, res) => {
  const course_id = req.body?.course_id ? int(req.body.course_id) : null;
  if (course_id && scopeError(req.user.id, course_id)) return res.status(400).json({ error: "That course is not yours." });
  res.json({ questions: analyze(req.user.id, (req.body?.questions || []).slice(0, 1000), course_id) });
});

r.post("/teacher/ai/suggest-answers", ...teacher, limiter, wrap(async (req, res) => {
  const qs = (req.body?.questions || []).slice(0, 25);
  const out = await suggestAnswers(qs);
  if (!out.configured) return res.status(503).json({ error: "No AI provider is configured on the server (AI_BASE_URL, AI_API_KEY, AI_MODEL). Answers were not generated." });
  res.json(out);
}));

/** Approve & save. Anything that is not fully ready for students is saved as "pending". */
r.post("/teacher/import", ...teacher, (req, res) => {
  const b = req.body || {};
  const course_id = int(b.course_id);
  if (!course_id) return res.status(400).json({ error: "Choose the course these questions belong to." });
  const err = scopeError(req.user.id, course_id, b.chapter_id);
  if (err) return res.status(400).json({ error: err });
  const validChapters = new Set(all("SELECT id FROM chapters WHERE course_id=?", [course_id]).map(c => c.id));
  const result = { imported: 0, pending: 0, skipped: 0, pending_reasons: [], quizzes: [], notes: [] };

  transaction(() => {
    for (const raw of (b.questions || []).slice(0, 2000)) {
      const q = cleanQuestionInput(raw);
      if (q.question_text.length < 5) { result.skipped++; continue; }
      const chapter_id = validChapters.has(Number(raw.chapter_id ?? b.chapter_id)) ? Number(raw.chapter_id ?? b.chapter_id) : null;
      const { status, reason } = importStatus(q);
      insertQuestion(q, { course_id, chapter_id, user_id: req.user.id, status, source_document: raw.source_file || null });
      if (status === "approved") result.imported++; else { result.pending++; if (result.pending_reasons.length < 20) result.pending_reasons.push(`${q.question_text.slice(0, 70)}… — ${reason}`); }
    }
    const docIds = (b.document_ids || []).map(Number).filter(Boolean);
    if (docIds.length) runc(`UPDATE documents SET status='imported', draft_json=NULL, course_id=? WHERE teacher_id=? AND id IN (${docIds.map(() => "?").join(",")})`, [course_id, req.user.id, ...docIds]);
  });

  if (b.auto_quizzes?.enabled && result.imported) {
    const gen = generateAutoQuizzes({ course_id, user_id: req.user.id, config: b.auto_quizzes.config || {}, publish: b.auto_quizzes.publish !== false });
    result.quizzes = gen.quizzes; result.notes = gen.notes;
  }
  res.json({ success: true, ...result });
});

export default r;
