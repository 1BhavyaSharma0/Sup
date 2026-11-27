import React, { useEffect, useState } from "react";
import { BookOpen, X, LoaderCircle } from "lucide-react";

export const PageHeading = ({ eyebrow, title, description, action }) => <div className="page-heading"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>{action}</div>;
export const StatCard = ({ icon: Icon, label, value, detail, trend }) => <div className="stat-card"><div className="stat-top"><span className="stat-icon"><Icon size={18} /></span>{trend && <span className="trend">{trend}</span>}</div><strong>{value}</strong><span className="stat-label">{label}</span><small>{detail}</small></div>;
export const Empty = ({ text, children }) => <div className="empty-state"><div><BookOpen size={21} /></div><p>{text}</p>{children}</div>;
export const Spinner = ({ text = "Loading…" }) => <div className="loading"><LoaderCircle className="spin" size={18} /> {text}</div>;
export const Pill = ({ tone = "", children, title }) => <span className={`pill ${tone}`} title={title}>{children}</span>;
export const Notice = ({ kind = "info", children, onClose }) => children ? <div className={`${kind}-box`}>{children}{onClose && <button onClick={onClose}>×</button>}</div> : null;

export function Modal({ title, onClose, children, wide }) {
  useEffect(() => { const k = e => e.key === "Escape" && onClose(); window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  return <div className="modal-backdrop" onMouseDown={onClose}><div className={`modal ${wide ? "wide" : ""}`} onMouseDown={e => e.stopPropagation()}><div className="modal-head"><h3>{title}</h3><button className="icon-btn" onClick={onClose}><X size={18} /></button></div>{children}</div></div>;
}

export const Tabs = ({ tabs, value, onChange }) => <div className="tabs">{tabs.map(([id, label, count]) => <button key={id} className={value === id ? "active" : ""} onClick={() => onChange(id)}>{label}{count !== undefined && <span>{count}</span>}</button>)}</div>;

export function Pager({ page, pages, onChange }) {
  if (pages <= 1) return null;
  return <div className="pager"><button className="btn outline small-btn" disabled={page <= 1} onClick={() => onChange(page - 1)}>Previous</button><span>Page {page} of {pages}</span><button className="btn outline small-btn" disabled={page >= pages} onClick={() => onChange(page + 1)}>Next</button></div>;
}

/** Tiny dependency-free markdown: headings, bullets, numbered lists, **bold**, `code`. */
function inline(text) {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((p, i) => p.startsWith("**") ? <strong key={i}>{p.slice(2, -2)}</strong> : p.startsWith("`") ? <code key={i}>{p.slice(1, -1)}</code> : p);
}
export function Markdown({ text = "" }) {
  const out = []; let list = null;
  const flush = () => { if (list) { out.push(list.ordered ? <ol key={out.length}>{list.items}</ol> : <ul key={out.length}>{list.items}</ul>); list = null; } };
  text.split("\n").forEach((raw, i) => {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/), num = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (bullet || num) { const ordered = !!num; if (!list || list.ordered !== ordered) { flush(); list = { ordered, items: [] }; } list.items.push(<li key={i}>{inline((bullet || num)[1])}</li>); return; }
    flush();
    if (/^#{1,2}\s/.test(line)) out.push(<h3 key={i}>{line.replace(/^#+\s*/, "")}</h3>);
    else if (/^#{3,}\s/.test(line)) out.push(<h4 key={i}>{line.replace(/^#+\s*/, "")}</h4>);
    else if (line.trim()) out.push(<p key={i}>{inline(line)}</p>);
  });
  flush();
  return <div className="note-content">{out}</div>;
}

export const fmtDate = s => { try { return new Date(String(s).includes("T") ? s : String(s).replace(" ", "T") + "Z").toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }); } catch { return ""; } };
export const initials = n => (n || "?").split(" ").map(x => x[0]).slice(0, 2).join("").toUpperCase();
export const typeLabel = t => ({ mcq: "MCQ", true_false: "True / False", short_answer: "Short answer", long_answer: "Long answer" }[t] || t);

export function useAsync(fn, deps = []) {
  const [state, set] = useState({ data: null, error: "", loading: true });
  const reload = () => { set(s => ({ ...s, loading: true })); return fn().then(data => set({ data, error: "", loading: false })).catch(e => set({ data: null, error: e.message, loading: false })); };
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, deps);
  return { ...state, reload, setData: data => set(s => ({ ...s, data })) };
}
