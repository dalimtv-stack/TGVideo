// src/player/wakeLock.js
// Mantiene la pantalla encendida mientras se reproduce (evita el salvapantallas en Android TV).
// APK: flag FLAG_KEEP_SCREEN_ON vía ExoPlayerPlugin.keepScreenOn. Web: Screen Wake Lock API.
import { isAndroidApp } from '../core/platform.js';

let webLock = null;
let current = false;

export async function keepScreenOn(enabled) {
  enabled = !!enabled;
  if (enabled === current && (!enabled || webLock || isAndroidApp())) return;
  current = enabled;
  try {
    if (isAndroidApp()) {
      await window.Capacitor?.Plugins?.ExoPlayerPlugin?.keepScreenOn?.({ enabled });
    } else if (enabled) {
      webLock = await navigator.wakeLock?.request?.('screen') || null;
    } else if (webLock) {
      await webLock.release();
      webLock = null;
    }
  } catch (_) { webLock = null; }
}

// Liga el bloqueo a un <video>: activo mientras reproduce; se libera al pausar, terminar o desmontarse.
export function bindWakeLock(video) {
  if (!video) return () => {};
  const on = () => keepScreenOn(true);
  const off = () => keepScreenOn(false);
  video.addEventListener('playing', on);
  video.addEventListener('play', on);
  video.addEventListener('pause', off);
  video.addEventListener('ended', off);
  const onVis = () => { if (document.visibilityState === 'visible' && !video.paused) { current = false; on(); } };
  document.addEventListener('visibilitychange', onVis);
  const watch = setInterval(() => { if (!video.isConnected) stop(); }, 3000);
  function stop() {
    clearInterval(watch);
    video.removeEventListener('playing', on);
    video.removeEventListener('play', on);
    video.removeEventListener('pause', off);
    video.removeEventListener('ended', off);
    document.removeEventListener('visibilitychange', onVis);
    off();
  }
  if (!video.paused) on();
  return stop;
}
