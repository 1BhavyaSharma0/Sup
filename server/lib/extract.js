import fs from "fs";
import path from "path";
import pdf from "pdf-parse/lib/pdf-parse.js";
import mammoth from "mammoth";

/* ------------------------------------------------------------------ text extraction */

const SIGNATURES = { pdf: [0x25, 0x50, 0x44, 0x46], docx: [0x50, 0x4b], doc: [0xd0, 0xcf, 0x11, 0xe0] };

/** Rejects files whose content does not match their extension (e.g. an .exe renamed to .pdf). */
export function verifyFileType(filePath, ext) {
  const head = Buffer.alloc(8);
  const fd = fs.openSync(filePath, "r");
  fs.readSync(fd, head, 0, 8, 0);
  fs.closeSync(fd);
  if (ext === "txt") return !head.includes(0);
  const sig = SIGNATURES[ext];
  return !!sig && sig.every((b, i) => head[i] === b);
}

async function viaProcessor(file) {
  const base = process.env.PROCESSOR_URL;
  if (!base) return null;
  try {
    const form = new FormData();
    form.append("file", new Blob([fs.readFileSync(file.path)]), file.originalname);
    const res = await fetch(`${base.replace(/\/$/, "")}/extract`, { method: "POST", body: form, signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Processor returned ${res.status}`);
    const data = await res.json();
    return { text: data.text || "", ocr_used: !!data.ocr_used, method: "python" };
  } catch (e) {
    console.error("Python processor unavailable:", e.message);
    return { error: e.message };
  }
}

export async function extractText(file) {
  const ext = path.extname(file.originalname).toLowerCase().slice(1);
  const remote = await viaProcessor(file);
  if (remote && !remote.error) return remote;
  if (ext === "doc") throw new Error("Legacy .doc files need the Python processor (LibreOffice). Save the file as .docx, or start the processor service.");
  if (ext === "pdf") {
    const data = await pdf(fs.readFileSync(file.path));
    const text = data.text || "";
    const perPage = text.replace(/\s/g, "").length / Math.max(1, data.numpages || 1);
    return { text, ocr_used: false, method: "node", scanned: perPage < 40 };
  }
  if (ext === "docx") return { text: (await mammoth.extractRawText({ path: file.path })).value || "", ocr_used: false, method: "node" };
  if (ext === "txt") return { text: fs.readFileSync(file.path, "utf8"), ocr_used: false, method: "node" };
  throw new Error("Supported formats: PDF, DOC, DOCX and TXT.");
}

/* ------------------------------------------------------------------ question detection */

const START = /^(?:Q(?:uestion)?\.?\s*)?\(?(\d{1,3})[.):]\s*(.+)$/i;
const OPTION = /^\(?([A-Ea-e])[).:]\s*(.+)$/;
const INLINE_OPT = /(?:^|\s)\(?([A-Ea-e])[).]\s+/g;
const ANSWER_LINE = /^(?:correct\s+)?(?:ans(?:wer)?|key|solution)\s*(?:is)?\s*[:\-–.]\s*(.+)$/i;
const KEY_HEADING = /^(?:answer\s*key|answers?|answer\s*sheet|solutions?|key)\s*[:\-–]?\s*$/i;
const MARKS = /[\[(]\s*(\d{1,2})\s*marks?\s*[\])]|\b(\d{1,2})\s*marks?\b\s*$/i;
const SECTION = [
  [/multiple\s*choice|\bmcqs?\b|objective/i, "mcq"],
  [/true\s*(?:or|\/|and)\s*false|\bt\/f\b/i, "true_false"],
  [/long\s*(?:answer|question)|essay|descriptive|detailed/i, "long_answer"],
  [/short\s*(?:answer|question)|very\s*short|fill\s*in|one\s*word/i, "short_answer"],
];
const LONG_VERBS = /\b(explain|describe|discuss|derive|compare|differentiate|elaborate|analy[sz]e|evaluate|justify|illustrate|critically|with\s+(?:a\s+)?(?:suitable\s+)?(?:example|diagram)s?|write\s+(?:a\s+)?(?:short\s+)?(?:note|essay|program|algorithm|code)|distinguish|outline|summari[sz]e)\b/i;

function splitAnswerKey(lines) {
  let idx = -1;
  lines.forEach((l, i) => { if (KEY_HEADING.test(l) && i > lines.length * 0.3) idx = i; });
  if (idx < 0) return { body: lines, key: {} };
  const key = {};
  const text = lines.slice(idx + 1).join(" ");
  for (const m of text.matchAll(/(?:^|\s)\(?(\d{1,3})\)?\s*[.):\-–]?\s*\(?([A-Ea-e]|true|false|t|f)\)?(?=\s|,|;|$)/gi)) key[Number(m[1])] = m[2];
  return Object.keys(key).length ? { body: lines.slice(0, idx), key } : { body: lines, key: {} };
}

function parseOptions(blockLines) {
  const options = [];
  const rest = [];
  for (const line of blockLines) {
    const m = line.match(OPTION);
    if (m && (options.length || m[1].toUpperCase() === "A")) {
      // a line such as "A) x B) y C) z D) w"
      const parts = line.split(INLINE_OPT);
      if (parts.length > 3) {
        for (let i = 1; i < parts.length; i += 2) options.push({ label: parts[i].toUpperCase(), text: (parts[i + 1] || "").trim() });
        continue;
      }
      options.push({ label: m[1].toUpperCase(), text: m[2].trim() });
    } else if (options.length && !ANSWER_LINE.test(line)) {
      options[options.length - 1].text += " " + line;          // wrapped option text
    } else rest.push(line);
  }
  return { options, rest };
}

function inlineOptions(text) {
  const marks = [...text.matchAll(INLINE_OPT)];
  if (marks.length < 2 || marks[0][1].toUpperCase() !== "A") return null;
  for (let i = 1; i < marks.length; i++) if (marks[i][1].toUpperCase().charCodeAt(0) !== marks[i - 1][1].toUpperCase().charCodeAt(0) + 1) return null;
  const options = marks.map((m, i) => ({
    label: m[1].toUpperCase(),
    text: text.slice(m.index + m[0].length, i + 1 < marks.length ? marks[i + 1].index : undefined).trim(),
  }));
  return { stem: text.slice(0, marks[0].index).trim(), options };
}

function classify({ stem, options, answerRaw, hint, marks }) {
  if (options.length >= 2) return "mcq";
  if (/\b(true\s*(?:or|\/)\s*false|state\s+whether.*\b(?:true|false))\b/i.test(stem) || /^(true|false)\.?$/i.test((answerRaw || "").trim())) return "true_false";
  if (hint === "true_false") return "true_false";
  if (hint === "long_answer" || (marks && marks >= 5)) return "long_answer";
  if (hint === "short_answer") return LONG_VERBS.test(stem) && stem.split(/\s+/).length > 14 ? "long_answer" : "short_answer";
  if (LONG_VERBS.test(stem) || stem.split(/\s+/).length > 45) return "long_answer";
  return "short_answer";
}

function build(block, number, key, hint) {
  let { first, lines } = block;
  let { options, rest } = parseOptions(lines);
  let stem = [first, ...rest].join(" ").replace(/\s+/g, " ").trim();
  let answerRaw = "";

  // Answers written inside the block: "Answer: B" or "Ans - Photosynthesis"
  const inlineAns = stem.match(/(?:^|\s)(?:correct\s+)?(?:ans(?:wer)?|solution)\s*(?:is)?\s*[:\-–]\s*(.+)$/i);
  if (inlineAns) { answerRaw = inlineAns[1].trim(); stem = stem.slice(0, inlineAns.index).trim(); }
  for (let i = options.length - 1; i >= 0; i--) {
    const m = options[i].text.match(/(?:^|\s)(?:correct\s+)?(?:ans(?:wer)?|solution)\s*(?:is)?\s*[:\-–]\s*(.+)$/i);
    if (m) { answerRaw = m[1].trim(); options[i].text = options[i].text.slice(0, m.index).trim(); }
  }
  for (const line of lines) { const m = line.match(ANSWER_LINE); if (m && !answerRaw) answerRaw = m[1].trim(); }

  if (!options.length) { const inl = inlineOptions(stem); if (inl) { stem = inl.stem; options = inl.options; } }
  options = options.filter(o => o.text);

  let marks = null;
  const mm = stem.match(MARKS);
  if (mm) { marks = Number(mm[1] || mm[2]); stem = stem.replace(MARKS, "").replace(/\s+/g, " ").trim(); }
  stem = stem.replace(/\s*[\[(]\s*(?:co|bt|l)\s*\d\s*[\])]\s*$/i, "").trim();

  const type = classify({ stem, options, answerRaw: answerRaw || key[number] || "", hint, marks });
  let answer = answerRaw || (key[number] ? String(key[number]) : "");
  let source = answer ? "extracted" : "missing";
  let answer_text = "";

  if (type === "mcq") {
    const letter = (answer.match(/^\(?([A-Ea-e])\)?\b/) || [])[1]?.toUpperCase();
    if (letter) { options = options.map(o => ({ ...o, correct: o.label === letter })); answer_text = letter; }
    else if (answer) { // answer written as the option text
      const hit = options.find(o => o.text.toLowerCase() === answer.toLowerCase());
      if (hit) { options = options.map(o => ({ ...o, correct: o === hit })); answer_text = hit.label; } else source = "missing";
    }
    options = options.map(o => ({ ...o, correct: !!o.correct }));
    if (!options.some(o => o.correct)) source = "missing";
  } else if (type === "true_false") {
    const v = answer.toLowerCase().trim();
    answer_text = /^(t|true)\b/.test(v) ? "True" : /^(f|false)\b/.test(v) ? "False" : "";
    if (!answer_text) source = "missing";
  } else answer_text = answer;

  let confidence = type === "mcq" ? (options.length >= 4 ? 0.9 : 0.8) : /\?$/.test(stem) || /^(define|explain|describe|what|why|how|which|state|list|write|name|differentiate|compare|discuss)\b/i.test(stem) ? 0.82 : 0.65;
  if (stem.length < 15) confidence -= 0.15;
  if (stem.length > 600) confidence -= 0.15;
  if (source === "extracted") confidence = Math.min(0.97, confidence + 0.05);

  return {
    question_text: stem, question_type: type, difficulty: "Medium", marks: marks || (type === "long_answer" ? 5 : 1),
    options: type === "mcq" ? options : [], answer_text, answer_source: source, answer_verified: source === "extracted" ? 0 : 1,
    explanation: "", confidence: Math.max(0.3, Math.round(confidence * 100) / 100), section: hint || null,
  };
}

export function detectQuestions(rawText) {
  const text = String(rawText || "").replace(/\r/g, "\n").replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ");
  const allLines = text.split("\n").map(s => s.trim()).filter(Boolean);
  const { body: lines, key } = splitAnswerKey(allLines);

  const blocks = [];
  let hint = null, current = null;
  for (const line of lines) {
    const m = line.match(START);
    if (m && !(m[2].length < 3)) {
      current = { number: Number(m[1]), first: m[2], lines: [], hint };
      blocks.push(current);
      continue;
    }
    const sec = SECTION.find(([re]) => re.test(line));
    const isHeading = (/^(section|part|unit|group)\b/i.test(line) || (line.length < 90 && !/[?]$/.test(line) && !OPTION.test(line))) && sec;
    if (isHeading) { hint = sec[1]; current = null; continue; }
    if (/^(section|part)\s+[A-Z0-9]+\b/i.test(line) && line.length < 90) { hint = null; current = null; continue; }
    if (current) current.lines.push(line);
  }

  let drafts = blocks.map(b => build(b, b.number, key, b.hint)).filter(q => q.question_text.length > 8);

  if (!drafts.length) { // unnumbered paper: fall back to paragraphs that look like questions
    const chunks = text.split(/\n\s*\n/).map(s => s.replace(/\s+/g, " ").trim()).filter(s => s.length > 15);
    drafts = chunks.filter(c => c.endsWith("?") || /^(explain|define|describe|what|why|how|which|write|state|list|name|discuss|differentiate|compare)\b/i.test(c))
      .map(c => build({ first: c, lines: [] }, -1, {}, null)).map(q => ({ ...q, confidence: Math.min(q.confidence, 0.6) }));
  }
  return drafts.map((q, i) => ({ ...q, temp_id: i }));
}

export const countByType = qs => qs.reduce((a, q) => ({ ...a, [q.question_type]: (a[q.question_type] || 0) + 1 }), {});
