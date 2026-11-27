// src/ui/externalTitlesBuilder.js
// Construcción y agrupación de títulos para canales, grupos y temas externos.
import { applyEpisodeOverrides, applySeriesMoves, getEpisodeSeriesMove } from './externalTitlesCache.js';
import { isVideoMessage, getFileName, parseCaption, parseEpisode, detectTrailingSeriesMap, getTrailingSeriesForFile, detectNumberedSeriesMap, getNumberedSeriesForFile } from '../library/parse.js';
import { extractTitleAndYear, extractTitlesFromCaption } from '../metadata/tmdb.js';
import { seriesNameFromFile, normalizeMovieKey } from '../library/titles.js';
import { getOverride, getOverrideByTmdbId } from '../metadata/overrides.js';

function resolveExternalMetadata(id, tmdbId, files, virtualId, metadataMap = {}) {
  const rawVirtualId = String(virtualId || "").replace(/^ext-/, "");
  const extVirtualId = rawVirtualId ? `ext-${rawVirtualId}` : "";
  const firstMsgId = files[0]?.messageId;

  // 1. PRIORIDAD MÁXIMA: Overrides explícitos manuales del usuario (local y sincronizado)
  const idStr = String(id || "");
  const idRaw = idStr.replace(/^ext-/, "");
  const idExt = idRaw ? `ext-${idRaw}` : "";

  const override = getOverride(idStr) ||
    (idRaw ? getOverride(idRaw) : null) ||
    (idExt ? getOverride(idExt) : null) ||
    (firstMsgId && virtualId ? getOverride(`${virtualId}:${firstMsgId}`) : null) ||
    (firstMsgId && rawVirtualId ? getOverride(`${rawVirtualId}:${firstMsgId}`) : null) ||
    (firstMsgId && extVirtualId ? getOverride(`${extVirtualId}:${firstMsgId}`) : null) ||
    files.map(f => getOverride(f.key) || (f.messageId && virtualId ? getOverride(`${virtualId}:${f.messageId}`) : null) || (f.messageId && rawVirtualId ? getOverride(`${rawVirtualId}:${f.messageId}`) : null)).find(Boolean) ||
    (tmdbId ? getOverrideByTmdbId(tmdbId) : null);

  let finalMeta = null;
  if (override) {
    finalMeta = { ...override };
  } else {
    // 2. Metadatos manuales guardados en metadataMap
    const saved = metadataMap[idStr] ||
      (idRaw ? metadataMap[idRaw] : null) ||
      (idExt ? metadataMap[idExt] : null) ||
      (tmdbId ? (metadataMap[`tmdb_${tmdbId}`] || metadataMap[String(tmdbId)]) : null) ||
      (firstMsgId && virtualId ? metadataMap[`${virtualId}:${firstMsgId}`] : null) ||
      (firstMsgId && rawVirtualId ? metadataMap[`${rawVirtualId}:${firstMsgId}`] : null) ||
      files.map(f => metadataMap[f.key] || (f.messageId && virtualId ? metadataMap[`${virtualId}:${f.messageId}`] : null) || (f.messageId && rawVirtualId ? metadataMap[`${rawVirtualId}:${f.messageId}`] : null)).find(Boolean);

    if (saved) {
      finalMeta = { ...saved };
    } else {
      // 3. Fallback: Metadatos previos del propio archivo (si vinieron de escaneo válido)
      const fileWithMeta = files.find(f => f.metadata) || files[0];
      if (fileWithMeta?.metadata) finalMeta = { ...fileWithMeta.metadata };
    }
  }

  if (finalMeta && typeof finalMeta === 'object') {
    if (!finalMeta.year) {
      const d = finalMeta.date || finalMeta.release_date || finalMeta.first_air_date;
      if (d) {
        const ym = String(d).match(/\b((?:19|20)\d{2})\b/);
        if (ym) finalMeta.year = ym[1];
      }
    }
  }
  return finalMeta;
}

const GENERIC_SERIES_NAME_RE = /^(?:serie|desconocida|unknown|sin secci[oó]n|\(sin secci[oó]n\)|video|file|input|\d+)$/i;

function isValidSeriesCandidate(name) {
  if (!name || typeof name !== 'string') return false;
  const trimmed = name.trim();
  if (trimmed.length < 2) return false;
  if (GENERIC_SERIES_NAME_RE.test(trimmed)) return false;
  return true;
}

/**
 * Función modular y reutilizable para construir los títulos de la biblioteca
 * a partir de un registro de canal externo y su lista de archivos de vídeo detectados.
 */
export function buildTitlesForExternalChannel(channelRecord, detectedFiles, metadataMap = {}) {
  const generatedTitles = [];
  const virtualId = String(channelRecord.id);
  const category = channelRecord.category || 'Películas';
  const groupName = channelRecord.group || channelRecord.name || channelRecord.title || 'Externo';

  applyEpisodeOverrides(detectedFiles);

  // Normalizar y asegurar temporada/episodio en todos los archivos detectados
  for (const f of detectedFiles) {
    if (!f) continue;
    if (!f.season || f.season <= 0 || !f.episode || f.episode <= 0) {
      const epFile = parseEpisode(f.captionFileName || f.fileName || f.label || '');
      const epCap = parseEpisode(f.rawCaption || f.caption || '');
      const sDet = epFile.season > 0 ? epFile.season : epCap.season;
      const eDet = epFile.episode > 0 ? epFile.episode : epCap.episode;
      if (sDet > 0 && (!f.season || f.season <= 0)) f.season = sDet;
      if (eDet > 0 && (!f.episode || f.episode <= 0)) f.episode = eDet;
    }
    if (f.season === 0 && (!f.isSpecial && !/especial|extra/i.test(f.captionFileName || f.fileName || f.label || ''))) {
      f.season = 1;
    }
  }

  const trailingSeriesMap = detectTrailingSeriesMap(detectedFiles);

  if (category === 'Películas') {
    const movieMap = new Map();
    const seriesDetectedMap = new Map();

    for (const f of detectedFiles) {
      const trailingInfo = getTrailingSeriesForFile(f.captionFileName || f.fileName, trailingSeriesMap);
      if (trailingInfo?.candidate && isValidSeriesCandidate(trailingInfo.candidate)) {
        const normKey = normalizeMovieKey(trailingInfo.candidate);
        if (!seriesDetectedMap.has(normKey)) {
          seriesDetectedMap.set(normKey, {
            id: `${virtualId}#${trailingInfo.candidate}`,
            nombre: trailingInfo.candidate,
            yearHint: trailingInfo.year || null,
            files: [f],
            tmdbId: f.tmdbId || null,
            imdbId: f.imdbId || null,
          });
        } else {
          const sGrp = seriesDetectedMap.get(normKey);
          sGrp.files.push(f);
          if (!sGrp.tmdbId && f.tmdbId) sGrp.tmdbId = f.tmdbId;
          if (!sGrp.yearHint && trailingInfo.year) sGrp.yearHint = trailingInfo.year;
        }
        continue;
      }

      const targetFileName = f.captionFileName || f.fileName || f.label;
      const fileParsed = extractTitleAndYear(targetFileName);
      const isGeneric = /^(video|file|document|input|stream)?_?\d+(\.[a-zA-Z0-9]+)?$/i.test(String(targetFileName || "").trim());

      let parsed = null;
      if (!isGeneric && fileParsed.title) {
        parsed = fileParsed;
      } else {
        const captionCand = extractTitlesFromCaption(f.rawCaption || f.caption || "")[0];
        parsed = captionCand || fileParsed;
      }
      const baseName = parsed.title || f.label;
      const finalYear = parsed.year || fileParsed.year || null;
      const key = f.tmdbId ? `tmdb_${f.tmdbId}` : `${baseName.toLowerCase().trim()}_${finalYear || ""}`;

      if (!movieMap.has(key)) {
        movieMap.set(key, {
          id: `${virtualId}:${f.messageId}`,
          nombre: baseName,
          yearHint: finalYear,
          files: [f],
          tmdbId: f.tmdbId || null,
          imdbId: f.imdbId || null,
        });
      } else {
        const grp = movieMap.get(key);
        grp.files.push(f);
        if (!grp.tmdbId && f.tmdbId) grp.tmdbId = f.tmdbId;
        if (!grp.yearHint && finalYear) grp.yearHint = finalYear;
      }
    }

    for (const sGrp of seriesDetectedMap.values()) {
      sGrp.files.sort((a, b) => ((Number(a.season) || 1) - (Number(b.season) || 1)) || ((Number(a.episode) || 1) - (Number(b.episode) || 1)) || ((Number(b.size) || 0) - (Number(a.size) || 0)) || (a.date - b.date));
      const savedMeta = resolveExternalMetadata(sGrp.id, sGrp.tmdbId, sGrp.files, virtualId, metadataMap);
      const titleObj = {
        id: String(sGrp.id),
        tipo: 'serie',
        isSaga: false,
        grupo: groupName,
        nombre: savedMeta?.name || savedMeta?.title || sGrp.nombre,
        yearHint: savedMeta?.year || sGrp.yearHint,
        origen: { tipo: 'externo', channelId: String(virtualId), messageId: sGrp.files[0].messageId },
        channel: { ...channelRecord, category: 'Series' },
        archivos: sGrp.files,
        ultimoMensajeFecha: sGrp.files.reduce((m, f) => Math.max(m, f.date || 0), 0),
        tmdbId: savedMeta?.id || sGrp.tmdbId || null,
        imdbId: savedMeta?.imdbId || sGrp.imdbId || null,
        metadata: savedMeta || null,
      };
      if (savedMeta?.poster) titleObj.poster = savedMeta.poster;
      if (savedMeta?.background || savedMeta?.backdrop) titleObj.backdrop = savedMeta.background || savedMeta.backdrop;
      generatedTitles.push(titleObj);
    }

    for (const grp of movieMap.values()) {
      grp.files.sort((a, b) => (Number(b.size) || 0) - (Number(a.size) || 0) || (b.date || 0) - (a.date || 0));
      const savedMeta = resolveExternalMetadata(grp.id, grp.tmdbId, grp.files, virtualId, metadataMap);
      const isCollection = savedMeta?.type === 'collection' || savedMeta?.collection;
      const titleObj = {
        id: String(grp.id),
        tipo: 'pelicula',
        isSaga: false,
        isCollection: Boolean(isCollection),
        collection: savedMeta?.collection || null,
        grupo: groupName,
        nombre: savedMeta?.name || savedMeta?.title || grp.nombre,
        yearHint: savedMeta?.year || grp.yearHint,
        origen: { tipo: 'externo', channelId: String(virtualId), messageId: grp.files[0].messageId },
        channel: channelRecord,
        archivos: grp.files,
        ultimoMensajeFecha: grp.files.reduce((m, f) => Math.max(m, f.date || 0), 0),
        tmdbId: savedMeta?.id || grp.tmdbId || null,
        imdbId: savedMeta?.imdbId || grp.imdbId || null,
        metadata: savedMeta || null,
      };
      if (savedMeta?.poster) titleObj.poster = savedMeta.poster;
      if (savedMeta?.background || savedMeta?.backdrop) titleObj.backdrop = savedMeta.background || savedMeta.backdrop;
      generatedTitles.push(titleObj);
    }
  } else if (category === 'Sagas') {
    const sagaMap = new Map();
    for (const f of detectedFiles) {
      const targetFileName = f.captionFileName || f.fileName || f.label;
      const fileParsed = extractTitleAndYear(targetFileName);
      const isGeneric = /^(video|file|document|input|stream)?_?\d+(\.[a-zA-Z0-9]+)?$/i.test(String(targetFileName || "").trim());

      let parsed = null;
      if (!isGeneric && fileParsed.title) {
        parsed = fileParsed;
      } else {
        const captionCand = extractTitlesFromCaption(f.rawCaption || f.caption || "")[0];
        parsed = captionCand || fileParsed;
      }
      const baseName = parsed.title || f.label;
      const finalYear = parsed.year || fileParsed.year || null;
      const key = f.tmdbId ? `tmdb_${f.tmdbId}` : `${baseName.toLowerCase().trim()}_${finalYear || ""}`;

      if (!sagaMap.has(key)) {
        sagaMap.set(key, {
          id: `${virtualId}:${f.messageId}`,
          nombre: baseName,
          yearHint: finalYear,
          files: [f],
          tmdbId: f.tmdbId || null,
          imdbId: f.imdbId || null,
        });
      } else {
        const grp = sagaMap.get(key);
        grp.files.push(f);
        if (!grp.tmdbId && f.tmdbId) grp.tmdbId = f.tmdbId;
        if (!grp.yearHint && finalYear) grp.yearHint = finalYear;
      }
    }

    for (const grp of sagaMap.values()) {
      grp.files.sort((a, b) => (Number(b.size) || 0) - (Number(a.size) || 0) || (b.date || 0) - (a.date || 0));
      const savedMeta = resolveExternalMetadata(grp.id, grp.tmdbId, grp.files, virtualId, metadataMap);
      const titleObj = {
        id: String(grp.id),
        tipo: 'pelicula',
        isSaga: true,
        grupo: groupName,
        nombre: savedMeta?.name || savedMeta?.title || grp.nombre,
        yearHint: savedMeta?.year || grp.yearHint,
        origen: { tipo: 'externo', channelId: String(virtualId), messageId: grp.files[0].messageId },
        channel: channelRecord,
        archivos: grp.files,
        ultimoMensajeFecha: grp.files.reduce((m, f) => Math.max(m, f.date || 0), 0),
        tmdbId: savedMeta?.id || grp.tmdbId || null,
        imdbId: savedMeta?.imdbId || grp.imdbId || null,
        metadata: savedMeta || null,
      };
      if (savedMeta?.poster) titleObj.poster = savedMeta.poster;
      if (savedMeta?.background || savedMeta?.backdrop) titleObj.backdrop = savedMeta.background || savedMeta.backdrop;
      generatedTitles.push(titleObj);
    }
  } else if (category === 'Series') {
    // Procesar en orden cronológico por messageId para agrupar episodios que van seguidos
    const sortedDetectedFiles = [...detectedFiles].sort((a, b) => (Number(a.messageId) || 0) - (Number(b.messageId) || 0) || ((a.date || 0) - (b.date || 0)));
    const numberedSeriesMap = detectNumberedSeriesMap(detectedFiles);

    const seriesTmdbMap = new Map();
    const seriesNameMap = new Map();
    const unknownGroups = [];

    let currentUnknownGroup = null;
    let unknownCounter = 0;
    let lastEpNumber = null;
    let lastSeasonNumber = null;
    let lastMsgId = null;

    for (const f of sortedDetectedFiles) {
      const fMeta = resolveExternalMetadata(null, f.tmdbId, [f], virtualId, metadataMap);
      const fileTmdbId = fMeta?.id || f.tmdbId || null;
      const trailingInfo = getTrailingSeriesForFile(f.captionFileName || f.fileName, trailingSeriesMap);
      const numberedInfo = getNumberedSeriesForFile(f.captionFileName || f.fileName, numberedSeriesMap);
      const prefixCandidate = seriesNameFromFile(f.captionFileName || f.fileName, trailingSeriesMap, numberedSeriesMap);

      let knownName = null;
      const manualMove = getEpisodeSeriesMove(f) || f.seriesMove;
      if (manualMove && (manualMove.targetSeriesName || manualMove.targetTitleName)) {
        knownName = manualMove.targetSeriesName || manualMove.targetTitleName;
        if (Number.isInteger(manualMove.season)) f.season = manualMove.season;
        if (Number.isInteger(manualMove.episode)) f.episode = manualMove.episode;
      } else if (isValidSeriesCandidate(fMeta?.name || fMeta?.title)) {
        knownName = fMeta.name || fMeta.title;
      } else if (isValidSeriesCandidate(trailingInfo?.candidate)) {
        knownName = trailingInfo.candidate;
      } else if (isValidSeriesCandidate(numberedInfo?.candidate)) {
        knownName = numberedInfo.candidate;
        if (!f.season || f.season === 0) f.season = numberedInfo.season;
        if (!f.episode || f.episode === 0) f.episode = numberedInfo.episode;
      } else if (isValidSeriesCandidate(prefixCandidate)) {
        knownName = prefixCandidate;
      }

      if (!f.season || f.season <= 0) {
        const epF = parseEpisode(f.captionFileName || f.fileName || f.label || '');
        const epC = parseEpisode(f.rawCaption || f.caption || '');
        const s = epF.season > 0 ? epF.season : epC.season;
        f.season = s > 0 ? s : 1;
      }
      if (!f.episode || f.episode <= 0) {
        const epF = parseEpisode(f.captionFileName || f.fileName || f.label || '');
        const epC = parseEpisode(f.rawCaption || f.caption || '');
        const e = epF.episode > 0 ? epF.episode : epC.episode;
        if (e > 0) f.episode = e;
      }

      // Si el episodio tiene TMDB ID o nombre de serie válido
      if (fileTmdbId || knownName) {
        // Interrumpir cualquier serie desconocida activa
        currentUnknownGroup = null;
        lastEpNumber = null;
        lastSeasonNumber = null;
        lastMsgId = null;

        const sName = knownName || `Serie TMDB ${fileTmdbId}`;
        const cleanBase = normalizeMovieKey(sName).replace(/(?:19|20)\d{2}/g, '');
        const fileYear = trailingInfo?.year || fMeta?.year || null;

        let grp = null;
        if (fileTmdbId && seriesTmdbMap.has(String(fileTmdbId))) {
          grp = seriesTmdbMap.get(String(fileTmdbId));
        } else if (cleanBase && seriesNameMap.has(cleanBase)) {
          grp = seriesNameMap.get(cleanBase);
        }

        if (!grp) {
          grp = {
            id: `${virtualId}#${sName}`,
            nombre: sName,
            yearHint: fileYear,
            files: [f],
            tmdbId: fileTmdbId,
            imdbId: fMeta?.imdbId || f.imdbId || null,
            metadata: fMeta || null,
          };
          if (fileTmdbId) seriesTmdbMap.set(String(fileTmdbId), grp);
          if (cleanBase) seriesNameMap.set(cleanBase, grp);
        } else {
          grp.files.push(f);
          if (!grp.tmdbId && fileTmdbId) {
            grp.tmdbId = fileTmdbId;
            seriesTmdbMap.set(String(fileTmdbId), grp);
          }
          if (!grp.yearHint && fileYear) grp.yearHint = fileYear;
          if (!grp.metadata && fMeta) grp.metadata = fMeta;
          if (fMeta?.name && grp.nombre !== fMeta.name) grp.nombre = fMeta.name;
        }
        continue;
      }

      // Si no se sabe de qué serie son: los episodios van todos seguidos.
      // Se agrupan como "Serie desconocida [0-100]" asignando un número secuencial según se encuentran.
      const ep = parseEpisode(f.captionFileName || f.fileName || f.label);
      const currentSeason = ep.season || 1;
      const currentEpisode = ep.episode || 0;
      const currentMsgId = Number(f.messageId) || 0;

      let startNewUnknown = false;
      if (!currentUnknownGroup) {
        startNewUnknown = true;
      } else if (currentSeason < (lastSeasonNumber || 1)) {
        // La temporada retrocedió -> nueva serie
        startNewUnknown = true;
      } else if (currentEpisode === 1 && (lastEpNumber || 0) > 1 && currentSeason <= (lastSeasonNumber || 1)) {
        // El episodio se reinició a 1 tras varios episodios -> nueva serie
        startNewUnknown = true;
      } else if (currentSeason === (lastSeasonNumber || 1) && currentEpisode > 0 && (lastEpNumber || 0) > 0 && currentEpisode < (lastEpNumber || 0)) {
        // En la misma temporada el episodio retrocedió -> nueva serie
        startNewUnknown = true;
      } else if (lastMsgId && (currentMsgId - lastMsgId > 150)) {
        // Salto excesivo de mensajes en el chat
        startNewUnknown = true;
      }

      if (startNewUnknown) {
        unknownCounter++;
        const unknownName = `Serie desconocida ${unknownCounter}`;
        currentUnknownGroup = {
          id: `${virtualId}#desconocida_${unknownCounter}`,
          nombre: unknownName,
          yearHint: null,
          files: [f],
          tmdbId: null,
          imdbId: null,
          metadata: null,
          isUnknownSeries: true,
        };
        unknownGroups.push(currentUnknownGroup);
      } else {
        currentUnknownGroup.files.push(f);
      }

      if (currentEpisode > 0) lastEpNumber = currentEpisode;
      if (currentSeason > 0) lastSeasonNumber = currentSeason;
      lastMsgId = currentMsgId;
    }

    const uniqueGroups = new Set([...seriesTmdbMap.values(), ...seriesNameMap.values(), ...unknownGroups]);
    for (const grp of uniqueGroups) {
      grp.files.sort((a, b) => ((Number(a.season) || 1) - (Number(b.season) || 1)) || ((Number(a.episode) || 1) - (Number(b.episode) || 1)) || ((Number(b.size) || 0) - (Number(a.size) || 0)) || (a.date - b.date));
      const savedMeta = grp.metadata || resolveExternalMetadata(grp.id, grp.tmdbId, grp.files, virtualId, metadataMap);
      const isUnknown = grp.isUnknownSeries && !savedMeta?.id;
      const titleObj = {
        id: String(grp.id),
        tipo: 'serie',
        isSaga: false,
        grupo: groupName,
        nombre: savedMeta?.name || savedMeta?.title || grp.nombre,
        yearHint: savedMeta?.year || grp.yearHint,
        origen: { tipo: 'externo', channelId: String(virtualId) },
        channel: channelRecord,
        archivos: grp.files,
        ultimoMensajeFecha: grp.files.reduce((m, f) => Math.max(m, f.date || 0), 0),
        tmdbId: savedMeta?.id || grp.tmdbId || null,
        imdbId: savedMeta?.imdbId || grp.imdbId || null,
        metadata: savedMeta || null,
        isUnknownSeries: isUnknown,
      };
      if (savedMeta?.poster) titleObj.poster = savedMeta.poster;
      if (savedMeta?.background || savedMeta?.backdrop) titleObj.backdrop = savedMeta.background || savedMeta.backdrop;
      generatedTitles.push(titleObj);
    }
  } else {
    // Modo genérico / Documentales / Deportes / Música
    const sortedFiles = [...detectedFiles].sort((a, b) => (b.date || 0) - (a.date || 0));
    const targetTmdb = sortedFiles.find(f => f.tmdbId)?.tmdbId || null;
    const savedMeta = resolveExternalMetadata(virtualId, targetTmdb, sortedFiles, virtualId, metadataMap);
    const titleObj = {
      id: virtualId,
      tipo: category === 'Deportes' ? 'deporte' : category === 'Música' ? 'musica' : 'documental',
      isSaga: false,
      grupo: groupName,
      nombre: savedMeta?.name || savedMeta?.title || channelRecord.title || groupName,
      yearHint: savedMeta?.year || null,
      origen: { tipo: 'externo', channelId: String(virtualId) },
      channel: channelRecord,
      archivos: sortedFiles,
      ultimoMensajeFecha: sortedFiles[0]?.date || 0,
      tmdbId: savedMeta?.id || targetTmdb || null,
      imdbId: savedMeta?.imdbId || null,
      metadata: savedMeta || null,
    };
    if (savedMeta?.poster) titleObj.poster = savedMeta.poster;
    if (savedMeta?.background || savedMeta?.backdrop) titleObj.backdrop = savedMeta.background || savedMeta.backdrop;
    generatedTitles.push(titleObj);
  }

  return applySeriesMoves(generatedTitles);
}
