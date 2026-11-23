// src/library/newsPrefs.js
// Orden y límites de las filas "Novedades · Películas" y "Novedades · Series".
//  - 'upload':  fecha de subida a Telegram (más recientes primero)
//  - 'release': estreno (películas) / emisión del último capítulo (series)
import { loadProgress } from '../player/progress.js';

export const NEWS_HOME_LIMIT = 20;
export const NEWS_GRID_LIMIT = 60;
export const NEWS_MODES = {
  upload: 'Fecha de subida a Telegram',
  release: 'Fecha de estreno / emisión',
};

const key = (profile) => `tgvideo_news_${profile?.id || 'default'}`;
const valid = (v) => (v === 'release' ? 'release' : 'upload');

export function getNewsPrefs(profile) {
  let local = {};
  try { local = JSON.parse(localStorage.getItem(key(profile)) || '{}') || {}; } catch (_) {}
  const p = profile?.news || {};
  return { movies: valid(local.movies || p.movies), series: valid(local.series || p.series) };
}

// kind: 'movies' | 'series'. Guarda en el perfil, en el dispositivo y sincroniza en segundo plano.
export function setNewsPref(profile, kind, mode, sync) {
  const next = { ...getNewsPrefs(profile), [kind]: valid(mode) };
  profile.news = next;
  try { localStorage.setItem(key(profile), JSON.stringify(next)); } catch (_) {}
  (async () => {
    try {
      const remote = await sync?.pullProfile?.(profile.id);
      if (!remote) return;
      await sync.pushProfile({
        ...remote,
        profile: { ...remote.profile, news: next },
        progress: sync.mergeProgress(loadProgress(profile.id), remote.progress || {}),
      });
    } catch (err) { console.warn('[news] No se pudo sincronizar', err); }
  })();
  return next;
}

const toMs = (d) => {
  if (!d) return 0;
  const ms = Date.parse(String(d).length === 4 ? `${d}-01-01` : d);
  return Number.isFinite(ms) ? ms : 0;
};

// Fecha de estreno (película) o de emisión del último capítulo (serie), en ms.
export function releaseTime(t) {
  if (t.tipo === 'serie') {
    let best = toMs(t.metadata?.last_air_date);
    for (const f of t.archivos || []) best = Math.max(best, toMs(f.metadata?.air_date));
    return best || toMs(t.metadata?.date) || toMs(t.yearHint);
  }
  const f = t.archivos?.[0];
  return toMs(t.metadata?.date) || toMs(f?.metadata?.date) || toMs(t.yearHint);
}

// Ordena (sin mutar) según el modo; en empate o sin fecha, desempata por subida.
export function sortNews(items, mode) {
  const up = (t) => t.ultimoMensajeFecha || 0;
  const list = [...items];
  if (mode === 'release') list.sort((a, b) => (releaseTime(b) - releaseTime(a)) || (up(b) - up(a)));
  else list.sort((a, b) => up(b) - up(a));
  return list;
}
