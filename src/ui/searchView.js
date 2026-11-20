// src/ui/searchView.js
// Vista de búsqueda de la Home: filtra en memoria los títulos ya cargados.

let LAST_QUERY = '';

const norm = (s) => String(s ?? '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().trim();

const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function getSearchQuery() { return LAST_QUERY; }

function haystack(t) {
  const m = t.metadata || {};
  return norm([
    t.nombre, m.name, m.title, m.original_title, m.year, t.year,
    m.director, Array.isArray(m.cast) ? m.cast.join(' ') : m.cast, m.casting,
    t.grupo, t.categoria,
  ].filter(Boolean).join(' '));
}

export function filterTitles(titles, query) {
  const words = norm(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return titles.filter(t => {
    const h = haystack(t);
    return words.every(w => h.includes(w));
  });
}

export function searchViewHtml() {
  return `
    <section class="category-view search-view" aria-label="Buscar">
      <div class="category-header">
        <div class="category-sort-bar search-bar" role="search">
          <span class="search-bar-icon" aria-hidden="true">🔍</span>
          <input type="search" class="search-input" data-focusable id="search-input"
            placeholder="Buscar título, año, director o reparto…" autocomplete="off"
            enterkeyhint="search" value="${escHtml(LAST_QUERY)}" aria-label="Buscar en la biblioteca">
          <button type="button" class="search-clear" data-focusable id="search-clear" aria-label="Borrar búsqueda" ${LAST_QUERY ? '' : 'hidden'}>✕</button>
        </div>
      </div>
      <p class="search-status" id="search-status"></p>
      <div class="category-grid" id="search-results"></div>
    </section>`;
}

/**
 * Conecta la vista de búsqueda.
 * @param {object} o
 * @param {Array} o.titles
 * @param {(t:any)=>string} o.cardHtml
 * @param {(t:any)=>void} o.onOpen
 * @param {(root:Element)=>void} [o.afterRender] p.ej. cargar pósters
 */
export function mountSearchView({ titles, cardHtml, onOpen, afterRender }) {
  const input = document.getElementById('search-input');
  const clear = document.getElementById('search-clear');
  const status = document.getElementById('search-status');
  const grid = document.getElementById('search-results');
  if (!input || !grid) return;

  const render = () => {
    const q = input.value;
    LAST_QUERY = q;
    if (clear) clear.hidden = !q;
    if (!norm(q)) {
      grid.innerHTML = '';
      status.textContent = 'Escribe para buscar en tu biblioteca';
      return;
    }
    const found = filterTitles(titles, q);
    status.textContent = found.length
      ? `${found.length} resultado${found.length === 1 ? '' : 's'}`
      : `No se encontraron resultados para "${q}"`;
    grid.innerHTML = found.map(cardHtml).join('');
    grid.querySelectorAll('.lib-card[data-title]').forEach(card => {
      card.onclick = () => {
        const t = titles.find(x => String(x.id) === String(card.dataset.title));
        if (t) onOpen(t);
      };
    });
    afterRender?.(grid);
  };

  let timer = null;
  input.oninput = () => { clearTimeout(timer); timer = setTimeout(render, 150); };
  input.onkeydown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); clearTimeout(timer); render(); input.blur(); grid.querySelector('.lib-card[data-focusable]')?.focus(); }
  };
  if (clear) clear.onclick = () => { input.value = ''; render(); input.focus(); };
  render();
}
