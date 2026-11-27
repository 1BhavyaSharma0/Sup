import React, { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowUpRight, BookOpen, Check, ChevronRight, Compass, Search, Send, Sparkles, Users, WifiOff, Plus } from "lucide-react";
import { useAuth } from "../context";
import { PageHeading, Empty, Spinner, Pill, Notice, useAsync } from "../ui";

/* ------------------------------------------------------------------ explore courses (students) */

export function Courses() {
  const { request } = useAuth(), nav = useNavigate();
  const { data, loading, error, reload } = useAsync(() => request("/api/courses"), []);
  const [q, setQ] = useState(""), [cat, setCat] = useState("All"), [busy, setBusy] = useState(null);
  if (loading) return <Spinner />;
  if (error) return <><PageHeading eyebrow="EXPLORE" title="Explore courses" description="" /><div className="info-box"><WifiOff size={13} /> {error}</div></>;
  const cats = ["All", ...new Set(data.courses.map(c => c.category))];
  const shown = data.courses.filter(c => (cat === "All" || c.category === cat) && `${c.title} ${c.description}`.toLowerCase().includes(q.toLowerCase()));
  const enroll = async (e, c) => { e.preventDefault(); setBusy(c.id); try { await request(`/api/courses/${c.id}/enroll`, { method: "POST" }); await reload(); } finally { setBusy(null); } };
  return <><PageHeading eyebrow="EXPLORE" title="Explore courses" description="Find a course and start learning." />
    <div className="toolbar"><div className="search-box"><Search size={15} /><input placeholder="Search courses" value={q} onChange={e => setQ(e.target.value)} /></div><div className="chips">{cats.map(c => <button key={c} className={cat === c ? "active" : ""} onClick={() => setCat(c)}>{c}</button>)}</div></div>
    {shown.length ? <div className="course-grid">{shown.map((c, i) => <Link to={`/courses/${c.id}`} key={c.id} className="course-card"><div className={`course-cover cover-${i % 4}`}><span className="cover-label">{c.category?.toUpperCase()}</span><div className="cover-illustration"><BookOpen size={34} /></div></div>
      <div className="course-card-body"><div className="course-meta"><span>{c.level}</span><span><Users size={12} /> {c.student_count}</span></div><h3>{c.title}</h3><p>{c.description}</p><small className="small-text">{c.teacher_name} · {c.chapter_count} chapters · {c.question_count} questions</small>
        {c.enrolled ? <div className="progress-line"><div className="progress-track"><span style={{ width: `${c.progress}%` }} /></div><b>{c.progress}%</b></div> : <button className="btn outline small-btn" disabled={busy === c.id} onClick={e => enroll(e, c)}><Plus size={13} /> Enroll</button>}</div></Link>)}</div>
      : <div className="panel"><Empty text="No courses match your search." /></div>}</>;
}

export function CourseDetail() {
  const { id } = useParams(), { request } = useAuth();
  const { data, loading, error, reload } = useAsync(() => request(`/api/courses/${id}`), [id]);
  if (loading) return <Spinner />;
  if (error) return <Notice kind="error">{error}</Notice>;
  const { course, chapters, enrolled, completed } = data, done = new Set(completed);
  const total = chapters.reduce((n, c) => n + c.topics.length, 0), pct = total ? Math.round((done.size / total) * 100) : 0;
  const toggle = async () => { await request(`/api/courses/${id}/enroll`, { method: enrolled ? "DELETE" : "POST" }); reload(); };
  return <><PageHeading eyebrow={`${course.category} · ${course.level}`.toUpperCase()} title={course.title} description={course.description} action={<button className={`btn ${enrolled ? "outline" : "primary"}`} onClick={toggle}>{enrolled ? "Unenroll" : <>Enroll now <ArrowUpRight size={15} /></>}</button>} />
    <div className="content-grid"><section className="panel"><div className="panel-heading"><div><h3>Syllabus</h3><p>Taught by {course.teacher_name}</p></div>{enrolled && <b>{pct}% complete</b>}</div>
      {chapters.map((c, i) => <div key={c.id} className="chapter-block"><div className="chapter-title"><span>{i + 1}</span><strong>{c.title}</strong></div>{c.topics.map(t => enrolled ? <Link key={t.id} className="topic-row" to={`/notes?course=${id}&topic=${t.id}`}>{done.has(t.id) ? <Check size={14} className="done" /> : <span className="dot" />}<span>{t.title}</span><ChevronRight size={14} /></Link> : <div key={t.id} className="topic-row"><span className="dot" /><span>{t.title}</span></div>)}</div>)}
      {!chapters.length && <Empty text="This course doesn't have any content yet." />}</section>
      <section className="panel"><h3>What you'll do</h3><p className="muted">Read notes, practise with questions from your teacher and take quizzes. Download the course to keep learning without internet.</p>
        {enrolled ? <div className="quick-links"><Link className="btn primary small-btn" to={`/notes?course=${id}`}>Open notes</Link><Link className="btn outline small-btn" to="/quizzes">Quizzes</Link><Link className="btn outline small-btn" to={`/practice?course=${id}`}>Practice</Link><Link className="btn outline small-btn" to="/downloads">Download</Link></div> : <p className="small-text">Enroll to unlock notes, questions and quizzes.</p>}</section></div></>;
}

/* ------------------------------------------------------------------ AI assistant */

export function Assistant() {
  const { request, user } = useAuth();
  const { data: cs } = useAsync(() => request("/api/courses").then(d => user.role === "teacher" ? d.courses : d.courses.filter(c => c.enrolled)).catch(() => []), []);
  const [courseId, setCourseId] = useState(""), [text, setText] = useState(""), [busy, setBusy] = useState(false);
  const [msgs, setMsgs] = useState([{ role: "ai", text: "Hi! I'm your study assistant. Pick a course and I'll use its notes to answer. What would you like to understand better?" }]);
  const end = useRef();
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);
  const send = async e => {
    e.preventDefault(); const prompt = text.trim(); if (!prompt) return; setText(""); setBusy(true);
    setMsgs(m => [...m, { role: "user", text: prompt }]);
    try { const r = await request("/api/ai/ask", { method: "POST", body: JSON.stringify({ prompt, course_id: courseId || undefined }) }); setMsgs(m => [...m, { role: "ai", text: r.answer, source: r.source, grounded: r.grounded }]); }
    catch (err) { setMsgs(m => [...m, { role: "ai", text: err.offline ? "The assistant needs an internet connection. Your downloaded notes are still available in Smart notes." : err.message, error: true }]); }
    finally { setBusy(false); }
  };
  return <><PageHeading eyebrow="AI STUDY ASSISTANT" title="Ask anything" description="Answers use your course notes when you choose a course." />
    <section className="panel chat-panel"><div className="chat-toolbar"><select className="filter-select" value={courseId} onChange={e => setCourseId(e.target.value)}><option value="">General question (no course notes)</option>{cs?.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}</select></div>
      <div className="chat-log">{msgs.map((m, i) => <div key={i} className={`bubble ${m.role} ${m.error ? "err" : ""}`}>{m.role === "ai" && <Sparkles size={14} />}<div>{m.text}{m.source === "demo" && <small className="demo-tag">Demo mode — configure an AI provider on the server for full answers.</small>}{m.source === "ai" && m.grounded && <small className="demo-tag">Based on your course notes.</small>}</div></div>)}{busy && <div className="bubble ai"><Sparkles size={14} /><div>Thinking…</div></div>}<div ref={end} /></div>
      <form className="chat-form" onSubmit={send}><input value={text} onChange={e => setText(e.target.value)} placeholder="Ask a question about your course…" /><button className="btn primary" disabled={busy || !text.trim()}><Send size={15} /></button></form></section></>;
}

/* ------------------------------------------------------------------ settings */

export function Settings() {
  const { user, request, updateUser } = useAuth();
  const [name, setName] = useState(user.name), [pw, setPw] = useState({ current: "", next: "" }), [msg, setMsg] = useState(""), [err, setErr] = useState("");
  const [defaults, setDefaults] = useState(null), [publish, setPublish] = useState(true), [health, setHealth] = useState(null);
  useEffect(() => { request("/api/settings").then(s => { setDefaults(s.quiz_defaults); setPublish(s.auto_publish); }).catch(() => {}); request("/api/health").then(setHealth).catch(() => {}); }, []); // eslint-disable-line
  const run = async (fn, ok) => { setErr(""); setMsg(""); try { await fn(); setMsg(ok); } catch (e) { setErr(e.message); } };
  return <><PageHeading eyebrow="SETTINGS" title="Settings" description="Manage your account and preferences." />
    {msg && <Notice kind="success" onClose={() => setMsg("")}>{msg}</Notice>}{err && <Notice kind="error" onClose={() => setErr("")}>{err}</Notice>}
    <div className="content-grid"><section className="panel"><h3>Profile</h3><div className="form-stack"><label>Full name<input value={name} onChange={e => setName(e.target.value)} /></label><label>Email<input value={user.email} disabled /></label>
      <button className="btn primary" onClick={() => run(async () => updateUser((await request("/api/auth/profile", { method: "PATCH", body: JSON.stringify({ name }) })).user), "Profile updated.")}>Save profile</button></div></section>
      <section className="panel"><h3>Change password</h3><div className="form-stack"><label>Current password<input type="password" value={pw.current} onChange={e => setPw({ ...pw, current: e.target.value })} /></label><label>New password<input type="password" minLength="8" value={pw.next} onChange={e => setPw({ ...pw, next: e.target.value })} placeholder="At least 8 characters" /></label>
        <button className="btn primary" onClick={() => run(async () => { await request("/api/auth/password", { method: "POST", body: JSON.stringify(pw) }); setPw({ current: "", next: "" }); }, "Password changed.")}>Update password</button></div></section></div>
    {user.role === "teacher" && defaults && <section className="panel"><h3>Automatic quiz defaults</h3><p className="muted">Used when you generate quizzes after importing questions. Set a size to 0 to skip that quiz type.</p>
      <div className="auto-grid">{[["quick", "Quick Practice"], ["chapter", "Chapter Test (per chapter)"], ["full", "Full Assessment"], ["random", "Random Practice"]].map(([k, l]) => <label key={k}>{l}<input type="number" min="0" max="200" value={defaults[k]} onChange={e => setDefaults({ ...defaults, [k]: Number(e.target.value) })} /></label>)}</div>
      <label className="correct-check"><input type="checkbox" checked={publish} onChange={e => setPublish(e.target.checked)} /> Publish generated quizzes to students by default</label>
      <button className="btn primary" onClick={() => run(() => request("/api/settings", { method: "PUT", body: JSON.stringify({ quiz_defaults: defaults, auto_publish: publish }) }), "Defaults saved.")}>Save defaults</button></section>}
    {health && <section className="panel"><h3>System</h3><div className="chip-row"><Pill tone={health.ai === "configured" ? "green" : "yellow"}>AI assistant: {health.ai === "configured" ? "provider connected" : "demo mode"}</Pill><Pill tone={health.processor ? "green" : "yellow"}>OCR processor: {health.processor ? "connected" : "not configured"}</Pill></div>
      {(health.ai !== "configured" || !health.processor) && <p className="small-text">{health.ai !== "configured" && "Set AI_BASE_URL, AI_API_KEY and AI_MODEL in .env for AI answers and answer suggestions. "}{!health.processor && "Set PROCESSOR_URL to the Python service to read scanned PDFs and .doc files."}</p>}</section>}</>;
}
