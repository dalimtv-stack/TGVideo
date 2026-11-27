// src/ui/forwardModal.js
import { Api } from 'telegram';
import { fetchTmdbFullDetails, extractTitleAndYear, enrichTitle, extractTitlesFromCaption } from '../metadata/tmdb.js';
import { createKV } from '../core/kv.js';
import { loadLibrary } from '../library/channels.js';
import { parseCaption, buildStandardCaption, parseEpisode, prettyEpisodeName } from '../library/parse.js';
import { normalizeMovieKey } from '../library/titles.js';
import { getOverride, getOverrideByTmdbId } from '../metadata/overrides.js';
import { EXT_CHANNEL_TITLES_CACHE, getEpisodeSeriesMove, filterSeriesFilesByMoves } from './externalTitlesCache.js';
import { startUploadTask, updateUploadTask } from './uploadTasks.js';

const kv = createKV();
const LIB_KEY = 'library_v2';

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
  // 1. Metadatos TMDB explícitos (revisar metadata de titleData, file, y overrides)
  const meta = titleData?.metadata || file?.metadata || null;
  if (meta?.year) {
    const m = String(meta.year).match(/\b((?:19|20)\d{2})\b/);
    if (m) return m[1];
  }
  if (meta?.date) {
    const m = String(meta.date).match(/\b((?:19|20)\d{2})\b/);
    if (m) return m[1];
  }
  if (meta?.release_date || meta?.releaseDate) {
    const m = String(meta.release_date || meta.releaseDate).match(/\b((?:19|20)\d{2})\b/);
    if (m) return m[1];
  }
  if (meta?.first_air_date || meta?.firstAirDate) {
    const m = String(meta.first_air_date || meta.firstAirDate).match(/\b((?:19|20)\d{2})\b/);
    if (m) return m[1];
  }

  // 2. Propiedades directas year / yearHint / date
  if (titleData?.year) {
    const m = String(titleData.year).match(/\b((?:19|20)\d{2})\b/);
    if (m) return m[1];
  }
  if (file?.year) {
    const m = String(file.year).match(/\b((?:19|20)\d{2})\b/);
    if (m) return m[1];
  }
  if (titleData?.yearHint) {
    const m = String(titleData.yearHint).match(/\b((?:19|20)\d{2})\b/);
    if (m) return m[1];
  }
  if (file?.yearHint) {
    const m = String(file.yearHint).match(/\b((?:19|20)\d{2})\b/);
    if (m) return m[1];
  }
  if (titleData?.date || titleData?.release_date) {
    const m = String(titleData.date || titleData.release_date).match(/\b((?:19|20)\d{2})\b/);
    if (m) return m[1];
  }
  if (file?.date || file?.release_date) {
    const m = String(file.date || file.release_date).match(/\b((?:19|20)\d{2})\b/);
    if (m) return m[1];
  }

  // 3. Revisar archivos hermanos en el título si existen
  if (Array.isArray(titleData?.archivos)) {
    for (const sf of titleData.archivos) {
      if (sf.year) {
        const m = String(sf.year).match(/\b((?:19|20)\d{2})\b/);
        if (m) return m[1];
      }
      if (sf.yearHint) {
        const m = String(sf.yearHint).match(/\b((?:19|20)\d{2})\b/);
        if (m) return m[1];
      }
      if (sf.metadata?.date || sf.metadata?.year) {
        const m = String(sf.metadata.year || sf.metadata.date).match(/\b((?:19|20)\d{2})\b/);
        if (m) return m[1];
      }
    }
  }

  // 4. Extracción desde caption y nombres de archivo de Telegram
  const cap = parseCaption(file?.rawCaption || file?.caption || '');
  if (cap.fileName) {
    const parsedCap = extractTitleAndYear(cap.fileName);
    if (parsedCap.year) return String(parsedCap.year);
  }

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
  const ep = parseEpisode(name);
  if (ep.season > 0 || ep.episode > 0) return ep;
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

  // Película: determinar nombre canónico y año
  const meta = titleData?.metadata || file?.metadata || null;
  const metaTitle = meta?.title || meta?.name || null;

  const candidateName = file?.captionFileName || file?.fileName || file?.label || titleData?.nombre || cleanBase;
  const parsedCandidate = extractTitleAndYear(candidateName);
  let year = extractYear(titleData, file) || parsedCandidate.year;

  // Si el archivo de origen tiene un nombre genérico (tipo "video23", "video_100") pero el caption o metadata tiene el nombre real
  const isGenericOrig = /^(?:video|vid|mov|clip|stream|track|input|file|doc|document)?[_\-\s]*\d+$/i.test(cleanBase) ||
    /^(?:video|input|file|document)$/i.test(cleanBase) ||
    /^[0-9\-_.]+(?:accion|pelicula|movie|fhd|hd|rip)?$/i.test(cleanBase);

  const cap = parseCaption(file?.rawCaption || file?.caption || '');
  const captionCandidate = cap.fileName ? cap.fileName.replace(/\.([a-zA-Z0-9]{2,5})$/, '') : (file?.rawCaption || file?.caption || '').trim().split('\n')[0].trim();
  const validCaptionCand = captionCandidate && !captionCandidate.includes(':') && captionCandidate.length >= 2 ? captionCandidate : null;

  let cleanFallback = titleData?.nombre;
  if (cleanFallback) {
    const pFb = extractTitleAndYear(cleanFallback);
    if (pFb.title) cleanFallback = pFb.title;
    if (!year && pFb.year) year = pFb.year;
  }
  if (cleanFallback && (isGenericOrig || /^(?:video[_\-\s]*\d+|\d+)$/i.test(cleanFallback.replace(/\.([a-zA-Z0-9]{2,5})$/, '').trim()))) {
    cleanFallback = validCaptionCand || null;
  }

  let mName = metaTitle || parsedCandidate.title || (isGenericOrig && validCaptionCand ? validCaptionCand : null) || cleanFallback || cleanBase;

  // Limpiar extensiones residuales
  mName = mName.replace(/\.(mkv|mp4|avi|mov|m4v|webm|ts)$/i, '').trim();

  if (year) {
    const escYear = String(year).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Limpiar el año existente en cualquier parte para evitar duplicados como "Batman (1992) (1992)"
    const cleaned = mName
      .replace(new RegExp(`\\s*[\\(\\[]?${escYear}[\\)\\]]?\\s*$`, 'i'), '')
      .replace(new RegExp(`\\b${escYear}\\b`, 'g'), ' ')
      .replace(/\s*[\[\(]?(?:19|20)\d{2}[\]\)]?\s*$/i, '')
      .replace(/\s*AÑO\s*\d{4}/i, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (cleaned) {
      mName = cleaned;
    }
    return `${mName} (${year})${ext}`;
  } else {
    // Si ya trae año entre paréntesis en el propio nombre, normalizar formato
    const matchYear = mName.match(/[\[\(]((?:19\d{2}|20[0-3]\d))[\]\)]/) || mName.match(/\b((?:19\d{2}|20[0-3]\d))\b/);
    if (matchYear) {
      const y = matchYear[1];
      const escY = String(y).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const cleaned = mName
        .replace(new RegExp(`\\s*[\\(\\[]?${escY}[\\)\\]]?\\s*$`, 'i'), '')
        .replace(new RegExp(`\\b${escY}\\b`, 'g'), ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (cleaned) mName = cleaned;
      return `${mName} (${y})${ext}`;
    }
  }
  return `${mName}${ext}`;
}

/**
 * Modal interactivo para enviar o subir rápidamente un archivo a un canal de tgstorage.
 */
export async function showForwardModal(client, tg, file, getChannels, titleData = null, getTitles = null, options = {}) {
  // deleteSourceAfter: tras publicar el archivo en el canal destino, borra el mensaje original (reenvío)
  const deleteSourceAfter = Boolean(options?.deleteSourceAfter);
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

  const fileKey = file.key || `${file.channelId || file.channel?.id}:${file.messageId}`;
  const fileChannelId = String(file.channelId || file.channel?.id || '').trim();
  const fileCap = parseCaption(file.rawCaption || file.caption || '');
  if (fileCap.fileName && !file.captionFileName) file.captionFileName = fileCap.fileName;
  if (fileCap.tmdbId && !file.tmdbId) file.tmdbId = fileCap.tmdbId;

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

  // Si titleData viene incompleto o genérico, resolver desde pool
  let effectiveTitle = titleData;
  if (pool.length > 0) {
    const matched = pool.find(t =>
      (t.id && (t.id === titleData?.id || t.id === fileKey)) ||
      t.archivos?.some(f =>
        (f.key && f.key === fileKey) ||
        (fileChannelId && String(f.channelId || f.channel?.id || t.channel?.id || t.origen?.channelId || '') === fileChannelId && String(f.messageId) === String(file.messageId))
      )
    );
    if (matched) {
      const hasSpecificTitle = titleData?.nombre && !/^(?:video[_\-\s]*\d+|\d+|sin t[ií]tulo)$/i.test(String(titleData.nombre).trim());
      effectiveTitle = {
        ...matched,
        ...(titleData || {}),
        metadata: (titleData?.metadata && Object.keys(titleData.metadata).length > 0) ? titleData.metadata : (matched.metadata || null),
        tmdbId: titleData?.tmdbId || file.tmdbId || fileCap.tmdbId || matched.tmdbId || null,
        nombre: hasSpecificTitle ? titleData.nombre : (matched.nombre || titleData?.nombre),
      };
    }
  }

  // Si tenemos TMDB ID conocido en el archivo o caption pero falta en effectiveTitle, asociarlo con títulos de pool con el mismo TMDB ID
  const directTmdbId = titleData?.tmdbId || file.tmdbId || fileCap.tmdbId;
  if (!effectiveTitle?.metadata && directTmdbId) {
    const wantedTmdb = String(directTmdbId).trim();
    const tmdbMatch = pool.find(t => String(t.tmdbId || t.metadata?.id || '').trim() === wantedTmdb);
    if (tmdbMatch?.metadata) {
      effectiveTitle = {
        ...(effectiveTitle || {}),
        metadata: tmdbMatch.metadata,
        nombre: tmdbMatch.metadata.name || tmdbMatch.metadata.title || effectiveTitle?.nombre,
        tmdbId: wantedTmdb,
      };
    }
  }

  // Buscar overrides de identificación previa en TMDB
  const rawTmdbId = effectiveTitle?.tmdbId || effectiveTitle?.metadata?.id || file.tmdbId || fileCap.tmdbId;
  const ov = getOverride(fileKey) ||
    (effectiveTitle?.id ? getOverride(effectiveTitle.id) : null) ||
    (rawTmdbId ? getOverrideByTmdbId(rawTmdbId) : null);

  if (ov) {
    if (!effectiveTitle) effectiveTitle = { id: fileKey, nombre: ov.title || ov.name, archivos: [file] };
    effectiveTitle.metadata = { ...(effectiveTitle.metadata || {}), ...ov };
    if (ov.id && !effectiveTitle.tmdbId) effectiveTitle.tmdbId = ov.id;
    if (ov.title || ov.name) effectiveTitle.nombre = ov.title || ov.name;
    file.metadata = { ...(file.metadata || {}), ...ov };
    if (ov.id && !file.tmdbId) file.tmdbId = ov.id;
  }

  // 1.1 Si no tenemos fecha/año o metadata en effectiveTitle, buscar en metadataMap persistido
  if (!effectiveTitle?.metadata?.date && !effectiveTitle?.metadata?.year) {
    try {
      const libObj = await kv.get(LIB_KEY).catch(() => null);
      const metaMap = libObj?.metadataMap || {};
      const tid = effectiveTitle?.id;
      const tidRaw = tid ? String(tid).replace(/^ext-/, '') : null;
      const tidExt = tidRaw ? `ext-${tidRaw}` : null;
      const foundMeta = metaMap[tid] || (tidRaw ? metaMap[tidRaw] : null) || (tidExt ? metaMap[tidExt] : null) ||
        (rawTmdbId ? (metaMap[`tmdb_${rawTmdbId}`] || metaMap[String(rawTmdbId)]) : null) ||
        metaMap[fileKey];
      if (foundMeta) {
        if (!effectiveTitle) effectiveTitle = { id: fileKey, nombre: foundMeta.name || foundMeta.title, archivos: [file] };
        effectiveTitle.metadata = { ...(effectiveTitle.metadata || {}), ...foundMeta };
        if (foundMeta.id && !effectiveTitle.tmdbId) effectiveTitle.tmdbId = foundMeta.id;
        if (foundMeta.name || foundMeta.title) effectiveTitle.nombre = foundMeta.name || foundMeta.title;
        file.metadata = { ...(file.metadata || {}), ...foundMeta };
        if (foundMeta.id && !file.tmdbId) file.tmdbId = foundMeta.id;
      }
    } catch (_) {}
  }

  // 1.2 Si tenemos TMDB ID pero falta metadata completa (nombre o fecha/año), consultar caché TMDB o fetch rápido
  let curMeta = effectiveTitle?.metadata || file.metadata || null;
  let effectiveTmdbId = curMeta?.id || effectiveTitle?.tmdbId || file.tmdbId || fileCap.tmdbId;
  const isSerieEarly = isSeriesTitle(effectiveTitle, file);
  const mediaTypeEarly = isSerieEarly ? 'tv' : 'movie';

  const hasCompleteMeta = Boolean(curMeta && (curMeta.title || curMeta.name) && (curMeta.date || curMeta.year || curMeta.release_date));

  if (effectiveTmdbId && !hasCompleteMeta) {
    try {
      const cached = await kv.get(`tmdb_v2:${mediaTypeEarly}:${effectiveTmdbId}`).catch(() => null);
      if (cached && (cached.date || cached.year || cached.release_date || cached.name || cached.title)) {
        curMeta = { ...(curMeta || {}), ...cached };
        if (effectiveTitle) {
          effectiveTitle.metadata = curMeta;
          effectiveTitle.tmdbId = effectiveTmdbId;
          if (cached.name || cached.title) effectiveTitle.nombre = cached.name || cached.title;
        }
        file.metadata = { ...(file.metadata || {}), ...curMeta };
      } else {
        const full = await fetchTmdbFullDetails(mediaTypeEarly, effectiveTmdbId).catch(() => null);
        if (full && Object.keys(full).length > 0) {
          curMeta = { ...(curMeta || {}), ...full };
          if (effectiveTitle) {
            effectiveTitle.metadata = curMeta;
            effectiveTitle.tmdbId = effectiveTmdbId;
            if (full.name || full.title) effectiveTitle.nombre = full.name || full.title;
          }
          file.metadata = { ...(file.metadata || {}), ...curMeta };
        }
      }
    } catch (err) {
      console.warn('[forwardModal] Error recuperando detalles TMDB por ID:', err);
    }
  }

  // 1.3 Si el título aún no tiene metadata ni año (p. ej. vídeo reenviado con nombre video23 y caption "batman"),
  // intentar enriquecerlo con TMDB antes de mostrar el modal para sugerir el nombre canónico y su año
  if ((!curMeta || (!curMeta.date && !curMeta.year && !extractYear(effectiveTitle, file))) && effectiveTitle) {
    try {
      const origClean = (file.fileName || '').replace(/\.[a-zA-Z0-9]{2,5}$/, '').trim();
      const isGeneric = /^(?:video|vid|mov|clip|stream|track|input|file|doc|document)?[_\-\s]*\d+$/i.test(origClean) ||
        /^(?:video|input|file|document)$/i.test(origClean) ||
        /^[0-9\-_.]+(?:accion|pelicula|movie|fhd|hd|rip)?$/i.test(origClean);

      if (isGeneric && fileCap.fileName) {
        const parsedCap = extractTitleAndYear(fileCap.fileName);
        if (parsedCap.title) effectiveTitle.nombre = parsedCap.title;
        if (parsedCap.year) effectiveTitle.yearHint = parsedCap.year;
      } else if (isGeneric && (file.rawCaption || file.caption)) {
        const cands = extractTitlesFromCaption(file.rawCaption || file.caption || '');
        if (cands.length > 0 && cands[0].title) {
          effectiveTitle.nombre = cands[0].title;
          if (cands[0].year) effectiveTitle.yearHint = cands[0].year;
        } else {
          const firstLine = (file.rawCaption || file.caption || '').trim().split('\n')[0].trim();
          if (firstLine && !firstLine.includes(':') && firstLine.length >= 2) {
            effectiveTitle.nombre = firstLine;
          }
        }
      }

      const enriched = await enrichTitle(effectiveTitle).catch(() => null);
      if (enriched) {
        curMeta = enriched;
        effectiveTitle.metadata = enriched;
        if (enriched.id) {
          effectiveTitle.tmdbId = enriched.id;
          file.tmdbId = enriched.id;
        }
        if (enriched.name || enriched.title) {
          effectiveTitle.nombre = enriched.name || enriched.title;
        }
        file.metadata = { ...(file.metadata || {}), ...enriched };
      }
    } catch (err) {
      console.warn('[forwardModal] Error al autoidentificar en TMDB:', err);
    }
  }

  const isSerie = isSeriesTitle(effectiveTitle, file);
  const curTmdb = effectiveTitle?.tmdbId || effectiveTitle?.metadata?.id || file.tmdbId;
  const curChId = effectiveTitle?.channel?.id || file.channelId || effectiveTitle?.origen?.channelId;
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

  const hasSelectedList = Array.isArray(options?.selectedFiles) && options.selectedFiles.length > 0;
  let allFiles = [];
  if (hasSelectedList) {
    allFiles = [...options.selectedFiles];
  } else if (isSerie && titleData) {
    allFiles = filterSeriesFilesByMoves(titleData, pool);
  } else if (isSerie && Array.isArray(titleData?.archivos) && titleData.archivos.length > 0) {
    allFiles = [...titleData.archivos];
  } else {
    allFiles = [file];
  }

  // Consolidar con episodios de la misma serie en el canal si estuvieran en fichas separadas (solo si no se pasó una lista manual)
  if (!hasSelectedList && isSerie && (curTmdb || titleData?.nombre)) {
    const sNameNorm = normalizeMovieKey(titleData.metadata?.name || titleData.metadata?.title || titleData.nombre).replace(/(?:19|20)\d{2}/g, '');

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
        const move = getEpisodeSeriesMove(sf);
        if (move && (move.targetTitleId || move.targetTitleName)) {
          const isTarget = (move.targetTitleId && String(move.targetTitleId) === String(titleData?.id)) ||
            (move.targetTitleName && titleData?.nombre && move.targetTitleName.toLowerCase().trim() === titleData.nombre.toLowerCase().trim());
          if (!isTarget) continue; // Descartar episodios que hayan sido movidos a otra serie
        }
        const sfKey = sf.key || `${sf.channelId || sf.channel?.id}:${sf.messageId}`;
        if (!existingKeys.has(sfKey)) {
          allFiles.push(sf);
          existingKeys.add(sfKey);
        }
      }
    }
  }

  // Parsear y asegurar season y episode en todos los archivos antes de ordenar
  for (const f of allFiles) {
    let s = Number(f.season);
    let ep = Number(f.episode);
    if (!Number.isFinite(s) || s <= 0 || !Number.isFinite(ep) || ep <= 0) {
      const parsed = parseEpisode(f.captionFileName || f.fileName || f.filename || '');
      if (!Number.isFinite(s) || s <= 0) f.season = parsed.season || 1;
      if (!Number.isFinite(ep) || ep <= 0) f.episode = parsed.episode || 1;
    }
  }

  // Ordenar episodios cronológicamente (temporada, capítulo, nombre numérico, fecha)
  allFiles.sort((a, b) => {
    const sDiff = (Number(a.season) || 1) - (Number(b.season) || 1);
    if (sDiff !== 0) return sDiff;
    const epDiff = (Number(a.episode) || 1) - (Number(b.episode) || 1);
    if (epDiff !== 0) return epDiff;
    const cmp = (a.fileName || a.filename || '').localeCompare(b.fileName || b.filename || '', 'es', { numeric: true, sensitivity: 'base' });
    if (cmp !== 0) return cmp;
    return (a.date || 0) - (b.date || 0);
  });

  // Agrupar temporadas
  const seasonsMap = new Map();
  if (isSerie || hasSelectedList) {
    for (const f of allFiles) {
      const s = Number(f.season) || 1;
      if (!seasonsMap.has(s)) seasonsMap.set(s, []);
      seasonsMap.get(s).push(f);
    }
  }
  const seasonNumbers = Array.from(seasonsMap.keys()).sort((a, b) => a - b);

  if (deleteSourceAfter && !hasSelectedList) allFiles = [file];
  const isMultiFile = allFiles.length > 1;
  const seriesBaseName = titleData?.metadata?.name || titleData?.metadata?.title || titleData?.nombre || 'Serie';
  const defaultFilename = formatSuggestedFileName(file, effectiveTitle || titleData);
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
          <span>⚡</span> ${deleteSourceAfter ? 'Enviar/Subir &amp; <span style="color:#ef4444;">BORRAR</span> a canal tgstorage' : (isMultiFile ? 'Enviar serie / episodios a canal tgstorage' : 'Enviar archivo a canal tgstorage')}
        </h3>
        <button id="modal-close-btn" style="background: transparent; border: none; color: #94a3b8; font-size: 1.4rem; cursor: pointer; padding: 0.2rem 0.5rem; border-radius: 4px;">×</button>
      </div>

      ${hasSelectedList ? `
        <div style="background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 0.85rem 1rem; margin-bottom: 1.2rem; font-size: 0.88rem;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div>
              <div style="font-size: 0.95rem; color: #fff; font-weight: 600;">
                ${allFiles.length} archivo${allFiles.length > 1 ? 's' : ''} seleccionado${allFiles.length > 1 ? 's' : ''}
              </div>
              <div style="color: #94a3b8; font-size: 0.78rem; margin-top: 0.25rem;">
                ${deleteSourceAfter ? 'Se enviarán ordenados correlativamente y se <strong style="color:#ef4444;">BORRARÁN</strong> los reenvíos originales.' : 'Se enviarán ordenados correlativamente a la biblioteca tgstorage.'}
              </div>
            </div>
            <span style="font-size: 0.85rem; color: #cbd5e1; font-weight: 600;">${esc(formatBytes(totalSeriesSize))}</span>
          </div>
        </div>
      ` : (isMultiFile ? `
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
      ` : '')}

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
            const rawSourceId = String(titleData?.channel?.id || file?.channelId || file?.channel?.id || titleData?.origen?.channelId || '').replace(/^ext-/, '').replace(/^-?100/, '').trim();
            const rawSourceTitle = String(titleData?.channel?.title || file?.channel?.title || '').toLowerCase().trim();
            const sourceGroup = String(titleData?.channel?.group || file?.channel?.group || titleData?.grupo || '').toLowerCase().trim();

            // 1. Coincidencia exacta por ID de canal de origen (si ya es un canal tgstorage)
            let preferredCh = rawSourceId ? tgStorageChannels.find(c => String(c.id).replace(/^-?100/, '').trim() === rawSourceId) : null;

            // 2. Coincidencia por título completo idéntico
            if (!preferredCh && rawSourceTitle) {
              preferredCh = tgStorageChannels.find(c => String(c.title || c.name || '').toLowerCase().trim() === rawSourceTitle);
            }

            // 3. Coincidencia por misma carpeta/grupo (ej. "HBO", "Acción", etc.)
            if (!preferredCh && sourceGroup) {
              preferredCh = tgStorageChannels.find(c => {
                const grp = String(c.group || '').toLowerCase().trim();
                const tit = String(c.title || c.name || '').toLowerCase();
                return (grp && grp === sourceGroup) || tit.includes(sourceGroup);
              });
            }

            // 4. Fallback por categoría (Series o Películas)
            if (!preferredCh) {
              preferredCh = isSerie
                ? (tgStorageChannels.find(c => c.category === 'Series') || tgStorageChannels[0])
                : (tgStorageChannels.find(c => c.category === 'Películas') || tgStorageChannels[0]);
            }

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

      ${deleteSourceAfter ? `
      <div style="background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.4); border-radius: 8px; padding: 0.75rem 1rem; margin-bottom: 1.2rem; font-size: 0.85rem; color: #fecaca;">
        Cuando Telegram confirme que el archivo está publicado en el canal destino, se <strong style="color:#ef4444;">BORRARÁ</strong> el reenvío original. Si el envío falla, el original no se toca.
      </div>` : ''}

      <div style="display: flex; justify-content: flex-end; gap: 0.8rem;">
        <button type="button" id="modal-cancel-btn" data-focusable tabindex="0" style="background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.15); border-radius: 6px; padding: 0.6rem 1.2rem; color: #fff; font-size: 0.9rem; cursor: pointer;">
          Cancelar
        </button>
        <button type="button" id="modal-send-btn" data-focusable tabindex="0" style="background: var(--theme-accent, #e50914); border: none; border-radius: 6px; padding: 0.6rem 1.4rem; color: #fff; font-size: 0.9rem; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 0.4rem;">
          <span>${deleteSourceAfter ? (allFiles.length > 1 ? `⚡ Enviar y BORRAR ${allFiles.length} reenvíos` : '⚡ Enviar y BORRAR reenvío') : (allFiles.length > 1 ? `⚡ Enviar ${allFiles.length} archivos` : '⚡ Enviar ahora')}</span>
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modalOverlay);

  // Autofoco prioritario en el botón de confirmación ("⚡ Enviar y BORRAR reenvío") para máxima rapidez
  setTimeout(() => {
    const sendBtnTarget = modalOverlay.querySelector('#modal-send-btn');
    sendBtnTarget?.focus?.({ preventScroll: true });
    sendBtnTarget?.classList?.add('dpad-focused');
  }, 50);

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
      sendBtn.innerHTML = `<span>${deleteSourceAfter ? `⚡ Enviar y BORRAR serie (${allFiles.length} eps)` : `⚡ Enviar serie entera (${allFiles.length} eps)`}</span>`;
    } else if (scopeSeasonRadio?.checked) {
      if (seasonSelectorContainer) seasonSelectorContainer.style.display = 'block';
      if (episodeSelectorContainer) episodeSelectorContainer.style.display = 'none';
      if (seriesNameContainer) seriesNameContainer.style.display = 'block';
      if (singleNameContainer) singleNameContainer.style.display = 'none';
      const sNum = Number(seasonSelect?.value || 1);
      const sFiles = seasonsMap.get(sNum) || [];
      const sSize = sFiles.reduce((acc, f) => acc + (Number(f.size) || 0), 0);
      if (seriesStatsLabel) seriesStatsLabel.innerHTML = `Temporada ${sNum}: <strong>${sFiles.length} episodios (${formatBytes(sSize)})</strong>`;
      sendBtn.innerHTML = `<span>${deleteSourceAfter ? `⚡ Enviar y BORRAR Temporada ${sNum} (${sFiles.length} eps)` : `⚡ Enviar Temporada ${sNum} (${sFiles.length} eps)`}</span>`;
    } else if (scopeSingleRadio?.checked) {
      if (seasonSelectorContainer) seasonSelectorContainer.style.display = 'none';
      if (episodeSelectorContainer) episodeSelectorContainer.style.display = 'block';
      if (seriesNameContainer) seriesNameContainer.style.display = 'none';
      if (singleNameContainer) singleNameContainer.style.display = 'block';
      const chosenKey = episodeSelect?.value;
      const chosenFile = allFiles.find(f => (f.key || `${f.channelId || f.channel?.id}:${f.messageId}`) === chosenKey) || file;
      if (filenameInput) filenameInput.value = formatSuggestedFileName(chosenFile, effectiveTitle || titleData);
      sendBtn.innerHTML = `<span>${deleteSourceAfter ? '⚡ Enviar y BORRAR reenvío' : '⚡ Enviar episodio a tgstorage'}</span>`;
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
      if (filenameInput) filenameInput.value = formatSuggestedFileName(chosenFile, effectiveTitle || titleData);
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
    if (hasSelectedList) {
      filesToSend = allFiles;
      uploadJobTitle = seriesBaseName || 'Lote seleccionado';
    } else if (isMultiFile) {
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

    // 1. Asegurar metadatos TMDB completos y detalles adicionales
    if (!effectiveTitle) {
      effectiveTitle = titleData;
      if (!effectiveTitle && file) {
        const internalTitles = (typeof getTitles === 'function' ? (getTitles() || []) : []) || [];
        const externalTitlesList = Array.from(EXT_CHANNEL_TITLES_CACHE?.values?.() || []).flat();
        const allTitles = [...internalTitles, ...externalTitlesList];
        effectiveTitle = allTitles.find(t => t.archivos?.some(f =>
          (f.key && f.key === file.key) ||
          (fileChannelId && String(f.channelId || f.channel?.id || t.channel?.id || '') === fileChannelId && String(f.messageId) === String(file.messageId))
        ));
      }
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

          const fileSourcePeer = curFile.peer || (await resolvePeer(client, tg, curFile.channel || curFile.channelId || effectiveTitle?.channel || file.channel));
          let msg = curFile.msg;
          if (!msg) {
            const curMsgId = Number(curFile.messageId || curFile.id);
            if (fileSourcePeer && curMsgId) {
              const res = await client.getMessages(fileSourcePeer, { ids: [curMsgId] });
              msg = res?.[0];
            }
          }
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

          let sentMsg = null;
          if (isFastUpload) {
            const docMedia = msg.media?.document || msg.media;
            if (docMedia) {
              try {
                sentMsg = await client.sendFile(targetPeer, {
                  file: docMedia,
                  caption: epCaption,
                  forceDocument: false,
                });
              } catch (sendErr) {
                const errMsg = String(sendErr?.message || sendErr || '');
                if (errMsg.includes('CHAT_FORWARDS_RESTRICTED') || errMsg.includes('FORWARDS_RESTRICTED')) {
                  console.warn('[forwardModal] Canal con restricción de reenvío (CHAT_FORWARDS_RESTRICTED). Descargando y resubiendo para eludir restricción…', curFilename);
                  setProgressBar(bar, {
                    id: taskId,
                    title: `⚡ Enviando: ${sBaseName} (${i + 1}/${count})`,
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
                  sentMsg = await client.sendFile(targetPeer, {
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
            sentMsg = await client.sendFile(targetPeer, {
              file: upload,
              caption: epCaption,
              forceDocument: !curFilename.toLowerCase().endsWith('.mp4'),
              attributes: [new Api.DocumentAttributeFilename({ fileName: curFilename })],
            });
          }

          if (deleteSourceAfter) {
            const sentId = Array.isArray(sentMsg) ? sentMsg[0]?.id : sentMsg?.id;
            if (sentId) {
              try {
                const epMsgId = Number(curFile.messageId || curFile.msg?.id || curFile.id);
                if (fileSourcePeer && epMsgId) {
                  await client.deleteMessages(fileSourcePeer, [epMsgId], { revoke: true });
                  try { options?.onSourceDeleted?.(curFile); } catch (_) {}
                }
              } catch (delErr) {
                console.warn('[forwardModal] Error borrando mensaje original en lote:', delErr);
              }
            }
          }

          if (i < count - 1) {
            await new Promise(r => setTimeout(r, 650));
          }
        }

        setProgressBar(bar, {
          id: taskId,
          title: `⚡ ${deleteSourceAfter ? 'Envío y borrado completado' : 'Envío completado'}: ${sBaseName}`,
          status: `Los ${count} archivos se han procesado en "${targetChannelName}"${deleteSourceAfter ? ' (reenvíos borrados)' : ''}`,
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

        let sentMsg = null;
        if (isFastUpload) {
          const docMedia = msg.media?.document || msg.media;
          if (!docMedia) throw new Error('El mensaje original no contiene un archivo reenviable.');

          try {
            sentMsg = await client.sendFile(targetPeer, {
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
              sentMsg = await client.sendFile(targetPeer, {
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

          sentMsg = await client.sendFile(targetPeer, {
            file: upload,
            caption: standardCaption,
            forceDocument: !filename.toLowerCase().endsWith('.mp4'),
            attributes: [new Api.DocumentAttributeFilename({ fileName: filename })],
          });
        }

        let deletedNote = '';
        if (deleteSourceAfter) {
          const sentId = Array.isArray(sentMsg) ? sentMsg[0]?.id : sentMsg?.id;
          if (!sentId) throw new Error('Telegram no confirmó la publicación en el canal destino. El reenvío original NO se ha borrado.');
          setProgressBar(bar, {
            id: taskId,
            title: `Borrando reenvío: ${filename}`,
            status: `Publicado en "${targetChannelName}". Borrando el reenvío original…`,
            percent: 97,
          });
          try {
            await client.deleteMessages(sourcePeer, [msgId], { revoke: true });
          } catch (delErr) {
            throw new Error(`El archivo se publicó en "${targetChannelName}", pero no se pudo borrar el reenvío original: ${delErr?.errorMessage || delErr?.message || delErr}`);
          }
          deletedNote = ' · reenvío original borrado';
          try { options?.onSourceDeleted?.(curTargetFile); } catch (_) {}
        }

        setProgressBar(bar, {
          id: taskId,
          title: `${isFastUpload ? '⚡ Subida rápida completada' : '🔄 Resubida completada'}: ${filename}`,
          status: `Añadido a "${targetChannelName}" con éxito${deletedNote}`,
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
