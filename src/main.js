import './style.css';
import { createTelegramClient } from './core/telegram.js';
import { createTelegramSync } from './sync/telegramSync.js';
import { loadLibrary } from './library/channels.js';
import { buildTitles } from './library/titles.js';
import { buildHomeRows, posterColor } from './ui/home.js';
import { initDpad, setBackHandler, focusFirst } from './ui/dpad.js';
import { loadProgress, titleState } from './player/progress.js';
import { playFile } from './player/player.js';
import { createKV } from './core/kv.js';
import { enrichTitles } from './metadata/tmdb.js';
import { loadGlobalConfig } from './settings/global.js';
import { showProfileMenu, profileAvatar } from './ui/settings.js';
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
    input.focus();
    const submit = () => resolve(input.value.trim());
    btn.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  });
}

// ---------- Home con biblioteca ----------
let TITLES_CACHE = null;
let metadataController = null;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtSize = (b) => b > 1e9 ? (b / 1e9).toFixed(2) + ' GB' : (b / 1e6).toFixed(0) + ' MB';
const fmtDur = (s) => s ? `${Math.floor(s / 3600) ? Math.floor(s / 3600) + 'h ' : ''}${Math.floor(s % 3600 / 60)}min` : '';

function cardHtml(t, progress) {
  const st = titleState(t, progress);
  const p = st.next && progress[st.next.key];
  const pct = p && p.duration ? Math.min(100, p.current_time / p.duration * 100) : 0;
  return `
    <div class="lib-card" tabindex="0" data-focusable data-title="${esc(t.id)}">
      <div class="lib-card-poster" style="--pc:${posterColor(t.grupo + t.nombre)}">
        ${t.metadata?.poster ? `<img class="poster-image" src="${esc(t.metadata.poster)}" alt="${esc(t.nombre)}" loading="lazy">` : ''}
        <span class="poster-group">${esc(t.grupo)}</span>
        <span class="poster-name">${esc(t.nombre)}</span>
        <span class="poster-meta">${t.tipo === 'serie' ? t.archivos.length + ' ep.' : 'Película'}</span>
        ${pct ? `<div class="poster-progress"><i style="width:${pct}%"></i></div>` : ''}
      </div>
      <div class="lib-card-name">${esc(t.nombre)}</div>
    </div>`;
}

// Lee los canales y solo vuelve a escanear los que han cambiado (o todos si force)
async function refreshLibrary(tg, { force = false, onProgress } = {}) {
  const client = tg.getClient();
  const channels = await loadLibrary(client);
  const saved = force ? {} : ((await kv.get(LIB_KEY).catch(() => null))?.cache || {});
  const { titles, cache } = await buildTitles(client, channels, tg.peerOf, onProgress, saved);
  const sig = channels.map(c => `${c.id}:${c.top}:${c.title}`).sort().join('|');
  await kv.set(LIB_KEY, { cache, channels, sig, savedAt: Date.now() }).catch(e => console.warn('[kv]', e));
  return { titles, sig };
}

let CHECKED = false;
async function showHome(tg, sync, profile, { reload = false } = {}) {
  setBackHandler(() => showProfileSelector(tg, sync));
  const onProgress = (d, n) => { const p = document.querySelector('.screen p'); if (p) p.textContent = `Leyendo canales… ${d}/${n}`; };
  if (reload) {
    showLoading('Actualizando biblioteca…');
    try { TITLES_CACHE = (await refreshLibrary(tg, { force: true, onProgress })).titles; CHECKED = true; }
    catch (err) { console.error('Error cargando biblioteca', err); TITLES_CACHE = TITLES_CACHE || []; }
  } else if (!TITLES_CACHE) {
    const saved = await kv.get(LIB_KEY).catch(() => null);
    if (saved?.cache && saved.channels) {
      // Biblioteca local: se muestra al instante sin leer Telegram
      const { titles } = await buildTitles(null, saved.channels, tg.peerOf, null, saved.cache);
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
      TITLES_CACHE = titles;
      if (document.querySelector('.home-screen')) showHome(tg, sync, profile);
    }).catch(e => console.warn('[library] comprobación fallida', e));
  }
  const titles = TITLES_CACHE;
  const progress = loadProgress(profile.id);
  const rows = buildHomeRows(titles, progress);

  const body = !titles.length ? `
      <div class="home-empty"><h2>Hola, ${esc(profile.name)}</h2>
        <p>No se han encontrado canales de vídeo.</p>
        <p style="opacity:.6;margin-top:.5rem">Los canales deben terminar en <code>::Series::tgstorage</code> o <code>::Películas::tgstorage</code></p></div>`
    : rows.map(r => `
      <section class="row"><h2 class="row-title">${esc(r.title)}</h2>
        <div class="row-track">${r.items.map(t => cardHtml(t, progress)).join('')}</div></section>`).join('');

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

  document.getElementById('btn-change-profile').onclick = () => showProfileMenu({ profile, sync,
    onSwitch: () => showProfileSelector(tg, sync), onChanged: () => showHome(tg, sync, profile),
    onGlobalChanged: () => { TITLES_CACHE?.forEach(t => delete t.metadata); showHome(tg, sync, profile); } });
  document.getElementById('btn-reload').onclick = () => showHome(tg, sync, profile, { reload: true });
  document.querySelectorAll('.lib-card').forEach(card => {
    card.onclick = () => { const t = titles.find(x => x.id === card.dataset.title); if (t) showDetail(tg, sync, profile, t); };
  });
  focusFirst('.lib-card');
  metadataController?.abort();
  metadataController = new AbortController();
  enrichTitles(titles, { signal: metadataController.signal, onUpdate: title => {
    document.querySelectorAll('.lib-card').forEach(card => {
      if (card.dataset.title !== title.id || !title.metadata?.poster) return;
      const poster = card.querySelector('.lib-card-poster');
      if (!poster || poster.querySelector('img')) return;
      const image = document.createElement('img');
      image.className = 'poster-image'; image.src = title.metadata.poster;
      image.alt = title.nombre; image.loading = 'lazy';
      image.onerror = () => image.remove();
      poster.prepend(image);
    });
    if (document.querySelector('.detail')?.dataset.title === title.id) applyDetailMetadata(title);
  } });
}

function applyDetailMetadata(t) {
  const metadata = t.metadata;
  if (!metadata) return;
  const detail = document.querySelector('.detail');
  if (!detail || detail.dataset.title !== t.id) return;
  if (metadata.backdrop) {
    detail.style.setProperty('--detail-backdrop', `url("${metadata.backdrop}")`);
    detail.classList.add('has-backdrop');
  }
  const poster = detail.querySelector('.lib-card-poster.big');
  if (metadata.poster && poster && !poster.querySelector('img')) {
    const image = document.createElement('img');
    image.className = 'poster-image'; image.src = metadata.poster; image.alt = t.nombre;
    image.onerror = () => image.remove(); poster.prepend(image);
  }
  const synopsis = detail.querySelector('.detail-syn');
  if (synopsis && metadata.overview) { synopsis.textContent = metadata.overview; synopsis.hidden = false; }
  const info = detail.querySelector('.detail-metadata');
  if (info) info.textContent = [metadata.date?.slice(0, 4), metadata.rating ? `★ ${metadata.rating.toFixed(1)}` : '', `TMDB ${metadata.id}`].filter(Boolean).join(' · ');
}

function showDetail(tg, sync, profile, t) {
  const back = () => showHome(tg, sync, profile);
  setBackHandler(back);
  const progress = loadProgress(profile.id);
  const st = titleState(t, progress);
  const nextLabel = !st.next ? '' : st.continueWatching && progress[st.next.key] && !progress[st.next.key].is_completed
    ? `▶ Continuar ${t.tipo === 'serie' ? esc(st.next.label) : ''}` : `▶ Reproducir ${t.tipo === 'serie' ? esc(st.next.label) : ''}`;

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

  showScreen(`
    <div class="screen detail" data-title="${esc(t.id)}" style="--pc:${posterColor(t.grupo + t.nombre)}">
      <button class="btn-ghost" data-focusable id="d-back">← Volver</button>
      <div class="detail-head">
        <div class="lib-card-poster big" style="--pc:${posterColor(t.grupo + t.nombre)}">
          <span class="poster-group">${esc(t.grupo)}</span><span class="poster-name">${esc(t.nombre)}</span></div>
        <div>
          <div class="detail-kicker">${t.tipo === 'serie' ? 'Serie' : 'Película'} · ${esc(t.grupo)}</div>
          <h1>${esc(t.nombre)}</h1>
          <p class="detail-sub">${t.archivos.length} ${t.tipo === 'serie' ? 'episodios' : 'archivo(s)'} · ${t.origen.tipo === 'macro' ? 'Sección de canal macro' : 'Canal dedicado'}</p>
          <p class="detail-metadata"></p>
          <p class="detail-syn" ${t.archivos[0]?.synopsis ? '' : 'hidden'}>${esc(t.archivos[0]?.synopsis || '')}</p>
          ${st.next ? `<button class="btn" data-focusable id="d-play">${nextLabel}</button>` : '<p>Este canal todavía no tiene vídeos.</p>'}
        </div>
      </div>
      ${seasonsBarHtml}
      <h2 class="row-title" id="d-list-title">${t.tipo === 'serie' ? 'Episodios' : 'Archivos'}</h2>
      <div class="ep-list" id="ep-list"></div>
    </div>`);

  applyDetailMetadata(t);

  const play = (f) => {
    const p = loadProgress(profile.id)[f.key];
    setBackHandler(null);
    playFile({ client: tg.getClient(), peerOf: tg.peerOf, file: f, title: t, profile,
      resumeAt: p && !p.is_completed ? p.current_time : 0, mount: app,
      onClose: () => showDetail(tg, sync, profile, t) });
  };

  const renderEpisodes = (seasonNum) => {
    const files = hasSeasons ? (seasonsMap.get(seasonNum) || []) : t.archivos;
    const container = document.getElementById('ep-list');
    container.innerHTML = files.map((f) => {
      const p = progress[f.key];
      const pct = p?.duration ? Math.min(100, p.current_time / p.duration * 100) : 0;
      const ep = f.season || f.episode ? `T${f.season || 1}·E${String(f.episode).padStart(2, '0')}` : '';
      return `<div class="ep" tabindex="0" data-focusable data-key="${esc(f.key)}">
        <div class="ep-num">${ep || '•'}</div>
        <div class="ep-info"><div class="ep-name">${esc(f.label)}</div>
          <div class="ep-meta">${[fmtDur(f.duration), fmtSize(f.size), new Date(f.date * 1000).toLocaleDateString()].filter(Boolean).join(' · ')}</div>
          ${pct ? `<div class="poster-progress"><i style="width:${pct}%"></i></div>` : ''}</div>
        <div class="ep-state">${p?.is_completed ? '✓ Visto' : pct ? Math.round(pct) + '%' : ''}</div>
      </div>`;
    }).join('');
    container.querySelectorAll('.ep').forEach(el => {
      el.onclick = () => { const f = t.archivos.find(x => x.key === el.dataset.key); if (f) play(f); };
    });
    if (hasSeasons) document.getElementById('d-list-title').textContent = `Temporada ${seasonNum} (${files.length} ep.)`;
  };
  renderEpisodes(currentSeason);

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

  document.querySelectorAll('.profile-card[data-id]').forEach(card => {
    card.addEventListener('click', () => {
      const id = card.dataset.id;
      const profile = profiles.find(p => p.id === id);
      if (profile) showHome(tg, sync, profile);
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
    promptPhone: () => promptUI('Número de teléfono', '+34 600 000 000', 'tel'),
    promptCode: () => promptUI('Código de Telegram', '12345', 'text'),
    promptPassword: () => promptUI('Contraseña 2FA', 'Tu contraseña', 'password'),
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
    await showProfileSelector(tg, sync);

  } catch (err) {
    console.error(err);
    showError(err?.message || String(err));
  }
}

initDpad();
start();
