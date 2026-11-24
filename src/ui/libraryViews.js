import { groupTitles, unbundleTitles } from '../library/titles.js';
import { getOverride, getOverrideByTmdbId } from '../metadata/overrides.js';
import { prettyEpisodeName } from '../library/parse.js';
import { extractTitleAndYear } from '../metadata/tmdb.js';
import { getSagaMovieGroups } from './home.js';
import { showCollectionPicker } from './collectionPicker.js';
import { assignMovieToCollection, removeMovieFromCollection } from '../metadata/collections.js';
import { renderAgeBadgeHtml } from './ageRating.js';
import { getTitleTrailers, openFullscreenTrailer } from './carouselView.js';
import { fetchTmdbAgeRating, fetchImdbRating, fetchExternalIds } from '../metadata/tmdb.js';

// Pantallas de biblioteca: fichas y cuadrículas separadas del orquestador.
export function createLibraryViews(deps) {
  const {
    applyProfileScale, setBackHandler, getTitles, setTitles, loadProgress, titleState,
    formatPlayButtonLabel, esc, posterColor, memoryCache, showScreen, cardHtml,
    loadPoster, applyImagePrefs, getAutoLogo, fmtDur, fmtSize, enrichTitle,
    showImagePicker, restoreOriginalImage, showMetadataModal, mergeMoviesByTmdb, attachAutoCollections,
    playFile, fetchSeasonEpisodes, centerSeason, firstUncompleted, adjacentSeason,
    isFavorite, toggleFavorite, toggleAllWatched, focusFirst, showHome, app,
    persistMetadata,
  } = deps;
  let lastOpenedTitleId = null;

  function showGroupGrid(tg, sync, profile, row, { focusTitleId = null } = {}) {
    applyProfileScale(profile);
    const isExt = Boolean(row.isExternal || String(row.id || "").startsWith("ext-"));
    const back = () => isExt ? showHome(tg, sync, profile, { selectedSection: "externos" }) : showHome(tg, sync, profile, { focusRowId: row.id, focusExpandBtn: true });
    setBackHandler(back);

    const titles = getTitles() || [];
    const progress = loadProgress(profile.id);
    const baseItems = (row.gridItems || row.items).map(it => titles.find(t => String(t.id) === String(it.id)) || it);

    const getGridSort = () => {
      try { return localStorage.getItem(`tg_grid_sort_${profile.id}`) || 'subida'; }
      catch (_) { return 'subida'; }
    };
    const setGridSort = (val) => {
      try { localStorage.setItem(`tg_grid_sort_${profile.id}`, val); } catch (_) {}
    };
    const getGridSortDir = (currentSort = 'subida') => {
      try {
        const saved = localStorage.getItem(`tg_grid_sort_dir_${profile.id}`);
        if (saved === 'asc' || saved === 'desc') return saved;
      } catch (_) {}
      return currentSort === 'nombre' ? 'asc' : 'desc';
    };
    const setGridSortDir = (val) => {
      try { localStorage.setItem(`tg_grid_sort_dir_${profile.id}`, val); } catch (_) {}
    };
    const getGridFilterUnidentified = () => {
      try { return localStorage.getItem(`tg_grid_unident_${profile.id}`) === 'true'; }
      catch (_) { return false; }
    };
    const setGridFilterUnidentified = (val) => {
      try { localStorage.setItem(`tg_grid_unident_${profile.id}`, val ? 'true' : 'false'); } catch (_) {}
    };

    let currentSort = getGridSort();
    let currentDir = getGridSortDir(currentSort);
    let onlyUnidentified = getGridFilterUnidentified();
    const getGridGrouped = () => {
      try { return localStorage.getItem(`tg_grid_grouped_${profile.id}`) === "true"; }
      catch (_) { return false; }
    };
    const setGridGrouped = (val) => {
      try { localStorage.setItem(`tg_grid_grouped_${profile.id}`, val ? "true" : "false"); } catch (_) {}
    };
    let isGrouped = getGridGrouped();

    const isIdentified = (t) => Boolean(t.metadata?.id || t.tmdbId);

    const sortGridItems = (items, sortType, sortDir) => {
      const list = [...items];
      const mult = sortDir === 'asc' ? 1 : -1;
      if (sortType === 'subida') {
        return list.sort((a, b) => {
          const msgA = a.ultimoMensajeFecha || 0;
          const msgB = b.ultimoMensajeFecha || 0;
          if (msgB !== msgA) return (msgA - msgB) * mult;
          const nameA = a.metadata?.name || a.metadata?.title || a.nombre || '';
          const nameB = b.metadata?.name || b.metadata?.title || b.nombre || '';
          return nameA.localeCompare(nameB, 'es', { numeric: true, sensitivity: 'base' });
        });
      }
      if (sortType === 'nombre') {
        return list.sort((a, b) => {
          const nameA = a.metadata?.name || a.metadata?.title || a.nombre || '';
          const nameB = b.metadata?.name || b.metadata?.title || b.nombre || '';
          return nameA.localeCompare(nameB, 'es', { numeric: true, sensitivity: 'base' }) * mult;
        });
      }
      if (sortType === 'estreno') {
        return list.sort((a, b) => {
          const dateA = a.metadata?.date || a.yearHint || a.metadata?.release_date || a.metadata?.first_air_date || '';
          const dateB = b.metadata?.date || b.yearHint || b.metadata?.release_date || b.metadata?.first_air_date || '';
          if (dateA && dateB && dateA !== dateB) return dateA.localeCompare(dateB) * mult;
          if (dateA && !dateB) return -1 * mult;
          if (!dateA && dateB) return 1 * mult;
          const nameA = a.metadata?.name || a.metadata?.title || a.nombre || '';
          const nameB = b.metadata?.name || b.metadata?.title || b.nombre || '';
          return nameA.localeCompare(nameB, 'es', { numeric: true, sensitivity: 'base' });
        });
      }
      return list;
    };

    const getProcessedItems = () => {
      let filtered = isGrouped ? groupTitles(baseItems) : unbundleTitles(baseItems);
      if (onlyUnidentified) {
        filtered = filtered.filter(t => !isIdentified(t));
      }
      return sortGridItems(filtered, currentSort, currentDir);
    };

    const renderToolsHtml = () => `
      <div class="grid-sort-bar" role="group" aria-label="Ordenar títulos">
        <span class="grid-sort-label">Ordenar:</span>
        <button type="button" class="grid-sort-btn ${currentSort === 'subida' ? 'active' : ''}" data-focusable data-sort="subida" aria-pressed="${currentSort === 'subida'}" title="Ordenar por fecha de subida (${currentDir === 'asc' ? 'antiguos primero' : 'recientes primero'})">Subida${currentSort === 'subida' ? (currentDir === 'asc' ? ' ↑' : ' ↓') : ''}</button>
        <button type="button" class="grid-sort-btn ${currentSort === 'nombre' ? 'active' : ''}" data-focusable data-sort="nombre" aria-pressed="${currentSort === 'nombre'}" title="Ordenar por nombre (${currentDir === 'asc' ? 'A-Z' : 'Z-A'})">Nombre${currentSort === 'nombre' ? (currentDir === 'asc' ? ' ↑' : ' ↓') : ''}</button>
        <button type="button" class="grid-sort-btn ${currentSort === 'estreno' ? 'active' : ''}" data-focusable data-sort="estreno" aria-pressed="${currentSort === 'estreno'}" title="Ordenar por fecha de estreno (${currentDir === 'asc' ? 'antiguos primero' : 'recientes primero'})">Estreno${currentSort === 'estreno' ? (currentDir === 'asc' ? ' ↑' : ' ↓') : ''}</button>
        <button type="button" class="grid-filter-group-btn ${isGrouped ? "active" : ""}" data-focusable role="checkbox" aria-checked="${isGrouped}" title="Agrupar series y películas">
          <span class="grid-filter-icon" aria-hidden="true">${isGrouped ? "☑" : "☐"}</span>
          <span class="grid-filter-text">Agrupar</span>
        </button>
        <button type="button" class="grid-filter-unidentified-btn ${onlyUnidentified ? 'active' : ''}" data-focusable role="checkbox" aria-checked="${onlyUnidentified}" title="Mostrar solo títulos sin identificar en TMDB">
          <span class="grid-filter-icon" aria-hidden="true">${onlyUnidentified ? '☑' : '☐'}</span>
          <span class="grid-filter-text">No identificados</span>
        </button>
      </div>`;

    const initialItems = getProcessedItems();
    const CHUNK_SIZE = 80;
    let activeGridItems = initialItems;
    let renderedCount = 0;

    showScreen(`
      <div class="screen grid-screen" data-grid-id="${esc(row.id)}">
        <header class="grid-header">
          <button class="btn-icon" data-focusable id="grid-btn-back" title="Volver al inicio" aria-label="Volver">←</button>
          <div class="grid-header-info">
            <h1>${esc(row.title)}</h1>
            <span class="grid-count">${initialItems.length} ${initialItems.length === 1 ? "título" : "títulos"}</span>
          </div>
          <div class="grid-tools" role="region" aria-label="Herramientas de ordenación de cuadrícula">
            ${renderToolsHtml()}
          </div>
        </header>
        <main class="grid-cards"></main>
      </div>`);

    document.getElementById("grid-btn-back").onclick = back;

    const appendGridBatch = (mainEl, items) => {
      if (!mainEl || renderedCount >= items.length) return;
      const batch = items.slice(renderedCount, renderedCount + CHUNK_SIZE);
      renderedCount += batch.length;
      const frag = document.createRange().createContextualFragment(
        batch.map(t => cardHtml(t, progress)).join("")
      );
      frag.querySelectorAll(".lib-card[data-title]").forEach(card => {
        card.onclick = () => {
          const t = items.find(x => String(x.id) === String(card.dataset.title));
          if (t) showDetail(tg, sync, profile, t, { fromGrid: row });
        };
      });
      frag.querySelectorAll(".lib-card-poster img.poster-image").forEach(img => {
        const url = img.getAttribute("data-poster-url") || img.src;
        if (url) loadPoster(img, url);
      });
      mainEl.appendChild(frag);
    };

    const renderCards = (items) => {
      activeGridItems = items;
      renderedCount = 0;
      const mainEl = document.querySelector(".grid-screen .grid-cards");
      const countEl = document.querySelector(".grid-screen .grid-count");
      if (countEl) {
        countEl.textContent = `${items.length} ${items.length === 1 ? "título" : "títulos"}`;
      }
      if (mainEl) {
        mainEl.innerHTML = "";
        if (items.length > 0) {
          appendGridBatch(mainEl, items);
        } else {
          mainEl.innerHTML = `<div class="grid-cards-empty" style="grid-column: 1 / -1; text-align: center; padding: 4rem 1rem; color: #aaa;"><p>No se encontraron vídeos ${onlyUnidentified ? "sin identificar " : ""}en este canal.</p></div>`;
        }
      }
    };

    const onGridScroll = () => {
      const mainEl = document.querySelector(".grid-screen .grid-cards");
      if (!mainEl?.isConnected) {
        window.removeEventListener("scroll", onGridScroll);
        return;
      }
      if (renderedCount < activeGridItems.length && window.innerHeight + window.scrollY >= document.body.offsetHeight - 800) {
        appendGridBatch(mainEl, activeGridItems);
      }
    };
    window.addEventListener("scroll", onGridScroll, { passive: true });

    renderCards(initialItems);

    const bindTools = () => {
      document.querySelectorAll("#app .grid-sort-btn").forEach(btn => {
        btn.onclick = (e) => {
          e.stopPropagation();
          const sortType = btn.dataset.sort;
          if (sortType === currentSort) {
            currentDir = currentDir === "desc" ? "asc" : "desc";
          } else {
            currentSort = sortType;
            currentDir = sortType === "nombre" ? "asc" : "desc";
          }
          setGridSort(currentSort);
          setGridSortDir(currentDir);

          const toolsEl = document.querySelector(".grid-tools");
          if (toolsEl) {
            toolsEl.innerHTML = renderToolsHtml();
            bindTools();
            const activeBtn = toolsEl.querySelector(`.grid-sort-btn[data-sort="${sortType}"]`);
            activeBtn?.focus();
          }
          renderCards(getProcessedItems());
        };
      });

      const groupBtn = document.querySelector("#app .grid-filter-group-btn");
      if (groupBtn) {
        groupBtn.onclick = (e) => {
          e.stopPropagation();
          isGrouped = !isGrouped;
          setGridGrouped(isGrouped);
          const toolsEl = document.querySelector(".grid-tools");
          if (toolsEl) {
            toolsEl.innerHTML = renderToolsHtml();
            bindTools();
            const newGroupBtn = toolsEl.querySelector(".grid-filter-group-btn");
            newGroupBtn?.focus();
          }
          renderCards(getProcessedItems());
        };
      }

      const filterBtn = document.querySelector("#app .grid-filter-unidentified-btn");
      if (filterBtn) {
        filterBtn.onclick = (e) => {
          e.stopPropagation();
          onlyUnidentified = !onlyUnidentified;
          setGridFilterUnidentified(onlyUnidentified);

          const toolsEl = document.querySelector(".grid-tools");
          if (toolsEl) {
            toolsEl.innerHTML = renderToolsHtml();
            bindTools();
            const newFilterBtn = toolsEl.querySelector(".grid-filter-unidentified-btn");
            newFilterBtn?.focus();
          }
          renderCards(getProcessedItems());
        };
      }
    };

    bindCards(initialItems);
    bindTools();

    setTimeout(() => {
      let el = null;
      if (focusTitleId) {
        el = document.querySelector(`.grid-cards .lib-card[data-title="${focusTitleId}"]`);
      }
      if (!el) {
        el = document.querySelector(".grid-cards .lib-card[data-focusable]") || document.getElementById("grid-btn-back");
      }
      if (el) {
        el.focus();
        el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
      }
    }, 80);
  }



function applySagaFilmMetadata(t) {
  const detail = document.querySelector('.detail');
  if (!detail || String(detail.dataset.title) !== String(t.id)) return;
  for (const file of t.archivos) {
    const row = [...detail.querySelectorAll('.ep[data-key]')].find(el => el.dataset.key === file.key);
    if (!row || !file.metadata) continue;
    const image = row.querySelector('.saga-film-poster');
    if (image && file.metadata.poster) {
      if (image.tagName !== 'IMG') {
        const img = document.createElement('img');
        img.className = 'saga-film-poster'; img.alt = ''; img.loading = 'lazy';
        loadPoster(img, file.metadata.poster);
        image.replaceWith(img);
      } else {
        loadPoster(image, file.metadata.poster);
      }
    }
    const name = row.querySelector('.ep-name');
    if (name && file.metadata.name) name.textContent = file.metadata.name;
    let synopsis = row.querySelector('.saga-film-synopsis');
    if (file.metadata.overview) {
      if (!synopsis) {
        synopsis = document.createElement('div');
        synopsis.className = 'saga-film-synopsis';
        row.querySelector('.ep-info')?.append(synopsis);
      }
      synopsis.textContent = file.metadata.overview;
    }
  }
}

function applyDetailMetadata(t, profile) {
  applyImagePrefs(t, profile);
  const metadata = t.metadata;
  if (!metadata) return;
  if (!metadata.logo) {
    getAutoLogo(t).then((url) => {
      if (url && t.metadata && !t.metadata.logo) {
        t.metadata = { ...t.metadata, logo: url };
        applyDetailMetadata(t, profile);
      }
    }).catch(() => {});
  }
  const detail = document.querySelector('.detail');
  if (!detail || String(detail.dataset.title) !== String(t.id)) return;
  const displayName = metadata.name || metadata.title || t.nombre;

  const titleH1 = detail.querySelector('.detail-head h1');
  if (titleH1 && displayName) titleH1.textContent = displayName;
  const posterName = detail.querySelector('.detail-head .poster-name');
  if (posterName && displayName) posterName.textContent = displayName;

  const detailHeadInfo = detail.querySelector('.detail-head > div:last-child');
  if (detailHeadInfo) {
    let logoBox = detailHeadInfo.querySelector('.detail-logo-container');
    if (metadata.logo) {
      if (!logoBox) {
        logoBox = document.createElement('div');
        logoBox.className = 'detail-logo-container';
        const img = document.createElement('img');
        img.className = 'detail-logo-img';
        img.alt = displayName || '';
        img.src = metadata.logo;
        img.onerror = () => { logoBox.remove(); if (titleH1) titleH1.classList.remove('detail-title-hidden', 'sr-only'); };
        logoBox.appendChild(img);
        if (titleH1) {
          titleH1.classList.add('detail-title-hidden', 'sr-only');
          titleH1.parentNode.insertBefore(logoBox, titleH1);
        } else {
          detailHeadInfo.prepend(logoBox);
        }
      } else {
        const img = logoBox.querySelector('.detail-logo-img');
        if (img) {
          img.src = metadata.logo;
          img.alt = displayName || '';
        }
        if (titleH1) titleH1.classList.add('detail-title-hidden', 'sr-only');
      }
    } else {
      if (logoBox) logoBox.remove();
      if (titleH1) titleH1.classList.remove('detail-title-hidden', 'sr-only');
    }
  }

  if (metadata.backdrop) {
    detail.style.setProperty('--detail-backdrop', `url("${metadata.backdrop}")`);
    detail.classList.add('has-backdrop');
  }
  const poster = detail.querySelector('.lib-card-poster.big');
  if (metadata.poster && poster) {
    let image = poster.querySelector('img.poster-image');
    if (!image) {
      image = document.createElement('img');
      image.className = 'poster-image';
      image.alt = displayName;
      poster.prepend(image);
    }
    image.onerror = () => {
      if (image.src !== metadata.poster) image.src = metadata.poster;
    };
    loadPoster(image, metadata.poster);
  }
  const synopsis = detail.querySelector('.detail-syn');
  const toggle = detail.querySelector('.btn-syn-toggle');
  if (synopsis && metadata.overview) {
    synopsis.textContent = metadata.overview;
    synopsis.hidden = false;
    if (toggle) {
      synopsis.classList.remove('expanded');
      requestAnimationFrame(() => {
        const isClamped = synopsis.scrollHeight > synopsis.clientHeight + 4;
        if (isClamped) {
          toggle.hidden = false;
          toggle.textContent = 'más';
          toggle.onclick = (e) => {
            e.preventDefault();
            const exp = synopsis.classList.toggle('expanded');
            toggle.textContent = exp ? 'menos' : 'más';
          };
        } else {
          toggle.hidden = true;
        }
      });
    }
  }
  const info = detail.querySelector('.detail-metadata');
  if (info) {
    const numRating = Number(metadata.imdbRating ?? metadata.rating ?? t.metadata?.imdbRating ?? t.metadata?.rating);
    const ratingStr = Number.isFinite(numRating) && numRating > 0 ? `★ ${numRating.toFixed(1)}` : '';
    const ageBadge = renderAgeBadgeHtml(t);
    const ratingWithAge = [ratingStr, ageBadge].filter(Boolean).join(' ');
    const yearStr = (metadata.date || t.metadata?.date)?.slice(0, 4) || t.yearHint || '';
    info.innerHTML = [yearStr, ratingWithAge].filter(Boolean).join(' · ');
  }


  // Actualizar botón de reproducir con el nombre TMDB si está disponible
  const playBtn = detail.querySelector('#d-play');
  if (playBtn && profile?.id) {
    const progress = loadProgress(profile.id);
    const st = titleState(t, progress);
    const label = formatPlayButtonLabel(t, st, progress);
    if (label) playBtn.textContent = label;
  }
}

function showDetail(tg, sync, profile, t, { fromRowId = null, fromCardIndex = null, fromGrid = null } = {}) {
  lastOpenedTitleId = t.id;
  if (t.isSaga && Array.isArray(t.archivos)) {
    const allTitles = getTitles() || [];
    for (const f of t.archivos) {
      const fileKey = f.key || `${t.channel?.id || t.id}:${f.messageId}`;
      const ov = getOverride(fileKey) || (f.tmdbId ? getOverrideByTmdbId(f.tmdbId) : null);
      if (ov) {
        f.metadata = ov;
        f.tmdbId = ov.id;
        if (ov.name) f.sagaName = ov.name;
      } else {
        const loose = allTitles.find(x => !x.isSaga && x.archivos?.some(a => a.key === f.key));
        if (loose?.metadata) {
          f.metadata = loose.metadata;
          f.tmdbId = loose.tmdbId || loose.metadata.id;
          if (loose.metadata.name) f.sagaName = loose.metadata.name;
        }
      }
    }
  }
  const back = () => {
    if (fromGrid) {
      showGroupGrid(tg, sync, profile, fromGrid, { focusTitleId: t.id });
    } else {
      showHome(tg, sync, profile, { focusTitleId: t.id, focusRowId: fromRowId, focusCardIndex: fromCardIndex });
    }
  };
  setBackHandler(back);
  const progress = loadProgress(profile.id);
  const st = titleState(t, progress);
  const nextLabel = formatPlayButtonLabel(t, st, progress);

  const seasonsMap = new Map();
  if (t.tipo === 'serie') for (const f of t.archivos) {
    const s = f.season || 1;
    if (!seasonsMap.has(s)) seasonsMap.set(s, []);
    seasonsMap.get(s).push(f);
  }
  const seasons = [...seasonsMap.keys()].sort((a, b) => a - b);
  let currentSeason = st.next?.season && seasonsMap.has(st.next.season) ? st.next.season : (seasons[0] || 1);
  const hasSeasons = t.tipo === 'serie' && seasons.length > 1;
  const seasonsBarHtml = hasSeasons ? `
    <div class="seasons-bar"><div class="seasons-label">Temporadas</div>
      <div class="seasons-track">${seasons.map(s => `<button class="season-btn ${s === currentSeason ? 'active' : ''}" data-focusable data-season="${s}">Temporada ${s}</button>`).join('')}</div>
    </div>` : '';
  const displayName = t.metadata?.name || t.metadata?.title || t.nombre;
  const typeLabel = t.tipo === 'serie' ? 'Serie' : t.tipo === 'deporte' ? 'Deporte' : t.tipo === 'musica' ? 'Música' : 'Película';

  showScreen(`
    <div class="screen detail" data-title="${esc(t.id)}" style="--pc:${posterColor(t.grupo + t.nombre)}">
      <div class="detail-nav-bar">
        <button class="btn-ghost" data-focusable id="d-back">← Volver</button>
        <div class="detail-nav-actions">
          <button class="btn-icon-circle" data-focusable id="d-fix-meta" title="Corregir identificación (TMDB)" aria-label="Identificación TMDB">ⓘ</button>
          <button class="btn-icon-circle" data-focusable id="d-images" title="Cambiar cartel, fondo o logo" aria-label="Imágenes de la ficha">⚙</button>
        </div>
      </div>
      <div class="detail-head">
        <div class="lib-card-poster big" style="--pc:${posterColor(t.grupo + t.nombre)}">
          ${t.metadata?.poster ? `<img class="poster-image" src="${esc(memoryCache.get(t.metadata.poster) || t.metadata.poster)}" alt="${esc(displayName)}">` : ''}
          <span class="poster-group">${esc(t.grupo)}</span><span class="poster-name">${esc(displayName)}</span></div>
        <div>
          <div class="detail-kicker">${typeLabel} · ${esc(t.grupo)}</div>
          <div class="detail-title-slot">
            ${t.metadata?.logo ? `<div class="detail-logo-container"><img class="detail-logo-img" src="${esc(t.metadata.logo)}" alt="${esc(displayName)}"><h1 class="detail-title-hidden sr-only">${esc(displayName)}</h1></div>` : `<h1>${esc(displayName)}</h1>`}
          </div>
          <p class="detail-sub">${t.isSaga ? `${t.archivos.length} películas de la saga` : t.tipo === 'serie' ? `${t.archivos.length} episodios` : t.archivos.length > 1 ? `${t.archivos.length} versiones disponibles` : (fmtDur(t.archivos[0]?.duration) || typeLabel)}</p>
          <p class="detail-metadata"></p>
          <div class="detail-syn-container">
            <p class="detail-syn" ${t.archivos[0]?.synopsis ? '' : 'hidden'}>${esc(t.archivos[0]?.synopsis || '')}</p>
            <button class="btn-syn-toggle" type="button" hidden data-focusable>más</button>
          </div>
          <div class="detail-actions-row">
            ${st.next ? `<button class="btn" data-focusable id="d-play">${nextLabel}</button>` : '<p>Este canal todavía no tiene vídeos.</p>'}
            <button class="btn-icon-action" data-focusable id="d-fav" type="button" title="Añadir a favoritos" aria-label="Añadir a favoritos">
              <span class="btn-action-icon" aria-hidden="true">★</span>
              <span class="btn-action-tooltip">Añadir a favoritos</span>
            </button>
            <button class="btn-icon-action" data-focusable id="d-watched" type="button" title="Marcar como visto" aria-label="Marcar como visto">
              <span class="btn-action-icon" aria-hidden="true">✓</span>
              <span class="btn-action-tooltip">Marcar como visto</span>
            </button>
            <button class="btn-icon-action" data-focusable id="d-trailer" type="button" title="Ver tráiler" aria-label="Ver tráiler">
              <span class="btn-action-icon" aria-hidden="true">🎬</span>
              <span class="btn-action-tooltip">Tráiler</span>
            </button>
          </div>
        </div>
      </div>
      ${seasonsBarHtml}
      <h2 class="row-title" id="d-list-title">${t.isSaga ? 'Películas de la saga' : t.tipo === 'serie' ? 'Episodios' : t.tipo === 'deporte' ? 'Vídeos deportivos' : t.tipo === 'musica' ? 'Vídeos musicales' : t.archivos.length > 1 ? 'Versiones disponibles' : 'Archivo de vídeo'}</h2>
      <div class="ep-list" id="ep-list"></div>
    </div>`);

  applyDetailMetadata(t, profile);
  if (t.isSaga) applySagaFilmMetadata(t);

  if (!t.metadata) {
    enrichTitle(t).then(meta => {
      if (meta && String(document.querySelector('.detail')?.dataset.title) === String(t.id)) {
        applyDetailMetadata(t, profile);
        if (t.isSaga) applySagaFilmMetadata(t);
      }
    }).catch(() => {});
  }

  // Reagrupa colecciones tras cambiar la pertenencia de una película y guarda los metadatos
  const regroupCollections = () => {
    if (getTitles()) setTitles((attachAutoCollections || (x => x))(mergeMoviesByTmdb(getTitles())));
    persistMetadata?.();
  };
  const canAddToCollection = t.tipo === 'pelicula' && !t.isSaga && !t.isVirtualSaga && !!t.metadata?.id;

  document.getElementById('d-images').onclick = () => {
    showImagePicker(t, profile, {
      sync,
      onChanged: (kind, url) => {
        if (!url) restoreOriginalImage(t, kind);
        applyDetailMetadata(t, profile);
        persistMetadata?.();
      },
      onAddToCollection: canAddToCollection ? () => {
        showCollectionPicker(t, getTitles() || [], {
          onAdd: async (col) => { await assignMovieToCollection(t, col); regroupCollections(); },
          onRemove: async () => { await removeMovieFromCollection(t); regroupCollections(); },
        });
      } : undefined,
    });
  };

  document.getElementById('d-fix-meta').onclick = () => {
    showMetadataModal(t, (updatedMeta) => {
      t.metadata = updatedMeta;
      if (t.archivos && !t.isSaga) {
        for (const f of t.archivos) {
          f.metadata = updatedMeta;
        }
      }
      const attachFn = attachAutoCollections || (x => x);
      if (getTitles()) setTitles(attachFn(mergeMoviesByTmdb(getTitles())));
      applyDetailMetadata(t, profile);
      showDetail(tg, sync, profile, t, { fromRowId, fromCardIndex, fromGrid });
    }, { client: tg?.getClient?.(), peerOf: tg?.peerOf, profile, sync });
  };

  const play = (f, targetTitle = t) => {
    const p = loadProgress(profile.id)[f.key];
    setBackHandler(null);
    // Siguiente archivo en la lista (episodio / saga / versiones)
    let nextFile = null;
    let nextTitle = targetTitle;
    const allTitles = getTitles() || [];

    if (targetTitle.isSaga) {
      const yearOf = (x) => Number(x.metadata?.date?.slice(0, 4) || x.fileName?.match(/\b(?:19|20)\d{2}\b/)?.[0] || 9999);
      const sortedSaga = [...(targetTitle.archivos || [])].sort((a, b) => (
        yearOf(a) - yearOf(b) ||
        (Number(b.size) || 0) - (Number(a.size) || 0) ||
        (a.label || '').localeCompare(b.label || '', 'es', { numeric: true })
      ));
      const curFilmId = f.metadata?.id || f.tmdbId || f.sagaName || f.label;
      nextFile = sortedSaga.find(x => {
        const xFilmId = x.metadata?.id || x.tmdbId || x.sagaName || x.label;
        if (xFilmId === curFilmId) return false;
        return yearOf(x) > yearOf(f) || (yearOf(x) === yearOf(f) && sortedSaga.indexOf(x) > sortedSaga.indexOf(f));
      }) || null;

      if (nextFile) {
        const standaloneNext = allTitles.find(x => !x.isSaga && !x.isVirtualSaga && x.archivos?.some(a => a.key === nextFile.key));
        if (standaloneNext) nextTitle = standaloneNext;
      }
    } else if (targetTitle.tipo === 'serie') {
      let list = targetTitle.archivos || [];
      if (f.season != null) {
        list = list.filter(x => Number(x.season) === Number(f.season));
        list = [...list].sort((a, b) => (a.episode || 0) - (b.episode || 0));
      }
      const idx = list.findIndex(x => String(x.key) === String(f.key));
      nextFile = idx >= 0 && idx < list.length - 1 ? list[idx + 1] : null;
    } else {
      // Película individual (ej. Scream 1 seleccionada desde Películas, Seguir viendo o Novedades):
      // Buscar si pertenece a una saga (canal físico o colección virtual TMDB) para reproducir la siguiente parte (ej. Scream 2)
      const sagaGroups = getSagaMovieGroups(allTitles);
      const targetGroup = sagaGroups.find(g =>
        g.movies.some(m => String(m.id) === String(targetTitle.id) || m.archivos?.some(a => a.key === f.key))
      );

      if (targetGroup && targetGroup.movies.length > 1) {
        const curIdx = targetGroup.movies.findIndex(m =>
          String(m.id) === String(targetTitle.id) || m.archivos?.some(a => a.key === f.key)
        );
        if (curIdx >= 0 && curIdx < targetGroup.movies.length - 1) {
          const nextMovie = targetGroup.movies[curIdx + 1];
          nextTitle = nextMovie;
          nextFile = nextMovie.archivos?.[0] || null;
          if (nextFile) {
            nextFile = {
              ...nextFile,
              sagaName: nextMovie.metadata?.name || nextMovie.nombre || nextFile.label,
              titleName: nextMovie.metadata?.name || nextMovie.nombre,
            };
          }
        }
      }

      // Si no pertenece a saga o es la última parte, buscar entre versiones del mismo título si existen
      if (!nextFile) {
        let list = targetTitle.archivos || [];
        const idx = list.findIndex(x => String(x.key) === String(f.key));
        nextFile = idx >= 0 && idx < list.length - 1 ? list[idx + 1] : null;
      }
    }

    playFile({
      client: tg.getClient(), peerOf: tg.peerOf, file: f, title: targetTitle, profile,
      resumeAt: p && !p.is_completed ? p.current_time : 0, mount: app,
      onClose: () => showDetail(tg, sync, profile, targetTitle, { fromRowId, fromCardIndex, fromGrid }),
      sync,
      nextFile,
      onNext: (nf) => play(nf, nextTitle),
    });
  };

  const renderEpisodes = (seasonNum) => {
    let files = hasSeasons ? (seasonsMap.get(seasonNum) || []) : t.archivos;
    if (t.isSaga) {
      const yearOf = (f) => Number(f.metadata?.date?.slice(0, 4) || f.fileName.match(/\b(?:19|20)\d{2}\b/)?.[0] || 9999);
      files = [...files].sort((a, b) => (
        yearOf(a) - yearOf(b) ||
        (Number(b.size) || 0) - (Number(a.size) || 0) ||
        a.label.localeCompare(b.label, 'es', { numeric: true })
      ));
    } else if (t.tipo === 'pelicula') {
      // Ordenar las versiones de mayor a menor tamaño
      files = [...files].sort((a, b) => (Number(b.size) || 0) - (Number(a.size) || 0) || (b.date || 0) - (a.date || 0));
    }
    const container = document.getElementById('ep-list');
    container.innerHTML = files.map((f) => {
      const p = progress[f.key];
      const pct = p?.duration ? Math.min(100, p.current_time / p.duration * 100) : 0;
      const ep = f.season || f.episode ? `T${f.season || 1}·E${String(f.episode).padStart(2, '0')}` : '';
      const filmYear = f.metadata?.date?.slice(0, 4) || f.fileName.match(/\b(?:19|20)\d{2}\b/)?.[0] || t.metadata?.date?.slice(0, 4) || '';
      const normalizedMovieName = t.metadata?.name || t.metadata?.title || t.nombre;
      const filmTitle = t.isSaga
        ? (f.metadata?.name || f.sagaName || f.label)
        : t.tipo === 'serie'
          ? (f.metadata?.name || prettyEpisodeName(f.fileName || f.label, normalizedMovieName))
          : (t.archivos.length > 1 ? (f.label || `Versión ${files.indexOf(f) + 1}`) : (f.metadata?.name || normalizedMovieName || f.sagaName || f.label));
      // En series se muestra la fecha oficial de emisión de TMDB si está disponible.
      // Se omite la fecha interna de subida a Telegram según especificación.
      let episodeDate = '';
      if (t.tipo === 'serie' && f.metadata?.air_date) {
        const parts = String(f.metadata.air_date).split('-');
        if (parts.length === 3) {
          episodeDate = `${parts[2].padStart(2, '0')}/${parts[1].padStart(2, '0')}/${parts[0]}`;
        } else {
          episodeDate = String(f.metadata.air_date);
        }
      }
      const fileDurationSecs = f.duration || (t.metadata?.runtime ? (t.metadata.runtime * 60) : 0);
      const durStr = fmtDur(fileDurationSecs);
      const poster = f.metadata?.poster ? `<img class="saga-film-poster" src="${esc(memoryCache.get(f.metadata.poster) || f.metadata.poster)}" alt="" loading="lazy">` : `<div class="saga-film-poster saga-film-placeholder">${esc(filmYear || '🎬')}</div>`;
      const synopsis = f.metadata?.overview ? `<div class="saga-film-synopsis">${esc(f.metadata.overview)}</div>` : '';
      return `<div class="ep ${t.isSaga ? 'saga-film' : ''}" tabindex="0" data-focusable data-key="${esc(f.key)}">
        ${t.isSaga ? poster : `<div class="ep-num">${ep || '•'}</div>`}
        <div class="ep-info"><div class="ep-name">${esc(filmTitle)}</div>
          <div class="ep-meta">${(t.tipo === 'serie' ? [durStr, fmtSize(f.size), episodeDate] : [filmYear, durStr, fmtSize(f.size)]).filter(Boolean).join(' · ')}</div>
          ${synopsis}${pct ? `<div class="poster-progress"><i style="width:${pct}%"></i></div>` : ''}</div>
        <div class="ep-state">
          ${p?.is_completed ? '<span class="ep-visto-badge">✓ Visto</span>' : pct ? Math.round(pct) + '%' : ''}
          ${(t.isSaga || (t.tipo === 'pelicula' && t.archivos.length > 1)) ? `<button class="btn-icon-circle saga-film-btn-meta" data-focusable type="button" data-key="${esc(f.key)}" title="Corregir identificación (TMDB)" aria-label="Identificación TMDB">ⓘ</button>` : ''}
        </div>
      </div>`;
    }).join('');
    container.querySelectorAll('.ep').forEach(el => {
      el.onclick = () => { const f = t.archivos.find(x => x.key === el.dataset.key); if (f) play(f); };
    });
    if (t.isSaga || (t.tipo === 'pelicula' && t.archivos.length > 1)) {
      container.querySelectorAll('.saga-film-btn-meta').forEach(metaBtn => {
        metaBtn.onclick = (e) => {
          e.stopPropagation();
          e.preventDefault();
          const f = t.archivos.find(x => x.key === metaBtn.dataset.key);
          if (!f) return;
          const parsedFilm = extractTitleAndYear(f.captionFileName || f.fileName || f.label);
          const fileKey = f.key || `${t.channel?.id || t.id}:${f.messageId}`;
          const filmTitleObj = {
            id: fileKey,
            tipo: 'pelicula',
            isSaga: false,
            nombre: f.sagaName || parsedFilm.title || f.label,
            yearHint: parsedFilm.year,
            channel: t.channel || f.channel,
            archivos: [f],
            metadata: f.metadata || (t.isSaga ? null : t.metadata) || null,
            tmdbId: f.tmdbId || f.metadata?.id || (t.isSaga ? null : t.tmdbId) || null,
          };
          showMetadataModal(filmTitleObj, (updatedMeta) => {
            f.metadata = updatedMeta;
            f.tmdbId = updatedMeta.id;
            f.sagaName = updatedMeta.name || f.sagaName;

            if (t.isSaga) {
              const allTitles = getTitles() || [];
              const loose = allTitles.find(x => !x.isSaga && x.archivos?.some(a => a.key === f.key));
              if (loose) {
                loose.metadata = updatedMeta;
                loose.tmdbId = updatedMeta.id;
                loose.nombre = updatedMeta.name || loose.nombre;
              }
              if (getTitles()) {
                const attachFn = attachAutoCollections || (x => x);
                setTitles(attachFn(mergeMoviesByTmdb(getTitles())));
              }
              applySagaFilmMetadata(t);
              renderEpisodes(currentSeason);
              persistMetadata?.();
            } else {
              // Película con múltiples versiones: sólo afecta a esa versión
              const allTitles = getTitles() || [];
              const currentTitleTmdbId = String(t.metadata?.id || t.tmdbId || '');
              const newTmdbId = String(updatedMeta?.id || '');

              if (newTmdbId && currentTitleTmdbId && newTmdbId !== currentTitleTmdbId) {
                // Si la identificación difiere del título padre, se separa a su propia ficha
                t.archivos = t.archivos.filter(x => x.key !== f.key);
                const separateTitle = {
                  id: f.key,
                  tipo: 'pelicula',
                  isSaga: false,
                  grupo: t.grupo || 'Películas',
                  nombre: updatedMeta.name || f.label,
                  yearHint: updatedMeta.date?.slice(0, 4) || parsedFilm.year || null,
                  origen: { tipo: 'año_container', channelId: String(f.channelId || t.channel?.id), messageId: f.messageId },
                  channel: t.channel || f.channel,
                  archivos: [f],
                  ultimoMensajeFecha: f.date || 0,
                  tmdbId: updatedMeta.id,
                  metadata: updatedMeta,
                };
                allTitles.push(separateTitle);
              }

              if (getTitles()) {
                const attachFn = attachAutoCollections || (x => x);
                setTitles(attachFn(mergeMoviesByTmdb(allTitles)));
              }
              persistMetadata?.();

              if (t.archivos.length === 0) {
                document.getElementById('d-back')?.click();
              } else {
                applyDetailMetadata(t, profile);
                renderEpisodes(currentSeason);
              }
            }
          }, { client: tg?.getClient?.(), peerOf: tg?.peerOf, profile, sync });
        };
      });
    }
    if (hasSeasons) document.getElementById('d-list-title').textContent = `Temporada ${seasonNum} (${files.length} ep.)`;
  };
  renderEpisodes(currentSeason);

  // Enriquecer nombres/sinopsis de episodios desde TMDB (cada temporada al abrirla)
  let loadSeasonMeta = () => {};
  if (t.tipo === 'serie' && (t.metadata?.id || t.tmdbId)) {
    loadSeasonMeta = (sNum) => {
      fetchSeasonEpisodes(t.metadata?.id || t.tmdbId, sNum).then(episodes => {
        if (!episodes || !episodes.length) return;
        const currentFiles = hasSeasons ? (seasonsMap.get(sNum) || []) : t.archivos;
        let updated = false;
        for (const f of currentFiles) {
          const ep = episodes.find(e => e.episode_number === f.episode);
          if (ep && (ep.name || ep.air_date)) {
            f.metadata = {
              ...(f.metadata || {}),
              name: ep.name || f.metadata?.name,
              overview: ep.overview || f.metadata?.overview,
              air_date: ep.air_date || f.metadata?.air_date
            };
            updated = true;
          }
        }
        if (updated && String(document.querySelector('.detail')?.dataset.title) === String(t.id)) {
          if (currentSeason === sNum) {
            renderEpisodes(sNum);
          }
          const playBtn = document.getElementById('d-play');
          if (playBtn) {
            playBtn.textContent = formatPlayButtonLabel(t, st, progress);
          }
        }
      }).catch(() => {});
    };
    loadSeasonMeta(currentSeason);
  }

  const centerCurrentSeason = () => centerSeason(document.querySelector('.seasons-track'), document.querySelector('.season-btn.active'));
  const changeSeason = (season, focusEpisode = false) => {
    currentSeason = season;
    document.querySelectorAll('.season-btn').forEach(b => b.classList.toggle('active', Number(b.dataset.season) === season));
    renderEpisodes(season);
    loadSeasonMeta(season);
    centerCurrentSeason();
    if (focusEpisode) {
      const target = firstUncompleted(seasonsMap.get(season) || [], loadProgress(profile.id));
      const element = [...document.querySelectorAll('.ep')].find(el => el.dataset.key === target?.key);
      element?.focus({ preventScroll: true });
      element?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  };
  document.getElementById('ep-list').addEventListener('keydown', e => {
    if (!e.target.closest('.ep') || !['ArrowLeft', 'ArrowRight'].includes(e.key) || !hasSeasons) return;
    e.preventDefault(); e.stopPropagation();
    const season = adjacentSeason(seasons, currentSeason, e.key === 'ArrowLeft' ? -1 : 1);
    if (season !== null) changeSeason(season, true);
  });
  document.querySelectorAll('.season-btn').forEach(btn => {
    btn.onclick = () => changeSeason(Number(btn.dataset.season));
  });
  requestAnimationFrame(centerCurrentSeason);
  const track = document.querySelector('.seasons-track');
  if (track) {
    const observer = new ResizeObserver(() => { if (track.isConnected) centerCurrentSeason(); else observer.disconnect(); });
    observer.observe(track);
  }
  document.getElementById('d-back').onclick = back;
  document.getElementById('d-play')?.addEventListener('click', () => play(st.next));

  const favBtn = document.getElementById('d-fav');
  const watchedBtn = document.getElementById('d-watched');
  const trailerBtn = document.getElementById('d-trailer');

  const updateActionButtons = () => {
    if (favBtn && profile?.id) {
      const fav = isFavorite(profile.id, t.id);
      favBtn.classList.toggle('active', fav);
      const tip = fav ? 'Quitar de favoritos' : 'Añadir a favoritos';
      favBtn.title = tip;
      favBtn.setAttribute('aria-label', tip);
      const tipEl = favBtn.querySelector('.btn-action-tooltip');
      if (tipEl) tipEl.textContent = tip;
    }
    if (watchedBtn && profile?.id) {
      const prg = loadProgress(profile.id);
      const allWatched = (t.archivos || []).length > 0 && (t.archivos || []).every(f => prg[f.key]?.is_completed);
      watchedBtn.classList.toggle('active', allWatched);
      const tip = allWatched ? 'Marcar como no visto' : 'Marcar como visto';
      watchedBtn.title = tip;
      watchedBtn.setAttribute('aria-label', tip);
      const tipEl = watchedBtn.querySelector('.btn-action-tooltip');
      if (tipEl) tipEl.textContent = tip;
    }
  };

  updateActionButtons();

  if (favBtn && profile?.id) {
    favBtn.onclick = (e) => {
      e.preventDefault();
      toggleFavorite(profile.id, t.id, sync, profile);
      updateActionButtons();
    };
  }

  if (watchedBtn && profile?.id) {
    watchedBtn.onclick = (e) => {
      e.preventDefault();
      toggleAllWatched(profile.id, t);
      updateActionButtons();
      const prg = loadProgress(profile.id);
      if (sync?.schedulePush) {
        sync.schedulePush({ profile, progress: prg });
      }
      const newSt = titleState(t, prg);
      const playBtnEl = document.getElementById('d-play');
      if (playBtnEl) {
        const lbl = formatPlayButtonLabel(t, newSt, prg);
        if (lbl) playBtnEl.textContent = lbl;
      }
      renderEpisodes(currentSeason);
    };
  }

  if (trailerBtn) {
    trailerBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      const tipEl = trailerBtn.querySelector('.btn-action-tooltip');
      const prevTip = tipEl?.textContent || 'Tráiler';
      trailerBtn.disabled = true;
      if (tipEl) tipEl.textContent = 'Buscando...';
      try {
        const trailers = await getTitleTrailers(t, getTitles() || []);
        if (!trailers || !trailers.length) {
          if (tipEl) tipEl.textContent = 'Sin tráiler';
          setTimeout(() => {
            if (tipEl) tipEl.textContent = prevTip;
            trailerBtn.disabled = false;
          }, 2000);
          return;
        }
        if (tipEl) tipEl.textContent = prevTip;
        trailerBtn.disabled = false;
        openFullscreenTrailer(trailers, t.metadata?.name || t.nombre || '', 0);
      } catch (_) {
        if (tipEl) tipEl.textContent = 'Error';
        setTimeout(() => {
          if (tipEl) tipEl.textContent = prevTip;
          trailerBtn.disabled = false;
        }, 2000);
      }
    });
  }

  // Si la edad recomendada no vino en la caché previa, consultar TMDB y refrescar el distintivo
  const updateDetailMetadataView = () => {
    const infoEl = document.querySelector('.detail-metadata');
    if (infoEl && t?.metadata) {
      const numR = Number(t.metadata.imdbRating ?? t.metadata.rating);
      const rStr = Number.isFinite(numR) && numR > 0 ? `★ ${numR.toFixed(1)}` : '';
      const aBadge = renderAgeBadgeHtml(t);
      const rWithA = [rStr, aBadge].filter(Boolean).join(' ');
      const yStr = (t.metadata.date)?.slice(0, 4) || t.yearHint || '';
      infoEl.innerHTML = [yStr, rWithA].filter(Boolean).join(' · ');
    }
  };

  if (t?.metadata?.id && !t.metadata?.ageRating) {
    fetchTmdbAgeRating(t.tipo === 'serie' ? 'tv' : 'movie', t.metadata.id).then(age => {
      if (age) {
        if (!t.metadata) t.metadata = {};
        t.metadata.ageRating = age;
        updateDetailMetadataView();
      }
    }).catch(() => {});
  }

  // Asegurar puntuación de IMDb en la ficha de detalle
  if (t?.metadata && !t.metadata.hasImdbRating) {
    const imdbId = t.metadata.imdbId;
    if (imdbId) {
      fetchImdbRating(imdbId, t.tipo).then(r => {
        if (r && Number.isFinite(r) && r > 0) {
          t.metadata.rating = r;
          t.metadata.imdbRating = r;
          t.metadata.hasImdbRating = true;
          updateDetailMetadataView();
          persistMetadata?.();
        }
      }).catch(() => {});
    } else if (t.metadata.id) {
      fetchExternalIds(t.tipo, t.metadata.id).then(async ext => {
        if (ext?.imdb_id) {
          t.metadata.imdbId = ext.imdb_id;
          const r = await fetchImdbRating(ext.imdb_id, t.tipo).catch(() => null);
          if (r && Number.isFinite(r) && r > 0) {
            t.metadata.rating = r;
            t.metadata.imdbRating = r;
            t.metadata.hasImdbRating = true;
            updateDetailMetadataView();
            persistMetadata?.();
          }
        }
      }).catch(() => {});
    }
  }

  focusFirst('#d-play, .season-btn.active, #ep-list .ep[data-focusable]');
}


  return { showGroupGrid, showDetail, applyDetailMetadata, applySagaFilmMetadata };
}