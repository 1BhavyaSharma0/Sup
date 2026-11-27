import { norm } from "../../shared/grading.js";

const STOP = new Set("a an the of in on at to for and or is are was were be been being what which who whom whose why how when where this that these those it its as by with from into than then so such can could should would will shall may might do does did have has had not no yes you your we our their they them he she his her i me my about between among between give list state name write explain describe define discuss following answer question marks mark".split(" "));

export const tokens = s => norm(s).split(" ").filter(w => w.length > 2 && !STOP.has(w));

export function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

export const fingerprint = q => norm(q.question_text);

/**
 * Flags drafts that duplicate a question already in the bank or earlier in the same batch.
 * existing: [{id, question_text}] ; drafts: [{question_text, ...}] -> adds `duplicate_of`.
 */
export function markDuplicates(drafts, existing, threshold = 0.82) {
  const pool = existing.map(e => ({ kind: "bank", id: e.id, text: e.question_text, fp: fingerprint(e), set: new Set(tokens(e.question_text)) }));
  return drafts.map(d => {
    const fp = fingerprint(d), set = new Set(tokens(d.question_text));
    let hit = null;
    for (const p of pool) {
      if (p.fp === fp || (set.size >= 3 && jaccard(set, p.set) >= threshold)) { hit = p; break; }
    }
    pool.push({ kind: "batch", id: null, text: d.question_text, fp, set });
    return { ...d, duplicate_of: hit ? { kind: hit.kind, id: hit.id, text: hit.text.slice(0, 160) } : null };
  });
}

/**
 * Suggests a chapter for each question by comparing its words with chapter titles,
 * topic titles and notes. Returns null when nothing is a convincing match.
 */
export function suggestChapters(drafts, chapters) {
  const profiles = chapters.map(ch => {
    const title = tokens(ch.title), body = tokens((ch.topics || []).map(t => `${t.title} ${t.content || ""}`).join(" "));
    const weight = new Map();
    for (const w of title) weight.set(w, (weight.get(w) || 0) + 3);
    for (const w of new Set(body)) weight.set(w, (weight.get(w) || 0) + 1);
    return { id: ch.id, weight };
  });
  const df = new Map();
  for (const p of profiles) for (const w of p.weight.keys()) df.set(w, (df.get(w) || 0) + 1);
  return drafts.map(d => {
    const words = new Set(tokens(`${d.question_text} ${(d.options || []).map(o => o.text).join(" ")}`));
    let best = null, second = 0;
    for (const p of profiles) {
      let score = 0;
      for (const w of words) if (p.weight.has(w)) score += p.weight.get(w) / (df.get(w) || 1);
      if (!best || score > best.score) { if (best) second = best.score; best = { id: p.id, score }; }
      else if (score > second) second = score;
    }
    const ok = best && best.score >= 2 && best.score > second * 1.15;
    return { ...d, suggested_chapter_id: ok ? best.id : null };
  });
}
