const $ = selector => document.querySelector(selector);
const palette = [{ bg: '#f0edff', color: '#7c6fd4', icon: '✳' }, { bg: '#e4f4ed', color: '#5eaa86', icon: '✦' }, { bg: '#fff2da', color: '#d69a37', icon: '◈' }, { bg: '#e7f0fb', color: '#6689bd', icon: '▧' }, { bg: '#ffedea', color: '#d57c70', icon: '✿' }];
const columnInfo = [{ id: 'todo', title: 'To do', color: '#9b91df' }, { id: 'inprogress', title: 'In progress', color: '#e6b85d' }, { id: 'done', title: 'Done', color: '#70b895' }];
let user = null, users = [], projects = [], activeProject = null, toastTimer, projectMenu = false, boardQuery = '', statusFilter = '';

async function api(url, options = {}) {
  const response = await fetch(url, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
  return data;
}
function esc(value = '') { return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])); }
function initials(name = '?') { return name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase(); }
function toast(message) { const el = $('#toast'); el.textContent = message; el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2600); }
function updateUser() { const label = user?.name || 'Guest', mark = user ? initials(user.name) : '?'; $('#user-name').textContent = label; $('#user-email').textContent = user?.email || 'Sign in to get started'; $('#user-avatar').textContent = mark; $('#top-avatar').textContent = mark; $('#top-name').textContent = user ? user.name.split(' ')[0] : 'Guest'; }
function setDate() { $('#today-label').textContent = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date()); }
function openModal(html) { $('#modal-content').innerHTML = html; $('#modal-wrap').classList.add('open'); $('#modal-wrap').setAttribute('aria-hidden', 'false'); document.body.classList.add('locked'); }
function closeModal() { $('#modal-wrap').classList.remove('open'); $('#modal-wrap').setAttribute('aria-hidden', 'true'); document.body.classList.remove('locked'); }

function openAuth(mode = 'login') {
  const isRegister = mode === 'register';
  openModal(`<p class="eyebrow">A calmer way to get it done</p><h2 id="modal-title">${isRegister ? 'Create your workspace account.' : 'Welcome back.'}</h2><p class="modal-intro">${isRegister ? 'Sign up and start planning your next good thing.' : 'Sign in to pick up where your team left off.'}</p><form id="auth-form">${isRegister ? '<div class="field"><label for="auth-name">Your name</label><input id="auth-name" name="name" autocomplete="name" required></div>' : ''}<div class="field"><label for="auth-email">Email address</label><input id="auth-email" name="email" type="email" autocomplete="email" required></div><div class="field"><label for="auth-password">Password</label><input id="auth-password" name="password" type="password" minlength="8" autocomplete="${isRegister ? 'new-password' : 'current-password'}" required></div><p class="form-error" id="form-error"></p><button class="primary-button modal-submit" type="submit">${isRegister ? 'Create account' : 'Sign in'} &nbsp; →</button></form><p class="form-switch">${isRegister ? 'Already have an account?' : 'New to Taskspace?'} <button id="auth-switch" type="button">${isRegister ? 'Sign in' : 'Create an account'}</button></p>`);
  $('#auth-switch').onclick = () => openAuth(isRegister ? 'login' : 'register');
  $('#auth-form').onsubmit = async event => {
    event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget).entries()); const button = event.currentTarget.querySelector('button[type=submit]'); button.disabled = true;
    try { const result = await api(isRegister ? '/api/register' : '/api/login', { method: 'POST', body: JSON.stringify(data) }); user = result.user; updateUser(); closeModal(); await loadWorkspace(); toast(`Welcome${isRegister ? '' : ' back'}, ${user.name.split(' ')[0]}!`); }
    catch (error) { $('#form-error').textContent = error.message; button.disabled = false; }
  };
}
function createProject() {
  if (!user) return openAuth('login');
  openModal(`<p class="eyebrow">Start with the big picture</p><h2 id="modal-title">Make a new project.</h2><p class="modal-intro">Give your team a clear place to make progress together.</p><form id="project-form"><div class="field"><label for="project-name">Project name</label><input id="project-name" name="name" maxlength="80" placeholder="e.g. Spring refresh" required></div><div class="field"><label for="project-description">What is it about?</label><textarea id="project-description" name="description" maxlength="500" placeholder="A short note to help your team get oriented"></textarea></div><p class="form-error" id="form-error"></p><button class="primary-button modal-submit">Create project &nbsp; →</button></form>`);
  $('#project-form').onsubmit = async event => { event.preventDefault(); const button = event.currentTarget.querySelector('button'); button.disabled = true; try { const result = await api('/api/projects', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget).entries())) }); closeModal(); await loadWorkspace(); await openProject(result.id); toast('A fresh project, ready for good work.'); } catch (error) { $('#form-error').textContent = error.message; button.disabled = false; } };
}
async function loadWorkspace() {
  projects = await api('/api/projects'); users = await api('/api/users');
  renderProjects();
  if (activeProject && projects.some(project => project.id === activeProject.id)) await openProject(activeProject.id, false); else showProjects();
}
function renderProjects() {
  $('#project-count').textContent = projects.length;
  $('#stat-projects').textContent = projects.length;
  const taskCount = projects.reduce((sum, project) => sum + project.task_count, 0);
  $('#stat-tasks').textContent = taskCount;
  $('#my-task-count').textContent = taskCount;
  $('#project-nav').innerHTML = projects.slice(0, 6).map((project, i) => `<a class="project-link" data-project="${project.id}"><span class="project-color" style="background:${palette[i % palette.length].color}"></span>${esc(project.name)}</a>`).join('');
  $('#project-nav').querySelectorAll('[data-project]').forEach(link => link.onclick = () => openProject(Number(link.dataset.project)));
  $('#empty-projects').classList.toggle('visible', !projects.length);
  $('#project-grid').style.display = projects.length ? 'grid' : 'none';
  $('#project-grid').innerHTML = projects.map((project, i) => {
    const color = palette[i % palette.length], percent = project.task_count ? Math.round((project.done_count || 0) / project.task_count * 100) : 0;
    return `<article class="project-card" data-project="${project.id}"><div class="project-card-top"><div class="project-mark" style="background:${color.bg};color:${color.color}">${color.icon}</div><button class="project-dots" data-project-menu="${project.id}" aria-label="Project menu">···</button></div><h3>${esc(project.name)}</h3><p>${esc(project.description || 'A shared space for good work and thoughtful progress.')}</p><div class="project-progress-row"><span>${project.task_count} task${project.task_count === 1 ? '' : 's'}</span><span>${percent}% complete</span></div><div class="progress-track"><div class="progress-fill" style="width:${percent}%;background:${color.color}"></div></div><div class="project-foot"><div class="tiny-avatars"><span class="tiny-avatar">${initials(user?.name || 'Y')}</span></div><span class="task-total">${project.member_count} teammate${project.member_count === 1 ? '' : 's'}</span></div></article>`;
  }).join('');
  $('#project-grid').querySelectorAll('.project-card').forEach(card => card.onclick = event => { if (!event.target.closest('[data-project-menu]')) openProject(Number(card.dataset.project)); });
  $('#project-grid').querySelectorAll('[data-project-menu]').forEach(button => button.onclick = event => { event.stopPropagation(); projectMenu = Number(button.dataset.project); openProjectMenu(projectMenu); });
}
function openProjectMenu(id) {
  const project = projects.find(item => item.id === id); if (!project) return;
  openModal(`<p class="eyebrow">Project options</p><h2 id="modal-title">${esc(project.name)}</h2><p class="modal-intro">Project actions are kept simple in this starter. You can add teammates or manage tasks from its board.</p><button class="primary-button modal-submit" id="open-project-action">Open project &nbsp; →</button>`);
  $('#open-project-action').onclick = () => { closeModal(); openProject(id); };
}
function showProjects() { activeProject = null; $('#projects-view').classList.remove('hidden'); $('#board-view').classList.add('hidden'); $('#breadcrumb-current').textContent = 'My projects'; }
async function openProject(id, rerender = true) {
  activeProject = await api(`/api/projects/${id}`);
  activeProject.done_count = activeProject.tasks.filter(task => task.status === 'done').length;
  $('#projects-view').classList.add('hidden'); $('#board-view').classList.remove('hidden');
  $('#breadcrumb-current').textContent = activeProject.name; $('#board-title').textContent = activeProject.name; $('#board-description').textContent = activeProject.description || 'A shared space for good work and thoughtful progress.';
  const color = palette[(id - 1) % palette.length]; $('#board-color').style.background = color.color;
  $('#member-stack').innerHTML = activeProject.members.slice(0, 5).map((member, i) => `<span class="tiny-avatar" title="${esc(member.name)}" style="background:${palette[i % palette.length].bg};color:${palette[i % palette.length].color}">${initials(member.name)}</span>`).join('');
  renderBoard();
  if (rerender) window.scrollTo({ top: 0, behavior: 'smooth' });
}
function renderBoard() {
  if (!activeProject) return;
  $('#board-columns').innerHTML = columnInfo.map((column, index) => {
    const tasks = activeProject.tasks.filter(task => task.status === column.id && (!statusFilter || task.priority === statusFilter) && `${task.title} ${task.description} ${task.assignee_name || ''}`.toLowerCase().includes(boardQuery.toLowerCase()));
    return `<section class="board-column"><div class="column-heading"><span class="column-dot" style="background:${column.color}"></span><h3>${column.title}</h3><span class="column-count">${tasks.length}</span><button class="column-add" data-add-column="${column.id}" aria-label="Add ${column.title} task">+</button></div><div class="task-list">${tasks.map(renderTask).join('')}</div></section>`;
  }).join('');
  $('#board-columns').querySelectorAll('[data-status]').forEach(select => select.onchange = async () => { try { await api(`/api/tasks/${select.dataset.status}`, { method: 'PATCH', body: JSON.stringify({ status: select.value }) }); await openProject(activeProject.id, false); await loadProjectStats(); } catch (error) { toast(error.message); } });
  $('#board-columns').querySelectorAll('[data-delete]').forEach(button => button.onclick = async () => { if (!confirm('Delete this task?')) return; try { await api(`/api/tasks/${button.dataset.delete}`, { method: 'DELETE' }); await openProject(activeProject.id, false); toast('Task removed.'); } catch (error) { toast(error.message); } });
  $('#board-columns').querySelectorAll('[data-comment]').forEach(button => button.onclick = () => openComments(Number(button.dataset.comment)));
  $('#board-columns').querySelectorAll('[data-add-column]').forEach(button => button.onclick = () => createTask(button.dataset.addColumn));
}
function renderTask(task) {
  return `<article class="task-card"><div class="task-card-top"><span class="priority ${task.priority}">${task.priority}</span><button class="task-menu" data-delete="${task.id}" aria-label="Delete task">···</button></div><h4>${esc(task.title)}</h4>${task.description ? `<p>${esc(task.description)}</p>` : ''}<div class="task-card-bottom"><span class="task-assignee"><span class="tiny-avatar">${task.assignee_name ? initials(task.assignee_name) : '—'}</span>${esc(task.assignee_name || 'Unassigned')}</span><select data-status="${task.id}" aria-label="Change status for ${esc(task.title)}">${columnInfo.map(column => `<option value="${column.id}" ${task.status === column.id ? 'selected' : ''}>${column.title}</option>`).join('')}</select><button class="comment-button" data-comment="${task.id}">☷ &nbsp; Discuss</button></div></article>`;
}
async function loadProjectStats() { projects = await api('/api/projects'); renderProjects(); }
function createTask(defaultStatus = 'todo') {
  if (!activeProject) return;
  openModal(`<p class="eyebrow">One step at a time</p><h2 id="modal-title">Add a task.</h2><p class="modal-intro">Make the next step clear for everyone.</p><form id="task-form"><div class="field"><label for="task-title">Task name</label><input id="task-title" name="title" maxlength="120" placeholder="What needs doing?" required></div><div class="field"><label for="task-description">A few details</label><textarea id="task-description" name="description" maxlength="500" placeholder="Add context or a helpful note"></textarea></div><div class="field-row"><div class="field"><label for="task-priority">Priority</label><select id="task-priority" name="priority"><option value="low">Low</option><option value="medium" selected>Medium</option><option value="high">High</option></select></div><div class="field"><label for="task-assignee">Assign to</label><select id="task-assignee" name="assigneeId"><option value="">Anyone can pick this up</option>${activeProject.members.map(member => `<option value="${member.id}">${esc(member.name)}</option>`).join('')}</select></div></div><div class="field"><label for="task-due">Due date <span style="color:#9ca1aa;font-weight:400">(optional)</span></label><input id="task-due" type="date" name="dueDate"></div><p class="form-error" id="form-error"></p><button class="primary-button modal-submit">Add task &nbsp; →</button></form>`);
  $('#task-form').onsubmit = async event => { event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget).entries()); data.assigneeId = data.assigneeId ? Number(data.assigneeId) : null; data.status = defaultStatus; const button = event.currentTarget.querySelector('button'); button.disabled = true; try { await api(`/api/projects/${activeProject.id}/tasks`, { method: 'POST', body: JSON.stringify(data) }); const projectId = activeProject.id; closeModal(); await openProject(projectId, false); await loadProjectStats(); toast('Task added to the board.'); } catch (error) { $('#form-error').textContent = error.message; button.disabled = false; } };
}
async function openComments(taskId) {
  const task = activeProject.tasks.find(item => item.id === taskId);
  const comments = await api(`/api/tasks/${taskId}/comments`);
  const commentHtml = comments.length ? comments.map(comment => `<div class="comment"><strong>${esc(comment.author)}</strong><time>${new Date(comment.created_at + 'Z').toLocaleDateString()}</time><p>${esc(comment.body)}</p></div>`).join('') : '<p class="modal-intro">No notes yet. Start the conversation with a helpful detail.</p>';
  openModal(`<p class="eyebrow">Task conversation</p><h2 id="modal-title">${esc(task?.title || 'Task')}</h2><p class="modal-intro">A little context helps good work move along.</p><div class="comment-list">${commentHtml}</div><form id="comment-form"><div class="field"><label for="comment-body">Add a comment</label><textarea id="comment-body" name="body" maxlength="500" placeholder="Share a helpful note..." required></textarea></div><p class="form-error" id="form-error"></p><button class="primary-button modal-submit">Post comment &nbsp; →</button></form>`);
  $('#comment-form').onsubmit = async event => { event.preventDefault(); const body = new FormData(event.currentTarget).get('body'); const button = event.currentTarget.querySelector('button'); button.disabled = true; try { await api(`/api/tasks/${taskId}/comments`, { method: 'POST', body: JSON.stringify({ body }) }); await openComments(taskId); } catch (error) { $('#form-error').textContent = error.message; button.disabled = false; } };
}
function inviteMember() {
  const currentIds = new Set(activeProject.members.map(member => member.id));
  const available = users.filter(person => !currentIds.has(person.id));
  openModal(`<p class="eyebrow">Good work is better together</p><h2 id="modal-title">Invite a teammate.</h2><p class="modal-intro">Choose an account that has already joined Taskspace on this device.</p>${available.length ? `<form id="invite-form"><div class="field"><label for="invite-user">Teammate</label><select id="invite-user" name="userId">${available.map(person => `<option value="${person.id}">${esc(person.name)} · ${esc(person.email)}</option>`).join('')}</select></div><p class="form-error" id="form-error"></p><button class="primary-button modal-submit">Add to project &nbsp; →</button></form>` : '<p class="modal-intro">No other accounts yet. Sign up a teammate in another browser or after signing out, then invite them here.</p>'}`);
  if ($('#invite-form')) $('#invite-form').onsubmit = async event => { event.preventDefault(); const userId = Number(new FormData(event.currentTarget).get('userId')); try { await api(`/api/projects/${activeProject.id}/members`, { method: 'POST', body: JSON.stringify({ userId }) }); const projectId = activeProject.id; closeModal(); users = await api('/api/users'); await openProject(projectId, false); toast('Teammate added to the project.'); } catch (error) { $('#form-error').textContent = error.message; } };
}
function searchBoard() {
  openModal(`<p class="eyebrow">Find your way</p><h2 id="modal-title">Search tasks.</h2><p class="modal-intro">Search task names, notes, and assignees in this project.</p><div class="field"><label for="search-query">Search</label><input id="search-query" placeholder="Try “design” or a teammate's name" value="${esc(boardQuery)}"></div><button class="primary-button modal-submit" id="clear-search">Clear search</button>`);
  $('#search-query').oninput = event => { boardQuery = event.target.value; renderBoard(); };
  $('#clear-search').onclick = () => { boardQuery = ''; closeModal(); renderBoard(); };
}
async function boot() {
  setDate();
  $('#new-project').onclick = createProject; $('#new-project-side').onclick = createProject; $('#empty-create').onclick = createProject;
  $('#back-projects').onclick = showProjects; $('#add-task').onclick = () => createTask(); $('#invite-member').onclick = inviteMember;
  $('#board-search').onclick = searchBoard; $('#board-filter').onclick = () => { const options = ['All priorities', 'Low', 'Medium', 'High']; openModal(`<p class="eyebrow">Board view</p><h2 id="modal-title">Filter by priority.</h2><p class="modal-intro">Keep the next important thing in view.</p><div class="field"><label for="priority-filter">Priority</label><select id="priority-filter"><option value="">All priorities</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></div><button class="primary-button modal-submit" id="apply-filter">Show tasks</button>`); $('#priority-filter').value = statusFilter; $('#apply-filter').onclick = () => { statusFilter = $('#priority-filter').value; closeModal(); renderBoard(); }; };
  $('#board-sort').onclick = () => { if (!activeProject) return; activeProject.tasks.reverse(); renderBoard(); toast('Task order reversed.'); };
  $('#list-view-button').onclick = () => toast('List view is a nice next addition. The board view is ready to use.');
  $('#sort-projects').onclick = () => { projects.reverse(); renderProjects(); toast('Project order updated.'); };
  $('#project-more').onclick = () => toast('Project details are ready to share with your teammates.');
  $('#help-button').onclick = () => openModal('<p class="eyebrow">A quick tour</p><h2 id="modal-title">Small steps, good momentum.</h2><p class="modal-intro">Create a project, add tasks, give each one an owner, then move tasks from To do to In progress and Done as the team works. Open Discuss on any task to share context.</p><button class="primary-button modal-submit" id="tour-done">Got it &nbsp; →</button>');
  $('#modal-close').onclick = closeModal; $('#modal-wrap').onclick = event => { if (event.target.id === 'modal-wrap') closeModal(); }; document.addEventListener('keydown', event => { if (event.key === 'Escape') closeModal(); });
  $('#account-button').onclick = accountAction; $('#profile-button').onclick = accountAction;
  $('#search-button').onclick = () => activeProject ? searchBoard() : openModal('<p class="eyebrow">Find your way</p><h2 id="modal-title">Search projects.</h2><div class="field"><label for="project-search">Project name</label><input id="project-search" placeholder="Type to filter projects"></div>');
  $('#notification-button').onclick = () => toast('You are all caught up.');
  $('#modal-content').addEventListener('click', event => { if (event.target.id === 'tour-done') closeModal(); });
  try { const session = await api('/api/me'); user = session.user; updateUser(); if (user) await loadWorkspace(); else { projects = []; renderProjects(); } }
  catch (error) { toast(error.message); }
}
async function accountAction() { if (!user) return openAuth('login'); if (!confirm('Sign out of Taskspace?')) return; await api('/api/logout', { method: 'POST' }); user = null; activeProject = null; updateUser(); projects = []; users = []; renderProjects(); showProjects(); toast('You are signed out. See you again soon.'); }
boot();
