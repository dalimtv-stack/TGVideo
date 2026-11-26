# TGVideo — Archivos Completos con Soluciones Verificadas

Este documento contiene el código íntegro de todos los archivos modificados para solucionar el envío a tgstorage (tanto en películas como en series, en Home y Externos), la subida paralela con progreso, el control de flood, estilos y títulos en negrita.

## Archivo: `src/ui/forwardModal.js`

```javascript
// src/ui/forwardModal.js
import { Api } from 'telegram';
import { fetchTmdbFullDetails, extractTitleAndYear } from '../metadata/tmdb.js';
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

  let rawId = String(typeof target === 'object' ? (target.tgChannelId || target.channelId || target.id || '') : target).split('_top_')[0].trim();
  const cleanId = rawId.replace(/^ext-/, '').trim();
  if (!cleanId) throw new Error('ID de canal no válido');

  const accessHash = typeof target === 'object' ? (target.accessHash || target.hash) : null;
  if (tg?.peerOf && accessHash) {
    try {
      const p = tg.peerOf({
        ...target,
        id: cleanId.replace(/^-100/, '').replace(/^-/, ''),
        accessHash,
      });
      if (p) return p;
    } catch (_) {}
  }

  if (client?.getInputEntity) {
    const numOnly = cleanId.replace(/^-?100/, '').replace(/^-/, '');
    try {
      return await client.getInputEntity(`-100${numOnly}`);
    } catch (_) {}
    try {
      return await client.getInputEntity(cleanId);
    } catch (_) {}
    try {
      return await client.getInputEntity(BigInt(`-100${numOnly}`));
    } catch (_) {}
    try {
      return await client.getInputEntity(Number(numOnly));
    } catch (_) {}
  }

  if (tg?.peerOf) {
    const numOnly = cleanId.replace(/^-?100/, '').replace(/^-/, '');
    return tg.peerOf({
      id: numOnly,
      accessHash: typeof target === 'object' ? (target.accessHash || target.hash || '0') : '0',
    });
  }

  throw new Error(`No se pudo resolver el canal en Telegram (${cleanId})`);
}

function ensureProgressBar() {
  return document.getElementById('admin-global-upload-bar');
}

function setProgressBar(_bar, { id, title, status, percent = 0, done = false, error = false }) {
  if (!id) return;
  updateUploadTask(id, { title, status, percent, done, error });
}

function extractYear(titleData, file) {
  // 1. Metadatos directos o heredados de TMDB
  const meta = titleData?.metadata || file?.metadata || null;
  if (meta?.year) return String(meta.year);
  if (meta?.release_date) {
    const m = String(meta.release_date).match(/^(\d{4})/);
    if (m) return m[1];
  }
  if (meta?.first_air_date) {
    const m = String(meta.first_air_date).match(/^(\d{4})/);
    if (m) return m[1];
  }
  if (titleData?.metadata?.year) return String(titleData.metadata.year);
  if (titleData?.metadata?.release_date) {
    const m = String(titleData.metadata.release_date).match(/^(\d{4})/);
    if (m) return m[1];
  }
  if (titleData?.metadata?.first_air_date) {
    const m = String(titleData.metadata.first_air_date).match(/^(\d{4})/);
    if (m) return m[1];
  }
  if (file?.metadata?.year) return String(file.metadata.year);
  if (file?.metadata?.release_date) {
    const m = String(file.metadata.release_date).match(/^(\d{4})/);
    if (m) return m[1];
  }

  // 2. Propiedades year / yearHint comunes en pestaña Externos
  if (titleData?.yearHint) return String(titleData.yearHint);
  if (file?.yearHint) return String(file.yearHint);
  if (titleData?.year) return String(titleData.year);
  if (file?.year) return String(file.year);

  // 3. Extracción robusta de nombres de archivo y captions de Telegram
  const candidate = file?.captionFileName || file?.fileName || file?.rawFileName || file?.label || titleData?.nombre || '';
  const parsedCandidate = extractTitleAndYear(candidate);
  if (parsedCandidate.year) return String(parsedCandidate.year);

  const raw = `${titleData?.nombre || ''} ${file?.fileName || ''} ${file?.captionFileName || ''} ${file?.rawFileName || ''} ${file?.rawCaption || ''} ${file?.caption || ''} ${file?.label || ''} ${file?.synopsis || ''}`;

  const mBracket = raw.match(/[\[\(]((?:19|20)\d{2})[\]\)]/);
  if (mBracket) return mBracket[1];

  const mYearTag = raw.match(/(?:AÑO|YEAR)\s*(\d{4})/i);
  if (mYearTag) return mYearTag[1];

  const mWord = raw.match(/\b((?:19\d{2}|20[0-3]\d))\b/);
  if (mWord) return mWord[1];

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

  const candidateName = file?.captionFileName || file?.fileName || file?.label || titleData?.nombre || cleanBase;
  const parsedCandidate = extractTitleAndYear(candidateName);
  let year = extractYear(titleData, file) || parsedCandidate.year;

  let mName = titleData?.metadata?.title || titleData?.metadata?.name || file?.metadata?.title || file?.metadata?.name || parsedCandidate.title || titleData?.nombre || cleanBase;

  if (year) {
    // Limpiar el año existente en cualquier parte para evitar duplicados como "Gladiator (2000) (2000)"
    mName = mName
      .replace(new RegExp(`\s*[\[\(]?${year}[\]\)]?\s*$`, 'i'), '')
      .replace(new RegExp(`\s*\b${year}\b\s*`, 'g'), ' ')
      .replace(/\s*[\[\(]?(?:19|20)\d{2}[\]\)]?\s*$/i, '')
      .replace(/\s*AÑO\s*\d{4}/i, '')
      .replace(/\s+/g, ' ')
      .trim();
    return `${mName} (${year})${ext}`;
  } else {
    // Si ya trae año entre paréntesis en el propio nombre, mantenerlo
    const hasParen = mName.match(/[\[\(]((?:19|20)\d{2})[\]\)]/);
    if (!hasParen) {
      const matchYear = mName.match(/\b((?:19\d{2}|20[0-3]\d))\b/);
      if (matchYear) {
        const y = matchYear[1];
        mName = mName.replace(new RegExp(`\s*[\[\(]?${y}[\]\)]?\s*$`, 'i'), '').trim();
        return `${mName} (${y})${ext}`;
      }
    }
  }
  return `${mName}${ext}`;
}

/**
 * Modal interactivo para enviar o subir rápidamente un archivo a un canal de tgstorage.
 */
export async function showForwardModal(client, tg, file, getChannels, titleData = null, getTitles = null) {
  if (!client) {
    if (tg?.getClient) client = tg.getClient();
    else if (window.tg?.getClient) client = window.tg.getClient();
  }
  if (!client) {
    alert('Cliente de Telegram no disponible.');
    return;
  }
  if (!file) {
    console.warn('[forwardModal] Archivo no especificado');
    return;
  }

  let channels = [];
  try {
    if (typeof getChannels === 'function') {
      channels = getChannels() || [];
    }
  } catch (err) {
    console.warn('[forwardModal] Error getChannels', err);
  }

  // Filtrar solo canales propios de tgstorage (excluyendo externos)
  let tgStorageChannels = (channels || []).filter(ch => !ch.isExternal && (ch.category || String(ch.title || '').includes('::tgstorage')));

  // Si no hay canales tgstorage encontrados en la caché (por ejemplo, estamos en la pestaña Externos),
  // forzamos la carga desde la biblioteca de Telegram para encontrarlos
  if (tgStorageChannels.length === 0 && client) {
    try {
      const loaded = await loadLibrary(client);
      if (Array.isArray(loaded)) {
        tgStorageChannels = loaded.filter(ch => !ch.isExternal && (ch.category || String(ch.title || '').includes('::tgstorage')));
      }
    } catch (err) {
      console.warn('[forwardModal] Error cargando canales tgstorage', err);
    }
  }

  if (tgStorageChannels.length === 0) {
    alert('No se encontraron canales de tgstorage disponibles en tu biblioteca para enviar el archivo.\nAsegúrate de tener canales creados que terminen en ::tgstorage (ej. Películas::tgstorage).');
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

  // Agrupar temporadas (solo para series, sin mutar películas)
  const seasonsMap = new Map();
  if (isSerie) {
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
          ${(() => {
            const preferredCh = isSerie
              ? (tgStorageChannels.find(c => c.category === 'Series') || tgStorageChannels[0])
              : (tgStorageChannels.find(c => c.category === 'Películas') || tgStorageChannels[0]);
            return tgStorageChannels.map(ch => {
              const isMatch = String(ch.id) === String(preferredCh?.id);
              return `<option value="${esc(ch.id)}" ${isMatch ? 'selected' : ''}>${isMatch ? '⭐ ' : ''}[${esc(ch.category || 'General')}] ${esc(ch.title || ch.name)}</option>`;
            }).join('');
          })()}
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
    const seriesInput = modalOverlay.querySelector('#target-seriesname-input');
    const sBaseName = seriesInput?.value?.trim() || uploadJobTitle || seriesBaseName;
    const filenameInput = modalOverlay.querySelector('#target-filename-input');
    const filename = filenameInput?.value?.trim() || defaultFilename;

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
                    workers: 1,
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
              workers: 1,
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
      const taskId = startUploadTask(`${isFastUpload ? '⚡ Subida rápida' : '🔄 Resubida completa'}: ${filename}`, `Conectando con canal destino "${targetChannelName}"…`, 15);
      setProgressBar(bar, {
        id: taskId,
        title: `${isFastUpload ? '⚡ Subida rápida' : '🔄 Resubida completa'}: ${filename}`,
        status: `Conectando con canal destino "${targetChannelName}"…`,
        percent: 15,
      });

      try {
        const curTargetFile = filesToSend[0] || file;
        const sourceCandidate = curTargetFile.channel || curTargetFile.channelId || effectiveTitle?.channel || effectiveTitle?.origen?.channelId || file.channel || file.channelId;
        const sourcePeer = await resolvePeer(client, tg, sourceCandidate);
        const targetPeer = await resolvePeer(client, tg, targetChannel || targetChannelId);

        const msgId = Number(curTargetFile.messageId || file.messageId);
        if (!msgId) throw new Error('ID de mensaje no válido para el archivo');

        const [msg] = await client.getMessages(sourcePeer, { ids: [msgId] });
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
                workers: 1,
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
            workers: 1,
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
        alert(`Error al enviar "${filename}" a tgstorage: ${err.message || String(err)}`);
      }
    }
  });
}
```

---

## Archivo: `src/ui/contextMenu.js`

```javascript
// src/ui/contextMenu.js
// Menú contextual nativo de PC (clic derecho) para archivos y fichas de vídeo:
// - Opción de descargar archivo (con barra de progreso)
// - Opción de mostrar y abrir en Telegram (enlace directo al mensaje)
// - Opción de reenviar o subida rápida a canal tgstorage con caption enriquecido y nombre editable

import { EXT_CHANNEL_TITLES_CACHE, hideExternalFiles, unhideExternalFiles, isExternalFileHiddenSync } from './externalTitlesCache.js';
import { isExternalTitle } from '../library/titles.js';
import { startUploadTask, updateUploadTask } from './uploadTasks.js';
import { extractTitleAndYear } from '../metadata/tmdb.js';
import { showMetadataModal } from './metadataModal.js';
import { createKV } from '../core/kv.js';
import { removeOverrides } from '../metadata/overrides.js';
import { showEditCaptionModal } from './editCaptionModal.js';
import { showForwardModal } from './forwardModal.js';

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

/**
 * Resuelve de forma robusta la entidad InputPeer de un canal o grupo de Telegram.
 */
async function resolvePeer(client, tg, target) {
  if (!target) throw new Error("Canal no especificado para resolver peer");
  if (target.className?.startsWith("InputPeer") || target._ === "inputPeerChannel" || target._ === "inputPeerChat") {
    return target;
  }
  if (target.entity) return target.entity;
  if (tg?.peerOf && typeof target === "object" && (target.accessHash || target.hash)) {
    try {
      const p = tg.peerOf(target);
      if (p) return p;
    } catch (_) {}
  }
  const rawId = String(typeof target === "object" ? (target.tgChannelId || target.channelId || target.id || "") : target).split("_top_")[0].trim();
  if (!rawId) throw new Error("ID de canal no válido");

  if (client?.getInputEntity) {
    try {
      return await client.getInputEntity(rawId);
    } catch (_) {
      try {
        const clean = rawId.replace(/^-100/, "").replace(/^-/, "");
        return await client.getInputEntity(`-100${clean}`);
      } catch (err) {
        if (tg?.peerOf) {
          const clean = rawId.replace(/^-100/, "").replace(/^-/, "");
          return tg.peerOf({ id: clean, accessHash: typeof target === "object" ? (target.accessHash || target.hash) : "0" });
        }
        throw new Error(`No se pudo resolver el canal en Telegram: ${err.message || String(err)}`);
      }
    }
  }
  throw new Error("Cliente Telegram no disponible para resolver el canal");
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
  const filename = file.fileName || file.captionFileName || file.label || `video_${file.messageId}.mp4`;
  const totalSize = Number(file.size) || 0;
  let writableStream = null;

  // Mostrar el selector nativo antes de iniciar la transferencia cuando el navegador lo admite.
  if (typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function') {
    try {
      const ext = (filename.match(/\.([a-zA-Z0-9]+)$/)?.[1] || 'mp4').toLowerCase();
      const mimeByExt = {
        mp4: 'video/mp4', m4v: 'video/mp4', mkv: 'video/x-matroska',
        avi: 'video/x-msvideo', mov: 'video/quicktime', webm: 'video/webm',
        mpeg: 'video/mpeg', mpg: 'video/mpeg', ts: 'video/mp2t',
      };
      const mime = file.mimeType || mimeByExt[ext] || 'application/octet-stream';
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: 'Archivo de vídeo', accept: { [mime]: [`.${ext}`] } }],
      });
      writableStream = await handle.createWritable();
    } catch (pickerErr) {
      if (pickerErr?.name === 'AbortError') return;
      console.warn('[contextMenu] No se pudo abrir el selector de destino', pickerErr);
      alert('No se pudo abrir el selector de destino. Comprueba los permisos del navegador e inténtalo de nuevo.');
      return;
    }
  }

  const bar = ensureProgressBar();
  const taskId = startUploadTask(`Descargando: ${filename}`, 'Conectando con Telegram…', 0);
  setProgressBar(bar, {
    id: taskId,
    title: `Descargando: ${filename}`,
    status: `Conectando con Telegram… (${formatBytes(totalSize)})`,
    percent: 0,
  });

  try {
    const peer = await resolvePeer(client, tg, file.channel || file.channelId);
    const [msg] = await client.getMessages(peer, { ids: [file.messageId] });
    if (!msg || !msg.media) throw new Error('No se encontró el mensaje o archivo en Telegram');

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

    if (writableStream) {
      await writableStream.write(bytes);
      await writableStream.close();
    } else {
      const doc = msg.document || msg.media?.document;
      const blob = new Blob([bytes], { type: doc?.mimeType || 'video/mp4' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1000);
    }

    const savedBytes = Number(bytes?.byteLength || bytes?.length || totalSize) || 0;
    setProgressBar(bar, {
      id: taskId,
      title: `Descarga completada: ${filename}`,
      status: `Guardado en tu equipo (${formatBytes(savedBytes)})`,
      percent: 100,
      done: true,
    });
  } catch (err) {
    if (writableStream) {
      try { await writableStream.abort(); } catch (_) {}
    }
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
 * Abre el mensaje correspondiente en Telegram Web / Desktop vía enlace tg://
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
 * Extrae el año de los metadatos TMDB o del archivo con múltiples estrategias.
 */
function extractYear(titleData, file) {
  if (titleData?.metadata?.year) return String(titleData.metadata.year);
  if (titleData?.metadata?.date) {
    const m = String(titleData.metadata.date).match(/\b((?:19|20)\d{2})\b/);
    if (m) return m[1];
  }
  if (titleData?.metadata?.release_date) {
    const m = String(titleData.metadata.release_date).match(/\b((?:19|20)\d{2})\b/);
    if (m) return m[1];
  }
  if (titleData?.yearHint) return String(titleData.yearHint);
  if (file?.yearHint) return String(file.yearHint);
  const cand = [file?.captionFileName, file?.fileName, file?.rawCaption, titleData?.nombre].filter(Boolean).join(' ');
  const m = cand.match(/\b((?:19|20)\d{2})\b/);
  return m ? m[1] : null;
}

/**
 * Helper para detectar temporada y episodio de un string de forma segura.
 */
function parseEpisodeHelper(name = '') {
  let m = name.match(/[ST](\d{1,2})[\s._-]*E(\d{1,3})/i);
  if (m) return { season: +m[1], episode: +m[2] };
  m = name.match(/(\d{1,2})\s*x\s*(\d{1,3})/i);
  if (m) return { season: +m[1], episode: +m[2] };
  m = name.match(/T(?:emp(?:orada)?)?[\s._-]*(\d{1,2})[\s._-]+(?:ep|cap(?:[ií]tulo)?)[\s._-]*(\d{1,3})/i);
  if (m) return { season: +m[1], episode: +m[2] };
  m = name.match(/(?:ep(?:isodio)?|cap(?:[ií]tulo)?)[\s._-]*(\d{1,3})/i);
  if (m) return { season: 1, episode: +m[1] };
  return { season: 0, episode: 0 };
}

/**
 * Genera el nombre estándar sugerido para el archivo según si es película o serie.
 * - Película: [Nombre de Película] ([año]).ext
 * - Serie: [Nombre de la Serie] - [temporada]x[número de episodio].ext
 */
function isSeriesTitle(titleData, file) {
  const channelCat = String(titleData?.channel?.category || file?.channel?.category || '').trim();
  const isMovieCat = /^pel[ií]culas?$/i.test(channelCat) || /^documental(es)?$/i.test(channelCat);
  if (isMovieCat) return false;
  if (titleData?.tipo === 'pelicula' || titleData?.tipo === 'documental') return false;
  const isSeriesCat = /^series?$/i.test(channelCat);
  if (isSeriesCat || titleData?.tipo === 'serie') return true;
  if (titleData?.metadata?.tipo === 'tv' || titleData?.metadata?.type === 'tv') return true;
  if (file?.season > 0 && file?.episode > 0) return true;
  return false;
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

  // Película o documental: priorizar título/nombre de los metadatos TMDB identificados
  let mName = titleData?.metadata?.title || titleData?.metadata?.name || file?.metadata?.title || file?.metadata?.name || titleData?.nombre;
  let year = extractYear(titleData, file);

  if (!mName) {
    mName = cleanBase.replace(/\s*AÑO\s*\d{4}/i, '').replace(/\b((?:19|20)\d{2})\b/g, '').trim();
  } else if (year) {
    mName = mName.replace(new RegExp(`\\s*[\\(\\[]?${year}[\\)\\]]?\\s*$`, "i"), "").trim();

  }

  if (year) {
    return `${mName} (${year})${ext}`;
  }
  return `${mName}${ext}`;
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
    const cardEl = e.target.closest('.lib-card, .carousel-item');
    const adminRow = e.target.closest('.admin-video-row');
    const detailEl = e.target.closest('.detail');

    if (!epEl && !cardEl && !adminRow && !detailEl) return;

    let targetFile = null;
    let targetTitle = null;
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
          targetTitle = t;
          titleName = t.nombre;
          break;
        }
      }
      if (!targetFile) {
        const dEl = document.querySelector('.detail');
        const detailTitleId = dEl?.dataset?.title;
        const dt = allTitles.find(x => String(x.id) === String(detailTitleId)) || dEl?._titleData;
        if (dt) {
          const found = dt.archivos?.find(f => f.key === key || String(f.messageId) === String(epEl.dataset.messageId));
          if (found) {
            targetFile = found;
            targetTitle = dt;
            titleName = dt.nombre;
          }
        }
      }
    } else if (cardEl) {
      const titleId = cardEl.dataset.title;
      let t = (titleId ? allTitles.find(x => String(x.id) === String(titleId)) : null) || cardEl._titleData;
      if (!t && titleId) {
        t = allTitles.find(x => x.archivos?.some(f => f.key === titleId || `${f.channelId || f.channel?.id}:${f.messageId}` === titleId || String(f.messageId) === String(titleId)));
      }
      if (!t && titleId && String(titleId).includes(':')) {
        const parts = String(titleId).split(':');
        const mId = parts[parts.length - 1];
        t = allTitles.find(x => x.archivos?.some(f => String(f.messageId) === String(mId)));
      }
      if (t && t.archivos && t.archivos.length > 0) {
        // En tarjetas tomamos el primer archivo (o película principal)
        targetFile = t.archivos[0];
        targetTitle = t;
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
            targetTitle = t;
            titleName = t.nombre;
            break;
          }
        }
      }
    } else if (detailEl) {
      const detailTitleId = detailEl?.dataset?.title;
      const dt = allTitles.find(x => String(x.id) === String(detailTitleId)) || detailEl?._titleData;
      if (dt && dt.archivos && dt.archivos.length > 0) {
        targetFile = dt.archivos[0];
        targetTitle = dt;
        titleName = dt.nombre;
      }
    }

    if (targetFile && targetTitle) {
      if (!targetFile.channel && targetTitle.channel) targetFile.channel = targetTitle.channel;
      if (!targetFile.channelId) targetFile.channelId = targetTitle.channel?.id || targetTitle.origen?.channelId;
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

    const isExt = isExternalTitle(targetTitle) || Boolean(targetFile.channel?.isExternal) || Boolean(targetTitle?.isExternal) || Boolean(targetTitle?._isExternalContext) || Boolean(targetFile.channelId && String(targetFile.channelId).startsWith('ext-'));
    const allMovieFiles = (targetTitle?.archivos && targetTitle.archivos.length > 0) ? targetTitle.archivos : [targetFile];
    const isMovie = targetTitle?.tipo === 'pelicula' || (!targetTitle?.tipo && !targetTitle?.isSaga && !targetFile.season);
    const hasMultipleVersions = isMovie && allMovieFiles.length > 1;
    const isEpClick = Boolean(epEl);

    menu.innerHTML = `
      <div style="padding: 0.5rem 0.9rem 0.4rem; border-bottom: 1px solid rgba(255,255,255,0.1); font-size: 0.8rem; color: #94a3b8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
        <strong style="color: #e2e8f0; display: block; overflow: hidden; text-overflow: ellipsis;">${esc(displayName)}</strong>
        <span>${esc(sizeStr)}</span>
      </div>
      <div class="pc-menu-item" id="pc-menu-forward" style="display: flex; align-items: center; gap: 0.6rem; padding: 0.6rem 0.9rem; cursor: pointer; font-size: 0.9rem; transition: background 0.15s;">
        <span style="font-size: 1.1rem;">⚡</span>
        <span>${targetTitle?.tipo === 'serie' && (targetTitle?.archivos?.length || 1) > 1 ? 'Enviar serie completa / episodio a tgstorage' : 'Enviar / Subir archivo a canal tgstorage'}</span>
      </div>
      <div class="pc-menu-item" id="pc-menu-identify" style="display: flex; align-items: center; gap: 0.6rem; padding: 0.6rem 0.9rem; cursor: pointer; font-size: 0.9rem; transition: background 0.15s;">
        <span style="font-size: 1.1rem; color: #c084fc;">✨</span>
        <span>Identificar / Corregir en TMDB</span>
      </div>
      <div class="pc-menu-item" id="pc-menu-clear-meta" style="display: flex; align-items: center; gap: 0.6rem; padding: 0.6rem 0.9rem; cursor: pointer; font-size: 0.9rem; transition: background 0.15s; color: #fca5a5;">
        <span style="font-size: 1.1rem;">🗑️</span>
        <span>Borrar identificación guardada</span>
      </div>
      ${(() => {
        if (isEpClick) {
          const isSeries = targetTitle?.tipo === 'serie';
          const singleLabel = isSeries ? 'Editar caption/datos de este episodio' : 'Editar caption/datos de esta versión';
          let html = `
            <div class="pc-menu-item" id="pc-menu-edit-caption-single" style="display: flex; align-items: center; gap: 0.6rem; padding: 0.6rem 0.9rem; cursor: pointer; font-size: 0.9rem; transition: background 0.15s; color: #38bdf8;">
              <span style="font-size: 1.1rem;">📝</span>
              <span>${singleLabel}</span>
            </div>
          `;
          if (allMovieFiles.length > 1) {
            const commonLabel = isSeries ? 'Editar datos comunes de la serie' : 'Editar datos comunes (todas las versiones)';
            html += `
              <div class="pc-menu-item" id="pc-menu-edit-caption-common" style="display: flex; align-items: center; gap: 0.6rem; padding: 0.6rem 0.9rem; cursor: pointer; font-size: 0.9rem; transition: background 0.15s; color: #7dd3fc;">
                <span style="font-size: 1.1rem;">📋</span>
                <span>${commonLabel}</span>
              </div>
            `;
          }
          return html;
        } else {
          if (allMovieFiles.length > 1) {
            const isSeries = targetTitle?.tipo === 'serie';
            const commonLabel = isSeries
              ? `Editar datos comunes de la serie (${allMovieFiles.length} eps)`
              : `Editar datos comunes (${allMovieFiles.length} versiones)`;
            return `
              <div class="pc-menu-item" id="pc-menu-edit-caption-common" style="display: flex; align-items: center; gap: 0.6rem; padding: 0.6rem 0.9rem; cursor: pointer; font-size: 0.9rem; transition: background 0.15s; color: #38bdf8;">
                <span style="font-size: 1.1rem;">📝</span>
                <span>${commonLabel}</span>
              </div>
            `;
          } else {
            return `
              <div class="pc-menu-item" id="pc-menu-edit-caption-single" style="display: flex; align-items: center; gap: 0.6rem; padding: 0.6rem 0.9rem; cursor: pointer; font-size: 0.9rem; transition: background 0.15s; color: #38bdf8;">
                <span style="font-size: 1.1rem;">📝</span>
                <span>Editar caption/datos Telegram</span>
              </div>
            `;
          }
        }
      })()}
      <div class="pc-menu-item" id="pc-menu-download" style="display: flex; align-items: center; gap: 0.6rem; padding: 0.6rem 0.9rem; cursor: pointer; font-size: 0.9rem; transition: background 0.15s;">
        <span style="font-size: 1.1rem;">⬇️</span>
        <span>Descargar archivo</span>
      </div>
      <div class="pc-menu-item" id="pc-menu-telegram" style="display: flex; align-items: center; gap: 0.6rem; padding: 0.6rem 0.9rem; cursor: pointer; font-size: 0.9rem; transition: background 0.15s;">
        <span style="font-size: 1.1rem;">✈️</span>
        <span>Mostrar en Telegram</span>
      </div>
      ${isExt ? (() => {
        if (hasMultipleVersions && isEpClick) {
          const hidden = isExternalFileHiddenSync(targetFile);
          const allHidden = allMovieFiles.every(f => isExternalFileHiddenSync(f));
          return `
            <div class="pc-menu-item" id="pc-menu-toggle-hidden-single" style="display:flex;align-items:center;gap:.6rem;padding:.6rem .9rem;cursor:pointer;font-size:.9rem;color:${hidden ? '#86efac' : '#fca5a5'};">
              <span style="font-size:1.1rem;">${hidden ? '👁️' : '🙈'}</span>
              <span>${hidden ? 'Mostrar esta versión' : 'Ocultar solo esta versión'}</span>
            </div>
            <div class="pc-menu-item" id="pc-menu-toggle-hidden-all" style="display:flex;align-items:center;gap:.6rem;padding:.6rem .9rem;cursor:pointer;font-size:.9rem;color:${allHidden ? '#86efac' : '#f87171'};border-top:1px solid rgba(255,255,255,.08);">
              <span style="font-size:1.1rem;">${allHidden ? '👁️' : '🙈'}</span>
              <span>${allHidden ? 'Mostrar película completa' : 'Ocultar película completa'}</span>
            </div>
          `;
        }
        if (hasMultipleVersions) {
          const allHidden = allMovieFiles.every(f => isExternalFileHiddenSync(f));
          return `
            <div class="pc-menu-item" id="pc-menu-toggle-hidden-all" style="display:flex;align-items:center;gap:.6rem;padding:.6rem .9rem;cursor:pointer;font-size:.9rem;color:${allHidden ? '#86efac' : '#fca5a5'};">
              <span style="font-size:1.1rem;">${allHidden ? '👁️' : '🙈'}</span>
              <span>${allHidden ? 'Mostrar película completa' : 'Ocultar película completa'}</span>
            </div>
            <div style="padding:.35rem .9rem .2rem;font-size:.72rem;text-transform:uppercase;color:#94a3b8;font-weight:700;border-top:1px solid rgba(255,255,255,.08);margin-top:.25rem;">Ocultar solo una versión:</div>
            ${allMovieFiles.map((f, index) => {
              const hidden = isExternalFileHiddenSync(f);
              const label = f.label || f.fileName || `Versión ${index + 1}`;
              return `<div class="pc-menu-item pc-menu-toggle-version-item" data-msg-id="${esc(f.messageId)}" data-version-index="${index}" style="display:flex;align-items:center;gap:.5rem;padding:.45rem .9rem;cursor:pointer;font-size:.84rem;color:${hidden ? '#86efac' : '#cbd5e1'};"><span>${hidden ? '👁️' : '🙈'}</span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${hidden ? 'Mostrar' : 'Ocultar'} ${esc(label)}</span></div>`;
            }).join('')}
          `;
        }
        const targetFiles = allMovieFiles;
        const fullyHidden = targetFiles.every(f => isExternalFileHiddenSync(f));
        const isSeries = targetTitle?.tipo === 'serie' || targetFiles.length > 1;
        const labelText = fullyHidden
          ? (isSeries ? 'Mostrar serie oculta' : 'Mostrar archivo oculto')
          : (isSeries ? 'Ocultar serie ya gestionada' : 'Ocultar archivo ya gestionado');
        return `<div class="pc-menu-item" id="pc-menu-toggle-hidden-all" style="display:flex;align-items:center;gap:.6rem;padding:.6rem .9rem;cursor:pointer;font-size:.9rem;color:${fullyHidden ? '#86efac' : '#fca5a5'};"><span style="font-size:1.1rem;">${fullyHidden ? '👁️' : '🙈'}</span><span>${labelText}</span></div>`;
      })() : ''}
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
      const currentTg = currentConfig.tg || (typeof window !== 'undefined' ? window.tg : null);
      const currentClient = currentConfig.client || currentTg?.getClient?.() || (typeof window !== 'undefined' && window.tg?.getClient?.());
      showForwardModal(currentClient, currentTg, targetFile, currentConfig.getChannels, targetTitle, currentConfig.getTitles).catch(err => {
        console.error('[contextMenu] Error en showForwardModal:', err);
        alert('Error al abrir envío a tgstorage: ' + (err.message || String(err)));
      });
    });

    menu.querySelector('#pc-menu-identify')?.addEventListener('click', (ev) => {
      ev.stopPropagation();
      removeActiveMenu();
      const currentConfig = activeContextConfig || {};
      const currentTg = currentConfig.tg;
      const currentClient = currentConfig.client || currentTg?.getClient?.();
      const currentSync = currentConfig.sync || window.sync;
      const currentProfile = currentConfig.profile;

      showMetadataModal(targetTitle, (updatedMeta) => {
        targetTitle.metadata = updatedMeta;
        targetTitle.nombre = updatedMeta.name || updatedMeta.title || targetTitle.nombre;
        if (targetTitle.archivos && !targetTitle.isSaga) {
          for (const f of targetTitle.archivos) {
            f.metadata = updatedMeta;
            f.tmdbId = updatedMeta.id;
          }
        }
        const cardEl = document.querySelector(`.lib-card[data-title="${esc(targetTitle.id)}"]`);
        if (cardEl) {
          cardEl._titleData = targetTitle;
          const nameEl = cardEl.querySelector(".lib-card-name");
          if (nameEl) nameEl.textContent = updatedMeta.name || updatedMeta.title || targetTitle.nombre;
          const posterEl = cardEl.querySelector(".lib-card-poster");
          const posterUrl = updatedMeta.poster;
          if (posterEl && posterUrl) {
            posterEl.classList.add("has-poster");
            let img = posterEl.querySelector("img.poster-image");
            if (!img) {
              img = document.createElement("img");
              img.className = "poster-image";
              img.alt = updatedMeta.name || updatedMeta.title || "";
              posterEl.prepend(img);
            }
            img.src = posterUrl;
          }
        }
      }, {
        client: currentClient,
        peerOf: currentTg?.peerOf,
        profile: currentProfile,
        sync: currentSync,
      });
    });

    menu.querySelector('#pc-menu-edit-caption-single')?.addEventListener('click', (ev) => {
      ev.stopPropagation();
      removeActiveMenu();
      const currentConfig = activeContextConfig || {};
      const currentTg = currentConfig.tg;
      const currentClient = currentConfig.client || currentTg?.getClient?.();

      showEditCaptionModal({
        title: targetTitle,
        targetFile,
        allFiles: allMovieFiles,
        initialCommonMode: false,
        client: currentClient,
        tg: currentTg,
        onUpdated: (updatedTitle, updatedFiles) => {
          const cEl = document.querySelector(`.lib-card[data-title="${esc(updatedTitle?.id)}"]`);
          if (cEl && updatedTitle) cEl._titleData = updatedTitle;
        },
      });
    });

    menu.querySelector('#pc-menu-edit-caption-common')?.addEventListener('click', (ev) => {
      ev.stopPropagation();
      removeActiveMenu();
      const currentConfig = activeContextConfig || {};
      const currentTg = currentConfig.tg;
      const currentClient = currentConfig.client || currentTg?.getClient?.();

      showEditCaptionModal({
        title: targetTitle,
        targetFile: null,
        allFiles: allMovieFiles,
        initialCommonMode: true,
        client: currentClient,
        tg: currentTg,
        onUpdated: (updatedTitle, updatedFiles) => {
          const cEl = document.querySelector(`.lib-card[data-title="${esc(updatedTitle?.id)}"]`);
          if (cEl && updatedTitle) cEl._titleData = updatedTitle;
        },
      });
    });

    menu.querySelector('#pc-menu-clear-meta')?.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      removeActiveMenu();

      const currentConfig = activeContextConfig || {};
      const currentTg = currentConfig.tg;
      const currentSync = currentConfig.sync || window.sync;
      const kv = createKV();

      const titleDisplayName = targetTitle?.nombre || displayName;
      if (!confirm(`¿Borrar la identificación guardada de "${titleDisplayName}" tanto de la caché local como del archivo JSON de Telegram?`)) {
        return;
      }

      try {
        const titleId = String(targetTitle?.id || '');
        const channelId = String(targetTitle?.channel?.id || targetFile?.channelId || '');
        const rawChannelId = channelId.replace(/^ext-/, '');
        const extChannelId = rawChannelId ? `ext-${rawChannelId}` : '';

        const keysToDelete = new Set([
          titleId,
          titleId.replace(/^ext-/, ''),
          channelId,
          rawChannelId,
          extChannelId,
        ].filter(Boolean));

        const targetFiles = (targetTitle?.archivos && targetTitle.archivos.length > 0) ? targetTitle.archivos : [targetFile];

        for (const f of targetFiles) {
          if (f.key) keysToDelete.add(String(f.key));
          if (f.messageId) {
            if (channelId) keysToDelete.add(`${channelId}:${f.messageId}`);
            if (rawChannelId) keysToDelete.add(`${rawChannelId}:${f.messageId}`);
            if (extChannelId) keysToDelete.add(`${extChannelId}:${f.messageId}`);
            if (titleId) keysToDelete.add(`${titleId}:${f.messageId}`);
          }
        }

        // 1. Borrar de overrides sincronizados (memoria, IndexedDB y push inmediato a Telegram JSON)
        await removeOverrides(Array.from(keysToDelete), currentSync);

        // 2. Borrar de manual_tmdb:* en IndexedDB
        for (const k of keysToDelete) {
          await kv.del(`manual_tmdb:${k}`).catch(() => {});
        }

        // 3. Borrar de library_v2 metadataMap y limpiar tmdbId de los archivos cacheados
        const lib = await kv.get('library_v2').catch(() => null);
        if (lib) {
          if (lib.metadataMap) {
            for (const k of keysToDelete) {
              delete lib.metadataMap[k];
            }
          }
          if (lib.cache) {
            const chKeys = [channelId, rawChannelId, titleId].filter(Boolean);
            for (const ck of chKeys) {
              if (lib.cache[ck]?.files) {
                for (const f of lib.cache[ck].files) {
                  f.metadata = null;
                  f.tmdbId = null;
                }
              }
            }
          }
          await kv.set('library_v2', lib).catch(() => {});
        }

        // 4. Borrar de la caché de TMDB si hay tmdbId o query
        if (targetTitle?.tmdbId) {
          await kv.del(`tmdb_v2:tv:${targetTitle.tmdbId}`).catch(() => {});
          await kv.del(`tmdb_v2:movie:${targetTitle.tmdbId}`).catch(() => {});
        }
        if (targetTitle?.nombre) {
          const parsed = extractTitleAndYear(targetTitle.nombre);
          const q = (parsed.title || '').toLowerCase();
          const y = targetTitle.yearHint || parsed.year || '';
          if (q) {
            await kv.del(`tmdb_v2:tv:${q}:${y}`).catch(() => {});
            await kv.del(`tmdb_v2:movie:${q}:${y}`).catch(() => {});
            await kv.del(`tmdb_v2:tv:${q}:`).catch(() => {});
            await kv.del(`tmdb_v2:movie:${q}:`).catch(() => {});
          }
        }

        // 5. Limpiar en memoria el título y sus archivos
        if (targetTitle) {
          targetTitle.metadata = null;
          targetTitle.tmdbId = null;
          targetTitle._origImages = {};
          if (targetTitle.channel?.name) {
            targetTitle.nombre = targetTitle.channel.name;
          }
        }

        for (const f of targetFiles) {
          f.metadata = null;
          f.tmdbId = null;
        }

        // 6. Si es canal externo, limpiar también ext_files_{id} en IndexedDB
        if (channelId || rawChannelId) {
          const extKeys = new Set([`ext_files_${channelId}`, `ext_files_${rawChannelId}`, `ext_files_${extChannelId}`].filter(Boolean));
          const targetMsgIds = new Set(targetFiles.map(f => String(f.messageId)));
          for (const extKey of extKeys) {
            const cachedList = await kv.get(extKey).catch(() => null);
            if (Array.isArray(cachedList) && cachedList.length > 0) {
              let changed = false;
              for (const f of cachedList) {
                if (targetMsgIds.has(String(f.messageId))) {
                  f.metadata = null;
                  f.tmdbId = null;
                  changed = true;
                }
              }
              if (changed) {
                await kv.set(extKey, cachedList).catch(() => {});
              }
            }
          }
        }

        // 7. Actualizar la tarjeta visual en el DOM
        const cardEl = document.querySelector(`.lib-card[data-title="${esc(targetTitle?.id)}"]`);
        if (cardEl) {
          cardEl._titleData = targetTitle;
          const nameEl = cardEl.querySelector('.lib-card-name');
          if (nameEl) nameEl.textContent = targetTitle?.nombre || displayName;
          const posterEl = cardEl.querySelector('.lib-card-poster');
          if (posterEl) {
            posterEl.classList.remove('has-poster');
            const img = posterEl.querySelector('img.poster-image');
            if (img) img.remove();
          }
        }

        // 8. Disparar eventos globales para refrescar vistas
        window.dispatchEvent(new CustomEvent('tgvideo:external-hidden-changed', {
          detail: { channelId, messageId: targetFile?.messageId, titleId: targetTitle?.id },
        }));
        window.dispatchEvent(new CustomEvent('tgvideo:metadata-cleared', {
          detail: { titleId: targetTitle?.id, channelId },
        }));

        alert('Identificación guardada eliminada con éxito de la caché local y de Telegram.');
      } catch (err) {
        console.error('[contextMenu] Error borrando identificación', err);
        alert(`Error al borrar identificación: ${err?.message || err}`);
      }
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

    const toggleExternalFiles = async (files) => {
      const isFullyHidden = files.every(f => isExternalFileHiddenSync(f));
      if (isFullyHidden) await unhideExternalFiles(files);
      else await hideExternalFiles(files);
      window.dispatchEvent(new CustomEvent('tgvideo:external-hidden-changed', {
        detail: {
          channelId: targetFile.channelId || targetFile.channel?.id,
          messageId: targetFile.messageId,
          titleId: targetTitle?.id,
        },
      }));
    };

    menu.querySelector('#pc-menu-toggle-hidden-single')?.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      removeActiveMenu();
      try { await toggleExternalFiles([targetFile]); }
      catch (err) {
        console.error('[contextMenu] Error al cambiar visibilidad de versión', err);
        alert(`No se pudo actualizar la visibilidad: ${err?.message || err}`);
      }
    });

    menu.querySelector('#pc-menu-toggle-hidden-all')?.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      removeActiveMenu();
      try { await toggleExternalFiles(allMovieFiles); }
      catch (err) {
        console.error('[contextMenu] Error al cambiar visibilidad del archivo externo', err);
        alert(`No se pudo actualizar la visibilidad: ${err?.message || err}`);
      }
    });

    menu.querySelectorAll('.pc-menu-toggle-version-item').forEach((item) => {
      item.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        removeActiveMenu();
        const index = Number(item.dataset.versionIndex);
        const file = allMovieFiles[index];
        if (!file) return;
        try { await toggleExternalFiles([file]); }
        catch (err) {
          console.error('[contextMenu] Error al cambiar visibilidad de versión', err);
          alert(`No se pudo actualizar la visibilidad: ${err?.message || err}`);
        }
      });
    });

    activeMenuEl = menu;
  });
}

```

---

## Archivo: `src/library/channels.js`

```javascript
/**
 * Descubrimiento y listado de canales de vídeo (tgstorage).
 * Categorías soportadas: Series, Películas, Deportes, Música
 */

import { Api } from 'telegram';

const SEP_RE = /\s*::\s*/;
const TSEP = ':';
const TGSTORAGE_SUFFIX_RE = /\s*::\s*tgstorage\s*$/i;
const VALID_CATEGORIES = ['series', 'películas', 'peliculas', 'movies', 'tv', 'deportes', 'sport', 'sports', 'música', 'musica', 'music'];

function normalizeCategory(cat) {
  const c = String(cat || '').toLowerCase().trim();
  if (c === 'peliculas' || c === 'movies') return 'Películas';
  if (c === 'series' || c === 'tv') return 'Series';
  if (['deportes', 'sport', 'sports'].includes(c)) return 'Deportes';
  if (['música', 'musica', 'music'].includes(c)) return 'Música';
  return cat || '';
}

/**
 * Parsea el título de un canal Telegram según la convención tgstorage.
 * Soporta espacios variables, mayúsculas/minúsculas y chats/canales.
 * Ejemplos:
 *   1988:Por año::Películas::tgstorage
 *   Puñales por la espalda:Sagas::Películas::tgstorage
 *   Green Lantern:HBO::Series::tgstorage
 *   HBO::Series::tgstorage
 *   2000-2010::Películas::tgstorage
 */
export function parseChannelTitle(title) {
  if (!title) return null;
  const rawTitle = String(title).trim();
  if (!TGSTORAGE_SUFFIX_RE.test(rawTitle)) return null;

  const body = rawTitle.replace(TGSTORAGE_SUFFIX_RE, '').trim();
  const parts = body.split(SEP_RE);
  if (parts.length === 0) return null;

  let category = '';
  let head = '';
  if (parts.length === 1) {
    category = normalizeCategory(parts[0]);
    head = category;
  } else {
    category = normalizeCategory(parts[parts.length - 1]);
    head = parts.slice(0, -1).join('::');
  }

  if (!VALID_CATEGORIES.includes(category.toLowerCase()) &&
      !['Series', 'Películas', 'Deportes', 'Música'].includes(category)) {
    return null;
  }

  // Macro o Contenedor directo sin TSEP: Grupo::Categoría::tgstorage (ej. HBO::Series::tgstorage)
  if (!head.includes(TSEP)) {
    const trimmedHead = head.trim();
    const isYear = /^(por a[ñn]o|a[ñn]os|d[ée]cadas|por d[ée]cada)s?$/i.test(trimmedHead) ||
                   /^\d{4}(s|[-–]\d{4})?$/.test(trimmedHead);
    return {
      name: trimmedHead,
      group: trimmedHead,
      category,
      macro: !isYear,
      isYearContainer: category === 'Películas' && isYear,
      isSaga: false,
    };
  }

  // Dedicado o clasificado: Nombre:Grupo::Categoría::tgstorage
  const colonIdx = head.indexOf(TSEP);
  const name = head.slice(0, colonIdx).trim();
  const group = head.slice(colonIdx + 1).trim();
  const trimmedName = name || '';
  const trimmedGroup = group || 'Sin grupo';

  // Contenedores por año (ej: 1988:Por año::Películas::tgstorage)
  const isYearContainer = category === 'Películas' && (
    /^(por a[ñn]o|a[ñn]os|d[ée]cadas|por d[ée]cada)s?$/i.test(trimmedGroup) ||
    /^\d{4}(s|[-–]\d{4})?$/.test(trimmedName)
  );

  // Sagas / Colecciones (ej: Puñales por la espalda:Sagas::Películas::tgstorage)
  const isSaga = category === 'Películas' && (
    /^(sagas?|colecci[oó]n|colecciones|franquicias?)$/i.test(trimmedGroup)
  );

  return {
    name: trimmedName,
    group: trimmedGroup,
    category,
    macro: false,
    isYearContainer,
    isSaga,
  };
}

/**
 * Escanea los diálogos del usuario y devuelve los canales de vídeo.
 */
export async function loadLibrary(client) {
  const found = new Map();

  const add = (entity, top = 0) => {
    if (!entity) return;
    // Soporte tanto para canales broadcast ('Channel') como grupos privados ('Chat' o supergrupos)
    if (entity.className !== 'Channel' && entity.className !== 'Chat') return;
    const info = parseChannelTitle(entity.title || '');
    if (!info) return;

    found.set(String(entity.id), {
      id: String(entity.id),
      hash: String(entity.accessHash || ''),
      name: info.name,
      group: info.group,
      category: info.category,
      macro: !!info.macro,
      isYearContainer: !!info.isYearContainer,
      isSaga: !!info.isSaga,
      title: entity.title,
      // id del último mensaje: si cambia, el canal se ha modificado
      top: top || found.get(String(entity.id))?.top || 0,
    });
  };

  // Búsqueda por el sufijo
  try {
    const res = await client.invoke(
      new Api.contacts.Search({ q: 'tgstorage', limit: 100 })
    );
    (res.chats || []).forEach(add);
  } catch (e) {
    console.warn('[library] search failed', e);
  }

  // Recorrer diálogos activos
  try {
    for await (const dialog of client.iterDialogs({})) {
      add(dialog.entity, dialog.message?.id || 0);
    }
  } catch (e) {
    console.warn('[library] active dialogs scan failed', e);
  }

  // Recorrer diálogos archivados para no ignorar canales organizados en carpetas archivadas
  try {
    for await (const dialog of client.iterDialogs({ archived: true })) {
      add(dialog.entity, dialog.message?.id || 0);
    }
  } catch (e) {
    console.warn('[library] archived dialogs scan failed', e);
  }

  const list = [...found.values()];

  // Ordenar: primero por categoría, luego por grupo, luego por nombre
  list.sort((a, b) => {
    const c = a.category.localeCompare(b.category);
    if (c !== 0) return c;
    const g = a.group.localeCompare(b.group);
    if (g !== 0) return g;
    return a.name.localeCompare(b.name);
  });

  return list;
}

/**
 * Agrupa la biblioteca por categoría → grupo.
 */
export function groupLibrary(lib) {
  const byCat = new Map();

  for (const ch of lib) {
    const cat = ch.category || 'Otros';
    if (!byCat.has(cat)) byCat.set(cat, new Map());
    const byGroup = byCat.get(cat);
    const group = ch.group || 'Sin grupo';
    if (!byGroup.has(group)) byGroup.set(group, []);
    byGroup.get(group).push(ch);
  }

  return byCat;
}

```

---

## Archivo: `src/main.js`

```javascript
import { checkForUpdate } from './core/updateCheck.js';
import { initContextMenu } from './ui/contextMenu.js';
// Suprimir alerts intrusivos de GramJS (ej. TypeNotFoundError ID 0)
if (typeof window !== 'undefined') {
  const _origAlert = window.alert;
  window.alert = function (msg, ...args) {
    const text = String(msg || '');
    if (text.includes('Missing MTProto Entity') || text.includes('TL definition')) {
      console.warn('[GramJS alert interceptado en main]:', text);
      return;
    }
    return _origAlert ? _origAlert.apply(this, [msg, ...args]) : undefined;
  };
}

let LAST_OPENED_TITLE_ID = null;
import { searchViewHtml, mountSearchView } from './ui/searchView.js';
import './style.css';
import { createTelegramClient } from './core/telegram.js';
import { createTelegramSync } from './sync/telegramSync.js';
import { loadLibrary } from './library/channels.js';
import { buildTitles, mergeMoviesByTmdb, attachAutoCollections } from './library/titles.js';
import { buildHomeRows, posterColor } from './ui/home.js';
import { getNewsPrefs } from './library/newsPrefs.js';
import { initDpad, setBackHandler, focusFirst, focusInRow } from './ui/dpad.js';
import { loadProgress, loadFavorites, saveFavorites, mergeFavorites, writeFullProgress, titleState, isFavorite, toggleFavorite, toggleAllWatched } from './player/progress.js';
import { playFile } from './player/player.js';
import { createKV } from './core/kv.js';
import { enrichTitles, enrichTitle, fetchSeasonEpisodes } from './metadata/tmdb.js';
import { loadPoster, prewarmPosterCache, memoryCache } from './metadata/posterCache.js';
import { prettyEpisodeName } from './library/parse.js';
import { showMetadataModal } from './ui/metadataModal.js';
import { pickAvatar } from './ui/avatarCarousel.js';
import { showImagePicker } from './ui/imagePickerModal.js';
import { getAutoLogo } from './metadata/autoLogo.js';
import { applyImagePrefs, restoreOriginalImage, pullAndMergeImagePrefs, metadataForPersist } from './metadata/imagePrefs.js';
import { hookConsole, isDevLogEnabled, startDevLogging } from './utils/devLogger.js';
import { loadGlobalConfig } from './settings/global.js';
import { loadOverrides, getOverride, getOverrideByTmdbId } from './metadata/overrides.js';
import { showProfileMenu, profileAvatar, applyProfileScale, modal } from './ui/settings.js';
import { showAdminView } from './ui/adminView.js';
import { renderExternalsView } from './ui/externalsView.js';
import { resolveTitleAgeRating } from './ui/ageRating.js';
import { adjacentSeason, firstUncompleted, centerSeason } from './ui/seasons.js';
import { mountCarousel, destroyCarousel } from './ui/carouselView.js';
import { createLibraryViews } from './ui/libraryViews.js';
import { setupTvPlatform, isAndroidApp } from './core/platform.js';

setupTvPlatform();

const kv = createKV();
const LIB_KEY = 'library_v2';
// Pestaña "Externos" oculta temporalmente (planteamiento en revisión).
const SHOW_EXTERNALS_SECTION = true;
// Caché del procesado de títulos para cambios de pestaña rápidos (sin recalcular overrides/colecciones).
let HOME_PROCESSED = { ref: null, profileId: null };
// Títulos ya enviados a identificación TMDB en esta sesión (evita relanzar búsquedas en cada pestaña).
const TMDB_ATTEMPTED = new Set();
let BG_ENRICH = null;
const perfNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const perfLog = (msg) => console.log(`[perf] ${msg}`);

const app = document.getElementById('app');


function isTitleAllowedByProfileAge(title, profile) {
  const limit = profile?.maxAgeRating;
  if (!limit || limit === 'all' || limit === 'sin-limite') return true;
  const info = resolveTitleAgeRating(title);
  if (!info) return true;
  const label = String(info.label).toUpperCase();
  if (limit === '18') return label !== 'X';
  if (limit === '16') return label !== 'X' && label !== '18';
  if (limit === '12') return label !== 'X' && label !== '18' && label !== '16';
  if (limit === '7') return label === 'APTA' || label === '7';
  if (limit === 'APTA') return label === 'APTA';
  return true;
}

function showScreen(html) {
  app.innerHTML = html;
  window.scrollTo(0, 0);
}

function showLoading(msg = 'Cargando…') {
  showScreen(`
    <div class="screen center">
      <div class="loader"></div>
      <p>${msg}</p>
    </div>
  `);
}

function showError(msg) {
  showScreen(`
    <div class="screen center">
      <h2>Error</h2>
      <p style="color:#f88;margin:1rem 0;">${msg}</p>
      <button id="btn-retry" class="btn">Reintentar</button>
    </div>
  `);
  document.getElementById('btn-retry')?.addEventListener('click', start);
}

function promptUI(title, placeholder = '', type = 'text') {
  return new Promise((resolve) => {
    showScreen(`
      <div class="screen center">
        <h2>${title}</h2>
        <input id="prompt-input" type="${type}" placeholder="${placeholder}"
               style="margin:1.5rem 0;padding:0.8rem 1rem;width:min(320px,90%);font-size:1.1rem;border-radius:8px;border:1px solid #444;background:#1a1a1a;color:#fff;" />
        <button id="prompt-ok" class="btn">Continuar</button>
      </div>
    `);
    const input = document.getElementById('prompt-input');
    const btn = document.getElementById('prompt-ok');
    input?.focus();
    const submit = () => resolve(input?.value?.trim() || '');
    btn?.addEventListener('click', submit);
    input?.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  });
}

function promptPhoneUI() {
  return new Promise((resolve) => {
    showScreen(`
      <div class="screen center">
        <h2>Número de teléfono</h2>
        <p style="color:#aaa;font-size:0.95rem;margin-top:0.4rem;">Introduce tu prefijo y tu número de Telegram:</p>
        <div style="display:flex;gap:0.6rem;margin:1.5rem 0;width:min(340px,92%);align-items:center;justify-content:center;">
          <input id="prompt-phone-prefix" type="tel" inputmode="tel" data-focusable value="+34"
                 style="padding:0.8rem 0.6rem;width:76px;text-align:center;font-size:1.1rem;border-radius:8px;border:1px solid #444;background:#1a1a1a;color:#fff;" />
          <input id="prompt-phone-num" type="tel" inputmode="tel" data-focusable placeholder="600 000 000"
                 style="flex:1;padding:0.8rem 1rem;font-size:1.1rem;border-radius:8px;border:1px solid #444;background:#1a1a1a;color:#fff;" />
        </div>
        <button id="prompt-ok" class="btn" data-focusable>Continuar</button>
      </div>
    `);
    const prefixInput = document.getElementById('prompt-phone-prefix');
    const numInput = document.getElementById('prompt-phone-num');
    const btn = document.getElementById('prompt-ok');
    numInput?.focus();

    const submit = () => {
      let pref = prefixInput?.value?.trim() || '+34';
      if (!pref.startsWith('+')) pref = '+' + pref;
      const num = numInput?.value?.replace(/\s+/g, '').trim();
      if (!num) return;
      resolve(pref + num);
    };

    btn?.addEventListener('click', submit);
    numInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    prefixInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') numInput?.focus(); });
  });
}

function promptCodeUI() {
  return new Promise((resolve) => {
    showScreen(`
      <div class="screen center">
        <h2>Código de Telegram</h2>
        <p style="color:#aaa;font-size:0.95rem;margin-top:0.4rem;">Introduce el código numérico recibido en Telegram:</p>
        <input id="prompt-input" type="tel" inputmode="numeric" pattern="[0-9]*" autocomplete="one-time-code" data-focusable placeholder="12345"
               style="margin:1.5rem 0;padding:0.8rem 1rem;width:min(240px,90%);text-align:center;letter-spacing:0.3em;font-size:1.4rem;border-radius:8px;border:1px solid #444;background:#1a1a1a;color:#fff;" />
        <button id="prompt-ok" class="btn" data-focusable>Continuar</button>
      </div>
    `);
    const input = document.getElementById('prompt-input');
    const btn = document.getElementById('prompt-ok');
    input?.focus();
    const submit = () => resolve(input?.value?.trim() || '');
    btn?.addEventListener('click', submit);
    input?.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  });
}

function promptApiCredentialsUI() {
  return new Promise((resolve) => {
    showScreen(`
      <div class="screen center" style="max-width:440px;margin:0 auto;text-align:center;">
        <h2>Configurar Telegram API</h2>
        <p style="color:#aaa;font-size:0.9rem;margin:0.5rem 0 1.2rem;line-height:1.4;">
          Esta APK no tiene las credenciales incrustadas.<br>
          Introduce tu API ID y Hash de <strong style="color:#fff;">my.telegram.org</strong>:
        </p>
        <div style="display:flex;flex-direction:column;gap:0.8rem;width:100%;align-items:center;">
          <input id="prompt-api-id" type="number" placeholder="API ID (ej: 1234567)"
                 style="padding:0.8rem 1rem;width:min(320px,90%);font-size:1rem;border-radius:8px;border:1px solid #444;background:#1a1a1a;color:#fff;" />
          <input id="prompt-api-hash" type="text" placeholder="API Hash (32 caracteres)"
                 style="padding:0.8rem 1rem;width:min(320px,90%);font-size:1rem;border-radius:8px;border:1px solid #444;background:#1a1a1a;color:#fff;" />
          <button id="prompt-api-ok" class="btn" style="margin-top:0.4rem;width:min(320px,90%);">Guardar y Conectar</button>
        </div>
      </div>
    `);
    const idInput = document.getElementById('prompt-api-id');
    const hashInput = document.getElementById('prompt-api-hash');
    const btn = document.getElementById('prompt-api-ok');
    idInput?.focus();

    const submit = () => {
      const id = idInput?.value?.trim();
      const hash = hashInput?.value?.trim();
      if (!id || !hash) return;
      resolve({ apiId: id, apiHash: hash });
    };

    btn?.addEventListener('click', submit);
    hashInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    idInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') hashInput?.focus(); });
  });
}


// ---------- Home con biblioteca ----------
let TITLES_CACHE = null;
let CHANNELS_CACHE = [];
let ACTIVE_HOME_SECTION = 'inicio';
let metadataController = null;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtSize = (b) => b > 1e9 ? (b / 1e9).toFixed(2) + ' GB' : (b / 1e6).toFixed(0) + ' MB';
const fmtDur = (s) => s ? `${Math.floor(s / 3600) ? Math.floor(s / 3600) + 'h ' : ''}${Math.floor(s % 3600 / 60)}min` : '';

function formatPlayButtonLabel(t, st, progress) {
  if (!st?.next) return '';
  const isContinue = st.continueWatching && progress[st.next.key] && !progress[st.next.key].is_completed;
  const actionPrefix = isContinue ? '▶ Continuar' : '▶ Reproducir';

  if (t.tipo === 'serie') {
    const nextFile = st.next;
    const epNum = (nextFile.season || nextFile.episode)
      ? `T${nextFile.season || 1}·E${String(nextFile.episode || 1).padStart(2, '0')}`
      : '';
    const epName = nextFile.metadata?.name || prettyEpisodeName(nextFile.fileName || nextFile.label, t.metadata?.name || t.nombre);
    return `${actionPrefix} ${epNum ? epNum + ' - ' : ''}${epName}`;
  }

  if (t.isSaga) {
    const nextFile = st.next;
    const filmName = nextFile.metadata?.name || nextFile.sagaName || nextFile.label;
    return `${actionPrefix} ${filmName}`;
  }

  return actionPrefix;
}

function cardHtml(t, progress) {
  const st = titleState(t, progress);
  const p = st.next && progress[st.next.key];
  const pct = p && p.duration ? Math.min(100, p.current_time / p.duration * 100) : 0;
  const displayName = t.metadata?.name || t.metadata?.title || t.nombre;
  const metaBadge = t.tipo === 'serie' ? `${t.archivos.length} ep.` : t.isSaga ? `${t.archivos.length} películas` : t.tipo === 'deporte' ? 'Deporte' : t.tipo === 'musica' ? 'Música' : t.archivos.length > 1 ? `${t.archivos.length} vers.` : 'Película';
  const posterUrl = t.metadata?.poster;
  const localPoster = posterUrl ? (memoryCache.get(posterUrl) || posterUrl) : '';

  return `
    <div class="lib-card" tabindex="0" data-focusable data-title="${esc(t.id)}">
      <div class="lib-card-poster ${posterUrl ? 'has-poster' : ''}" style="--pc:${posterColor(t.grupo + t.nombre)}">
        ${posterUrl ? `<img class="poster-image" src="${esc(localPoster)}" data-poster-url="${esc(posterUrl)}" alt="${esc(displayName)}" loading="lazy" onerror="this.onerror=null;this.remove();">` : ''}
        <span class="poster-group">${esc(t.grupo)}</span>
        <span class="poster-name">${esc(displayName)}</span>
        <span class="poster-meta">${metaBadge}</span>
        ${pct ? `<div class="poster-progress"><i style="width:${pct}%"></i></div>` : ''}
      </div>
      <div class="lib-card-name">${esc(displayName)}</div>
    </div>`;
}

// Guarda en la caché local los metadatos de todos los títulos SIN las imágenes elegidas por el perfil
// (esas viajan en image_prefs y se reaplican al cargar; así "Restaurar original" siempre funciona).
async function persistTitlesMetadata() {
  try {
    const saved = await kv.get(LIB_KEY).catch(() => null);
    if (!saved) return;
    saved.metadataMap = saved.metadataMap || {};
    for (const t of (TITLES_CACHE || [])) {
      const meta = metadataForPersist(t);
      if (meta) saved.metadataMap[t.id] = meta;
      if (Array.isArray(t.archivos) && (t.isSaga || (t.tipo === 'pelicula' && t.archivos.length > 1))) {
        for (const f of t.archivos) {
          if (f.metadata) {
            const fKey = f.key || `${t.channel?.id || t.id}:${f.messageId}`;
            saved.metadataMap[fKey] = metadataForPersist(f);
          }
        }
      }
    }
    await kv.set(LIB_KEY, saved);
  } catch (_) {}
}

const libraryViews = createLibraryViews({
  applyProfileScale, setBackHandler, getTitles: () => TITLES_CACHE, setTitles: value => { TITLES_CACHE = value; },
  loadProgress, titleState, formatPlayButtonLabel, esc, posterColor, memoryCache, showScreen, cardHtml,
  loadPoster, applyImagePrefs, getAutoLogo, fmtDur, fmtSize, enrichTitle, showImagePicker,
  restoreOriginalImage, showMetadataModal, mergeMoviesByTmdb, attachAutoCollections, playFile, fetchSeasonEpisodes,
  centerSeason, firstUncompleted, adjacentSeason, isFavorite, toggleFavorite, toggleAllWatched,
  focusFirst, showHome, app, persistMetadata: persistTitlesMetadata,
});

// Lee los canales y solo vuelve a escanear los que han cambiado (o todos si force)
async function refreshLibrary(tg, { force = false, onProgress } = {}) {
  const client = tg.getClient();
  const channels = await loadLibrary(client);
  CHANNELS_CACHE = channels;
  // En una actualización completa se invalida el caché de los canales TGStorage,
  // pero se conserva la biblioteca previa para restaurar los canales externos.
  const previousObj = await kv.get(LIB_KEY).catch(() => null);
  const savedObj = force ? null : previousObj;
  const saved = savedObj?.cache || {};
  const savedMeta = previousObj?.metadataMap || {};
  const { titles, cache } = await buildTitles(client, channels, tg.peerOf, onProgress, saved);

  // Conservar canales externos persistidos en external_sources_v1 sin escanearlos en el arranque
  // (los títulos de canales externos se cargan bajo demanda en su pestaña dedicada sin ralentizar el inicio)
  const extSources = (await kv.get('external_sources_v1').catch(() => [])) || [];
  const combinedCache = { ...(force ? (previousObj?.cache || {}) : saved), ...cache };

  if (savedMeta) {
    for (const t of titles) {
      if (savedMeta[t.id]) t.metadata = savedMeta[t.id];
      if (Array.isArray(t.archivos) && (t.isSaga || (t.tipo === 'pelicula' && t.archivos.length > 1))) {
        for (const f of t.archivos) {
          const fKey = f.key || `${t.channel?.id || t.id}:${f.messageId}`;
          if (savedMeta[fKey]) {
            f.metadata = savedMeta[fKey];
            f.tmdbId = savedMeta[fKey].id;
            if (savedMeta[fKey].name && t.isSaga) f.sagaName = savedMeta[fKey].name;
          }
        }
      }
    }
  }
  const sig = channels.map(c => `${c.id}:${c.top}:${c.title}`).sort().join('|');
  const metadataMap = { ...savedMeta };
  for (const t of titles) {
    if (t.metadata) metadataMap[t.id] = metadataForPersist(t);
    if (t.isSaga && Array.isArray(t.archivos)) {
      for (const f of t.archivos) {
        if (f.metadata) {
          const fKey = f.key || `${t.channel?.id || t.id}:${f.messageId}`;
          metadataMap[fKey] = f.metadata;
        }
      }
    }
  }

  // Conservar canales tgstorage y canales externos guardados
  const allChannels = [...channels];
  for (const ext of extSources) {
    const extId = String(ext.id);
    const existingRec = previousObj?.channels?.find(c => String(c.id) === extId);
    if (existingRec && !allChannels.some(c => String(c.id) === extId)) {
      allChannels.push(existingRec);
    }
  }

  await kv.set(LIB_KEY, { cache: combinedCache, channels: allChannels, sig, metadataMap, savedAt: Date.now() }).catch(e => console.warn('[kv]', e));
  return { titles, sig };
}


function showUpdateDialog({ onQuick, onFull }) {
  const { overlay, close } = modal("Actualizar biblioteca", `
    <div style="display:flex;flex-direction:column;gap:1rem;">
      <p style="color:#aaa;font-size:0.95rem;margin:0 0 0.2rem;">Selecciona el modo de actualización de canales y vídeos:</p>
      <div class="update-options-list" style="display:flex;flex-direction:column;gap:0.8rem;">
        <button class="btn btn-update-option" id="btn-update-quick" data-focusable style="text-align:left;padding:0.9rem 1.1rem;line-height:1.4;">
          <div style="font-weight:700;font-size:1.05rem;color:#fff;">⚡ Actualización rápida</div>
          <div style="font-size:0.85rem;color:#bbb;margin-top:0.25rem;">Sincroniza perfil (favoritos, carátulas y fondos), metadatos de TMDB y canales con nuevos vídeos.</div>
        </button>
        <button class="btn btn-secondary btn-update-option" id="btn-update-full" data-focusable style="text-align:left;padding:0.9rem 1.1rem;line-height:1.4;">
          <div style="font-weight:700;font-size:1.05rem;color:#fff;">🔄 Forzar actualización completa</div>
          <div style="font-size:0.85rem;color:#bbb;margin-top:0.25rem;">Reescanea todos los canales desde cero y regenera la biblioteca entera.</div>
        </button>
      </div>
    </div>
  `, "Comprueba nuevos vídeos o reescanea canales");

  overlay.querySelector("#btn-update-quick").onclick = () => { close(); onQuick(); };
  overlay.querySelector("#btn-update-full").onclick = () => { close(); onFull(); };

  setTimeout(() => {
    overlay.querySelector("#btn-update-quick")?.focus();
  }, 50);
}


export function isExternalTitle(t) {
  return Boolean(
    t?.origen?.tipo === 'externo' ||
    t?.channel?.isExternal ||
    t?.isExternal ||
    (typeof t?.channel?.id === 'string' && t.channel.id.includes('_top_'))
  );
}

let CHECKED = false;
function getSectionSort(profileId, sectionId) {
  try {
    return localStorage.getItem(`tg_sort_${profileId}_${sectionId}`) || 'nombre';
  } catch (_) {
    return 'nombre';
  }
}

function setSectionSort(profileId, sectionId, sortType) {
  try {
    localStorage.setItem(`tg_sort_${profileId}_${sectionId}`, sortType);
  } catch (_) {}
}

function getSectionSortOrder(profileId, sectionId, currentSort = 'nombre') {
  try {
    const saved = localStorage.getItem(`tg_sort_dir_${profileId}_${sectionId}`);
    if (saved === 'asc' || saved === 'desc') return saved;
  } catch (_) {}
  return currentSort === 'nombre' ? 'asc' : 'desc';
}

function setSectionSortOrder(profileId, sectionId, order) {
  try {
    localStorage.setItem(`tg_sort_dir_${profileId}_${sectionId}`, order);
  } catch (_) {}
}

function getSectionViewMode(profileId, sectionId) {
  try {
    return localStorage.getItem(`tg_view_${profileId}_${sectionId}`) || 'grid';
  } catch (_) {
    return 'grid';
  }
}

function setSectionViewMode(profileId, sectionId, viewMode) {
  try {
    localStorage.setItem(`tg_view_${profileId}_${sectionId}`, viewMode);
  } catch (_) {}
}

function nextViewMode(current) {
  if (current === 'grid') return 'posters';
  if (current === 'posters') return 'logos';
  return 'grid';
}

function viewModeShortLabel(mode) {
  if (mode === 'logos') return 'Logos';
  if (mode === 'posters') return 'Carrusel';
  return 'Cuadrícula';
}

function sortTitles(items, sortType, sortOrder = 'desc') {
  const list = [...items];
  const mult = sortOrder === 'asc' ? 1 : -1;

  if (sortType === 'estreno') {
    return list.sort((a, b) => {
      const dateA = a.metadata?.date || a.yearHint || a.metadata?.release_date || a.metadata?.first_air_date || '';
      const dateB = b.metadata?.date || b.yearHint || b.metadata?.release_date || b.metadata?.first_air_date || '';
      if (dateA && dateB) {
        const cmp = String(dateA).localeCompare(String(dateB));
        if (cmp !== 0) return cmp * mult;
      } else if (dateA && !dateB) {
        return sortOrder === 'asc' ? -1 : 1;
      } else if (!dateA && dateB) {
        return sortOrder === 'asc' ? 1 : -1;
      }
      const msgA = a.ultimoMensajeFecha || 0;
      const msgB = b.ultimoMensajeFecha || 0;
      if (msgB !== msgA) return (msgA - msgB) * mult;
      const nameA = a.metadata?.name || a.metadata?.title || a.nombre || '';
      const nameB = b.metadata?.name || b.metadata?.title || b.nombre || '';
      return nameA.localeCompare(nameB, 'es', { numeric: true, sensitivity: 'base' });
    });
  }
  if (sortType === 'puntuacion') {
    return list.sort((a, b) => {
      const rA = Number(a.metadata?.imdbRating ?? a.metadata?.rating) || 0;
      const rB = Number(b.metadata?.imdbRating ?? b.metadata?.rating) || 0;
      if (rB !== rA) return (rA - rB) * mult;
      const dateA = a.metadata?.date || a.yearHint || '';
      const dateB = b.metadata?.date || b.yearHint || '';
      if (dateA && dateB) {
        const cmp = String(dateA).localeCompare(String(dateB));
        if (cmp !== 0) return cmp * mult;
      }
      const nameA = a.metadata?.name || a.metadata?.title || a.nombre || '';
      const nameB = b.metadata?.name || b.metadata?.title || b.nombre || '';
      return nameA.localeCompare(nameB, 'es', { numeric: true, sensitivity: 'base' });
    });
  }
  return list.sort((a, b) => {
    const nameA = a.metadata?.name || a.metadata?.title || a.nombre || '';
    const nameB = b.metadata?.name || b.metadata?.title || b.nombre || '';
    return nameA.localeCompare(nameB, 'es', { numeric: true, sensitivity: 'base' }) * (sortOrder === 'desc' ? -1 : 1);
  });
}

function applyOverridesAndUnbundle(titles = []) {
  const unbundledTitles = [];
  for (const t of titles) {
    let ov = getOverride(t.id);
    if (!ov && t.tmdbId) ov = getOverrideByTmdbId(t.tmdbId);
    if (ov) {
      t.metadata = ov;
      t.tmdbId = ov.id || t.tmdbId;
    }

    if (t.isSaga && Array.isArray(t.archivos)) {
      for (const f of t.archivos) {
        const fileKey = f.key || `${t.channel?.id || t.id}:${f.messageId}`;
        const fOv = getOverride(fileKey) || (f.tmdbId ? getOverrideByTmdbId(f.tmdbId) : null);
        if (fOv) {
          f.metadata = fOv;
          f.tmdbId = fOv.id;
          if (fOv.name) f.sagaName = fOv.name;
        }
      }
      unbundledTitles.push(t);
    } else if (t.tipo === 'pelicula' && Array.isArray(t.archivos) && t.archivos.length > 1) {
      const remainingFiles = [];
      const titleTmdbId = String(t.metadata?.id || t.tmdbId || '');
      for (const f of t.archivos) {
        const fileKey = f.key || `${t.channel?.id || t.id}:${f.messageId}`;
        const fOv = getOverride(fileKey);
        if (fOv) {
          f.metadata = fOv;
          f.tmdbId = fOv.id;
          if (titleTmdbId && String(fOv.id) !== titleTmdbId) {
            unbundledTitles.push({
              id: fileKey,
              tipo: 'pelicula',
              isSaga: false,
              grupo: t.grupo || 'Películas',
              nombre: fOv.name || f.label,
              yearHint: fOv.date?.slice(0, 4) || null,
              origen: { tipo: 'año_container', channelId: String(f.channelId || t.channel?.id), messageId: f.messageId },
              channel: t.channel || f.channel,
              archivos: [f],
              ultimoMensajeFecha: f.date || t.ultimoMensajeFecha || 0,
              tmdbId: fOv.id,
              metadata: fOv,
            });
            continue;
          }
        }
        remainingFiles.push(f);
      }
      t.archivos = remainingFiles;
      if (t.archivos.length > 0) {
        unbundledTitles.push(t);
      }
    } else {
      unbundledTitles.push(t);
    }
  }
  return unbundledTitles;
}

let BG_LIBRARY_PROMISE = null;
let BG_LIBRARY_DONE = false;
let BG_LIBRARY_STATUS = '';
let WAITING_USER_SCREEN = false;

function updateBackgroundProgress(statusText) {
  BG_LIBRARY_STATUS = statusText;
  if (WAITING_USER_SCREEN) {
    const p = document.querySelector('.screen.center p');
    if (p) p.textContent = statusText;
  }
}

function startBackgroundLibraryCheck(tg) {
  if (BG_LIBRARY_PROMISE) return BG_LIBRARY_PROMISE;
  BG_LIBRARY_DONE = false;
  BG_LIBRARY_STATUS = 'Comprobando nuevos vídeos…';

  BG_LIBRARY_PROMISE = (async () => {
    try {
      const onProgress = (d, n) => {
        updateBackgroundProgress(`Buscando nuevos vídeos… ${d}/${n}`);
      };

      const refreshed = await refreshLibrary(tg, { force: false, onProgress });
      let titles = refreshed.titles || [];

      titles = applyOverridesAndUnbundle(titles);
      titles = attachAutoCollections(mergeMoviesByTmdb(titles));
      TITLES_CACHE = titles;
      CHECKED = true;

      const pendingTitles = titles.filter(t => !isExternalTitle(t) && (!t.metadata || (t.isSaga && t.archivos?.some(f => !f.metadata))));
      pendingTitles.forEach(t => TMDB_ATTEMPTED.add(t.id));
      if (pendingTitles.length > 0) {
        updateBackgroundProgress(`Identificando vídeos con TMDB (0/${pendingTitles.length})…`);
        metadataController?.abort();
        metadataController = new AbortController();
        await enrichTitles(pendingTitles, {
          signal: metadataController.signal,
          onProgress: (d, total) => {
            updateBackgroundProgress(`Identificando vídeos con TMDB (${d}/${total})…`);
          },
        });
        persistTitlesMetadata();
        titles = attachAutoCollections(mergeMoviesByTmdb(titles));
        TITLES_CACHE = titles;
      }

      updateBackgroundProgress('Cargando carátulas…');
      await prewarmPosterCache(titles);
      BG_LIBRARY_STATUS = '';
      BG_LIBRARY_DONE = true;
      return TITLES_CACHE;
    } catch (err) {
      console.error('[bgLibrary] Error en segundo plano:', err);
      BG_LIBRARY_DONE = true;
      if (!TITLES_CACHE) TITLES_CACHE = [];
      return TITLES_CACHE;
    }
  })();

  return BG_LIBRARY_PROMISE;
}

async function syncProfileOnly(sync, profile) {
  try {
    if (sync) {
      await loadOverrides(sync).catch(e => console.warn('[overrides] sync error', e));
    }
    if (sync && profile?.id) {
      const remote = await sync.pullProfile(profile.id).catch(e => { console.warn('[sync] pullProfile error', e); return null; });
      if (remote) {
        if (remote.progress) {
          const mergedPrg = sync.mergeProgress(loadProgress(profile.id), remote.progress);
          writeFullProgress(profile.id, mergedPrg);
        }
        const remoteFavs = mergeFavorites(remote.favorites || [], remote.profile?.favorites || []);
        const localFavs = loadFavorites(profile.id);
        const mergedFavs = mergeFavorites(localFavs, remoteFavs);
        saveFavorites(profile.id, mergedFavs);
        profile.favorites = mergedFavs;

        const remoteImg = { ...(remote.image_prefs || {}), ...(remote.profile?.image_prefs || {}) };
        const mergedImg = await pullAndMergeImagePrefs(profile, sync, remoteImg);
        profile.image_prefs = mergedImg;

        if (remote.profile?.devices) {
          profile.devices = { ...(remote.profile.devices || {}), ...(profile.devices || {}) };
        }
        if (remote.profile?.ui_scale !== undefined && profile.ui_scale === undefined) {
          profile.ui_scale = remote.profile.ui_scale;
        }

        if (mergedFavs.length > remoteFavs.length) {
          sync.pushProfile({
            profile,
            progress: loadProgress(profile.id),
            favorites: mergedFavs,
            image_prefs: mergedImg,
          }).catch(e => console.warn('[sync] push merged error', e));
        }
      }
    }
  } catch (err) {
    console.warn('[sync] Error sincronizando perfil', err);
  }
}

async function loadAndSyncAll(tg, sync, profile, { force = false } = {}) {
  showLoading('Sincronizando perfil…');
  await syncProfileOnly(sync, profile);

  BG_LIBRARY_PROMISE = null;
  BG_LIBRARY_DONE = false;
  WAITING_USER_SCREEN = true;
  showLoading('Comprobando nuevos vídeos…');
  const onProgress = (d, n) => {
    updateBackgroundProgress(`Buscando nuevos vídeos… ${d}/${n}`);
  };

  try {
    const refreshed = await refreshLibrary(tg, { force, onProgress });
    TITLES_CACHE = refreshed.titles || [];
  } catch (err) {
    console.error('Error cargando biblioteca', err);
    if (!TITLES_CACHE) TITLES_CACHE = [];
  }
  CHECKED = true;

  let titles = applyOverridesAndUnbundle(TITLES_CACHE || []);
  titles = attachAutoCollections(mergeMoviesByTmdb(titles));
  TITLES_CACHE = titles;

  const pendingTitles = titles.filter(t => !isExternalTitle(t) && (!t.metadata || (t.isSaga && t.archivos?.some(f => !f.metadata))));
  pendingTitles.forEach(t => TMDB_ATTEMPTED.add(t.id));
  if (pendingTitles.length > 0) {
    showLoading(`Identificando vídeos con TMDB (0/${pendingTitles.length})…`);
    metadataController?.abort();
    metadataController = new AbortController();
    await enrichTitles(pendingTitles, {
      signal: metadataController.signal,
      onProgress: (d, total) => {
        showLoading(`Identificando vídeos con TMDB (${d}/${total})…`);
      },
    });
    persistTitlesMetadata();
    titles = attachAutoCollections(mergeMoviesByTmdb(titles));
    TITLES_CACHE = titles;
  }

  titles.forEach(t => applyImagePrefs(t, profile));
  showLoading('Cargando carátulas…');
  await prewarmPosterCache(titles);
  WAITING_USER_SCREEN = false;
  BG_LIBRARY_DONE = true;

  return TITLES_CACHE;
}

async function showHome(tg, sync, profile, { fast = false, reload = false, force = false, focusTitleId = null, focusRowId = null, focusCardIndex = null, focusExpandBtn = false, focusSort = null, focusSortToggle = false, focusViewBtn = false, selectedSection = ACTIVE_HOME_SECTION, fromPointer = false } = {}) {
  applyProfileScale(profile);
  if (selectedSection !== 'inicio') {
    setBackHandler(() => {
      destroyCarousel();
      showHome(tg, sync, profile, { selectedSection: 'inicio' });
    });
  } else {
    setBackHandler(() => showProfileSelector(tg, sync));
  }
  const tStart = perfNow();
  if (reload || !TITLES_CACHE) {
    TMDB_ATTEMPTED.clear();
    HOME_PROCESSED = { ref: null, profileId: null };
    await loadAndSyncAll(tg, sync, profile, { force });
    perfLog(`loadAndSyncAll ${Math.round(perfNow() - tStart)} ms`);
  }

  let titles = TITLES_CACHE || [];
  const canReuse = fast && !reload && HOME_PROCESSED.ref === TITLES_CACHE && HOME_PROCESSED.profileId === profile.id;
  if (canReuse) {
    perfLog(`showHome(${selectedSection}): procesado reutilizado (${titles.length} títulos)`);
  } else {
    const tProc = perfNow();
    titles = applyOverridesAndUnbundle(titles);
    titles = titles.filter(t => isTitleAllowedByProfileAge(t, profile));
    titles = attachAutoCollections(mergeMoviesByTmdb(titles));
    titles = titles.filter(t => isTitleAllowedByProfileAge(t, profile));
    TITLES_CACHE = titles;
    titles.forEach(t => applyImagePrefs(t, profile));
    const tPrewarm = perfNow();
    // Precalentar carátulas cacheadas en memoria para que se muestren en 0 ms
    await prewarmPosterCache(titles);
    perfLog(`showHome(${selectedSection}): procesado ${Math.round(tPrewarm - tProc)} ms, prewarm carátulas ${Math.round(perfNow() - tPrewarm)} ms (${titles.length} títulos)`);
    HOME_PROCESSED = { ref: titles, profileId: profile.id };
  }
  const tBuild = perfNow();

  const progress = loadProgress(profile.id);
  const rows = buildHomeRows(titles, progress, getNewsPrefs(profile));
  const titleById = new Map();
  for (const t of titles) {
    titleById.set(String(t.id), t);
    if (t.tmdbId) {
      if (!titleById.has(String(t.tmdbId))) titleById.set(String(t.tmdbId), t);
      if (!titleById.has(`tmdb:${t.tmdbId}`)) titleById.set(`tmdb:${t.tmdbId}`, t);
    }
    if (t.archivos) {
      for (const f of t.archivos) {
        const fileKey = `${f.channel}:${f.messageId}`;
        if (!titleById.has(fileKey)) titleById.set(fileKey, t);
      }
    }
  }
  const favIds = loadFavorites(profile.id);
  const seenFavs = new Set();
  const favoriteTitles = [];
  for (const id of favIds) {
    const t = titleById.get(String(id));
    if (t && !seenFavs.has(t.id)) {
      seenFavs.add(t.id);
      favoriteTitles.push(t);
    }
  }
  const extSources = (await kv.get("external_sources_v1").catch(() => [])) || [];
  const externalTitles = titles.filter(t => isExternalTitle(t));
  const collectionTitles = titles.filter(t => (t.isSaga || t.metadata?.tipo === 'collection') && !isExternalTitle(t));
  const movieTitles = titles.filter(t => t.tipo === 'pelicula' && !t.isSaga && t.metadata?.tipo !== 'collection' && !isExternalTitle(t));
  const seriesTitles = titles.filter(t => t.tipo === 'serie' && !isExternalTitle(t));
  const sportTitles = titles.filter(t => t.tipo === 'deporte' && !isExternalTitle(t));
  const musicTitles = titles.filter(t => t.tipo === 'musica' && !isExternalTitle(t));

  const sectionDefs = [
    ...(titles.length ? [{ id: 'inicio', label: 'Inicio', items: titles }] : []),
    ...(favoriteTitles.length ? [{ id: 'favoritos', label: 'Favoritos', items: favoriteTitles }] : []),
    ...(movieTitles.length ? [{ id: 'peliculas', label: 'Películas', items: movieTitles }] : []),
    ...(seriesTitles.length ? [{ id: 'series', label: 'Series', items: seriesTitles }] : []),
    ...(sportTitles.length ? [{ id: 'deportes', label: 'Deportes', items: sportTitles }] : []),
    ...(musicTitles.length ? [{ id: 'musica', label: 'Música', items: musicTitles }] : []),
    ...(collectionTitles.length ? [{ id: 'colecciones', label: 'Colecciones', items: collectionTitles }] : []),
    ...(SHOW_EXTERNALS_SECTION && (externalTitles.length || extSources.length) ? [{ id: 'externos', label: 'Externo', items: externalTitles }] : []),
  ];
  const isSearch = selectedSection === 'buscar' && titles.length > 0;
  if (!isSearch && !sectionDefs.some(section => section.id === selectedSection)) selectedSection = sectionDefs[0]?.id || 'inicio';
  ACTIVE_HOME_SECTION = selectedSection;
  const activeSection = sectionDefs.find(section => section.id === selectedSection);

  const isExternalsTab = selectedSection === 'externos';
  const isCategorySection = selectedSection !== 'inicio' && !isSearch && !isExternalsTab;
  const currentView = isCategorySection ? getSectionViewMode(profile.id, selectedSection) : 'grid';
  const isCarousel = isCategorySection && (currentView === 'posters' || currentView === 'logos');

  const categoryToolsHtml = (inHeader = false) => {
    const currentSort = getSectionSort(profile.id, selectedSection);
    const currentOrder = getSectionSortOrder(profile.id, selectedSection, currentSort);
    const isSortExpanded = false;
    return `
      <div class="${inHeader ? 'category-header--in-header' : 'category-header-inner'}" role="region" aria-label="Herramientas de ordenación y vista">
        <div class="category-sort-bar ${isSortExpanded ? 'is-expanded' : ''}" role="group" aria-label="Ordenar por">
          <button type="button" class="category-sort-toggle" data-focusable aria-expanded="${isSortExpanded}" aria-haspopup="true" title="Desplegar opciones de ordenación (actual: orden ${currentOrder === 'asc' ? 'ascendente' : 'descendente'})">
            <span class="category-sort-label">Ordenar:</span>
            <span class="category-sort-icon" aria-hidden="true">${currentOrder === 'asc' ? '↑' : '↓'}</span>
          </button>
          <div class="category-sort-options">
            <button type="button" class="category-sort-btn ${currentSort === 'nombre' ? 'active' : ''}" data-focusable data-sort="nombre" aria-pressed="${currentSort === 'nombre'}">Nombre</button>
            <button type="button" class="category-sort-btn ${currentSort === 'estreno' ? 'active' : ''}" data-focusable data-sort="estreno" aria-pressed="${currentSort === 'estreno'}">Fecha de estreno</button>
            <button type="button" class="category-sort-btn ${currentSort === 'puntuacion' ? 'active' : ''}" data-focusable data-sort="puntuacion" aria-pressed="${currentSort === 'puntuacion'}">Puntuación</button>
          </div>
        </div>
        <div class="category-views-bar" role="group" aria-label="Modo de vista">
          <span class="category-views-label">Vista:</span>
          <button type="button" class="category-view-btn" data-focusable data-view="${currentView}" title="Cambiar modo de vista" aria-label="Cambiar vista, actual: ${viewModeShortLabel(currentView)}">${viewModeShortLabel(currentView)}</button>
        </div>
      </div>`;
  };


  const body = (!titles.length && !isExternalsTab) ? `
      <div class="home-empty"><h2>Hola, ${esc(profile.name)}</h2>
        <p>No se han encontrado canales de vídeo.</p>
        <p style="opacity:.6;margin-top:.5rem">Los canales deben terminar en <code>::Series::tgstorage</code> o <code>::Películas::tgstorage</code></p></div>`
    : isSearch ? searchViewHtml()
    : isExternalsTab ? '<div id="externals-view-mount"></div>'
    : selectedSection !== 'inicio' ? (() => {
        const currentSort = getSectionSort(profile.id, selectedSection);
        const currentOrder = getSectionSortOrder(profile.id, selectedSection, currentSort);
        const sortedItems = sortTitles(activeSection?.items || [], currentSort, currentOrder);
        const initialChunk = isCarousel ? sortedItems : sortedItems.slice(0, 80);
        return `
      <section class="category-view ${isCarousel ? 'category-view--carousel' : 'category-view--grid'}" aria-label="${esc(activeSection?.label || '')}">
        ${isCarousel ? `<div class="carousel-host" id="carousel-host"></div>` : `<div class="category-grid">${initialChunk.map(t => cardHtml(t, progress)).join('')}</div>`}
      </section>`;
      })()
    : rows.map(r => `
      <section class="row" data-row-id="${esc(r.id)}">
        <div class="row-header">
          <h2 class="row-title">${esc(r.title)}</h2>
        </div>
        <div class="row-track">
          <div class="lib-card row-expand-card" tabindex="0" data-focusable data-row-id="${esc(r.id)}" title="Ver todos en cuadrícula" aria-label="Ver todos ${esc(r.title)}">
            <div class="row-expand-card-inner">
              <span class="row-expand-plus">+</span>
            </div>
          </div>
          ${r.items.map(t => cardHtml(t, progress)).join('')}
        </div>
      </section>`).join('');

  showScreen(`
    <div class="screen home-screen ${isCarousel ? 'home-screen--carousel' : ''}">
      <header class="home-header ${isCarousel ? 'home-header--carousel' : ''}">
        <div class="home-logo" id="home-logo" title="TGVideo" role="banner">TGVideo</div>
        ${sectionDefs.length ? `<nav class="home-nav" aria-label="Secciones"><button class="home-nav-item nav-search-btn ${isSearch ? 'active' : ''}" data-focusable data-section="buscar" type="button" aria-label="Buscar" title="Buscar" aria-current="${isSearch ? 'page' : 'false'}"><span class="nav-search-icon" aria-hidden="true">🔍</span></button>${sectionDefs.map(section => `<button class="home-nav-item ${section.id === selectedSection ? 'active' : ''}" data-focusable data-section="${esc(section.id)}" type="button" aria-current="${section.id === selectedSection ? 'page' : 'false'}">${esc(section.label)}</button>`).join('')}</nav>` : ''}
        ${isCategorySection ? categoryToolsHtml(true) : ''}
        <div class="home-actions">
          <button class="btn-icon" data-focusable id="btn-reload" title="Actualizar biblioteca" aria-label="Actualizar">↻</button>
          <div class="home-profile" tabindex="0" data-focusable id="btn-change-profile" title="${esc(profile.name)}" aria-label="Perfil: ${esc(profile.name)}">
            <div class="avatar small">${profileAvatar(profile)}</div>
            <span class="profile-update-dot" id="profile-update-dot" style="display:none;" title="Nueva versión disponible"></span>
          </div>
        </div>
      </header>
      <main class="home-main ${isCarousel ? 'home-main--carousel' : ''}">${body}</main>
    </div>`);

  const activeNav = document.querySelector('.home-nav-item.active');
  if (activeNav) {
    requestAnimationFrame(() => {
      activeNav.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
    });
  }

  document.querySelectorAll('.home-nav-item').forEach(button => {
    button.onclick = (e) => {
      button.blur();
      button.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
      destroyCarousel();
      perfLog(`click pestaña -> ${button.dataset.section}`);
      showHome(tg, sync, profile, { fast: true, selectedSection: button.dataset.section, fromPointer: e.detail > 0 });
    };
  });
  if (isExternalsTab) {
    const extMount = document.getElementById('externals-view-mount');
    if (extMount) {
      renderExternalsView({
        tg,
        sync,
        profile,
        externalTitles,
        extSources,
        libraryViews,
        showHome,
        app: extMount,
      });
    }
  }
  if (isSearch) {
    mountSearchView({
      titles,
      cardHtml: t => cardHtml(t, progress),
      onOpen: t => libraryViews.showDetail(tg, sync, profile, t),
      afterRender: root => root.querySelectorAll('.lib-card-poster img.poster-image').forEach(img => {
        const url = img.getAttribute('data-poster-url') || img.src;
        if (url) loadPoster(img, url);
      }),
    });
    setBackHandler(() => showHome(tg, sync, profile, { selectedSection: 'inicio' }));
  }
  // Plegado y despliegue del selector "Ordenar:"
  const sortBar = document.querySelector('.category-sort-bar:not(.search-bar)');
  const sortToggle = document.querySelector('.category-sort-toggle');
  if (sortBar && sortToggle) {
    const expandSort = () => {
      sortBar.classList.add('is-expanded');
      sortToggle.setAttribute('aria-expanded', 'true');
    };
    const collapseSort = () => {
      sortBar.classList.remove('is-expanded');
      sortToggle.setAttribute('aria-expanded', 'false');
    };

    sortToggle.onclick = (e) => {
      e.stopPropagation();
      const isExpanded = sortBar.classList.contains('is-expanded');
      if (isExpanded) {
        collapseSort();
      } else {
        expandSort();
        const activeBtn = sortBar.querySelector('.category-sort-btn.active') || sortBar.querySelector('.category-sort-btn');
        activeBtn?.focus();
      }
    };

    // Prevenir que toques dentro de la barra en iOS/iPhone disparen cierres accidentales
    sortBar.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
    });

    sortBar.addEventListener('focusout', (e) => {
      // Solo colapsar si el foco realmente se movió a otro elemento interactivo fuera de sortBar.
      // En dispositivos táctiles (iOS/iPhone) e.relatedTarget es null al tocar un botón,
      // lo que causaba que el menú se cerrara antes de procesar el evento click.
      if (e.relatedTarget && !sortBar.contains(e.relatedTarget)) {
        collapseSort();
      }
    });

    const handleOutsideSort = (e) => {
      if (!sortBar.contains(e.target)) {
        collapseSort();
      }
    };
    document.addEventListener('pointerdown', handleOutsideSort, { passive: true });
  }

  document.querySelectorAll('.category-sort-btn').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      btn.blur();
      const sortType = btn.dataset.sort;
      const currentSort = getSectionSort(profile.id, selectedSection);
      const currentOrder = getSectionSortOrder(profile.id, selectedSection, currentSort);

      if (sortType === currentSort) {
        // Al pulsar sobre el que ya estaba seleccionado, se cambia el sentido (ascendente/descendente)
        const nextOrder = currentOrder === 'desc' ? 'asc' : 'desc';
        setSectionSortOrder(profile.id, selectedSection, nextOrder);
      } else {
        // Al seleccionar un nuevo criterio, se aplica su orden por defecto
        const defaultOrder = sortType === 'nombre' ? 'asc' : 'desc';
        setSectionSort(profile.id, selectedSection, sortType);
        setSectionSortOrder(profile.id, selectedSection, defaultOrder);
      }
      showHome(tg, sync, profile, { fast: true, selectedSection, focusSortToggle: true, fromPointer: e.detail > 0 });
    };
  });
  const viewBtn = document.querySelector('.category-view-btn');
  if (viewBtn) {
    viewBtn.onclick = (e) => {
      e.stopPropagation();
      const current = getSectionViewMode(profile.id, selectedSection);
      const next = nextViewMode(current);
      setSectionViewMode(profile.id, selectedSection, next);
      showHome(tg, sync, profile, { fast: true, selectedSection, focusViewBtn: true, fromPointer: e.detail > 0 });
    };
  }

  if (isCarousel) {
    const carouselHost = document.getElementById('carousel-host');
    if (carouselHost && activeSection?.items) {
      const currentSort = getSectionSort(profile.id, selectedSection);
      const currentOrder = getSectionSortOrder(profile.id, selectedSection, currentSort);
      const sortedItems = sortTitles(activeSection?.items || [], currentSort, currentOrder);
      mountCarousel(carouselHost, {
        items: sortedItems,
        mode: currentView,
        initialId: focusTitleId,
        allTitles: titles,
        onOpen: (t) => {
          if (t) libraryViews.showDetail(tg, sync, profile, t);
        },
      });
    }
  } else {
    destroyCarousel();
  }
  document.getElementById('btn-change-profile').onclick = () => showProfileMenu({ profile, sync, libraryTitles: titles,
    onSwitch: () => showProfileSelector(tg, sync), onChanged: () => showHome(tg, sync, profile),
    onOpenAdmin: () => showAdminView({ tg, sync, profile, titles: TITLES_CACHE, onBack: () => showHome(tg, sync, profile) }),
    onGlobalChanged: () => { TITLES_CACHE?.forEach(t => delete t.metadata); showHome(tg, sync, profile); } });
    if (isAndroidApp()) {
    checkForUpdate().then(updateInfo => {
      if (updateInfo?.hasUpdate) {
        const dot = document.getElementById('profile-update-dot');
        if (dot) dot.style.display = 'block';
      }
    }).catch(() => {});
  }

  document.getElementById('btn-reload').onclick = () => {
    showUpdateDialog({
      onQuick: () => showHome(tg, sync, profile, { reload: true, force: false }),
      onFull: () => showHome(tg, sync, profile, { reload: true, force: true }),
    });
  };

  document.querySelectorAll('#app .row-expand-card').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const rowId = btn.dataset.rowId;
      const r = rows.find(x => x.id === rowId);
      if (r) libraryViews.showGroupGrid(tg, sync, profile, r);
    };
  });
  document.querySelectorAll('#app .category-grid .lib-card[data-title]').forEach(card => {
    const t = titles.find(x => String(x.id) === String(card.dataset.title));
    if (t) card._titleData = t;
    card.onclick = () => {
      if (t) libraryViews.showDetail(tg, sync, profile, t);
    };
  });

  // Carga progresiva en cuadrícula de sección (evita bloquear la interfaz en colecciones de miles de títulos)
  if (!isCarousel && isCategorySection && activeSection?.items) {
    const currentSort = getSectionSort(profile.id, selectedSection);
    const currentOrder = getSectionSortOrder(profile.id, selectedSection, currentSort);
    const fullSorted = sortTitles(activeSection.items || [], currentSort, currentOrder);
    const gridEl = document.querySelector('.category-grid');
    if (gridEl && fullSorted.length > 80) {
      let loadedCards = 80;
      const onCategoryScroll = () => {
        if (!gridEl.isConnected || loadedCards >= fullSorted.length) {
          window.removeEventListener('scroll', onCategoryScroll);
          return;
        }
        if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 800) {
          const nextBatch = fullSorted.slice(loadedCards, loadedCards + 60);
          loadedCards += nextBatch.length;
          const range = document.createRange();
          const frag = range.createContextualFragment(nextBatch.map(t => cardHtml(t, progress)).join(''));
          frag.querySelectorAll('.lib-card[data-title]').forEach(card => {
            const t = titles.find(x => String(x.id) === String(card.dataset.title));
            if (t) card._titleData = t;
            card.onclick = () => {
              if (t) libraryViews.showDetail(tg, sync, profile, t);
            };
          });
          frag.querySelectorAll('.lib-card-poster img.poster-image').forEach(img => {
            const url = img.getAttribute('data-poster-url') || img.src;
            if (url) loadPoster(img, url);
          });
          gridEl.appendChild(frag);
        }
      };
      window.addEventListener('scroll', onCategoryScroll, { passive: true });
    }
  }
  document.querySelectorAll('#app .row').forEach(rowEl => {
    const rowId = rowEl.dataset.rowId;
    rowEl.querySelectorAll('.lib-card[data-title]').forEach((card, idx) => {
      const t = titles.find(x => String(x.id) === String(card.dataset.title));
      if (t) card._titleData = t;
      card.onclick = () => {
        if (t) libraryViews.showDetail(tg, sync, profile, t, { fromRowId: rowId, fromCardIndex: idx + 1 });
      };
    });
  });
  document.querySelectorAll('.lib-card-poster img.poster-image').forEach(img => {
    const url = img.getAttribute('data-poster-url') || img.src;
    if (url) loadPoster(img, url);
  });


  setTimeout(() => {
    let el = null;
    if (focusViewBtn) {
      el = document.querySelector('.category-view-btn');
    } else if (focusSortToggle) {
      el = document.querySelector('.category-sort-toggle');
    } else if (focusSort && !fromPointer) {
      document.querySelector('.category-sort-bar')?.classList.add('is-expanded');
      el = document.querySelector(`.category-sort-btn[data-sort="${focusSort}"]`);
    } else if (isCarousel) {
      el = document.querySelector('.carousel-stage');
    }
    if (focusRowId && focusExpandBtn) {
      el = document.querySelector(`.row[data-row-id="${focusRowId}"] .row-expand-card`);
    } else if (focusRowId && focusTitleId) {
      el = document.querySelector(`.row[data-row-id="${focusRowId}"] .lib-card[data-title="${focusTitleId}"]`);
    }
    if (!el && focusRowId && typeof focusCardIndex === "number") {
      const row = document.querySelector(`.row[data-row-id="${focusRowId}"]`);
      el = row?.querySelectorAll(".row-track > [data-focusable]")?.[focusCardIndex];
    }
    if (!el && focusTitleId) {
      el = document.querySelector(`.lib-card[data-title="${focusTitleId}"]`);
    }
    if (!el && isSearch) {
      el = focusTitleId ? document.querySelector(`#search-results .lib-card[data-title="${focusTitleId}"]`) : null;
      el ||= document.getElementById('search-input');
      if (el) { el.focus({ preventScroll: true }); return; }
    }
    if (!el && !fromPointer) {
      // Categorías enfocan su pestaña activa en navegación D-Pad; Inicio mantiene el foco en la primera carátula.
      el = selectedSection !== 'inicio' ? document.querySelector('.home-nav-item.active') : null;
      el ||= document.querySelector('.row[data-row-id="continue"] .row-track .lib-card[data-title]')
        || document.querySelector('.row-track .lib-card[data-title]');
    }
    if (!el && !fromPointer) {
      el = document.querySelector('.home-nav-item.active, [data-focusable]');
    }
    if (el) {
      if (el.closest('.row')) {
        // Fila de la home: un único desplazamiento (centrada; la primera fila al tope con su título entero)
        focusInRow(el, { behavior: fromPointer ? 'auto' : 'smooth' });
      } else {
        el.focus({ preventScroll: true });
        if (!fromPointer) el.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
      }
    }
  }, 80);
  perfLog(`showHome(${selectedSection}): render HTML+eventos ${Math.round(perfNow() - tBuild)} ms, total ${Math.round(perfNow() - tStart)} ms`);
  requestAnimationFrame(() => requestAnimationFrame(() => perfLog(`showHome(${selectedSection}): pintado en pantalla ${Math.round(perfNow() - tStart)} ms`)));

  let metaSaveTimer = null;
  const saveMetaDebounced = () => {
    clearTimeout(metaSaveTimer);
    metaSaveTimer = setTimeout(persistTitlesMetadata, 1500);
  };

  let reattachTimer = null;
  const scheduleReattach = () => {
    clearTimeout(reattachTimer);
    reattachTimer = setTimeout(() => {
      if (!metadataController.signal.aborted && TITLES_CACHE) {
        const beforeCount = TITLES_CACHE.length;
        const newTitles = attachAutoCollections(mergeMoviesByTmdb(TITLES_CACHE));
        if (newTitles.length !== beforeCount) {
          TITLES_CACHE = newTitles;
          if (document.querySelector('.home-screen') && !document.querySelector('.carousel-stage:focus, .carousel-stage.dpad-focused') && (selectedSection === 'inicio' || selectedSection === 'colecciones')) {
            showHome(tg, sync, profile, { focusSort: getSectionSort(profile.id, selectedSection), fromPointer: true });
          }
        }
      }
    }, 2500);
  };

  const pendingBg = titles.filter(t => !isExternalTitle(t) && !TMDB_ATTEMPTED.has(t.id) && (!t.metadata || (t.isSaga && t.archivos?.some(f => !f.metadata))));
  if (BG_ENRICH && BG_ENRICH.profileId === profile.id) {
    if (pendingBg.length) perfLog(`TMDB en segundo plano ya en curso; ${pendingBg.length} pendientes nuevos esperan`);
  } else if (pendingBg.length > 0) {
    metadataController?.abort();
    metadataController = new AbortController();
    pendingBg.forEach(t => TMDB_ATTEMPTED.add(t.id));
    const bgRun = { profileId: profile.id };
    BG_ENRICH = bgRun;
    const tEnrich = perfNow();
    perfLog(`TMDB segundo plano: ${pendingBg.length} títulos`);
    enrichTitles(pendingBg, { signal: metadataController.signal, onUpdate: title => {
      applyImagePrefs(title, profile);
      saveMetaDebounced();
      if (title.metadata?.collection || (title.isSaga && title.archivos?.some(f => f.metadata))) {
        scheduleReattach();
      }
      document.querySelectorAll('.lib-card').forEach(card => {
        if (String(card.dataset.title) !== String(title.id)) return;
        const displayName = title.metadata?.name || title.metadata?.title || title.nombre;
        const nameEl = card.querySelector('.lib-card-name');
        if (nameEl && displayName) nameEl.textContent = displayName;
        const posterNameEl = card.querySelector('.poster-name');
        if (posterNameEl && displayName) posterNameEl.textContent = displayName;

        if (!title.metadata?.poster) return;
        const poster = card.querySelector('.lib-card-poster');
        if (!poster) return;
        let image = poster.querySelector('img.poster-image');
        if (!image) {
          image = document.createElement('img');
          image.className = 'poster-image';
          image.alt = displayName;
          image.loading = 'lazy';
          image.setAttribute('data-poster-url', title.metadata.poster);
          poster.prepend(image);
        }
        loadPoster(image, title.metadata.poster);
      });
      if (String(document.querySelector('.detail')?.dataset.title) === String(title.id)) {
        libraryViews.applyDetailMetadata(title, profile);
        if (title.isSaga) libraryViews.applySagaFilmMetadata(title);
      }
    } }).then(() => {
      // Tras enriquecer, re-agrupar películas con el mismo TMDB y colecciones automáticas
      if (!metadataController.signal.aborted && TITLES_CACHE) {
        const before = TITLES_CACHE.length;
        TITLES_CACHE = attachAutoCollections(mergeMoviesByTmdb(TITLES_CACHE));
        if (TITLES_CACHE.length !== before && document.querySelector('.home-screen') && !document.querySelector('.carousel-stage:focus, .carousel-stage.dpad-focused') && (selectedSection === 'inicio' || selectedSection === 'colecciones')) {
          showHome(tg, sync, profile, { selectedSection: ACTIVE_HOME_SECTION, focusSort: getSectionSort(profile.id, ACTIVE_HOME_SECTION), fromPointer: true });
        }
      }
    }).catch(() => {}).finally(() => {
      perfLog(`TMDB segundo plano terminado en ${Math.round(perfNow() - tEnrich)} ms`);
      if (BG_ENRICH === bgRun) BG_ENRICH = null;
    });
  }
}

// ---------- Selector de perfiles ----------
async function showProfileSelector(tg, sync) {
  applyProfileScale(null);
  showLoading('Cargando perfiles…');

  let profiles = [];
  try {
    profiles = await sync.listProfiles();
  } catch (err) {
    console.warn('No se pudieron cargar perfiles', err);
  }

  const cards = profiles.map(p => `
    <div class="profile-card" tabindex="0" data-focusable data-id="${p.id}">
      <div class="avatar">${profileAvatar(p)}</div>
      <div class="profile-name">${esc(p.name)}</div>
    </div>
  `).join('');

  const addCard = `
    <div class="profile-card add-profile" tabindex="0" data-focusable id="btn-add-profile">
      <div class="avatar add">+</div>
      <div class="profile-name">Añadir perfil</div>
    </div>
  `;

  showScreen(`
    <div class="screen profiles-screen">
      <h1 class="profiles-title">¿Quién está ahí?</h1>
      <div class="profiles-centered-container">
        <div class="profiles-side-spacer" aria-hidden="true"></div>
        <div class="profiles-grid">
          ${cards}
        </div>
        <div class="profiles-add-wrapper">
          ${addCard}
        </div>
      </div>
      <button id="btn-logout" data-focusable class="logout-btn">Cerrar sesión</button>
    </div>
  `);

  const lastProfileId = localStorage.getItem('tgvideo_last_profile_id') || profiles[0]?.id;
  setTimeout(() => {
    let target = null;
    if (lastProfileId) {
      target = document.querySelector(`.profile-card[data-id="${lastProfileId}"]`);
    }
    if (!target) {
      target = document.querySelector('.profile-card[data-id], #btn-add-profile');
    }
    if (target) {
      target.focus();
      target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    }
  }, 60);

  document.querySelectorAll('.profile-card[data-id]').forEach(card => {
    card.addEventListener('click', async () => {
      const id = card.dataset.id;
      const profile = profiles.find(p => p.id === id);
      if (profile) {
        localStorage.setItem('tgvideo_last_profile_id', profile.id);
      }
      if (profile) {
        showLoading('Sincronizando perfil…');
        await syncProfileOnly(sync, profile);

        if (BG_LIBRARY_PROMISE && !BG_LIBRARY_DONE) {
          if (BG_LIBRARY_STATUS) {
            showLoading(BG_LIBRARY_STATUS);
          }
          WAITING_USER_SCREEN = true;
          await BG_LIBRARY_PROMISE;
          WAITING_USER_SCREEN = false;
        }

        (TITLES_CACHE || []).forEach(t => applyImagePrefs(t, profile));

        if (isDevLogEnabled()) {
          startDevLogging({
            getClient: () => tg.getClient(),
            peerOf: tg.peerOf,
            profile,
            sync,
          });
        }

        showHome(tg, sync, profile);
      }
    });
  });

  document.getElementById('btn-add-profile')?.addEventListener('click', async () => {
    const name = await promptUI('Nombre del perfil', 'Ej: Papá, Niños…');
    if (!name) return showProfileSelector(tg, sync);

    const chosenAvatar = await pickAvatar({ name, current: null, title: 'Elige tu avatar', confirmLabel: 'Crear perfil' });
    if (chosenAvatar === null) return showProfileSelector(tg, sync);

    const cleanId = name
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    const profileId = cleanId && cleanId !== 'perfil' && cleanId !== 'default'
      ? cleanId
      : `usr_${Date.now().toString(36)}`;

    const newProfile = {
      v: 1,
      profile: {
        id: profileId,
        name: name.trim(),
        avatar: chosenAvatar,
        age_limit: '+18',
        pin: null,
        is_kids: false,
        player: 'artplayer',
      },
      progress: {},
      recent: [],
      prefs: {},
    };

    showLoading('Creando perfil…');
    try {
      await sync.pushProfile(newProfile);
      await showProfileSelector(tg, sync);
    } catch (err) {
      showError(err?.message || String(err));
    }
  });

  document.getElementById('btn-logout')?.addEventListener('click', async () => {
    await tg.logout();
    initDpad();
    start();
  });
}

// ---------- Arranque ----------
async function start() {
  setupTvPlatform();
  applyProfileScale(null);
  showLoading('Conectando con Telegram…');

  const tg = createTelegramClient({
    promptPhone: () => promptPhoneUI(),
    promptCode: () => promptCodeUI(),
    promptPassword: () => promptUI('Contraseña 2FA', 'Tu contraseña', 'password'),
    promptApiCredentials: () => promptApiCredentialsUI(),
    onError: (err) => showError(err?.message || String(err)),
  });

  try {
    await tg.ready();

    const sync = createTelegramSync({
      getClient: async () => {
        await tg.ready();
        return tg.getClient();
      },
      peerOf: tg.peerOf,
    });

    window.tg = tg;
    window.sync = sync;
    initContextMenu({ tg, getTitles: () => TITLES_CACHE, getChannels: () => CHANNELS_CACHE });

    await loadGlobalConfig(sync);
    await loadOverrides(sync).catch(e => console.warn('[overrides]', e));

    // Arrancar comprobación de biblioteca en segundo plano mientras el usuario elige perfil
    startBackgroundLibraryCheck(tg);

    await showProfileSelector(tg, sync);

  } catch (err) {
    console.error(err);
    showError(err?.message || String(err));
  }
}

hookConsole();
initDpad();
start();
```

---

## Archivo: `src/ui/adminUpload.js`

```javascript
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

```

---

## Archivo: `src/ui/uploadTasks.js`

```javascript
// src/ui/uploadTasks.js
// Shared bottom-bar task list for downloads, uploads, Telegram forwards, and bulk caption edits.

const tasks = new Map();
let bar = null;
let showBtn = null;
let isHidden = false;

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function ensureBar() {
  bar = document.getElementById('admin-global-upload-bar') || bar;
  if (!bar || !bar.isConnected) {
    bar = document.createElement('div');
    bar.id = 'admin-global-upload-bar';
    bar.className = 'admin-global-upload-bar';
    document.body.appendChild(bar);
  }
  return bar;
}

function ensureShowButton() {
  showBtn = document.getElementById('btn-show-upload-bar') || showBtn;
  if (!showBtn || !showBtn.isConnected) {
    showBtn = document.createElement('button');
    showBtn.id = 'btn-show-upload-bar';
    showBtn.type = 'button';
    showBtn.setAttribute('data-focusable', '');
    showBtn.style.cssText = `
      position: fixed;
      bottom: 16px;
      right: 20px;
      z-index: 1000000;
      background: #0284c7;
      color: #ffffff;
      border: 1px solid #38bdf8;
      border-radius: 9999px;
      padding: 0.5rem 1.1rem;
      font-size: 0.85rem;
      font-weight: 600;
      box-shadow: 0 6px 20px rgba(0,0,0,0.6);
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 0.45rem;
      transition: all 0.2s ease;
    `;
    showBtn.addEventListener('click', () => {
      isHidden = false;
      render();
    });
    document.body.appendChild(showBtn);
  }
  return showBtn;
}

function render() {
  if (!tasks.size) {
    bar?.remove();
    bar = null;
    showBtn?.remove();
    showBtn = null;
    return;
  }

  const list = [...tasks.values()];
  const activeCount = list.filter(t => !t.done && !t.error).length;

  if (isHidden) {
    if (bar) bar.style.display = 'none';
    const btn = ensureShowButton();
    btn.style.display = 'flex';
    btn.innerHTML = `<span>Mostrar</span>`;
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
            <div class="admin-upload-bar-right" style="display: flex; align-items: center; gap: 0.65rem; flex: 0 0 250px;">
              <div class="admin-upload-bar-track" style="flex: 1; height: 7px; background: rgba(255,255,255,0.15); border-radius: 9px; overflow: hidden;">
                <div class="admin-upload-bar-fill" style="width: ${Math.max(0, Math.min(100, Number(t.percent) || 0))}%; height: 100%; background: ${t.error ? '#ef4444' : t.done ? '#10b981' : '#38bdf8'}; transition: width 0.3s ease;"></div>
              </div>
              <span class="admin-upload-bar-pct" style="width: 38px; text-align: right; color: #fff; font-size: 0.82rem; font-weight: 600;">
                ${Math.round(Number(t.percent) || 0)}%
              </span>
              ${t.done || t.error ? `
                <button type="button" data-close-task="${esc(t.id)}" aria-label="Cerrar tarea" style="background: transparent; border: 0; color: #94a3b8; font-size: 1.1rem; cursor: pointer; padding: 0 4px;">×</button>
              ` : ''}
            </div>
          </div>
        `).join('')}
      </div>

      <!-- Barra inferior de control: Botón Ocultar abajo a la izquierda y resumen / limpiar a la derecha -->
      <div style="display: flex; justify-content: space-between; align-items: center; color: #94a3b8; font-size: 0.78rem; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 0.4rem; margin-top: 0.1rem;">
        <button type="button" id="upload-bar-btn-hide" data-focusable style="background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.18); border-radius: 4px; color: #cbd5e1; padding: 0.22rem 0.65rem; font-size: 0.78rem; cursor: pointer; display: flex; align-items: center; gap: 0.3rem;">
          <span>Ocultar</span>
        </button>
        <div style="display: flex; align-items: center; gap: 0.8rem;">
          <span>${activeCount} activas · ${list.length} total</span>
          ${list.some(t => t.done || t.error) ? `
            <button type="button" data-clear-finished style="background: transparent; border: 0; color: #38bdf8; cursor: pointer; text-decoration: underline; font-size: 0.78rem;">
              Limpiar terminados
            </button>
          ` : ''}
        </div>
      </div>
    </div>
  `;

  root.querySelector('#upload-bar-btn-hide')?.addEventListener('click', () => {
    isHidden = true;
    render();
  });

  root.querySelectorAll('[data-close-task]').forEach(btn => {
    btn.addEventListener('click', () => {
      tasks.delete(btn.dataset.closeTask);
      render();
    });
  });

  root.querySelector('[data-clear-finished]')?.addEventListener('click', () => {
    for (const [id, task] of tasks) {
      if (task.done || task.error) tasks.delete(id);
    }
    render();
  });
}

export function startUploadTask(title, status = 'Iniciando…', percent = 0) {
  const id = `task-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  tasks.set(id, { id, title, status, percent, done: false, error: false });
  render();
  return id;
}

export function updateUploadTask(id, patch = {}) {
  const current = tasks.get(String(id));
  if (!current) return;
  tasks.set(String(id), { ...current, ...patch, id: String(id) });
  render();
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

```

---

## Archivo: `src/ui/editCaptionModal.js`

```javascript
// src/ui/editCaptionModal.js
import { Api } from 'telegram';
import { modal } from './settings.js';
import { parseCaption, buildStandardCaption } from '../library/parse.js';
import { attachSpatialNav } from './spatialNav.js';
import { startUploadTask, updateUploadTask, finishUploadTask, failUploadTask } from './uploadTasks.js';


function getFloodWaitSeconds(err) {
  if (typeof err?.seconds === "number" && err.seconds > 0) {
    return err.seconds;
  }
  const str = String(err?.errorMessage || err?.message || err || "");
  const match = str.match(/FLOOD_WAIT_(\d+)/i) || str.match(/wait of (\d+)\s*seconds/i);
  if (match) {
    const s = parseInt(match[1], 10);
    if (!isNaN(s) && s > 0) return s;
  }
  return 0;
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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

/**
 * Abre el diálogo de edición de caption y metadatos de Telegram.
 * Soporta edición de archivo individual (versión/episodio) o de datos comunes para múltiples archivos.
 *
 * @param {Object} options
 * @param {Object} options.title Título al que pertenece el archivo/archivos.
 * @param {Object} [options.targetFile] Archivo individual seleccionado (si se pulsó en una versión/episodio).
 * @param {Array<Object>} [options.allFiles] Lista de todos los archivos del título.
 * @param {boolean} [options.initialCommonMode=false] Iniciar directamente en modo edición común.
 * @param {Object} options.client Cliente GramJS.
 * @param {Object} options.tg Instancia tg helper.
 * @param {Function} [options.onUpdated] Callback invocado tras guardar los cambios.
 */
export function showEditCaptionModal({
  title,
  targetFile = null,
  allFiles = [],
  initialCommonMode = false,
  client,
  tg,
  onUpdated = null,
}) {
  const filesList = (Array.isArray(allFiles) && allFiles.length > 0)
    ? allFiles
    : (title?.archivos && title.archivos.length > 0 ? title.archivos : (targetFile ? [targetFile] : []));

  const hasMultipleFiles = filesList.length > 1;
  let isCommonMode = Boolean(hasMultipleFiles && (initialCommonMode || !targetFile));
  let currentSelectedFile = targetFile || filesList[0] || null;
  let isRawTextMode = false;

  const channelObj = currentSelectedFile?.channel || title?.channel || title?.origen;
  const channelTitle = channelObj?.title || channelObj?.name || title?.grupo || 'Canal Telegram';

  const modalTitle = hasMultipleFiles
    ? `Editar caption/datos Telegram (${title.nombre || 'Título'})`
    : `Editar caption/datos: ${currentSelectedFile?.fileName || currentSelectedFile?.label || title.nombre || 'Archivo'}`;

  const subtitleText = hasMultipleFiles
    ? `Canal: <strong>${esc(channelTitle)}</strong> · Total: <strong>${filesList.length} archivos</strong>`
    : `Canal: <strong>${esc(channelTitle)}</strong> · Mensaje: <strong>${esc(currentSelectedFile?.messageId || '')}</strong>`;

  const getInitialValues = (f, isCommon) => {
    if (isCommon) {
      const firstF = filesList[0] || {};
      const cap = parseCaption(firstF.rawCaption || firstF.caption || '');
      return {
        fileName: '',
        section: cap.section || title.origen?.seccion || '',
        tmdbId: cap.tmdbId || title.tmdbId || title.metadata?.id || '',
        imdbId: cap.imdbId || title.imdbId || title.metadata?.imdbId || '',
        director: cap.director || title.metadata?.director || '',
        writer: cap.writer || title.metadata?.writer || '',
        cast: cap.cast || title.metadata?.cast || '',
        rating: cap.rating || title.metadata?.rating || title.metadata?.vote_average || '',
        ageRating: cap.ageRating || title.metadata?.ageRating || '',
        synopsis: cap.synopsis || title.metadata?.overview || '',
        rawText: '',
      };
    }
    const cap = parseCaption(f?.rawCaption || f?.caption || '');
    const fileName = cap.fileName || f?.captionFileName || f?.fileName || f?.label || '';
    const section = cap.section || f?.section || title.origen?.seccion || '';
    const tmdbId = cap.tmdbId || f?.tmdbId || title.tmdbId || title.metadata?.id || '';
    const imdbId = cap.imdbId || f?.imdbId || title.imdbId || title.metadata?.imdbId || '';
    const director = cap.director || title.metadata?.director || '';
    const writer = cap.writer || title.metadata?.writer || '';
    const cast = cap.cast || title.metadata?.cast || '';
    const rating = cap.rating || title.metadata?.rating || title.metadata?.vote_average || '';
    const ageRating = cap.ageRating || title.metadata?.ageRating || '';
    const synopsis = cap.synopsis || f?.synopsis || title.metadata?.overview || '';
    const rawText = f?.rawCaption || f?.caption || buildStandardCaption({
      fileName,
      section,
      tmdbId,
      imdbId,
      director,
      writer,
      cast,
      rating,
      ageRating,
      synopsis,
    });

    return { fileName, section, tmdbId, imdbId, director, writer, cast, rating, ageRating, synopsis, rawText };
  };

  let formValues = getInitialValues(currentSelectedFile, isCommonMode);

  const bodyHtml = `
    <div class="edit-cap-container" style="display: flex; flex-direction: column; gap: 0.85rem; font-size: 0.88rem; color: #e2e8f0;">
      ${hasMultipleFiles ? `
        <div style="display: flex; flex-direction: column; gap: 0.4rem; padding-bottom: 0.6rem; border-bottom: 1px solid rgba(255,255,255,0.08);">
          <div style="font-weight: 600; color: #cbd5e1; font-size: 0.82rem; text-transform: uppercase;">Objetivo de edición:</div>
          <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
            <button type="button" class="btn btn-ghost edit-cap-target-btn ${isCommonMode ? 'is-active' : ''}" data-focusable data-target="common" style="padding: 0.4rem 0.8rem; font-size: 0.85rem; border: 1px solid ${isCommonMode ? '#38bdf8' : 'rgba(255,255,255,0.15)'}; background: ${isCommonMode ? 'rgba(56,189,248,0.15)' : 'transparent'}; color: ${isCommonMode ? '#38bdf8' : '#cbd5e1'}; border-radius: 6px;">
              ⭐ Datos comunes (${filesList.length} archivos)
            </button>
            <select id="edit-cap-file-select" data-focusable style="flex: 1; min-width: 200px; padding: 0.4rem 0.6rem; font-size: 0.85rem; background: #141820; border: 1px solid rgba(255,255,255,0.18); border-radius: 6px; color: #fff;">
              <option value="__common__" ${isCommonMode ? 'selected' : ''}>-- Seleccionar archivo individual --</option>
              ${filesList.map((f, idx) => {
                const isSelected = !isCommonMode && currentSelectedFile === f;
                const label = f.label || f.fileName || `Archivo ${idx + 1} (Msg ${f.messageId})`;
                return `<option value="${idx}" ${isSelected ? 'selected' : ''}>${idx + 1}. ${esc(label)}</option>`;
              }).join('')}
            </select>
          </div>
        </div>
      ` : ''}

      <div id="edit-cap-common-notice" style="display: ${isCommonMode ? 'block' : 'none'}; background: rgba(56, 189, 248, 0.1); border: 1px solid rgba(56, 189, 248, 0.3); border-radius: 6px; padding: 0.55rem 0.8rem; font-size: 0.82rem; color: #bae6fd; line-height: 1.4;">
        ℹ️ <strong>Modo datos comunes:</strong> Los metadatos guardados se aplicarán a los <strong>${filesList.length} archivos</strong>. El <em>Nombre de archivo</em> se conservará individualmente en cada archivo para no sobrescribir nombres de episodios o versiones.
      </div>

      ${!hasMultipleFiles || !isCommonMode ? `
        <div id="edit-cap-mode-bar" style="display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; margin-top: -0.2rem;">
          <span style="font-size: 0.8rem; color: #94a3b8;">Tipo de edición:</span>
          <div style="display: flex; gap: 0.4rem;">
            <button type="button" class="btn btn-ghost edit-cap-mode-btn is-active" data-focusable data-mode="structured" style="padding: 0.25rem 0.6rem; font-size: 0.78rem; border-radius: 4px; border: 1px solid rgba(255,255,255,0.2);">Campos estructurados</button>
            <button type="button" class="btn btn-ghost edit-cap-mode-btn" data-focusable data-mode="raw" style="padding: 0.25rem 0.6rem; font-size: 0.78rem; border-radius: 4px; border: 1px solid rgba(255,255,255,0.15); color: #94a3b8;">Texto libre (Caption)</button>
          </div>
        </div>
      ` : ''}

      <form id="edit-cap-form" style="display: flex; flex-direction: column; gap: 0.65rem;">
        <div id="edit-cap-fields-structured" style="display: flex; flex-direction: column; gap: 0.65rem;">
          <div id="edit-cap-row-filename" style="display: ${isCommonMode ? 'none' : 'flex'}; flex-direction: column; gap: 0.25rem;">
            <label style="font-size: 0.78rem; font-weight: 600; color: #94a3b8;">Nombre de archivo (respetado por Telegram):</label>
            <input type="text" id="cap-input-filename" data-focusable value="${esc(formValues.fileName)}" placeholder="Ej: MiPelicula.1080p.mp4" style="padding: 0.5rem 0.7rem; background: #11141a; border: 1px solid rgba(255,255,255,0.15); border-radius: 5px; color: #fff; font-size: 0.85rem;">
          </div>

          <div style="display: flex; gap: 0.6rem; flex-wrap: wrap;">
            <div style="flex: 1; min-width: 140px; display: flex; flex-direction: column; gap: 0.25rem;">
              <label style="font-size: 0.78rem; font-weight: 600; color: #94a3b8;">Sección:</label>
              <input type="text" id="cap-input-section" data-focusable value="${esc(formValues.section)}" placeholder="Ej: Clásicas, Series, Acción" style="padding: 0.5rem 0.7rem; background: #11141a; border: 1px solid rgba(255,255,255,0.15); border-radius: 5px; color: #fff; font-size: 0.85rem;">
            </div>
            <div style="flex: 1; min-width: 110px; display: flex; flex-direction: column; gap: 0.25rem;">
              <label style="font-size: 0.78rem; font-weight: 600; color: #94a3b8;">ID TMDB:</label>
              <input type="text" id="cap-input-tmdb" data-focusable value="${esc(formValues.tmdbId)}" placeholder="Ej: 2211" style="padding: 0.5rem 0.7rem; background: #11141a; border: 1px solid rgba(255,255,255,0.15); border-radius: 5px; color: #fff; font-size: 0.85rem;">
            </div>
            <div style="flex: 1; min-width: 110px; display: flex; flex-direction: column; gap: 0.25rem;">
              <label style="font-size: 0.78rem; font-weight: 600; color: #94a3b8;">ID IMDB:</label>
              <input type="text" id="cap-input-imdb" data-focusable value="${esc(formValues.imdbId)}" placeholder="Ej: tt0086659" style="padding: 0.5rem 0.7rem; background: #11141a; border: 1px solid rgba(255,255,255,0.15); border-radius: 5px; color: #fff; font-size: 0.85rem;">
            </div>
          </div>

          <div style="display: flex; gap: 0.6rem; flex-wrap: wrap;">
            <div style="flex: 1; min-width: 160px; display: flex; flex-direction: column; gap: 0.25rem;">
              <label style="font-size: 0.78rem; font-weight: 600; color: #94a3b8;">Director:</label>
              <input type="text" id="cap-input-director" data-focusable value="${esc(formValues.director)}" placeholder="Ej: Alfred Hitchcock" style="padding: 0.5rem 0.7rem; background: #11141a; border: 1px solid rgba(255,255,255,0.15); border-radius: 5px; color: #fff; font-size: 0.85rem;">
            </div>
            <div style="flex: 1; min-width: 160px; display: flex; flex-direction: column; gap: 0.25rem;">
              <label style="font-size: 0.78rem; font-weight: 600; color: #94a3b8;">Guionista:</label>
              <input type="text" id="cap-input-writer" data-focusable value="${esc(formValues.writer)}" placeholder="Ej: Roald Dahl" style="padding: 0.5rem 0.7rem; background: #11141a; border: 1px solid rgba(255,255,255,0.15); border-radius: 5px; color: #fff; font-size: 0.85rem;">
            </div>
          </div>

          <div style="display: flex; flex-direction: column; gap: 0.25rem;">
            <label style="font-size: 0.78rem; font-weight: 600; color: #94a3b8;">Casting / Reparto:</label>
            <input type="text" id="cap-input-cast" data-focusable value="${esc(formValues.cast)}" placeholder="Separados por comas" style="padding: 0.5rem 0.7rem; background: #11141a; border: 1px solid rgba(255,255,255,0.15); border-radius: 5px; color: #fff; font-size: 0.85rem;">
          </div>

          <div style="display: flex; gap: 0.6rem; flex-wrap: wrap;">
            <div style="flex: 1; min-width: 120px; display: flex; flex-direction: column; gap: 0.25rem;">
              <label style="font-size: 0.78rem; font-weight: 600; color: #94a3b8;">Puntuación:</label>
              <input type="text" id="cap-input-rating" data-focusable value="${esc(formValues.rating)}" placeholder="Ej: 8.4" style="padding: 0.5rem 0.7rem; background: #11141a; border: 1px solid rgba(255,255,255,0.15); border-radius: 5px; color: #fff; font-size: 0.85rem;">
            </div>
            <div style="flex: 1; min-width: 120px; display: flex; flex-direction: column; gap: 0.25rem;">
              <label style="font-size: 0.78rem; font-weight: 600; color: #94a3b8;">Edad recomendada:</label>
              <input type="text" id="cap-input-agerating" data-focusable value="${esc(formValues.ageRating)}" placeholder="Ej: 13, 18, TP" style="padding: 0.5rem 0.7rem; background: #11141a; border: 1px solid rgba(255,255,255,0.15); border-radius: 5px; color: #fff; font-size: 0.85rem;">
            </div>
          </div>

          <div style="display: flex; flex-direction: column; gap: 0.25rem;">
            <label style="font-size: 0.78rem; font-weight: 600; color: #94a3b8;">Sinopsis:</label>
            <textarea id="cap-input-synopsis" data-focusable rows="3" placeholder="Sinopsis oficial o resumen…" style="padding: 0.5rem 0.7rem; background: #11141a; border: 1px solid rgba(255,255,255,0.15); border-radius: 5px; color: #fff; font-size: 0.85rem; resize: vertical; line-height: 1.4;">${esc(formValues.synopsis)}</textarea>
          </div>
        </div>

        <div id="edit-cap-fields-raw" style="display: none; flex-direction: column; gap: 0.35rem;">
          <label style="font-size: 0.78rem; font-weight: 600; color: #94a3b8;">Texto íntegro del caption en Telegram:</label>
          <textarea id="cap-input-rawtext" data-focusable rows="8" placeholder="Escribe o pega el caption completo del mensaje…" style="padding: 0.6rem 0.8rem; background: #11141a; border: 1px solid rgba(255,255,255,0.18); border-radius: 5px; color: #fff; font-size: 0.85rem; font-family: monospace; resize: vertical; line-height: 1.4;">${esc(formValues.rawText)}</textarea>
        </div>
      </form>

      <!-- Vista previa del caption generado -->
      <div style="background: #0f131a; border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; padding: 0.6rem 0.8rem;">
        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.72rem; color: #94a3b8; margin-bottom: 0.35rem;">
          <span style="font-weight: 600; text-transform: uppercase;">Vista previa del caption en Telegram:</span>
          <span id="edit-cap-char-counter" style="font-weight: 600; color: #38bdf8;">0 / 1024</span>
        </div>
        <pre id="edit-cap-preview" style="margin: 0; font-family: monospace; font-size: 0.78rem; color: #cbd5e1; white-space: pre-wrap; word-break: break-word; max-height: 110px; overflow-y: auto; line-height: 1.35;"></pre>
      </div>

      <div style="display: flex; justify-content: space-between; align-items: center; gap: 0.8rem; margin-top: 0.4rem; padding-top: 0.6rem; border-top: 1px solid rgba(255,255,255,0.08);">
        <div id="edit-cap-status" style="font-size: 0.8rem; color: #94a3b8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"></div>
        <div style="display: flex; gap: 0.6rem; flex-shrink: 0;">
          <button type="button" class="btn btn-secondary" id="btn-edit-cap-cancel" data-focusable style="padding: 0.45rem 1rem;">Cancelar</button>
          <button type="button" class="btn btn-primary" id="btn-edit-cap-save" data-focusable style="padding: 0.45rem 1.2rem; background: #2563eb; color: #fff; font-weight: 600; border-radius: 5px;">
            <span>💾 Guardar en Telegram</span>
          </button>
        </div>
      </div>
    </div>
  `;

  const { overlay, close } = modal(modalTitle, bodyHtml, subtitleText);
  attachSpatialNav(overlay.querySelector('.edit-cap-container'));

  const statusEl = overlay.querySelector('#edit-cap-status');
  const previewEl = overlay.querySelector('#edit-cap-preview');
  const counterEl = overlay.querySelector('#edit-cap-char-counter');
  const btnSave = overlay.querySelector('#btn-edit-cap-save');
  const btnCancel = overlay.querySelector('#btn-edit-cap-cancel');

  const inputFilename = overlay.querySelector('#cap-input-filename');
  const inputSection = overlay.querySelector('#cap-input-section');
  const inputTmdb = overlay.querySelector('#cap-input-tmdb');
  const inputImdb = overlay.querySelector('#cap-input-imdb');
  const inputDirector = overlay.querySelector('#cap-input-director');
  const inputWriter = overlay.querySelector('#cap-input-writer');
  const inputCast = overlay.querySelector('#cap-input-cast');
  const inputRating = overlay.querySelector('#cap-input-rating');
  const inputAgeRating = overlay.querySelector('#cap-input-agerating');
  const inputSynopsis = overlay.querySelector('#cap-input-synopsis');
  const inputRawText = overlay.querySelector('#cap-input-rawtext');

  const fileSelect = overlay.querySelector('#edit-cap-file-select');
  const targetCommonBtn = overlay.querySelector('.edit-cap-target-btn[data-target="common"]');
  const noticeCommon = overlay.querySelector('#edit-cap-common-notice');
  const rowFilename = overlay.querySelector('#edit-cap-row-filename');
  const fieldsStructured = overlay.querySelector('#edit-cap-fields-structured');
  const fieldsRaw = overlay.querySelector('#edit-cap-fields-raw');
  const modeBar = overlay.querySelector('#edit-cap-mode-bar');
  const modeBtns = overlay.querySelectorAll('.edit-cap-mode-btn');

  btnCancel.onclick = () => close();

  const updatePreview = () => {
    let finalStr = '';
    if (isRawTextMode && inputRawText) {
      finalStr = inputRawText.value || '';
    } else {
      const fName = isCommonMode
        ? '<se conserva nombre individual de cada archivo>'
        : (inputFilename?.value?.trim() || '');

      finalStr = buildStandardCaption({
        fileName: fName,
        section: inputSection?.value?.trim() || '',
        tmdbId: inputTmdb?.value?.trim() || '',
        imdbId: inputImdb?.value?.trim() || '',
        director: inputDirector?.value?.trim() || '',
        writer: inputWriter?.value?.trim() || '',
        cast: inputCast?.value?.trim() || '',
        rating: inputRating?.value?.trim() || '',
        ageRating: inputAgeRating?.value?.trim() || '',
        synopsis: inputSynopsis?.value?.trim() || '',
      });
    }

    if (previewEl) previewEl.textContent = finalStr || '(Caption vacío)';
    const len = (finalStr || '').length;
    if (counterEl) {
      counterEl.textContent = `${len} / 1024`;
      counterEl.style.color = len > 1024 ? '#f87171' : (len > 900 ? '#fde047' : '#38bdf8');
    }
  };

  const populateForm = (values, common) => {
    if (inputFilename) inputFilename.value = values.fileName || '';
    if (inputSection) inputSection.value = values.section || '';
    if (inputTmdb) inputTmdb.value = values.tmdbId || '';
    if (inputImdb) inputImdb.value = values.imdbId || '';
    if (inputDirector) inputDirector.value = values.director || '';
    if (inputWriter) inputWriter.value = values.writer || '';
    if (inputCast) inputCast.value = values.cast || '';
    if (inputRating) inputRating.value = values.rating || '';
    if (inputAgeRating) inputAgeRating.value = values.ageRating || '';
    if (inputSynopsis) inputSynopsis.value = values.synopsis || '';
    if (inputRawText) inputRawText.value = values.rawText || '';

    if (rowFilename) rowFilename.style.display = common ? 'none' : 'flex';
    if (noticeCommon) noticeCommon.style.display = common ? 'block' : 'none';
    if (modeBar) modeBar.style.display = common ? 'none' : 'flex';
    if (common && isRawTextMode) {
      isRawTextMode = false;
      modeBtns.forEach((btn) => {
        const active = btn.dataset.mode === 'structured';
        btn.classList.toggle('is-active', active);
        btn.style.color = active ? '#fff' : '#94a3b8';
        btn.style.borderColor = active ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.15)';
      });
      if (fieldsStructured) fieldsStructured.style.display = 'flex';
      if (fieldsRaw) fieldsRaw.style.display = 'none';
    }

    updatePreview();
  };

  [inputFilename, inputSection, inputTmdb, inputImdb, inputDirector, inputWriter, inputCast, inputRating, inputAgeRating, inputSynopsis, inputRawText].forEach(el => {
    el?.addEventListener('input', updatePreview);
  });

  // Selector de objetivo en caso de múltiples archivos
  if (targetCommonBtn) {
    targetCommonBtn.onclick = () => {
      isCommonMode = true;
      targetCommonBtn.classList.add('is-active');
      targetCommonBtn.style.borderColor = '#38bdf8';
      targetCommonBtn.style.background = 'rgba(56,189,248,0.15)';
      targetCommonBtn.style.color = '#38bdf8';
      if (fileSelect) fileSelect.value = '__common__';
      formValues = getInitialValues(currentSelectedFile, true);
      populateForm(formValues, true);
    };
  }

  if (fileSelect) {
    fileSelect.onchange = () => {
      const val = fileSelect.value;
      if (val === '__common__') {
        targetCommonBtn?.click();
        return;
      }
      isCommonMode = false;
      targetCommonBtn?.classList.remove('is-active');
      if (targetCommonBtn) {
        targetCommonBtn.style.borderColor = 'rgba(255,255,255,0.15)';
        targetCommonBtn.style.background = 'transparent';
        targetCommonBtn.style.color = '#cbd5e1';
      }
      const idx = Number(val);
      currentSelectedFile = filesList[idx] || filesList[0];
      formValues = getInitialValues(currentSelectedFile, false);
      populateForm(formValues, false);
    };
  }

  // Toggle estructurado / texto libre
  modeBtns.forEach(b => {
    b.onclick = () => {
      modeBtns.forEach(btn => {
        btn.classList.remove('is-active');
        btn.style.color = '#94a3b8';
        btn.style.borderColor = 'rgba(255,255,255,0.15)';
      });
      b.classList.add('is-active');
      b.style.color = '#fff';
      b.style.borderColor = 'rgba(255,255,255,0.3)';
      isRawTextMode = b.dataset.mode === 'raw';

      if (fieldsStructured) fieldsStructured.style.display = isRawTextMode ? 'none' : 'flex';
      if (fieldsRaw) fieldsRaw.style.display = isRawTextMode ? 'flex' : 'none';

      if (isRawTextMode && inputRawText && !inputRawText.value.trim()) {
        inputRawText.value = buildStandardCaption({
          fileName: inputFilename?.value?.trim() || '',
          section: inputSection?.value?.trim() || '',
          tmdbId: inputTmdb?.value?.trim() || '',
          imdbId: inputImdb?.value?.trim() || '',
          director: inputDirector?.value?.trim() || '',
          writer: inputWriter?.value?.trim() || '',
          cast: inputCast?.value?.trim() || '',
          rating: inputRating?.value?.trim() || '',
          ageRating: inputAgeRating?.value?.trim() || '',
          synopsis: inputSynopsis?.value?.trim() || '',
        });
      }
      updatePreview();
    };
  });

  // Guardar en Telegram
  btnSave.onclick = async () => {
    if (!client) {
      alert('Cliente de Telegram no disponible para guardar.');
      return;
    }

    const filesToUpdate = isCommonMode ? filesList : (currentSelectedFile ? [currentSelectedFile] : []);
    if (filesToUpdate.length === 0) {
      alert('No hay archivos seleccionados para actualizar.');
      return;
    }

    const commonData = {
      section: inputSection?.value?.trim() || null,
      tmdbId: inputTmdb?.value?.trim() || null,
      imdbId: inputImdb?.value?.trim() || null,
      director: inputDirector?.value?.trim() || null,
      writer: inputWriter?.value?.trim() || null,
      cast: inputCast?.value?.trim() || null,
      rating: inputRating?.value?.trim() || null,
      ageRating: inputAgeRating?.value?.trim() || null,
      synopsis: inputSynopsis?.value?.trim() || '',
    };

    const singleFileName = inputFilename?.value?.trim() || null;
    const rawCustomText = isRawTextMode && !isCommonMode ? (inputRawText?.value || '') : null;
    const previewText = isRawTextMode && !isCommonMode ? rawCustomText : buildStandardCaption({
      fileName: isCommonMode ? '' : (singleFileName || currentSelectedFile?.captionFileName || currentSelectedFile?.fileName || currentSelectedFile?.label),
      ...commonData,
    });
    if (String(previewText || '').length > 1024) {
      alert('Telegram limita los captions a 1024 caracteres. Acorta el texto antes de guardar.');
      return;
    }

    btnSave.disabled = true;
    let cancelRequested = false;
    if (btnCancel) {
      btnCancel.disabled = false;
      btnCancel.textContent = "Cancelar restantes";
      btnCancel.onclick = (e) => {
        e.preventDefault();
        cancelRequested = true;
        if (statusEl) {
          statusEl.textContent = "Cancelando proceso tras la operación actual…";
          statusEl.style.color = "#f59e0b";
        }
      };
    }

    let successCount = 0;
    let failedCount = 0;
    let lastError = null;
    const taskId = filesToUpdate.length > 1
      ? startUploadTask(`📝 Editando captions (${filesToUpdate.length} archivos)`, 'Iniciando edición…', 0)
      : null;

    try {
      for (let i = 0; i < filesToUpdate.length; i++) {
        if (cancelRequested) break;
        const file = filesToUpdate[i];
        if (!file.messageId) continue;

        if (statusEl) {
          statusEl.style.color = "#38bdf8";
          statusEl.textContent = `Actualizando mensaje ${i + 1} de ${filesToUpdate.length} en Telegram…`;
        }

        const peer = await resolvePeer(client, tg, file.channel || file.channelId || title.channel);

        let finalCaption = '';
        if (isCommonMode) {
          const existingCap = parseCaption(file.rawCaption || file.caption || '');
          const preservedFileName = existingCap.fileName || file.captionFileName || file.fileName || file.label;
          finalCaption = buildStandardCaption({
            fileName: preservedFileName,
            ...commonData,
          });
        } else {
          finalCaption = rawCustomText !== null
            ? rawCustomText
            : buildStandardCaption({
              fileName: singleFileName || file.captionFileName || file.fileName || file.label,
              ...commonData,
            });
        }

        if (taskId) {
          updateUploadTask(taskId, {
            status: `Actualizando archivo ${i + 1}/${filesToUpdate.length}…`,
            percent: Math.round((i / filesToUpdate.length) * 100)
          });
        }

        // Si el caption es idéntico al actual, saltar llamada innecesaria para prevenir flood
        const currentCap = String(file.rawCaption || file.caption || '').trim();
        if (currentCap && currentCap === String(finalCaption).trim()) {
          successCount++;
          continue;
        }

        let fileSaved = false;
        while (!fileSaved && !cancelRequested) {
          try {
            await client.invoke(new Api.messages.EditMessage({
              peer,
              id: Number(file.messageId),
              message: String(finalCaption || ''),
            }));

            file.caption = finalCaption;
            file.rawCaption = finalCaption;
            const parsed = parseCaption(finalCaption);
            if (parsed.fileName) file.captionFileName = parsed.fileName;
            if (parsed.section) file.section = parsed.section;
            if (parsed.tmdbId) file.tmdbId = parsed.tmdbId;
            if (parsed.imdbId) file.imdbId = parsed.imdbId;
            if (parsed.synopsis) file.synopsis = parsed.synopsis;

            successCount++;
            fileSaved = true;
          } catch (mErr) {
            const em = String(mErr?.errorMessage || mErr?.message || mErr || '');
            if (/MESSAGE_NOT_MODIFIED/i.test(em)) {
              successCount++;
              fileSaved = true;
              break;
            }

            const waitSec = getFloodWaitSeconds(mErr);
            if (waitSec > 0) {
              console.warn(`[editCaptionModal] FloodWait detectado (${waitSec}s) para mensaje ${file.messageId}`);
              let remaining = waitSec + 1;
              while (remaining > 0 && !cancelRequested) {
                const floodMsg = `⏳ Límite de Telegram (FloodWait): esperando ${remaining}s antes de reanudar (${successCount}/${filesToUpdate.length} completados)…`;
                if (statusEl) {
                  statusEl.style.color = "#f59e0b";
                  statusEl.textContent = floodMsg;
                }
                if (taskId) {
                  updateUploadTask(taskId, {
                    title: `📝 Editando captions (${successCount}/${filesToUpdate.length})`,
                    status: floodMsg,
                    percent: Math.round((successCount / filesToUpdate.length) * 100),
                  });
                }
                await new Promise(r => setTimeout(r, 1000));
                remaining--;
              }
              if (cancelRequested) break;
              continue;
            }

            console.warn('[editCaptionModal] Error editando mensaje en Telegram:', file.messageId, mErr);
            failedCount++;
            lastError = mErr;
            break;
          }
        }

        if (cancelRequested) break;

        // Pausa preventiva entre ediciones para evitar FloodWait (como en TGComic)
        if (filesToUpdate.length > 1 && !cancelRequested) {
          await new Promise(r => setTimeout(r, 2000));
        }
      }

      if (taskId) {
        if (failedCount > 0) {
          failUploadTask(taskId, `Completado con incidencias: ${successCount} guardados, ${failedCount} fallidos`);
        } else {
          finishUploadTask(taskId, `✅ ${successCount} captions actualizados`);
        }
      }

      if (successCount > 0) {
        if (commonData.section && title?.origen) {
          title.origen.seccion = commonData.section;
        }
        if (commonData.tmdbId && !title.tmdbId) {
          title.tmdbId = commonData.tmdbId;
        }

        try {
          window.dispatchEvent(new CustomEvent('tgvideo:caption-updated', {
            detail: {
              titleId: title?.id,
              channelId: channelObj?.id,
              files: filesToUpdate,
            },
          }));
        } catch (_) {}

        try { onUpdated?.(title, filesToUpdate); } catch (e) { console.warn('[editCaptionModal] onUpdated error', e); }

        close();
        if (cancelRequested) {
          alert(`Proceso detenido por el usuario. Se actualizaron ${successCount} mensaje${successCount === 1 ? '' : 's'} en Telegram.`);
        } else if (failedCount > 0) {
          alert(`Se actualizaron ${successCount} mensajes en Telegram, pero ${failedCount} fallaron: ${lastError?.message || lastError}`);
        } else {
          alert(`✅ Caption y datos de Telegram actualizados con éxito (${successCount} mensaje${successCount === 1 ? '' : 's'}).`);
        }
      } else {
        const em = String(lastError?.errorMessage || lastError?.message || lastError || '');
        if (/CHAT_ADMIN_REQUIRED|CHAT_WRITE_FORBIDDEN/i.test(em)) {
          alert('No tienes permisos de administrador en este canal de Telegram para editar los mensajes.');
        } else {
          alert(`No se pudo actualizar el mensaje en Telegram: ${em}`);
        }
        btnSave.disabled = false;
        if (btnCancel) { btnCancel.disabled = false; btnCancel.textContent = 'Cancelar'; btnCancel.onclick = () => close(); }
        if (statusEl) { statusEl.style.color = "#ef4444"; statusEl.textContent = 'Error al guardar en Telegram.'; }
      }
    } catch (err) {
      console.error('[editCaptionModal] Error en proceso de guardado', err);
      alert(`Error al guardar en Telegram: ${err?.message || err}`);
      btnSave.disabled = false;
      if (btnCancel) { btnCancel.disabled = false; btnCancel.textContent = 'Cancelar'; btnCancel.onclick = () => close(); }
      if (statusEl) { statusEl.style.color = "#ef4444"; statusEl.textContent = 'Error al guardar en Telegram.'; }
    }
  };

  updatePreview();
}
```

---

## Archivo: `src/styles/home.css`

```css
/* src/styles/home.css */
/* ===== Home / Cabecera ===== */
.home-screen {
  padding: 0;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 100%;
  flex: 1 1 auto;
  overflow: hidden;
}

.home-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: max(0.9rem, calc(var(--sat) + 0.5rem));
  padding-bottom: 0.8rem;
  padding-left: max(1.5rem, calc(var(--sal) + 1rem));
  padding-right: max(1.5rem, calc(var(--sar) + 1rem));
  background: rgba(20, 20, 20, 0.9);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  position: sticky;
  top: 0;
  z-index: 100;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.home-logo {
  font-size: 1.6rem;
  font-weight: 800;
  color: #e50914;
  letter-spacing: -0.5px;
  line-height: 1;
}

.home-actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

/* Botón icono de actualizar (solo símbolo ↻) */
.btn-icon {
  width: 38px;
  height: 38px;
  min-width: 38px;
  min-height: 38px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
  border: 1px solid rgba(255, 255, 255, 0.15);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 1.25rem;
  cursor: pointer;
  line-height: 1;
  padding: 0;
  transition: background 0.15s, transform 0.1s, border-color 0.15s;
}

.btn-icon:hover {
  background: rgba(255, 255, 255, 0.22);
  border-color: rgba(255, 255, 255, 0.35);
}

.btn-icon:active {
  transform: scale(0.92);
}

/* Avatar de usuario en cabecera */
.home-profile {
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  border-radius: 50%;
  padding: 0;
  outline: none;
}

.home-profile:hover .avatar.small,
.home-profile:focus .avatar.small {
  border-color: #fff;
  transform: scale(1.06);
}

.home-main {
  flex: 1;
  display: block;
  padding: 1.2rem 0 3rem;
  overflow-y: auto;
  overflow-x: hidden;
  scroll-padding-top: 2rem;
  scroll-behavior: smooth;
}

.row:first-child {
  margin-top: 0.25rem;
  scroll-margin-top: 3rem;
}

.home-empty {
  text-align: center;
  opacity: 0.9;
  padding: 4rem 1.5rem;
}

.home-empty h2 {
  font-size: 1.8rem;
  font-weight: 400;
  margin-bottom: 0.8rem;
}

/* ===== Biblioteca y Carruseles ===== */
.row {
  margin-bottom: 1rem;           /* antes 2rem: espacio entre líneas a la mitad */
  scroll-margin-block: 1.5rem;
  overflow: visible;
}

.row-title {
  font-size: calc(1.25rem * var(--ui-font-scale, 1));
  font-weight: 600;
  margin: 0 max(1.5rem, calc(var(--sal) + 1rem)) 0.35rem;
}

.row-track {
  display: flex;
  gap: 1rem;
  overflow-x: auto;
  padding: 1.15rem max(1.5rem, calc(var(--sal) + 1rem)) 0.95rem;
  margin-top: -0.65rem;
  margin-bottom: -0.45rem;
  scroll-padding: 0 max(1.5rem, calc(var(--sal) + 1rem));
  scroll-snap-type: x proximity;
  scrollbar-width: none;
}

.row-track::-webkit-scrollbar {
  display: none;
}

.row-track .lib-card {
  flex: 0 0 auto;
  scroll-snap-align: start;
}

.lib-card {
  position: relative;
  width: calc(140px * var(--ui-scale, 1.32));
  cursor: pointer;
  outline: none;
  transition: transform 0.15s;
  scroll-margin-left: 40px;
  scroll-margin-right: 40px;
}

.lib-card:focus,
.lib-card.dpad-focused {
  z-index: 10;
}

@media (hover: hover) and (pointer: fine) {
  .lib-card:hover {
    z-index: 10;
  }
}

.lib-card-poster {
  position: relative;
  width: calc(140px * var(--ui-scale, 1.32));
  height: calc(200px * var(--ui-scale, 1.32));
  border-radius: 6px;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  align-items: flex-start;
  padding: 0.8rem;
  overflow: hidden;
  text-align: left;
  border: 2px solid transparent;
  background: linear-gradient(160deg, var(--pc, #333) 0%, #111 85%);
  transition: transform 0.15s, border-color 0.15s, box-shadow 0.15s;
}

.lib-card:focus .lib-card-poster,
.lib-card.dpad-focused .lib-card-poster {
  transform: scale(1.08);
  border-color: #fff;
  box-shadow: 0 0 22px rgba(255, 255, 255, 0.45);
  z-index: 12;
}

@media (hover: hover) and (pointer: fine) {
  .lib-card:hover .lib-card-poster {
    transform: scale(1.08);
    border-color: #fff;
    box-shadow: 0 0 22px rgba(255, 255, 255, 0.45);
    z-index: 12;
  }
}

.lib-card-name {
  font-size: calc(0.9rem * var(--ui-font-scale, 1));
  color: #ddd;
  text-align: center;
  line-height: 1.3;
  margin-top: 0.5rem;
  line-height: 1.35;
  height: 2.7em;
  min-height: 2.7em;
  max-height: 2.7em;
  word-break: break-word;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.poster-group {
  position: absolute;
  top: 0.6rem;
  left: 0.7rem;
  font-size: 0.65rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  opacity: 0.75;
}

.poster-name {
  font-size: 1.05rem;
  font-weight: 800;
  line-height: 1.15;
}

.poster-meta {
  font-size: 0.7rem;
  opacity: 0.7;
  margin-top: 0.3rem;
}

.poster-progress {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 4px;
  background: rgba(0, 0, 0, 0.5);
}

.poster-progress i {
  display: block;
  height: 100%;
  background: #e50914;
}

.ep .poster-progress {
  position: static;
  margin-top: 0.4rem;
  border-radius: 2px;
}


/* Carátulas y metadatos: nunca cambian el nombre original. */
.poster-image { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; background: #101010; z-index: 0; }
.lib-card-poster.has-poster,
.lib-card-poster:has(.poster-image) { background: #141414; }
.lib-card-poster.has-poster .poster-name,
.lib-card-poster.has-poster .poster-group,
.lib-card-poster.has-poster .poster-meta,
.lib-card-poster:has(.poster-image) .poster-name,
.lib-card-poster:has(.poster-image) .poster-group,
.lib-card-poster:has(.poster-image) .poster-meta { display: none !important; visibility: hidden !important; }
.poster-progress { z-index: 1; }
.detail {
  position: relative;
  min-height: 100%;
  flex: 1 1 auto;
}

/* ===== Filas con botón expandir en cuadrícula (+) ===== */
.row-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin: 0 max(1.5rem, calc(var(--sal) + 1rem)) 0.35rem;
}

.row-header .row-title {
  margin: 0;
}

/* Mini tarjeta "+" al inicio de la fila para ver cuadrícula */
.row-expand-card {
  flex: 0 0 calc(38px * var(--ui-scale, 1.32)) !important;
  width: calc(38px * var(--ui-scale, 1.32)) !important;
  cursor: pointer;
  outline: none;
  scroll-margin-left: 0;
  scroll-margin-right: 12px;
  display: flex;
  flex-direction: column;
  margin-left: 0 !important;
  margin-right: 0 !important;
}

.row-expand-card-inner {
  width: 100%;
  height: calc(200px * var(--ui-scale, 1.32));
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid transparent;
  background: transparent;
  transition: transform 0.15s, border-color 0.15s, box-shadow 0.15s, background 0.15s;
}

.row-expand-card:focus .row-expand-card-inner,
.row-expand-card:hover .row-expand-card-inner,
.row-expand-card.dpad-focused .row-expand-card-inner {
  transform: scale(1.05);
  border-color: #fff;
  background: rgba(255, 255, 255, 0.18);
  box-shadow: 0 0 16px rgba(255, 255, 255, 0.35);
}

.row-expand-plus {
  font-size: calc(2rem * var(--ui-font-scale, 1));
  font-weight: 300;
  color: #fff;
  line-height: 1;
  pointer-events: none;
  user-select: none;
}

/* ===== Vista en cuadrícula de grupo / categoría ===== */
.grid-screen {
  padding: 1.5rem max(1.5rem, calc(var(--sal) + 1rem)) 4rem;
  min-height: 100%;
  flex: 1 1 auto;
}

.grid-header {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 1.2rem;
  margin-bottom: 2rem;
}

.grid-header-info {
  display: flex;
  flex-direction: column;
  margin-right: auto;
}

.grid-tools {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  margin-left: auto;
}

.grid-sort-bar {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  background: rgba(255, 255, 255, 0.05);
  padding: 0.25rem 0.55rem;
  border-radius: 9999px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  user-select: none;
  max-width: 100%;
}

.grid-sort-label {
  font-size: 0.76rem;
  color: var(--theme-text-muted, #888);
  margin: 0 0.2rem 0 0.3rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.grid-sort-btn {
  appearance: none;
  border: 1px solid transparent;
  background: transparent;
  color: var(--theme-text-muted, #aaa);
  padding: 0.28rem 0.65rem;
  border-radius: 9999px;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
  -webkit-tap-highlight-color: transparent;
  outline: none;
}

@media (hover: hover) and (pointer: fine) {
  .grid-sort-btn:hover {
    color: #fff;
    background: rgba(255, 255, 255, 0.12);
  }
}

.grid-sort-btn:focus-visible,
.grid-sort-btn.dpad-focused {
  color: #fff !important;
  border-color: #fff !important;
  outline: 2px solid #fff !important;
  outline-offset: 2px !important;
  background: rgba(255, 255, 255, 0.22) !important;
  box-shadow: 0 0 10px rgba(255, 255, 255, 0.45) !important;
}

.grid-sort-btn.active {
  color: #fff;
  background: color-mix(in srgb, var(--theme-accent, #e50914) 80%, transparent);
  border-color: var(--theme-accent, #e50914);
}

.grid-filter-unidentified-btn {
  appearance: none;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.04);
  color: var(--theme-text-muted, #aaa);
  padding: 0.28rem 0.65rem;
  border-radius: 9999px;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  margin-left: 0.25rem;
  transition: all 0.15s ease;
  white-space: nowrap;
  -webkit-tap-highlight-color: transparent;
  outline: none;
}

@media (hover: hover) and (pointer: fine) {
  .grid-filter-unidentified-btn:hover {
    color: #fff;
    background: rgba(255, 255, 255, 0.12);
  }
}

.grid-filter-unidentified-btn:focus-visible,
.grid-filter-unidentified-btn.dpad-focused {
  color: #fff !important;
  border-color: #fff !important;
  outline: 2px solid #fff !important;
  outline-offset: 2px !important;
  background: rgba(255, 255, 255, 0.22) !important;
  box-shadow: 0 0 10px rgba(255, 255, 255, 0.45) !important;
}

.grid-filter-unidentified-btn.active {
  color: #fbbf24;
  background: rgba(251, 191, 36, 0.18);
  border-color: rgba(251, 191, 36, 0.5);
}

.grid-filter-unidentified-btn .grid-filter-icon {
  font-size: 0.88rem;
  line-height: 1;
}

.grid-filter-group-btn {
  appearance: none;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.04);
  color: var(--theme-text-muted, #aaa);
  padding: 0.28rem 0.65rem;
  border-radius: 9999px;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  margin-left: 0.25rem;
  transition: all 0.15s ease;
  white-space: nowrap;
  -webkit-tap-highlight-color: transparent;
  outline: none;
}

@media (hover: hover) and (pointer: fine) {
  .grid-filter-group-btn:hover {
    color: #fff;
    background: rgba(255, 255, 255, 0.12);
  }
}

.grid-filter-group-btn:focus-visible,
.grid-filter-group-btn.dpad-focused {
  color: #fff !important;
  border-color: #fff !important;
  outline: 2px solid #fff !important;
  outline-offset: 2px !important;
  background: rgba(255, 255, 255, 0.22) !important;
  box-shadow: 0 0 10px rgba(255, 255, 255, 0.45) !important;
}

.grid-filter-group-btn.active {
  color: #38bdf8;
  background: rgba(56, 189, 248, 0.18);
  border-color: rgba(56, 189, 248, 0.5);
}

.grid-filter-group-btn .grid-filter-icon {
  font-size: 0.88rem;
  line-height: 1;
}

/* ===== Canales Externos - Banners y Categorías ===== */
.externals-view-container {
  max-width: 1350px;
  margin: 0 auto;
  padding: 1.5rem 1.8rem 4rem 1.8rem;
  width: 100%;
  box-sizing: border-box;
}

.ext-theme-section {
  margin-bottom: 2.5rem;
}

.ext-theme-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.externals-top-bar {
  margin-bottom: 2rem;
}

.externals-category-section {
  margin-bottom: 2.2rem;
}

.externals-category-title {
  font-size: 1.25rem;
  font-weight: 700;
  color: #fff;
  margin-bottom: 1rem;
  display: flex;
  align-items: center;
  gap: 0.6rem;
}

.externals-banners-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 1.2rem;
}

.ext-channel-banner {
  background: linear-gradient(135deg, rgba(30, 41, 59, 0.72) 0%, rgba(15, 23, 42, 0.88) 100%);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 14px;
  padding: 1.25rem 1.4rem;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  min-height: 140px;
  position: relative;
  overflow: hidden;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
  transition: transform 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
  user-select: none;
}

.ext-channel-banner:hover {
  transform: translateY(-3px);
  border-color: rgba(255, 255, 255, 0.35) !important;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5) !important;
}

.ext-channel-banner:focus-visible,
.ext-channel-banner.dpad-focused {
  border-color: var(--theme-accent, #e50914) !important;
  outline: 2px solid var(--theme-accent, #e50914) !important;
  outline-offset: 2px !important;
  transform: translateY(-2px);
  box-shadow: 0 0 16px rgba(229, 9, 20, 0.4) !important;
}

.ext-banner-glow {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: linear-gradient(90deg, var(--theme-accent, #e50914), transparent);
}

.ext-banner-badge {
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-weight: 700;
  color: var(--theme-accent, #e50914);
  background: rgba(229, 9, 20, 0.12);
  padding: 0.2rem 0.55rem;
  border-radius: 9999px;
  display: inline-block;
}

.ext-banner-topic-badge {
  font-size: 0.7rem;
  font-weight: 600;
  color: #38bdf8;
  background: rgba(56, 189, 248, 0.15);
  padding: 0.15rem 0.5rem;
  border-radius: 9999px;
  display: inline-block;
}

.ext-banner-title {
  font-size: 1.15rem;
  font-weight: 700;
  color: #fff;
  margin: 0 0 0.35rem 0;
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.ext-banner-sub {
  font-size: 0.82rem;
  color: var(--theme-text-muted, #aaa);
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ext-banner-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 1rem;
  padding-top: 0.75rem;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.ext-banner-count {
  font-size: 0.85rem;
  font-weight: 600;
  color: #e2e8f0;
}

.ext-banner-action {
  font-size: 0.82rem;
  font-weight: 700;
  color: var(--theme-accent, #e50914);
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
}


@media (max-width: 768px) {
  .grid-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.8rem;
  }
  .grid-tools {
    width: 100%;
    margin-left: 0;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    padding-bottom: 0.3rem;
  }
}

.grid-header-info h1 {
  font-size: calc(1.6rem * var(--ui-font-scale, 1));
  font-weight: 700;
  margin: 0 0 0.2rem;
}

.grid-count {
  font-size: 0.9rem;
  color: #aaa;
}

.grid-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(calc(135px * var(--ui-scale, 1.32)), 1fr));
  gap: 1.8rem 1.2rem;
  justify-items: center;
}

.grid-cards .lib-card {
  width: 100%;
  max-width: calc(160px * var(--ui-scale, 1.32));
}

.grid-cards .lib-card-poster {
  width: 100%;
  height: calc(210px * var(--ui-scale, 1.32));
}

@media (max-width: 680px) {
  .row-header {
    margin: 0 max(1rem, var(--sal)) 0.3rem;
    gap: 0.5rem;
  }
  .row-expand-card {
    flex: 0 0 calc(34px * var(--ui-scale, 1.32)) !important;
    width: calc(34px * var(--ui-scale, 1.32)) !important;
  }
  .row-expand-card-inner {
    height: calc(155px * var(--ui-scale, 1.32));
  }
  .row-expand-plus {
    font-size: 1.6rem;
  }
  .grid-screen {
    padding: 1rem max(1rem, var(--sal)) 3rem;
  }
  .grid-cards {
    grid-template-columns: repeat(auto-fill, minmax(105px, 1fr));
    gap: 1.2rem 0.75rem;
  }
  .grid-cards .lib-card-poster {
    height: calc(155px * var(--ui-scale, 1.32));
  }
}


/* ===== Siguiente episodio (cuenta atrás) ===== */
.player-next-up {
  position: absolute;
  right: max(1rem, env(safe-area-inset-left, 0px));
  bottom: max(5.5rem, calc(env(safe-area-inset-bottom, 0px) + 4.5rem));
  z-index: 40;
  pointer-events: auto;
  max-width: min(320px, 80vw);
}
.player-next-up-inner {
  background: rgba(0, 0, 0, 0.82);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 10px;
  padding: 0.75rem 1rem;
  backdrop-filter: blur(8px);
}
.player-next-up-label {
  font-size: 0.8rem;
  color: #bbb;
  margin-bottom: 0.25rem;
}
.player-next-up-count {
  color: #e50914;
  font-weight: 700;
}
.player-next-up-title {
  font-size: 0.95rem;
  color: #fff;
  font-weight: 600;
  line-height: 1.3;
  margin-bottom: 0.5rem;
}
.player-next-up-actions {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.5rem;
}
.player-next-up-play {
  background: #e50914;
  border: 1px solid transparent;
  color: #fff;
  border-radius: 4px;
  padding: 0.35rem 0.8rem;
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
  transition: transform 0.15s ease;
}
.player-next-up-play:hover,
.player-next-up-play:focus,
.player-next-up-play:focus-visible {
  outline: 3px solid #fff;
  outline-offset: 2px;
  box-shadow: 0 0 16px rgba(255, 255, 255, 0.6);
}
.player-next-up-cancel {
  background: transparent;
  border: 1px solid rgba(255,255,255,0.35);
  color: #ddd;
  border-radius: 4px;
  padding: 0.3rem 0.7rem;
  font-size: 0.8rem;
  cursor: pointer;
  transition: transform 0.15s ease;
}
.player-next-up-cancel:hover,
.player-next-up-cancel:focus,
.player-next-up-cancel:focus-visible {
  border-color: #fff;
  color: #fff;
  outline: 3px solid #fff;
  outline-offset: 2px;
  box-shadow: 0 0 16px rgba(255, 255, 255, 0.6);
}



/* Filas de la home pegadas a la izquierda (la primera tarjeta es el "+") */
.home-screen .row-title { margin-left: max(0.6rem, var(--sal, 0px)); }
.home-screen .row-track {
  padding-left: max(0.6rem, var(--sal, 0px));
  scroll-padding-left: max(0.6rem, var(--sal, 0px));
}

/* Navegación por secciones: usa la paleta activa para mantener skins independientes. */
.home-nav {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
  margin: 0 auto 0 2rem;
  padding: 0.25rem;
  -webkit-overflow-scrolling: touch;
  touch-action: pan-x;
  scroll-behavior: smooth;
  scroll-snap-type: x proximity;
  scroll-padding-inline: 1rem;
}
.home-nav::-webkit-scrollbar { display: none; }
.home-nav-item {
  scroll-snap-align: center;
  flex: 0 0 auto;
  border: 1px solid transparent;
  border-radius: 999px;
  padding: 0.55rem 0.9rem;
  background: transparent;
  color: var(--theme-text-muted, #aaa);
  font: inherit;
  cursor: pointer;
  white-space: nowrap;
  transition: color .15s, background .15s, border-color .15s;
  -webkit-tap-highlight-color: transparent;
  outline: none;
  user-select: none;
  -webkit-user-select: none;
}
@media (hover: hover) and (pointer: fine) {
  .home-nav-item:hover {
    color: var(--theme-text, #fff);
    background: rgba(255, 255, 255, 0.12);
  }
}
.home-nav-item:focus {
  outline: none;
}
.home-nav-item:focus-visible,
.home-nav-item.dpad-focused {
  color: var(--theme-text, #fff) !important;
  border-color: #fff !important;
  outline: 2px solid #fff !important;
  outline-offset: 2px !important;
  background: rgba(255, 255, 255, 0.2) !important;
  box-shadow: 0 0 12px rgba(255, 255, 255, 0.45) !important;
}
.home-nav-item.active {
  color: var(--theme-text, #fff);
  background: color-mix(in srgb, var(--theme-accent, #e50914) 22%, transparent);
}
.home-nav-item.active:focus-visible,
.home-nav-item.active.dpad-focused {
  border-color: #fff !important;
  outline: 2px solid #fff !important;
  outline-offset: 2px !important;
  box-shadow: 0 0 12px rgba(255, 255, 255, 0.45) !important;
}
.category-view { padding: 0 max(1.5rem, calc(var(--sal) + 1rem)) 3rem; }
.category-header {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 1rem;
  margin-bottom: 1.2rem;
}
/* Herramientas de ordenación y vistas en la barra de arriba (carrusel y cuadrícula) */
.category-header--in-header {
  display: inline-flex;
  align-items: center;
  gap: 0.6rem;
  margin: 0 1.2rem;
  flex: 0 0 auto;
}

@media (max-width: 760px) {
  .category-header--in-header {
    order: 4;
    width: 100%;
    margin: 0.35rem 0 0;
    justify-content: center;
  }
}

/* Distintivo de Edad Recomendada (Ficha y Carrusel) */
.age-rating-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: inherit;
  font-size: 0.76rem;
  font-weight: 800;
  line-height: 1;
  padding: 0.12rem 0.4rem;
  border-radius: 4px;
  border: 1px solid currentColor;
  background: rgba(0, 0, 0, 0.45);
  letter-spacing: 0.4px;
  margin-left: 0.4rem;
  vertical-align: middle;
  position: relative;
  top: -1.5px; /* subida ligerísimamente para alineación perfecta con la puntuación */
  text-transform: uppercase;
}

.age-rating-badge.age-rating--apta {
  color: #0284c7 !important; /* Azul celeste tirando a azul, como el de Añadir a colección */
  border-color: #0284c7 !important;
  background: rgba(2, 132, 199, 0.15) !important;
}

.age-rating-badge.age-rating--nr {
  color: #94a3b8 !important;
  border-color: #94a3b8 !important;
  background: rgba(148, 163, 184, 0.16) !important;
}

.age-rating-badge.age-rating--7 {
  color: #22c55e !important; /* Verde */
  border-color: #22c55e !important;
  background: rgba(34, 197, 94, 0.15) !important;
}

.age-rating-badge.age-rating--12 {
  color: #eab308 !important; /* Amarillo */
  border-color: #eab308 !important;
  background: rgba(234, 179, 8, 0.15) !important;
}

.age-rating-badge.age-rating--16 {
  color: #f97316 !important; /* Naranja fuerte */
  border-color: #f97316 !important;
  background: rgba(249, 115, 22, 0.15) !important;
}

.age-rating-badge.age-rating--18 {
  color: #ff3333 !important; /* Rojo llamativo */
  border-color: #ff3333 !important;
  background: rgba(255, 51, 51, 0.16) !important;
}

.age-rating-badge.age-rating--x {
  color: #ff3333 !important; /* Rojo llamativo */
  border-color: #ff3333 !important;
  background: rgba(255, 51, 51, 0.16) !important;
}
.category-title { display: none; }
.category-sort-bar:not(.search-bar) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  background: rgba(255, 255, 255, 0.05);
  padding: 0.25rem 0.55rem;
  border-radius: 9999px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  margin: 0;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  position: relative;
  user-select: none;
}
.category-sort-toggle {
  appearance: none;
  border: 1px solid transparent;
  background: transparent;
  color: var(--theme-text-muted, #aaa);
  padding: 0.3rem 0.65rem;
  border-radius: 9999px;
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  transition: all 0.15s ease;
  white-space: nowrap;
  -webkit-tap-highlight-color: transparent;
  outline: none;
}
@media (hover: hover) and (pointer: fine) {
  .category-sort-toggle:hover {
    color: #fff;
    background: rgba(255, 255, 255, 0.12);
  }
}
.category-sort-toggle:focus {
  outline: none;
}
.category-sort-toggle:focus-visible,
.category-sort-toggle.dpad-focused {
  color: #fff !important;
  border-color: #fff !important;
  outline: 2px solid #fff !important;
  outline-offset: 2px !important;
  background: rgba(255, 255, 255, 0.22) !important;
  box-shadow: 0 0 10px rgba(255, 255, 255, 0.45) !important;
}
.category-sort-label {
  font-size: 0.85rem;
  color: var(--theme-text-muted, #888);
  margin-right: 0.1rem;
  font-weight: 500;
}
.category-sort-icon {
  font-size: 1.15rem; /* Más grande para indicar claramente el sentido de ordenación */
  font-weight: 800;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--theme-accent, #e50914);
  line-height: 1;
  vertical-align: middle;
  margin-left: 0.15rem;
}
.category-sort-options {
  display: none;
  align-items: center;
  gap: 0.35rem;
}
.category-sort-bar.is-expanded .category-sort-options {
  display: inline-flex;
  animation: fadeInSort 0.16s cubic-bezier(0.16, 1, 0.3, 1);
}
@keyframes fadeInSort {
  from {
    opacity: 0;
    transform: translateX(-6px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}
.category-sort-btn {
  appearance: none;
  border: 1px solid transparent;
  background: transparent;
  color: var(--theme-text-muted, #aaa);
  padding: 0.35rem 0.85rem;
  border-radius: 9999px;
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
  -webkit-tap-highlight-color: transparent;
  outline: none;
}
@media (hover: hover) and (pointer: fine) {
  .category-sort-btn:hover {
    color: #fff;
    background: rgba(255, 255, 255, 0.15);
  }
}
.category-sort-btn:focus {
  outline: none;
}
.category-sort-btn:focus-visible,
.category-sort-btn.dpad-focused {
  color: #fff !important;
  border-color: #fff !important;
  outline: 2px solid #fff !important;
  outline-offset: 2px !important;
  background: rgba(255, 255, 255, 0.22) !important;
  box-shadow: 0 0 10px rgba(255, 255, 255, 0.45) !important;
}
.category-sort-btn.active {
  color: #fff;
  background: color-mix(in srgb, var(--theme-accent, #e50914) 75%, transparent);
  border-color: var(--theme-accent, #e50914);
}
.category-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(calc(140px * var(--ui-scale, 1.32)), 1fr)); gap: 1.8rem 1rem; justify-items: center; }
.category-grid .lib-card { width: 100%; max-width: calc(160px * var(--ui-scale, 1.32)); }
.category-grid .lib-card-poster { width: 100%; height: calc(210px * var(--ui-scale, 1.32)); }
@media (max-width: 760px) {
  .home-header { flex-wrap: wrap; gap: .5rem; }
  .home-nav {
    order: 3;
    width: 100%;
    margin: 0;
    padding-inline: 1rem;
    -webkit-overflow-scrolling: touch;
    touch-action: pan-x;
    scroll-behavior: smooth;
    scroll-snap-type: x proximity;
    scroll-padding-inline: 1rem;
    justify-content: flex-start;
  }
  .category-view { padding-inline: max(1rem, var(--sal)); }
  .category-header { justify-content: center; align-items: center; gap: 0.75rem; }
  .category-sort-bar { justify-content: center; }
  .category-grid { grid-template-columns: repeat(auto-fill, minmax(105px, 1fr)); gap: 1.2rem .75rem; }
  .category-grid .lib-card-poster { height: calc(155px * var(--ui-scale, 1.32)); }
}

.btn-icon:focus,
.home-profile:focus {
  outline: none;
}
.btn-icon:focus-visible,
.btn-icon.dpad-focused,
.home-profile:focus-visible,
.home-profile.dpad-focused {
  outline: 2px solid #fff !important;
  outline-offset: 2px !important;
  border-color: #fff !important;
  background: rgba(255, 255, 255, 0.25) !important;
  box-shadow: 0 0 12px rgba(255, 255, 255, 0.5) !important;
}

/* ── Búsqueda ─────────────────────────────── */
.nav-search-btn { display: inline-flex; align-items: center; justify-content: center; min-width: 2.4em; padding-left: .7em; padding-right: .7em; }
.nav-search-icon { font-size: 1em; line-height: 1; filter: grayscale(1) brightness(1.6); }
.nav-search-btn.active .nav-search-icon { filter: none; }
.search-bar { display: flex; align-items: center; gap: .6rem; width: 100%; max-width: 720px; margin: 0 auto;
  padding: .35rem .5rem .35rem 1rem; border-radius: 999px; background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.12); }
.search-bar:focus-within { border-color: rgba(255,255,255,.45); background: rgba(255,255,255,.12); }
.search-bar-icon { opacity: .6; flex: none; }
.search-input { flex: 1; min-width: 0; background: transparent; border: 0; outline: 0; color: inherit; font: inherit; font-size: 1.05rem; padding: .45rem 0; }
.search-input::-webkit-search-cancel-button { display: none; }
.search-clear { flex: none; width: 2rem; height: 2rem; border-radius: 50%; border: 0; background: rgba(255,255,255,.12); color: inherit; cursor: pointer; }
.search-clear:focus-visible, .search-clear.dpad-focused { outline: 2px solid currentColor; }
.search-status { text-align: center; opacity: .6; font-size: .9rem; margin: .8rem 0 1rem; }
@media (max-width: 600px) { .search-bar { max-width: none; } .search-input { font-size: 16px; } }


/* Notificación de nueva versión sobre el avatar de perfil */
.home-profile {
  position: relative !important;
}
.profile-update-dot {
  position: absolute;
  top: -2px;
  right: -2px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #ef4444;
  border: 2px solid #141414;
  box-shadow: 0 0 10px rgba(239, 68, 68, 0.9);
  pointer-events: none;
  animation: pulse-update-dot 2s infinite ease-in-out;
  z-index: 10;
}
@keyframes pulse-update-dot {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.2); opacity: 0.85; }
}
.avatar img, .avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: inherit;
  display: block;
}


/* =========================================================
   Optimizaciones de rendimiento exclusivas para Android TV
   Desactivar backdrop-filter (coste altísimo en GPU modestas)
   y asegurar fluidez a 60 fps en el scroll
   ========================================================= */
html.is-tv .home-header,
html.is-tv .home-header--carousel,
html.is-tv .category-view,
html.is-tv .category-sort-options,
html.is-tv .modal-backdrop,
html.is-tv .dialog-overlay {
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}

html.is-tv .home-header,
html.is-tv .home-header--carousel {
  background: rgba(15, 15, 15, 0.95) !important;
}

html.is-tv .category-sort-options {
  background: rgba(20, 20, 20, 0.98) !important;
}

/* Modales en Android TV: ajuste de altura máxima y márgenes para aprovechar la pantalla completa */
html.is-tv .settings-overlay {
  padding: 0.4rem 0.75rem !important;
}
html.is-tv .settings-dialog {
  max-height: 97vh !important;
}

/* Punto 6: En cuadrícula, separación ligera hacia abajo y letra en negrita */
.grid-cards .lib-card-name,
.category-grid .lib-card-name,
.category-view--grid .lib-card-name,
.grid-screen .lib-card-name,
.screen.grid-screen .lib-card-name {
  margin-top: 0.65rem !important;
  font-weight: 700 !important;
}
```

---

## Archivo: `src/styles/carousel.css`

```css
/* src/styles/carousel.css */
/* Vista en carrusel de las pestañas de categoría. Usa las variables del tema (skins). */

/* ---- Cabecera en modo carrusel: barra superior sólida con herramientas integradas ---- */
.home-screen--carousel .home-header--carousel {
  position: sticky;
  top: 0;
  z-index: 100;
  background: rgba(20, 20, 20, 0.95);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

/* Herramientas de ordenación y vistas en la barra de arriba en modo carrusel */
.category-header--in-header {
  display: inline-flex;
  align-items: center;
  gap: 0.6rem;
  margin: 0 1.2rem;
  flex: 0 0 auto;
}

@media (max-width: 760px) {
  .category-header--in-header {
    order: 4;
    width: 100%;
    margin: 0.35rem 0 0;
    justify-content: center;
  }
}

/* ---- La home en modo carrusel: sube un poco hacia arriba para maximizar el espacio ---- */
.home-main--carousel {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  overflow: hidden;
  padding-top: 0.15rem;
  margin-top: -0.35rem;
  padding-bottom: 0.6rem;
}

.home-screen--carousel .category-view {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 0;
}

/* ---- Barra de modos de vista y ordenación ---- */
.category-header {
  flex-wrap: wrap;
  gap: 0.6rem 1rem;
}

.category-sort-bar {
  flex: 0 0 auto;
}

.category-views-bar {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  background: var(--theme-card-bg, rgba(255, 255, 255, 0.05));
  border: 1px solid var(--theme-border, rgba(255, 255, 255, 0.12));
  border-radius: 9999px;
  padding: 0.25rem 0.55rem 0.25rem 0.85rem;
  font-size: 0.85rem;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

.category-views-label {
  color: var(--theme-text-muted, #aaa);
  font-weight: 500;
  user-select: none;
}

.category-view-btn {
  appearance: none;
  border: 1px solid rgba(255, 255, 255, 0.2);
  background: rgba(255, 255, 255, 0.1);
  color: var(--theme-text, #fff);
  padding: 0.35rem 0.95rem;
  border-radius: 9999px;
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.18s ease;
  line-height: 1.2;
}

.category-view-btn:hover {
  background: rgba(255, 255, 255, 0.22);
  border-color: rgba(255, 255, 255, 0.45);
  color: #fff;
}

.category-view-btn:focus {
  outline: none;
}

.category-view-btn:focus-visible,
.category-view-btn.dpad-focused {
  border-color: #fff !important;
  outline: 2px solid #fff !important;
  outline-offset: 2px !important;
  background: rgba(255, 255, 255, 0.3) !important;
  color: #fff !important;
  box-shadow: 0 0 10px rgba(255, 255, 255, 0.5) !important;
}

.carousel-host {
  flex: 1 1 auto;
  min-height: 0;
  height: 100%;
  overflow: hidden;
}

/* ---- Contenedor del Carrusel ---- */
.carousel-view {
  --car-h: 520px;
  height: 100%;
  max-height: 100%;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  min-height: 0;
  overflow: hidden;
}

/* ---- Escenario / Pista de Portadas ---- */
.carousel-stage {
  position: relative;
  overflow: hidden !important;
  outline: none;
  flex: 0 0 auto;
  height: clamp(340px, 52vh, 460px);
  padding: 24px 0;
  box-sizing: border-box;
  border-radius: 12px;
  scroll-behavior: auto !important;
  user-select: none;
}

.carousel-track {
  position: relative !important;
  left: 0;
  top: 0;
  display: flex;
  align-items: center;
  gap: 0.85rem;
  height: 100%;
  width: max-content;
  transition: transform 0.24s cubic-bezier(0.16, 1, 0.3, 1);
  will-change: transform;
}

/* En modo portadas, las no enfocadas están un poco más juntas */
.carousel-mode-posters .carousel-track {
  gap: 0.45rem;
}

/* Tarjeta en modo portadas: dimensiones fijas, las no enfocadas más juntas y a escala 0.88 */
.carousel-item {
  flex: 0 0 auto !important;
  height: clamp(170px, 25vh, 235px) !important;
  box-sizing: border-box !important;
  aspect-ratio: 2 / 3 !important;
  width: auto !important;
  max-width: none !important;
  min-width: 0 !important;
  border-radius: 10px;
  overflow: hidden;
  background: linear-gradient(160deg, var(--pc, #333), #151515);
  display: flex;
  align-items: center;
  justify-content: center;
  transform: scale(0.88);
  opacity: 0.52;
  /* Se excluye margin de transition para que el cálculo de centrado no sufra retardo ni desvíos laterales */
  transition: transform 0.24s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.22s ease, box-shadow 0.22s ease;
  cursor: pointer;
}

/* Portada seleccionada pero cuando el escenario NO tiene el foco (foco en pestañas o botones) */
.carousel-item.is-active {
  transform: scale(1.68) !important;
  margin: 0 4.25rem !important;
  opacity: 0.82 !important;
  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.4), 0 4px 16px rgba(0, 0, 0, 0.7) !important;
  z-index: 4;
}

/* Portada cuando el carrusel SÍ tiene el foco activo (teclado/mando) */
.carousel-stage:focus .carousel-item.is-active,
.carousel-stage:focus-visible .carousel-item.is-active,
.carousel-stage.dpad-focused .carousel-item.is-active {
  transform: scale(1.76) !important;
  margin: 0 4.25rem !important;
  opacity: 1 !important;
  box-shadow: 0 0 0 3px #fff, 0 0 28px rgba(255, 255, 255, 0.65), 0 10px 30px rgba(0, 0, 0, 0.9) !important;
  z-index: 6;
}

.carousel-poster {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

/* ---- MODO LOGOS: fondos transparentes, escala idéntica a fichas, sin cajas oscuras ---- */
.carousel-mode-logos .carousel-stage {
  position: relative;
  overflow: hidden !important;
  outline: none;
  flex: 0 0 auto;
  height: calc(clamp(110px, 18vh, 140px) * var(--carousel-logos-scale, 1)) !important;
  padding: 8px 0;
  margin-top: clamp(0.75rem, 2.5vh, 1.4rem);
  box-sizing: border-box;
  border-radius: 12px;
  scroll-behavior: auto !important;
  user-select: none;
}

.carousel-mode-logos .carousel-track {
  gap: calc(1.35rem * var(--carousel-logos-scale, 1));
}

.carousel-mode-logos .carousel-item {
  flex: 0 0 auto !important;
  height: 100% !important;
  box-sizing: border-box !important;
  width: calc(250px * var(--carousel-logos-scale, 1)) !important;
  max-width: calc(250px * var(--carousel-logos-scale, 1)) !important;
  min-width: calc(250px * var(--carousel-logos-scale, 1)) !important;
  aspect-ratio: unset !important;
  border-radius: 10px;
  overflow: visible;
  background: transparent !important;
  border: none !important;
  box-shadow: none !important;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px 10px;
  transform: scale(0.88);
  opacity: 0.55;
  transition: transform 0.22s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.22s ease, filter 0.22s ease;
  cursor: pointer;
}

.carousel-mode-logos .carousel-logo {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  display: block;
  filter: drop-shadow(0 2px 5px rgba(0, 0, 0, 0.7));
  transition: filter 0.22s ease;
}

/* Logo activo cuando el carrusel NO tiene el foco */
.carousel-mode-logos .carousel-item.is-active {
  transform: scale(1.03) !important;
  opacity: 0.8 !important;
  background: transparent !important;
  box-shadow: none !important;
  z-index: 4;
}

.carousel-mode-logos .carousel-item.is-active .carousel-logo {
  filter: drop-shadow(0 0 8px rgba(255, 255, 255, 0.4)) drop-shadow(0 2px 6px rgba(0, 0, 0, 0.8)) !important;
}

/* Logo activo cuando el carrusel SÍ tiene el foco */
.carousel-mode-logos .carousel-stage:focus .carousel-item.is-active,
.carousel-mode-logos .carousel-stage:focus-visible .carousel-item.is-active,
.carousel-mode-logos .carousel-stage.dpad-focused .carousel-item.is-active {
  transform: scale(1.06) !important;
  opacity: 1 !important;
  background: transparent !important;
  box-shadow: none !important;
  z-index: 6;
}

.carousel-mode-logos .carousel-stage:focus .carousel-item.is-active .carousel-logo,
.carousel-mode-logos .carousel-stage:focus-visible .carousel-item.is-active .carousel-logo,
.carousel-mode-logos .carousel-stage.dpad-focused .carousel-item.is-active .carousel-logo {
  filter: drop-shadow(0 0 20px rgba(255, 255, 255, 0.95)) drop-shadow(0 2px 10px rgba(0, 0, 0, 0.95)) !important;
}

.carousel-mode-logos .carousel-fallback {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 8px;
  padding: 0.5rem 0.9rem;
  font-size: 0.92rem;
  color: #fff;
  font-weight: 700;
  text-align: center;
  max-width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.carousel-fallback {
  padding: 0.6rem;
  text-align: center;
  font-weight: 700;
  line-height: 1.25;
  font-size: clamp(0.8rem, calc(var(--car-h, 520px) * 0.03), 1.2rem);
  word-break: break-word;
}

.carousel-nav {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 2.4rem;
  height: 2.4rem;
  border-radius: 50%;
  border: 1px solid var(--theme-border, rgba(255, 255, 255, 0.2));
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 1.6rem;
  line-height: 1;
  cursor: pointer;
  z-index: 2;
}
.carousel-nav.prev { left: 0.4rem; }
.carousel-nav.next { right: 0.4rem; }
@media (hover: none) { .carousel-nav { display: none; } }

/* ---- Información, Sinopsis y Tráiler ---- */
.carousel-info {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 0.35rem;
  padding: 0 max(0.5rem, var(--sal, 0px)) 1rem;
  overflow-y: auto;
}
.carousel-title {
  margin: 0;
  font-size: clamp(1.1rem, calc(var(--car-h, 520px) * 0.045), 1.8rem);
  line-height: 1.2;
  max-width: 90%;
}
.carousel-mode-logos .carousel-title { display: none; }
.carousel-meta {
  color: var(--theme-text-muted, #aaa);
  font-size: clamp(0.8rem, calc(var(--car-h, 520px) * 0.026), 0.98rem);
}

.carousel-mode-logos .carousel-info {
  gap: 0.5rem;
  margin-top: 0.35rem;
}

.carousel-trailer {
  position: relative;
  flex: 0 0 auto;
  height: clamp(160px, 34vh, 280px);
  max-width: 90%;
  aspect-ratio: 16 / 9;
  background: #000;
  border-radius: 12px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* En el carrusel de logos, el tráiler aparece proporcional a la escala de logos */
.carousel-mode-logos .carousel-trailer {
  height: calc(clamp(200px, 46vh, 380px) * var(--carousel-logos-scale, 1));
  max-height: calc(52vh * var(--carousel-logos-scale, 1));
  max-width: 95%;
  aspect-ratio: 16 / 9;
}
.carousel-trailer-wrap {
  position: relative;
  width: 100%;
  height: 100%;
}
.carousel-trailer iframe,
.carousel-trailer-wrap iframe {
  width: 100%;
  height: 100%;
  border: 0;
  pointer-events: auto;
}
html.is-tv .carousel-trailer iframe,
html.is-tv .carousel-trailer-wrap iframe {
  pointer-events: none;
}
.carousel-trailer-tag {
  position: absolute;
  top: 8px;
  left: 8px;
  background: rgba(0, 0, 0, 0.82);
  color: #fff;
  font-size: 0.72rem;
  font-weight: 600;
  padding: 3px 8px;
  border-radius: 4px;
  pointer-events: none;
  z-index: 2;
  max-width: calc(100% - 16px);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  backdrop-filter: blur(6px);
  border: 1px solid rgba(255, 255, 255, 0.2);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.6);
}
.carousel-trailer-msg { color: var(--theme-text-muted, #aaa); font-size: 0.9rem; padding: 0.5rem; }

.carousel-syn {
  margin: 0;
  max-width: min(60rem, 92%);
  font-size: clamp(0.8rem, calc(var(--car-h, 520px) * 0.028), 1rem);
  line-height: 1.45;
  color: var(--theme-text, #fff);
  opacity: 0.9;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 5;
  line-clamp: 5;
  overflow: hidden;
}

/* ---- Botón Tráiler a pantalla completa (modo portadas) ---- */
.carousel-trailer-action {
  flex: 0 0 auto;
  margin-top: 0.35rem;
  margin-bottom: 0.35rem;
}
.carousel-trailer-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.45rem;
  padding: 0.5rem 1.4rem;
  border-radius: 9999px;
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
  border: 1px solid rgba(255, 255, 255, 0.28);
  font-size: calc(0.92rem * var(--ui-font-scale, 1));
  font-weight: 600;
  cursor: pointer;
  transition: all 0.18s ease;
  backdrop-filter: blur(8px);
  -webkit-tap-highlight-color: transparent;
}
.carousel-trailer-btn:hover {
  background: rgba(255, 255, 255, 0.24);
  border-color: rgba(255, 255, 255, 0.45);
  transform: scale(1.03);
}
.carousel-trailer-btn:focus { outline: none; }
.carousel-trailer-btn:focus-visible,
.carousel-trailer-btn.dpad-focused {
  color: #fff !important;
  border-color: #fff !important;
  outline: 2px solid #fff !important;
  outline-offset: 2px !important;
  background: rgba(255, 255, 255, 0.32) !important;
  box-shadow: 0 0 12px rgba(255, 255, 255, 0.5) !important;
  transform: scale(1.05);
}
.carousel-trailer-btn .carousel-trailer-icon {
  font-size: 0.8em;
  display: inline-block;
}

.carousel-count { flex: 0 0 auto; color: var(--theme-text-muted, #aaa); font-size: 0.75rem; }

/* ---- Modal Tráiler a Pantalla Completa ---- */
.carousel-trailer-modal {
  position: fixed;
  inset: 0;
  z-index: 99999;
  background: rgba(0, 0, 0, 0.96);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: max(1rem, env(safe-area-inset-top, 0px)) max(1rem, env(safe-area-inset-right, 0px)) max(1rem, env(safe-area-inset-bottom, 0px)) max(1rem, env(safe-area-inset-left, 0px));
  box-sizing: border-box;
  animation: trailerModalFadeIn 0.2s ease-out;
}
.carousel-trailer-modal.closing {
  animation: trailerModalFadeOut 0.2s ease-in forwards;
}
@keyframes trailerModalFadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes trailerModalFadeOut {
  from { opacity: 1; }
  to { opacity: 0; }
}
.carousel-trailer-backdrop {
  position: absolute;
  inset: 0;
  z-index: 1;
  background: transparent;
  cursor: pointer;
}

.carousel-trailer-player-box,
.carousel-trailer-content {
  position: relative;
  z-index: 2;
  width: 100%;
  max-width: 1100px;
  height: auto;
  max-height: 92vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.65rem;
}

.carousel-trailer-header,
.carousel-trailer-bar {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.8rem;
  padding: 0 0.2rem;
  box-sizing: border-box;
}

.carousel-trailer-title-wrap,
.carousel-trailer-info {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  min-width: 0;
  flex: 1;
}

.carousel-trailer-badge,
.carousel-trailer-seq-badge {
  color: #fff;
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.5px;
  background: var(--theme-accent, #e50914);
  padding: 3px 8px;
  border-radius: 4px;
  white-space: nowrap;
  line-height: 1.2;
}

.carousel-trailer-main-title {
  color: #fff;
  font-size: 1.15rem;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.carousel-trailer-part-title {
  color: var(--theme-text-muted, #aaa);
  font-size: 0.95rem;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.carousel-trailer-close-btn,
.carousel-trailer-close {
  width: 40px;
  height: 40px;
  min-width: 40px;
  min-height: 40px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.25);
  background: rgba(30, 30, 30, 0.85);
  color: #fff;
  font-size: 1.15rem;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.15s ease;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  -webkit-tap-highlight-color: transparent;
  flex-shrink: 0;
}

.carousel-trailer-close-btn:hover,
.carousel-trailer-close:hover {
  background: rgba(255, 255, 255, 0.25);
  border-color: #fff;
  transform: scale(1.08);
}

.carousel-trailer-close-btn:focus,
.carousel-trailer-close:focus { outline: none; }
.carousel-trailer-close-btn:focus-visible,
.carousel-trailer-close-btn.dpad-focused,
.carousel-trailer-close:focus-visible,
.carousel-trailer-close.dpad-focused {
  outline: 2px solid #fff !important;
  outline-offset: 2px !important;
  border-color: #fff !important;
  background: rgba(255, 255, 255, 0.4) !important;
  box-shadow: 0 0 12px rgba(255, 255, 255, 0.5) !important;
  transform: scale(1.08);
}

.carousel-trailer-frame-container,
.carousel-trailer-frame-wrap {
  width: 100%;
  max-width: 1100px;
  position: relative;
  aspect-ratio: 16 / 9;
  max-height: calc(88vh - 70px);
  background: #000;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 12px 48px rgba(0, 0, 0, 0.9);
  border: 1px solid rgba(255, 255, 255, 0.12);
  transform: translateZ(0);
}

.carousel-trailer-frame-container iframe,
.carousel-trailer-frame-wrap iframe {
  width: 100%;
  height: 100%;
  border: 0;
  display: block;
  background: #000;
}

@supports not (aspect-ratio: 16 / 9) {
  .carousel-trailer-frame-container,
  .carousel-trailer-frame-wrap {
    height: 0;
    padding-top: 56.25%;
  }
  .carousel-trailer-frame-container iframe,
  .carousel-trailer-frame-wrap iframe {
    position: absolute;
    top: 0;
    left: 0;
  }
}

.carousel-trailer-controls {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.8rem;
  margin-top: 0.35rem;
}

.carousel-trailer-nav-btn {
  border: 1px solid rgba(255, 255, 255, 0.25);
  background: rgba(30, 30, 30, 0.85);
  color: #fff;
  font-size: 0.88rem;
  font-weight: 600;
  padding: 0.4rem 1.1rem;
  border-radius: 9999px;
  cursor: pointer;
  transition: all 0.15s ease;
  backdrop-filter: blur(8px);
}

.carousel-trailer-nav-btn:hover {
  background: rgba(255, 255, 255, 0.25);
  border-color: #fff;
  transform: scale(1.04);
}

.carousel-trailer-nav-btn:focus-visible,
.carousel-trailer-nav-btn.dpad-focused {
  outline: 2px solid #fff !important;
  outline-offset: 2px !important;
  background: rgba(255, 255, 255, 0.35) !important;
  box-shadow: 0 0 10px rgba(255, 255, 255, 0.5) !important;
}

.carousel-trailer-counter {
  color: var(--theme-text-muted, #aaa);
  font-size: 0.85rem;
  font-weight: 600;
}

@media (max-width: 760px) {
  .carousel-trailer-header,
  .carousel-trailer-bar {
    flex-wrap: wrap;
    gap: 0.4rem;
  }
  .carousel-trailer-main-title {
    font-size: 1rem;
  }
  .carousel-trailer-part-title {
    font-size: 0.82rem;
  }
  .carousel-trailer-close-btn,
  .carousel-trailer-close {
    width: 38px;
    height: 38px;
    font-size: 1.1rem;
  }
}

/* Fire TV / Android TV: el vídeo de YouTube se pinta en una capa de hardware.
   Esquinas redondeadas + overflow:hidden + transform + animaciones de opacidad
   obligan a recortarlo y la imagen sale negra (los subtítulos sí se ven). */
html.is-tv .carousel-trailer,
html.is-tv .carousel-trailer-frame-container,
html.is-tv .carousel-trailer-frame-wrap {
  border-radius: 0 !important;
  overflow: visible !important;
  transform: none !important;
  box-shadow: none !important;
  filter: none !important;
}
html.is-tv .carousel-trailer-modal,
html.is-tv .carousel-trailer-modal.closing {
  animation: none !important;
  opacity: 1 !important;
  background: #000;
}


/* =========================================================
   Rendimiento en Android TV / Fire TV para vista Carrusel
   ========================================================= */
html.is-tv .carousel-view,
html.is-tv .carousel-item,
html.is-tv .carousel-details-pane,
html.is-tv .carousel-trailer-modal {
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}
/* ==========================================================================
   Escala de portadas y letras en Carrusel Portadas (Ajustes de dispositivo)
   Afecta exclusivamente a portadas y textos del carrusel, nunca a Ordenar/Vista.
   El nivel -3 (escala 0.85) equivale al valor de Enorme previo (1.32 / 1.12 = 1.1786).
   Factor de escala = var(--ui-scale, 1.32) * 1.3865.
   ========================================================================== */
.carousel-mode-posters .carousel-stage {
  height: calc(clamp(340px, 52vh, 460px) * var(--carousel-posters-scale, 1.83));
}

.carousel-mode-posters .carousel-item {
  height: calc(clamp(170px, 25vh, 235px) * var(--carousel-posters-scale, 1.83)) !important;
}

.carousel-mode-posters .carousel-item.is-active,
.carousel-mode-posters .carousel-stage:focus .carousel-item.is-active,
.carousel-mode-posters .carousel-stage:focus-visible .carousel-item.is-active,
.carousel-mode-posters .carousel-stage.dpad-focused .carousel-item.is-active {
  margin: 0 calc(4.25rem * var(--carousel-posters-scale, 1.83)) !important;
}

.carousel-mode-posters .carousel-title {
  font-size: calc(clamp(1.1rem, calc(var(--car-h, 520px) * 0.045), 1.8rem) * var(--carousel-posters-scale, 1.83));
}

.carousel-mode-posters .carousel-meta {
  font-size: calc(clamp(0.8rem, calc(var(--car-h, 520px) * 0.026), 0.98rem) * var(--carousel-posters-scale, 1.83));
}

.carousel-mode-posters .carousel-synopsis {
  font-size: calc(clamp(0.85rem, calc(var(--car-h, 520px) * 0.028), 1.05rem) * var(--carousel-posters-scale, 1.83));
}

.carousel-mode-posters .carousel-count {
  font-size: calc(0.8rem * var(--carousel-posters-scale, 1.83));
}

.carousel-mode-posters .age-rating-badge {
  font-size: calc(0.76rem * var(--carousel-posters-scale, 1.83));
}
/* Punto 11: En modo carrusel portadas, elevar ligeramente la info bajo la portada */
.carousel-mode-posters .carousel-stage {
  padding-bottom: 23.5px !important;
}

.carousel-mode-posters .carousel-info {
  position: relative !important;
  top: -0.5px !important;
  transform: translateY(-0.5px) !important;
}

```

---

## Archivo: `src/style-base.css`

```css
/* src/style.css */
/* Prevenir zoom automático al enfocar inputs en móviles y fijar viewport */
input, select, textarea {
  font-size: 16px !important;
  touch-action: manipulation;
}
html, body {
  touch-action: pan-x pan-y;
  overscroll-behavior: none;
}
* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

/* Áreas seguras para iPhone (Notch, Dynamic Island) y Android */
:root {
  --sat: env(safe-area-inset-top, 0px);
  --sab: env(safe-area-inset-bottom, 0px);
  --sal: env(safe-area-inset-left, 0px);
  --sar: env(safe-area-inset-right, 0px);
  --ui-scale: 1.12;
  --ui-font-scale: calc(var(--ui-scale, 1.12) / 1.12);
}

html, body {
  height: 100%;
  background: #141414;
  color: #fff;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  -webkit-font-smoothing: antialiased;
}

.screen {
  min-height: 100vh;
  padding: 2rem;
  padding-left: max(1.5rem, calc(var(--sal) + 1rem));
  padding-right: max(1.5rem, calc(var(--sar) + 1rem));
}

.screen.center {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
}

.btn {
  background: #e50914;
  color: white;
  border: none;
  padding: 0.75rem 1.8rem;
  font-size: 1rem;
  border-radius: 4px;
  cursor: pointer;
  font-weight: 600;
  transition: background 0.15s;
}

.btn:hover {
  background: #f6121d;
}

.loader {
  width: 40px;
  height: 40px;
  border: 3px solid #333;
  border-top-color: #e50914;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  margin-bottom: 1rem;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* ===== Selector de perfiles ===== */
.profiles-screen {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  position: relative;
  padding-top: max(2rem, calc(var(--sat) + 1rem));
  padding-bottom: max(2rem, calc(var(--sab) + 1rem));
}

.profiles-title {
  font-size: 2.2rem;
  font-weight: 400;
  margin-bottom: 2.5rem;
  text-align: center;
}

.profiles-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 2rem;
  justify-content: center;
  max-width: 900px;
}

.profile-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.9rem;
  cursor: pointer;
  transition: transform 0.15s;
}

.profile-card:hover {
  transform: scale(1.08);
}

.profile-card:hover .avatar {
  outline: 3px solid #fff;
}

.avatar {
  width: 120px;
  height: 120px;
  border-radius: 8px;
  background: #333;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 3rem;
  font-weight: 700;
  color: #fff;
  transition: outline 0.15s;
}

.avatar.small {
  width: 38px;
  height: 38px;
  font-size: 1.05rem;
  border-radius: 50%;
  background: #333;
  border: 2px solid transparent;
  transition: border-color 0.15s, transform 0.1s;
}

.avatar.add {
  background: #1a1a1a;
  font-size: 4rem;
  font-weight: 300;
  color: #888;
}

.profile-card.add-profile:hover .avatar.add {
  background: #e50914;
  color: #fff;
  outline: none;
}

.profile-name {
  font-size: 1.05rem;
  color: #ccc;
  text-align: center;
}

.profile-card:hover .profile-name {
  color: #fff;
}

.logout-btn {
  position: fixed;
  bottom: max(1.5rem, calc(var(--sab) + 1rem));
  right: max(1.5rem, calc(var(--sar) + 1rem));
  background: transparent;
  border: 1px solid #555;
  color: #888;
  padding: 0.45rem 1rem;
  font-size: 0.85rem;
  border-radius: 4px;
  cursor: pointer;
}

.logout-btn:hover {
  border-color: #888;
  color: #ccc;
}

/* ===== Home / Cabecera ===== */
.home-screen {
  padding: 0;
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

.home-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: max(0.9rem, calc(var(--sat) + 0.5rem));
  padding-bottom: 0.8rem;
  padding-left: max(1.5rem, calc(var(--sal) + 1rem));
  padding-right: max(1.5rem, calc(var(--sar) + 1rem));
  background: rgba(20, 20, 20, 0.9);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  position: sticky;
  top: 0;
  z-index: 100;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.home-logo {
  font-size: 1.6rem;
  font-weight: 800;
  color: #e50914;
  letter-spacing: -0.5px;
  line-height: 1;
}

.home-actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

/* Botón icono de actualizar (solo símbolo ↻) */
.btn-icon {
  width: 38px;
  height: 38px;
  min-width: 38px;
  min-height: 38px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
  border: 1px solid rgba(255, 255, 255, 0.15);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 1.25rem;
  cursor: pointer;
  line-height: 1;
  padding: 0;
  transition: background 0.15s, transform 0.1s, border-color 0.15s;
}

.btn-icon:hover {
  background: rgba(255, 255, 255, 0.22);
  border-color: rgba(255, 255, 255, 0.35);
}

.btn-icon:active {
  transform: scale(0.92);
}

/* Avatar de usuario en cabecera */
.home-profile {
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  border-radius: 50%;
  padding: 0;
  outline: none;
}

.home-profile:hover .avatar.small,
.home-profile:focus .avatar.small {
  border-color: #fff;
  transform: scale(1.06);
}

.home-main {
  flex: 1;
  display: block;
  padding: 1.4rem 0 3rem;
  overflow-y: auto;
  scroll-padding-top: 1.5rem;
  scroll-behavior: smooth;
}

.home-empty {
  text-align: center;
  opacity: 0.9;
  padding: 4rem 1.5rem;
}

.home-empty h2 {
  font-size: 1.8rem;
  font-weight: 400;
  margin-bottom: 0.8rem;
}

/* ===== Biblioteca y Carruseles ===== */
.row {
  margin-bottom: 2rem;
  scroll-margin-block: 1.5rem;
}

.row-title {
  font-size: calc(1.25rem * var(--ui-font-scale, 1));
  font-weight: 600;
  margin: 0 max(1.5rem, calc(var(--sal) + 1rem)) 0.7rem;
}

.row-track {
  display: flex;
  gap: 1rem;
  overflow-x: auto;
  padding: 1rem max(1.5rem, calc(var(--sal) + 1rem)) 1.25rem;
  scroll-padding: 0 max(1.5rem, calc(var(--sal) + 1rem));
  scroll-snap-type: x proximity;
  scrollbar-width: none;
}

.row-track::-webkit-scrollbar {
  display: none;
}

.row-track .lib-card {
  flex: 0 0 auto;
  scroll-snap-align: start;
}

.lib-card {
  width: calc(140px * var(--ui-scale, 1.12));
  cursor: pointer;
  outline: none;
  transition: transform 0.15s;
  scroll-margin-left: 40px;
  scroll-margin-right: 40px;
}

.lib-card-poster {
  position: relative;
  width: calc(140px * var(--ui-scale, 1.12));
  height: calc(200px * var(--ui-scale, 1.12));
  border-radius: 6px;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  align-items: flex-start;
  padding: 0.8rem;
  overflow: hidden;
  text-align: left;
  border: 2px solid transparent;
  background: linear-gradient(160deg, var(--pc, #333) 0%, #111 85%);
  transition: transform 0.15s, border-color 0.15s, box-shadow 0.15s;
}

.lib-card:focus .lib-card-poster,
.lib-card:hover .lib-card-poster {
  transform: scale(1.08);
  border-color: #fff;
  box-shadow: 0 0 22px rgba(255, 255, 255, 0.3);
}

.lib-card-name {
  font-size: calc(0.9rem * var(--ui-font-scale, 1));
  color: #ddd;
  text-align: center;
  line-height: 1.3;
  margin-top: 0.5rem;
  line-height: 1.35;
  height: 2.7em;
  min-height: 2.7em;
  max-height: 2.7em;
  word-break: break-word;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.poster-group {
  position: absolute;
  top: 0.6rem;
  left: 0.7rem;
  font-size: 0.65rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  opacity: 0.75;
}

.poster-name {
  font-size: 1.05rem;
  font-weight: 800;
  line-height: 1.15;
}

.poster-meta {
  font-size: 0.7rem;
  opacity: 0.7;
  margin-top: 0.3rem;
}

.poster-progress {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 4px;
  background: rgba(0, 0, 0, 0.5);
}

.poster-progress i {
  display: block;
  height: 100%;
  background: #e50914;
}

.ep .poster-progress {
  position: static;
  margin-top: 0.4rem;
  border-radius: 2px;
}

/* Foco unificado TV / D-Pad: elegante, blanco y redondeado */
:focus {
  outline: none;
}

.lib-card:focus {
  outline: none;
}

.lib-card:focus .lib-card-poster {
  transform: scale(1.08);
  border-color: #fff;
  border-radius: 8px;
  box-shadow: 0 0 24px rgba(255, 255, 255, 0.45);
}

.profile-card:focus {
  outline: none;
  transform: scale(1.08);
}

.profile-card:focus .avatar {
  outline: 3px solid #fff;
  outline-offset: 3px;
  border-radius: 12px;
  box-shadow: 0 0 22px rgba(255, 255, 255, 0.4);
}

.btn:focus,
.btn-ghost:focus,
.btn-icon:focus,
.logout-btn:focus,
.btn-syn-toggle:focus {
  outline: 3px solid #fff;
  outline-offset: 2px;
  border-radius: 6px;
  box-shadow: 0 0 16px rgba(255, 255, 255, 0.4);
}

.btn-icon-circle:focus,
.btn-icon-circle:focus-visible {
  outline: 3px solid #fff;
  outline-offset: 2px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.25);
  box-shadow: 0 0 20px rgba(255, 255, 255, 0.6);
  transform: scale(1.15);
}

.ep:focus,
.ep:focus-visible {
  background: rgba(255, 255, 255, 0.22) !important;
  border-color: #fff !important;
  border-radius: 8px !important;
  outline: 3px solid #fff !important;
  outline-offset: 2px !important;
  box-shadow: 0 0 20px rgba(255, 255, 255, 0.6) !important;
}

.season-btn:focus,
.season-btn:focus-visible {
  background: rgba(255, 255, 255, 0.3) !important;
  border-color: #fff !important;
  color: #fff !important;
  border-radius: 6px !important;
  outline: 3px solid #fff !important;
  outline-offset: 2px !important;
  box-shadow: 0 0 18px rgba(255, 255, 255, 0.6) !important;
}

.settings-dialog input:focus,
.settings-dialog select:focus,
.meta-field input:focus,
.meta-field select:focus {
  outline: 2px solid #fff;
  border-color: #fff;
  border-radius: 6px;
}

.btn-select-meta:focus {
  outline: 3px solid #fff;
  outline-offset: 2px;
  background: #fff;
  color: #111;
  border-radius: 6px;
  box-shadow: 0 0 16px rgba(255, 255, 255, 0.4);
}

.btn-ghost {
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
  border: none;
  padding: 0.5rem 1rem;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.95rem;
  transition: background 0.15s;
}

.btn-ghost:hover {
  background: rgba(255, 255, 255, 0.16);
}

/* ===== Pantalla de Detalle ===== */
.detail {
  padding-top: max(1.2rem, calc(var(--sat) + 0.8rem));
  padding-left: max(1.5rem, calc(var(--sal) + 1rem));
  padding-right: max(1.5rem, calc(var(--sar) + 1rem));
  padding-bottom: max(2.5rem, calc(var(--sab) + 1.5rem));
  background-color: #141414;
  background-image: linear-gradient(180deg, color-mix(in srgb, var(--pc) 45%, #141414) 0%, #141414 420px);
  background-repeat: no-repeat;
  min-height: 100dvh;
}

#d-back {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  height: 38px;
  padding: 0 1rem;
  border-radius: 19px;
  background: rgba(255, 255, 255, 0.12);
  border: 1px solid rgba(255, 255, 255, 0.18);
  font-size: 0.92rem;
  font-weight: 500;
  margin-bottom: 1.2rem;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}

#d-back:hover {
  background: rgba(255, 255, 255, 0.22);
  border-color: rgba(255, 255, 255, 0.3);
}

.detail-head {
  display: flex;
  gap: 2rem;
  margin: 1rem 0 2rem;
  align-items: flex-end;
  flex-wrap: wrap;
}

.lib-card-poster.big {
  width: calc(200px * var(--ui-font-scale, 1));
  height: calc(290px * var(--ui-font-scale, 1));
  margin: 0;
  flex-shrink: 0;
}

.detail h1 {
  font-size: calc(2.4rem * var(--ui-font-scale, 1));
  margin: 0.3rem 0;
}

.detail-kicker {
  text-transform: uppercase;
  letter-spacing: 0.12em;
  font-size: calc(0.8rem * var(--ui-font-scale, 1));
  opacity: 0.7;
}

.detail-sub {
  opacity: 0.7;
  margin-bottom: 1rem;
  font-size: calc(0.95rem * var(--ui-font-scale, 1));
}

.detail-syn {
  max-width: 640px;
  opacity: 0.85;
  margin-bottom: 1.2rem;
  line-height: 1.5;
  font-size: calc(1rem * var(--ui-font-scale, 1));
}

.detail .row-title {
  margin: 0 0 0.7rem;
}

.ep-list {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  max-width: 900px;
}

.ep {
  display: flex;
  gap: 1rem;
  align-items: center;
  padding: 0.8rem 1rem;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.04);
  cursor: pointer;
  border: 2px solid transparent;
  transition: background 0.15s, border-color 0.15s;
}

.ep:focus,
.ep:focus-visible {
  background: rgba(255, 255, 255, 0.22) !important;
  border-color: #fff !important;
  outline: 3px solid #fff !important;
  outline-offset: 2px !important;
  box-shadow: 0 0 20px rgba(255, 255, 255, 0.6) !important;
}
@media (hover: hover) and (pointer: fine) {
  .ep:hover {
    background: rgba(255, 255, 255, 0.1);
    border-color: #fff;
    outline: none;
  }
}

.ep-num {
  width: calc(70px * var(--ui-font-scale, 1));
  font-weight: 700;
  opacity: 0.8;
  font-size: calc(0.95rem * var(--ui-font-scale, 1));
}

.ep-info {
  flex: 1;
  min-width: 0;
}

.ep-name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: calc(1rem * var(--ui-font-scale, 1));
}

.ep-meta {
  font-size: calc(0.8rem * var(--ui-font-scale, 1));
  opacity: 0.6;
  margin-top: 0.2rem;
}

.ep-state {
  font-size: calc(0.85rem * var(--ui-font-scale, 1));
  opacity: 0.8;
}

/* ===== Selector de Temporadas ===== */
.seasons-bar { margin: 1.2rem 0 1rem; }
.seasons-label { font-size: .8rem; text-transform: uppercase; letter-spacing: .12em; opacity: .6; margin-bottom: .6rem; font-weight: 600; }
.seasons-track { display: flex; gap: .5rem; overflow-x: auto; padding-bottom: .5rem; scrollbar-width: none; }
.seasons-track::-webkit-scrollbar { display: none; }
.season-btn { padding: .45rem 1.1rem; border-radius: 20px; background: rgba(255,255,255,.08); color: #ddd; border: 1px solid rgba(255,255,255,.14); font-size: calc(.92rem * var(--ui-font-scale, 1)); font-weight: 600; cursor: pointer; white-space: nowrap; flex: 0 0 auto; }
.season-btn:hover, .season-btn:focus { background: rgba(255,255,255,.18); color: #fff; outline: none; border-color: #fff; }
.season-btn.active { background: #e50914; color: #fff; border-color: #e50914; }

/* ===== Reproductor ===== */
.player {
  position: fixed;
  inset: 0;
  background: #000;
  display: flex;
  flex-direction: column;
  z-index: 1000;
  overflow: hidden;
}

.player-top-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 30;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: max(0.85rem, calc(var(--sat) + 0.5rem));
  padding-left: max(1rem, calc(var(--sal) + 0.5rem));
  padding-right: max(1rem, calc(var(--sar) + 0.5rem));
  padding-bottom: 2rem;
  background: linear-gradient(180deg, rgba(0, 0, 0, 0.85) 0%, rgba(0, 0, 0, 0.4) 60%, transparent 100%);
  pointer-events: none;
  transition: opacity 0.25s ease, transform 0.25s ease;
}

.player-top-overlay > * {
  pointer-events: auto;
}

.player-top-overlay.is-hidden {
  opacity: 0;
  transform: translateY(-8px);
  pointer-events: none;
}

.player-top-left {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-width: 0;
}

.player-title {
  font-size: 1rem;
  font-weight: 500;
  color: #fff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-shadow: 0 1px 3px rgba(0,0,0,0.8);
}

.player-badge {
  font-size: 0.72rem;
  padding: 0.2rem 0.5rem;
  border-radius: 4px;
  background: #e50914;
  color: #fff;
  font-weight: 700;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  white-space: nowrap;
  line-height: 1;
  cursor: pointer;
  user-select: none;
  transition: transform 0.15s ease, opacity 0.15s ease, filter 0.15s ease;
}

.player-badge:hover {
  transform: scale(1.06);
  filter: brightness(1.15);
}

.player-badge:active {
  transform: scale(0.96);
}

.player-badge-native {
  background: #2563eb;
}

/* .player-loading: definido solo en styles/player.css */

.artplayer-host {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  background: #000;
}
.artplayer-host .artplayer-app,
.artplayer-host .art-video-player {
  width: 100% !important;
  height: 100% !important;
}
.artplayer-host .art-video-player { aspect-ratio: auto; }

.native-video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: #000;
  outline: none;
  z-index: 10;
}

.art-ios-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  padding: 2px 6px;
  border: 1px solid rgba(255,255,255,0.4);
  border-radius: 4px;
  color: #fff;
  background: rgba(0,0,0,0.4);
}
.saga-film-poster {
  width: 54px;
  height: 78px;
  flex: 0 0 54px;
  object-fit: cover;
  border-radius: 5px;
  background: #242424;
}
.saga-film-placeholder {
  display: grid;
  place-items: center;
  font-size: .85rem;
  color: #bbb;
}
.saga-film { align-items: flex-start; gap: .8rem; }
.saga-film .ep-info { min-width: 0; }
.saga-film-synopsis {
  margin-top: .35rem;
  color: #aaa;
  font-size: .82rem;
  line-height: 1.35;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* ===== Ajustes Móviles (iPhone / Android) ===== */
@media (max-width: 640px) {
  .home-header {
    padding-left: max(1rem, var(--sal));
    padding-right: max(1rem, var(--sar));
  }

  .home-logo {
    font-size: 1.4rem;
  }

  .row-title {
    margin: 0 max(1rem, var(--sal)) 0.6rem;
  }

  .row-track {
    padding: 0.5rem max(1rem, var(--sal)) 1rem;
  }

  .lib-card,
  .lib-card-poster {
    width: calc(110px * var(--ui-scale, 1.12));
  }

  .lib-card-poster {
    height: calc(160px * var(--ui-scale, 1.12));
  }

  .detail {
    padding-left: max(1rem, var(--sal));
    padding-right: max(1rem, var(--sar));
  }

  .detail h1 {
    font-size: calc(1.7rem * var(--ui-font-scale, 1));
  }

  .lib-card-poster.big {
    width: calc(130px * var(--ui-font-scale, 1));
    height: calc(190px * var(--ui-font-scale, 1));
  }
}


/* Carátulas y metadatos: nunca cambian el nombre original. */
.poster-image { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; background: #101010; z-index: 0; }
.lib-card-poster.has-poster,
.lib-card-poster:has(.poster-image) { background: #141414; }
.lib-card-poster.has-poster .poster-name,
.lib-card-poster.has-poster .poster-group,
.lib-card-poster.has-poster .poster-meta,
.lib-card-poster:has(.poster-image) .poster-name,
.lib-card-poster:has(.poster-image) .poster-group,
.lib-card-poster:has(.poster-image) .poster-meta { display: none !important; visibility: hidden !important; }
.poster-progress { z-index: 1; }
.detail {
  position: relative;
  min-height: 100vh;
  min-height: 100dvh;
}
.detail.has-backdrop {
  background-color: #141414;
}
.detail.has-backdrop::before {
  content: "";
  position: fixed;
  inset: 0;
  z-index: 0;
  background-image: var(--detail-backdrop);
  background-size: cover;
  background-position: center top;
  background-repeat: no-repeat;
  pointer-events: none;
  opacity: 0.45;
}
.detail.has-backdrop::after {
  content: "";
  position: fixed;
  inset: 0;
  z-index: 1;
  background: linear-gradient(
    180deg,
    rgba(20, 20, 20, 0.25) 0%,
    rgba(20, 20, 20, 0.65) 240px,
    rgba(20, 20, 20, 0.92) 420px,
    #141414 100%
  );
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  pointer-events: none;
}
.detail-nav-bar,
.detail-head,
.seasons-bar,
#d-list-title,
.ep-list {
  position: relative;
  z-index: 2;
}
.detail-metadata { margin: .5rem 0 1rem; color: #ddd; font-size: calc(0.95rem * var(--ui-font-scale, 1)); }
.detail-head > div:last-child { flex: 1; min-width: 0; }
.seasons-track { position: relative; max-width: 100%; }
.settings-overlay { position: fixed; inset: 0; z-index: 1200; background: rgba(0,0,0,.75); display: flex; align-items: center; justify-content: center; padding: max(1rem, var(--sat)) max(1rem, var(--sar)) max(1rem, var(--sab)) max(1rem, var(--sal)); }
.settings-dialog { background: #1c1c1c; border: 1px solid #555; border-radius: 8px; width: min(520px, 94vw); max-height: 82vh; overflow-y: auto; overscroll-behavior: contain; padding: 1.25rem; }
.settings-dialog header { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-bottom: 1.5rem; }
.settings-dialog h2 { font-size: 1.25rem; }
.settings-dialog form, .profile-menu { display: flex; flex-direction: column; gap: 1rem; }
.profile-menu button { text-align: left; padding: 1rem; }
.settings-dialog label { display: flex; flex-direction: column; gap: .5rem; }
.settings-dialog input, .settings-dialog select { width: 100%; min-width: 0; padding: .75rem; background: #141414; color: #fff; border: 1px solid #777; border-radius: 4px; font: inherit; }
.settings-dialog input:focus, .settings-dialog select:focus { outline: 2px solid #fff; }
.settings-dialog p { line-height: 1.5; overflow-wrap: anywhere; }
.settings-status { color: #ddd; }
.settings-actions { display: flex; flex-wrap: wrap; gap: .75rem; }
.settings-dialog button:disabled { opacity: .5; cursor: wait; }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; transition: none !important; } }

/* Ajustes - Sección Reproductor */
.settings-section {
  border: 1px solid #444;
  border-radius: 6px;
  padding: 0.85rem;
  margin-top: 0.35rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  background: rgba(255, 255, 255, 0.02);
}
.settings-legend {
  font-weight: 600;
  font-size: 0.95rem;
  color: #fff;
  padding: 0 0.4rem;
}
.settings-radios {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.settings-radio-label {
  display: flex !important;
  flex-direction: row !important;
  align-items: flex-start !important;
  gap: 0.75rem !important;
  cursor: pointer;
  padding: 0.6rem 0.75rem;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid #444;
  outline: none;
  transition: background 0.15s, border-color 0.15s;
}
.settings-radio-label:has(input:checked),
.settings-radio-label.is-checked {
  background: rgba(229, 9, 20, 0.15);
  border-color: #e50914 !important;
}
.settings-radio-label:focus,
.settings-radio-label.dpad-focus {
  border-color: #ffffff !important;
  background: rgba(255, 255, 255, 0.15) !important;
  outline: 2px solid #ffffff !important;
  outline-offset: 2px !important;
}
.settings-radio-label input[type="radio"] {
  width: auto !important;
  margin-top: 0.2rem;
  accent-color: #e50914;
}
.settings-radio-info {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}
.settings-radio-info strong {
  color: #fff;
  font-size: 0.92rem;
}
.settings-radio-info small {
  color: #aaa;
  font-size: 0.8rem;
  line-height: 1.35;
}


/* Barra superior de detalle: Volver + Botón 'i' */
.detail-nav-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1.2rem;
  position: relative;
  z-index: 10;
}
.detail-nav-bar #d-back {
  margin-bottom: 0;
}
.btn-icon-circle {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.12);
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: #fff;
  font-size: 1.25rem;
  font-family: inherit;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, transform 0.15s;
}
.btn-icon-circle:hover {
  background: rgba(255, 255, 255, 0.24);
  border-color: rgba(255, 255, 255, 0.38);
  transform: scale(1.05);
}

/* Sinopsis en detalle: contenedor y recorte para móvil */
.detail-syn-container {
  max-width: 640px;
  margin-bottom: 1.2rem;
}
.detail-syn {
  opacity: 0.85;
  margin-bottom: 0.35rem;
  line-height: 1.5;
}
.btn-syn-toggle {
  background: none;
  border: none;
  color: #e50914;
  font-weight: 600;
  font-size: 0.88rem;
  padding: 0.2rem 0.4rem 0.2rem 0;
  cursor: pointer;
  text-decoration: underline;
  display: inline-block;
}
.btn-syn-toggle:hover {
  color: #ff3b47;
}

@media (max-width: 680px) {
  .detail-head {
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 1.2rem;
    margin: 0.5rem 0 1.5rem;
  }
  .lib-card-poster.big {
    width: calc(175px * var(--ui-font-scale, 1));
    height: calc(254px * var(--ui-font-scale, 1));
    margin: 0 auto;
  }
  .detail-head > div:last-child {
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .detail h1 {
    font-size: calc(1.85rem * var(--ui-font-scale, 1));
  }
  .detail-syn {
    text-align: left;
  }
  .detail-syn-container {
    width: 100%;
  }
  #d-play {
    width: 100%;
    max-width: 320px;
    margin: 0.8rem auto 0;
    align-self: center;
  }
  .detail-syn:not(.expanded) {
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
}

/* Indicador flotante de salto en reproductor (doble tap/click) */
.player-skip-feedback {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 50;
  display: flex;
  align-items: center;
}
.player-skip-feedback.show-left {
  justify-content: flex-start;
  padding-left: 12%;
}
.player-skip-feedback.show-right {
  justify-content: flex-end;
  padding-right: 12%;
}
.skip-pill {
  background: rgba(0, 0, 0, 0.75);
  border: 1px solid rgba(255, 255, 255, 0.25);
  color: #fff;
  padding: 0.6rem 1.1rem;
  border-radius: 24px;
  font-size: 1.1rem;
  font-weight: 700;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  box-shadow: 0 4px 18px rgba(0, 0, 0, 0.6);
  animation: skipBadgePop 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}
@keyframes skipBadgePop {
  0% { transform: scale(0.7); opacity: 0; }
  25% { transform: scale(1.1); opacity: 1; }
  80% { transform: scale(1); opacity: 1; }
  100% { transform: scale(0.95); opacity: 0; }
}

/* Ajustes globales: Caché y formularios */
.settings-hint {
  font-size: 0.84rem;
  color: #aaa;
  margin: 0 0 0.4rem;
  line-height: 1.4;
}
.btn-sm {
  height: 32px !important;
  padding: 0 0.8rem !important;
  font-size: 0.84rem !important;
  border-radius: 4px !important;
}
.settings-field-row {
  margin-top: 0.4rem;
}
.settings-label-inline {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  font-size: 0.9rem;
}
.settings-select {
  background: #222;
  color: #fff;
  border: 1px solid #444;
  border-radius: 4px;
  padding: 0.5rem 0.6rem;
  font-size: 0.92rem;
}
.cache-stats-box {
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid #333;
  border-radius: 6px;
  padding: 0.6rem 0.8rem;
  font-size: 0.85rem;
  color: #ddd;
  line-height: 1.4;
}
.cache-stats-box strong {
  color: #fff;
}
.settings-actions-inline {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

/* Modal de Identificación y Corrección TMDB (botón 'i') */
.meta-modal-body {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  max-width: 640px;
}
.meta-current-box {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 6px;
  padding: 0.6rem 0.85rem;
  font-size: 0.88rem;
  color: #ccc;
}
.meta-search-form {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.meta-search-fields {
  display: flex;
  gap: 0.6rem;
  flex-wrap: wrap;
}
.meta-field {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  flex: 1;
  min-width: 140px;
  font-size: 0.84rem;
  color: #bbb;
}
.meta-field-sm {
  flex: 0 0 130px;
}
.meta-field-xs {
  flex: 0 0 85px;
}
.meta-field input,
.meta-field select {
  background: #1e1e1e;
  border: 1px solid #444;
  color: #fff;
  border-radius: 4px;
  padding: 0.5rem 0.6rem;
  font-size: 0.9rem;
}
.meta-search-direct {
  display: flex;
  gap: 0.6rem;
  align-items: flex-end;
}
.meta-search-direct .meta-field {
  flex: 1;
}
.meta-results-container {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  max-height: 380px;
  overflow-y: auto;
  padding-right: 0.2rem;
}
.meta-status {
  font-size: 0.86rem;
  color: #aaa;
  margin: 0;
}
.meta-results-list {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}
.meta-result-card {
  display: flex;
  gap: 0.85rem;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  padding: 0.6rem;
  align-items: flex-start;
  transition: background 0.15s, border-color 0.15s;
}
.meta-result-card:hover {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(229, 9, 20, 0.4);
}
.meta-result-poster {
  width: 60px;
  height: 90px;
  flex-shrink: 0;
  border-radius: 4px;
  overflow: hidden;
  background: #111;
  display: flex;
  align-items: center;
  justify-content: center;
}
.meta-result-poster img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.meta-poster-empty {
  font-size: 1.5rem;
  opacity: 0.4;
}
.meta-result-info {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  flex: 1;
  min-width: 0;
}
.meta-result-title {
  font-size: 0.95rem;
  font-weight: 600;
  color: #fff;
}
.meta-result-year {
  color: #888;
  font-weight: 400;
  font-size: 0.85rem;
}
.meta-result-id {
  font-size: 0.8rem;
  color: #aaa;
}
.meta-result-overview {
  font-size: 0.82rem;
  color: #bbb;
  margin: 0.15rem 0 0.4rem;
  line-height: 1.35;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.meta-footer-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 0.2rem;
}

@media (max-width: 680px) {
  .detail.has-backdrop {
    background-image:
      linear-gradient(180deg, rgba(20, 20, 20, 0.45) 0%, rgba(20, 20, 20, 0.88) 320px, #141414 560px, #141414 100%),
      var(--detail-backdrop);
    background-size: 100% 100%, 100% auto;
  }
}





/* Reproductor Stremio-Style: Barra de control limpia abajo */
.player {
  position: fixed;
  inset: 0;
  background: #000;
  z-index: 100;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  overflow: hidden;
}

.player-tv-osd {
  position: absolute;
  inset: 0;
  z-index: 50;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 1.5rem 2rem 1.2rem;
  background: linear-gradient(180deg, rgba(0,0,0,0.8) 0%, rgba(0,0,0,0) 25%, rgba(0,0,0,0) 65%, rgba(0,0,0,0.88) 100%);
  pointer-events: auto;
  transition: opacity 0.22s ease, visibility 0.22s ease;
  user-select: none;
}

.player-tv-osd.is-hidden {
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
}

.player-osd-top {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.player-osd-back-btn {
  background: rgba(255, 255, 255, 0.12);
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: #fff;
  width: 42px;
  height: 42px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 1.2rem;
  transition: background 0.15s, transform 0.15s;
}

.player-osd-back-btn:focus {
  outline: 3px solid #fff;
  outline-offset: 2px;
  background: rgba(255, 255, 255, 0.3);
  transform: scale(1.1);
}

.player-osd-title {
  flex: 1;
  font-size: 1.15rem;
  font-weight: 600;
  color: #f1f5f9;
  text-shadow: 0 2px 4px rgba(0,0,0,0.8);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.player-osd-badge {
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.25);
  color: #e2e8f0;
  font-size: 0.8rem;
  font-weight: 600;
  padding: 0.35rem 0.75rem;
  border-radius: 20px;
  cursor: pointer;
}


.grid-cards .lib-card-name,
.category-grid .lib-card-name,
.category-view--grid .lib-card-name,
.grid-screen .lib-card-name,
.screen.grid-screen .lib-card-name {
  margin-top: 0.65rem !important;
  font-weight: 700 !important;
}

```

---

