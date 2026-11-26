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

/** ¿Es un MP4 que Telegram puede tratar como vídeo nativo? */
export function isMp4File(file, fileName = '') {
  const name = String(fileName || file?.name || '').toLowerCase();
  const type = String(file?.type || '').toLowerCase();
  return type === 'video/mp4' || /\.(mp4|m4v)$/.test(name);
}

function parseEpisodeHelper(name = '', fallbackIdx = 1) {
  const m = name.match(/(\d+)[xX](\d+)/);
  if (m) return { season: parseInt(m[1], 10), episode: parseInt(m[2], 10) };
  const s = name.match(/[sS](\d+)/);
  const e = name.match(/[eE](\d+)/);
  if (s || e) return { season: s ? parseInt(s[1], 10) : 1, episode: e ? parseInt(e[1], 10) : fallbackIdx };
  const epSolo = name.match(/\b(?:ep|episodio|cap|capitulo)\s*(\d+)\b/i);
  if (epSolo) return { season: 1, episode: parseInt(epSolo[1], 10) };
  const numSolo = name.match(/\b(\d{1,3})\b/);
  if (numSolo) return { season: 1, episode: parseInt(numSolo[1], 10) };
  return { season: 1, episode: fallbackIdx };
}

/**
 * Lee duración y dimensiones de un MP4 en el navegador mediante <video>.
 */
export async function probeVideo(file) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      try { URL.revokeObjectURL(url); } catch (_) {}
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish({ duration: 0, width: 0, height: 0, thumb: null });
    }, 10000);

    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;

    let url = '';
    try {
      url = URL.createObjectURL(file);
    } catch (_) {
      clearTimeout(timer);
      return resolve({ duration: 0, width: 0, height: 0, thumb: null });
    }

    video.onloadedmetadata = () => {
      clearTimeout(timer);
      const duration = Math.round(video.duration || 0);
      const width = video.videoWidth || 0;
      const height = video.videoHeight || 0;

      if (!width || !height) {
        return finish({ duration, width, height, thumb: null });
      }

      const seekTime = Math.min(Math.max(1, Math.floor(duration * 0.1)), 15);
      video.currentTime = seekTime;

      video.onseeked = () => {
        try {
          const maxDim = 320;
          let tw = width;
          let th = height;
          if (tw > th && tw > maxDim) {
            th = Math.round((th * maxDim) / tw);
            tw = maxDim;
          } else if (th > maxDim) {
            tw = Math.round((tw * maxDim) / th);
            th = maxDim;
          }
          const canvas = document.createElement('canvas');
          canvas.width = tw;
          canvas.height = th;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(video, 0, 0, tw, th);
          canvas.toBlob((blob) => {
            if (!blob) return finish({ duration, width, height, thumb: null });
            const reader = new FileReader();
            reader.onloadend = () => {
              const buf = reader.result ? new Uint8Array(reader.result) : null;
              finish({ duration, width, height, thumb: buf });
            };
            reader.onerror = () => finish({ duration, width, height, thumb: null });
            reader.readAsArrayBuffer(blob);
          }, 'image/jpeg', 0.8);
        } catch (_) {
          finish({ duration, width, height, thumb: null });
        }
      };

      video.onerror = () => finish({ duration, width, height, thumb: null });
    };

    video.onerror = () => {
      clearTimeout(timer);
      finish({ duration: 0, width: 0, height: 0, thumb: null });
    };

    video.src = url;
  });
}

export function fitTelegramCaption(caption, maxLen = 1024) {
  const str = String(caption ?? '').trim();
  if (str.length <= maxLen) return str;
  const parts = str.split('\n\n');
  let current = '';
  for (const p of parts) {
    const candidate = current ? `${current}\n\n${p}` : p;
    if (candidate.length <= maxLen) current = candidate;
    else break;
  }
  if (!current) current = str.slice(0, maxLen - 3) + '…';
  return current;
}

export async function sendFileSafe(client, peer, options) {
  try {
    return await client.sendFile(peer, options);
  } catch (err) {
    const msg = String(err?.errorMessage || err?.message || err || '');
    if (msg.includes('RPCError 400') || msg.includes('CHANNEL_INVALID') || msg.includes('MEDIA_EMPTY')) {
      if (!options.forceDocument) {
        console.warn('[upload] sendFile falló con vídeo, reintentando como documento plano:', msg);
        const docOpts = {
          file: options.file,
          caption: options.caption,
          forceDocument: true,
          attributes: options.attributes?.filter(a => a.className === 'DocumentAttributeFilename') || [],
        };
        return await client.sendFile(peer, docOpts);
      }
    }
    throw err;
  }
}

export function extractMessageId(sentMsg) {
  if (!sentMsg) return null;
  if (typeof sentMsg.id === 'number') return sentMsg.id;
  if (Array.isArray(sentMsg)) {
    const last = sentMsg[sentMsg.length - 1];
    if (typeof last?.id === 'number') return last.id;
  }
  if (Array.isArray(sentMsg.updates)) {
    for (const u of sentMsg.updates) {
      if (typeof u.id === 'number') return u.id;
      if (u.message && typeof u.message.id === 'number') return u.message.id;
    }
  }
  return null;
}

export async function renderUploadTab({ mainPanel, client, tg }) {
  mainPanel.innerHTML = `
    <div class="admin-panel-header">
      <div class="admin-panel-title">
        <h2>Subir archivos</h2>
        <p>Sube archivos de vídeo desde tu dispositivo directamente a tus canales ::tgstorage de Telegram, con metadatos de TMDB y subida concurrente en segundo plano.</p>
      </div>
      <div>
        <input type="file" id="upload-file-input" accept="video/*,.mkv,.mp4,.avi,.mov,.m4v,.webm,.ts,.m2ts" multiple style="display:none;" />
        <button class="btn-primary" data-focusable id="btn-select-file">Cargar vídeo(s) del disco</button>
      </div>
    </div>

    <div id="admin-upload-workspace">
      <p style="color:#aaa;">Selecciona uno o varios archivos de vídeo de tu disco para configurar su ficha técnica y canal de destino.</p>
    </div>
  `;

  const selectFileBtn = document.getElementById('btn-select-file');
  const fileInput = document.getElementById('upload-file-input');
  const workspace = document.getElementById('admin-upload-workspace');

  selectFileBtn?.addEventListener('click', () => fileInput?.click());

  fileInput?.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    if (files.length === 1) {
      renderSingleFileUploadForm({ workspace, file: files[0], client, tg });
    } else {
      renderMultiFileUploadForm({ workspace, files, client, tg });
    }
  });
}

/** Formulario para un único archivo */
async function renderSingleFileUploadForm({ workspace, file, client, tg }) {
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
        <button class="btn-secondary admin-btn-sm" id="btn-change-file">Cambiar selección</button>
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
          <label>Temporada / Episodio (si es serie):</label>
          <input type="text" class="admin-input" id="meta-episode" placeholder="Ej. T1·E01 o 1x01" />
        </div>
      </div>

      <div class="admin-field-group">
        <label>Nombre final del archivo que verá Telegram:</label>
        <input type="text" class="admin-input" id="meta-final-filename" value="${esc(detectedYear ? `${cleanName} (${detectedYear}).mp4` : file.name)}" />
      </div>

      <div class="admin-field-group">
        <label>Sinopsis:</label>
        <textarea class="admin-textarea" id="meta-synopsis" rows="3" placeholder="Sinopsis del título…"></textarea>
      </div>

      <div class="admin-field-group">
        <label>Canal tgstorage de destino:</label>
        <select class="admin-select" id="upload-target-channel">
          <option value="">Cargando canales tgstorage…</option>
        </select>
      </div>

      <div style="margin-top:1.5rem;display:flex;gap:1rem;justify-content:flex-end;">
        <button class="btn-primary" data-focusable id="btn-start-upload" style="font-size:1rem;padding:0.6rem 1.6rem;">
          Iniciar subida a Telegram
        </button>
      </div>
    </div>
  `;

  document.getElementById('btn-change-file')?.addEventListener('click', () => {
    document.getElementById('upload-file-input')?.click();
  });

  setupTmdbSearch(cleanName);
  await populateChannelSelect('upload-target-channel', client, 'Películas');

  document.getElementById('btn-start-upload')?.addEventListener('click', () => {
    const finalFilename = document.getElementById('meta-final-filename')?.value?.trim() || file.name;
    const targetSelect = document.getElementById('upload-target-channel');
    const targetChannelId = targetSelect?.value;
    const targetTitle = targetSelect?.selectedOptions?.[0]?.text || 'tgstorage';

    if (!targetChannelId) {
      alert('Por favor, selecciona un canal de destino.');
      return;
    }

    const caption = buildStandardCaption({
      fileName: finalFilename,
      tmdbId: document.getElementById('meta-tmdb-id')?.value?.trim() || '',
      rating: document.getElementById('meta-rating')?.value?.trim() || '',
      ageRating: document.getElementById('meta-age-rating')?.value || '',
      synopsis: document.getElementById('meta-synopsis')?.value?.trim() || '',
      section: document.getElementById('meta-episode')?.value?.trim() || '',
    });

    const isMp4 = isMp4File(file, finalFilename);

    startBackgroundUpload({
      file,
      finalFilename,
      caption,
      targetChannelId,
      targetTitle,
      videoAsDocument: !isMp4,
      client,
      tg
    });
  });
}

/** Formulario para múltiples archivos (series / sagas) */
async function renderMultiFileUploadForm({ workspace, files, client, tg }) {
  const totalSize = files.reduce((acc, f) => acc + (f.size || 0), 0);
  const firstParsed = extractTitleAndYear(files[0].name);
  const cleanName = firstParsed.title || cleanSearchName(files[0].name);

  // Ordenar archivos por nombre / número de episodio natural
  files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

  workspace.innerHTML = `
    <div class="admin-upload-form">
      <div style="background:rgba(56,189,248,0.1);padding:0.9rem 1.2rem;border-radius:8px;border:1px solid rgba(56,189,248,0.25);display:flex;align-items:center;justify-content:space-between;">
        <div>
          <strong style="color:#38bdf8;font-size:1.05rem;">${files.length} archivos seleccionados</strong>
          <div style="color:#aaa;font-size:0.85rem;margin-top:0.2rem;">Tamaño total: ${formatBytes(totalSize)}</div>
        </div>
        <button class="btn-secondary admin-btn-sm" id="btn-change-file">Cambiar selección</button>
      </div>

      <div class="admin-field-group">
        <label>Buscar serie o título en TMDB para todos los archivos:</label>
        <div style="display:flex;gap:0.6rem;">
          <select class="admin-select" id="upload-tmdb-type" style="width:140px;flex:0 0 auto;">
            <option value="tv" selected>Serie / TV</option>
            <option value="movie">Película</option>
            <option value="collection">Colección</option>
          </select>
          <input type="text" class="admin-input" id="upload-tmdb-query" value="${esc(cleanName)}" placeholder="Título de la serie en TMDB" />
          <button class="btn-primary" data-focusable id="btn-run-tmdb-search" style="flex:0 0 auto;">Buscar</button>
        </div>
      </div>

      <div id="upload-tmdb-results" style="display:none;"></div>

      <div class="admin-grid-2col">
        <div class="admin-field-group">
          <label>ID de TMDB común:</label>
          <input type="text" class="admin-input" id="meta-tmdb-id" placeholder="Ej. 1399 (Game of Thrones)" />
        </div>
        <div class="admin-field-group">
          <label>Puntuación TMDB (0 - 10):</label>
          <input type="number" step="0.1" class="admin-input" id="meta-rating" placeholder="Ej. 8.4" />
        </div>
      </div>

      <div class="admin-grid-2col">
        <div class="admin-field-group">
          <label>Clasificación por edad:</label>
          <select class="admin-select" id="meta-age-rating">
            <option value="APTA">APTA (Todos los públicos)</option>
            <option value="7">+7 años</option>
            <option value="12">+12 años</option>
            <option value="16" selected>+16 años</option>
            <option value="18">+18 años</option>
          </select>
        </div>
        <div class="admin-field-group">
          <label>Temporada común (si aplica):</label>
          <input type="number" class="admin-input" id="meta-default-season" value="1" min="1" />
        </div>
      </div>

      <div class="admin-field-group">
        <label>Sinopsis común:</label>
        <textarea class="admin-textarea" id="meta-synopsis" rows="2" placeholder="Sinopsis general de la serie…"></textarea>
      </div>

      <div class="admin-field-group">
        <label>Canal tgstorage de destino:</label>
        <select class="admin-select" id="upload-target-channel">
          <option value="">Cargando canales tgstorage…</option>
        </select>
      </div>

      <div class="admin-field-group" style="margin-top:1.2rem;">
        <label>Lista de archivos a procesar (${files.length}):</label>
        <div style="max-height: 220px; overflow-y: auto; background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.08); border-radius: 6px; padding: 0.5rem 0.8rem;">
          ${files.map((f, idx) => {
            const ep = parseEpisodeHelper(f.name, idx + 1);
            return `
              <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.35rem 0; border-bottom: 1px solid rgba(255,255,255,0.05); font-size: 0.85rem;">
                <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 70%; color: #e2e8f0;">
                  ${idx + 1}. ${esc(f.name)}
                </span>
                <span style="color: #38bdf8; font-weight: 600;">
                  T${ep.season}·E${String(ep.episode).padStart(2, '0')} · ${formatBytes(f.size)}
                </span>
              </div>
            `;
          }).join('')}
        </div>
      </div>

      <div style="margin-top:1.5rem;display:flex;gap:1rem;justify-content:flex-end;">
        <button class="btn-primary" data-focusable id="btn-start-multi-upload" style="font-size:1rem;padding:0.6rem 1.6rem;">
          Iniciar subida en paralelo (${files.length} archivos)
        </button>
      </div>
    </div>
  `;

  document.getElementById('btn-change-file')?.addEventListener('click', () => {
    document.getElementById('upload-file-input')?.click();
  });

  setupTmdbSearch(cleanName);
  await populateChannelSelect('upload-target-channel', client, 'Series');

  document.getElementById('btn-start-multi-upload')?.addEventListener('click', () => {
    const targetSelect = document.getElementById('upload-target-channel');
    const targetChannelId = targetSelect?.value;
    const targetTitle = targetSelect?.selectedOptions?.[0]?.text || 'tgstorage';

    if (!targetChannelId) {
      alert('Por favor, selecciona un canal de destino.');
      return;
    }

    const seriesName = document.getElementById('upload-tmdb-query')?.value?.trim() || cleanName;
    const tmdbId = document.getElementById('meta-tmdb-id')?.value?.trim() || '';
    const rating = document.getElementById('meta-rating')?.value?.trim() || '';
    const ageRating = document.getElementById('meta-age-rating')?.value || '';
    const synopsis = document.getElementById('meta-synopsis')?.value?.trim() || '';
    const defaultSeason = parseInt(document.getElementById('meta-default-season')?.value || '1', 10);

    alert(`Se ha iniciado la subida de ${files.length} archivos en segundo plano con control de concurrencia.\nPuedes seguir navegando mientras se procesan.`);

    // Subida concurrente en paralelo (máx 2 tareas simultáneas para proteger Telegram y memoria)
    startConcurrentUploads({
      files,
      seriesName,
      defaultSeason,
      tmdbId,
      rating,
      ageRating,
      synopsis,
      targetChannelId,
      targetTitle,
      client,
      tg
    });
  });
}

function setupTmdbSearch(initialQuery) {
  const queryInput = document.getElementById('upload-tmdb-query');
  const typeSelect = document.getElementById('upload-tmdb-type');
  const resultsDiv = document.getElementById('upload-tmdb-results');
  const searchBtn = document.getElementById('btn-run-tmdb-search');

  async function executeSearch() {
    const q = queryInput?.value?.trim();
    if (!q) return;

    if (resultsDiv) {
      resultsDiv.style.display = 'block';
      resultsDiv.innerHTML = '<p style="color:#aaa;padding:0.5rem;">Buscando en TMDB…</p>';
    }

    const type = typeSelect?.value || 'movie';
    const res = await searchTmdbManual(q, type);

    if (!res || !res.results || !res.results.length) {
      if (resultsDiv) resultsDiv.innerHTML = '<p style="color:#aaa;padding:0.5rem;">No se encontraron resultados en TMDB.</p>';
      return;
    }

    if (resultsDiv) {
      resultsDiv.innerHTML = `
        <div style="max-height:240px;overflow-y:auto;background:rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.1);border-radius:6px;padding:0.5rem;">
          ${res.results.map(item => {
            const title = item.title || item.name || '';
            const year = (item.release_date || item.first_air_date || '').slice(0, 4);
            const poster = item.poster_path ? `https://image.tmdb.org/t/p/w92${item.poster_path}` : '';
            return `
              <div class="tmdb-search-item" data-id="${item.id}" data-title="${esc(title)}" data-year="${esc(year)}" data-overview="${esc(item.overview || '')}" data-vote="${item.vote_average || ''}" style="display:flex;align-items:center;gap:0.8rem;padding:0.4rem;border-bottom:1px solid rgba(255,255,255,0.05);cursor:pointer;">
                ${poster ? `<img src="${poster}" style="width:36px;height:52px;object-fit:cover;border-radius:4px;" />` : '<div style="width:36px;height:52px;background:#333;border-radius:4px;"></div>'}
                <div style="flex:1;">
                  <strong style="color:#fff;font-size:0.9rem;">${esc(title)}</strong>
                  <span style="color:#aaa;font-size:0.8rem;">(${year || 'N/A'}) · ⭐ ${item.vote_average ? item.vote_average.toFixed(1) : '-'}</span>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;

      resultsDiv.querySelectorAll('.tmdb-search-item').forEach(el => {
        el.addEventListener('click', () => {
          const id = el.dataset.id;
          const title = el.dataset.title;
          const year = el.dataset.year;
          const overview = el.dataset.overview;
          const vote = el.dataset.vote;

          const tmdbIdInput = document.getElementById('meta-tmdb-id');
          if (tmdbIdInput) tmdbIdInput.value = id;

          const ratingInput = document.getElementById('meta-rating');
          if (ratingInput && vote) ratingInput.value = Number(vote).toFixed(1);

          const synopsisInput = document.getElementById('meta-synopsis');
          if (synopsisInput) synopsisInput.value = overview;

          const filenameInput = document.getElementById('meta-final-filename');
          if (filenameInput) {
            const ext = filenameInput.value.match(/\.([a-zA-Z0-9]{2,5})$/)?.[0] || '.mp4';
            filenameInput.value = year ? `${title} (${year})${ext}` : `${title}${ext}`;
          }

          resultsDiv.style.display = 'none';
        });
      });
    }
  }

  searchBtn?.addEventListener('click', executeSearch);
  queryInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      executeSearch();
    }
  });
}

async function populateChannelSelect(selectId, client, preferredCat = 'Películas') {
  const select = document.getElementById(selectId);
  if (!select) return;

  try {
    const channels = await loadLibrary(client);
    const tgChannels = (channels || []).filter(c => !c.isExternal && c.category && ['Películas', 'Series', 'Deportes', 'Música'].includes(c.category));

    if (!tgChannels.length) {
      select.innerHTML = '<option value="">No se encontraron canales ::tgstorage</option>';
      return;
    }

    select.innerHTML = tgChannels.map(c => `
      <option value="${c.id}" ${c.category === preferredCat ? 'selected' : ''}>${esc(c.title)} (${c.category})</option>
    `).join('');
  } catch (err) {
    console.warn('[adminUpload] Error cargando canales', err);
    select.innerHTML = '<option value="">Error cargando canales</option>';
  }
}

/** Ejecuta subidas concurrentes en paralelo */
async function startConcurrentUploads({ files, seriesName, defaultSeason, tmdbId, rating, ageRating, synopsis, targetChannelId, targetTitle, client, tg }) {
  const concurrency = 2; // 2 subidas simultáneas
  let nextIdx = 0;

  async function worker() {
    while (nextIdx < files.length) {
      const idx = nextIdx++;
      const file = files[idx];
      const epInfo = parseEpisodeHelper(file.name, idx + 1);
      const s = epInfo.season || defaultSeason;
      const e = epInfo.episode;
      const epCode = `T${s}·E${String(e).padStart(2, '0')}`;
      const extMatch = file.name.match(/\.([a-zA-Z0-9]{2,5})$/);
      const ext = extMatch ? `.${extMatch[1]}` : '.mp4';
      const finalFilename = `${seriesName} - ${s}x${String(e).padStart(2, '0')}${ext}`;

      const caption = buildStandardCaption({
        fileName: finalFilename,
        tmdbId,
        rating,
        ageRating,
        synopsis,
        section: epCode,
      });

      const isMp4 = isMp4File(file, finalFilename);

      await startBackgroundUpload({
        file,
        finalFilename,
        caption,
        targetChannelId,
        targetTitle,
        videoAsDocument: !isMp4,
        client,
        tg
      });
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, files.length) }, () => worker());
  await Promise.allSettled(workers);
}

/**
 * Inicia la subida de un vídeo a Telegram en segundo plano.
 * Usa workers: 1 (como en TGComic) para máxima velocidad de arranque y evitar que se quede en 'Preparando subida'.
 */
export async function startBackgroundUpload({
  file,
  finalFilename,
  caption,
  targetChannelId,
  targetTitle,
  videoAsDocument = false,
  client,
  tg
}) {
  if (!client) {
    if (tg?.getClient) client = tg.getClient();
    else if (window.tg?.getClient) client = window.tg.getClient();
  }
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

  try {
    let peer = null;
    // 1. Resolución directa si tg dispone de peerOf
    if (tg?.peerOf && typeof targetChannelId === 'object') {
      try { peer = tg.peerOf(targetChannelId); } catch (_) {}
    }

    // 2. Intento con getInputEntity
    if (!peer && client?.getInputEntity) {
      try {
        peer = await client.getInputEntity(targetChannelId);
      } catch (_) {
        try {
          const clean = String(targetChannelId).replace(/^-100/, '').replace(/^-/, '');
          peer = await client.getInputEntity(`-100${clean}`);
        } catch (_) {}
      }
    }
    if (!peer) {
      peer = targetChannelId;
    }

    // Subida con workers: 1 (patrón robusto y rápido de TGComic que evita cuelgues)
    setTaskStatus(`Iniciando transferencia de ${formatBytes(file.size)}…`, 1);

    const inputFile = await client.uploadFile({
      file,
      workers: 1,
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

    finishUploadTask(taskId, `✅ Subida completada con éxito en ${targetTitle}`);
    console.log('[upload] Subida finalizada:', { finalFilename, messageId, targetTitle });

    // Invalidar caché de biblioteca para que aparezca el nuevo archivo en la app
    try {
      await kv.del(LIB_KEY);
    } catch (_) {}

  } catch (err) {
    console.error('[upload] Error en la subida en segundo plano:', err);
    failUploadTask(taskId, `Error: ${err?.errorMessage || err?.message || 'Error en subida'}`);
  }
}
