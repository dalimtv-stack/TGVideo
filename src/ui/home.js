// Proveedor de filas de la Home (independiente del HTML / skin)
import { titleState } from '../player/progress.js';

export function buildHomeRows(titles, progress) {
  const rows = [];
  const cont = titles
    .map(t => ({ t, s: titleState(t, progress) }))
    .filter(x => x.s.continueWatching)
    .sort((a, b) => b.s.updatedAt - a.s.updatedAt)
    .map(x => x.t);
  if (cont.length) rows.push({ id: 'continue', title: 'Seguir viendo', items: cont });

  const byDate = (a, b) => b.ultimoMensajeFecha - a.ultimoMensajeFecha;
  const movies = titles.filter(t => t.tipo === 'pelicula').sort(byDate);
  const series = titles.filter(t => t.tipo === 'serie').sort(byDate);
  if (movies.length) rows.push({ id: 'new-movies', title: 'Novedades · Películas', items: movies });
  if (series.length) rows.push({ id: 'new-series', title: 'Novedades · Series', items: series });

  const groupRows = (list, label) => {
    const m = new Map();
    list.forEach(t => { if (!m.has(t.grupo)) m.set(t.grupo, []); m.get(t.grupo).push(t); });
    [...m.keys()].sort((a, b) => a.localeCompare(b)).forEach(g =>
      rows.push({ id: `${label}-${g}`, title: `${label} · ${g}`,
        items: m.get(g).sort((a, b) => a.nombre.localeCompare(b.nombre)) }));
  };
  groupRows(series, 'Series');
  groupRows(movies, 'Películas');
  return rows;
}

const PALETTE = ['#5b2a86','#1f6f8b','#8b1e3f','#2d6a4f','#9c6644','#3a0ca3','#b5179e','#c1121f'];
export function posterColor(s) {
  let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length];
}
