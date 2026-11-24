import { checkForUpdate } from './core/updateCheck.js';
import { initContextMenu } from './ui/contextMenu.js';
// Suprimir alerts intrusivos de GramJS (ej. TypeNotFoundError ID 0)
if (typeof window !== 'undefined') {
  const _origAlert = window.alert;
  window.alert = function (msg, ...args) {
    const text = String(msg || '');
    if (text.includes('Missing MTProto Entity') || text.includes('TL definition')) {
      console.warn('[GramJS alert interceptado en main]:', text);
      return;
    }
    return _origAlert ? _origAlert.apply(this, [msg, ...args]) : undefined;
  };
}

let LAST_OPENED_TITLE_ID = null;
import { searchViewHtml, mountSearchView } from './ui/searchView.js';
import './style.css';
import { createTelegramClient } from './core/telegram.js';
import { createTelegramSync } from './sync/telegramSync.js';
import { loadLibrary } from './library/channels.js';
import { buildTitles, mergeMoviesByTmdb, attachAutoCollections } from './library/titles.js';
import { buildHomeRows, posterColor } from './ui/home.js';
import { getNewsPrefs } from './library/newsPrefs.js';
import { initDpad, setBackHandler, focusFirst, focusInRow } from './ui/dpad.js';
import { loadProgress, loadFavorites, saveFavorites, mergeFavorites, writeFullProgress, titleState, isFavorite, toggleFavorite, toggleAllWatched } from './player/progress.js';
import { playFile } from './player/player.js';
import { createKV } from './core/kv.js';
import { enrichTitles, enrichTitle, fetchSeasonEpisodes } from './metadata/tmdb.js';
import { loadPoster, prewarmPosterCache, memoryCache } from './metadata/posterCache.js';
import { prettyEpisodeName } from './library/parse.js';
import { showMetadataModal } from './ui/metadataModal.js';
import { pickAvatar } from './ui/avatarCarousel.js';
import { showImagePicker } from './ui/imagePickerModal.js';
import { getAutoLogo } from './metadata/autoLogo.js';
import { applyImagePrefs, restoreOriginalImage, pullAndMergeImagePrefs, metadataForPersist } from './metadata/imagePrefs.js';
import { hookConsole, isDevLogEnabled, startDevLogging } from './utils/devLogger.js';
import { loadGlobalConfig } from './settings/global.js';
import { loadOverrides, getOverride, getOverrideByTmdbId } from './metadata/overrides.js';
import { showProfileMenu, profileAvatar, applyProfileScale, modal } from './ui/settings.js';
import { showAdminView } from './ui/adminView.js';
import { buildTitlesForExternalChannel } from './ui/adminChannels.js';
import { resolveTitleAgeRating } from './ui/ageRating.js';
import { adjacentSeason, firstUncompleted, centerSeason } from './ui/seasons.js';
import { mountCarousel, destroyCarousel } from './ui/carouselView.js';
import { createLibraryViews } from './ui/libraryViews.js';
import { setupTvPlatform, isAndroidApp } from './core/platform.js';

setupTvPlatform();

const kv = createKV();
const LIB_KEY = 'library_v2';
// Pestaña "Externos" oculta temporalmente (planteamiento en revisión).
const SHOW_EXTERNALS_SECTION = true;
// Caché del procesado de títulos para cambios de pestaña rápidos (sin recalcular overrides/colecciones).
let HOME_PROCESSED = { ref: null, profileId: null };
// Títulos ya enviados a identificación TMDB en esta sesión (evita relanzar búsquedas en cada pestaña).
const TMDB_ATTEMPTED = new Set();
let BG_ENRICH = null;
const perfNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const perfLog = (msg) => console.log(`[perf] ${msg}`);

const app = document.getElementById('app');


function isTitleAllowedByProfileAge(title, profile) {
  const limit = profile?.maxAgeRating;
  if (!limit || limit === 'all' || limit === 'sin-limite') return true;
  const info = resolveTitleAgeRating(title);
  if (!info) return true;
  const label = String(info.label).toUpperCase();
  if (limit === '18') return label !== 'X';
  if (limit === '16') return label !== 'X' && label !== '18';
  if (limit === '12') return label !== 'X' && label !== '18' && label !== '16';
  if (limit === '7') return label === 'APTA' || label === '7';
  if (limit === 'APTA') return label === 'APTA';
  return true;
}

function showScreen(html) {
  app.innerHTML = html;
  window.scrollTo(0, 0);
}

function showLoading(msg = 'Cargando…') {
  showScreen(`
    <div class="screen center">
      <div class="loader"></div>
      <p>${msg}</p>
    </div>
  `);
}

function showError(msg) {
  showScreen(`
    <div class="screen center">
      <h2>Error</h2>
      <p style="color:#f88;margin:1rem 0;">${msg}</p>
      <button id="btn-retry" class="btn">Reintentar</button>
    </div>
  `);
  document.getElementById('btn-retry')?.addEventListener('click', start);
}

function promptUI(title, placeholder = '', type = 'text') {
  return new Promise((resolve) => {
    showScreen(`
      <div class="screen center">
        <h2>${title}</h2>
        <input id="prompt-input" type="${type}" placeholder="${placeholder}"
               style="margin:1.5rem 0;padding:0.8rem 1rem;width:min(320px,90%);font-size:1.1rem;border-radius:8px;border:1px solid #444;background:#1a1a1a;color:#fff;" />
        <button id="prompt-ok" class="btn">Continuar</button>
      </div>
    `);
    const input = document.getElementById('prompt-input');
    const btn = document.getElementById('prompt-ok');
    input?.focus();
    const submit = () => resolve(input?.value?.trim() || '');
    btn?.addEventListener('click', submit);
    input?.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  });
}

function promptPhoneUI() {
  return new Promise((resolve) => {
    showScreen(`
      <div class="screen center">
        <h2>Número de teléfono</h2>
        <p style="color:#aaa;font-size:0.95rem;margin-top:0.4rem;">Introduce tu prefijo y tu número de Telegram:</p>
        <div style="display:flex;gap:0.6rem;margin:1.5rem 0;width:min(340px,92%);align-items:center;justify-content:center;">
          <input id="prompt-phone-prefix" type="tel" inputmode="tel" data-focusable value="+34"
                 style="padding:0.8rem 0.6rem;width:76px;text-align:center;font-size:1.1rem;border-radius:8px;border:1px solid #444;background:#1a1a1a;color:#fff;" />
          <input id="prompt-phone-num" type="tel" inputmode="tel" data-focusable placeholder="600 000 000"
                 style="flex:1;padding:0.8rem 1rem;font-size:1.1rem;border-radius:8px;border:1px solid #444;background:#1a1a1a;color:#fff;" />
        </div>
        <button id="prompt-ok" class="btn" data-focusable>Continuar</button>
      </div>
    `);
    const prefixInput = document.getElementById('prompt-phone-prefix');
    const numInput = document.getElementById('prompt-phone-num');
    const btn = document.getElementById('prompt-ok');
    numInput?.focus();

    const submit = () => {
      let pref = prefixInput?.value?.trim() || '+34';
      if (!pref.startsWith('+')) pref = '+' + pref;
      const num = numInput?.value?.replace(/\s+/g, '').trim();
      if (!num) return;
      resolve(pref + num);
    };

    btn?.addEventListener('click', submit);
    numInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    prefixInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') numInput?.focus(); });
  });
}

function promptCodeUI() {
  return new Promise((resolve) => {
    showScreen(`
      <div class="screen center">
        <h2>Código de Telegram</h2>
        <p style="color:#aaa;font-size:0.95rem;margin-top:0.4rem;">Introduce el código numérico recibido en Telegram:</p>
        <input id="prompt-input" type="tel" inputmode="numeric" pattern="[0-9]*" autocomplete="one-time-code" data-focusable placeholder="12345"
               style="margin:1.5rem 0;padding:0.8rem 1rem;width:min(240px,90%);text-align:center;letter-spacing:0.3em;font-size:1.4rem;border-radius:8px;border:1px solid #444;background:#1a1a1a;color:#fff;" />
        <button id="prompt-ok" class="btn" data-focusable>Continuar</button>
      </div>
    `);
    const input = document.getElementById('prompt-input');
    const btn = document.getElementById('prompt-ok');
    input?.focus();
    const submit = () => resolve(input?.value?.trim() || '');
    btn?.addEventListener('click', submit);
    input?.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  });
}

function promptApiCredentialsUI() {
  return new Promise((resolve) => {
    showScreen(`
      <div class="screen center" style="max-width:440px;margin:0 auto;text-align:center;">
        <h2>Configurar Telegram API</h2>
        <p style="color:#aaa;font-size:0.9rem;margin:0.5rem 0 1.2rem;line-height:1.4;">
          Esta APK no tiene las credenciales incrustadas.<br>
          Introduce tu API ID y Hash de <strong style="color:#fff;">my.telegram.org</strong>:
        </p>
        <div style="display:flex;flex-direction:column;gap:0.8rem;width:100%;align-items:center;">
          <input id="prompt-api-id" type="number" placeholder="API ID (ej: 1234567)"
                 style="padding:0.8rem 1rem;width:min(320px,90%);font-size:1rem;border-radius:8px;border:1px solid #444;background:#1a1a1a;color:#fff;" />
          <input id="prompt-api-hash" type="text" placeholder="API Hash (32 caracteres)"
                 style="padding:0.8rem 1rem;width:min(320px,90%);font-size:1rem;border-radius:8px;border:1px solid #444;background:#1a1a1a;color:#fff;" />
          <button id="prompt-api-ok" class="btn" style="margin-top:0.4rem;width:min(320px,90%);">Guardar y Conectar</button>
        </div>
      </div>
    `);
    const idInput = document.getElementById('prompt-api-id');
    const hashInput = document.getElementById('prompt-api-hash');
    const btn = document.getElementById('prompt-api-ok');
    idInput?.focus();

    const submit = () => {
      const id = idInput?.value?.trim();
      const hash = hashInput?.value?.trim();
      if (!id || !hash) return;
      resolve({ apiId: id, apiHash: hash });
    };

    btn?.addEventListener('click', submit);
    hashInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    idInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') hashInput?.focus(); });
  });
}


// ---------- Home con biblioteca ----------
let TITLES_CACHE = null;
let ACTIVE_HOME_SECTION = 'inicio';
let metadataController = null;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtSize = (b) => b > 1e9 ? (b / 1e9).toFixed(2) + ' GB' : (b / 1e6).toFixed(0) + ' MB';
const fmtDur = (s) => s ? `${Math.floor(s / 3600) ? Math.floor(s / 3600) + 'h ' : ''}${Math.floor(s % 3600 / 60)}min` : '';

function formatPlayButtonLabel(t, st, progress) {
  if (!st?.next) return '';
  const isContinue = st.continueWatching && progress[st.next.key] && !progress[st.next.key].is_completed;
  const actionPrefix = isContinue ? '▶ Continuar' : '▶ Reproducir';

  if (t.tipo === 'serie') {
    const nextFile = st.next;
    const epNum = (nextFile.season || nextFile.episode)
      ? `T${nextFile.season || 1}·E${String(nextFile.episode || 1).padStart(2, '0')}`
      : '';
    const epName = nextFile.metadata?.name || prettyEpisodeName(nextFile.fileName || nextFile.label, t.metadata?.name || t.nombre);
    return `${actionPrefix} ${epNum ? epNum + ' - ' : ''}${epName}`;
  }

  if (t.isSaga) {
    const nextFile = st.next;
    const filmName = nextFile.metadata?.name || nextFile.sagaName || nextFile.label;
    return `${actionPrefix} ${filmName}`;
  }

  return actionPrefix;
}

function cardHtml(t, progress) {
  const st = titleState(t, progress);
  const p = st.next && progress[st.next.key];
  const pct = p && p.duration ? Math.min(100, p.current_time / p.duration * 100) : 0;
  const displayName = t.metadata?.name || t.metadata?.title || t.nombre;
  const metaBadge = t.tipo === 'serie' ? `${t.archivos.length} ep.` : t.isSaga ? `${t.archivos.length} películas` : t.tipo === 'deporte' ? 'Deporte' : t.tipo === 'musica' ? 'Música' : t.archivos.length > 1 ? `${t.archivos.length} vers.` : 'Película';
  const posterUrl = t.metadata?.poster;
  const localPoster = posterUrl ? (memoryCache.get(posterUrl) || posterUrl) : '';

  return `
    <div class="lib-card" tabindex="0" data-focusable data-title="${esc(t.id)}">
      <div class="lib-card-poster ${posterUrl ? 'has-poster' : ''}" style="--pc:${posterColor(t.grupo + t.nombre)}">
        ${posterUrl ? `<img class="poster-image" src="${esc(localPoster)}" data-poster-url="${esc(posterUrl)}" alt="${esc(displayName)}" loading="lazy" onerror="this.onerror=null;this.remove();">` : ''}
        <span class="poster-group">${esc(t.grupo)}</span>
        <span class="poster-name">${esc(displayName)}</span>
        <span class="poster-meta">${metaBadge}</span>
        ${pct ? `<div class="poster-progress"><i style="width:${pct}%"></i></div>` : ''}
      </div>
      <div class="lib-card-name">${esc(displayName)}</div>
    </div>`;
}

// Guarda en la caché local los metadatos de todos los títulos SIN las imágenes elegidas por el perfil
// (esas viajan en image_prefs y se reaplican al cargar; así "Restaurar original" siempre funciona).
async function persistTitlesMetadata() {
  try {
    const saved = await kv.get(LIB_KEY).catch(() => null);
    if (!saved) return;
    saved.metadataMap = saved.metadataMap || {};
    for (const t of (TITLES_CACHE || [])) {
      const meta = metadataForPersist(t);
      if (meta) saved.metadataMap[t.id] = meta;
      if (Array.isArray(t.archivos) && (t.isSaga || (t.tipo === 'pelicula' && t.archivos.length > 1))) {
        for (const f of t.archivos) {
          if (f.metadata) {
            const fKey = f.key || `${t.channel?.id || t.id}:${f.messageId}`;
            saved.metadataMap[fKey] = metadataForPersist(f);
          }
        }
      }
    }
    await kv.set(LIB_KEY, saved);
  } catch (_) {}
}

const libraryViews = createLibraryViews({
  applyProfileScale, setBackHandler, getTitles: () => TITLES_CACHE, setTitles: value => { TITLES_CACHE = value; },
  loadProgress, titleState, formatPlayButtonLabel, esc, posterColor, memoryCache, showScreen, cardHtml,
  loadPoster, applyImagePrefs, getAutoLogo, fmtDur, fmtSize, enrichTitle, showImagePicker,
  restoreOriginalImage, showMetadataModal, mergeMoviesByTmdb, attachAutoCollections, playFile, fetchSeasonEpisodes,
  centerSeason, firstUncompleted, adjacentSeason, isFavorite, toggleFavorite, toggleAllWatched,
  focusFirst, showHome, app, persistMetadata: persistTitlesMetadata,
});

// Lee los canales y solo vuelve a escanear los que han cambiado (o todos si force)
async function refreshLibrary(tg, { force = false, onProgress } = {}) {
  const client = tg.getClient();
  const channels = await loadLibrary(client);
  // En una actualización completa se invalida el caché de los canales TGStorage,
  // pero se conserva la biblioteca previa para restaurar los canales externos.
  const previousObj = await kv.get(LIB_KEY).catch(() => null);
  const savedObj = force ? null : previousObj;
  const saved = savedObj?.cache || {};
  const savedMeta = previousObj?.metadataMap || {};
  const { titles, cache } = await buildTitles(client, channels, tg.peerOf, onProgress, saved);

  // Reintegrar canales externos persistidos en external_sources_v1
  const extSources = (await kv.get('external_sources_v1').catch(() => [])) || [];
  const combinedCache = { ...(force ? (previousObj?.cache || {}) : saved), ...cache };

  for (const ext of extSources) {
    const extId = String(ext.id);
    const cachedFiles = combinedCache[extId];
    if (Array.isArray(cachedFiles) && cachedFiles.length > 0) {
      combinedCache[extId] = cachedFiles;
      const channelRecord = previousObj?.channels?.find(c => String(c.id) === extId) || {
        id: extId,
        name: ext.groupName || ext.title,
        group: ext.groupName || ext.title,
        category: ext.category || 'Películas',
        title: ext.title,
        isExternal: true,
        isTopic: Boolean(ext.isTopic),
        topicId: ext.topicId || null,
        channelId: ext.channelId || extId.split('_top_')[0],
        tgChannelId: ext.channelId || extId.split('_top_')[0],
        hash: ext.hash || ext.accessHash || '0',
        accessHash: ext.hash || ext.accessHash || '0',
      };
      const extTitles = buildTitlesForExternalChannel(channelRecord, cachedFiles);
      titles.push(...extTitles);
    }
  }

  if (savedMeta) {
    for (const t of titles) {
      if (savedMeta[t.id]) t.metadata = savedMeta[t.id];
      if (Array.isArray(t.archivos) && (t.isSaga || (t.tipo === 'pelicula' && t.archivos.length > 1))) {
        for (const f of t.archivos) {
          const fKey = f.key || `${t.channel?.id || t.id}:${f.messageId}`;
          if (savedMeta[fKey]) {
            f.metadata = savedMeta[fKey];
            f.tmdbId = savedMeta[fKey].id;
            if (savedMeta[fKey].name && t.isSaga) f.sagaName = savedMeta[fKey].name;
          }
        }
      }
    }
  }
  const sig = channels.map(c => `${c.id}:${c.top}:${c.title}`).sort().join('|');
  const metadataMap = { ...savedMeta };
  for (const t of titles) {
    if (t.metadata) metadataMap[t.id] = metadataForPersist(t);
    if (t.isSaga && Array.isArray(t.archivos)) {
      for (const f of t.archivos) {
        if (f.metadata) {
          const fKey = f.key || `${t.channel?.id || t.id}:${f.messageId}`;
          metadataMap[fKey] = f.metadata;
        }
      }
    }
  }

  // Conservar canales tgstorage y canales externos guardados
  const allChannels = [...channels];
  for (const ext of extSources) {
    const extId = String(ext.id);
    const existingRec = previousObj?.channels?.find(c => String(c.id) === extId);
    if (existingRec && !allChannels.some(c => String(c.id) === extId)) {
      allChannels.push(existingRec);
    }
  }

  await kv.set(LIB_KEY, { cache: combinedCache, channels: allChannels, sig, metadataMap, savedAt: Date.now() }).catch(e => console.warn('[kv]', e));
  return { titles, sig };
}


function showUpdateDialog({ onQuick, onFull }) {
  const { overlay, close } = modal("Actualizar biblioteca", `
    <div style="display:flex;flex-direction:column;gap:1rem;">
      <p style="color:#aaa;font-size:0.95rem;margin:0 0 0.2rem;">Selecciona el modo de actualización de canales y vídeos:</p>
      <div class="update-options-list" style="display:flex;flex-direction:column;gap:0.8rem;">
        <button class="btn btn-update-option" id="btn-update-quick" data-focusable style="text-align:left;padding:0.9rem 1.1rem;line-height:1.4;">
          <div style="font-weight:700;font-size:1.05rem;color:#fff;">⚡ Actualización rápida</div>
          <div style="font-size:0.85rem;color:#bbb;margin-top:0.25rem;">Sincroniza perfil (favoritos, carátulas y fondos), metadatos de TMDB y canales con nuevos vídeos.</div>
        </button>
        <button class="btn btn-secondary btn-update-option" id="btn-update-full" data-focusable style="text-align:left;padding:0.9rem 1.1rem;line-height:1.4;">
          <div style="font-weight:700;font-size:1.05rem;color:#fff;">🔄 Forzar actualización completa</div>
          <div style="font-size:0.85rem;color:#bbb;margin-top:0.25rem;">Reescanea todos los canales desde cero y regenera la biblioteca entera.</div>
        </button>
      </div>
    </div>
  `, "Comprueba nuevos vídeos o reescanea canales");

  overlay.querySelector("#btn-update-quick").onclick = () => { close(); onQuick(); };
  overlay.querySelector("#btn-update-full").onclick = () => { close(); onFull(); };

  setTimeout(() => {
    overlay.querySelector("#btn-update-quick")?.focus();
  }, 50);
}


export function isExternalTitle(t) {
  return Boolean(
    t?.origen?.tipo === 'externo' ||
    t?.channel?.isExternal ||
    t?.isExternal ||
    (typeof t?.channel?.id === 'string' && t.channel.id.includes('_top_'))
  );
}

let CHECKED = false;
function getSectionSort(profileId, sectionId) {
  try {
    return localStorage.getItem(`tg_sort_${profileId}_${sectionId}`) || 'nombre';
  } catch (_) {
    return 'nombre';
  }
}

function setSectionSort(profileId, sectionId, sortType) {
  try {
    localStorage.setItem(`tg_sort_${profileId}_${sectionId}`, sortType);
  } catch (_) {}
}

function getSectionSortOrder(profileId, sectionId, currentSort = 'nombre') {
  try {
    const saved = localStorage.getItem(`tg_sort_dir_${profileId}_${sectionId}`);
    if (saved === 'asc' || saved === 'desc') return saved;
  } catch (_) {}
  return currentSort === 'nombre' ? 'asc' : 'desc';
}

function setSectionSortOrder(profileId, sectionId, order) {
  try {
    localStorage.setItem(`tg_sort_dir_${profileId}_${sectionId}`, order);
  } catch (_) {}
}

function getSectionViewMode(profileId, sectionId) {
  try {
    return localStorage.getItem(`tg_view_${profileId}_${sectionId}`) || 'grid';
  } catch (_) {
    return 'grid';
  }
}

function setSectionViewMode(profileId, sectionId, viewMode) {
  try {
    localStorage.setItem(`tg_view_${profileId}_${sectionId}`, viewMode);
  } catch (_) {}
}

function nextViewMode(current) {
  if (current === 'grid') return 'posters';
  if (current === 'posters') return 'logos';
  return 'grid';
}

function viewModeShortLabel(mode) {
  if (mode === 'logos') return 'Logos';
  if (mode === 'posters') return 'Carrusel';
  return 'Cuadrícula';
}

function sortTitles(items, sortType, sortOrder = 'desc') {
  const list = [...items];
  const mult = sortOrder === 'asc' ? 1 : -1;

  if (sortType === 'estreno') {
    return list.sort((a, b) => {
      const dateA = a.metadata?.date || a.yearHint || a.metadata?.release_date || a.metadata?.first_air_date || '';
      const dateB = b.metadata?.date || b.yearHint || b.metadata?.release_date || b.metadata?.first_air_date || '';
      if (dateA && dateB) {
        const cmp = String(dateA).localeCompare(String(dateB));
        if (cmp !== 0) return cmp * mult;
      } else if (dateA && !dateB) {
        return sortOrder === 'asc' ? -1 : 1;
      } else if (!dateA && dateB) {
        return sortOrder === 'asc' ? 1 : -1;
      }
      const msgA = a.ultimoMensajeFecha || 0;
      const msgB = b.ultimoMensajeFecha || 0;
      if (msgB !== msgA) return (msgA - msgB) * mult;
      const nameA = a.metadata?.name || a.metadata?.title || a.nombre || '';
      const nameB = b.metadata?.name || b.metadata?.title || b.nombre || '';
      return nameA.localeCompare(nameB, 'es', { numeric: true, sensitivity: 'base' });
    });
  }
  if (sortType === 'puntuacion') {
    return list.sort((a, b) => {
      const rA = Number(a.metadata?.imdbRating ?? a.metadata?.rating) || 0;
      const rB = Number(b.metadata?.imdbRating ?? b.metadata?.rating) || 0;
      if (rB !== rA) return (rA - rB) * mult;
      const dateA = a.metadata?.date || a.yearHint || '';
      const dateB = b.metadata?.date || b.yearHint || '';
      if (dateA && dateB) {
        const cmp = String(dateA).localeCompare(String(dateB));
        if (cmp !== 0) return cmp * mult;
      }
      const nameA = a.metadata?.name || a.metadata?.title || a.nombre || '';
      const nameB = b.metadata?.name || b.metadata?.title || b.nombre || '';
      return nameA.localeCompare(nameB, 'es', { numeric: true, sensitivity: 'base' });
    });
  }
  return list.sort((a, b) => {
    const nameA = a.metadata?.name || a.metadata?.title || a.nombre || '';
    const nameB = b.metadata?.name || b.metadata?.title || b.nombre || '';
    return nameA.localeCompare(nameB, 'es', { numeric: true, sensitivity: 'base' }) * (sortOrder === 'desc' ? -1 : 1);
  });
}

function applyOverridesAndUnbundle(titles = []) {
  const unbundledTitles = [];
  for (const t of titles) {
    let ov = getOverride(t.id);
    if (!ov && t.tmdbId) ov = getOverrideByTmdbId(t.tmdbId);
    if (ov) {
      t.metadata = ov;
      t.tmdbId = ov.id || t.tmdbId;
    }

    if (t.isSaga && Array.isArray(t.archivos)) {
      for (const f of t.archivos) {
        const fileKey = f.key || `${t.channel?.id || t.id}:${f.messageId}`;
        const fOv = getOverride(fileKey) || (f.tmdbId ? getOverrideByTmdbId(f.tmdbId) : null);
        if (fOv) {
          f.metadata = fOv;
          f.tmdbId = fOv.id;
          if (fOv.name) f.sagaName = fOv.name;
        }
      }
      unbundledTitles.push(t);
    } else if (t.tipo === 'pelicula' && Array.isArray(t.archivos) && t.archivos.length > 1) {
      const remainingFiles = [];
      const titleTmdbId = String(t.metadata?.id || t.tmdbId || '');
      for (const f of t.archivos) {
        const fileKey = f.key || `${t.channel?.id || t.id}:${f.messageId}`;
        const fOv = getOverride(fileKey);
        if (fOv) {
          f.metadata = fOv;
          f.tmdbId = fOv.id;
          if (titleTmdbId && String(fOv.id) !== titleTmdbId) {
            unbundledTitles.push({
              id: fileKey,
              tipo: 'pelicula',
              isSaga: false,
              grupo: t.grupo || 'Películas',
              nombre: fOv.name || f.label,
              yearHint: fOv.date?.slice(0, 4) || null,
              origen: { tipo: 'año_container', channelId: String(f.channelId || t.channel?.id), messageId: f.messageId },
              channel: t.channel || f.channel,
              archivos: [f],
              ultimoMensajeFecha: f.date || t.ultimoMensajeFecha || 0,
              tmdbId: fOv.id,
              metadata: fOv,
            });
            continue;
          }
        }
        remainingFiles.push(f);
      }
      t.archivos = remainingFiles;
      if (t.archivos.length > 0) {
        unbundledTitles.push(t);
      }
    } else {
      unbundledTitles.push(t);
    }
  }
  return unbundledTitles;
}

async function loadAndSyncAll(tg, sync, profile, { force = false } = {}) {
  // 1. Sincronizar perfil y overrides desde Telegram
  showLoading('Sincronizando perfil…');
  try {
    if (sync) {
      await loadOverrides(sync).catch(e => console.warn('[overrides] sync error', e));
    }
    if (sync && profile?.id) {
      const remote = await sync.pullProfile(profile.id).catch(e => { console.warn('[sync] pullProfile error', e); return null; });
      if (remote) {
        if (remote.progress) {
          const mergedPrg = sync.mergeProgress(loadProgress(profile.id), remote.progress);
          writeFullProgress(profile.id, mergedPrg);
        }
        const remoteFavs = mergeFavorites(remote.favorites || [], remote.profile?.favorites || []);
        const localFavs = loadFavorites(profile.id);
        const mergedFavs = mergeFavorites(localFavs, remoteFavs);
        saveFavorites(profile.id, mergedFavs);
        profile.favorites = mergedFavs;

        const remoteImg = { ...(remote.image_prefs || {}), ...(remote.profile?.image_prefs || {}) };
        const mergedImg = await pullAndMergeImagePrefs(profile, sync, remoteImg);
        profile.image_prefs = mergedImg;

        if (remote.profile?.devices) {
          profile.devices = { ...(remote.profile.devices || {}), ...(profile.devices || {}) };
        }
        if (remote.profile?.ui_scale !== undefined && profile.ui_scale === undefined) {
          profile.ui_scale = remote.profile.ui_scale;
        }

        if (mergedFavs.length > remoteFavs.length) {
          sync.pushProfile({
            profile,
            progress: loadProgress(profile.id),
            favorites: mergedFavs,
            image_prefs: mergedImg,
          }).catch(e => console.warn('[sync] push merged error', e));
        }
      }
    }
  } catch (err) {
    console.warn('[sync] Error sincronizando perfil', err);
  }

  // 2. Comprobar canales y buscar nuevos vídeos
  showLoading('Comprobando nuevos vídeos…');
  const onProgress = (d, n) => {
    const p = document.querySelector('.screen.center p');
    if (p) p.textContent = `Buscando nuevos vídeos… ${d}/${n}`;
  };

  try {
    const refreshed = await refreshLibrary(tg, { force, onProgress });
    TITLES_CACHE = refreshed.titles || [];
  } catch (err) {
    console.error('Error cargando biblioteca', err);
    if (!TITLES_CACHE) TITLES_CACHE = [];
  }
  CHECKED = true;

  // 3. Aplicar overrides y separar versiones con identificación distinta
  let titles = applyOverridesAndUnbundle(TITLES_CACHE || []);
  titles = attachAutoCollections(mergeMoviesByTmdb(titles));
  TITLES_CACHE = titles;

  // 4. Identificar vídeos pendientes en TMDB antes de mostrar la home
  const pendingTitles = titles.filter(t => (!t.metadata || (t.isSaga && t.archivos?.some(f => !f.metadata))));
  pendingTitles.forEach(t => TMDB_ATTEMPTED.add(t.id));
  if (pendingTitles.length > 0) {
    showLoading(`Identificando vídeos con TMDB (0/${pendingTitles.length})…`);
    metadataController?.abort();
    metadataController = new AbortController();
    await enrichTitles(pendingTitles, {
      signal: metadataController.signal,
      onProgress: (d, total) => {
        const p = document.querySelector('.screen.center p');
        if (p) p.textContent = `Identificando vídeos con TMDB (${d}/${total})…`;
      },
    });
    persistTitlesMetadata();
    titles = attachAutoCollections(mergeMoviesByTmdb(titles));
    TITLES_CACHE = titles;
  }

  // 5. Aplicar preferencias de imagen del perfil y precalentar carátulas
  titles.forEach(t => applyImagePrefs(t, profile));
  showLoading('Cargando carátulas…');
  await prewarmPosterCache(titles);

  return TITLES_CACHE;
}

async function showHome(tg, sync, profile, { fast = false, reload = false, force = false, focusTitleId = null, focusRowId = null, focusCardIndex = null, focusExpandBtn = false, focusSort = null, focusSortToggle = false, focusViewBtn = false, selectedSection = ACTIVE_HOME_SECTION, fromPointer = false } = {}) {
  applyProfileScale(profile);
  if (selectedSection !== 'inicio') {
    setBackHandler(() => {
      destroyCarousel();
      showHome(tg, sync, profile, { selectedSection: 'inicio' });
    });
  } else {
    setBackHandler(() => showProfileSelector(tg, sync));
  }
  const tStart = perfNow();
  if (reload || !TITLES_CACHE) {
    TMDB_ATTEMPTED.clear();
    HOME_PROCESSED = { ref: null, profileId: null };
    await loadAndSyncAll(tg, sync, profile, { force });
    perfLog(`loadAndSyncAll ${Math.round(perfNow() - tStart)} ms`);
  }

  let titles = TITLES_CACHE || [];
  const canReuse = fast && !reload && HOME_PROCESSED.ref === TITLES_CACHE && HOME_PROCESSED.profileId === profile.id;
  if (canReuse) {
    perfLog(`showHome(${selectedSection}): procesado reutilizado (${titles.length} títulos)`);
  } else {
    const tProc = perfNow();
    titles = applyOverridesAndUnbundle(titles);
    titles = titles.filter(t => isTitleAllowedByProfileAge(t, profile));
    titles = attachAutoCollections(mergeMoviesByTmdb(titles));
    titles = titles.filter(t => isTitleAllowedByProfileAge(t, profile));
    TITLES_CACHE = titles;
    titles.forEach(t => applyImagePrefs(t, profile));
    const tPrewarm = perfNow();
    // Precalentar carátulas cacheadas en memoria para que se muestren en 0 ms
    await prewarmPosterCache(titles);
    perfLog(`showHome(${selectedSection}): procesado ${Math.round(tPrewarm - tProc)} ms, prewarm carátulas ${Math.round(perfNow() - tPrewarm)} ms (${titles.length} títulos)`);
    HOME_PROCESSED = { ref: titles, profileId: profile.id };
  }
  const tBuild = perfNow();

  const progress = loadProgress(profile.id);
  const rows = buildHomeRows(titles, progress, getNewsPrefs(profile));
  const titleById = new Map();
  for (const t of titles) {
    titleById.set(String(t.id), t);
    if (t.tmdbId) {
      if (!titleById.has(String(t.tmdbId))) titleById.set(String(t.tmdbId), t);
      if (!titleById.has(`tmdb:${t.tmdbId}`)) titleById.set(`tmdb:${t.tmdbId}`, t);
    }
    if (t.archivos) {
      for (const f of t.archivos) {
        const fileKey = `${f.channel}:${f.messageId}`;
        if (!titleById.has(fileKey)) titleById.set(fileKey, t);
      }
    }
  }
  const favIds = loadFavorites(profile.id);
  const seenFavs = new Set();
  const favoriteTitles = [];
  for (const id of favIds) {
    const t = titleById.get(String(id));
    if (t && !seenFavs.has(t.id)) {
      seenFavs.add(t.id);
      favoriteTitles.push(t);
    }
  }
  const externalTitles = titles.filter(t => isExternalTitle(t));
  const collectionTitles = titles.filter(t => (t.isSaga || t.metadata?.tipo === 'collection') && !isExternalTitle(t));
  const movieTitles = titles.filter(t => t.tipo === 'pelicula' && !t.isSaga && t.metadata?.tipo !== 'collection' && !isExternalTitle(t));
  const seriesTitles = titles.filter(t => t.tipo === 'serie' && !isExternalTitle(t));
  const sportTitles = titles.filter(t => t.tipo === 'deporte' && !isExternalTitle(t));
  const musicTitles = titles.filter(t => t.tipo === 'musica' && !isExternalTitle(t));

  const sectionDefs = [
    ...(titles.length ? [{ id: 'inicio', label: 'Inicio', items: titles }] : []),
    ...(favoriteTitles.length ? [{ id: 'favoritos', label: 'Favoritos', items: favoriteTitles }] : []),
    ...(movieTitles.length ? [{ id: 'peliculas', label: 'Películas', items: movieTitles }] : []),
    ...(seriesTitles.length ? [{ id: 'series', label: 'Series', items: seriesTitles }] : []),
    ...(sportTitles.length ? [{ id: 'deportes', label: 'Deportes', items: sportTitles }] : []),
    ...(musicTitles.length ? [{ id: 'musica', label: 'Música', items: musicTitles }] : []),
    ...(collectionTitles.length ? [{ id: 'colecciones', label: 'Colecciones', items: collectionTitles }] : []),
    ...(SHOW_EXTERNALS_SECTION && externalTitles.length ? [{ id: 'externos', label: 'Externos', items: externalTitles }] : []),
  ];
  const isSearch = selectedSection === 'buscar' && titles.length > 0;
  if (!isSearch && !sectionDefs.some(section => section.id === selectedSection)) selectedSection = sectionDefs[0]?.id || 'inicio';
  ACTIVE_HOME_SECTION = selectedSection;
  const activeSection = sectionDefs.find(section => section.id === selectedSection);

  const isCategorySection = selectedSection !== 'inicio' && !isSearch;
  const currentView = isCategorySection ? getSectionViewMode(profile.id, selectedSection) : 'grid';
  const isCarousel = isCategorySection && (currentView === 'posters' || currentView === 'logos');

  const categoryToolsHtml = (inHeader = false) => {
    const currentSort = getSectionSort(profile.id, selectedSection);
    const currentOrder = getSectionSortOrder(profile.id, selectedSection, currentSort);
    const isSortExpanded = false;
    return `
      <div class="${inHeader ? 'category-header--in-header' : 'category-header-inner'}" role="region" aria-label="Herramientas de ordenación y vista">
        <div class="category-sort-bar ${isSortExpanded ? 'is-expanded' : ''}" role="group" aria-label="Ordenar por">
          <button type="button" class="category-sort-toggle" data-focusable aria-expanded="${isSortExpanded}" aria-haspopup="true" title="Desplegar opciones de ordenación (actual: orden ${currentOrder === 'asc' ? 'ascendente' : 'descendente'})">
            <span class="category-sort-label">Ordenar:</span>
            <span class="category-sort-icon" aria-hidden="true">${currentOrder === 'asc' ? '↑' : '↓'}</span>
          </button>
          <div class="category-sort-options">
            <button type="button" class="category-sort-btn ${currentSort === 'nombre' ? 'active' : ''}" data-focusable data-sort="nombre" aria-pressed="${currentSort === 'nombre'}">Nombre</button>
            <button type="button" class="category-sort-btn ${currentSort === 'estreno' ? 'active' : ''}" data-focusable data-sort="estreno" aria-pressed="${currentSort === 'estreno'}">Fecha de estreno</button>
            <button type="button" class="category-sort-btn ${currentSort === 'puntuacion' ? 'active' : ''}" data-focusable data-sort="puntuacion" aria-pressed="${currentSort === 'puntuacion'}">Puntuación</button>
          </div>
        </div>
        <div class="category-views-bar" role="group" aria-label="Modo de vista">
          <span class="category-views-label">Vista:</span>
          <button type="button" class="category-view-btn" data-focusable data-view="${currentView}" title="Cambiar modo de vista" aria-label="Cambiar vista, actual: ${viewModeShortLabel(currentView)}">${viewModeShortLabel(currentView)}</button>
        </div>
      </div>`;
  };


  const body = !titles.length ? `
      <div class="home-empty"><h2>Hola, ${esc(profile.name)}</h2>
        <p>No se han encontrado canales de vídeo.</p>
        <p style="opacity:.6;margin-top:.5rem">Los canales deben terminar en <code>::Series::tgstorage</code> o <code>::Películas::tgstorage</code></p></div>`
    : isSearch ? searchViewHtml()
    : selectedSection !== 'inicio' ? (() => {
        const currentSort = getSectionSort(profile.id, selectedSection);
        const currentOrder = getSectionSortOrder(profile.id, selectedSection, currentSort);
        const sortedItems = sortTitles(activeSection?.items || [], currentSort, currentOrder);
        const initialChunk = isCarousel ? sortedItems : sortedItems.slice(0, 80);
        return `
      <section class="category-view ${isCarousel ? 'category-view--carousel' : 'category-view--grid'}" aria-label="${esc(activeSection?.label || '')}">
        ${isCarousel ? `<div class="carousel-host" id="carousel-host"></div>` : `<div class="category-grid">${initialChunk.map(t => cardHtml(t, progress)).join('')}</div>`}
      </section>`;
      })()
    : rows.map(r => `
      <section class="row" data-row-id="${esc(r.id)}">
        <div class="row-header">
          <h2 class="row-title">${esc(r.title)}</h2>
        </div>
        <div class="row-track">
          <div class="lib-card row-expand-card" tabindex="0" data-focusable data-row-id="${esc(r.id)}" title="Ver todos en cuadrícula" aria-label="Ver todos ${esc(r.title)}">
            <div class="row-expand-card-inner">
              <span class="row-expand-plus">+</span>
            </div>
          </div>
          ${r.items.map(t => cardHtml(t, progress)).join('')}
        </div>
      </section>`).join('');

  showScreen(`
    <div class="screen home-screen ${isCarousel ? 'home-screen--carousel' : ''}">
      <header class="home-header ${isCarousel ? 'home-header--carousel' : ''}">
        <div class="home-logo" id="home-logo" title="TGVideo" role="banner">TGVideo</div>
        ${sectionDefs.length ? `<nav class="home-nav" aria-label="Secciones"><button class="home-nav-item nav-search-btn ${isSearch ? 'active' : ''}" data-focusable data-section="buscar" type="button" aria-label="Buscar" title="Buscar" aria-current="${isSearch ? 'page' : 'false'}"><span class="nav-search-icon" aria-hidden="true">🔍</span></button>${sectionDefs.map(section => `<button class="home-nav-item ${section.id === selectedSection ? 'active' : ''}" data-focusable data-section="${esc(section.id)}" type="button" aria-current="${section.id === selectedSection ? 'page' : 'false'}">${esc(section.label)}</button>`).join('')}</nav>` : ''}
        ${isCategorySection ? categoryToolsHtml(true) : ''}
        <div class="home-actions">
          <button class="btn-icon" data-focusable id="btn-reload" title="Actualizar biblioteca" aria-label="Actualizar">↻</button>
          <div class="home-profile" tabindex="0" data-focusable id="btn-change-profile" title="${esc(profile.name)}" aria-label="Perfil: ${esc(profile.name)}">
            <div class="avatar small">${profileAvatar(profile)}</div>
            <span class="profile-update-dot" id="profile-update-dot" style="display:none;" title="Nueva versión disponible"></span>
          </div>
        </div>
      </header>
      <main class="home-main ${isCarousel ? 'home-main--carousel' : ''}">${body}</main>
    </div>`);

  const activeNav = document.querySelector('.home-nav-item.active');
  if (activeNav) {
    requestAnimationFrame(() => {
      activeNav.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
    });
  }

  document.querySelectorAll('.home-nav-item').forEach(button => {
    button.onclick = (e) => {
      button.blur();
      button.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
      destroyCarousel();
      perfLog(`click pestaña -> ${button.dataset.section}`);
      showHome(tg, sync, profile, { fast: true, selectedSection: button.dataset.section, fromPointer: e.detail > 0 });
    };
  });
  if (isSearch) {
    mountSearchView({
      titles,
      cardHtml: t => cardHtml(t, progress),
      onOpen: t => libraryViews.showDetail(tg, sync, profile, t),
      afterRender: root => root.querySelectorAll('.lib-card-poster img.poster-image').forEach(img => {
        const url = img.getAttribute('data-poster-url') || img.src;
        if (url) loadPoster(img, url);
      }),
    });
    setBackHandler(() => showHome(tg, sync, profile, { selectedSection: 'inicio' }));
  }
  // Plegado y despliegue del selector "Ordenar:"
  const sortBar = document.querySelector('.category-sort-bar:not(.search-bar)');
  const sortToggle = document.querySelector('.category-sort-toggle');
  if (sortBar && sortToggle) {
    const expandSort = () => {
      sortBar.classList.add('is-expanded');
      sortToggle.setAttribute('aria-expanded', 'true');
    };
    const collapseSort = () => {
      sortBar.classList.remove('is-expanded');
      sortToggle.setAttribute('aria-expanded', 'false');
    };

    sortToggle.onclick = (e) => {
      e.stopPropagation();
      const isExpanded = sortBar.classList.contains('is-expanded');
      if (isExpanded) {
        collapseSort();
      } else {
        expandSort();
        const activeBtn = sortBar.querySelector('.category-sort-btn.active') || sortBar.querySelector('.category-sort-btn');
        activeBtn?.focus();
      }
    };

    // Prevenir que toques dentro de la barra en iOS/iPhone disparen cierres accidentales
    sortBar.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
    });

    sortBar.addEventListener('focusout', (e) => {
      // Solo colapsar si el foco realmente se movió a otro elemento interactivo fuera de sortBar.
      // En dispositivos táctiles (iOS/iPhone) e.relatedTarget es null al tocar un botón,
      // lo que causaba que el menú se cerrara antes de procesar el evento click.
      if (e.relatedTarget && !sortBar.contains(e.relatedTarget)) {
        collapseSort();
      }
    });

    const handleOutsideSort = (e) => {
      if (!sortBar.contains(e.target)) {
        collapseSort();
      }
    };
    document.addEventListener('pointerdown', handleOutsideSort, { passive: true });
  }

  document.querySelectorAll('.category-sort-btn').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      btn.blur();
      const sortType = btn.dataset.sort;
      const currentSort = getSectionSort(profile.id, selectedSection);
      const currentOrder = getSectionSortOrder(profile.id, selectedSection, currentSort);

      if (sortType === currentSort) {
        // Al pulsar sobre el que ya estaba seleccionado, se cambia el sentido (ascendente/descendente)
        const nextOrder = currentOrder === 'desc' ? 'asc' : 'desc';
        setSectionSortOrder(profile.id, selectedSection, nextOrder);
      } else {
        // Al seleccionar un nuevo criterio, se aplica su orden por defecto
        const defaultOrder = sortType === 'nombre' ? 'asc' : 'desc';
        setSectionSort(profile.id, selectedSection, sortType);
        setSectionSortOrder(profile.id, selectedSection, defaultOrder);
      }
      showHome(tg, sync, profile, { fast: true, selectedSection, focusSortToggle: true, fromPointer: e.detail > 0 });
    };
  });
  const viewBtn = document.querySelector('.category-view-btn');
  if (viewBtn) {
    viewBtn.onclick = (e) => {
      e.stopPropagation();
      const current = getSectionViewMode(profile.id, selectedSection);
      const next = nextViewMode(current);
      setSectionViewMode(profile.id, selectedSection, next);
      showHome(tg, sync, profile, { fast: true, selectedSection, focusViewBtn: true, fromPointer: e.detail > 0 });
    };
  }

  if (isCarousel) {
    const carouselHost = document.getElementById('carousel-host');
    if (carouselHost && activeSection?.items) {
      const currentSort = getSectionSort(profile.id, selectedSection);
      const currentOrder = getSectionSortOrder(profile.id, selectedSection, currentSort);
      const sortedItems = sortTitles(activeSection?.items || [], currentSort, currentOrder);
      mountCarousel(carouselHost, {
        items: sortedItems,
        mode: currentView,
        initialId: focusTitleId,
        allTitles: titles,
        onOpen: (t) => {
          if (t) libraryViews.showDetail(tg, sync, profile, t);
        },
      });
    }
  } else {
    destroyCarousel();
  }
  document.getElementById('btn-change-profile').onclick = () => showProfileMenu({ profile, sync, libraryTitles: titles,
    onSwitch: () => showProfileSelector(tg, sync), onChanged: () => showHome(tg, sync, profile),
    onOpenAdmin: () => showAdminView({ tg, sync, profile, titles: TITLES_CACHE, onBack: () => showHome(tg, sync, profile) }),
    onGlobalChanged: () => { TITLES_CACHE?.forEach(t => delete t.metadata); showHome(tg, sync, profile); } });
    if (isAndroidApp()) {
    checkForUpdate().then(updateInfo => {
      if (updateInfo?.hasUpdate) {
        const dot = document.getElementById('profile-update-dot');
        if (dot) dot.style.display = 'block';
      }
    }).catch(() => {});
  }

  document.getElementById('btn-reload').onclick = () => {
    showUpdateDialog({
      onQuick: () => showHome(tg, sync, profile, { reload: true, force: false }),
      onFull: () => showHome(tg, sync, profile, { reload: true, force: true }),
    });
  };

  document.querySelectorAll('#app .row-expand-card').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const rowId = btn.dataset.rowId;
      const r = rows.find(x => x.id === rowId);
      if (r) libraryViews.showGroupGrid(tg, sync, profile, r);
    };
  });
  document.querySelectorAll('#app .category-grid .lib-card[data-title]').forEach(card => {
    card.onclick = () => {
      const t = titles.find(x => String(x.id) === String(card.dataset.title));
      if (t) libraryViews.showDetail(tg, sync, profile, t);
    };
  });

  // Carga progresiva en cuadrícula de sección (evita bloquear la interfaz en colecciones de miles de títulos)
  if (!isCarousel && isCategorySection && activeSection?.items) {
    const currentSort = getSectionSort(profile.id, selectedSection);
    const currentOrder = getSectionSortOrder(profile.id, selectedSection, currentSort);
    const fullSorted = sortTitles(activeSection.items || [], currentSort, currentOrder);
    const gridEl = document.querySelector('.category-grid');
    if (gridEl && fullSorted.length > 80) {
      let loadedCards = 80;
      const onCategoryScroll = () => {
        if (!gridEl.isConnected || loadedCards >= fullSorted.length) {
          window.removeEventListener('scroll', onCategoryScroll);
          return;
        }
        if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 800) {
          const nextBatch = fullSorted.slice(loadedCards, loadedCards + 60);
          loadedCards += nextBatch.length;
          const range = document.createRange();
          const frag = range.createContextualFragment(nextBatch.map(t => cardHtml(t, progress)).join(''));
          frag.querySelectorAll('.lib-card[data-title]').forEach(card => {
            card.onclick = () => {
              const t = titles.find(x => String(x.id) === String(card.dataset.title));
              if (t) libraryViews.showDetail(tg, sync, profile, t);
            };
          });
          frag.querySelectorAll('.lib-card-poster img.poster-image').forEach(img => {
            const url = img.getAttribute('data-poster-url') || img.src;
            if (url) loadPoster(img, url);
          });
          gridEl.appendChild(frag);
        }
      };
      window.addEventListener('scroll', onCategoryScroll, { passive: true });
    }
  }
  document.querySelectorAll('#app .row').forEach(rowEl => {
    const rowId = rowEl.dataset.rowId;
    rowEl.querySelectorAll('.lib-card[data-title]').forEach((card, idx) => {
      card.onclick = () => {
        const t = titles.find(x => String(x.id) === String(card.dataset.title));
        if (t) libraryViews.showDetail(tg, sync, profile, t, { fromRowId: rowId, fromCardIndex: idx + 1 });
      };
    });
  });
  document.querySelectorAll('.lib-card-poster img.poster-image').forEach(img => {
    const url = img.getAttribute('data-poster-url') || img.src;
    if (url) loadPoster(img, url);
  });


  setTimeout(() => {
    let el = null;
    if (focusViewBtn) {
      el = document.querySelector('.category-view-btn');
    } else if (focusSortToggle) {
      el = document.querySelector('.category-sort-toggle');
    } else if (focusSort && !fromPointer) {
      document.querySelector('.category-sort-bar')?.classList.add('is-expanded');
      el = document.querySelector(`.category-sort-btn[data-sort="${focusSort}"]`);
    } else if (isCarousel) {
      el = document.querySelector('.carousel-stage');
    }
    if (focusRowId && focusExpandBtn) {
      el = document.querySelector(`.row[data-row-id="${focusRowId}"] .row-expand-card`);
    } else if (focusRowId && focusTitleId) {
      el = document.querySelector(`.row[data-row-id="${focusRowId}"] .lib-card[data-title="${focusTitleId}"]`);
    }
    if (!el && focusRowId && typeof focusCardIndex === "number") {
      const row = document.querySelector(`.row[data-row-id="${focusRowId}"]`);
      el = row?.querySelectorAll(".row-track > [data-focusable]")?.[focusCardIndex];
    }
    if (!el && focusTitleId) {
      el = document.querySelector(`.lib-card[data-title="${focusTitleId}"]`);
    }
    if (!el && isSearch) {
      el = focusTitleId ? document.querySelector(`#search-results .lib-card[data-title="${focusTitleId}"]`) : null;
      el ||= document.getElementById('search-input');
      if (el) { el.focus({ preventScroll: true }); return; }
    }
    if (!el && !fromPointer) {
      // Categorías enfocan su pestaña activa en navegación D-Pad; Inicio mantiene el foco en la primera carátula.
      el = selectedSection !== 'inicio' ? document.querySelector('.home-nav-item.active') : null;
      el ||= document.querySelector('.row[data-row-id="continue"] .row-track .lib-card[data-title]')
        || document.querySelector('.row-track .lib-card[data-title]');
    }
    if (!el && !fromPointer) {
      el = document.querySelector('.home-nav-item.active, [data-focusable]');
    }
    if (el) {
      if (el.closest('.row')) {
        // Fila de la home: un único desplazamiento (centrada; la primera fila al tope con su título entero)
        focusInRow(el, { behavior: fromPointer ? 'auto' : 'smooth' });
      } else {
        el.focus({ preventScroll: true });
        if (!fromPointer) el.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
      }
    }
  }, 80);
  perfLog(`showHome(${selectedSection}): render HTML+eventos ${Math.round(perfNow() - tBuild)} ms, total ${Math.round(perfNow() - tStart)} ms`);
  requestAnimationFrame(() => requestAnimationFrame(() => perfLog(`showHome(${selectedSection}): pintado en pantalla ${Math.round(perfNow() - tStart)} ms`)));

  let metaSaveTimer = null;
  const saveMetaDebounced = () => {
    clearTimeout(metaSaveTimer);
    metaSaveTimer = setTimeout(persistTitlesMetadata, 1500);
  };

  let reattachTimer = null;
  const scheduleReattach = () => {
    clearTimeout(reattachTimer);
    reattachTimer = setTimeout(() => {
      if (!metadataController.signal.aborted && TITLES_CACHE) {
        const beforeCount = TITLES_CACHE.length;
        const newTitles = attachAutoCollections(mergeMoviesByTmdb(TITLES_CACHE));
        if (newTitles.length !== beforeCount) {
          TITLES_CACHE = newTitles;
          if (document.querySelector('.home-screen') && !document.querySelector('.carousel-stage:focus, .carousel-stage.dpad-focused') && (selectedSection === 'inicio' || selectedSection === 'colecciones')) {
            showHome(tg, sync, profile, { focusSort: getSectionSort(profile.id, selectedSection), fromPointer: true });
          }
        }
      }
    }, 2500);
  };

  const pendingBg = titles.filter(t => !TMDB_ATTEMPTED.has(t.id) && (!t.metadata || (t.isSaga && t.archivos?.some(f => !f.metadata))));
  if (BG_ENRICH && BG_ENRICH.profileId === profile.id) {
    if (pendingBg.length) perfLog(`TMDB en segundo plano ya en curso; ${pendingBg.length} pendientes nuevos esperan`);
  } else if (pendingBg.length > 0) {
    metadataController?.abort();
    metadataController = new AbortController();
    pendingBg.forEach(t => TMDB_ATTEMPTED.add(t.id));
    const bgRun = { profileId: profile.id };
    BG_ENRICH = bgRun;
    const tEnrich = perfNow();
    perfLog(`TMDB segundo plano: ${pendingBg.length} títulos`);
    enrichTitles(pendingBg, { signal: metadataController.signal, onUpdate: title => {
      applyImagePrefs(title, profile);
      saveMetaDebounced();
      if (title.metadata?.collection || (title.isSaga && title.archivos?.some(f => f.metadata))) {
        scheduleReattach();
      }
      document.querySelectorAll('.lib-card').forEach(card => {
        if (String(card.dataset.title) !== String(title.id)) return;
        const displayName = title.metadata?.name || title.metadata?.title || title.nombre;
        const nameEl = card.querySelector('.lib-card-name');
        if (nameEl && displayName) nameEl.textContent = displayName;
        const posterNameEl = card.querySelector('.poster-name');
        if (posterNameEl && displayName) posterNameEl.textContent = displayName;

        if (!title.metadata?.poster) return;
        const poster = card.querySelector('.lib-card-poster');
        if (!poster) return;
        let image = poster.querySelector('img.poster-image');
        if (!image) {
          image = document.createElement('img');
          image.className = 'poster-image';
          image.alt = displayName;
          image.loading = 'lazy';
          image.setAttribute('data-poster-url', title.metadata.poster);
          poster.prepend(image);
        }
        loadPoster(image, title.metadata.poster);
      });
      if (String(document.querySelector('.detail')?.dataset.title) === String(title.id)) {
        libraryViews.applyDetailMetadata(title, profile);
        if (title.isSaga) libraryViews.applySagaFilmMetadata(title);
      }
    } }).then(() => {
      // Tras enriquecer, re-agrupar películas con el mismo TMDB y colecciones automáticas
      if (!metadataController.signal.aborted && TITLES_CACHE) {
        const before = TITLES_CACHE.length;
        TITLES_CACHE = attachAutoCollections(mergeMoviesByTmdb(TITLES_CACHE));
        if (TITLES_CACHE.length !== before && document.querySelector('.home-screen') && !document.querySelector('.carousel-stage:focus, .carousel-stage.dpad-focused') && (selectedSection === 'inicio' || selectedSection === 'colecciones')) {
          showHome(tg, sync, profile, { selectedSection: ACTIVE_HOME_SECTION, focusSort: getSectionSort(profile.id, ACTIVE_HOME_SECTION), fromPointer: true });
        }
      }
    }).catch(() => {}).finally(() => {
      perfLog(`TMDB segundo plano terminado en ${Math.round(perfNow() - tEnrich)} ms`);
      if (BG_ENRICH === bgRun) BG_ENRICH = null;
    });
  }
}

// ---------- Selector de perfiles ----------
async function showProfileSelector(tg, sync) {
  applyProfileScale(null);
  showLoading('Cargando perfiles…');

  let profiles = [];
  try {
    profiles = await sync.listProfiles();
  } catch (err) {
    console.warn('No se pudieron cargar perfiles', err);
  }

  const cards = profiles.map(p => `
    <div class="profile-card" tabindex="0" data-focusable data-id="${p.id}">
      <div class="avatar">${profileAvatar(p)}</div>
      <div class="profile-name">${esc(p.name)}</div>
    </div>
  `).join('');

  const addCard = `
    <div class="profile-card add-profile" tabindex="0" data-focusable id="btn-add-profile">
      <div class="avatar add">+</div>
      <div class="profile-name">Añadir perfil</div>
    </div>
  `;

  showScreen(`
    <div class="screen profiles-screen">
      <h1 class="profiles-title">¿Quién está ahí?</h1>
      <div class="profiles-grid">
        ${cards}
        ${addCard}
      </div>
      <button id="btn-logout" data-focusable class="logout-btn">Cerrar sesión</button>
    </div>
  `);

  const lastProfileId = localStorage.getItem('tgvideo_last_profile_id') || profiles[0]?.id;
  setTimeout(() => {
    let target = null;
    if (lastProfileId) {
      target = document.querySelector(`.profile-card[data-id="${lastProfileId}"]`);
    }
    if (!target) {
      target = document.querySelector('.profile-card[data-id], #btn-add-profile');
    }
    if (target) {
      target.focus();
      target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    }
  }, 60);

  document.querySelectorAll('.profile-card[data-id]').forEach(card => {
    card.addEventListener('click', async () => {
      const id = card.dataset.id;
      const profile = profiles.find(p => p.id === id);
      if (profile) {
        localStorage.setItem('tgvideo_last_profile_id', profile.id);
      }
      if (profile) {
        await loadAndSyncAll(tg, sync, profile);

        if (isDevLogEnabled()) {
          startDevLogging({
            getClient: () => tg.getClient(),
            peerOf: tg.peerOf,
            profile,
            sync,
          });
        }

        showHome(tg, sync, profile);
      }
    });
  });

  document.getElementById('btn-add-profile')?.addEventListener('click', async () => {
    const name = await promptUI('Nombre del perfil', 'Ej: Papá, Niños…');
    if (!name) return showProfileSelector(tg, sync);

    const chosenAvatar = await pickAvatar({ name, current: null, title: 'Elige tu avatar', confirmLabel: 'Crear perfil' });
    if (chosenAvatar === null) return showProfileSelector(tg, sync);

    const cleanId = name
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    const profileId = cleanId && cleanId !== 'perfil' && cleanId !== 'default'
      ? cleanId
      : `usr_${Date.now().toString(36)}`;

    const newProfile = {
      v: 1,
      profile: {
        id: profileId,
        name: name.trim(),
        avatar: chosenAvatar,
        age_limit: '+18',
        pin: null,
        is_kids: false,
        player: 'artplayer',
      },
      progress: {},
      recent: [],
      prefs: {},
    };

    showLoading('Creando perfil…');
    try {
      await sync.pushProfile(newProfile);
      await showProfileSelector(tg, sync);
    } catch (err) {
      showError(err?.message || String(err));
    }
  });

  document.getElementById('btn-logout')?.addEventListener('click', async () => {
    await tg.logout();
    initDpad();
    start();
  });
}

// ---------- Arranque ----------
async function start() {
  setupTvPlatform();
  applyProfileScale(null);
  showLoading('Conectando con Telegram…');

  const tg = createTelegramClient({
    promptPhone: () => promptPhoneUI(),
    promptCode: () => promptCodeUI(),
    promptPassword: () => promptUI('Contraseña 2FA', 'Tu contraseña', 'password'),
    promptApiCredentials: () => promptApiCredentialsUI(),
    onError: (err) => showError(err?.message || String(err)),
  });

  try {
    await tg.ready();

    const sync = createTelegramSync({
      getClient: async () => {
        await tg.ready();
        return tg.getClient();
      },
      peerOf: tg.peerOf,
    });

    window.tg = tg;
    window.sync = sync;
    initContextMenu({ tg, getTitles: () => TITLES_CACHE });

    await loadGlobalConfig(sync);
    await loadOverrides(sync).catch(e => console.warn('[overrides]', e));
    await showProfileSelector(tg, sync);

  } catch (err) {
    console.error(err);
    showError(err?.message || String(err));
  }
}

hookConsole();
initDpad();
start();