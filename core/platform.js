// src/core/platform.js
// Detección de plataforma: versión web (navegador / PWA) frente a la APK de Android (Capacitor).
// Cualquier diferencia entre web y APK debe preguntar aquí, no repetir la comprobación en cada módulo.
import { Capacitor } from '@capacitor/core';

export function isAndroidApp() {
  if (typeof window === 'undefined') return false;
  const cap = window.Capacitor || Capacitor;
  return !!(cap?.isNativePlatform?.() || cap?.getPlatform?.() === 'android' || cap?.platform === 'android');
}

export function isWebApp() {
  return !isAndroidApp();
}

/**
 * Detecta si el dispositivo es un televisor inteligente (Android TV, Fire TV, Google TV, etc.)
 * Evita falsos positivos en iPhones, móviles Android o pantallas táctiles.
 */
export function isAndroidTV() {
  if (typeof window === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const isTvUA = /Android.*TV|SMART-TV|AFT|GoogleTV|Chromecast|BRAVIA|MIBOX|SHIELD|Nexus Player|Leanback/i.test(ua);
  const cap = window.Capacitor || Capacitor;
  const isAndroid = !!(cap?.isNativePlatform?.() || cap?.getPlatform?.() === 'android' || cap?.platform === 'android' || /Android/i.test(ua));

  // En la APK de Android: si está en orientación apaisada y es operado sin pantalla táctil (mando a distancia)
  const isTvLandscapeApp = isAndroid && (window.innerWidth > window.innerHeight) && (navigator.maxTouchPoints === 0 || isTvUA);

  return isTvUA || isTvLandscapeApp;
}

/**
 * Aplica el zoom de resolución de pantalla (densidad de píxeles) según la preferencia
 * guardada en este dispositivo o mediante cálculo automático para televisores.
 * @param {number|string|null|undefined} customZoom - Valor numérico, 'auto' o undefined para leer de localStorage.
 */
export function applyDevicePixelZoom(customZoom) {
  if (typeof document === 'undefined') return;

  let zoomVal = customZoom;
  if (zoomVal === undefined && typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem('tgvideo_device_pixel_zoom');
      if (raw && raw !== 'auto') {
        const n = parseFloat(raw);
        if (!isNaN(n) && n >= 0.4 && n <= 1.6) zoomVal = n;
      }
    } catch (_) {}
  }

  if (zoomVal !== undefined && zoomVal !== null && zoomVal !== 'auto') {
    const num = typeof zoomVal === 'number' ? zoomVal : parseFloat(zoomVal);
    if (!isNaN(num) && num > 0) {
      document.documentElement.style.zoom = num.toFixed(3);
      return;
    }
  }

  // Automático: si es televisor, escala proporcional para equivaler a ~1440px
  if (isAndroidTV()) {
    // Tomar en cuenta el zoom ya aplicado para que el ancho base sea estable y no oscile al cambiar de pestaña
    const currentZoom = parseFloat(document.documentElement.style.zoom) || 1.0;
    const baseWidth = (window.innerWidth && currentZoom > 0)
      ? Math.round(window.innerWidth * currentZoom)
      : (window.screen?.width || 1280);

    if (baseWidth > 0 && baseWidth < 1500) {
      const targetWidth = 1440;
      const factor = Math.min(1.0, Math.max(0.60, baseWidth / targetWidth));
      document.documentElement.style.zoom = factor.toFixed(3);
    } else {
      document.documentElement.style.zoom = '';
    }
  } else {
    document.documentElement.style.zoom = '';
  }
}

/**
 * Inicializa la configuración de entorno para Android TV y Fire TV.
 * Añade la clase 'is-tv' al documento para estilos dedicados y ajusta
 * la escala de píxeles (zoom) para que los elementos sean más pequeños
 * y equivalgan a la resolución de escritorio (1440px - 1600px).
 */
export function setupTvPlatform() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  if (isAndroidTV()) {
    document.documentElement.classList.add('is-tv');
  }

  // Asegurar siempre viewport nativo estándar
  const vp = document.querySelector('meta[name=viewport]');
  if (vp && vp.content.includes('width=1920')) {
    vp.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover');
  }

  // Restaurar el tamaño de fuente si fue modificado inline
  if (document.documentElement.style.fontSize) {
    document.documentElement.style.fontSize = '';
  }

  applyDevicePixelZoom();
  window.addEventListener('resize', () => applyDevicePixelZoom());
}
