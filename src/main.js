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
import './style.css';
import { createTelegramClient } from './core/telegram.js';
import { createTelegramSync } from './sync/telegramSync.js';
import { loadLibrary } from './library/channels.js';
import { buildTitles, mergeMoviesByTmdb } from './library/titles.js';
import { buildHomeRows, posterColor } from './ui/home.js';
import { initDpad, setBackHandler, focusFirst } from './ui/dpad.js';
import { loadProgress, loadFavorites, saveFavorites, mergeFavorites, writeFullProgress, titleState, isFavorite, toggleFavorite, toggleAllWatched } from './player/progress.js';
import { playFile } from './player/player.js';
import { createKV } from './core/kv.js';
import { enrichTitles, enrichTitle, fetchSeasonEpisodes } from './metadata/tmdb.js';
import { loadPoster, prewarmPosterCache, memoryCache } from './metadata/posterCache.js';
import { prettyEpisodeName } from './library/parse.js';
import { showMetadataModal } from './ui/metadataModal.js';
import { showImagePicker } from './ui/imagePickerModal.js';
import { getAutoLogo } from './metadata/autoLogo.js';
import { applyImagePrefs, restoreOriginalImage, syncImagePrefsWithRemote, readImagePrefs } from './metadata/imagePrefs.js';
import { hookConsole, isDevLogEnabled, startDevLogging } from './utils/devLogger.js';
import { loadGlobalConfig } from './settings/global.js';
import { loadOverrides, getOverride, getOverrideByTmdbId } from './metadata/overrides.js';
import { showProfileMenu, profileAvatar, applyProfileScale, modal } from './ui/settings.js';
import { adjacentSeason, firstUncompleted, centerSeason } from './ui/seasons.js';
import { createLibraryViews } from './ui/libraryViews.js';

const kv = createKV();
const LIB_KEY = 'library_v2';

const app = document.getElementById('app');

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

const libraryViews = createLibraryViews({
  applyProfileScale, setBackHandler, getTitles: () => TITLES_CACHE, setTitles: value => { TITLES_CACHE = value; },
  loadProgress, titleState, formatPlayButtonLabel, esc, posterColor, memoryCache, showScreen, cardHtml,
  loadPoster, applyImagePrefs, getAutoLogo, fmtDur, fmtSize, enrichTitle, showImagePicker,
  restoreOriginalImage, showMetadataModal, mergeMoviesByTmdb, playFile, fetchSeasonEpisodes,
  centerSeason, firstUncompleted, adjacentSeason, isFavorite, toggleFavorite, toggleAllWatched,
  focusFirst, showHome, app,
});

// Lee los canales y solo vuelve a escanear los que han cambiado (o todos si force)
async function refreshLibrary(tg, { force = false, onProgress } = {}) {
  const client = tg.getClient();
  const channels = await loadLibrary(client);
  const savedObj = force ? null : await kv.get(LIB_KEY).catch(() => null);
  const saved = savedObj?.cache || {};
  const savedMeta = savedObj?.metadataMap || {};
  const { titles, cache } = await buildTitles(client, channels, tg.peerOf, onProgress, saved);
  if (savedMeta) {
    for (const t of titles) {
      if (savedMeta[t.id]) t.metadata = savedMeta[t.id];
    }
  }
  const sig = channels.map(c => `${c.id}:${c.top}:${c.title}`).sort().join('|');
  const metadataMap = { ...savedMeta };
  for (const t of titles) {
    if (t.metadata) metadataMap[t.id] = t.metadata;
  }
  await kv.set(LIB_KEY, { cache, channels, sig, metadataMap, savedAt: Date.now() }).catch(e => console.warn('[kv]', e));
  return { titles, sig };
}


function showUpdateDialog({ onQuick, onFull }) {
  const { overlay, close } = modal("Actualizar biblioteca", `
    <div style="display:flex;flex-direction:column;gap:1rem;">
      <p style="color:#aaa;font-size:0.95rem;margin:0 0 0.2rem;">Selecciona el modo de actualización de canales y vídeos:</p>
      <div class="update-options-list" style="display:flex;flex-direction:column;gap:0.8rem;">
        <button class="btn btn-update-option" id="btn-update-quick" data-focusable style="text-align:left;padding:0.9rem 1.1rem;line-height:1.4;">
          <div style="font-weight:700;font-size:1.05rem;color:#fff;">⚡ Actualización rápida</div>
          <div style="font-size:0.85rem;color:#bbb;margin-top:0.25rem;">Comprueba únicamente canales con nuevos mensajes o vídeos desde la última lectura.</div>
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

function sortTitles(items, sortType) {
  const list = [...items];
  if (sortType === 'estreno') {
    return list.sort((a, b) => {
      const dateA = a.metadata?.date || a.yearHint || a.metadata?.release_date || a.metadata?.first_air_date || '';
      const dateB = b.metadata?.date || b.yearHint || b.metadata?.release_date || b.metadata?.first_air_date || '';
      if (dateA && dateB) {
        const cmp = String(dateB).localeCompare(String(dateA));
        if (cmp !== 0) return cmp;
      } else if (dateA && !dateB) {
        return -1;
      } else if (!dateA && dateB) {
        return 1;
      }
      const msgA = a.ultimoMensajeFecha || 0;
      const msgB = b.ultimoMensajeFecha || 0;
      if (msgB !== msgA) return msgB - msgA;
      const nameA = a.metadata?.name || a.metadata?.title || a.nombre || '';
      const nameB = b.metadata?.name || b.metadata?.title || b.nombre || '';
      return nameA.localeCompare(nameB, 'es', { numeric: true, sensitivity: 'base' });
    });
  }
  if (sortType === 'puntuacion') {
    return list.sort((a, b) => {
      const rA = Number(a.metadata?.rating) || 0;
      const rB = Number(b.metadata?.rating) || 0;
      if (rB !== rA) return rB - rA;
      const dateA = a.metadata?.date || a.yearHint || '';
      const dateB = b.metadata?.date || b.yearHint || '';
      if (dateA && dateB) {
        const cmp = String(dateB).localeCompare(String(dateA));
        if (cmp !== 0) return cmp;
      }
      const nameA = a.metadata?.name || a.metadata?.title || a.nombre || '';
      const nameB = b.metadata?.name || b.metadata?.title || b.nombre || '';
      return nameA.localeCompare(nameB, 'es', { numeric: true, sensitivity: 'base' });
    });
  }
  return list.sort((a, b) => {
    const nameA = a.metadata?.name || a.metadata?.title || a.nombre || '';
    const nameB = b.metadata?.name || b.metadata?.title || b.nombre || '';
    return nameA.localeCompare(nameB, 'es', { numeric: true, sensitivity: 'base' });
  });
}

async function showHome(tg, sync, profile, { reload = false, force = false, focusTitleId = null, focusRowId = null, focusCardIndex = null, focusExpandBtn = false, focusSort = null, selectedSection = ACTIVE_HOME_SECTION } = {}) {
  applyProfileScale(profile);
  setBackHandler(() => showProfileSelector(tg, sync));
  const onProgress = (d, n) => { const p = document.querySelector('.screen p'); if (p) p.textContent = `Leyendo canales… ${d}/${n}`; };
  if (reload) {
    showLoading(force ? 'Reescaneando toda la biblioteca…' : 'Buscando nuevos vídeos…');
    try { TITLES_CACHE = (await refreshLibrary(tg, { force, onProgress })).titles; CHECKED = true; }
    catch (err) { console.error('Error cargando biblioteca', err); TITLES_CACHE = TITLES_CACHE || []; }
  } else if (!TITLES_CACHE) {
    const saved = await kv.get(LIB_KEY).catch(() => null);
    if (saved?.cache && saved.channels) {
      // Biblioteca local: se muestra al instante sin leer Telegram
      const { titles } = await buildTitles(null, saved.channels, tg.peerOf, null, saved.cache);
      if (saved.metadataMap) {
        for (const t of titles) {
          if (saved.metadataMap[t.id]) t.metadata = saved.metadataMap[t.id];
        }
      }
      TITLES_CACHE = titles;
    } else {
      showLoading('Cargando biblioteca…');
      try { TITLES_CACHE = (await refreshLibrary(tg, { onProgress })).titles; CHECKED = true; }
      catch (err) { console.error('Error cargando biblioteca', err); TITLES_CACHE = []; }
    }
  }
  // Una vez por sesión: comprobar en segundo plano si algún canal ha cambiado
  if (!CHECKED) {
    CHECKED = true;
    const before = (await kv.get(LIB_KEY).catch(() => null))?.sig;
    refreshLibrary(tg).then(({ titles, sig }) => {
      if (sig === before) return;
      const existingMeta = new Map();
      (TITLES_CACHE || []).forEach(t => { if (t.metadata) existingMeta.set(String(t.id), t.metadata); });
      titles.forEach(t => { if (existingMeta.has(String(t.id))) t.metadata = existingMeta.get(String(t.id)); });
      TITLES_CACHE = titles;
      if (document.querySelector('.home-screen')) showHome(tg, sync, profile);
    }).catch(e => console.warn('[library] comprobación fallida', e));
  }
  let titles = TITLES_CACHE || [];

  // Aplicar overrides (incl. reenvíos por TMDB) y re-agrupar películas
  for (const t of titles) {
    let ov = getOverride(t.id);
    if (!ov && t.tmdbId) ov = getOverrideByTmdbId(t.tmdbId);
    if (!ov && t.archivos) {
      for (const f of t.archivos) {
        if (f.tmdbId) { ov = getOverrideByTmdbId(f.tmdbId); if (ov) break; }
      }
    }
    if (ov) {
      t.metadata = ov;
      t.tmdbId = ov.id || t.tmdbId;
    }
  }
  titles = mergeMoviesByTmdb(titles);
  TITLES_CACHE = titles;
  // Carteles/fondos/logos elegidos por el usuario (por perfil + caché del dispositivo)
  titles.forEach(t => applyImagePrefs(t, profile));

  // Precalentar carátulas cacheadas en memoria para que se muestren en 0 ms
  await prewarmPosterCache(titles);

  const progress = loadProgress(profile.id);
  const rows = buildHomeRows(titles, progress);
  const titleById = new Map(titles.map(t => [String(t.id), t]));
  const favoriteTitles = loadFavorites(profile.id).map(id => titleById.get(String(id))).filter(Boolean);
  const collectionTitles = titles.filter(t => t.isSaga || t.metadata?.tipo === 'collection');
  const movieTitles = titles.filter(t => t.tipo === 'pelicula' && !t.isSaga && t.metadata?.tipo !== 'collection');
  const seriesTitles = titles.filter(t => t.tipo === 'serie');
  const sportTitles = titles.filter(t => t.tipo === 'deporte');
  const musicTitles = titles.filter(t => t.tipo === 'musica');

  const sectionDefs = [
    ...(titles.length ? [{ id: 'inicio', label: 'Inicio', items: titles }] : []),
    ...(favoriteTitles.length ? [{ id: 'favoritos', label: 'Favoritos', items: favoriteTitles }] : []),
    ...(movieTitles.length ? [{ id: 'peliculas', label: 'Películas', items: movieTitles }] : []),
    ...(seriesTitles.length ? [{ id: 'series', label: 'Series', items: seriesTitles }] : []),
    ...(sportTitles.length ? [{ id: 'deportes', label: 'Deportes', items: sportTitles }] : []),
    ...(musicTitles.length ? [{ id: 'musica', label: 'Música', items: musicTitles }] : []),
    ...(collectionTitles.length ? [{ id: 'colecciones', label: 'Colecciones', items: collectionTitles }] : []),
  ];
  if (!sectionDefs.some(section => section.id === selectedSection)) selectedSection = sectionDefs[0]?.id || 'inicio';
  ACTIVE_HOME_SECTION = selectedSection;
  const activeSection = sectionDefs.find(section => section.id === selectedSection);

  const body = !titles.length ? `
      <div class="home-empty"><h2>Hola, ${esc(profile.name)}</h2>
        <p>No se han encontrado canales de vídeo.</p>
        <p style="opacity:.6;margin-top:.5rem">Los canales deben terminar en <code>::Series::tgstorage</code> o <code>::Películas::tgstorage</code></p></div>`
    : selectedSection !== 'inicio' ? (() => {
        const currentSort = getSectionSort(profile.id, selectedSection);
        const sortedItems = sortTitles(activeSection?.items || [], currentSort);
        return `
      <section class="category-view" aria-label="${esc(activeSection?.label || '')}">
        <div class="category-header">
          <h1 class="category-title">${esc(activeSection?.label || '')}</h1>
          <div class="category-sort-bar" role="group" aria-label="Ordenar por">
            <span class="category-sort-label">Ordenar:</span>
            <button type="button" class="category-sort-btn ${currentSort === 'nombre' ? 'active' : ''}" data-focusable data-sort="nombre" aria-pressed="${currentSort === 'nombre'}">Nombre</button>
            <button type="button" class="category-sort-btn ${currentSort === 'estreno' ? 'active' : ''}" data-focusable data-sort="estreno" aria-pressed="${currentSort === 'estreno'}">Fecha de estreno</button>
            <button type="button" class="category-sort-btn ${currentSort === 'puntuacion' ? 'active' : ''}" data-focusable data-sort="puntuacion" aria-pressed="${currentSort === 'puntuacion'}">Puntuación</button>
          </div>
        </div>
        <div class="category-grid">${sortedItems.map(t => cardHtml(t, progress)).join('')}</div>
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
    <div class="screen home-screen">
      <header class="home-header">
        <div class="home-logo">TGVideo</div>
        ${sectionDefs.length ? `<nav class="home-nav" aria-label="Secciones">${sectionDefs.map(section => `<button class="home-nav-item ${section.id === selectedSection ? 'active' : ''}" data-focusable data-section="${esc(section.id)}" type="button" aria-current="${section.id === selectedSection ? 'page' : 'false'}">${esc(section.label)}</button>`).join('')}</nav>` : ''}
        <div class="home-actions">
          <button class="btn-icon" data-focusable id="btn-reload" title="Actualizar biblioteca" aria-label="Actualizar">↻</button>
          <div class="home-profile" tabindex="0" data-focusable id="btn-change-profile" title="${esc(profile.name)}" aria-label="Perfil: ${esc(profile.name)}">
            <div class="avatar small">${profileAvatar(profile)}</div>
          </div>
        </div>
      </header>
      <main class="home-main">${body}</main>
    </div>`);

  document.querySelectorAll('.home-nav-item').forEach(button => {
    button.onclick = () => showHome(tg, sync, profile, { selectedSection: button.dataset.section });
  });
  document.querySelectorAll('.category-sort-btn').forEach(btn => {
    btn.onclick = () => {
      const newSort = btn.dataset.sort;
      const currentSort = getSectionSort(profile.id, selectedSection);
      if (newSort && newSort !== currentSort) {
        setSectionSort(profile.id, selectedSection, newSort);
        showHome(tg, sync, profile, { selectedSection, focusSort: newSort });
      }
    };
  });
  document.getElementById('btn-change-profile').onclick = () => showProfileMenu({ profile, sync, libraryTitles: titles,
    onSwitch: () => showProfileSelector(tg, sync), onChanged: () => showHome(tg, sync, profile),
    onGlobalChanged: () => { TITLES_CACHE?.forEach(t => delete t.metadata); showHome(tg, sync, profile); } });
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
    if (focusSort) {
      el = document.querySelector(`.category-sort-btn[data-sort="${focusSort}"]`);
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
    if (!el) {
      // Categorías enfocan su pestaña activa; Inicio mantiene el foco en la primera carátula.
      el = selectedSection !== 'inicio' ? document.querySelector('.home-nav-item.active') : null;
      el ||= document.querySelector('.row[data-row-id="continue"] .row-track .lib-card[data-title]')
        || document.querySelector('.row-track .lib-card[data-title]');
    }
    if (!el) {
      el = document.querySelector('.home-nav-item.active, [data-focusable]');
    }
    if (el) {
      el.focus();
      const parentRow = el.closest('.row');
      if (parentRow) {
        parentRow.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
      }
      el.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    }
  }, 80);
  metadataController?.abort();
  metadataController = new AbortController();

  let metaSaveTimer = null;
  const saveMetaDebounced = () => {
    clearTimeout(metaSaveTimer);
    metaSaveTimer = setTimeout(async () => {
      try {
        const saved = await kv.get(LIB_KEY).catch(() => null);
        if (saved) {
          saved.metadataMap = saved.metadataMap || {};
          for (const t of (TITLES_CACHE || [])) {
            if (t.metadata) saved.metadataMap[t.id] = t.metadata;
          }
          await kv.set(LIB_KEY, saved);
        }
      } catch (_) {}
    }, 1500);
  };

  enrichTitles(titles, { signal: metadataController.signal, onUpdate: title => {
    applyImagePrefs(title, profile);
    saveMetaDebounced();
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
    // Tras enriquecer, re-agrupar películas con el mismo TMDB
    if (!metadataController.signal.aborted && TITLES_CACHE) {
      const before = TITLES_CACHE.length;
      TITLES_CACHE = mergeMoviesByTmdb(TITLES_CACHE);
      if (TITLES_CACHE.length !== before && document.querySelector('.home-screen')) {
        showHome(tg, sync, profile);
      }
    }
  }).catch(() => {});
}

// ---------- Selector de perfiles ----------
async function showProfileSelector(tg, sync) {
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
        showLoading('Sincronizando perfil…');
        try {
          const remote = await sync.pullProfile(profile.id);
          if (remote) {
            if (remote.progress) {
              const merged = sync.mergeProgress(loadProgress(profile.id), remote.progress);
              writeFullProgress(profile.id, merged);
            }
            // Sincronizar Favoritos por perfil
            const remoteFavs = remote.favorites || remote.profile?.favorites || [];
            if (Array.isArray(remoteFavs)) {
              const localFavs = loadFavorites(profile.id);
              const mergedFavs = mergeFavorites(localFavs, remoteFavs);
              saveFavorites(profile.id, mergedFavs);
              profile.favorites = mergedFavs;
            }
            // Sincronizar Carteles, Fondos y Logos por perfil
            const remoteImg = remote.image_prefs || remote.profile?.image_prefs || {};
            if (remoteImg && typeof remoteImg === 'object') {
              const mergedImg = syncImagePrefsWithRemote(profile, remoteImg);
              profile.image_prefs = mergedImg;
            }
          }
        } catch (err) {
          console.warn('[sync] Error sincronizando perfil', err);
        }

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

    const profileId = name
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'perfil';

    const newProfile = {
      v: 1,
      profile: {
        id: profileId,
        name: name.trim(),
        avatar: null,
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
