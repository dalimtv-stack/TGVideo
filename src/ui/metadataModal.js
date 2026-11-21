// src/ui/metadataModal.js
import { Api } from 'telegram';
import { modal } from './settings.js';
import { extractTitleAndYear, searchTmdbManual, setManualMetadata, clearManualMetadata, enrichTitle, fetchTmdbFullDetails } from '../metadata/tmdb.js';
import { buildStandardCaption, parseCaption } from '../library/parse.js';
import { loadPoster } from '../metadata/posterCache.js';
import { fetchFanartBest, parseFanartMovieId, isFanartCollectionUrl } from '../metadata/fanart.js';
import { getImagePrefs, setImagePref, IMAGE_KINDS } from '../metadata/imagePrefs.js';
import { getFanartKey } from '../settings/global.js';
import { attachSpatialNav } from './spatialNav.js';

const TYPE_LABELS = { movie: 'Película', tv: 'Serie', collection: 'Saga / Colección' };

const segButtons = (name, options, current) => options.map(([value, label]) =>
  `<button type="button" class="btn-ghost meta-seg-btn ${value === current ? 'is-active' : ''}" data-focusable data-seg="${name}" data-value="${value}" aria-pressed="${value === current}">${label}</button>`).join('');

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function showMetadataModal(title, onUpdated, { client, peerOf, profile, sync } = {}) {
  const currentMeta = title.metadata;
  const parsed = extractTitleAndYear(title.nombre);
  const initialQuery = parsed.title;
  const initialYear = parsed.year || title.yearHint || '';
  const currentType = title.isSaga ? 'collection' : title.tipo === 'serie' ? 'tv' : 'movie';

  const telegramFileName = title.archivos?.[0]?.captionFileName || title.archivos?.[0]?.fileName || title.nombre || '';
  const telegramChannel = title.channel?.title || title.channel?.name || title.grupo || '';

  const hasFanart = !!getFanartKey();
  // TMDB es SIEMPRE el valor por defecto. Fanart.tv solo se usa si el usuario lo activa aquí, y solo
  // para esta identificación.
  const initialSource = 'tmdb';

  const statusText = currentMeta
    ? `Identificación actual: <strong>${esc(currentMeta.name)}</strong> (${esc(currentMeta.date?.slice(0, 4) || 's/f')}) · TMDB ID: ${currentMeta.id}`
    : '<em>Sin identificar en TMDB actualmente.</em>';

  const modalTitle = `Archivo en Telegram: ${telegramFileName}`;
  const modalSubtitle = telegramChannel ? `Canal en Telegram: <strong>${esc(telegramChannel)}</strong>` : '';

  const { overlay, close } = modal(modalTitle, `
    <div class="meta-modal-body">
      <div class="meta-col-left">
        <div class="meta-current-box">${statusText}</div>

        <form class="meta-search-form" id="meta-form">
          <div class="meta-search-fields">
            <label class="meta-field">
              <span>Término de búsqueda</span>
              <input name="query" data-focusable value="${esc(initialQuery)}" required placeholder="Ej: Matrix, Breaking Bad…">
            </label>

            <div class="meta-field meta-field-sm">
              <span>Tipo</span>
              <input type="hidden" name="type" value="${currentType}">
              <div class="meta-seg" role="group" aria-label="Tipo">${segButtons('type', Object.entries(TYPE_LABELS), currentType)}</div>
            </div>

            <label class="meta-field meta-field-xs">
              <span>Año</span>
              <input name="year" data-focusable type="number" min="1900" max="2099" value="${esc(initialYear)}" placeholder="Ej: 1999">
            </label>
          </div>

          <div class="meta-search-direct">
            <label class="meta-field">
              <span>O introduce ID directo de TMDB / enlace de TMDB o Fanart.tv (opcional)</span>
              <input name="directId" data-focusable placeholder="Ej: 603, themoviedb.org/movie/603 o fanart.tv/movie/603">
            </label>
            <button class="btn" type="submit" data-focusable>Buscar</button>
          </div>

          <div class="meta-field meta-imgsource">
            <span>Imágenes de la ficha tras identificar</span>
            <input type="hidden" name="imgsource" value="${initialSource}">
            <div class="meta-seg" role="group" aria-label="Origen de las imágenes">${segButtons('imgsource', [['tmdb', 'TMDB'], ['fanart', 'Fanart.tv']], initialSource)}</div>
            <small class="meta-hint">${hasFanart ? 'TMDB deja las imágenes como están. Fanart.tv aplica automáticamente las mejores que encuentre.' : 'Para usar Fanart.tv añade tu clave en Ajustes globales.'}</small>
          </div>
        </form>

        <div class="meta-footer-actions">
          ${currentMeta ? `<button class="btn-ghost btn-sm" type="button" id="btn-reset-meta" data-focusable>Restablecer identificación automática</button>` : ''}
        </div>
      </div>

      <div class="meta-col-right">
        <div class="meta-results-container">
          <p class="meta-status" role="status">Introduce un título o ID y pulsa Buscar para corregir la ficha.</p>
          <div class="meta-results-list" id="meta-results"></div>
        </div>
      </div>
    </div>
  `, modalSubtitle);

  const form = overlay.querySelector('#meta-form');
  attachSpatialNav(overlay.querySelector('.meta-modal-body'));

  // Botones segmentados (sustituyen a los <select>, que no se abren con el mando)
  overlay.querySelectorAll('.meta-seg-btn').forEach((btn) => {
    btn.onclick = () => {
      const name = btn.dataset.seg;
      form.elements[name].value = btn.dataset.value;
      overlay.querySelectorAll(`.meta-seg-btn[data-seg="${name}"]`).forEach((b) => {
        const on = b === btn;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-pressed', String(on));
      });
    };
  });
  const status = overlay.querySelector('.meta-status');
  const resultsContainer = overlay.querySelector('#meta-results');
  const resetBtn = overlay.querySelector('#btn-reset-meta');

  // Asegurar auto-scroll suave dentro del contenedor de resultados al navegar con D-Pad
  resultsContainer.addEventListener('focusin', (e) => {
    e.target.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });

  const setTypeUi = (value) => {
    form.elements.type.value = value;
    overlay.querySelectorAll('.meta-seg-btn[data-seg="type"]').forEach((b) => {
      const on = b.dataset.value === value;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', String(on));
    });
  };

  const executeSearch = async () => {
    const query = form.elements.query.value.trim();
    const type = form.elements.type.value;
    const year = form.elements.year.value.trim();
    const rawDirect = form.elements.directId.value.trim();
    const directId = parseFanartMovieId(rawDirect) || rawDirect;

    status.textContent = 'Buscando en TMDB…';
    resultsContainer.innerHTML = '';

    try {
      // Un enlace de Fanart.tv (fanart.tv/movie/1570/die-hard-collection) lleva el ID de TMDB de una
      // película o de una colección: se prueba el tipo indicado por el enlace/elegido y, si TMDB no
      // lo reconoce, el otro.
      const fromFanart = !!parseFanartMovieId(rawDirect);
      const firstType = fromFanart && isFanartCollectionUrl(rawDirect) ? 'collection' : type;
      const order = fromFanart ? [firstType, firstType === 'collection' ? 'movie' : 'collection'] : [type];
      let results = null;
      let lastErr = null;
      for (const tryType of order) {
        try {
          const found = await searchTmdbManual({ query, type: tryType, year, directId });
          if (found?.length) { results = found; if (tryType !== form.elements.type.value) setTypeUi(tryType); break; }
        } catch (e) { lastErr = e; }
      }
      if (!results && lastErr) throw lastErr;
      if (!results || results.length === 0) {
        status.textContent = 'No se encontraron resultados en TMDB. Prueba cambiando el título o tipo.';
        return;
      }
      status.textContent = `Se encontraron ${results.length} resultado(s):`;

      resultsContainer.innerHTML = results.map(r => {
        const numRating = Number(r.rating);
        const ratingBadge = Number.isFinite(numRating) && numRating > 0 ? `· ★ ${numRating.toFixed(1)}` : '';
        return `
        <div class="meta-result-card" data-id="${r.id}">
          <div class="meta-result-poster">
            ${r.poster ? `<img src="${esc(r.poster)}" alt="" loading="lazy">` : `<div class="meta-poster-empty">🎬</div>`}
          </div>
          <div class="meta-result-info">
            <div class="meta-result-title">${esc(r.name)} <span class="meta-result-year">(${esc(r.date?.slice(0, 4) || 's/f')})</span></div>
            <div class="meta-result-id">TMDB #${r.id} ${ratingBadge}</div>
            <p class="meta-result-overview">${esc(r.overview ? r.overview.slice(0, 160) + '…' : 'Sin sinopsis disponible.')}</p>
            <button class="btn btn-sm btn-select-meta" data-focusable type="button">Seleccionar esta</button>
          </div>
        </div>
      `;
      }).join('');


      resultsContainer.querySelectorAll('.btn-select-meta').forEach((btn, idx) => {
        btn.onclick = async () => {
          const selected = results[idx];
          btn.disabled = true;
          status.textContent = `Aplicando "${selected.name}"…`;

          // Precalentar póster en navegador
          if (selected.poster) {
            try {
              const img = new Image();
              img.src = selected.poster;
            } catch (_) {}
          }

          // Obtener los detalles completos (incluyendo collection, director, cast, runtime, overview)
          // de inmediato ANTES de guardar y notificar para que la colección esté disponible al instante.
          try {
            const full = await fetchTmdbFullDetails(selected.type, selected.id);
            if (full) {
              Object.assign(selected, full);
            }
          } catch (err) {
            console.warn('[metadataModal] Error obteniendo detalles TMDB:', err);
          }

          // Asignar metadatos completos (la identidad cambia: se descartan los originales de imagen anteriores)
          title.metadata = selected;
          title.tmdbId = selected.id;
          title._origImages = {};

          if (title.archivos && !title.isSaga) {
            for (const f of title.archivos) {
              f.metadata = selected;
              f.tmdbId = selected.id;
            }
          }

          // Guardar localmente y actualizar vista
          await setManualMetadata(title, selected).catch(() => {});

          // Imágenes de la ficha.
          // - Si la identificación cambió de título, se descartan las imágenes que el usuario había
          //   elegido para el título anterior (si no, un cartel ajeno seguiría mostrándose).
          // - Con origen TMDB no se toca nada más. Con Fanart.tv se aplican las mejores disponibles.
          if (profile) {
            const idChanged = String(currentMeta?.id ?? '') !== String(selected.id);
            if (idChanged && currentMeta) {
              const oldTitle = { ...title, metadata: currentMeta };
              const old = getImagePrefs(profile, oldTitle);
              for (const kind of Object.keys(IMAGE_KINDS)) {
                if (old[kind]) setImagePref(profile, oldTitle, kind, '', sync);
              }
            }
            if (form.elements.imgsource.value === 'fanart') {
              status.textContent = `Buscando imágenes de «${selected.name}» en Fanart.tv…`;
              try {
                const best = await fetchFanartBest(selected.type || currentType, selected.id);
                for (const kind of Object.keys(IMAGE_KINDS)) {
                  if (best[kind]) setImagePref(profile, title, kind, best[kind], sync);
                }
              } catch (err) { console.warn('[metadataModal] Fanart.tv:', err?.message || err); }
            }
          }
          try { onUpdated?.(selected); } catch (e) { console.warn('[metadataModal] onUpdated error', e); }
          close();

          // Edición del caption en Telegram en segundo plano
          (async () => {

            if (client && peerOf) {
              try {
                const ch = title.channel || title.archivos?.[0]?.channel;
                if (ch?.id && ch?.hash) {
                  const peer = peerOf(ch);
                  const files = title.archivos || [];
                  for (const file of files) {
                    if (!file.messageId) continue;
                    try {
                      // Si el caption original contenía "Nombre de archivo: ", respetarlo estrictamente ya que Telegram trunca nombres largos
                      const existingCap = parseCaption(file.rawCaption || file.caption || '');
                      const preservedFileName = existingCap.fileName || file.captionFileName || file.fileName || file.label;

                      const newCap = buildStandardCaption({
                        fileName: preservedFileName,
                        section: file.section || title.origen?.seccion || existingCap.section || null,
                        tmdbId: selected.id,
                        imdbId: selected.imdbId || existingCap.imdbId || '',
                        director: selected.director || existingCap.director || '',
                        writer: selected.writer || existingCap.writer || '',
                        cast: selected.cast || existingCap.cast || '',
                        rating: selected.rating || existingCap.rating || '',
                        ageRating: selected.ageRating || existingCap.ageRating || '',
                        synopsis: selected.overview || existingCap.synopsis || '',
                      });

                      // EditMessage al estilo TGComic con Api.messages.EditMessage
                      await client.invoke(new Api.messages.EditMessage({
                        peer,
                        id: Number(file.messageId),
                        message: String(newCap || ''),
                      }));

                      file.caption = newCap;
                      file.rawCaption = newCap;
                      file.captionFileName = preservedFileName;
                      if (!file.synopsis) file.synopsis = selected.overview || null;
                    } catch (mErr) {
                      const em = String(mErr?.errorMessage || mErr?.message || mErr || '');
                      if (!/MESSAGE_NOT_MODIFIED/i.test(em)) {
                        console.warn('[metadataModal] Error al editar mensaje:', file.messageId, mErr);
                      }
                    }
                  }
                }
              } catch (tgErr) {
                console.warn('[metadataModal] Error actualizando caption en Telegram:', tgErr);
              }
            }
          })().catch(e => console.warn('[metadataModal] Error en guardado en segundo plano:', e));
        };
      });

      // Enfocar automáticamente el primer botón de resultado para mando TV
      setTimeout(() => {
        const firstBtn = resultsContainer.querySelector('.btn-select-meta');
        if (firstBtn) {
          firstBtn.focus();
          firstBtn.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
      }, 50);

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
    title._origImages = {};
    await enrichTitle(title);
    if (title.archivos && !title.isSaga) {
      for (const f of title.archivos) {
        f.metadata = title.metadata;
        f.tmdbId = title.tmdbId;
      }
    }
    onUpdated?.(title.metadata);
    close();
  });

  executeSearch();
}
