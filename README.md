# LearnSphere AI — Offline-First E-Learning Platform

React + Node/Express + SQLite (sql.js) + optional Python/OCR service. Teachers upload question papers, review the
extracted questions, and the platform builds quizzes automatically. Students download courses and keep learning
**offline**; attempts and progress sync when the connection returns.

## Quick start

```bash
npm install
copy .env.example .env        # Windows   (macOS/Linux: cp .env.example .env)
npm run dev                   # API on :5000, web app on http://localhost:5173
```

Demo accounts (created on first run unless `SEED_DEMO=false`):

| Role | Email | Password |
|---|---|---|
| Student | student@learnsphere.dev | student123 |
| Teacher | teacher@learnsphere.dev | teacher123 |

Production / offline (PWA) mode — the service worker is only active on a production build:

```bash
npm run build && npm start    # one server on http://localhost:5000 serving the app + API
```

Open it once while online; after that the app shell loads without internet. Install it from the browser menu.

## Feature map (from the project scenario)

| Scenario | Where |
|---|---|
| Upload PDF / DOC / DOCX / TXT, several at once | Teacher → *Upload question papers* (up to 10 files, 15 MB each) |
| Detect MCQ / True-False / Short / **Long** answer | `server/lib/extract.js` (section headings, numbering, marks, verbs like "Explain…") |
| Extract options A–E and **existing answer keys** | Inline `Answer: B`, `Ans:` lines and a trailing "Answer Key" table are matched |
| Never silently use a generated answer | Extracted = *From the paper*. AI answers are *AI suggestion · verify* and stay **pending** (hidden from students) until the teacher confirms |
| Teacher review: edit text/type/options/answer, delete, chapter, difficulty, approve | Review screen with filters (needs attention / duplicates), bulk chapter & difficulty, paging, **Save draft & resume** |
| Bulk import: duplicates, chapter grouping, missing answers | Duplicates flagged across files **and** your existing bank; chapters suggested from your notes; optional AI answer suggestions |
| Only approved questions reach students | `approval_status`; incomplete questions are auto-saved as *pending* |
| Automatic quizzes: Quick 10 / Chapter 20 / Full 50 / Random 15 (configurable) | *Quiz builder → Auto-generate*, defaults in *Settings*; re-running refreshes instead of duplicating |
| Students attempt quizzes without internet | *My downloads* saves a course pack to IndexedDB; quizzes, notes, question bank and practice work offline |
| Student portal (8 sections) / Teacher portal (8 sections) | Dashboard, Explore, My learning, Notes, Question bank, Practice, **Quizzes**, Downloads, Statistics, Settings / Dashboard, My courses, Notes manager, Question bank, Upload, Quiz builder, Student performance, Settings |
| Python processing, PyMuPDF, python-docx, Tesseract OCR | `processor/` (optional service — see below) |
| SQLite | `sql.js` (SQLite compiled to WebAssembly, persisted to `server/data/learnsphere.sqlite`) |

## How offline works

1. **Download** (online): `GET /api/courses/:id/pack` → notes, approved questions, published quizzes and your progress → IndexedDB.
2. **Learn offline**: notes, question bank, practice and quizzes read from the pack.
3. **Record offline**: quiz attempts and topic progress go into a local queue (each attempt has a client UUID).
4. **Sync** (automatic on reconnect, every minute while online, or *Sync now*): `POST /api/sync`. The **server re-grades** every attempt, so the official score is always authoritative. Attempts are idempotent (a retry never creates a duplicate) and progress merges **last-write-wins** by timestamp.

Trade-off, stated plainly: anything stored on a device can be read by its owner. Per course, teachers can switch off
*Answers in offline downloads*; students then still answer offline but see results after syncing. Use online-only
delivery for high-stakes exams.

## Optional: Python processor (scanned PDFs, `.doc`)

```bash
cd processor
pip install -r requirements.txt
# OCR needs the Tesseract program: https://github.com/UB-Mannheim/tesseract/wiki (Windows) or `apt install tesseract-ocr`
# .doc support needs LibreOffice
python app.py                  # http://127.0.0.1:8001
# then set PROCESSOR_URL=http://127.0.0.1:8001 in .env and restart the API
```
Without it the API uses Node parsers (`pdf-parse`, `mammoth`) for text PDFs, DOCX and TXT, and warns when a PDF looks scanned.

## AI features

Set `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL` (any OpenAI-compatible chat endpoint). It powers the study assistant
(grounded in the course notes), *Suggest missing answers*, and *Draft questions (AI)* in the Notes manager.
Without a provider the assistant runs in a clearly labelled demo mode and **no answers are ever invented**.
Question detection itself is rule-based (no model needed) and every result goes through teacher review.

## Security notes

- Teacher sign-up requires `TEACHER_INVITE_CODE`; passwords are hashed (bcrypt); login/upload endpoints are rate-limited.
- Students never receive answers or explanations before attempting (`/api/questions`, quiz play). Answers come from `/answer`, or after submit.
- Uploaded files are content-checked (magic bytes), **deleted right after text extraction**, and never served publicly.
- Every teacher write verifies course/chapter ownership. `JWT_SECRET` must be strong in production (the server refuses to start otherwise).

## Tests

```bash
npm test      # extraction engine + end-to-end API test (security, import, quizzes, sync, performance)
```

## Known limits

- `sql.js` keeps the database in memory and writes the file after changes: ideal for one server process and demos. For many concurrent users move to a server database (the SQL is standard SQLite).
- Fonts load from Google Fonts; offline the app falls back to system fonts.
- The JWT is kept in `localStorage`; use HTTPS in production.

## Production deployment: Vercel + Render

The browser app is deployed to Vercel; the Express API runs as a persistent Node service on Render.
Do not deploy this project as a static-only Vercel app and expect the Express API to start there.

### 1. Deploy the API on Render

1. Push this project to GitHub (the folder containing `package.json`, `server/`, and `src/` must be the service root).
2. In Render, choose **New → Blueprint** and select the repository. Render reads `render.yaml`.
3. The blueprint creates `learnsphere-api` and a persistent disk mounted at `/var/data`. A paid Render instance is required for the persistent disk; do not remove it if you need database records to survive restarts/redeploys.
4. Set `CLIENT_ORIGIN` in the Render service environment to your exact Vercel origin, e.g. `https://your-project.vercel.app` (no trailing slash). Add your custom domain too, comma-separated, if used.
5. Keep the generated `JWT_SECRET` and `TEACHER_INVITE_CODE` values private. Do not commit `.env` or secrets to GitHub.
6. Wait for the service to become healthy at `https://YOUR-RENDER-SERVICE.onrender.com/api/health`.

### 2. Connect Vercel to Render

1. In `vercel.json`, replace `https://YOUR-RENDER-SERVICE.onrender.com` with the actual Render service URL. Keep the `/api/:path*` suffix exactly as shown.
2. Import the same GitHub repository into Vercel. Set the Vercel **Root Directory** to the directory containing `package.json` (if the repository itself contains the app files, use `.`).
3. Use the build command `npm run build` and output directory `dist` (Vercel normally detects Vite automatically).
4. Redeploy. Frontend requests to `/api/...` will be proxied to Render, so the browser can keep using relative API URLs.

### 3. Verify

- Open `https://YOUR-VERCEL-DOMAIN.vercel.app/api/health`. It should return JSON from the Render API.
- Test student/teacher login, course loading, quiz submission, and document upload.
- Demo accounts are seeded only when the database is first created and `SEED_DEMO=true`. Change this to `false` after initial setup if you do not want demo accounts. The demo credentials are listed above; change/remove them before sharing a public production site.

### 4. Database and uploads

`DATA_DIR=/var/data` stores the SQLite database on Render's persistent disk. The service is designed for one API instance because `sql.js` keeps the database in memory and writes it to disk. Do not scale this service to multiple instances. Uploaded originals are temporary and are deleted after extraction; they are not stored on the persistent disk.

### 5. Optional Python OCR processor

The Node API can process text-based PDF, DOCX and TXT files without Python. Scanned PDF OCR and legacy DOC conversion need the optional Python processor plus Tesseract/LibreOffice. Deploy `processor/app.py` as a separate Python web service only if you need those features, then set `PROCESSOR_URL` on the Render Node service to that service's base URL. The optional processor is not required for the main app to run.

### Local development

For local development, keep `CLIENT_ORIGIN=http://localhost:5173`, `DATA_DIR=server/data`, and `UPLOAD_DIR=server/uploads` in your local `.env`. The Vite dev server proxies `/api` to `http://localhost:5000`.
