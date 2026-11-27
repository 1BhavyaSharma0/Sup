import React, { useState } from "react";
import { Routes, Route, Navigate, Link, useLocation, useNavigate } from "react-router-dom";
import { BookOpen, LayoutDashboard, Compass, FileText, Library, ClipboardList, ChartNoAxesCombined, Download, Settings as SettingsIcon, LogOut, Menu, ArrowUpRight, Sparkles, Wifi, WifiOff, ChevronRight, FileQuestion, GraduationCap, UploadCloud, LoaderCircle, RefreshCw, FolderOpen, Layers } from "lucide-react";
import { useAuth } from "./context";
import { initials } from "./ui";
import { StudentDashboard, Learning, Notes, StudentQuestions, Practice, Quizzes, QuizRun, Downloads, Statistics } from "./pages/student";
import { TeacherDashboard, TeacherCourses, CourseManage, NotesManager, TeacherQuestions, QuizBuilder, Performance, Library as ContentLibrary } from "./pages/teacher";
import { Courses, CourseDetail, Assistant, Settings } from "./pages/common";
import Upload from "./pages/Upload";

export default function App() {
  const { user } = useAuth();
  return <Routes>
    <Route path="/login" element={user ? <Navigate to="/" replace /> : <AuthPage />} />
    <Route path="/register" element={user ? <Navigate to="/" replace /> : <AuthPage register />} />
    <Route path="/*" element={user ? <Shell /> : <Navigate to="/login" replace />} />
  </Routes>;
}

function AuthPage({ register = false }) {
  const { login, register: signup } = useAuth(), nav = useNavigate();
  const [f, setF] = useState({ role: "student", name: "", email: register ? "" : "student@learnsphere.dev", password: register ? "" : "student123", invite_code: "" });
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  async function submit(e) {
    e.preventDefault(); setError(""); setBusy(true);
    try { if (register) await signup(f); else await login(f.email, f.password); nav("/"); } catch (err) { setError(err.offline ? "You need an internet connection to sign in the first time." : err.message); } finally { setBusy(false); }
  }
  return <div className="auth-page"><div className="auth-art"><div className="brand light"><span className="brand-mark"><GraduationCap size={21} /></span> learnsphere</div>
    <div className="art-copy"><span className="eyebrow">LEARN WITHOUT LIMITS</span><h1>Big ideas.<br /><em>Small barriers.</em></h1><p>A calmer, smarter way to learn — with AI by your side and your classroom in your pocket, even offline.</p>
      <div className="art-stats"><div><strong>01</strong><span>Learn at your pace</span></div><div><strong>02</strong><span>Practice with purpose</span></div><div><strong>03</strong><span>Keep learning offline</span></div></div></div>
    <div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" /><div className="art-card"><Sparkles size={17} /><span>YOUR NEXT STEP</span><strong>Revise supervised learning</strong><small>AI recommendation · 8 min</small></div></div>
    <div className="auth-panel"><div className="auth-mobile-brand"><span className="brand-mark"><GraduationCap /></span> learnsphere</div>
      <div className="auth-form-wrap"><span className="eyebrow">{register ? "GET STARTED" : "WELCOME BACK"}</span><h2>{register ? "Create your account" : "Good to see you again."}</h2><p className="muted">{register ? "Your learning journey starts here." : "Pick up right where your curiosity left off."}</p>
        <form onSubmit={submit} className="form-stack">
          {register && <label>Full name<input required value={f.name} onChange={e => set("name", e.target.value)} placeholder="Your name" /></label>}
          <label>Email address<input required type="email" value={f.email} onChange={e => set("email", e.target.value)} placeholder="you@example.com" /></label>
          <label>Password<input required type="password" minLength="8" value={f.password} onChange={e => set("password", e.target.value)} placeholder="At least 8 characters" /></label>
          {register && <label>Account type<select value={f.role} onChange={e => set("role", e.target.value)}><option value="student">Student</option><option value="teacher">Teacher</option></select></label>}
          {register && f.role === "teacher" && <label>Teacher invitation code<input required value={f.invite_code} onChange={e => set("invite_code", e.target.value)} placeholder="Ask your administrator" /></label>}
          {error && <div className="error-box">{error}</div>}
          <button className="btn primary full" disabled={busy}>{busy ? <LoaderCircle className="spin" size={17} /> : register ? "Create account" : "Sign in"} <ArrowUpRight size={17} /></button></form>
        {!register && <div className="demo-box"><strong>Demo accounts</strong><span>Student: student@learnsphere.dev / student123</span><span>Teacher: teacher@learnsphere.dev / teacher123</span></div>}
        <p className="auth-switch">{register ? "Already have an account?" : "New to LearnSphere?"} <Link to={register ? "/login" : "/register"}>{register ? "Sign in" : "Create an account"}</Link></p></div>
      <div className="auth-foot">© 2026 LearnSphere · Made for curious minds</div></div></div>;
}

const studentNav = [
  { label: "OVERVIEW", items: [["Dashboard", LayoutDashboard, "/"], ["Explore courses", Compass, "/courses"], ["My learning", BookOpen, "/learning"]] },
  { label: "STUDY", items: [["Smart notes", FileText, "/notes"], ["Question bank", Library, "/questions"], ["Practice zone", ClipboardList, "/practice"], ["Quizzes", Layers, "/quizzes"], ["AI study assistant", Sparkles, "/assistant"]] },
  { label: "PERSONAL", items: [["My downloads", Download, "/downloads"], ["Statistics", ChartNoAxesCombined, "/statistics"], ["Settings", SettingsIcon, "/settings"]] },
];
const teacherNav = [
  { label: "OVERVIEW", items: [["Dashboard", LayoutDashboard, "/"], ["My courses", BookOpen, "/courses"]] },
  { label: "CONTENT STUDIO", items: [["Notes manager", FileText, "/notes"], ["Question bank", FileQuestion, "/questions"], ["Upload question papers", UploadCloud, "/upload"], ["Content library", FolderOpen, "/content"], ["Quiz builder", Sparkles, "/quiz-builder"]] },
  { label: "INSIGHTS", items: [["Student performance", ChartNoAxesCombined, "/statistics"], ["Settings", SettingsIcon, "/settings"]] },
];

function Shell() {
  const { user, logout, online, pending, syncing, syncNow } = useAuth(), loc = useLocation(), [open, setOpen] = useState(true);
  const isT = user.role === "teacher", nav = isT ? teacherNav : studentNav;
  const active = p => loc.pathname === p || (p !== "/" && loc.pathname.startsWith(p + "/"));
  const title = nav.flatMap(g => g.items).find(i => active(i[2]))?.[0] || "LearnSphere";
  return <div className="app-shell"><aside className={`sidebar ${open ? "" : "collapsed"}`}>
    <Link to="/" className="brand"><span className="brand-mark"><GraduationCap size={21} /></span><span>learn<span className="brand-bold">sphere</span><i>.</i></span></Link>
    <div className="workspace"><div className="workspace-icon">{isT ? "T" : "S"}</div><div><strong>{isT ? "Teaching space" : "My learning space"}</strong><small>{isT ? "Educator workspace" : "Personal workspace"}</small></div></div>
    <nav>{nav.map(g => <div className="nav-group" key={g.label}><span className="nav-label">{g.label}</span>{g.items.map(([label, Icon, path]) => <Link key={path} to={path} className={`nav-link ${active(path) ? "active" : ""}`} title={label} onClick={() => window.innerWidth < 900 && setOpen(false)}><Icon size={18} /><span>{label}</span>{label === "Upload question papers" && <span className="nav-new">AI</span>}{label === "My downloads" && pending > 0 && <span className="nav-new">{pending}</span>}</Link>)}</div>)}</nav>
    <div className="sidebar-bottom"><div className={`connection ${online ? "online" : "offline"}`}>{online ? <Wifi size={15} /> : <WifiOff size={15} />}<span>{online ? "You're online" : "Offline mode"}</span><i /></div>
      <div className="profile-row"><div className="avatar">{initials(user.name)}</div><div className="profile-meta"><strong>{user.name}</strong><small>{isT ? "Teacher account" : "Student account"}</small></div><button className="icon-btn" onClick={logout} title="Sign out"><LogOut size={17} /></button></div></div></aside>
    <main className="main-area"><header className="topbar"><button className="icon-btn mobile-menu" onClick={() => setOpen(!open)}><Menu size={19} /></button>
      <div className="breadcrumbs"><span>Workspace</span><ChevronRight size={14} /><strong>{title}</strong></div>
      <div className="top-actions">{!isT && pending > 0 && <button className="top-status sync" onClick={syncNow} disabled={!online || syncing} title="Sync now"><RefreshCw size={14} className={syncing ? "spin" : ""} /><span>{pending} to sync</span></button>}
        <div className={`top-status ${online ? "" : "is-offline"}`}>{online ? <Wifi size={14} /> : <WifiOff size={14} />}<span>{online ? (pending ? "Online" : "Synced") : "Offline"}</span></div><div className="avatar small">{initials(user.name)}</div></div></header>
      <div className="page-wrap"><Routes>
        <Route index element={isT ? <TeacherDashboard /> : <StudentDashboard />} />
        <Route path="courses" element={isT ? <TeacherCourses /> : <Courses />} />
        <Route path="courses/:id" element={isT ? <CourseManage /> : <CourseDetail />} />
        <Route path="notes" element={isT ? <NotesManager /> : <Notes />} />
        <Route path="questions" element={isT ? <TeacherQuestions /> : <StudentQuestions />} />
        <Route path="statistics" element={isT ? <Performance /> : <Statistics />} />
        <Route path="settings" element={<Settings />} />
        <Route path="assistant" element={<Assistant />} />
        {!isT && <><Route path="learning" element={<Learning />} /><Route path="practice" element={<Practice />} /><Route path="quizzes" element={<Quizzes />} /><Route path="quizzes/:id" element={<QuizRun />} /><Route path="downloads" element={<Downloads />} /></>}
        {isT && <><Route path="content" element={<ContentLibrary />} /><Route path="upload" element={<Upload />} /><Route path="quiz-builder" element={<QuizBuilder />} /></>}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes></div></main></div>;
}
