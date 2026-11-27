import React from "react";
import { Plus, Trash2, ShieldCheck, Sparkles, FileText } from "lucide-react";
import { answerProblem, needsVerification } from "../../shared/grading.js";
import { Pill } from "../ui";

const LABELS = "ABCDEF";

export function SourceBadge({ q }) {
  if (needsVerification(q)) return <Pill tone="purple"><Sparkles size={11} /> AI suggestion · verify</Pill>;
  if (q.answer_source === "extracted") return <Pill tone="green"><FileText size={11} /> From the paper</Pill>;
  if (q.answer_source === "missing" && !(q.answer_text || (q.options || []).some(o => o.correct))) return <Pill tone="yellow">No answer yet</Pill>;
  return <Pill tone="green"><ShieldCheck size={11} /> Teacher verified</Pill>;
}

/** Edits one question (draft or saved). `onChange(patch)` receives only the changed fields. */
export default function QuestionEditor({ q, onChange, chapters = [], hideChapter = false }) {
  const options = q.options || [];
  const touchAnswer = patch => onChange({ ...patch, answer_source: "teacher", answer_verified: true });
  const setType = type => {
    const patch = { question_type: type };
    if (type === "mcq" && options.length < 2) patch.options = LABELS.slice(0, 4).split("").map(l => ({ label: l, text: "", correct: false }));
    if (type !== "mcq") patch.options = [];
    if (type !== q.question_type) patch.answer_text = "";
    onChange(patch);
  };
  const setOption = (i, patch) => onChange({ options: options.map((o, k) => k === i ? { ...o, ...patch } : o) });
  const problem = answerProblem(q);

  return <div className="qe">
    <textarea className="qe-text" value={q.question_text} onChange={e => onChange({ question_text: e.target.value })} placeholder="Question text" />
    <div className="qe-row">
      <label>Type<select value={q.question_type} onChange={e => setType(e.target.value)}><option value="mcq">MCQ</option><option value="true_false">True / False</option><option value="short_answer">Short answer</option><option value="long_answer">Long answer</option></select></label>
      <label>Difficulty<select value={q.difficulty} onChange={e => onChange({ difficulty: e.target.value })}><option>Easy</option><option>Medium</option><option>Hard</option></select></label>
      <label>Marks<input type="number" min="1" max="20" value={q.marks || 1} onChange={e => onChange({ marks: Number(e.target.value) })} /></label>
      {!hideChapter && <label>Chapter<select value={q.chapter_id || ""} onChange={e => onChange({ chapter_id: e.target.value ? Number(e.target.value) : null })}><option value="">Unassigned</option>{chapters.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}</select></label>}
    </div>

    {q.question_type === "mcq" && <div className="qe-options">
      {options.map((o, i) => <div className="draft-option" key={i}>
        <span>{o.label || LABELS[i]}</span>
        <input value={o.text} placeholder={`Option ${LABELS[i]}`} onChange={e => setOption(i, { text: e.target.value })} />
        <label className="correct-check"><input type="radio" checked={!!o.correct} onChange={() => touchAnswer({ options: options.map((v, k) => ({ ...v, correct: k === i })) })} /> Correct</label>
        {options.length > 2 && <button className="icon-btn danger" title="Remove option" onClick={() => onChange({ options: options.filter((_, k) => k !== i).map((v, k) => ({ ...v, label: LABELS[k] })) })}><Trash2 size={14} /></button>}
      </div>)}
      {options.length < 6 && <button className="text-link" onClick={() => onChange({ options: [...options, { label: LABELS[options.length], text: "", correct: false }] })}><Plus size={13} /> Add option</button>}
    </div>}

    {q.question_type === "true_false" && <div className="qe-tf">{["True", "False"].map(v => <label key={v} className="correct-check"><input type="radio" checked={q.answer_text === v} onChange={() => touchAnswer({ answer_text: v })} /> {v}</label>)}</div>}
    {q.question_type === "short_answer" && <label className="qe-field">Expected answer <small>(separate accepted alternatives with |)</small><input value={q.answer_text || ""} onChange={e => touchAnswer({ answer_text: e.target.value })} placeholder="e.g. mean squared error | MSE" /></label>}
    {q.question_type === "long_answer" && <label className="qe-field">Model answer <small>(optional — students self-check against it; not auto-graded)</small><textarea value={q.answer_text || ""} onChange={e => touchAnswer({ answer_text: e.target.value })} /></label>}
    <label className="qe-field">Explanation <small>(optional, shown after the attempt)</small><input value={q.explanation || ""} onChange={e => onChange({ explanation: e.target.value })} /></label>

    <div className="qe-foot">
      <SourceBadge q={q} />
      {needsVerification(q) && <button className="btn outline small-btn" onClick={() => onChange({ answer_source: "teacher", answer_verified: true })}><ShieldCheck size={13} /> I verified this answer</button>}
      {problem && <span className="qe-problem">{problem} <em>It will be saved as pending.</em></span>}
    </div>
  </div>;
}
