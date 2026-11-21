// src/sync/imagePrefsSync.js
// Sincronización DEDICADA de carteles / fondos / logos elegidos por perfil.
//
// Antes viajaban dentro del archivo del perfil (perfil_*.json), que se vuelve a subir cada pocos
// segundos al ver contenido. Un dispositivo con datos antiguos podía empujar fuera de las últimas
// versiones el cambio de otro. Ahora tienen su propio archivo imgprefs_<perfil>_<fecha>.json que solo
// se sube cuando cambia una elección, y siempre se fusiona (por tipo de imagen) con lo ya existente
// en Telegram antes de subir, de modo que nunca se pierde un cambio de otro dispositivo.
import { Api } from 'telegram';
import { mergeImagePrefMaps, hasNewerThan } from '../metadata/imagePrefs.js';

const MAX_VERSIONS = 5;
const MERGE_BACK = 3; // versiones recientes que se fusionan al leer

export function createImagePrefsSync({ getClient, peerOf, listSyncFiles, findOrCreateSyncChannel, nowTimestamp, normalizeName }) {
  const sameProfile = (f, profileId) => {
    const norm = normalizeName(profileId);
    return f.kind === 'imgprefs' && (f.profileId === profileId || f.profileId === norm || normalizeName(f.profileId) === norm);
  };

  async function readFile(client, peer, messageId) {
    const [msg] = await client.getMessages(peer, { ids: [messageId] });
    if (!msg?.media) return null;
    const buffer = await client.downloadMedia(msg.media, {});
    const data = JSON.parse(new TextDecoder().decode(buffer));
    return data && typeof data.image_prefs === 'object' ? data.image_prefs : null;
  }

  /** Lee y fusiona las últimas versiones de imágenes del perfil. Devuelve {} si no hay ninguna. */
  async function pullImagePrefs(profileId) {
    const files = (await listSyncFiles()).filter((f) => sameProfile(f, profileId));
    if (!files.length) return null;
    const client = await getClient();
    const peer = peerOf(await findOrCreateSyncChannel());
    let merged = {};
    for (const f of files.slice(0, MERGE_BACK)) {
      try {
        const prefs = await readFile(client, peer, f.messageId);
        if (prefs) merged = mergeImagePrefMaps(merged, prefs);
      } catch (e) { console.warn('[imgprefs] no se pudo leer', f.filename, e); }
    }
    return merged;
  }

  let queue = Promise.resolve();
  /** Fusiona `prefs` con lo remoto y sube una nueva versión solo si hay algo nuevo que guardar. */
  function pushImagePrefs(profileId, prefs) {
    const snapshot = structuredClone(prefs || {});
    const task = queue.catch(() => {}).then(async () => {
      const remote = (await pullImagePrefs(profileId).catch(() => null)) || {};
      const merged = mergeImagePrefMaps(remote, snapshot);
      if (Object.keys(remote).length && !hasNewerThan(merged, remote)) return merged; // nada nuevo

      const client = await getClient();
      const peer = peerOf(await findOrCreateSyncChannel());
      const profileKey = normalizeName(profileId);
      const filename = `imgprefs_${profileKey}_${nowTimestamp()}.json`;
      const body = JSON.stringify({ v: 1, profile_id: profileId, updated_at: Date.now(), image_prefs: merged });
      const uploaded = await client.uploadFile({ file: new File([body], filename, { type: 'application/json' }), workers: 1 });
      const sent = await client.sendFile(peer, {
        file: uploaded,
        caption: `Imágenes ${profileKey}`,
        forceDocument: true,
        attributes: [new Api.DocumentAttributeFilename({ fileName: filename })],
      });

      const older = (await listSyncFiles()).filter((f) => sameProfile(f, profileId) && f.messageId !== sent?.id);
      if (older.length >= MAX_VERSIONS) {
        for (const f of older.slice(MAX_VERSIONS - 1)) {
          try { await client.deleteMessages(peer, [f.messageId], { revoke: true }); }
          catch (e) { console.warn('[imgprefs] no se pudo borrar versión antigua', e); }
        }
      }
      return merged;
    });
    queue = task;
    return task;
  }

  return { pullImagePrefs, pushImagePrefs };
}
