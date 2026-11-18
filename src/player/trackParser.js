// src/player/trackParser.js
// Parsea cabeceras MP4 (moov/trak) y MKV (EBML/Tracks) para detectar
// pistas de audio y subtítulos embebidas. Chrome/Android TV no exponen
// video.audioTracks/textTracks para MP4/MKV multi-pista, así que leemos
// los primeros bytes del fichero vía Range y extraemos el listado.

const LANG_NAMES_ISO639_2 = {
  spa: 'Español', eng: 'Inglés', fre: 'Francés', fra: 'Francés', ger: 'Alemán',
  deu: 'Alemán', ita: 'Italiano', por: 'Portugués', jpn: 'Japonés', rus: 'Ruso',
  chi: 'Chino', zho: 'Chino', kor: 'Coreano', cat: 'Catalán', glg: 'Gallego',
  eus: 'Euskera', baq: 'Euskera', und: 'Indeterminado', mul: 'Múltiple',
  lat: 'Latino', ara: 'Árabe', hin: 'Hindi', tur: 'Turco', pol: 'Polaco',
  nld: 'Holandés', dut: 'Holandés', swe: 'Sueco', nor: 'Noruego', dan: 'Danés',
  fin: 'Finés', gre: 'Griego', ell: 'Griego', heb: 'Hebreo', tha: 'Tailandés',
  vie: 'Vietnamita', ukr: 'Ucraniano', ces: 'Checo', cze: 'Checo', hun: 'Húngaro',
  ron: 'Rumano', rum: 'Rumano',
};

export function langName(code) {
  if (!code) return '';
  const key = String(code).toLowerCase().trim();
  return LANG_NAMES_ISO639_2[key] || key.toUpperCase();
}

const TRACK_CACHE = new Map();

export async function detectTracksFromUrl(url) {
  if (!url) return { audio: [], text: [] };
  if (TRACK_CACHE.has(url)) return TRACK_CACHE.get(url);
  const promise = (async () => {
    try {
      // Leer solo la cabecera inicial (512 KiB = primera parte ya presente en caché)
      // para no saturar el canal de streaming ni causar congelamientos en la reproducción
      let head = await fetchRange(url, 0, 512 * 1024 - 1);
      if (!head || head.length < 16) return { audio: [], text: [] };
      if (isMp4Header(head)) {
        let r = parseMp4(head);
        if (r.audio.length || r.text.length) return r;
        // Si no se encuentra en 512 KiB, probar hasta 1 MiB como máximo
        const extended = await fetchRange(url, 0, 1024 * 1024 - 1);
        if (extended && extended.length > head.length) {
          return parseMp4(extended);
        }
        return r;
      }
      if (isMkvHeader(head)) {
        let r = parseMkv(head);
        if (r.audio.length || r.text.length) return r;
        let s = scanMkvTracks(head);
        if (s.audio.length || s.text.length) return s;

        // Probar hasta 1 MiB si no se encontró en la primera parte
        const extended = await fetchRange(url, 0, 1024 * 1024 - 1);
        if (extended && extended.length > head.length) {
          r = parseMkv(extended);
          if (r.audio.length || r.text.length) return r;
          return scanMkvTracks(extended);
        }
        return { audio: [], text: [] };
      }
      return { audio: [], text: [] };
    } catch (e) {
      console.warn('[trackParser] fallo', e);
      return { audio: [], text: [] };
    }
  })();
  TRACK_CACHE.set(url, promise);
  return promise;
}

export function clearTrackCache(url) {
  if (url) TRACK_CACHE.delete(url);
  else TRACK_CACHE.clear();
}

async function fetchRange(url, start, end) {
  try {
    const res = await fetch(url, { headers: { Range: `bytes=${start}-${end - 1}` } });
    if (!res.ok && res.status !== 206) return null;
    if (res.status !== 206) {
      // Servidor ignoró Range: leer solo el primer bloque por streaming.
      if (!res.body?.getReader) return null;
      const reader = res.body.getReader();
      const max = end - start;
      const chunks = [];
      let total = 0;
      while (total < max) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        total += value.length;
      }
      reader.cancel?.().catch(() => {});
      const out = new Uint8Array(Math.min(total, max));
      let p = 0;
      for (const c of chunks) {
        const take = Math.min(c.length, out.length - p);
        if (take <= 0) break;
        out.set(c.subarray(0, take), p);
        p += take;
      }
      return out;
    }
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    return null;
  }
}

async function fetchSize(url) {
  try {
    const res = await fetch(url, { headers: { Range: 'bytes=0-1' } });
    const cr = res.headers.get('Content-Range') || '';
    const m = /\/(\d+)$/.exec(cr);
    try { res.body?.cancel?.(); } catch (_) {}
    return m ? Number(m[1]) : 0;
  } catch { return 0; }
}

function findBox(buf, type) {
  const a = type.charCodeAt(0), b = type.charCodeAt(1), c = type.charCodeAt(2), d = type.charCodeAt(3);
  for (let i = 4; i + 4 <= buf.length; i++) {
    if (buf[i] === a && buf[i + 1] === b && buf[i + 2] === c && buf[i + 3] === d) return i - 4;
  }
  return -1;
}

// Busca directamente el elemento Tracks (1654AE6B) cuando el recorrido secuencial falla
function scanMkvTracks(buf) {
  for (let i = 0; i + 4 < buf.length; i++) {
    if (buf[i] === 0x16 && buf[i + 1] === 0x54 && buf[i + 2] === 0xAE && buf[i + 3] === 0x6B) {
      return parseMkvFromTracks(buf.subarray(i));
    }
  }
  return { audio: [], text: [] };
}

function parseMkvFromTracks(sub) {
  const head = new Uint8Array(5 + 12 + sub.length);
  head.set([0x1A, 0x45, 0xDF, 0xA3, 0x80], 0); // EBML vacío
  head.set([0x18, 0x53, 0x80, 0x67, 0x01, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF], 5); // Segment desconocido
  head.set(sub, 17);
  return parseMkv(head);
}

function isMp4Header(buf) {
  return String.fromCharCode(buf[4], buf[5], buf[6], buf[7]) === 'ftyp';
}

function isMkvHeader(buf) {
  return buf[0] === 0x1A && buf[1] === 0x45 && buf[2] === 0xDF && buf[3] === 0xA3;
}

// ---------- MP4 ----------
function parseMp4(buf) {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const audio = [];
  const text = [];

  const findBoxes = (start, end, target) => {
    const found = [];
    let pos = start;
    while (pos + 8 <= end) {
      let size = view.getUint32(pos);
      const type = String.fromCharCode(buf[pos + 4], buf[pos + 5], buf[pos + 6], buf[pos + 7]);
      let header = 8;
      if (size === 1) {
        size = Number(view.getBigUint64(pos + 8));
        header = 16;
      } else if (size === 0) {
        size = end - pos;
      }
      if (size < header || pos + size > end) break;
      if (type === target) found.push({ start: pos + header, end: pos + size });
      pos += size;
    }
    return found;
  };

  const moov = findBoxes(0, buf.length, 'moov');
  if (!moov.length) return { audio, text };
  const traks = findBoxes(moov[0].start, moov[0].end, 'trak');

  for (const trak of traks) {
    const mdias = findBoxes(trak.start, trak.end, 'mdia');
    if (!mdias.length) continue;
    const mdia = mdias[0];
    const hdlrs = findBoxes(mdia.start, mdia.end, 'hdlr');
    if (!hdlrs.length) continue;
    const hdlr = hdlrs[0];
    const handlerType = String.fromCharCode(
      buf[hdlr.start + 8], buf[hdlr.start + 9],
      buf[hdlr.start + 10], buf[hdlr.start + 11]
    );

    let language = '';
    const mdhds = findBoxes(mdia.start, mdia.end, 'mdhd');
    if (mdhds.length) {
      const mdhd = mdhds[0];
      const version = buf[mdhd.start];
      let langPos;
      if (version === 1) langPos = mdhd.start + 4 + 8 + 8 + 4 + 8;
      else langPos = mdhd.start + 4 + 4 + 4 + 4 + 4;
      if (langPos + 2 <= buf.length) {
        const packed = (buf[langPos] << 8) | buf[langPos + 1];
        language = unpackIso639(packed);
      }
    }

    const label = language ? langName(language) : '';
    if (handlerType === 'soun') {
      audio.push({ index: audio.length, language, label, native: false });
    } else if (handlerType === 'subt' || handlerType === 'sbtl' || handlerType === 'text') {
      text.push({ index: text.length, language, label, native: false });
    }
  }

  return { audio, text };
}

function unpackIso639(packed) {
  if (!packed) return '';
  const c1 = ((packed >> 10) & 0x1F) + 0x60;
  const c2 = ((packed >> 5) & 0x1F) + 0x60;
  const c3 = (packed & 0x1F) + 0x60;
  return String.fromCharCode(c1, c2, c3);
}

// ---------- MKV ----------
const EBML_SEGMENT = 0x18538067;
const EBML_TRACKS = 0x1654AE6B;
const EBML_TRACKENTRY = 0xAE;
const EBML_TRACKNUMBER = 0xD7;
const EBML_TRACKTYPE = 0x83;
const EBML_CODECID = 0x86;
const EBML_LANGUAGE = 0x22B59C;
const EBML_LANGUAGE_IETF = 0x22B59D;
const EBML_NAME = 0x536E;

function parseMkv(buf) {
  const audio = [];
  const text = [];

  const readVint = (pos, isId) => {
    if (pos >= buf.length) return null;
    const first = buf[pos];
    if (first === 0) return null;
    let length = 1;
    let mask = 0x80;
    while (length <= 8 && !(first & mask)) { mask >>= 1; length++; }
    if (length > 8 || pos + length > buf.length) return null;
    let value = isId ? first : (first & (mask - 1));
    let allOnes = !isId && (first & (mask - 1)) === (mask - 1);
    for (let i = 1; i < length; i++) { value = value * 256 + buf[pos + i]; if (buf[pos + i] !== 0xFF) allOnes = false; }
    if (allOnes) value = buf.length; // tamaño desconocido: hasta el final del búfer
    return { value, length };
  };

  const readElement = (pos) => {
    const id = readVint(pos, true);
    if (!id) return null;
    const size = readVint(pos + id.length, false);
    if (!size) return null;
    return {
      id: id.value,
      dataStart: pos + id.length + size.length,
      dataEnd: pos + id.length + size.length + size.value,
      totalLength: id.length + size.length + size.value,
    };
  };

  const readString = (start, end) => {
    if (start >= end || end > buf.length) return '';
    let s = '';
    for (let i = start; i < end; i++) {
      if (buf[i] === 0) break;
      s += String.fromCharCode(buf[i]);
    }
    return s;
  };

  const readUint = (start, end) => {
    let v = 0;
    for (let i = start; i < end && i < buf.length; i++) v = v * 256 + buf[i];
    return v;
  };

  let pos = 0;
  const first = readElement(0);
  if (!first) return { audio, text };
  pos = first.totalLength;

  while (pos < buf.length) {
    const el = readElement(pos);
    if (!el) break;
    if (el.id === EBML_SEGMENT) {
      let inner = el.dataStart;
      const innerEnd = Math.min(el.dataEnd, buf.length);
      while (inner < innerEnd) {
        const child = readElement(inner);
        if (!child) break;
        if (child.id === EBML_TRACKS) {
          let tp = child.dataStart;
          const tpEnd = Math.min(child.dataEnd, buf.length);
          while (tp < tpEnd) {
            const entry = readElement(tp);
            if (!entry) break;
            if (entry.id === EBML_TRACKENTRY) {
              const track = parseTrackEntry(entry, buf, readElement, readString, readUint);
              if (track) {
                if (track.type === 2) audio.push({ index: audio.length, ...track });
                else if (track.type === 17) text.push({ index: text.length, ...track });
              }
            }
            tp = entry.dataEnd;
          }
          break;
        }
        inner = child.dataEnd;
      }
      break;
    }
    pos = el.dataEnd;
  }

  return { audio, text };
}

function parseTrackEntry(entry, buf, readElement, readString, readUint) {
  let pos = entry.dataStart;
  const end = Math.min(entry.dataEnd, buf.length);
  let type = 0, language = '', languageIETF = '', name = '', codec = '';
  while (pos < end) {
    const el = readElement(pos);
    if (!el) break;
    switch (el.id) {
      case EBML_TRACKTYPE: type = readUint(el.dataStart, el.dataEnd); break;
      case EBML_CODECID: codec = readString(el.dataStart, el.dataEnd); break;
      case EBML_LANGUAGE: language = readString(el.dataStart, el.dataEnd); break;
      case EBML_LANGUAGE_IETF: languageIETF = readString(el.dataStart, el.dataEnd); break;
      case EBML_NAME: name = readString(el.dataStart, el.dataEnd); break;
    }
    pos = el.dataEnd;
  }
  const lang = languageIETF || language;
  const label = name || langName(lang) || '';
  return { type, language: lang, label, codec, native: false };
}
