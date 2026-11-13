/**
 * Sincronización de perfiles y progreso mediante canal de Telegram.
 *
 * Canal: Perfiles::TGVideo::tgstorage
 * Archivos: perfil_{nombreNormalizado}_{YYYYMMDDHHmmss}.json
 * Máximo 5 versiones por perfil.
 */

import { Api } from 'telegram';

const SYNC_CHANNEL_TITLE = 'Perfiles::TGVideo::tgstorage';
const MAX_VERSIONS = 5;
const FILE_RE = /^perfil_([a-z0-9_]+)_(\d{14})\.json$/i;

function normalizeName(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '') || 'perfil';
}

function nowTimestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return (
    d.getFullYear() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}

function parseFilename(name) {
  const m = String(name || '').match(FILE_RE);
  if (!m) return null;
  return { profileId: m[1], timestamp: m[2] };
}

/**
 * @param {object} opts
 * @param {() => Promise<any>} opts.getClient
 * @param {(ch) => any} opts.peerOf
 */
export function createTelegramSync({ getClient, peerOf }) {
  let syncChannel = null;
  let pushTimer = null;
  let pushing = false;

  async function findOrCreateSyncChannel() {
    const client = await getClient();
    if (syncChannel) return syncChannel;

    // Buscar canal existente
    for await (const dialog of client.iterDialogs({})) {
      const entity = dialog.entity;
      if (entity?.className === 'Channel' && entity.title === SYNC_CHANNEL_TITLE) {
        syncChannel = {
          id: String(entity.id),
          hash: String(entity.accessHash),
        };
        return syncChannel;
      }
    }

    // Crear canal privado
    const result = await client.invoke(
      new Api.channels.CreateChannel({
        title: SYNC_CHANNEL_TITLE,
        about: 'Sincronización de perfiles TGVideo (no borrar)',
        megagroup: false,
      })
    );

    const created = result.chats?.[0];
    if (!created) throw new Error('No se pudo crear el canal de sincronización');

    syncChannel = {
      id: String(created.id),
      hash: String(created.accessHash),
    };
    return syncChannel;
  }

  async function listSyncFiles() {
    const client = await getClient();
    const ch = await findOrCreateSyncChannel();
    const peer = peerOf(ch);
    const files = [];

    for await (const msg of client.iterMessages(peer, {
      filter: new Api.InputMessagesFilterDocument(),
      limit: 100,
    })) {
      const doc = msg.document;
      if (!doc) continue;
      const filename = doc.attributes?.find(
        (a) => a.className === 'DocumentAttributeFilename'
      )?.fileName;
      const parsed = parseFilename(filename);
      if (!parsed) continue;

      files.push({
        messageId: msg.id,
        filename,
        profileId: parsed.profileId,
        timestamp: parsed.timestamp,
        date: msg.date,
        size: Number(doc.size?.toString?.() || doc.size || 0),
      });
    }

    files.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    return files;
  }

  async function listProfiles() {
    const files = await listSyncFiles();
    const byId = new Map();

    for (const f of files) {
      if (!byId.has(f.profileId)) {
        byId.set(f.profileId, f);
      }
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
    return JSON.parse(text);
  }

  async function pushProfile(profileData) {
    if (pushing) return;
    pushing = true;

    try {
      const client = await getClient();
      const ch = await findOrCreateSyncChannel();
      const peer = peerOf(ch);

      const profileId = normalizeName(profileData.profile?.id || profileData.profile?.name || 'perfil');
      const filename = `perfil_${profileId}_${nowTimestamp()}.json`;
      const json = JSON.stringify(profileData);
      const bytes = new TextEncoder().encode(json);

      // Forma correcta de subir un archivo pequeño con GramJS en navegador
      await client.sendFile(peer, {
        file: bytes,
        caption: `Sync ${profileData.profile?.name || profileId}`,
        forceDocument: true,
        attributes: [
          new Api.DocumentAttributeFilename({ fileName: filename }),
        ],
      });

      // Limpiar versiones antiguas
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
    listProfiles,
    pullProfile,
    pushProfile,
    mergeProgress,
    schedulePush,
    findOrCreateSyncChannel,
  };
}
