import { createKV } from "../core/kv.js";
import { getTmdbKey } from "../settings/global.js";
import { getOverride, getOverrideByTmdbId, setOverride, removeOverride } from "./overrides.js";
const kv = createKV();
const API = "https://api.themoviedb.org/3";
const IMAGE = "https://image.tmdb.org/t/p/";

const VALID_YEAR_RE = /(?:19\d{2}|20[0-2]\d|2030)/;

export function extractTitleAndYear(name = "") {
  let str = String(name || "").trim();
  try { str = decodeURIComponent(str); } catch (_) {}

  // 1. Quitar extensiones de vídeo
  str = str.replace(/\.(mkv|mp4|avi|mov|m4v|webm|ts|m2ts)$/i, "").trim();

  // 2. Extraer año explícito entre paréntesis o corchetes: (1996), [2026], etc.
  // Es la convención principal: las fechas van entre paréntesis habitualmente tras el título.
  let year = null;
  const parenMatches = [...str.matchAll(/[\(\[]\s*((?:19\d{2}|20[0-3]\d))\s*[\)\]]/g)];
  if (parenMatches.length > 0) {
    const lastMatch = parenMatches[parenMatches.length - 1];
    year = lastMatch[1];
    str = str.slice(0, lastMatch.index) + " " + str.slice(lastMatch.index + lastMatch[0].length);
  }

  // Eliminar carácter "ª" si está pegado a "[" o tras fecha/corchetes/paréntesis
  str = str.replace(/([\)\]])\s*ª/g, "$1");
  str = str.replace(/\s*ª\s*(?=\[|$)/g, " ");

  // 3. Eliminar etiquetas de calidad y códec entre corchetes o paréntesis: [BlurayRip], [480p], [Dual], etc.
  const qualityKw = "(?:bluray|brrip|bdrip|dvdrip|dvd|webrip|web[- ]?dl|hdtv|hdrip|microhd|remux|rip|\\d{3,4}p|[248]k|uhd|x26[45]|h26[45]|hevc|aac|ac3|eac3|dts|dts-hd|truehd|mp3|flac|dual|multi|castellano|latino|spanish|sub|subs|vose|ita|eng|french|proper|repack|yts|yify|rarbg)";
  const bracketQualityRe = new RegExp("\\[[^\\]]*" + qualityKw + "[^\\]]*\\]", "gi");
  const parenQualityRe = new RegExp("\\([^\\)]*" + qualityKw + "[^\\)]*\\)", "gi");
  str = str.replace(bracketQualityRe, " ").replace(parenQualityRe, " ");

  // 4. Eliminar códigos de episodios: S01E02, 1x02
  str = str.replace(/[ST]\d{1,2}[\s._-]*E\d{1,3}.*/i, " ");
  str = str.replace(/\d{1,2}x\d{1,3}.*/i, " ");

  // 5. Eliminar desde la primera palabra clave suelta de calidad hasta el final
  const bareQualityRe = new RegExp(`\\b${qualityKw}\\b.*`, "i");
  str = str.replace(bareQualityRe, " ");

  // 6. Si aún no hay año entre paréntesis, buscar año suelto estrictamente al FINAL del texto
  // (nunca al inicio ni en medio, para no romper títulos como "2013 - Rescate en L.A.", "Blade Runner 2049" o "1984")
  if (!year) {
    const trailingYearMatch = str.match(/\s+((?:19\d{2}|20[0-3]\d))\s*$/);
    if (trailingYearMatch) {
      const candidateTitle = str.slice(0, trailingYearMatch.index).trim();
      if (candidateTitle.length > 1) {
        year = trailingYearMatch[1];
        str = candidateTitle;
      }
    }
  }

  // 7. Limpiar corchetes o paréntesis residuales y espacios
  str = str.replace(/\[[^\]]*\]/g, " ").replace(/\([^)]*\)/g, " ").replace(/[\[\]\(\)]/g, " ");

  // 8. Normalizar separadores sin destruir puntos en siglas/abreviaturas como "L.A."
  str = str.replace(/([a-zA-Z0-9]{2,})\.([a-zA-Z0-9]{2,})/g, "$1 $2");
  str = str.replace(/_/g, " ");
  str = str.replace(/[\s\-_–—]+ª\s*$/g, "");
  str = str.replace(/\s+ª\s+/g, " ");
  str = str.replace(/[-–—\s]+$/, "").replace(/^\s*[-–—]+/, "").replace(/\s+/g, " ").trim();

  return { title: str || name, year };
}

export function cleanSearchName(name = "") {
  return extractTitleAndYear(name).title;
}

export function parseTmdbId(value) {
  const m = String(value || "").match(/(?:themoviedb\.org\/(?:tv|movie|collection)\/|^(?:(?:tv|movie|collection)[:/])?)(\d+)/i);
  return m ? Number(m[1]) : null;
}
export function imageUrl(path, size = "w342") { return path?.startsWith("/") ? IMAGE + size + path : ""; }
async function request(path, params = {}, signal) {
  const key = getTmdbKey();
  if (!key) throw new Error("Introduce tu clave de TMDB en Ajustes globales.");
  const url = new URL(API + path);
  if (!("language" in params)) {
    url.searchParams.set("language", "es-ES");
  }
  for (const [name, value] of Object.entries(params)) {
    if (value === null || value === undefined) {
      url.searchParams.delete(name);
    } else {
      url.searchParams.set(name, value);
    }
  }
  const headers = {};
  if (key.includes(".")) headers.Authorization = `Bearer ${key}`;
  else url.searchParams.set("api_key", key);
  const response = await fetch(url, { headers, signal });
  if (!response.ok) throw new Error(response.status === 401 ? "La clave de TMDB no es válida." : `TMDB no disponible (${response.status}).`);
  return response.json();
}
// Imágenes disponibles en TMDB para un título: { poster: [...], backdrop: [...], logo: [...] }
export async function fetchTmdbImages(type, id, signal) {
  const endpoint = type === "collection" ? "collection" : (type === "serie" || type === "tv" ? "tv" : "movie");
  const data = await request(`/${endpoint}/${id}/images`, { language: null }, signal);
  const rank = (x) => (x.iso_639_1 === "es" ? 0 : x.iso_639_1 === "en" ? 1 : !x.iso_639_1 ? 2 : 3);
  const build = (list = [], thumb, full) => [...list]
    .sort((a, b) => rank(a) - rank(b) || (b.vote_average || 0) - (a.vote_average || 0) || (b.vote_count || 0) - (a.vote_count || 0))
    .slice(0, 500)
    .map((x) => ({
      thumb: imageUrl(x.file_path, thumb),
      url: imageUrl(x.file_path, full),
      lang: x.iso_639_1 || "",
      vote: x.vote_average || 0,
      likes: x.vote_count || 0,
    }));
  return {
    poster: build(data?.posters, "w185", "w500"),
    backdrop: build(data?.backdrops, "w300", "w1280"),
    logo: build(data?.logos, "w300", "w500"),
  };
}

// Películas de una colección de TMDB (ordenadas por fecha de estreno)
export async function fetchTmdbCollectionParts(collectionId, signal) {
  if (!collectionId) return [];
  try {
    const data = await request(`/collection/${collectionId}`, {}, signal);
    return (data.parts || [])
      .map((p) => ({ id: p.id, name: p.title || p.name || "", date: p.release_date || "", poster: imageUrl(p.poster_path) }))
      .sort((a, b) => String(a.date || "9999").localeCompare(String(b.date || "9999")));
  } catch (_) {
    return [];
  }
}

/**
 * Obtiene en orden cronológico los tráilers de las películas que componen una colección de TMDB.
 * @param {string|number} collectionId ID de la colección en TMDB.
 * @param {AbortSignal} [signal]
 * @returns {Promise<Array<{ key: string, id: number, name: string, date: string }>>}
 */
export async function fetchCollectionMovieTrailers(collectionId, signal) {
  if (!collectionId) return [];
  const parts = await fetchTmdbCollectionParts(collectionId, signal);
  if (!parts || !parts.length) return [];

  const list = await Promise.all(
    parts.map(async (part) => {
      try {
        const key = await fetchTmdbTrailer("movie", part.id, signal);
        if (!key) return null;
        const year = part.date ? String(part.date).slice(0, 4) : "";
        const titleWithYear = year && !part.name.includes(year) ? `${part.name} (${year})` : part.name;
        return {
          key,
          id: part.id,
          name: titleWithYear,
          date: part.date || "",
        };
      } catch (_) {
        return null;
      }
    })
  );

  return list.filter(Boolean);
}

export async function validateTmdbKey() { return request("/configuration"); }

export async function fetchExternalIds(type, id, signal) {
  if (!id) return null;
  const endpoint = (type === "serie" || type === "tv") ? "tv" : "movie";
  try {
    return await request(`/${endpoint}/${id}/external_ids`, {}, signal);
  } catch (_) {
    return null;
  }
}

export async function fetchTvExternalIds(tvId, signal) {
  return fetchExternalIds("tv", tvId, signal);
}

const imdbMemoryCache = new Map();

function withTimeoutSignal(parentSignal, ms = 3500) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  if (parentSignal) {
    if (parentSignal.aborted) {
      clearTimeout(timer);
      ctrl.abort();
    } else {
      parentSignal.addEventListener("abort", () => {
        clearTimeout(timer);
        ctrl.abort();
      }, { once: true });
    }
  }
  return ctrl.signal;
}

/**
 * Obtiene la puntuación pública oficial de IMDb por su ID (ej: "tt0111161").
 * Utiliza caché en memoria y KV, proxy público de Agregarr y fallback a Cinemeta.
 * @param {string} imdbId
 * @param {string} [type="movie"]
 * @param {AbortSignal} [signal]
 * @returns {Promise<number|null>}
 */
export async function fetchImdbRating(imdbId, type = "movie", signal) {
  if (!imdbId) return null;
  const rawId = String(imdbId).trim();
  const id = rawId.startsWith("tt") ? rawId : `tt${rawId}`;
  if (imdbMemoryCache.has(id)) {
    return imdbMemoryCache.get(id);
  }
  const cacheKey = `imdb_rating:${id}`;
  try {
    const cached = await kv.get(cacheKey).catch(() => null);
    if (cached != null && Number.isFinite(Number(cached)) && Number(cached) > 0) {
      const val = Number(cached);
      imdbMemoryCache.set(id, val);
      return val;
    }
  } catch (_) {}

  const reqSignal = withTimeoutSignal(signal, 3500);

  // 1. Agregarr (proxy de ratings públicos oficiales de IMDb actualizados a diario)
  try {
    const res = await fetch(`https://api.agregarr.org/api/ratings?id=${encodeURIComponent(id)}`, {
      signal: reqSignal,
    });
    if (res.ok) {
      const data = await res.json();
      const item = Array.isArray(data) ? data[0] : data;
      const score = item?.rating != null ? Number(item.rating) : null;
      if (score != null && Number.isFinite(score) && score > 0) {
        imdbMemoryCache.set(id, score);
        await kv.set(cacheKey, score).catch(() => {});
        return score;
      }
    }
  } catch (_) {}

  // 2. Cinemeta (catálogo público de metadatos de Stremio indexado por IMDb ID)
  try {
    const stremType = (type === "serie" || type === "tv" || type === "series") ? "series" : "movie";
    const res = await fetch(`https://v3-cinemeta.strem.io/meta/${stremType}/${encodeURIComponent(id)}.json`, {
      signal: reqSignal,
    });
    if (res.ok) {
      const data = await res.json();
      const score = data?.meta?.imdbRating != null ? Number(data.meta.imdbRating) : null;
      if (score != null && Number.isFinite(score) && score > 0) {
        imdbMemoryCache.set(id, score);
        await kv.set(cacheKey, score).catch(() => {});
        return score;
      }
    }
  } catch (_) {}

  return null;
}

export async function fetchTmdbTrailer(type, id, signal) {
  if (!id) return null;
  if (type === "collection") {
    const trailers = await fetchCollectionMovieTrailers(id, signal);
    return trailers[0]?.key || null;
  }
  const endpoint = type === "serie" || type === "tv" ? "tv" : "movie";
  try {
    const dataEs = await request(`/${endpoint}/${id}/videos`, {}, signal);
    const results = dataEs.results || [];
    let vid = results.find(v => v.site === "YouTube" && v.type === "Trailer")
      || results.find(v => v.site === "YouTube" && (v.type === "Teaser" || v.type === "Clip"));
    if (vid?.key) return vid.key;

    const dataEn = await request(`/${endpoint}/${id}/videos`, { language: "en-US" }, signal);
    const resultsEn = dataEn.results || [];
    vid = resultsEn.find(v => v.site === "YouTube" && v.type === "Trailer")
      || resultsEn.find(v => v.site === "YouTube" && (v.type === "Teaser" || v.type === "Clip"));
    return vid?.key || null;
  } catch (_) {
    return null;
  }
}

const normalize = s => String(s || "")
  .replace(/ñ/g, "n").replace(/Ñ/g, "N")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]/g, "");

export async function setManualMetadata(title, metadata) {
  if (!title || !metadata) return null;
  const key = `manual_tmdb:${title.id}`;
  await kv.set(key, metadata).catch(e => console.warn("[tmdb] Error guardando identificación manual", e));
  // Sincronizar con otros dispositivos (sirve también para mensajes reenviados)
  await setOverride(title.id, metadata).catch(e => console.warn("[tmdb] Error guardando override", e));
  title.metadata = metadata;
  title.tmdbId = metadata.id;
  return metadata;
}

export async function clearManualMetadata(title) {
  if (!title) return;
  const key = `manual_tmdb:${title.id}`;
  await kv.del(key).catch(() => {});
  await removeOverride(title.id).catch(() => {});
  title.metadata = null;
  title.tmdbId = null;
}

export function parseAgeRatingFromTmdb(data, type) {
  if (!data) return "";
  const isTv = type === "tv" || type === "serie";
  if (!isTv && data.release_dates) {
    const results = data.release_dates?.results || [];
    const es = results.find(r => String(r.iso_3166_1 || '').toUpperCase() === "ES");
    const esCert = es?.release_dates?.find(d => d.certification && String(d.certification).trim())?.certification;
    if (esCert) return String(esCert).trim();

    const latam = results.find(r => ["MX", "AR", "CO", "CL"].includes(String(r.iso_3166_1 || '').toUpperCase()));
    const latamCert = latam?.release_dates?.find(d => d.certification && String(d.certification).trim())?.certification;
    if (latamCert) return String(latamCert).trim();

    const usOrGb = results.find(r => ["US", "GB"].includes(String(r.iso_3166_1 || '').toUpperCase()));
    const usCert = usOrGb?.release_dates?.find(d => d.certification && String(d.certification).trim())?.certification;
    if (usCert) return String(usCert).trim();

    for (const r of results) {
      const anyCert = r.release_dates?.find(d => d.certification && String(d.certification).trim())?.certification;
      if (anyCert) return String(anyCert).trim();
    }

    // Si existen estrenos o fecha pero ninguna entidad asignó certificado, en TMDB se muestra "NR"
    if (results.length > 0 || data.release_date) {
      return "NR";
    }
  } else if (data.content_ratings) {
    const results = data.content_ratings?.results || [];
    const es = results.find(r => String(r.iso_3166_1 || '').toUpperCase() === "ES");
    if (es?.rating && String(es.rating).trim()) return String(es.rating).trim();

    const latam = results.find(r => ["MX", "AR", "CO", "CL"].includes(String(r.iso_3166_1 || '').toUpperCase()));
    if (latam?.rating && String(latam.rating).trim()) return String(latam.rating).trim();

    const usOrGb = results.find(r => ["US", "GB"].includes(String(r.iso_3166_1 || '').toUpperCase()));
    if (usOrGb?.rating && String(usOrGb.rating).trim()) return String(usOrGb.rating).trim();

    for (const r of results) {
      if (r.rating && String(r.rating).trim()) return String(r.rating).trim();
    }

    if (results.length > 0 || data.first_air_date) {
      return "NR";
    }
  }
  return "";
}

export async function fetchTmdbAgeRating(type, id, signal) {
  if (!id || !getTmdbKey()) return "";
  const endpoint = type === "serie" || type === "tv" ? "tv" : "movie";
  const append = endpoint === "tv" ? "content_ratings" : "release_dates";
  try {
    const data = await request(`/${endpoint}/${id}`, { append_to_response: append }, signal);
    return parseAgeRatingFromTmdb(data, endpoint);
  } catch (_) {
    return "";
  }
}

export async function fetchTmdbFullDetails(type, id, signal) {
  const endpoint = type === "collection" ? "collection" : (type === "serie" || type === "tv" ? "tv" : "movie");
  if (endpoint === "collection") return {};
  const append = endpoint === "tv" ? "credits,external_ids,content_ratings" : "credits,external_ids,release_dates";
  try {
    const data = await request(`/${endpoint}/${id}`, { append_to_response: append }, signal);
    const crew = data.credits?.crew || [];
    const director = crew.find(c => c.job === "Director")?.name || "";
    const writer = crew.find(c => c.job === "Screenplay" || c.job === "Writer" || c.job === "Story")?.name || "";
    const cast = (data.credits?.cast || []).slice(0, 5).map(c => c.name).join(", ");
    const imdbId = data.external_ids?.imdb_id || data.imdb_id || "";
    const ageRating = parseAgeRatingFromTmdb(data, endpoint);
    const col = data.belongs_to_collection;
    const collection = col ? {
      id: col.id,
      name: col.name,
      poster: imageUrl(col.poster_path),
      backdrop: imageUrl(col.backdrop_path, "w1280"),
    } : null;
    let rating = data.vote_average != null ? Number(data.vote_average) : 0;
    let imdbRating = null;
    let tmdbRating = rating;
    let hasImdbRating = false;
    if (imdbId) {
      const imdbR = await fetchImdbRating(imdbId, endpoint, signal).catch(() => null);
      if (imdbR && Number.isFinite(imdbR) && imdbR > 0) {
        rating = imdbR;
        imdbRating = imdbR;
        hasImdbRating = true;
      }
    }
    return {
      director,
      writer,
      cast,
      imdbId,
      ageRating,
      rating,
      imdbRating,
      tmdbRating,
      hasImdbRating,
      overview: data.overview || "",
      runtime: data.runtime || 0,
      collection,
    };

  } catch (e) {
    console.warn("[tmdb] Error fetching full details:", e);
    return {};
  }
}

export async function searchTmdbManual({ query, type = "movie", year = "", directId = null }, signal) {
  const endpoint = type === "collection" ? "collection" : type === "serie" || type === "tv" ? "tv" : "movie";
  const id = parseTmdbId(directId);
  if (id) {
    const data = await request(`/${endpoint}/${id}`, {}, signal);
    const col = data.belongs_to_collection;
    const collection = col ? {
      id: col.id,
      name: col.name,
      poster: imageUrl(col.poster_path),
      backdrop: imageUrl(col.backdrop_path, "w1280"),
    } : null;
    return [{
      id: data.id,
      type: endpoint,
      name: data.name || data.title,
      overview: data.overview || "",
      date: data.first_air_date || data.release_date || "",
      poster: imageUrl(data.poster_path),
      backdrop: imageUrl(data.backdrop_path, "w1280"),
      rating: data.vote_average || 0,
      collection,
    }];
  }

  const parsed = extractTitleAndYear(query);
  const q = String(parsed.title || query || "").trim();
  const searchYear = String(year || parsed.year || "").trim();

  if (!q) return [];
  const params = { query: q };
  if (searchYear && endpoint !== "collection") {
    params[endpoint === "tv" ? "first_air_date_year" : "year"] = searchYear;
  }
  let search = await request(`/search/${endpoint}`, params, signal);
  if ((!search.results || search.results.length === 0) && searchYear && endpoint !== "collection") {
    search = await request(`/search/${endpoint}`, { query: q }, signal).catch(() => search);
  }

  // Fallback si contiene caracteres especiales o "ñ": probar búsqueda transliterada
  if (!search.results || search.results.length === 0) {
    const unaccented = q
      .replace(/ñ/g, "n").replace(/Ñ/g, "N")
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
    if (unaccented && unaccented.toLowerCase() !== q.toLowerCase()) {
      search = await request(`/search/${endpoint}`, { query: unaccented }, signal).catch(() => search);
    }
  }

  return (search.results || []).slice(0, 10).map(r => ({
    id: r.id,
    type: endpoint,
    name: r.name || r.title,
    overview: r.overview || "",
    date: r.first_air_date || r.release_date || "",
    poster: imageUrl(r.poster_path),
    backdrop: imageUrl(r.backdrop_path, "w1280"),
    rating: r.vote_average || 0,
  }));
}

async function enrichSaga(title, { signal } = {}) {
  const ov = getOverride(title.id);
  if (ov) { title.metadata = ov; title.tmdbId = ov.id; return ov; }
  const byTmdb = title.tmdbId ? getOverrideByTmdbId(title.tmdbId) : null;
  if (byTmdb) { title.metadata = byTmdb; title.tmdbId = byTmdb.id; return byTmdb; }
  const manual = await kv.get(`manual_tmdb:${title.id}`).catch(() => null);
  if (manual) { title.metadata = manual; title.tmdbId = manual.id; return manual; }

  const directId = parseTmdbId(title.tmdbId || title.archivos.find(f => f.tmdbId)?.tmdbId);
  const query = cleanSearchName(title.nombre);
  const cacheKey = `tmdb_v2:collection:${directId || query.toLowerCase()}`;
  const cached = await kv.get(cacheKey).catch(() => null);
  if (cached) { title.metadata = cached; return cached; }
  if (!getTmdbKey()) return null;
  let data;
  if (directId) data = await request(`/collection/${directId}`, {}, signal);
  else {
    let search = await request("/search/collection", { query }, signal);
    if (!search.results || search.results.length === 0) {
      const unaccented = query.replace(/ñ/g, "n").replace(/Ñ/g, "N").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
      if (unaccented && unaccented.toLowerCase() !== query.toLowerCase()) {
        search = await request("/search/collection", { query: unaccented }, signal).catch(() => search);
      }
    }
    const match = search.results?.find(r => normalize(r.name) === normalize(query)) || search.results?.[0];
    if (!match?.id) return null;
    data = await request(`/collection/${match.id}`, {}, signal);
  }
  const metadata = {
    id: data.id, type: "collection", name: data.name || title.nombre,
    overview: data.overview || "", poster: imageUrl(data.poster_path),
    backdrop: imageUrl(data.backdrop_path, "w1280"),
  };
  await kv.set(cacheKey, metadata).catch(error => console.warn("[tmdb] Caché no disponible", error));
  title.metadata = metadata;
  return metadata;
}

export async function enrichTitle(title, { signal } = {}) {
  if (!["pelicula", "serie"].includes(title?.tipo)) return null;
  const ov = getOverride(title.id);
  if (ov) {
    if (ov.id && !ov.ageRating && getTmdbKey()) {
      fetchTmdbAgeRating(title.tipo === "serie" ? "tv" : "movie", ov.id, signal).then(rating => {
        if (rating) {
          ov.ageRating = rating;
          setOverride(title.id, ov).catch(() => {});
        }
      }).catch(() => {});
    }
    if (title.tipo === "pelicula" && ov.id && ov.collection === undefined && getTmdbKey()) {
      fetchTmdbFullDetails("movie", ov.id, signal).then(full => {
        if (full?.collection !== undefined) {
          ov.collection = full.collection;
          if (full?.ageRating && !ov.ageRating) ov.ageRating = full.ageRating;
          setOverride(title.id, ov).catch(() => {});
        }
      }).catch(() => {});
    }
    const ovImdbId = ov.imdbId || title.imdbId;
    if (ovImdbId && !ov.hasImdbRating) {
      fetchImdbRating(ovImdbId, title.tipo === "serie" ? "tv" : "movie", signal).then(r => {
        if (r && Number.isFinite(r) && r > 0) {
          if (!ov.tmdbRating && ov.rating && ov.rating !== r) ov.tmdbRating = ov.rating;
          ov.imdbId = ovImdbId;
          ov.rating = r;
          ov.imdbRating = r;
          ov.hasImdbRating = true;
          setOverride(title.id, ov).catch(() => {});
        }
      }).catch(() => {});
    }
    title.metadata = ov; title.tmdbId = ov.id; return ov;
  }
  // Reenvío u otro mensaje: mismo TMDB en caption o ya conocido
  const byTmdb = title.tmdbId ? getOverrideByTmdbId(title.tmdbId) : null;
  if (byTmdb) {
    if (byTmdb.id && !byTmdb.ageRating && getTmdbKey()) {
      fetchTmdbAgeRating(title.tipo === "serie" ? "tv" : "movie", byTmdb.id, signal).then(rating => {
        if (rating) {
          byTmdb.ageRating = rating;
          setOverride(title.id, byTmdb).catch(() => {});
        }
      }).catch(() => {});
    }
    if (title.tipo === "pelicula" && byTmdb.id && byTmdb.collection === undefined && getTmdbKey()) {
      fetchTmdbFullDetails("movie", byTmdb.id, signal).then(full => {
        if (full?.collection !== undefined) {
          byTmdb.collection = full.collection;
          if (full?.ageRating && !byTmdb.ageRating) byTmdb.ageRating = full.ageRating;
          setOverride(title.id, byTmdb).catch(() => {});
        }
      }).catch(() => {});
    }
    title.metadata = byTmdb; title.tmdbId = byTmdb.id; return byTmdb;
  }
  const manual = await kv.get(`manual_tmdb:${title.id}`).catch(() => null);
  if (manual) {
    if (manual.id && !manual.ageRating && getTmdbKey()) {
      fetchTmdbAgeRating(title.tipo === "serie" ? "tv" : "movie", manual.id, signal).then(rating => {
        if (rating) {
          manual.ageRating = rating;
          setManualMetadata(title, manual).catch(() => {});
        }
      }).catch(() => {});
    }
    if (title.tipo === "pelicula" && manual.id && manual.collection === undefined && getTmdbKey()) {
      fetchTmdbFullDetails("movie", manual.id, signal).then(full => {
        if (full?.collection !== undefined) {
          manual.collection = full.collection;
          if (full?.ageRating && !manual.ageRating) manual.ageRating = full.ageRating;
          setManualMetadata(title, manual).catch(() => {});
        }
      }).catch(() => {});
    }
    title.metadata = manual; title.tmdbId = manual.id; return manual;
  }

  if (title.isSaga) return enrichSaga(title, { signal });
  const type = title.tipo === "serie" ? "tv" : "movie";
  const directId = parseTmdbId(title.tmdbId || title.archivos.find(f => f.tmdbId)?.tmdbId);
  const parsed = extractTitleAndYear(title.nombre);
  const query = parsed.title;
  // Priorizar siempre el año explícito entre paréntesis extraído inicialmente en yearHint
  const year = title.yearHint || parsed.year;
  const cacheKey = `tmdb_v2:${type}:${directId || `${query.toLowerCase()}:${year || ""}`}`;
  const cached = await kv.get(cacheKey).catch(() => null);
  if (cached) {
    if (type === "movie" && cached.id && cached.collection === undefined && getTmdbKey()) {
      try {
        const full = await fetchTmdbFullDetails("movie", cached.id, signal);
        cached.collection = full?.collection || null;
        if (full?.ageRating && !cached.ageRating) {
          cached.ageRating = full.ageRating;
        }
        await kv.set(cacheKey, cached).catch(() => {});
      } catch (_) {}
    } else if (cached.id && !cached.ageRating && getTmdbKey()) {
      fetchTmdbAgeRating(type, cached.id, signal).then(rating => {
        if (rating) {
          cached.ageRating = rating;
          title.metadata = cached;
          kv.set(cacheKey, cached).catch(() => {});
        }
      }).catch(() => {});
    }

    // Asegurar puntuación de IMDb si aún no se tiene
    const effectiveImdbId = cached.imdbId || title.imdbId;
    if (effectiveImdbId && !cached.hasImdbRating) {
      try {
        const r = await fetchImdbRating(effectiveImdbId, type, signal);
        if (r && Number.isFinite(r) && r > 0) {
          if (!cached.tmdbRating && cached.rating && cached.rating !== r) cached.tmdbRating = cached.rating;
          cached.imdbId = effectiveImdbId;
          cached.rating = r;
          cached.imdbRating = r;
          cached.hasImdbRating = true;
          await kv.set(cacheKey, cached).catch(() => {});
        }
      } catch (_) {}
    } else if (!cached.hasImdbRating && cached.id && getTmdbKey()) {
      try {
        const ext = await fetchExternalIds(type, cached.id, signal);
        const iId = ext?.imdb_id;
        if (iId) {
          cached.imdbId = iId;
          const r = await fetchImdbRating(iId, type, signal);
          if (r && Number.isFinite(r) && r > 0) {
            if (!cached.tmdbRating && cached.rating && cached.rating !== r) cached.tmdbRating = cached.rating;
            cached.rating = r;
            cached.imdbRating = r;
            cached.hasImdbRating = true;
          }
          await kv.set(cacheKey, cached).catch(() => {});
        }
      } catch (_) {}
    }

    title.metadata = cached;
    return cached;
  }
  if (!getTmdbKey()) return null;
  let id = directId;
  if (!id) {
    const params = { query };
    if (year) {
      params[type === "tv" ? "first_air_date_year" : "year"] = year;
    }
    let search = await request(`/search/${type}`, params, signal);
    if ((!search.results || search.results.length === 0) && year) {
      search = await request(`/search/${type}`, { query }, signal).catch(() => search);
    }
    // Fallback para caracteres con "ñ" o tildes que puedan no coincidir exactamente en TMDB
    if (!search.results || search.results.length === 0) {
      const unaccented = query.replace(/ñ/g, "n").replace(/Ñ/g, "N").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
      if (unaccented && unaccented.toLowerCase() !== query.toLowerCase()) {
        search = await request(`/search/${type}`, { query: unaccented }, signal).catch(() => search);
      }
    }
    const match = search.results?.find(r => [r.name, r.title, r.original_name, r.original_title].some(n => n && normalize(n) === normalize(query)))
      || search.results?.find(r => [r.name, r.title, r.original_name, r.original_title].some(n => n && (normalize(n).includes(normalize(query)) || normalize(query).includes(normalize(n)))))
      || search.results?.[0];
    id = match?.id;
  }
  if (!id) return null;
  const append = type === "tv" ? "content_ratings,external_ids" : "release_dates,external_ids";
  const data = await request(`/${type}/${id}`, { append_to_response: append }, signal);
  const ageRating = parseAgeRatingFromTmdb(data, type);
  const imdbId = data.external_ids?.imdb_id || data.imdb_id || "";
  const col = data.belongs_to_collection;
  const collection = col ? {
    id: col.id,
    name: col.name,
    poster: imageUrl(col.poster_path),
    backdrop: imageUrl(col.backdrop_path, "w1280"),
  } : null;

  let rating = data.vote_average != null ? Number(data.vote_average) : 0;
  let imdbRating = null;
  let tmdbRating = rating;
  let hasImdbRating = false;
  if (imdbId) {
    try {
      const imdbR = await fetchImdbRating(imdbId, type, signal);
      if (imdbR && Number.isFinite(imdbR) && imdbR > 0) {
        rating = imdbR;
        imdbRating = imdbR;
        hasImdbRating = true;
      }
    } catch (_) {}
  }

  const metadata = { id: data.id, type, name: data.name || data.title, overview: data.overview, rating,
    imdbRating, tmdbRating,
    imdbId, hasImdbRating,
    date: data.first_air_date || data.release_date, last_air_date: data.last_air_date || "", poster: imageUrl(data.poster_path), backdrop: imageUrl(data.backdrop_path, "w1280"),
    collection, ageRating };
  await kv.set(cacheKey, metadata).catch(error => console.warn("[tmdb] Caché no disponible", error));
  title.metadata = metadata;
  return metadata;
}

export async function enrichTitles(titles, { signal, onUpdate } = {}) {
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(3, titles.length) }, async () => {
    while (index < titles.length && !signal?.aborted) {
      const title = titles[index++];
      try {
        if (await enrichTitle(title, { signal })) onUpdate?.(title);
        // Cada película dentro de una saga obtiene metadatos propios con clave individual para respetar overrides
        if (title.isSaga && Array.isArray(title.archivos)) {
          for (const file of title.archivos) {
            if (signal?.aborted) break;
            const parsedFilm = extractTitleAndYear(file.captionFileName || file.fileName || file.label);
            const fileKey = file.key || `${title.channel?.id || title.id}:${file.messageId}`;
            const film = {
              id: fileKey,
              tipo: "pelicula",
              nombre: parsedFilm.title || file.label,
              tmdbId: file.tmdbId,
              yearHint: parsedFilm.year || file.yearHint,
              archivos: [file],
            };
            try {
              const metadata = await enrichTitle(film, { signal });
              if (metadata) {
                file.metadata = metadata;
                file.tmdbId = metadata.id;
                if (metadata.name) file.sagaName = metadata.name;
                onUpdate?.(title);
              }
            } catch (error) {
              if (error.name !== "AbortError") console.warn("[tmdb saga film]", error.message);
            }
          }
        }
      } catch (error) { if (error.name !== "AbortError") console.warn("[tmdb]", error.message); }
    }
  }));
}

const seasonCache = new Map();

export async function fetchSeasonEpisodes(tvId, seasonNumber = 1, signal) {
  if (!tvId) return [];
  const key = `${tvId}_s${seasonNumber}`;
  if (seasonCache.has(key)) return seasonCache.get(key);
  try {
    const data = await request(`/tv/${tvId}/season/${seasonNumber}`, {}, signal);
    const list = data.episodes || [];
    seasonCache.set(key, list);
    return list;
  } catch (e) {
    return [];
  }
}