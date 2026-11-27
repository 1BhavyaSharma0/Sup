import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowDown, ArrowUp, BookOpen, CheckCircle2, ChevronRight, ClipboardList, Edit3, Eye, FilePlus2, FileText, FolderOpen, Layers, Plus, Settings2, Sparkles, Trash2, Upload as UploadIcon, Users, Wand2, ChartNoAxesCombined, HelpCircle } from "lucide-react";
import { useAuth } from "../context";
import { PageHeading, StatCard, Empty, Spinner, Pill, Notice, Modal, Tabs, Pager, Markdown, fmtDate, typeLabel, useAsync } from "../ui";
import QuestionEditor, { SourceBadge } from "../components/QuestionEditor";

const blankQuestion = () => ({ question_text: "", question_type: "mcq", difficulty: "Medium", marks: 1, answer_text: "", explanation: "", answer_source: "teacher", answer_verified: true, chapter_id: null, options: "ABCD".split("").map(l => ({ label: l, text: "", correct: false })) });
const post = (request, url, body, method = "POST") => request(url, { method, body: JSON.stringify(body) });

/* ------------------------------------------------------------------ dashboard */

export function TeacherDashboard() {
  const { user, request } = useAuth();
  const { data: d, loading } = useAsync(() => request("/api/dashboard"), []);
  if (loading || !d) return <Spinner />;
  return <><PageHeading eyebrow="TEACHER DASHBOARD" title={`Welcome back, ${user.name.split(" ")[0]}`} description="Upload papers, review questions and keep an eye on how students are doing." action={<Link className="btn primary" to="/upload"><UploadIcon size={16} /> Upload question paper</Link>} />
    <div className="stats-grid"><StatCard icon={BookOpen} label="Courses" value={d.courses.length} detail="Courses you teach" /><StatCard icon={Users} label="Students" value={d.students} detail="Enrolled across courses" /><StatCard icon={HelpCircle} label="Approved questions" value={d.approved} detail={d.pending ? `${d.pending} pending review` : "Nothing waiting"} /><StatCard icon={Layers} label="Quizzes" value={d.quizzes} detail="Created for students" /></div>
    {d.pending > 0 && <div className="info-box"><b>{d.pending}</b> question{d.pending === 1 ? " is" : "s are"} pending and hidden from students. <Link to="/questions?status=pending"><b>Review them</b></Link></div>}
    <div className="content-grid"><section className="panel"><div className="panel-heading"><div><h3>Recent uploads</h3><p>Question papers you've processed.</p></div><Link className="text-link" to="/content">Library <ChevronRight size={13} /></Link></div>
      {d.documents.length ? d.documents.map(x => <div key={x.id} className="attempt-row"><div className="attempt-symbol"><FileText size={16} /></div><div className="attempt-main"><strong>{x.file_name}</strong><small>{x.question_count} questions · {fmtDate(x.created_at)}</small></div><Pill tone={x.status === "imported" ? "green" : "yellow"}>{x.status === "imported" ? "Imported" : x.status === "review" ? "In review" : "No questions"}</Pill></div>) : <Empty text="No papers uploaded yet.">{<Link className="btn primary small-btn" to="/upload">Upload one</Link>}</Empty>}</section>
      <section className="panel"><div className="panel-heading"><div><h3>Student activity</h3><p>Latest quiz attempts.</p></div></div>
        {d.activity.length ? d.activity.map(a => <div key={a.id} className="attempt-row"><div className="attempt-symbol"><ClipboardList size={16} /></div><div className="attempt-main"><strong>{a.student_name}</strong><small>{a.title} · {fmtDate(a.created_at)}</small></div><strong>{a.score}%</strong></div>) : <Empty text="No quiz attempts yet." />}</section></div></>;
}

/* ------------------------------------------------------------------ courses */

function CourseForm({ initial, onSave, onClose, title }) {
  const [f, setF] = useState(initial || { title: "", description: "", category: "General", level: "Beginner" }), [err, setErr] = useState("");
  return <Modal title={title} onClose={onClose}><div className="form-stack">
    <label>Title<input value={f.title} onChange={e => setF({ ...f, title: e.target.value })} /></label>
    <label>Description<textarea rows={3} value={f.description || ""} onChange={e => setF({ ...f, description: e.target.value })} /></label>
    <div className="two-col"><label>Category<input value={f.category || ""} onChange={e => setF({ ...f, category: e.target.value })} /></label><label>Level<select value={f.level} onChange={e => setF({ ...f, level: e.target.value })}><option>Beginner</option><option>Intermediate</option><option>Advanced</option></select></label></div>
    {err && <Notice kind="error">{err}</Notice>}<button className="btn primary" onClick={() => onSave(f).catch(e => setErr(e.message))}>Save course</button></div></Modal>;
}

export function TeacherCourses() {
  const { request } = useAuth(), [modal, setModal] = useState(false);
  const { data, loading, reload } = useAsync(() => request("/api/courses"), []);
  if (loading) return <Spinner />;
  return <><PageHeading eyebrow="MY COURSES" title="My courses" description="Create and manage the courses you teach." action={<button className="btn primary" onClick={() => setModal(true)}><Plus size={16} /> New course</button>} />
    {data.courses.length ? <div className="course-grid">{data.courses.map((c, i) => <Link key={c.id} to={`/courses/${c.id}`} className="course-card"><div className={`course-cover cover-${i % 4}`}><span className="cover-label">{c.category?.toUpperCase()}</span><div className="cover-illustration"><BookOpen size={34} /></div></div>
      <div className="course-card-body"><div className="course-meta"><span>{c.level}</span><Pill tone={c.published ? "green" : "yellow"}>{c.published ? "Published" : "Draft"}</Pill></div><h3>{c.title}</h3><p>{c.chapter_count} chapters · {c.question_count} questions · {c.student_count} students</p></div></Link>)}</div>
      : <div className="panel"><Empty text="You haven't created a course yet." /></div>}
    {modal && <CourseForm title="New course" onClose={() => setModal(false)} onSave={async f => { await post(request, "/api/courses", f); setModal(false); reload(); }} />}</>;
}

export function CourseManage() {
  const { id } = useParams(), { request } = useAuth(), nav = useNavigate();
  const { data, loading, error, reload } = useAsync(() => request(`/api/courses/${id}`), [id]);
  const [edit, setEdit] = useState(false), [msg, setMsg] = useState("");
  if (loading) return <Spinner />;
  if (error) return <Notice kind="error">{error}</Notice>;
  const { course, chapters, stats } = data;
  const patch = async body => { await post(request, `/api/courses/${id}`, body, "PATCH"); reload(); };
  const del = async () => { if (window.confirm(`Delete “${course.title}” with all its notes, questions and quizzes? This cannot be undone.`)) { await request(`/api/courses/${id}`, { method: "DELETE" }); nav("/courses"); } };
  return <><PageHeading eyebrow={`${course.category} · ${course.level}`.toUpperCase()} title={course.title} description={course.description} action={<button className="btn outline" onClick={() => setEdit(true)}><Edit3 size={15} /> Edit details</button>} />
    {msg && <Notice kind="info" onClose={() => setMsg("")}>{msg}</Notice>}
    <div className="stats-grid"><StatCard icon={Users} label="Students" value={stats.students} detail="Enrolled" /><StatCard icon={HelpCircle} label="Approved questions" value={stats.approved} detail={`${stats.pending} pending`} /><StatCard icon={Layers} label="Quizzes" value={stats.quizzes} detail="Created" /><StatCard icon={BookOpen} label="Chapters" value={chapters.length} detail="In this course" /></div>
    <div className="content-grid"><section className="panel"><div className="panel-heading"><div><h3>Syllabus</h3><p>Chapters and topics.</p></div><Link className="btn outline small-btn" to={`/notes?course=${id}`}><Edit3 size={13} /> Edit notes</Link></div>
      {chapters.length ? chapters.map((c, i) => <div key={c.id} className="chapter-block"><div className="chapter-title"><span>{i + 1}</span><strong>{c.title}</strong></div>{c.topics.map(t => <div className="topic-row" key={t.id}><span>{t.title}</span></div>)}</div>) : <Empty text="No chapters yet.">{<Link className="btn primary small-btn" to={`/notes?course=${id}`}>Add notes</Link>}</Empty>}</section>
      <section className="panel"><div className="panel-heading"><div><h3>Settings</h3></div></div>
        <label className="switch-row"><div><strong>Published</strong><small>Visible to students in Explore courses.</small></div><input type="checkbox" checked={!!course.published} onChange={e => patch({ published: e.target.checked })} /></label>
        <label className="switch-row"><div><strong>Answers in offline downloads</strong><small>Lets students grade quizzes and see answers without internet. Turn off for strict assessments — results then appear after syncing.</small></div><input type="checkbox" checked={!!course.offline_answers} onChange={e => patch({ offline_answers: e.target.checked })} /></label>
        <div className="quick-links"><Link className="btn outline small-btn" to="/upload"><UploadIcon size={13} /> Upload papers</Link><Link className="btn outline small-btn" to="/quiz-builder"><Layers size={13} /> Quizzes</Link><button className="btn outline small-btn danger-btn" onClick={del}><Trash2 size={13} /> Delete course</button></div></section></div>
    {edit && <CourseForm title="Edit course" initial={course} onClose={() => setEdit(false)} onSave={async f => { await patch(f); setEdit(false); }} />}</>;
}

/* ------------------------------------------------------------------ notes manager */

export function NotesManager() {
  const { request } = useAuth(), [sp, setSp] = useSearchParams();
  const { data: cs } = useAsync(() => request("/api/courses"), []);
  const courseId = sp.get("course") || cs?.courses[0]?.id;
  const { data, reload } = useAsync(() => courseId ? request(`/api/courses/${courseId}`) : Promise.resolve(null), [courseId]);
  const [topic, setTopic] = useState(null), [preview, setPreview] = useState(false), [msg, setMsg] = useState(""), [err, setErr] = useState("");
  const chapters = data?.chapters || [];
  useEffect(() => { setTopic(null); }, [courseId]);
  const run = async fn => { setErr(""); try { await fn(); await reload(); } catch (e) { setErr(e.message); } };
  const addChapter = () => { const title = window.prompt("Chapter title"); if (title) run(() => post(request, "/api/chapters", { course_id: Number(courseId), title })); };
  const addTopic = ch => { const title = window.prompt("Topic title"); if (title) run(async () => { const { topic: t } = await post(request, "/api/topics", { chapter_id: ch.id, title, content: "" }); setTopic(t); }); };
  const save = () => run(async () => { await post(request, `/api/topics/${topic.id}`, { title: topic.title, content: topic.content }, "PATCH"); setMsg("Saved."); });
  const importFile = e => { const f = e.target.files[0]; e.target.value = ""; if (!f || !topic) return; run(async () => { const form = new FormData(); form.append("document", f); form.append("chapter_id", topic.chapter_id); const { topic: t } = await request("/api/teacher/notes/import", { method: "POST", body: form }); setTopic(t); setMsg("Imported as a new topic."); }); };
  const gen = () => run(async () => { const o = await post(request, "/api/teacher/ai/generate-questions", { topic_id: topic.id, count: 5 }); setMsg(`${o.added} draft questions added as pending. ${o.notice}`); });
  return <><PageHeading eyebrow="NOTES MANAGER" title="Notes manager" description="Write and organise the notes students read. Use ## for headings, - for bullets and **bold**." action={<button className="btn primary" disabled={!courseId} onClick={addChapter}><Plus size={15} /> Add chapter</button>} />
    {err && <Notice kind="error" onClose={() => setErr("")}>{err}</Notice>}{msg && <Notice kind="success" onClose={() => setMsg("")}>{msg}</Notice>}
    <div className="notes-layout"><aside className="panel notes-index"><select className="filter-select" value={courseId || ""} onChange={e => setSp({ course: e.target.value })}>{cs?.courses.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}</select><div className="index-divider" />
      {chapters.map(ch => <div key={ch.id} className="idx-chapter"><div className="idx-head"><span className="nav-label">{ch.title.toUpperCase()}</span>
        <span className="mini-actions"><button title="Move up" onClick={() => run(() => post(request, `/api/chapters/${ch.id}`, { move: "up" }, "PATCH"))}><ArrowUp size={12} /></button><button title="Move down" onClick={() => run(() => post(request, `/api/chapters/${ch.id}`, { move: "down" }, "PATCH"))}><ArrowDown size={12} /></button>
          <button title="Rename" onClick={() => { const title = window.prompt("Rename chapter", ch.title); if (title) run(() => post(request, `/api/chapters/${ch.id}`, { title }, "PATCH")); }}><Edit3 size={12} /></button>
          <button title="Delete" onClick={() => window.confirm("Delete this chapter and its topics? Questions stay in the bank, unassigned.") && run(() => request(`/api/chapters/${ch.id}`, { method: "DELETE" }))}><Trash2 size={12} /></button></span></div>
        {ch.topics.map(t => <button key={t.id} className={`topic-select ${topic?.id === t.id ? "on" : ""}`} onClick={() => { setTopic({ ...t }); setPreview(false); }}><span />{t.title}</button>)}
        <button className="text-link add-topic" onClick={() => addTopic(ch)}><Plus size={12} /> Add topic</button></div>)}
      {!chapters.length && <p className="small-text">No chapters yet.</p>}</aside>
    <article className="panel notes-reader">{!topic ? <Empty text="Select a topic to edit, or add a chapter to get started." /> : <>
      <div className="editor-top"><input className="title-input" value={topic.title} onChange={e => setTopic({ ...topic, title: e.target.value })} /><div className="editor-actions">
        <button className="btn outline small-btn" onClick={() => setPreview(!preview)}><Eye size={13} /> {preview ? "Edit" : "Preview"}</button>
        <label className="btn outline small-btn file-btn"><FilePlus2 size={13} /> Import file<input type="file" accept=".pdf,.docx,.doc,.txt" onChange={importFile} /></label>
        <button className="btn outline small-btn" onClick={gen}><Wand2 size={13} /> Draft questions (AI)</button></div></div>
      {preview ? <Markdown text={topic.content} /> : <textarea className="notes-editor" value={topic.content || ""} onChange={e => setTopic({ ...topic, content: e.target.value })} placeholder="Write the notes for this topic…" />}
      <div className="reader-actions"><button className="btn outline danger-btn" onClick={() => window.confirm("Delete this topic?") && run(async () => { await request(`/api/topics/${topic.id}`, { method: "DELETE" }); setTopic(null); })}><Trash2 size={14} /> Delete</button><button className="btn primary" onClick={save}>Save topic</button></div></>}</article></div></>;
}

/* ------------------------------------------------------------------ teacher question bank */

export function TeacherQuestions() {
  const { request } = useAuth(), [sp] = useSearchParams();
  const { data: cs } = useAsync(() => request("/api/courses"), []);
  const [f, setF] = useState({ course_id: "", chapter_id: "", status: sp.get("status") || "", type: "", difficulty: "", q: "" }), [page, setPage] = useState(1);
  const [chapters, setChapters] = useState([]), [sel, setSel] = useState(new Set()), [edit, setEdit] = useState(null), [msg, setMsg] = useState(""), [err, setErr] = useState("");
  const qs = new URLSearchParams({ page, limit: 15, ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)) }).toString();
  const { data, loading, reload } = useAsync(() => request(`/api/teacher/questions?${qs}`), [qs]);
  useEffect(() => { if (f.course_id) request(`/api/courses/${f.course_id}`).then(d => setChapters(d.chapters)).catch(() => {}); else setChapters([]); }, [f.course_id]); // eslint-disable-line
  const set = (k, v) => { setF(x => ({ ...x, [k]: v, ...(k === "course_id" ? { chapter_id: "" } : {}) })); setPage(1); setSel(new Set()); };
  const bulk = async (action, extra = {}) => { setErr(""); try { const o = await post(request, "/api/teacher/questions/bulk", { ids: [...sel], action, ...extra }); setMsg(`${o.changed} updated${o.skipped.length ? `, ${o.skipped.length} skipped: ${o.skipped[0].reason}` : ""}.`); setSel(new Set()); reload(); } catch (e) { setErr(e.message); } };
  const saveEdit = async () => {
    setErr("");
    try {
      const body = { ...edit, ...(edit.approval_status === "pending" ? {} : {}) };
      if (edit.id) await post(request, `/api/teacher/questions/${edit.id}`, body, "PATCH");
      else { const o = await post(request, "/api/teacher/questions", { ...body, course_id: edit.course_id || f.course_id, save_as_pending: true }); if (o.reason) setMsg(`Saved as pending: ${o.reason}`); }
      setEdit(null); reload();
    } catch (e) { setErr(e.message); }
  };
  const approve = async q => { setErr(""); try { await post(request, `/api/teacher/questions/${q.id}`, { approval_status: "approved" }, "PATCH"); reload(); } catch (e) { setErr(`${e.message} Open the question to fix it.`); } };
  const rows = data?.questions || [];
  return <><PageHeading eyebrow="QUESTION BANK" title="Question bank" description="Everything you've imported or written. Only approved questions are visible to students." action={<div className="head-actions"><Link className="btn outline" to="/upload"><UploadIcon size={15} /> Import papers</Link><button className="btn primary" disabled={!f.course_id && !cs?.courses.length} onClick={() => setEdit({ ...blankQuestion(), course_id: f.course_id || cs.courses[0].id, chapter_id: f.chapter_id ? Number(f.chapter_id) : null })}><Plus size={15} /> Add question</button></div>} />
    {msg && <Notice kind="info" onClose={() => setMsg("")}>{msg}</Notice>}{err && <Notice kind="error" onClose={() => setErr("")}>{err}</Notice>}
    <div className="chip-row"><Pill tone="green">{data?.counts.approved ?? 0} approved</Pill><Pill tone="yellow">{data?.counts.pending ?? 0} pending</Pill></div>
    <div className="toolbar wrap"><select className="filter-select" value={f.course_id} onChange={e => set("course_id", e.target.value)}><option value="">All courses</option>{cs?.courses.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}</select>
      <select className="filter-select" value={f.chapter_id} onChange={e => set("chapter_id", e.target.value)} disabled={!f.course_id}><option value="">All chapters</option><option value="none">Unassigned</option>{chapters.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}</select>
      <select className="filter-select" value={f.status} onChange={e => set("status", e.target.value)}><option value="">Any status</option><option value="approved">Approved</option><option value="pending">Pending</option></select>
      <select className="filter-select" value={f.type} onChange={e => set("type", e.target.value)}><option value="">All types</option><option value="mcq">MCQ</option><option value="true_false">True / False</option><option value="short_answer">Short answer</option><option value="long_answer">Long answer</option></select>
      <select className="filter-select" value={f.difficulty} onChange={e => set("difficulty", e.target.value)}><option value="">Any difficulty</option><option>Easy</option><option>Medium</option><option>Hard</option></select>
      <input className="filter-select" placeholder="Search…" value={f.q} onChange={e => set("q", e.target.value)} /></div>
    {sel.size > 0 && <div className="bulk-bar"><strong>{sel.size} selected</strong><button className="btn outline small-btn" onClick={() => bulk("approve")}>Approve</button><button className="btn outline small-btn" onClick={() => bulk("unpublish")}>Move to pending</button>
      {f.course_id && <select className="filter-select" value="" onChange={e => e.target.value && bulk("move", { chapter_id: e.target.value === "none" ? null : Number(e.target.value) })}><option value="">Move to chapter…</option><option value="none">Unassigned</option>{chapters.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}</select>}
      <select className="filter-select" value="" onChange={e => e.target.value && bulk("difficulty", { difficulty: e.target.value })}><option value="">Set difficulty…</option><option>Easy</option><option>Medium</option><option>Hard</option></select>
      <button className="btn outline small-btn danger-btn" onClick={() => window.confirm(`Delete ${sel.size} question(s)?`) && bulk("delete")}><Trash2 size={13} /> Delete</button></div>}
    {loading ? <Spinner /> : !rows.length ? <div className="panel"><Empty text="No questions match these filters.">{<Link className="btn primary small-btn" to="/upload">Import a question paper</Link>}</Empty></div> :
      <div className="panel table-panel"><table className="table"><thead><tr><th><input type="checkbox" checked={rows.every(r => sel.has(r.id))} onChange={e => setSel(e.target.checked ? new Set(rows.map(r => r.id)) : new Set())} /></th><th>Question</th><th>Type</th><th>Level</th><th>Status</th><th /></tr></thead>
        <tbody>{rows.map(q => <tr key={q.id}><td><input type="checkbox" checked={sel.has(q.id)} onChange={e => setSel(s => { const n = new Set(s); e.target.checked ? n.add(q.id) : n.delete(q.id); return n; })} /></td>
          <td className="q-cell"><span>{q.question_text}</span><SourceBadge q={q} /></td><td>{typeLabel(q.question_type)}</td><td>{q.difficulty}</td>
          <td><Pill tone={q.approval_status === "approved" ? "green" : "yellow"}>{q.approval_status}</Pill></td>
          <td className="row-actions">{q.approval_status === "pending" && <button className="btn outline small-btn" onClick={() => approve(q)}><CheckCircle2 size={13} /> Approve</button>}<button className="icon-btn" title="Edit" onClick={() => setEdit({ ...q })}><Edit3 size={15} /></button>
            <button className="icon-btn danger" title="Delete" onClick={() => window.confirm("Delete this question?") && request(`/api/teacher/questions/${q.id}`, { method: "DELETE" }).then(reload)}><Trash2 size={15} /></button></td></tr>)}</tbody></table></div>}
    <Pager page={data?.page || 1} pages={data?.pages || 1} onChange={setPage} />
    {edit && <Modal wide title={edit.id ? "Edit question" : "Add question"} onClose={() => setEdit(null)}>
      {!edit.id && <label className="inline-field">Course<select className="filter-select" value={edit.course_id} onChange={e => setEdit({ ...edit, course_id: Number(e.target.value), chapter_id: null })}>{cs.courses.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}</select></label>}
      <QuestionEditor q={edit} chapters={edit.course_id === Number(f.course_id) || edit.id ? chapters : []} hideChapter={!f.course_id && !edit.id} onChange={p => setEdit(e => ({ ...e, ...p }))} />
      {err && <Notice kind="error">{err}</Notice>}
      <div className="modal-actions"><button className="btn outline" onClick={() => setEdit(null)}>Cancel</button><button className="btn primary" onClick={saveEdit}>Save question</button></div></Modal>}</>;
}

/* ------------------------------------------------------------------ quiz builder */

export function QuizBuilder() {
  const { request } = useAuth();
  const { data: cs } = useAsync(() => request("/api/courses"), []);
  const [courseId, setCourseId] = useState(""), [tab, setTab] = useState("auto");
  const id = courseId || cs?.courses[0]?.id || "";
  return <><PageHeading eyebrow="QUIZ BUILDER" title="Quiz builder" description="Generate quizzes from approved questions in one click, or build your own." />
    <div className="toolbar"><select className="filter-select" value={id} onChange={e => setCourseId(e.target.value)}>{cs?.courses.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}</select></div>
    <Tabs value={tab} onChange={setTab} tabs={[["auto", "Auto-generate"], ["list", "My quizzes"], ["custom", "Build custom"]]} />
    {id ? <>{tab === "auto" && <AutoQuizzes courseId={id} />}{tab === "list" && <QuizList courseId={id} />}{tab === "custom" && <CustomQuiz courseId={id} onDone={() => setTab("list")} />}</> : <div className="panel"><Empty text="Create a course first." /></div>}</>;
}

function AutoQuizzes({ courseId }) {
  const { request } = useAuth();
  const { data, loading } = useAsync(() => request(`/api/teacher/courses/${courseId}/quiz-stats`), [courseId]);
  const [cfg, setCfg] = useState(null), [publish, setPublish] = useState(true), [out, setOut] = useState(null), [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  useEffect(() => { if (data) setCfg(data.defaults); setOut(null); }, [data]);
  if (loading || !cfg) return <Spinner />;
  const gen = async () => { setBusy(true); setErr(""); try { setOut(await post(request, `/api/teacher/courses/${courseId}/auto-quizzes`, { config: cfg, publish })); } catch (e) { setErr(e.message); } finally { setBusy(false); } };
  const eligible = data.by_chapter.filter(c => c.count >= 3).length;
  const presets = [["quick", "Quick Practice", "A short random set across the whole course. Untimed.", Math.min(cfg.quick, data.approved)], ["chapter", "Chapter Test", `One timed test per chapter with at least 3 questions (${eligible} eligible).`, `${eligible} tests`], ["full", "Full Assessment", "Timed, balanced across every chapter.", Math.min(cfg.full, data.approved)], ["random", "Random Practice", "A fresh random set every time a student plays it. Untimed.", Math.min(cfg.random, data.approved)]];
  return <section className="panel"><div className="panel-heading"><div><h3>Automatic quizzes</h3><p>Built from the <b>{data.approved}</b> approved questions in this course{data.pending ? ` (${data.pending} pending are excluded)` : ""}. Running this again refreshes the same quizzes instead of duplicating them.</p></div></div>
    {data.approved === 0 ? <Empty text="Approve some questions first.">{<Link className="btn primary small-btn" to="/upload">Import a paper</Link>}</Empty> : <>
      <div className="preset-grid">{presets.map(([k, title, desc, preview]) => <div className="preset" key={k}><strong>{title}</strong><small>{desc}</small><label>Questions{k === "chapter" ? " per test" : ""}<input type="number" min="0" max="200" value={cfg[k]} onChange={e => setCfg({ ...cfg, [k]: Number(e.target.value) })} /></label><span className="preset-preview">{cfg[k] ? `→ ${preview}${typeof preview === "number" ? " questions" : ""}` : "Disabled"}</span></div>)}</div>
      {data.unassigned > 0 && <div className="info-box">{data.unassigned} approved question{data.unassigned === 1 ? " has" : "s have"} no chapter, so they only appear in Quick, Full and Random quizzes. Assign chapters in the Question bank to include them in Chapter Tests.</div>}
      <label className="correct-check"><input type="checkbox" checked={publish} onChange={e => setPublish(e.target.checked)} /> Publish to students immediately</label>
      {err && <Notice kind="error">{err}</Notice>}
      <button className="btn primary" disabled={busy} onClick={gen}><Sparkles size={15} /> {busy ? "Generating…" : "Generate quizzes"}</button>
      {out && <div className="success-box"><CheckCircle2 size={13} /> {out.quizzes.length} quizzes created or refreshed. {out.notes.map((n, i) => <div key={i}>{n}</div>)}</div>}</>}</section>;
}

function QuizList({ courseId }) {
  const { request } = useAuth();
  const { data, loading, reload } = useAsync(() => request(`/api/teacher/quizzes?course_id=${courseId}`), [courseId]);
  const [view, setView] = useState(null), [edit, setEdit] = useState(null);
  if (loading) return <Spinner />;
  const patch = (q, body) => post(request, `/api/teacher/quizzes/${q.id}`, body, "PATCH").then(reload);
  return <section className="panel table-panel">{!data.quizzes.length ? <Empty text="No quizzes yet — generate them or build one." /> : <table className="table"><thead><tr><th>Quiz</th><th>Type</th><th>Questions</th><th>Attempts</th><th>Avg</th><th>Published</th><th /></tr></thead><tbody>{data.quizzes.map(q => <tr key={q.id}>
    <td className="q-cell"><span>{q.title}</span>{q.auto && <Pill>auto</Pill>}</td><td>{q.mode === "assessment" ? `Timed · ${q.duration_min} min` : "Practice"}</td><td>{q.question_count}</td><td>{q.attempts}</td><td>{q.avg_score != null ? `${q.avg_score}%` : "—"}</td>
    <td><input type="checkbox" checked={q.published} onChange={e => patch(q, { published: e.target.checked })} /></td>
    <td className="row-actions"><button className="icon-btn" title="View questions" onClick={() => request(`/api/teacher/quizzes/${q.id}`).then(setView)}><Eye size={15} /></button><button className="icon-btn" title="Settings" onClick={() => setEdit({ ...q })}><Settings2 size={15} /></button>
      <button className="icon-btn danger" title="Delete" onClick={() => window.confirm("Delete this quiz? Past attempts are kept.") && request(`/api/teacher/quizzes/${q.id}`, { method: "DELETE" }).then(reload)}><Trash2 size={15} /></button></td></tr>)}</tbody></table>}
    {view && <Modal wide title={view.quiz.title} onClose={() => setView(null)}>{view.questions.map((q, i) => <div key={q.id} className="option-line"><span>{i + 1}</span>{q.question_text} <Pill>{typeLabel(q.question_type)}</Pill></div>)}{view.quiz.kind === "random" && <p className="small-text">Random Practice draws a fresh set from the course each time it is played; the list above is just the latest draw.</p>}</Modal>}
    {edit && <Modal title="Quiz settings" onClose={() => setEdit(null)}><div className="form-stack"><label>Title<input value={edit.title} onChange={e => setEdit({ ...edit, title: e.target.value })} /></label>
      <label>Mode<select value={edit.mode} onChange={e => setEdit({ ...edit, mode: e.target.value })}><option value="practice">Practice (untimed)</option><option value="assessment">Timed assessment</option></select></label>
      {edit.mode === "assessment" && <label>Time limit (minutes)<input type="number" min="1" value={edit.duration_min || 15} onChange={e => setEdit({ ...edit, duration_min: Number(e.target.value) })} /></label>}
      <button className="btn primary" onClick={() => patch(edit, edit).then(() => setEdit(null))}>Save</button></div></Modal>}</section>;
}

function CustomQuiz({ courseId, onDone }) {
  const { request } = useAuth();
  const { data: detail } = useAsync(() => request(`/api/courses/${courseId}`), [courseId]);
  const [f, setF] = useState({ title: "", mode: "practice", duration_min: 20, chapter_id: "", difficulty: "", q: "" }), [sel, setSel] = useState([]), [err, setErr] = useState("");
  const qs = new URLSearchParams({ course_id: courseId, status: "approved", limit: 100, ...(f.chapter_id ? { chapter_id: f.chapter_id } : {}), ...(f.difficulty ? { difficulty: f.difficulty } : {}), ...(f.q ? { q: f.q } : {}) }).toString();
  const { data } = useAsync(() => request(`/api/teacher/questions?${qs}`), [qs]);
  const rows = data?.questions || [];
  const toggle = id => setSel(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  const random = n => setSel([...rows].sort(() => Math.random() - 0.5).slice(0, n).map(q => q.id));
  const save = async () => { setErr(""); try { await post(request, "/api/teacher/quizzes", { course_id: Number(courseId), title: f.title, mode: f.mode, duration_min: f.duration_min, chapter_id: f.chapter_id || null, question_ids: sel }); onDone(); } catch (e) { setErr(e.message); } };
  return <section className="panel"><div className="form-stack">
    <div className="two-col"><label>Title<input value={f.title} onChange={e => setF({ ...f, title: e.target.value })} placeholder="e.g. Midterm revision" /></label><label>Mode<select value={f.mode} onChange={e => setF({ ...f, mode: e.target.value })}><option value="practice">Practice (untimed)</option><option value="assessment">Timed assessment</option></select></label></div>
    {f.mode === "assessment" && <label>Time limit (minutes)<input type="number" min="1" value={f.duration_min} onChange={e => setF({ ...f, duration_min: Number(e.target.value) })} /></label>}
    <div className="toolbar wrap"><select className="filter-select" value={f.chapter_id} onChange={e => setF({ ...f, chapter_id: e.target.value })}><option value="">All chapters</option>{detail?.chapters.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}</select>
      <select className="filter-select" value={f.difficulty} onChange={e => setF({ ...f, difficulty: e.target.value })}><option value="">Any difficulty</option><option>Easy</option><option>Medium</option><option>Hard</option></select>
      <input className="filter-select" placeholder="Search…" value={f.q} onChange={e => setF({ ...f, q: e.target.value })} /><button className="btn outline small-btn" onClick={() => random(10)}>Pick 10 at random</button><button className="btn outline small-btn" onClick={() => setSel(rows.map(r => r.id))}>Select all shown</button></div>
    <div className="pick-list">{rows.map(q => <label key={q.id} className="pick-row"><input type="checkbox" checked={sel.includes(q.id)} onChange={() => toggle(q.id)} /><span>{q.question_text}</span><Pill>{typeLabel(q.question_type)}</Pill></label>)}{!rows.length && <Empty text="No approved questions match." />}</div>
    {err && <Notice kind="error">{err}</Notice>}<button className="btn primary" disabled={!sel.length || !f.title.trim()} onClick={save}>Create quiz with {sel.length} question{sel.length === 1 ? "" : "s"}</button></div></section>;
}

/* ------------------------------------------------------------------ student performance */

export function Performance() {
  const { request } = useAuth();
  const { data: cs } = useAsync(() => request("/api/courses"), []);
  const [courseId, setCourseId] = useState("");
  const { data: p, loading } = useAsync(() => request(`/api/teacher/performance${courseId ? `?course_id=${courseId}` : ""}`), [courseId]);
  const max = useMemo(() => Math.max(1, ...(p?.distribution || []).map(d => d.count)), [p]);
  return <><PageHeading eyebrow="STUDENT PERFORMANCE" title="Student performance" description="See how students are doing and which questions trip them up." action={<select className="filter-select" value={courseId} onChange={e => setCourseId(e.target.value)}><option value="">All courses</option>{cs?.courses.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}</select>} />
    {loading || !p ? <Spinner /> : p.empty ? <div className="panel"><Empty text="Create a course to see performance." /></div> : <>
      <div className="stats-grid"><StatCard icon={Users} label="Students" value={p.summary.students} detail={`${p.summary.active_week} active this week`} /><StatCard icon={ClipboardList} label="Quiz attempts" value={p.summary.attempts} detail="All quizzes" /><StatCard icon={ChartNoAxesCombined} label="Average score" value={`${p.summary.avg_score}%`} detail="Across attempts" /><StatCard icon={CheckCircle2} label="Avg. completion" value={`${p.summary.avg_completion}%`} detail="Of topics" /></div>
      <div className="content-grid"><section className="panel"><div className="panel-heading"><div><h3>Score distribution</h3></div></div><div className="bars wide">{p.distribution.map(d => <div key={d.label} className="bar"><span style={{ height: `${Math.max(4, (d.count / max) * 100)}%` }} /><small>{d.label}<br />{d.count}</small></div>)}</div></section>
        <section className="panel"><div className="panel-heading"><div><h3>Hardest questions</h3><p>Lowest accuracy (answered at least twice).</p></div></div>{p.hardest.length ? p.hardest.map(h => <div key={h.id} className="stat-line"><span className="clip">{h.question_text}</span><div className="progress-track"><span style={{ width: `${h.accuracy}%` }} /></div><b>{h.accuracy}%</b></div>) : <Empty text="Not enough answers yet." />}</section></div>
      <div className="content-grid"><section className="panel"><div className="panel-heading"><div><h3>Chapter accuracy</h3></div></div>{p.chapters.length ? p.chapters.map(c => <div key={c.title} className="stat-line"><span>{c.title}</span><div className="progress-track"><span style={{ width: `${c.accuracy}%` }} /></div><b>{c.accuracy}%</b></div>) : <Empty text="No data yet." />}</section>
        <section className="panel"><div className="panel-heading"><div><h3>Quizzes</h3></div></div>{p.quizzes.map(q => <div key={q.id} className="attempt-row"><div className="attempt-main"><strong>{q.title}</strong><small>{q.attempts} attempts · {q.students} students</small></div><strong>{q.avg_score != null ? `${q.avg_score}%` : "—"}</strong></div>)}</section></div>
      <section className="panel table-panel"><div className="panel-heading"><div><h3>Students</h3></div></div>{p.students.length ? <table className="table"><thead><tr><th>Student</th><th>Attempts</th><th>Avg score</th><th>Topics done</th><th>Last active</th></tr></thead><tbody>{p.students.map(s => <tr key={s.id}><td className="q-cell"><span>{s.name}</span><small>{s.email}</small></td><td>{s.attempts}</td><td>{s.avg_score != null ? `${s.avg_score}%` : "—"}</td><td>{s.topics_done}/{s.topics_total} ({s.completion}%)</td><td>{s.last_active ? fmtDate(s.last_active) : "—"}</td></tr>)}</tbody></table> : <Empty text="No students are enrolled yet." />}</section></>}</>;
}

/* ------------------------------------------------------------------ content library */

export function Library() {
  const { request } = useAuth();
  const { data, loading, reload } = useAsync(() => request("/api/teacher/documents"), []);
  if (loading) return <Spinner />;
  return <><PageHeading eyebrow="CONTENT LIBRARY" title="Uploaded papers" description="Resume a review you saved, or see what has already been imported." action={<Link className="btn primary" to="/upload"><UploadIcon size={15} /> Upload</Link>} />
    <section className="panel">{data.documents.length ? data.documents.map(d => <div key={d.id} className="attempt-row"><div className="attempt-symbol"><FolderOpen size={16} /></div><div className="attempt-main"><strong>{d.file_name}</strong><small>{d.question_count} questions · {fmtDate(d.created_at)}{d.ocr_used ? " · OCR" : ""}</small></div>
      <Pill tone={d.status === "imported" ? "green" : "yellow"}>{d.status === "imported" ? "Imported" : d.status === "review" ? "In review" : "No questions found"}</Pill>
      {d.has_draft && d.status !== "imported" && <Link className="btn outline small-btn" to={`/upload?doc=${d.id}`}>Resume review</Link>}
      <button className="icon-btn danger" title="Delete record" onClick={() => window.confirm("Remove this record? Imported questions stay in your bank.") && request(`/api/teacher/documents/${d.id}`, { method: "DELETE" }).then(reload)}><Trash2 size={15} /></button></div>) : <Empty text="No papers uploaded yet." />}</section></>;
}
