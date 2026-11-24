// src/ui/adminForwarded.js
// Listado y gestión real de vídeos reenviados en canales ::tgstorage.
import { loadLibrary } from '../library/channels.js';
import { Api } from 'telegram';

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
function setProgress(bar, { title, status, percent = 0, done = false, error = false }) {
  bar.innerHTML = `<div class="admin-upload-bar-inner">
    <div class="admin-upload-bar-left">${error ? '<span class="admin-upload-bar-icon" style="color:#f87171;">⚠️</span>' : done ? '<span class="admin-upload-bar-icon" style="color:#34d399;">✓</span>' : '<span class="admin-upload-spinner"></span>'}
      <div class="admin-upload-bar-text"><div class="admin-upload-bar-title"><strong>${esc(title)}</strong></div><div class="admin-upload-bar-sub" style="color:${error ? '#f87171' : done ? '#34d399' : ''}">${esc(status)}</div></div></div>
    <div class="admin-upload-bar-right"><div class="admin-upload-bar-track"><div class="admin-upload-bar-fill" style="width:${percent}%;"></div></div><span class="admin-upload-bar-pct">${percent}%</span>
      ${done || error ? '<button class="admin-upload-bar-close" title="Cerrar">×</button>' : ''}</div></div>`;
  bar.querySelector('.admin-upload-bar-close')?.addEventListener('click', () => bar.remove());
}

export async function renderForwardedTab({ mainPanel, client, tg }) {
  mainPanel.innerHTML = `<div class="admin-panel-header"><div class="admin-panel-title"><h2>Listar vídeos reenviados</h2><p>Selecciona vídeos reenviados de los canales ::tgstorage para descargarlos o resubirlos al canal correspondiente.</p></div><button class="btn-primary" data-focusable id="btn-load-forwarded">Cargar vídeos reenviados</button></div><div id="admin-forwarded-content"><p style="color:#aaa;">Pulsa «Cargar vídeos reenviados» para escanear los canales tgstorage.</p></div>`;
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
            byChannel.get(name).push({ key: `${channel.id}:${msg.id}`, msg, peer, channel, filename: getFilename(msg), size: Number(doc.size?.toString?.() || doc.size || 0) });
          }
        } catch (error) { console.warn('[adminForwarded] No se pudo leer canal', channel.title, error); }
      }
      if (!byChannel.size) {
        container.innerHTML = `<p style="color:#aaa;">No se encontraron vídeos reenviados en los ${channels.length} canales tgstorage.</p>`;
        loadBtn.disabled = false; loadBtn.textContent = 'Cargar vídeos reenviados'; return;
      }
      const selected = new Set();
      const total = [...byChannel.values()].reduce((sum, files) => sum + files.length, 0);
      container.innerHTML = `<p style="color:#aaa;margin-bottom:1rem;">${total} vídeos reenviados en ${byChannel.size} canales tgstorage.</p><div class="admin-accordion-list">${[...byChannel.entries()].map(([name, files], idx) => `<div class="admin-accordion-item"><div class="admin-accordion-header" data-idx="${idx}"><div style="display:flex;align-items:center;gap:.75rem"><input type="checkbox" class="forwarded-channel-check" data-channel="${esc(name)}"><strong>${esc(name)}</strong><span>${files.length} vídeos</span></div><span>▼</span></div><div class="admin-accordion-content" id="forwarded-list-${idx}" style="display:none">${files.map(file => `<div class="admin-video-row"><div class="admin-video-info"><input type="checkbox" class="forwarded-file-check" data-channel="${esc(name)}" data-key="${esc(file.key)}"><span>${esc(file.filename)}</span></div><span>${formatBytes(file.size)}</span></div>`).join('')}</div></div>`).join('')}</div><div class="admin-sticky-bar" id="forwarded-actions" style="display:none;position:fixed;bottom:0;left:0;right:0;z-index:9999;background:rgba(18,18,18,.97);padding:.9rem 1.6rem;justify-content:space-between;align-items:center"><span id="forwarded-count">0 seleccionados</span><div style="display:flex;gap:.75rem"><button class="btn-secondary" id="btn-download-forwarded">Descargar</button><button class="btn-primary" id="btn-reupload-forwarded">Resubir</button></div></div>`;
      const actions = document.getElementById('forwarded-actions');
      const update = () => { actions.style.display = selected.size ? 'flex' : 'none'; document.getElementById('forwarded-count').textContent = `${selected.size} seleccionados`; };
      container.querySelectorAll('.admin-accordion-header').forEach(header => header.addEventListener('click', e => {
        if (e.target.closest('input')) return;
        const body = document.getElementById(`forwarded-list-${header.dataset.idx}`); body.style.display = body.style.display === 'none' ? 'flex' : 'none';
      }));
      container.querySelectorAll('.forwarded-file-check').forEach(box => box.addEventListener('change', () => {
        box.checked ? selected.add(box.dataset.key) : selected.delete(box.dataset.key); update();
        const channelBox = container.querySelector(`.forwarded-channel-check[data-channel="${CSS.escape(box.dataset.channel)}"]`);
        const list = byChannel.get(box.dataset.channel) || [];
        if (channelBox) channelBox.checked = list.every(item => selected.has(item.key));
      }));
      container.querySelectorAll('.forwarded-channel-check').forEach(box => box.addEventListener('change', () => {
        const name = box.dataset.channel;
        (byChannel.get(name) || []).forEach(item => box.checked ? selected.add(item.key) : selected.delete(item.key));
        container.querySelectorAll(`.forwarded-file-check[data-channel="${CSS.escape(name)}"]`).forEach(item => { item.checked = box.checked; }); update();
      }));
      document.getElementById('btn-download-forwarded')?.addEventListener('click', () => downloadSelected(selected, byChannel, client));
      document.getElementById('btn-reupload-forwarded')?.addEventListener('click', () => showRenameAndReupload(selected, byChannel, client));
      loadBtn.disabled = false; loadBtn.textContent = 'Actualizar reenvíos';
    } catch (error) {
      console.error('[adminForwarded]', error); container.innerHTML = `<p style="color:#f87171;">Error al escanear: ${esc(error.message || error)}</p>`;
      loadBtn.disabled = false; loadBtn.textContent = 'Reintentar';
    }
  });
}

function selectedEntries(selected, byChannel) {
  return [...byChannel.values()].flat().filter(item => selected.has(item.key));
}
async function downloadSelected(selected, byChannel, client) {
  const entries = selectedEntries(selected, byChannel);
  if (!entries.length) return;
  const bar = ensureProgressBar();
  try {
    for (let i = 0; i < entries.length; i++) {
      const item = entries[i];
      setProgress(bar, { title: `Descargando ${item.filename}`, status: `${i + 1} de ${entries.length}`, percent: 0 });
      const bytes = await client.downloadMedia(item.msg.media, { progressCallback: (done, total) => setProgress(bar, { title: `Descargando ${item.filename}`, status: `${formatBytes(done)} / ${formatBytes(total)}`, percent: Math.min(100, Math.round(done / (total || item.size || 1) * 100)) }) });
      const blob = new Blob([bytes], { type: item.msg.document?.mimeType || 'application/octet-stream' });
      const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = item.filename; anchor.click(); URL.revokeObjectURL(url);
    }
    setProgress(bar, { title: 'Descarga completada', status: `Se descargaron ${entries.length} archivos.`, percent: 100, done: true });
  } catch (error) { console.error(error); setProgress(bar, { title: 'Error al descargar', status: error.message || String(error), error: true }); }
}
function showRenameAndReupload(selected, byChannel, client) {
  const entries = selectedEntries(selected, byChannel);
  if (!entries.length) return;
  const overlay = document.createElement('div'); overlay.className = 'admin-modal-overlay';
  overlay.innerHTML = `<div class="admin-modal-card"><h3>Renombrar y resubir</h3><p>Revisa el nombre final de cada archivo antes de enviarlo al mismo canal tgstorage.</p><div class="admin-reupload-name-list" style="max-height:45vh;overflow:auto">${entries.map((item, i) => `<label class="admin-field-group"><span>${esc(item.filename)} · ${formatBytes(item.size)}</span><input class="admin-input" data-index="${i}" value="${esc(item.filename)}"></label>`).join('')}</div><label style="display:flex;gap:.5rem;align-items:center"><input type="checkbox" id="admin-premium-check"> Soy usuario Premium (permite archivos de hasta 4 GB)</label><p id="admin-reupload-limit" style="color:#fbbf24"></p><div style="display:flex;justify-content:flex-end;gap:.75rem"><button class="btn-secondary" id="reupload-cancel">Cancelar</button><button class="btn-primary" id="reupload-confirm">Comenzar resubida</button></div></div>`;
  document.body.appendChild(overlay);
  const premium = overlay.querySelector('#admin-premium-check');
  const updateLimit = () => { const max = premium.checked ? 4 * 1024 ** 3 : 2 * 1024 ** 3; const excluded = entries.filter(x => x.size > max).length; overlay.querySelector('#admin-reupload-limit').textContent = excluded ? `${excluded} archivo(s) exceden el límite actual y se omitirán.` : 'Todos los archivos cumplen el límite.'; };
  premium.addEventListener('change', updateLimit); updateLimit();
  overlay.querySelector('#reupload-cancel').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#reupload-confirm').addEventListener('click', async () => {
    const maxBytes = premium.checked ? 4 * 1024 ** 3 : 2 * 1024 ** 3;
    const queue = entries.map((item, i) => ({ ...item, newName: overlay.querySelector(`input[data-index="${i}"]`).value.trim() || item.filename })).filter(item => item.size <= maxBytes);
    overlay.remove(); await reuploadQueue(queue, client);
  });
}
async function reuploadQueue(entries, client) {
  if (!entries.length) return;
  const bar = ensureProgressBar();
  for (let i = 0; i < entries.length; i++) {
    const item = entries[i];
    try {
      setProgress(bar, { title: `Resubiendo ${item.newName}`, status: `Descargando original · ${i + 1} de ${entries.length}`, percent: 0 });
      const bytes = await client.downloadMedia(item.msg.media, { progressCallback: (done, total) => setProgress(bar, { title: `Resubiendo ${item.newName}`, status: `Descargando ${formatBytes(done)} / ${formatBytes(total)}`, percent: Math.min(45, Math.round(done / (total || item.size || 1) * 45)) }) });
      const blob = new Blob([bytes], { type: item.msg.document?.mimeType || 'application/octet-stream' });
      const upload = await client.uploadFile({ file: new File([blob], item.newName, { type: blob.type }), workers: 3, onProgress: progress => setProgress(bar, { title: `Resubiendo ${item.newName}`, status: `Subiendo ${formatBytes(progress * item.size)} / ${formatBytes(item.size)}`, percent: 45 + Math.round(progress * 50) }) });
      const caption = item.msg.message || '';
      await client.sendFile(item.peer, { file: upload, caption, forceDocument: true, attributes: [new Api.DocumentAttributeFilename({ fileName: item.newName })] });
    } catch (error) {
      console.error('[adminForwarded] Error resubiendo', item.newName, error);
      setProgress(bar, { title: `Error con ${item.newName}`, status: error.message || String(error), error: true });
      return;
    }
  }
  setProgress(bar, { title: 'Resubida completada', status: `Se resubieron ${entries.length} archivos.`, percent: 100, done: true });
}
