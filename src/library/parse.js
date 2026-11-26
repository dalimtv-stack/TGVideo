// src/library/parse.js
// Parseo de nombres de archivo y captions (sin TMDB todavía)
const VIDEO_EXT = /\.(mkv|mp4|avi|mov|m4v|webm|ts|m2ts)$/i;

export function getFileName(msg) {
  const doc = msg.document || msg.media?.document;
  const attr = doc?.attributes?.find(a => a.className === 'DocumentAttributeFilename');
  return attr?.fileName || '';
}

export function isVideoMessage(msg) {
  const doc = msg.document || msg.media?.document;
  if (!doc) return false;
  if (String(doc.mimeType || '').startsWith('video/')) return true;
  return VIDEO_EXT.test(getFileName(msg));
}

export function parseCaption(text = '') {
  const out = {};
  for (const line of String(text).split('\n')) {
    const m = line.match(/^\s*([^:]+):\s*(.+)$/);
    if (!m) continue;
    const k = m[1].trim().toLowerCase();
    const v = m[2].trim();
    if (k === 'sección' || k === 'seccion') out.section = v;
    else if (k === 'nombre de archivo' || k === 'nombre del archivo' || k === 'nombre archivo' || k === 'filename') out.fileName = v;
    else if (k === 'id tmdb' || k === 'tmdb id' || k === 'tmdb') out.tmdbId = v;
    else if (k === 'id imdb' || k === 'imdb id' || k === 'imdb') out.imdbId = v;
    else if (k === 'director') out.director = v;
    else if (k === 'guionista' || k === 'guion') out.writer = v;
    else if (k === 'casting' || k === 'reparto') out.cast = v;
    else if (k === 'puntuación' || k === 'puntuacion') out.rating = v;
    else if (k === 'edad') out.ageRating = v;
    else if (k === 'sinopsis') out.synopsis = v;
  }
  return out;
}

export function buildStandardCaption({
  fileName,
  section,
  tmdbId,
  imdbId,
  director,
  writer,
  cast,
  rating,
  ageRating,
  synopsis = ''
}) {
  const lines = [];
  if (fileName) lines.push(`Nombre de archivo: ${fileName}`);
  if (section) lines.push(`Sección: ${section}`);
  if (tmdbId) lines.push(`ID TMDB: ${tmdbId}`);
  if (imdbId) lines.push(`ID IMDB: ${imdbId}`);
  if (director) lines.push(`Director: ${director}`);
  if (writer) lines.push(`Guionista: ${writer}`);
  if (cast) lines.push(`Casting: ${cast}`);
  if (rating) lines.push(`Puntuación: ${rating}`);
  if (ageRating) lines.push(`Edad: ${ageRating}`);

  let base = lines.join('\n');
  if (synopsis) {
    const headerWithKey = base ? `${base}\nSinopsis: ` : 'Sinopsis: ';
    const remaining = 1024 - headerWithKey.length - 1;
    if (remaining > 30) {
      const maxSynopsis = Math.min(remaining - 1, 350);
      const trimmed = synopsis.length > maxSynopsis ? synopsis.slice(0, maxSynopsis).trim() + '…' : synopsis;
      base = `${headerWithKey}${trimmed}`;
    }
  }
  return base.slice(0, 1024);
}

/**
 * S01E02, 1x02, T7 C14, T07C14, T01, E04, Temporada 3, capítulo 2,
 * Lupin T1 C01, "Episodio 3", "Cap 3", etc.
 */
export function parseEpisode(name = '') {
  const clean = String(name || '').replace(/[._]+/g, ' ');

  // 1. Temporada con Episodio explícito:
  // S01E02, T01E02, T01, E04, T1, C01, Temp 1, Cap 4, Temporada 3, capítulo 2,
  // Lupin T1 C01, S1-E4, Temp 3 - Cap 2, etc.
  let m = clean.match(/\b(?:T(?:emp(?:orada)?)?|S(?:eason)?)[\s,–—.:_-]*(\d{1,2})[\s,–—.:_-]*(?:[EC]|ep(?:isodio)?|cap(?:[ií]tulo)?|ch(?:apter)?)[\s,–—.:_-]*(\d{1,4})(?!\d)/i);
  if (m) return { season: +m[1], episode: +m[2] };

  // 2. 7x14, 07x14, 1x02, 1x105
  m = clean.match(/\b(\d{1,2})\s*x\s*(\d{1,4})(?!\d)/i);
  if (m) return { season: +m[1], episode: +m[2] };

  // 3. T7 - 14, Temp 7 - 14 (sin letra en el episodio si viene precedido de T/Temp claro y separador)
  m = clean.match(/\b(?:T(?:emp(?:orada)?)?|S(?:eason)?)[\s,–—.:_-]*(\d{1,2})[\s,–—.:-]+(\d{1,4})(?!\d)/i);
  if (m) return { season: +m[1], episode: +m[2] };

  // 4. Solo episodio: Episodio 3, Cap 3, Capitulo 14, Ep 59, C04, Ch 2
  m = clean.match(/\b(?:ep(?:isodio)?|cap(?:[ií]tulo)?)\b[\s,–—.:_-]*(\d{1,4})(?!\d)/i);
  if (m) return { season: 1, episode: +m[1] };

  return { season: 0, episode: 0 };
}

export function prettyName(fileName = '') {
  return fileName.replace(VIDEO_EXT, '').replace(/[._]+/g, ' ').trim();
}

/** Limpia la etiqueta técnica del nombre de un episodio y deja el título legible. */
export function prettyEpisodeName(fileName = '', showName = '', fallbackEp = null) {
  let label = prettyName(fileName);
  const candidates = [showName].filter(Boolean);
  for (const candidate of candidates) {
    const escaped = String(candidate).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    label = label.replace(new RegExp(`^\\s*${escaped}\\s*[-–—:]*\\s*`, 'i'), '');
    label = label.replace(new RegExp(`\\s*[-–—:]*\\s*${escaped}\\s*$`, 'i'), '');
  }
  label = label
    .replace(/^\s*(?:[ST]\s*\d{1,2}[\s,–—._-]*[EC]\s*\d{1,4}|\d{1,2}\s*x\s*\d{1,4}|(?:T(?:emp(?:orada)?)?|S(?:eason)?)\s*\d{1,2}[\s,–—._-]*(?:[EC]|ep|cap(?:[ií]tulo)?|ch(?:apter)?)?\s*\d{1,4}|(?:ep(?:isodio)?|cap(?:[ií]tulo)?)\s*\d{1,4})\s*[-–—:]*\s*/i, '')
    .replace(/\[[^\]]*\]|\([^)]*\)/g, (part) => /(?:2160|1080|720|480|4k|uhd|bluray|blu\s*ray|hdtv|web[- ]?dl|webrip|brrip|dual|castellano|latino|dts|ac3|x26[45]|h26[45]|hevc)/i.test(part) ? '' : part)
    .replace(/\b(?:2160p|1080p|720p|480p|4k|uhd|bluray|blu\s*ray|hdtv|web[- ]?dl|webrip|brrip|dual|castellano|latino|dts|ac3|x26[45]|h26[45]|hevc)\b.*$/i, '')
    .replace(/[._]+/g, ' ')
    .replace(/\s*[-–—]\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Si tras quitar showName solo queda un número suelto (ej. "59" o "- 59")
  if (/^\s*[-–—:#]*\s*\d{1,4}\s*$/.test(label)) {
    const num = label.match(/\d{1,4}/)[0];
    return `Episodio ${parseInt(num, 10)}`;
  }

  if (showName && (!label || label.toLowerCase() === showName.toLowerCase())) {
    const ep = parseEpisode(fileName);
    const epNum = ep.episode > 0 ? ep.episode : fallbackEp;
    if (epNum > 0) return `Episodio ${epNum}`;
  }
  return label || prettyName(fileName);
}

const GENERIC_BLACKLIST = /^(?:cap[ií]tulo|episodio|ep|cap|parte|part|temporada|temp|season|video|pelicula|movie|serie|unknown|sin secci[oó]n)$/i;

export function normalizeSeriesKey(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(castellano|latino|spa|esp|eng|dual|multi|subs?|vose|uhd|remux|hdr|dts|ac3|aac|x264|x265)\b/gi, '')
    .replace(/[^a-z0-9]/g, '');
}

export function cleanTrailingCandidate(trailing = '') {
  if (!trailing) return null;
  let str = String(trailing).trim();

  // 1. Quitar corchetes y paréntesis extrayendo año si existe
  let year = null;
  str = str.replace(/\[[^\]]*\]/g, ' ').replace(/\([^)]*\)/g, (match) => {
    const ym = match.match(/\b((?:19|20)\d{2})\b/);
    if (ym) year = ym[1];
    return ' ';
  });

  // 2. Extraer año si quedó suelto al final
  if (!year) {
    const ym = str.match(/[\(\[]?\s*((?:19|20)\d{2})\s*[\)\]]?\s*$/);
    if (ym) {
      year = ym[1];
      str = str.slice(0, ym.index).trim();
    }
  }

  // 3. Quitar etiquetas técnicas de calidad/códec
  const qualityKw = '(?:bluray|brrip|bdrip|dvdrip|dvd|webrip|web[- ]?dl|hdtv|hdrip|microhd|remux|rip|\\d{3,4}p|[248]k|uhd|x26[45]|h26[45]|hevc|dual|multi|castellano|latino|spanish|spa|esp|sub|subs|vose|eng)';
  const qualityRe = new RegExp(`\\b${qualityKw}\\b.*$`, 'i');
  str = str.replace(qualityRe, ' ');

  // 4. Limpiar corchetes, puntos o símbolos sueltos
  str = str.replace(/[\[\]\(\)]/g, ' ');
  str = str.replace(/[._]+/g, ' ');
  str = str.replace(/[-–—:_.\s]+$/, '').replace(/^\s*[-–—:_.]+/, '').replace(/\s+/g, ' ').trim();

  // 5. Si tiene un subtítulo de episodio tipo "Castle Rock - Capitulo 1", cortar subtítulo
  const subM = str.match(/^(.+?)\s*[-–—:]\s*(?:cap[ií]tulo|episodio|ep|part|parte|\d+)/i);
  const candidate = subM ? subM[1].trim() : str;

  if (candidate.length < 2 || GENERIC_BLACKLIST.test(candidate)) return null;
  return { candidate, year };
}

export function extractTrailingSeriesCandidate(fileName = '') {
  let base = String(fileName).replace(VIDEO_EXT, '').trim();
  // Quitar etiquetas iniciales de canal: [Canal], (Canal), @Canal
  base = base.replace(/^\s*(?:\[[^\]]+\]|\([^)]+\)|@[A-Za-z0-9_]+)\s*/i, '');

  // Detectar código de episodio al inicio (1x01, S01E01, etc.) seguido del nombre de la serie
  const m = base.match(/^\s*(?:[ST]\d{1,2}[\s,–—.:_-]*[EC]\d{1,4}|\d{1,2}\s*x\s*\d{1,4}|(?:T(?:emp(?:orada)?)?|S(?:eason)?)\b[\s,–—.:_-]*\d{1,2}[\s,–—.:_-]*(?:[EC]|ep|cap(?:[ií]tulo)?|ch(?:apter)?)?[\s,–—.:_-]*\d{1,4}|(?:ep(?:isodio)?|cap(?:[ií]tulo)?)\b[\s,–—.:_-]*\d{1,4})\s*[-–—:._]*\s*(.+)$/i);
  if (!m) return null;

  return cleanTrailingCandidate(m[1]);
}

/**
 * Analiza un conjunto de archivos para detectar series cuyo nombre va detrás del número de episodio.
 * Regla: solo se valida si hay VARIOS episodios (>= 2) que compartan ese mismo nombre de serie.
 */
export function detectTrailingSeriesMap(files = []) {
  if (!Array.isArray(files) || files.length === 0) return new Map();

  const counts = new Map();
  for (const f of files) {
    const name = f?.captionFileName || f?.fileName || f?.name || f?.label || '';
    const cand = extractTrailingSeriesCandidate(name);
    if (cand) {
      const norm = normalizeSeriesKey(cand.candidate);
      if (norm) {
        const existing = counts.get(norm);
        if (!existing) {
          counts.set(norm, { count: 1, candidate: cand.candidate, year: cand.year });
        } else {
          existing.count++;
          if (!existing.year && cand.year) existing.year = cand.year;
          if (cand.candidate.length > existing.candidate.length && cand.candidate.length < 50) {
            existing.candidate = cand.candidate;
          }
        }
      }
    }
  }

  const validMap = new Map();
  for (const [norm, data] of counts.entries()) {
    if (data.count >= 2) {
      validMap.set(norm, { candidate: data.candidate, year: data.year, count: data.count });
    }
  }
  return validMap;
}

export function getTrailingSeriesForFile(fileName = '', trailingMap = null) {
  if (!trailingMap || trailingMap.size === 0) return null;
  const cand = extractTrailingSeriesCandidate(fileName);
  if (!cand) return null;
  const norm = normalizeSeriesKey(cand.candidate);
  if (!norm) return null;
  const match = trailingMap.get(norm);
  if (!match) return null;
  return { candidate: match.candidate, year: match.year || cand.year || null };
}

/**
 * Extrae candidato de serie numerada bare ("Yo decido Amar - 59").
 */
export function extractNumberedSeriesCandidate(fileName = '') {
  let base = String(fileName).replace(VIDEO_EXT, '').trim();
  base = base.replace(/^\s*(?:\[[^\]]+\]|\([^)]+\)|@[A-Za-z0-9_]+)\s*/i, '');

  const qualityKw = '(?:bluray|brrip|bdrip|dvdrip|dvd|webrip|web[- ]?dl|hdtv|hdrip|microhd|remux|rip|\\d{3,4}p|[248]k|uhd|x26[45]|h26[45]|hevc|dual|multi|castellano|latino|spanish|spa|esp|sub|subs|vose|eng)';
  base = base.replace(new RegExp(`\\b${qualityKw}\\b.*$`, 'i'), '').trim();

  // Buscar separador seguido de número al final: "Yo decido Amar - 59", "Yo decido Amar #59"
  const m = base.match(/^(.+?)\s*[-–—#:]+\s*(\d{1,4})\s*$/) || base.match(/^(.+?)\s+(\d{1,4})\s*$/);
  if (!m) return null;

  const cand = m[1].replace(/[-–—:._\s]+$/, '').trim();
  const epNum = parseInt(m[2], 10);
  if (epNum <= 0) return null;
  // Años entre 1900 y 2099 se excluyen para no confundir películas con año
  if (m[2].length === 4 && epNum >= 1900 && epNum <= 2099) return null;
  if (!cand || cand.length < 2) return null;
  if (/^(?:video|pelicula|movie|serie|unknown|file|input|sin secci[oó]n)$/i.test(cand)) return null;

  return { candidate: cand, episode: epNum };
}

/**
 * Detecta series numeradas aisladas (ej. "Yo decido Amar - 59").
 * REGLA ESTRICTA: SOLO SERIES y tiene que haber VARIOS episodios (>= 2) con el mismo nombre.
 */
export function detectNumberedSeriesMap(files = []) {
  if (!Array.isArray(files) || files.length === 0) return new Map();

  const groups = new Map();
  for (const f of files) {
    const name = f?.captionFileName || f?.fileName || f?.name || f?.label || '';
    const cand = extractNumberedSeriesCandidate(name);
    if (cand) {
      const norm = normalizeSeriesKey(cand.candidate);
      if (norm) {
        if (!groups.has(norm)) {
          groups.set(norm, { candidate: cand.candidate, episodes: new Set([cand.episode]), count: 1 });
        } else {
          const g = groups.get(norm);
          g.count++;
          g.episodes.add(cand.episode);
          if (cand.candidate.length > g.candidate.length && cand.candidate.length < 50) {
            g.candidate = cand.candidate;
          }
        }
      }
    }
  }

  const validMap = new Map();
  for (const [norm, data] of groups.entries()) {
    // Al menos 2 episodios distintos con el mismo patrón
    if (data.count >= 2) {
      validMap.set(norm, { candidate: data.candidate, count: data.count });
    }
  }
  return validMap;
}

export function getNumberedSeriesForFile(fileName = '', numberedMap = null) {
  if (!numberedMap || numberedMap.size === 0) return null;
  const cand = extractNumberedSeriesCandidate(fileName);
  if (!cand) return null;
  const norm = normalizeSeriesKey(cand.candidate);
  if (!norm) return null;
  const match = numberedMap.get(norm);
  if (!match) return null;
  return { candidate: match.candidate, season: 1, episode: cand.episode };
}
