// src/ui/episodeIdentificationModal.js
// Modal modular para corregir temporada, episodio y título de un archivo de serie de forma local.

import { Api } from "telegram";
import { modal } from "./settings.js";
import { buildStandardCaption, formatEpisodeFileName, parseCaption } from "../library/parse.js";
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
  client,
  peerOf,
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
      <p style="margin:0;color:#94a3b8;font-size:.86rem;">Al guardar se actualizará el caption de Telegram y la biblioteca local para que los demás dispositivos lean el mismo orden.</p>
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

    const saveButton = overlay.querySelector("#episode-edit-save");
    if (saveButton?.disabled) return;
    if (saveButton) {
      saveButton.disabled = true;
      saveButton.textContent = "Guardando…";
    }
    if (errorEl) errorEl.textContent = "";

    const rawCaption = String(file.rawCaption || file.caption || '');
    const existingCaption = parseCaption(rawCaption);
    const oldFileName = existingCaption.fileName || file.captionFileName || file.fileName || file.label || '';
    const updatedFileName = formatEpisodeFileName(oldFileName, season, episode);
    const updatedCaption = buildStandardCaption({
      fileName: updatedFileName,
      season,
      episode,
      section: existingCaption.section || file.section || title?.origen?.seccion || null,
      tmdbId: existingCaption.tmdbId || file.tmdbId || null,
      imdbId: existingCaption.imdbId || file.imdbId || null,
      director: existingCaption.director || '',
      writer: existingCaption.writer || '',
      cast: existingCaption.cast || '',
      rating: existingCaption.rating || '',
      ageRating: existingCaption.ageRating || '',
      synopsis: existingCaption.synopsis || file.synopsis || '',
    });

    // En canales propios, Telegram es la fuente compartida entre dispositivos.
    // Los canales externos conservan el comportamiento local porque no se pueden editar desde aquí.
    const isExternalChannel = Boolean(
      file.channel?.isExternal || title?.channel?.isExternal || title?.isExternal ||
      title?.origen?.tipo === 'externo' || String(file.channelId || file.channel?.id || '').startsWith('ext-')
    );
    const channel = file.channel || title?.channel;
    try {
      if (!isExternalChannel) {
        if (!client || !peerOf || !channel || !file.messageId) {
          throw new Error('No se pudo acceder al mensaje del canal para actualizar su caption.');
        }
        const peer = await peerOf(channel);
        try {
          await client.invoke(new Api.messages.EditMessage({
            peer,
            id: Number(file.messageId),
            message: updatedCaption,
          }));
        } catch (telegramError) {
          const code = String(telegramError?.errorMessage || telegramError?.message || '');
          if (!/MESSAGE_NOT_MODIFIED/i.test(code)) throw telegramError;
        }
      }
    } catch (err) {
      console.warn('[episodeIdentificationModal] No se pudo actualizar el caption en Telegram:', err);
      if (errorEl) {
        errorEl.textContent = `No se guardó el cambio en Telegram: ${String(err?.errorMessage || err?.message || err)}. Revisa permisos y conexión.`;
      }
      if (saveButton) {
        saveButton.disabled = false;
        saveButton.textContent = 'Guardar identificación';
      }
      return;
    }

    // 1. Actualizar el archivo en memoria, incluida la versión estandarizada del nombre.
    const changed = file.season !== season || file.episode !== episode;
    file.season = season;
    file.episode = episode;
    file.captionEpisodeOverride = !isExternalChannel;
    file.caption = updatedCaption;
    file.rawCaption = updatedCaption;
    file.captionFileName = updatedFileName;
    file.fileName = updatedFileName;
    file.episodeOverride = { season, episode, name: customTitle || null, updated_at: Date.now() };
    if (customTitle) {
      file.metadata = { ...(file.metadata || {}), name: customTitle };
    } else if (changed && file.metadata?.name) {
      delete file.metadata.name;
      delete file.metadata.overview;
      delete file.metadata.air_date;
    }

    // 2. Persistir también el override/cache local.
    try {
      await saveEpisodeOverride({ title, file, season, episode, name: customTitle || null });
    } catch (err) {
      console.warn("[episodeIdentificationModal] Error guardando override:", err);
    }
    try {
      await persistMetadata?.();
    } catch (_) {}

    close();

    // 3. Reconstruir el mapa de temporadas y ordenar los archivos.
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

      renderEpisodes?.(targetSeason);
      loadSeasonMeta?.(targetSeason);
      centerCurrentSeason?.();
    }

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
