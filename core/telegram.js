// Suprimir alerts intrusivos de GramJS (ej. TypeNotFoundError / Missing MTProto Entity ID 0)
if (typeof window !== 'undefined') {
  const origAlert = window.alert;
  window.alert = function (msg, ...args) {
    const text = String(msg || '');
    if (text.includes('Missing MTProto Entity') || text.includes('TL definition')) {
      console.warn('[GramJS alert interceptado y suprimido]:', text);
      return;
    }
    return origAlert ? origAlert.apply(this, [msg, ...args]) : undefined;
  };
}

import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions';
import bigInt from 'big-integer';

export function getStoredApiCredentials() {
  const envId = Number(import.meta.env.VITE_API_ID);
  const envHash = import.meta.env.VITE_API_HASH;

  const localId = Number(localStorage.getItem('tg_api_id'));
  const localHash = localStorage.getItem('tg_api_hash');

  const finalId = (!isNaN(envId) && envId > 0)
    ? envId
    : ((!isNaN(localId) && localId > 0) ? localId : null);

  const finalHash = (envHash && String(envHash).trim())
    ? String(envHash).trim()
    : ((localHash && String(localHash).trim()) ? String(localHash).trim() : null);

  return { apiId: finalId, apiHash: finalHash };
}

let client = null;
let isReconnecting = false;

/**
 * Limpia y recicla los senders exportados hacia los Data Centers de medios (DC 2, DC 4, etc.)
 * Evita el bloqueo conocido de GramJS donde un sender secundario desconectado no puede reconectar ni reenviar autenticación.
 */
export async function resetExportedSenders(tgClient = client) {
  if (!tgClient) return;
  try {
    if (tgClient._exportedSenderReleaseTimeouts) {
      for (const t of tgClient._exportedSenderReleaseTimeouts.values()) {
        try { clearTimeout(t); } catch (_) {}
      }
      tgClient._exportedSenderReleaseTimeouts.clear();
    }
    if (tgClient._exportedSenderPromises) {
      const promises = Array.from(tgClient._exportedSenderPromises.values());
      tgClient._exportedSenderPromises.clear();
      for (const p of promises) {
        try {
          const s = await Promise.race([p, Promise.resolve(null)]);
          if (s && typeof s.disconnect === 'function') {
            try { await s.disconnect(); } catch (_) {}
          }
        } catch (_) {}
      }
    }
  } catch (err) {
    console.warn('[telegram] Error reseteando senders de streaming:', err);
  }
}

/**
 * Asegura que el cliente de Telegram esté conectado.
 * Si la conexión se ha perdido (ej. tras error MTProto o suspensión de red), reconecta automáticamente.
 */
export async function ensureConnected(tgClient = client, { forceResetSenders = false } = {}) {
  if (!tgClient) return null;
  if (forceResetSenders) {
    await resetExportedSenders(tgClient);
  }
  if (tgClient.connected) return tgClient;
  if (isReconnecting) {
    await new Promise(r => setTimeout(r, 600));
    return tgClient;
  }
  isReconnecting = true;
  try {
    console.warn('[telegram] Conexión perdida, reconectando cliente Telegram...');
    await tgClient.connect();
    console.info('[telegram] Cliente Telegram reconectado con éxito.');
  } catch (err) {
    console.warn('[telegram] Error durante la reconexión:', err?.message || err);
  } finally {
    isReconnecting = false;
  }
  return tgClient;
}

let readyPromise = null;

/**
 * Crea / recupera el cliente de Telegram.
 * Maneja login por teléfono + código + 2FA y guarda la sesión en localStorage.
 */
export function createTelegramClient({
  promptPhone,
  promptCode,
  promptPassword,
  promptApiCredentials,
  onError,
} = {}) {
  async function connect() {
    if (client && client.connected) return client;

    let { apiId, apiHash } = getStoredApiCredentials();

    if (!apiId || !apiHash) {
      if (typeof promptApiCredentials === 'function') {
        const creds = await promptApiCredentials();
        if (creds && creds.apiId && creds.apiHash) {
          apiId = Number(creds.apiId);
          apiHash = String(creds.apiHash).trim();
          localStorage.setItem('tg_api_id', String(apiId));
          localStorage.setItem('tg_api_hash', apiHash);
        }
      }
    }

    if (!apiId || !apiHash) {
      throw new Error('No se han configurado API ID y API Hash. Añádelos en los Secrets de GitHub o introdúcelos en la app.');
    }

    const sessionStr = localStorage.getItem('tg_session') || '';
    const session = new StringSession(sessionStr);

    client = new TelegramClient(session, apiId, apiHash, {
      connectionRetries: 5,
      useWSS: true,
    });

    await client.start({
      phoneNumber: async () => {
        if (typeof promptPhone === 'function') return (await promptPhone()) || '';
        return prompt('Teléfono con prefijo (+34...)') || '';
      },
      phoneCode: async () => {
        if (typeof promptCode === 'function') return (await promptCode()) || '';
        return prompt('Código recibido en Telegram') || '';
      },
      password: async () => {
        if (typeof promptPassword === 'function') return (await promptPassword()) || '';
        return prompt('Contraseña de verificación en dos pasos (2FA)') || '';
      },
      onError: (err) => {
        console.error('[telegram]', err);
        if (typeof onError === 'function') onError(err);
      },
    });

    // Guardar sesión
    localStorage.setItem('tg_session', client.session.save());
    return client;
  }

  readyPromise = connect();

  return {
    /** Promesa que se resuelve cuando el cliente está listo */
    ready: () => readyPromise,

    /** Devuelve el cliente (después de await ready()) */
    getClient: () => client,

    /** Helper para InputPeerChannel o InputPeerChat (compatible con canales externos, temas y grupos) */
    peerOf: (ch) => {
      if (!ch) return null;
      const rawId = String(ch.tgChannelId || ch.channelId || ch.id || "").split("_top_")[0].trim();
      const cleanId = rawId.replace(/^-100/, "").replace(/^-/, "");
      const hash = ch.accessHash || ch.hash;
      const isBasicGroup = ch.className === "Chat" || (ch.isGroup && (!hash || String(hash) === "0"));
      if (isBasicGroup) {
        return new Api.InputPeerChat({
          chatId: bigInt(rawId.replace(/^-/, "")),
        });
      }
      return new Api.InputPeerChannel({
        channelId: bigInt(cleanId || "0"),
        accessHash: bigInt(hash || "0"),
      });
    },

    /** Asegura reconexión si se pierde la conexión */
    ensureConnected: () => ensureConnected(client),

    resetExportedSenders: () => resetExportedSenders(client),

    /** ¿Hay sesión guardada? */
    hasSession: () => !!localStorage.getItem('tg_session'),

    /** Cerrar sesión */
    logout: async () => {
      try {
        if (client) await client.invoke(new Api.auth.LogOut());
      } catch (_) {}
      localStorage.removeItem('tg_session');
      client = null;
      readyPromise = null;
    },
  };
}
