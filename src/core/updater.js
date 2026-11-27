// src/core/updater.js
// Gestor de actualización de TGVideo dentro de la aplicación.
// En Android TV / APK descarga el paquete mostrando progreso porcentual
// y lanza el instalador nativo del sistema. En Web ofrece la descarga directa.

import { Capacitor, registerPlugin } from '@capacitor/core';
import { attachSpatialNav } from '../ui/spatialNav.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

function getUpdaterPlugin() {
  if (typeof window !== 'undefined' && window.Capacitor?.Plugins?.AppUpdaterPlugin) {
    return window.Capacitor.Plugins.AppUpdaterPlugin;
  }
  if (typeof Capacitor !== 'undefined' && Capacitor?.Plugins?.AppUpdaterPlugin) {
    return Capacitor.Plugins.AppUpdaterPlugin;
  }
  try {
    return registerPlugin('AppUpdaterPlugin');
  } catch (_) {
    return null;
  }
}

/**
 * Muestra el diálogo modal de descarga y actualización con barra de progreso.
 * @param {object} updateInfo Datos de la release obtenidos por checkForUpdate()
 */
let updateInProgress = false;

export async function startAppUpdate(updateInfo) {
  if (!updateInfo) return;
  // Evita abrir dos descargas a la vez (doble pulsación del mando)
  if (updateInProgress || document.querySelector('.update-download-overlay')) return;

  const isAndroid = typeof window !== 'undefined' &&
    (Capacitor?.isNativePlatform?.() || Capacitor?.getPlatform?.() === 'android');

  const targetUrl = updateInfo.downloadUrl || updateInfo.releaseUrl;
  const version = updateInfo.latestVersion || 'Nueva versión';

  // Si estamos en un navegador web sin capacidad de instalación local, abrir enlace
  if (!isAndroid) {
    window.open(targetUrl, '_blank');
    return;
  }

  // Comprobar si el plugin nativo de actualización está disponible
  const updaterPlugin = getUpdaterPlugin();
  updateInProgress = true;

  const overlay = document.createElement('div');
  overlay.className = 'settings-overlay update-download-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', `Actualizando a ${version}`);

  overlay.innerHTML = `
    <div class="settings-dialog update-download-dialog" style="max-width: 480px; width: 90%; text-align: center; padding: 2rem 1.8rem;">
      <div style="font-size: 2.4rem; line-height: 1; margin-bottom: 0.8rem;">⚡</div>
      <h2 style="margin: 0 0 0.4rem; font-size: 1.35rem; color: #fff;">Actualizando TGVideo</h2>
      <p style="margin: 0 0 1.4rem; color: #aaa; font-size: 0.95rem;">Descargando versión ${esc(version)}</p>

      <div class="update-progress-container" style="background: rgba(255,255,255,0.08); border-radius: 9999px; height: 16px; overflow: hidden; margin-bottom: 0.8rem; border: 1px solid rgba(255,255,255,0.15); position: relative;">
        <div id="update-progress-bar" style="height: 100%; width: 0%; background: linear-gradient(90deg, #0284c7, #38bdf8); border-radius: 9999px; transition: width 0.2s ease;"></div>
      </div>

      <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.88rem; color: #bbb; margin-bottom: 1.5rem;">
        <span id="update-status-label">Iniciando descarga…</span>
        <span id="update-bytes-label" style="font-variant-numeric: tabular-nums;">0%</span>
      </div>

      <div style="display: flex; justify-content: center; gap: 0.8rem;">
        <button type="button" class="btn btn-ghost" id="update-cancel-btn" data-focusable style="padding: 0.6rem 1.6rem;">Cancelar</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  attachSpatialNav(overlay);

  const barEl = overlay.querySelector('#update-progress-bar');
  const statusEl = overlay.querySelector('#update-status-label');
  const bytesEl = overlay.querySelector('#update-bytes-label');
  const cancelBtn = overlay.querySelector('#update-cancel-btn');
  const actionsEl = cancelBtn.parentElement;

  let cancelled = false;
  const listeners = [];

  const close = () => {
    cancelled = true;
    updateInProgress = false;
    listeners.forEach((l) => { try { l?.remove?.(); } catch (_) {} });
    listeners.length = 0;
    overlay.remove();
  };

  const showRetryInstall = () => {
    if (overlay.querySelector('#update-retry-btn')) return;
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.id = 'update-retry-btn';
    retry.className = 'btn';
    retry.setAttribute('data-focusable', '');
    retry.style.padding = '0.6rem 1.6rem';
    retry.textContent = 'Instalar ahora';
    retry.onclick = async () => {
      try {
        await updaterPlugin.retryInstall();
        if (statusEl) statusEl.textContent = 'Abriendo instalador de Android…';
      } catch (err) {
        if (statusEl) statusEl.textContent = `Error: ${err?.message || err}`;
      }
    };
    actionsEl.prepend(retry);
    retry.focus();
  };

  cancelBtn.onclick = () => close();
  cancelBtn.focus();

  if (updaterPlugin && typeof updaterPlugin.downloadAndInstall === 'function') {
    try {
      if (typeof updaterPlugin.addListener === 'function') {
        listeners.push(await updaterPlugin.addListener('onUpdateProgress', (data) => {
          if (cancelled) return;
          const percent = Math.min(100, Math.max(0, Number(data?.percent) || 0));
          const downloaded = Number(data?.bytesDownloaded) || 0;
          const total = Number(data?.totalBytes) || 0;
          if (barEl) barEl.style.width = `${percent}%`;
          if (bytesEl) {
            bytesEl.textContent = total > 0
              ? `${percent}% (${formatBytes(downloaded)} / ${formatBytes(total)})`
              : `${percent}%`;
          }
          if (statusEl) {
            statusEl.textContent = percent >= 100 ? 'Descarga verificada. Preparando instalación…' : 'Descargando actualización…';
          }
        }));

        // Estado de la instalación: permiso pendiente, permiso denegado o instalador abierto
        listeners.push(await updaterPlugin.addListener('onUpdateState', (data) => {
          if (cancelled) return;
          const state = data?.state;
          if (state === 'permission') {
            if (statusEl) statusEl.textContent = 'Activa «Instalar apps desconocidas» para TGVideo y vuelve: la instalación seguirá sola.';
            if (bytesEl) bytesEl.textContent = '';
          } else if (state === 'permission-denied') {
            if (statusEl) statusEl.textContent = 'Falta el permiso «Instalar apps desconocidas». La descarga está guardada.';
            if (bytesEl) bytesEl.textContent = '';
            showRetryInstall();
          } else if (state === 'installer') {
            if (statusEl) statusEl.textContent = 'Instalador de Android abierto. Pulsa «Actualizar» para terminar.';
            if (bytesEl) bytesEl.textContent = '';
            showRetryInstall();
            const retry = overlay.querySelector('#update-retry-btn');
            if (retry) retry.textContent = 'Abrir instalador otra vez';
          }
        }));

        listeners.push(await updaterPlugin.addListener('onUpdateError', (data) => {
          if (cancelled) return;
          updateInProgress = false;
          if (statusEl) statusEl.textContent = `Error: ${data?.error || 'Fallo en la descarga'}`;
          if (bytesEl) bytesEl.textContent = 'Reintentar más tarde';
        }));
      }

      await updaterPlugin.downloadAndInstall({ url: targetUrl, version });
    } catch (err) {
      console.warn('[updater] Error en descarga nativa, usando navegador alternativo:', err);
      if (!cancelled) {
        if (statusEl) statusEl.textContent = 'Abriendo instalador del sistema…';
        window.open(targetUrl, '_system');
        setTimeout(close, 1500);
      }
    }
  } else {
    // Si no está registrado el plugin nativo aún, abrir con el sistema
    if (statusEl) statusEl.textContent = 'Descargando con el gestor de Android…';
    window.open(targetUrl, '_system');
    setTimeout(close, 2000);
  }
}
