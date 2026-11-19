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
