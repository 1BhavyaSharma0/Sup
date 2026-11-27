import jwt from "jsonwebtoken";
import { one } from "../db.js";

const DEV_SECRET = "development-secret-change-this-please-123456";
const secret = process.env.JWT_SECRET || DEV_SECRET;
if (process.env.NODE_ENV === "production" && (secret === DEV_SECRET || secret.length < 32 || secret.startsWith("replace-this"))) {
  throw new Error("Set a strong JWT_SECRET (32+ characters) before running in production.");
}

export const signToken = u => jwt.sign({ id: u.id, role: u.role }, secret, { expiresIn: "7d" });

export function auth(req, res, next) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ error: "Please sign in to continue." });
  try {
    const payload = jwt.verify(token, secret);
    const user = one("SELECT id,name,email,role FROM users WHERE id=?", [payload.id]);
    if (!user) return res.status(401).json({ error: "Account not found." });
    req.user = user;
    next();
  } catch { res.status(401).json({ error: "Your session has expired. Please sign in again." }); }
}

export const allow = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : res.status(403).json({ error: "You don't have permission to access this resource." });

export const ownCourse = (courseId, userId) =>
  one("SELECT * FROM courses WHERE id=? AND teacher_id=?", [courseId, userId]);
