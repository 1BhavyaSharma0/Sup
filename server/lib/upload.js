import multer from "multer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const uploadDir = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, "..", "uploads"));
fs.mkdirSync(uploadDir, { recursive: true });

export const upload = multer({
  storage: multer.diskStorage({
    destination: (_, __, cb) => cb(null, uploadDir),
    filename: (_, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(16).slice(2)}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 15 * 1024 * 1024, files: 10 },
  fileFilter: (_, file, cb) => cb(/\.(pdf|doc|docx|txt)$/i.test(file.originalname) ? null : new Error("Only PDF, DOC, DOCX and TXT files are supported."), /\.(pdf|doc|docx|txt)$/i.test(file.originalname)),
});

export const removeFile = p => { try { fs.unlinkSync(p); } catch {} };
