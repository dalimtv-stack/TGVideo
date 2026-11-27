// src/ui/uploadTasks.js
// Shared bottom-bar task list for downloads, uploads, Telegram forwards, and bulk caption edits.

const tasks = new Map();
let bar = null;
let showBtn = null;
let isHidden = false;

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function ensureBar() {
  let existing = document.getElementById('admin-global-upload-bar') || bar;
  if (!existing || !existing.isConnected) {
    existing = document.createElement('div');
    existing.id = 'admin-global-upload-bar';
    existing.className = 'admin-global-upload-bar';
    document.body.appendChild(existing);
  }

  if (!existing._hasUploadTasksListener) {
    existing._hasUploadTasksListener = true;
    existing.addEventListener('click', (e) => {
      const hideBtn = e.target.closest('#upload-bar-btn-hide');
      if (hideBtn) {
        e.preventDefault();
        e.stopPropagation();
        isHidden = true;
        render();
        return;
      }

      const closeTaskBtn = e.target.closest('[data-close-task]');
      if (closeTaskBtn) {
        e.preventDefault();
        e.stopPropagation();
        tasks.delete(closeTaskBtn.dataset.closeTask);
        render();
        return;
      }

      const clearFinishedBtn = e.target.closest('[data-clear-finished]');
      if (clearFinishedBtn) {
        e.preventDefault();
        e.stopPropagation();
        for (const [id, task] of tasks) {
          if (task.done || task.error) tasks.delete(id);
        }
        render();
        return;
      }
    });
  }

  bar = existing;
  return bar;
}

function ensureShowButton() {
  showBtn = document.getElementById('btn-show-upload-bar') || showBtn;
  if (!showBtn || !showBtn.isConnected) {
    showBtn = document.createElement('button');
    showBtn.id = 'btn-show-upload-bar';
    showBtn.type = 'button';
    showBtn.setAttribute('data-focusable', '');
    showBtn.style.cssText = `
      position: fixed;
      bottom: 16px;
      right: 20px;
      z-index: 1000000;
      background: #0284c7;
      color: #ffffff;
      border: 1px solid #38bdf8;
      border-radius: 9999px;
      padding: 0.5rem 1.1rem;
      font-size: 0.85rem;
      font-weight: 600;
      box-shadow: 0 6px 20px rgba(0,0,0,0.6);
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 0.45rem;
      transition: all 0.2s ease;
    `;
    showBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      isHidden = false;
      render();
      setTimeout(() => {
        document.getElementById('upload-bar-btn-hide')?.focus?.({ preventScroll: true });
      }, 50);
    });
    document.body.appendChild(showBtn);
  }
  return showBtn;
}

function render() {
  if (!tasks.size) {
    const b = document.getElementById('admin-global-upload-bar') || bar;
    b?.remove();
    bar = null;
    const s = document.getElementById('btn-show-upload-bar') || showBtn;
    s?.remove();
    showBtn = null;
    return;
  }

  const list = [...tasks.values()];
  const activeCount = list.filter(t => !t.done && !t.error).length;

  if (isHidden) {
    const el = document.getElementById('admin-global-upload-bar') || bar;
    if (el) el.style.display = 'none';
    const btn = ensureShowButton();
    btn.style.display = 'flex';
    btn.innerHTML = `<span>⏳ ${activeCount > 0 ? `${activeCount} subiendo` : 'Tareas'} · Mostrar</span>`;
    return;
  }

  if (showBtn) {
    showBtn.style.display = 'none';
  }

  const root = ensureBar();
  root.style.display = 'block';

  // Contenedor principal limitado a un máximo de 3 líneas con scroll
  root.innerHTML = `
    <div class="admin-uploads-container" style="max-width: 1200px; margin: 0 auto; display: flex; flex-direction: column; gap: 0.5rem;">
      <div class="admin-uploads-list" style="max-height: 135px; overflow-y: auto; overflow-x: hidden; display: flex; flex-direction: column; gap: 0.45rem; padding-right: 4px;">
        ${list.map(t => `
          <div class="admin-upload-bar-inner" data-task-id="${esc(t.id)}" style="display: flex; align-items: center; justify-content: space-between; gap: 1rem; min-height: 38px;">
            <div class="admin-upload-bar-left" style="display: flex; align-items: center; gap: 0.7rem; min-width: 0; flex: 1;">
              <span class="admin-upload-bar-icon" style="color: ${t.error ? '#f87171' : t.done ? '#34d399' : '#38bdf8'}; font-size: 1.05rem;">
                ${t.error ? '⚠️' : t.done ? '✓' : '<span class="admin-upload-spinner"></span>'}
              </span>
              <div style="min-width: 0; overflow: hidden; flex: 1;">
                <div class="admin-upload-bar-title" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #fff; font-size: 0.88rem;">
                  <strong>${esc(t.title)}</strong>
                </div>
                <div class="admin-upload-bar-sub" style="color: ${t.error ? '#f87171' : t.done ? '#34d399' : '#94a3b8'}; font-size: 0.78rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                  ${esc(t.status)}
                </div>
              </div>
            </div>
            <div class="admin-upload-bar-right" style="display: flex; align-items: center; gap: 0.65rem; flex: 0 0 250px;">
              <div class="admin-upload-bar-track" style="flex: 1; height: 7px; background: rgba(255,255,255,0.15); border-radius: 9px; overflow: hidden;">
                <div class="admin-upload-bar-fill" style="width: ${Math.max(0, Math.min(100, Number(t.percent) || 0))}%; height: 100%; background: ${t.error ? '#ef4444' : t.done ? '#10b981' : '#38bdf8'}; transition: width 0.3s ease;"></div>
              </div>
              <span class="admin-upload-bar-pct" style="width: 38px; text-align: right; color: #fff; font-size: 0.82rem; font-weight: 600;">
                ${Math.round(Number(t.percent) || 0)}%
              </span>
              ${t.done || t.error ? `
                <button type="button" data-close-task="${esc(t.id)}" aria-label="Cerrar tarea" style="background: transparent; border: 0; color: #94a3b8; font-size: 1.1rem; cursor: pointer; padding: 0 4px;">×</button>
              ` : ''}
            </div>
          </div>
        `).join('')}
      </div>

      <!-- Barra inferior de control: Botón Ocultar abajo a la izquierda y resumen / limpiar a la derecha -->
      <div style="display: flex; justify-content: space-between; align-items: center; color: #94a3b8; font-size: 0.78rem; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 0.4rem; margin-top: 0.1rem;">
        <button type="button" id="upload-bar-btn-hide" data-focusable aria-label="Ocultar barra de tareas" style="background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.18); border-radius: 4px; color: #cbd5e1; padding: 0.25rem 0.75rem; font-size: 0.78rem; cursor: pointer; display: flex; align-items: center; gap: 0.3rem;">
          <span>Ocultar</span>
        </button>
        <div style="display: flex; align-items: center; gap: 0.8rem;">
          <span class="admin-uploads-summary-count">${activeCount} activas · ${list.length} total</span>
          ${list.some(t => t.done || t.error) ? `
            <button type="button" data-clear-finished style="background: transparent; border: 0; color: #38bdf8; cursor: pointer; text-decoration: underline; font-size: 0.78rem;">
              Limpiar terminados
            </button>
          ` : ''}
        </div>
      </div>
    </div>
  `;

  const hideBtn = root.querySelector('#upload-bar-btn-hide');
  if (hideBtn) {
    hideBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      isHidden = true;
      render();
      setTimeout(() => {
        document.getElementById('btn-show-upload-bar')?.focus?.({ preventScroll: true });
      }, 50);
    };
  }
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
  const updated = { ...current, ...patch, id: String(id) };
  tasks.set(String(id), updated);

  if (isHidden) {
    if (showBtn && showBtn.isConnected) {
      const list = [...tasks.values()];
      const activeCount = list.filter(t => !t.done && !t.error).length;
      showBtn.innerHTML = `<span>⏳ ${activeCount > 0 ? `${activeCount} subiendo` : 'Tareas'} · Mostrar</span>`;
    }
    return;
  }

  const root = document.getElementById('admin-global-upload-bar');
  if (!root || !root.isConnected || !root.querySelector('.admin-uploads-list')) {
    render();
    return;
  }

  const taskRow = root.querySelector(`.admin-upload-bar-inner[data-task-id="${esc(id)}"]`);
  if (!taskRow) {
    render();
    return;
  }

  // Actualización quirúrgica de progreso y estado en el DOM existente
  // Evita destruir y recrear el DOM cada segundo, lo que cancelaba los clics en Ocultar y perdía el foco
  if (patch.status !== undefined) {
    const subEl = taskRow.querySelector('.admin-upload-bar-sub');
    if (subEl) subEl.textContent = patch.status;
  }

  const percentNum = Math.max(0, Math.min(100, Number(updated.percent) || 0));
  const fillEl = taskRow.querySelector('.admin-upload-bar-fill');
  if (fillEl) {
    fillEl.style.width = `${percentNum}%`;
    if (updated.error) fillEl.style.background = '#ef4444';
    else if (updated.done) fillEl.style.background = '#10b981';
    else fillEl.style.background = '#38bdf8';
  }

  const pctEl = taskRow.querySelector('.admin-upload-bar-pct');
  if (pctEl) {
    pctEl.textContent = `${Math.round(percentNum)}%`;
  }

  if (patch.done !== undefined || patch.error !== undefined) {
    render();
    return;
  }

  const countSpan = root.querySelector('.admin-uploads-summary-count');
  if (countSpan) {
    const list = [...tasks.values()];
    const activeCount = list.filter(t => !t.done && !t.error).length;
    countSpan.textContent = `${activeCount} activas · ${list.length} total`;
  }
}

export function finishUploadTask(id, status, percent = 100) {
  updateUploadTask(id, { status, percent, done: true, error: false });
}

export function failUploadTask(id, status) {
  updateUploadTask(id, { status, error: true, done: false });
}

export function removeUploadTask(id) {
  tasks.delete(String(id));
  render();
}
