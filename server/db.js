import initSqlJs from "sql.js";
import fs from "fs";
import path from "path";

const dataDir = path.resolve(process.env.DATA_DIR || "server/data");
const dbPath = path.join(dataDir, "learnsphere.sqlite");
fs.mkdirSync(dataDir, { recursive: true });

let db, SQL, txDepth = 0, saveTimer = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('student','teacher','admin')),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS settings (
  user_id INTEGER NOT NULL, key TEXT NOT NULL, value TEXT, PRIMARY KEY(user_id,key),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS courses (
  id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, description TEXT, category TEXT,
  level TEXT DEFAULT 'Beginner', teacher_id INTEGER, published INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(teacher_id) REFERENCES users(id));
CREATE TABLE IF NOT EXISTS chapters (
  id INTEGER PRIMARY KEY AUTOINCREMENT, course_id INTEGER NOT NULL, title TEXT NOT NULL, position INTEGER DEFAULT 0,
  FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS topics (
  id INTEGER PRIMARY KEY AUTOINCREMENT, chapter_id INTEGER NOT NULL, title TEXT NOT NULL, content TEXT,
  position INTEGER DEFAULT 0, FOREIGN KEY(chapter_id) REFERENCES chapters(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, course_id INTEGER, chapter_id INTEGER, topic_id INTEGER,
  question_text TEXT NOT NULL, question_type TEXT DEFAULT 'mcq', difficulty TEXT DEFAULT 'Medium',
  answer_text TEXT, answer_source TEXT DEFAULT 'teacher', explanation TEXT, source_document TEXT,
  approval_status TEXT DEFAULT 'approved', created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(course_id) REFERENCES courses(id), FOREIGN KEY(chapter_id) REFERENCES chapters(id),
  FOREIGN KEY(topic_id) REFERENCES topics(id), FOREIGN KEY(created_by) REFERENCES users(id));
CREATE TABLE IF NOT EXISTS options (
  id INTEGER PRIMARY KEY AUTOINCREMENT, question_id INTEGER NOT NULL, option_label TEXT, option_text TEXT NOT NULL,
  is_correct INTEGER DEFAULT 0, FOREIGN KEY(question_id) REFERENCES questions(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT, teacher_id INTEGER NOT NULL, file_name TEXT NOT NULL, stored_name TEXT NOT NULL,
  extracted_text TEXT, status TEXT DEFAULT 'processed', created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(teacher_id) REFERENCES users(id));
CREATE TABLE IF NOT EXISTS enrollments (
  id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER NOT NULL, course_id INTEGER NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(student_id,course_id),
  FOREIGN KEY(student_id) REFERENCES users(id), FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS quizzes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, course_id INTEGER NOT NULL, chapter_id INTEGER, title TEXT NOT NULL,
  kind TEXT DEFAULT 'custom', mode TEXT DEFAULT 'practice', question_count INTEGER DEFAULT 10,
  difficulty TEXT, duration_min INTEGER DEFAULT 0, published INTEGER DEFAULT 0, auto INTEGER DEFAULT 0,
  created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS quiz_questions (
  quiz_id INTEGER NOT NULL, question_id INTEGER NOT NULL, position INTEGER DEFAULT 0, PRIMARY KEY(quiz_id,question_id),
  FOREIGN KEY(quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE, FOREIGN KEY(question_id) REFERENCES questions(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS quiz_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER NOT NULL, course_id INTEGER, title TEXT,
  score INTEGER DEFAULT 0, total INTEGER DEFAULT 0, answers_json TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(student_id) REFERENCES users(id));
CREATE TABLE IF NOT EXISTS attempt_answers (
  id INTEGER PRIMARY KEY AUTOINCREMENT, attempt_id INTEGER NOT NULL, question_id INTEGER NOT NULL, answer TEXT,
  correct INTEGER, FOREIGN KEY(attempt_id) REFERENCES quiz_attempts(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS progress (
  id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER NOT NULL, topic_id INTEGER NOT NULL, completed INTEGER DEFAULT 0,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(student_id,topic_id),
  FOREIGN KEY(student_id) REFERENCES users(id), FOREIGN KEY(topic_id) REFERENCES topics(id) ON DELETE CASCADE);
`;

// Columns added after the first starter release; applied to existing databases too.
const COLUMNS = [
  ["courses", "offline_answers", "INTEGER DEFAULT 1"],
  ["questions", "answer_verified", "INTEGER DEFAULT 1"],
  ["questions", "marks", "INTEGER DEFAULT 1"],
  ["questions", "updated_at", "TEXT"],
  ["documents", "draft_json", "TEXT"],
  ["documents", "question_count", "INTEGER DEFAULT 0"],
  ["documents", "ocr_used", "INTEGER DEFAULT 0"],
  ["documents", "course_id", "INTEGER"],
  ["quiz_attempts", "quiz_id", "INTEGER"],
  ["quiz_attempts", "correct", "INTEGER DEFAULT 0"],
  ["quiz_attempts", "long_count", "INTEGER DEFAULT 0"],
  ["quiz_attempts", "client_attempt_id", "TEXT"],
  ["quiz_attempts", "duration_sec", "INTEGER DEFAULT 0"],
  ["quiz_attempts", "offline", "INTEGER DEFAULT 0"],
];
const INDEXES = [
  "CREATE UNIQUE INDEX IF NOT EXISTS ux_attempt_client ON quiz_attempts(student_id, client_attempt_id) WHERE client_attempt_id IS NOT NULL",
  "CREATE INDEX IF NOT EXISTS ix_questions_course ON questions(course_id, approval_status)",
  "CREATE INDEX IF NOT EXISTS ix_attempts_student ON quiz_attempts(student_id)",
  "CREATE INDEX IF NOT EXISTS ix_answers_attempt ON attempt_answers(attempt_id)",
];

export async function initDb() {
  SQL = await initSqlJs();
  db = fs.existsSync(dbPath) ? new SQL.Database(fs.readFileSync(dbPath)) : new SQL.Database();
  db.run("PRAGMA foreign_keys = ON;");
  db.run(SCHEMA);
  for (const [t, c, ddl] of COLUMNS) {
    const has = all(`PRAGMA table_info(${t})`).some(r => r.name === c);
    if (!has) db.run(`ALTER TABLE ${t} ADD COLUMN ${c} ${ddl}`);
  }
  for (const ix of INDEXES) db.run(ix);
  saveNow();
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { saveNow(); process.exit(0); });
  process.on("beforeExit", saveNow);
}

export function all(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}
export const one = (sql, params = []) => all(sql, params)[0] || null;

/** Runs a write and returns the inserted row id. */
export function run(sql, params = []) {
  db.run(sql, params);
  const id = one("SELECT last_insert_rowid() AS id")?.id;
  if (!txDepth) saveSoon();
  return id;
}
/** Runs a write and returns the number of changed rows. */
export function runc(sql, params = []) {
  db.run(sql, params);
  const n = db.getRowsModified();
  if (!txDepth) saveSoon();
  return n;
}
export function transaction(fn) {
  if (txDepth) return fn();
  db.run("BEGIN");
  txDepth++;
  try { const r = fn(); db.run("COMMIT"); txDepth--; saveSoon(); return r; }
  catch (e) { try { db.run("ROLLBACK"); } catch {} txDepth--; throw e; }
}

function saveSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 150); }
export function saveNow() {
  if (!db || txDepth) return;
  clearTimeout(saveTimer);
  const tmp = dbPath + ".tmp";
  fs.writeFileSync(tmp, Buffer.from(db.export()));
  fs.renameSync(tmp, dbPath);
  // sql.js resets PRAGMA foreign_keys after export(), so turn it back on.
  db.run("PRAGMA foreign_keys = ON;");
}
