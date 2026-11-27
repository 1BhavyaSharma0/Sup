import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowUpRight, BookOpen, Brain, ChartNoAxesCombined, CheckCircle2, ChevronRight, ClipboardList, Clock3, CloudDownload, Compass, Download, FileQuestion, Flame, Play, Search, Sparkles, Trash2, WifiOff, RefreshCw, Library as LibraryIcon } from "lucide-react";
import { useAuth } from "../context";
import { PageHeading, StatCard, Empty, Spinner, Pill, Notice, Markdown, fmtDate, typeLabel, useAsync } from "../ui";
import QuizPlayer from "../components/QuizPlayer";
import { deletePack, fmtBytes, getPack, gradeLocal, listPacks, newId, savePack, setLocalProgress, storageUsage } from "../offline";
import { shuffle } from "../util";

/* ------------------------------------------------------------------ data helpers (online first, device second) */

function useEnrolledCourses() {
  const { request, online } = useAuth();
  return useAsync(async () => {
    if (navigator.onLine) {
      try { return { offline: false, courses: (await request("/api/courses")).courses.filter(c => c.enrolled) }; } catch (e) { if (!e.offline) throw e; }
    }
    return { offline: true, courses: (await listPacks()).map(p => ({ ...p.pack.course, progress: localProgress(p.pack), downloaded: true })) };
  }, [online]);
}
function localProgress(pack) {
  const total = pack.chapters.reduce((n, c) => n + c.topics.length, 0);
  const done = Object.values(pack.progress || {}).filter(p => p.completed).length;
  return total ? Math.round((done / total) * 100) : 0;
}
const OfflineNote = () => <div className="info-box"><WifiOff size={13} /> You're offline — showing what you've downloaded to this device.</div>;

/* ------------------------------------------------------------------ dashboard */

export function StudentDashboard() {
  const { user, request } = useAuth();
  const { data, error, loading } = useAsync(() => request("/api/dashboard"), []);
  if (loading) return <Spinner />;
  if (error) return <><PageHeading eyebrow="DASHBOARD" title={`Hello, ${user.name.split(" ")[0]}`} description="" />
    <div className="info-box"><WifiOff size={13} /> {error} Your downloaded courses still work: open <Link to="/quizzes"><b>Quizzes</b></Link> or <Link to="/notes"><b>Smart notes</b></Link>.</div></>;
  const hour = new Date().getHours(), greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  return <>
    <PageHeading eyebrow={new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }).toUpperCase()} title={`${greet}, ${user.name.split(" ")[0]} 👋`} description="A little progress each day adds up to big results." action={<Link className="btn primary" to="/courses"><Compass size={16} /> Explore courses</Link>} />
    <section className="hero-banner"><div className="hero-copy"><span className="hero-kicker"><Sparkles size={14} /> YOUR LEARNING, IN FLOW</span>
      <h2>{data.next_quiz ? <>Ready for your<br /><em>next quiz?</em></> : <>Make today a<br /><em>learning day.</em></>}</h2>
      <p>{data.next_quiz ? `${data.next_quiz.title} · ${data.next_quiz.course_title}` : "Pick up where you left off, or ask your AI study companion for a hand."}</p>
      <Link to={data.next_quiz ? `/quizzes/${data.next_quiz.id}` : "/assistant"} className="btn hero-btn">{data.next_quiz ? "Start quiz" : "Ask your AI tutor"} <ArrowUpRight size={16} /></Link></div>
      <div className="hero-graphic"><div className="hero-ring ring-a" /><div className="hero-ring ring-b" /><div className="hero-orb"><Brain size={48} /></div>
        <div className="floating-chip chip-a"><Flame size={15} /> {data.streak} day streak</div><div className="floating-chip chip-b"><CheckCircle2 size={15} /> One step at a time</div></div></section>
    <div className="stats-grid">
      <StatCard icon={BookOpen} label="Enrolled courses" value={data.courses.length} detail="Keep building your skills" />
      <StatCard icon={CheckCircle2} label="Topics completed" value={data.completed} detail="Every topic counts" />
      <StatCard icon={ClipboardList} label="Quizzes attempted" value={data.stats.attempts} detail="Practice makes progress" />
      <StatCard icon={ChartNoAxesCombined} label="Average score" value={`${Math.round(data.stats.avg_score)}%`} detail="Across your attempts" />
    </div>
    <div className="content-grid">
      <section className="panel"><div className="panel-heading"><div><h3>Continue learning</h3><p>Pick up right where you left off.</p></div><Link className="text-link" to="/learning">View all <ChevronRight size={13} /></Link></div>
        {data.courses.length ? data.courses.map(c => <Link key={c.id} to={`/courses/${c.id}`} className="course-row"><div className="course-thumb"><BookOpen size={19} /></div><div className="course-row-main"><strong>{c.title}</strong><small>{c.category} · {c.level}</small><div className="progress-track"><span style={{ width: `${c.progress}%` }} /></div></div><span className="course-progress">{c.progress}%</span></Link>)
          : <Empty text="You haven't enrolled in a course yet.">{<Link className="btn primary small-btn" to="/courses">Browse courses</Link>}</Empty>}</section>
      <section className="panel"><div className="panel-heading"><div><h3>Recent quizzes</h3><p>Your latest results.</p></div></div>
        {data.attempts.length ? data.attempts.map(a => <div key={a.id} className="attempt-row"><div className="attempt-symbol"><ClipboardList size={16} /></div><div className="attempt-main"><strong>{a.title}</strong><small>{fmtDate(a.created_at)}</small></div><strong>{a.score}%</strong></div>) : <Empty text="No attempts yet. Try a quick practice quiz." />}</section>
    </div>
  </>;
}

/* ------------------------------------------------------------------ my learning */

export function Learning() {
  const { data, loading } = useEnrolledCourses();
  const [packs, setPacks] = useState({});
  useEffect(() => { listPacks().then(p => setPacks(Object.fromEntries(p.map(x => [x.courseId, x])))).catch(() => {}); }, []);
  if (loading) return <Spinner />;
  return <><PageHeading eyebrow="MY LEARNING" title="Your courses" description="Everything you're enrolled in, with your progress." />
    {data?.offline && <OfflineNote />}
    {data?.courses.length ? <div className="course-grid">{data.courses.map((c, i) => <div key={c.id} className="course-card"><div className={`course-cover cover-${i % 4}`}><span className="cover-label">{c.category?.toUpperCase()}</span><div className="cover-illustration"><BookOpen size={34} /></div></div>
      <div className="course-card-body"><div className="course-meta"><span>{c.level}</span>{packs[c.id] && <Pill tone="green"><CloudDownload size={11} /> On this device</Pill>}</div><h3>{c.title}</h3>
        <div className="progress-track wide"><span style={{ width: `${c.progress}%` }} /></div><p className="small-text">{c.progress}% complete</p>
        <div className="card-actions"><Link className="btn primary small-btn" to={`/notes?course=${c.id}`}>Notes</Link><Link className="btn outline small-btn" to={`/quizzes`}>Quizzes</Link><Link className="btn outline small-btn" to={`/practice?course=${c.id}`}>Practice</Link></div></div></div>)}</div>
      : <div className="panel"><Empty text="You haven't enrolled in any course yet.">{<Link className="btn primary small-btn" to="/courses">Explore courses</Link>}</Empty></div>}</>;
}

/* ------------------------------------------------------------------ smart notes */

async function loadCourseDetail(request, courseId) {
  if (navigator.onLine) {
    try { const d = await request(`/api/courses/${courseId}`); return { chapters: d.chapters, completed: new Set(d.completed), offline: false }; } catch (e) { if (!e.offline) throw e; }
  }
  const pack = await getPack(courseId);
  if (!pack) throw new Error("This course isn't downloaded to your device. Connect to the internet or download it from Downloads.");
  return { chapters: pack.chapters, completed: new Set(Object.entries(pack.progress || {}).filter(([, p]) => p.completed).map(([id]) => Number(id))), offline: true };
}

export function Notes() {
  const { request, queueProgress } = useAuth();
  const [sp, setSp] = useSearchParams();
  const { data: list } = useEnrolledCourses();
  const courseId = Number(sp.get("course")) || list?.courses?.[0]?.id;
  const [detail, setDetail] = useState(null), [error, setError] = useState(""), [topicId, setTopicId] = useState(null);
  useEffect(() => { if (!courseId) return; setDetail(null); setError(""); loadCourseDetail(request, courseId).then(d => { setDetail(d); setTopicId(Number(sp.get("topic")) || d.chapters[0]?.topics[0]?.id || null); }).catch(e => setError(e.message)); }, [courseId]); // eslint-disable-line
  const topics = useMemo(() => (detail?.chapters || []).flatMap(c => c.topics.map(t => ({ ...t, chapter: c.title }))), [detail]);
  const idx = topics.findIndex(t => t.id === topicId), topic = topics[idx];
  const toggle = async () => {
    const completed = !detail.completed.has(topic.id), updated_at = new Date().toISOString();
    setDetail(d => { const s = new Set(d.completed); completed ? s.add(topic.id) : s.delete(topic.id); return { ...d, completed: s }; });
    const payload = { topic_id: topic.id, completed, updated_at, course_id: courseId };
    try { if (!navigator.onLine) throw Object.assign(new Error(), { offline: true }); await request("/api/progress", { method: "POST", body: JSON.stringify(payload) }); await setLocalProgress(courseId, topic.id, completed, updated_at).catch(() => {}); }
    catch (e) { if (e.offline) await queueProgress(payload); else setError(e.message); }
  };
  return <><PageHeading eyebrow="SMART NOTES" title="Notes" description="Read, complete topics and track your progress. Your progress saves even when you're offline." />
    {error && <Notice kind="error">{error}</Notice>}
    <div className="notes-layout"><aside className="panel notes-index">
      {list?.courses.map(c => <button key={c.id} className={`course-select ${c.id === courseId ? "selected" : ""}`} onClick={() => setSp({ course: c.id })}><BookOpen size={14} /> {c.title}</button>)}
      <div className="index-divider" />
      {detail?.chapters.map(ch => <div key={ch.id} className="idx-chapter"><span className="nav-label">{ch.title.toUpperCase()}</span>{ch.topics.map(t => <button key={t.id} className={`topic-select ${t.id === topicId ? "on" : ""}`} onClick={() => setTopicId(t.id)}>{detail.completed.has(t.id) ? <CheckCircle2 size={12} className="done" /> : <span />}{t.title}</button>)}</div>)}
    </aside>
    <article className="panel notes-reader">{!detail && !error ? <Spinner /> : !topic ? <Empty text="This course has no notes yet." /> : <>
      <div className="reader-top"><Pill tone="orange">{topic.chapter}</Pill>{detail.offline && <Pill><WifiOff size={11} /> Offline copy</Pill>}</div>
      <h2>{topic.title}</h2><div className="reader-byline"><Clock3 size={13} /> {Math.max(1, Math.round((topic.content || "").split(/\s+/).length / 180))} min read</div>
      <Markdown text={topic.content} />
      <div className="reader-actions"><button className="btn outline" disabled={idx <= 0} onClick={() => setTopicId(topics[idx - 1].id)}>Previous</button>
        <button className={`btn ${detail.completed.has(topic.id) ? "outline" : "primary"}`} onClick={toggle}><CheckCircle2 size={15} /> {detail.completed.has(topic.id) ? "Completed — undo" : "Mark as complete"}</button>
        <button className="btn outline" disabled={idx >= topics.length - 1} onClick={() => setTopicId(topics[idx + 1].id)}>Next</button></div></>}</article></div></>;
}

/* ------------------------------------------------------------------ question bank */

export function StudentQuestions() {
  const { request } = useAuth();
  const { data: list } = useEnrolledCourses();
  const [f, setF] = useState({ course: "", chapter: "", type: "", difficulty: "", q: "" });
  const [chapters, setChapters] = useState([]), [items, setItems] = useState(null), [error, setError] = useState(""), [shown, setShown] = useState({});
  const courseId = f.course || list?.courses?.[0]?.id || "";
  useEffect(() => { if (!courseId) return; loadCourseDetail(request, courseId).then(d => setChapters(d.chapters)).catch(() => setChapters([])); }, [courseId]); // eslint-disable-line
  useEffect(() => {
    if (!courseId) return; setItems(null); setError("");
    (async () => {
      if (navigator.onLine) {
        try {
          const p = new URLSearchParams({ course_id: courseId }); for (const k of ["chapter", "type", "difficulty", "q"]) if (f[k]) p.set(k === "chapter" ? "chapter_id" : k, f[k]);
          return setItems((await request(`/api/questions?${p}`)).questions);
        } catch (e) { if (!e.offline) return setError(e.message); }
      }
      const pack = await getPack(courseId); if (!pack) return setError("Download this course to browse its questions offline.");
      setItems(pack.questions.filter(q => (!f.chapter || q.chapter_id === Number(f.chapter)) && (!f.type || q.question_type === f.type) && (!f.difficulty || q.difficulty === f.difficulty) && (!f.q || q.question_text.toLowerCase().includes(f.q.toLowerCase()))));
    })();
  }, [courseId, f.chapter, f.type, f.difficulty, f.q]); // eslint-disable-line
  const reveal = async id => {
    if (shown[id]) return setShown(s => ({ ...s, [id]: null }));
    try {
      let a;
      if (navigator.onLine) { try { a = await request(`/api/questions/${id}/answer`); } catch (e) { if (!e.offline) throw e; } }
      if (!a) { const pack = await getPack(courseId); a = pack?.answers?.[id]; if (!a) throw new Error("Answers aren't available offline for this course."); }
      setShown(s => ({ ...s, [id]: a }));
    } catch (e) { setError(e.message); }
  };
  const set = (k, v) => setF(x => ({ ...x, [k]: v, ...(k === "course" ? { chapter: "" } : {}) }));
  return <><PageHeading eyebrow="QUESTION BANK" title="Question bank" description="Approved questions from your teachers. Reveal an answer when you're ready." />
    <div className="toolbar wrap"><select className="filter-select" value={courseId} onChange={e => set("course", e.target.value)}>{list?.courses.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}</select>
      <select className="filter-select" value={f.chapter} onChange={e => set("chapter", e.target.value)}><option value="">All chapters</option>{chapters.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}</select>
      <select className="filter-select" value={f.type} onChange={e => set("type", e.target.value)}><option value="">All types</option><option value="mcq">MCQ</option><option value="true_false">True / False</option><option value="short_answer">Short answer</option><option value="long_answer">Long answer</option></select>
      <select className="filter-select" value={f.difficulty} onChange={e => set("difficulty", e.target.value)}><option value="">Any difficulty</option><option>Easy</option><option>Medium</option><option>Hard</option></select>
      <div className="search-box"><Search size={15} /><input placeholder="Search questions" value={f.q} onChange={e => set("q", e.target.value)} /></div></div>
    {error && <Notice kind="error" onClose={() => setError("")}>{error}</Notice>}
    {!items ? (error ? null : <Spinner />) : !items.length ? <div className="panel"><Empty text="No questions match these filters." /></div> :
      <div className="question-list">{items.map((q, n) => { const a = shown[q.id]; return <div className="panel question-card" key={q.id}>
        <div className="question-card-top"><span className="question-number">Q{n + 1}</span><Pill tone="purple">{typeLabel(q.question_type)}</Pill><Pill tone="orange">{q.difficulty}</Pill></div>
        <h3>{q.question_text}</h3>{q.options.map(o => <div key={o.label} className="option-line"><span>{o.label}</span>{o.text}</div>)}
        {a && <div className="answer-reveal">{q.question_type === "mcq" ? <p><b>Answer:</b> {a.correct_labels?.map(l => `${l}. ${q.options.find(o => o.label === l)?.text || ""}`).join(", ") || "—"}</p> : <p><b>{q.question_type === "long_answer" ? "Model answer:" : "Answer:"}</b> {a.answer_text || "—"}</p>}{a.explanation && <small>{a.explanation}</small>}</div>}
        <button className="btn outline small-btn" onClick={() => reveal(q.id)}>{a ? "Hide answer" : "Show answer"}</button></div>; })}</div>}</>;
}

/* ------------------------------------------------------------------ attempts (shared by practice + quizzes) */

function useSubmit() {
  const { request, queueAttempt } = useAuth();
  return useCallback(async ({ quizId = null, courseId, title, questions, answers, meta }) => {
    const payload = { client_attempt_id: newId(), quiz_id: quizId, course_id: courseId, title, question_ids: meta.question_ids, answers, duration_sec: meta.duration_sec };
    if (navigator.onLine) {
      try { return await request(quizId ? `/api/quizzes/${quizId}/submit` : "/api/practice/submit", { method: "POST", body: JSON.stringify(payload) }); } catch (e) { if (!e.offline) throw e; }
    }
    const pack = await getPack(courseId);
    await queueAttempt(payload);
    return gradeLocal(pack || {}, questions, answers, { title });
  }, [request, queueAttempt]);
}

/* ------------------------------------------------------------------ practice zone */

export function Practice() {
  const { request } = useAuth(), submit = useSubmit(), nav = useNavigate();
  const [sp] = useSearchParams();
  const { data: list } = useEnrolledCourses();
  const [f, setF] = useState({ course: sp.get("course") || "", chapter: "", count: 10, difficulty: "" });
  const [chapters, setChapters] = useState([]), [session, setSession] = useState(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const courseId = Number(f.course || list?.courses?.[0]?.id) || "";
  useEffect(() => { if (courseId) loadCourseDetail(request, courseId).then(d => setChapters(d.chapters)).catch(() => setChapters([])); }, [courseId]); // eslint-disable-line
  const start = async () => {
    setBusy(true); setError("");
    try {
      let questions;
      if (navigator.onLine) { try { const p = new URLSearchParams({ course_id: courseId, count: f.count }); if (f.chapter) p.set("chapter_id", f.chapter); if (f.difficulty) p.set("difficulty", f.difficulty); questions = (await request(`/api/practice?${p}`)).questions; } catch (e) { if (!e.offline) throw e; } }
      if (!questions) { const pack = await getPack(courseId); if (!pack) throw new Error("Download this course first to practise offline."); questions = shuffle(pack.questions.filter(q => (!f.chapter || q.chapter_id === Number(f.chapter)) && (!f.difficulty || q.difficulty === f.difficulty))).slice(0, f.count); }
      if (!questions.length) throw new Error("There are no approved questions for these settings yet.");
      setSession({ questions, id: newId() });
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  if (session) return <><PageHeading eyebrow="PRACTICE ZONE" title="Practice session" description="Answer at your own pace — there's no timer." />
    <QuizPlayer key={session.id} title="Practice" questions={session.questions} onSubmit={(answers, meta) => submit({ courseId, title: "Practice session", questions: session.questions, answers, meta })} onRetry={start} onExit={() => nav("/statistics")} exitLabel="View statistics" /></>;
  return <><PageHeading eyebrow="PRACTICE ZONE" title="Practice zone" description="Build a custom practice set from your courses." />
    <section className="panel builder-panel"><div className="builder-icon"><FileQuestion size={20} /></div><h3>Start a practice set</h3><p>Questions are drawn at random from approved questions in the course.</p>
      <div className="builder-fields"><label>Course<select value={courseId} onChange={e => setF({ ...f, course: e.target.value, chapter: "" })}>{list?.courses.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}</select></label>
        <label>Chapter<select value={f.chapter} onChange={e => setF({ ...f, chapter: e.target.value })}><option value="">All chapters</option>{chapters.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}</select></label>
        <label>Difficulty<select value={f.difficulty} onChange={e => setF({ ...f, difficulty: e.target.value })}><option value="">Mixed</option><option>Easy</option><option>Medium</option><option>Hard</option></select></label>
        <label>Questions<select value={f.count} onChange={e => setF({ ...f, count: Number(e.target.value) })}>{[5, 10, 15, 20, 30].map(n => <option key={n}>{n}</option>)}</select></label></div>
      {error && <Notice kind="error">{error}</Notice>}
      <button className="btn primary" disabled={!courseId || busy} onClick={start}><Play size={15} /> {busy ? "Preparing…" : "Start practice"}</button></section></>;
}

/* ------------------------------------------------------------------ quizzes */

export function Quizzes() {
  const { request } = useAuth();
  const { data, loading } = useAsync(async () => {
    if (navigator.onLine) { try { return { offline: false, quizzes: (await request("/api/quizzes")).quizzes }; } catch (e) { if (!e.offline) throw e; } }
    const packs = await listPacks();
    return { offline: true, quizzes: packs.flatMap(p => p.pack.quizzes.map(z => ({ ...z, course_id: p.courseId, course_title: p.pack.course.title, question_count: z.kind === "random" ? z.question_count : z.question_ids.length }))) };
  }, []);
  if (loading) return <Spinner />;
  const groups = Object.values((data?.quizzes || []).reduce((m, z) => { (m[z.course_id] ||= { title: z.course_title, items: [] }).items.push(z); return m; }, {}));
  return <><PageHeading eyebrow="QUIZZES" title="Quizzes" description="Quizzes created by your teachers from approved questions." />
    {data?.offline && <OfflineNote />}
    {groups.length ? groups.map(g => <section className="panel" key={g.title}><div className="panel-heading"><div><h3>{g.title}</h3></div></div>
      <div className="quiz-grid">{g.items.map(z => <Link key={z.id} to={`/quizzes/${z.id}`} className="quiz-tile"><div className="quiz-tile-top"><Pill tone={z.mode === "assessment" ? "purple" : "green"}>{z.mode === "assessment" ? "Timed" : "Practice"}</Pill>{z.best_score != null && <Pill tone="orange">Best {z.best_score}%</Pill>}</div>
        <strong>{z.title}</strong><small>{z.question_count} questions{z.duration_min ? ` · ${z.duration_min} min` : ""}{z.attempts ? ` · ${z.attempts} attempt${z.attempts === 1 ? "" : "s"}` : ""}</small><span className="text-link">{z.attempts ? "Try again" : "Start"} <ArrowUpRight size={13} /></span></Link>)}</div></section>)
      : <div className="panel"><Empty text="No quizzes yet. Enroll in a course, or download one for offline use.">{<Link className="btn primary small-btn" to="/courses">Explore courses</Link>}</Empty></div>}</>;
}

export function QuizRun() {
  const { id } = useParams(), { request } = useAuth(), submit = useSubmit(), nav = useNavigate();
  const [state, setState] = useState(null), [error, setError] = useState(""), [round, setRound] = useState(0);
  useEffect(() => {
    setState(null); setError("");
    (async () => {
      if (navigator.onLine) { try { return setState(await request(`/api/quizzes/${id}/play`)); } catch (e) { if (!e.offline) return setError(e.message); } }
      for (const p of await listPacks()) {
        const z = p.pack.quizzes.find(x => x.id === Number(id)); if (!z) continue;
        const byId = new Map(p.pack.questions.map(q => [q.id, q]));
        let ids = z.question_ids; if (z.kind === "random") ids = shuffle(ids).slice(0, z.question_count);
        return setState({ quiz: { ...z, course_id: p.courseId }, questions: ids.map(i => byId.get(i)).filter(Boolean) });
      }
      setError("This quiz isn't available offline. Download its course from Downloads while you're online.");
    })();
  }, [id, round]); // eslint-disable-line
  if (error) return <><PageHeading eyebrow="QUIZ" title="Quiz unavailable" description="" /><Notice kind="error">{error}</Notice><Link className="btn outline" to="/quizzes">Back to quizzes</Link></>;
  if (!state) return <Spinner />;
  const { quiz, questions } = state;
  if (!questions.length) return <Notice kind="info">This quiz has no approved questions right now.</Notice>;
  return <><PageHeading eyebrow={quiz.mode === "assessment" ? "TIMED QUIZ" : "PRACTICE QUIZ"} title={quiz.title} description={quiz.mode === "assessment" ? `You have ${quiz.duration_min} minutes. The quiz submits automatically when time is up.` : "No timer — take your time."} />
    <QuizPlayer key={round} title={quiz.title} questions={questions} durationMin={quiz.mode === "assessment" ? quiz.duration_min : 0}
      onSubmit={(answers, meta) => submit({ quizId: quiz.id, courseId: quiz.course_id, title: quiz.title, questions, answers, meta })} onRetry={() => setRound(r => r + 1)} onExit={() => nav("/quizzes")} /></>;
}

/* ------------------------------------------------------------------ downloads (offline packs) */

export function Downloads() {
  const { request, online, pending, syncNow, syncing, syncMsg } = useAuth();
  const [packs, setPacks] = useState([]), [courses, setCourses] = useState([]), [busy, setBusy] = useState(null), [error, setError] = useState(""), [usage, setUsage] = useState(null);
  const refresh = useCallback(async () => { setPacks(await listPacks()); setUsage(await storageUsage()); }, []);
  useEffect(() => { refresh(); if (navigator.onLine) request("/api/courses").then(d => setCourses(d.courses.filter(c => c.enrolled))).catch(() => {}); }, [online]); // eslint-disable-line
  const download = async c => {
    setBusy(c.id); setError("");
    try { await savePack(c.id, await request(`/api/courses/${c.id}/pack`)); await refresh(); if (navigator.storage?.persist) navigator.storage.persist(); }
    catch (e) { setError(e.offline ? "You need an internet connection to download." : e.message); } finally { setBusy(null); }
  };
  const remove = async id => { if (!window.confirm("Remove this course from your device? Anything not yet synced stays queued.")) return; await deletePack(id); refresh(); };
  const byId = Object.fromEntries(packs.map(p => [p.courseId, p]));
  const rows = courses.length ? courses : packs.map(p => ({ id: p.courseId, ...p.pack.course }));
  const swReady = !!navigator.serviceWorker?.controller;
  return <><section className="offline-banner"><div><span className="hero-kicker"><CloudDownload size={14} /> LEARN ANYWHERE</span><h2>Take your courses offline.</h2><p>Download a course once: notes, approved questions and quizzes are saved on this device. Quiz attempts and progress sync automatically when you're back online.</p></div><div className="offline-graphic"><Download size={52} /></div></section>
    {error && <Notice kind="error" onClose={() => setError("")}>{error}</Notice>}
    {syncMsg && <Notice kind="success">{syncMsg}</Notice>}
    <div className="stats-grid three">
      <StatCard icon={CloudDownload} label="Courses on device" value={packs.length} detail={usage ? `${fmtBytes(usage.used)} of browser storage used` : "Stored in your browser"} />
      <StatCard icon={RefreshCw} label="Waiting to sync" value={pending} detail={pending ? (online ? "Syncing automatically" : "Will sync when you're online") : "Everything is up to date"} />
      <StatCard icon={WifiOff} label="App shell" value={swReady ? "Ready" : "Not yet"} detail={swReady ? "Opens without internet" : "Reload once online to enable"} />
    </div>
    {pending > 0 && <div className="panel sync-panel"><div><strong>{pending} item{pending === 1 ? "" : "s"} waiting to sync</strong><small>Quiz attempts and topic progress saved on this device.</small></div><button className="btn primary small-btn" disabled={!online || syncing} onClick={syncNow}><RefreshCw size={14} className={syncing ? "spin" : ""} /> Sync now</button></div>}
    <section className="panel"><div className="panel-heading"><div><h3>Your courses</h3><p>{online ? "Download or update a course for offline use." : "You're offline — these are the courses stored on this device."}</p></div></div>
      {rows.length ? rows.map(c => { const p = byId[c.id]; return <div className="course-row" key={c.id}><div className="course-thumb"><BookOpen size={19} /></div>
        <div className="course-row-main"><strong>{c.title}</strong><small>{p ? `${fmtBytes(p.size)} · ${p.pack.questions.length} questions · ${p.pack.quizzes.length} quizzes · saved ${fmtDate(p.savedAt)}` : "Not downloaded"}{p && !p.pack.answers ? " · answers online only" : ""}</small></div>
        {online && <button className="btn outline small-btn" disabled={busy === c.id} onClick={() => download(c)}>{busy === c.id ? "Downloading…" : p ? <><RefreshCw size={13} /> Update</> : <><CloudDownload size={13} /> Download</>}</button>}
        {p && <button className="icon-btn danger" title="Remove from device" onClick={() => remove(c.id)}><Trash2 size={16} /></button>}</div>; })
        : <Empty text="No courses yet. Enroll in a course first, then download it here."><Link className="btn primary small-btn" to="/courses">Explore courses</Link></Empty>}</section></>;
}

/* ------------------------------------------------------------------ statistics */

export function Statistics() {
  const { request } = useAuth();
  const { data, loading, error } = useAsync(() => request("/api/stats/student"), []);
  if (loading) return <Spinner />;
  if (error) return <><PageHeading eyebrow="STATISTICS" title="Your statistics" description="" /><div className="info-box"><WifiOff size={13} /> {error}</div></>;
  const t = data.totals;
  return <><PageHeading eyebrow="STATISTICS" title="Your statistics" description="See how your learning is going and where to focus next." />
    <div className="stats-grid"><StatCard icon={ClipboardList} label="Quizzes taken" value={t.attempts} detail="All attempts" /><StatCard icon={ChartNoAxesCombined} label="Average score" value={`${t.avg_score}%`} detail={`Best: ${t.best_score}%`} /><StatCard icon={CheckCircle2} label="Topics completed" value={t.topics_done} detail="Across all courses" /><StatCard icon={Flame} label="Day streak" value={data.streak} detail={`${t.minutes} min spent in quizzes`} /></div>
    <div className="content-grid"><section className="panel"><div className="panel-heading"><div><h3>Score history</h3><p>Your last {data.history.length} attempts.</p></div></div>
      {data.history.length ? <div className="bars">{data.history.map(h => <div key={h.id} className="bar" title={`${h.title}: ${h.score}%`}><span style={{ height: `${Math.max(4, h.score)}%` }} /><small>{h.score}</small></div>)}</div> : <Empty text="Take a quiz to see your history." />}</section>
      <section className="panel"><div className="panel-heading"><div><h3>Needs attention</h3><p>Chapters where you miss the most questions.</p></div></div>
        {data.weak_areas.length ? data.weak_areas.map(w => <div key={w.title} className="stat-line"><span>{w.title}</span><div className="progress-track"><span style={{ width: `${w.accuracy}%` }} /></div><b>{w.accuracy}%</b></div>) : <Empty text="Answer a few more questions and we'll show where to focus." />}</section></div>
    <section className="panel"><div className="panel-heading"><div><h3>By course</h3></div></div>{data.per_course.map(c => <div key={c.id} className="stat-line"><span>{c.title}</span><div className="progress-track"><span style={{ width: `${c.progress}%` }} /></div><b>{c.progress}% · {c.attempts} quizzes{c.avg_score != null ? ` · avg ${c.avg_score}%` : ""}</b></div>)}</section></>;
}
