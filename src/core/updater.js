// src/core/updater.js
// Gestor de actualización de TGVideo dentro de la aplicación.
// En Android TV / APK descarga el paquete mostrando progreso porcentual
// y lanza el instalador nativo del sistema. En Web ofrece la descarga directa.

import { Capacitor } from '@capacitor/core';
import { attachSpatialNav } from '../ui/spatialNav.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

/**
 * Muestra el diálogo modal de descarga y actualización con barra de progreso.
 * @param {object} updateInfo Datos de la release obtenidos por checkForUpdate()
 */
export async function startAppUpdate(updateInfo) {
  if (!updateInfo) return;

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
  const updaterPlugin = window.Capacitor?.Plugins?.AppUpdaterPlugin;

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

  let cancelled = false;
  let progressListener = null;

  const close = () => {
    cancelled = true;
    if (progressListener && typeof progressListener.remove === 'function') {
      try { progressListener.remove(); } catch (_) {}
    }
    overlay.remove();
  };

  cancelBtn.onclick = () => close();
  cancelBtn.focus();

  if (updaterPlugin && typeof updaterPlugin.downloadAndInstall === 'function') {
    try {
      progressListener = await updaterPlugin.addListener('onUpdateProgress', (data) => {
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

        if (percent >= 100) {
          if (statusEl) statusEl.textContent = 'Descarga lista. Abriendo instalador…';
          setTimeout(close, 2000);
        } else {
          if (statusEl) statusEl.textContent = 'Descargando actualización…';
        }
      });

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
