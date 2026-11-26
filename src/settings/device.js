// src/settings/device.js
// Configuración por dispositivo (almacenada localmente en localStorage, específica de este equipo)

export const DEFAULT_POSTER_SIZE = 480;
export const DEFAULT_POSTER_QUALITY = 0.72;

/**
 * Obtiene el tamaño máximo (lado mayor en píxeles) configurado para las portadas en caché de este dispositivo.
 * Por defecto actual: 480 px.
 */
export function getDevicePosterSize() {
  if (typeof localStorage === 'undefined') return DEFAULT_POSTER_SIZE;
  const raw = localStorage.getItem('tgvideo_device_poster_size');
  if (!raw) return DEFAULT_POSTER_SIZE;
  const val = Number(raw);
  return (val && !isNaN(val) && val >= 120 && val <= 2400) ? val : DEFAULT_POSTER_SIZE;
}

/**
 * Obtiene la calidad de compresión (0.1 a 1.0) configurada para las portadas en caché de este dispositivo.
 * Por defecto actual: 0.72 (72%).
 */
export function getDevicePosterQuality() {
  if (typeof localStorage === 'undefined') return DEFAULT_POSTER_QUALITY;
  const raw = localStorage.getItem('tgvideo_device_poster_quality');
  if (!raw) return DEFAULT_POSTER_QUALITY;
  const val = Number(raw);
  return (val && !isNaN(val) && val >= 0.1 && val <= 1.0) ? val : DEFAULT_POSTER_QUALITY;
}

/**
 * Guarda el tamaño y la calidad de las portadas exclusivamente en este dispositivo (localStorage).
 * No se comparte con otros dispositivos ni se asocia a perfiles de usuario.
 */
export function setDevicePosterSettings(size, quality) {
  if (typeof localStorage === 'undefined') return;
  const numSize = Number(size);
  if (numSize && !isNaN(numSize) && numSize >= 120 && numSize <= 2400) {
    localStorage.setItem('tgvideo_device_poster_size', String(numSize));
  }
  const numQuality = Number(quality);
  if (numQuality && !isNaN(numQuality) && numQuality >= 0.1 && numQuality <= 1.0) {
    localStorage.setItem('tgvideo_device_poster_quality', String(numQuality));
  }
}
