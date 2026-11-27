import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Copy, FileText, LoaderCircle, Save, Sparkles, Trash2, UploadCloud, X, ShieldCheck, Layers } from "lucide-react";
import { useAuth } from "../context";
import { PageHeading, Pill, Notice, Pager, Empty, typeLabel } from "../ui";
import QuestionEditor from "../components/QuestionEditor";
import { answerProblem, importStatus, needsVerification } from "../../shared/grading.js";

const PAGE = 10;
const fileSize = b => b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;

export default function Upload() {
  const { request } = useAuth();
  const [sp] = useSearchParams();
  const [courses, setCourses] = useState([]), [chapters, setChapters] = useState([]);
  const [courseId, setCourseId] = useState(""), [files, setFiles] = useState([]);
  const [drafts, setDrafts] = useState(null), [docs, setDocs] = useState([]), [fileErrors, setFileErrors] = useState([]);
  const [busy, setBusy] = useState(""), [error, setError] = useState(""), [info, setInfo] = useState("");
  const [filter, setFilter] = useState("all"), [page, setPage] = useState(1);
  const [auto, setAuto] = useState({ enabled: true, publish: true, config: { quick: 10, chapter: 20, full: 50, random: 15 } });
  const [result, setResult] = useState(null);
  const inputRef = useRef();

  useEffect(() => { request("/api/courses").then(d => { setCourses(d.courses); if (!courseId && d.courses.length === 1 && !sp.get("doc")) setCourseId(String(d.courses[0].id)); }).catch(e => setError(e.message)); request("/api/settings").then(s => s.quiz_defaults && setAuto(a => ({ ...a, config: s.quiz_defaults, publish: s.auto_publish }))).catch(() => {}); }, []); // eslint-disable-line
  useEffect(() => { if (!courseId) return setChapters([]); request(`/api/courses/${courseId}`).then(d => setChapters(d.chapters)).catch(() => setChapters([])); }, [courseId]); // eslint-disable-line
  useEffect(() => { // resume a saved review
    const id = sp.get("doc"); if (!id) return;
    request(`/api/teacher/documents/${id}`).then(d => { setDocs([{ id: d.document.id, file_name: d.document.file_name }]); if (d.document.course_id) setCourseId(String(d.document.course_id)); setDrafts(d.questions.map(q => ({ ...q, include: q.include ?? !q.duplicate_of }))); }).catch(e => setError(e.message));
  }, [sp]); // eslint-disable-line

  const addFiles = list => { const ok = [...list].filter(f => /\.(pdf|docx?|txt)$/i.test(f.name)); if (ok.length < list.length) setError("Only PDF, DOC, DOCX and TXT files can be uploaded."); setFiles(f => [...f, ...ok].slice(0, 10)); };

  const extract = async () => {
    setBusy("extract"); setError(""); setInfo("");
    try {
      const form = new FormData(); files.forEach(f => form.append("documents", f)); if (courseId) form.append("course_id", courseId);
      const out = await request("/api/teacher/documents", { method: "POST", body: form });
      setDocs(out.documents); setFileErrors(out.errors); setFiles([]);
      setDrafts(out.questions.map(q => ({ ...q, include: !q.duplicate_of, chapter_id: q.suggested_chapter_id || null })));
      setPage(1); setFilter("all");
      const warn = out.documents.map(d => d.warning && `${d.file_name}: ${d.warning}`).filter(Boolean);
      if (!out.questions.length) setError(warn.join(" ") || "No questions were detected. Check that the paper numbers its questions (1., 2., …).");
      else if (warn.length) setInfo(warn.join(" "));
    } catch (e) { setError(e.message); } finally { setBusy(""); }
  };

  const update = (key, patch) => setDrafts(ds => ds.map(d => d.temp_id === key ? { ...d, ...patch, ...("chapter_id" in patch ? { chapter_manual: true } : {}) } : d));
  const remove = key => setDrafts(ds => ds.filter(d => d.temp_id !== key));
  const patchIncluded = patch => setDrafts(ds => ds.map(d => d.include ? { ...d, ...patch, ...("chapter_id" in patch ? { chapter_manual: true } : {}) } : d));

  const redetect = async (cid = courseId) => {
    if (!cid) return;
    setBusy("chapters"); setError("");
    try {
      const out = await request("/api/teacher/drafts/analyze", { method: "POST", body: JSON.stringify({ course_id: cid, questions: drafts.map(d => ({ temp_id: d.temp_id, question_text: d.question_text, options: d.options })) }) });
      const sug = new Map(out.questions.map(q => [q.temp_id, q.suggested_chapter_id]));
      setDrafts(ds => ds.map(d => d.chapter_manual ? d : { ...d, chapter_id: sug.get(d.temp_id) || null }));
      setInfo("Chapter suggestions refreshed. Only questions you haven't assigned manually were changed.");
    } catch (e) { setError(e.message); } finally { setBusy(""); }
  };
  const onCourse = id => { setCourseId(id); if (drafts) { setDrafts(ds => ds.map(d => d.chapter_manual ? d : { ...d, chapter_id: null })); redetect(id); } };

  const suggest = async () => {
    const targets = drafts.filter(d => d.include && d.question_type !== "long_answer" ? answerProblem(d)?.match(/option|True|expected/i) : d.include && !d.answer_text).slice(0, 25);
    if (!targets.length) return setInfo("Every included question already has an answer.");
    setBusy("ai"); setError("");
    try {
      const out = await request("/api/teacher/ai/suggest-answers", { method: "POST", body: JSON.stringify({ questions: targets.map(d => ({ temp_id: d.temp_id, question_text: d.question_text, question_type: d.question_type, options: d.options })) }) });
      const by = new Map(out.suggestions.map(s => [s.temp_id, s]));
      setDrafts(ds => ds.map(d => {
        const s = by.get(d.temp_id); if (!s) return d;
        const patch = { answer_source: "ai_suggested", answer_verified: false, explanation: d.explanation || s.explanation };
        if (d.question_type === "mcq") { const L = s.answer.trim().toUpperCase().charAt(0); patch.options = d.options.map(o => ({ ...o, correct: o.label === L })); }
        else if (d.question_type === "true_false") patch.answer_text = /^t/i.test(s.answer) ? "True" : /^f/i.test(s.answer) ? "False" : "";
        else patch.answer_text = s.answer;
        return { ...d, ...patch };
      }));
      setInfo(`AI suggested answers for ${out.suggestions.length} of ${targets.length} questions. They're marked “AI suggestion” — verify each one; unverified questions are saved as pending and hidden from students.`);
    } catch (e) { setError(e.message); } finally { setBusy(""); }
  };

  const saveDraft = async () => { setBusy("save"); try { await request("/api/teacher/drafts", { method: "PUT", body: JSON.stringify({ questions: drafts }) }); setInfo("Draft saved. Resume it any time from Content library."); } catch (e) { setError(e.message); } finally { setBusy(""); } };

  const included = (drafts || []).filter(d => d.include);
  const stats = useMemo(() => {
    const s = { total: drafts?.length || 0, included: included.length, ready: 0, pending: 0, dup: 0, answered: 0, attention: 0 };
    for (const d of drafts || []) { if (d.duplicate_of) s.dup++; if (answerProblem(d) || needsVerification(d) || d.confidence < 0.7) s.attention++; if (d.answer_source === "extracted") s.answered++; }
    for (const d of included) importStatus(d).status === "approved" ? s.ready++ : s.pending++;
    return s;
  }, [drafts]); // eslint-disable-line
  const visible = (drafts || []).filter(d => filter === "all" ? true : filter === "attention" ? (answerProblem(d) || needsVerification(d) || d.confidence < 0.7) : filter === "duplicates" ? d.duplicate_of : filter === "included" ? d.include : !d.include);
  const pages = Math.max(1, Math.ceil(visible.length / PAGE));

  const doImport = async () => {
    if (!courseId) return setError("Choose the course these questions belong to.");
    setBusy("import"); setError("");
    try {
      const out = await request("/api/teacher/import", { method: "POST", body: JSON.stringify({ course_id: courseId, questions: included, document_ids: docs.map(d => d.id), auto_quizzes: auto }) });
      setResult(out);
    } catch (e) { setError(e.message); } finally { setBusy(""); }
  };
  const reset = () => { setDrafts(null); setDocs([]); setResult(null); setFiles([]); setInfo(""); setError(""); setFileErrors([]); };

  /* ---------------- done ---------------- */
  if (result) return <><PageHeading eyebrow="QUESTION EXTRACTOR" title="Questions saved" description="Your question bank is updated." />
    <section className="panel done-panel"><div className="result-badge"><CheckCircle2 size={34} /></div>
      <h3>{result.imported} approved · {result.pending} pending{result.skipped ? ` · ${result.skipped} skipped` : ""}</h3>
      <p className="muted">Approved questions are available to students. Pending ones need an answer or verification before they go live.</p>
      {result.quizzes.length > 0 && <div className="success-box"><Layers size={13} /> {result.quizzes.length} quiz{result.quizzes.length === 1 ? "" : "zes"} created or refreshed automatically.</div>}
      {result.notes.map((n, i) => <div key={i} className="info-box">{n}</div>)}
      {result.pending_reasons.length > 0 && <details><summary>Why some are pending</summary><ul className="reasons">{result.pending_reasons.map((r, i) => <li key={i}>{r}</li>)}</ul></details>}
      <div className="result-actions"><Link className="btn outline" to={`/questions?status=pending`}>Review pending</Link><Link className="btn outline" to="/quiz-builder">Open quiz builder</Link><button className="btn primary" onClick={reset}>Upload more papers</button></div></section></>;

  /* ---------------- upload ---------------- */
  if (!drafts) return <><PageHeading eyebrow="AI QUESTION PAPER EXTRACTOR" title="Upload question papers" description="Upload one or several papers. Questions, options and answer keys are extracted for you to review before anything reaches students." />
    {error && <Notice kind="error" onClose={() => setError("")}>{error}</Notice>}
    <div className="upload-layout"><section className="panel upload-panel">
      <div className="upload-title"><div className="upload-icon"><UploadCloud size={21} /></div><div><h3>Bulk question import</h3><p>PDF, DOC, DOCX or TXT · up to 10 files, 15 MB each</p></div></div>
      <label className="inline-field">Course<select className="filter-select" value={courseId} onChange={e => setCourseId(e.target.value)}><option value="">Choose later</option>{courses.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}</select></label>
      <div className="dropzone" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); addFiles(e.dataTransfer.files); }}><input ref={inputRef} type="file" multiple accept=".pdf,.doc,.docx,.txt" onChange={e => { addFiles(e.target.files); e.target.value = ""; }} />
        <div className="drop-icon"><FileText size={22} /></div><strong>Drop papers here, or click to browse</strong><span>Selecting a course lets us suggest a chapter for each question.</span><small>Scanned PDFs need the optional Python/OCR processor.</small></div>
      {files.length > 0 && <div className="file-list">{files.map((f, i) => <div key={i}><FileText size={14} /><span>{f.name}</span><small>{fileSize(f.size)}</small><button className="icon-btn" onClick={() => setFiles(fs => fs.filter((_, k) => k !== i))}><X size={14} /></button></div>)}</div>}
      <button className="btn primary full" disabled={!files.length || busy === "extract"} onClick={extract}>{busy === "extract" ? <><LoaderCircle className="spin" size={16} /> Extracting…</> : <><Sparkles size={16} /> Extract questions{files.length > 1 ? ` from ${files.length} files` : ""}</>}</button>
    </section>
    <aside className="panel process-panel"><h3>How it works</h3>
      {[["1", "Parse", "Text is read from every file, using OCR for scanned pages when the processor is running."], ["2", "Detect", "Questions are split and classified as MCQ, true/false, short or long answer."], ["3", "Answers", "Answer keys written in the paper are matched to questions. Missing answers stay blank unless you ask for AI suggestions."], ["4", "Clean up", "Duplicates across files and your existing bank are flagged, and chapters are suggested."], ["5", "Review & approve", "You edit and approve. Only approved questions reach students."]].map(([n, t, d]) => <div className="process-step" key={n}><span>{n}</span><div><strong>{t}</strong><small>{d}</small></div></div>)}
      <div className="privacy-note"><ShieldCheck size={14} /> Original files are deleted right after text extraction.</div></aside></div></>;

  /* ---------------- review ---------------- */
  return <><PageHeading eyebrow="REVIEW EXTRACTED QUESTIONS" title={`${stats.total} questions found`} description={docs.length ? `From ${docs.map(d => d.file_name).join(", ")}` : ""}
    action={<button className="btn outline" onClick={reset}>Start over</button>} />
    {error && <Notice kind="error" onClose={() => setError("")}>{error}</Notice>}
    {info && <Notice kind="info" onClose={() => setInfo("")}>{info}</Notice>}
    {fileErrors.map(f => <Notice key={f.file_name} kind="error">{f.file_name}: {f.error}</Notice>)}
    <div className="chip-row"><Pill tone="green">{stats.included} included</Pill><Pill tone="green">{stats.answered} with answers from paper</Pill>{stats.dup > 0 && <Pill tone="yellow">{stats.dup} duplicates</Pill>}{stats.attention > 0 && <Pill tone="orange">{stats.attention} need attention</Pill>}</div>
    <section className="panel review-toolbar">
      <label>Course<select className="filter-select" value={courseId} onChange={e => onCourse(e.target.value)}><option value="">Choose a course…</option>{courses.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}</select></label>
      <label>Chapter for included<select className="filter-select" value="" onChange={e => e.target.value !== "" && patchIncluded({ chapter_id: e.target.value === "none" ? null : Number(e.target.value) })}><option value="">Apply…</option><option value="none">Unassigned</option>{chapters.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}</select></label>
      <label>Difficulty for included<select className="filter-select" value="" onChange={e => e.target.value && patchIncluded({ difficulty: e.target.value })}><option value="">Apply…</option><option>Easy</option><option>Medium</option><option>Hard</option></select></label>
      <div className="review-buttons"><button className="btn outline small-btn" disabled={!courseId || busy} onClick={() => redetect()}>{busy === "chapters" ? "…" : "Re-detect chapters"}</button>
        <button className="btn outline small-btn" disabled={busy} onClick={suggest}><Sparkles size={13} /> {busy === "ai" ? "Asking AI…" : "Suggest missing answers"}</button>
        <button className="btn outline small-btn" disabled={busy} onClick={saveDraft}><Save size={13} /> Save draft</button></div></section>
    <div className="tabs">{[["all", "All", stats.total], ["attention", "Needs attention", stats.attention], ["duplicates", "Duplicates", stats.dup], ["included", "Included", stats.included], ["excluded", "Excluded", stats.total - stats.included]].map(([id, label, n]) => <button key={id} className={filter === id ? "active" : ""} onClick={() => { setFilter(id); setPage(1); }}>{label}<span>{n}</span></button>)}
      <span className="tabs-spacer" /><button className="text-link" onClick={() => setDrafts(ds => ds.map(d => ({ ...d, include: true })))}>Include all</button><button className="text-link" onClick={() => setDrafts(ds => ds.map(d => ({ ...d, include: false })))}>Exclude all</button></div>
    {visible.length === 0 ? <div className="panel"><Empty text="Nothing in this view." /></div> : visible.slice((page - 1) * PAGE, page * PAGE).map(d => <div key={d.temp_id} className={`draft-question ${d.include ? "" : "excluded"}`}>
      <div className="draft-head"><label className="correct-check"><input type="checkbox" checked={d.include} onChange={e => update(d.temp_id, { include: e.target.checked })} /> Include</label><strong>#{drafts.indexOf(d) + 1}</strong><Pill tone="purple">{typeLabel(d.question_type)}</Pill>{d.source_file && docs.length > 1 && <Pill>{d.source_file}</Pill>}<span className="confidence" title="How sure the detector is">{Math.round(d.confidence * 100)}% confident</span><button className="icon-btn danger" title="Delete this draft" onClick={() => remove(d.temp_id)}><Trash2 size={15} /></button></div>
      {d.duplicate_of && <div className="dup-warning"><Copy size={13} /> Looks like a duplicate of {d.duplicate_of.kind === "bank" ? "a question already in your bank" : "an earlier question in this upload"}: “{d.duplicate_of.text}”. Excluded by default.</div>}
      <QuestionEditor q={d} chapters={chapters} onChange={patch => update(d.temp_id, patch)} /></div>)}
    <Pager page={Math.min(page, pages)} pages={pages} onChange={setPage} />
    <section className="panel import-panel">
      <div><h3>Approve &amp; save</h3><p className="muted">{stats.ready} will be approved for students{stats.pending ? `, ${stats.pending} will be saved as pending (missing or unverified answer)` : ""}.</p></div>
      <div className="auto-quiz"><label className="correct-check"><input type="checkbox" checked={auto.enabled} onChange={e => setAuto({ ...auto, enabled: e.target.checked })} /> <b>Create quizzes automatically</b></label>
        {auto.enabled && <div className="auto-grid">{[["quick", "Quick Practice"], ["chapter", "Chapter Test"], ["full", "Full Assessment"], ["random", "Random Practice"]].map(([k, label]) => <label key={k}>{label}<input type="number" min="0" max="200" value={auto.config[k]} onChange={e => setAuto({ ...auto, config: { ...auto.config, [k]: Number(e.target.value) } })} /></label>)}
          <label className="correct-check"><input type="checkbox" checked={auto.publish} onChange={e => setAuto({ ...auto, publish: e.target.checked })} /> Publish to students</label></div>}</div>
      <button className="btn primary" disabled={!stats.included || busy === "import"} onClick={doImport}>{busy === "import" ? "Saving…" : `Approve & save ${stats.included} question${stats.included === 1 ? "" : "s"}`}</button></section></>;
}
