// src/ui/adminForwarded.js
// Listado y gestión real de vídeos reenviados en canales ::tgstorage.
import { loadLibrary } from '../library/channels.js';
import { Api } from 'telegram';
import { startUploadTask, updateUploadTask, finishUploadTask, failUploadTask, isTaskCancelled } from './uploadTasks.js';
import { showForwardModal } from './forwardModal.js';
import { parseEpisode, parseCaption } from '../library/parse.js';
import { seriesNameFromFile } from '../library/titles.js';

function esc(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}
function getFilename(msg) {
  const doc = msg.document || msg.media?.document;
  return doc?.attributes?.find(a => a.className === 'DocumentAttributeFilename')?.fileName || `video_${msg.id}.mp4`;
}
function setProgress(taskId, { title, status, percent = 0, done = false, error = false }) {
  updateUploadTask(taskId, { title, status, percent, done, error });
}

export function sortForwardedFiles(files = []) {
  return files.sort((a, b) => {
    const nameA = a.seriesName || '';
    const nameB = b.seriesName || '';
    if (nameA && nameB && nameA.toLowerCase() !== nameB.toLowerCase()) {
      return nameA.localeCompare(nameB, 'es', { numeric: true, sensitivity: 'base' });
    }
    const aEp = (a.season > 0 || a.episode > 0);
    const bEp = (b.season > 0 || b.episode > 0);
    if (aEp && bEp) {
      if (a.season !== b.season) return a.season - b.season;
      if (a.episode !== b.episode) return a.episode - b.episode;
    } else if (aEp && !bEp) {
      return -1;
    } else if (!aEp && bEp) {
      return 1;
    }
    const cmp = (a.filename || a.fileName || '').localeCompare(b.filename || b.fileName || '', 'es', { numeric: true, sensitivity: 'base' });
    if (cmp !== 0) return cmp;
    return (a.msg?.id || a.messageId || 0) - (b.msg?.id || b.messageId || 0);
  });
}

function selectedEntries(selected, byChannel) {
  const entries = [...byChannel.values()].flat().filter(item => selected.has(item.key));
  return sortForwardedFiles(entries);
}

let forwardedDeletedHandler = null;

export async function renderForwardedTab({ mainPanel, client, tg, titles = [], getTitles = null }) {
  const safeGetTitles = typeof getTitles === 'function' ? getTitles : () => (Array.isArray(titles) ? titles : []);

  mainPanel.innerHTML = `<div class="admin-panel-header"><div class="admin-panel-title"><h2>Listar vídeos reenviados</h2><p>Selecciona vídeos reenviados de los canales ::tgstorage para descargarlos, enviarlos o resubirlos al canal correspondiente.</p></div><button class="btn-primary" data-focusable id="btn-load-forwarded">Cargar vídeos reenviados</button></div><div id="admin-forwarded-content"><p style="color:#aaa;">Pulsa «Cargar vídeos reenviados» para escanear los canales tgstorage.</p></div>`;
  const loadBtn = document.getElementById('btn-load-forwarded');
  const container = document.getElementById('admin-forwarded-content');
  loadBtn?.addEventListener('click', async () => {
    if (!client) { container.innerHTML = '<p style="color:#f87171;">Cliente de Telegram no disponible.</p>'; return; }
    loadBtn.disabled = true; loadBtn.textContent = 'Escaneando…';
    container.innerHTML = '<p style="color:#38bdf8;">Buscando mensajes reenviados en canales tgstorage…</p>';
    try {
      const channels = await loadLibrary(client);
      const byChannel = new Map();
      for (const channel of channels) {
        const peer = tg?.peerOf ? tg.peerOf(channel) : channel.entity;
        if (!peer) continue;
        try {
          for await (const msg of client.iterMessages(peer, { limit: 0 })) {
            const doc = msg.document || msg.media?.document;
            if (!doc || !(String(doc.mimeType || '').startsWith('video/') || msg.media?.video) || !(msg.fwdFrom || msg.fwdHeader)) continue;
            const name = channel.title || channel.name || `Canal ${channel.id}`;
            if (!byChannel.has(name)) byChannel.set(name, []);
            const filename = getFilename(msg);
            const ep = parseEpisode(filename);
            let seriesName = seriesNameFromFile(filename) || '';
            if (!seriesName) {
              const cap = parseCaption(msg.message || '');
              if (cap.section && !/^(?:series?|pel[ií]culas?|video|videos|tgstorage)$/i.test(cap.section.trim())) {
                seriesName = cap.section.trim();
              } else if (cap.fileName) {
                seriesName = seriesNameFromFile(cap.fileName) || '';
              }
            }
            if (!seriesName && channel.title?.includes('::')) {
              const cand = channel.title.split('::')[0].replace(/\s*\((?:19|20)\d{2}\)$/, '').trim();
              if (cand && !/^(?:series?|pel[ií]culas?|video|videos|tgstorage)$/i.test(cand)) {
                seriesName = cand;
              }
            }
            byChannel.get(name).push({
              key: `${channel.id}:${msg.id}`,
              msg,
              peer,
              channel,
              channelId: channel.id,
              messageId: msg.id,
              filename,
              fileName: filename,
              captionFileName: filename,
              rawCaption: msg.message || '',
              caption: msg.message || '',
              size: Number(doc.size?.toString?.() || doc.size || 0),
              season: ep.season,
              episode: ep.episode,
              seriesName,
              date: msg.date || 0,
            });
          }
        } catch (error) { console.warn('[adminForwarded] No se pudo leer canal', channel.title, error); }
      }
      if (!byChannel.size) {
        container.innerHTML = `<p style="color:#aaa;">No se encontraron vídeos reenviados en los ${channels.length} canales tgstorage.</p>`;
        loadBtn.disabled = false; loadBtn.textContent = 'Cargar vídeos reenviados'; return;
      }

      // Ordenar vídeos dentro de cada canal cronológicamente (temporada, capítulo, nombre)
      for (const [name, files] of byChannel.entries()) {
        sortForwardedFiles(files);
      }

      const selected = new Set();
      const total = [...byChannel.values()].reduce((sum, files) => sum + files.length, 0);
      container.innerHTML = `<p style="color:#aaa;margin-bottom:1rem;">${total} vídeos reenviados en ${byChannel.size} canales tgstorage.</p><div class="admin-accordion-list">${[...byChannel.entries()].map(([name, files], idx) => `<div class="admin-accordion-item"><div class="admin-accordion-header" data-focusable tabindex="0" role="button" data-idx="${idx}"><div style="display:flex;align-items:center;gap:.75rem"><input type="checkbox" class="forwarded-channel-check" data-focusable data-channel="${esc(name)}"><strong>${esc(name)}</strong><span>${files.length} vídeos</span></div><span>▼</span></div><div class="admin-accordion-content" id="forwarded-list-${idx}" style="display:none">${files.map(file => `<div class="admin-video-row"><div class="admin-video-info"><input type="checkbox" class="forwarded-file-check" data-focusable data-channel="${esc(name)}" data-key="${esc(file.key)}"><span>${esc(file.filename)}</span></div><span>${formatBytes(file.size)}</span></div>`).join('')}</div></div>`).join('')}</div><div class="admin-sticky-bar" id="forwarded-actions" style="display:none;position:fixed;bottom:0;left:0;right:0;z-index:9999;background:rgba(18,18,18,.97);padding:.9rem 1.6rem;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:.75rem"><span id="forwarded-count">0 seleccionados</span><div style="display:flex;gap:.75rem;flex-wrap:wrap;align-items:center"><button class="btn-secondary" data-focusable id="btn-download-forwarded">Descargar</button><button class="btn-secondary" data-focusable id="btn-reupload-forwarded">Resubir</button><button class="btn-primary" data-focusable id="btn-forward-selected" style="background:#2563eb;">⚡ Enviar</button><button class="btn-danger" data-focusable id="btn-forward-delete-selected" style="background:#dc2626;color:#fff;">⚡ Enviar y BORRAR</button></div></div>`;

      // Enlaza cada fila con su mensaje para el menú contextual («Enviar/Subir & BORRAR»)
      const itemsByKey = new Map([...byChannel.values()].flat().map(item => [item.key, item]));
      container.querySelectorAll('.forwarded-file-check').forEach(box => {
        const row = box.closest('.admin-video-row');
        if (row) row._forwardedItem = itemsByKey.get(box.dataset.key) || null;
      });
      const actions = document.getElementById('forwarded-actions');
      const update = () => { actions.style.display = selected.size ? 'flex' : 'none'; document.getElementById('forwarded-count').textContent = `${selected.size} seleccionados`; };
      container.querySelectorAll('.admin-accordion-header').forEach(header => {
        const toggle = () => {
          const body = document.getElementById(`forwarded-list-${header.dataset.idx}`);
          if (body) body.style.display = body.style.display === 'none' ? 'flex' : 'none';
        };
        header.addEventListener('click', e => {
          if (e.target.closest('input')) return;
          toggle();
        });
        header.addEventListener('keydown', e => {
          if (e.key === 'Enter' || e.key === ' ' || e.keyCode === 13 || e.keyCode === 23) {
            if (e.target.closest('input')) return;
            e.preventDefault();
            toggle();
          }
        });
      });
      container.querySelectorAll('.forwarded-file-check').forEach(box => box.addEventListener('change', () => {
        box.checked ? selected.add(box.dataset.key) : selected.delete(box.dataset.key); update();
        const chName = box.dataset.channel;
        const channelBox = Array.from(container.querySelectorAll('.forwarded-channel-check')).find(cb => cb.dataset.channel === chName);
        const list = byChannel.get(chName) || [];
        if (channelBox) channelBox.checked = list.length > 0 && list.every(item => selected.has(item.key));
      }));
      container.querySelectorAll('.forwarded-channel-check').forEach(box => box.addEventListener('change', () => {
        const name = box.dataset.channel;
        const list = byChannel.get(name) || [];
        list.forEach(item => box.checked ? selected.add(item.key) : selected.delete(item.key));
        Array.from(container.querySelectorAll('.forwarded-file-check')).filter(fb => fb.dataset.channel === name).forEach(item => { item.checked = box.checked; });
        update();
      }));

      // Tras «Enviar/Subir & BORRAR»: quitar la fila del reenvío borrado y actualizar contadores
      if (forwardedDeletedHandler) document.removeEventListener('tgv:forwarded-deleted', forwardedDeletedHandler);
      forwardedDeletedHandler = (ev) => {
        const key = ev.detail?.key;
        if (!key || !document.body.contains(container)) return;
        selected.delete(key);
        for (const [name, files] of byChannel) {
          const idx = files.findIndex(item => item.key === key);
          if (idx === -1) continue;
          files.splice(idx, 1);
          const box = Array.from(container.querySelectorAll('.forwarded-file-check')).find(b => b.dataset.key === key);
          const accordion = box?.closest('.admin-accordion-item');
          box?.closest('.admin-video-row')?.remove();
          const countEl = accordion?.querySelector('.admin-accordion-header span:not([class])');
          if (countEl) countEl.textContent = `${files.length} vídeos`;
          if (!files.length) { accordion?.remove(); byChannel.delete(name); }
          break;
        }
        update();
      };
      document.addEventListener('tgv:forwarded-deleted', forwardedDeletedHandler);

      document.getElementById('btn-download-forwarded')?.addEventListener('click', () => downloadSelected(selected, byChannel, client));
      document.getElementById('btn-reupload-forwarded')?.addEventListener('click', () => showRenameAndReupload(selected, byChannel, client));

      document.getElementById('btn-forward-selected')?.addEventListener('click', () => {
        const entries = selectedEntries(selected, byChannel);
        if (!entries.length) {
          alert('Por favor, selecciona al menos un archivo para enviar.');
          return;
        }
        const candidateSeries = entries.find(e => e.seriesName)?.seriesName || '';
        const isSerie = Boolean(candidateSeries) || entries.some(e => (Number(e.season) > 0 || Number(e.episode) > 0));
        const syntheticTitle = {
          id: entries[0].channelId ? `forwarded-${entries[0].channelId}` : `forwarded-${Date.now()}`,
          nombre: candidateSeries || entries[0].filename || 'Lote seleccionado',
          tipo: isSerie ? 'serie' : 'pelicula',
          archivos: entries,
        };
        showForwardModal(client, tg, entries[0], () => channels, syntheticTitle, safeGetTitles, {
          selectedFiles: entries,
          deleteSourceAfter: false,
        }).catch(err => {
          console.error('[adminForwarded] Error al abrir modal de envío:', err);
          alert('Error al abrir envío a tgstorage: ' + (err.message || String(err)));
        });
      });

      document.getElementById('btn-forward-delete-selected')?.addEventListener('click', () => {
        const entries = selectedEntries(selected, byChannel);
        if (!entries.length) {
          alert('Por favor, selecciona al menos un archivo para enviar y borrar.');
          return;
        }
        const candidateSeries = entries.find(e => e.seriesName)?.seriesName || '';
        const isSerie = Boolean(candidateSeries) || entries.some(e => (Number(e.season) > 0 || Number(e.episode) > 0));
        const syntheticTitle = {
          id: entries[0].channelId ? `forwarded-${entries[0].channelId}` : `forwarded-${Date.now()}`,
          nombre: candidateSeries || entries[0].filename || 'Lote seleccionado',
          tipo: isSerie ? 'serie' : 'pelicula',
          archivos: entries,
        };
        showForwardModal(client, tg, entries[0], () => channels, syntheticTitle, safeGetTitles, {
          selectedFiles: entries,
          deleteSourceAfter: true,
          onSourceDeleted: (f) => {
            const k = f?.key || (f?.channelId && f?.messageId ? `${f.channelId}:${f.messageId}` : null);
            if (k) document.dispatchEvent(new CustomEvent('tgv:forwarded-deleted', { detail: { key: k } }));
          },
        }).catch(err => {
          console.error('[adminForwarded] Error al abrir modal de envío y borrado:', err);
          alert('Error al abrir envío y borrado: ' + (err.message || String(err)));
        });
      });

      loadBtn.disabled = false; loadBtn.textContent = 'Actualizar reenvíos';
    } catch (error) {
      console.error('[adminForwarded]', error); container.innerHTML = `<p style="color:#f87171;">Error al escanear: ${esc(error.message || error)}</p>`;
      loadBtn.disabled = false; loadBtn.textContent = 'Reintentar';
    }
  });
}

async function downloadSelected(selected, byChannel, client) {
  const entries = selectedEntries(selected, byChannel);
  if (!entries.length) return;
  const taskIds = entries.map(item => startUploadTask(`Descargando ${item.filename}`, 'En cola…', 0));
  for (let i = 0; i < entries.length; i++) {
    const item = entries[i];
    const taskId = taskIds[i];
    if (isTaskCancelled(taskId)) {
      failUploadTask(taskId, 'Descarga cancelada');
      continue;
    }
    try {
      setProgress(taskId, { title: `Descargando ${item.filename}`, status: `Iniciando · ${i + 1} de ${entries.length}`, percent: 0 });
      const bytes = await client.downloadMedia(item.msg.media, {
        progressCallback: (done, total) => {
          if (isTaskCancelled(taskId)) throw new Error('Descarga cancelada por el usuario');
          setProgress(taskId, {
            title: `Descargando ${item.filename}`,
            status: `${formatBytes(done)} / ${formatBytes(total)}`,
            percent: Math.min(100, Math.round(done / (total || item.size || 1) * 100))
          });
        }
      });
      const blob = new Blob([bytes], { type: item.msg.document?.mimeType || 'application/octet-stream' });
      const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = item.filename; anchor.click(); URL.revokeObjectURL(url);
      finishUploadTask(taskId, 'Descarga guardada en el dispositivo', 100);
    } catch (error) {
      console.error(error);
      failUploadTask(taskId, error.message || String(error));
    }
  }
}

function showRenameAndReupload(selected, byChannel, client) {
  const entries = selectedEntries(selected, byChannel);
  if (!entries.length) return;
  const overlay = document.createElement('div'); overlay.className = 'admin-modal-overlay';
  overlay.innerHTML = `<div class="admin-modal-card"><h3>Renombrar y resubir</h3><p>Revisa el nombre final de cada archivo antes de enviarlo al mismo canal tgstorage.</p><div class="admin-reupload-name-list" style="max-height:45vh;overflow:auto">${entries.map((item, i) => `<label class="admin-field-group"><span>${esc(item.filename)} · ${formatBytes(item.size)}</span><input class="admin-input" data-focusable data-index="${i}" value="${esc(item.filename)}"></label>`).join('')}</div><label style="display:flex;gap:.5rem;align-items:center"><input type="checkbox" data-focusable id="admin-premium-check"> Soy usuario Premium (permite archivos de hasta 4 GB)</label><p id="admin-reupload-limit" style="color:#fbbf24"></p><div style="display:flex;justify-content:flex-end;gap:.75rem"><button class="btn-secondary" data-focusable id="reupload-cancel">Cancelar</button><button class="btn-primary" data-focusable id="reupload-confirm">Comenzar resubida</button></div></div>`;
  document.body.appendChild(overlay);
  const prevFocus = document.activeElement;
  setTimeout(() => {
    const confirmBtn = overlay.querySelector('#reupload-confirm');
    confirmBtn?.focus({ preventScroll: true });
    confirmBtn?.classList.add('dpad-focused');
  }, 50);
  const premium = overlay.querySelector('#admin-premium-check');
  const updateLimit = () => { const max = premium.checked ? 4 * 1024 ** 3 : 2 * 1024 ** 3; const excluded = entries.filter(x => x.size > max).length; overlay.querySelector('#admin-reupload-limit').textContent = excluded ? `${excluded} archivo(s) exceden el límite actual y se omitirán.` : 'Todos los archivos cumplen el límite.'; };
  premium.addEventListener('change', updateLimit); updateLimit();
  overlay.querySelector('#reupload-cancel').addEventListener('click', () => { overlay.remove(); prevFocus?.focus?.({ preventScroll: true }); });
  overlay.querySelector('#reupload-confirm').addEventListener('click', async () => {
    const maxBytes = premium.checked ? 4 * 1024 ** 3 : 2 * 1024 ** 3;
    const queue = entries.map((item, i) => ({ ...item, newName: overlay.querySelector(`input[data-index="${i}"]`).value.trim() || item.filename })).filter(item => item.size <= maxBytes);
    overlay.remove(); await reuploadQueue(queue, client);
  });
}
async function reuploadQueue(entries, client) {
  if (!entries.length) return;
  const taskIds = entries.map(item => startUploadTask(`Resubiendo ${item.newName}`, 'En cola…', 0));
  for (let i = 0; i < entries.length; i++) {
    const item = entries[i];
    const taskId = taskIds[i];
    if (isTaskCancelled(taskId)) {
      failUploadTask(taskId, 'Cancelado por el usuario');
      continue;
    }
    try {
      setProgress(taskId, { title: `Resubiendo ${item.newName}`, status: `Descargando original · ${i + 1} de ${entries.length}`, percent: 0 });
      const bytes = await client.downloadMedia(item.msg.media, {
        progressCallback: (done, total) => {
          if (isTaskCancelled(taskId)) throw new Error('Resubida cancelada por el usuario');
          setProgress(taskId, {
            title: `Resubiendo ${item.newName}`,
            status: `Descargando ${formatBytes(done)} / ${formatBytes(total)}`,
            percent: Math.min(45, Math.round(done / (total || item.size || 1) * 45))
          });
        }
      });
      if (isTaskCancelled(taskId)) throw new Error('Resubida cancelada por el usuario');
      const blob = new Blob([bytes], { type: item.msg.document?.mimeType || 'application/octet-stream' });
      const upload = await client.uploadFile({
        file: new File([blob], item.newName, { type: blob.type }),
        workers: 3,
        onProgress: progress => {
          if (isTaskCancelled(taskId)) throw new Error('Resubida cancelada por el usuario');
          setProgress(taskId, {
            title: `Resubiendo ${item.newName}`,
            status: `Subiendo ${formatBytes(progress * item.size)} / ${formatBytes(item.size)}`,
            percent: 45 + Math.round(progress * 50)
          });
        }
      });
      if (isTaskCancelled(taskId)) throw new Error('Resubida cancelada por el usuario');
      const caption = item.msg.message || '';
      await client.sendFile(item.peer, { file: upload, caption, forceDocument: true, attributes: [new Api.DocumentAttributeFilename({ fileName: item.newName })] });
      finishUploadTask(taskId, 'Resubida completada', 100);
    } catch (error) {
      console.error('[adminForwarded] Error resubiendo', item.newName, error);
      failUploadTask(taskId, error.message || String(error));
      return;
    }
  }
}
