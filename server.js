const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const db = new sqlite3.Database(path.join(__dirname, 'projects.db'));
const PORT = process.env.PORT || 3001;
app.use(express.json());
app.use(session({ secret: process.env.SESSION_SECRET || 'replace-this-development-secret', resave: false, saveUninitialized: false, cookie: { httpOnly: true, sameSite: 'lax', maxAge: 24 * 60 * 60 * 1000 } }));
app.use(express.static(path.join(__dirname, 'public')));
const run = (sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, function (err) { err ? reject(err) : resolve(this); }));
const all = (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows)));
const get = (sql, params = []) => new Promise((resolve, reject) => db.get(sql, params, (err, row) => err ? reject(err) : resolve(row)));
const auth = (req, res, next) => req.session.user ? next() : res.status(401).json({ error: 'Please sign in to continue.' });

async function initialize() {
  await run('PRAGMA foreign_keys = ON');
  await run('CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL)');
  await run('CREATE TABLE IF NOT EXISTS projects (id INTEGER PRIMARY KEY, name TEXT NOT NULL, description TEXT DEFAULT "", owner_id INTEGER NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(owner_id) REFERENCES users(id) ON DELETE CASCADE)');
  await run('CREATE TABLE IF NOT EXISTS project_members (project_id INTEGER NOT NULL, user_id INTEGER NOT NULL, PRIMARY KEY(project_id, user_id), FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE, FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE)');
  await run('CREATE TABLE IF NOT EXISTS tasks (id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL, title TEXT NOT NULL, description TEXT DEFAULT "", status TEXT NOT NULL DEFAULT "todo", priority TEXT NOT NULL DEFAULT "medium", assignee_id INTEGER, due_date TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE, FOREIGN KEY(assignee_id) REFERENCES users(id) ON DELETE SET NULL)');
  await run('CREATE TABLE IF NOT EXISTS comments (id INTEGER PRIMARY KEY, task_id INTEGER NOT NULL, user_id INTEGER NOT NULL, body TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE, FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE)');
}

app.post('/api/register', async (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name?.trim() || !email?.trim() || !password || password.length < 8) return res.status(400).json({ error: 'Enter your name, email, and a password with at least 8 characters.' });
  try {
    const result = await run('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)', [name.trim(), email.trim().toLowerCase(), await bcrypt.hash(password, 10)]);
    req.session.user = { id: result.lastID, name: name.trim(), email: email.trim().toLowerCase() };
    res.status(201).json({ user: req.session.user });
  } catch (error) { res.status(error.code === 'SQLITE_CONSTRAINT' ? 409 : 500).json({ error: error.code === 'SQLITE_CONSTRAINT' ? 'That email is already registered.' : 'Could not create your account.' }); }
});
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body || {};
  try {
    const user = await get('SELECT * FROM users WHERE email = ?', [String(email || '').trim().toLowerCase()]);
    if (!user || !(await bcrypt.compare(password || '', user.password_hash))) return res.status(401).json({ error: 'Email or password is incorrect.' });
    req.session.user = { id: user.id, name: user.name, email: user.email };
    res.json({ user: req.session.user });
  } catch { res.status(500).json({ error: 'Could not sign in.' }); }
});
app.get('/api/me', (req, res) => res.json({ user: req.session.user || null }));
app.post('/api/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get('/api/users', auth, async (req, res) => {
  try { res.json(await all('SELECT id, name, email FROM users ORDER BY name')); } catch { res.status(500).json({ error: 'Could not load teammates.' }); }
});
app.get('/api/projects', auth, async (req, res) => {
  try {
    const projects = await all(`SELECT p.*, (SELECT COUNT(*) FROM tasks t WHERE t.project_id=p.id) AS task_count, (SELECT COUNT(*) FROM tasks t WHERE t.project_id=p.id AND t.status='done') AS done_count, (SELECT COUNT(*) FROM project_members m WHERE m.project_id=p.id) AS member_count FROM projects p JOIN project_members m ON m.project_id=p.id WHERE m.user_id=? ORDER BY p.id DESC`, [req.session.user.id]);
    res.json(projects);
  } catch { res.status(500).json({ error: 'Could not load projects.' }); }
});
app.post('/api/projects', auth, async (req, res) => {
  const name = String(req.body?.name || '').trim(), description = String(req.body?.description || '').trim();
  if (!name || name.length > 80) return res.status(400).json({ error: 'Give your project a name (up to 80 characters).' });
  try {
    await run('BEGIN IMMEDIATE');
    try {
      const project = await run('INSERT INTO projects (name, description, owner_id) VALUES (?, ?, ?)', [name, description.slice(0, 500), req.session.user.id]);
      await run('INSERT INTO project_members (project_id, user_id) VALUES (?, ?)', [project.lastID, req.session.user.id]);
      await run('COMMIT');
      res.status(201).json({ id: project.lastID, name, description });
    } catch (error) { await run('ROLLBACK'); throw error; }
  } catch { res.status(500).json({ error: 'Could not create your project.' }); }
});
async function isMember(projectId, userId) { return Boolean(await get('SELECT 1 FROM project_members WHERE project_id=? AND user_id=?', [projectId, userId])); }
app.get('/api/projects/:id', auth, async (req, res) => {
  try {
    if (!(await isMember(req.params.id, req.session.user.id))) return res.status(404).json({ error: 'Project not found.' });
    const project = await get('SELECT * FROM projects WHERE id=?', [req.params.id]);
    project.members = await all('SELECT u.id, u.name, u.email FROM users u JOIN project_members m ON m.user_id=u.id WHERE m.project_id=? ORDER BY u.name', [project.id]);
    project.tasks = await all(`SELECT t.*, u.name AS assignee_name FROM tasks t LEFT JOIN users u ON u.id=t.assignee_id WHERE t.project_id=? ORDER BY CASE t.status WHEN 'todo' THEN 1 WHEN 'inprogress' THEN 2 ELSE 3 END, t.id DESC`, [project.id]);
    res.json(project);
  } catch { res.status(500).json({ error: 'Could not load this project.' }); }
});
app.post('/api/projects/:id/members', auth, async (req, res) => {
  const { id } = req.params, userId = Number(req.body?.userId);
  try {
    if (!(await isMember(id, req.session.user.id))) return res.status(404).json({ error: 'Project not found.' });
    if (!Number.isInteger(userId) || !(await get('SELECT id FROM users WHERE id=?', [userId]))) return res.status(400).json({ error: 'Choose a registered teammate.' });
    await run('INSERT OR IGNORE INTO project_members (project_id, user_id) VALUES (?, ?)', [id, userId]);
    res.status(201).json({ ok: true });
  } catch { res.status(500).json({ error: 'Could not add teammate.' }); }
});
app.post('/api/projects/:id/tasks', auth, async (req, res) => {
  const { id } = req.params, { title, description = '', priority = 'medium', assigneeId = null, dueDate = null } = req.body || {};
  if (!await isMember(id, req.session.user.id)) return res.status(404).json({ error: 'Project not found.' });
  if (!String(title || '').trim() || String(title).length > 120) return res.status(400).json({ error: 'Enter a task title (up to 120 characters).' });
  if (!['low', 'medium', 'high'].includes(priority)) return res.status(400).json({ error: 'Choose a valid priority.' });
  try {
    const member = assigneeId ? await get('SELECT user_id FROM project_members WHERE project_id=? AND user_id=?', [id, Number(assigneeId)]) : null;
    if (assigneeId && !member) return res.status(400).json({ error: 'Assignee must be a project member.' });
    const result = await run('INSERT INTO tasks (project_id, title, description, priority, assignee_id, due_date) VALUES (?, ?, ?, ?, ?, ?)', [id, String(title).trim(), String(description).trim().slice(0, 500), priority, assigneeId || null, dueDate || null]);
    res.status(201).json(await get('SELECT t.*, u.name AS assignee_name FROM tasks t LEFT JOIN users u ON u.id=t.assignee_id WHERE t.id=?', [result.lastID]));
  } catch { res.status(500).json({ error: 'Could not create task.' }); }
});
app.patch('/api/tasks/:id', auth, async (req, res) => {
  try {
    const task = await get('SELECT * FROM tasks WHERE id=?', [req.params.id]);
    if (!task || !await isMember(task.project_id, req.session.user.id)) return res.status(404).json({ error: 'Task not found.' });
    const allowed = ['todo', 'inprogress', 'done'];
    const status = req.body?.status;
    if (!allowed.includes(status)) return res.status(400).json({ error: 'Choose a valid task status.' });
    await run('UPDATE tasks SET status=? WHERE id=?', [status, task.id]);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Could not update task.' }); }
});
app.delete('/api/tasks/:id', auth, async (req, res) => {
  try {
    const task = await get('SELECT * FROM tasks WHERE id=?', [req.params.id]);
    if (!task || !await isMember(task.project_id, req.session.user.id)) return res.status(404).json({ error: 'Task not found.' });
    await run('DELETE FROM tasks WHERE id=?', [task.id]);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Could not delete task.' }); }
});
app.get('/api/tasks/:id/comments', auth, async (req, res) => {
  try {
    const task = await get('SELECT project_id FROM tasks WHERE id=?', [req.params.id]);
    if (!task || !await isMember(task.project_id, req.session.user.id)) return res.status(404).json({ error: 'Task not found.' });
    res.json(await all('SELECT c.*, u.name AS author FROM comments c JOIN users u ON u.id=c.user_id WHERE c.task_id=? ORDER BY c.id', [req.params.id]));
  } catch { res.status(500).json({ error: 'Could not load comments.' }); }
});
app.post('/api/tasks/:id/comments', auth, async (req, res) => {
  const body = String(req.body?.body || '').trim();
  if (!body || body.length > 500) return res.status(400).json({ error: 'Write a comment (up to 500 characters).' });
  try {
    const task = await get('SELECT project_id FROM tasks WHERE id=?', [req.params.id]);
    if (!task || !await isMember(task.project_id, req.session.user.id)) return res.status(404).json({ error: 'Task not found.' });
    const result = await run('INSERT INTO comments (task_id, user_id, body) VALUES (?, ?, ?)', [req.params.id, req.session.user.id, body]);
    res.status(201).json(await get('SELECT c.*, u.name AS author FROM comments c JOIN users u ON u.id=c.user_id WHERE c.id=?', [result.lastID]));
  } catch { res.status(500).json({ error: 'Could not add comment.' }); }
});

initialize().then(() => app.listen(PORT, () => console.log(`Project board running at http://localhost:${PORT}`))).catch(error => { console.error('Project board setup failed:', error); process.exit(1); });
