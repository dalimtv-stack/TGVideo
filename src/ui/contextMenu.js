// src/ui/contextMenu.js
// Menú contextual nativo de PC (clic derecho) para archivos y fichas de vídeo:
// - Opción de descargar archivo (con barra de progreso)
// - Opción de mostrar y abrir en Telegram (enlace directo al mensaje)
// - Opción de reenviar o subida rápida a canal tgstorage con caption enriquecido y nombre editable

import { EXT_CHANNEL_TITLES_CACHE, hideExternalFiles, unhideExternalFiles, isExternalFileHiddenSync } from './externalTitlesCache.js';
import { isExternalTitle } from '../library/titles.js';
import { parseEpisode } from '../library/parse.js';
import { startUploadTask, updateUploadTask } from './uploadTasks.js';
import { extractTitleAndYear } from '../metadata/tmdb.js';
import { showMetadataModal } from './metadataModal.js';
import { createKV } from '../core/kv.js';
import { removeOverrides } from '../metadata/overrides.js';
import { showEditCaptionModal } from './editCaptionModal.js';
import { showForwardModal } from './forwardModal.js';

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (!n) return '0 B';
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

/**
 * Resuelve de forma robusta la entidad InputPeer de un canal o grupo de Telegram.
 */
async function resolvePeer(client, tg, target) {
  if (!target) throw new Error("Canal no especificado para resolver peer");
  if (target.className?.startsWith("InputPeer") || target._ === "inputPeerChannel" || target._ === "inputPeerChat") {
    return target;
  }
  if (target.entity) return target.entity;
  if (tg?.peerOf && typeof target === "object" && (target.accessHash || target.hash)) {
    try {
      const p = tg.peerOf(target);
      if (p) return p;
    } catch (_) {}
  }
  const rawId = String(typeof target === "object" ? (target.tgChannelId || target.channelId || target.id || "") : target).split("_top_")[0].trim();
  if (!rawId) throw new Error("ID de canal no válido");

  if (client?.getInputEntity) {
    try {
      return await client.getInputEntity(rawId);
    } catch (_) {
      try {
        const clean = rawId.replace(/^-100/, "").replace(/^-/, "");
        return await client.getInputEntity(`-100${clean}`);
      } catch (err) {
        if (tg?.peerOf) {
          const clean = rawId.replace(/^-100/, "").replace(/^-/, "");
          return tg.peerOf({ id: clean, accessHash: typeof target === "object" ? (target.accessHash || target.hash) : "0" });
        }
        throw new Error(`No se pudo resolver el canal en Telegram: ${err.message || String(err)}`);
      }
    }
  }
  throw new Error("Cliente Telegram no disponible para resolver el canal");
}

function ensureProgressBar() {
  return document.getElementById('admin-global-upload-bar');
}

function setProgressBar(_bar, { id, title, status, percent = 0, done = false, error = false }) {
  if (!id) return;
  updateUploadTask(id, { title, status, percent, done, error });
}

/**
 * Descarga un archivo de vídeo de Telegram en el navegador con soporte de barra de progreso.
 */
async function triggerFileDownload(client, tg, file) {
  if (!client) {
    alert('Cliente de Telegram no disponible para descargar.');
    return;
  }
  const filename = file.fileName || file.captionFileName || file.label || `video_${file.messageId}.mp4`;
  const totalSize = Number(file.size) || 0;
  let writableStream = null;

  // Mostrar el selector nativo antes de iniciar la transferencia cuando el navegador lo admite.
  if (typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function') {
    try {
      const ext = (filename.match(/\.([a-zA-Z0-9]+)$/)?.[1] || 'mp4').toLowerCase();
      const mimeByExt = {
        mp4: 'video/mp4', m4v: 'video/mp4', mkv: 'video/x-matroska',
        avi: 'video/x-msvideo', mov: 'video/quicktime', webm: 'video/webm',
        mpeg: 'video/mpeg', mpg: 'video/mpeg', ts: 'video/mp2t',
      };
      const mime = file.mimeType || mimeByExt[ext] || 'application/octet-stream';
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: 'Archivo de vídeo', accept: { [mime]: [`.${ext}`] } }],
      });
      writableStream = await handle.createWritable();
    } catch (pickerErr) {
      if (pickerErr?.name === 'AbortError') return;
      console.warn('[contextMenu] No se pudo abrir el selector de destino', pickerErr);
      alert('No se pudo abrir el selector de destino. Comprueba los permisos del navegador e inténtalo de nuevo.');
      return;
    }
  }

  const bar = ensureProgressBar();
  const taskId = startUploadTask(`Descargando: ${filename}`, 'Conectando con Telegram…', 0);
  setProgressBar(bar, {
    id: taskId,
    title: `Descargando: ${filename}`,
    status: `Conectando con Telegram… (${formatBytes(totalSize)})`,
    percent: 0,
  });

  try {
    const peer = await resolvePeer(client, tg, file.channel || file.channelId);
    const [msg] = await client.getMessages(peer, { ids: [file.messageId] });
    if (!msg || !msg.media) throw new Error('No se encontró el mensaje o archivo en Telegram');

    const bytes = await client.downloadMedia(msg.media, {
      progressCallback: (done, total) => {
        const t = total || totalSize || 1;
        const pct = Math.min(100, Math.round((done / t) * 100));
        setProgressBar(bar, {
          id: taskId,
          title: `Descargando: ${filename}`,
          status: `${formatBytes(done)} / ${formatBytes(t)} (${pct}%)`,
          percent: pct,
        });
      },
    });

    if (writableStream) {
      await writableStream.write(bytes);
      await writableStream.close();
    } else {
      const doc = msg.document || msg.media?.document;
      const blob = new Blob([bytes], { type: doc?.mimeType || 'video/mp4' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1000);
    }

    const savedBytes = Number(bytes?.byteLength || bytes?.length || totalSize) || 0;
    setProgressBar(bar, {
      id: taskId,
      title: `Descarga completada: ${filename}`,
      status: `Guardado en tu equipo (${formatBytes(savedBytes)})`,
      percent: 100,
      done: true,
    });
  } catch (err) {
    if (writableStream) {
      try { await writableStream.abort(); } catch (_) {}
    }
    console.error('[contextMenu] Error descargando archivo', err);
    setProgressBar(bar, {
      id: taskId,
      title: `Error al descargar: ${filename}`,
      status: err.message || String(err),
      percent: 0,
      error: true,
    });
  }
}

/**
 * Abre el mensaje correspondiente en Telegram Web / Desktop vía enlace tg://
 */
function openInTelegram(file) {
  const channelId = String(file.channelId || file.channel?.id || '').split('_top_')[0];
  const cleanId = channelId.replace(/^-100/, '').replace(/^-/, '');
  const messageId = file.messageId;

  if (!cleanId || !messageId) {
    alert('No se pudo determinar el ID del canal o mensaje para abrir en Telegram.');
    return;
  }

  const tgUri = `tg://privatepost?channel=${cleanId}&post=${messageId}`;
  const link = document.createElement('a');
  link.href = tgUri;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  setTimeout(() => link.remove(), 500);
}

/**
 * Extrae el año de los metadatos TMDB o del archivo con múltiples estrategias.
 */
function extractYear(titleData, file) {
  if (titleData?.metadata?.year) return String(titleData.metadata.year);
  if (titleData?.metadata?.date) {
    const m = String(titleData.metadata.date).match(/\b((?:19|20)\d{2})\b/);
    if (m) return m[1];
  }
  if (titleData?.metadata?.release_date) {
    const m = String(titleData.metadata.release_date).match(/\b((?:19|20)\d{2})\b/);
    if (m) return m[1];
  }
  if (titleData?.yearHint) return String(titleData.yearHint);
  if (file?.yearHint) return String(file.yearHint);
  const cand = [file?.captionFileName, file?.fileName, file?.rawCaption, titleData?.nombre].filter(Boolean).join(' ');
  const m = cand.match(/\b((?:19|20)\d{2})\b/);
  return m ? m[1] : null;
}

/**
 * Helper para detectar temporada y episodio de un string de forma segura.
 */
function parseEpisodeHelper(name = '') {
  return parseEpisode(name);
}

/**
 * Genera el nombre estándar sugerido para el archivo según si es película o serie.
 * - Película: [Nombre de Película] ([año]).ext
 * - Serie: [Nombre de la Serie] - [temporada]x[número de episodio].ext
 */
function isSeriesTitle(titleData, file) {
  const channelCat = String(titleData?.channel?.category || file?.channel?.category || '').trim();
  const isMovieCat = /^pel[ií]culas?$/i.test(channelCat) || /^documental(es)?$/i.test(channelCat);
  if (isMovieCat) return false;
  if (titleData?.tipo === 'pelicula' || titleData?.tipo === 'documental') return false;
  const isSeriesCat = /^series?$/i.test(channelCat);
  if (isSeriesCat || titleData?.tipo === 'serie') return true;
  if (titleData?.metadata?.tipo === 'tv' || titleData?.metadata?.type === 'tv') return true;
  if (file?.season > 0 && file?.episode > 0) return true;
  const origName = file?.fileName || file?.captionFileName || file?.label || '';
  const parsed = parseEpisodeHelper(origName);
  if (parsed.season > 0 || parsed.episode > 0) return true;
  return false;
}

function formatSuggestedFileName(file, titleData) {
  const origName = file.fileName || file.captionFileName || file.label || `video_${file.messageId}.mp4`;
  const extMatch = origName.match(/\.([a-zA-Z0-9]{2,5})$/);
  const ext = extMatch ? `.${extMatch[1]}` : '.mp4';
  const cleanBase = origName.replace(/\.([a-zA-Z0-9]{2,5})$/, '').trim();

  const isMovieExplicit = titleData?.tipo === 'pelicula' || titleData?.tipo === 'documental';
  const isSerieExplicit = titleData?.tipo === 'serie';

  const fileSeason = Number(file.season) || 0;
  const fileEpisode = Number(file.episode) || 0;
  const parsedEp = parseEpisodeHelper(origName);
  const hasEp = (fileSeason > 0 || fileEpisode > 0) || (parsedEp.season > 0 || parsedEp.episode > 0);

  const isSerie = isSerieExplicit || (!isMovieExplicit && hasEp);

  if (isSerie) {
    const sName = titleData?.metadata?.name || titleData?.metadata?.title || titleData?.nombre || file.section || cleanBase;
    const season = fileSeason > 0 ? fileSeason : (parsedEp.season > 0 ? parsedEp.season : 1);
    const episode = fileEpisode > 0 ? fileEpisode : (parsedEp.episode > 0 ? parsedEp.episode : 1);
    const epStr = String(episode).padStart(2, '0');
    return `${sName} - ${season}x${epStr}${ext}`;
  }

  // Película o documental: priorizar título/nombre de los metadatos TMDB identificados
  let mName = titleData?.metadata?.title || titleData?.metadata?.name || file?.metadata?.title || file?.metadata?.name || titleData?.nombre;
  let year = extractYear(titleData, file);

  if (!mName) {
    mName = cleanBase.replace(/\s*AÑO\s*\d{4}/i, '').replace(/\b((?:19|20)\d{2})\b/g, '').trim();
  } else if (year) {
    mName = mName.replace(new RegExp(`\\s*[\\(\\[]?${year}[\\)\\]]?\\s*$`, "i"), "").trim();

  }

  if (year) {
    return `${mName} (${year})${ext}`;
  }
  return `${mName}${ext}`;
}

let activeMenuEl = null;
let prevFocusedEl = null;
let activeContextConfig = null;
let contextMenuInitialized = false;

export function isMenuKey(e) {
  return Boolean(
    e.key === 'ContextMenu' ||
    e.key === 'Menu' ||
    e.keyCode === 82 ||
    e.keyCode === 93 ||
    (e.key === 'F10' && e.shiftKey)
  );
}

export function isContextMenuOpen() {
  return Boolean(activeMenuEl && document.body.contains(activeMenuEl));
}

export function removeActiveMenu() {
  if (activeMenuEl) {
    activeMenuEl.remove();
    activeMenuEl = null;
    if (prevFocusedEl && typeof prevFocusedEl.focus === 'function' && document.body.contains(prevFocusedEl)) {
      try {
        prevFocusedEl.focus({ preventScroll: true });
        prevFocusedEl.classList.add('dpad-focused');
      } catch (_) {}
    }
    prevFocusedEl = null;
    return true;
  }
  return false;
}

export function openContextMenuForFocusedElement() {
  if (document.querySelector('.player:not([style*="display: none"])') && !document.querySelector('.settings-overlay, .player-tracks-overlay, .player-next-up')) {
    return false;
  }
  let candidate = document.activeElement;
  if (!candidate || candidate === document.body) {
    candidate = document.querySelector('.dpad-focused');
  }
  let target = candidate?.closest?.('.ep, .lib-card, .carousel-item, .admin-video-row, .detail');
  if (!target) {
    const detailEl = document.querySelector('.detail');
    if (detailEl && detailEl.offsetParent) {
      target = detailEl;
    }
  }
  if (!target) return false;
  return showContextMenuForElement(target, null);
}

export function showContextMenuForElement(sourceEl, coords = null) {
  if (!sourceEl) return false;

  const epEl = sourceEl.closest('.ep');
  const cardEl = sourceEl.closest('.lib-card, .carousel-item');
  const adminRow = sourceEl.closest('.admin-video-row');
  const detailEl = sourceEl.closest('.detail') || (sourceEl.classList?.contains('detail') ? sourceEl : null);

  if (!epEl && !cardEl && !adminRow && !detailEl) return false;

    let targetFile = null;
    let targetTitle = null;
    let titleName = '';
    const config = activeContextConfig || {};
    const internalTitles = (typeof config.getTitles === 'function' ? config.getTitles() : []) || [];
    const externalTitlesList = Array.from(EXT_CHANNEL_TITLES_CACHE?.values?.() || []).flat();
    const allTitles = [...internalTitles, ...externalTitlesList];

    if (epEl) {
      const key = epEl.dataset.key;
      for (const t of allTitles) {
        const found = t.archivos?.find(f => f.key === key);
        if (found) {
          targetFile = found;
          targetTitle = t;
          titleName = t.nombre;
          break;
        }
      }
      if (!targetFile) {
        const dEl = document.querySelector('.detail');
        const detailTitleId = dEl?.dataset?.title;
        const dt = allTitles.find(x => String(x.id) === String(detailTitleId)) || dEl?._titleData;
        if (dt) {
          const found = dt.archivos?.find(f => f.key === key || String(f.messageId) === String(epEl.dataset.messageId));
          if (found) {
            targetFile = found;
            targetTitle = dt;
            titleName = dt.nombre;
          }
        }
      }
    } else if (cardEl) {
      const titleId = cardEl.dataset.title;
      let t = (titleId ? allTitles.find(x => String(x.id) === String(titleId)) : null) || cardEl._titleData;
      if (!t && titleId) {
        t = allTitles.find(x => x.archivos?.some(f => f.key === titleId || `${f.channelId || f.channel?.id}:${f.messageId}` === titleId || String(f.messageId) === String(titleId)));
      }
      if (!t && titleId && String(titleId).includes(':')) {
        const parts = String(titleId).split(':');
        const mId = parts[parts.length - 1];
        t = allTitles.find(x => x.archivos?.some(f => String(f.messageId) === String(mId)));
      }
      if (t && t.archivos && t.archivos.length > 0) {
        // En tarjetas tomamos el primer archivo (o película principal)
        targetFile = t.archivos[0];
        targetTitle = t;
        titleName = t.nombre;
      }
    } else if (adminRow) {
      const fileCheck = adminRow.querySelector('input[type="checkbox"]');
      const key = fileCheck?.dataset?.key;
      if (key) {
        for (const t of allTitles) {
          const found = t.archivos?.find(f => f.key === key);
          if (found) {
            targetFile = found;
            targetTitle = t;
            titleName = t.nombre;
            break;
          }
        }
      }
    } else if (detailEl) {
      const detailTitleId = detailEl?.dataset?.title;
      const dt = allTitles.find(x => String(x.id) === String(detailTitleId)) || detailEl?._titleData;
      if (dt && dt.archivos && dt.archivos.length > 0) {
        targetFile = dt.archivos[0];
        targetTitle = dt;
        titleName = dt.nombre;
      }
    }

    if (targetFile && targetTitle) {
      if (!targetFile.channel && targetTitle.channel) targetFile.channel = targetTitle.channel;
      if (!targetFile.channelId) targetFile.channelId = targetTitle.channel?.id || targetTitle.origen?.channelId;
    }

    if (!targetFile || !targetFile.messageId) return false;

    prevFocusedEl = document.activeElement || document.querySelector('.dpad-focused');
    removeActiveMenu();

    const menu = document.createElement('div');
    menu.className = 'pc-context-menu';
    menu.id = 'pc-context-menu';
    menu.style.cssText = `
      position: fixed;
      z-index: 100000;
      background: #181c24;
      border: 1px solid rgba(255, 255, 255, 0.16);
      border-radius: 8px;
      box-shadow: 0 10px 25px rgba(0,0,0,0.7);
      min-width: 250px;
      padding: 0.4rem 0;
      font-family: inherit;
      color: #fff;
    `;

    const displayName = targetFile.label || targetFile.fileName || titleName || `Vídeo ${targetFile.messageId}`;
    const sizeStr = formatBytes(targetFile.size);

    const isExt = isExternalTitle(targetTitle) || Boolean(targetFile.channel?.isExternal) || Boolean(targetTitle?.isExternal) || Boolean(targetTitle?._isExternalContext) || Boolean(targetFile.channelId && String(targetFile.channelId).startsWith('ext-'));
    const allMovieFiles = (targetTitle?.archivos && targetTitle.archivos.length > 0) ? targetTitle.archivos : [targetFile];
    const isMovie = targetTitle?.tipo === 'pelicula' || (!targetTitle?.tipo && !targetTitle?.isSaga && !targetFile.season);
    const hasMultipleVersions = isMovie && allMovieFiles.length > 1;
    const isEpClick = Boolean(epEl);

    menu.innerHTML = `
      <div style="padding: 0.5rem 0.9rem 0.4rem; border-bottom: 1px solid rgba(255,255,255,0.1); font-size: 0.8rem; color: #94a3b8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
        <strong style="color: #e2e8f0; display: block; overflow: hidden; text-overflow: ellipsis;">${esc(displayName)}</strong>
        <span>${esc(sizeStr)}</span>
      </div>
      <div class="pc-menu-item" data-focusable tabindex="0" role="button" id="pc-menu-forward" style="display: flex; align-items: center; gap: 0.6rem; padding: 0.6rem 0.9rem; cursor: pointer; font-size: 0.9rem; transition: background 0.15s;">
        <span style="font-size: 1.1rem;">⚡</span>
        <span>${targetTitle?.tipo === 'serie' && (targetTitle?.archivos?.length || 1) > 1 ? 'Enviar serie completa / episodio a tgstorage' : 'Enviar / Subir archivo a canal tgstorage'}</span>
      </div>
      <div class="pc-menu-item" data-focusable tabindex="0" role="button" id="pc-menu-identify" style="display: flex; align-items: center; gap: 0.6rem; padding: 0.6rem 0.9rem; cursor: pointer; font-size: 0.9rem; transition: background 0.15s;">
        <span style="font-size: 1.1rem; color: #c084fc;">✨</span>
        <span>Identificar / Corregir en TMDB</span>
      </div>
      <div class="pc-menu-item" data-focusable tabindex="0" role="button" id="pc-menu-clear-meta" style="display: flex; align-items: center; gap: 0.6rem; padding: 0.6rem 0.9rem; cursor: pointer; font-size: 0.9rem; transition: background 0.15s; color: #fca5a5;">
        <span style="font-size: 1.1rem;">🗑️</span>
        <span>Borrar identificación guardada</span>
      </div>
      ${(() => {
        if (isEpClick) {
          const isSeries = targetTitle?.tipo === 'serie';
          const singleLabel = isSeries ? 'Editar caption/datos de este episodio' : 'Editar caption/datos de esta versión';
          let html = `
            <div class="pc-menu-item" data-focusable tabindex="0" role="button" id="pc-menu-edit-caption-single" style="display: flex; align-items: center; gap: 0.6rem; padding: 0.6rem 0.9rem; cursor: pointer; font-size: 0.9rem; transition: background 0.15s; color: #38bdf8;">
              <span style="font-size: 1.1rem;">📝</span>
              <span>${singleLabel}</span>
            </div>
          `;
          if (allMovieFiles.length > 1) {
            const commonLabel = isSeries ? 'Editar datos comunes de la serie' : 'Editar datos comunes (todas las versiones)';
            html += `
              <div class="pc-menu-item" data-focusable tabindex="0" role="button" id="pc-menu-edit-caption-common" style="display: flex; align-items: center; gap: 0.6rem; padding: 0.6rem 0.9rem; cursor: pointer; font-size: 0.9rem; transition: background 0.15s; color: #7dd3fc;">
                <span style="font-size: 1.1rem;">📋</span>
                <span>${commonLabel}</span>
              </div>
            `;
          }
          return html;
        } else {
          if (allMovieFiles.length > 1) {
            const isSeries = targetTitle?.tipo === 'serie';
            const commonLabel = isSeries
              ? `Editar datos comunes de la serie (${allMovieFiles.length} eps)`
              : `Editar datos comunes (${allMovieFiles.length} versiones)`;
            return `
              <div class="pc-menu-item" data-focusable tabindex="0" role="button" id="pc-menu-edit-caption-common" style="display: flex; align-items: center; gap: 0.6rem; padding: 0.6rem 0.9rem; cursor: pointer; font-size: 0.9rem; transition: background 0.15s; color: #38bdf8;">
                <span style="font-size: 1.1rem;">📝</span>
                <span>${commonLabel}</span>
              </div>
            `;
          } else {
            return `
              <div class="pc-menu-item" data-focusable tabindex="0" role="button" id="pc-menu-edit-caption-single" style="display: flex; align-items: center; gap: 0.6rem; padding: 0.6rem 0.9rem; cursor: pointer; font-size: 0.9rem; transition: background 0.15s; color: #38bdf8;">
                <span style="font-size: 1.1rem;">📝</span>
                <span>Editar caption/datos Telegram</span>
              </div>
            `;
          }
        }
      })()}
      <div class="pc-menu-item" data-focusable tabindex="0" role="button" id="pc-menu-download" style="display: flex; align-items: center; gap: 0.6rem; padding: 0.6rem 0.9rem; cursor: pointer; font-size: 0.9rem; transition: background 0.15s;">
        <span style="font-size: 1.1rem;">⬇️</span>
        <span>Descargar archivo</span>
      </div>
      <div class="pc-menu-item" data-focusable tabindex="0" role="button" id="pc-menu-telegram" style="display: flex; align-items: center; gap: 0.6rem; padding: 0.6rem 0.9rem; cursor: pointer; font-size: 0.9rem; transition: background 0.15s;">
        <span style="font-size: 1.1rem;">✈️</span>
        <span>Mostrar en Telegram</span>
      </div>
      ${isExt ? (() => {
        if (hasMultipleVersions && isEpClick) {
          const hidden = isExternalFileHiddenSync(targetFile);
          const allHidden = allMovieFiles.every(f => isExternalFileHiddenSync(f));
          return `
            <div class="pc-menu-item" data-focusable tabindex="0" role="button" id="pc-menu-toggle-hidden-single" style="display:flex;align-items:center;gap:.6rem;padding:.6rem .9rem;cursor:pointer;font-size:.9rem;color:${hidden ? '#86efac' : '#fca5a5'};">
              <span style="font-size:1.1rem;">${hidden ? '👁️' : '🙈'}</span>
              <span>${hidden ? 'Mostrar esta versión' : 'Ocultar solo esta versión'}</span>
            </div>
            <div class="pc-menu-item" data-focusable tabindex="0" role="button" id="pc-menu-toggle-hidden-all" style="display:flex;align-items:center;gap:.6rem;padding:.6rem .9rem;cursor:pointer;font-size:.9rem;color:${allHidden ? '#86efac' : '#f87171'};border-top:1px solid rgba(255,255,255,.08);">
              <span style="font-size:1.1rem;">${allHidden ? '👁️' : '🙈'}</span>
              <span>${allHidden ? 'Mostrar película completa' : 'Ocultar película completa'}</span>
            </div>
          `;
        }
        if (hasMultipleVersions) {
          const allHidden = allMovieFiles.every(f => isExternalFileHiddenSync(f));
          return `
            <div class="pc-menu-item" data-focusable tabindex="0" role="button" id="pc-menu-toggle-hidden-all" style="display:flex;align-items:center;gap:.6rem;padding:.6rem .9rem;cursor:pointer;font-size:.9rem;color:${allHidden ? '#86efac' : '#fca5a5'};">
              <span style="font-size:1.1rem;">${allHidden ? '👁️' : '🙈'}</span>
              <span>${allHidden ? 'Mostrar película completa' : 'Ocultar película completa'}</span>
            </div>
            <div style="padding:.35rem .9rem .2rem;font-size:.72rem;text-transform:uppercase;color:#94a3b8;font-weight:700;border-top:1px solid rgba(255,255,255,.08);margin-top:.25rem;">Ocultar solo una versión:</div>
            ${allMovieFiles.map((f, index) => {
              const hidden = isExternalFileHiddenSync(f);
              const label = f.label || f.fileName || `Versión ${index + 1}`;
              return `<div class="pc-menu-item pc-menu-toggle-version-item" data-focusable tabindex="0" role="button" data-msg-id="${esc(f.messageId)}" data-version-index="${index}" style="display:flex;align-items:center;gap:.5rem;padding:.45rem .9rem;cursor:pointer;font-size:.84rem;color:${hidden ? '#86efac' : '#cbd5e1'};"><span>${hidden ? '👁️' : '🙈'}</span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${hidden ? 'Mostrar' : 'Ocultar'} ${esc(label)}</span></div>`;
            }).join('')}
          `;
        }
        const targetFiles = allMovieFiles;
        const fullyHidden = targetFiles.every(f => isExternalFileHiddenSync(f));
        const isSeries = targetTitle?.tipo === 'serie' || targetFiles.length > 1;
        const labelText = fullyHidden
          ? (isSeries ? 'Mostrar serie oculta' : 'Mostrar archivo oculto')
          : (isSeries ? 'Ocultar serie ya gestionada' : 'Ocultar archivo ya gestionado');
        return `<div class="pc-menu-item" data-focusable tabindex="0" role="button" id="pc-menu-toggle-hidden-all" style="display:flex;align-items:center;gap:.6rem;padding:.6rem .9rem;cursor:pointer;font-size:.9rem;color:${fullyHidden ? '#86efac' : '#fca5a5'};"><span style="font-size:1.1rem;">${fullyHidden ? '👁️' : '🙈'}</span><span>${labelText}</span></div>`;
      })() : ''}
    `;

    // Posicionamiento inteligente para no salir de pantalla (ratón en PC o mando en TV)
    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    let left = 0;
    let top = 0;

    if (coords && typeof coords.clientX === 'number') {
      left = coords.clientX;
      top = coords.clientY;
    } else {
      const anchorEl = epEl || cardEl || adminRow || detailEl || sourceEl;
      const anchorRect = anchorEl?.getBoundingClientRect?.() || { left: 40, top: 40, width: 200, height: 100, right: 240, bottom: 140 };
      if (anchorRect.right + rect.width + 12 <= window.innerWidth) {
        left = anchorRect.right + 12;
        top = anchorRect.top;
      } else if (anchorRect.left - rect.width - 12 >= 16) {
        left = anchorRect.left - rect.width - 12;
        top = anchorRect.top;
      } else {
        left = Math.max(16, anchorRect.left + (anchorRect.width - rect.width) / 2);
        top = anchorRect.bottom + 8;
      }
    }

    if (left + rect.width > window.innerWidth - 12) {
      left = window.innerWidth - rect.width - 12;
    }
    if (top + rect.height > window.innerHeight - 12) {
      top = window.innerHeight - rect.height - 12;
    }
    menu.style.left = `${Math.max(12, left)}px`;
    menu.style.top = `${Math.max(12, top)}px`;

    menu.querySelectorAll('.pc-menu-item').forEach(item => {
      item.addEventListener('mouseenter', () => {
        item.style.backgroundColor = '#2a3242';
      });
      item.addEventListener('mouseleave', () => {
        item.style.backgroundColor = 'transparent';
      });
      item.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ' || ev.keyCode === 13 || ev.keyCode === 23) {
          ev.preventDefault();
          ev.stopPropagation();
          item.click();
        }
      });
    });

    // Enfocar automáticamente la primera opción al abrir en TV / teclado
    setTimeout(() => {
      const first = menu.querySelector('.pc-menu-item[data-focusable]');
      if (first) {
        first.focus({ preventScroll: true });
        first.classList.add('dpad-focused');
      }
    }, 40);

    menu.querySelector('#pc-menu-forward')?.addEventListener('click', (ev) => {
      ev.stopPropagation();
      removeActiveMenu();
      const currentConfig = activeContextConfig || {};
      const currentTg = currentConfig.tg || (typeof window !== 'undefined' ? window.tg : null);
      const currentClient = currentConfig.client || currentTg?.getClient?.() || (typeof window !== 'undefined' && window.tg?.getClient?.());
      showForwardModal(currentClient, currentTg, targetFile, currentConfig.getChannels, targetTitle, currentConfig.getTitles).catch(err => {
        console.error('[contextMenu] Error en showForwardModal:', err);
        alert('Error al abrir envío a tgstorage: ' + (err.message || String(err)));
      });
    });

    menu.querySelector('#pc-menu-identify')?.addEventListener('click', (ev) => {
      ev.stopPropagation();
      removeActiveMenu();
      const currentConfig = activeContextConfig || {};
      const currentTg = currentConfig.tg;
      const currentClient = currentConfig.client || currentTg?.getClient?.();
      const currentSync = currentConfig.sync || window.sync;
      const currentProfile = currentConfig.profile;

      showMetadataModal(targetTitle, (updatedMeta) => {
        targetTitle.metadata = updatedMeta;
        targetTitle.nombre = updatedMeta.name || updatedMeta.title || targetTitle.nombre;
        if (targetTitle.archivos && !targetTitle.isSaga) {
          for (const f of targetTitle.archivos) {
            f.metadata = updatedMeta;
            f.tmdbId = updatedMeta.id;
          }
        }
        const cardEl = document.querySelector(`.lib-card[data-title="${esc(targetTitle.id)}"]`);
        if (cardEl) {
          cardEl._titleData = targetTitle;
          const nameEl = cardEl.querySelector(".lib-card-name");
          if (nameEl) nameEl.textContent = updatedMeta.name || updatedMeta.title || targetTitle.nombre;
          const posterEl = cardEl.querySelector(".lib-card-poster");
          const posterUrl = updatedMeta.poster;
          if (posterEl && posterUrl) {
            posterEl.classList.add("has-poster");
            let img = posterEl.querySelector("img.poster-image");
            if (!img) {
              img = document.createElement("img");
              img.className = "poster-image";
              img.alt = updatedMeta.name || updatedMeta.title || "";
              posterEl.prepend(img);
            }
            img.src = posterUrl;
          }
        }
      }, {
        client: currentClient,
        peerOf: currentTg?.peerOf,
        profile: currentProfile,
        sync: currentSync,
      });
    });

    menu.querySelector('#pc-menu-edit-caption-single')?.addEventListener('click', (ev) => {
      ev.stopPropagation();
      removeActiveMenu();
      const currentConfig = activeContextConfig || {};
      const currentTg = currentConfig.tg;
      const currentClient = currentConfig.client || currentTg?.getClient?.();

      showEditCaptionModal({
        title: targetTitle,
        targetFile,
        allFiles: allMovieFiles,
        initialCommonMode: false,
        client: currentClient,
        tg: currentTg,
        onUpdated: (updatedTitle, updatedFiles) => {
          const cEl = document.querySelector(`.lib-card[data-title="${esc(updatedTitle?.id)}"]`);
          if (cEl && updatedTitle) cEl._titleData = updatedTitle;
        },
      });
    });

    menu.querySelector('#pc-menu-edit-caption-common')?.addEventListener('click', (ev) => {
      ev.stopPropagation();
      removeActiveMenu();
      const currentConfig = activeContextConfig || {};
      const currentTg = currentConfig.tg;
      const currentClient = currentConfig.client || currentTg?.getClient?.();

      showEditCaptionModal({
        title: targetTitle,
        targetFile: null,
        allFiles: allMovieFiles,
        initialCommonMode: true,
        client: currentClient,
        tg: currentTg,
        onUpdated: (updatedTitle, updatedFiles) => {
          const cEl = document.querySelector(`.lib-card[data-title="${esc(updatedTitle?.id)}"]`);
          if (cEl && updatedTitle) cEl._titleData = updatedTitle;
        },
      });
    });

    menu.querySelector('#pc-menu-clear-meta')?.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      removeActiveMenu();

      const currentConfig = activeContextConfig || {};
      const currentTg = currentConfig.tg;
      const currentSync = currentConfig.sync || window.sync;
      const kv = createKV();

      const titleDisplayName = targetTitle?.nombre || displayName;
      if (!confirm(`¿Borrar la identificación guardada de "${titleDisplayName}" tanto de la caché local como del archivo JSON de Telegram?`)) {
        return;
      }

      try {
        const titleId = String(targetTitle?.id || '');
        const channelId = String(targetTitle?.channel?.id || targetFile?.channelId || '');
        const rawChannelId = channelId.replace(/^ext-/, '');
        const extChannelId = rawChannelId ? `ext-${rawChannelId}` : '';

        const keysToDelete = new Set([
          titleId,
          titleId.replace(/^ext-/, ''),
          channelId,
          rawChannelId,
          extChannelId,
        ].filter(Boolean));

        const targetFiles = (targetTitle?.archivos && targetTitle.archivos.length > 0) ? targetTitle.archivos : [targetFile];

        for (const f of targetFiles) {
          if (f.key) keysToDelete.add(String(f.key));
          if (f.messageId) {
            if (channelId) keysToDelete.add(`${channelId}:${f.messageId}`);
            if (rawChannelId) keysToDelete.add(`${rawChannelId}:${f.messageId}`);
            if (extChannelId) keysToDelete.add(`${extChannelId}:${f.messageId}`);
            if (titleId) keysToDelete.add(`${titleId}:${f.messageId}`);
          }
        }

        // 1. Borrar de overrides sincronizados (memoria, IndexedDB y push inmediato a Telegram JSON)
        await removeOverrides(Array.from(keysToDelete), currentSync);

        // 2. Borrar de manual_tmdb:* en IndexedDB
        for (const k of keysToDelete) {
          await kv.del(`manual_tmdb:${k}`).catch(() => {});
        }

        // 3. Borrar de library_v2 metadataMap y limpiar tmdbId de los archivos cacheados
        const lib = await kv.get('library_v2').catch(() => null);
        if (lib) {
          if (lib.metadataMap) {
            for (const k of keysToDelete) {
              delete lib.metadataMap[k];
            }
          }
          if (lib.cache) {
            const chKeys = [channelId, rawChannelId, titleId].filter(Boolean);
            for (const ck of chKeys) {
              if (lib.cache[ck]?.files) {
                for (const f of lib.cache[ck].files) {
                  f.metadata = null;
                  f.tmdbId = null;
                }
              }
            }
          }
          await kv.set('library_v2', lib).catch(() => {});
        }

        // 4. Borrar de la caché de TMDB si hay tmdbId o query
        if (targetTitle?.tmdbId) {
          await kv.del(`tmdb_v2:tv:${targetTitle.tmdbId}`).catch(() => {});
          await kv.del(`tmdb_v2:movie:${targetTitle.tmdbId}`).catch(() => {});
        }
        if (targetTitle?.nombre) {
          const parsed = extractTitleAndYear(targetTitle.nombre);
          const q = (parsed.title || '').toLowerCase();
          const y = targetTitle.yearHint || parsed.year || '';
          if (q) {
            await kv.del(`tmdb_v2:tv:${q}:${y}`).catch(() => {});
            await kv.del(`tmdb_v2:movie:${q}:${y}`).catch(() => {});
            await kv.del(`tmdb_v2:tv:${q}:`).catch(() => {});
            await kv.del(`tmdb_v2:movie:${q}:`).catch(() => {});
          }
        }

        // 5. Limpiar en memoria el título y sus archivos
        if (targetTitle) {
          targetTitle.metadata = null;
          targetTitle.tmdbId = null;
          targetTitle._origImages = {};
          if (targetTitle.channel?.name) {
            targetTitle.nombre = targetTitle.channel.name;
          }
        }

        for (const f of targetFiles) {
          f.metadata = null;
          f.tmdbId = null;
        }

        // 6. Si es canal externo, limpiar también ext_files_{id} en IndexedDB
        if (channelId || rawChannelId) {
          const extKeys = new Set([`ext_files_${channelId}`, `ext_files_${rawChannelId}`, `ext_files_${extChannelId}`].filter(Boolean));
          const targetMsgIds = new Set(targetFiles.map(f => String(f.messageId)));
          for (const extKey of extKeys) {
            const cachedList = await kv.get(extKey).catch(() => null);
            if (Array.isArray(cachedList) && cachedList.length > 0) {
              let changed = false;
              for (const f of cachedList) {
                if (targetMsgIds.has(String(f.messageId))) {
                  f.metadata = null;
                  f.tmdbId = null;
                  changed = true;
                }
              }
              if (changed) {
                await kv.set(extKey, cachedList).catch(() => {});
              }
            }
          }
        }

        // 7. Actualizar la tarjeta visual en el DOM
        const cardEl = document.querySelector(`.lib-card[data-title="${esc(targetTitle?.id)}"]`);
        if (cardEl) {
          cardEl._titleData = targetTitle;
          const nameEl = cardEl.querySelector('.lib-card-name');
          if (nameEl) nameEl.textContent = targetTitle?.nombre || displayName;
          const posterEl = cardEl.querySelector('.lib-card-poster');
          if (posterEl) {
            posterEl.classList.remove('has-poster');
            const img = posterEl.querySelector('img.poster-image');
            if (img) img.remove();
          }
        }

        // 8. Disparar eventos globales para refrescar vistas
        window.dispatchEvent(new CustomEvent('tgvideo:external-hidden-changed', {
          detail: { channelId, messageId: targetFile?.messageId, titleId: targetTitle?.id },
        }));
        window.dispatchEvent(new CustomEvent('tgvideo:metadata-cleared', {
          detail: { titleId: targetTitle?.id, channelId },
        }));

        alert('Identificación guardada eliminada con éxito de la caché local y de Telegram.');
      } catch (err) {
        console.error('[contextMenu] Error borrando identificación', err);
        alert(`Error al borrar identificación: ${err?.message || err}`);
      }
    });

    menu.querySelector('#pc-menu-download')?.addEventListener('click', (ev) => {
      ev.stopPropagation();
      removeActiveMenu();
      const currentConfig = activeContextConfig || {};
      const currentTg = currentConfig.tg;
      const currentClient = currentConfig.client || currentTg?.getClient?.();
      triggerFileDownload(currentClient, currentTg, targetFile);
    });

    menu.querySelector('#pc-menu-telegram')?.addEventListener('click', (ev) => {
      ev.stopPropagation();
      removeActiveMenu();
      openInTelegram(targetFile);
    });

    const toggleExternalFiles = async (files) => {
      const isFullyHidden = files.every(f => isExternalFileHiddenSync(f));
      if (isFullyHidden) await unhideExternalFiles(files);
      else await hideExternalFiles(files);
      window.dispatchEvent(new CustomEvent('tgvideo:external-hidden-changed', {
        detail: {
          channelId: targetFile.channelId || targetFile.channel?.id,
          messageId: targetFile.messageId,
          titleId: targetTitle?.id,
        },
      }));
    };

    menu.querySelector('#pc-menu-toggle-hidden-single')?.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      removeActiveMenu();
      try { await toggleExternalFiles([targetFile]); }
      catch (err) {
        console.error('[contextMenu] Error al cambiar visibilidad de versión', err);
        alert(`No se pudo actualizar la visibilidad: ${err?.message || err}`);
      }
    });

    menu.querySelector('#pc-menu-toggle-hidden-all')?.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      removeActiveMenu();
      try { await toggleExternalFiles(allMovieFiles); }
      catch (err) {
        console.error('[contextMenu] Error al cambiar visibilidad del archivo externo', err);
        alert(`No se pudo actualizar la visibilidad: ${err?.message || err}`);
      }
    });

    menu.querySelectorAll('.pc-menu-toggle-version-item').forEach((item) => {
      item.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        removeActiveMenu();
        const index = Number(item.dataset.versionIndex);
        const file = allMovieFiles[index];
        if (!file) return;
        try { await toggleExternalFiles([file]); }
        catch (err) {
          console.error('[contextMenu] Error al cambiar visibilidad de versión', err);
          alert(`No se pudo actualizar la visibilidad: ${err?.message || err}`);
        }
      });
    });

    activeMenuEl = menu;
    return true;
}

/**
 * Inicializa el listener global de clic derecho en PC y botón Menú (tres rayas) en Android TV.
 */
export function initContextMenu(config) {
  activeContextConfig = config;
  if (contextMenuInitialized) return;
  contextMenuInitialized = true;

  document.addEventListener('click', (e) => {
    if (activeMenuEl && !activeMenuEl.contains(e.target)) {
      removeActiveMenu();
    }
  });

  window.addEventListener('blur', () => removeActiveMenu());
  window.addEventListener('resize', () => removeActiveMenu());

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (activeMenuEl) {
        e.preventDefault();
        e.stopPropagation();
        removeActiveMenu();
      }
      return;
    }

    if (isMenuKey(e)) {
      e.preventDefault();
      e.stopPropagation();
      if (activeMenuEl) {
        removeActiveMenu();
      } else {
        openContextMenuForFocusedElement();
      }
    }
  }, true);

  document.addEventListener('contextmenu', (e) => {
    const handled = showContextMenuForElement(e.target, { clientX: e.clientX, clientY: e.clientY });
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  });
}
