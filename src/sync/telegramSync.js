// src/sync/telegramSync.js
// Sincronización bidireccional vía canal de Telegram (Perfiles::TGVideo::tgstorage)
import { Api } from 'telegram';
import { loadFavorites, mergeFavorites, loadProgress } from '../player/progress.js';
import { readImagePrefs, mergeImagePrefMaps } from '../metadata/imagePrefs.js';
import { createImagePrefsSync } from './imagePrefsSync.js';

const SYNC_CHANNEL_TITLE = 'Perfiles::TGVideo::tgstorage';
const MAX_VERSIONS = 5; // 1 versión activa + 4 backups (5 en total)

function nowTimestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

function normalizeName(name) {
  return (name || 'perfil')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_-]/g, '_')
    .slice(0, 32);
}

/**
 * Parsea nombres de archivo de sincronización soportando timestamps de 14 dígitos
 * tanto continuos (YYYYMMDDHHMMSS) como con guion bajo (YYYYMMDD_HHMMSS) e IDs con guiones.
 */
function parseSyncFilename(filename) {
  if (!filename || typeof filename !== 'string' || !filename.endsWith('.json')) return null;
  const name = filename.slice(0, -5);

  if (name.startsWith('config_global_')) {
    const rawTs = name.slice('config_global_'.length);
    const timestamp = rawTs.replace(/\D/g, '');
    return { kind: 'global', timestamp, rawTs, filename };
  }

  if (name.startsWith('metadata_overrides_')) {
    const rawTs = name.slice('metadata_overrides_'.length);
    const timestamp = rawTs.replace(/\D/g, '');
    return { kind: 'overrides', timestamp, rawTs, filename };
  }

  if (name.startsWith('perfil_') || name.startsWith('imgprefs_')) {
    const kind = name.startsWith('imgprefs_') ? 'imgprefs' : 'profile';
    const rest = name.slice(name.startsWith('imgprefs_') ? 'imgprefs_'.length : 'perfil_'.length);
    // Timestamp al final: _YYYYMMDD_HHMMSS o _YYYYMMDDHHMMSS
    const match = rest.match(/^(.*?)_(\d{8}_\d{6}|\d{14})$/);
    if (match) {
      const profileId = match[1];
      const rawTs = match[2];
      const timestamp = rawTs.replace(/\D/g, '');
      return { kind, profileId, timestamp, rawTs, filename };
    }
    const lastUnderscore = rest.lastIndexOf('_');
    if (lastUnderscore > 0) {
      const profileId = rest.slice(0, lastUnderscore);
      const rawTs = rest.slice(lastUnderscore + 1);
      const timestamp = rawTs.replace(/\D/g, '');
      return { kind, profileId, timestamp, rawTs, filename };
    }
    return { kind, profileId: rest, timestamp: '', rawTs: '', filename };
  }

  return null;
}

export function createTelegramSync({ getClient, peerOf }) {
  let cachedChannel = null;
  let pushTimer = null;

  async function findOrCreateSyncChannel() {
    if (cachedChannel) return cachedChannel;
    const client = await getClient();

    // 1. Buscar en diálogos activos
    for await (const dialog of client.iterDialogs({})) {
      const entity = dialog.entity;
      if (
        entity?.className === 'Channel' &&
        entity.title === SYNC_CHANNEL_TITLE
      ) {
        cachedChannel = {
          id: String(entity.id),
          hash: String(entity.accessHash),
          title: entity.title,
        };
        return cachedChannel;
      }
    }

    // 2. Buscar en archivados si no se encontró en activos
    try {
      for await (const dialog of client.iterDialogs({ folder: 1 })) {
        const entity = dialog.entity;
        if (
          entity?.className === 'Channel' &&
          entity.title === SYNC_CHANNEL_TITLE
        ) {
          cachedChannel = {
            id: String(entity.id),
            hash: String(entity.accessHash),
            title: entity.title,
          };
          return cachedChannel;
        }
      }
    } catch (_) {}

    // 3. Crear el canal si no existe
    const created = await client.invoke(
      new Api.channels.CreateChannel({
        title: SYNC_CHANNEL_TITLE,
        about: 'Almacenamiento de perfiles y progreso de TGVideo (no borrar)',
        broadcast: true,
        megagroup: false,
      })
    );

    const chat = created.chats?.[0];
    if (!chat) throw new Error('No se pudo crear el canal de sincronización');

    cachedChannel = {
      id: String(chat.id),
      hash: String(chat.accessHash),
      title: chat.title,
    };
    return cachedChannel;
  }

  async function listSyncFiles() {
    const client = await getClient();
    const ch = await findOrCreateSyncChannel();
    const peer = peerOf(ch);
    const files = [];

    for await (const msg of client.iterMessages(peer, { limit: 200 })) {
      const doc = msg.media?.document;
      if (!doc) continue;

      const attr = doc.attributes?.find(
        (a) => a.className === 'DocumentAttributeFilename'
      );
      const filename = attr?.fileName;
      if (!filename) continue;

      const parsed = parseSyncFilename(filename);
      if (!parsed) continue;

      files.push({
        ...parsed,
        messageId: msg.id,
        date: msg.date || 0,
      });
    }

    // Ordenar de más reciente a más antiguo:
    // Primero por timestamp normalizado (14 dígitos YYYYMMDDHHMMSS)
    // Desempate por messageId de Telegram (los más recientes tienen mayor ID)
    return files.sort((a, b) => {
      if (b.timestamp !== a.timestamp) {
        return b.timestamp.localeCompare(a.timestamp);
      }
      return (b.messageId || 0) - (a.messageId || 0);
    });
  }

  async function pullGlobalConfig() {
    const latest = (await listSyncFiles()).find((f) => f.kind === 'global');
    if (!latest) return null;
    const client = await getClient();
    const peer = peerOf(await findOrCreateSyncChannel());
    const [msg] = await client.getMessages(peer, { ids: [latest.messageId] });
    if (!msg?.media) return null;
    const buffer = await client.downloadMedia(msg.media, {});
    const data = JSON.parse(new TextDecoder().decode(buffer));
    if (!data || typeof data !== 'object') return null;
    return data;
  }

  let globalQueue = Promise.resolve();
  function pushGlobalConfig(config) {
    const snapshot = structuredClone(config);
    const task = globalQueue.catch(() => {}).then(async () => {
      const client = await getClient();
      const peer = peerOf(await findOrCreateSyncChannel());
      const filename = `config_global_${nowTimestamp()}.json`;
      const file = new File([JSON.stringify(snapshot)], filename, {
        type: 'application/json',
      });
      const uploaded = await client.uploadFile({ file, workers: 1 });
      const sentMsg = await client.sendFile(peer, {
        file: uploaded,
        caption: 'Configuración global TGVideo',
        forceDocument: true,
        attributes: [new Api.DocumentAttributeFilename({ fileName: filename })],
      });

      // Conservar la versión recién subida y hasta 4 backups anteriores (5 en total)
      const oldGlobals = (await listSyncFiles()).filter(
        (f) => f.kind === 'global' && f.messageId !== sentMsg?.id
      );
      if (oldGlobals.length >= MAX_VERSIONS) {
        const toDelete = oldGlobals.slice(MAX_VERSIONS - 1);
        for (const f of toDelete) {
          try {
            await client.deleteMessages(peer, [f.messageId], { revoke: true });
          } catch (error) {
            console.warn('[config] No se pudo borrar versión antigua', error);
          }
        }
      }
    });
    globalQueue = task;
    return task;
  }

  async function pullMetadataOverrides() {
    const latest = (await listSyncFiles()).find((f) => f.kind === 'overrides');
    if (!latest) return null;
    const client = await getClient();
    const peer = peerOf(await findOrCreateSyncChannel());
    const [msg] = await client.getMessages(peer, { ids: [latest.messageId] });
    if (!msg?.media) return null;
    const buffer = await client.downloadMedia(msg.media, {});
    const data = JSON.parse(new TextDecoder().decode(buffer));
    if (!data || typeof data.overrides !== 'object') return null;
    return data;
  }

  let overridesQueue = Promise.resolve();
  function pushMetadataOverrides(data) {
    const snapshot = structuredClone(data);
    const task = overridesQueue.catch(() => {}).then(async () => {
      const client = await getClient();
      const peer = peerOf(await findOrCreateSyncChannel());
      const filename = `metadata_overrides_${nowTimestamp()}.json`;
      const file = new File([JSON.stringify(snapshot)], filename, {
        type: 'application/json',
      });
      const uploaded = await client.uploadFile({ file, workers: 1 });
      const sentMsg = await client.sendFile(peer, {
        file: uploaded,
        caption: 'Identificaciones TMDB TGVideo',
        forceDocument: true,
        attributes: [new Api.DocumentAttributeFilename({ fileName: filename })],
      });

      // Conservar la versión recién subida y hasta 4 backups anteriores (5 en total)
      const oldOverrides = (await listSyncFiles()).filter(
        (f) => f.kind === 'overrides' && f.messageId !== sentMsg?.id
      );
      if (oldOverrides.length >= MAX_VERSIONS) {
        const toDelete = oldOverrides.slice(MAX_VERSIONS - 1);
        for (const f of toDelete) {
          try {
            await client.deleteMessages(peer, [f.messageId], { revoke: true });
          } catch (error) {
            console.warn('[overrides] No se pudo borrar versión antigua', error);
          }
        }
      }
    });
    overridesQueue = task;
    return task;
  }

  async function listProfiles() {
    const files = await listSyncFiles();
    const byId = new Map();

    for (const f of files) {
      if (f.kind !== 'profile') continue;
      const key = normalizeName(f.profileId);
      if (!byId.has(key)) byId.set(key, f);
    }

    const profiles = [];
    const client = await getClient();
    const ch = await findOrCreateSyncChannel();
    const peer = peerOf(ch);

    for (const f of byId.values()) {
      try {
        const [msg] = await client.getMessages(peer, { ids: [f.messageId] });
        if (!msg?.media) continue;
        const buffer = await client.downloadMedia(msg.media, {});
        const text = new TextDecoder().decode(buffer);
        const data = JSON.parse(text);

        const pId = data.profile?.id || f.profileId;
        // Filtrar y omitir perfiles fantasma huérfanos con ID o nombre 'perfil'
        if ((pId === 'perfil' || f.profileId === 'perfil') && (!data.profile || !data.profile.name || data.profile.name === 'perfil')) {
          continue;
        }
        const storedMaxAge = typeof localStorage !== 'undefined' ? localStorage.getItem(`tgvideo_max_age_${pId}`) : null;
        profiles.push({
          id: pId,
          name: data.profile?.name || f.profileId,
          avatar: data.profile?.avatar || null,
          age_limit: data.profile?.age_limit || 'TP',
          maxAgeRating: data.profile?.maxAgeRating || storedMaxAge || 'all',
          pin: data.profile?.pin || null,
          is_kids: !!data.profile?.is_kids,
          player:
            data.profile?.player ||
            (typeof localStorage !== 'undefined'
              ? localStorage.getItem(`tgvideo_player_${data.profile?.id || f.profileId}`)
              : null) ||
            'artplayer',
          skip_seconds:
            data.profile?.skip_seconds ||
            (typeof localStorage !== 'undefined'
              ? Number(localStorage.getItem(`tgvideo_skip_${data.profile?.id || f.profileId}`))
              : null) ||
            10,
          favorites: mergeFavorites(data.profile?.favorites || [], data.favorites || []),
          image_prefs: mergeImagePrefMaps(data.image_prefs || {}, data.profile?.image_prefs || {}),
          devices: data.profile?.devices || {},
          ui_scale: data.profile?.ui_scale,
          lastSync: f.timestamp,
          messageId: f.messageId,
        });
      } catch (err) {
        if (f.profileId === 'perfil') continue;
        console.warn('[sync] No se pudo leer perfil', f.filename, err);
        const storedFallbackMaxAge = typeof localStorage !== 'undefined' ? localStorage.getItem(`tgvideo_max_age_${f.profileId}`) : null;
        profiles.push({
          id: f.profileId,
          name: f.profileId,
          avatar: null,
          age_limit: 'TP',
          maxAgeRating: storedFallbackMaxAge || 'all',
          pin: null,
          is_kids: false,
          player:
            (typeof localStorage !== 'undefined'
              ? localStorage.getItem(`tgvideo_player_${f.profileId}`)
              : null) || 'artplayer',
          skip_seconds:
            (typeof localStorage !== 'undefined'
              ? Number(localStorage.getItem(`tgvideo_skip_${f.profileId}`))
              : null) || 10,
          favorites: [],
          image_prefs: {},
          lastSync: f.timestamp,
          messageId: f.messageId,
        });
      }
    }

    return profiles.sort((a, b) => a.name.localeCompare(b.name));
  }

  async function pullProfile(profileId) {
    const files = await listSyncFiles();
    const norm = normalizeName(profileId);
    const matching = files.filter(
      (f) =>
        f.kind === 'profile' &&
        (f.profileId === profileId ||
          f.profileId === norm ||
          normalizeName(f.profileId) === norm)
    );
    if (!matching.length) return null;

    const client = await getClient();
    const ch = await findOrCreateSyncChannel();
    const peer = peerOf(ch);

    const latest = matching[0];
    const msgs = await client.getMessages(peer, { ids: [latest.messageId] });
    const msg = msgs[0];
    if (!msg?.media) return null;

    const buffer = await client.downloadMedia(msg.media, {});
    const text = new TextDecoder().decode(buffer);
    const data = JSON.parse(text);

    let remoteFavs = mergeFavorites(data.favorites || [], data.profile?.favorites || []);
    let remoteImg = mergeImagePrefMaps(data.image_prefs || {}, data.profile?.image_prefs || {});

    // Si hay más versiones en Telegram (hasta 3), fusionar favoritos e imágenes recientes
    // para no perder datos si otro dispositivo subió un snapshot incompleto o desfasado
    if (matching.length > 1) {
      for (let i = 1; i < Math.min(matching.length, 3); i++) {
        try {
          const [prevMsg] = await client.getMessages(peer, { ids: [matching[i].messageId] });
          if (!prevMsg?.media) continue;
          const prevBuf = await client.downloadMedia(prevMsg.media, {});
          const prevData = JSON.parse(new TextDecoder().decode(prevBuf));
          const prevFavs = mergeFavorites(prevData.favorites || [], prevData.profile?.favorites || []);
          if (prevFavs.length) {
            remoteFavs = mergeFavorites(remoteFavs, prevFavs);
          }
          const prevImg = { ...(prevData.image_prefs || {}), ...(prevData.profile?.image_prefs || {}) };
          remoteImg = mergeImagePrefMaps(remoteImg, prevImg);
        } catch (_) {}
      }
    }

    return {
      ...data,
      favorites: remoteFavs,
      image_prefs: remoteImg,
    };
  }

  /**
   * Subida de perfil hacia Telegram en cola secuencial (no descarta pushes simultáneos)
   */
  let profileQueue = Promise.resolve();
  function pushProfile(profileData) {
    const snapshot = structuredClone(profileData);
    const task = profileQueue.catch(() => {}).then(async () => {
      const client = await getClient();
      const ch = await findOrCreateSyncChannel();
      const peer = peerOf(ch);

      const actualProfile = snapshot.profile || (snapshot.name ? snapshot : null);
      if (!snapshot.profile && actualProfile) {
        snapshot.profile = actualProfile;
      }
      const rawPid = snapshot.profile?.id || snapshot.profile?.name;
      if (!rawPid || rawPid === 'perfil') {
        console.warn('[sync] pushProfile ignorado: id de perfil no especificado o inválido');
        return;
      }
      const pid = rawPid;
      if (snapshot.profile) {
        if (!snapshot.profile.maxAgeRating && typeof localStorage !== 'undefined') {
          snapshot.profile.maxAgeRating = localStorage.getItem(`tgvideo_max_age_${pid}`) || 'all';
        }
      }
      const profileId = normalizeName(pid);
      const filename = `perfil_${profileId}_${nowTimestamp()}.json`;

      // Asegurar que favoritos e image_prefs queden incluidos de forma exhaustiva
      const localFavs = typeof loadFavorites === 'function' ? loadFavorites(pid) : [];
      const currentFavs = mergeFavorites(localFavs, snapshot.favorites || snapshot.profile?.favorites || []);
      snapshot.favorites = currentFavs;
      if (snapshot.profile) {
        snapshot.profile.favorites = currentFavs;
      }

      const localImg = typeof readImagePrefs === 'function' ? readImagePrefs(snapshot.profile || { id: pid }) : {};
      const currentImg = mergeImagePrefMaps(
        mergeImagePrefMaps(localImg, snapshot.profile?.image_prefs || {}),
        snapshot.image_prefs || {}
      );
      snapshot.image_prefs = currentImg;
      if (snapshot.profile) {
        snapshot.profile.image_prefs = currentImg;
      }

      // Asegurar que el progreso local quede incluido y fusionado exhaustivamente
      const localPrg = typeof loadProgress === 'function' ? loadProgress(pid) : {};
      const currentPrg = snapshot.progress && Object.keys(snapshot.progress).length > 0
        ? mergeProgress(localPrg, snapshot.progress)
        : localPrg;
      snapshot.progress = currentPrg;

      const json = JSON.stringify(snapshot);

      const browserFile = new File([json], filename, { type: 'application/json' });
      const inputFile = await client.uploadFile({
        file: browserFile,
        workers: 1,
      });

      const sentMsg = await client.sendFile(peer, {
        file: inputFile,
        caption: `Sync ${snapshot.profile?.name || profileId}`,
        forceDocument: true,
        attributes: [
          new Api.DocumentAttributeFilename({ fileName: filename }),
        ],
      });

      // Limpiar versiones antiguas dejando exactamente MAX_VERSIONS (1 activa + 4 backups = 5 total)
      const norm = normalizeName(profileId);
      const files = await listSyncFiles();
      const mine = files.filter(
        (f) =>
          f.kind === 'profile' &&
          (f.profileId === profileId ||
            f.profileId === norm ||
            normalizeName(f.profileId) === norm)
      );

      // EXCLUIR explícitamente el mensaje que acabamos de enviar para NUNCA borrarlo
      const older = mine.filter((f) => f.messageId !== sentMsg?.id);
      if (older.length >= MAX_VERSIONS) {
        // Dejar MAX_VERSIONS - 1 copias anteriores (4 backups)
        const toDelete = older.slice(MAX_VERSIONS - 1);
        for (const f of toDelete) {
          try {
            await client.deleteMessages(peer, [f.messageId], { revoke: true });
          } catch (err) {
            console.warn('[sync] No se pudo borrar versión antigua', f.filename, err);
          }
        }
      }
    });
    profileQueue = task;
    return task;
  }

  const imagePrefsSync = createImagePrefsSync({
    getClient, peerOf, listSyncFiles, findOrCreateSyncChannel, nowTimestamp, normalizeName,
  });

  function mergeProgress(localProgress = {}, remoteProgress = {}) {
    const out = { ...localProgress };

    for (const [key, remote] of Object.entries(remoteProgress)) {
      const local = out[key];
      if (!local) {
        out[key] = remote;
        continue;
      }

      const localPct = local.duration > 0 ? local.current_time / local.duration : 0;
      const remotePct = remote.duration > 0 ? remote.current_time / remote.duration : 0;

      if (remote.is_completed && !local.is_completed) {
        out[key] = remote;
      } else if (local.is_completed && !remote.is_completed) {
        out[key] = local;
      } else if ((remote.updated_at || 0) > (local.updated_at || 0)) {
        out[key] = remote;
      } else if ((local.updated_at || 0) > (remote.updated_at || 0)) {
        out[key] = local;
      } else if (remotePct >= localPct) {
        out[key] = remote;
      }
    }

    return out;
  }

  function schedulePush(profileData, delayMs = 1500) {
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      pushProfile(profileData);
    }, delayMs);
  }

  return {
    findOrCreateSyncChannel,
    listSyncFiles,
    pullGlobalConfig,
    pushGlobalConfig,
    pullMetadataOverrides,
    pushMetadataOverrides,
    listProfiles,
    pullProfile,
    pushProfile,
    schedulePush,
    mergeProgress,
    pullImagePrefs: imagePrefsSync.pullImagePrefs,
    pushImagePrefs: imagePrefsSync.pushImagePrefs,
  };
}