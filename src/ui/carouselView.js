// src/ui/carouselView.js
// Vista en carrusel de las pestañas de categoría (Favoritos, Películas, Series, Colecciones…).
//   modo 'posters': portadas grandes (todas del mismo tamaño) y debajo la sinopsis.
//   modo 'logos'  : logo de cada título; debajo, el tráiler de TMDB que se reproduce solo, y la sinopsis.
// Todo se ajusta a la altura disponible de la pantalla. Se maneja con mando/teclado:
//   ◀ ▶ cambian de título · OK abre la ficha · ▲ vuelve a "Ordenar" · ratón/táctil: clic, rueda o deslizar.
import { getAutoLogo } from '../metadata/autoLogo.js';
import { fetchTmdbTrailer, fetchCollectionMovieTrailers } from '../metadata/tmdb.js';
import { loadPoster, memoryCache } from '../metadata/posterCache.js';
import { posterColor } from './home.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const LOAD_WINDOW = 5;        // elementos a cada lado del activo cuyas imágenes se cargan
const TRAILER_DELAY_MS = 700; // espera antes de pedir/mostrar el tráiler (evita cargas al ir pasando rápido)

let active = null;

const titleType = (t) =>
  (t.isSaga || t.metadata?.type === 'collection') ? 'collection' : (t.tipo === 'serie' ? 'tv' : 'movie');

const isCollectionTitle = (t) =>
  Boolean(t.isSaga || t.isVirtualSaga || t.metadata?.type === 'collection' || t.metadata?.tipo === 'collection' || t.grupo === 'Sagas');

const displayName = (t) => t.metadata?.name || t.metadata?.title || t.nombre || '';

function badgeOf(t) {
  if (t.tipo === 'serie') return `${t.archivos.length} ep.`;
  if (t.isSaga) return `${t.archivos.length} películas`;
  if (t.tipo === 'deporte') return 'Deporte';
  if (t.tipo === 'musica') return 'Música';
  return t.archivos.length > 1 ? `${t.archivos.length} versiones` : 'Película';
}

function metaLine(t) {
  const m = t.metadata || {};
  const rating = Number(m.rating);
  return [
    String(m.date || '').slice(0, 4) || t.yearHint || '',
    Number.isFinite(rating) && rating > 0 ? `★ ${rating.toFixed(1)}` : '',
    badgeOf(t),
  ].filter(Boolean).join(' · ');
}

const synopsisOf = (t) => t.metadata?.overview || t.archivos?.[0]?.synopsis || '';

/**
 * Obtiene los tráilers disponibles para un título.
 * Si es una colección o saga, obtiene en orden cronológico los tráilers de las películas que la componen.
 * @param {object} t
 * @param {object[]} [allTitles]
 * @param {AbortSignal} [signal]
 * @returns {Promise<Array<{ key: string, id?: number|string, name: string, date?: string }>>}
 */
export async function getTitleTrailers(t, allTitles = [], signal) {
  if (!t) return [];

  // Si ya están cacheados en este título, devolverlos
  if (Array.isArray(t._collectionTrailers)) {
    return t._collectionTrailers;
  }

  // Si NO es colección: es una película estándar o serie
  if (!isCollectionTitle(t)) {
    if (t._trailerKey) {
      return [{ key: t._trailerKey, name: displayName(t) }];
    }
    const id = t.metadata?.id || t.tmdbId;
    if (!id) return [];
    try {
      const key = await fetchTmdbTrailer(titleType(t), id, signal);
      if (key) {
        t._trailerKey = key;
        return [{ key, name: displayName(t) }];
      }
    } catch (_) {}
    return [];
  }

  // ES UNA COLECCIÓN O SAGA:
  const colId = t.metadata?.id || t.tmdbId || t.origen?.collectionId;
  let trailers = [];

  // 1. Obtener partes oficiales de la colección desde TMDB (/collection/{id})
  if (colId && String(colId).match(/^\d+$/)) {
    try {
      trailers = await fetchCollectionMovieTrailers(colId, signal);
    } catch (_) {
      trailers = [];
    }
  }

  // 2. Si no hay trailers aún, buscar a partir de los archivos de la saga en la biblioteca
  if ((!trailers || !trailers.length) && Array.isArray(t.archivos) && t.archivos.length > 0) {
    const yearOf = (f) => Number(f.metadata?.date?.slice(0, 4) || f.fileName?.match(/\b(?:19|20)\d{2}\b/)?.[0] || 9999);
    const sortedFiles = [...t.archivos].sort((a, b) => (
      yearOf(a) - yearOf(b) ||
      (a.metadata?.name || a.sagaName || a.label || '').localeCompare(b.metadata?.name || b.sagaName || b.label || '', 'es', { numeric: true })
    ));

    const seenIds = new Set();
    const movieCandidates = [];
    for (const f of sortedFiles) {
      const mId = f.metadata?.id || f.tmdbId;
      const filmName = f.metadata?.name || f.sagaName || f.label || '';
      const key = mId ? `id_${mId}` : `name_${filmName}`;
      if (seenIds.has(key)) continue;
      seenIds.add(key);
      if (mId) {
        movieCandidates.push({ id: mId, name: filmName, date: f.metadata?.date || '' });
      }
    }

    if (movieCandidates.length > 0) {
      const fetched = await Promise.all(
        movieCandidates.map(async (m) => {
          try {
            const key = await fetchTmdbTrailer('movie', m.id, signal);
            if (!key) return null;
            const year = m.date ? String(m.date).slice(0, 4) : '';
            const titleWithYear = year && !m.name.includes(year) ? `${m.name} (${year})` : m.name;
            return { key, id: m.id, name: titleWithYear, date: m.date };
          } catch (_) {
            return null;
          }
        })
      );
      trailers = fetched.filter(Boolean);
    }
  }

  // 3. Si aún no hay trailers y tenemos títulos globales, buscar títulos sueltos asociados al canal de la saga
  if ((!trailers || !trailers.length) && Array.isArray(allTitles) && allTitles.length > 0) {
    const chId = String(t.channel?.id || t.id || '');
    const related = allTitles.filter(x =>
      !x.isSaga && !x.isVirtualSaga &&
      (String(x.channel?.id) === chId || String(x.sagaChannelId) === chId || String(x.origen?.channelId) === chId)
    );
    if (related.length > 0) {
      const yearOfTitle = (m) => Number(m.metadata?.date?.slice(0, 4) || m.yearHint || 9999);
      related.sort((a, b) => yearOfTitle(a) - yearOfTitle(b));
      const fetched = await Promise.all(
        related.map(async (m) => {
          const mId = m.metadata?.id || m.tmdbId;
          if (!mId) return null;
          try {
            const key = await fetchTmdbTrailer('movie', mId, signal);
            if (!key) return null;
            const name = displayName(m);
            const year = m.metadata?.date ? String(m.metadata.date).slice(0, 4) : '';
            const titleWithYear = year && !name.includes(year) ? `${name} (${year})` : name;
            return { key, id: mId, name: titleWithYear, date: m.metadata?.date || '' };
          } catch (_) {
            return null;
          }
        })
      );
      trailers = fetched.filter(Boolean);
    }
  }

  t._collectionTrailers = trailers || [];
  return t._collectionTrailers;
}

/**
 * Abre el reproductor de tráiler a pantalla completa.
 * Si recibe una lista de tráilers (colección), reproduce en orden cronológico los tráilers
 * de las películas que la componen, pasando de uno a otro automáticamente al terminar
 * y ciclando de vuelta al primero de forma continua.
 * @param {string|Array<{ key: string, name?: string }>} trailersInput
 * @param {string} [mainTitle]
 * @param {number} [initialIndex]
 */
export function openFullscreenTrailer(trailersInput, mainTitle = 'Tráiler', initialIndex = 0) {
  document.querySelector('.carousel-trailer-modal')?.remove();

  let trailers = [];
  if (typeof trailersInput === 'string') {
    trailers = [{ key: trailersInput, name: mainTitle }];
  } else if (Array.isArray(trailersInput)) {
    trailers = trailersInput.filter(x => x?.key);
  }
  if (!trailers.length) return;

  const isMulti = trailers.length > 1;
  let activeIndex = Math.max(0, Math.min(trailers.length - 1, initialIndex || 0));
  let advanceTimeout = null;

  const modal = document.createElement('div');
  modal.className = 'carousel-trailer-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', `Tráiler: ${mainTitle}`);

  modal.innerHTML = `
    <div class="carousel-trailer-backdrop"></div>
    <div class="carousel-trailer-content">
      <div class="carousel-trailer-bar">
        <div class="carousel-trailer-info">
          <span class="carousel-trailer-main-title">${esc(mainTitle)}</span>
          ${isMulti ? `<span class="carousel-trailer-seq-badge"></span>` : ''}
        </div>
        <div class="carousel-trailer-controls">
          ${isMulti ? `
            <button type="button" class="carousel-trailer-nav-btn prev" data-focusable title="Tráiler anterior" aria-label="Tráiler anterior">‹</button>
            <button type="button" class="carousel-trailer-nav-btn next" data-focusable title="Siguiente tráiler" aria-label="Siguiente tráiler">›</button>
          ` : ''}
          <button type="button" class="carousel-trailer-close" data-focusable title="Cerrar tráiler" aria-label="Cerrar tráiler">✕</button>
        </div>
      </div>
      <div class="carousel-trailer-frame-wrap"></div>
    </div>
  `;

  document.body.appendChild(modal);

  const frameWrap = modal.querySelector('.carousel-trailer-frame-wrap');
  const badgeEl = modal.querySelector('.carousel-trailer-seq-badge');
  const prevBtn = modal.querySelector('.carousel-trailer-nav-btn.prev');
  const nextBtn = modal.querySelector('.carousel-trailer-nav-btn.next');
  const closeBtn = modal.querySelector('.carousel-trailer-close');

  function renderVideo(idx) {
    clearTimeout(advanceTimeout);
    activeIndex = (idx + trailers.length) % trailers.length;
    const cur = trailers[activeIndex];
    const filmName = cur.name || mainTitle;

    if (badgeEl) {
      badgeEl.textContent = `Tráiler ${activeIndex + 1} de ${trailers.length}: ${filmName}`;
      badgeEl.title = filmName;
    }

    const allKeys = trailers.map(t => t.key);
    const playlist = allKeys.slice(activeIndex).concat(allKeys.slice(0, activeIndex)).join(',');
    const src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(cur.key)}`
      + `?autoplay=1&controls=1&rel=0&modestbranding=1&playsinline=1&loop=1&playlist=${encodeURIComponent(playlist)}&enablejsapi=1`;

    frameWrap.innerHTML = `
      <iframe
        src="${src}"
        title="Tráiler: ${esc(filmName)}"
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        allowfullscreen>
      </iframe>
    `;
  }

  const close = () => {
    clearTimeout(advanceTimeout);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('message', onMessage);
    modal.classList.add('closing');
    setTimeout(() => modal.remove(), 200);
    const returnTarget = document.querySelector('.carousel-trailer-btn:focus')
      || document.querySelector('.carousel-trailer-btn')
      || document.querySelector('.carousel-stage');
    returnTarget?.focus?.({ preventScroll: true });
  };

  const onKey = (e) => {
    if (e.key === 'Escape' || e.key === 'Back' || e.key === 'BrowserBack') {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if (isMulti) {
      const activeEl = document.activeElement;
      const onControls = activeEl && modal.querySelector('.carousel-trailer-controls')?.contains(activeEl);
      if (!onControls) {
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          e.stopPropagation();
          renderVideo(activeIndex - 1);
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          e.stopPropagation();
          renderVideo(activeIndex + 1);
        }
      }
    }
  };
  window.addEventListener('keydown', onKey, true);

  const onMessage = (e) => {
    if (!isMulti) return;
    try {
      const data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
      if (data?.event === 'onStateChange' && data.info === 0) { // 0 = YT.PlayerState.ENDED
        clearTimeout(advanceTimeout);
        advanceTimeout = setTimeout(() => {
          renderVideo(activeIndex + 1);
        }, 350);
      }
    } catch (_) {}
  };
  window.addEventListener('message', onMessage);

  if (prevBtn) {
    prevBtn.onclick = (e) => {
      e.stopPropagation();
      renderVideo(activeIndex - 1);
    };
  }
  if (nextBtn) {
    nextBtn.onclick = (e) => {
      e.stopPropagation();
      renderVideo(activeIndex + 1);
    };
  }

  closeBtn.onclick = (e) => {
    e.stopPropagation();
    close();
  };
  modal.querySelector('.carousel-trailer-backdrop').onclick = (e) => {
    e.stopPropagation();
    close();
  };

  renderVideo(activeIndex);
  closeBtn?.focus?.();
}

export function destroyCarousel() {
  active?.destroy();
  active = null;
}

/**
 * @param {HTMLElement} host
 * @param {{ items: object[], mode?: 'posters'|'logos', initialId?: string|null, allTitles?: object[], onOpen?: (t: object) => void }} opts
 */
export function mountCarousel(host, { items, mode = 'posters', initialId = null, allTitles = [], onOpen } = {}) {
  destroyCarousel();
  if (!host || !items?.length) return null;

  const logos = mode === 'logos';
  let cur = Math.max(0, items.findIndex((t) => String(t.id) === String(initialId)));
  let trailerTimer = null;
  let trailerToken = 0;
  let logoTrailerTrailers = [];
  let logoTrailerIdx = 0;
  let logoAdvanceTimeout = null;

  host.innerHTML = `
    <div class="carousel-view carousel-mode-${logos ? 'logos' : 'posters'}">
      <div class="carousel-stage" tabindex="0" data-focusable role="listbox" aria-label="Carrusel de títulos">
        <div class="carousel-track">
          ${items.map((t, i) => `
            <div class="carousel-item" role="option" data-i="${i}" data-title="${esc(t.id)}" style="--pc:${posterColor((t.grupo || '') + (t.nombre || ''))}"></div>`).join('')}
        </div>
        <button type="button" class="carousel-nav prev" tabindex="-1" aria-label="Anterior">‹</button>
        <button type="button" class="carousel-nav next" tabindex="-1" aria-label="Siguiente">›</button>
      </div>
      <div class="carousel-info">
        <h2 class="carousel-title"></h2>
        <div class="carousel-meta"></div>
        ${logos ? '<div class="carousel-trailer" aria-label="Tráiler"></div>' : ''}
        <p class="carousel-syn"></p>
        ${!logos ? `
        <div class="carousel-trailer-action">
          <button type="button" class="carousel-trailer-btn" data-focusable aria-label="Reproducir tráiler a pantalla completa">
            <span class="carousel-trailer-icon">▶</span>
            <span class="carousel-trailer-text">Tráiler</span>
          </button>
        </div>` : ''}
        <div class="carousel-count"></div>
      </div>
    </div>`;

  const stage = host.querySelector('.carousel-stage');
  const track = host.querySelector('.carousel-track');
  const els = [...host.querySelectorAll('.carousel-item')];
  const titleEl = host.querySelector('.carousel-title');
  const metaEl = host.querySelector('.carousel-meta');
  const synEl = host.querySelector('.carousel-syn');
  const countEl = host.querySelector('.carousel-count');
  const trailerBox = host.querySelector('.carousel-trailer');
  const alive = () => host.isConnected;

  // ---------------------------------------------------------------- imágenes de cada elemento
  const placeholder = (t) => `<span class="carousel-fallback">${esc(displayName(t))}</span>`;

  function fillImage(el, t, url) {
    const img = document.createElement('img');
    img.className = logos ? 'carousel-logo' : 'carousel-poster';
    img.alt = displayName(t);
    img.decoding = 'async';
    img.onerror = () => { img.remove(); el.innerHTML = placeholder(t); };
    el.innerHTML = '';
    el.append(img);
    if (logos) { img.src = url; return; }
    img.src = memoryCache.get(url) || url;
    loadPoster(img, url);
  }

  function loadItem(i) {
    const el = els[i];
    if (!el || el.dataset.loaded) return;
    el.dataset.loaded = '1';
    const t = items[i];
    if (!logos) {
      const url = t.metadata?.poster;
      el.innerHTML = url ? '' : placeholder(t);
      if (url) fillImage(el, t, url);
      return;
    }
    el.innerHTML = placeholder(t);
    const own = t.metadata?.logo;
    if (own) { fillImage(el, t, own); return; }
    getAutoLogo(t).then((url) => { if (url && alive()) fillImage(el, t, url); }).catch(() => {});
  }

  function loadWindow() {
    for (let d = -LOAD_WINDOW; d <= LOAD_WINDOW; d++) loadItem(cur + d);
  }

  // ---------------------------------------------------------------- tráiler (modo logos)
  function clearTrailer() {
    clearTimeout(trailerTimer);
    clearTimeout(logoAdvanceTimeout);
    trailerToken++;
    logoTrailerTrailers = [];
    logoTrailerIdx = 0;
    if (trailerBox) trailerBox.innerHTML = '';
  }

  function renderLogoTrailer(trailers, idx) {
    if (!trailerBox || !alive()) return;
    idx = (idx + trailers.length) % trailers.length;
    logoTrailerIdx = idx;

    const allKeys = trailers.map(x => x.key);
    // Orden de la playlist empezando por el actual y dando la vuelta
    const playlistKeys = allKeys.slice(idx).concat(allKeys.slice(0, idx));
    const curKey = playlistKeys[0];
    const src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(curKey)}`
      + `?autoplay=1&mute=1&controls=0&rel=0&modestbranding=1&playsinline=1&iv_load_policy=3&disablekb=1`
      + `&loop=1&playlist=${encodeURIComponent(playlistKeys.join(','))}&enablejsapi=1`;

    const isMulti = trailers.length > 1;
    const filmName = trailers[idx].name || '';
    trailerBox.innerHTML = `
      <div class="carousel-trailer-wrap">
        ${isMulti ? `<div class="carousel-trailer-tag" title="${esc(filmName)}">Tráiler ${idx + 1}/${trailers.length} · ${esc(filmName)}</div>` : ''}
        <iframe src="${src}" title="Tráiler" tabindex="-1" allow="autoplay; encrypted-media; picture-in-picture" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>
      </div>
    `;
  }

  function showTrailer(t) {
    if (!trailerBox) return;
    clearTrailer();
    const token = ++trailerToken;
    trailerBox.innerHTML = '<div class="carousel-trailer-msg">Cargando tráiler…</div>';
    trailerTimer = setTimeout(async () => {
      if (!alive() || token !== trailerToken) return;
      let trailers = [];
      try {
        trailers = await getTitleTrailers(t, allTitles);
      } catch (_) {
        trailers = [];
      }
      if (!alive() || token !== trailerToken) return;
      if (!trailers.length) {
        trailerBox.innerHTML = '<div class="carousel-trailer-msg">Sin tráiler disponible</div>';
        return;
      }
      logoTrailerTrailers = trailers;
      logoTrailerIdx = 0;
      renderLogoTrailer(trailers, 0);
    }, TRAILER_DELAY_MS);
  }

  function onWindowMessage(e) {
    if (!alive() || !logoTrailerTrailers.length || logoTrailerTrailers.length <= 1) return;
    try {
      const data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
      if (data?.event === 'onStateChange' && data.info === 0) { // 0 = YT.PlayerState.ENDED
        clearTimeout(logoAdvanceTimeout);
        logoAdvanceTimeout = setTimeout(() => {
          if (!alive() || !logoTrailerTrailers.length) return;
          logoTrailerIdx = (logoTrailerIdx + 1) % logoTrailerTrailers.length;
          renderLogoTrailer(logoTrailerTrailers, logoTrailerIdx);
        }, 350);
      }
    } catch (_) {}
  }
  window.addEventListener('message', onWindowMessage);

  // ---------------------------------------------------------------- posición y datos
  const view = host.querySelector('.carousel-view');
  // Altura disponible en px: todos los tamaños del carrusel se calculan a partir de ella (se ajusta a la pantalla)
  const fit = () => view.style.setProperty('--car-h', `${host.clientHeight}px`);

  function center(smooth = true) {
    fit();
    const el = els[cur];
    if (!el) return;
    const x = el.offsetLeft + el.offsetWidth / 2 - stage.clientWidth / 2;
    track.style.transition = smooth ? '' : 'none';
    track.style.transform = `translateX(${-x}px)`;
    if (!smooth) { void track.offsetWidth; track.style.transition = ''; }
  }

  function setActive(i, { smooth = true } = {}) {
    cur = Math.max(0, Math.min(items.length - 1, i));
    els.forEach((el, k) => {
      const on = k === cur;
      el.classList.toggle('is-active', on);
      el.setAttribute('aria-selected', String(on));
    });
    const t = items[cur];
    loadWindow();
    center(smooth);
    titleEl.textContent = displayName(t);
    metaEl.textContent = metaLine(t);
    synEl.textContent = synopsisOf(t) || 'Sin sinopsis disponible.';
    countEl.textContent = `${cur + 1} / ${items.length}`;
    if (logos) {
      showTrailer(t);
    } else if (trailerBtn) {
      const textEl = trailerBtn.querySelector('.carousel-trailer-text');
      if (textEl) textEl.textContent = 'Tráiler';
      trailerBtn.disabled = false;
    }
  }

  const step = (d) => { if (cur + d >= 0 && cur + d < items.length) setActive(cur + d); };

  // ---------------------------------------------------------------- entrada: mando, teclado, ratón, táctil
  stage.addEventListener('keydown', (e) => {
    const stop = () => { e.preventDefault(); e.stopPropagation(); };
    switch (e.key) {
      case 'ArrowLeft': stop(); step(-1); break;
      case 'ArrowRight': stop(); step(1); break;
      case 'PageUp': stop(); step(-5); break;
      case 'PageDown': stop(); step(5); break;
      case 'Home': stop(); setActive(0); break;
      case 'End': stop(); setActive(items.length - 1); break;
      case 'ArrowDown': {
        const trailerBtn = host.querySelector('.carousel-trailer-btn');
        if (trailerBtn && trailerBtn.offsetParent) {
          stop();
          trailerBtn.focus();
          trailerBtn.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          break;
        }
        stop();
        break;
      }
      case 'ArrowUp': {
        stop();
        const up = document.querySelector('.category-sort-bar [data-focusable].active')
          || document.querySelector('.category-sort-bar [data-focusable]')
          || document.querySelector('.home-nav-item.active');
        up?.focus({ preventScroll: true });
        break;
      }
      default: break; // Enter lo convierte dpad.js en un clic sobre el elemento enfocado
    }
  });

  stage.addEventListener('click', (e) => {
    const nav = e.target.closest('.carousel-nav');
    if (nav) { step(nav.classList.contains('prev') ? -1 : 1); return; }
    const itemEl = e.target.closest('.carousel-item');
    if (itemEl) {
      const i = Number(itemEl.dataset.i);
      if (i !== cur) { setActive(i); return; }
    }
    onOpen?.(items[cur]);
  });

  let wheelLock = 0;
  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    const now = Date.now();
    if (now - wheelLock < 140) return;
    wheelLock = now;
    step((Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) > 0 ? 1 : -1);
  }, { passive: false });

  let touchX = null;
  stage.addEventListener('touchstart', (e) => { touchX = e.touches[0]?.clientX ?? null; }, { passive: true });
  stage.addEventListener('touchend', (e) => {
    if (touchX == null) return;
    const dx = (e.changedTouches[0]?.clientX ?? touchX) - touchX;
    touchX = null;
    if (Math.abs(dx) > 40) step(dx < 0 ? 1 : -1);
  }, { passive: true });

  const onResize = () => { if (!alive()) { destroy(); return; } center(false); };
  window.addEventListener('resize', onResize);

  function destroy() {
    clearTrailer();
    window.removeEventListener('message', onWindowMessage);
    document.querySelector('.carousel-trailer-modal')?.remove();
    window.removeEventListener('resize', onResize);
    if (active === api) active = null;
  }

  const trailerBtn = host.querySelector('.carousel-trailer-btn');
  if (trailerBtn) {
    trailerBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const t = items[cur];
      if (!t) return;

      const textEl = trailerBtn.querySelector('.carousel-trailer-text');
      const prevText = textEl?.textContent || 'Tráiler';
      if (textEl) textEl.textContent = 'Buscando…';
      trailerBtn.disabled = true;

      try {
        const trailers = await getTitleTrailers(t, allTitles);
        if (!trailers.length) {
          if (textEl) textEl.textContent = 'Sin tráiler';
          setTimeout(() => {
            if (textEl) textEl.textContent = prevText;
            trailerBtn.disabled = false;
          }, 2000);
          return;
        }

        if (textEl) textEl.textContent = prevText;
        trailerBtn.disabled = false;
        openFullscreenTrailer(trailers, displayName(t), 0);
      } catch (_) {
        if (textEl) textEl.textContent = 'Error';
        setTimeout(() => {
          if (textEl) textEl.textContent = prevText;
          trailerBtn.disabled = false;
        }, 2000);
      }
    });

    trailerBtn.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        stage.focus({ preventScroll: true });
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        e.stopPropagation();
        step(-1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        e.stopPropagation();
        step(1);
      }
    });
  }

  const api = { destroy, focus: () => stage.focus({ preventScroll: true }), setActive };
  active = api;
  // Primer pintado sin animación, ya con el diseño calculado
  requestAnimationFrame(() => { if (alive()) setActive(cur, { smooth: false }); });
  setActive(cur, { smooth: false });
  return api;
}
