const configured = () => !!(process.env.AI_BASE_URL && process.env.AI_API_KEY && process.env.AI_MODEL);
export const aiStatus = () => (configured() ? "configured" : "demo");

async function chat(messages, { temperature = 0.3, json = false } = {}) {
  const base = process.env.AI_BASE_URL.replace(/\/$/, "");
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.AI_API_KEY}` },
    body: JSON.stringify({ model: process.env.AI_MODEL, messages, temperature, ...(json ? { response_format: { type: "json_object" } } : {}) }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`AI provider returned ${res.status}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}

const parseJson = text => { try { return JSON.parse(text.replace(/^```(?:json)?|```$/g, "").trim()); } catch { return null; } };

export async function askAI({ prompt, context = "" }) {
  if (configured()) {
    try {
      const answer = await chat([
        { role: "system", content: "You are LearnSphere's study assistant. Be accurate, supportive and concise. Prefer the supplied course context. If the context does not contain the answer, say so clearly and answer from general knowledge only when you are confident." },
        { role: "user", content: `COURSE CONTEXT:\n${context.slice(0, 12000)}\n\nSTUDENT QUESTION:\n${prompt}` },
      ], { temperature: 0.4 });
      return { answer: answer || "I couldn't generate an answer.", source: "ai" };
    } catch (e) { console.error("AI provider error:", e.message); }
  }
  const w = prompt.toLowerCase();
  if (w.includes("machine learning")) return { answer: "Machine learning is a branch of AI where systems learn patterns from examples in data. A typical workflow: collect data, prepare it, choose a model, train it, evaluate it on unseen examples, then use it for predictions.", source: "demo" };
  if (w.includes("supervised")) return { answer: "Supervised learning uses labelled examples: each input is paired with a known answer. Classification predicts a category (spam / not spam); regression predicts a number (a house price).", source: "demo" };
  if (w.includes("overfit")) return { answer: "Overfitting happens when a model memorises noise in the training data, so it scores well on training examples but poorly on new ones. Remedies include more data, simpler models, regularisation and cross-validation.", source: "demo" };
  return { answer: "I'm your LearnSphere study assistant running in demo mode. Open a topic and ask from there so I can use its notes. To get generated answers, configure AI_BASE_URL, AI_API_KEY and AI_MODEL in the server .env file.", source: "demo" };
}

/** Suggested answers are ALWAYS returned as suggestions; the teacher must verify them. Never fabricated in demo mode. */
export async function suggestAnswers(questions) {
  if (!configured()) return { configured: false, suggestions: [] };
  const out = [];
  const queue = [...questions];
  const worker = async () => {
    while (queue.length) {
      const q = queue.shift();
      try {
        const opts = (q.options || []).map(o => `${o.label}. ${o.text}`).join("\n");
        const type = q.question_type;
        const instruction = type === "mcq" ? 'Pick the single correct option. Reply as JSON: {"answer":"<letter>","explanation":"<one sentence>"}'
          : type === "true_false" ? 'Reply as JSON: {"answer":"True" or "False","explanation":"<one sentence>"}'
          : type === "short_answer" ? 'Reply as JSON: {"answer":"<concise answer, max 2 sentences>","explanation":""}'
          : 'Reply as JSON: {"answer":"<model answer in 4-6 sentences>","explanation":""}';
        const text = await chat([
          { role: "system", content: "You help teachers prepare answer keys. Be accurate; if the question is ambiguous, say so in the explanation." },
          { role: "user", content: `Question (${type}): ${q.question_text}\n${opts}\n\n${instruction}` },
        ], { temperature: 0.1, json: true });
        const j = parseJson(text);
        if (j?.answer) out.push({ temp_id: q.temp_id, answer: String(j.answer).trim(), explanation: String(j.explanation || "").trim() });
      } catch (e) { console.error("suggestAnswers:", e.message); }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return { configured: true, suggestions: out };
}

export async function generateQuestions({ title, content, count = 5 }) {
  if (!configured()) return { configured: false, questions: [] };
  const text = await chat([
    { role: "system", content: "You write exam questions strictly from the supplied notes. Never invent facts that are not in the notes." },
    { role: "user", content: `Notes titled "${title}":\n${content.slice(0, 9000)}\n\nWrite ${count} questions (mix of mcq, true_false, short_answer). Reply as JSON: {"questions":[{"question_type":"mcq|true_false|short_answer","question_text":"","options":["","","",""],"answer":"letter for mcq, True/False, or short text","explanation":""}]}` },
  ], { temperature: 0.4, json: true });
  const j = parseJson(text);
  return { configured: true, questions: Array.isArray(j?.questions) ? j.questions : [] };
}
