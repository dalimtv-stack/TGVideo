// src/ui/forwardModal.js
import { Api } from 'telegram';
import { fetchTmdbFullDetails } from '../metadata/tmdb.js';
import { loadLibrary } from '../library/channels.js';
import { parseCaption, buildStandardCaption, parseEpisode, prettyEpisodeName } from '../library/parse.js';
import { normalizeMovieKey } from '../library/titles.js';
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

async function resolvePeer(client, tg, target) {
  if (!target) throw new Error('Canal no especificado para resolver peer');
  if (target.className?.startsWith('InputPeer') || target._ === 'inputPeerChannel' || target._ === 'inputPeerChat') {
    return target;
  }
  if (target.entity) return target.entity;
  if (tg?.peerOf && typeof target === 'object' && (target.accessHash || target.hash)) {
    try {
      const p = tg.peerOf(target);
      if (p) return p;
    } catch (_) {}
  }
  const rawId = String(typeof target === 'object' ? (target.tgChannelId || target.channelId || target.id || '') : target).split('_top_')[0].trim();
  if (!rawId) throw new Error('ID de canal no válido');

  if (client?.getInputEntity) {
    try {
      return await client.getInputEntity(rawId);
    } catch (_) {
      try {
        const clean = rawId.replace(/^-100/, '').replace(/^-/, '');
        return await client.getInputEntity(`-100${clean}`);
      } catch (err) {
        if (tg?.peerOf) {
          const clean = rawId.replace(/^-100/, '').replace(/^-/, '');
          return tg.peerOf({ id: clean, accessHash: typeof target === 'object' ? (target.accessHash || target.hash) : '0' });
        }
        throw new Error(`No se pudo resolver el canal en Telegram: ${err.message || String(err)}`);
      }
    }
  }
  throw new Error('Cliente Telegram no disponible para resolver el canal');
}

function ensureProgressBar() {
  return document.getElementById('admin-global-upload-bar');
}

function setProgressBar(_bar, { id, title, status, percent = 0, done = false, error = false }) {
  if (!id) return;
  updateUploadTask(id, { title, status, percent, done, error });
}

function extractYear(titleData, file) {
  if (titleData?.metadata?.year) return String(titleData.metadata.year);
  if (titleData?.metadata?.release_date) {
    const m = String(titleData.metadata.release_date).match(/^(\d{4})/);
    if (m) return m[1];
  }
  if (titleData?.year) return String(titleData.year);

  const raw = `${titleData?.nombre || ''} ${file?.fileName || ''} ${file?.label || ''}`;
  const m1 = raw.match(/\b((?:19|20)\d{2})\b/);
  if (m1) return m1[1];
  const m2 = raw.match(/AÑO\s*(\d{4})/i);
  if (m2) return m2[1];
  return null;
}

function parseEpisodeHelper(name = '') {
  const m = name.match(/(\d+)[xX](\d+)/);
  if (m) return { season: parseInt(m[1], 10), episode: parseInt(m[2], 10) };
  const s = name.match(/[sS](\d+)/);
  const e = name.match(/[eE](\d+)/);
  if (s || e) return { season: s ? parseInt(s[1], 10) : 1, episode: e ? parseInt(e[1], 10) : 0 };
  const epSolo = name.match(/\b(?:ep|episodio|cap|capitulo)\s*(\d+)\b/i);
  if (epSolo) return { season: 1, episode: parseInt(epSolo[1], 10) };
  const numSolo = name.match(/\b(\d{1,3})\b/);
  if (numSolo) return { season: 1, episode: parseInt(numSolo[1], 10) };
  return { season: 0, episode: 0 };
}

function isSeriesTitle(titleData, file) {
  if (titleData?.tipo === 'serie') return true;
  if (titleData?.tipo === 'pelicula' || titleData?.tipo === 'documental') return false;
  if (file?.season || file?.episode) return true;
  const origName = file?.fileName || file?.captionFileName || file?.label || '';
  const parsed = parseEpisodeHelper(origName);
  return parsed.season > 0 || parsed.episode > 0;
}

function formatSuggestedFileName(file, titleData) {
  const origName = file.fileName || file.captionFileName || file.label || `video_${file.messageId}.mp4`;
  const extMatch = origName.match(/\.([a-zA-Z0-9]{2,5})$/);
  const ext = extMatch ? `.${extMatch[1]}` : '.mp4';
  const cleanBase = origName.replace(/\.([a-zA-Z0-9]{2,5})$/, '').trim();

  const isMovieExplicit = titleData?.tipo === 'pelicula' || titleData?.tipo === 'documental';
  const isSerieExplicit = titleData?.tipo === 'serie';

  const fileSeason = Number(file.season) || 0;
  const fileEpisode = Number(file.episode) || 0;
  const parsedEp = parseEpisodeHelper(origName);
  const hasEp = (fileSeason > 0 || fileEpisode > 0) || (parsedEp.season > 0 || parsedEp.episode > 0);

  const isSerie = isSerieExplicit || (!isMovieExplicit && hasEp);

  if (isSerie) {
    const sName = titleData?.metadata?.name || titleData?.metadata?.title || titleData?.nombre || file.section || cleanBase;
    const season = fileSeason > 0 ? fileSeason : (parsedEp.season > 0 ? parsedEp.season : 1);
    const episode = fileEpisode > 0 ? fileEpisode : (parsedEp.episode > 0 ? parsedEp.episode : 1);
    const epStr = String(episode).padStart(2, '0');
    return `${sName} - ${season}x${epStr}${ext}`;
  }

  let mName = titleData?.metadata?.title || titleData?.metadata?.name || file?.metadata?.title || file?.metadata?.name || titleData?.nombre;
  let year = extractYear(titleData, file);

  if (!mName) {
    mName = cleanBase.replace(/\s*AÑO\s*\d{4}/i, '').replace(/\b((?:19|20)\d{2})\b/g, '').trim();
  } else if (year) {
    mName = mName.replace(new RegExp(`\\s*\\[?\\(?${year}\\]?\\)?\\s*$`, 'i'), '').trim();
  }

  if (year) {
    return `${mName} (${year})${ext}`;
  }
  return `${mName}${ext}`;
}

/**
 * Modal interactivo para enviar o subir rápidamente un archivo a un canal de tgstorage.
 */
export async function showForwardModal(client, tg, file, getChannels, titleData = null, getTitles = null) {
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

  const isSerie = isSeriesTitle(titleData, file);
  let allFiles = isSerie && Array.isArray(titleData?.archivos) && titleData.archivos.length > 0
    ? [...titleData.archivos]
    : [file];

  // Consolidar con episodios de la misma serie en el canal si estuvieran en fichas separadas
  const curTmdb = titleData?.tmdbId || titleData?.metadata?.id || file.tmdbId;
  const curChId = titleData?.channel?.id || file.channelId || titleData?.origen?.channelId;
  if (isSerie && (curTmdb || titleData?.nombre)) {
    const sNameNorm = normalizeMovieKey(titleData.metadata?.name || titleData.metadata?.title || titleData.nombre).replace(/(?:19|20)\d{2}/g, '');
    const pool = [];
    if (typeof getTitles === 'function') {
      try { pool.push(...(getTitles() || [])); } catch (_) {}
    }
    if (typeof EXT_CHANNEL_TITLES_CACHE !== 'undefined' && EXT_CHANNEL_TITLES_CACHE?.values) {
      try {
        for (const list of EXT_CHANNEL_TITLES_CACHE.values()) {
          if (Array.isArray(list)) pool.push(...list);
        }
      } catch (_) {}
    }

    const siblings = pool.filter(t => {
      if (t === titleData) return false;
      const matchCh = String(t.channel?.id || t.origen?.channelId || '') === String(curChId || '');
      if (!matchCh) return false;
      if (curTmdb && String(t.tmdbId || t.metadata?.id) === String(curTmdb)) return true;
      const tNorm = normalizeMovieKey(t.metadata?.name || t.metadata?.title || t.nombre).replace(/(?:19|20)\d{2}/g, '');
      return sNameNorm && tNorm === sNameNorm;
    });

    const existingKeys = new Set(allFiles.map(f => f.key || `${f.channelId || f.channel?.id}:${f.messageId}`));
    for (const sib of siblings) {
      for (const sf of (sib.archivos || [])) {
        const sfKey = sf.key || `${sf.channelId || sf.channel?.id}:${sf.messageId}`;
        if (!existingKeys.has(sfKey)) {
          allFiles.push(sf);
          existingKeys.add(sfKey);
        }
      }
    }
  }

  // Ordenar episodios
  allFiles.sort((a, b) => (a.season - b.season) || (a.episode - b.episode) || ((Number(b.size) || 0) - (Number(a.size) || 0)) || (a.date - b.date));

  // Agrupar temporadas
  const seasonsMap = new Map();
  for (const f of allFiles) {
    let s = Number(f.season);
    if (!Number.isFinite(s) || s <= 0) {
      const parsed = parseEpisode(f.captionFileName || f.fileName || '');
      s = parsed.season || 1;
      f.season = s;
      if (!f.episode) f.episode = parsed.episode || 1;
    }
    if (!seasonsMap.has(s)) seasonsMap.set(s, []);
    seasonsMap.get(s).push(f);
  }
  const seasonNumbers = Array.from(seasonsMap.keys()).sort((a, b) => a - b);

  const isMultiFile = isSerie && allFiles.length > 1;
  const seriesBaseName = titleData?.metadata?.name || titleData?.metadata?.title || titleData?.nombre || 'Serie';
  const defaultFilename = formatSuggestedFileName(file, titleData);
  const sizeStr = formatBytes(file.size);
  const totalSeriesSize = allFiles.reduce((acc, f) => acc + (Number(f.size) || 0), 0);

  const seasonOptionsHtml = seasonNumbers.map(sNum => {
    const sFiles = seasonsMap.get(sNum);
    const sSize = sFiles.reduce((acc, f) => acc + (Number(f.size) || 0), 0);
    return `<option value="${sNum}">Temporada ${sNum} (${sFiles.length} episodios · ${formatBytes(sSize)})</option>`;
  }).join('');

  const episodeOptionsHtml = allFiles.map((f, idx) => {
    const fKey = f.key || `${f.channelId || f.channel?.id}:${f.messageId}` || `ep_${idx}`;
    const s = f.season || 1;
    const epNum = f.episode || (idx + 1);
    const epTitle = prettyEpisodeName(f.captionFileName || f.fileName, seriesBaseName) || f.fileName;
    const isSelected = (file && (f.messageId === file.messageId || f.key === file.key)) || idx === 0;
    return `<option value="${esc(fKey)}" ${isSelected ? 'selected' : ''}>T${s}E${String(epNum).padStart(2, '0')} - ${esc(epTitle)} (${formatBytes(f.size)})</option>`;
  }).join('');

  const modalOverlay = document.createElement('div');
  modalOverlay.className = 'modal-overlay';
  modalOverlay.style.cssText = `
    position: fixed; inset: 0; z-index: 100050;
    background: rgba(0, 0, 0, 0.78); backdrop-filter: blur(4px);
    display: flex; align-items: center; justify-content: center; padding: 1rem;
  `;

  modalOverlay.innerHTML = `
    <div style="background: #181c24; border: 1px solid rgba(255,255,255,0.15); border-radius: 12px; max-width: 560px; width: 100%; box-shadow: 0 20px 40px rgba(0,0,0,0.8); color: #fff; padding: 1.5rem; font-family: inherit;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.2rem; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 0.8rem;">
        <h3 style="margin: 0; font-size: 1.2rem; font-weight: 700; display: flex; align-items: center; gap: 0.5rem;">
          <span>⚡</span> ${isMultiFile ? 'Enviar serie / episodios a canal tgstorage' : 'Enviar archivo a canal tgstorage'}
        </h3>
        <button id="modal-close-btn" style="background: transparent; border: none; color: #94a3b8; font-size: 1.4rem; cursor: pointer; padding: 0.2rem 0.5rem; border-radius: 4px;">×</button>
      </div>

      ${isMultiFile ? `
        <div style="background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 0.85rem 1rem; margin-bottom: 1.2rem; font-size: 0.88rem;">
          <label style="display: block; font-size: 0.82rem; font-weight: 600; color: #cbd5e1; margin-bottom: 0.55rem;">
            ¿Qué deseas enviar a tgstorage?
          </label>
          <div style="display: flex; flex-direction: column; gap: 0.65rem;">
            <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer; font-size: 0.88rem; color: #fff;">
              <input type="radio" name="send-scope" id="scope-all" value="all" checked style="cursor: pointer; accent-color: var(--theme-accent, #e50914);" />
              <strong>Enviar serie entera (${allFiles.length} episodios · ${esc(formatBytes(totalSeriesSize))})</strong>
            </label>

            ${seasonNumbers.length > 0 ? `
              <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer; font-size: 0.88rem; color: #cbd5e1;">
                <input type="radio" name="send-scope" id="scope-season" value="season" style="cursor: pointer; accent-color: var(--theme-accent, #e50914);" />
                <span>Enviar una temporada en concreto</span>
              </label>
              <div id="season-selector-container" style="display: none; margin-left: 1.6rem; margin-top: 0.2rem;">
                <select id="target-season-select" style="width: 100%; background: #0f172a; border: 1px solid rgba(255,255,255,0.22); border-radius: 6px; padding: 0.5rem 0.75rem; color: #fff; font-size: 0.88rem; outline: none; box-sizing: border-box;">
                  ${seasonOptionsHtml}
                </select>
              </div>
            ` : ''}

            <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer; font-size: 0.88rem; color: #cbd5e1;">
              <input type="radio" name="send-scope" id="scope-single" value="single" style="cursor: pointer; accent-color: var(--theme-accent, #e50914);" />
              <span>Enviar solo un episodio</span>
            </label>
            <div id="episode-selector-container" style="display: none; margin-left: 1.6rem; margin-top: 0.2rem;">
              <select id="target-episode-select" style="width: 100%; background: #0f172a; border: 1px solid rgba(255,255,255,0.22); border-radius: 6px; padding: 0.5rem 0.75rem; color: #fff; font-size: 0.88rem; outline: none; box-sizing: border-box;">
                ${episodeOptionsHtml}
              </select>
            </div>
          </div>
        </div>

        <div id="series-name-container" style="background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 0.85rem 1rem; margin-bottom: 1.2rem; font-size: 0.88rem;">
          <label style="display: block; font-size: 0.82rem; font-weight: 600; color: #cbd5e1; margin-bottom: 0.4rem;">
            Nombre base de la serie (editable):
          </label>
          <input type="text" id="target-seriesname-input" value="${esc(seriesBaseName)}" style="width: 100%; background: #0f172a; border: 1px solid rgba(255,255,255,0.22); border-radius: 6px; padding: 0.6rem 0.75rem; color: #fff; font-size: 0.92rem; outline: none; box-sizing: border-box;" />
          <div style="display: flex; justify-content: space-between; align-items: center; color: #94a3b8; font-size: 0.78rem; margin-top: 0.45rem;">
            <span id="series-stats-label">Total: <strong>${allFiles.length} episodios (${esc(formatBytes(totalSeriesSize))})</strong></span>
            <span style="color: #38bdf8;">Formato: "[Serie] - 1x01.mp4", "1x02.mp4"...</span>
          </div>
        </div>
      ` : ''}

      <div id="single-name-container" style="${isMultiFile ? 'display: none;' : ''} background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 0.85rem 1rem; margin-bottom: 1.2rem; font-size: 0.88rem;">
        <label style="display: block; font-size: 0.82rem; font-weight: 600; color: #cbd5e1; margin-bottom: 0.4rem;">
          Nombre del archivo en Telegram (editable):
        </label>
        <input type="text" id="target-filename-input" value="${esc(defaultFilename)}" style="width: 100%; background: #0f172a; border: 1px solid rgba(255,255,255,0.22); border-radius: 6px; padding: 0.6rem 0.75rem; color: #fff; font-size: 0.92rem; outline: none; box-sizing: border-box;" />
        <div style="display: flex; justify-content: space-between; align-items: center; color: #94a3b8; font-size: 0.78rem; margin-top: 0.45rem;">
          <span>Tamaño: <strong>${esc(sizeStr)}</strong></span>
          <span style="color: #38bdf8;">Se incluirá en el caption oficial de tgstorage</span>
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
            <option value="${esc(ch.id)}">${ch.id === (isSerie ? tgStorageChannels.find(c => c.category === 'Series')?.id : tgStorageChannels.find(c => c.category === 'Películas')?.id) ? '⭐ ' : ''}[${esc(ch.category || 'General')}] ${esc(ch.title || ch.name)}</option>
          `).join('')}
        </select>
      </div>

      <div style="background: rgba(56,189,248,0.08); border: 1px solid rgba(56,189,248,0.22); border-radius: 8px; padding: 0.85rem 1rem; margin-bottom: 1.5rem;">
        <label style="display: flex; align-items: flex-start; gap: 0.6rem; cursor: pointer; font-size: 0.88rem; color: #e0f2fe;">
          <input type="checkbox" id="fast-upload-check" checked style="margin-top: 0.25rem; cursor: pointer;" />
          <div>
            <strong>⚡ Subida rápida en la nube (Recomendada)</strong>
            <div style="color: #94a3b8; font-size: 0.78rem; margin-top: 0.25rem; line-height: 1.4;">
              Instantánea y sin descargar al PC. Publica el archivo en el canal destino con el nuevo nombre y todos los metadatos TMDB en el caption oficial de tgstorage.
              <br><span style="color: #64748b;">(Si desmarcas esta casilla, se descargará a memoria y resubirá completamente para cambiar también el nombre interno en Telegram Desktop/Mobile).</span>
            </div>
          </div>
        </label>
      </div>

      <div style="display: flex; justify-content: flex-end; gap: 0.8rem;">
        <button type="button" id="modal-cancel-btn" style="background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.15); border-radius: 6px; padding: 0.6rem 1.2rem; color: #fff; font-size: 0.9rem; cursor: pointer;">
          Cancelar
        </button>
        <button type="button" id="modal-send-btn" style="background: var(--theme-accent, #e50914); border: none; border-radius: 6px; padding: 0.6rem 1.4rem; color: #fff; font-size: 0.9rem; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 0.4rem;">
          <span>${isMultiFile ? `⚡ Enviar ${allFiles.length} episodios` : '⚡ Enviar ahora'}</span>
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modalOverlay);

  const closeModal = () => modalOverlay.remove();
  modalOverlay.querySelector('#modal-close-btn').onclick = closeModal;
  modalOverlay.querySelector('#modal-cancel-btn').onclick = closeModal;
  modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) closeModal();
  });

  const searchInput = modalOverlay.querySelector('#channel-search-input');
  const targetSelect = modalOverlay.querySelector('#channel-target-select');
  const fastCheck = modalOverlay.querySelector('#fast-upload-check');
  const sendBtn = modalOverlay.querySelector('#modal-send-btn');
  const scopeAllRadio = modalOverlay.querySelector('#scope-all');
  const scopeSeasonRadio = modalOverlay.querySelector('#scope-season');
  const scopeSingleRadio = modalOverlay.querySelector('#scope-single');
  const seasonSelectorContainer = modalOverlay.querySelector('#season-selector-container');
  const seasonSelect = modalOverlay.querySelector('#target-season-select');
  const episodeSelectorContainer = modalOverlay.querySelector('#episode-selector-container');
  const episodeSelect = modalOverlay.querySelector('#target-episode-select');
  const seriesNameContainer = modalOverlay.querySelector('#series-name-container');
  const singleNameContainer = modalOverlay.querySelector('#single-name-container');
  const seriesStatsLabel = modalOverlay.querySelector('#series-stats-label');
  const filenameInput = modalOverlay.querySelector('#target-filename-input');

  const updateScopeView = () => {
    if (!isMultiFile) return;
    if (scopeAllRadio?.checked) {
      if (seasonSelectorContainer) seasonSelectorContainer.style.display = 'none';
      if (episodeSelectorContainer) episodeSelectorContainer.style.display = 'none';
      if (seriesNameContainer) seriesNameContainer.style.display = 'block';
      if (singleNameContainer) singleNameContainer.style.display = 'none';
      if (seriesStatsLabel) seriesStatsLabel.innerHTML = `Total: <strong>${allFiles.length} episodios (${formatBytes(totalSeriesSize)})</strong>`;
      sendBtn.innerHTML = `<span>⚡ Enviar serie entera (${allFiles.length} eps)</span>`;
    } else if (scopeSeasonRadio?.checked) {
      if (seasonSelectorContainer) seasonSelectorContainer.style.display = 'block';
      if (episodeSelectorContainer) episodeSelectorContainer.style.display = 'none';
      if (seriesNameContainer) seriesNameContainer.style.display = 'block';
      if (singleNameContainer) singleNameContainer.style.display = 'none';
      const sNum = Number(seasonSelect?.value || 1);
      const sFiles = seasonsMap.get(sNum) || [];
      const sSize = sFiles.reduce((acc, f) => acc + (Number(f.size) || 0), 0);
      if (seriesStatsLabel) seriesStatsLabel.innerHTML = `Temporada ${sNum}: <strong>${sFiles.length} episodios (${formatBytes(sSize)})</strong>`;
      sendBtn.innerHTML = `<span>⚡ Enviar Temporada ${sNum} (${sFiles.length} eps)</span>`;
    } else if (scopeSingleRadio?.checked) {
      if (seasonSelectorContainer) seasonSelectorContainer.style.display = 'none';
      if (episodeSelectorContainer) episodeSelectorContainer.style.display = 'block';
      if (seriesNameContainer) seriesNameContainer.style.display = 'none';
      if (singleNameContainer) singleNameContainer.style.display = 'block';
      const chosenKey = episodeSelect?.value;
      const chosenFile = allFiles.find(f => (f.key || `${f.channelId || f.channel?.id}:${f.messageId}`) === chosenKey) || file;
      if (filenameInput) filenameInput.value = formatSuggestedFileName(chosenFile, titleData);
      sendBtn.innerHTML = '<span>⚡ Enviar episodio a tgstorage</span>';
    }
  };

  scopeAllRadio?.addEventListener('change', updateScopeView);
  scopeSeasonRadio?.addEventListener('change', updateScopeView);
  scopeSingleRadio?.addEventListener('change', updateScopeView);
  seasonSelect?.addEventListener('change', updateScopeView);
  episodeSelect?.addEventListener('change', () => {
    if (scopeSingleRadio?.checked) {
      const chosenKey = episodeSelect.value;
      const chosenFile = allFiles.find(f => (f.key || `${f.channelId || f.channel?.id}:${f.messageId}`) === chosenKey) || file;
      if (filenameInput) filenameInput.value = formatSuggestedFileName(chosenFile, titleData);
    }
  });

  // Filtrado reactivo de canales
  searchInput.addEventListener('input', () => {
    const term = (searchInput.value || '').trim().toLowerCase();
    const filtered = tgStorageChannels.filter(ch => {
      const matchName = (ch.title || ch.name || '').toLowerCase().includes(term);
      const matchCat = (ch.category || '').toLowerCase().includes(term);
      return matchName || matchCat;
    });

    if (filtered.length > 0) {
      targetSelect.innerHTML = filtered.map(ch => `
        <option value="${esc(ch.id)}">[${esc(ch.category || 'General')}] ${esc(ch.title || ch.name)}</option>
      `).join('');
    } else {
      targetSelect.innerHTML = '<option value="">No hay canales que coincidan</option>';
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
    const isScopeAll = isMultiFile && scopeAllRadio && scopeAllRadio.checked;
    const isScopeSeason = isMultiFile && scopeSeasonRadio && scopeSeasonRadio.checked;

    // Determinar los archivos exactos a enviar según la selección
    let filesToSend = allFiles;
    let uploadJobTitle = '';
    if (isMultiFile) {
      if (isScopeAll) {
        filesToSend = allFiles;
        uploadJobTitle = seriesBaseName;
      } else if (isScopeSeason) {
        const sNum = Number(seasonSelect?.value || 1);
        filesToSend = seasonsMap.get(sNum) || [];
        uploadJobTitle = `${seriesBaseName} - T${sNum}`;
      } else {
        const chosenKey = episodeSelect?.value;
        const chosenFile = allFiles.find(f => (f.key || `${f.channelId || f.channel?.id}:${f.messageId}`) === chosenKey) || file;
        filesToSend = [chosenFile];
      }
    } else {
      filesToSend = [file];
    }

    const isBatchMulti = filesToSend.length > 1;
    closeModal();

    const bar = ensureProgressBar();

    // 1. Resolver el título y sus metadatos TMDB completos
    let effectiveTitle = titleData;
    if (!effectiveTitle && file) {
      const internalTitles = (typeof getTitles === 'function' ? (getTitles() || []) : []) || [];
      const externalTitlesList = Array.from(EXT_CHANNEL_TITLES_CACHE?.values?.() || []).flat();
      const allTitles = [...internalTitles, ...externalTitlesList];
      effectiveTitle = allTitles.find(t => t.archivos?.some(f => f.key === file.key || String(f.messageId) === String(file.messageId)));
    }

    let meta = effectiveTitle?.metadata || file.metadata || null;
    let effectiveTmdbId = meta?.id || effectiveTitle?.tmdbId || file.tmdbId;

    if (effectiveTmdbId && (!meta?.director || !meta?.cast)) {
      try {
        const isTv = effectiveTitle?.tipo === 'serie' || isSerie;
        const full = await fetchTmdbFullDetails(isTv ? 'tv' : 'movie', effectiveTmdbId);
        if (full && Object.keys(full).length > 0) {
          meta = { ...(meta || {}), ...full };
          if (effectiveTitle) effectiveTitle.metadata = meta;
        }
      } catch (err) {
        console.warn('[contextMenu] No se pudieron cargar detalles adicionales de TMDB', err);
      }
    }

    if (isBatchMulti) {
      // --- ENVÍO EN LOTE DE SERIE COMPLETA O TEMPORADA ---
      const seriesInput = modalOverlay.querySelector('#target-seriesname-input');
      const sBaseName = seriesInput?.value?.trim() || uploadJobTitle || seriesBaseName;
      const count = filesToSend.length;
      const taskId = startUploadTask(`${isFastUpload ? '⚡ Subida rápida' : '🔄 Subiendo'}: ${sBaseName} (${count} eps)`, `Iniciando envío de ${count} episodios a "${targetChannelName}"…`, 5);
      setProgressBar(bar, {
        id: taskId,
        title: `${isFastUpload ? '⚡ Subida rápida' : '🔄 Subiendo'}: ${sBaseName} (${count} eps)`,
        status: `Iniciando envío de ${count} episodios a "${targetChannelName}"…`,
        percent: 5,
      });

      try {
        const targetPeer = await resolvePeer(client, tg, targetChannel || targetChannelId);

        for (let i = 0; i < count; i++) {
          const curFile = filesToSend[i];
          const curFilename = formatSuggestedFileName(curFile, {
            ...effectiveTitle,
            nombre: sBaseName,
            tipo: 'serie',
            metadata: { ...(meta || {}), name: sBaseName, title: sBaseName },
          });

          const pct = Math.round((i / count) * 90) + 5;
          setProgressBar(bar, {
            id: taskId,
            title: `⚡ Enviando serie: ${sBaseName} (${i + 1}/${count})`,
            status: `[${i + 1}/${count}] Enviando "${curFilename}"…`,
            percent: pct,
          });

          const fileSourcePeer = await resolvePeer(client, tg, curFile.channel || curFile.channelId || effectiveTitle?.channel || file.channel);
          const [msg] = await client.getMessages(fileSourcePeer, { ids: [curFile.messageId] });
          if (!msg || !msg.media) continue;

          const cap = parseCaption(curFile.rawCaption || msg.message || '');
          const isEpSeries = effectiveTitle?.tipo === 'serie' || isSerie;
          const targetSection = isEpSeries
            ? (sBaseName || seriesBaseName || targetChannel?.group || '')
            : (targetChannel?.section || targetChannel?.group || curFile.section || effectiveTitle?.origen?.seccion || '');
          const epCaption = buildStandardCaption({
            fileName: curFilename,
            section: targetSection,
            tmdbId: meta?.id || effectiveTmdbId || cap.tmdbId || '',
            imdbId: meta?.imdbId || meta?.imdb_id || effectiveTitle?.imdbId || cap.imdbId || '',
            director: meta?.director || cap.director || '',
            writer: meta?.writer || cap.writer || '',
            cast: meta?.cast || cap.cast || '',
            rating: meta?.rating || meta?.vote_average || cap.rating || '',
            ageRating: meta?.ageRating || cap.ageRating || '',
            synopsis: curFile.synopsis || meta?.overview || meta?.synopsis || cap.synopsis || '',
          });

          if (isFastUpload) {
            const docMedia = msg.media?.document || msg.media;
            if (docMedia) {
              try {
                await client.sendFile(targetPeer, {
                  file: docMedia,
                  caption: epCaption,
                  forceDocument: false,
                });
              } catch (sendErr) {
                const errMsg = String(sendErr?.message || sendErr || '');
                if (errMsg.includes('CHAT_FORWARDS_RESTRICTED') || errMsg.includes('FORWARDS_RESTRICTED')) {
                  console.warn('[contextMenu] Canal con restricción de reenvío (CHAT_FORWARDS_RESTRICTED). Descargando y resubiendo para eludir restricción…', curFilename);
                  setProgressBar(bar, {
                    id: taskId,
                    title: `⚡ Enviando serie: ${sBaseName} (${i + 1}/${count})`,
                    status: `[${i + 1}/${count}] Canal con reenvío protegido: descargando y resubiendo…`,
                    percent: pct,
                  });
                  const bytes = await client.downloadMedia(msg.media, {});
                  const mimeType = msg.document?.mimeType || (curFilename.toLowerCase().endsWith('.mp4') ? 'video/mp4' : 'application/octet-stream');
                  const blob = new Blob([bytes], { type: mimeType });
                  const upload = await client.uploadFile({
                    file: new File([blob], curFilename, { type: blob.type }),
                    workers: 3,
                  });
                  await client.sendFile(targetPeer, {
                    file: upload,
                    caption: epCaption,
                    forceDocument: !curFilename.toLowerCase().endsWith('.mp4'),
                    attributes: [new Api.DocumentAttributeFilename({ fileName: curFilename })],
                  });
                } else {
                  throw sendErr;
                }
              }
            }
          } else {
            const bytes = await client.downloadMedia(msg.media, {});
            const mimeType = msg.document?.mimeType || (curFilename.toLowerCase().endsWith('.mp4') ? 'video/mp4' : 'application/octet-stream');
            const blob = new Blob([bytes], { type: mimeType });
            const upload = await client.uploadFile({
              file: new File([blob], curFilename, { type: blob.type }),
              workers: 3,
            });
            await client.sendFile(targetPeer, {
              file: upload,
              caption: epCaption,
              forceDocument: !curFilename.toLowerCase().endsWith('.mp4'),
              attributes: [new Api.DocumentAttributeFilename({ fileName: curFilename })],
            });
          }

          if (i < count - 1) {
            await new Promise(r => setTimeout(r, 650));
          }
        }

        setProgressBar(bar, {
          id: taskId,
          title: `⚡ Serie enviada con éxito: ${sBaseName}`,
          status: `Los ${count} episodios se han enviado a "${targetChannelName}"`,
          percent: 100,
          done: true,
        });
      } catch (err) {
        console.error('[contextMenu] Error en subida de serie completa', err);
        setProgressBar(bar, {
          id: taskId,
          title: `Error al enviar serie: ${sBaseName}`,
          status: err.message || String(err),
          percent: 0,
          error: true,
        });
      }
    } else {
      // --- ENVÍO DE ARCHIVO INDIVIDUAL ---
      const filenameInput = modalOverlay.querySelector('#target-filename-input');
      const filename = filenameInput?.value?.trim() || defaultFilename;

      const taskId = startUploadTask(`${isFastUpload ? '⚡ Subida rápida' : '🔄 Resubida completa'}: ${filename}`, `Conectando con canal destino "${targetChannelName}"…`, 15);
      setProgressBar(bar, {
        id: taskId,
        title: `${isFastUpload ? '⚡ Subida rápida' : '🔄 Resubida completa'}: ${filename}`,
        status: `Conectando con canal destino "${targetChannelName}"…`,
        percent: 15,
      });

      try {
        const curTargetFile = filesToSend[0] || file;
        const sourcePeer = await resolvePeer(client, tg, curTargetFile.channel || curTargetFile.channelId || file.channel || file.channelId);
        const targetPeer = await resolvePeer(client, tg, targetChannel || targetChannelId);

        const [msg] = await client.getMessages(sourcePeer, { ids: [curTargetFile.messageId] });
        if (!msg || !msg.media) {
          throw new Error('No se pudo encontrar el mensaje original en Telegram.');
        }

        setProgressBar(bar, {
          id: taskId,
          title: `${isFastUpload ? '⚡ Subida rápida' : '🔄 Resubida completa'}: ${filename}`,
          status: 'Preparando metadatos y caption…',
          percent: 45,
        });

        const cap = parseCaption(curTargetFile.rawCaption || msg.message || '');
        const isSingleSeries = isSerie || effectiveTitle?.tipo === 'serie';
        const singleSection = isSingleSeries
          ? (seriesBaseName || targetChannel?.group || '')
          : (targetChannel?.section || targetChannel?.group || file.section || effectiveTitle?.origen?.seccion || '');
        const standardCaption = buildStandardCaption({
          fileName: filename,
          section: singleSection,
          tmdbId: meta?.id || effectiveTmdbId || cap.tmdbId || '',
          imdbId: meta?.imdbId || meta?.imdb_id || effectiveTitle?.imdbId || cap.imdbId || '',
          director: meta?.director || cap.director || '',
          writer: meta?.writer || cap.writer || '',
          cast: meta?.cast || cap.cast || '',
          rating: meta?.rating || meta?.vote_average || cap.rating || '',
          ageRating: meta?.ageRating || cap.ageRating || '',
          synopsis: meta?.overview || meta?.synopsis || file.synopsis || cap.synopsis || '',
        });

        setProgressBar(bar, {
          id: taskId,
          title: `${isFastUpload ? '⚡ Subida rápida' : '🔄 Resubida completa'}: ${filename}`,
          status: `Enviando a "${targetChannelName}"…`,
          percent: 60,
        });

        if (isFastUpload) {
          const docMedia = msg.media?.document || msg.media;
          if (!docMedia) throw new Error('El mensaje original no contiene un archivo reenviable.');

          try {
            await client.sendFile(targetPeer, {
              file: docMedia,
              caption: standardCaption,
              forceDocument: false,
            });
          } catch (sendErr) {
            const errMsg = String(sendErr?.message || sendErr || '');
            if (errMsg.includes('CHAT_FORWARDS_RESTRICTED') || errMsg.includes('FORWARDS_RESTRICTED')) {
              console.warn('[contextMenu] Canal con restricción de reenvío (CHAT_FORWARDS_RESTRICTED). Descargando y resubiendo para eludir restricción…', filename);
              setProgressBar(bar, {
                id: taskId,
                title: `⚡ Enviando: ${filename}`,
                status: 'Canal protegido contra reenvío: descargando original…',
                percent: 30,
              });
              const bytes = await client.downloadMedia(msg.media, {
                progressCallback: (done, total) => {
                  const tot = total || file.size || 1;
                  const pct = Math.min(50, Math.round((done / tot) * 50));
                  setProgressBar(bar, {
                    id: taskId,
                    title: `⚡ Enviando: ${filename}`,
                    status: `Descargando original ${formatBytes(done)} / ${formatBytes(tot)}…`,
                    percent: pct,
                  });
                }
              });
              setProgressBar(bar, {
                id: taskId,
                title: `⚡ Enviando: ${filename}`,
                status: 'Subiendo archivo nuevo a Telegram…',
                percent: 55,
              });
              const mimeType = msg.document?.mimeType || (filename.toLowerCase().endsWith('.mp4') ? 'video/mp4' : 'application/octet-stream');
              const blob = new Blob([bytes], { type: mimeType });
              const upload = await client.uploadFile({
                file: new File([blob], filename, { type: blob.type }),
                workers: 3,
                onProgress: (progress) => {
                  const pct = 55 + Math.round(progress * 40);
                  setProgressBar(bar, {
                    id: taskId,
                    title: `⚡ Enviando: ${filename}`,
                    status: `Subiendo ${Math.round(progress * 100)}%…`,
                    percent: pct,
                  });
                }
              });
              await client.sendFile(targetPeer, {
                file: upload,
                caption: standardCaption,
                forceDocument: !filename.toLowerCase().endsWith('.mp4'),
                attributes: [new Api.DocumentAttributeFilename({ fileName: filename })],
              });
            } else {
              throw sendErr;
            }
          }
        } else {
          setProgressBar(bar, {
            id: taskId,
            title: `🔄 Resubiendo: ${filename}`,
            status: `Descargando original (${formatBytes(file.size)})…`,
            percent: 35,
          });

          const bytes = await client.downloadMedia(msg.media, {
            progressCallback: (done, total) => {
              const tot = total || file.size || 1;
              const pct = Math.min(45, Math.round((done / tot) * 45));
              setProgressBar(bar, {
                id: taskId,
                title: `🔄 Resubiendo: ${filename}`,
                status: `Descargando ${formatBytes(done)} / ${formatBytes(tot)}…`,
                percent: pct,
              });
            }
          });

          const mimeType = msg.document?.mimeType || (filename.toLowerCase().endsWith('.mp4') ? 'video/mp4' : 'application/octet-stream');
          const blob = new Blob([bytes], { type: mimeType });
          const upload = await client.uploadFile({
            file: new File([blob], filename, { type: blob.type }),
            workers: 3,
            onProgress: (progress) => {
              const pct = 45 + Math.round(progress * 50);
              setProgressBar(bar, {
                id: taskId,
                title: `🔄 Resubiendo: ${filename}`,
                status: `Subiendo a "${targetChannelName}" (${Math.round(progress * 100)}%)…`,
                percent: pct,
              });
            }
          });

          await client.sendFile(targetPeer, {
            file: upload,
            caption: standardCaption,
            forceDocument: !filename.toLowerCase().endsWith('.mp4'),
            attributes: [new Api.DocumentAttributeFilename({ fileName: filename })],
          });
        }

        setProgressBar(bar, {
          id: taskId,
          title: `${isFastUpload ? '⚡ Subida rápida completada' : '🔄 Resubida completada'}: ${filename}`,
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
    }
  });
}



