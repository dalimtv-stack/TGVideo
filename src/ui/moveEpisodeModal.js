// src/ui/moveEpisodeModal.js
// Modal interactivo y accesible con mando TV para mover un episodio de una serie a otra serie (existente o nueva).
import { modal } from "./settings.js";
import { attachSpatialNav } from "./spatialNav.js";
import { saveEpisodeSeriesMove, EXT_CHANNEL_TITLES_CACHE } from "./externalTitlesCache.js";

/**
 * Función centralizada y segura para ejecutar el movimiento de un episodio,
 * garantizando la consistencia en memoria, caché de canal externo, cuadrícula y persistencia en IndexedDB/localStorage.
 */
export async function executeEpisodeMove({
  file,
  sourceTitle,
  targetTitle = null,
  targetSeriesId = null,
  targetSeriesName = "",
  newSeason = 1,
  newEpisode = 1,
  isExt = false,
  fromGrid = null,
  channelId = "",
  getTitles = null,
  setTitles = null,
  persistMetadata = null,
}) {
  if (!file || !sourceTitle) return { target: null, isEmpty: false };

  const s = Number(newSeason) || 1;
  const ep = Number(newEpisode) || 1;
  file.season = s;
  file.episode = ep;

  const matchesFile = (x) =>
    x === file ||
    (file.key && x.key === file.key) ||
    (file.messageId && String(x.messageId) === String(file.messageId)) ||
    (file.fileName && x.fileName && x.fileName === file.fileName && x.size === file.size);

  // 1. Quitar el archivo de la serie origen en memoria
  sourceTitle.archivos = (sourceTitle.archivos || []).filter(x => !matchesFile(x));

  // 2. Determinar la colección de títulos activa según el contexto (externo o interno)
  let titlePool = [];
  const cleanChId = String(channelId || sourceTitle.channel?.id || fromGrid?.channel?.id || fromGrid?.id || "").replace(/^ext-/, "");

  if (isExt) {
    if (fromGrid && Array.isArray(fromGrid.gridItems)) {
      titlePool = fromGrid.gridItems;
    } else if (fromGrid && Array.isArray(fromGrid.items)) {
      titlePool = fromGrid.items;
    } else if (cleanChId && EXT_CHANNEL_TITLES_CACHE.has(cleanChId)) {
      titlePool = EXT_CHANNEL_TITLES_CACHE.get(cleanChId);
    } else if (cleanChId && EXT_CHANNEL_TITLES_CACHE.has(`ext-${cleanChId}`)) {
      titlePool = EXT_CHANNEL_TITLES_CACHE.get(`ext-${cleanChId}`);
    }
  } else if (typeof getTitles === "function") {
    titlePool = getTitles() || [];
  }

  // 3. Quitar el archivo de cualquier título previo en titlePool (para evitar que permanezca en la serie errónea)
  for (const t of titlePool) {
    if (Array.isArray(t.archivos)) {
      t.archivos = t.archivos.filter(x => !matchesFile(x));
    }
  }

  // 4. Localizar o instanciar la serie destino
  let target = targetTitle;
  if (!target && titlePool.length > 0) {
    target = titlePool.find(x =>
      (targetSeriesId && String(x.id) === String(targetSeriesId)) ||
      (x.tipo === "serie" && x.nombre && targetSeriesName && x.nombre.toLowerCase().trim() === targetSeriesName.toLowerCase().trim())
    );
  }

  if (!target) {
    const newId = targetSeriesId || (isExt ? `${cleanChId || "ext"}#${targetSeriesName}` : `custom_series_${Date.now()}`);
    target = {
      id: newId,
      tipo: "serie",
      isSaga: false,
      nombre: targetSeriesName,
      grupo: sourceTitle.grupo || fromGrid?.title || "Series",
      channel: sourceTitle.channel || fromGrid?.channel,
      origen: sourceTitle.origen || (isExt ? { tipo: "externo", channelId: cleanChId } : undefined),
      archivos: [],
      ultimoMensajeFecha: file.date || Date.now(),
    };
    titlePool.push(target);
    if (isExt && fromGrid) {
      if (Array.isArray(fromGrid.gridItems) && !fromGrid.gridItems.includes(target)) fromGrid.gridItems.push(target);
      if (Array.isArray(fromGrid.items) && !fromGrid.items.includes(target)) fromGrid.items.push(target);
    }
  }

  // 5. Incorporar el archivo a la serie destino
  if (target) {
    target.archivos = target.archivos || [];
    const alreadyThere = target.archivos.some(matchesFile);
    if (!alreadyThere) {
      target.archivos.push(file);
    }
    target.archivos.sort((a, b) =>
      ((Number(a.season) || 1) - (Number(b.season) || 1)) ||
      ((Number(a.episode) || 1) - (Number(b.episode) || 1)) ||
      ((Number(b.size) || 0) - (Number(a.size) || 0)) ||
      (a.date - b.date)
    );
  }

  // 6. Limpiar series vacías de las listas activas
  const cleanedPool = titlePool.filter(t => t === target || (Array.isArray(t.archivos) && t.archivos.length > 0));
  titlePool.length = 0;
  titlePool.push(...cleanedPool);

  const isEmpty = (sourceTitle.archivos || []).length === 0;

  // 7. Persistir en almacenamiento durable y sincronizar cachés
  try {
    await saveEpisodeSeriesMove({
      file,
      sourceTitle,
      targetTitle: target,
      targetSeriesId: target?.id || targetSeriesId,
      targetSeriesName: target?.nombre || targetSeriesName,
      season: s,
      episode: ep,
    });
  } catch (err) {
    console.warn("[executeEpisodeMove] Error al guardar reubicación:", err);
  }

  if (isExt) {
    const cCandidates = [cleanChId, `ext-${cleanChId}`].filter(Boolean);
    for (const cKey of cCandidates) {
      EXT_CHANNEL_TITLES_CACHE.set(cKey, [...titlePool]);
    }
    if (fromGrid) {
      fromGrid.gridItems = [...titlePool];
      fromGrid.items = [...titlePool];
    }
  } else if (typeof setTitles === "function") {
    setTitles([...titlePool]);
    try {
      if (typeof persistMetadata === "function") await persistMetadata();
    } catch (_) {}
  }

  return { target, isEmpty };
}

/**
 * Muestra el diálogo modal para mover un episodio individual a otra serie.
 * Incluye compatibilidad total con mando a distancia Android TV (D-pad).
 */
export function showMoveEpisodeModal({
  file,
  currentTitle,
  allTitles = [],
  esc = (s) => String(s || ""),
  onMoved,
}) {
  if (!file || !currentTitle) return;

  const currentFileName = file.captionFileName || file.fileName || file.label || "Episodio";
  const curSeason = Number.isInteger(file.season) ? file.season : (Number(file.season) || 1);
  const curEpisode = Number.isInteger(file.episode) ? file.episode : (Number(file.episode) || 1);

  // Filtrar otras series disponibles en la biblioteca/canal
  const availableSeries = (allTitles || [])
    .filter(t => t.tipo === "serie" && String(t.id) !== String(currentTitle.id))
    .sort((a, b) => (a.nombre || "").localeCompare(b.nombre || "", undefined, { sensitivity: "base" }));

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

        <div id="move-ep-list" style="max-height:160px;overflow-y:auto;border:1px solid #333;border-radius:6px;background:#111;padding:0.25rem;display:flex;flex-direction:column;gap:2px;">
          ${availableSeries.length === 0 ? `<div style="padding:0.75rem;text-align:center;color:#888;font-size:0.85rem;">No hay otras series cargadas aún en este canal</div>` : ""}
          ${availableSeries.map(s => `
            <button type="button" class="move-ep-option" data-focusable data-series-id="${esc(s.id)}" data-series-name="${esc(s.nombre)}"
                 style="width:100%;text-align:left;background:transparent;border:1px solid transparent;padding:0.5rem 0.75rem;cursor:pointer;border-radius:4px;display:flex;justify-content:space-between;align-items:center;color:#fff;font-size:0.9rem;outline:none;transition:background 0.15s, border-color 0.15s;">
              <span style="font-weight:500;">${esc(s.nombre)}</span>
              <span style="font-size:0.75rem;color:#aaa;">${s.archivos?.length || 0} eps</span>
            </button>
          `).join("")}
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

  const { overlay, close } = modal("Mover episodio a otra serie", bodyHtml, "Reasigna este archivo a su serie correspondiente");

  let selectedSeriesId = null;
  let selectedSeriesName = null;

  const searchInput = overlay.querySelector("#move-ep-search");
  const seriesList = overlay.querySelector("#move-ep-list");
  const newNameInput = overlay.querySelector("#move-ep-new-name");
  const seasonInput = overlay.querySelector("#move-ep-season");
  const episodeInput = overlay.querySelector("#move-ep-episode");
  const errorBox = overlay.querySelector("#move-ep-error");
  const submitBtn = overlay.querySelector("#move-ep-submit");
  const cancelBtn = overlay.querySelector("#move-ep-cancel");

  cancelBtn.onclick = close;

  function highlightSelectedOption() {
    seriesList.querySelectorAll(".move-ep-option").forEach(el => {
      const match = el.dataset.seriesId === selectedSeriesId;
      el.style.background = match ? "rgba(33, 150, 243, 0.35)" : "transparent";
      el.style.borderColor = match ? "#2196f3" : "transparent";
    });
  }

  // Filtrado reactivo en el input de búsqueda
  searchInput.addEventListener("input", () => {
    const q = searchInput.value.trim().toLowerCase();
    seriesList.querySelectorAll(".move-ep-option").forEach(el => {
      const name = (el.dataset.seriesName || "").toLowerCase();
      el.style.display = (!q || name.includes(q)) ? "flex" : "none";
    });
  });

  seriesList.querySelectorAll(".move-ep-option").forEach(opt => {
    const selectThis = () => {
      selectedSeriesId = opt.dataset.seriesId;
      selectedSeriesName = opt.dataset.seriesName;
      newNameInput.value = "";
      highlightSelectedOption();
      errorBox.style.display = "none";
    };

    opt.addEventListener("click", selectThis);
    opt.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        selectThis();
      }
    });

    // Foco en Android TV
    opt.addEventListener("focus", () => {
      opt.style.borderColor = "#64b5f6";
      opt.style.background = opt.dataset.seriesId === selectedSeriesId ? "rgba(33, 150, 243, 0.45)" : "rgba(255, 255, 255, 0.1)";
    });
    opt.addEventListener("blur", () => {
      const match = opt.dataset.seriesId === selectedSeriesId;
      opt.style.borderColor = match ? "#2196f3" : "transparent";
      opt.style.background = match ? "rgba(33, 150, 243, 0.35)" : "transparent";
    });
  });

  newNameInput.addEventListener("input", () => {
    if (newNameInput.value.trim()) {
      selectedSeriesId = null;
      selectedSeriesName = null;
      highlightSelectedOption();
      errorBox.style.display = "none";
    }
  });

  // Navegación fluida horizontal con teclado/mando dentro del modal
  seasonInput.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      episodeInput.focus();
    }
  });
  episodeInput.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      seasonInput.focus();
    }
  });
  cancelBtn.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      submitBtn.focus();
    }
  });
  submitBtn.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      cancelBtn.focus();
    }
  });

  submitBtn.onclick = async () => {
    const customName = newNameInput.value.trim();
    const finalSeriesName = customName || selectedSeriesName;
    const finalSeriesId = customName ? `custom_series_${Date.now()}` : selectedSeriesId;

    if (!finalSeriesName) {
      errorBox.textContent = "Selecciona una serie de la lista o escribe el nombre de una nueva.";
      errorBox.style.display = "block";
      return;
    }

    const newSeason = parseInt(seasonInput.value, 10);
    const newEpisode = parseInt(episodeInput.value, 10);
    if (!Number.isFinite(newSeason) || newSeason < 1) {
      errorBox.textContent = "La temporada debe ser un número mayor o igual a 1.";
      errorBox.style.display = "block";
      return;
    }
    if (!Number.isFinite(newEpisode) || newEpisode < 1) {
      errorBox.textContent = "El episodio debe ser un número mayor o igual a 1.";
      errorBox.style.display = "block";
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Moviendo...";

    try {
      let targetTitle = (allTitles || []).find(t =>
        (finalSeriesId && String(t.id) === String(finalSeriesId)) ||
        (t.tipo === "serie" && t.nombre?.toLowerCase().trim() === finalSeriesName.toLowerCase())
      );

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
      console.error("[moveEpisodeModal] Error al mover episodio:", err);
      errorBox.textContent = "Error al guardar el movimiento del episodio.";
      errorBox.style.display = "block";
      submitBtn.disabled = false;
      submitBtn.textContent = "Mover episodio";
    }
  };

  attachSpatialNav?.(overlay);

  setTimeout(() => {
    searchInput?.focus();
  }, 60);
}
