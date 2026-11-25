// src/ui/editCaptionModal.js
import { Api } from 'telegram';
import { modal } from './settings.js';
import { parseCaption, buildStandardCaption } from '../library/parse.js';
import { attachSpatialNav } from './spatialNav.js';

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function resolvePeer(client, tg, target) {
  if (!target) throw new Error('Canal no especificado para resolver peer');
  if (target.className?.startsWith('InputPeer') || target._ === 'inputPeerChannel' || target._ === 'inputPeerChat') {
    return target;
  }
  if (target.entity) return target.entity;
  if (tg?.peerOf && typeof target === 'object' && (target.accessHash || target.hash)) {
    try {
      const p = tg.peerOf(target);
      if (p) return p;
    } catch (_) {}
  }
  const rawId = String(typeof target === 'object' ? (target.tgChannelId || target.channelId || target.id || '') : target).split('_top_')[0].trim();
  if (!rawId) throw new Error('ID de canal no válido');

  if (client?.getInputEntity) {
    try {
      return await client.getInputEntity(rawId);
    } catch (_) {
      try {
        const clean = rawId.replace(/^-100/, '').replace(/^-/, '');
        return await client.getInputEntity(`-100${clean}`);
      } catch (err) {
        if (tg?.peerOf) {
          const clean = rawId.replace(/^-100/, '').replace(/^-/, '');
          return tg.peerOf({ id: clean, accessHash: typeof target === 'object' ? (target.accessHash || target.hash) : '0' });
        }
        throw new Error(`No se pudo resolver el canal en Telegram: ${err.message || String(err)}`);
      }
    }
  }
  throw new Error('Cliente Telegram no disponible para resolver el canal');
}

/**
 * Abre el diálogo de edición de caption y metadatos de Telegram.
 * Soporta edición de archivo individual (versión/episodio) o de datos comunes para múltiples archivos.
 *
 * @param {Object} options
 * @param {Object} options.title Título al que pertenece el archivo/archivos.
 * @param {Object} [options.targetFile] Archivo individual seleccionado (si se pulsó en una versión/episodio).
 * @param {Array<Object>} [options.allFiles] Lista de todos los archivos del título.
 * @param {boolean} [options.initialCommonMode=false] Iniciar directamente en modo edición común.
 * @param {Object} options.client Cliente GramJS.
 * @param {Object} options.tg Instancia tg helper.
 * @param {Function} [options.onUpdated] Callback invocado tras guardar los cambios.
 */
export function showEditCaptionModal({
  title,
  targetFile = null,
  allFiles = [],
  initialCommonMode = false,
  client,
  tg,
  onUpdated = null,
}) {
  const filesList = (Array.isArray(allFiles) && allFiles.length > 0)
    ? allFiles
    : (title?.archivos && title.archivos.length > 0 ? title.archivos : (targetFile ? [targetFile] : []));

  const hasMultipleFiles = filesList.length > 1;
  let isCommonMode = Boolean(hasMultipleFiles && (initialCommonMode || !targetFile));
  let currentSelectedFile = targetFile || filesList[0] || null;
  let isRawTextMode = false;

  const channelObj = currentSelectedFile?.channel || title?.channel || title?.origen;
  const channelTitle = channelObj?.title || channelObj?.name || title?.grupo || 'Canal Telegram';

  const modalTitle = hasMultipleFiles
    ? `Editar caption/datos Telegram (${title.nombre || 'Título'})`
    : `Editar caption/datos: ${currentSelectedFile?.fileName || currentSelectedFile?.label || title.nombre || 'Archivo'}`;

  const subtitleText = hasMultipleFiles
    ? `Canal: <strong>${esc(channelTitle)}</strong> · Total: <strong>${filesList.length} archivos</strong>`
    : `Canal: <strong>${esc(channelTitle)}</strong> · Mensaje: <strong>${esc(currentSelectedFile?.messageId || '')}</strong>`;

  const getInitialValues = (f, isCommon) => {
    if (isCommon) {
      const firstF = filesList[0] || {};
      const cap = parseCaption(firstF.rawCaption || firstF.caption || '');
      return {
        fileName: '',
        section: cap.section || title.origen?.seccion || '',
        tmdbId: cap.tmdbId || title.tmdbId || title.metadata?.id || '',
        imdbId: cap.imdbId || title.imdbId || title.metadata?.imdbId || '',
        director: cap.director || title.metadata?.director || '',
        writer: cap.writer || title.metadata?.writer || '',
        cast: cap.cast || title.metadata?.cast || '',
        rating: cap.rating || title.metadata?.rating || title.metadata?.vote_average || '',
        ageRating: cap.ageRating || title.metadata?.ageRating || '',
        synopsis: cap.synopsis || title.metadata?.overview || '',
        rawText: '',
      };
    }
    const cap = parseCaption(f?.rawCaption || f?.caption || '');
    const fileName = cap.fileName || f?.captionFileName || f?.fileName || f?.label || '';
    const section = cap.section || f?.section || title.origen?.seccion || '';
    const tmdbId = cap.tmdbId || f?.tmdbId || title.tmdbId || title.metadata?.id || '';
    const imdbId = cap.imdbId || f?.imdbId || title.imdbId || title.metadata?.imdbId || '';
    const director = cap.director || title.metadata?.director || '';
    const writer = cap.writer || title.metadata?.writer || '';
    const cast = cap.cast || title.metadata?.cast || '';
    const rating = cap.rating || title.metadata?.rating || title.metadata?.vote_average || '';
    const ageRating = cap.ageRating || title.metadata?.ageRating || '';
    const synopsis = cap.synopsis || f?.synopsis || title.metadata?.overview || '';
    const rawText = f?.rawCaption || f?.caption || buildStandardCaption({
      fileName,
      section,
      tmdbId,
      imdbId,
      director,
      writer,
      cast,
      rating,
      ageRating,
      synopsis,
    });

    return { fileName, section, tmdbId, imdbId, director, writer, cast, rating, ageRating, synopsis, rawText };
  };

  let formValues = getInitialValues(currentSelectedFile, isCommonMode);

  const bodyHtml = `
    <div class="edit-cap-container" style="display: flex; flex-direction: column; gap: 0.85rem; font-size: 0.88rem; color: #e2e8f0;">
      ${hasMultipleFiles ? `
        <div style="display: flex; flex-direction: column; gap: 0.4rem; padding-bottom: 0.6rem; border-bottom: 1px solid rgba(255,255,255,0.08);">
          <div style="font-weight: 600; color: #cbd5e1; font-size: 0.82rem; text-transform: uppercase;">Objetivo de edición:</div>
          <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
            <button type="button" class="btn btn-ghost edit-cap-target-btn ${isCommonMode ? 'is-active' : ''}" data-focusable data-target="common" style="padding: 0.4rem 0.8rem; font-size: 0.85rem; border: 1px solid ${isCommonMode ? '#38bdf8' : 'rgba(255,255,255,0.15)'}; background: ${isCommonMode ? 'rgba(56,189,248,0.15)' : 'transparent'}; color: ${isCommonMode ? '#38bdf8' : '#cbd5e1'}; border-radius: 6px;">
              ⭐ Datos comunes (${filesList.length} archivos)
            </button>
            <select id="edit-cap-file-select" data-focusable style="flex: 1; min-width: 200px; padding: 0.4rem 0.6rem; font-size: 0.85rem; background: #141820; border: 1px solid rgba(255,255,255,0.18); border-radius: 6px; color: #fff;">
              <option value="__common__" ${isCommonMode ? 'selected' : ''}>-- Seleccionar archivo individual --</option>
              ${filesList.map((f, idx) => {
                const isSelected = !isCommonMode && currentSelectedFile === f;
                const label = f.label || f.fileName || `Archivo ${idx + 1} (Msg ${f.messageId})`;
                return `<option value="${idx}" ${isSelected ? 'selected' : ''}>${idx + 1}. ${esc(label)}</option>`;
              }).join('')}
            </select>
          </div>
        </div>
      ` : ''}

      <div id="edit-cap-common-notice" style="display: ${isCommonMode ? 'block' : 'none'}; background: rgba(56, 189, 248, 0.1); border: 1px solid rgba(56, 189, 248, 0.3); border-radius: 6px; padding: 0.55rem 0.8rem; font-size: 0.82rem; color: #bae6fd; line-height: 1.4;">
        ℹ️ <strong>Modo datos comunes:</strong> Los metadatos guardados se aplicarán a los <strong>${filesList.length} archivos</strong>. El <em>Nombre de archivo</em> se conservará individualmente en cada archivo para no sobrescribir nombres de episodios o versiones.
      </div>

      ${!hasMultipleFiles || !isCommonMode ? `
        <div id="edit-cap-mode-bar" style="display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; margin-top: -0.2rem;">
          <span style="font-size: 0.8rem; color: #94a3b8;">Tipo de edición:</span>
          <div style="display: flex; gap: 0.4rem;">
            <button type="button" class="btn btn-ghost edit-cap-mode-btn is-active" data-focusable data-mode="structured" style="padding: 0.25rem 0.6rem; font-size: 0.78rem; border-radius: 4px; border: 1px solid rgba(255,255,255,0.2);">Campos estructurados</button>
            <button type="button" class="btn btn-ghost edit-cap-mode-btn" data-focusable data-mode="raw" style="padding: 0.25rem 0.6rem; font-size: 0.78rem; border-radius: 4px; border: 1px solid rgba(255,255,255,0.15); color: #94a3b8;">Texto libre (Caption)</button>
          </div>
        </div>
      ` : ''}

      <form id="edit-cap-form" style="display: flex; flex-direction: column; gap: 0.65rem;">
        <div id="edit-cap-fields-structured" style="display: flex; flex-direction: column; gap: 0.65rem;">
          <div id="edit-cap-row-filename" style="display: ${isCommonMode ? 'none' : 'flex'}; flex-direction: column; gap: 0.25rem;">
            <label style="font-size: 0.78rem; font-weight: 600; color: #94a3b8;">Nombre de archivo (respetado por Telegram):</label>
            <input type="text" id="cap-input-filename" data-focusable value="${esc(formValues.fileName)}" placeholder="Ej: MiPelicula.1080p.mp4" style="padding: 0.5rem 0.7rem; background: #11141a; border: 1px solid rgba(255,255,255,0.15); border-radius: 5px; color: #fff; font-size: 0.85rem;">
          </div>

          <div style="display: flex; gap: 0.6rem; flex-wrap: wrap;">
            <div style="flex: 1; min-width: 140px; display: flex; flex-direction: column; gap: 0.25rem;">
              <label style="font-size: 0.78rem; font-weight: 600; color: #94a3b8;">Sección:</label>
              <input type="text" id="cap-input-section" data-focusable value="${esc(formValues.section)}" placeholder="Ej: Clásicas, Series, Acción" style="padding: 0.5rem 0.7rem; background: #11141a; border: 1px solid rgba(255,255,255,0.15); border-radius: 5px; color: #fff; font-size: 0.85rem;">
            </div>
            <div style="flex: 1; min-width: 110px; display: flex; flex-direction: column; gap: 0.25rem;">
              <label style="font-size: 0.78rem; font-weight: 600; color: #94a3b8;">ID TMDB:</label>
              <input type="text" id="cap-input-tmdb" data-focusable value="${esc(formValues.tmdbId)}" placeholder="Ej: 2211" style="padding: 0.5rem 0.7rem; background: #11141a; border: 1px solid rgba(255,255,255,0.15); border-radius: 5px; color: #fff; font-size: 0.85rem;">
            </div>
            <div style="flex: 1; min-width: 110px; display: flex; flex-direction: column; gap: 0.25rem;">
              <label style="font-size: 0.78rem; font-weight: 600; color: #94a3b8;">ID IMDB:</label>
              <input type="text" id="cap-input-imdb" data-focusable value="${esc(formValues.imdbId)}" placeholder="Ej: tt0086659" style="padding: 0.5rem 0.7rem; background: #11141a; border: 1px solid rgba(255,255,255,0.15); border-radius: 5px; color: #fff; font-size: 0.85rem;">
            </div>
          </div>

          <div style="display: flex; gap: 0.6rem; flex-wrap: wrap;">
            <div style="flex: 1; min-width: 160px; display: flex; flex-direction: column; gap: 0.25rem;">
              <label style="font-size: 0.78rem; font-weight: 600; color: #94a3b8;">Director:</label>
              <input type="text" id="cap-input-director" data-focusable value="${esc(formValues.director)}" placeholder="Ej: Alfred Hitchcock" style="padding: 0.5rem 0.7rem; background: #11141a; border: 1px solid rgba(255,255,255,0.15); border-radius: 5px; color: #fff; font-size: 0.85rem;">
            </div>
            <div style="flex: 1; min-width: 160px; display: flex; flex-direction: column; gap: 0.25rem;">
              <label style="font-size: 0.78rem; font-weight: 600; color: #94a3b8;">Guionista:</label>
              <input type="text" id="cap-input-writer" data-focusable value="${esc(formValues.writer)}" placeholder="Ej: Roald Dahl" style="padding: 0.5rem 0.7rem; background: #11141a; border: 1px solid rgba(255,255,255,0.15); border-radius: 5px; color: #fff; font-size: 0.85rem;">
            </div>
          </div>

          <div style="display: flex; flex-direction: column; gap: 0.25rem;">
            <label style="font-size: 0.78rem; font-weight: 600; color: #94a3b8;">Casting / Reparto:</label>
            <input type="text" id="cap-input-cast" data-focusable value="${esc(formValues.cast)}" placeholder="Separados por comas" style="padding: 0.5rem 0.7rem; background: #11141a; border: 1px solid rgba(255,255,255,0.15); border-radius: 5px; color: #fff; font-size: 0.85rem;">
          </div>

          <div style="display: flex; gap: 0.6rem; flex-wrap: wrap;">
            <div style="flex: 1; min-width: 120px; display: flex; flex-direction: column; gap: 0.25rem;">
              <label style="font-size: 0.78rem; font-weight: 600; color: #94a3b8;">Puntuación:</label>
              <input type="text" id="cap-input-rating" data-focusable value="${esc(formValues.rating)}" placeholder="Ej: 8.4" style="padding: 0.5rem 0.7rem; background: #11141a; border: 1px solid rgba(255,255,255,0.15); border-radius: 5px; color: #fff; font-size: 0.85rem;">
            </div>
            <div style="flex: 1; min-width: 120px; display: flex; flex-direction: column; gap: 0.25rem;">
              <label style="font-size: 0.78rem; font-weight: 600; color: #94a3b8;">Edad recomendada:</label>
              <input type="text" id="cap-input-agerating" data-focusable value="${esc(formValues.ageRating)}" placeholder="Ej: 13, 18, TP" style="padding: 0.5rem 0.7rem; background: #11141a; border: 1px solid rgba(255,255,255,0.15); border-radius: 5px; color: #fff; font-size: 0.85rem;">
            </div>
          </div>

          <div style="display: flex; flex-direction: column; gap: 0.25rem;">
            <label style="font-size: 0.78rem; font-weight: 600; color: #94a3b8;">Sinopsis:</label>
            <textarea id="cap-input-synopsis" data-focusable rows="3" placeholder="Sinopsis oficial o resumen…" style="padding: 0.5rem 0.7rem; background: #11141a; border: 1px solid rgba(255,255,255,0.15); border-radius: 5px; color: #fff; font-size: 0.85rem; resize: vertical; line-height: 1.4;">${esc(formValues.synopsis)}</textarea>
          </div>
        </div>

        <div id="edit-cap-fields-raw" style="display: none; flex-direction: column; gap: 0.35rem;">
          <label style="font-size: 0.78rem; font-weight: 600; color: #94a3b8;">Texto íntegro del caption en Telegram:</label>
          <textarea id="cap-input-rawtext" data-focusable rows="8" placeholder="Escribe o pega el caption completo del mensaje…" style="padding: 0.6rem 0.8rem; background: #11141a; border: 1px solid rgba(255,255,255,0.18); border-radius: 5px; color: #fff; font-size: 0.85rem; font-family: monospace; resize: vertical; line-height: 1.4;">${esc(formValues.rawText)}</textarea>
        </div>
      </form>

      <!-- Vista previa del caption generado -->
      <div style="background: #0f131a; border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; padding: 0.6rem 0.8rem;">
        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.72rem; color: #94a3b8; margin-bottom: 0.35rem;">
          <span style="font-weight: 600; text-transform: uppercase;">Vista previa del caption en Telegram:</span>
          <span id="edit-cap-char-counter" style="font-weight: 600; color: #38bdf8;">0 / 1024</span>
        </div>
        <pre id="edit-cap-preview" style="margin: 0; font-family: monospace; font-size: 0.78rem; color: #cbd5e1; white-space: pre-wrap; word-break: break-word; max-height: 110px; overflow-y: auto; line-height: 1.35;"></pre>
      </div>

      <div style="display: flex; justify-content: space-between; align-items: center; gap: 0.8rem; margin-top: 0.4rem; padding-top: 0.6rem; border-top: 1px solid rgba(255,255,255,0.08);">
        <div id="edit-cap-status" style="font-size: 0.8rem; color: #94a3b8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"></div>
        <div style="display: flex; gap: 0.6rem; flex-shrink: 0;">
          <button type="button" class="btn btn-secondary" id="btn-edit-cap-cancel" data-focusable style="padding: 0.45rem 1rem;">Cancelar</button>
          <button type="button" class="btn btn-primary" id="btn-edit-cap-save" data-focusable style="padding: 0.45rem 1.2rem; background: #2563eb; color: #fff; font-weight: 600; border-radius: 5px;">
            <span>💾 Guardar en Telegram</span>
          </button>
        </div>
      </div>
    </div>
  `;

  const { overlay, close } = modal(modalTitle, bodyHtml, subtitleText);
  attachSpatialNav(overlay.querySelector('.edit-cap-container'));

  const statusEl = overlay.querySelector('#edit-cap-status');
  const previewEl = overlay.querySelector('#edit-cap-preview');
  const counterEl = overlay.querySelector('#edit-cap-char-counter');
  const btnSave = overlay.querySelector('#btn-edit-cap-save');
  const btnCancel = overlay.querySelector('#btn-edit-cap-cancel');

  const inputFilename = overlay.querySelector('#cap-input-filename');
  const inputSection = overlay.querySelector('#cap-input-section');
  const inputTmdb = overlay.querySelector('#cap-input-tmdb');
  const inputImdb = overlay.querySelector('#cap-input-imdb');
  const inputDirector = overlay.querySelector('#cap-input-director');
  const inputWriter = overlay.querySelector('#cap-input-writer');
  const inputCast = overlay.querySelector('#cap-input-cast');
  const inputRating = overlay.querySelector('#cap-input-rating');
  const inputAgeRating = overlay.querySelector('#cap-input-agerating');
  const inputSynopsis = overlay.querySelector('#cap-input-synopsis');
  const inputRawText = overlay.querySelector('#cap-input-rawtext');

  const fileSelect = overlay.querySelector('#edit-cap-file-select');
  const targetCommonBtn = overlay.querySelector('.edit-cap-target-btn[data-target="common"]');
  const noticeCommon = overlay.querySelector('#edit-cap-common-notice');
  const rowFilename = overlay.querySelector('#edit-cap-row-filename');
  const fieldsStructured = overlay.querySelector('#edit-cap-fields-structured');
  const fieldsRaw = overlay.querySelector('#edit-cap-fields-raw');
  const modeBar = overlay.querySelector('#edit-cap-mode-bar');
  const modeBtns = overlay.querySelectorAll('.edit-cap-mode-btn');

  btnCancel.onclick = () => close();

  const updatePreview = () => {
    let finalStr = '';
    if (isRawTextMode && inputRawText) {
      finalStr = inputRawText.value || '';
    } else {
      const fName = isCommonMode
        ? '<se conserva nombre individual de cada archivo>'
        : (inputFilename?.value?.trim() || '');

      finalStr = buildStandardCaption({
        fileName: fName,
        section: inputSection?.value?.trim() || '',
        tmdbId: inputTmdb?.value?.trim() || '',
        imdbId: inputImdb?.value?.trim() || '',
        director: inputDirector?.value?.trim() || '',
        writer: inputWriter?.value?.trim() || '',
        cast: inputCast?.value?.trim() || '',
        rating: inputRating?.value?.trim() || '',
        ageRating: inputAgeRating?.value?.trim() || '',
        synopsis: inputSynopsis?.value?.trim() || '',
      });
    }

    if (previewEl) previewEl.textContent = finalStr || '(Caption vacío)';
    const len = (finalStr || '').length;
    if (counterEl) {
      counterEl.textContent = `${len} / 1024`;
      counterEl.style.color = len > 1024 ? '#f87171' : (len > 900 ? '#fde047' : '#38bdf8');
    }
  };

  const populateForm = (values, common) => {
    if (inputFilename) inputFilename.value = values.fileName || '';
    if (inputSection) inputSection.value = values.section || '';
    if (inputTmdb) inputTmdb.value = values.tmdbId || '';
    if (inputImdb) inputImdb.value = values.imdbId || '';
    if (inputDirector) inputDirector.value = values.director || '';
    if (inputWriter) inputWriter.value = values.writer || '';
    if (inputCast) inputCast.value = values.cast || '';
    if (inputRating) inputRating.value = values.rating || '';
    if (inputAgeRating) inputAgeRating.value = values.ageRating || '';
    if (inputSynopsis) inputSynopsis.value = values.synopsis || '';
    if (inputRawText) inputRawText.value = values.rawText || '';

    if (rowFilename) rowFilename.style.display = common ? 'none' : 'flex';
    if (noticeCommon) noticeCommon.style.display = common ? 'block' : 'none';
    if (modeBar) modeBar.style.display = common ? 'none' : 'flex';
    if (common && isRawTextMode) {
      isRawTextMode = false;
      modeBtns.forEach((btn) => {
        const active = btn.dataset.mode === 'structured';
        btn.classList.toggle('is-active', active);
        btn.style.color = active ? '#fff' : '#94a3b8';
        btn.style.borderColor = active ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.15)';
      });
      if (fieldsStructured) fieldsStructured.style.display = 'flex';
      if (fieldsRaw) fieldsRaw.style.display = 'none';
    }

    updatePreview();
  };

  [inputFilename, inputSection, inputTmdb, inputImdb, inputDirector, inputWriter, inputCast, inputRating, inputAgeRating, inputSynopsis, inputRawText].forEach(el => {
    el?.addEventListener('input', updatePreview);
  });

  // Selector de objetivo en caso de múltiples archivos
  if (targetCommonBtn) {
    targetCommonBtn.onclick = () => {
      isCommonMode = true;
      targetCommonBtn.classList.add('is-active');
      targetCommonBtn.style.borderColor = '#38bdf8';
      targetCommonBtn.style.background = 'rgba(56,189,248,0.15)';
      targetCommonBtn.style.color = '#38bdf8';
      if (fileSelect) fileSelect.value = '__common__';
      formValues = getInitialValues(currentSelectedFile, true);
      populateForm(formValues, true);
    };
  }

  if (fileSelect) {
    fileSelect.onchange = () => {
      const val = fileSelect.value;
      if (val === '__common__') {
        targetCommonBtn?.click();
        return;
      }
      isCommonMode = false;
      targetCommonBtn?.classList.remove('is-active');
      if (targetCommonBtn) {
        targetCommonBtn.style.borderColor = 'rgba(255,255,255,0.15)';
        targetCommonBtn.style.background = 'transparent';
        targetCommonBtn.style.color = '#cbd5e1';
      }
      const idx = Number(val);
      currentSelectedFile = filesList[idx] || filesList[0];
      formValues = getInitialValues(currentSelectedFile, false);
      populateForm(formValues, false);
    };
  }

  // Toggle estructurado / texto libre
  modeBtns.forEach(b => {
    b.onclick = () => {
      modeBtns.forEach(btn => {
        btn.classList.remove('is-active');
        btn.style.color = '#94a3b8';
        btn.style.borderColor = 'rgba(255,255,255,0.15)';
      });
      b.classList.add('is-active');
      b.style.color = '#fff';
      b.style.borderColor = 'rgba(255,255,255,0.3)';
      isRawTextMode = b.dataset.mode === 'raw';

      if (fieldsStructured) fieldsStructured.style.display = isRawTextMode ? 'none' : 'flex';
      if (fieldsRaw) fieldsRaw.style.display = isRawTextMode ? 'flex' : 'none';

      if (isRawTextMode && inputRawText && !inputRawText.value.trim()) {
        inputRawText.value = buildStandardCaption({
          fileName: inputFilename?.value?.trim() || '',
          section: inputSection?.value?.trim() || '',
          tmdbId: inputTmdb?.value?.trim() || '',
          imdbId: inputImdb?.value?.trim() || '',
          director: inputDirector?.value?.trim() || '',
          writer: inputWriter?.value?.trim() || '',
          cast: inputCast?.value?.trim() || '',
          rating: inputRating?.value?.trim() || '',
          ageRating: inputAgeRating?.value?.trim() || '',
          synopsis: inputSynopsis?.value?.trim() || '',
        });
      }
      updatePreview();
    };
  });

  // Guardar en Telegram
  btnSave.onclick = async () => {
    if (!client) {
      alert('Cliente de Telegram no disponible para guardar.');
      return;
    }

    const filesToUpdate = isCommonMode ? filesList : (currentSelectedFile ? [currentSelectedFile] : []);
    if (filesToUpdate.length === 0) {
      alert('No hay archivos seleccionados para actualizar.');
      return;
    }

    const commonData = {
      section: inputSection?.value?.trim() || null,
      tmdbId: inputTmdb?.value?.trim() || null,
      imdbId: inputImdb?.value?.trim() || null,
      director: inputDirector?.value?.trim() || null,
      writer: inputWriter?.value?.trim() || null,
      cast: inputCast?.value?.trim() || null,
      rating: inputRating?.value?.trim() || null,
      ageRating: inputAgeRating?.value?.trim() || null,
      synopsis: inputSynopsis?.value?.trim() || '',
    };

    const singleFileName = inputFilename?.value?.trim() || null;
    const rawCustomText = isRawTextMode && !isCommonMode ? (inputRawText?.value || '') : null;
    const previewText = isRawTextMode && !isCommonMode ? rawCustomText : buildStandardCaption({
      fileName: isCommonMode ? '' : (singleFileName || currentSelectedFile?.captionFileName || currentSelectedFile?.fileName || currentSelectedFile?.label),
      ...commonData,
    });
    if (String(previewText || '').length > 1024) {
      alert('Telegram limita los captions a 1024 caracteres. Acorta el texto antes de guardar.');
      return;
    }

    btnSave.disabled = true;
    if (btnCancel) btnCancel.disabled = true;
    let successCount = 0;
    let failedCount = 0;
    let lastError = null;

    try {
      for (let i = 0; i < filesToUpdate.length; i++) {
        const file = filesToUpdate[i];
        if (!file.messageId) continue;

        if (statusEl) {
          statusEl.textContent = `Actualizando mensaje ${i + 1} de ${filesToUpdate.length} en Telegram…`;
        }

        const peer = await resolvePeer(client, tg, file.channel || file.channelId || title.channel);

        let finalCaption = '';
        if (isCommonMode) {
          const existingCap = parseCaption(file.rawCaption || file.caption || '');
          const preservedFileName = existingCap.fileName || file.captionFileName || file.fileName || file.label;
          finalCaption = buildStandardCaption({
            fileName: preservedFileName,
            ...commonData,
          });
        } else {
          finalCaption = rawCustomText !== null
            ? rawCustomText
            : buildStandardCaption({
              fileName: singleFileName || file.captionFileName || file.fileName || file.label,
              ...commonData,
            });
        }

        try {
          await client.invoke(new Api.messages.EditMessage({
            peer,
            id: Number(file.messageId),
            message: String(finalCaption || ''),
          }));

          file.caption = finalCaption;
          file.rawCaption = finalCaption;
          const parsed = parseCaption(finalCaption);
          if (parsed.fileName) file.captionFileName = parsed.fileName;
          if (parsed.section) file.section = parsed.section;
          if (parsed.tmdbId) file.tmdbId = parsed.tmdbId;
          if (parsed.imdbId) file.imdbId = parsed.imdbId;
          if (parsed.synopsis) file.synopsis = parsed.synopsis;

          successCount++;
        } catch (mErr) {
          const em = String(mErr?.errorMessage || mErr?.message || mErr || '');
          if (/MESSAGE_NOT_MODIFIED/i.test(em)) {
            successCount++;
          } else {
            console.warn('[editCaptionModal] Error editando mensaje en Telegram:', file.messageId, mErr);
            failedCount++;
            lastError = mErr;
          }
        }

        if (filesToUpdate.length > 1) {
          await new Promise(r => setTimeout(r, 120));
        }
      }

      if (successCount > 0) {
        if (commonData.section && title?.origen) {
          title.origen.seccion = commonData.section;
        }
        if (commonData.tmdbId && !title.tmdbId) {
          title.tmdbId = commonData.tmdbId;
        }

        try {
          window.dispatchEvent(new CustomEvent('tgvideo:caption-updated', {
            detail: {
              titleId: title?.id,
              channelId: channelObj?.id,
              files: filesToUpdate,
            },
          }));
        } catch (_) {}

        try { onUpdated?.(title, filesToUpdate); } catch (e) { console.warn('[editCaptionModal] onUpdated error', e); }

        close();
        if (failedCount > 0) {
          alert(`Se actualizaron ${successCount} mensajes en Telegram, pero ${failedCount} fallaron: ${lastError?.message || lastError}`);
        } else {
          alert(`✅ Caption y datos de Telegram actualizados con éxito (${successCount} mensaje${successCount === 1 ? '' : 's'}).`);
        }
      } else {
        const em = String(lastError?.errorMessage || lastError?.message || lastError || '');
        if (/CHAT_ADMIN_REQUIRED|CHAT_WRITE_FORBIDDEN/i.test(em)) {
          alert('No tienes permisos de administrador en este canal de Telegram para editar los mensajes.');
        } else {
          alert(`No se pudo actualizar el mensaje en Telegram: ${em}`);
        }
        btnSave.disabled = false;
        if (btnCancel) btnCancel.disabled = false;
        if (statusEl) statusEl.textContent = 'Error al guardar en Telegram.';
      }
    } catch (err) {
      console.error('[editCaptionModal] Error en proceso de guardado', err);
      alert(`Error al guardar en Telegram: ${err?.message || err}`);
      btnSave.disabled = false;
      if (btnCancel) btnCancel.disabled = false;
      if (statusEl) statusEl.textContent = 'Error al guardar en Telegram.';
    }
  };

  updatePreview();
}
