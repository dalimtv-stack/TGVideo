import './style.css';
import { createTelegramClient } from './core/telegram.js';
import { createTelegramSync } from './sync/telegramSync.js';
import { loadLibrary } from './library/channels.js';
import { buildTitles } from './library/titles.js';
import { buildHomeRows, posterColor } from './ui/home.js';
import { initDpad, setBackHandler, focusFirst } from './ui/dpad.js';
import { loadProgress, titleState } from './player/progress.js';
import { playFile } from './player/player.js';

const app = document.getElementById('app');

function showScreen(html) {
  app.innerHTML = html;
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
        <span class="poster-group">${esc(t.grupo)}</span>
        <span class="poster-name">${esc(t.nombre)}</span>
        <span class="poster-meta">${t.tipo === 'serie' ? t.archivos.length + ' ep.' : 'Película'}</span>
        ${pct ? `<div class="poster-progress"><i style="width:${pct}%"></i></div>` : ''}
      </div>
      <div class="lib-card-name">${esc(t.nombre)}</div>
    </div>`;
}

async function showHome(tg, sync, profile, { reload = false } = {}) {
  setBackHandler(() => showProfileSelector(tg, sync));
  if (!TITLES_CACHE || reload) {
    showLoading('Cargando biblioteca…');
    try {
      const client = tg.getClient();
      const channels = await loadLibrary(client);
      TITLES_CACHE = await buildTitles(client, channels, tg.peerOf, (d, n) => {
        const p = document.querySelector('.screen p'); if (p) p.textContent = `Leyendo canales… ${d}/${n}`;
      });
    } catch (err) { console.error('Error cargando biblioteca', err); TITLES_CACHE = []; }
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
        <div style="display:flex;gap:.5rem;align-items:center">
          <button class="btn-ghost" data-focusable id="btn-reload">↻ Actualizar</button>
          <div class="home-profile" tabindex="0" data-focusable id="btn-change-profile">
            <div class="avatar small">${esc((profile.name || '?')[0].toUpperCase())}</div><span>${esc(profile.name)}</span></div>
        </div>
      </header>
      <main class="home-main">${body}</main>
    </div>`);

  document.getElementById('btn-change-profile').onclick = () => showProfileSelector(tg, sync);
  document.getElementById('btn-reload').onclick = () => showHome(tg, sync, profile, { reload: true });
  document.querySelectorAll('.lib-card').forEach(card => {
    card.onclick = () => { const t = titles.find(x => x.id === card.dataset.title); if (t) showDetail(tg, sync, profile, t); };
  });
  focusFirst('.lib-card');
}

function showDetail(tg, sync, profile, t) {
  const back = () => showHome(tg, sync, profile);
  setBackHandler(back);
  const progress = loadProgress(profile.id);
  const st = titleState(t, progress);
  const nextLabel = !st.next ? '' : st.continueWatching && progress[st.next.key] && !progress[st.next.key].is_completed
    ? `▶ Continuar ${t.tipo === 'serie' ? esc(st.next.label) : ''}` : `▶ Reproducir ${t.tipo === 'serie' ? esc(st.next.label) : ''}`;

  const list = t.archivos.map((f) => {
    const p = progress[f.key];
    const pct = p?.duration ? Math.min(100, p.current_time / p.duration * 100) : 0;
    const ep = f.season || f.episode ? `T${f.season}·E${String(f.episode).padStart(2, '0')}` : '';
    return `<div class="ep" tabindex="0" data-focusable data-key="${esc(f.key)}">
      <div class="ep-num">${ep || '•'}</div>
      <div class="ep-info"><div class="ep-name">${esc(f.label)}</div>
        <div class="ep-meta">${[fmtDur(f.duration), fmtSize(f.size), new Date(f.date * 1000).toLocaleDateString()].filter(Boolean).join(' · ')}</div>
        ${pct ? `<div class="poster-progress"><i style="width:${pct}%"></i></div>` : ''}</div>
      <div class="ep-state">${p?.is_completed ? '✓ Visto' : pct ? Math.round(pct) + '%' : ''}</div>
    </div>`;
  }).join('');

  showScreen(`
    <div class="screen detail" style="--pc:${posterColor(t.grupo + t.nombre)}">
      <button class="btn-ghost" data-focusable id="d-back">← Volver</button>
      <div class="detail-head">
        <div class="lib-card-poster big" style="--pc:${posterColor(t.grupo + t.nombre)}">
          <span class="poster-group">${esc(t.grupo)}</span><span class="poster-name">${esc(t.nombre)}</span></div>
        <div>
          <div class="detail-kicker">${t.tipo === 'serie' ? 'Serie' : 'Película'} · ${esc(t.grupo)}</div>
          <h1>${esc(t.nombre)}</h1>
          <p class="detail-sub">${t.archivos.length} ${t.tipo === 'serie' ? 'episodios' : 'archivo(s)'} · ${t.origen.tipo === 'macro' ? 'Sección de canal macro' : 'Canal dedicado'}</p>
          ${t.archivos[0]?.synopsis ? `<p class="detail-syn">${esc(t.archivos[0].synopsis)}</p>` : ''}
          ${st.next ? `<button class="btn" data-focusable id="d-play">${nextLabel}</button>` : '<p>Este canal todavía no tiene vídeos.</p>'}
        </div>
      </div>
      <h2 class="row-title">${t.tipo === 'serie' ? 'Episodios' : 'Archivos'}</h2>
      <div class="ep-list">${list}</div>
    </div>`);

  const play = (f) => {
    const p = loadProgress(profile.id)[f.key];
    setBackHandler(null);
    playFile({ client: tg.getClient(), peerOf: tg.peerOf, file: f, title: t, profile,
      resumeAt: p && !p.is_completed ? p.current_time : 0, mount: app,
      onClose: () => showDetail(tg, sync, profile, t) });
  };
  document.getElementById('d-back').onclick = back;
  document.getElementById('d-play')?.addEventListener('click', () => play(st.next));
  document.querySelectorAll('.ep').forEach(el => {
    el.onclick = () => { const f = t.archivos.find(x => x.key === el.dataset.key); if (f) play(f); };
  });
  focusFirst('#d-play, .ep');
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
      <div class="avatar">${(p.name || '?')[0].toUpperCase()}</div>
      <div class="profile-name">${p.name}</div>
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

    await showProfileSelector(tg, sync);

  } catch (err) {
    console.error(err);
    showError(err?.message || String(err));
  }
}

initDpad();
start();
