// src/ui/moveEpisodeModal.js
// Modal interactivo para mover un episodio de una serie a otra serie (existente o nueva).
import { modal } from './settings.js';
import { attachSpatialNav } from './spatialNav.js';
import { saveEpisodeSeriesMove } from './externalTitlesCache.js';

/**
 * Muestra el diálogo modal para mover un episodio individual a otra serie.
 */
export function showMoveEpisodeModal({
  file,
  currentTitle,
  allTitles = [],
  esc = (s) => String(s || ''),
  onMoved,
}) {
  if (!file || !currentTitle) return;

  const currentFileName = file.captionFileName || file.fileName || file.label || 'Episodio';
  const curSeason = Number.isInteger(file.season) ? file.season : (Number(file.season) || 1);
  const curEpisode = Number.isInteger(file.episode) ? file.episode : (Number(file.episode) || 1);

  // Filtrar otras series disponibles en la biblioteca
  const availableSeries = (allTitles || [])
    .filter(t => t.tipo === 'serie' && String(t.id) !== String(currentTitle.id))
    .sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', undefined, { sensitivity: 'base' }));

  const bodyHtml = `
    <div class="move-ep-container" style="display:flex;flex-direction:column;gap:1rem;color:#f0f0f0;">
      <div style="background:rgba(255,255,255,0.05);padding:0.75rem 1rem;border-radius:8px;font-size:0.9rem;">
        <div style="color:#aaa;font-size:0.8rem;margin-bottom:0.25rem;">Archivo seleccionado:</div>
        <div style="word-break:break-all;font-weight:600;">${esc(currentFileName)}</div>
        <div style="margin-top:0.35rem;font-size:0.85rem;color:#64b5f6;">
          Serie actual: <strong>${esc(currentTitle.nombre)}</strong> (T${curSeason}:E${curEpisode})
        </div>
      </div>

      <div>
        <label for="move-ep-search" style="display:block;font-size:0.85rem;font-weight:bold;margin-bottom:0.35rem;">
          1. Seleccionar serie de destino:
        </label>
        <input type="text" id="move-ep-search" class="input-text" data-focusable
               placeholder="Escribe para filtrar series existentes..."
               style="width:100%;box-sizing:border-box;padding:0.6rem;border-radius:6px;border:1px solid #444;background:#1a1a1a;color:#fff;margin-bottom:0.5rem;" />

        <div id="move-ep-list" style="max-height:160px;overflow-y:auto;border:1px solid #333;border-radius:6px;background:#111;padding:0.25rem;">
          ${availableSeries.length === 0 ? '<div style="padding:0.75rem;text-align:center;color:#888;font-size:0.85rem;">No hay otras series cargadas aún en la biblioteca</div>' : ''}
          ${availableSeries.map(s => `
            <div class="move-ep-option" data-focusable data-series-id="${esc(s.id)}" data-series-name="${esc(s.nombre)}"
                 style="padding:0.5rem 0.75rem;cursor:pointer;border-radius:4px;display:flex;justify-content:space-between;align-items:center;transition:background 0.15s;">
              <span style="font-weight:500;">${esc(s.nombre)}</span>
              <span style="font-size:0.75rem;color:#888;">${s.archivos?.length || 0} eps</span>
            </div>
          `).join('')}
        </div>
      </div>

      <div>
        <label for="move-ep-new-name" style="display:block;font-size:0.85rem;font-weight:bold;margin-bottom:0.35rem;">
          O crear / escribir nombre de nueva serie:
        </label>
        <input type="text" id="move-ep-new-name" class="input-text" data-focusable
               placeholder="Nombre exacto si no está en la lista..."
               style="width:100%;box-sizing:border-box;padding:0.6rem;border-radius:6px;border:1px solid #444;background:#1a1a1a;color:#fff;" />
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;">
        <div>
          <label for="move-ep-season" style="display:block;font-size:0.85rem;font-weight:bold;margin-bottom:0.35rem;">
            Temporada destino:
          </label>
          <input type="number" id="move-ep-season" class="input-text" data-focusable min="1" max="99" value="${curSeason}"
                 style="width:100%;box-sizing:border-box;padding:0.6rem;border-radius:6px;border:1px solid #444;background:#1a1a1a;color:#fff;" />
        </div>
        <div>
          <label for="move-ep-episode" style="display:block;font-size:0.85rem;font-weight:bold;margin-bottom:0.35rem;">
            Episodio destino:
          </label>
          <input type="number" id="move-ep-episode" class="input-text" data-focusable min="1" max="9999" value="${curEpisode}"
                 style="width:100%;box-sizing:border-box;padding:0.6rem;border-radius:6px;border:1px solid #444;background:#1a1a1a;color:#fff;" />
        </div>
      </div>

      <div id="move-ep-error" style="display:none;color:#ff5252;font-size:0.85rem;padding:0.5rem;background:rgba(255,82,82,0.1);border-radius:4px;"></div>

      <div style="display:flex;justify-content:flex-end;gap:0.75rem;margin-top:0.5rem;">
        <button type="button" class="btn-ghost" id="move-ep-cancel" data-focusable style="padding:0.6rem 1.25rem;">Cancelar</button>
        <button type="button" class="btn-primary" id="move-ep-submit" data-focusable style="padding:0.6rem 1.25rem;background:#2196f3;color:#fff;border:none;border-radius:6px;font-weight:bold;cursor:pointer;">Mover episodio</button>
      </div>
    </div>
  `;

  const { overlay, close } = modal('Mover episodio a otra serie', bodyHtml, 'Reasigna este archivo a su serie correspondiente');

  let selectedSeriesId = null;
  let selectedSeriesName = null;

  const searchInput = overlay.querySelector('#move-ep-search');
  const seriesList = overlay.querySelector('#move-ep-list');
  const newNameInput = overlay.querySelector('#move-ep-new-name');
  const seasonInput = overlay.querySelector('#move-ep-season');
  const episodeInput = overlay.querySelector('#move-ep-episode');
  const errorBox = overlay.querySelector('#move-ep-error');
  const submitBtn = overlay.querySelector('#move-ep-submit');
  const cancelBtn = overlay.querySelector('#move-ep-cancel');

  cancelBtn.onclick = close;

  function highlightSelectedOption() {
    seriesList.querySelectorAll('.move-ep-option').forEach(el => {
      const match = el.dataset.seriesId === selectedSeriesId;
      el.style.background = match ? 'rgba(33, 150, 243, 0.35)' : 'transparent';
      el.style.border = match ? '1px solid #2196f3' : '1px solid transparent';
    });
  }

  // Filtrado reactivo en el input de búsqueda
  searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim().toLowerCase();
    seriesList.querySelectorAll('.move-ep-option').forEach(el => {
      const name = (el.dataset.seriesName || '').toLowerCase();
      el.style.display = (!q || name.includes(q)) ? 'flex' : 'none';
    });
  });

  seriesList.querySelectorAll('.move-ep-option').forEach(opt => {
    opt.addEventListener('click', () => {
      selectedSeriesId = opt.dataset.seriesId;
      selectedSeriesName = opt.dataset.seriesName;
      newNameInput.value = '';
      highlightSelectedOption();
      errorBox.style.display = 'none';
    });
  });

  newNameInput.addEventListener('input', () => {
    if (newNameInput.value.trim()) {
      selectedSeriesId = null;
      selectedSeriesName = null;
      highlightSelectedOption();
      errorBox.style.display = 'none';
    }
  });

  submitBtn.onclick = async () => {
    const customName = newNameInput.value.trim();
    const finalSeriesName = customName || selectedSeriesName;
    const finalSeriesId = customName ? `custom_series_${Date.now()}` : selectedSeriesId;

    if (!finalSeriesName) {
      errorBox.textContent = 'Selecciona una serie de la lista o escribe el nombre de una nueva.';
      errorBox.style.display = 'block';
      return;
    }

    const newSeason = parseInt(seasonInput.value, 10);
    const newEpisode = parseInt(episodeInput.value, 10);
    if (!Number.isFinite(newSeason) || newSeason < 1) {
      errorBox.textContent = 'La temporada debe ser un número mayor o igual a 1.';
      errorBox.style.display = 'block';
      return;
    }
    if (!Number.isFinite(newEpisode) || newEpisode < 1) {
      errorBox.textContent = 'El episodio debe ser un número mayor o igual a 1.';
      errorBox.style.display = 'block';
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Moviendo...';

    try {
      let targetTitle = (allTitles || []).find(t => String(t.id) === String(finalSeriesId) || (t.tipo === 'serie' && t.nombre?.toLowerCase().trim() === finalSeriesName.toLowerCase()));

      await saveEpisodeSeriesMove({
        file,
        sourceTitle: currentTitle,
        targetTitle,
        targetSeriesId: targetTitle?.id || finalSeriesId,
        targetSeriesName: finalSeriesName,
        season: newSeason,
        episode: newEpisode,
      });

      if (onMoved) {
        await onMoved({
          file,
          sourceTitle: currentTitle,
          targetTitle,
          targetSeriesId: targetTitle?.id || finalSeriesId,
          targetSeriesName: finalSeriesName,
          newSeason,
          newEpisode,
        });
      }

      close();
    } catch (err) {
      console.error('[moveEpisodeModal] Error al mover episodio:', err);
      errorBox.textContent = 'Error al guardar el movimiento del episodio.';
      errorBox.style.display = 'block';
      submitBtn.disabled = false;
      submitBtn.textContent = 'Mover episodio';
    }
  };

  attachSpatialNav?.(overlay);
}
