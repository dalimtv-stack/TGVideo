// Puente página <-> Service Worker: descarga de Telegram solo los trozos pedidos.
import bigInt from 'big-integer';

const PART = 512 * 1024; // tamaño de petición a Telegram (múltiplo válido para upload.getFile)
const CACHE_PARTS = 24;  // ~12 MB en memoria
const streams = new Map(); // id -> { client, media, size, mime, cache: Map<partIdx, Promise<Uint8Array>> }
let listening = false;

export async function streamingAvailable() {
  if (!('serviceWorker' in navigator)) return false;
  try {
    await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      // Primera visita: esperamos a que el SW tome el control (clients.claim)
      await new Promise((res) => {
        const t = setTimeout(res, 3000);
        navigator.serviceWorker.addEventListener('controllerchange', () => { clearTimeout(t); res(); }, { once: true });
      });
    }
    listen();
    return !!navigator.serviceWorker.controller;
  } catch (e) { console.warn('[stream] sin service worker', e); return false; }
}

function listen() {
  if (listening) return; listening = true;
  navigator.serviceWorker.addEventListener('message', async (ev) => {
    if (ev.data?.type !== 'tgstream') return;
    const port = ev.ports[0];
    const s = streams.get(ev.data.id);
    if (!s) return port.postMessage({ error: 'stream desconocido' });
    try {
      const start = ev.data.start, end = Math.min(ev.data.end, s.size - 1);
      if (start >= s.size) return port.postMessage({ size: s.size, mime: s.mime, data: new ArrayBuffer(0) });
      const data = await readRange(s, start, end);
      port.postMessage({ size: s.size, mime: s.mime, data: data.buffer }, [data.buffer]);
    } catch (e) { port.postMessage({ error: String(e?.message || e) }); }
  });
}

function getPart(s, idx) {
  if (s.cache.has(idx)) { const p = s.cache.get(idx); s.cache.delete(idx); s.cache.set(idx, p); return p; }
  const p = (async () => {
    for await (const chunk of s.client.iterDownload({
      file: s.media, offset: bigInt(idx * PART), requestSize: PART, limit: 1, fileSize: bigInt(s.size),
    })) return new Uint8Array(chunk);
    return new Uint8Array(0);
  })();
  p.catch(() => s.cache.delete(idx));
  s.cache.set(idx, p);
  while (s.cache.size > CACHE_PARTS) s.cache.delete(s.cache.keys().next().value);
  return p;
}

async function readRange(s, start, end) {
  const first = Math.floor(start / PART), lastP = Math.floor(end / PART);
  const parts = await Promise.all(Array.from({ length: lastP - first + 1 }, (_, i) => getPart(s, first + i)));
  // precarga el siguiente trozo para que no haya cortes
  if ((lastP + 1) * PART < s.size) getPart(s, lastP + 1);
  const out = new Uint8Array(end - start + 1);
  let pos = 0;
  parts.forEach((p, i) => {
    const base = (first + i) * PART;
    const from = Math.max(0, start - base), to = Math.min(p.length, end - base + 1);
    if (to > from) { out.set(p.subarray(from, to), pos); pos += to - from; }
  });
  return out.subarray(0, pos).slice();
}

export function openStream({ client, media, size, mime, name = 'video' }) {
  const id = Math.random().toString(36).slice(2);
  streams.set(id, { client, media, size, mime, cache: new Map() });
  return { url: `/tgstream/${id}/${encodeURIComponent(name)}`, close: () => streams.delete(id) };
}
