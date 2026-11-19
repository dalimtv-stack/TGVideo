// src/ui/imagePickerModal.js
// Engranaje ⚙ de la ficha: elegir cartel / fondo / logo entre las imágenes de TMDB.
import { modal } from './settings.js';
import { fetchTmdbImages } from '../metadata/tmdb.js';
import { IMAGE_KINDS, getImagePrefs, setImagePref } from '../metadata/imagePrefs.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function showImagePicker(title, profile, { sync, onChanged } = {}) {
  const tmdbId = title.metadata?.id;
  const type = title.isSaga ? 'collection' : title.tipo === 'serie' ? 'tv' : 'movie';
  const { overlay } = modal('Imágenes de la ficha', '<div class="imgpick" id="imgpick"></div>', esc(title.metadata?.name || title.nombre || ''));
  const root = overlay.querySelector('#imgpick');
  let images = null;

  const focusFirst = () => root.querySelector('[data-focusable]')?.focus({ preventScroll: true });

  const renderMenu = () => {
    root.innerHTML = Object.entries(IMAGE_KINDS).map(([kind, label]) =>
      `<button class="btn imgpick-opt" data-focusable data-kind="${kind}">Cambiar ${label.toLowerCase()}</button>`).join('');
    root.querySelectorAll('[data-kind]').forEach((b) => { b.onclick = () => renderGrid(b.dataset.kind); });
    focusFirst();
  };

  const renderGrid = async (kind) => {
    root.innerHTML = `<button class="btn-ghost" data-focusable id="imgpick-back">← Volver</button><p class="imgpick-msg">Cargando imágenes…</p>`;
    root.querySelector('#imgpick-back').onclick = renderMenu;
    focusFirst();
    if (!tmdbId) { root.querySelector('.imgpick-msg').textContent = 'Este título aún no está identificado en TMDB.'; return; }
    try {
      images = images || await fetchTmdbImages(type, tmdbId);
    } catch (e) {
      root.querySelector('.imgpick-msg').textContent = e.message || 'No se pudieron cargar las imágenes.';
      return;
    }
    const list = images[kind] || [];
    const current = getImagePrefs(profile, title.id)[kind] || title.metadata?.[kind] || '';
    root.innerHTML = `
      <div class="imgpick-bar">
        <button class="btn-ghost" data-focusable id="imgpick-back">← Volver</button>
        <strong>${IMAGE_KINDS[kind]}</strong>
        <button class="btn-ghost" data-focusable id="imgpick-reset">Restaurar original</button>
      </div>
      ${list.length ? '' : '<p class="imgpick-msg">TMDB no tiene imágenes de este tipo.</p>'}
      <div class="imgpick-grid imgpick-${kind}">
        ${list.map((im, i) => `<button class="imgpick-item ${im.url === current ? 'is-current' : ''}" data-focusable data-i="${i}" title="${esc(im.lang || 'sin idioma')}"><img src="${esc(im.thumb)}" alt="" loading="lazy"></button>`).join('')}
      </div>`;
    root.querySelector('#imgpick-back').onclick = renderMenu;
    root.querySelector('#imgpick-reset').onclick = () => { setImagePref(profile, title.id, kind, '', sync); onChanged?.(kind, ''); renderMenu(); };
    root.querySelectorAll('.imgpick-item').forEach((b) => {
      b.onclick = () => {
        const im = list[Number(b.dataset.i)];
        setImagePref(profile, title.id, kind, im.url, sync);
        onChanged?.(kind, im.url);
        root.querySelectorAll('.imgpick-item').forEach((x) => x.classList.toggle('is-current', x === b));
      };
    });
    (root.querySelector('.imgpick-item.is-current') || root.querySelector('.imgpick-item'))?.focus({ preventScroll: true });
  };

  renderMenu();
}
