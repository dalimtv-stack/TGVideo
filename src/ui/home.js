// Proveedor de filas de la Home (independiente del HTML / skin)
import { titleState } from '../player/progress.js';

function getSagaMovieGroups(titles) {
  const groups = [];
  const seenSagas = new Set();

  // 1. Canales físicos de sagas
  const physicalSagas = titles.filter(t => t.isSaga && !t.isVirtualSaga);
  for (const s of physicalSagas) {
    const chId = String(s.channel?.id || s.id);
    if (seenSagas.has(`ch_${chId}`)) continue;
    seenSagas.add(`ch_${chId}`);

    const movies = titles.filter(t =>
      !t.isSaga && !t.isVirtualSaga &&
      (String(t.channel?.id) === chId || String(t.sagaChannelId) === chId || String(t.origen?.channelId) === chId)
    );
    if (movies.length > 0) {
      groups.push({ id: `ch_${chId}`, movies });
    }
  }

  // 2. Colecciones virtuales de TMDB
  const virtualSagas = titles.filter(t => t.isVirtualSaga || t.origen?.tipo === 'auto_collection');
  for (const s of virtualSagas) {
    const colId = String(s.tmdbId || s.origen?.collectionId || s.metadata?.id);
    if (!colId || seenSagas.has(`col_${colId}`)) continue;
    seenSagas.add(`col_${colId}`);

    const movies = titles.filter(t =>
      !t.isSaga && !t.isVirtualSaga &&
      String(t.metadata?.collection?.id || t.metadata?.belongs_to_collection?.id) === colId
    );
    if (movies.length > 0) {
      groups.push({ id: `col_${colId}`, movies });
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

export function buildHomeRows(titles, progress) {
  const rows = [];

  // En "Seguir viendo":
  // Solo debe aparecer la película concreta que se está viendo, NO la saga/colección y la película.
  // Al terminar una película de la saga, como en cualquier episodio, si hay siguiente parte debe aparecer en "Seguir viendo".
  const sagaGroups = getSagaMovieGroups(titles);
  const sagaMovieMap = new Map(); // movieId -> sagaGroup
  for (const g of sagaGroups) {
    for (const m of g.movies) {
      sagaMovieMap.set(String(m.id), g);
    }
  }

  const continueItems = [];
  const processedSagaIds = new Set();

  for (const t of titles) {
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
  if (cont.length) rows.push({ id: 'continue', title: 'Seguir viendo', items: cont });

  const byDate = (a, b) => b.ultimoMensajeFecha - a.ultimoMensajeFecha;
  const movies = titles.filter(t => t.tipo === 'pelicula').sort(byDate);
  const looseMovies = movies.filter(t => !t.isSaga);
  const series = titles.filter(t => t.tipo === 'serie').sort(byDate);
  if (looseMovies.length) rows.push({ id: 'new-movies', title: 'Novedades · Películas', items: looseMovies });
  if (series.length) rows.push({ id: 'new-series', title: 'Novedades · Series', items: series });
  const sports = titles.filter(t => t.tipo === 'deporte').sort(byDate);
  const music = titles.filter(t => t.tipo === 'musica').sort(byDate);
  if (sports.length) rows.push({ id: 'new-sports', title: 'Deportes', items: sports });
  if (music.length) rows.push({ id: 'new-music', title: 'Música', items: music });

  const groupRows = (list, label) => {
    const m = new Map();
    list.forEach(t => {
      const g = (t.grupo || '').trim();
      if (!g) return;
      if (!m.has(g)) m.set(g, []);
      m.get(g).push(t);
    });
    [...m.keys()].sort((a, b) => a.localeCompare(b)).forEach(g =>
      rows.push({
        id: `${label}-${g}`,
        title: `${label} · ${g}`,
        items: m.get(g).sort((a, b) => (a.metadata?.name || a.nombre).localeCompare(b.metadata?.name || b.nombre, 'es', { numeric: true }))
      })
    );
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
