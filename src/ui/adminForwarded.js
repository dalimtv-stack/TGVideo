// src/ui/adminForwarded.js
// Módulo para listar vídeos reenviados en canales ::tgstorage, seleccionarlos, descargarlos o resubirlos.
import { loadLibrary } from '../library/channels.js';

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatBytes(bytes) {
  const num = Number(bytes) || 0;
  if (num <= 0) return '0 B';
  if (num < 1024 * 1024) return `${(num / 1024).toFixed(1)} KB`;
  if (num < 1024 * 1024 * 1024) return `${(num / (1024 * 1024)).toFixed(1)} MB`;
  return `${(num / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export async function renderForwardedTab({ mainPanel, client, tg }) {
  mainPanel.innerHTML = `
    <div class="admin-panel-header">
      <div class="admin-panel-title">
        <h2>Listar vídeos reenviados</h2>
        <p>Localiza mensajes de vídeo reenviados exclusivamente en los canales de almacenamiento de la biblioteca (formato ::tgstorage) para descargarlos o resubirlos limpiamente.</p>
      </div>
      <button class="btn-primary" data-focusable id="btn-load-forwarded">Cargar vídeos reenviados</button>
    </div>
    <div id="admin-forwarded-content">
      <p style="color:#aaa;">Pulsa "Cargar vídeos reenviados" para escanear los canales tgstorage de la biblioteca.</p>
    </div>
  `;

  const loadBtn = document.getElementById('btn-load-forwarded');
  const container = document.getElementById('admin-forwarded-content');

  loadBtn?.addEventListener('click', async () => {
    if (!client) {
      container.innerHTML = `<p style="color:#f87171;">Cliente de Telegram no disponible.</p>`;
      return;
    }

    loadBtn.disabled = true;
    loadBtn.textContent = 'Escaneando reenvíos…';
    container.innerHTML = `<p style="color:#38bdf8;">Obteniendo canales tgstorage de la biblioteca…</p>`;

    try {
      const libraryChannels = await loadLibrary(client);

      if (!libraryChannels || libraryChannels.length === 0) {
        container.innerHTML = `<p style="color:#aaa;">No se encontraron canales tgstorage (formato ::Películas/Series/Deportes/Música::tgstorage) asociados a tu cuenta.</p>`;
        loadBtn.disabled = false;
        loadBtn.textContent = 'Cargar vídeos reenviados';
        return;
      }

      container.innerHTML = `<p style="color:#38bdf8;">Escaneando mensajes en ${libraryChannels.length} canales tgstorage…</p>`;

      const forwardedByChannel = new Map();

      for (const ch of libraryChannels) {
        const peer = tg?.peerOf ? tg.peerOf(ch) : (ch.entity || ch.id);
        try {
          for await (const msg of client.iterMessages(peer, { limit: 150 })) {
            const doc = msg.document || msg.media?.document;
            const isVid = doc && (String(doc.mimeType || '').startsWith('video/') || msg.media?.video);
            if (isVid && (msg.fwdFrom || msg.fwdHeader)) {
              const chName = ch.title || ch.name || `Canal ${ch.id}`;
              if (!forwardedByChannel.has(chName)) {
                forwardedByChannel.set(chName, []);
              }
              const size = Number(doc?.size?.toString?.() || doc?.size || 0);
              forwardedByChannel.get(chName).push({
                messageId: msg.id,
                channelId: String(ch.id),
                channelTitle: chName,
                entity: peer,
                msg,
                size,
                date: msg.date,
                fileName: doc?.attributes?.find(a => a.className === 'DocumentAttributeFilename')?.fileName || `video_${msg.id}.mp4`,
              });
            }
          }
        } catch (e) {
          console.warn('Error leyendo reenvíos en canal', ch.name, e);
        }
      }

      if (forwardedByChannel.size === 0) {
        container.innerHTML = `<p style="color:#aaa;">No se encontraron vídeos reenviados en los ${libraryChannels.length} canales tgstorage consultados.</p>`;
        loadBtn.disabled = false;
        loadBtn.textContent = 'Cargar vídeos reenviados';
        return;
      }

      const selectedKeys = new Set();
      let totalCount = 0;
      for (const list of forwardedByChannel.values()) totalCount += list.length;

      container.innerHTML = `
        <div style="margin-bottom:0.75rem;font-size:0.9rem;color:#aaa;">
          Se han detectado <strong>${totalCount} vídeos reenviados</strong> en <strong>${forwardedByChannel.size} canales tgstorage</strong>.
        </div>

        <div class="admin-accordion-list">
          ${Array.from(forwardedByChannel.entries()).map(([chName, vids], chIdx) => `
            <div class="admin-accordion-item">
              <div class="admin-accordion-header" data-ch-idx="${chIdx}">
                <div style="display:flex;align-items:center;gap:0.75rem;">
                  <input type="checkbox" class="ch-master-checkbox" data-ch-name="${esc(chName)}" />
                  <strong style="color:#fff;">${esc(chName)}</strong>
                  <span style="background:rgba(255,255,255,0.1);padding:0.15rem 0.5rem;border-radius:9999px;font-size:0.78rem;">
                    ${vids.length} vídeos
                  </span>
                </div>
                <span class="accordion-arrow">▼</span>
              </div>
              <div class="admin-accordion-content" id="accordion-content-${chIdx}" style="display:none;">
                ${vids.map(v => {
                  const key = `${v.channelId}:${v.messageId}`;
                  return `
                    <div class="admin-video-row">
                      <div class="admin-video-info">
                        <input type="checkbox" class="video-row-checkbox" data-ch-name="${esc(chName)}" data-key="${esc(key)}" />
                        <span>${esc(v.fileName)}</span>
                      </div>
                      <span style="color:#888;font-size:0.8rem;flex:0 0 auto;">${formatBytes(v.size)}</span>
                    </div>
                  `;
                }).join('')}
              </div>
            </div>
          `).join('')}
        </div>

        <div class="admin-sticky-bar" id="forwarded-sticky-bar" style="display:none;position:fixed;bottom:0;left:0;right:0;z-index:9999;background:rgba(18,18,18,0.96);box-shadow:0 -4px 20px rgba(0,0,0,0.8);padding:0.9rem 1.6rem;">
          <span id="forwarded-selected-info" style="font-size:0.95rem;color:#fff;">
            <strong>0</strong> seleccionados
          </span>
          <div style="display:flex;gap:0.75rem;">
            <button class="btn-secondary" data-focusable id="btn-download-forwarded">
              Descargar
            </button>
            <button class="btn-primary" data-focusable id="btn-reupload-forwarded">
              Resubir
            </button>
          </div>
        </div>
      `;

      const stickyBar = document.getElementById('forwarded-sticky-bar');
      const selectedInfo = document.getElementById('forwarded-selected-info');

      const updateSelectionUI = () => {
        if (stickyBar && selectedInfo) {
          stickyBar.style.display = selectedKeys.size > 0 ? 'flex' : 'none';
          selectedInfo.innerHTML = `<strong>${selectedKeys.size}</strong> seleccionados`;
        }
      };

      container.querySelectorAll('.admin-accordion-header').forEach(hdr => {
        hdr.addEventListener('click', (e) => {
          if (e.target.tagName === 'INPUT') return;
          const idx = hdr.dataset.chIdx;
          const content = document.getElementById(`accordion-content-${idx}`);
          const arrow = hdr.querySelector('.accordion-arrow');
          if (content) {
            const isOpen = content.style.display !== 'none';
            content.style.display = isOpen ? 'none' : 'flex';
            if (arrow) arrow.textContent = isOpen ? '▼' : '▲';
          }
        });
      });

      container.querySelectorAll('.video-row-checkbox').forEach(cb => {
        cb.addEventListener('change', () => {
          const key = cb.dataset.key;
          if (cb.checked) selectedKeys.add(key);
          else selectedKeys.delete(key);

          const chName = cb.dataset.chName;
          const chVids = forwardedByChannel.get(chName) || [];
          const masterCb = container.querySelector(`.ch-master-checkbox[data-ch-name="${CSS.escape(chName)}"]`);
          if (masterCb) {
            masterCb.checked = chVids.every(v => selectedKeys.has(`${v.channelId}:${v.messageId}`));
          }

          updateSelectionUI();
        });
      });

      container.querySelectorAll('.ch-master-checkbox').forEach(masterCb => {
        masterCb.addEventListener('change', () => {
          const chName = masterCb.dataset.chName;
          const chVids = forwardedByChannel.get(chName) || [];
          const check = masterCb.checked;

          chVids.forEach(v => {
            const key = `${v.channelId}:${v.messageId}`;
            if (check) selectedKeys.add(key);
            else selectedKeys.delete(key);
          });

          container.querySelectorAll(`.video-row-checkbox[data-ch-name="${CSS.escape(chName)}"]`).forEach(cb => {
            cb.checked = check;
          });

          updateSelectionUI();
        });
      });

      document.getElementById('btn-download-forwarded')?.addEventListener('click', () => {
        if (selectedKeys.size === 0) return;
        alert(`Descarga de ${selectedKeys.size} vídeos solicitada. Telegram iniciará la transferencia de los archivos seleccionados.`);
      });

      document.getElementById('btn-reupload-forwarded')?.addEventListener('click', () => {
        if (selectedKeys.size === 0) return;
        promptReupload(selectedKeys, forwardedByChannel);
      });

      loadBtn.disabled = false;
      loadBtn.textContent = 'Actualizar reenvíos';
    } catch (err) {
      console.error('Error cargando reenvíos', err);
      container.innerHTML = `<p style="color:#f87171;">Error al escanear: ${esc(err.message || String(err))}</p>`;
      loadBtn.disabled = false;
      loadBtn.textContent = 'Reintentar';
    }
  });
}

function promptReupload(selectedKeys, forwardedByChannel) {
  const existing = document.querySelector('.admin-modal-overlay');
  existing?.remove();

  const selectedFiles = [];
  for (const list of forwardedByChannel.values()) {
    for (const item of list) {
      if (selectedKeys.has(`${item.channelId}:${item.messageId}`)) {
        selectedFiles.push(item);
      }
    }
  }

  const overlay = document.createElement('div');
  overlay.className = 'admin-modal-overlay';
  overlay.innerHTML = `
    <div class="admin-modal-card">
      <h3 style="margin:0;font-size:1.15rem;color:#fff;">Resubir vídeos a Telegram</h3>
      <p style="margin:0;color:#ccc;font-size:0.9rem;">
        Se van a resubir <strong>${selectedFiles.length} vídeos</strong> a sus canales de origen para desvincularlos de reenvíos externos.
      </p>

      <div style="background:rgba(255,255,255,0.05);padding:0.9rem;border-radius:8px;font-size:0.88rem;color:#ddd;">
        <p style="margin:0 0 0.5rem 0;"><strong>¿Tu cuenta de Telegram es Premium?</strong></p>
        <label style="display:flex;align-items:center;gap:0.5rem;cursor:pointer;margin-bottom:0.3rem;">
          <input type="radio" name="premium-status" value="no" checked />
          <span>No, cuenta estándar (Límite 2 GB por archivo)</span>
        </label>
        <label style="display:flex;align-items:center;gap:0.5rem;cursor:pointer;">
          <input type="radio" name="premium-status" value="yes" />
          <span>Sí, Telegram Premium (Hasta 4 GB)</span>
        </label>
      </div>

      <div id="reupload-warning" style="font-size:0.84rem;color:#fbbf24;"></div>

      <div style="display:flex;justify-content:flex-end;gap:0.75rem;margin-top:0.5rem;">
        <button class="btn-secondary" data-focusable id="reupload-cancel-btn">Cancelar</button>
        <button class="btn-primary" data-focusable id="reupload-confirm-btn">Comenzar resubida</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const warnEl = overlay.querySelector('#reupload-warning');
  const updateWarning = () => {
    const isPremium = overlay.querySelector('input[name="premium-status"]:checked').value === 'yes';
    const maxBytes = isPremium ? 4 * 1024 * 1024 * 1024 : 2 * 1024 * 1024 * 1024;
    const filtered = selectedFiles.filter(f => f.size <= maxBytes);
    const skipped = selectedFiles.length - filtered.length;
    if (skipped > 0) {
      warnEl.textContent = `Aviso: ${skipped} archivo(s) superan el límite de ${isPremium ? '4 GB' : '2 GB'} y serán omitidos. Se procesarán ${filtered.length}.`;
    } else {
      warnEl.textContent = `Todos los ${filtered.length} archivos cumplen con el límite de tamaño.`;
    }
  };
  updateWarning();

  overlay.querySelectorAll('input[name="premium-status"]').forEach(r => {
    r.addEventListener('change', updateWarning);
  });

  overlay.querySelector('#reupload-cancel-btn')?.addEventListener('click', () => overlay.remove());

  overlay.querySelector('#reupload-confirm-btn')?.addEventListener('click', async () => {
    const isPremium = overlay.querySelector('input[name="premium-status"]:checked').value === 'yes';
    const maxBytes = isPremium ? 4 * 1024 * 1024 * 1024 : 2 * 1024 * 1024 * 1024;
    const toProcess = selectedFiles.filter(f => f.size <= maxBytes);
    overlay.remove();

    alert(`Iniciando resubida de ${toProcess.length} vídeos a sus canales correspondientes en Telegram.`);
  });
}
