/**
 * Capa de datos: convierte canales (dedicados, contenedores de año y macro) en "Títulos" unificados.
 * No toca el DOM.
 */
import { isVideoMessage, getFileName, parseCaption, parseEpisode, prettyName } from './parse.js';
import { splitBySection } from './macro.js';
import { parseChannelTitle } from './channels.js';

async function scanFiles(client, peer, ch) {
  const files = [];
  for await (const msg of client.iterMessages(peer)) {
    if (!isVideoMessage(msg)) continue;
    const cap = parseCaption(msg.message || '');
    const fileName = getFileName(msg) || cap.fileName || `video_${msg.id}`;
    const ep = parseEpisode(fileName);
    const doc = msg.document || msg.media?.document;
    const durAttr = doc?.attributes?.find(a => a.className === 'DocumentAttributeVideo');
    files.push({
      key: `${ch.id}:${msg.id}`, channelId: ch.id, messageId: msg.id,
      channel: ch,
      fileName, label: prettyName(fileName), section: cap.section || null,
      synopsis: cap.synopsis || null, tmdbId: cap.tmdbId || null,
      season: ep.season, episode: ep.episode,
      size: Number(doc?.size?.toString?.() || doc?.size || 0),
      duration: durAttr?.duration || 0, mimeType: doc?.mimeType || 'video/mp4', date: msg.date,
    });
  }
  return files;
}

function sortFiles(files, tipo) {
  if (tipo === 'pelicula') return files.sort((a, b) => b.date - a.date);
  return files.sort((a, b) => (a.season - b.season) || (a.episode - b.episode) || (a.date - b.date));
}

function makeTitle({ id, ch, name, origen, seccion, files }) {
  const tipo = ch.category === 'Películas' ? 'pelicula' : 'serie';
  sortFiles(files, tipo);
  return {
    id, tipo, grupo: ch.group, nombre: name,
    origen: { tipo: origen, channelId: ch.id, seccion: seccion || null },
    channel: ch, archivos: files,
    ultimoMensajeFecha: files.reduce((m, f) => Math.max(m, f.date), 0),
    tmdbId: files.find(f => f.tmdbId)?.tmdbId || null,
  };
}

const YEAR_RE = /\b((?:19|20)\d{2})\b/;
const YEAR_GROUP_RE = /^(?:por\s+año|por\s+ano|años|anos|décadas|decadas|por\s+década|por\s+decada)$/i;

function movieName(file) {
  return String(file.fileName || file.label || `video_${file.messageId}`)
    .replace(/\.(mkv|mp4|avi|mov|m4v|webm|ts)$/i, '')
    .replace(/[._]+/g, ' ')
    .replace(/\b(2160p|1080p|720p|480p|bluray|brrip|webrip|web[- ]?dl|hdtv|x26[45]|h26[45]|hevc)\b.*/i, '')
    .replace(/\s+/g, ' ').trim();
}

function normalizeMovieKey(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(castellano|latino|spa|esp|eng|dual|multi|subs?|vose|uhd|remux|hdr|dts|ac3|aac|x264|x265)\b/gi, '')
    .replace(/[^a-z0-9]/g, '');
}

/** cache: { [channelId]: { top, title, files } } */
export async function buildTitles(client, channels, peerOf, onProgress, cache = {}) {
  const titles = [];
  const newCache = {};
  let done = 0;
  await Promise.all(channels.map(async (rawChannel) => {
    // Recupera las banderas derivadas también de la caché local creada antes de esta mejora.
    const ch = { ...rawChannel };
    const parsed = parseChannelTitle(ch.title);
    if (parsed) Object.assign(ch, { name: parsed.name, group: parsed.group, category: parsed.category, macro: !!parsed.macro, isYearContainer: !!parsed.isYearContainer, isSaga: !!parsed.isSaga });
    const prev = cache[ch.id];
    let files = [];
    if (prev && (!client || (prev.top === ch.top && prev.title === ch.title && ch.top))) {
      files = prev.files.map(f => ({ ...f, channel: f.channel || ch }));
    } else {
      try { files = await scanFiles(client, peerOf(ch), ch); }
      catch (e) { console.warn('[titles] no se pudo leer', ch.title, e); }
    }
    newCache[ch.id] = { top: ch.top, title: ch.title, files: files.map(f => ({ ...f })) };

    if (ch.isYearContainer) {
      // Un canal por año es un contenedor: agrupa múltiples versiones de la misma película en una sola ficha
      const channelYear = ch.name.match(YEAR_RE)?.[1] || null;
      const movieMap = new Map();
      for (const f of files) {
        const yearHint = f.fileName.match(YEAR_RE)?.[1] || channelYear;
        const baseName = movieName(f);
        const normKey = f.tmdbId ? `tmdb_${f.tmdbId}` : `${normalizeMovieKey(baseName)}_${yearHint || ''}`;
        if (!movieMap.has(normKey)) {
          movieMap.set(normKey, {
            id: `${ch.id}:${f.messageId}`,
            nombre: baseName,
            yearHint,
            files: [f],
            tmdbId: f.tmdbId || null,
          });
        } else {
          const grp = movieMap.get(normKey);
          grp.files.push(f);
          if (!grp.tmdbId && f.tmdbId) grp.tmdbId = f.tmdbId;
          if (baseName.length < grp.nombre.length && baseName.length > 2) {
            grp.nombre = baseName;
          }
        }
      }
      for (const grp of movieMap.values()) {
        sortFiles(grp.files, 'pelicula');
        titles.push({
          id: grp.id, tipo: 'pelicula', isSaga: false,
          grupo: grp.yearHint || ch.group || ch.name,
          nombre: grp.nombre, yearHint: grp.yearHint,
          origen: { tipo: 'año_container', channelId: ch.id, messageId: grp.files[0].messageId },
          channel: ch, archivos: grp.files,
          ultimoMensajeFecha: grp.files.reduce((m, f) => Math.max(m, f.date), 0),
          tmdbId: grp.tmdbId,
        });
      }
    } else if (ch.isSaga) {
      // La saga permanece agrupada como una tarjeta única.
      const sagaFiles = files.map(f => ({ ...f, sagaName: movieName(f) }));
      titles.push({
        id: String(ch.id), tipo: 'pelicula', isSaga: true, grupo: ch.group || 'Sagas',
        nombre: ch.name, origen: { tipo: 'saga', channelId: ch.id }, channel: ch,
        archivos: sagaFiles, ultimoMensajeFecha: files.reduce((m, f) => Math.max(m, f.date), 0),
        tmdbId: files.find(f => f.tmdbId)?.tmdbId || null,
      });
    } else if (ch.macro) {
      for (const [sec, fs] of splitBySection(files)) {
        titles.push(makeTitle({ id: `${ch.id}#${sec}`, ch, name: sec, origen: 'macro', seccion: sec, files: fs }));
      }
    } else {
      titles.push(makeTitle({ id: ch.id, ch, name: ch.name, origen: 'dedicado', files }));
    }
    onProgress?.(++done, channels.length);
  }));
  return { titles, cache: newCache };
}
