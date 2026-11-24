// src/ui/adminUpload.js
// Módulo para configurar y realizar la subida de vídeos a canales ::tgstorage en segundo plano con barra inferior.
import { Api } from 'telegram';
import { loadLibrary } from '../library/channels.js';
import { buildStandardCaption, prettyName } from '../library/parse.js';
import { searchTmdbManual, cleanSearchName, extractTitleAndYear, parseTmdbId } from '../metadata/tmdb.js';
import { createKV } from '../core/kv.js';

const kv = createKV();
const LIB_KEY = 'library_v2';

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

export async function renderUploadTab({ mainPanel, client, tg }) {
  mainPanel.innerHTML = `
    <div class="admin-panel-header">
      <div class="admin-panel-title">
        <h2>Subir archivos</h2>
        <p>Sube archivos de vídeo desde tu dispositivo directamente a tus canales ::tgstorage de Telegram, con metadatos de TMDB y subida en segundo plano.</p>
      </div>
      <div>
        <input type="file" id="upload-file-input" accept="video/*" style="display:none;" />
        <button class="btn-primary" data-focusable id="btn-select-file">Cargar vídeo del disco</button>
      </div>
    </div>

    <div id="admin-upload-workspace">
      <p style="color:#aaa;">Selecciona un archivo de vídeo de tu disco para configurar su ficha técnica y canal de destino.</p>
    </div>
  `;

  const selectFileBtn = document.getElementById('btn-select-file');
  const fileInput = document.getElementById('upload-file-input');
  const workspace = document.getElementById('admin-upload-workspace');

  selectFileBtn?.addEventListener('click', () => fileInput?.click());

  fileInput?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const rawName = file.name;
    const parsedInfo = extractTitleAndYear(rawName);
    const cleanName = parsedInfo.title || cleanSearchName(rawName);
    const detectedYear = parsedInfo.year || '';

    workspace.innerHTML = `
      <div class="admin-upload-form">
        <div style="background:rgba(56,189,248,0.1);padding:0.9rem 1.2rem;border-radius:8px;border:1px solid rgba(56,189,248,0.25);display:flex;align-items:center;justify-content:space-between;">
          <div>
            <strong style="color:#38bdf8;font-size:1.05rem;">${esc(file.name)}</strong>
            <div style="color:#aaa;font-size:0.85rem;margin-top:0.2rem;">Tamaño: ${formatBytes(file.size)}</div>
          </div>
          <button class="btn-secondary admin-btn-sm" id="btn-change-file">Cambiar archivo</button>
        </div>

        <div class="admin-field-group">
          <label>Buscar e identificar en TMDB:</label>
          <div style="display:flex;gap:0.6rem;">
            <select class="admin-select" id="upload-tmdb-type" style="width:140px;flex:0 0 auto;">
              <option value="movie" selected>Película</option>
              <option value="tv">Serie / TV</option>
              <option value="collection">Colección</option>
            </select>
            <input type="text" class="admin-input" id="upload-tmdb-query" value="${esc(cleanName)}" placeholder="Título o ID de TMDB (ej. Matrix o 603)" />
            <button class="btn-primary" data-focusable id="btn-run-tmdb-search" style="flex:0 0 auto;">Buscar</button>
          </div>
        </div>

        <div id="upload-tmdb-results" style="display:none;"></div>

        <div class="admin-grid-2col">
          <div class="admin-field-group">
            <label>ID de TMDB:</label>
            <input type="text" class="admin-input" id="meta-tmdb-id" placeholder="Ej. 603" />
          </div>
          <div class="admin-field-group">
            <label>Puntuación TMDB (0 - 10):</label>
            <input type="number" step="0.1" class="admin-input" id="meta-rating" placeholder="Ej. 8.2" />
          </div>
        </div>

        <div class="admin-grid-2col">
          <div class="admin-field-group">
            <label>Clasificación por edad:</label>
            <select class="admin-select" id="meta-age-rating">
              <option value="APTA">APTA (Todos los públicos)</option>
              <option value="7">+7 años</option>
              <option value="12" selected>+12 años</option>
              <option value="16">+16 años</option>
              <option value="18">+18 años</option>
            </select>
          </div>
          <div class="admin-field-group">
            <label>Nombre de archivo final:</label>
            <input type="text" class="admin-input" id="meta-filename" value="${esc(file.name)}" />
          </div>
        </div>

        <div class="admin-field-group">
          <label>Sinopsis:</label>
          <textarea class="admin-textarea" id="meta-synopsis" rows="3"></textarea>
        </div>

        <!-- Canal tgstorage colocado de última opción antes del botón de subida -->
        <div class="admin-field-group">
          <label>Canal destino en Telegram (canales ::tgstorage de biblioteca):</label>
          <select class="admin-select" id="upload-target-channel">
            <option value="">Cargando canales tgstorage…</option>
          </select>
        </div>

        <div style="display:flex;justify-content:flex-end;margin-top:0.8rem;">
          <button class="btn-primary" id="btn-submit-upload" style="padding:0.75rem 1.8rem;font-size:1rem;">
            📤 Subir vídeo a Telegram
          </button>
        </div>
      </div>
    `;

    workspace.querySelector('#btn-change-file')?.addEventListener('click', () => fileInput.click());

    const chSelect = workspace.querySelector('#upload-target-channel');
    let loadedTgChannels = [];
    try {
      if (client) {
        loadedTgChannels = await loadLibrary(client);
      }
      if (loadedTgChannels && loadedTgChannels.length > 0) {
        chSelect.innerHTML = loadedTgChannels.map(ch => `
          <option value="${esc(ch.id)}">[${esc(ch.category)}] ${esc(ch.title || ch.name)}</option>
        `).join('');
      } else {
        chSelect.innerHTML = `<option value="">No hay canales tgstorage disponibles</option>`;
      }
    } catch (e) {
      console.warn('Error cargando canales tgstorage para subida', e);
      chSelect.innerHTML = `<option value="">Error cargando canales</option>`;
    }

    const searchBtn = workspace.querySelector('#btn-run-tmdb-search');
    const resultsWrap = workspace.querySelector('#upload-tmdb-results');

    searchBtn?.addEventListener('click', async () => {
      const rawQ = workspace.querySelector('#upload-tmdb-query').value.trim();
      const type = workspace.querySelector('#upload-tmdb-type').value;
      if (!rawQ) return;

      searchBtn.disabled = true;
      searchBtn.textContent = 'Buscando…';
      resultsWrap.style.display = 'block';
      resultsWrap.innerHTML = `<p style="color:#aaa;padding:0.5rem;">Consultando TMDB…</p>`;

      try {
        const directId = parseTmdbId(rawQ);
        const results = await searchTmdbManual({
          query: rawQ,
          type,
          year: detectedYear,
          directId: directId || null,
        });

        if (!results || !results.length) {
          resultsWrap.innerHTML = `<p style="color:#aaa;padding:0.5rem;">No se encontraron resultados en TMDB para "${esc(rawQ)}". Revisa el término o introduce el ID directo.</p>`;
        } else {
          resultsWrap.innerHTML = `
            <div class="admin-tmdb-results">
              ${results.map(r => `
                <div class="admin-tmdb-item"
                  data-tmdb-id="${esc(r.id)}"
                  data-tmdb-title="${esc(r.name)}"
                  data-tmdb-synopsis="${esc(r.overview || '')}"
                  data-tmdb-rating="${esc(r.rating || '')}">
                  ${r.poster ? `<img src="${esc(r.poster)}" class="admin-tmdb-poster" alt="" />` : `<div style="width:80px;height:120px;background:#333;margin-bottom:0.4rem;border-radius:4px;"></div>`}
                  <strong style="font-size:0.82rem;line-height:1.2;color:#fff;">${esc(r.name)}</strong>
                  <small style="color:#888;">${esc((r.date || '').slice(0, 4))}${r.rating ? ` · ★ ${r.rating}` : ''}</small>
                </div>
              `).join('')}
            </div>
          `;

          resultsWrap.querySelectorAll('.admin-tmdb-item').forEach(item => {
            item.addEventListener('click', () => {
              resultsWrap.querySelectorAll('.admin-tmdb-item').forEach(el => el.classList.remove('is-selected'));
              item.classList.add('is-selected');

              workspace.querySelector('#meta-tmdb-id').value = item.dataset.tmdbId;
              workspace.querySelector('#meta-synopsis').value = item.dataset.tmdbSynopsis;
              workspace.querySelector('#meta-rating').value = item.dataset.tmdbRating;
            });
          });
        }
      } catch (err) {
        console.error('Error buscando en TMDB', err);
        const msg = err.message || String(err);
        resultsWrap.innerHTML = `<p style="color:#f87171;padding:0.5rem;">Error buscando en TMDB: ${esc(msg)}</p>`;
      } finally {
        searchBtn.disabled = false;
        searchBtn.textContent = 'Buscar';
      }
    });

    workspace.querySelector('#btn-submit-upload')?.addEventListener('click', async () => {
      const targetChannelId = workspace.querySelector('#upload-target-channel').value;
      if (!targetChannelId) {
        alert('Por favor selecciona un canal tgstorage de destino.');
        return;
      }

      const tmdbId = workspace.querySelector('#meta-tmdb-id').value.trim();
      const rating = workspace.querySelector('#meta-rating').value.trim();
      const synopsis = workspace.querySelector('#meta-synopsis').value.trim();
      const ageRating = workspace.querySelector('#meta-age-rating').value;
      const finalFilename = workspace.querySelector('#meta-filename').value.trim() || file.name;

      const caption = buildStandardCaption({
        fileName: finalFilename,
        synopsis,
        tmdbId,
        rating,
        ageRating,
      });

      const targetChannel = loadedTgChannels.find(c => String(c.id) === String(targetChannelId));
      const targetTitle = targetChannel?.title || targetChannel?.name || `Canal ${targetChannelId}`;

      startBackgroundUpload({
        client,
        tg,
        file,
        finalFilename,
        targetChannelId,
        targetChannel,
        targetTitle,
        caption,
        tmdbId,
        rating,
        ageRating,
        synopsis,
        videoAsDocument: true,
      });
    });
  });
}

function startBackgroundUpload({
  client,
  tg,
  file,
  finalFilename,
  targetChannelId,
  targetChannel,
  targetTitle,
  caption,
  tmdbId,
  rating,
  ageRating,
  synopsis,
  videoAsDocument = true,
}) {
  if (!client) {
    alert('Cliente de Telegram no disponible para realizar la subida.');
    return;
  }

  let uploadBar = document.getElementById('admin-global-upload-bar');
  if (!uploadBar) {
    uploadBar = document.createElement('div');
    uploadBar.id = 'admin-global-upload-bar';
    uploadBar.className = 'admin-global-upload-bar';
    document.body.appendChild(uploadBar);
  }

  uploadBar.innerHTML = `
    <div class="admin-upload-bar-inner">
      <div class="admin-upload-bar-left">
        <span class="admin-upload-bar-icon spin" id="upload-bar-icon">🔄</span>
        <div class="admin-upload-bar-text">
          <div class="admin-upload-bar-title">Subiendo: <strong>${esc(finalFilename)}</strong> a <em>${esc(targetTitle)}</em></div>
          <div class="admin-upload-bar-sub" id="upload-bar-status">Iniciando subida en segundo plano… (0%)</div>
        </div>
      </div>
      <div class="admin-upload-bar-right">
        <div class="admin-upload-bar-track">
          <div class="admin-upload-bar-fill" id="upload-bar-fill" style="width:0%;"></div>
        </div>
        <span class="admin-upload-bar-pct" id="upload-bar-pct">0%</span>
        <button class="admin-upload-bar-close" id="upload-bar-close" style="display:none;" title="Cerrar">×</button>
      </div>
    </div>
  `;

  const statusEl = uploadBar.querySelector('#upload-bar-status');
  const fillEl = uploadBar.querySelector('#upload-bar-fill');
  const pctEl = uploadBar.querySelector('#upload-bar-pct');
  const iconEl = uploadBar.querySelector('#upload-bar-icon');
  const closeBtn = uploadBar.querySelector('#upload-bar-close');

  closeBtn.addEventListener('click', () => uploadBar.remove());

  alert(`La subida de "${finalFilename}" ha comenzado en segundo plano.
Puedes seguir navegando mientras avanza la barra inferior.`);

  (async () => {
    try {
      const peer = tg?.peerOf ? tg.peerOf(targetChannel) : (targetChannel?.entity || targetChannelId);

      const inputFile = await client.uploadFile({
        file,
        workers: 2,
        onProgress: (progress) => {
          const pct = Math.min(100, Math.round(progress * 100));
          const uploadedBytes = Math.round(progress * file.size);
          fillEl.style.width = `${pct}%`;
          pctEl.textContent = `${pct}%`;
          statusEl.textContent = `Subiendo: ${formatBytes(uploadedBytes)} / ${formatBytes(file.size)} (${pct}%)`;
        }
      });

      statusEl.textContent = 'Enviando archivo y metadatos al canal…';
      fillEl.style.width = '100%';
      pctEl.textContent = '100%';

      const sendParams = {
        file: inputFile,
        caption,
        forceDocument: videoAsDocument,
        attributes: [new Api.DocumentAttributeFilename({ fileName: finalFilename })],
      };

      // Telegram puede rechazar el envío como vídeo con CHANNEL_INVALID aunque la subida del archivo haya llegado al 100%.
      // Si ocurre, repetir como documento sin atributos de vídeo para que Telegram lo trate como archivo.
      let sentMsg;
      try {
        sentMsg = await client.sendFile(peer, {
          ...sendParams,
          forceDocument: false,
          attributes: [
            new Api.DocumentAttributeVideo({ duration: 0, w: 1920, h: 1080, supportsStreaming: true }),
            new Api.DocumentAttributeFilename({ fileName: finalFilename }),
          ],
        });
      } catch (videoSendError) {
        console.warn('[adminUpload] Envío como vídeo falló; reintentando como archivo', videoSendError);
        statusEl.textContent = 'Telegram rechazó el vídeo; reintentando como archivo…';
        sentMsg = await client.sendFile(peer, {
          ...sendParams,
          forceDocument: true,
          attributes: [new Api.DocumentAttributeFilename({ fileName: finalFilename })],
        });
      }

      const newFileEntry = {
        key: `${targetChannelId}:${sentMsg.id}`,
        channelId: String(targetChannelId),
        messageId: sentMsg.id,
        channel: targetChannel || { id: targetChannelId, name: targetTitle, group: targetTitle, category: 'Películas' },
        fileName: finalFilename,
        captionFileName: finalFilename,
        rawFileName: finalFilename,
        rawCaption: caption,
        label: prettyName(finalFilename),
        section: null,
        synopsis: synopsis || null,
        tmdbId: tmdbId || null,
        imdbId: null,
        rating: rating ? Number(rating) : null,
        ageRating: ageRating || null,
        season: 0,
        episode: 0,
        size: file.size,
        duration: 0,
        mimeType: file.type || 'video/mp4',
        date: Math.floor(Date.now() / 1000),
      };

      const savedObj = (await kv.get(LIB_KEY).catch(() => null)) || {};
      savedObj.cache = savedObj.cache || {};
      savedObj.cache[targetChannelId] = savedObj.cache[targetChannelId] || [];
      savedObj.cache[targetChannelId].unshift(newFileEntry);
      await kv.set(LIB_KEY, savedObj).catch(() => {});

      iconEl.classList.remove('spin');
      iconEl.textContent = '✓';
      iconEl.style.color = '#34d399';
      statusEl.textContent = `✓ Subida completada con éxito en ${targetTitle}`;
      statusEl.style.color = '#34d399';
      closeBtn.style.display = 'block';

      setTimeout(() => {
        uploadBar?.remove();
      }, 10000);
    } catch (err) {
      console.error('Error durante la subida en segundo plano', err);
      iconEl.classList.remove('spin');
      iconEl.textContent = '⚠️';
      iconEl.style.color = '#f87171';
      statusEl.textContent = `Error en la subida: ${esc(err.message || String(err))}`;
      statusEl.style.color = '#f87171';
      closeBtn.style.display = 'block';
    }
  })();
}
