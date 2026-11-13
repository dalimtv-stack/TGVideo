import './style.css';
import { createTelegramClient } from './core/telegram.js';
import { createTelegramSync } from './sync/telegramSync.js';

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

// ---------- UI de login Telegram ----------
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
    const client = tg.getClient();

    // Crear el módulo de sincronización
    const sync = createTelegramSync({
      getClient: async () => {
        await tg.ready();
        return tg.getClient();
      },
      peerOf: tg.peerOf,
    });

    // Guardamos en window para depuración
    window.tg = tg;
    window.sync = sync;

    showScreen(`
      <div class="screen center">
        <h1>TGVideo</h1>
        <p style="margin:1rem 0;opacity:0.8;">Sesión de Telegram iniciada correctamente</p>
        <button id="btn-profiles" class="btn">Ver perfiles</button>
        <button id="btn-logout" class="btn btn-secondary" style="margin-top:0.8rem;">Cerrar sesión</button>
      </div>
    `);

    document.getElementById('btn-profiles')?.addEventListener('click', async () => {
      showLoading('Cargando perfiles…');
      try {
        const profiles = await sync.listProfiles();
        if (!profiles.length) {
          showScreen(`
            <div class="screen center">
              <h2>No hay perfiles</h2>
              <p style="margin:1rem 0;opacity:0.7;">Aún no se ha creado ningún perfil de sincronización.</p>
              <button id="btn-back" class="btn">Volver</button>
            </div>
          `);
          document.getElementById('btn-back')?.addEventListener('click', start);
          return;
        }

        const list = profiles.map(p => `
          <div class="profile-card" data-id="${p.id}">
            <div class="avatar">${(p.name || '?')[0].toUpperCase()}</div>
            <div>
              <strong>${p.name}</strong>
              <div style="font-size:0.85rem;opacity:0.6;">${p.age_limit || ''}</div>
            </div>
          </div>
        `).join('');

        showScreen(`
          <div class="screen">
            <h2 style="text-align:center;margin-bottom:1.5rem;">¿Quién está viendo?</h2>
            <div class="profiles-grid">${list}</div>
            <div style="text-align:center;margin-top:2rem;">
              <button id="btn-back" class="btn btn-secondary">Volver</button>
            </div>
          </div>
        `);
        document.getElementById('btn-back')?.addEventListener('click', start);
      } catch (err) {
        showError(err?.message || String(err));
      }
    });

    document.getElementById('btn-logout')?.addEventListener('click', async () => {
      await tg.logout();
      start();
    });

  } catch (err) {
    console.error(err);
    showError(err?.message || String(err));
  }
}

start();
