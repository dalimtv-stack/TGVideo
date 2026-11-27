// src/sync/telegramSync.js
import { Api } from 'telegram';
import { loadFavorites, loadProgress } from '../player/progress.js';
import { mergeImagePrefMaps, readImagePrefs } from '../metadata/imagePrefs.js';
import { createImagePrefsSync } from './imagePrefsSync.js';

const SYNC_CHANNEL_TITLE = 'Perfiles::TGVideo::tgstorage';
const MAX_VERSIONS = 5; // 1 versión activa + 4 backups (5 en total)
const CACHED_SYNC_CHANNEL_KEY = 'tg_sync_channel_v1';
const CACHED_PROFILES_KEY = 'tgvideo_cached_profiles_v1';

export function getCachedProfiles() {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(CACHED_PROFILES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function getStoredSyncChannel() {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(CACHED_SYNC_CHANNEL_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && parsed.id && parsed.hash && parsed.hash !== 'undefined' && parsed.hash !== 'null') {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function saveStoredSyncChannel(channel) {
  if (typeof localStorage === 'undefined' || !channel) return;
  try {
    localStorage.setItem(CACHED_SYNC_CHANNEL_KEY, JSON.stringify(channel));
  } catch (_) {}
}

function nowTimestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function normalizeName(str) {
  return (str || '')
    .toString()
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_-]/g, '_');
}

function parseSyncFilename(name) {
  const mGlobal = name.match(/^config_global_(\d{14})\.json$/);
  if (mGlobal) {
    return { kind: 'global', timestamp: mGlobal[1], filename: name };
  }
  const mOverrides = name.match(/^metadata_overrides_(\d{14})\.json$/);
  if (mOverrides) {
    return { kind: 'overrides', timestamp: mOverrides[1], filename: name };
  }
  const mImg = name.match(/^imgprefs_([a-z0-9_-]+)_(\d{14})\.json$/i);
  if (mImg) {
    return {
      kind: 'imgprefs',
      profileId: mImg[1],
      timestamp: mImg[2],
      filename: name,
    };
  }
  const m = name.match(/^perfil_([a-z0-9_-]+)_(\d{14})\.json$/i);
  if (m) {
    return {
      kind: 'profile',
      profileId: m[1],
      timestamp: m[2],
      filename: name,
    };
  }
  return null;
}

function mergeFavorites(local = [], remote = []) {
  const set = new Set(local);
  for (const item of remote) {
    set.add(item);
  }
  return [...set];
}

async function safeDownloadMedia(client, media, timeoutMs = 4000) {
  if (!client || !media) return null;
  try {
    return await Promise.race([
      client.downloadMedia(media, {}),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs))
    ]);
  } catch (err) {
    console.warn('[sync] safeDownloadMedia error/timeout:', err?.message || err);
    return null;
  }
}

export function createTelegramSync({ getClient, peerOf }) {
  let cachedChannel = null;
  let pushTimer = null;
  const docCache = new Map(); // messageId -> parsed json data

  async function findOrCreateSyncChannel() {
    if (cachedChannel && cachedChannel.id && cachedChannel.hash && cachedChannel.hash !== 'undefined' && cachedChannel.hash !== 'null') {
      return cachedChannel;
    }
    const stored = getStoredSyncChannel();
    if (stored && stored.id && stored.hash && stored.hash !== 'undefined' && stored.hash !== 'null') {
      cachedChannel = stored;
      return cachedChannel;
    }
    const client = await getClient();

    // 1. Buscar en diálogos activos con timeout
    try {
      const dialogs = await Promise.race([
        client.getDialogs({ limit: 40 }),
        new Promise(r => setTimeout(() => r([]), 4500))
      ]);
      for (const d of (dialogs || [])) {
        const entity = d.entity;
        if (
          (entity?.className === 'Channel' || entity?.className === 'Chat') &&
          entity.title === SYNC_CHANNEL_TITLE
        ) {
          cachedChannel = {
            id: String(entity.id),
            hash: (entity.accessHash && String(entity.accessHash) !== 'undefined') ? String(entity.accessHash) : '0',
            title: entity.title,
          };
          saveStoredSyncChannel(cachedChannel);
          return cachedChannel;
        }
      }
    } catch (e) {
      console.warn('[sync] Error buscando canal en dialogs', e);
    }

    // 2. Si no está en los diálogos, buscar por título
    try {
      const searchRes = await Promise.race([
        client.invoke(new Api.contacts.Search({ q: SYNC_CHANNEL_TITLE, limit: 10 })),
        new Promise(r => setTimeout(() => r({ chats: [] }), 3500))
      ]);
      const found = (searchRes.chats || []).find(
        (c) => c.title === SYNC_CHANNEL_TITLE
      );
      if (found) {
        cachedChannel = {
          id: String(found.id),
          hash: (found.accessHash && String(found.accessHash) !== 'undefined') ? String(found.accessHash) : '0',
          title: found.title,
        };
        saveStoredSyncChannel(cachedChannel);
        return cachedChannel;
      }
    } catch (e) {
      console.warn('[sync] Búsqueda de canal de sync falló', e);
    }

    // 3. Crear el canal privado si no existe
    try {
      const res = await client.invoke(
        new Api.channels.CreateChannel({
          title: SYNC_CHANNEL_TITLE,
          about: 'Canal de sincronización de perfiles y progreso de TGVideo (no eliminar)',
          broadcast: true,
          megagroup: false,
        })
      );
      const chat = res.chats?.[0];
      if (chat) {
        cachedChannel = {
          id: String(chat.id),
          hash: (chat.accessHash && String(chat.accessHash) !== 'undefined') ? String(chat.accessHash) : '0',
          title: chat.title,
        };
        saveStoredSyncChannel(cachedChannel);
        return cachedChannel;
      }
    } catch (err) {
      console.error('[sync] Error creando canal de sincronización:', err);
    }

    return cachedChannel;
  }

  let listFilesCache = null;
  let listFilesCacheTime = 0;
  let listFilesPromise = null;

  async function listSyncFiles({ force = false } = {}) {
    const now = Date.now();
    if (!force && listFilesCache && (now - listFilesCacheTime < 20000)) {
      return listFilesCache;
    }
    if (!force && listFilesPromise) {
      return listFilesPromise;
    }

    listFilesPromise = (async () => {
      try {
        const client = await getClient();
        const ch = await findOrCreateSyncChannel();
        if (!ch) return [];
        const peer = peerOf(ch);
        const files = [];

        // Obtener mensajes de forma directa y atómica sin bloqueos de async generator
        const messages = await Promise.race([
          client.getMessages(peer, { limit: 100 }),
          new Promise(r => setTimeout(() => r([]), 4500))
        ]);

        for (const msg of (messages || [])) {
          const doc = msg.media?.document;
          if (!doc) continue;

          const attr = doc.attributes?.find(
            (a) => a.className === 'DocumentAttributeFilename'
          );
          const filename = attr?.fileName;
          if (!filename) continue;

          const parsed = parseSyncFilename(filename);
          if (!parsed) continue;
          if (parsed.profileId === 'perfil' || parsed.profileId === 'default') continue;

          files.push({
            ...parsed,
            messageId: msg.id,
            date: msg.date || 0,
            caption: msg.message || '',
          });
        }

        const sorted = files.sort((a, b) => {
          if (b.timestamp !== a.timestamp) {
            return b.timestamp.localeCompare(a.timestamp);
          }
          return (b.messageId || 0) - (a.messageId || 0);
        });

        listFilesCache = sorted;
        listFilesCacheTime = Date.now();
        return sorted;
      } catch (err) {
        console.warn('[sync] listSyncFiles falló', err);
        return [];
      } finally {
        listFilesPromise = null;
      }
    })();

    return listFilesPromise;
  }

  async function pullGlobalConfig({ ifDifferentThanMsgId = null } = {}) {
    const latest = (await listSyncFiles()).find((f) => f.kind === 'global');
    if (!latest) return null;
    if (ifDifferentThanMsgId && latest.messageId === ifDifferentThanMsgId) {
      return null;
    }
    if (docCache.has(latest.messageId)) {
      return docCache.get(latest.messageId);
    }
    const client = await getClient();
    const peer = peerOf(await findOrCreateSyncChannel());
    const msgs = await Promise.race([
      client.getMessages(peer, { ids: [latest.messageId] }),
      new Promise(r => setTimeout(() => r([]), 3500))
    ]);
    const msg = msgs?.[0];
    if (!msg?.media) return null;
    const buffer = await safeDownloadMedia(client, msg.media, 4000);
    if (!buffer) return null;
    try {
      const data = JSON.parse(new TextDecoder().decode(buffer));
      if (!data || typeof data !== 'object') return null;
      data._syncMessageId = latest.messageId;
      docCache.set(latest.messageId, data);
      return data;
    } catch (_) {
      return null;
    }
  }

  let globalQueue = Promise.resolve();
  function pushGlobalConfig(config) {
    listFilesCache = null;
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

      if (sentMsg?.id) {
        snapshot._syncMessageId = sentMsg.id;
        docCache.set(sentMsg.id, snapshot);
      }

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

  async function pullMetadataOverrides({ ifDifferentThanMsgId = null } = {}) {
    const latest = (await listSyncFiles()).find((f) => f.kind === 'overrides');
    if (!latest) return null;
    if (ifDifferentThanMsgId && latest.messageId === ifDifferentThanMsgId) {
      return null;
    }
    if (docCache.has(latest.messageId)) {
      return docCache.get(latest.messageId);
    }
    const client = await getClient();
    const peer = peerOf(await findOrCreateSyncChannel());
    const msgs = await Promise.race([
      client.getMessages(peer, { ids: [latest.messageId] }),
      new Promise(r => setTimeout(() => r([]), 3500))
    ]);
    const msg = msgs?.[0];
    if (!msg?.media) return null;
    const buffer = await safeDownloadMedia(client, msg.media, 4000);
    if (!buffer) return null;
    try {
      const data = JSON.parse(new TextDecoder().decode(buffer));
      if (!data || typeof data.overrides !== 'object') return null;
      data._syncMessageId = latest.messageId;
      docCache.set(latest.messageId, data);
      return data;
    } catch (_) {
      return null;
    }
  }

  let overridesQueue = Promise.resolve();
  function pushMetadataOverrides(data) {
    listFilesCache = null;
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

      if (sentMsg?.id) {
        snapshot._syncMessageId = sentMsg.id;
        docCache.set(sentMsg.id, snapshot);
      }

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

    const cachedProfiles = getCachedProfiles() || [];
    const cachedMap = new Map();
    for (const p of cachedProfiles) {
      if (p.id) cachedMap.set(normalizeName(p.id), p);
    }

    const profiles = [];
    const neededFiles = [];

    for (const f of byId.values()) {
      const pKey = normalizeName(f.profileId);
      const existing = cachedMap.get(pKey);

      // Si ya tenemos este perfil en caché local con el MISMO messageId exacto,
      // reutilizarlo de inmediato sin volver a descargarlo de Telegram
      if (existing && existing.messageId === f.messageId) {
        profiles.push(existing);
        continue;
      }

      // Si ya se descargó en esta sesión:
      if (docCache.has(f.messageId)) {
        const data = docCache.get(f.messageId);
        const pId = data.profile?.id || f.profileId;
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
              ? localStorage.getItem(`tgvideo_player_${pId}`)
              : null) ||
            'artplayer',
          skip_seconds:
            data.profile?.skip_seconds ||
            (typeof localStorage !== 'undefined'
              ? Number(localStorage.getItem(`tgvideo_skip_${pId}`))
              : null) ||
            10,
          favorites: mergeFavorites(data.profile?.favorites || [], data.favorites || []),
          image_prefs: mergeImagePrefMaps(data.image_prefs || {}, data.profile?.image_prefs || {}),
          devices: data.profile?.devices || {},
          ui_scale: data.profile?.ui_scale,
          lastSync: f.timestamp,
          messageId: f.messageId,
        });
        continue;
      }

      neededFiles.push(f);
    }

    if (neededFiles.length > 0) {
      try {
        const client = await getClient();
        const ch = await findOrCreateSyncChannel();
        if (ch) {
          const peer = peerOf(ch);

          // Descarga concurrente con límite de tiempo por perfil para evitar bloqueos en iOS / Safari
          const downloadResults = await Promise.allSettled(
            neededFiles.map(async (f) => {
              const captionName = f.caption ? f.caption.replace(/^Sync\s+/i, '').trim() : null;

              try {
                const msgs = await Promise.race([
                  client.getMessages(peer, { ids: [f.messageId] }),
                  new Promise(r => setTimeout(() => r([]), 3500))
                ]);
                const msg = msgs?.[0];
                if (!msg?.media) {
                  return { f, data: null, captionName };
                }

                const buffer = await safeDownloadMedia(client, msg.media, 3500);
                if (buffer) {
                  const text = new TextDecoder().decode(buffer);
                  const data = JSON.parse(text);
                  docCache.set(f.messageId, data);
                  return { f, data, captionName };
                }
              } catch (err) {
                console.warn('[sync] Falló descarga de perfil', f.filename, err?.message || err);
              }
              return { f, data: null, captionName };
            })
          );

          for (const res of downloadResults) {
            if (res.status !== 'fulfilled') continue;
            const { f, data, captionName } = res.value;
            const pId = data?.profile?.id || f.profileId;
            if ((pId === 'perfil' || f.profileId === 'perfil') && (!data?.profile || !data.profile.name || data.profile.name === 'perfil')) {
              continue;
            }
            const profileName = data?.profile?.name || captionName || f.profileId;
            const storedMaxAge = typeof localStorage !== 'undefined' ? localStorage.getItem(`tgvideo_max_age_${pId}`) : null;
            profiles.push({
              id: pId,
              name: profileName,
              avatar: data?.profile?.avatar || null,
              age_limit: data?.profile?.age_limit || 'TP',
              maxAgeRating: data?.profile?.maxAgeRating || storedMaxAge || 'all',
              pin: data?.profile?.pin || null,
              is_kids: !!data?.profile?.is_kids,
              player:
                data?.profile?.player ||
                (typeof localStorage !== 'undefined'
                  ? localStorage.getItem(`tgvideo_player_${pId}`)
                  : null) ||
                'artplayer',
              skip_seconds:
                data?.profile?.skip_seconds ||
                (typeof localStorage !== 'undefined'
                  ? Number(localStorage.getItem(`tgvideo_skip_${pId}`))
                  : null) ||
                10,
              favorites: mergeFavorites(data?.profile?.favorites || [], data?.favorites || []),
              image_prefs: mergeImagePrefMaps(data?.image_prefs || {}, data?.profile?.image_prefs || {}),
              devices: data?.profile?.devices || {},
              ui_scale: data?.profile?.ui_scale,
              lastSync: f.timestamp,
              messageId: f.messageId,
            });
          }
        }
      } catch (err) {
        console.warn('[sync] Error descargando perfiles remotos en lote', err);
      }
    }

    const sortedProfiles = profiles.sort((a, b) => a.name.localeCompare(b.name));
    if (typeof localStorage !== 'undefined' && sortedProfiles.length > 0) {
      try {
        localStorage.setItem(CACHED_PROFILES_KEY, JSON.stringify(sortedProfiles));
      } catch (_) {}
    }
    return sortedProfiles;
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

    const latest = matching[0];

    if (docCache.has(latest.messageId)) {
      const data = docCache.get(latest.messageId);
      const remoteFavs = mergeFavorites(data.favorites || [], data.profile?.favorites || []);
      const remoteImg = mergeImagePrefMaps(data.image_prefs || {}, data.profile?.image_prefs || {});
      return {
        ...data,
        favorites: remoteFavs,
        image_prefs: remoteImg,
      };
    }

    const cachedProfiles = getCachedProfiles() || [];
    const cached = cachedProfiles.find((p) => p.id === profileId || normalizeName(p.id) === norm);
    if (cached && cached.messageId === latest.messageId) {
      return {
        profile: cached,
        favorites: cached.favorites || [],
        image_prefs: cached.image_prefs || {},
        progress: typeof loadProgress === 'function' ? loadProgress(cached.id) : {},
      };
    }

    const client = await getClient();
    const ch = await findOrCreateSyncChannel();
    if (!ch) return null;
    const peer = peerOf(ch);

    const msgs = await Promise.race([
      client.getMessages(peer, { ids: [latest.messageId] }),
      new Promise(r => setTimeout(() => r([]), 3500))
    ]);
    const msg = msgs?.[0];
    if (!msg?.media) return null;

    const buffer = await safeDownloadMedia(client, msg.media, 4000);
    if (!buffer) return null;
    try {
      const text = new TextDecoder().decode(buffer);
      const data = JSON.parse(text);
      docCache.set(latest.messageId, data);

      const remoteFavs = mergeFavorites(data.favorites || [], data.profile?.favorites || []);
      const remoteImg = mergeImagePrefMaps(data.image_prefs || {}, data.profile?.image_prefs || {});

      return {
        ...data,
        favorites: remoteFavs,
        image_prefs: remoteImg,
      };
    } catch (_) {
      return null;
    }
  }

  /**
   * Subida de perfil hacia Telegram en cola secuencial (no descarta pushes simultáneos)
   */
  let profileQueue = Promise.resolve();
  function pushProfile(profileData) {
    listFilesCache = null;
    const snapshot = structuredClone(profileData);
    const task = profileQueue.catch(() => {}).then(async () => {
      const client = await getClient();
      const ch = await findOrCreateSyncChannel();
      if (!ch) return;
      const peer = peerOf(ch);

      const actualProfile = snapshot.profile || (snapshot.name ? snapshot : null);
      if (!snapshot.profile && actualProfile) {
        snapshot.profile = actualProfile;
      }
      const rawPid = snapshot.profile?.id || snapshot.profile?.name;
      const pid = normalizeName(rawPid);
      if (!pid || pid === 'perfil' || pid === 'default') {
        console.warn('[sync] pushProfile rechazado: id de perfil no especificado o inválido:', rawPid);
        return;
      }
      if (snapshot.profile) {
        if (!snapshot.profile.maxAgeRating && typeof localStorage !== 'undefined') {
          snapshot.profile.maxAgeRating = localStorage.getItem(`tgvideo_max_age_${pid}`) || 'all';
        }
      }
      const profileId = pid;
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

      if (sentMsg?.id) {
        docCache.set(sentMsg.id, snapshot);
        if (typeof localStorage !== 'undefined') {
          try {
            const currentCached = getCachedProfiles() || [];
            const idx = currentCached.findIndex((p) => p.id === pid || normalizeName(p.id) === pid);
            const updatedEntry = {
              id: pid,
              name: snapshot.profile?.name || pid,
              avatar: snapshot.profile?.avatar || null,
              age_limit: snapshot.profile?.age_limit || 'TP',
              maxAgeRating: snapshot.profile?.maxAgeRating || 'all',
              pin: snapshot.profile?.pin || null,
              is_kids: !!snapshot.profile?.is_kids,
              player: snapshot.profile?.player || 'artplayer',
              skip_seconds: snapshot.profile?.skip_seconds || 10,
              favorites: currentFavs,
              image_prefs: currentImg,
              devices: snapshot.profile?.devices || {},
              ui_scale: snapshot.profile?.ui_scale,
              lastSync: nowTimestamp(),
              messageId: sentMsg.id,
            };
            if (idx >= 0) currentCached[idx] = updatedEntry;
            else currentCached.push(updatedEntry);
            localStorage.setItem(CACHED_PROFILES_KEY, JSON.stringify(currentCached));
          } catch (_) {}
        }
      }

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
    getCachedProfiles,
    pullProfile,
    pushProfile,
    schedulePush,
    mergeProgress,
    pullImagePrefs: imagePrefsSync.pullImagePrefs,
    pushImagePrefs: imagePrefsSync.pushImagePrefs,
  };
}
