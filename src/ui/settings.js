import { getGlobalConfig, getTmdbKey, getCacheMaxMb, saveGlobalConfig } from '../settings/global.js';
import { loadProgress } from '../player/progress.js';
import { getPosterCacheStats, optimizePosterCache, clearPosterCache } from '../metadata/posterCache.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function profileAvatar(profile) { return ['👤', '🙂', '🎬', '🌟', '🐱'].includes(profile.avatar) ? profile.avatar : esc((profile.name || '?')[0].toUpperCase()); }

export function modal(title, body, subtitle = '') {
  const previousFocus = document.activeElement;
  const overlay = document.createElement('div');
  overlay.className = 'settings-overlay';
  const subtitleHtml = subtitle ? `<div class="modal-subtitle" style="font-size:0.85rem;color:#aaa;margin-top:0.35rem;font-weight:normal;word-break:break-word;">${subtitle}</div>` : '';
  overlay.innerHTML = `<section class="settings-dialog" role="dialog" aria-modal="true" aria-label="${esc(title)}"><header style="align-items:flex-start;"><div><h2 style="font-size:1.15rem;word-break:break-all;line-height:1.35;">${esc(title)}</h2>${subtitleHtml}</div><button class="btn-icon" data-focusable aria-label="Cerrar">×</button></header>${body}</section>`;
  document.body.append(overlay);
  const close = () => { overlay.remove(); previousFocus?.focus({ preventScroll: true }); };
  overlay.querySelector('[aria-label="Cerrar"]').onclick = close;
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  overlay.addEventListener('keydown', e => {
    const isBackKey = ['Escape', 'GoBack', 'Back'].includes(e.key) || e.keyCode === 4 ||
      (e.key === 'Backspace' && !['INPUT', 'TEXTAREA'].includes(e.target.tagName));
    if (isBackKey) {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if (e.key === 'Tab') {
      const items = [...overlay.querySelectorAll('button, input, select')].filter(el => !el.disabled);
      const first = items[0], last = items.at(-1);
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    }
    // El D-Pad queda dentro del diálogo, permitiendo subir/bajar entre campos e inputs
    const isTextInput = ['INPUT', 'TEXTAREA'].includes(e.target.tagName);
    if (['ArrowUp', 'ArrowDown'].includes(e.key)) {
      const items = [...overlay.querySelectorAll('[data-focusable]')].filter(el => !el.disabled && el.offsetParent);
      const index = items.indexOf(document.activeElement);
      const delta = e.key === 'ArrowUp' ? -1 : 1;
      const next = items[Math.max(0, Math.min(items.length - 1, index + delta))];
      if (next) {
        e.preventDefault();
        e.stopPropagation();
        next.focus(); next.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    } else if (['ArrowLeft', 'ArrowRight'].includes(e.key) && !isTextInput) {
      const items = [...overlay.querySelectorAll('[data-focusable]')].filter(el => !el.disabled && el.offsetParent);
      const index = items.indexOf(document.activeElement);
      const delta = e.key === 'ArrowLeft' ? -1 : 1;
      const next = items[Math.max(0, Math.min(items.length - 1, index + delta))];
      if (next) {
        e.preventDefault();
        e.stopPropagation();
        next.focus(); next.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    }
  });

  const initialFocus = overlay.querySelector('input[data-focusable], button[data-focusable]') || overlay.querySelector('button');
  initialFocus?.focus({ preventScroll: true });
  return { overlay, close };
}

export function showProfileMenu({ profile, sync, onSwitch, onChanged, onGlobalChanged, libraryTitles = [] }) {
  const { overlay, close } = modal(profile.name, `<nav class="profile-menu"><button class="btn-ghost" data-focusable data-action="switch">Cambiar de perfil</button><button class="btn-ghost" data-focusable data-action="profile">Ajustes de perfil</button><button class="btn-ghost" data-focusable data-action="global">Ajustes globales</button></nav>`);
  overlay.querySelector('[data-action="switch"]').onclick = () => { close(); onSwitch(); };
  overlay.querySelector('[data-action="profile"]').onclick = () => { close(); profileSettings(profile, sync, onChanged); };
  overlay.querySelector('[data-action="global"]').onclick = () => { close(); globalSettings(sync, onGlobalChanged, libraryTitles); };
}

function profileSettings(profile, sync, onChanged) {
  const avatars = ['👤', '🙂', '🎬', '🌟', '🐱'];
  const localPlayer = typeof localStorage !== 'undefined' ? localStorage.getItem(`tgvideo_player_${profile.id}`) : null;
  const currentPlayer = profile.player || localPlayer || 'artplayer';
  const localSkip = typeof localStorage !== 'undefined' ? localStorage.getItem(`tgvideo_skip_${profile.id}`) : null;
  const currentSkip = Number(profile.skip_seconds || localSkip || 10);

  const { overlay, close } = modal('Ajustes de perfil', `
    <form class="profile-settings-form">
      <div class="settings-fields">
        <label>Nombre
          <input name="name" value="${esc(profile.name)}" required maxlength="60">
        </label>
        <label>Avatar
          <select name="avatar">
            ${avatars.map(a => `<option ${a === profile.avatar ? 'selected' : ''}>${a}</option>`).join('')}
          </select>
        </label>
      </div>

      <fieldset class="settings-section">
        <legend class="settings-legend">Reproductor</legend>
        <div class="settings-radios">
          <label class="settings-radio-label" data-focusable>
            <input type="radio" name="player" value="artplayer" ${currentPlayer !== 'native' ? 'checked' : ''}>
            <div class="settings-radio-info">
              <strong>ArtPlayer</strong>
              <small>Diseño cinemático, gestos táctiles, proporción, subtítulos y velocidad.</small>
            </div>
          </label>
          <label class="settings-radio-label" data-focusable>
            <input type="radio" name="player" value="native" ${currentPlayer === 'native' ? 'checked' : ''}>
            <div class="settings-radio-info">
              <strong>Reproductor nativo</strong>
              <small>El que estaba antes. Recomendado en iPhone para seleccionar audios, subtítulos y AirPlay.</small>
            </div>
          </label>
        </div>

        <div class="settings-field-row">
          <label class="settings-label-inline">
            <span>Salto por doble toque / doble clic:</span>
            <select name="skipSeconds" class="settings-select" data-focusable>
              <option value="5" ${currentSkip === 5 ? 'selected' : ''}>5 segundos</option>
              <option value="10" ${currentSkip === 10 ? 'selected' : ''}>10 segundos (por defecto)</option>
              <option value="15" ${currentSkip === 15 ? 'selected' : ''}>15 segundos</option>
              <option value="30" ${currentSkip === 30 ? 'selected' : ''}>30 segundos</option>
            </select>
          </label>
        </div>
      </fieldset>

      <p class="settings-status" role="status"></p>
      <button class="btn" data-focusable type="submit">Guardar</button>
    </form>
  `);

  overlay.querySelector('form').onsubmit = async e => {
    e.preventDefault();
    const form = e.currentTarget, button = form.querySelector('[type="submit"]');
    const name = form.elements.name.value.trim();
    if (!name) return;
    const player = form.elements.player?.value || 'artplayer';
    const skipSeconds = Number(form.elements.skipSeconds?.value) || 10;

    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(`tgvideo_player_${profile.id}`, player);
      localStorage.setItem(`tgvideo_skip_${profile.id}`, String(skipSeconds));
    }
    profile.player = player;
    profile.skip_seconds = skipSeconds;

    button.disabled = true;
    try {
      const remote = await sync.pullProfile(profile.id);
      if (!remote) throw new Error('No se pudo leer el perfil. Inténtalo de nuevo.');
      const changed = { ...remote.profile, name, avatar: form.elements.avatar.value, player, skip_seconds: skipSeconds };
      await sync.pushProfile({ ...remote, profile: changed, progress: sync.mergeProgress(loadProgress(profile.id), remote.progress || {}) });
      Object.assign(profile, changed);
      close(); onChanged();
    } catch (error) { form.querySelector('[role="status"]').textContent = error.message; }
    finally { button.disabled = false; }
  };
}

function globalSettings(sync, onChanged, libraryTitles = []) {
  const ownKey = !!getGlobalConfig().tmdb?.apiKey;
  const demoAvailable = !!import.meta.env?.VITE_TMDB_DEMO_API_KEY;
  const status = ownKey ? 'Usando tu clave personalizada de TMDB.' : demoAvailable ? 'Usando clave demo integrada.' : 'No hay clave demo configurada. Introduce tu clave de TMDB.';
  const currentMaxMb = getCacheMaxMb() || 100;

  const { overlay, close } = modal('Ajustes globales', `
    <form class="global-settings-form">
      <fieldset class="settings-section">
        <legend class="settings-legend">Metadatos (TMDB)</legend>
        <p class="settings-hint">${status}</p>
        <label>Clave de TMDB
          <input name="apiKey" type="password" autocomplete="off" placeholder="${ownKey ? 'Nueva clave (dejar vacío para conservar)' : 'API Key o token de lectura'}">
        </label>
        ${ownKey ? `<button class="btn-ghost btn-sm" data-focusable type="button" id="reset-tmdb">${demoAvailable ? 'Usar clave demo' : 'Eliminar clave personalizada'}</button>` : ''}
      </fieldset>

      <fieldset class="settings-section">
        <legend class="settings-legend">Caché de portadas</legend>
        <p class="settings-hint">Almacena las carátulas en el dispositivo para no descargarlas continuamente.</p>
        <label>Límite de espacio en megas (MB)
          <input name="cacheMaxMb" type="number" min="10" max="2000" step="10" value="${currentMaxMb}">
        </label>
        <div class="cache-stats-box" id="cache-stats">
          <span>Calculando espacio de caché…</span>
        </div>
        <div class="settings-actions-inline">
          <button class="btn-ghost btn-sm" data-focusable type="button" id="btn-optimize-cache">Optimizar caché</button>
          <button class="btn-ghost btn-sm" data-focusable type="button" id="btn-clear-cache">Vaciar caché</button>
        </div>
      </fieldset>

      <p class="settings-status" role="status"></p>
      <div class="settings-actions">
        <button class="btn" data-focusable type="submit">Guardar ajustes</button>
      </div>
    </form>
  `);

  const statsBox = overlay.querySelector('#cache-stats');
  const refreshStats = async () => {
    if (!statsBox) return;
    const stats = await getPosterCacheStats();
    statsBox.innerHTML = `<strong>Uso actual:</strong> ${stats.mb} MB de ${stats.maxMb} MB · <span>${stats.count} portadas guardadas</span>`;
  };
  refreshStats();

  overlay.querySelector('#btn-optimize-cache')?.addEventListener('click', async () => {
    const btn = overlay.querySelector('#btn-optimize-cache');
    const msg = overlay.querySelector('[role="status"]');
    btn.disabled = true;
    msg.textContent = 'Optimizando caché y eliminando portadas huérfanas…';
    try {
      const validUrls = [];
      for (const t of libraryTitles) {
        if (t.metadata?.poster) validUrls.push(t.metadata.poster);
        if (t.metadata?.backdrop) validUrls.push(t.metadata.backdrop);
        if (t.archivos) {
          for (const f of t.archivos) {
            if (f.metadata?.poster) validUrls.push(f.metadata.poster);
          }
        }
      }
      const res = await optimizePosterCache(validUrls);
      await refreshStats();
      msg.textContent = `✓ Caché optimizada: ${res.deleted} portadas obsoletas eliminadas (${res.freedMb} MB liberados).`;
    } catch (e) {
      msg.textContent = 'Error al optimizar la caché: ' + e.message;
    } finally {
      btn.disabled = false;
    }
  });

  overlay.querySelector('#btn-clear-cache')?.addEventListener('click', async () => {
    if (!confirm('¿Seguro que deseas vaciar toda la caché de portadas?')) return;
    const msg = overlay.querySelector('[role="status"]');
    await clearPosterCache();
    await refreshStats();
    msg.textContent = '✓ Caché de portadas vaciada por completo.';
  });

  async function save({ apiKey, cacheMaxMb }) {
    const buttons = overlay.querySelectorAll('button'); buttons.forEach(b => b.disabled = true);
    const message = overlay.querySelector('[role="status"]');
    message.textContent = 'Guardando configuración…';
    try {
      if (apiKey) {
        const url = new URL('https://api.themoviedb.org/3/configuration');
        const headers = {};
        if (apiKey.includes('.')) headers.Authorization = `Bearer ${apiKey}`;
        else url.searchParams.set('api_key', apiKey);
        const response = await fetch(url, { headers });
        if (!response.ok) throw new Error('No se pudo validar la clave de TMDB. Comprueba la clave y tu conexión.');
      }
      await saveGlobalConfig(sync, { apiKey, cacheMaxMb });
      close(); onChanged();
    } catch (error) { message.textContent = error.message; }
    finally { buttons.forEach(b => b.disabled = false); }
  }

  overlay.querySelector('form').onsubmit = e => {
    e.preventDefault();
    const key = e.currentTarget.elements.apiKey.value.trim();
    const cacheMaxMb = Number(e.currentTarget.elements.cacheMaxMb.value) || 100;
    save({ apiKey: key || (ownKey ? undefined : ''), cacheMaxMb });
  };
  overlay.querySelector('#reset-tmdb')?.addEventListener('click', () => {
    const cacheMaxMb = Number(overlay.querySelector('[name="cacheMaxMb"]').value) || 100;
    save({ apiKey: '', cacheMaxMb });
  });
}
