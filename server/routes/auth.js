import { Router } from "express";
import bcrypt from "bcryptjs";
import { one, run, runc, all } from "../db.js";
import { auth, allow, signToken } from "../lib/auth.js";
import { wrap, rateLimit, safeEq } from "../lib/util.js";
import { DEFAULT_QUIZ_CONFIG } from "../lib/quizgen.js";

const r = Router();
const limiter = rateLimit({ windowMs: 60_000, max: 20, message: "Too many attempts. Please wait a minute and try again." });
const safeUser = u => ({ id: u.id, name: u.name, email: u.email, role: u.role });

r.post("/auth/register", limiter, wrap(async (req, res) => {
  const { password, role = "student", invite_code } = req.body || {};
  const name = String(req.body?.name || "").trim(), email = String(req.body?.email || "").trim().toLowerCase();
  if (!name || !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: "Enter your name and a valid email address." });
  if (!password || String(password).length < 8) return res.status(400).json({ error: "Choose a password of at least 8 characters." });
  if (!["student", "teacher"].includes(role)) return res.status(400).json({ error: "Invalid account role." });
  if (role === "teacher") {
    const code = process.env.TEACHER_INVITE_CODE;
    if (!code || !safeEq(invite_code, code)) return res.status(403).json({ error: "A valid teacher invitation code is required to create a teacher account." });
  }
  if (one("SELECT id FROM users WHERE email=?", [email])) return res.status(409).json({ error: "An account with this email already exists." });
  const id = run("INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,?)", [name, email, await bcrypt.hash(password, 10), role]);
  const user = one("SELECT id,name,email,role FROM users WHERE id=?", [id]);
  res.json({ token: signToken(user), user: safeUser(user) });
}));

r.post("/auth/login", limiter, wrap(async (req, res) => {
  const user = one("SELECT * FROM users WHERE email=?", [String(req.body?.email || "").trim().toLowerCase()]);
  if (!user || !(await bcrypt.compare(String(req.body?.password || ""), user.password_hash))) return res.status(401).json({ error: "Email or password is incorrect." });
  res.json({ token: signToken(user), user: safeUser(user) });
}));

r.get("/auth/me", auth, (req, res) => res.json({ user: safeUser(req.user) }));

r.patch("/auth/profile", auth, (req, res) => {
  const name = String(req.body?.name || "").trim();
  if (name.length < 2) return res.status(400).json({ error: "Enter your name." });
  runc("UPDATE users SET name=? WHERE id=?", [name, req.user.id]);
  res.json({ user: safeUser({ ...req.user, name }) });
});

r.post("/auth/password", auth, limiter, wrap(async (req, res) => {
  const { current, next } = req.body || {};
  const u = one("SELECT * FROM users WHERE id=?", [req.user.id]);
  if (!(await bcrypt.compare(String(current || ""), u.password_hash))) return res.status(400).json({ error: "Your current password is incorrect." });
  if (!next || String(next).length < 8) return res.status(400).json({ error: "The new password must be at least 8 characters." });
  runc("UPDATE users SET password_hash=? WHERE id=?", [await bcrypt.hash(next, 10), req.user.id]);
  res.json({ success: true });
}));

const getSetting = (uid, key, fallback) => { try { const v = one("SELECT value FROM settings WHERE user_id=? AND key=?", [uid, key])?.value; return v ? JSON.parse(v) : fallback; } catch { return fallback; } };
export const teacherDefaults = uid => ({ ...DEFAULT_QUIZ_CONFIG, ...getSetting(uid, "quiz_defaults", {}) });

r.get("/settings", auth, (req, res) => res.json({
  quiz_defaults: req.user.role === "teacher" ? teacherDefaults(req.user.id) : null,
  auto_publish: getSetting(req.user.id, "auto_publish", true),
}));

r.put("/settings", auth, allow("teacher"), (req, res) => {
  const d = req.body?.quiz_defaults || {};
  const clean = Object.fromEntries(Object.keys(DEFAULT_QUIZ_CONFIG).map(k => [k, Math.max(0, Math.min(200, parseInt(d[k], 10) || 0))]));
  const put = (k, v) => run("INSERT INTO settings(user_id,key,value) VALUES(?,?,?) ON CONFLICT(user_id,key) DO UPDATE SET value=excluded.value", [req.user.id, k, JSON.stringify(v)]);
  put("quiz_defaults", clean);
  put("auto_publish", req.body?.auto_publish !== false);
  res.json({ quiz_defaults: clean, auto_publish: req.body?.auto_publish !== false });
});

export default r;
