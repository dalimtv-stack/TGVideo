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
  const isAndroid = isAndroidApp() || /Android/i.test(ua);

  // En la APK de Android: si está en orientación apaisada y es operado sin pantalla táctil (mando a distancia)
  const isTvLandscapeApp = isAndroid && (window.innerWidth > window.innerHeight) && (navigator.maxTouchPoints === 0 || isTvUA);

  return isTvUA || isTvLandscapeApp;
}

/**
 * Inicializa la configuración de entorno para Android TV y Fire TV.
 * Añade la clase 'is-tv' al documento para estilos dedicados y ajusta
 * la escala de píxeles (zoom) para que los elementos sean más pequeños
 * y equivalgan a la resolución de escritorio (1440px - 1600px), garantizando
 * que quepa toda la información y se vea idéntico a la versión web de PC.
 */
export function setupTvPlatform() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (!isAndroidTV()) return;

  document.documentElement.classList.add('is-tv');

  // Asegurar siempre viewport nativo estándar
  const vp = document.querySelector('meta[name="viewport"]');
  if (vp && vp.content.includes('width=1920')) {
    vp.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover');
  }

  // Restaurar el tamaño de fuente si fue modificado inline
  if (document.documentElement.style.fontSize) {
    document.documentElement.style.fontSize = '';
  }

  const updateTvScale = () => {
    if (!isAndroidTV()) return;
    const width = window.innerWidth;
    // En Android TV y Fire TV (1080p a 320dpi), el WebView tiene un ancho lógico de ~960px.
    // Reducimos la escala de píxeles para que equivalga a una pantalla de 1440px de ancho,
    // haciendo que los elementos se vean proporcionados y quepa todo como en la versión web/PC.
    if (width > 0 && width < 1500) {
      const targetWidth = 1440;
      const factor = Math.min(1.0, Math.max(0.60, width / targetWidth));
      document.documentElement.style.zoom = factor.toFixed(3);
    } else {
      document.documentElement.style.zoom = '';
    }
  };

  updateTvScale();
  window.addEventListener('resize', updateTvScale);
}
