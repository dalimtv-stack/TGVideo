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
import { createKV } from '../core/kv.js';
import { EXT_CHANNEL_TITLES_CACHE } from './externalTitlesCache.js';
import { setOverride } from '../metadata/overrides.js';

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

          // Normalizar name y title para que ninguno quede indefinido
          const chosenName = selected.name || selected.title || title.nombre;
          selected.name = chosenName;
          selected.title = chosenName;

          // Asignar metadatos completos (la identidad cambia: se descartan los originales de imagen anteriores)
          const isCollection = title.isSaga || selected.type === 'collection';
          if (isCollection) {
            title.isSaga = true;
          }
          title.metadata = selected;
          title.tmdbId = selected.id;
          title.nombre = chosenName;
          title._origImages = {};

          // Solo si NO es una saga/colección asignamos los metadatos y el tmdbId a cada archivo
          if (title.archivos && !isCollection) {
            for (const f of title.archivos) {
              f.metadata = selected;
              f.tmdbId = selected.id;
            }
          }

          // Guardar localmente y actualizar vista
          await setManualMetadata(title, selected).catch(() => {});

          // Persistencia inmediata para canales externos (IndexedDB y caché en memoria)
          try {
            const kv = createKV();
            const virtualId = String(title.channel?.id || title.channel?.channelId || title.origen?.channelId || "").trim();
            const rawChannelId = virtualId.replace(/^ext-/, "");
            const extChannelId = rawChannelId ? `ext-${rawChannelId}` : "";

            // Guardar overrides con sync para el ID del título y variantes
            const titleIdStr = String(title.id || "");
            const titleIdRaw = titleIdStr.replace(/^ext-/, "");
            const titleIdExt = titleIdRaw ? `ext-${titleIdRaw}` : "";
            const keysToOverride = new Set([titleIdStr, titleIdRaw, titleIdExt].filter(Boolean));

            if (!isCollection) {
              (title.archivos || []).forEach(f => {
                if (f.key) keysToOverride.add(String(f.key));
                if (f.messageId) {
                  if (virtualId) keysToOverride.add(`${virtualId}:${f.messageId}`);
                  if (rawChannelId) keysToOverride.add(`${rawChannelId}:${f.messageId}`);
                  if (extChannelId) keysToOverride.add(`${extChannelId}:${f.messageId}`);
                }
              });
            }

            for (const k of keysToOverride) {
              await setOverride(k, selected, sync).catch(() => {});
              await kv.set(`manual_tmdb:${k}`, selected).catch(() => {});
            }

            if (virtualId || rawChannelId) {
              // 1. Actualizar ext_files_{id} en IndexedDB para todas las variantes de ID
              const extKeys = new Set([`ext_files_${virtualId}`, `ext_files_${rawChannelId}`, `ext_files_${extChannelId}`].filter(k => k !== "ext_files_"));
              const targetMsgIds = new Set((title.archivos || []).map(f => String(f.messageId)));

              for (const extKey of extKeys) {
                const cachedFiles = (await kv.get(extKey).catch(() => [])) || [];
                if (Array.isArray(cachedFiles) && cachedFiles.length > 0) {
                  let modified = false;
                  for (const f of cachedFiles) {
                    if (targetMsgIds.has(String(f.messageId))) {
                      f.metadata = selected;
                      f.tmdbId = selected.id;
                      modified = true;
                    }
                  }
                  if (modified) {
                    await kv.set(extKey, cachedFiles).catch(() => {});
                  }
                }
              }

              // 2. Actualizar metadataMap y cache en library_v2
              const libObj = (await kv.get("library_v2").catch(() => null)) || {};
              libObj.metadataMap = libObj.metadataMap || {};
              libObj.metadataMap[`tmdb_${selected.id}`] = selected;
              for (const k of keysToOverride) {
                libObj.metadataMap[k] = selected;
              }

              // También actualizar dentro de libObj.cache si existe
              if (libObj.cache) {
                for (const cKey of [virtualId, rawChannelId, extChannelId].filter(Boolean)) {
                  if (Array.isArray(libObj.cache[cKey])) {
                    for (const f of libObj.cache[cKey]) {
                      if (targetMsgIds.has(String(f.messageId))) {
                        f.metadata = selected;
                        f.tmdbId = selected.id;
                      }
                    }
                  }
                }
              }
              await kv.set("library_v2", libObj).catch(() => {});

              // 3. Actualizar caché de títulos del canal externo en memoria
              for (const cKey of [virtualId, rawChannelId, extChannelId].filter(Boolean)) {
                const cachedTitles = EXT_CHANNEL_TITLES_CACHE?.get?.(cKey);
                if (Array.isArray(cachedTitles)) {
                  const ct = cachedTitles.find(x => String(x.id) === titleIdStr || String(x.id) === titleIdRaw || String(x.id) === titleIdExt);
                  if (ct) {
                    ct.metadata = selected;
                    ct.tmdbId = selected.id;
                    ct.nombre = chosenName;
                    ct.poster = selected.poster || ct.poster;
                    ct.backdrop = selected.background || selected.backdrop || ct.backdrop;
                    if (ct.archivos) {
                      ct.archivos.forEach(f => { f.metadata = selected; f.tmdbId = selected.id; });
                    }

                    // Si otro título en el mismo canal comparte ahora este mismo TMDB ID, unificarlos
                    const sameTmdbIdx = cachedTitles.findIndex(x => x !== ct && String(x.tmdbId || x.metadata?.id) === String(selected.id));
                    if (sameTmdbIdx !== -1) {
                      const other = cachedTitles[sameTmdbIdx];
                      const existingKeys = new Set((ct.archivos || []).map(f => f.key || `${f.channelId || f.channel?.id}:${f.messageId}`));
                      for (const f of (other.archivos || [])) {
                        const fKey = f.key || `${f.channelId || f.channel?.id}:${f.messageId}`;
                        if (!existingKeys.has(fKey)) {
                          ct.archivos.push(f);
                          existingKeys.add(fKey);
                        }
                      }
                      ct.archivos.sort((a, b) => (a.season - b.season) || (a.episode - b.episode) || ((Number(b.size) || 0) - (Number(a.size) || 0)) || (a.date - b.date));
                      cachedTitles.splice(sameTmdbIdx, 1);
                    }
                  }
                }
              }
              window.dispatchEvent(new CustomEvent('tgvideo:external-hidden-changed'));
            }
          } catch (e) {
            console.warn("[metadataModal] Error persistiendo metadatos externos:", e);
          }

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

                      const fileTmdbId = isCollection
                        ? (file.tmdbId || existingCap.tmdbId || null)
                        : selected.id;

                      const newCap = buildStandardCaption({
                        fileName: preservedFileName,
                        section: file.section || title.origen?.seccion || existingCap.section || null,
                        tmdbId: fileTmdbId,
                        imdbId: isCollection ? (file.imdbId || existingCap.imdbId || '') : (selected.imdbId || existingCap.imdbId || ''),
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