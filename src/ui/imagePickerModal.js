// src/ui/imagePickerModal.js
// Engranaje ⚙ de la ficha: elegir cartel / fondo / logo entre las imágenes de TMDB o Fanart.tv.
import { modal } from './settings.js';
import { fetchTmdbImages } from '../metadata/tmdb.js';
import { fetchFanartImages } from '../metadata/fanart.js';
import { IMAGE_KINDS, getImagePrefs, setImagePref } from '../metadata/imagePrefs.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function showImagePicker(title, profile, { sync, onChanged } = {}) {
  const tmdbId = title.metadata?.id || title.tmdbId;
  const type = title.isSaga ? 'collection' : title.tipo === 'serie' ? 'tv' : 'movie';
  const { overlay } = modal('Imágenes de la ficha', '<div class="imgpick" id="imgpick"></div>', esc(title.metadata?.name || title.nombre || ''));
  const root = overlay.querySelector('#imgpick');

  const providerCache = {
    tmdb: null,
    fanart: null,
  };
  let currentProvider = 'tmdb';

  const focusFirst = () => root.querySelector('[data-focusable]')?.focus({ preventScroll: true });

  const renderMenu = () => {
    root.innerHTML = Object.entries(IMAGE_KINDS).map(([kind, label]) =>
      `<button class="btn imgpick-opt" data-focusable data-kind="${kind}">Cambiar ${label.toLowerCase()}</button>`).join('');
    root.querySelectorAll('[data-kind]').forEach((b) => { b.onclick = () => renderGrid(b.dataset.kind); });
    focusFirst();
  };

  const loadProviderImages = async (provider, kind) => {
    if (providerCache[provider]) return providerCache[provider];
    if (provider === 'tmdb') {
      const data = await fetchTmdbImages(type, tmdbId);
      providerCache.tmdb = data;
      return data;
    } else if (provider === 'fanart') {
      const data = await fetchFanartImages(type, tmdbId, {
        externalIds: title.metadata?.external_ids || (title.metadata?.imdbId ? { imdb_id: title.metadata.imdbId } : null)
      });
      providerCache.fanart = data;
      return data;
    }
    return { poster: [], backdrop: [], logo: [] };
  };

  const renderGrid = async (kind) => {
    if (!tmdbId) {
      root.innerHTML = `
        <div class="imgpick-bar">
          <button class="btn-ghost" data-focusable id="imgpick-back">← Volver</button>
        </div>
        <p class="imgpick-msg">Este título aún no está identificado en TMDB.</p>`;
      root.querySelector('#imgpick-back').onclick = renderMenu;
      focusFirst();
      return;
    }

    root.innerHTML = `
      <div class="imgpick-bar">
        <button class="btn-ghost" data-focusable id="imgpick-back">← Volver</button>
        <strong>${IMAGE_KINDS[kind]}</strong>
        <label class="imgpick-provider-label">
          <span>Proveedor:</span>
          <select class="imgpick-select" id="imgpick-provider" data-focusable>
            <option value="tmdb" ${currentProvider === 'tmdb' ? 'selected' : ''}>TMDB</option>
            <option value="fanart" ${currentProvider === 'fanart' ? 'selected' : ''}>Fanart.tv</option>
          </select>
        </label>
        <button class="btn-ghost" data-focusable id="imgpick-reset">Restaurar original</button>
      </div>
      <p class="imgpick-msg">Cargando imágenes de ${currentProvider === 'fanart' ? 'Fanart.tv' : 'TMDB'}…</p>
      <div class="imgpick-grid imgpick-${kind}" id="imgpick-results"></div>
    `;

    root.querySelector('#imgpick-back').onclick = renderMenu;
    root.querySelector('#imgpick-reset').onclick = () => {
      setImagePref(profile, title.id, kind, '', sync);
      onChanged?.(kind, '');
      renderMenu();
    };

    const selectEl = root.querySelector('#imgpick-provider');
    selectEl.onchange = (e) => {
      currentProvider = e.target.value;
      renderGrid(kind);
    };

    const msgEl = root.querySelector('.imgpick-msg');
    const gridEl = root.querySelector('#imgpick-results');

    let imagesData = null;
    try {
      imagesData = await loadProviderImages(currentProvider, kind);
    } catch (e) {
      msgEl.textContent = e.message || `No se pudieron cargar imágenes de ${currentProvider === 'fanart' ? 'Fanart.tv' : 'TMDB'}.`;
      selectEl?.focus({ preventScroll: true });
      return;
    }

    const list = imagesData?.[kind] || [];
    const current = getImagePrefs(profile, title.id)[kind] || title.metadata?.[kind] || '';

    if (!list.length) {
      msgEl.textContent = `${currentProvider === 'fanart' ? 'Fanart.tv' : 'TMDB'} no tiene imágenes de este tipo.`;
    } else {
      msgEl.textContent = '';
      msgEl.style.display = 'none';
    }

    gridEl.innerHTML = list.map((im, i) =>
      `<button class="imgpick-item ${im.url === current ? 'is-current' : ''}" data-focusable data-i="${i}" title="${esc(im.lang ? (im.lang + (im.likes ? ' · ' + im.likes + ' likes' : '')) : (im.likes ? im.likes + ' likes' : 'sin idioma'))}">
        <img src="${esc(im.thumb)}" alt="" loading="lazy">
      </button>`
    ).join('');

    gridEl.querySelectorAll('.imgpick-item').forEach((b) => {
      b.onclick = () => {
        const im = list[Number(b.dataset.i)];
        if (!im?.url) return;
        setImagePref(profile, title.id, kind, im.url, sync);
        onChanged?.(kind, im.url);
        gridEl.querySelectorAll('.imgpick-item').forEach((x) => x.classList.toggle('is-current', x === b));
      };
    });

    (gridEl.querySelector('.imgpick-item.is-current') || gridEl.querySelector('.imgpick-item') || selectEl)?.focus({ preventScroll: true });
  };

  renderMenu();
}
