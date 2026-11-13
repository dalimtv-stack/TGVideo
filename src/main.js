import './style.css';
import { createTelegramClient } from './core/telegram.js';
import { createTelegramSync } from './sync/telegramSync.js';
import { loadLibrary, groupLibrary } from './library/channels.js';

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
async function showHome(tg, sync, profile) {
  showLoading('Cargando biblioteca…');

  let lib = [];
  try {
    const client = tg.getClient();
    lib = await loadLibrary(client);
  } catch (err) {
    console.error('Error cargando biblioteca', err);
  }

  const grouped = groupLibrary(lib);

  let sectionsHtml = '';

  if (lib.length === 0) {
    sectionsHtml = `
      <div class="home-empty">
        <h2>Hola, ${profile.name}</h2>
        <p>No se han encontrado canales de vídeo.</p>
        <p style="opacity:0.6;margin-top:0.5rem;font-size:0.95rem;">
          Los canales deben terminar en <code>::Series::tgstorage</code> o <code>::Películas::tgstorage</code>
        </p>
      </div>
    `;
  } else {
    for (const [category, groups] of grouped) {
      sectionsHtml += `<section class="lib-section"><h2 class="lib-cat">${category}</h2>`;

      for (const [groupName, channels] of groups) {
        sectionsHtml += `
          <div class="lib-group">
            <h3 class="lib-group-title">${groupName}</h3>
            <div class="lib-row">
              ${channels.map(ch => `
                <div class="lib-card" data-id="${ch.id}" data-hash="${ch.hash}" data-macro="${ch.macro}">
                  <div class="lib-card-poster">
                    <span>${ch.macro ? '📁' : '🎬'}</span>
                  </div>
                  <div class="lib-card-name">${ch.name}</div>
                </div>
              `).join('')}
            </div>
          </div>
        `;
      }

      sectionsHtml += `</section>`;
    }
  }

  showScreen(`
    <div class="screen home-screen">
      <header class="home-header">
        <div class="home-logo">TGVideo</div>
        <div class="home-profile" id="btn-change-profile">
          <div class="avatar small">${(profile.name || '?')[0].toUpperCase()}</div>
          <span>${profile.name}</span>
        </div>
      </header>

      <main class="home-main">
        ${sectionsHtml}
      </main>
    </div>
  `);

  document.getElementById('btn-change-profile')?.addEventListener('click', () => {
    showProfileSelector(tg, sync);
  });

  // Click en canal (de momento solo log)
  document.querySelectorAll('.lib-card').forEach(card => {
    card.addEventListener('click', () => {
      console.log('Canal seleccionado', {
        id: card.dataset.id,
        hash: card.dataset.hash,
        macro: card.dataset.macro,
      });
      // TODO: abrir contenido del canal
    });
  });
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
    <div class="profile-card" data-id="${p.id}">
      <div class="avatar">${(p.name || '?')[0].toUpperCase()}</div>
      <div class="profile-name">${p.name}</div>
    </div>
  `).join('');

  const addCard = `
    <div class="profile-card add-profile" id="btn-add-profile">
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
      <button id="btn-logout" class="logout-btn">Cerrar sesión</button>
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

start();
