// src/ui/imagePickerModal.js
// Engranaje ⚙ de la ficha: elegir cartel / fondo / logo entre las imágenes de TMDB o Fanart.tv,
// y (en películas) añadir la película a una colección existente.
//
// Pensado para mando (D-pad) en la APK: nada de <select> nativos (no se abren con el mando);
// el proveedor se cambia con dos botones y la rejilla se recorre con navegación espacial.
import { modal } from './settings.js';
import { attachSpatialNav } from './spatialNav.js';
import { fetchTmdbImages } from '../metadata/tmdb.js';
import { fetchFanartImages } from '../metadata/fanart.js';
import { IMAGE_KINDS, getImagePrefs, setImagePref } from '../metadata/imagePrefs.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const PROVIDERS = { tmdb: 'TMDB', fanart: 'Fanart.tv' };
const PROVIDER_KEY = 'tgvideo_image_provider';

const loadProvider = () => {
  try { const v = localStorage.getItem(PROVIDER_KEY); return PROVIDERS[v] ? v : 'tmdb'; } catch (_) { return 'tmdb'; }
};
const saveProvider = (v) => { try { localStorage.setItem(PROVIDER_KEY, v); } catch (_) {} };

/**
 * @param {object} title
 * @param {object} profile
 * @param {{ sync?: object, onChanged?: (kind: string, url: string) => void, onAddToCollection?: () => void }} [opts]
 */
export function showImagePicker(title, profile, { sync, onChanged, onAddToCollection } = {}) {
  const tmdbId = title.metadata?.id || title.tmdbId;
  const type = title.isSaga || title.metadata?.type === 'collection' ? 'collection' : title.tipo === 'serie' ? 'tv' : 'movie';
  const { overlay, close } = modal('Imágenes de la ficha', '<div class="imgpick" id="imgpick"></div>', esc(title.metadata?.name || title.nombre || ''));
  const root = overlay.querySelector('#imgpick');
  attachSpatialNav(root);

  const cache = { tmdb: null, fanart: null };
  let provider = loadProvider();

  const focusFirst = () => root.querySelector('[data-focusable]')?.focus({ preventScroll: true });

  const renderMenu = () => {
    const kinds = Object.entries(IMAGE_KINDS).map(([kind, label]) =>
      `<button class="btn imgpick-opt" data-focusable data-kind="${kind}">Cambiar ${label.toLowerCase()}</button>`).join('');
    const addCol = onAddToCollection
      ? '<button class="btn btn-secondary imgpick-opt btn-addcol" data-focusable id="imgpick-addcol">Añadir a colección…</button>'
      : '';
    root.innerHTML = kinds + addCol;
    root.querySelectorAll('[data-kind]').forEach((b) => { b.onclick = () => renderGrid(b.dataset.kind); });
    const addBtn = root.querySelector('#imgpick-addcol');
    // Se cierra este diálogo antes de abrir el siguiente (el mando solo navega dentro del primer diálogo abierto)
    if (addBtn) addBtn.onclick = () => { close(); onAddToCollection(); };
    focusFirst();
  };

  const loadImages = async (prov) => {
    if (cache[prov]) return cache[prov];
    const data = prov === 'tmdb'
      ? await fetchTmdbImages(type, tmdbId)
      : await fetchFanartImages(type, tmdbId, { externalIds: title.metadata?.external_ids || null });
    cache[prov] = data;
    return data;
  };

  // Fila "URL manual": siempre la primera de la pantalla (también en títulos sin identificar)
  const urlRowHtml = () => `
    <form class="imgpick-url" id="imgpick-url-form" autocomplete="off">
      <input type="url" id="imgpick-url" data-focusable inputmode="url" placeholder="URL manual de la imagen (https://…)">
      <button class="btn btn-sm" type="submit" data-focusable>Usar URL</button>
    </form>
    <p class="imgpick-urlmsg" id="imgpick-urlmsg" role="status"></p>`;

  const bindUrlRow = (kind) => {
    const form = root.querySelector('#imgpick-url-form');
    const input = root.querySelector('#imgpick-url');
    const msg = root.querySelector('#imgpick-urlmsg');
    form.onsubmit = (e) => {
      e.preventDefault();
      const raw = input.value.trim();
      let url = '';
      try { const u = new URL(raw); if (/^https?:$/.test(u.protocol)) url = u.href; } catch (_) {}
      if (!url) { msg.textContent = 'Introduce una URL válida que empiece por http:// o https://'; return; }
      msg.textContent = 'Comprobando la imagen…';
      const probe = new Image();
      probe.onload = () => {
        setImagePref(profile, title, kind, url, sync);
        onChanged?.(kind, url);
        msg.textContent = 'Imagen aplicada.';
        root.querySelectorAll('.imgpick-item.is-current').forEach((x) => x.classList.remove('is-current'));
      };
      probe.onerror = () => { msg.textContent = 'No se pudo cargar esa imagen. Revisa la URL.'; };
      probe.src = url;
    };
  };

  const providerBtns = () => Object.entries(PROVIDERS).map(([id, label]) =>
    `<button class="btn-ghost imgpick-provider-btn ${provider === id ? 'is-active' : ''}" data-focusable data-provider="${id}" aria-pressed="${provider === id}">${label}</button>`).join('');

  const renderGrid = async (kind) => {
    if (!tmdbId) {
      root.innerHTML = `
        <div class="imgpick-bar"><button class="btn-ghost" data-focusable id="imgpick-back">← Volver</button><strong>${IMAGE_KINDS[kind]}</strong></div>
        ${urlRowHtml()}
        <p class="imgpick-msg">Este título aún no está identificado en TMDB: solo puedes usar una URL manual.</p>`;
      root.querySelector('#imgpick-back').onclick = renderMenu;
      bindUrlRow(kind);
      root.querySelector('#imgpick-url')?.focus({ preventScroll: true });
      return;
    }

    root.innerHTML = `
      <div class="imgpick-bar">
        <button class="btn-ghost" data-focusable id="imgpick-back">← Volver</button>
        <strong>${IMAGE_KINDS[kind]}</strong>
        <button class="btn-ghost" data-focusable id="imgpick-reset">Restaurar original</button>
      </div>
      ${urlRowHtml()}
      <div class="imgpick-providers" role="group" aria-label="Proveedor de imágenes">
        <span class="imgpick-provider-label">Proveedor:</span>${providerBtns()}
      </div>
      <p class="imgpick-msg">Cargando imágenes de ${PROVIDERS[provider]}…</p>
      <div class="imgpick-grid imgpick-${kind}" id="imgpick-results"></div>`;

    root.querySelector('#imgpick-back').onclick = renderMenu;
    bindUrlRow(kind);
    root.querySelector('#imgpick-reset').onclick = () => {
      setImagePref(profile, title, kind, '', sync);
      onChanged?.(kind, '');
      renderMenu();
    };
    root.querySelectorAll('[data-provider]').forEach((b) => {
      b.onclick = () => {
        if (b.dataset.provider === provider) return;
        provider = b.dataset.provider;
        saveProvider(provider);
        renderGrid(kind).then(() => {
          root.querySelector(`[data-provider="${provider}"]`)?.focus({ preventScroll: true });
        });
      };
    });

    const msgEl = root.querySelector('.imgpick-msg');
    const gridEl = root.querySelector('#imgpick-results');
    const activeProviderBtn = root.querySelector(`[data-provider="${provider}"]`);

    let data;
    try {
      data = await loadImages(provider);
    } catch (e) {
      msgEl.textContent = e.message || `No se pudieron cargar imágenes de ${PROVIDERS[provider]}.`;
      activeProviderBtn?.focus({ preventScroll: true });
      return;
    }

    const list = data?.[kind] || [];
    const current = getImagePrefs(profile, title)[kind] || title.metadata?.[kind] || '';

    if (!list.length) {
      msgEl.textContent = `${PROVIDERS[provider]} no tiene imágenes de este tipo.`;
      activeProviderBtn?.focus({ preventScroll: true });
      return;
    }
    msgEl.textContent = '';
    msgEl.style.display = 'none';

    gridEl.innerHTML = list.map((im, i) => {
      const tip = im.lang ? `${im.lang}${im.likes ? ` · ${im.likes} likes` : ''}` : (im.likes ? `${im.likes} likes` : 'sin idioma');
      return `<button class="imgpick-item ${im.url === current ? 'is-current' : ''}" data-focusable data-i="${i}" title="${esc(tip)}">
        <img src="${esc(im.thumb)}" alt="" loading="lazy">
      </button>`;
    }).join('');

    gridEl.querySelectorAll('.imgpick-item').forEach((b) => {
      b.onclick = () => {
        const im = list[Number(b.dataset.i)];
        if (!im?.url) return;
        setImagePref(profile, title, kind, im.url, sync);   // se guarda con alias TMDB y se sincroniza
        onChanged?.(kind, im.url);
        gridEl.querySelectorAll('.imgpick-item').forEach((x) => x.classList.toggle('is-current', x === b));
      };
    });

    (gridEl.querySelector('.imgpick-item.is-current') || gridEl.querySelector('.imgpick-item'))?.focus({ preventScroll: true });
  };

  renderMenu();
}
