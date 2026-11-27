import crypto from "crypto";

export const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function rateLimit({ windowMs = 60_000, max = 30, message = "Too many requests. Please wait a moment." } = {}) {
  const hits = new Map();
  setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (v.reset < now) hits.delete(k); }, windowMs).unref();
  return (req, res, next) => {
    const key = req.ip || "unknown";
    const now = Date.now();
    const h = hits.get(key) && hits.get(key).reset > now ? hits.get(key) : { n: 0, reset: now + windowMs };
    h.n++; hits.set(key, h);
    if (h.n > max) return res.status(429).json({ error: message });
    next();
  };
}

export const shuffle = arr => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
export const sample = (arr, n) => shuffle(arr).slice(0, Math.max(0, n));
export const safeEq = (a, b) => { const x = Buffer.from(String(a ?? "")), y = Buffer.from(String(b ?? "")); return x.length === y.length && crypto.timingSafeEqual(x, y); };
export const int = (v, d = 0) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };
export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
export const uuid = () => crypto.randomUUID();
