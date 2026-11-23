// Plan-Do-See 다이어리 서버 — 의존성 없음 (Node 22+ 내장 node:sqlite)
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const DB_PATH = process.env.DB_PATH || path.join(ROOT, 'data', 'pds.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
db.exec(`
CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, category TEXT NOT NULL,
  start_date TEXT NOT NULL, end_date TEXT NOT NULL,
  priority INTEGER NOT NULL CHECK (priority BETWEEN 1 AND 3),
  success_criteria TEXT NOT NULL, est_min INTEGER NOT NULL CHECK (est_min >= 0),
  improvement TEXT NOT NULL DEFAULT '', rev_no INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS plan_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, plan_id TEXT NOT NULL REFERENCES plans(id),
  rev_no INTEGER NOT NULL, title TEXT NOT NULL, category TEXT NOT NULL,
  start_date TEXT NOT NULL, end_date TEXT NOT NULL, priority INTEGER NOT NULL,
  success_criteria TEXT NOT NULL, est_min INTEGER NOT NULL, improvement TEXT NOT NULL DEFAULT '',
  change_note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, UNIQUE (plan_id, rev_no));
CREATE TRIGGER IF NOT EXISTS plan_rev_no_update BEFORE UPDATE ON plan_revisions
  BEGIN SELECT RAISE(ABORT, '수정 이력은 바꿀 수 없습니다'); END;
CREATE TRIGGER IF NOT EXISTS plan_rev_no_delete BEFORE DELETE ON plan_revisions
  BEGIN SELECT RAISE(ABORT, '수정 이력은 지울 수 없습니다'); END;
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT, plan_id TEXT NOT NULL REFERENCES plans(id),
  title TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', tags TEXT NOT NULL DEFAULT '',
  due_date TEXT NOT NULL, due_time TEXT NOT NULL DEFAULT '',
  priority INTEGER NOT NULL CHECK (priority BETWEEN 1 AND 3),
  est_min INTEGER NOT NULL CHECK (est_min >= 0),
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','done','skipped')),
  completed_at TEXT, original_date TEXT, gen_key TEXT UNIQUE,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_date);
CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('done','skipped','voided')),
  planned_date TEXT NOT NULL, started_at TEXT, ended_at TEXT, actual_min INTEGER,
  block_reason TEXT NOT NULL DEFAULT '', idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS one_done_run_per_task ON runs(task_id) WHERE status = 'done';
CREATE TABLE IF NOT EXISTS retro_notes (
  week_start TEXT PRIMARY KEY, plan_id TEXT NOT NULL REFERENCES plans(id),
  improvement TEXT NOT NULL, plan_rev_no INTEGER NOT NULL, saved_at TEXT NOT NULL);
`);

if (!db.prepare('PRAGMA table_info(plans)').all().some((c) => c.name === 'color')) db.exec('ALTER TABLE plans ADD COLUMN color TEXT');
if (!db.prepare('PRAGMA table_info(tasks)').all().some((c) => c.name === 'color')) db.exec("ALTER TABLE tasks ADD COLUMN color TEXT NOT NULL DEFAULT ''");
if (!db.prepare('PRAGMA table_info(plans)').all().some((c) => c.name === 'archived')) db.exec('ALTER TABLE plans ADD COLUMN archived INTEGER NOT NULL DEFAULT 0');
if (!db.prepare('PRAGMA table_info(tasks)').all().some((c) => c.name === 'end_date')) db.exec("ALTER TABLE tasks ADD COLUMN end_date TEXT NOT NULL DEFAULT ''; ALTER TABLE tasks ADD COLUMN end_time TEXT NOT NULL DEFAULT ''");
if (!db.prepare('PRAGMA table_info(tasks)').all().some((c) => c.name === 'series_id')) db.exec("ALTER TABLE tasks ADD COLUMN series_id TEXT; ALTER TABLE tasks ADD COLUMN repeat_freq TEXT NOT NULL DEFAULT ''");
if (!db.prepare('PRAGMA table_info(tasks)').all().some((c) => c.name === 'repeat_count')) db.exec('ALTER TABLE tasks ADD COLUMN repeat_count INTEGER NOT NULL DEFAULT 0');
if (!db.prepare('PRAGMA table_info(tasks)').all().some((c) => c.name === 'repeat_until')) db.exec("ALTER TABLE tasks ADD COLUMN repeat_until TEXT NOT NULL DEFAULT ''");
if (!db.prepare('PRAGMA table_info(runs)').all().some((c) => c.name === 'condition_score')) db.exec('ALTER TABLE runs ADD COLUMN condition_score INTEGER');
db.exec(`CREATE TABLE IF NOT EXISTS workout_sets (
  id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  exercise TEXT NOT NULL, set_no INTEGER NOT NULL, weight_kg REAL NOT NULL DEFAULT 0, reps INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)`);

db.exec(`CREATE TABLE IF NOT EXISTS diary (
  date TEXT PRIMARY KEY, body TEXT NOT NULL DEFAULT '', mood INTEGER CHECK (mood BETWEEN 1 AND 5),
  tags TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tag_colors (tag TEXT PRIMARY KEY, color TEXT NOT NULL);`);

db.exec(`CREATE TABLE IF NOT EXISTS day_notes (date TEXT PRIMARY KEY, body TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL)`);
// 이벤트 안의 체크리스트 (이벤트가 지워지면 같이 지워짐)
db.exec(`CREATE TABLE IF NOT EXISTS checklist_items (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, text TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0, pos INTEGER NOT NULL DEFAULT 0)`);
// D-day / D+day: 사용자가 직접 저장한 날짜 (남은 날·지난 날을 계산해 보여줌)
db.exec(`CREATE TABLE IF NOT EXISTS ddays (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, date TEXT NOT NULL, created_at TEXT NOT NULL)`);
if (!db.prepare('PRAGMA table_info(ddays)').all().some((c) => c.name === 'task_id')) db.exec('ALTER TABLE ddays ADD COLUMN task_id INTEGER');
// 휴지통: 삭제한 이벤트를 통째로 보관 (복구할 때 그대로 되살림)
db.exec(`CREATE TABLE IF NOT EXISTS trash (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER, title TEXT NOT NULL, due_date TEXT NOT NULL, snapshot TEXT NOT NULL, deleted_at TEXT NOT NULL)`);

// ───────── 시간·날짜 규칙: 모두 Asia/Seoul(+09:00), 날짜 YYYY-MM-DD, 시각 ISO8601+09:00, 시간 단위는 분 ─────────
const nowIso = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 19) + '+09:00';
const today = () => nowIso().slice(0, 10);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const toD = (s) => new Date(s + 'T00:00:00Z');
const fmt = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = toD(s); d.setUTCDate(d.getUTCDate() + n); return fmt(d); };
// 매월·매년 반복용: 31일 → 2월 말처럼 없는 날은 그 달의 마지막 날로 맞춘다
const addMonthsClamp = (s, n) => { const d = toD(s), day = d.getUTCDate(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + n); const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate(); d.setUTCDate(Math.min(day, last)); return fmt(d); };
const dayDiff = (a, b) => Math.round((toD(a) - toD(b)) / 86400000);
const REPEATS = { daily: (s, i) => addDays(s, i), weekly: (s, i) => addDays(s, 7 * i), biweekly: (s, i) => addDays(s, 14 * i), monthly: (s, i) => addMonthsClamp(s, i), yearly: (s, i) => addMonthsClamp(s, 12 * i) };
// 반복 종료일이 없으면 1년 치만 만든다 (최대 400개)
function repeatDates(start, freq, until, count = 0) {
  const limit = until || addMonthsClamp(start, 12), out = [];
  for (let i = 0; i < (count || 400); i++) { const d = REPEATS[freq](start, i); if (!count && d > limit) break; out.push(d); }
  return out;
}
const repCount = (rep) => Math.min(400, Math.max(0, Math.trunc(Number(rep && rep.count) || 0)));
// 수정할 때 반복을 바꾸면: 이 이벤트 이후의 반복분을 지우고 새 설정으로 다시 만든다 (반복 '안 함'이면 이후분만 지움)
function applyRepeat(id, rep) {
  const cur = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id), freq = rep && REPEATS[rep.freq] ? rep.freq : '';
  let until = '', count = freq ? repCount(rep) : 0;
  if (freq && !count && rep.until) { until = date(rep.until, '반복 종료일'); if (until < cur.due_date) throw bad('반복 종료일은 시작일보다 빠를 수 없습니다'); }
  tx(() => {
    if (cur.series_id) db.prepare('DELETE FROM tasks WHERE series_id = ? AND due_date > ?').run(cur.series_id, cur.due_date);
    if (!freq) { db.prepare("UPDATE tasks SET series_id = NULL, repeat_freq = '', repeat_until = '', repeat_count = 0 WHERE id = ?").run(id); return; }
    const sid = cur.series_id || randomUUID(), at = nowIso();
    db.prepare('UPDATE tasks SET series_id = ?, repeat_freq = ?, repeat_until = ?, repeat_count = ? WHERE id = ?').run(sid, freq, until, count, id);
    const ins = db.prepare(`INSERT INTO tasks (plan_id,title,detail,tags,due_date,due_time,priority,est_min,original_date,color,end_date,end_time,series_id,repeat_freq,repeat_until,repeat_count,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    repeatDates(cur.due_date, freq, until, count).slice(1).forEach((d) => ins.run(cur.plan_id, cur.title, cur.detail, cur.tags, d, cur.due_time, cur.priority, cur.est_min, d, cur.color,
      cur.end_date ? addDays(cur.end_date, dayDiff(d, cur.due_date)) : '', cur.end_time, sid, freq, until, count, at, at));
  });
}
const addMonths = (s, n) => { const d = toD(s); d.setUTCMonth(d.getUTCMonth() + n); return fmt(d); };
const weekStart = (s) => addDays(s, -toD(s).getUTCDay()); // 일요일 시작 (화면·회고의 한 주)
const monWeekStart = (s) => addDays(s, -((toD(s).getUTCDay() + 6) % 7)); // 월요일 시작 (운동 순서 규칙용)
const dow = (s) => (toD(s).getUTCDay() + 6) % 7; // 월=0 … 일=6
const validDate = (s) => typeof s === 'string' && DATE_RE.test(s) && fmt(toD(s)) === s;

class HttpError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const bad = (msg) => new HttpError(400, msg);
const tx = (fn) => {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
};

const str = (v, name, max, required = true) => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (required && !s) throw bad(`${name}을(를) 입력해 주세요`);
  if (s.length > max) throw bad(`${name}은(는) ${max}자 이하로 입력해 주세요`);
  return s;
};
const int = (v, name, min, max) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`${name}은(는) ${min}~${max} 사이의 정수여야 합니다`);
  return n;
};
const date = (v, name) => { if (!validDate(v)) throw bad(`${name}은(는) YYYY-MM-DD 형식이어야 합니다`); return v; };
const normTags = (v) => [...new Set(String(v ?? '').split(',').map((t) => t.trim().replace(/^#+/, '').slice(0, 20)).filter(Boolean))].join(',').slice(0, 100);
const splitTags = (s) => String(s || '').split(',').filter(Boolean);

// ───────── 계획 ─────────
const PLAN_FIELDS = ['title', 'category', 'start_date', 'end_date', 'priority', 'success_criteria', 'est_min', 'improvement'];
function readPlan(b, prev = {}) {
  const m = { ...prev, ...b };
  const p = {
    title: str(m.title, '계획 이름', 80), category: str(m.category, '분류', 20),
    start_date: date(m.start_date, '시작일'), end_date: date(m.end_date, '종료일'),
    priority: int(m.priority, '우선순위', 1, 3), success_criteria: str(m.success_criteria, '성공 기준', 400),
    est_min: int(m.est_min, '예상 시간', 0, 100000), improvement: str(m.improvement ?? '', '개선점', 300, false),
  };
  if (p.end_date < p.start_date) throw bad('종료일이 시작일보다 빠릅니다');
  return p;
}
function insertRevision(id, p, rev, note, at) {
  db.prepare(`INSERT INTO plan_revisions (plan_id, rev_no, title, category, start_date, end_date, priority,
    success_criteria, est_min, improvement, change_note, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, rev, p.title, p.category, p.start_date, p.end_date, p.priority, p.success_criteria, p.est_min, p.improvement, note, at);
}
function createPlan(b) {
  const p = readPlan(b);
  return tx(() => {
    const n = (db.prepare("SELECT MAX(CAST(SUBSTR(id, 5) AS INTEGER)) m FROM plans").get().m || 0) + 1; // 계획을 지워도 번호가 겹치지 않게 가장 큰 번호 다음 값을 쓴다
    const id = 'PLN-' + String(n).padStart(3, '0'), at = nowIso();
    db.prepare(`INSERT INTO plans (id, title, category, start_date, end_date, priority, success_criteria, est_min, improvement,
      rev_no, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,0,?,?)`)
      .run(id, p.title, p.category, p.start_date, p.end_date, p.priority, p.success_criteria, p.est_min, p.improvement, at, at);
    insertRevision(id, p, 0, '최초 계획', at);
    return db.prepare('SELECT * FROM plans WHERE id = ?').get(id);
  });
}
const updatePlan = (id, b, note = '') => tx(() => updatePlanCore(id, b, note));
function updatePlanCore(id, b, note = '') {
  const cur = db.prepare('SELECT * FROM plans WHERE id = ?').get(id);
  if (!cur) throw new HttpError(404, '계획이 없습니다');
  const p = readPlan(b, cur);
  if (PLAN_FIELDS.every((f) => p[f] === cur[f])) return cur; // 바뀐 게 없으면 이력도 만들지 않음
  const rev = cur.rev_no + 1, at = nowIso();
  insertRevision(id, p, rev, str(note, '변경 메모', 200, false), at);
  db.prepare(`UPDATE plans SET title=?, category=?, start_date=?, end_date=?, priority=?, success_criteria=?, est_min=?,
    improvement=?, rev_no=?, updated_at=? WHERE id=?`)
    .run(p.title, p.category, p.start_date, p.end_date, p.priority, p.success_criteria, p.est_min, p.improvement, rev, at, id);
  return db.prepare('SELECT * FROM plans WHERE id = ?').get(id);
}

// 평일 운동을 못 한 날: 같은 주 안에서 어깨→가슴→등 순서를 유지한 채 하루씩 뒤로 밀고, 금요일 휴식도 사용한다.
function shiftWeekdayWorkouts(task) {
  const ws = monWeekStart(task.due_date), fri = addDays(ws, 4);
  const slots = []; // 건너뛴 날 다음 날부터 금요일까지
  for (let d = addDays(task.due_date, 1); d <= fri; d = addDays(d, 1)) slots.push(d);
  const queue = db.prepare(`SELECT * FROM tasks WHERE plan_id='PLN-001' AND status='todo' AND due_date >= ? AND due_date <= ?
    AND tags LIKE '%운동%' AND tags NOT LIKE '%주말%' ORDER BY due_date, id`).all(task.due_date, fri);
  const moved = [];
  queue.forEach((t, i) => {
    if (i < slots.length) {
      db.prepare('UPDATE tasks SET due_date=?, updated_at=? WHERE id=?').run(slots[i], nowIso(), t.id);
      moved.push({ id: t.id, to: slots[i] });
    } else { // 자리가 없으면 주 단위 원칙에 따라 다음 주로 넘기지 않는다
      db.prepare("UPDATE tasks SET status='skipped', updated_at=? WHERE id=?").run(nowIso(), t.id);
      if (t.id !== task.id) db.prepare(`INSERT INTO runs (task_id, status, planned_date, block_reason, idempotency_key, created_at)
        VALUES (?, 'skipped', ?, '이번 주 남은 평일 없음 (다음 주로 넘기지 않음)', ?, ?)`)
        .run(t.id, t.due_date, `auto-${t.id}-${Date.now()}`, nowIso());
    }
  });
  return moved;
}

// ───────── 할 일 ─────────
const SORTS = {
  due: ['due_date', 'due_time'], priority: ['priority'], est: ['est_min'], title: ['title COLLATE NOCASE'], status: ['status'],
};
const SORT_LABEL = { due: '마감일', priority: '우선순위', est: '예상 시간', title: '이름', status: '상태' };
function attachRuns(rows) {
  if (!rows.length) return rows;
  const runs = db.prepare(`SELECT * FROM runs WHERE task_id IN (${rows.map(() => '?').join(',')}) ORDER BY id`).all(...rows.map((r) => r.id));
  const by = new Map();
  runs.forEach((r) => { if (!by.has(r.task_id)) by.set(r.task_id, []); by.get(r.task_id).push(r); });
  const sets = db.prepare(`SELECT * FROM workout_sets WHERE task_id IN (${rows.map(() => '?').join(',')}) ORDER BY id`).all(...rows.map((r) => r.id));
  const bs = new Map();
  sets.forEach((x) => { if (!bs.has(x.task_id)) bs.set(x.task_id, []); bs.get(x.task_id).push(x); });
  rows.forEach((t) => {
    t.runs = by.get(t.id) || [];
    t.sets = bs.get(t.id) || [];
    t.actual_min = t.runs.filter((r) => r.status === 'done').reduce((a, r) => a + (r.actual_min || 0), 0);
    t.blocked = t.runs.some((r) => r.status !== 'voided' && r.block_reason);
    t.overdue = t.status === 'todo' && t.due_date < today();
  });
  return rows;
}
function listTasks(q) {
  const w = [], a = [];
  if (q.q) { const like = `%${q.q.replace(/[\\%_]/g, '\\$&')}%`; w.push("(title LIKE ? ESCAPE '\\' OR detail LIKE ? ESCAPE '\\' OR tags LIKE ? ESCAPE '\\')"); a.push(like, like, like); }
  if (q.status === 'overdue') w.push("status='todo' AND due_date < '" + today() + "'");
  else if (['todo', 'done', 'skipped'].includes(q.status)) { w.push('status = ?'); a.push(q.status); }
  if (['1', '2', '3'].includes(q.priority)) { w.push('priority = ?'); a.push(Number(q.priority)); }
  if (q.tag) { w.push("(',' || tags || ',') LIKE ? ESCAPE '\\'"); a.push(`%,${q.tag.replace(/[\\%_]/g, '\\$&')},%`); }
  if (q.plan) { w.push('plan_id = ?'); a.push(q.plan); }
  if (validDate(q.from)) { w.push("COALESCE(NULLIF(end_date, ''), due_date) >= ?"); a.push(q.from); }
  if (validDate(q.to)) { w.push('due_date <= ?'); a.push(q.to); }
  const key = SORTS[q.sort] ? q.sort : 'due', dir = q.dir === 'desc' ? 'DESC' : 'ASC';
  // 정렬 키가 같을 때의 보조 기준(tie-breaker): 마감일 → 시각 → ID
  const order = [...SORTS[key].map((c) => `${c} ${dir}`), 'due_date ASC', "(due_time = '') ASC", 'due_time ASC', 'id ASC'].join(', ');
  const rows = db.prepare(`SELECT * FROM tasks ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY ${order}`).all(...a);
  return { tasks: attachRuns(rows), sort: { key, label: SORT_LABEL[key], dir: dir.toLowerCase(), tiebreak: '마감일 → 시각 → ID' } };
}
// 계획 없이 만든 일회성 일정(졸업식, 약속 등)은 '기타 일정' 계획에 자동으로 모은다
function miscPlanId() {
  const f = db.prepare("SELECT id FROM plans WHERE category = '기타' AND archived = 0 ORDER BY id LIMIT 1").get();
  if (f) return f.id;
  const t = today();
  return createPlan({ title: '기타 일정', category: '기타', start_date: t, end_date: addMonths(t, 120), priority: 2, est_min: 0, success_criteria: '계획에 속하지 않는 일회성 일정 (졸업식, 약속 등)' }).id;
}
function readTask(b) {
  if (!b.plan_id) b = { ...b, plan_id: miscPlanId() };
  const plan = db.prepare('SELECT id FROM plans WHERE id = ? AND archived = 0').get(b.plan_id);
  if (!plan) throw bad('계획을 선택해 주세요');
  const time = b.due_time ? String(b.due_time) : '';
  if (time && !TIME_RE.test(time)) throw bad('시각은 HH:MM 형식이어야 합니다');
  const due = date(b.due_date, '마감일'), endT = b.end_time ? String(b.end_time) : '';
  if (endT && !TIME_RE.test(endT)) throw bad('종료 시각은 HH:MM 형식이어야 합니다');
  let endD = b.end_date ? date(b.end_date, '종료일') : '';
  if (endD && endD < due) throw bad('종료일은 시작일보다 빠를 수 없습니다');
  if (endD === due) endD = '';
  return {
    end_date: endD, end_time: endT,
    plan_id: plan.id, title: str(b.title, '이벤트 이름', 120), detail: str(b.detail ?? '', '메모', 400, false),
    tags: normTags(b.tags), due_date: date(b.due_date, '마감일'), due_time: time,
    priority: int(b.priority, '우선순위', 1, 3), est_min: int(b.est_min, '예상 시간', 0, 1440),
    color: /^#[0-9a-fA-F]{6}$/.test(b.color || '') ? b.color.toLowerCase() : '',
  };
}
const getTask = (id) => {
  const t = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  if (!t) throw new HttpError(404, '이벤트가 없습니다');
  return t;
};
const withRuns = (id) => attachRuns([getTask(id)])[0];

function completeTask(id, b) {
  const key = str(b.idempotency_key, '멱등성 키', 80);
  const dup = db.prepare('SELECT * FROM runs WHERE idempotency_key = ?').get(key);
  if (dup) return { task: withRuns(dup.task_id), run: dup, duplicate: true };
  const t = getTask(id);
  if (t.status === 'done') return { task: withRuns(id), run: db.prepare("SELECT * FROM runs WHERE task_id=? AND status='done'").get(id), duplicate: true };
  const hhmm = b.started_time || '00:00';
  if (!TIME_RE.test(hhmm)) throw bad('시작 시각은 HH:MM 형식이어야 합니다');
  const mins = int(b.actual_min ?? t.est_min, '소요 시간', 0, 1440);
  const started = new Date(`${t.due_date}T${hhmm}:00Z`);
  const ended = new Date(started.getTime() + mins * 60000);
  const iso = (d) => d.toISOString().slice(0, 19) + '+09:00';
  const cond = b.condition_score ? int(b.condition_score, '컨디션', 1, 5) : null;
  return tx(() => {
    const r = db.prepare(`INSERT INTO runs (task_id, status, planned_date, started_at, ended_at, actual_min, block_reason, idempotency_key, created_at, condition_score)
      VALUES (?, 'done', ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, t.due_date, iso(started), iso(ended), mins, str(b.block_reason ?? '', '막힘 사유', 300, false), key, nowIso(), cond);
    db.prepare("UPDATE tasks SET status='done', completed_at=?, updated_at=? WHERE id=?").run(nowIso(), nowIso(), id);
    return { task: withRuns(id), run: db.prepare('SELECT * FROM runs WHERE id=?').get(r.lastInsertRowid), duplicate: false };
  });
}
function skipTask(id, b) {
  const key = str(b.idempotency_key, '멱등성 키', 80);
  const dup = db.prepare('SELECT * FROM runs WHERE idempotency_key = ?').get(key);
  if (dup) return { task: withRuns(dup.task_id), duplicate: true };
  const t = getTask(id);
  if (t.status !== 'todo') throw bad('진행 전인 이벤트만 건너뛸 수 있습니다');
  const reason = str(b.block_reason, '건너뛴 사유', 300);
  return tx(() => {
    db.prepare(`INSERT INTO runs (task_id, status, planned_date, block_reason, idempotency_key, created_at) VALUES (?, 'skipped', ?, ?, ?, ?)`)
      .run(id, t.due_date, reason, key, nowIso());
    const weekdayWorkout = t.plan_id === 'PLN-001' && t.tags.split(',').includes('운동') && !t.tags.includes('주말') && dow(t.due_date) < 5;
    let moved = [];
    if (weekdayWorkout) moved = shiftWeekdayWorkouts(t);
    else db.prepare("UPDATE tasks SET status='skipped', updated_at=? WHERE id=?").run(nowIso(), id);
    return { task: withRuns(id), moved, duplicate: false };
  });
}
function undoTask(id) {
  const t = getTask(id);
  if (t.status === 'todo') return withRuns(id);
  return tx(() => {
    db.prepare("UPDATE runs SET status='voided' WHERE task_id=? AND status IN ('done','skipped')").run(id);
    db.prepare("UPDATE tasks SET status='todo', completed_at=NULL, updated_at=? WHERE id=?").run(nowIso(), id);
    return withRuns(id);
  });
}

// ───────── 주간 회고 ─────────
const dur = (m) => `${Math.floor(m / 60)}시간 ${m % 60}분`;
function review(ws, we = addDays(ws, 6)) {
  const tasks = attachRuns(db.prepare('SELECT * FROM tasks WHERE due_date BETWEEN ? AND ? ORDER BY due_date, due_time, id').all(ws, we));
  const row = (t) => {
    const done = t.status === 'done', delta = done ? t.actual_min - t.est_min : null;
    let verdict = t.overdue ? '마감 지남' : t.status === 'skipped' ? '건너뜀' : !done ? '진행 전' : delta > 5 ? '예상보다 늦음' : delta < -5 ? '예상보다 빠름' : '예상대로';
    return { id: t.id, title: t.title, due_date: t.due_date, due_time: t.due_time, status: t.status, est_min: t.est_min, actual_min: t.actual_min,
      delta, verdict, reasons: t.runs.filter((r) => r.status !== 'voided' && r.block_reason).map((r) => r.block_reason), tags: t.tags };
  };
  const rows = tasks.map(row);
  const doneT = rows.filter((r) => r.status === 'done');
  const estSum = tasks.reduce((a, t) => a + t.est_min, 0);
  const actSum = tasks.reduce((a, t) => a + t.actual_min, 0);
  const items = {
    planned: rows, done: doneT, delayed: rows.filter((r) => r.verdict === '마감 지남'),
    blocked: rows.filter((r) => r.reasons.length), est: rows.filter((r) => r.est_min > 0), actual: doneT,
    diff: doneT.filter((r) => r.delta !== 0).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)),
  };
  const late = doneT.filter((r) => r.delta > 5), early = doneT.filter((r) => r.delta < -5);
  const diff = tasks.length ? actSum - estSum : 0;
  const base = tasks.filter((t) => t.status !== 'skipped').length;
  const rate = base ? Math.round((doneT.length / base) * 100) : 0;
  let diligence = '아직 기록이 없어요';
  if (doneT.length) diligence = `완료율 ${rate}% · 예상보다 늦은 일 ${late.length}건, 빠른 일 ${early.length}건`;
  // 개선점 제안: 가장 많이 늦은 할 일 또는 막힘 사유에서 도출
  let suggestion = '기록이 쌓이면 개선점을 제안해 드려요';
  if (late.length) { const w = [...late].sort((a, b) => b.delta - a.delta)[0]; suggestion = `「${w.title}」이(가) 예상보다 ${w.delta}분 늦었어요 — 다음 주 예상 시간을 ${w.est_min + w.delta}분으로 늘리거나 시작 시각을 앞당겨 보세요.`; }
  else if (items.blocked.length) suggestion = `「${items.blocked[0].title}」에서 막힌 이유(${items.blocked[0].reasons[0]})를 미리 해결할 방법을 정해 보세요.`;
  else if (items.delayed.length) suggestion = `마감이 지난 「${items.delayed[0].title}」부터 먼저 끝내 보세요.`;
  const note = db.prepare('SELECT * FROM retro_notes WHERE week_start = ?').get(ws) || null;
  // 일기: 기간 안의 일기, 태그 횟수, 기분이 낮은/높은 날의 시간 차이(완료한 일의 평균 실제−예상)
  const diary = db.prepare('SELECT * FROM diary WHERE date BETWEEN ? AND ? ORDER BY date').all(ws, we);
  const dtags = new Map();
  diary.forEach((r) => splitTags(r.tags).forEach((k) => dtags.set(k, (dtags.get(k) || 0) + 1)));
  const dayDelta = (d) => { const ds = doneT.filter((r) => r.due_date === d); return ds.length ? ds.reduce((a, r) => a + r.delta, 0) / ds.length : null; };
  const grp = (f) => { const v = diary.filter(f).map((r) => dayDelta(r.date)).filter((x) => x !== null); return v.length ? { days: v.length, avg_delta: Math.round(v.reduce((a, b) => a + b, 0) / v.length) } : null; };
  const moods = diary.filter((r) => r.mood);
  return {
    diary, diary_tags: [...dtags].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count),
    mood_avg: moods.length ? Math.round((moods.reduce((a, r) => a + r.mood, 0) / moods.length) * 10) / 10 : null,
    mood_effect: { low: grp((r) => r.mood && r.mood <= 2), high: grp((r) => r.mood && r.mood >= 4) },
    week_start: ws, week_end: we, diligence, rate,
    metrics: { planned: tasks.length, done: doneT.length, delayed: items.delayed.length, blocked: items.blocked.length, est_min: estSum, actual_min: actSum, diff_min: diff,
      done_diff_min: doneT.reduce((a, r) => a + r.delta, 0) },
    items, suggestion, note, est_label: dur(estSum), actual_label: dur(actSum),
    reasons: reasonStats(rows), estimates: we === addDays(ws, 6) ? estimateSuggestions() : [],
  };
}
// 막힘 사유 통계: 같은 사유(공백·대소문자 무시)끼리 묶어 횟수를 센다
function reasonStats(rows) {
  const m = new Map();
  rows.forEach((r) => r.reasons.forEach((x) => {
    const k = x.trim().toLowerCase(), e = m.get(k) || { reason: x.trim(), count: 0, task_ids: [] };
    e.count++; if (!e.task_ids.includes(r.id)) e.task_ids.push(r.id); m.set(k, e);
  }));
  return [...m.values()].sort((a, b) => b.count - a.count);
}
// 예상 시간 보정 제안: 최근 28일 동안 같은 이름의 일이 3번 이상 끝났고 평균 실제 시간이 예상과 5분 이상 다를 때
function estimateSuggestions() {
  const from = addDays(today(), -28);
  const rows = db.prepare(`SELECT t.title, t.plan_id, COUNT(*) n, AVG(r.actual_min) a, AVG(t.est_min) e FROM tasks t
    JOIN runs r ON r.task_id = t.id AND r.status = 'done' WHERE t.due_date >= ? GROUP BY t.title HAVING n >= 3`).all(from);
  return rows.map((r) => {
    const up = db.prepare("SELECT COUNT(*) c FROM tasks WHERE title = ? AND status = 'todo' AND due_date >= ?").get(r.title, today());
    const suggested = Math.max(5, Math.round(r.a / 5) * 5);
    return { title: r.title, plan_id: r.plan_id, samples: r.n, avg_min: Math.round(r.a), est_min: Math.round(r.e), suggested_min: suggested, upcoming: up.c };
  }).filter((x) => x.upcoming > 0 && Math.abs(x.suggested_min - x.est_min) >= 5);
}
function applyEstimate(b) {
  const title = str(b.title, '이벤트 이름', 120), min = int(b.est_min, '예상 시간', 1, 1440);
  const r = db.prepare("UPDATE tasks SET est_min = ?, updated_at = ? WHERE title = ? AND status = 'todo' AND due_date >= ?").run(min, nowIso(), title, today());
  return { changed: Number(r.changes) };
}
function monthReview(month, cap) {
  if (!/^\d{4}-\d{2}$/.test(month || '') || !validDate(month + '-01')) throw bad('month는 YYYY-MM 형식이어야 합니다');
  const from = month + '-01', d = toD(from); d.setUTCMonth(d.getUTCMonth() + 1, 0);
  let to = fmt(d); if (cap && validDate(cap) && cap >= from && cap < to) to = cap;   // 진행 중인 달은 오늘까지만 집계
  const r = review(from, to), weeks = [];
  for (let w = weekStart(from); w <= to; w = addDays(w, 7)) {
    const a = w < from ? from : w, z = addDays(w, 6) > to ? to : addDays(w, 6), x = review(a, z);
    weeks.push({ week_start: w, from: a, to: z, ...x.metrics, rate: x.rate });
  }
  return { ...r, month, weeks, note: null };
}
function trends(n) {
  const cur = weekStart(today()), out = [];
  for (let i = n - 1; i >= 0; i--) {
    const ws = addDays(cur, -7 * i), r = review(ws);
    out.push({ week_start: ws, planned: r.metrics.planned, done: r.metrics.done, rate: r.rate, done_diff_min: r.metrics.done_diff_min, delayed: r.metrics.delayed });
  }
  const days = db.prepare("SELECT due_date, SUM(status='done') d, COUNT(*) c, SUM(status='todo') t FROM tasks WHERE tags LIKE '%운동%' AND due_date <= ? GROUP BY due_date ORDER BY due_date").all(today());
  let best = 0, run = 0;
  days.forEach((x) => { if (x.d === x.c) { run++; best = Math.max(best, run); } else if (!(x.due_date === today() && x.t > 0)) run = 0; });
  // 오늘 운동이 아직 남았다면 어제까지의 연속 기록을 유지
  const last = days[days.length - 1];
  const streak = last && last.due_date === today() && last.t > 0 ? (() => { let c = 0; for (let i = days.length - 2; i >= 0 && days[i].d === days[i].c; i--) c++; return c; })() : run;
  return { weeks: out, streak, best_streak: Math.max(best, streak) };
}

// ───────── 운동 세트 · 삭제 복원 · 복제 · 복사 ─────────
function saveSets(id, b) {
  getTask(id);
  const list = Array.isArray(b.sets) ? b.sets : [];
  if (list.length > 60) throw bad('세트는 60개까지 기록할 수 있어요');
  const kg = (v) => { const n = Number(v); if (!Number.isFinite(n) || n < 0 || n > 1000) throw bad('무게는 0~1000kg 사이여야 합니다'); return n; };
  const rows = list.map((x) => ({ exercise: str(x.exercise, '운동 이름', 60), weight_kg: kg(x.weight_kg), reps: int(x.reps, '횟수', 0, 1000) }));
  const cond = b.condition_score ? int(b.condition_score, '컨디션', 1, 5) : null;
  return tx(() => {
    db.prepare('DELETE FROM workout_sets WHERE task_id = ?').run(id);
    const n = new Map();
    rows.forEach((x) => { const k = (n.get(x.exercise) || 0) + 1; n.set(x.exercise, k);
      db.prepare('INSERT INTO workout_sets (task_id, exercise, set_no, weight_kg, reps, created_at) VALUES (?,?,?,?,?,?)').run(id, x.exercise, k, x.weight_kg, x.reps, nowIso()); });
    if (cond) db.prepare("UPDATE runs SET condition_score = ? WHERE task_id = ? AND status = 'done'").run(cond, id);
    return withRuns(id);
  });
}
function restoreTask(b) {
  const o = b.task || {}, id = int(o.id, 'ID', 1, 2 ** 31), t = readTask(o);
  if (db.prepare('SELECT 1 FROM tasks WHERE id = ?').get(id)) throw bad('이미 같은 ID의 이벤트가 있어요');
  if (!['todo', 'done', 'skipped'].includes(o.status)) throw bad('상태가 올바르지 않습니다');
  const sd = (v) => (typeof v === 'string' && v.length <= 40 ? v : null);
  return tx(() => {
    db.prepare(`INSERT INTO tasks (id, plan_id, title, detail, tags, due_date, due_time, end_date, end_time, priority, est_min, status, completed_at, original_date, gen_key, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, t.plan_id, t.title, t.detail, t.tags, t.due_date, t.due_time, t.end_date, t.end_time, t.priority, t.est_min, o.status, sd(o.completed_at),
      validDate(o.original_date) ? o.original_date : t.due_date, typeof o.gen_key === 'string' ? o.gen_key.slice(0, 60) : null, sd(o.created_at) || nowIso(), nowIso());
    (Array.isArray(b.runs) ? b.runs : []).forEach((r) => {
      if (!['done', 'skipped', 'voided'].includes(r.status)) return;
      db.prepare(`INSERT INTO runs (task_id, status, planned_date, started_at, ended_at, actual_min, block_reason, idempotency_key, created_at, condition_score)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).run(id, r.status, validDate(r.planned_date) ? r.planned_date : t.due_date, sd(r.started_at), sd(r.ended_at),
        Number.isInteger(r.actual_min) ? r.actual_min : null, str(r.block_reason ?? '', '막힘 사유', 300, false), str(r.idempotency_key, '멱등성 키', 80), sd(r.created_at) || nowIso(),
        Number.isInteger(r.condition_score) ? r.condition_score : null);
    });
    (Array.isArray(b.sets) ? b.sets : []).slice(0, 60).forEach((x) => db.prepare('INSERT INTO workout_sets (task_id, exercise, set_no, weight_kg, reps, created_at) VALUES (?,?,?,?,?,?)')
      .run(id, str(x.exercise, '운동 이름', 60), int(x.set_no, '세트', 1, 1000), Number(x.weight_kg) || 0, int(x.reps, '횟수', 0, 1000), nowIso()));
    return withRuns(id);
  });
}
const insertCopy = (t, d) => db.prepare(`INSERT INTO tasks (plan_id,title,detail,tags,due_date,due_time,priority,est_min,original_date,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
  .run(t.plan_id, t.title, t.detail, t.tags, d, t.due_time, t.priority, t.est_min, d, nowIso(), nowIso()).lastInsertRowid;
function copyDay(b) {
  const from = date(b.from, '복사할 날짜'), to = date(b.to, '붙여넣을 날짜');
  if (from === to) throw bad('같은 날짜로는 복사할 수 없어요');
  return tx(() => {
    const have = new Set(db.prepare('SELECT title, due_time FROM tasks WHERE due_date = ?').all(to).map((x) => x.title + '|' + x.due_time));
    let n = 0;
    db.prepare('SELECT * FROM tasks WHERE due_date = ? ORDER BY id').all(from).forEach((t) => { if (!have.has(t.title + '|' + t.due_time)) { insertCopy(t, to); n++; } });
    return { created: n };
  });
}

// ───────── 태그 관리 · 일기 ─────────
function tagStats() {
  const rows = db.prepare(`SELECT t.tags, t.status, t.est_min, (SELECT COALESCE(SUM(actual_min),0) FROM runs r WHERE r.task_id = t.id AND r.status = 'done') actual
    FROM tasks t WHERE t.tags != ''`).all();
  const m = new Map();
  const get = (k) => { if (!m.has(k)) m.set(k, { tag: k, tasks: 0, done: 0, skipped: 0, est_min: 0, done_est: 0, done_actual: 0, diary: 0 }); return m.get(k); };
  rows.forEach((r) => splitTags(r.tags).forEach((k) => { const e = get(k); e.tasks++; e.est_min += r.est_min;
    if (r.status === 'done') { e.done++; e.done_est += r.est_min; e.done_actual += r.actual; } else if (r.status === 'skipped') e.skipped++; }));
  db.prepare("SELECT tags FROM diary WHERE tags != ''").all().forEach((r) => splitTags(r.tags).forEach((k) => { get(k).diary++; }));
  const colors = Object.fromEntries(db.prepare('SELECT * FROM tag_colors').all().map((c) => [c.tag, c.color]));
  db.prepare('SELECT tag FROM tag_colors').all().forEach((c) => get(c.tag));
  return [...m.values()].map((e) => ({ tag: e.tag, tasks: e.tasks, done: e.done, diary: e.diary, est_min: e.est_min,
    rate: e.tasks - e.skipped ? Math.round((e.done / (e.tasks - e.skipped)) * 100) : 0, delta_min: e.done_actual - e.done_est, color: colors[e.tag] || '' }))
    .sort((a, b) => b.tasks + b.diary - (a.tasks + a.diary) || a.tag.localeCompare(b.tag));
}
function mapTags(fn) {
  let n = 0;
  const upd = (table, key) => db.prepare(`SELECT ${key} k, tags FROM ${table} WHERE tags != ''`).all().forEach((r) => {
    const next = [...new Set(fn(splitTags(r.tags)))].join(',');
    if (next !== r.tags) { db.prepare(`UPDATE ${table} SET tags = ? WHERE ${key} = ?`).run(next, r.k); n++; }
  });
  upd('tasks', 'id'); upd('diary', 'date');
  return n;
}
function renameTag(b) { // 새 이름이 이미 있으면 자동으로 합쳐진다
  const from = str(b.from, '기존 태그', 20), raw = str(b.to, '새 태그', 20), to = normTags(raw);
  if (!to || raw.includes(',')) throw bad('새 태그 이름이 올바르지 않습니다');
  return tx(() => {
    const changed = mapTags((l) => l.map((t) => (t === from ? to : t)));
    const c = db.prepare('SELECT color FROM tag_colors WHERE tag = ?').get(from);
    if (c) { db.prepare('INSERT OR IGNORE INTO tag_colors (tag, color) VALUES (?, ?)').run(to, c.color); db.prepare('DELETE FROM tag_colors WHERE tag = ?').run(from); }
    return { changed };
  });
}
function deleteTag(b) {
  const t = str(b.tag, '태그', 20);
  return tx(() => { const changed = mapTags((l) => l.filter((x) => x !== t)); db.prepare('DELETE FROM tag_colors WHERE tag = ?').run(t); return { changed }; });
}
function setTagColor(b) {
  const t = str(b.tag, '태그', 20), c = b.color ? String(b.color) : '';
  if (c && !/^#[0-9a-fA-F]{6}$/.test(c)) throw bad('색은 #RRGGBB 형식이어야 합니다');
  if (c) db.prepare('INSERT INTO tag_colors (tag, color) VALUES (?, ?) ON CONFLICT(tag) DO UPDATE SET color = excluded.color').run(t, c);
  else db.prepare('DELETE FROM tag_colors WHERE tag = ?').run(t);
  return { ok: true };
}
function addTag(b) { // 할 일·일기에 붙이기 전에도 목록에 남도록 tag_colors 에 등록한다
  const raw = str(b.tag, '태그', 20), tag = normTags(raw), c = b.color ? String(b.color) : '#8a8a80';
  if (!tag || raw.includes(',')) throw bad('태그 이름이 올바르지 않습니다 (쉼표 없이 20자 이내)');
  if (!/^#[0-9a-fA-F]{6}$/.test(c)) throw bad('색은 #RRGGBB 형식이어야 합니다');
  if (tagStats().some((x) => x.tag === tag)) throw bad('이미 있는 태그예요');
  db.prepare('INSERT INTO tag_colors (tag, color) VALUES (?, ?)').run(tag, c);
  return { tag };
}
function diaryDay(d) {
  const entry = db.prepare('SELECT * FROM diary WHERE date = ?').get(d) || null;
  const t = db.prepare("SELECT COUNT(*) total, SUM(status='done') done, SUM(status='todo' AND due_date < ?) late FROM tasks WHERE due_date = ?").get(today(), d);
  const monthAgo = db.prepare('SELECT * FROM diary WHERE date = ?').get(addMonths(d, -1)) || null;
  let same = [];
  if (entry && entry.tags) {
    const ts = splitTags(entry.tags);
    same = db.prepare("SELECT * FROM diary WHERE date < ? AND tags != '' ORDER BY date DESC").all(d).filter((r) => splitTags(r.tags).some((x) => ts.includes(x))).slice(0, 3);
  }
  return { date: d, entry, summary: { total: t.total, done: t.done || 0, late: t.late || 0 }, month_ago: monthAgo, same_tag: same };
}
function saveDiary(b) {
  const d = date(b.date, '날짜'), body = str(b.body ?? '', '일기', 1000, false), tags = normTags(b.tags);
  const mood = b.mood ? int(b.mood, '기분', 1, 5) : null;
  if (!body && !mood && !tags) { db.prepare('DELETE FROM diary WHERE date = ?').run(d); return diaryDay(d); }
  const at = nowIso();
  db.prepare(`INSERT INTO diary (date, body, mood, tags, created_at, updated_at) VALUES (?,?,?,?,?,?)
    ON CONFLICT(date) DO UPDATE SET body = excluded.body, mood = excluded.mood, tags = excluded.tags, updated_at = excluded.updated_at`).run(d, body, mood, tags, at, at);
  return diaryDay(d);
}
function tagItems(tag) {
  const t = str(tag, '태그', 20);
  const diary = db.prepare("SELECT * FROM diary WHERE tags != '' ORDER BY date DESC").all().filter((r) => splitTags(r.tags).includes(t));
  return { tag: t, tasks: listTasks({ tag: t, sort: 'due', dir: 'desc' }).tasks, diary };
}

// ───────── 백업 불러오기 (전체 백업 파일로 DB 교체) ─────────
const IMPORT_ORDER = ['plans', 'plan_revisions', 'tasks', 'checklist_items', 'runs', 'ddays', 'workout_sets', 'retro_notes', 'diary', 'tag_colors', 'day_notes'];
function importAll(d) {
  if (!d || d.scope !== 'all') throw bad('전체 백업 파일(scope: all)만 불러올 수 있어요. 달력·날짜 저장 파일은 불러올 수 없어요');
  if (!Array.isArray(d.plans) || !d.plans.length) throw bad('계획이 하나도 없는 파일이에요');
  for (const t of IMPORT_ORDER) if (d[t] !== undefined && !Array.isArray(d[t])) throw bad(`${t} 형식이 올바르지 않습니다`);
  return tx(() => {
    const triggers = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'trigger'").all();
    triggers.forEach((t) => db.exec(`DROP TRIGGER "${t.name}"`)); // 수정 이력 보호 트리거를 잠시 해제 (실패하면 전체 롤백)
    [...IMPORT_ORDER].reverse().forEach((t) => db.exec(`DELETE FROM ${t}`));
    const counts = {};
    for (const t of IMPORT_ORDER) {
      const cols = db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
      counts[t] = 0;
      for (const row of d[t] || []) {
        const keys = Object.keys(row).filter((k) => cols.includes(k));
        const vals = keys.map((k) => { const v = row[k]; if (v !== null && !['string', 'number'].includes(typeof v)) throw bad(`${t}.${k} 값이 올바르지 않습니다`); return v; });
        db.prepare(`INSERT INTO ${t} (${keys.map((k) => `"${k}"`).join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...vals);
        counts[t]++;
      }
    }
    triggers.forEach((t) => db.exec(t.sql));
    return counts;
  });
}
function saveReview(b) {
  const ws = weekStart(date(b.week_start, '주 시작일'));
  const text = str(b.improvement, '개선점', 300);
  const plan = db.prepare('SELECT * FROM plans WHERE id = ? AND archived = 0').get(b.plan_id || '') || db.prepare('SELECT * FROM plans WHERE archived = 0 ORDER BY id LIMIT 1').get() || db.prepare('SELECT * FROM plans WHERE id = ?').get(miscPlanId());
  if (!plan) throw bad('저장할 수 없습니다');
  return tx(() => {
    const p = updatePlanCore(plan.id, { improvement: text }, `${ws} 주 회고 개선점 반영`);
    db.prepare(`INSERT INTO retro_notes (week_start, plan_id, improvement, plan_rev_no, saved_at) VALUES (?,?,?,?,?)
      ON CONFLICT(week_start) DO UPDATE SET plan_id=excluded.plan_id, improvement=excluded.improvement, plan_rev_no=excluded.plan_rev_no, saved_at=excluded.saved_at`)
      .run(ws, plan.id, text, p.rev_no, nowIso());
    return review(ws);
  });
}

// ───────── 내보내기 ─────────
function exportData(d, scope) {
  const meta = { exported_at: nowIso(), timezone: 'Asia/Seoul', notice: '공개되어도 괜찮은 내용만 담겨 있어야 합니다' };
  if (scope === 'all') {
    return { ...meta, scope: 'all', plans: db.prepare('SELECT * FROM plans').all(), plan_revisions: db.prepare('SELECT * FROM plan_revisions').all(),
      tasks: db.prepare('SELECT * FROM tasks').all(), checklist_items: db.prepare('SELECT * FROM checklist_items').all(), ddays: db.prepare('SELECT * FROM ddays').all(), runs: db.prepare('SELECT * FROM runs').all(),
      workout_sets: db.prepare('SELECT * FROM workout_sets').all(), diary: db.prepare('SELECT * FROM diary').all(), day_notes: db.prepare('SELECT * FROM day_notes').all(), tag_colors: db.prepare('SELECT * FROM tag_colors').all(), retro_notes: db.prepare('SELECT * FROM retro_notes').all() };
  }
  if (!d) { // 전체 저장 → 달력 부분만
    const rows = db.prepare('SELECT due_date, due_time, title, status FROM tasks ORDER BY due_date, (due_time=\'\'), due_time, id').all();
    const days = new Map();
    rows.forEach((r) => { if (!days.has(r.due_date)) days.set(r.due_date, { date: r.due_date, weekday: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][dow(r.due_date)], tasks: [] }); days.get(r.due_date).tasks.push({ time: r.due_time, title: r.title, status: r.status }); });
    return { ...meta, scope: 'calendar', calendar: [...days.values()] };
  }
  const tasks = attachRuns(db.prepare('SELECT * FROM tasks WHERE due_date = ? ORDER BY (due_time=\'\'), due_time, id').all(d));
  const plans = db.prepare('SELECT * FROM plans').all().filter((p) => tasks.some((t) => t.plan_id === p.id));
  return { ...meta, scope: 'day', date: d, diary: db.prepare('SELECT * FROM diary WHERE date = ?').get(d) || null, day_note: db.prepare('SELECT body FROM day_notes WHERE date = ?').get(d)?.body ?? null, weekday: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][dow(d)], plans, tasks };
}

// ───────── 라우팅 ─────────
const json = (res, code, body, headers = {}) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
};
const readBody = (req, limit = 100_000) => new Promise((resolve, reject) => {
  let s = '';
  req.on('data', (c) => { s += c; if (s.length > limit) { reject(bad('요청이 너무 큽니다')); req.destroy(); } });
  req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch { reject(bad('JSON 형식이 올바르지 않습니다')); } });
});

async function api(req, res, url) {
  const { pathname: p, searchParams: sp } = url, m = req.method, q = Object.fromEntries(sp);
  const body = ['POST', 'PUT'].includes(m) ? await readBody(req, p === '/api/import' ? 5_000_000 : p === '/api/day-note' || p === '/api/month-note' ? 1_000_000 : 100_000) : {};
  let r;
  if (p === '/api/meta' && m === 'GET') return json(res, 200, { today: today(), notice: '지금은 로그인이 없어 링크를 아는 사람은 누구나 볼 수 있습니다. 남이 봐도 괜찮은 내용만 넣으세요.' });
  if (p === '/api/plans' && m === 'GET') {
    const plans = db.prepare('SELECT * FROM plans WHERE archived = 0 ORDER BY id').all();
    plans.forEach((pl) => { pl.revisions = db.prepare('SELECT * FROM plan_revisions WHERE plan_id = ? ORDER BY rev_no').all(pl.id); });
    return json(res, 200, plans);
  }
  if (p === '/api/plans' && m === 'POST') return json(res, 201, createPlan(body));
  if ((r = p.match(/^\/api\/plans\/(PLN-\d+)\/color$/)) && m === 'PUT') {
    const col = body.color || '';
    if (col && !/^#[0-9a-fA-F]{6}$/.test(col)) throw bad('색상 형식이 올바르지 않습니다');
    if (!db.prepare('UPDATE plans SET color = ? WHERE id = ?').run(col ? col.toLowerCase() : null, r[1]).changes) throw new HttpError(404, '계획이 없습니다');
    return json(res, 200, { ok: true });
  }
  if ((r = p.match(/^\/api\/plans\/(PLN-\d+)$/)) && m === 'DELETE') {
    // 수정 이력은 지울 수 없으므로 계획은 '숨김' 처리하고, 그 계획의 할 일만 삭제한다
    return json(res, 200, tx(() => {
      if (!db.prepare('SELECT 1 FROM plans WHERE id = ? AND archived = 0').get(r[1])) throw new HttpError(404, '계획이 없습니다');
      const n = db.prepare('DELETE FROM tasks WHERE plan_id = ?').run(r[1]).changes;
      db.prepare('UPDATE plans SET archived = 1, updated_at = ? WHERE id = ?').run(nowIso(), r[1]);
      return { ok: true, tasks_deleted: n };
    }));
  }
  if ((r = p.match(/^\/api\/plans\/(PLN-\d+)$/)) && m === 'PUT') return json(res, 200, updatePlan(r[1], body, body.change_note));
  if (p === '/api/tasks' && m === 'GET') return json(res, 200, listTasks(q));
  if (p === '/api/tasks' && m === 'POST') {
    const t = readTask(body), at = nowIso(), rep = body.repeat && REPEATS[body.repeat.freq] ? body.repeat : null;
    let until = '';
    const count = rep ? repCount(rep) : 0;
    if (rep && !count && rep.until) { until = date(rep.until, '반복 종료일'); if (until < t.due_date) throw bad('반복 종료일은 시작일보다 빠를 수 없습니다'); }
    const dates = rep ? repeatDates(t.due_date, rep.freq, until, count) : [t.due_date], sid = rep ? randomUUID() : null;
    const ins = db.prepare(`INSERT INTO tasks (plan_id,title,detail,tags,due_date,due_time,priority,est_min,original_date,color,end_date,end_time,series_id,repeat_freq,repeat_until,repeat_count,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const first = tx(() => dates.map((d) => ins.run(t.plan_id, t.title, t.detail, t.tags, d, t.due_time, t.priority, t.est_min, d, t.color, t.end_date ? addDays(t.end_date, dayDiff(d, t.due_date)) : '', t.end_time, sid, rep ? rep.freq : '', until, count, at, at).lastInsertRowid)[0]);
    return json(res, 201, { ...withRuns(first), created: dates.length });
  }
  if ((r = p.match(/^\/api\/tasks\/(\d+)$/))) {
    const id = Number(r[1]);
    if (m === 'GET') return json(res, 200, withRuns(id));
    if (m === 'PUT') {
      const old = getTask(id);
      const t = readTask(body);
      if (q.scope === 'future' && old.series_id) { // 반복 이벤트: 이 이벤트와 이후 모든 이벤트에 같이 적용 (날짜를 옮기면 같은 만큼 같이 이동)
        const delta = dayDiff(t.due_date, old.due_date), span = t.end_date ? dayDiff(t.end_date, t.due_date) : 0;
        tx(() => db.prepare('SELECT id, due_date FROM tasks WHERE series_id = ? AND due_date >= ?').all(old.series_id, old.due_date).forEach((x) => {
          const nd = addDays(x.due_date, delta);
          db.prepare(`UPDATE tasks SET title=?,detail=?,tags=?,due_date=?,due_time=?,priority=?,est_min=?,color=?,end_date=?,end_time=?,updated_at=? WHERE id=?`)
            .run(t.title, t.detail, t.tags, nd, t.due_time, t.priority, t.est_min, t.color, t.end_date ? addDays(nd, span) : '', t.end_time, nowIso(), x.id);
        }));
        if (body.repeat !== undefined) applyRepeat(id, body.repeat);
        return json(res, 200, withRuns(id));
      }
      db.prepare(`UPDATE tasks SET plan_id=?,title=?,detail=?,tags=?,due_date=?,due_time=?,priority=?,est_min=?,color=?,end_date=?,end_time=?,updated_at=? WHERE id=?`)
        .run(t.plan_id, t.title, t.detail, t.tags, t.due_date, t.due_time, t.priority, t.est_min, t.color, t.end_date, t.end_time, nowIso(), id);
      if (body.repeat !== undefined) applyRepeat(id, body.repeat);
      return json(res, 200, withRuns(id));
    }
    if (m === 'DELETE') {
      const old = getTask(id);
      if (q.scope === 'future' && old.series_id) return json(res, 200, { ok: true, deleted: db.prepare('DELETE FROM tasks WHERE series_id = ? AND due_date >= ?').run(old.series_id, old.due_date).changes });
      db.prepare('DELETE FROM tasks WHERE id = ?').run(id); return json(res, 200, { ok: true, deleted: 1 });
    }
  }
  if (p === '/api/tasks/restore' && m === 'POST') return json(res, 201, restoreTask(body));
  if ((r = p.match(/^\/api\/tasks\/(\d+)\/sets$/)) && m === 'PUT') return json(res, 200, saveSets(Number(r[1]), body));
  if ((r = p.match(/^\/api\/tasks\/(\d+)\/duplicate$/)) && m === 'POST') {
    const t = getTask(Number(r[1]));
    const ds = [...new Set((Array.isArray(body.dates) ? body.dates : [body.date]).map((d) => date(d, '복제할 날짜')))];
    if (!ds.length || ds.length > 31) throw bad('복제할 날짜를 1~31개 선택해 주세요');
    return json(res, 201, { created: tx(() => ds.map((d) => insertCopy(t, d))).map(withRuns) });
  }
  if ((r = p.match(/^\/api\/tasks\/(\d+)\/(complete|skip|undo)$/)) && m === 'POST') {
    const id = Number(r[1]);
    return json(res, 200, r[2] === 'complete' ? completeTask(id, body) : r[2] === 'skip' ? skipTask(id, body) : { task: undoTask(id) });
  }
  if (p === '/api/calendar' && m === 'GET') {
    const from = date(q.from, 'from'), to = date(q.to, 'to');
    return json(res, 200, db.prepare(`SELECT due_date d, COUNT(*) total, SUM(status='done') done FROM tasks WHERE due_date BETWEEN ? AND ? GROUP BY due_date`).all(from, to));
  }
  if (p === '/api/tags' && m === 'GET') return json(res, 200, tagStats());
  if (p === '/api/tags' && m === 'POST') return json(res, 201, addTag(body));
  if (p === '/api/tags/rename' && m === 'POST') return json(res, 200, renameTag(body));
  if (p === '/api/tags/delete' && m === 'POST') return json(res, 200, deleteTag(body));
  if (p === '/api/tags/color' && m === 'PUT') return json(res, 200, setTagColor(body));
  if (p === '/api/tag-items' && m === 'GET') return json(res, 200, tagItems(q.tag));
  if (p === '/api/diary' && m === 'GET') return json(res, 200, diaryDay(date(q.date, 'date')));
  if (p === '/api/diary' && m === 'PUT') return json(res, 200, saveDiary(body));
  { // 체크리스트 / 휴지통
    const ck = p.match(/^\/api\/tasks\/(\d+)\/checklist$/);
    if (ck && m === 'GET') return json(res, 200, db.prepare('SELECT id, text, done FROM checklist_items WHERE task_id = ? ORDER BY pos, id').all(Number(ck[1])));
    if (ck && m === 'PUT') {
      const tid = Number(ck[1]); getTask(tid);
      const items = Array.isArray(body.items) ? body.items.slice(0, 50) : [];
      tx(() => { db.prepare('DELETE FROM checklist_items WHERE task_id = ?').run(tid);
        items.forEach((x, i) => { const tx_ = String(x.text ?? '').trim().slice(0, 100); if (tx_) db.prepare('INSERT INTO checklist_items (task_id, text, done, pos) VALUES (?,?,?,?)').run(tid, tx_, x.done ? 1 : 0, i); }); });
      return json(res, 200, db.prepare('SELECT id, text, done FROM checklist_items WHERE task_id = ? ORDER BY pos, id').all(tid));
    }
    if (p === '/api/ddays' && m === 'GET') return json(res, 200, db.prepare('SELECT id, title, date, task_id FROM ddays ORDER BY date, id').all());
    if (p === '/api/ddays' && m === 'POST') {
      const title = String(body.title ?? '').trim().slice(0, 30); if (!title) throw bad('이름을 입력해 주세요');
      const d = date(body.date, '날짜');
      if (db.prepare('SELECT COUNT(*) c FROM ddays').get().c >= 100) throw bad('D-day는 100개까지 저장할 수 있어요');
      db.prepare('INSERT INTO ddays (title, date, created_at, task_id) VALUES (?,?,?,?)').run(title, d, nowIso(), Number.isInteger(body.task_id) ? body.task_id : null);
      return json(res, 201, db.prepare('SELECT id, title, date, task_id FROM ddays ORDER BY date, id').all());
    }
    const dd = p.match(/^\/api\/ddays\/(\d+)$/);
    if (dd && m === 'PUT') {
      const title = String(body.title ?? '').trim().slice(0, 30); if (!title) throw bad('이름을 입력해 주세요');
      if (!db.prepare('UPDATE ddays SET title = ?, date = ?, task_id = COALESCE(?, task_id) WHERE id = ?').run(title, date(body.date, '날짜'), Number.isInteger(body.task_id) ? body.task_id : null, Number(dd[1])).changes) throw bad('찾을 수 없어요');
      return json(res, 200, db.prepare('SELECT id, title, date, task_id FROM ddays ORDER BY date, id').all());
    }
    if (dd && m === 'DELETE') { db.prepare('DELETE FROM ddays WHERE id = ?').run(Number(dd[1])); return json(res, 200, db.prepare('SELECT id, title, date, task_id FROM ddays ORDER BY date, id').all()); }
    if (p === '/api/trash' && m === 'GET') return json(res, 200, db.prepare('SELECT id, task_id, title, due_date, snapshot, deleted_at FROM trash ORDER BY id DESC').all().map((x) => ({ ...x, snapshot: JSON.parse(x.snapshot) })));
    if (p === '/api/trash' && m === 'POST') {
      const t = body.task || {}; if (!t.title || !t.due_date) throw bad('휴지통에 넣을 수 없어요');
      db.prepare('INSERT INTO trash (task_id, title, due_date, snapshot, deleted_at) VALUES (?,?,?,?,?)').run(Number(t.id) || null, String(t.title).slice(0, 120), String(t.due_date).slice(0, 10), JSON.stringify(body), nowIso());
      db.prepare('DELETE FROM trash WHERE id NOT IN (SELECT id FROM trash ORDER BY id DESC LIMIT 100)').run();
      return json(res, 201, { ok: true });
    }
    const tr = p.match(/^\/api\/trash\/(\d+)$/);
    if (tr && m === 'DELETE') { db.prepare('DELETE FROM trash WHERE id = ?').run(Number(tr[1])); return json(res, 200, { ok: true }); }
  }
  if (p === '/api/diary-search' && m === 'GET') { const s = String(q.q || '').trim(); if (!s) return json(res, 200, []); const like = `%${s.replace(/[\\%_]/g, '\\$&')}%`; return json(res, 200, db.prepare("SELECT * FROM diary WHERE body LIKE ? ESCAPE '\\' ORDER BY date DESC LIMIT 50").all(like)); }
  if (p === '/api/diary-list' && m === 'GET') return json(res, 200, db.prepare('SELECT * FROM diary WHERE date BETWEEN ? AND ? ORDER BY date').all(date(q.from, 'from'), date(q.to, 'to')));
  if (p === '/api/copy-day' && m === 'POST') return json(res, 200, copyDay(body));
  if (p === '/api/import' && m === 'POST') return json(res, 200, { imported: importAll(body) });
  if (p === '/api/apply-estimate' && m === 'POST') return json(res, 200, applyEstimate(body));
  if (p === '/api/trends' && m === 'GET') return json(res, 200, trends(Math.min(Math.max(Number(q.weeks) || 8, 1), 26)));
  if (p === '/api/review/month' && m === 'GET') return json(res, 200, monthReview(q.month, q.to));
  if (p === '/api/review' && m === 'GET') { const ws = weekStart(date(q.week, 'week')); let we = addDays(ws, 6); if (q.to && validDate(q.to) && q.to >= ws && q.to < we) we = q.to; return json(res, 200, review(ws, we)); }   // 진행 중인 주는 오늘까지만 집계
  if (p === '/api/review' && m === 'PUT') return json(res, 200, saveReview(body));
  // 달 노트: day_notes 표에 'YYYY-MM' 키로 저장한다 (날짜 키는 10자라 겹치지 않음)
  if (p === '/api/month-note') {
    const key = (v) => { if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(v || ''))) throw bad('월 형식이 올바르지 않습니다'); return String(v); };
    if (m === 'GET') { const k = key(q.month), row = db.prepare('SELECT body FROM day_notes WHERE date = ?').get(k); return json(res, 200, { month: k, saved: !!row, body: row ? row.body : '' }); }
    if (m === 'PUT') {
      const k = key(body.month), text = typeof body.body === 'string' ? body.body : '';
      if (text.length > 800_000) throw bad('메모가 너무 커요 (이미지를 줄여 주세요)');
      db.prepare(`INSERT INTO day_notes (date, body, updated_at) VALUES (?,?,?) ON CONFLICT(date) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at`).run(k, text, nowIso());
      return json(res, 200, { ok: true });
    }
  }
  if (p === '/api/day-note' && m === 'GET') {
    const d = date(q.date, 'date'), row = db.prepare('SELECT body FROM day_notes WHERE date = ?').get(d);
    return json(res, 200, { date: d, saved: !!row, body: row ? row.body : '' });
  }
  if (p === '/api/day-note' && m === 'PUT') {
    const d = date(body.date, '날짜'), text = typeof body.body === 'string' ? body.body : '';
    if (text.length > 800_000) throw bad('메모가 너무 커요 (이미지를 줄여 주세요)');
    db.prepare(`INSERT INTO day_notes (date, body, updated_at) VALUES (?,?,?) ON CONFLICT(date) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at`).run(d, text, nowIso());
    return json(res, 200, { ok: true });
  }
  if (p === '/api/export' && m === 'GET') {
    const d = q.date ? date(q.date, 'date') : null;
    const data = exportData(d, q.scope);
    const name = q.scope === 'all' ? 'pds-all.json' : d ? `pds-${d}.json` : 'pds-calendar.json';
    return json(res, 200, data, { 'Content-Disposition': `attachment; filename="${name}"` });
  }
  throw new HttpError(404, '없는 주소입니다');
}

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml' };
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const file = path.join(ROOT, 'public', rel);
    if (!file.startsWith(path.join(ROOT, 'public') + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) throw new HttpError(404, '없는 페이지입니다');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    if (e instanceof HttpError) return json(res, e.code, { error: e.message });
    console.error(e);
    json(res, 500, { error: '서버 오류가 발생했습니다' });
  }
}).listen(PORT, () => console.log(`Plan-Do-See → http://localhost:${PORT}`));
