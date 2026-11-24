// src/ui/adminUpload.js
// Módulo para configurar y realizar la subida de vídeos a canales ::tgstorage en segundo plano con barra inferior.
import { Api } from 'telegram';
import { loadLibrary } from '../library/channels.js';
import { buildStandardCaption, prettyName } from '../library/parse.js';
import { searchTmdbManual, cleanSearchName, extractTitleAndYear, parseTmdbId } from '../metadata/tmdb.js';
import { createKV } from '../core/kv.js';
import { startUploadTask, updateUploadTask, finishUploadTask, failUploadTask } from './uploadTasks.js';

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

// ---------- Utilidades de subida (patrón robusto heredado de TGComic) ----------

/** ¿Es un MP4 que Telegram puede tratar como vídeo nativo? */
export function isMp4File(file, fileName = '') {
  const name = String(fileName || file?.name || '').toLowerCase();
  const type = String(file?.type || '').toLowerCase();
  return type === 'video/mp4' || /\.(mp4|m4v)$/.test(name);
}

/** Telegram limita el caption de medios a 1024 caracteres. */
function fitTelegramCaption(text, max = 1024) {
  const str = String(text || '');
  if (str.length <= max) return str;
  return str.slice(0, max - 1).trimEnd() + '…';
}

const isGramNoise = (e) => /Missing MTProto Entity|TL definition for ID 0|ENTITY_MEMBER_INVALID|constructor id/i.test(String(e?.message || e || ''));

/** GramJS a veces lanza un error de parseo DESPUÉS de enviar: el mensaje ya está en Telegram, no reintentar. */
async function sendFileSafe(client, peer, opts) {
  try {
    return await client.sendFile(peer, opts);
  } catch (e) {
    if (isGramNoise(e)) {
      console.warn('[upload] aviso interno GramJS tras enviar (mensaje enviado):', e?.message || e);
      return { __sentWithNoise: true };
    }
    throw e;
  }
}

/** Lee duración, resolución y una miniatura JPEG del vídeo usando el propio navegador. */
function probeVideo(file, timeoutMs = 10000) {
  return new Promise((resolve) => {
    const result = { duration: 0, width: 0, height: 0, thumb: null };
    let url = null;
    let done = false;
    const video = document.createElement('video');
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { video.removeAttribute('src'); video.load(); } catch (_) {}
      if (url) URL.revokeObjectURL(url);
      resolve(result);
    };
    const timer = setTimeout(finish, timeoutMs);
    try {
      url = URL.createObjectURL(file);
      video.preload = 'metadata';
      video.muted = true;
      video.playsInline = true;
      video.onerror = finish;
      video.onloadedmetadata = () => {
        result.duration = Number.isFinite(video.duration) ? Math.round(video.duration) : 0;
        result.width = video.videoWidth || 0;
        result.height = video.videoHeight || 0;
        const target = Math.min(Math.max(1, (video.duration || 10) * 0.1), 30);
        try { video.currentTime = target; } catch (_) { finish(); }
      };
      video.onseeked = () => {
        try {
          const w = video.videoWidth, h = video.videoHeight;
          if (w && h) {
            const scale = Math.min(1, 320 / Math.max(w, h));
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(w * scale);
            canvas.height = Math.round(h * scale);
            canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
            canvas.toBlob((blob) => {
              if (blob) result.thumb = new File([blob], 'thumb.jpg', { type: 'image/jpeg' });
              finish();
            }, 'image/jpeg', 0.8);
            return;
          }
        } catch (_) {}
        finish();
      };
      video.src = url;
    } catch (_) {
      finish();
    }
  });
}

function extractMessageId(sentMsg) {
  if (!sentMsg || sentMsg.__sentWithNoise) return null;
  return sentMsg.id ||
    sentMsg.updates?.find?.(u => u.message?.id)?.message?.id ||
    sentMsg.message?.id || null;
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
        loadedTgChannels = loadedTgChannels.filter(ch => ch.category && ['Películas', 'Series', 'Deportes', 'Música'].includes(ch.category) && !ch.isExternal);
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
        // Los MP4 se envían como vídeo de Telegram (reproducible/streaming); el resto como documento.
        videoAsDocument: !isMp4File(file, finalFilename),
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

  let currentPercent = 0;
  const taskId = startUploadTask(`Subiendo: ${finalFilename}`, `Preparando subida a ${targetTitle}…`, 0);
  const setTaskStatus = (status, percent = currentPercent) => {
    currentPercent = Math.max(0, Math.min(100, Number(percent) || 0));
    updateUploadTask(taskId, { title: `Subiendo: ${finalFilename}`, status, percent: currentPercent });
  };

  alert(`La subida de "${finalFilename}" ha comenzado en segundo plano.
Puedes seguir navegando mientras avanza la barra inferior.`);

  (async () => {
    try {
      let peer = null;
      if (client?.getInputEntity) {
        try {
          peer = await client.getInputEntity(targetChannel?.entity || targetChannelId);
        } catch (_) {
          try {
            const clean = String(targetChannelId).replace(/^-100/, '').replace(/^-/, '');
            peer = await client.getInputEntity(`-100${clean}`);
          } catch (_) {}
        }
      }
      if (!peer && tg?.peerOf && targetChannel) {
        peer = tg.peerOf(targetChannel);
      }
      if (!peer) {
        peer = targetChannel?.entity || targetChannelId;
      }

      const inputFile = await client.uploadFile({
        file,
        workers: 3,
        onProgress: (progress) => {
          const pct = Math.min(100, Math.round(progress * 100));
          const uploadedBytes = Math.round(progress * file.size);
          setTaskStatus(`Subiendo partes: ${formatBytes(uploadedBytes)} / ${formatBytes(file.size)} (${pct}%)`, pct);
        }
      });

      setTaskStatus('Registrando mensaje y metadatos en Telegram…', 100);

      const safeCaption = fitTelegramCaption(caption, 1024);
      if (safeCaption.length < String(caption || '').length) {
        console.warn(`[upload] Caption recortado a ${safeCaption.length}/1024 caracteres (límite Telegram)`);
      }
      const filenameAttr = new Api.DocumentAttributeFilename({ fileName: finalFilename });

      let sentMsg = null;
      let sentAsVideo = false;
      let videoInfo = { duration: 0, width: 0, height: 0, thumb: null };

      if (!videoAsDocument) {
        // MP4: se envía como vídeo nativo con streaming, duración, resolución y miniatura.
        try {
          setTaskStatus('Preparando vídeo (duración y miniatura)…');
          videoInfo = await probeVideo(file);
          console.log('[upload] vídeo detectado', { duration: videoInfo.duration, width: videoInfo.width, height: videoInfo.height, thumb: !!videoInfo.thumb });
          setTaskStatus('Publicando como vídeo en Telegram…');
          const opts = {
            file: inputFile,
            caption: safeCaption,
            forceDocument: false,
            supportsStreaming: true,
            attributes: [
              new Api.DocumentAttributeVideo({
                duration: videoInfo.duration || 0,
                w: videoInfo.width || 0,
                h: videoInfo.height || 0,
                supportsStreaming: true,
              }),
              filenameAttr,
            ],
          };
          if (videoInfo.thumb) opts.thumb = videoInfo.thumb;
          sentMsg = await sendFileSafe(client, peer, opts);
          sentAsVideo = true;
        } catch (e) {
          console.warn('[upload] Envío como vídeo rechazado, se reintenta como documento:', e?.message || e);
          setTaskStatus('Telegram rechazó el vídeo; reintentando como documento…');
        }
      }

      if (!sentAsVideo) {
        // Documento: evita 400 CHANNEL_INVALID con códecs no estándar (MKV, AVI…)
        sentMsg = await sendFileSafe(client, peer, {
          file: inputFile,
          caption: safeCaption,
          forceDocument: true,
          attributes: [filenameAttr],
        });
      }

      const messageId = extractMessageId(sentMsg);
      if (!messageId && !sentMsg?.__sentWithNoise) {
        throw new Error('Telegram no devolvió el identificador del mensaje; no se puede confirmar que el archivo se publicara en el canal');
      }

      if (messageId) {
        const newFileEntry = {
          key: `${targetChannelId}:${messageId}`,
          channelId: String(targetChannelId),
          messageId: messageId,
          channel: targetChannel || { id: targetChannelId, name: targetTitle, group: targetTitle, category: 'Películas' },
          fileName: finalFilename,
          captionFileName: finalFilename,
          rawFileName: finalFilename,
          rawCaption: safeCaption,
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
          duration: videoInfo.duration || 0,
          mimeType: file.type || 'video/mp4',
          date: Math.floor(Date.now() / 1000),
        };
        await addEntryToLibraryCache(targetChannelId, targetChannel, messageId, newFileEntry);
      } else {
        // Enviado pero sin id: invalidar la caché del canal para que se reescanee en la próxima actualización.
        await addEntryToLibraryCache(targetChannelId, targetChannel, null, null);
      }

      finishUploadTask(taskId, `✓ Subida completada (${sentAsVideo ? 'como vídeo' : 'como documento'}) en ${targetTitle} (Mensaje #${messageId || 'OK'})`, 100);
    } catch (err) {
      console.error('Error durante la subida en segundo plano', err);
      failUploadTask(taskId, `Error en la subida: ${err.message || String(err)}`);
    }
  })();
}

/**
 * Inserta el nuevo archivo en la caché local library_v2.
 * Estructura real de la caché (ver library/titles.js → buildTitles):
 *   cache[channelId] = { top, title, files: [...] }
 * (El error "unshift is not a function" venía de tratar esa entrada como un array.)
 */
async function addEntryToLibraryCache(channelId, channel, messageId, entry) {
  try {
    const savedObj = (await kv.get(LIB_KEY).catch(() => null)) || {};
    savedObj.cache = savedObj.cache || {};
    const key = String(channelId);
    let slot = savedObj.cache[key];
    if (Array.isArray(slot)) slot = { top: null, title: channel?.title || null, files: slot };
    if (!slot || typeof slot !== 'object' || !Array.isArray(slot.files)) {
      slot = { top: null, title: channel?.title || null, files: [] };
    }
    if (entry && messageId) {
      slot.files = [entry, ...slot.files.filter(f => String(f.messageId) !== String(messageId))];
      // El nuevo mensaje es ahora el último del canal: así la actualización rápida no reescanea.
      slot.top = messageId;
    } else {
      slot.top = null; // fuerza reescaneo
    }
    savedObj.cache[key] = slot;
    await kv.set(LIB_KEY, savedObj);
  } catch (e) {
    console.warn('[upload] No se pudo actualizar la caché local de la biblioteca', e);
  }
}
