// src/sync/telegramSync.js
// Sincronización bidireccional vía canal de Telegram (Perfiles::TGVideo::tgstorage)
import { Api } from 'telegram';
import { loadFavorites } from '../player/progress.js';
import { readImagePrefs } from '../metadata/imagePrefs.js';

const SYNC_CHANNEL_TITLE = 'Perfiles::TGVideo::tgstorage';
const MAX_VERSIONS = 5;

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

export function createTelegramSync({ getClient, peerOf }) {
  let cachedChannel = null;
  let pushing = false;
  let pushTimer = null;

  async function findOrCreateSyncChannel() {
    if (cachedChannel) return cachedChannel;
    const client = await getClient();

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

    for await (const msg of client.iterMessages(peer, { limit: 100 })) {
      const doc = msg.media?.document;
      if (!doc) continue;

      const attr = doc.attributes?.find(
        (a) => a.className === 'DocumentAttributeFilename'
      );
      const filename = attr?.fileName;
      if (!filename) continue;

      if (filename.startsWith('config_global_') && filename.endsWith('.json')) {
        const parts = filename.replace('.json', '').split('_');
        const ts = parts.slice(2).join('_');
        files.push({ kind: 'global', timestamp: ts, messageId: msg.id, filename });
      } else if (filename.startsWith('metadata_overrides_') && filename.endsWith('.json')) {
        const parts = filename.replace('.json', '').split('_');
        const ts = parts.slice(2).join('_');
        files.push({ kind: 'overrides', timestamp: ts, messageId: msg.id, filename });
      } else if (filename.startsWith('perfil_') && filename.endsWith('.json')) {
        const parts = filename.replace('.json', '').split('_');
        const ts = parts.slice(2).join('_');
        const profileId = parts[1];
        files.push({ kind: 'profile', profileId, timestamp: ts, messageId: msg.id, filename });
      }
    }

    return files.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }

  async function pullGlobalConfig() {
    const latest = (await listSyncFiles()).find(f => f.kind === 'global');
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
      const file = new File([JSON.stringify(snapshot)], filename, { type: 'application/json' });
      const uploaded = await client.uploadFile({ file, workers: 1 });
      await client.sendFile(peer, { file: uploaded, caption: 'Configuración global TGVideo', forceDocument: true,
        attributes: [new Api.DocumentAttributeFilename({ fileName: filename })] });
      const old = (await listSyncFiles()).filter(f => f.kind === 'global').slice(MAX_VERSIONS);
      for (const f of old) {
        try { await client.deleteMessages(peer, [f.messageId], { revoke: true }); }
        catch (error) { console.warn('[config] No se pudo borrar versión antigua', error); }
      }
    });
    globalQueue = task;
    return task;
  }

  async function pullMetadataOverrides() {
    const latest = (await listSyncFiles()).find(f => f.kind === 'overrides');
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
      const file = new File([JSON.stringify(snapshot)], filename, { type: 'application/json' });
      const uploaded = await client.uploadFile({ file, workers: 1 });
      await client.sendFile(peer, { file: uploaded, caption: 'Identificaciones TMDB TGVideo', forceDocument: true,
        attributes: [new Api.DocumentAttributeFilename({ fileName: filename })] });
      const old = (await listSyncFiles()).filter(f => f.kind === 'overrides').slice(MAX_VERSIONS);
      for (const f of old) {
        try { await client.deleteMessages(peer, [f.messageId], { revoke: true }); }
        catch (error) { console.warn('[overrides] No se pudo borrar versión antigua', error); }
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
      if (!byId.has(f.profileId)) byId.set(f.profileId, f);
    }

    const profiles = [];
    const client = await getClient();
    const ch = await findOrCreateSyncChannel();
    const peer = peerOf(ch);

    for (const f of byId.values()) {
      try {
        const msgs = await client.getMessages(peer, { ids: [f.messageId] });
        const msg = msgs[0];
        if (!msg?.media) continue;

        const buffer = await client.downloadMedia(msg.media, {});
        const text = new TextDecoder().decode(buffer);
        const data = JSON.parse(text);

        profiles.push({
          id: data.profile?.id || f.profileId,
          name: data.profile?.name || f.profileId,
          avatar: data.profile?.avatar || null,
          age_limit: data.profile?.age_limit || 'TP',
          pin: data.profile?.pin || null,
          is_kids: !!data.profile?.is_kids,
          player: data.profile?.player || (typeof localStorage !== 'undefined' ? localStorage.getItem(`tgvideo_player_${data.profile?.id || f.profileId}`) : null) || 'artplayer',
          skip_seconds: data.profile?.skip_seconds || (typeof localStorage !== 'undefined' ? Number(localStorage.getItem(`tgvideo_skip_${data.profile?.id || f.profileId}`)) : null) || 10,
          favorites: data.profile?.favorites || data.favorites || [],
          image_prefs: data.profile?.image_prefs || data.image_prefs || {},
          lastSync: f.timestamp,
          messageId: f.messageId,
        });
      } catch (err) {
        console.warn('[sync] No se pudo leer perfil', f.filename, err);
        profiles.push({
          id: f.profileId,
          name: f.profileId,
          avatar: null,
          age_limit: 'TP',
          pin: null,
          is_kids: false,
          player: (typeof localStorage !== 'undefined' ? localStorage.getItem(`tgvideo_player_${f.profileId}`) : null) || 'artplayer',
          skip_seconds: (typeof localStorage !== 'undefined' ? Number(localStorage.getItem(`tgvideo_skip_${f.profileId}`)) : null) || 10,
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
    const latest = files.find((f) => f.profileId === profileId);
    if (!latest) return null;

    const client = await getClient();
    const ch = await findOrCreateSyncChannel();
    const peer = peerOf(ch);
    const msgs = await client.getMessages(peer, { ids: [latest.messageId] });
    const msg = msgs[0];
    if (!msg?.media) return null;

    const buffer = await client.downloadMedia(msg.media, {});
    const text = new TextDecoder().decode(buffer);
    const data = JSON.parse(text);
    return {
      ...data,
      favorites: data.profile?.favorites || data.favorites || [],
      image_prefs: data.profile?.image_prefs || data.image_prefs || {},
    };
  }

  /**
   * Subida de perfil hacia Telegram
   */
  async function pushProfile(profileData) {
    if (pushing) return;
    pushing = true;

    try {
      const client = await getClient();
      const ch = await findOrCreateSyncChannel();
      const peer = peerOf(ch);

      const pid = profileData.profile?.id || profileData.profile?.name || 'perfil';
      const profileId = normalizeName(pid);
      const filename = `perfil_${profileId}_${nowTimestamp()}.json`;

      // Asegurar que favoritos e image_prefs queden incluidos en el snapshot
      if (!profileData.favorites && typeof loadFavorites === 'function') {
        profileData.favorites = loadFavorites(pid);
      }
      if (profileData.profile && !profileData.profile.favorites && profileData.favorites) {
        profileData.profile.favorites = profileData.favorites;
      }
      if (!profileData.image_prefs && typeof readImagePrefs === 'function' && profileData.profile) {
        profileData.image_prefs = readImagePrefs(profileData.profile);
      }
      if (profileData.profile && !profileData.profile.image_prefs && profileData.image_prefs) {
        profileData.profile.image_prefs = profileData.image_prefs;
      }

      const json = JSON.stringify(profileData);

      const browserFile = new File([json], filename, { type: 'application/json' });
      const inputFile = await client.uploadFile({
        file: browserFile,
        workers: 1,
      });

      await client.sendFile(peer, {
        file: inputFile,
        caption: `Sync ${profileData.profile?.name || profileId}`,
        forceDocument: true,
        attributes: [
          new Api.DocumentAttributeFilename({ fileName: filename }),
        ],
      });

      // Limpiar versiones antiguas (dejar máximo MAX_VERSIONS)
      const files = await listSyncFiles();
      const mine = files.filter((f) => f.profileId === profileId);
      if (mine.length > MAX_VERSIONS) {
        const toDelete = mine.slice(MAX_VERSIONS);
        for (const f of toDelete) {
          try {
            await client.deleteMessages(peer, [f.messageId], { revoke: true });
          } catch (err) {
            console.warn('[sync] No se pudo borrar versión antigua', f.filename, err);
          }
        }
      }
    } finally {
      pushing = false;
    }
  }

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
        // local gana
      } else if (remotePct > localPct) {
        out[key] = remote;
      } else if (remotePct === localPct && (remote.updated_at || 0) > (local.updated_at || 0)) {
        out[key] = remote;
      }
    }

    return out;
  }

  function schedulePush(profileData, delayMs = 4000) {
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      pushProfile(profileData).catch((err) => {
        console.warn('[sync] push failed', err);
      });
    }, delayMs);
  }

  return {
    pullGlobalConfig,
    pushGlobalConfig,
    pullMetadataOverrides,
    pushMetadataOverrides,
    listProfiles,
    pullProfile,
    pushProfile,
    mergeProgress,
    schedulePush,
    findOrCreateSyncChannel,
  };
}
