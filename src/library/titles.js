/**
 * Capa de datos: convierte canales (dedicados y macro) en "Títulos" unificados.
 * No toca el DOM.
 */
import { isVideoMessage, getFileName, parseCaption, parseEpisode, prettyName } from './parse.js';
import { splitBySection } from './macro.js';

async function scanFiles(client, peer, ch) {
  const files = [];
  for await (const msg of client.iterMessages(peer, { limit: 500 })) {
    if (!isVideoMessage(msg)) continue;
    const cap = parseCaption(msg.message || '');
    const fileName = getFileName(msg) || cap.fileName || `video_${msg.id}`;
    const ep = parseEpisode(fileName);
    const doc = msg.document || msg.media?.document;
    const durAttr = doc?.attributes?.find(a => a.className === 'DocumentAttributeVideo');
    files.push({
      key: `${ch.id}:${msg.id}`,
      channelId: ch.id,
      messageId: msg.id,
      fileName,
      label: prettyName(fileName),
      section: cap.section || null,
      synopsis: cap.synopsis || null,
      season: ep.season,
      episode: ep.episode,
      size: Number(doc?.size?.toString?.() || doc?.size || 0),
      duration: durAttr?.duration || 0,
      mimeType: doc?.mimeType || 'video/mp4',
      date: msg.date,
    });
  }
  return files;
}

function sortFiles(files, tipo) {
  if (tipo === 'pelicula') return files.sort((a, b) => b.date - a.date);
  return files.sort((a, b) =>
    (a.season - b.season) || (a.episode - b.episode) || (a.date - b.date));
}

function makeTitle({ id, ch, name, origen, seccion, files }) {
  const tipo = ch.category === 'Películas' ? 'pelicula' : 'serie';
  sortFiles(files, tipo);
  return {
    id, tipo, grupo: ch.group, nombre: name,
    origen: { tipo: origen, channelId: ch.id, seccion: seccion || null },
    channel: ch,
    archivos: files,
    ultimoMensajeFecha: files.reduce((m, f) => Math.max(m, f.date), 0),
    tmdbId: null,
  };
}

/**
 * cache: { [channelId]: { top, title, files } } — los canales sin cambios no se vuelven a leer.
 * Devuelve { titles, cache } con la caché actualizada.
 */
export async function buildTitles(client, channels, peerOf, onProgress, cache = {}) {
  const titles = [];
  const newCache = {};
  let done = 0;
  await Promise.all(channels.map(async (ch) => {
    const prev = cache[ch.id];
    let files = [];
    if (prev && (!client || (prev.top === ch.top && prev.title === ch.title && ch.top))) {
      files = prev.files.map(f => ({ ...f }));
    } else {
      try { files = await scanFiles(client, peerOf(ch), ch); }
      catch (e) { console.warn('[titles] no se pudo leer', ch.title, e); }
    }
    newCache[ch.id] = { top: ch.top, title: ch.title, files: files.map(f => ({ ...f })) };

    if (ch.macro) {
      for (const [sec, fs] of splitBySection(files)) {
        titles.push(makeTitle({ id: `${ch.id}#${sec}`, ch, name: sec, origen: 'macro', seccion: sec, files: fs }));
      }
    } else {
      // Dedicado: se muestra siempre, aunque no tenga archivos aún
      titles.push(makeTitle({ id: ch.id, ch, name: ch.name, origen: 'dedicado', files }));
    }
    onProgress?.(++done, channels.length);
  }));
  return { titles, cache: newCache };
}
