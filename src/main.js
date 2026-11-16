let LAST_OPENED_TITLE_ID = null;
import './style.css';
import { createTelegramClient } from './core/telegram.js';
import { createTelegramSync } from './sync/telegramSync.js';
import { loadLibrary } from './library/channels.js';
import { buildTitles, mergeMoviesByTmdb } from './library/titles.js';
import { buildHomeRows, posterColor } from './ui/home.js';
import { initDpad, setBackHandler, focusFirst } from './ui/dpad.js';
import { loadProgress, writeFullProgress, titleState } from './player/progress.js';
import { playFile } from './player/player.js';
import { createKV } from './core/kv.js';
import { enrichTitles, enrichTitle, fetchSeasonEpisodes } from './metadata/tmdb.js';
import { loadPoster, prewarmPosterCache, memoryCache } from './metadata/posterCache.js';
import { prettyEpisodeName } from './library/parse.js';
import { showMetadataModal } from './ui/metadataModal.js';
import { loadGlobalConfig } from './settings/global.js';
import { loadOverrides } from './metadata/overrides.js';
import { showProfileMenu, profileAvatar, applyProfileScale } from './ui/settings.js';
import { adjacentSeason, firstUncompleted, centerSeason } from './ui/seasons.js';

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
  const metaBadge = t.tipo === 'serie' ? `${t.archivos.length} ep.` : t.isSaga ? `${t.archivos.length} películas` : t.archivos.length > 1 ? `${t.archivos.length} vers.` : 'Película';
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
  const overlay = document.createElement("div");
  overlay.className = "settings-overlay";
  overlay.innerHTML = `
    <div class="settings-modal update-modal" role="dialog" aria-label="Actualizar biblioteca">
      <div class="settings-modal-header">
        <h2 style="margin:0;font-size:1.3rem;">Actualizar biblioteca</h2>
        <button class="settings-close-btn" data-focusable aria-label="Cerrar">✕</button>
      </div>
      <p style="color:#aaa;font-size:0.95rem;margin:0.5rem 0 1.2rem;">Selecciona el modo de actualización de canales y vídeos:</p>
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
  `;
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.querySelector(".settings-close-btn").onclick = close;
  overlay.onclick = (e) => { if (e.target === overlay) close(); };

  document.getElementById("btn-update-quick").onclick = () => { close(); onQuick(); };
  document.getElementById("btn-update-full").onclick = () => { close(); onFull(); };

  setTimeout(() => {
    document.getElementById("btn-update-quick")?.focus();
  }, 50);
}

function showGroupGrid(tg, sync, profile, row, { focusTitleId = null } = {}) {
  applyProfileScale(profile);
  const back = () => showHome(tg, sync, profile, { focusRowId: row.id, focusExpandBtn: true });
  setBackHandler(back);

  const titles = TITLES_CACHE || [];
  const progress = loadProgress(profile.id);
  const currentItems = row.items.map(it => titles.find(t => String(t.id) === String(it.id)) || it);

  showScreen(`
    <div class="screen grid-screen" data-grid-id="${esc(row.id)}">
      <header class="grid-header">
        <button class="btn-icon" data-focusable id="grid-btn-back" title="Volver al inicio" aria-label="Volver">←</button>
        <div class="grid-header-info">
          <h1>${esc(row.title)}</h1>
          <span class="grid-count">${currentItems.length} ${currentItems.length === 1 ? "título" : "títulos"}</span>
        </div>
      </header>
      <main class="grid-cards">
        ${currentItems.map(t => cardHtml(t, progress)).join("")}
      </main>
    </div>`);

  document.getElementById("grid-btn-back").onclick = back;

  document.querySelectorAll("#app .grid-cards .lib-card").forEach(card => {
    card.onclick = () => {
      const t = currentItems.find(x => String(x.id) === String(card.dataset.title));
      if (t) showDetail(tg, sync, profile, t, { fromGrid: row });
    };
  });

  document.querySelectorAll("#app .grid-cards .lib-card-poster img.poster-image").forEach(img => {
    const url = img.getAttribute("data-poster-url") || img.src;
    if (url) loadPoster(img, url);
  });

  setTimeout(() => {
    let el = null;
    if (focusTitleId) {
      el = document.querySelector(`.grid-cards .lib-card[data-title="${focusTitleId}"]`);
    }
    if (!el) {
      el = document.querySelector(".grid-cards .lib-card[data-focusable]") || document.getElementById("grid-btn-back");
    }
    if (el) {
      el.focus();
      el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
    }
  }, 80);
}

let CHECKED = false;
async function showHome(tg, sync, profile, { reload = false, force = false, focusTitleId = null, focusRowId = null, focusCardIndex = null, focusExpandBtn = false } = {}) {
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
  const titles = TITLES_CACHE || [];

  // Precalentar carátulas cacheadas en memoria para que se muestren en 0 ms
  await prewarmPosterCache(titles);

  const progress = loadProgress(profile.id);
  const rows = buildHomeRows(titles, progress);

  const body = !titles.length ? `
      <div class="home-empty"><h2>Hola, ${esc(profile.name)}</h2>
        <p>No se han encontrado canales de vídeo.</p>
        <p style="opacity:.6;margin-top:.5rem">Los canales deben terminar en <code>::Series::tgstorage</code> o <code>::Películas::tgstorage</code></p></div>`
    : rows.map(r => `
      <section class="row" data-row-id="${esc(r.id)}">
        <div class="row-header">
          <button class="row-expand-btn btn-icon" data-focusable data-row-id="${esc(r.id)}" title="Ver todos en cuadrícula" aria-label="Ver todos ${esc(r.title)}">+</button>
          <h2 class="row-title">${esc(r.title)}</h2>
        </div>
        <div class="row-track">${r.items.map(t => cardHtml(t, progress)).join('')}</div>
      </section>`).join('');

  showScreen(`
    <div class="screen home-screen">
      <header class="home-header">
        <div class="home-logo">TGVideo</div>
        <div class="home-actions">
          <button class="btn-icon" data-focusable id="btn-reload" title="Actualizar biblioteca" aria-label="Actualizar">↻</button>
          <div class="home-profile" tabindex="0" data-focusable id="btn-change-profile" title="${esc(profile.name)}" aria-label="Perfil: ${esc(profile.name)}">
            <div class="avatar small">${profileAvatar(profile)}</div>
          </div>
        </div>
      </header>
      <main class="home-main">${body}</main>
    </div>`);

  document.getElementById('btn-change-profile').onclick = () => showProfileMenu({ profile, sync, libraryTitles: titles,
    onSwitch: () => showProfileSelector(tg, sync), onChanged: () => showHome(tg, sync, profile),
    onGlobalChanged: () => { TITLES_CACHE?.forEach(t => delete t.metadata); showHome(tg, sync, profile); } });
  document.getElementById('btn-reload').onclick = () => {
    showUpdateDialog({
      onQuick: () => showHome(tg, sync, profile, { reload: true, force: false }),
      onFull: () => showHome(tg, sync, profile, { reload: true, force: true }),
    });
  };

  document.querySelectorAll('#app .row-expand-btn').forEach(btn => {
    btn.onclick = () => {
      const rowId = btn.dataset.rowId;
      const r = rows.find(x => x.id === rowId);
      if (r) showGroupGrid(tg, sync, profile, r);
    };
  });
  document.querySelectorAll('#app .row').forEach(rowEl => {
    const rowId = rowEl.dataset.rowId;
    rowEl.querySelectorAll('.lib-card').forEach((card, idx) => {
      card.onclick = () => {
        const t = titles.find(x => String(x.id) === String(card.dataset.title));
        if (t) showDetail(tg, sync, profile, t, { fromRowId: rowId, fromCardIndex: idx });
      };
    });
  });
  document.querySelectorAll('.lib-card-poster img.poster-image').forEach(img => {
    const url = img.getAttribute('data-poster-url') || img.src;
    if (url) loadPoster(img, url);
  });


  setTimeout(() => {
    let el = null;
    if (focusRowId && focusExpandBtn) {
      el = document.querySelector(`.row[data-row-id="${focusRowId}"] .row-expand-btn`);
    } else if (focusRowId && focusTitleId) {
      el = document.querySelector(`.row[data-row-id="${focusRowId}"] .lib-card[data-title="${focusTitleId}"]`);
    }
    if (!el && focusRowId && typeof focusCardIndex === "number") {
      const row = document.querySelector(`.row[data-row-id="${focusRowId}"]`);
      el = row?.querySelectorAll(".lib-card")?.[focusCardIndex];
    }
    if (!el && focusTitleId) {
      el = document.querySelector(`.lib-card[data-title="${focusTitleId}"]`);
    }
    if (!el) {
      // Al cargar un perfil: enfocar primera cajetilla de Seguir viendo (o la primera de la siguiente fila si está vacía)
      el = document.querySelector('.row-track .lib-card[data-focusable]');
    }
    if (!el) {
      el = document.querySelector('[data-focusable]');
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
      applyDetailMetadata(title, profile);
      if (title.isSaga) applySagaFilmMetadata(title);
    }
  } });
}

function applySagaFilmMetadata(t) {
  const detail = document.querySelector('.detail');
  if (!detail || String(detail.dataset.title) !== String(t.id)) return;
  for (const file of t.archivos) {
    const row = [...detail.querySelectorAll('.ep[data-key]')].find(el => el.dataset.key === file.key);
    if (!row || !file.metadata) continue;
    const image = row.querySelector('.saga-film-poster');
    if (image && file.metadata.poster && image.tagName !== 'IMG') {
      const img = document.createElement('img');
      img.className = 'saga-film-poster'; img.alt = ''; img.loading = 'lazy';
      loadPoster(img, file.metadata.poster);
      image.replaceWith(img);
    }
    const name = row.querySelector('.ep-name');
    if (name && file.metadata.name) name.textContent = file.metadata.name;
    const synopsis = row.querySelector('.saga-film-synopsis');
    if (!synopsis && file.metadata.overview) {
      const el = document.createElement('div'); el.className = 'saga-film-synopsis'; el.textContent = file.metadata.overview;
      row.querySelector('.ep-info')?.append(el);
    }
  }
}

function applyDetailMetadata(t, profile) {
  const metadata = t.metadata;
  if (!metadata) return;
  const detail = document.querySelector('.detail');
  if (!detail || String(detail.dataset.title) !== String(t.id)) return;
  const displayName = metadata.name || metadata.title || t.nombre;

  const titleH1 = detail.querySelector('.detail-head h1');
  if (titleH1 && displayName) titleH1.textContent = displayName;
  const posterName = detail.querySelector('.detail-head .poster-name');
  if (posterName && displayName) posterName.textContent = displayName;

  if (metadata.backdrop) {
    detail.style.setProperty('--detail-backdrop', `url("${metadata.backdrop}")`);
    detail.classList.add('has-backdrop');
  }
  const poster = detail.querySelector('.lib-card-poster.big');
  if (metadata.poster && poster) {
    let image = poster.querySelector('img.poster-image');
    if (!image) {
      image = document.createElement('img');
      image.className = 'poster-image';
      image.alt = displayName;
      poster.prepend(image);
    }
    image.onerror = () => {
      if (image.src !== metadata.poster) image.src = metadata.poster;
    };
    loadPoster(image, metadata.poster);
  }
  const synopsis = detail.querySelector('.detail-syn');
  const toggle = detail.querySelector('.btn-syn-toggle');
  if (synopsis && metadata.overview) {
    synopsis.textContent = metadata.overview;
    synopsis.hidden = false;
    if (toggle) {
      if (metadata.overview.length > 120) {
        toggle.hidden = false;
        toggle.textContent = 'más';
        synopsis.classList.remove('expanded');
        toggle.onclick = (e) => {
          e.preventDefault();
          const exp = synopsis.classList.toggle('expanded');
          toggle.textContent = exp ? 'menos' : 'más';
        };
      } else {
        toggle.hidden = true;
      }
    }
  }
  const info = detail.querySelector('.detail-metadata');
  if (info) {
    const numRating = Number(metadata.rating);
    const ratingStr = Number.isFinite(numRating) && numRating > 0 ? `★ ${numRating.toFixed(1)}` : '';
    info.textContent = [metadata.date?.slice(0, 4), ratingStr].filter(Boolean).join(' · ');
  }


  // Actualizar botón de reproducir con el nombre TMDB si está disponible
  const playBtn = detail.querySelector('#d-play');
  if (playBtn && profile?.id) {
    const progress = loadProgress(profile.id);
    const st = titleState(t, progress);
    const label = formatPlayButtonLabel(t, st, progress);
    if (label) playBtn.textContent = label;
  }
}

function showDetail(tg, sync, profile, t, { fromRowId = null, fromCardIndex = null, fromGrid = null } = {}) {
  LAST_OPENED_TITLE_ID = t.id;
  const back = () => {
    if (fromGrid) {
      showGroupGrid(tg, sync, profile, fromGrid, { focusTitleId: t.id });
    } else {
      showHome(tg, sync, profile, { focusTitleId: t.id, focusRowId: fromRowId, focusCardIndex: fromCardIndex });
    }
  };
  setBackHandler(back);
  const progress = loadProgress(profile.id);
  const st = titleState(t, progress);
  const nextLabel = formatPlayButtonLabel(t, st, progress);

  const seasonsMap = new Map();
  if (t.tipo === 'serie') for (const f of t.archivos) {
    const s = f.season || 1;
    if (!seasonsMap.has(s)) seasonsMap.set(s, []);
    seasonsMap.get(s).push(f);
  }
  const seasons = [...seasonsMap.keys()].sort((a, b) => a - b);
  let currentSeason = st.next?.season && seasonsMap.has(st.next.season) ? st.next.season : (seasons[0] || 1);
  const hasSeasons = t.tipo === 'serie' && seasons.length > 1;
  const seasonsBarHtml = hasSeasons ? `
    <div class="seasons-bar"><div class="seasons-label">Temporadas</div>
      <div class="seasons-track">${seasons.map(s => `<button class="season-btn ${s === currentSeason ? 'active' : ''}" data-focusable data-season="${s}">Temporada ${s}</button>`).join('')}</div>
    </div>` : '';
  const displayName = t.metadata?.name || t.metadata?.title || t.nombre;

  showScreen(`
    <div class="screen detail" data-title="${esc(t.id)}" style="--pc:${posterColor(t.grupo + t.nombre)}">
      <div class="detail-nav-bar">
        <button class="btn-ghost" data-focusable id="d-back">← Volver</button>
        <button class="btn-icon-circle" data-focusable id="d-fix-meta" title="Corregir identificación (TMDB)" aria-label="Identificación TMDB">ⓘ</button>
      </div>
      <div class="detail-head">
        <div class="lib-card-poster big" style="--pc:${posterColor(t.grupo + t.nombre)}">
          ${t.metadata?.poster ? `<img class="poster-image" src="${esc(memoryCache.get(t.metadata.poster) || t.metadata.poster)}" alt="${esc(displayName)}">` : ''}
          <span class="poster-group">${esc(t.grupo)}</span><span class="poster-name">${esc(displayName)}</span></div>
        <div>
          <div class="detail-kicker">${t.tipo === 'serie' ? 'Serie' : 'Película'} · ${esc(t.grupo)}</div>
          <h1>${esc(displayName)}</h1>
          <p class="detail-sub">${t.isSaga ? `${t.archivos.length} películas de la saga` : t.tipo === 'serie' ? `${t.archivos.length} episodios` : t.archivos.length > 1 ? `${t.archivos.length} versiones disponibles` : (fmtDur(t.archivos[0]?.duration) || 'Película')}</p>
          <p class="detail-metadata"></p>
          <div class="detail-syn-container">
            <p class="detail-syn" ${t.archivos[0]?.synopsis ? '' : 'hidden'}>${esc(t.archivos[0]?.synopsis || '')}</p>
            <button class="btn-syn-toggle" type="button" hidden data-focusable>más</button>
          </div>
          ${st.next ? `<button class="btn" data-focusable id="d-play">${nextLabel}</button>` : '<p>Este canal todavía no tiene vídeos.</p>'}
        </div>
      </div>
      ${seasonsBarHtml}
      <h2 class="row-title" id="d-list-title">${t.isSaga ? 'Películas de la saga' : t.tipo === 'serie' ? 'Episodios' : t.archivos.length > 1 ? 'Versiones disponibles' : 'Archivo de vídeo'}</h2>
      <div class="ep-list" id="ep-list"></div>
    </div>`);

  applyDetailMetadata(t, profile);
  if (t.isSaga) applySagaFilmMetadata(t);

  if (!t.metadata) {
    enrichTitle(t).then(meta => {
      if (meta && String(document.querySelector('.detail')?.dataset.title) === String(t.id)) {
        applyDetailMetadata(t, profile);
        if (t.isSaga) applySagaFilmMetadata(t);
      }
    }).catch(() => {});
  }

  document.getElementById('d-fix-meta').onclick = () => {
    showMetadataModal(t, (updatedMeta) => {
      t.metadata = updatedMeta;
      if (t.archivos && !t.isSaga) {
        for (const f of t.archivos) {
          f.metadata = updatedMeta;
        }
      }
      if (TITLES_CACHE) {
        TITLES_CACHE = mergeMoviesByTmdb(TITLES_CACHE);
      }
      applyDetailMetadata(t, profile);
      showDetail(tg, sync, profile, t, { fromRowId, fromCardIndex, fromGrid });
    }, { client: tg?.getClient?.(), peerOf: tg?.peerOf });
  };

  const play = (f) => {
    const p = loadProgress(profile.id)[f.key];
    setBackHandler(null);
    playFile({ client: tg.getClient(), peerOf: tg.peerOf, file: f, title: t, profile,
      resumeAt: p && !p.is_completed ? p.current_time : 0, mount: app,
      onClose: () => showDetail(tg, sync, profile, t, { fromRowId, fromCardIndex, fromGrid }), sync });
  };

  const renderEpisodes = (seasonNum) => {
    let files = hasSeasons ? (seasonsMap.get(seasonNum) || []) : t.archivos;
    if (t.isSaga) {
      const yearOf = (f) => Number(f.metadata?.date?.slice(0, 4) || f.fileName.match(/\b(?:19|20)\d{2}\b/)?.[0] || 9999);
      files = [...files].sort((a, b) => yearOf(a) - yearOf(b) || a.label.localeCompare(b.label, 'es', { numeric: true }));
    }
    const container = document.getElementById('ep-list');
    container.innerHTML = files.map((f) => {
      const p = progress[f.key];
      const pct = p?.duration ? Math.min(100, p.current_time / p.duration * 100) : 0;
      const ep = f.season || f.episode ? `T${f.season || 1}·E${String(f.episode).padStart(2, '0')}` : '';
      const filmYear = f.metadata?.date?.slice(0, 4) || f.fileName.match(/\b(?:19|20)\d{2}\b/)?.[0] || t.metadata?.date?.slice(0, 4) || '';
      const normalizedMovieName = t.metadata?.name || t.metadata?.title || t.nombre;
      const filmTitle = t.isSaga
        ? (f.metadata?.name || f.sagaName || f.label)
        : t.tipo === 'serie'
          ? (f.metadata?.name || prettyEpisodeName(f.fileName || f.label, normalizedMovieName))
          : (t.archivos.length > 1 ? (f.label || `Versión ${files.indexOf(f) + 1}`) : (f.metadata?.name || normalizedMovieName || f.sagaName || f.label));
      const sentAt = Number(f.date);
      const episodeDate = Number.isFinite(sentAt) && sentAt > 0
        ? new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(sentAt * 1000))
        : '';
      const fileDurationSecs = f.duration || (t.metadata?.runtime ? (t.metadata.runtime * 60) : 0);
      const durStr = fmtDur(fileDurationSecs);
      const poster = f.metadata?.poster ? `<img class="saga-film-poster" src="${esc(memoryCache.get(f.metadata.poster) || f.metadata.poster)}" alt="" loading="lazy">` : `<div class="saga-film-poster saga-film-placeholder">${esc(filmYear || '🎬')}</div>`;
      const synopsis = f.metadata?.overview ? `<div class="saga-film-synopsis">${esc(f.metadata.overview)}</div>` : '';
      return `<div class="ep ${t.isSaga ? 'saga-film' : ''}" tabindex="0" data-focusable data-key="${esc(f.key)}">
        ${t.isSaga ? poster : `<div class="ep-num">${ep || '•'}</div>`}
        <div class="ep-info"><div class="ep-name">${esc(filmTitle)}</div>
          <div class="ep-meta">${(t.tipo === 'serie' ? [durStr, fmtSize(f.size), episodeDate] : [filmYear, durStr, fmtSize(f.size)]).filter(Boolean).join(' · ')}</div>
          ${synopsis}${pct ? `<div class="poster-progress"><i style="width:${pct}%"></i></div>` : ''}</div>
        <div class="ep-state">${p?.is_completed ? '✓ Visto' : pct ? Math.round(pct) + '%' : ''}</div>
      </div>`;
    }).join('');
    container.querySelectorAll('.ep').forEach(el => {
      el.onclick = () => { const f = t.archivos.find(x => x.key === el.dataset.key); if (f) play(f); };
    });
    if (hasSeasons) document.getElementById('d-list-title').textContent = `Temporada ${seasonNum} (${files.length} ep.)`;
  };
  renderEpisodes(currentSeason);

  // Enriquecer nombres normalizados de episodios desde TMDB
  if (t.tipo === 'serie' && (t.metadata?.id || t.tmdbId)) {
    const loadSeasonMeta = (sNum) => {
      fetchSeasonEpisodes(t.metadata?.id || t.tmdbId, sNum).then(episodes => {
        if (!episodes || !episodes.length) return;
        const currentFiles = hasSeasons ? (seasonsMap.get(sNum) || []) : t.archivos;
        let updated = false;
        for (const f of currentFiles) {
          const ep = episodes.find(e => e.episode_number === f.episode);
          if (ep && ep.name) {
            f.metadata = { ...(f.metadata || {}), name: ep.name, overview: ep.overview || f.metadata?.overview };
            updated = true;
          }
        }
        if (updated && String(document.querySelector('.detail')?.dataset.title) === String(t.id)) {
          if (currentSeason === sNum) {
            renderEpisodes(sNum);
          }
          const playBtn = document.getElementById('d-play');
          if (playBtn) {
            playBtn.textContent = formatPlayButtonLabel(t, st, progress);
          }
        }
      }).catch(() => {});
    };
    loadSeasonMeta(currentSeason);
  }

  const centerCurrentSeason = () => centerSeason(document.querySelector('.seasons-track'), document.querySelector('.season-btn.active'));
  const changeSeason = (season, focusEpisode = false) => {
    currentSeason = season;
    document.querySelectorAll('.season-btn').forEach(b => b.classList.toggle('active', Number(b.dataset.season) === season));
    renderEpisodes(season);
    centerCurrentSeason();
    if (focusEpisode) {
      const target = firstUncompleted(seasonsMap.get(season) || [], loadProgress(profile.id));
      const element = [...document.querySelectorAll('.ep')].find(el => el.dataset.key === target?.key);
      element?.focus({ preventScroll: true });
      element?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  };
  document.getElementById('ep-list').addEventListener('keydown', e => {
    if (!e.target.closest('.ep') || !['ArrowLeft', 'ArrowRight'].includes(e.key) || !hasSeasons) return;
    e.preventDefault(); e.stopPropagation();
    const season = adjacentSeason(seasons, currentSeason, e.key === 'ArrowLeft' ? -1 : 1);
    if (season !== null) changeSeason(season, true);
  });
  document.querySelectorAll('.season-btn').forEach(btn => {
    btn.onclick = () => changeSeason(Number(btn.dataset.season));
  });
  requestAnimationFrame(centerCurrentSeason);
  const track = document.querySelector('.seasons-track');
  if (track) {
    const observer = new ResizeObserver(() => { if (track.isConnected) centerCurrentSeason(); else observer.disconnect(); });
    observer.observe(track);
  }
  document.getElementById('d-back').onclick = back;
  document.getElementById('d-play')?.addEventListener('click', () => play(st.next));
  focusFirst('#d-play, .season-btn.active, .ep');
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
          if (remote?.progress) {
            const merged = sync.mergeProgress(loadProgress(profile.id), remote.progress);
            writeFullProgress(profile.id, merged);
          }
        } catch (err) {
          console.warn('[sync] Error sincronizando progreso', err);
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

initDpad();
start();
