// src/core/platform.js
// Detección de plataforma: versión web (navegador / PWA) frente a la APK de Android (Capacitor).
// Cualquier diferencia entre web y APK debe preguntar aquí, no repetir la comprobación en cada módulo.

export function isAndroidApp() {
  if (typeof window === 'undefined') return false;
  const cap = window.Capacitor;
  return !!(cap?.isNativePlatform?.() || cap?.platform === 'android');
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
  const isAndroid = !!(window.Capacitor?.isNativePlatform?.() || window.Capacitor?.platform === 'android' || /Android/i.test(ua));

  // En la APK de Android: si está en orientación apaisada y es operado sin pantalla táctil (mando a distancia)
  const isTvLandscapeApp = isAndroid && (window.innerWidth > window.innerHeight) && (navigator.maxTouchPoints === 0 || isTvUA);

  return isTvUA || isTvLandscapeApp;
}

/**
 * Configura la escala y el viewport de televisión para igualar exactamente la visualización de PC a 1080p.
 */
export function setupTvPlatform() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (!isAndroidTV()) return;

  document.documentElement.classList.add('is-tv');

  // Si el viewport no se ha establecido en 1920, forzarlo
  const vp = document.querySelector('meta[name="viewport"]');
  if (vp && !vp.content.includes('width=1920')) {
    vp.setAttribute('content', 'width=1920, initial-scale=1.0, maximum-scale=1.0, user-scalable=no');
  }

  // Si por limitaciones del motor WebView el ancho lógico efectivo sigue siendo menor a 1600px,
  // ajustar el tamaño de fuente raíz dinámicamente para mantener proporciones idénticas a PC 1080p.
  const width = window.innerWidth;
  if (width > 0 && width < 1600) {
    const factor = Math.max(0.65, Math.min(1.0, width / 1920));
    document.documentElement.style.fontSize = `${(16 * factor).toFixed(2)}px`;
  }
}
