import "dotenv/config";
import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { initDb } from "./db.js";
import { seedDemo } from "./seed.js";
import authRoutes from "./routes/auth.js";
import contentRoutes from "./routes/content.js";
import questionRoutes from "./routes/questions.js";
import documentRoutes from "./routes/documents.js";
import quizRoutes from "./routes/quizzes.js";
import insightRoutes from "./routes/insights.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = process.env.PORT || 5000;
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use((_, res, next) => {
  res.set({ "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "same-origin" });
  next();
});
const allowedOrigins = (process.env.CLIENT_ORIGIN || "http://localhost:5173")
  .split(",").map(origin => origin.trim()).filter(Boolean);
app.use(cors({
  origin(origin, callback) {
    // Requests from server-to-server tools and same-origin Vercel rewrites have no Origin header.
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("Origin is not allowed by CORS."));
  },
  credentials: false,
}));
app.use(express.json({ limit: "8mb" }));

// Uploaded originals are deleted after text extraction and are never served publicly.
for (const router of [authRoutes, contentRoutes, questionRoutes, documentRoutes, quizRoutes, insightRoutes]) app.use("/api", router);
app.use("/api", (_, res) => res.status(404).json({ error: "Not found." }));

const dist = path.resolve(__dirname, "..", "dist");
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { index: false, maxAge: "1h" }));
  app.get("*", (_, res) => res.sendFile(path.join(dist, "index.html")));
}

app.use((err, req, res, next) => {
  if (err.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: "That file is larger than 15 MB." });
  if (err.code === "LIMIT_FILE_COUNT" || err.code === "LIMIT_UNEXPECTED_FILE") return res.status(400).json({ error: "You can upload up to 10 files at a time." });
  if (err.type === "entity.too.large") return res.status(413).json({ error: "That request is too large." });
  const status = err.status || (err.name === "MulterError" || /Only PDF/.test(err.message) ? 400 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? "Something went wrong on the server." : err.message });
});

await initDb();
seedDemo();
export { app };
if (!process.env.NO_LISTEN) app.listen(port, () => console.log(`LearnSphere API running at http://localhost:${port}`));
