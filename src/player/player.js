// Reproductor Artplayer: descarga el vídeo de Telegram por chunks y lo reproduce
import Artplayer from 'artplayer';

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
import { saveProgress } from './progress.js';
import { streamingAvailable, openStream } from './stream.js';

export async function playFile({ client, peerOf, file, title, profile, resumeAt = 0, onClose, mount }) {
  mount.innerHTML = `
    <div class="player">
      <div class="player-top"><button class="btn-ghost" data-focusable id="pl-back">← Volver</button>
        <div class="player-title">${escapeHtml(title.nombre)} · ${escapeHtml(file.label)}</div></div>
      <div class="player-loading" id="pl-loading"><div class="loader"></div>
        <p id="pl-pct">Conectando con Telegram…</p></div>
      <div class="artplayer-host" id="pl-artplayer"></div>
    </div>`;
  let cancelled = false, url = null, stream = null, art = null;
  if (!document.getElementById('artplayer-runtime-style')) {
    const style = document.createElement('style'); style.id = 'artplayer-runtime-style'; style.textContent = Artplayer.STYLE; document.head.append(style);
  }
  const playerEl = mount.querySelector('.player');
  const loading = mount.querySelector('#pl-loading');
  const status = mount.querySelector('#pl-pct');
  const container = mount.querySelector('#pl-artplayer');

  const goFullscreen = () => {
    if (document.fullscreenElement || document.webkitFullscreenElement) return;
    const req = playerEl.requestFullscreen || playerEl.webkitRequestFullscreen;
    if (req) Promise.resolve(req.call(playerEl, { navigationUI: 'hide' }))
      .then(() => screen.orientation?.lock?.('landscape').catch(() => {}))
      .catch(() => {});
  };
  const exitFullscreen = () => {
    try { screen.orientation?.unlock?.(); } catch (_) {}
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else if (document.webkitFullscreenElement) document.webkitExitFullscreen?.();
  };

  const saveCurrent = () => {
    const video = art?.template?.$video;
    if (video?.duration) saveProgress(profile.id, file.key, video.currentTime, video.duration);
  };
  const close = () => {
    if (cancelled) return;
    cancelled = true;
    saveCurrent();
    exitFullscreen();
    try { art?.destroy(); } catch (error) { console.warn('[player] destroy failed', error); }
    art = null;
    if (stream) stream.close();
    else if (url) URL.revokeObjectURL(url);
    onClose?.();
  };
  mount.querySelector('#pl-back').onclick = close;
  mount.querySelector('#pl-back').focus();
  // Se solicita durante el gesto del usuario para que el navegador permita pantalla completa.
  goFullscreen();

  try {
    const [msg] = await client.getMessages(peerOf(title.channel), { ids: [file.messageId] });
    const doc = msg.media?.document;
    const size = Number(doc?.size ?? file.size ?? 0);
    const mime = (doc?.mimeType || file.mimeType) === 'video/x-matroska' ? 'video/webm' : (doc?.mimeType || file.mimeType || 'video/mp4');
    if (size > 0 && await streamingAvailable()) {
      if (cancelled) return;
      stream = openStream({ client, media: msg.media, size, mime, name: file.label || 'video' });
      url = stream.url;
    } else {
      const buf = await client.downloadMedia(msg.media, {
        progressCallback: (got, total) => {
          if (cancelled) throw new Error('cancelado');
          const t = Number(total) || file.size || 1;
          if (status) status.textContent = `Descargando desde Telegram… ${Math.round(Number(got) / t * 100)}%`;
        },
      });
      if (cancelled) return;
      url = URL.createObjectURL(new Blob([buf], { type: mime }));
    }
    if (cancelled) return;

    art = new Artplayer({
      container, url, autoplay: true, playsInline: true, theme: '#a855f7',
      lang: 'es', volume: 0.8, autoSize: false, mutex: true,
      hotkey: true, playbackRate: true, aspectRatio: true,
      fullscreen: true, fullscreenWeb: true, pip: true,
      setting: true, screenshot: false, lock: true, fastForward: true,
      autoOrientation: true, autoPlayback: false,
    });

    const video = art.template.$video;
    let lastSaved = 0;
    art.on('ready', () => {
      if (loading) loading.style.display = 'none';
      if (resumeAt > 0 && resumeAt < video.duration - 5) video.currentTime = resumeAt;
      art.play().catch(() => {});
    });
    art.on('video:timeupdate', () => {
      if (Date.now() - lastSaved > 5000) { lastSaved = Date.now(); saveCurrent(); }
    });
    art.on('video:ended', () => {
      if (video.duration) saveProgress(profile.id, file.key, video.duration, video.duration, true);
    });
    art.on('video:error', () => {
      if (loading) loading.style.display = 'flex';
      if (status) status.textContent = 'El navegador no puede reproducir este formato (códec no soportado).';
    });
    art.on('hotkey', (event) => {
      if (event.key === 'f' || event.key === 'F') goFullscreen();
    });
    art.on('video:canplay', () => { if (!document.fullscreenElement && !document.webkitFullscreenElement) goFullscreen(); });
  } catch (e) {
    if (cancelled) return;
    console.error(e);
    if (status) status.textContent = 'Error al cargar el vídeo: ' + (e?.message || e);
  }
}
