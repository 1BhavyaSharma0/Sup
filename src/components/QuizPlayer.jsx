import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, CheckCircle2, ChevronLeft, ChevronRight, Clock3, RotateCcw, X, WifiOff, CircleHelp } from "lucide-react";
import { typeLabel } from "../ui";

const fmt = s => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

export function QuizResult({ result, onRetry, onExit, exitLabel = "Back to quizzes" }) {
  const [open, setOpen] = useState(null);
  const pct = result.percentage ?? 0;
  const graded = result.total ?? 0;
  const tone = pct >= 75 ? "good" : pct >= 50 ? "mid" : "low";
  return <div className="result-view">
    {result.provisional && <div className="info-box">{result.hasKey
      ? <><WifiOff size={13} /> Scored on your device. Your teacher's record is updated when you're back online — the official score may differ slightly.</>
      : <><WifiOff size={13} /> Your answers are saved on this device. They will be marked automatically when you reconnect.</>}</div>}
    {(graded > 0 || !result.provisional) ? <>
      <div className={`ring ${tone}`} style={{ "--p": pct }}><strong>{pct}%</strong></div>
      <span className="eyebrow">{graded ? "QUIZ COMPLETE" : "SUBMITTED"}</span>
      <p>{graded ? `${result.score} of ${graded} auto-graded question${graded === 1 ? "" : "s"} correct.` : "Nothing in this attempt can be auto-graded."}</p>
    </> : <><div className="result-badge"><CheckCircle2 size={34} /></div><h2>Saved</h2></>}
    {result.long_count > 0 && <p className="muted">{result.long_count} long-answer question{result.long_count === 1 ? "" : "s"} aren't auto-graded — compare your answer with the model answer below.</p>}
    {result.reviewed?.length > 0 && result.reviewed.some(r => r.correct_answer || r.correct !== null) && <div className="review-list">
      {result.reviewed.map((r, i) => {
        const status = r.correct === null ? (r.correct_answer ? "check" : "none") : r.correct ? "ok" : "bad";
        const yours = r.question_type === "mcq" ? (r.options.find(o => o.label === r.your_answer)?.text ? `${r.your_answer}. ${r.options.find(o => o.label === r.your_answer).text}` : r.your_answer) : r.your_answer;
        return <div key={r.question_id} className={`review-item ${status}`}>
          <button onClick={() => setOpen(open === i ? null : i)}>
            {status === "ok" ? <CheckCircle2 size={16} /> : status === "bad" ? <X size={16} /> : <CircleHelp size={16} />}
            <span>{i + 1}. {r.question_text}</span><ChevronRight size={15} className={open === i ? "turn" : ""} />
          </button>
          {open === i && <div className="review-body">
            <p><b>Your answer:</b> {yours || <i>No answer</i>}</p>
            {r.correct_answer && <p><b>{r.question_type === "long_answer" ? "Model answer:" : "Correct answer:"}</b> {r.correct_answer}</p>}
            {r.explanation && <p className="muted">{r.explanation}</p>}
          </div>}
        </div>;
      })}
    </div>}
    <div className="result-actions">{onRetry && <button className="btn outline" onClick={onRetry}><RotateCcw size={15} /> Try again</button>}<button className="btn primary" onClick={onExit}>{exitLabel} <ArrowUpRight size={15} /></button></div>
  </div>;
}

/** One question at a time, with a palette, optional countdown, and auto-submit when time runs out. */
export default function QuizPlayer({ title, questions, durationMin = 0, onSubmit, onExit, onRetry, exitLabel }) {
  const [i, setI] = useState(0);
  const [answers, setAnswers] = useState({});
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [left, setLeft] = useState(durationMin ? durationMin * 60 : null);
  const started = useRef(Date.now());
  const latest = useRef(answers); latest.current = answers;
  const done = useRef(false);

  const submit = async () => {
    if (done.current) return; done.current = true; setBusy(true); setError("");
    try { setResult(await onSubmit(latest.current, { duration_sec: Math.round((Date.now() - started.current) / 1000), question_ids: questions.map(q => q.id) })); }
    catch (e) { done.current = false; setError(e.message); } finally { setBusy(false); }
  };
  useEffect(() => {
    if (left === null || result) return;
    if (left <= 0) { submit(); return; }
    const t = setTimeout(() => setLeft(l => l - 1), 1000);
    return () => clearTimeout(t);
  }, [left, result]); // eslint-disable-line

  const q = questions[i];
  const answered = useMemo(() => questions.filter(x => (answers[x.id] ?? "").toString().trim()).length, [answers, questions]);
  if (result) return <div className="quiz-wrap panel"><QuizResult result={result} onRetry={onRetry} onExit={onExit} exitLabel={exitLabel} /></div>;
  if (!q) return null;
  const set = v => setAnswers(a => ({ ...a, [q.id]: v }));
  const confirmSubmit = () => { if (answered < questions.length && !window.confirm(`You've answered ${answered} of ${questions.length}. Submit anyway?`)) return; submit(); };

  return <div className="quiz-wrap panel">
    <div className="player-top"><div><span className="eyebrow">{title}</span><strong>Question {i + 1} of {questions.length}</strong></div>
      {left !== null && <div className={`timer ${left < 60 ? "low" : ""}`}><Clock3 size={14} /> {fmt(Math.max(0, left))}</div>}</div>
    <div className="progress-track wide"><span style={{ width: `${(answered / questions.length) * 100}%` }} /></div>
    <div className="quiz-question">
      <div className="quiz-q-meta"><span>{typeLabel(q.question_type).toUpperCase()}{q.marks > 1 ? ` · ${q.marks} MARKS` : ""}</span><span className="pill orange">{q.difficulty}</span></div>
      <h3>{q.question_text}</h3>
      {q.question_type === "mcq" && q.options.map(o => <button key={o.label} className={`quiz-option ${answers[q.id] === o.label ? "chosen" : ""}`} onClick={() => set(o.label)}><span>{o.label}</span>{o.text}</button>)}
      {q.question_type === "true_false" && <div className="answer-options">{["True", "False"].map(v => <button key={v} className={`quiz-option ${answers[q.id] === v ? "chosen" : ""}`} onClick={() => set(v)}>{v}</button>)}</div>}
      {q.question_type === "short_answer" && <input className="answer-input" value={answers[q.id] || ""} onChange={e => set(e.target.value)} placeholder="Type your answer" />}
      {q.question_type === "long_answer" && <textarea className="answer-input long" value={answers[q.id] || ""} onChange={e => set(e.target.value)} placeholder="Write your answer. You'll compare it with the model answer afterwards." />}
    </div>
    <div className="palette">{questions.map((x, k) => <button key={x.id} className={`${k === i ? "current" : ""} ${(answers[x.id] ?? "").toString().trim() ? "filled" : ""}`} onClick={() => setI(k)}>{k + 1}</button>)}</div>
    {error && <div className="error-box">{error}</div>}
    <div className="quiz-footer">
      <button className="btn outline" disabled={i === 0} onClick={() => setI(i - 1)}><ChevronLeft size={15} /> Previous</button>
      <span>{answered} of {questions.length} answered</span>
      {i < questions.length - 1 ? <button className="btn primary" onClick={() => setI(i + 1)}>Next <ChevronRight size={15} /></button>
        : <button className="btn primary" disabled={busy} onClick={confirmSubmit}>{busy ? "Submitting…" : "Submit"} <ArrowUpRight size={15} /></button>}
    </div>
    {i < questions.length - 1 && <div className="finish-row"><button className="text-link" onClick={confirmSubmit} disabled={busy}>Finish now</button></div>}
  </div>;
}
