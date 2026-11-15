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

    /** Helper para InputPeerChannel */
    peerOf: (ch) => new Api.InputPeerChannel({
      channelId: bigInt(ch.id),
      accessHash: bigInt(ch.hash),
    }),

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
