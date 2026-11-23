// src/ui/carouselView.js
// Vista en carrusel tipo Apple TV / Android TV para las pestañas de categorías.
// Permite modo "posters" (pósteres verticales 2:3) y modo "logos" (logos horizontales sobre fondo neutro).
// Soporta tráilers en ventana (modo logos) y a pantalla completa (modo posters), navegación D-Pad y táctil.

import { memoryCache, loadPoster } from '../metadata/posterCache.js';
import { getAutoLogo } from '../metadata/autoLogo.js';
import { fetchTmdbTrailer, fetchCollectionMovieTrailers, fetchImdbRating, fetchExternalIds } from '../metadata/tmdb.js';
import { renderAgeBadgeHtml } from './ageRating.js';

let active = null;
const LOAD_WINDOW = 10;
const TRAILER_DELAY_MS = 900;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const displayName = (t) => t.metadata?.name || t.nombre || t.title || 'Sin título';

const metaHtml = (t) => {
  const year = t.metadata?.date ? String(t.metadata.date).slice(0, 4) : (t.yearHint || '');
  const numRating = Number(t.metadata?.imdbRating ?? t.metadata?.rating);
  const ratingStr = Number.isFinite(numRating) && numRating > 0 ? `★ ${numRating.toFixed(1)}` : '';
  const ageBadge = renderAgeBadgeHtml(t);
  const ratingWithAge = [ratingStr, ageBadge].filter(Boolean).join(' ');
  const genres = Array.isArray(t.metadata?.genres) ? t.metadata.genres.slice(0, 3).join(' · ') : '';
  return [year, ratingWithAge, genres].filter(Boolean).join('   •   ');
};

const synopsisOf = (t) => t.metadata?.overview || t.overview || '';

function posterColor(seed) {
  let h = 0;
  for (let i = 0; i < (seed || '').length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360}deg 35% 18%)`;
}

const titleType = (t) => (t.tipo === 'serie' || t.isSerie || t.isSeason || t.isEpisode ? 'tv' : 'movie');
const isCollectionTitle = (t) => Boolean(t.isSaga || t.isVirtualSaga || t.tipo === 'saga' || t.tipo === 'coleccion');

export async function getTitleTrailers(t, allTitles = [], signal) {
  if (!t) return [];

  // Si ya tenemos trailers resueltos en memoria para este título
  if (Array.isArray(t._collectionTrailers) && t._collectionTrailers.length > 0) {
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

  if (trailers && trailers.length > 0) {
    t._collectionTrailers = trailers;
  }
  return trailers;
}

export function openFullscreenTrailer(trailers, titleName = '', initialIndex = 0) {
  if (!trailers || !trailers.length) return;

  const existing = document.querySelector('.carousel-trailer-modal');
  if (existing) existing.remove();

  let activeIndex = Math.max(0, Math.min(trailers.length - 1, initialIndex));
  const isMulti = trailers.length > 1;

  const modal = document.createElement('div');
  modal.className = 'carousel-trailer-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', `Tráiler de ${titleName}`);

  modal.innerHTML = `
    <div class="carousel-trailer-backdrop"></div>
    <div class="carousel-trailer-player-box">
      <div class="carousel-trailer-header">
        <div class="carousel-trailer-title-wrap">
          <span class="carousel-trailer-badge">TRÁILER</span>
          <span class="carousel-trailer-main-title">${esc(titleName)}</span>
          ${isMulti ? `<span class="carousel-trailer-part-title" id="trailer-part-label"></span>` : ''}
        </div>
        <button type="button" class="carousel-trailer-close-btn" data-focusable aria-label="Cerrar tráiler">✕</button>
      </div>
      <div class="carousel-trailer-frame-container" id="trailer-frame-host"></div>
      ${isMulti ? `
      <div class="carousel-trailer-controls">
        <button type="button" class="carousel-trailer-nav-btn prev" data-focusable aria-label="Tráiler anterior">‹ Anterior</button>
        <span class="carousel-trailer-counter" id="trailer-counter-label">${activeIndex + 1} / ${trailers.length}</span>
        <button type="button" class="carousel-trailer-nav-btn next" data-focusable aria-label="Siguiente tráiler">Siguiente ›</button>
      </div>` : ''}
    </div>
  `;

  document.body.appendChild(modal);

  const frameHost = modal.querySelector('#trailer-frame-host');
  const partLabel = modal.querySelector('#trailer-part-label');
  const counterLabel = modal.querySelector('#trailer-counter-label');
  const closeBtn = modal.querySelector('.carousel-trailer-close-btn');
  const prevBtn = modal.querySelector('.carousel-trailer-nav-btn.prev');
  const nextBtn = modal.querySelector('.carousel-trailer-nav-btn.next');

  let advanceTimer = null;

  function renderVideo(idx) {
    clearTimeout(advanceTimer);
    activeIndex = (idx + trailers.length) % trailers.length;
    const cur = trailers[activeIndex];

    if (partLabel) {
      partLabel.textContent = cur.name ? `— ${cur.name}` : '';
    }
    if (counterLabel) {
      counterLabel.textContent = `${activeIndex + 1} / ${trailers.length}`;
    }

    const allKeys = trailers.map(x => x.key);
    const playlistKeys = allKeys.slice(activeIndex).concat(allKeys.slice(0, activeIndex));
    const origin = typeof window !== 'undefined' && window.location?.origin ? window.location.origin : 'https://localhost';
    const src = `https://www.youtube.com/embed/${encodeURIComponent(cur.key)}`
      + `?autoplay=1&controls=1&rel=0&modestbranding=1&playsinline=1&enablejsapi=1`
      + `&origin=${encodeURIComponent(origin)}`
      + `&widget_referrer=${encodeURIComponent(origin)}`
      + `&loop=${isMulti ? '0' : '1'}&playlist=${encodeURIComponent(playlistKeys.join(','))}`;

    frameHost.innerHTML = `
      <iframe
        src="${src}"
        title="${esc(cur.name || titleName)}"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen"
        allowfullscreen>
      </iframe>
    `;

    if (frameHost && frameHost.clientWidth > 0 && frameHost.clientHeight === 0) {
      frameHost.style.height = `${Math.round(frameHost.clientWidth * 9 / 16)}px`;
    }
  }

  const close = () => {
    clearTimeout(advanceTimer);
    window.removeEventListener('message', onMessage);
    window.removeEventListener('keydown', onKeyDown, true);
    modal.remove();
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape' || e.key === 'Backspace') {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (isMulti && (e.key === 'ArrowLeft' || e.key === 'PageUp')) {
      e.preventDefault();
      e.stopPropagation();
      renderVideo(activeIndex - 1);
    } else if (isMulti && (e.key === 'ArrowRight' || e.key === 'PageDown')) {
      e.preventDefault();
      e.stopPropagation();
      renderVideo(activeIndex + 1);
    }
  };
  window.addEventListener('keydown', onKeyDown, true);

  const onMessage = (e) => {
    if (!isMulti) return;
    try {
      const data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
      if (data?.event === 'onStateChange' && data.info === 0) { // 0 = YT.PlayerState.ENDED
        clearTimeout(advanceTimer);
        advanceTimer = setTimeout(() => {
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
            <span class="carousel-trailer-icon">🎬</span>
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
    if (i < 0 || i >= items.length) return;
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

  // Observer automático para cargar en 0 ms cualquier carátula que esté en pantalla o a menos de 350px
  let observer = null;
  if (typeof IntersectionObserver !== 'undefined') {
    observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const idx = Number(entry.target.dataset.i);
          if (!isNaN(idx)) loadItem(idx);
        }
      });
    }, { root: stage, rootMargin: '350px' });
    els.forEach((el) => observer.observe(el));
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
    const playlistKeys = allKeys.slice(idx).concat(allKeys.slice(0, idx));
    const curKey = playlistKeys[0];
    const origin = typeof window !== 'undefined' && window.location?.origin ? window.location.origin : 'https://localhost';
    const src = `https://www.youtube.com/embed/${encodeURIComponent(curKey)}`
      + `?autoplay=1&mute=1&controls=0&rel=0&modestbranding=1&playsinline=1&iv_load_policy=3&disablekb=1`
      + `&loop=1&playlist=${encodeURIComponent(playlistKeys.join(','))}&enablejsapi=1&origin=${encodeURIComponent(origin)}`;

    const isMulti = trailers.length > 1;
    const filmName = trailers[idx].name || '';
    trailerBox.innerHTML = `
      <div class="carousel-trailer-wrap">
        ${isMulti ? `<div class="carousel-trailer-tag" title="${esc(filmName)}">Tráiler ${idx + 1}/${trailers.length} · ${esc(filmName)}</div>` : ''}
        <iframe src="${src}" title="Tráiler" tabindex="-1" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen" allowfullscreen></iframe>
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
  // Altura disponible en px: ajustada una sola vez en el montaje y al redimensionar la ventana (evita bucles recursivos)
  const updateAvailableHeight = () => {
    if (!host || !view) return;
    const h = host.clientHeight || Math.round(window.innerHeight * 0.72);
    const clampedH = Math.max(340, Math.min(840, h));
    view.style.setProperty('--car-h', `${clampedH}px`);
  };
  updateAvailableHeight();

  const getItemMetrics = () => {
    const isLogos = logos;
    const stageH = stage.clientHeight || (isLogos ? 130 : 340);
    const itemH = isLogos ? 110 : Math.max(60, Math.round(stageH - 24));
    const itemW = isLogos ? 250 : Math.round(itemH * (2 / 3));
    const rem = (typeof window !== 'undefined' && parseFloat(getComputedStyle(document.documentElement).fontSize)) || 16;
    const gap = isLogos ? Math.round(1.4 * rem) : Math.round(0.45 * rem);
    return { itemW, itemH, gap };
  };

  function center(smooth = true) {
    if (!stage || !track || !els.length) return;
    const stageWidth = stage.clientWidth;
    if (!stageWidth) return;

    if (stage.scrollLeft !== 0) stage.scrollLeft = 0;
    if (stage.scrollTop !== 0) stage.scrollTop = 0;

    const activeEl = els[cur];
    let targetX = 0;
    if (activeEl && activeEl.offsetWidth > 0) {
      targetX = activeEl.offsetLeft + (activeEl.offsetWidth / 2) - (stageWidth / 2);
    } else {
      const { itemW, gap } = getItemMetrics();
      const rem = (typeof window !== 'undefined' && parseFloat(getComputedStyle(document.documentElement).fontSize)) || 16;
      const uiScale = (typeof window !== 'undefined' && parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-scale'))) || 1.32;
      const scaleFactor = uiScale * 1.3865;
      const activeMargin = logos ? 0 : Math.round(4.25 * rem * scaleFactor);
      targetX = cur * (itemW + gap) + activeMargin + itemW / 2 - stageWidth / 2;
    }

    track.style.transition = smooth ? 'transform 0.24s cubic-bezier(0.16, 1, 0.3, 1)' : 'none';
    track.style.transform = `translate3d(${-Math.round(targetX)}px, 0, 0)`;
    if (!smooth) {
      void track.offsetWidth;
      track.style.transition = '';
    }
  }

  // Prevenir que el scroll nativo desplace la pista del carrusel
  stage.addEventListener('scroll', () => {
    if (stage.scrollLeft !== 0) stage.scrollLeft = 0;
    if (stage.scrollTop !== 0) stage.scrollTop = 0;
  }, { passive: true });

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
    metaEl.innerHTML = metaHtml(t);
    synEl.textContent = synopsisOf(t) || 'Sin sinopsis disponible.';
    countEl.textContent = `${cur + 1} / ${items.length}`;

    if (t?.metadata && !t.metadata.hasImdbRating) {
      const tType = titleType(t);
      if (t.metadata.imdbId) {
        fetchImdbRating(t.metadata.imdbId, tType).then(r => {
          if (r && Number.isFinite(r) && r > 0 && cur === i && alive()) {
            t.metadata.rating = r;
            t.metadata.imdbRating = r;
            t.metadata.hasImdbRating = true;
            metaEl.innerHTML = metaHtml(t);
          }
        }).catch(() => {});
      } else if (t.metadata.id) {
        fetchExternalIds(tType, t.metadata.id).then(async ext => {
          if (ext?.imdb_id) {
            t.metadata.imdbId = ext.imdb_id;
            const r = await fetchImdbRating(ext.imdb_id, tType).catch(() => null);
            if (r && Number.isFinite(r) && r > 0 && cur === i && alive()) {
              t.metadata.rating = r;
              t.metadata.imdbRating = r;
              t.metadata.hasImdbRating = true;
              metaEl.innerHTML = metaHtml(t);
            }
          }
        }).catch(() => {});
      }
    }
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
  let keyLock = 0;
  const KEY_STEP_THROTTLE_MS = 140;

  stage.addEventListener('keydown', (e) => {
    const stop = () => { e.preventDefault(); e.stopPropagation(); };
    switch (e.key) {
      case 'ArrowLeft': {
        stop();
        const now = Date.now();
        if (now - keyLock < KEY_STEP_THROTTLE_MS) return;
        keyLock = now;
        step(-1);
        break;
      }
      case 'ArrowRight': {
        stop();
        const now = Date.now();
        if (now - keyLock < KEY_STEP_THROTTLE_MS) return;
        keyLock = now;
        step(1);
        break;
      }
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
        const up = document.querySelector('.category-sort-toggle')
          || document.querySelector('.category-views-bar [data-focusable]')
          || document.querySelector('.category-sort-bar [data-focusable]')
          || document.querySelector('#home-logo[data-focusable]')
          || document.querySelector('.home-nav-item.active');
        up?.focus({ preventScroll: true });
        break;
      }
      default: break;
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

  const onResize = () => { if (!alive()) { destroy(); return; } updateAvailableHeight(); center(false); };
  window.addEventListener('resize', onResize);

  function destroy() {
    observer?.disconnect();
    observer = null;
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