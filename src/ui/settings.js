// src/ui/settings.js
import { getGlobalConfig, getTmdbKey, getCacheMaxMb, saveGlobalConfig } from '../settings/global.js';
import { loadProgress } from '../player/progress.js';
import { getPosterCacheStats, optimizePosterCache, clearPosterCache } from '../metadata/posterCache.js';
import { pruneOverrides, getOverridesSizeBytes } from '../metadata/overrides.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const UI_SCALE_LEVELS = [
  { id: 'diminuto', label: 'Diminuto', scale: 0.72 },
  { id: 'muy-pequeno', label: 'Muy pequeño', scale: 0.82 },
  { id: 'pequeno', label: 'Pequeño', scale: 0.92 },
  { id: 'normal', label: 'Normal', scale: 1.0 },
  { id: 'grande', label: 'Grande (predeterminado)', scale: 1.12 },
  { id: 'muy-grande', label: 'Muy Grande', scale: 1.25 },
  { id: 'gigante', label: 'Gigante', scale: 1.40 },
];

export function getDeviceId() {
  if (typeof localStorage === 'undefined') return 'device_default';
  let devId = localStorage.getItem('tgvideo_device_id');
  if (!devId) {
    devId = 'dev_' + Math.random().toString(36).slice(2, 9) + '_' + Date.now().toString(36);
    localStorage.setItem('tgvideo_device_id', devId);
  }
  return devId;
}

export function getDeviceSettings(profile) {
  const deviceId = getDeviceId();
  const devProfile = profile?.devices?.[deviceId] || {};
  const localPlayer = typeof localStorage !== 'undefined' ? localStorage.getItem('tgvideo_device_player') : null;
  const legacyLocalPlayer = typeof localStorage !== 'undefined' && profile?.id ? localStorage.getItem(`tgvideo_player_${profile.id}`) : null;
  const localSkip = typeof localStorage !== 'undefined' ? localStorage.getItem('tgvideo_device_skip') : null;
  const legacyLocalSkip = typeof localStorage !== 'undefined' && profile?.id ? localStorage.getItem(`tgvideo_skip_${profile.id}`) : null;
  const localScale = typeof localStorage !== 'undefined' ? localStorage.getItem('tgvideo_device_scale') : null;
  const legacyLocalScale = typeof localStorage !== 'undefined' && profile?.id ? localStorage.getItem(`tgvideo_scale_${profile.id}`) : null;

  return {
    deviceId,
    player: devProfile.player || localPlayer || profile?.player || legacyLocalPlayer || 'artplayer',
    skipSeconds: Number(devProfile.skip_seconds || localSkip || profile?.skip_seconds || legacyLocalSkip || 10),
    uiScale: Number(devProfile.ui_scale ?? localScale ?? profile?.ui_scale ?? legacyLocalScale ?? 4),
  };
}

export function applyProfileScale(profile) {
  const dev = getDeviceSettings(profile);
  const rawIdx = dev.uiScale;
  const validIdx = Math.max(0, Math.min(UI_SCALE_LEVELS.length - 1, isNaN(rawIdx) ? 4 : rawIdx));
  const conf = UI_SCALE_LEVELS[validIdx];
  if (typeof document !== 'undefined') {
    document.documentElement.style.setProperty('--ui-scale', String(conf.scale));
    document.documentElement.setAttribute('data-ui-scale', conf.id);
  }
  return validIdx;
}

export function profileAvatar(profile) {
  return ['👤', '🙂', '🎬', '🌟', '🐱'].includes(profile.avatar) ? profile.avatar : esc((profile.name || '?')[0].toUpperCase());
}

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
      if (document.activeElement?.type === 'range') {
        // En sliders permitir que las flechas izquierda/derecha muevan el nivel sin saltar de input
        return;
      }
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
  const { overlay, close } = modal(profile.name, `
    <nav class="profile-menu">
      <button class="btn-ghost" data-focusable data-action="switch">Cambiar de perfil</button>
      <button class="btn-ghost" data-focusable data-action="profile">Ajustes de perfil</button>
      <button class="btn-ghost" data-focusable data-action="device">Ajustes de dispositivo</button>
      <button class="btn-ghost" data-focusable data-action="global">Ajustes globales</button>
    </nav>
  `);
  overlay.querySelector('[data-action="switch"]').onclick = () => { close(); onSwitch(); };
  overlay.querySelector('[data-action="profile"]').onclick = () => { close(); profileSettings(profile, sync, onChanged); };
  overlay.querySelector('[data-action="device"]').onclick = () => { close(); deviceSettings(profile, sync, onChanged); };
  overlay.querySelector('[data-action="global"]').onclick = () => { close(); globalSettings(sync, onGlobalChanged, libraryTitles); };
}

// 1. Ajustes de perfil: Únicamente Nombre y Avatar
function profileSettings(profile, sync, onChanged) {
  const avatars = ['👤', '🙂', '🎬', '🌟', '🐱'];

  const { overlay, close } = modal('Ajustes de perfil', `
    <form class="profile-settings-form">
      <div class="settings-fields">
        <label>Nombre
          <input name="name" value="${esc(profile.name)}" required maxlength="60" data-focusable autocomplete="off">
        </label>
        <label>Avatar
          <select name="avatar" data-focusable>
            ${avatars.map(a => `<option ${a === profile.avatar ? 'selected' : ''}>${a}</option>`).join('')}
          </select>
        </label>
      </div>

      <p class="settings-status" role="status"></p>
      <div class="settings-actions" style="margin-top:1.5rem;">
        <button class="btn" data-focusable type="submit">Guardar perfil</button>
      </div>
    </form>
  `, 'Configura el nombre y el avatar personal de este perfil');

  overlay.querySelector('form').onsubmit = async e => {
    e.preventDefault();
    const form = e.currentTarget;
    const name = form.elements.name.value.trim();
    if (!name) return;
    const avatar = form.elements.avatar.value;

    profile.name = name;
    profile.avatar = avatar;

    close();
    onChanged();

    // Sincronizar en segundo plano con Telegram sin bloquear la interfaz
    (async () => {
      try {
        const remote = await sync.pullProfile(profile.id);
        if (!remote) return;
        const changed = { ...remote.profile, name, avatar };
        await sync.pushProfile({
          ...remote,
          profile: changed,
          progress: sync.mergeProgress(loadProgress(profile.id), remote.progress || {})
        });
        Object.assign(profile, changed);
      } catch (err) {
        console.warn('[settings] Error al sincronizar nombre/avatar del perfil:', err);
      }
    })();
  };
}

// 2. Ajustes de dispositivo: Reproductor, Reproducción e Interfaz, Tamaño de portadas y letras
function deviceSettings(profile, sync, onChanged) {
  const devSettings = getDeviceSettings(profile);
  const currentPlayer = devSettings.player;
  const currentSkip = devSettings.skipSeconds;
  const currentScaleIndex = applyProfileScale(profile);
  const currentScaleLabel = UI_SCALE_LEVELS[currentScaleIndex]?.label || 'Grande (predeterminado)';

  const isAndroidApp = typeof window !== 'undefined' &&
    (window.Capacitor?.isNativePlatform?.() || window.Capacitor?.platform === 'android');

  const { overlay, close } = modal('Ajustes de dispositivo', `
    <form class="device-settings-form">
      <div class="profile-settings-cols">
        <div class="profile-settings-col">
          <fieldset class="settings-section">
            <legend class="settings-legend">Reproductor</legend>
            <div class="settings-radios">
              <label class="settings-radio-label ${currentPlayer === 'exoplayer' ? 'is-checked' : ''}" data-focusable tabindex="0" role="radio" aria-checked="${currentPlayer === 'exoplayer'}">
                <input type="radio" name="player" value="exoplayer" ${currentPlayer === 'exoplayer' ? 'checked' : ''}>
                <div class="settings-radio-info">
                  <strong>ExoPlayer ${isAndroidApp ? '★ Recomendado en Android TV' : '(Android TV / APK)'}</strong>
                  <small>Decodificación por hardware de MKV/4K, múltiples audios y subtítulos en Android TV.</small>
                </div>
              </label>

              <label class="settings-radio-label ${currentPlayer === 'artplayer' ? 'is-checked' : ''}" data-focusable tabindex="0" role="radio" aria-checked="${currentPlayer === 'artplayer'}">
                <input type="radio" name="player" value="artplayer" ${currentPlayer === 'artplayer' ? 'checked' : ''}>
                <div class="settings-radio-info">
                  <strong>ArtPlayer</strong>
                  <small>Diseño cinemático, gestos táctiles, selector OSD y velocidad (Web y PC).</small>
                </div>
              </label>

              <label class="settings-radio-label ${currentPlayer === 'native' ? 'is-checked' : ''}" data-focusable tabindex="0" role="radio" aria-checked="${currentPlayer === 'native'}">
                <input type="radio" name="player" value="native" ${currentPlayer === 'native' ? 'checked' : ''}>
                <div class="settings-radio-info">
                  <strong>Reproductor nativo</strong>
                  <small>Recomendado en iOS / Safari para AirPlay y audios nativos.</small>
                </div>
              </label>
            </div>
          </fieldset>
        </div>

        <div class="profile-settings-col">
          <fieldset class="settings-section">
            <legend class="settings-legend">Reproducción e Interfaz</legend>
            <div class="settings-field-row">
              <label class="settings-label-inline">
                <span>Salto por doble toque / clic:</span>
                <select name="skipSeconds" class="settings-select" data-focusable>
                  <option value="5" ${currentSkip === 5 ? 'selected' : ''}>5 segundos</option>
                  <option value="10" ${currentSkip === 10 ? 'selected' : ''}>10 segundos (por defecto)</option>
                  <option value="15" ${currentSkip === 15 ? 'selected' : ''}>15 segundos</option>
                  <option value="30" ${currentSkip === 30 ? 'selected' : ''}>30 segundos</option>
                </select>
              </label>
            </div>

            <div class="settings-field-row ui-scale-setting" style="margin-top:1rem;">
              <label class="settings-label-block">
                <div class="ui-scale-header">
                  <span>Tamaño de portadas y letras:</span>
                  <strong class="ui-scale-value" id="ui-scale-label">${currentScaleLabel}</strong>
                </div>
                <input type="range" name="uiScale" class="settings-slider" min="0" max="6" step="1" value="${currentScaleIndex}" data-focusable>
                <div class="ui-scale-ticks">
                  <span>Diminuto</span>
                  <span>Muy pequeño</span>
                  <span>Pequeño</span>
                  <span>Normal</span>
                  <span>Grande</span>
                  <span>Muy Grande</span>
                  <span>Gigante</span>
                </div>
              </label>
            </div>
          </fieldset>
        </div>
      </div>

      <p class="settings-status" role="status"></p>
      <div class="settings-actions" style="margin-top:1.25rem;">
        <button class="btn" data-focusable type="submit">Guardar en este dispositivo</button>
      </div>
    </form>
  `, 'Estas preferencias se guardan para este equipo sin alterar otros dispositivos');

  const scaleSlider = overlay.querySelector('input[name="uiScale"]');
  const scaleLabel = overlay.querySelector('#ui-scale-label');
  if (scaleSlider && scaleLabel) {
    const updateScaleDisplay = () => {
      const idx = Math.max(0, Math.min(UI_SCALE_LEVELS.length - 1, Number(scaleSlider.value)));
      const conf = UI_SCALE_LEVELS[idx];
      scaleLabel.textContent = conf.label;
      document.documentElement.style.setProperty('--ui-scale', String(conf.scale));
      document.documentElement.setAttribute('data-ui-scale', conf.id);
    };
    scaleSlider.addEventListener('input', updateScaleDisplay);
    scaleSlider.addEventListener('change', updateScaleDisplay);
  }

  overlay.querySelectorAll('.settings-radio-label').forEach(label => {
    const radio = label.querySelector('input[type="radio"]');
    const updateRadios = () => {
      if (radio) {
        radio.checked = true;
        overlay.querySelectorAll('.settings-radio-label').forEach(l => {
          const r = l.querySelector('input[type="radio"]');
          const isCh = Boolean(r?.checked);
          l.setAttribute('aria-checked', String(isCh));
          l.classList.toggle('is-checked', isCh);
        });
      }
    };
    label.addEventListener('click', updateRadios);
    label.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        updateRadios();
      }
    });
  });

  overlay.querySelector('form').onsubmit = async e => {
    e.preventDefault();
    const form = e.currentTarget;
    const player = form.elements.player?.value || 'artplayer';
    const skipSeconds = Number(form.elements.skipSeconds?.value) || 10;
    const scaleIndex = Number(form.elements.uiScale?.value ?? 4);

    const deviceId = getDeviceId();

    // Guardado local inmediato para este dispositivo
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('tgvideo_device_player', player);
      localStorage.setItem('tgvideo_device_skip', String(skipSeconds));
      localStorage.setItem('tgvideo_device_scale', String(scaleIndex));
      // Compatibilidad retroactiva con claves por perfil
      localStorage.setItem(`tgvideo_player_${profile.id}`, player);
      localStorage.setItem(`tgvideo_skip_${profile.id}`, String(skipSeconds));
      localStorage.setItem(`tgvideo_scale_${profile.id}`, String(scaleIndex));
    }

    // Guardado en memoria en el perfil bajo la clave de este dispositivo
    if (!profile.devices) profile.devices = {};
    profile.devices[deviceId] = {
      player,
      skip_seconds: skipSeconds,
      ui_scale: scaleIndex,
      updated_at: Date.now()
    };
    profile.player = player;
    profile.skip_seconds = skipSeconds;
    profile.ui_scale = scaleIndex;

    applyProfileScale(profile);
    close();
    onChanged();

    // Sincronizar en segundo plano dentro del JSON de perfil en Telegram
    (async () => {
      try {
        const remote = await sync.pullProfile(profile.id);
        if (!remote) return;
        const remoteDevices = remote.profile?.devices || {};
        remoteDevices[deviceId] = {
          player,
          skip_seconds: skipSeconds,
          ui_scale: scaleIndex,
          updated_at: Date.now()
        };
        const changed = {
          ...remote.profile,
          devices: remoteDevices,
          player,
          skip_seconds: skipSeconds,
          ui_scale: scaleIndex
        };
        await sync.pushProfile({
          ...remote,
          profile: changed,
          progress: sync.mergeProgress(loadProgress(profile.id), remote.progress || {})
        });
        Object.assign(profile, changed);
      } catch (err) {
        console.warn('[settings] Error al sincronizar ajustes de dispositivo:', err);
      }
    })();
  };
}

// 3. Ajustes globales: TMDB y Caché de portadas
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
          <input name="apiKey" type="password" autocomplete="off" data-focusable placeholder="${ownKey ? 'Nueva clave (dejar vacío para conservar)' : 'API Key o token de lectura'}">
        </label>
        ${ownKey ? `<button class="btn-ghost btn-sm" data-focusable type="button" id="reset-tmdb">${demoAvailable ? 'Usar clave demo' : 'Eliminar clave personalizada'}</button>` : ''}
      </fieldset>

      <fieldset class="settings-section">
        <legend class="settings-legend">Caché de portadas</legend>
        <p class="settings-hint">Almacena las carátulas en el dispositivo para no descargarlas continuamente.</p>
        <label>Límite de espacio en megas (MB)
          <input name="cacheMaxMb" type="number" min="10" max="2000" step="10" value="${currentMaxMb}" data-focusable>
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
      const validKeys = [];
      for (const t of libraryTitles) {
        validKeys.push(String(t.id));
        if (t.tmdbId) validKeys.push('tmdb:' + t.tmdbId);
        if (t.metadata?.id) validKeys.push('tmdb:' + t.metadata.id);
        if (t.metadata?.poster) validUrls.push(t.metadata.poster);
        if (t.metadata?.backdrop) validUrls.push(t.metadata.backdrop);
        if (t.archivos) {
          for (const f of t.archivos) {
            if (f.key) validKeys.push(String(f.key));
            if (f.tmdbId) validKeys.push('tmdb:' + f.tmdbId);
            if (f.metadata?.poster) validUrls.push(f.metadata.poster);
          }
        }
      }
      const res = await optimizePosterCache(validUrls);

      let pruneMsg = '';
      const ovBytes = getOverridesSizeBytes();
      if (ovBytes > 1024 * 1024) {
        msg.textContent = 'Overrides > 1 MB: limpiando identificaciones de títulos que ya no están…';
        const pr = await pruneOverrides(validKeys, sync);
        pruneMsg = pr.removed
          ? ` · Overrides: ${pr.removed} entradas eliminadas (${(pr.bytes / 1024).toFixed(0)} KB)`
          : ' · Overrides: sin entradas huérfanas';
      }

      await refreshStats();
      msg.textContent = `✓ Caché optimizada: ${res.deleted} portadas obsoletas eliminadas (${res.freedMb} MB liberados).${pruneMsg}`;
    } catch (e) {
      msg.textContent = 'Error al optimizar: ' + (e?.message || e);
    }
    btn.disabled = false;
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
