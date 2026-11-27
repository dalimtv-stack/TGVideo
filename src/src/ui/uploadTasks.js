// src/ui/uploadTasks.js
// Shared bottom-bar task list for downloads, uploads, Telegram forwards, and bulk caption edits.

const tasks = new Map();
let bar = null;
let showBtn = null;
let isHidden = false;
let hiddenSide = 'right'; // 'left' | 'right'

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
      const hideSideBtn = e.target.closest('[data-hide-side]');
      if (hideSideBtn) {
        e.preventDefault();
        e.stopPropagation();
        hiddenSide = hideSideBtn.dataset.hideSide || 'right';
        isHidden = true;
        render();
        setTimeout(() => {
          document.getElementById('btn-show-upload-bar')?.focus?.({ preventScroll: true });
        }, 50);
        return;
      }

      const hideBtn = e.target.closest('#upload-bar-btn-hide');
      if (hideBtn) {
        e.preventDefault();
        e.stopPropagation();
        hiddenSide = 'right';
        isHidden = true;
        render();
        setTimeout(() => {
          document.getElementById('btn-show-upload-bar')?.focus?.({ preventScroll: true });
        }, 50);
        return;
      }

      const cancelTaskBtn = e.target.closest('[data-cancel-task]');
      if (cancelTaskBtn) {
        e.preventDefault();
        e.stopPropagation();
        cancelTask(cancelTaskBtn.dataset.cancelTask);
        return;
      }

      const stopAllBtn = e.target.closest('[data-stop-all]');
      if (stopAllBtn) {
        e.preventDefault();
        e.stopPropagation();
        stopAllTasks();
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

function ensureShowButton(side = 'right') {
  showBtn = document.getElementById('btn-show-upload-bar') || showBtn;
  if (!showBtn || !showBtn.isConnected) {
    showBtn = document.createElement('button');
    showBtn.id = 'btn-show-upload-bar';
    showBtn.type = 'button';
    showBtn.setAttribute('data-focusable', '');
    showBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      isHidden = false;
      render();
      setTimeout(() => {
        const targetFocus = side === 'left'
          ? (document.getElementById('upload-bar-btn-hide-left') || document.getElementById('upload-bar-btn-hide'))
          : (document.getElementById('upload-bar-btn-hide-right') || document.getElementById('upload-bar-btn-hide'));
        targetFocus?.focus?.({ preventScroll: true });
      }, 50);
    });
    document.body.appendChild(showBtn);
  }

  showBtn.style.cssText = `
    position: fixed;
    bottom: 16px;
    ${side === 'left' ? 'left: 20px; right: auto;' : 'right: 20px; left: auto;'}
    z-index: 1000000;
    background: #0284c7;
    color: #ffffff;
    border: 1px solid #38bdf8;
    border-radius: 9999px;
    padding: 0.5rem 1.15rem;
    font-size: 0.85rem;
    font-weight: 600;
    box-shadow: 0 6px 20px rgba(0,0,0,0.6);
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 0.45rem;
    transition: all 0.2s ease;
  `;

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
    const btn = ensureShowButton(hiddenSide);
    btn.style.display = 'flex';
    const sideArrow = hiddenSide === 'left' ? '▶' : '◀';
    btn.innerHTML = `<span>⏳ ${activeCount > 0 ? `${activeCount} activas` : 'Tareas'} · Mostrar ${sideArrow}</span>`;
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
            <div class="admin-upload-bar-right" style="display: flex; align-items: center; gap: 0.65rem; flex: 0 0 260px;">
              <div class="admin-upload-bar-track" style="flex: 1; height: 7px; background: rgba(255,255,255,0.15); border-radius: 9px; overflow: hidden;">
                <div class="admin-upload-bar-fill" style="width: ${Math.max(0, Math.min(100, Number(t.percent) || 0))}%; height: 100%; background: ${t.error ? '#ef4444' : t.done ? '#10b981' : '#38bdf8'}; transition: width 0.3s ease;"></div>
              </div>
              <span class="admin-upload-bar-pct" style="width: 38px; text-align: right; color: #fff; font-size: 0.82rem; font-weight: 600;">
                ${Math.round(Number(t.percent) || 0)}%
              </span>
              ${t.done || t.error ? `
                <button type="button" data-close-task="${esc(t.id)}" title="Quitar de la lista" aria-label="Cerrar tarea" data-focusable style="background: transparent; border: 0; color: #94a3b8; font-size: 1.15rem; cursor: pointer; padding: 0 5px; line-height: 1;">×</button>
              ` : `
                <button type="button" data-cancel-task="${esc(t.id)}" title="Cancelar este proceso" aria-label="Cancelar proceso" data-focusable style="background: rgba(239,68,68,0.22); border: 1px solid rgba(239,68,68,0.45); color: #fca5a5; font-size: 0.75rem; font-weight: 600; border-radius: 4px; padding: 2px 7px; cursor: pointer; display: inline-flex; align-items: center; gap: 3px; line-height: 1.2;">
                  <span>⏹</span><span>Parar</span>
                </button>
              `}
            </div>
          </div>
        `).join('')}
      </div>

      <!-- Barra inferior de control: Ocultar (izq/der), Parar todo y Limpiar -->
      <div style="display: flex; justify-content: space-between; align-items: center; color: #94a3b8; font-size: 0.78rem; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 0.4rem; margin-top: 0.1rem; gap: 0.5rem; flex-wrap: wrap;">
        <div style="display: flex; align-items: center; gap: 0.5rem;">
          <button type="button" id="upload-bar-btn-hide-left" data-hide-side="left" data-focusable aria-label="Ocultar a la izquierda" style="background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.18); border-radius: 4px; color: #cbd5e1; padding: 0.25rem 0.65rem; font-size: 0.78rem; cursor: pointer; display: flex; align-items: center; gap: 0.3rem;">
            <span>◀ Ocultar</span>
          </button>
        </div>

        <div style="display: flex; align-items: center; gap: 0.75rem; margin-left: auto;">
          <span class="admin-uploads-summary-count">${activeCount} activas · ${list.length} total</span>
          ${activeCount > 0 ? `
            <button type="button" id="upload-bar-btn-stop-all" data-stop-all data-focusable title="Detener todos los procesos activos" style="background: #dc2626; color: #ffffff; border: 1px solid #ef4444; border-radius: 4px; padding: 0.25rem 0.75rem; font-size: 0.78rem; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 0.35rem; box-shadow: 0 2px 6px rgba(220,38,38,0.4);">
              <span>⏹</span> Detener todo
            </button>
          ` : ''}
          ${list.some(t => t.done || t.error) ? `
            <button type="button" data-clear-finished data-focusable style="background: transparent; border: 0; color: #38bdf8; cursor: pointer; text-decoration: underline; font-size: 0.78rem;">
              Limpiar terminados
            </button>
          ` : ''}
          <button type="button" id="upload-bar-btn-hide-right" data-hide-side="right" data-focusable aria-label="Ocultar a la derecha" style="background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.18); border-radius: 4px; color: #cbd5e1; padding: 0.25rem 0.65rem; font-size: 0.78rem; cursor: pointer; display: flex; align-items: center; gap: 0.3rem;">
            <span>Ocultar ▶</span>
          </button>
        </div>
      </div>
    </div>
  `;
}

export function startUploadTask(title, status = 'Iniciando…', percent = 0, onCancel = null) {
  const id = `task-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const abortController = typeof AbortController !== 'undefined' ? new AbortController() : null;
  tasks.set(id, {
    id,
    title,
    status,
    percent,
    done: false,
    error: false,
    cancelled: false,
    abortController,
    onCancel: typeof onCancel === 'function' ? onCancel : null,
  });
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
      const sideArrow = hiddenSide === 'left' ? '▶' : '◀';
      showBtn.innerHTML = `<span>⏳ ${activeCount > 0 ? `${activeCount} activas` : 'Tareas'} · Mostrar ${sideArrow}</span>`;
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

export function cancelTask(id) {
  const current = tasks.get(String(id));
  if (!current || current.done) return;
  current.cancelled = true;
  current.error = true;
  current.status = 'Cancelado por el usuario';
  try { current.onCancel?.(); } catch (_) {}
  try { current.abortController?.abort(); } catch (_) {}
  document.dispatchEvent(new CustomEvent('tgv:task-cancelled', { detail: { taskId: String(id) } }));
  render();
}

export function stopAllTasks() {
  let stopped = 0;
  for (const [id, task] of tasks) {
    if (!task.done && !task.error) {
      task.cancelled = true;
      task.error = true;
      task.status = 'Detenido por el usuario';
      try { task.onCancel?.(); } catch (_) {}
      try { task.abortController?.abort(); } catch (_) {}
      stopped++;
    }
  }
  document.dispatchEvent(new CustomEvent('tgv:tasks-stopped', { detail: { count: stopped } }));
  render();
}

export function isTaskCancelled(id) {
  const current = tasks.get(String(id));
  return Boolean(current?.cancelled);
}
