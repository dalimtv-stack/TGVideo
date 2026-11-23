import { isAndroidTV, isAndroidApp, applyDevicePixelZoom } from '../core/platform.js';
import { startAppUpdate } from '../core/updater.js';
import { checkForUpdate, CURRENT_VERSION } from '../core/updateCheck.js';
import { isDevLogEnabled, setDevLogEnabled, startDevLogging, stopDevLogging, uploadDevLog } from '../utils/devLogger.js';
// src/ui/settings.js
import { getGlobalConfig, getTmdbKey, getFanartKey, getCacheMaxMb, saveGlobalConfig } from '../settings/global.js';
import { validateFanartKey } from '../metadata/fanart.js';
import { loadProgress } from '../player/progress.js';
import { getPosterCacheStats, optimizePosterCache, clearPosterCache } from '../metadata/posterCache.js';
import { pruneOverrides, getOverridesSizeBytes } from '../metadata/overrides.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const UI_SCALE_LEVELS = [
  { id: 'diminuto', label: 'Diminuto', scale: 0.60 },
  { id: 'muy-pequeno', label: 'Muy pequeño', scale: 0.72 },
  { id: 'pequeno', label: 'Pequeño', scale: 0.85 },
  { id: 'normal', label: 'Normal', scale: 1.0 },
  { id: 'grande', label: 'Grande (predeterminado)', scale: 1.12 },
  { id: 'muy-grande', label: 'Muy Grande', scale: 1.22 },
  { id: 'gigante', label: 'Enorme', scale: 1.32 },
];

function normalizeScaleIndex(value, fallback = 4) {
  const index = Number(value);
  return Number.isFinite(index)
    ? Math.max(0, Math.min(UI_SCALE_LEVELS.length - 1, Math.round(index)))
    : fallback;
}

export const PIXEL_ZOOM_LEVELS = [
  { id: 'auto', label: 'Automático (según pantalla)', tickLabel: 'Auto', value: 'auto' },
  { id: '60', label: '60% (Muy compacto)', tickLabel: '60%', value: 0.60 },
  { id: '67', label: '67% (Compacto)', tickLabel: '67%', value: 0.67 },
  { id: '75', label: '75% (Equilibrado TV)', tickLabel: '75%', value: 0.75 },
  { id: '85', label: '85% (Medio)', tickLabel: '85%', value: 0.85 },
  { id: '100', label: '100% (Nativo sin zoom)', tickLabel: '100%', value: 1.0 },
  { id: '115', label: '115% (Grande)', tickLabel: '115%', value: 1.15 },
];

function normalizePixelZoomIndex(value, fallback = 0) {
  if (value === 'auto' || value === null || value === undefined) return 0;
  const num = typeof value === 'number' ? value : parseFloat(value);
  if (isNaN(num)) return fallback;
  let bestIdx = 0;
  let minDiff = Infinity;
  for (let i = 1; i < PIXEL_ZOOM_LEVELS.length; i++) {
    const diff = Math.abs(PIXEL_ZOOM_LEVELS[i].value - num);
    if (diff < minDiff) {
      minDiff = diff;
      bestIdx = i;
    }
  }
  return bestIdx;
}

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

  // En Android TV / Fire TV, resetear valores heredados de escritorio si no han sido calibrados expresamente
  if (typeof window !== 'undefined' && isAndroidTV()) {
    if (localStorage.getItem('tgvideo_tv_scale_calibrated') !== 'v3') {
      localStorage.removeItem('tgvideo_device_scale');
      localStorage.setItem('tgvideo_tv_scale_calibrated', 'v3');
    }
  }

  const localScale = typeof localStorage !== 'undefined' ? localStorage.getItem('tgvideo_device_scale') : null;
  const legacyLocalScale = typeof localStorage !== 'undefined' && profile?.id ? localStorage.getItem(`tgvideo_scale_${profile.id}`) : null;

  const isAndroidApp = typeof window !== 'undefined' &&
    (window.Capacitor?.isNativePlatform?.() || window.Capacitor?.platform === 'android');
  let chosenPlayer = devProfile.player || localPlayer || profile?.player || legacyLocalPlayer || 'artplayer';
  if (!isAndroidApp && chosenPlayer === 'exoplayer') {
    chosenPlayer = 'artplayer';
  }

  // Escala predeterminada según tipo de pantalla si el dispositivo no ha guardado aún una preferencia
  let defaultScaleIndex = 4; // 'Grande (1.12)' para PC y monitores de escritorio
  if (typeof window !== 'undefined') {
    if (isAndroidTV()) {
      // Con el ajuste de escala de píxeles (zoom) de TV activo, la escala 1.0 (Normal)
      // muestra exactamente la misma proporción (10-11 portadas por fila) que en PC de escritorio
      defaultScaleIndex = 3; // 'Normal (1.0)'
    }
  }

  // Se prioriza la escala específica de este hardware (localStorage o perfil bajo deviceId)
  const deviceSpecificScale = devProfile.ui_scale ?? localScale;
  const resolvedScale = (deviceSpecificScale !== null && deviceSpecificScale !== undefined)
    ? normalizeScaleIndex(deviceSpecificScale, defaultScaleIndex)
    : defaultScaleIndex;

  const localPixelZoom = typeof localStorage !== 'undefined' ? localStorage.getItem('tgvideo_device_pixel_zoom') : null;
  const devPixelZoom = devProfile.pixel_zoom ?? localPixelZoom ?? 'auto';
  const resolvedPixelZoomIdx = normalizePixelZoomIndex(devPixelZoom, 0);

  return {
    deviceId,
    player: chosenPlayer,
    skipSeconds: Number(devProfile.skip_seconds || localSkip || profile?.skip_seconds || legacyLocalSkip || 10),
    uiScale: resolvedScale,
    pixelZoom: devPixelZoom,
    pixelZoomIndex: resolvedPixelZoomIdx,
  };
}

export function applyProfileScale(profile) {
  const dev = getDeviceSettings(profile);
  const rawIdx = dev.uiScale;
  const validIdx = Math.max(0, Math.min(UI_SCALE_LEVELS.length - 1, isNaN(rawIdx) ? 3 : rawIdx));
  const conf = UI_SCALE_LEVELS[validIdx];
  if (typeof document !== 'undefined') {
    document.documentElement.style.setProperty('--ui-scale', String(conf.scale));
    document.documentElement.setAttribute('data-ui-scale', conf.id);
  }
  return validIdx;
}

// Carga dinámica de imágenes de avatares desde public/avatares/ usando Vite import.meta.glob
const avatarModules = import.meta.glob('/public/avatares/*.{png,jpg,jpeg,webp,svg,gif,avif,PNG,JPG,JPEG,WEBP,SVG,GIF,AVIF}', { eager: true });

function formatAvatarName(file) {
  const customNames = {
    'elfo-navidad.png': 'Elfo de Navidad',
    'carmen-sandiego.png': 'Carmen Sandiego',
    'lucifer.png': 'Lucifer',
  };
  const lower = file.toLowerCase();
  if (customNames[lower]) return customNames[lower];

  const base = file.replace(/\.[^.]+$/, '').replace(/[-_.]+/g, ' ').trim();
  return base
    .split(' ')
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function getAvailableAvatars() {
  const entries = Object.keys(avatarModules || {});
  const images = entries.map(path => {
    const file = path.replace(/^.*[\\/]/, '');
    return {
      id: file,
      name: formatAvatarName(file),
      type: 'image',
      file: file,
    };
  }).sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));

  const emojis = [
    { id: '👤', name: 'Usuario', type: 'emoji' },
    { id: '🙂', name: 'Sonrisa', type: 'emoji' },
    { id: '🎬', name: 'Cine', type: 'emoji' },
    { id: '🌟', name: 'Estrella', type: 'emoji' },
    { id: '🐱', name: 'Gato', type: 'emoji' },
  ];

  return [...images, ...emojis];
}

export const AVAILABLE_AVATARS = getAvailableAvatars();

export function profileAvatar(profile) {
  const av = profile?.avatar;
  if (!av) return esc((profile?.name || '?')[0].toUpperCase());
  if (typeof av === 'string' && (/\.(png|jpg|jpeg|webp|svg|gif|avif)$/i.test(av) || av.includes('/'))) {
    const cleanFile = av.replace(/^\/?(avatares\/)?/, '');
    return `<img src="/avatares/${esc(encodeURI(cleanFile))}" class="avatar-img" alt="${esc(profile.name || '')}" onerror="this.style.display='none';this.parentElement.textContent='👤';" />`;
  }
  return ['👤', '🙂', '🎬', '🌟', '🐱'].includes(av) ? av : esc((profile?.name || '?')[0].toUpperCase());
}

import { pickAvatar } from './avatarCarousel.js';
import { showNewsSettings } from './newsSettings.js';

export function modal(title, body, subtitle = '', onClose = null) {
  const previousFocus = document.activeElement;
  const overlay = document.createElement('div');
  overlay.className = 'settings-overlay';
  const subtitleHtml = subtitle ? `<div class="modal-subtitle" style="font-size:0.85rem;color:#aaa;margin-top:0.35rem;font-weight:normal;word-break:break-word;">${subtitle}</div>` : '';
  overlay.innerHTML = `<section class="settings-dialog" role="dialog" aria-modal="true" aria-label="${esc(title)}"><header style="align-items:flex-start;"><div><h2 style="font-size:1.15rem;word-break:break-all;line-height:1.35;">${esc(title)}</h2>${subtitleHtml}</div><button class="btn-icon" data-focusable aria-label="Cerrar">×</button></header>${body}</section>`;
  document.body.append(overlay);
  const close = () => { overlay.remove(); previousFocus?.focus({ preventScroll: true }); onClose?.(); };
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
    const isAvatarGrid = document.activeElement?.closest('.avatar-grid');

    if (isAvatarGrid && ['ArrowUp', 'ArrowDown'].includes(e.key)) {
      const gridItems = [...isAvatarGrid.querySelectorAll('[data-focusable]')].filter(el => !el.disabled && el.offsetParent);
      const idx = gridItems.indexOf(document.activeElement);
      if (idx !== -1) {
        const cols = 4;
        const targetIdx = e.key === 'ArrowUp' ? idx - cols : idx + cols;
        if (targetIdx >= 0 && targetIdx < gridItems.length) {
          e.preventDefault();
          e.stopPropagation();
          gridItems[targetIdx].focus();
          gridItems[targetIdx].scrollIntoView({ block: "nearest", behavior: "smooth" });
          return;
        }
      }
    }

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

export async function showProfileMenu({ profile, sync, onSwitch, onChanged, onGlobalChanged, libraryTitles = [] }) {
  const isApk = isAndroidApp();
  let updateInfo = null;

  if (isApk) {
    updateInfo = await checkForUpdate().catch(() => null);
  }

  // En la versión web no se muestra nada de actualización.
  // Solo en la APK: si hay actualización detectada se muestra el botón de descargar,
  // y si no hay ninguna detectada, el botón de "Buscar actualización, versión actual".
  let updateBtnHtml = '';
  if (isApk) {
    if (updateInfo?.hasUpdate) {
      updateBtnHtml = `
        <button class="btn-ghost btn-update-release" data-focusable data-action="update" style="display:flex;align-items:center;gap:0.75rem;">
          <span style="font-size:1.2rem;line-height:1;">⚡</span>
          <span style="display:flex;flex-direction:column;align-items:flex-start;text-align:left;">
            <strong style="color:#fff;font-size:0.92rem;">Descargar y actualizar (${esc(updateInfo.latestVersion)})</strong>
            <small style="color:#fca5a5;font-size:0.75rem;">Nueva versión oficial en GitHub</small>
          </span>
        </button>
      `;
    } else {
      updateBtnHtml = `
        <button class="btn-ghost btn-check-update" data-focusable data-action="check-update" style="display:flex;align-items:center;gap:0.75rem;">
          <span class="update-icon" style="font-size:1.2rem;line-height:1;">🔄</span>
          <span class="update-text" style="display:flex;flex-direction:column;align-items:flex-start;text-align:left;">
            <strong style="color:#fff;font-size:0.90rem;">Buscar actualización, versión actual ${esc(CURRENT_VERSION)}</strong>
            <small style="color:rgba(255,255,255,0.7);font-size:0.75rem;">Comprobar nuevas versiones en GitHub</small>
          </span>
        </button>
      `;
    }
  }

  const { overlay, close } = modal(profile.name, `
    <nav class="profile-menu">
      <button class="btn-ghost" data-focusable data-action="switch">Cambiar de perfil</button>
      <button class="btn-ghost" data-focusable data-action="profile">Ajustes de perfil</button>
      <button class="btn-ghost" data-focusable data-action="device">Ajustes de dispositivo</button>
      <button class="btn-ghost" data-focusable data-action="global">Ajustes globales</button>
      <button class="btn-ghost" data-focusable data-action="developer">Desarrollador</button>
      ${updateBtnHtml}
    </nav>
  `);
  overlay.querySelector('[data-action="switch"]').onclick = () => { close(); onSwitch(); };
  overlay.querySelector('[data-action="profile"]').onclick = () => { close(); profileSettings(profile, sync, onChanged); };
  overlay.querySelector('[data-action="device"]').onclick = () => { close(); deviceSettings(profile, sync, onChanged); };
  overlay.querySelector('[data-action="global"]').onclick = () => { close(); globalSettings(sync, onGlobalChanged, libraryTitles); };
  overlay.querySelector('[data-action="developer"]').onclick = () => { close(); developerSettings(profile, sync); };

  const updateBtn = overlay.querySelector('[data-action="update"]');
  if (updateBtn && updateInfo) {
    updateBtn.onclick = () => {
      close();
      startAppUpdate(updateInfo);
    };
  }

  const checkUpdateBtn = overlay.querySelector('[data-action="check-update"]');
  if (checkUpdateBtn) {
    checkUpdateBtn.onclick = async () => {
      const textContainer = checkUpdateBtn.querySelector('.update-text');
      const iconEl = checkUpdateBtn.querySelector('.update-icon');
      if (textContainer) {
        textContainer.innerHTML = `
          <strong style="color:#fff;font-size:0.90rem;">Buscando actualización…</strong>
          <small style="color:rgba(255,255,255,0.7);font-size:0.75rem;">Consultando GitHub…</small>
        `;
      }
      if (iconEl) iconEl.textContent = '⏳';
      checkUpdateBtn.style.pointerEvents = 'none';

      try {
        const freshInfo = await checkForUpdate(true);
        if (freshInfo?.hasUpdate) {
          const dot = document.getElementById('profile-update-dot');
          if (dot) dot.style.display = 'block';

          checkUpdateBtn.className = 'btn-ghost btn-update-release';
          checkUpdateBtn.setAttribute('data-action', 'update');
          checkUpdateBtn.style.pointerEvents = 'auto';
          checkUpdateBtn.innerHTML = `
            <span style="font-size:1.2rem;line-height:1;">⚡</span>
            <span style="display:flex;flex-direction:column;align-items:flex-start;text-align:left;">
              <strong style="color:#fff;font-size:0.92rem;">Descargar y actualizar (${esc(freshInfo.latestVersion)})</strong>
              <small style="color:#fca5a5;font-size:0.75rem;">Nueva versión oficial en GitHub</small>
            </span>
          `;
          checkUpdateBtn.onclick = () => {
            close();
            startAppUpdate(freshInfo);
          };
          checkUpdateBtn.focus();
        } else {
          checkUpdateBtn.style.pointerEvents = 'auto';
          if (iconEl) iconEl.textContent = '✓';
          if (textContainer) {
            textContainer.innerHTML = `
              <strong style="color:#4ade80;font-size:0.90rem;">Versión actual ${esc(CURRENT_VERSION)} al día</strong>
              <small style="color:rgba(255,255,255,0.7);font-size:0.75rem;">No hay nuevas actualizaciones</small>
            `;
          }
          setTimeout(() => {
            if (document.body.contains(checkUpdateBtn)) {
              if (iconEl) iconEl.textContent = '🔄';
              if (textContainer) {
                textContainer.innerHTML = `
                  <strong style="color:#fff;font-size:0.90rem;">Buscar actualización, versión actual ${esc(CURRENT_VERSION)}</strong>
                  <small style="color:rgba(255,255,255,0.7);font-size:0.75rem;">Comprobar nuevas versiones en GitHub</small>
                `;
              }
            }
          }, 3500);
        }
      } catch (err) {
        checkUpdateBtn.style.pointerEvents = 'auto';
        if (iconEl) iconEl.textContent = '⚠️';
        if (textContainer) {
          textContainer.innerHTML = `
            <strong style="color:#f87171;font-size:0.90rem;">Error al comprobar</strong>
            <small style="color:rgba(255,255,255,0.7);font-size:0.75rem;">Pulsa para reintentar</small>
          `;
        }
      }
    };
  }
}

// 4. Ajustes de desarrollador: Registro de log en Telegram (cada 60 segundos)
function developerSettings(profile, sync) {
  const isEnabled = isDevLogEnabled();

  const { overlay, close } = modal('Desarrollador', `
    <form class="developer-settings-form">
      <fieldset class="settings-section">
        <legend class="settings-legend">Depuración y Diagnóstico</legend>
        <label class="settings-checkbox-label" data-focusable tabindex="0" style="display:flex;align-items:flex-start;gap:0.75rem;padding:0.85rem;cursor:pointer;border-radius:6px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.12);">
          <input type="checkbox" name="dev_log" ${isEnabled ? 'checked' : ''} style="width:20px;height:20px;margin-top:2px;cursor:pointer;">
          <div style="display:flex;flex-direction:column;gap:0.3rem;">
            <strong style="color:#fff;font-size:0.95rem;">Log de depuración en Telegram</strong>
            <small style="color:rgba(255,255,255,0.7);font-size:0.82rem;line-height:1.35;">
              Guarda el log de la app cada 60 segundos en el canal de Telegram <code>Perfiles::TGVideo::tgstorage</code>. <em>Solo se guarda si esta casilla está marcada.</em>
            </small>
          </div>
        </label>
      </fieldset>

      <p class="settings-status" role="status" style="margin-top:0.75rem;font-size:0.85rem;color:#4ade80;display:none;"></p>

      <div class="settings-actions" style="margin-top:1.5rem;display:flex;gap:0.75rem;justify-content:flex-end;">
        <button type="button" class="btn-ghost" data-focusable id="btn-send-log-now">Enviar log ahora</button>
        <button type="submit" class="btn" data-focusable>Guardar</button>
      </div>
    </form>
  `, 'Herramientas de depuración de TGVideo');

  const form = overlay.querySelector('form');
  const statusEl = overlay.querySelector('.settings-status');

  overlay.querySelector('#btn-send-log-now').onclick = async () => {
    if (statusEl) {
      statusEl.style.display = 'block';
      statusEl.style.color = '#93c5fd';
      statusEl.textContent = 'Enviando log a Telegram…';
    }
    try {
      await uploadDevLog({
        getClient: typeof window !== 'undefined' && window.tg?.getClient,
        peerOf: typeof window !== 'undefined' && window.tg?.peerOf,
        profile,
        sync
      });
      if (statusEl) {
        statusEl.style.color = '#4ade80';
        statusEl.textContent = '✓ Log enviado con éxito al canal Perfiles::TGVideo::tgstorage';
      }
    } catch (err) {
      if (statusEl) {
        statusEl.style.color = '#f87171';
        statusEl.textContent = 'Error al enviar log: ' + (err?.message || err);
      }
    }
  };

  form.onsubmit = (e) => {
    e.preventDefault();
    const enabled = form.elements.dev_log.checked;
    setDevLogEnabled(enabled);
    if (enabled) {
      startDevLogging({
        getClient: typeof window !== 'undefined' && window.tg?.getClient,
        peerOf: typeof window !== 'undefined' && window.tg?.peerOf,
        profile,
        sync
      });
    } else {
      stopDevLogging();
    }
    close();
  };
}

// 1. Ajustes de perfil: Nombre y Avatar
function profileSettings(profile, sync, onChanged) {
  let selectedAvatar = profile.avatar || '👤';

  const { overlay, close } = modal('Ajustes de perfil', `
    <form class="profile-settings-form">
      <div class="settings-fields">
        <label>Nombre
          <input name="name" value="${esc(profile.name)}" required maxlength="60" data-focusable autocomplete="off">
        </label>
        <div class="settings-avatar-section">
          <div class="settings-avatar-row">
            <div class="avatar" id="avatar-preview">${profileAvatar({ avatar: selectedAvatar, name: profile.name })}</div>
            <button type="button" class="btn-ghost" data-focusable id="btn-change-avatar">Cambiar avatar</button>
          </div>
          <input type="hidden" name="avatar" value="${esc(selectedAvatar)}">
        </div>
        <button type="button" class="btn-ghost" data-focusable id="btn-news-settings" style="margin-top:0.6rem;">Configurar Novedades</button>
      </div>

      <p class="settings-status" role="status"></p>
      <div class="settings-actions" style="margin-top:1.25rem;">
        <button class="btn" data-focusable type="submit">Guardar perfil</button>
      </div>
    </form>
  `, 'Configura el nombre y el avatar de este perfil');

  const avatarInput = overlay.querySelector('input[name="avatar"]');
  overlay.querySelector('#btn-news-settings').onclick = () => showNewsSettings(profile, sync, onChanged);
  overlay.querySelector('#btn-change-avatar').onclick = async () => {
    const nameNow = overlay.querySelector('input[name="name"]').value.trim() || profile.name;
    const picked = await pickAvatar({ name: nameNow, current: selectedAvatar, title: 'Cambiar avatar', confirmLabel: 'Elegir' });
    if (picked === null) return;
    selectedAvatar = picked;
    if (avatarInput) avatarInput.value = picked;
    overlay.querySelector('#avatar-preview').innerHTML = profileAvatar({ avatar: picked, name: nameNow });
  };

  overlay.querySelector('form').onsubmit = async e => {
    e.preventDefault();
    const form = e.currentTarget;
    const name = form.elements.name.value.trim();
    if (!name) return;
    const avatar = selectedAvatar;

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

// 2. Ajustes de dispositivo: Reproductor, salto y tamaño de interfaz
function deviceSettings(profile, sync, onChanged) {
  const devSettings = getDeviceSettings(profile);
  const isAndroidApp = typeof window !== 'undefined' &&
    (window.Capacitor?.isNativePlatform?.() || window.Capacitor?.platform === 'android');
  const currentPlayer = (!isAndroidApp && devSettings.player === 'exoplayer') ? 'artplayer' : devSettings.player;
  const currentSkip = devSettings.skipSeconds;
  const currentScale = devSettings.uiScale;
  const currentPixelZoomIdx = devSettings.pixelZoomIndex;

  const exoPlayerOption = isAndroidApp ? `
              <label class="settings-radio-label ${currentPlayer === 'exoplayer' ? 'is-checked' : ''}" data-focusable tabindex="0" role="radio" aria-checked="${currentPlayer === 'exoplayer'}">
                <input type="radio" name="player" value="exoplayer" ${currentPlayer === 'exoplayer' ? 'checked' : ''}>
                <div class="settings-radio-info">
                  <strong>ExoPlayer ★ Recomendado</strong>
                  <small>Nativo Android TV (MKV / 4K / HW)</small>
                </div>
              </label>` : '';

  const { overlay, close } = modal('Ajustes de dispositivo', `
    <form class="device-settings-form">
      <fieldset class="settings-section">
            <legend class="settings-legend">Reproductor</legend>
            <div class="settings-radios">
              ${exoPlayerOption}

              <label class="settings-radio-label ${currentPlayer === 'artplayer' ? 'is-checked' : ''}" data-focusable tabindex="0" role="radio" aria-checked="${currentPlayer === 'artplayer'}">
                <input type="radio" name="player" value="artplayer" ${currentPlayer === 'artplayer' ? 'checked' : ''}>
                <div class="settings-radio-info">
                  <strong>ArtPlayer</strong>
                  <small>Reproductor web con OSD cinemático</small>
                </div>
              </label>

              <label class="settings-radio-label ${currentPlayer === 'native' ? 'is-checked' : ''}" data-focusable tabindex="0" role="radio" aria-checked="${currentPlayer === 'native'}">
                <input type="radio" name="player" value="native" ${currentPlayer === 'native' ? 'checked' : ''}>
                <div class="settings-radio-info">
                  <strong>Reproductor nativo</strong>
                  <small>HTML5 estándar (AirPlay / Safari / Web)</small>
                </div>
              </label>
            </div>
          </fieldset>

          <fieldset class="settings-section">
            <legend class="settings-legend">Reproducción e Interfaz</legend>
            <div class="settings-field-row">
              <label class="settings-label-inline">
                <span>Salto por toque / clic:</span>
                <select name="skipSeconds" class="settings-select" data-focusable>
                  <option value="5" ${currentSkip === 5 ? 'selected' : ''}>5 segundos</option>
                  <option value="10" ${currentSkip === 10 ? 'selected' : ''}>10s (por defecto)</option>
                  <option value="15" ${currentSkip === 15 ? 'selected' : ''}>15 segundos</option>
                  <option value="30" ${currentSkip === 30 ? 'selected' : ''}>30 segundos</option>
                </select>
              </label>
            </div>
            <label class="ui-scale-setting device-scale-setting">
              <span class="ui-scale-header"><span>Escala de portadas y letras:</span><strong class="ui-scale-value" id="device-scale-label"></strong></span>
              <input name="uiScale" type="range" class="settings-slider" min="0" max="${UI_SCALE_LEVELS.length - 1}" step="1" value="${currentScale}" data-focusable>
              <span class="ui-scale-ticks">${UI_SCALE_LEVELS.map(level => `<span>${esc(level.label.replace(' (predeterminado)', ''))}</span>`).join('')}</span>
            </label>

            <label class="ui-scale-setting device-pixel-zoom-setting" style="margin-top:0.65rem;">
              <span class="ui-scale-header"><span>Resolución de pantalla (píxeles):</span><strong class="ui-scale-value" id="device-pixel-zoom-label"></strong></span>
              <input name="pixelZoom" type="range" class="settings-slider" min="0" max="${PIXEL_ZOOM_LEVELS.length - 1}" step="1" value="${currentPixelZoomIdx}" data-focusable>
              <span class="ui-scale-ticks">${PIXEL_ZOOM_LEVELS.map(level => `<span>${esc(level.tickLabel || level.label)}</span>`).join('')}</span>
            </label>
          </fieldset>

      <p class="settings-status" role="status"></p>
      <div class="settings-actions">
        <button class="btn" data-focusable type="submit">Guardar en este dispositivo</button>
      </div>
    </form>
  `, 'Estas preferencias se guardan para este equipo sin alterar otros dispositivos');

  const scaleInput = overlay.querySelector('input[name="uiScale"]');
  const scaleLabel = overlay.querySelector('#device-scale-label');
  const updateScalePreview = () => {
    const index = normalizeScaleIndex(scaleInput?.value, currentScale);
    if (scaleLabel) scaleLabel.textContent = UI_SCALE_LEVELS[index].label;
    document.documentElement.style.setProperty('--ui-scale', String(UI_SCALE_LEVELS[index].scale));
    document.documentElement.setAttribute('data-ui-scale', UI_SCALE_LEVELS[index].id);
  };
  scaleInput?.addEventListener('input', updateScalePreview);
  updateScalePreview();

  const zoomInput = overlay.querySelector('input[name="pixelZoom"]');
  const zoomLabel = overlay.querySelector('#device-pixel-zoom-label');
  const updateZoomPreview = () => {
    const idx = Math.max(0, Math.min(PIXEL_ZOOM_LEVELS.length - 1, Number(zoomInput?.value) || 0));
    const level = PIXEL_ZOOM_LEVELS[idx];
    if (zoomLabel) zoomLabel.textContent = level.label;
    applyDevicePixelZoom(level.value);
  };
  zoomInput?.addEventListener('input', updateZoomPreview);
  updateZoomPreview();

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
    const uiScale = normalizeScaleIndex(form.elements.uiScale?.value, currentScale);

    const deviceId = getDeviceId();

    const pixelZoomIdx = Math.max(0, Math.min(PIXEL_ZOOM_LEVELS.length - 1, Number(form.elements.pixelZoom?.value) || 0));
    const pixelZoomVal = PIXEL_ZOOM_LEVELS[pixelZoomIdx].value;

    // Guardado local inmediato para este dispositivo
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('tgvideo_device_player', player);
      localStorage.setItem('tgvideo_device_skip', String(skipSeconds));
      localStorage.setItem('tgvideo_device_scale', String(uiScale));
      localStorage.setItem('tgvideo_device_pixel_zoom', String(pixelZoomVal));
      // Compatibilidad retroactiva con claves por perfil
      localStorage.setItem(`tgvideo_player_${profile.id}`, player);
      localStorage.setItem(`tgvideo_skip_${profile.id}`, String(skipSeconds));
      localStorage.setItem(`tgvideo_scale_${profile.id}`, String(uiScale));
    }

    // Guardado en memoria en el perfil bajo la clave de este dispositivo
    if (!profile.devices) profile.devices = {};
    profile.devices[deviceId] = {
      player,
      skip_seconds: skipSeconds,
      ui_scale: uiScale,
      pixel_zoom: pixelZoomVal,
      updated_at: Date.now()
    };
    profile.player = player;
    profile.skip_seconds = skipSeconds;

    applyDevicePixelZoom(pixelZoomVal);

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
          ui_scale: uiScale,
          updated_at: Date.now()
        };
        const changed = {
          ...remote.profile,
          devices: remoteDevices,
          player,
          skip_seconds: skipSeconds,
          ui_scale: uiScale
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
  const ownFanartKey = !!getGlobalConfig().fanart?.apiKey;
  const fanartStatus = ownFanartKey ? 'Clave de Fanart.tv configurada y activa.' : 'Opcional. Introduce tu clave de Fanart.tv para logos, carteles y fondos alternativos.';
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
        <legend class="settings-legend">Imágenes de Fanart.tv</legend>
        <p class="settings-hint">${fanartStatus}</p>
        <label>Clave de Fanart.tv
          <input name="fanartApiKey" type="password" autocomplete="off" data-focusable placeholder="${ownFanartKey ? 'Nueva clave (dejar vacío para conservar)' : 'API Key de Fanart.tv'}">
        </label>
        ${ownFanartKey ? `<button class="btn-ghost btn-sm" data-focusable type="button" id="reset-fanart">Eliminar clave de Fanart.tv</button>` : ''}
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

  async function save({ apiKey, fanartApiKey, cacheMaxMb }) {
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
      if (fanartApiKey) {
        try {
          await validateFanartKey(fanartApiKey);
        } catch (err) {
          throw new Error('No se pudo validar la clave de Fanart.tv: ' + (err?.message || err));
        }
      }
      await saveGlobalConfig(sync, { apiKey, fanartApiKey, cacheMaxMb });
      close(); onChanged();
    } catch (error) { message.textContent = error.message; }
    finally { buttons.forEach(b => b.disabled = false); }
  }

  overlay.querySelector('form').onsubmit = e => {
    e.preventDefault();
    const key = e.currentTarget.elements.apiKey.value.trim();
    const fanartKey = e.currentTarget.elements.fanartApiKey.value.trim();
    const cacheMaxMb = Number(e.currentTarget.elements.cacheMaxMb.value) || 100;
    save({
      apiKey: key || (ownKey ? undefined : ''),
      fanartApiKey: fanartKey || (ownFanartKey ? undefined : ''),
      cacheMaxMb
    });
  };
  overlay.querySelector('#reset-tmdb')?.addEventListener('click', () => {
    const cacheMaxMb = Number(overlay.querySelector('[name="cacheMaxMb"]').value) || 100;
    save({ apiKey: '', cacheMaxMb });
  });
  overlay.querySelector('#reset-fanart')?.addEventListener('click', () => {
    const cacheMaxMb = Number(overlay.querySelector('[name="cacheMaxMb"]').value) || 100;
    save({ fanartApiKey: '', cacheMaxMb });
  });
}