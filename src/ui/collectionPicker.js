// src/ui/collectionPicker.js
// Diálogo "Añadir a colección": elegir una colección ya existente en la biblioteca para la película.
// Navegable con mando: lista de botones con navegación espacial, sin <select>.
import { modal } from './settings.js';
import { attachSpatialNav } from './spatialNav.js';
import { listLibraryCollections, filterCollections, getMovieCollection } from '../metadata/collections.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * @param {object} title         película a añadir
 * @param {object[]} libraryTitles  títulos de la biblioteca (para listar colecciones)
 * @param {{ onAdd: (col) => Promise<void>, onRemove?: () => Promise<void> }} handlers
 */
export function showCollectionPicker(title, libraryTitles, { onAdd, onRemove } = {}) {
  const current = getMovieCollection(title);
  const all = listLibraryCollections(libraryTitles).filter((c) => String(c.id) !== String(current?.id));
  const name = title.metadata?.name || title.nombre || '';

  const { overlay, close } = modal('Añadir a colección', `
    <div class="colpick" id="colpick">
      <p class="colpick-current">${current
        ? `Ahora en: <strong>${esc(current.name)}</strong>${current.manual ? ' (manual)' : ''}`
        : 'Esta película no pertenece a ninguna colección.'}</p>
      ${current && onRemove ? '<button class="btn-ghost" data-focusable id="colpick-remove" type="button">Quitar de la colección</button>' : ''}
      <input class="colpick-filter" id="colpick-filter" data-focusable type="text" placeholder="Filtrar colecciones…" autocomplete="off">
      <p class="colpick-msg" id="colpick-msg" role="status"></p>
      <div class="colpick-list" id="colpick-list"></div>
    </div>`, esc(name));

  const root = overlay.querySelector('#colpick');
  const listEl = root.querySelector('#colpick-list');
  const msgEl = root.querySelector('#colpick-msg');
  const filterEl = root.querySelector('#colpick-filter');
  attachSpatialNav(root);

  let shown = all;
  const renderList = () => {
    shown = filterCollections(all, filterEl.value);
    if (!all.length) {
      msgEl.textContent = 'No hay colecciones en la biblioteca todavía (necesitas una saga identificada en TMDB).';
    } else if (!shown.length) {
      msgEl.textContent = 'Ninguna colección coincide con el filtro.';
    } else {
      msgEl.textContent = '';
    }
    listEl.innerHTML = shown.map((c, i) => `
      <button class="colpick-item" data-focusable data-i="${i}" type="button">
        ${c.poster ? `<img src="${esc(c.poster)}" alt="" loading="lazy">` : '<span class="colpick-noposter">🎬</span>'}
        <span class="colpick-name">${esc(c.name)}</span>
        <span class="colpick-count">${c.count} ${c.count === 1 ? 'película' : 'películas'}</span>
      </button>`).join('');
    listEl.querySelectorAll('.colpick-item').forEach((b) => {
      b.onclick = async () => {
        const col = shown[Number(b.dataset.i)];
        if (!col) return;
        listEl.querySelectorAll('button').forEach((x) => { x.disabled = true; });
        msgEl.textContent = `Añadiendo a «${col.name}»…`;
        try {
          await onAdd?.(col);
          msgEl.textContent = `Añadida a «${col.name}».`;
          setTimeout(close, 700);
        } catch (e) {
          msgEl.textContent = e?.message || 'No se pudo añadir a la colección.';
          listEl.querySelectorAll('button').forEach((x) => { x.disabled = false; });
        }
      };
    });
  };

  filterEl.addEventListener('input', renderList);
  root.querySelector('#colpick-remove')?.addEventListener('click', async () => {
    msgEl.textContent = 'Quitando de la colección…';
    try {
      await onRemove?.();
      msgEl.textContent = 'Película quitada de la colección.';
      setTimeout(close, 700);
    } catch (e) {
      msgEl.textContent = e?.message || 'No se pudo quitar de la colección.';
    }
  });

  renderList();
  // El primer elemento de la lista recibe el foco para que el mando pueda elegir directamente
  setTimeout(() => (listEl.querySelector('.colpick-item') || filterEl).focus({ preventScroll: true }), 30);
}
