// src/utils/devLogger.js
// Recopilador y sincronizador de logs de depuración hacia Telegram (Perfiles::TGVideo::tgstorage)
import { Api } from 'telegram';

const DEV_LOG_KEY = 'tgvideo_dev_log_enabled';
const MAX_BUFFER_LINES = 400;
const logBuffer = [];
let isHooked = false;
let logInterval = null;

function pad(n) {
  return String(n).padStart(2, '0');
}

function timestamp() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
         `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

function fileTimestamp() {
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export function hookConsole() {
  if (isHooked || typeof window === 'undefined') return;
  isHooked = true;

  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;

  const pushEntry = (level, args) => {
    try {
      const msg = args.map(a => {
        if (typeof a === 'string') return a;
        try { return JSON.stringify(a); } catch (_) { return String(a); }
      }).join(' ');
      logBuffer.push(`[${timestamp()}] [${level}] ${msg}`);
      if (logBuffer.length > MAX_BUFFER_LINES) {
        logBuffer.splice(0, logBuffer.length - MAX_BUFFER_LINES);
      }
    } catch (_) {}
  };

  console.log = function (...args) {
    pushEntry('INFO', args);
    return originalLog.apply(console, args);
  };

  console.warn = function (...args) {
    pushEntry('WARN', args);
    return originalWarn.apply(console, args);
  };

  console.error = function (...args) {
    pushEntry('ERROR', args);
    return originalError.apply(console, args);
  };
}

export function isDevLogEnabled() {
  try {
    return localStorage.getItem(DEV_LOG_KEY) === 'true';
  } catch (_) {
    return false;
  }
}

export function setDevLogEnabled(enabled) {
  try {
    localStorage.setItem(DEV_LOG_KEY, enabled ? 'true' : 'false');
  } catch (_) {}
}

export async function uploadDevLog({ getClient, peerOf, profile, sync }) {
  if (!getClient || !peerOf) return;
  try {
    const client = await getClient();
    if (!client || !client.connected) return;

    let targetPeer = null;
    if (sync?.findOrCreateSyncChannel) {
      const ch = await sync.findOrCreateSyncChannel();
      if (ch) targetPeer = peerOf(ch);
    }

    if (!targetPeer) {
      for await (const dialog of client.iterDialogs({})) {
        const entity = dialog.entity;
        if (entity?.className === 'Channel' && entity.title === 'Perfiles::TGVideo::tgstorage') {
          targetPeer = peerOf({ id: String(entity.id), hash: String(entity.accessHash) });
          break;
        }
      }
    }

    if (!targetPeer) {
      console.warn('[devLogger] Canal Perfiles::TGVideo::tgstorage no encontrado para subir log.');
      return;
    }

    const deviceId = localStorage.getItem('tgvideo_device_id') || 'dev';
    const profileName = profile?.name || 'anon';
    const platform = typeof window !== 'undefined' && window.Capacitor?.platform ? window.Capacitor.platform : 'web';
    const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown';

    const header = [
      '================================================================',
      `TGVideo Debug Log - ${timestamp()}`,
      `Perfil: ${profileName} (${profile?.id || 'n/a'})`,
      `Dispositivo: ${deviceId} | Plataforma: ${platform}`,
      `User-Agent: ${userAgent}`,
      '================================================================\n',
    ].join('\n');

    const content = header + logBuffer.join('\n');
    const filename = `debug_log_${deviceId}_${fileTimestamp()}.txt`;

    const browserFile = new File([content], filename, { type: 'text/plain' });
    const uploaded = await client.uploadFile({ file: browserFile, workers: 1 });

    await client.sendFile(targetPeer, {
      file: uploaded,
      caption: `Log de depuración TGVideo [${profileName} - ${deviceId}] ${timestamp()}`,
      forceDocument: true,
      attributes: [
        new Api.DocumentAttributeFilename({ fileName: filename }),
      ],
    });

    console.info('[devLogger] Log de depuración subido exitosamente a Telegram.');
  } catch (err) {
    console.warn('[devLogger] Error al subir log de depuración a Telegram:', err?.message || err);
  }
}

export function startDevLogging({ getClient, peerOf, profile, sync }) {
  stopDevLogging();
  hookConsole();
  if (!isDevLogEnabled()) return;

  console.info('[devLogger] Modo Desarrollador activo: el log se enviará cada 60 segundos a Telegram.');
  logInterval = setInterval(() => {
    if (!isDevLogEnabled()) {
      stopDevLogging();
      return;
    }
    uploadDevLog({ getClient, peerOf, profile, sync }).catch(() => {});
  }, 60000);
}

export function stopDevLogging() {
  if (logInterval) {
    clearInterval(logInterval);
    logInterval = null;
  }
}
