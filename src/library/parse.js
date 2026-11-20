// Parseo de nombres de archivo y captions (sin TMDB todavía)
const VIDEO_EXT = /\.(mkv|mp4|avi|mov|m4v|webm|ts)$/i;

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

/** S01E02, 1x02, "Episodio 3", "Cap 3", o número suelto */
export function parseEpisode(name = '') {
  let m = name.match(/[ST](\d{1,2})[\s._-]*E(\d{1,3})/i);
  if (m) return { season: +m[1], episode: +m[2] };
  m = name.match(/(\d{1,2})\s*x\s*(\d{1,3})/i);
  if (m) return { season: +m[1], episode: +m[2] };
  m = name.match(/T(?:emp(?:orada)?)?[\s._-]*(\d{1,2})[\s._-]+(?:ep|cap(?:[ií]tulo)?)?[\s._-]*(\d{1,3})/i);
  if (m) return { season: +m[1], episode: +m[2] };
  m = name.match(/(?:ep(?:isodio)?|cap(?:[ií]tulo)?)[\s._-]*(\d{1,3})/i);
  if (m) return { season: 1, episode: +m[1] };
  return { season: 0, episode: 0 };
}

export function prettyName(fileName = '') {
  return fileName.replace(VIDEO_EXT, '').replace(/[._]+/g, ' ').trim();
}


/** Limpia la etiqueta técnica del nombre de un episodio y deja el título legible. */
export function prettyEpisodeName(fileName = '', showName = '') {
  let label = prettyName(fileName);
  const candidates = [showName].filter(Boolean);
  for (const candidate of candidates) {
    const escaped = String(candidate).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    label = label.replace(new RegExp(`^\\s*${escaped}\\s*[-–—:]*\\s*`, 'i'), '');
  }
  label = label
    .replace(/^\s*(?:S\s*\d{1,2}\s*E\s*\d{1,3}|\d{1,2}\s*x\s*\d{1,3}|T(?:emp(?:orada)?)?\s*\d{1,2}\s*(?:E|ep|cap(?:[ií]tulo)?)?\s*\d{1,3}|(?:ep(?:isodio)?|cap(?:[ií]tulo)?)\s*\d{1,3})\s*[-–—:]*\s*/i, '')
    .replace(/\[[^\]]*\]|\([^)]*\)/g, (part) => /(?:2160|1080|720|480|4k|uhd|bluray|blu\s*ray|hdtv|web[- ]?dl|webrip|brrip|dual|castellano|latino|dts|ac3|x26[45]|h26[45]|hevc)/i.test(part) ? '' : part)
    .replace(/\b(?:2160p|1080p|720p|480p|4k|uhd|bluray|blu\s*ray|hdtv|web[- ]?dl|webrip|brrip|dual|castellano|latino|dts|ac3|x26[45]|h26[45]|hevc)\b.*$/i, '')
    .replace(/[._]+/g, ' ')
    .replace(/\s*[-–—]\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return label || prettyName(fileName);
}
