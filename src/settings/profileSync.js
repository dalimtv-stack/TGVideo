// src/settings/profileSync.js
// Sincronización segura de cambios del perfil con el JSON remoto en Telegram.
//
// Problema que resuelve: cada modal de ajustes hacía su propio «descargar perfil remoto → modificar →
// subir → copiar el remoto encima del perfil local». Si se guardaban dos modales seguidos (p. ej. Skin y
// luego Ajustes de dispositivo), el segundo descargaba el JSON anterior (sin los cambios del primero,
// que aún se estaba subiendo) y al terminar lo copiaba encima del perfil local: la configuración de
// Skin se perdía.
//
// Aquí todas las actualizaciones pasan por una única cola secuencial y los valores de ESTE dispositivo
// que ya están en memoria siempre ganan a los del JSON remoto.
import { loadProgress } from '../player/progress.js';

let queue = Promise.resolve();

/**
 * Aplica un cambio sobre el perfil remoto de forma secuencial.
 * @param {object} profile Perfil local en memoria.
 * @param {object} sync Cliente de sincronización (pullProfile / pushProfile / mergeProgress).
 * @param {(remoteProfile: object) => object} mutate Devuelve el perfil remoto ya modificado.
 * @param {string} [label] Texto para los avisos de consola.
 */
export function patchRemoteProfile(profile, sync, mutate, label = 'perfil') {
  if (!profile?.id || !sync?.pullProfile || !sync?.pushProfile) return Promise.resolve(null);
  const run = async () => {
    const remote = await sync.pullProfile(profile.id);
    if (!remote) return null;
    const base = remote.profile && typeof remote.profile === 'object' ? remote.profile : {};
    const changed = mutate({ ...base });
    const progress = typeof sync.mergeProgress === 'function'
      ? sync.mergeProgress(loadProgress(profile.id), remote.progress || {})
      : (remote.progress || {});
    await sync.pushProfile({ ...remote, profile: changed, progress });
    return changed;
  };
  const task = queue.catch(() => {}).then(run).catch((err) => {
    console.warn(`[profileSync] Error al sincronizar ${label}:`, err);
    return null;
  });
  queue = task;
  return task;
}

/**
 * Guarda valores propios de este dispositivo (profile.devices[deviceId]) en memoria y en Telegram.
 * Los valores locales del dispositivo prevalecen sobre los remotos; los de otros dispositivos se conservan.
 * @param {object} profile
 * @param {object} sync
 * @param {string} deviceId
 * @param {object} patch Campos a guardar (ui_scale, player, skip_seconds…).
 * @param {object} [profileFields] Campos de nivel de perfil que se guardan a la vez (p. ej. player).
 */
export function saveDeviceEntry(profile, sync, deviceId, patch = {}, profileFields = {}, label = 'ajustes de dispositivo') {
  if (!profile) return Promise.resolve(null);
  if (!profile.devices || typeof profile.devices !== 'object') profile.devices = {};
  profile.devices[deviceId] = { ...(profile.devices[deviceId] || {}), ...patch, updated_at: Date.now() };
  Object.assign(profile, profileFields);

  return patchRemoteProfile(profile, sync, (remoteProfile) => {
    const devices = { ...(remoteProfile.devices || {}) };
    // El estado en memoria de este dispositivo es el más reciente: incluye también lo guardado
    // en otros modales aunque su subida todavía no se haya reflejado en el JSON remoto.
    devices[deviceId] = { ...(devices[deviceId] || {}), ...(profile.devices?.[deviceId] || {}) };
    return { ...remoteProfile, ...profileFields, devices };
  }, label).then((changed) => {
    if (changed?.devices) {
      // Incorporar solo los otros dispositivos; nunca pisar el estado local de este equipo.
      const mine = profile.devices?.[deviceId];
      profile.devices = { ...changed.devices, ...(mine ? { [deviceId]: mine } : {}) };
    }
    return changed;
  });
}
