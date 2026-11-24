// Shared bottom-bar task list for downloads, uploads, and Telegram forwards.
const tasks = new Map();
let bar = null;

function esc(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function ensureBar() {
  bar = document.getElementById('admin-global-upload-bar') || bar;
  if (!bar || !bar.isConnected) {
    bar = document.createElement('div');
    bar.id = 'admin-global-upload-bar';
    bar.className = 'admin-global-upload-bar';
    document.body.appendChild(bar);
  }
  return bar;
}

function render() {
  if (!tasks.size) {
    bar?.remove();
    bar = null;
    return;
  }
  const root = ensureBar();
  const list = [...tasks.values()];
  root.innerHTML = `<div class="admin-uploads-container" style="max-width:1200px;margin:0 auto;display:flex;flex-direction:column;gap:.55rem;max-height:45vh;overflow:auto">
    ${list.length > 1 ? `<div style="display:flex;justify-content:space-between;color:#94a3b8;font-size:.8rem;border-bottom:1px solid rgba(255,255,255,.1);padding-bottom:.3rem"><span>${list.filter(t => !t.done && !t.error).length} tareas activas · ${list.length} total</span><button type="button" data-clear-finished style="background:transparent;border:0;color:#38bdf8;cursor:pointer">Limpiar terminados</button></div>` : ''}
    ${list.map(t => `<div class="admin-upload-bar-inner" data-task-id="${esc(t.id)}" style="display:flex;align-items:center;justify-content:space-between;gap:1rem">
      <div class="admin-upload-bar-left" style="display:flex;align-items:center;gap:.7rem;min-width:0;flex:1">
        <span class="admin-upload-bar-icon" style="color:${t.error ? '#f87171' : t.done ? '#34d399' : '#38bdf8'}">${t.error ? '⚠️' : t.done ? '✓' : '<span class="admin-upload-spinner"></span>'}</span>
        <div style="min-width:0;overflow:hidden"><div class="admin-upload-bar-title" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#fff"><strong>${esc(t.title)}</strong></div><div class="admin-upload-bar-sub" style="color:${t.error ? '#f87171' : t.done ? '#34d399' : '#94a3b8'};font-size:.78rem">${esc(t.status)}</div></div>
      </div><div class="admin-upload-bar-right" style="display:flex;align-items:center;gap:.65rem;flex:0 0 260px"><div class="admin-upload-bar-track" style="flex:1;height:7px;background:rgba(255,255,255,.15);border-radius:9px;overflow:hidden"><div class="admin-upload-bar-fill" style="width:${Math.max(0, Math.min(100, Number(t.percent) || 0))}%;height:100%;background:${t.error ? '#ef4444' : t.done ? '#10b981' : '#38bdf8'}"></div></div><span class="admin-upload-bar-pct" style="width:38px;text-align:right;color:#fff">${Math.round(Number(t.percent) || 0)}%</span>${t.done || t.error ? `<button type="button" data-close-task="${esc(t.id)}" aria-label="Cerrar tarea" style="background:transparent;border:0;color:#94a3b8;cursor:pointer">×</button>` : ''}</div>
    </div>`).join('')}
  </div>`;
  root.querySelectorAll('[data-close-task]').forEach(btn => btn.addEventListener('click', () => { tasks.delete(btn.dataset.closeTask); render(); }));
  root.querySelector('[data-clear-finished]')?.addEventListener('click', () => { for (const [id, task] of tasks) if (task.done || task.error) tasks.delete(id); render(); });
}

export function startUploadTask(title, status = 'Iniciando…', percent = 0) {
  const id = `task-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  tasks.set(id, { id, title, status, percent, done: false, error: false });
  render();
  return id;
}

export function updateUploadTask(id, patch = {}) {
  const current = tasks.get(String(id));
  if (!current) return;
  tasks.set(String(id), { ...current, ...patch, id: String(id) });
  render();
}

export function finishUploadTask(id, status, percent = 100) {
  updateUploadTask(id, { status, percent, done: true, error: false });
}

export function failUploadTask(id, status) {
  updateUploadTask(id, { status, error: true, done: false });
}
