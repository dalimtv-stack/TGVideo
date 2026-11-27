// Proveedor de filas de la Home (independiente del HTML / skin)
import { titleState } from '../player/progress.js';
import { sortNews, NEWS_HOME_LIMIT, NEWS_GRID_LIMIT } from '../library/newsPrefs.js';
import { isExternalTitle } from '../library/titles.js';

export const HOME_ROW_LIMIT = 20;

export function getSagaMovieGroups(titles) {
  const groups = [];
  const seenSagas = new Set();

  // 1. Canales físicos de sagas
  const physicalSagas = titles.filter(t => t.isSaga && !t.isVirtualSaga && !isExternalTitle(t));
  for (const s of physicalSagas) {
    const chId = String(s.channel?.id || s.id);
    if (seenSagas.has(`ch_${chId}`)) continue;
    seenSagas.add(`ch_${chId}`);

    const movies = titles.filter(t =>
      !t.isSaga && !t.isVirtualSaga && !isExternalTitle(t) &&
      (String(t.channel?.id) === chId || String(t.sagaChannelId) === chId || String(t.origen?.channelId) === chId)
    );
    if (movies.length > 0) {
      groups.push({ id: `ch_${chId}`, movies });
    }
  }

  // 2. Colecciones virtuales de TMDB
  const virtualSagas = titles.filter(t => (t.isVirtualSaga || t.origen?.tipo === 'auto_collection') && !isExternalTitle(t));
  for (const s of virtualSagas) {
    const colId = String(s.tmdbId || s.origen?.collectionId || s.metadata?.id);
    if (!colId || seenSagas.has(`col_${colId}`)) continue;
    seenSagas.add(`col_${colId}`);

    const movies = titles.filter(t =>
      !t.isSaga && !t.isVirtualSaga && !isExternalTitle(t) &&
      String(t.metadata?.collection?.id || t.metadata?.belongs_to_collection?.id) === colId
    );
    if (movies.length > 0) {
      groups.push({ id: `col_${colId}`, movies });
    }
  }

  // 3. Películas que comparten collection ID (TMDB) aunque aún no se haya instanciado el objeto saga
  const colMap = new Map();
  for (const t of titles) {
    if (t.isSaga || t.isVirtualSaga || isExternalTitle(t)) continue;
    const cid = t.metadata?.collection?.id || t.metadata?.belongs_to_collection?.id;
    if (cid) {
      const key = `col_${cid}`;
      if (!seenSagas.has(key)) {
        if (!colMap.has(key)) colMap.set(key, []);
        colMap.get(key).push(t);
      }
    }
  }
  for (const [key, movies] of colMap.entries()) {
    if (movies.length > 1) {
      seenSagas.add(key);
      groups.push({ id: key, movies });
    }
  }

  // Ordenar cronológicamente las películas dentro de cada saga
  const yearOf = (m) => {
    const f = m.archivos?.[0];
    return Number(m.metadata?.date?.slice(0, 4) || m.yearHint || f?.metadata?.date?.slice(0, 4) || f?.fileName?.match(/\b(?:19|20)\d{2}\b/)?.[0] || 9999);
  };
  for (const g of groups) {
    g.movies.sort((a, b) => yearOf(a) - yearOf(b) || (a.metadata?.name || a.nombre).localeCompare(b.metadata?.name || b.nombre, 'es', { numeric: true }));
  }

  return groups;
}

export function buildHomeRows(titles, progress, newsPrefs = {}) {
  const rows = [];

  // Excluir de forma estricta los títulos de canales externos de la Home y de Seguir viendo
  const standardTitles = titles.filter(t => !isExternalTitle(t));

  // En "Seguir viendo":
  // Solo debe aparecer la película concreta que se está viendo, NO la saga/colección y la película.
  // Al terminar una película de la saga, como en cualquier episodio, si hay siguiente parte debe aparecer en "Seguir viendo".
  const sagaGroups = getSagaMovieGroups(standardTitles);
  const sagaMovieMap = new Map(); // movieId -> sagaGroup
  for (const g of sagaGroups) {
    for (const m of g.movies) {
      sagaMovieMap.set(String(m.id), g);
    }
  }

  const continueItems = [];
  const processedSagaIds = new Set();

  for (const t of standardTitles) {
    // Excluir colecciones y sagas como contenedor (nunca van en Seguir viendo)
    if (t.isSaga || t.isVirtualSaga || t.metadata?.type === 'collection' || (t.grupo || '').trim().toLowerCase() === 'sagas') {
      continue;
    }

    const s = titleState(t, progress);
    const saga = sagaMovieMap.get(String(t.id));

    if (saga) {
      if (processedSagaIds.has(saga.id)) continue;
      processedSagaIds.add(saga.id);

      // Evaluar la saga:
      // ¿Hay alguna película en curso (empezada y no completada)?
      const inProgressMovie = saga.movies.find(m => {
        const st = titleState(m, progress);
        const lp = st.next ? progress[st.next.key] : null;
        return lp && !lp.is_completed && lp.current_time > 0;
      });

      if (inProgressMovie) {
        const st = titleState(inProgressMovie, progress);
        continueItems.push({ t: inProgressMovie, s: st, updatedAt: st.updatedAt || 0 });
      } else {
        // Ninguna película de la saga en curso. Buscar si la última vista se completó
        let lastCompletedMovie = null;
        let lastCompletedAt = 0;
        let lastCompletedIdx = -1;

        saga.movies.forEach((m, idx) => {
          const mFiles = m.archivos || [];
          for (const f of mFiles) {
            const p = progress[f.key];
            if (p?.is_completed && p.updated_at > lastCompletedAt) {
              lastCompletedAt = p.updated_at;
              lastCompletedMovie = m;
              lastCompletedIdx = idx;
            }
          }
        });

        if (lastCompletedMovie && lastCompletedIdx >= 0) {
          // Siguiente película de la saga no completada
          const nextMovie = saga.movies.slice(lastCompletedIdx + 1).find(m => {
            const mFiles = m.archivos || [];
            return !mFiles.every(f => progress[f.key]?.is_completed);
          });

          if (nextMovie) {
            const st = titleState(nextMovie, progress);
            continueItems.push({
              t: nextMovie,
              s: { ...st, started: false, continueWatching: true, updatedAt: lastCompletedAt },
              updatedAt: lastCompletedAt
            });
          }
        }
      }
    } else {
      // Títulos que no pertenecen a sagas (series, deportes, música, películas individuales estándar)
      if (s.continueWatching) {
        continueItems.push({ t, s, updatedAt: s.updatedAt || 0 });
      }
    }
  }

  continueItems.sort((a, b) => b.updatedAt - a.updatedAt);
  const cont = continueItems.map(x => x.t);
  if (cont.length) rows.push({ id: 'continue', title: 'Seguir viendo', items: cont.slice(0, HOME_ROW_LIMIT), gridItems: cont });

  const byDate = (a, b) => b.ultimoMensajeFecha - a.ultimoMensajeFecha;
  const movies = standardTitles.filter(t => t.tipo === 'pelicula').sort(byDate);
  const looseMovies = movies.filter(t => !t.isSaga);
  const series = standardTitles.filter(t => t.tipo === 'serie').sort(byDate);
  // Novedades: máx. 30 en la fila y 60 en la cuadrícula ("+"), con el orden configurado
  const newsMovies = sortNews(looseMovies, newsPrefs.movies || 'upload');
  const newsSeries = sortNews(series, newsPrefs.series || 'upload');
  if (newsMovies.length) rows.push({ id: 'new-movies', title: 'Novedades · Películas', items: newsMovies.slice(0, HOME_ROW_LIMIT), gridItems: newsMovies.slice(0, NEWS_GRID_LIMIT) });
  if (newsSeries.length) rows.push({ id: 'new-series', title: 'Novedades · Series', items: newsSeries.slice(0, HOME_ROW_LIMIT), gridItems: newsSeries.slice(0, NEWS_GRID_LIMIT) });
  const sports = standardTitles.filter(t => t.tipo === 'deporte').sort(byDate);
  const music = standardTitles.filter(t => t.tipo === 'musica').sort(byDate);
  if (sports.length) rows.push({ id: 'new-sports', title: 'Deportes', items: sports.slice(0, HOME_ROW_LIMIT), gridItems: sports });
  if (music.length) rows.push({ id: 'new-music', title: 'Música', items: music.slice(0, HOME_ROW_LIMIT), gridItems: music });

  const groupRows = (list, label) => {
    const m = new Map();
    list.forEach(t => {
      const g = (t.grupo || '').trim();
      if (!g) return;
      if (!m.has(g)) m.set(g, []);
      m.get(g).push(t);
    });
    [...m.keys()].sort((a, b) => a.localeCompare(b)).forEach(g => {
      const allGroupItems = m.get(g).sort((a, b) => (a.metadata?.name || a.nombre).localeCompare(b.metadata?.name || b.nombre, 'es', { numeric: true }));
      rows.push({
        id: `${label}-${g}`,
        title: `${label} · ${g}`,
        items: allGroupItems.slice(0, HOME_ROW_LIMIT),
        gridItems: allGroupItems
      });
    });
  };
  groupRows(series, 'Series');

  // En la Home, solo canales habituales de películas:
  // Se excluyen las sagas completas (isSaga), las colecciones virtuales,
  // el grupo 'Sagas' y las películas sueltas cuyo origen sea un canal de saga (origen: saga_pelicula o channel.isSaga).
  const channelMovies = movies.filter(t =>
    !t.isSaga &&
    !t.isVirtualSaga &&
    t.metadata?.tipo !== 'collection' &&
    t.origen?.tipo !== 'saga_pelicula' &&
    !t.channel?.isSaga &&
    (t.grupo || '').trim().toLowerCase() !== 'sagas'
  );
  groupRows(channelMovies, 'Películas');
  return rows;
}

const PALETTE = ['#5b2a86','#1f6f8b','#8b1e3f','#2d6a4f','#9c6644','#3a0ca3','#b5179e','#c1121f'];
export function posterColor(s) {
  let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length];
}

function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Compara dos listas de títulos para determinar si ha habido novedades reales
 * (títulos nuevos o eliminados, nuevos episodios/archivos, cambios de fecha o metadatos TMDB).
 * Si no hay diferencias, devuelve false, evitando redibujar la pantalla.
 */
export function hasLibraryChanges(prevTitles, newTitles) {
  if (!prevTitles && !newTitles) return false;
  if (!prevTitles || !newTitles) return true;
  if (prevTitles.length !== newTitles.length) return true;

  const prevMap = new Map();
  for (let i = 0; i < prevTitles.length; i++) {
    const t = prevTitles[i];
    prevMap.set(String(t.id), t);
  }

  for (let i = 0; i < newTitles.length; i++) {
    const nt = newTitles[i];
    const pt = prevMap.get(String(nt.id));
    if (!pt) return true;
    if ((nt.ultimoMensajeFecha || 0) !== (pt.ultimoMensajeFecha || 0)) return true;
    const nFiles = nt.archivos?.length || 0;
    const pFiles = pt.archivos?.length || 0;
    if (nFiles !== pFiles) return true;
    if (Boolean(nt.metadata) !== Boolean(pt.metadata)) return true;
    if (nt.metadata && pt.metadata) {
      if (nt.metadata.id !== pt.metadata.id) return true;
      if (nt.metadata.poster !== pt.metadata.poster) return true;
      if ((nt.metadata.name || nt.nombre || "") !== (pt.metadata.name || pt.nombre || "")) return true;
    }
  }

  return false;
}

/**
 * Inserta suavemente nuevas tarjetas o filas en la Home activa sin destruir el DOM,
 * sin reajustar el scroll, sin perder el foco del mando a distancia y sin parpadeos.
 */
export function smoothUpdateHomeRows({
  titles,
  progress = {},
  newsPrefs = {},
  libraryViews,
  tg,
  sync,
  profile,
  loadPoster,
  cardHtml,
}) {
  const homeMain = document.querySelector(".home-main");
  if (!homeMain) return false;

  const newRows = buildHomeRows(titles, progress, newsPrefs);
  if (!newRows.length) return false;

  const escapeAttr = (s) => (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/["\\]/g, "\\$&");

  let anyUpdated = false;

  for (const newRow of newRows) {
    const rowEl = homeMain.querySelector(`.row[data-row-id="${escapeAttr(newRow.id)}"]`);
    if (rowEl) {
      const trackEl = rowEl.querySelector(".row-track");
      if (!trackEl) continue;

      const existingCards = new Map();
      trackEl.querySelectorAll(".lib-card[data-title]").forEach(c => {
        existingCards.set(String(c.dataset.title), c);
      });

      const newItems = (newRow.items || []).filter(item => !existingCards.has(String(item.id)));
      if (newItems.length > 0) {
        anyUpdated = true;
        const expandBtn = trackEl.querySelector(".row-expand-card");

        for (const item of newItems) {
          const html = cardHtml(item, progress);
          const tmpl = document.createElement("template");
          tmpl.innerHTML = html.trim();
          const cardEl = tmpl.content.firstElementChild;
          if (!cardEl) continue;

          cardEl.classList.add("card-enter-smooth");
          cardEl._titleData = item;
          cardEl.onclick = () => {
            libraryViews?.showDetail?.(tg, sync, profile, item, { fromRowId: newRow.id });
          };

          const img = cardEl.querySelector(".lib-card-poster img.poster-image");
          if (img && loadPoster) {
            const url = img.getAttribute("data-poster-url") || img.src;
            if (url) loadPoster(img, url);
          }

          if (expandBtn && expandBtn.nextSibling) {
            trackEl.insertBefore(cardEl, expandBtn.nextSibling);
          } else if (expandBtn) {
            trackEl.appendChild(cardEl);
          } else {
            trackEl.prepend(cardEl);
          }
        }
      }
    } else {
      anyUpdated = true;
      const rowSection = document.createElement("section");
      rowSection.className = "row row-enter-smooth";
      rowSection.dataset.rowId = newRow.id;
      rowSection.innerHTML = `
        <div class="row-header">
          <h2 class="row-title">${esc(newRow.title)}</h2>
        </div>
        <div class="row-track">
          <div class="lib-card row-expand-card" tabindex="0" data-focusable data-row-id="${esc(newRow.id)}" title="Ver todos en cuadrícula" aria-label="Ver todos ${esc(newRow.title)}">
            <div class="row-expand-card-inner">
              <span class="row-expand-plus">+</span>
            </div>
          </div>
          ${newRow.items.map(t => cardHtml(t, progress)).join("")}
        </div>`;

      const expandBtn = rowSection.querySelector(".row-expand-card");
      if (expandBtn) {
        expandBtn.onclick = () => {
          libraryViews?.showGroupGrid?.(tg, sync, profile, newRow);
        };
      }

      rowSection.querySelectorAll(".lib-card[data-title]").forEach((card, idx) => {
        const t = newRow.items[idx];
        if (t) card._titleData = t;
        card.onclick = () => {
          if (t) libraryViews?.showDetail?.(tg, sync, profile, t, { fromRowId: newRow.id, fromCardIndex: idx + 1 });
        };
      });

      rowSection.querySelectorAll(".lib-card-poster img.poster-image").forEach(img => {
        const url = img.getAttribute("data-poster-url") || img.src;
        if (url && loadPoster) loadPoster(img, url);
      });

      homeMain.appendChild(rowSection);
    }
  }

  return anyUpdated;
}
