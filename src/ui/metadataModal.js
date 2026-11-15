import { modal } from './settings.js';
import { extractTitleAndYear, searchTmdbManual, setManualMetadata, clearManualMetadata, enrichTitle } from '../metadata/tmdb.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function showMetadataModal(title, onUpdated) {
  const currentMeta = title.metadata;
  const parsed = extractTitleAndYear(title.nombre);
  const initialQuery = parsed.title;
  const initialYear = title.yearHint || parsed.year || '';
  const currentType = title.isSaga ? 'collection' : title.tipo === 'serie' ? 'tv' : 'movie';

  const telegramFileName = title.archivos?.[0]?.fileName || title.nombre || '';
  const telegramChannel = title.channel?.title || title.channel?.name || title.grupo || '';

  const statusText = currentMeta
    ? `Identificación actual: <strong>${esc(currentMeta.name)}</strong> (${esc(currentMeta.date?.slice(0, 4) || 's/f')}) · TMDB ID: ${currentMeta.id}`
    : '<em>Sin identificar en TMDB actualmente.</em>';

  const modalTitle = `Archivo en Telegram: ${telegramFileName}`;
  const modalSubtitle = telegramChannel ? `Canal en Telegram: <strong>${esc(telegramChannel)}</strong>` : '';

  const { overlay, close } = modal(modalTitle, `
    <div class="meta-modal-body">
      <div class="meta-current-box">${statusText}</div>

      <form class="meta-search-form" id="meta-form">
        <div class="meta-search-fields">
          <label class="meta-field">
            <span>Término de búsqueda</span>
            <input name="query" value="${esc(initialQuery)}" required placeholder="Ej: Matrix, Breaking Bad…">
          </label>

          <label class="meta-field meta-field-sm">
            <span>Tipo</span>
            <select name="type">
              <option value="movie" ${currentType === 'movie' ? 'selected' : ''}>Película</option>
              <option value="tv" ${currentType === 'tv' ? 'selected' : ''}>Serie</option>
              <option value="collection" ${currentType === 'collection' ? 'selected' : ''}>Saga / Colección</option>
            </select>
          </label>

          <label class="meta-field meta-field-xs">
            <span>Año</span>
            <input name="year" type="number" min="1900" max="2099" value="${esc(initialYear)}" placeholder="Ej: 1999">
          </label>
        </div>

        <div class="meta-search-direct">
          <label class="meta-field">
            <span>O introduce ID directo de TMDB (opcional)</span>
            <input name="directId" placeholder="Ej: 603 o https://www.themoviedb.org/movie/603">
          </label>
          <button class="btn" type="submit" data-focusable>Buscar</button>
        </div>
      </form>

      <div class="meta-results-container">
        <p class="meta-status" role="status">Introduce un título o ID y pulsa Buscar para corregir la ficha.</p>
        <div class="meta-results-list" id="meta-results"></div>
      </div>

      <div class="meta-footer-actions">
        ${currentMeta ? `<button class="btn-ghost btn-sm" type="button" id="btn-reset-meta" data-focusable>Restablecer identificación automática</button>` : ''}
      </div>
    </div>
  `, modalSubtitle);

  const form = overlay.querySelector('#meta-form');
  const status = overlay.querySelector('.meta-status');
  const resultsContainer = overlay.querySelector('#meta-results');
  const resetBtn = overlay.querySelector('#btn-reset-meta');

  const executeSearch = async () => {
    const query = form.elements.query.value.trim();
    const type = form.elements.type.value;
    const year = form.elements.year.value.trim();
    const directId = form.elements.directId.value.trim();

    status.textContent = 'Buscando en TMDB…';
    resultsContainer.innerHTML = '';

    try {
      const results = await searchTmdbManual({ query, type, year, directId });
      if (!results || results.length === 0) {
        status.textContent = 'No se encontraron resultados en TMDB. Prueba cambiando el título o tipo.';
        return;
      }
      status.textContent = `Se encontraron ${results.length} resultado(s):`;
      resultsContainer.innerHTML = results.map(r => `
        <div class="meta-result-card" data-id="${r.id}">
          <div class="meta-result-poster">
            ${r.poster ? `<img src="${esc(r.poster)}" alt="" loading="lazy">` : `<div class="meta-poster-empty">🎬</div>`}
          </div>
          <div class="meta-result-info">
            <div class="meta-result-title">${esc(r.name)} <span class="meta-result-year">(${esc(r.date?.slice(0, 4) || 's/f')})</span></div>
            <div class="meta-result-id">TMDB #${r.id} ${r.rating ? `· ★ ${r.rating.toFixed(1)}` : ''}</div>
            <p class="meta-result-overview">${esc(r.overview ? r.overview.slice(0, 160) + '…' : 'Sin sinopsis disponible.')}</p>
            <button class="btn btn-sm btn-select-meta" data-focusable type="button">Seleccionar esta</button>
          </div>
        </div>
      `).join('');

      resultsContainer.querySelectorAll('.btn-select-meta').forEach((btn, idx) => {
        btn.onclick = async () => {
          const selected = results[idx];
          btn.disabled = true;
          status.textContent = `Aplicando "${selected.name}"…`;
          await setManualMetadata(title, selected);
          onUpdated?.(selected);
          close();
        };
      });
    } catch (err) {
      status.textContent = 'Error: ' + err.message;
    }
  };

  form.onsubmit = e => {
    e.preventDefault();
    executeSearch();
  };

  resetBtn?.addEventListener('click', async () => {
    if (!confirm('¿Restablecer identificación a automática?')) return;
    await clearManualMetadata(title);
    await enrichTitle(title);
    onUpdated?.(title.metadata);
    close();
  });

  executeSearch();
}
