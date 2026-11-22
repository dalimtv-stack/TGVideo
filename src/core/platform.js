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