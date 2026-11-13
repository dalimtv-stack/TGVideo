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
    else if (k === 'nombre de archivo') out.fileName = v;
    else if (k === 'id tmdb') out.tmdbId = v;
    else if (k === 'sinopsis') out.synopsis = v;
  }
  return out;
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
