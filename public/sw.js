// TGVideo · Service Worker de streaming
// Intercepta /tgstream/<id>/... y pide a la página solo los bytes que el <video> necesita.
const MAX_RESPONSE = 2 * 1024 * 1024; // como mucho 2 MB por petición de rango

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith('/tgstream/')) return;
  event.respondWith(handleStream(event, url));
});

async function pickClient(event) {
  if (event.clientId) { const c = await self.clients.get(event.clientId); if (c) return c; }
  const all = await self.clients.matchAll({ type: 'window' });
  return all.find((c) => c.focused) || all[0];
}

function ask(client, payload) {
  return new Promise((resolve, reject) => {
    const ch = new MessageChannel();
    const t = setTimeout(() => reject(new Error('timeout')), 60000);
    ch.port1.onmessage = (m) => { clearTimeout(t); m.data.error ? reject(new Error(m.data.error)) : resolve(m.data); };
    client.postMessage({ type: 'tgstream', ...payload }, [ch.port2]);
  });
}

async function handleStream(event, url) {
  const id = url.pathname.split('/')[2];
  const range = event.request.headers.get('range');
  let start = 0, end = null;
  const m = range && /bytes=(\d*)-(\d*)/.exec(range);
  if (m) { if (m[1]) start = Number(m[1]); if (m[2]) end = Number(m[2]); }
  const client = await pickClient(event);
  if (!client) return new Response('sin página', { status: 503 });
  try {
    const want = end == null ? start + MAX_RESPONSE - 1 : Math.min(end, start + MAX_RESPONSE - 1);
    const r = await ask(client, { id, start, end: want });
    if (start >= r.size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${r.size}` } });
    const last = start + r.data.byteLength - 1;
    return new Response(r.data, {
      status: 206,
      headers: {
        'Content-Type': r.mime || 'video/mp4',
        'Content-Length': String(r.data.byteLength),
        'Content-Range': `bytes ${start}-${last}/${r.size}`,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    return new Response(String(e.message || e), { status: 500 });
  }
}
