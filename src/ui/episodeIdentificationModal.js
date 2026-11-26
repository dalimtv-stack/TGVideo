// src/ui/episodeIdentificationModal.js
// Modal modular para corregir temporada, episodio y título de un archivo de serie de forma local.

import { modal } from "./settings.js";
import { attachSpatialNav } from "./spatialNav.js";
import { saveEpisodeOverride } from "./externalTitlesCache.js";

/**
 * Muestra el modal para corregir la temporada y el episodio de un archivo de serie.
 * Guarda la corrección localmente (localStorage, IndexedDB y en memoria), cierra el modal
 * y actualiza inmediatamente la vista de la serie.
 */
export function showEpisodeIdentificationModal({
  title,
  file,
  seasonsMap,
  persistMetadata,
  renderEpisodes,
  loadSeasonMeta,
  centerCurrentSeason,
  changeSeason,
  profile,
  loadProgress,
  formatPlayButtonLabel,
  titleState,
  esc,
}) {
  if (!file) return;

  const fileName = file.captionFileName || file.fileName || file.label || `Mensaje ${file.messageId || ""}`;
  const currentEpName = file.metadata?.name || "";
  const currentS = Number.isInteger(file.season) ? file.season : (Number(file.season) || 1);
  const currentE = Number.isInteger(file.episode) ? file.episode : (Number(file.episode) || 1);

  const { overlay, close } = modal(`Corregir identificación del episodio`, `
    <div style="display:flex;flex-direction:column;gap:.8rem;color:#e2e8f0;">
      <p style="margin:0;color:#cbd5e1;">Archivo: <strong>${esc(fileName)}</strong></p>
      <p style="margin:0;color:#94a3b8;font-size:.86rem;">Introduce la temporada, número y opcionalmente el título. Esta corrección se guardará localmente.</p>
      <div style="display:flex;gap:.75rem;flex-wrap:wrap;">
        <label style="display:flex;flex:1;min-width:120px;flex-direction:column;gap:.3rem;">Temporada
          <input id="episode-season-input" type="number" min="0" max="99" value="${currentS}" data-focusable style="padding:.55rem .7rem;background:#11141a;border:1px solid rgba(255,255,255,.18);border-radius:5px;color:#fff;">
        </label>
        <label style="display:flex;flex:1;min-width:120px;flex-direction:column;gap:.3rem;">Episodio
          <input id="episode-number-input" type="number" min="0" max="999" value="${currentE}" data-focusable style="padding:.55rem .7rem;background:#11141a;border:1px solid rgba(255,255,255,.18);border-radius:5px;color:#fff;">
        </label>
      </div>
      <label style="display:flex;flex-direction:column;gap:.3rem;">Título del episodio (opcional)
        <input id="episode-title-input" type="text" placeholder="Dejar en blanco para TMDB / nombre limpio" value="${esc(currentEpName)}" data-focusable style="padding:.55rem .7rem;background:#11141a;border:1px solid rgba(255,255,255,.18);border-radius:5px;color:#fff;">
      </label>
      <div id="episode-edit-error" role="alert" style="min-height:1.2rem;color:#f87171;font-size:.84rem;"></div>
      <div style="display:flex;justify-content:flex-end;gap:.6rem;">
        <button type="button" class="btn btn-secondary" id="episode-edit-cancel" data-focusable>Cancelar</button>
        <button type="button" class="btn btn-primary" id="episode-edit-save" data-focusable>Guardar identificación</button>
      </div>
    </div>
  `, `Serie: <strong>${esc(title?.metadata?.name || title?.nombre || "")}</strong>`);

  attachSpatialNav(overlay);

  const seasonInput = overlay.querySelector("#episode-season-input");
  const episodeInput = overlay.querySelector("#episode-number-input");
  const titleInput = overlay.querySelector("#episode-title-input");
  const errorEl = overlay.querySelector("#episode-edit-error");

  const handleSave = async () => {
    const sVal = seasonInput.value.trim();
    const eVal = episodeInput.value.trim();
    const customTitle = titleInput.value.trim();
    const season = Number(sVal);
    const episode = Number(eVal);

    if (
      sVal === "" || !Number.isInteger(season) || season < 0 || season > 99 ||
      eVal === "" || !Number.isInteger(episode) || episode < 0 || episode > 999
    ) {
      if (errorEl) errorEl.textContent = "Temporada: 0–99. Episodio: 0–999.";
      return;
    }

    // 1. Cerrar el modal de inmediato
    close();

    // 2. Modificar el objeto archivo
    const changed = file.season !== season || file.episode !== episode;
    file.season = season;
    file.episode = episode;
    if (customTitle) {
      file.metadata = { ...(file.metadata || {}), name: customTitle };
    } else if (changed && file.metadata?.name) {
      delete file.metadata.name;
      delete file.metadata.overview;
      delete file.metadata.air_date;
    }

    // 3. Persistir localmente en todas las fuentes pertinentes
    try {
      await saveEpisodeOverride({ title, file, season, episode, name: customTitle || null });
    } catch (err) {
      console.warn("[episodeIdentificationModal] Error guardando override:", err);
    }
    try {
      persistMetadata?.();
    } catch (_) {}

    // 4. Reconstruir el mapa de temporadas y ordenar los archivos
    if (seasonsMap && Array.isArray(title?.archivos)) {
      seasonsMap.clear();
      for (const item of title.archivos) {
        const s = Number.isInteger(item.season) ? item.season : (Number(item.season) || 1);
        if (!seasonsMap.has(s)) seasonsMap.set(s, []);
        seasonsMap.get(s).push(item);
      }
      title.archivos.sort((a, b) => ((Number(a.season) || 1) - (Number(b.season) || 1)) || ((Number(a.episode) || 1) - (Number(b.episode) || 1)) || (a.date - b.date));
      const seasons = [...seasonsMap.keys()].sort((a, b) => a - b);
      const hasSeasons = title.tipo === "serie" && seasons.length > 1;
      const targetSeason = seasonsMap.has(season) ? season : (seasons[0] || 1);

      // 5. Actualizar la barra de temporadas en el DOM
      const existingBar = document.querySelector(".seasons-bar");
      if (hasSeasons) {
        if (existingBar) {
          const track = existingBar.querySelector(".seasons-track");
          if (track) {
            track.innerHTML = seasons.map(s => `<button class="season-btn ${s === targetSeason ? "active" : ""}" data-focusable data-season="${s}">Temporada ${s}</button>`).join("");
            track.querySelectorAll(".season-btn").forEach(btn => {
              btn.onclick = () => changeSeason?.(Number(btn.dataset.season));
            });
          }
        } else {
          const listTitle = document.getElementById("d-list-title");
          if (listTitle) {
            const seasonBar = document.createElement("div");
            seasonBar.className = "seasons-bar";
            seasonBar.innerHTML = `<div class="seasons-label">Temporadas</div><div class="seasons-track">${seasons.map(s => `<button class="season-btn ${s === targetSeason ? "active" : ""}" data-focusable data-season="${s}">Temporada ${s}</button>`).join("")}</div>`;
            listTitle.before(seasonBar);
            seasonBar.querySelectorAll(".season-btn").forEach(btn => {
              btn.onclick = () => changeSeason?.(Number(btn.dataset.season));
            });
          }
        }
      } else {
        existingBar?.remove();
      }

      // 6. Refrescar lista de episodios y metadatos
      renderEpisodes?.(targetSeason);
      loadSeasonMeta?.(targetSeason);
      centerCurrentSeason?.();
    }

    // 7. Actualizar botón de reproducción si procede
    const playBtn = document.getElementById("d-play");
    if (playBtn && profile?.id && loadProgress && formatPlayButtonLabel && titleState) {
      const p = loadProgress(profile.id);
      const label = formatPlayButtonLabel(title, titleState(title, p), p);
      if (label) playBtn.textContent = label;
    }
  };

  overlay.querySelector("#episode-edit-cancel").onclick = close;
  overlay.querySelector("#episode-edit-save").onclick = handleSave;

  [seasonInput, episodeInput, titleInput].forEach(inp => {
    if (inp) {
      inp.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") {
          ev.preventDefault();
          ev.stopPropagation();
          handleSave();
        }
      });
    }
  });

  seasonInput?.focus();
}
