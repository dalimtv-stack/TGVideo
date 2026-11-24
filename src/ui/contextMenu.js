// src/ui/contextMenu.js
// Menú contextual nativo de PC (clic derecho) para archivos y fichas de vídeo:
// - Opción de descargar archivo (con barra de progreso)
// - Opción de mostrar y abrir en Telegram (enlace directo al mensaje)


function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (!n) return '0 B';
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

function ensureProgressBar() {
  let bar = document.getElementById('admin-global-upload-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'admin-global-upload-bar';
    bar.className = 'admin-global-upload-bar';
    document.body.appendChild(bar);
  }
  return bar;
}

function setProgressBar(bar, { title, status, percent = 0, done = false, error = false }) {
  bar.innerHTML = `
    <div class="admin-upload-bar-inner">
      <div class="admin-upload-bar-left">
        ${error ? '<span class="admin-upload-bar-icon" style="color:#f87171;">⚠️</span>' : done ? '<span class="admin-upload-bar-icon" style="color:#34d399;">✓</span>' : '<span class="admin-upload-spinner"></span>'}
        <div class="admin-upload-bar-text">
          <div class="admin-upload-bar-title"><strong>${esc(title)}</strong></div>
          <div class="admin-upload-bar-sub" style="color:${error ? '#f87171' : done ? '#34d399' : '#94a3b8'};">${esc(status)}</div>
        </div>
      </div>
      <div class="admin-upload-bar-right">
        <div class="admin-upload-bar-track">
          <div class="admin-upload-bar-fill" style="width:${Math.max(0, Math.min(100, percent))}%;background:${error ? '#ef4444' : done ? '#10b981' : '#38bdf8'};"></div>
        </div>
        <span class="admin-upload-bar-pct">${Math.round(percent)}%</span>
        ${done || error ? '<button class="admin-upload-bar-close" title="Cerrar">×</button>' : ''}
      </div>
    </div>
  `;
  const closeBtn = bar.querySelector('.admin-upload-bar-close');
  if (closeBtn) {
    closeBtn.onclick = () => bar.remove();
  }
}

/**
 * Descarga un archivo de vídeo de Telegram en el navegador con soporte de barra de progreso.
 */
async function triggerFileDownload(client, tg, file) {
  if (!client) {
    alert('Cliente de Telegram no disponible para descargar.');
    return;
  }
  const bar = ensureProgressBar();
  const filename = file.fileName || file.captionFileName || file.label || `video_${file.messageId}.mp4`;
  const totalSize = Number(file.size) || 0;

  setProgressBar(bar, {
    title: `Descargando: ${filename}`,
    status: `Conectando con Telegram… (${formatBytes(totalSize)})`,
    percent: 0,
  });

  try {
    const channelId = String(file.channelId || file.channel?.id || '').split('_top_')[0];
    const cleanId = channelId.replace(/^-100/, '').replace(/^-/, '');
    let peer = null;

    if (client.getInputEntity) {
      try {
        peer = await client.getInputEntity(file.channel?.entity || channelId);
      } catch (_) {
        try {
          peer = await client.getInputEntity(`-100${cleanId}`);
        } catch (_) {}
      }
    }
    if (!peer && tg?.peerOf && file.channel) {
      peer = tg.peerOf(file.channel);
    }
    if (!peer) {
      peer = channelId;
    }

    const [msg] = await client.getMessages(peer, { ids: [file.messageId] });
    if (!msg || !msg.media) {
      throw new Error('No se encontró el mensaje o archivo en Telegram');
    }

    const bytes = await client.downloadMedia(msg.media, {
      progressCallback: (done, total) => {
        const t = total || totalSize || 1;
        const pct = Math.min(100, Math.round((done / t) * 100));
        setProgressBar(bar, {
          title: `Descargando: ${filename}`,
          status: `${formatBytes(done)} / ${formatBytes(t)} (${pct}%)`,
          percent: pct,
        });
      },
    });

    const doc = msg.document || msg.media?.document;
    const blob = new Blob([bytes], { type: doc?.mimeType || 'video/mp4' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      a.remove();
      URL.revokeObjectURL(url);
    }, 1000);

    setProgressBar(bar, {
      title: `Descarga completada: ${filename}`,
      status: `Guardado en tu equipo (${formatBytes(blob.size)})`,
      percent: 100,
      done: true,
    });
  } catch (err) {
    console.error('[contextMenu] Error descargando archivo', err);
    setProgressBar(bar, {
      title: `Error al descargar: ${filename}`,
      status: err.message || String(err),
      percent: 0,
      error: true,
    });
  }
}

/**
 * Abre el mensaje correspondiente en Telegram Web / Desktop vía enlace t.me/c/...
 */
function openInTelegram(file) {
  const channelId = String(file.channelId || file.channel?.id || '').split('_top_')[0];
  const cleanId = channelId.replace(/^-100/, '').replace(/^-/, '');
  const messageId = file.messageId;

  if (!cleanId || !messageId) {
    alert('No se pudo determinar el ID del canal o mensaje para abrir en Telegram.');
    return;
  }

  // Protocolo nativo tg:// para abrir directamente Telegram Desktop en PC sin abrir ni dejar pestañas huérfanas en el navegador
  const tgUri = `tg://privatepost?channel=${cleanId}&post=${messageId}`;
  const link = document.createElement('a');
  link.href = tgUri;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  setTimeout(() => link.remove(), 500);
}

let activeMenuEl = null;
let activeContextConfig = null;
let contextMenuInitialized = false;

function removeActiveMenu() {
  if (activeMenuEl) {
    activeMenuEl.remove();
    activeMenuEl = null;
  }
}

/**
 * Inicializa el listener global de clic derecho en PC.
 */
export function initContextMenu(config) {
  activeContextConfig = config;
  // Solo instalar listeners una vez, incluso si la app renueva la sesión Telegram.
  if (contextMenuInitialized) return;
  // Solo en navegadores de escritorio (evita interferir en Smart TV o móvil).
  const isTouchOnly = 'ontouchstart' in window && !window.matchMedia('(pointer: fine)').matches;
  if (isTouchOnly) return;
  contextMenuInitialized = true;

  document.addEventListener('click', () => removeActiveMenu());
  window.addEventListener('blur', () => removeActiveMenu());
  window.addEventListener('resize', () => removeActiveMenu());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') removeActiveMenu();
  });

  document.addEventListener('contextmenu', (e) => {
    const epEl = e.target.closest('.ep');
    const cardEl = e.target.closest('.lib-card');
    const adminRow = e.target.closest('.admin-video-row');

    if (!epEl && !cardEl && !adminRow) return;

    let targetFile = null;
    let titleName = '';
    const config = activeContextConfig || {};
    const allTitles = (typeof config.getTitles === 'function' ? config.getTitles() : []) || [];

    if (epEl) {
      const key = epEl.dataset.key;
      for (const t of allTitles) {
        const found = t.archivos?.find(f => f.key === key);
        if (found) {
          targetFile = found;
          titleName = t.nombre;
          break;
        }
      }
    } else if (cardEl) {
      const titleId = cardEl.dataset.title;
      const t = allTitles.find(x => String(x.id) === String(titleId));
      if (t && t.archivos && t.archivos.length > 0) {
        // En tarjetas tomamos el primer archivo (o película principal)
        targetFile = t.archivos[0];
        titleName = t.nombre;
      }
    } else if (adminRow) {
      const fileCheck = adminRow.querySelector('input[type="checkbox"]');
      const key = fileCheck?.dataset?.key;
      if (key) {
        for (const t of allTitles) {
          const found = t.archivos?.find(f => f.key === key);
          if (found) {
            targetFile = found;
            titleName = t.nombre;
            break;
          }
        }
      }
    }

    if (!targetFile || !targetFile.messageId) return;

    e.preventDefault();
    e.stopPropagation();
    removeActiveMenu();

    const menu = document.createElement('div');
    menu.className = 'pc-context-menu';
    menu.id = 'pc-context-menu';
    menu.style.cssText = `
      position: fixed;
      z-index: 100000;
      background: #181c24;
      border: 1px solid rgba(255, 255, 255, 0.16);
      border-radius: 8px;
      box-shadow: 0 10px 25px rgba(0,0,0,0.7);
      min-width: 240px;
      padding: 0.4rem 0;
      font-family: inherit;
      color: #fff;
    `;

    const displayName = targetFile.label || targetFile.fileName || titleName || `Vídeo ${targetFile.messageId}`;
    const sizeStr = formatBytes(targetFile.size);

    menu.innerHTML = `
      <div style="padding: 0.5rem 0.9rem 0.4rem; border-bottom: 1px solid rgba(255,255,255,0.1); font-size: 0.8rem; color: #94a3b8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
        <strong style="color: #e2e8f0; display: block; overflow: hidden; text-overflow: ellipsis;">${esc(displayName)}</strong>
        <span>${esc(sizeStr)}</span>
      </div>
      <div class="pc-menu-item" id="pc-menu-download" style="display: flex; align-items: center; gap: 0.6rem; padding: 0.6rem 0.9rem; cursor: pointer; font-size: 0.9rem; transition: background 0.15s;">
        <span style="font-size: 1.1rem;">⬇️</span>
        <span>Descargar archivo</span>
      </div>
      <div class="pc-menu-item" id="pc-menu-telegram" style="display: flex; align-items: center; gap: 0.6rem; padding: 0.6rem 0.9rem; cursor: pointer; font-size: 0.9rem; transition: background 0.15s;">
        <span style="font-size: 1.1rem;">✈️</span>
        <span>Mostrar en Telegram</span>
      </div>
    `;

    // Posicionamiento inteligente para no salir de pantalla
    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    let left = e.clientX;
    let top = e.clientY;

    if (left + rect.width > window.innerWidth) {
      left = window.innerWidth - rect.width - 8;
    }
    if (top + rect.height > window.innerHeight) {
      top = window.innerHeight - rect.height - 8;
    }
    menu.style.left = `${Math.max(8, left)}px`;
    menu.style.top = `${Math.max(8, top)}px`;

    menu.querySelectorAll('.pc-menu-item').forEach(item => {
      item.addEventListener('mouseenter', () => {
        item.style.backgroundColor = '#2a3242';
      });
      item.addEventListener('mouseleave', () => {
        item.style.backgroundColor = 'transparent';
      });
    });

    menu.querySelector('#pc-menu-download')?.addEventListener('click', (ev) => {
      ev.stopPropagation();
      removeActiveMenu();
      const currentConfig = activeContextConfig || {};
      const currentTg = currentConfig.tg;
      const currentClient = currentConfig.client || currentTg?.getClient?.();
      triggerFileDownload(currentClient, currentTg, targetFile);
    });

    menu.querySelector('#pc-menu-telegram')?.addEventListener('click', (ev) => {
      ev.stopPropagation();
      removeActiveMenu();
      openInTelegram(targetFile);
    });

    activeMenuEl = menu;
  });
}
