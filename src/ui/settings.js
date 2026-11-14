import { getGlobalConfig, getTmdbKey, saveGlobalConfig } from '../settings/global.js';
import { loadProgress } from '../player/progress.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function profileAvatar(profile) { return ['👤', '🙂', '🎬', '🌟', '🐱'].includes(profile.avatar) ? profile.avatar : esc((profile.name || '?')[0].toUpperCase()); }

function modal(title, body) {
  const previousFocus = document.activeElement;
  const overlay = document.createElement('div');
  overlay.className = 'settings-overlay';
  overlay.innerHTML = `<section class="settings-dialog" role="dialog" aria-modal="true" aria-label="${esc(title)}"><header><h2>${esc(title)}</h2><button class="btn-icon" data-focusable aria-label="Cerrar">×</button></header>${body}</section>`;
  document.body.append(overlay);
  const close = () => { overlay.remove(); previousFocus?.focus({ preventScroll: true }); };
  overlay.querySelector('[aria-label="Cerrar"]').onclick = close;
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  overlay.addEventListener('keydown', e => {
    if (['Escape', 'Backspace', 'GoBack'].includes(e.key) && !['INPUT', 'TEXTAREA'].includes(e.target.tagName)) { e.preventDefault(); e.stopPropagation(); close(); }
    if (e.key === 'Tab') {
      const items = [...overlay.querySelectorAll('button, input, select')].filter(el => !el.disabled);
      const first = items[0], last = items.at(-1);
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    }
    // El D-Pad queda dentro del diálogo, no en la biblioteca del fondo.
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) && !['INPUT', 'SELECT'].includes(e.target.tagName)) {
      const items = [...overlay.querySelectorAll('[data-focusable]')];
      const index = items.indexOf(document.activeElement);
      const delta = ['ArrowLeft', 'ArrowUp'].includes(e.key) ? -1 : 1;
      items[Math.max(0, Math.min(items.length - 1, index + delta))]?.focus({ preventScroll: true });
      e.preventDefault(); e.stopPropagation();
    }
  });
  overlay.querySelector('button')?.focus({ preventScroll: true });
  return { overlay, close };
}
export function showProfileMenu({ profile, sync, onSwitch, onChanged, onGlobalChanged }) {
  const { overlay, close } = modal(profile.name, `<nav class="profile-menu"><button class="btn-ghost" data-focusable data-action="switch">Cambiar de perfil</button><button class="btn-ghost" data-focusable data-action="profile">Ajustes de perfil</button><button class="btn-ghost" data-focusable data-action="global">Ajustes globales</button></nav>`);
  overlay.querySelector('[data-action="switch"]').onclick = () => { close(); onSwitch(); };
  overlay.querySelector('[data-action="profile"]').onclick = () => { close(); profileSettings(profile, sync, onChanged); };
  overlay.querySelector('[data-action="global"]').onclick = () => { close(); globalSettings(sync, onGlobalChanged); };
}
function profileSettings(profile, sync, onChanged) {
  const avatars = ['👤', '🙂', '🎬', '🌟', '🐱'];
  const { overlay, close } = modal('Ajustes de perfil', `<form><label>Nombre<input name="name" value="${esc(profile.name)}" required maxlength="60"></label><label>Avatar<select name="avatar">${avatars.map(a => `<option ${a === profile.avatar ? 'selected' : ''}>${a}</option>`).join('')}</select></label><p class="settings-status" role="status"></p><button class="btn" data-focusable type="submit">Guardar</button></form>`);
  overlay.querySelector('form').onsubmit = async e => {
    e.preventDefault();
    const form = e.currentTarget, button = form.querySelector('[type="submit"]');
    const name = form.elements.name.value.trim();
    if (!name) return;
    button.disabled = true;
    try {
      const remote = await sync.pullProfile(profile.id);
      if (!remote) throw new Error('No se pudo leer el perfil. Inténtalo de nuevo.');
      const changed = { ...remote.profile, name, avatar: form.elements.avatar.value };
      await sync.pushProfile({ ...remote, profile: changed, progress: sync.mergeProgress(loadProgress(profile.id), remote.progress || {}) });
      Object.assign(profile, changed);
      close(); onChanged();
    } catch (error) { form.querySelector('[role="status"]').textContent = error.message; }
    finally { button.disabled = false; }
  };
}
function globalSettings(sync, onChanged) {
  const ownKey = !!getGlobalConfig().tmdb?.apiKey;
  const demoAvailable = !!import.meta.env?.VITE_TMDB_DEMO_API_KEY;
  const status = ownKey ? 'Usando tu clave personalizada.' : demoAvailable ? 'Usando clave demo integrada.' : 'No hay una clave demo configurada. Introduce tu clave de TMDB.';
  const { overlay, close } = modal('Ajustes globales', `<form><p>${status}</p><label>Clave de TMDB<input name="apiKey" type="password" autocomplete="off" placeholder="${ownKey ? 'Nueva clave (dejar vacío para conservar)' : 'API Key o token de lectura'}"></label><p class="settings-status" role="status"></p><div class="settings-actions"><button class="btn" data-focusable type="submit">Guardar</button>${ownKey ? `<button class="btn-ghost" data-focusable type="button" id="reset-tmdb">${demoAvailable ? 'Usar clave demo' : 'Eliminar clave personalizada'}</button>` : ''}</div></form>`);
  async function save(apiKey) {
    const buttons = overlay.querySelectorAll('button'); buttons.forEach(b => b.disabled = true);
    const message = overlay.querySelector('[role="status"]');
    message.textContent = 'Guardando en Telegram…';
    try {
      // Validar antes de subir; nunca mostrar ni registrar la clave.
      if (apiKey) {
        const url = new URL('https://api.themoviedb.org/3/configuration');
        const headers = {};
        if (apiKey.includes('.')) headers.Authorization = `Bearer ${apiKey}`;
        else url.searchParams.set('api_key', apiKey);
        const response = await fetch(url, { headers });
        if (!response.ok) throw new Error('No se pudo validar la clave de TMDB. Comprueba la clave y tu conexión.');
      }
      await saveGlobalConfig(sync, apiKey);
      close(); onChanged();
    } catch (error) { message.textContent = error.message; }
    finally { buttons.forEach(b => b.disabled = false); }
  }
  overlay.querySelector('form').onsubmit = e => {
    e.preventDefault();
    const key = e.currentTarget.elements.apiKey.value.trim();
    if (!key && ownKey) { close(); return; }
    save(key);
  };
  overlay.querySelector('#reset-tmdb')?.addEventListener('click', () => save(''));
}
