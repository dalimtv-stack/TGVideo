// src/ui/contextMenu.js
// Menú contextual nativo de PC (clic derecho) para archivos y fichas de vídeo:
// - Opción de descargar archivo (con barra de progreso)
// - Opción de mostrar y abrir en Telegram (enlace directo al mensaje)
// - Opción de reenviar o subida rápida a canal tgstorage

import { loadLibrary } from '../library/channels.js';
import { parseCaption, buildStandardCaption } from '../library/parse.js';
import { EXT_CHANNEL_TITLES_CACHE } from './externalTitlesCache.js';
import { startUploadTask, updateUploadTask } from './uploadTasks.js';

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
  return document.getElementById('admin-global-upload-bar');
}

function setProgressBar(_bar, { id, title, status, percent = 0, done = false, error = false }) {
  if (!id) return;
  updateUploadTask(id, { title, status, percent, done, error });
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
  const taskId = startUploadTask(`Descargando: ${filename}`, 'Conectando con Telegram…', 0);
  const totalSize = Number(file.size) || 0;

  setProgressBar(bar, {
    id: taskId,
    title: `Descargando: ${filename}`,
    status: `Conectando con Telegram… (${formatBytes(totalSize)})`,
    percent: 0,
  });

  try {
    const peer = await resolvePeer(client, tg, file.channel || file.channelId);
    const [msg] = await client.getMessages(peer, { ids: [file.messageId] });
    if (!msg || !msg.media) {
      throw new Error('No se encontró el mensaje o archivo en Telegram');
    }

    const bytes = await client.downloadMedia(msg.media, {
      progressCallback: (done, total) => {
        const t = total || totalSize || 1;
        const pct = Math.min(100, Math.round((done / t) * 100));
        setProgressBar(bar, {
          id: taskId,
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
      id: taskId,
      title: `Descarga completada: ${filename}`,
      status: `Guardado en tu equipo (${formatBytes(blob.size)})`,
      percent: 100,
      done: true,
    });
  } catch (err) {
    console.error('[contextMenu] Error descargando archivo', err);
    setProgressBar(bar, {
      id: taskId,
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

  const tgUri = `tg://privatepost?channel=${cleanId}&post=${messageId}`;
  const link = document.createElement('a');
  link.href = tgUri;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  setTimeout(() => link.remove(), 500);
}

/**
 * Modal interactivo para enviar o subir rápidamente un archivo a un canal de tgstorage.
 */
async function showForwardModal(client, tg, file, getChannels) {
  if (!client) {
    alert('Cliente de Telegram no disponible.');
    return;
  }

  let channels = [];
  try {
    if (typeof getChannels === 'function') {
      channels = getChannels() || [];
    }
    if (!channels || channels.length === 0) {
      channels = await loadLibrary(client);
    }
  } catch (err) {
    console.warn('[contextMenu] Error cargando canales tgstorage', err);
  }

  // Filtrar solo canales propios de tgstorage (excluyendo externos)
  const tgStorageChannels = (channels || []).filter(ch => !ch.isExternal && ch.category && ['Películas', 'Series', 'Deportes', 'Música'].includes(ch.category));

  if (tgStorageChannels.length === 0) {
    alert('No se encontraron canales de tgstorage disponibles en tu biblioteca para enviar el archivo.');
    return;
  }

  const filename = file.fileName || file.captionFileName || file.label || `video_${file.messageId}.mp4`;
  const sizeStr = formatBytes(file.size);

  const modalOverlay = document.createElement('div');
  modalOverlay.className = 'modal-overlay';
  modalOverlay.style.cssText = `
    position: fixed; inset: 0; z-index: 100050;
    background: rgba(0, 0, 0, 0.78); backdrop-filter: blur(4px);
    display: flex; align-items: center; justify-content: center; padding: 1rem;
  `;

  modalOverlay.innerHTML = `
    <div style="background: #181c24; border: 1px solid rgba(255,255,255,0.15); border-radius: 12px; max-width: 520px; width: 100%; box-shadow: 0 20px 40px rgba(0,0,0,0.8); color: #fff; padding: 1.5rem; font-family: inherit;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.2rem; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 0.8rem;">
        <h3 style="margin: 0; font-size: 1.2rem; font-weight: 700; display: flex; align-items: center; gap: 0.5rem;">
          <span>⚡</span> Enviar archivo a canal tgstorage
        </h3>
        <button id="modal-close-btn" style="background: transparent; border: none; color: #94a3b8; font-size: 1.4rem; cursor: pointer; padding: 0.2rem 0.5rem; border-radius: 4px;">×</button>
      </div>

      <div style="background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 0.75rem 1rem; margin-bottom: 1.2rem; font-size: 0.88rem;">
        <div style="font-weight: 600; color: #e2e8f0; margin-bottom: 0.25rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
          📄 ${esc(filename)}
        </div>
        <div style="color: #94a3b8; font-size: 0.8rem;">
          Tamaño: ${esc(sizeStr)}
        </div>
      </div>

      <div style="margin-bottom: 1.2rem;">
        <label style="display: block; font-size: 0.85rem; font-weight: 600; color: #cbd5e1; margin-bottom: 0.4rem;">
          Filtrar canal destino:
        </label>
        <input type="text" id="channel-search-input" placeholder="Buscar por nombre o categoría…" style="width: 100%; background: #0f172a; border: 1px solid rgba(255,255,255,0.16); border-radius: 6px; padding: 0.55rem 0.75rem; color: #fff; font-size: 0.9rem; margin-bottom: 0.6rem; outline: none; box-sizing: border-box;" />

        <label style="display: block; font-size: 0.85rem; font-weight: 600; color: #cbd5e1; margin-bottom: 0.4rem;">
          Canal destino (tgstorage):
        </label>
        <select id="channel-target-select" style="width: 100%; background: #0f172a; border: 1px solid rgba(255,255,255,0.16); border-radius: 6px; padding: 0.6rem 0.75rem; color: #fff; font-size: 0.9rem; outline: none; box-sizing: border-box;">
          ${tgStorageChannels.map(ch => `
            <option value="${esc(ch.id)}">[${esc(ch.category || 'General')}] ${esc(ch.title || ch.name)}</option>
          `).join('')}
        </select>
      </div>

      <div style="background: rgba(56,189,248,0.08); border: 1px solid rgba(56,189,248,0.2); border-radius: 8px; padding: 0.8rem 1rem; margin-bottom: 1.5rem;">
        <label style="display: flex; align-items: flex-start; gap: 0.6rem; cursor: pointer; font-size: 0.88rem; color: #e0f2fe;">
          <input type="checkbox" id="fast-upload-check" checked style="margin-top: 0.2rem; cursor: pointer;" />
          <div>
            <strong>⚡ Subida rápida (sin marca de 'Reenviado de')</strong>
            <div style="color: #94a3b8; font-size: 0.78rem; margin-top: 0.2rem; line-height: 1.35;">
              Usa el documento ya almacenado en Telegram mediante SendMedia. El archivo se publica como un post original del bot/canal al instante en la nube, sin descargar a tu PC ni consumir ancho de banda.
            </div>
          </div>
        </label>
      </div>

      <div style="display: flex; justify-content: flex-end; gap: 0.8rem;">
        <button type="button" id="modal-cancel-btn" style="background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.15); border-radius: 6px; padding: 0.6rem 1.2rem; color: #fff; font-size: 0.9rem; cursor: pointer;">
          Cancelar
        </button>
        <button type="button" id="modal-send-btn" style="background: var(--theme-accent, #e50914); border: none; border-radius: 6px; padding: 0.6rem 1.4rem; color: #fff; font-size: 0.9rem; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 0.4rem;">
          <span>⚡ Enviar ahora</span>
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modalOverlay);

  const searchInput = modalOverlay.querySelector('#channel-search-input');
  const targetSelect = modalOverlay.querySelector('#channel-target-select');
  const fastCheck = modalOverlay.querySelector('#fast-upload-check');
  const closeBtn = modalOverlay.querySelector('#modal-close-btn');
  const cancelBtn = modalOverlay.querySelector('#modal-cancel-btn');
  const sendBtn = modalOverlay.querySelector('#modal-send-btn');

  const closeModal = () => modalOverlay.remove();
  closeBtn.onclick = closeModal;
  cancelBtn.onclick = closeModal;

  searchInput.addEventListener('input', () => {
    const q = searchInput.value.toLowerCase().trim();
    const filtered = tgStorageChannels.filter(ch => {
      const matchName = (ch.title || ch.name || '').toLowerCase().includes(q);
      const matchCat = (ch.category || '').toLowerCase().includes(q);
      return matchName || matchCat;
    });

    if (filtered.length > 0) {
      targetSelect.innerHTML = filtered.map(ch => `
        <option value="${esc(ch.id)}">[${esc(ch.category || 'General')}] ${esc(ch.title || ch.name)}</option>
      `).join('');
    } else {
      targetSelect.innerHTML = `<option value="">No hay canales que coincidan</option>`;
    }
  });

  sendBtn.addEventListener('click', async () => {
    const targetChannelId = targetSelect.value;
    if (!targetChannelId) {
      alert('Por favor, selecciona un canal de destino.');
      return;
    }
    const targetChannel = tgStorageChannels.find(ch => String(ch.id) === String(targetChannelId));
    const targetChannelName = targetChannel?.title || targetChannel?.name || 'Canal seleccionado';
    const isFastUpload = fastCheck.checked;

    closeModal();

    const bar = ensureProgressBar();
    const taskId = startUploadTask(`${isFastUpload ? '⚡ Subida rápida' : '📤 Envío con caption app'}: ${filename}`, `Conectando con canal destino "${targetChannelName}"…`, 20);
    setProgressBar(bar, {
      id: taskId,
      title: `${isFastUpload ? '⚡ Subida rápida' : '📤 Envío con caption app'}: ${filename}`,
      status: `Conectando con canal destino "${targetChannelName}"…`,
      percent: 20,
    });

    try {
      const sourcePeer = await resolvePeer(client, tg, file.channel || file.channelId);
      const targetPeer = await resolvePeer(client, tg, targetChannel || targetChannelId);

      const [msg] = await client.getMessages(sourcePeer, { ids: [file.messageId] });
      if (!msg || !msg.media) {
        throw new Error('No se pudo encontrar el mensaje original en Telegram.');
      }

      setProgressBar(bar, {
        id: taskId,
        title: `${isFastUpload ? '⚡ Subida rápida' : '📤 Envío con caption app'}: ${filename}`,
        status: `Transmitiendo metadatos a "${targetChannelName}"…`,
        percent: 60,
      });

      // Construir caption estándar de la app para que el archivo quede perfectamente identificado
      let standardCaption = '';
      try {
        const cap = parseCaption(file.rawCaption || msg.message || '');
        standardCaption = buildStandardCaption({
          fileName: file.fileName || file.captionFileName || file.label,
          section: targetChannel?.section || targetChannel?.group || file.section || '',
          tmdbId: file.metadata?.id || file.tmdbId || cap.tmdbId || '',
          imdbId: file.metadata?.imdb_id || file.imdbId || cap.imdbId || '',
          director: file.metadata?.director || cap.director || '',
          writer: file.metadata?.writer || cap.writer || '',
          cast: file.metadata?.cast || cap.cast || '',
          rating: file.metadata?.rating || file.metadata?.vote_average || cap.rating || '',
          ageRating: file.metadata?.ageRating || cap.ageRating || '',
          synopsis: file.metadata?.overview || file.metadata?.synopsis || file.synopsis || cap.synopsis || '',
        });
      } catch (_) {
        standardCaption = file.rawCaption || msg.message || file.caption || file.label || '';
      }

      const docMedia = msg.media?.document || msg.media;
      if (!docMedia) throw new Error('El mensaje original no contiene un archivo reenviable.');

      // Enviar el medio con sendFile para aplicar el caption estándar. forwardMessages
      // conserva el caption original y no permite sustituirlo.
      await client.sendFile(targetPeer, {
        file: docMedia,
        caption: standardCaption,
        forceDocument: false,
        attributes: docMedia.attributes || [],
      });

      setProgressBar(bar, {
        id: taskId,
        title: `${isFastUpload ? '⚡ Subida rápida completada' : '📤 Envío completado'}: ${filename}`,
        status: `Añadido a "${targetChannelName}" con éxito`,
        percent: 100,
        done: true,
      });
    } catch (err) {
      console.error('[contextMenu] Error en subida/reenvío', err);
      setProgressBar(bar, {
        id: taskId,
        title: `Error al enviar: ${filename}`,
        status: err.message || String(err),
        percent: 0,
        error: true,
      });
    }
  });
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
    const internalTitles = (typeof config.getTitles === 'function' ? config.getTitles() : []) || [];
    const externalTitlesList = Array.from(EXT_CHANNEL_TITLES_CACHE?.values?.() || []).flat();
    const allTitles = [...internalTitles, ...externalTitlesList];

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
      if (!targetFile) {
        const detailEl = document.querySelector('.detail');
        const detailTitleId = detailEl?.dataset?.title;
        const dt = allTitles.find(x => String(x.id) === String(detailTitleId)) || detailEl?._titleData;
        if (dt) {
          const found = dt.archivos?.find(f => f.key === key || String(f.messageId) === String(epEl.dataset.messageId));
          if (found) {
            targetFile = found;
            titleName = dt.nombre;
          }
        }
      }
    } else if (cardEl) {
      const titleId = cardEl.dataset.title;
      const t = allTitles.find(x => String(x.id) === String(titleId)) || cardEl._titleData;
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
      min-width: 250px;
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
      <div class="pc-menu-item" id="pc-menu-forward" style="display: flex; align-items: center; gap: 0.6rem; padding: 0.6rem 0.9rem; cursor: pointer; font-size: 0.9rem; transition: background 0.15s;">
        <span style="font-size: 1.1rem;">⚡</span>
        <span>Enviar / Subir a canal tgstorage</span>
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

    menu.querySelector('#pc-menu-forward')?.addEventListener('click', (ev) => {
      ev.stopPropagation();
      removeActiveMenu();
      const currentConfig = activeContextConfig || {};
      const currentTg = currentConfig.tg;
      const currentClient = currentConfig.client || currentTg?.getClient?.();
      showForwardModal(currentClient, currentTg, targetFile, currentConfig.getChannels);
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
