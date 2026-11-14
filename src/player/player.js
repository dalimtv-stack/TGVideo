// Reproductor TGVideo: Soporta ArtPlayer (avanzado) y Reproductor Nativo (HTML5)
import Artplayer from 'artplayer';
import { saveProgress } from './progress.js';
import { streamingAvailable, openStream } from './stream.js';

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}[char]));

export async function playFile({ client, peerOf, file, title, profile, resumeAt = 0, onClose, mount }) {
  const localPref = typeof localStorage !== 'undefined' && profile?.id
    ? localStorage.getItem(`tgvideo_player_${profile.id}`)
    : null;
  const playerType = profile?.player || localPref || 'artplayer';

  if (playerType === 'native') {
    return playNative({ client, peerOf, file, title, profile, resumeAt, onClose, mount });
  }
  return playArtplayer({ client, peerOf, file, title, profile, resumeAt, onClose, mount });
}

// -------------------------------------------------------------
// REPRODUCTOR NATIVO (HTML5) - Recomendado para iPhone / AirPlay
// -------------------------------------------------------------
async function playNative({ client, peerOf, file, title, profile, resumeAt, onClose, mount }) {
  mount.innerHTML = `
    <div class="player player-native">
      <div class="player-top-overlay" id="pl-top">
        <div class="player-top-left">
          <button class="btn-ghost" data-focusable id="pl-back">← Volver</button>
          <div class="player-title">${escapeHtml(title.nombre)} · ${escapeHtml(file.label)}</div>
          <span class="player-badge player-badge-native">Nativo</span>
        </div>
      </div>
      <div class="player-loading" id="pl-loading">
        <div class="loader"></div>
        <p id="pl-pct">Conectando con Telegram…</p>
      </div>
      <video id="pl-video" class="native-video" controls playsinline style="display:none"></video>
    </div>`;

  let cancelled = false, url = null, stream = null;
  const video = mount.querySelector('#pl-video');
  const playerEl = mount.querySelector('.player');
  const topOverlay = mount.querySelector('#pl-top');
  const loading = mount.querySelector('#pl-loading');
  const status = mount.querySelector('#pl-pct');

  let hideTimer = null;
  const showTop = () => {
    topOverlay?.classList.remove('is-hidden');
    clearTimeout(hideTimer);
    if (!video.paused) {
      hideTimer = setTimeout(() => {
        if (!cancelled && !video.paused) topOverlay?.classList.add('is-hidden');
      }, 3500);
    }
  };

  playerEl.addEventListener('mousemove', showTop);
  playerEl.addEventListener('touchstart', showTop, { passive: true });
  video.addEventListener('play', () => {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => topOverlay?.classList.add('is-hidden'), 2500);
  });
  video.addEventListener('pause', () => {
    clearTimeout(hideTimer);
    topOverlay?.classList.remove('is-hidden');
  });

  const goFullscreen = () => {
    if (document.fullscreenElement || document.webkitFullscreenElement) return;
    const req = playerEl.requestFullscreen || playerEl.webkitRequestFullscreen;
    if (req) {
      Promise.resolve(req.call(playerEl, { navigationUI: 'hide' }))
        .then(() => screen.orientation?.lock?.('landscape').catch(() => {}))
        .catch(() => {
          if (video.webkitEnterFullscreen && video.readyState > 0) {
            try { video.webkitEnterFullscreen(); } catch (_) {}
          }
        });
    } else if (video.webkitEnterFullscreen && video.readyState > 0) {
      try { video.webkitEnterFullscreen(); } catch (_) {}
    }
  };

  const exitFullscreen = () => {
    try { screen.orientation?.unlock?.(); } catch (_) {}
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else if (document.webkitFullscreenElement) document.webkitExitFullscreen?.();
    if (video.webkitExitFullscreen) try { video.webkitExitFullscreen(); } catch (_) {}
  };

  // Solicitar pantalla completa durante el gesto inicial del usuario
  goFullscreen();

  const close = () => {
    if (cancelled) return;
    cancelled = true;
    clearTimeout(hideTimer);
    exitFullscreen();
    if (video.duration) saveProgress(profile.id, file.key, video.currentTime, video.duration);
    video.pause();
    video.removeAttribute('src');
    video.load();
    if (stream) stream.close();
    else if (url) URL.revokeObjectURL(url);
    onClose?.();
  };

  mount.querySelector('#pl-back').onclick = close;
  mount.querySelector('#pl-back').focus();

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
    loading.style.display = 'none';
    video.style.display = 'block';
    video.src = url;

    video.onloadedmetadata = () => {
      if (resumeAt > 0 && resumeAt < video.duration - 5) video.currentTime = resumeAt;
      video.play().catch(() => {});
      goFullscreen();
    };

    let last = 0;
    video.ontimeupdate = () => {
      if (Date.now() - last > 5000) {
        last = Date.now();
        saveProgress(profile.id, file.key, video.currentTime, video.duration);
      }
    };
    video.onended = () => saveProgress(profile.id, file.key, video.duration, video.duration, true);
    video.onerror = () => {
      loading.style.display = 'flex';
      status.textContent = 'El navegador no puede reproducir este formato (códec no soportado).';
    };
    video.focus();
  } catch (e) {
    if (cancelled) return;
    console.error(e);
    if (status) status.textContent = 'Error al cargar el vídeo: ' + (e?.message || e);
  }
}

// -------------------------------------------------------------
// ARTPLAYER - Avanzado con tema moderno y controles cinemáticos
// -------------------------------------------------------------
async function playArtplayer({ client, peerOf, file, title, profile, resumeAt = 0, onClose, mount }) {
  mount.innerHTML = `
    <div class="player player-art">
      <div class="artplayer-host" id="pl-artplayer"></div>
      <div class="player-top-overlay" id="pl-top">
        <div class="player-top-left">
          <button class="btn-ghost" data-focusable id="pl-back">← Volver</button>
          <div class="player-title">${escapeHtml(title.nombre)} · ${escapeHtml(file.label)}</div>
          <span class="player-badge">Art</span>
        </div>
      </div>
      <div class="player-loading" id="pl-loading">
        <div class="loader"></div>
        <p id="pl-pct">Conectando con Telegram…</p>
      </div>
    </div>`;

  let cancelled = false, url = null, stream = null, art = null;
  if (!document.getElementById('artplayer-runtime-style')) {
    const style = document.createElement('style');
    style.id = 'artplayer-runtime-style';
    style.textContent = Artplayer.STYLE;
    document.head.append(style);
  }

  const playerEl = mount.querySelector('.player');
  const topOverlay = mount.querySelector('#pl-top');
  const loading = mount.querySelector('#pl-loading');
  const status = mount.querySelector('#pl-pct');
  const container = mount.querySelector('#pl-artplayer');

  const goFullscreen = () => {
    if (document.fullscreenElement || document.webkitFullscreenElement) return;
    const req = playerEl.requestFullscreen || playerEl.webkitRequestFullscreen;
    if (req) {
      Promise.resolve(req.call(playerEl, { navigationUI: 'hide' }))
        .then(() => screen.orientation?.lock?.('landscape').catch(() => {}))
        .catch(() => {});
    }
  };

  const exitFullscreen = () => {
    try { screen.orientation?.unlock?.(); } catch (_) {}
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else if (document.webkitFullscreenElement) document.webkitExitFullscreen?.();
    const vid = art?.template?.$video;
    if (vid?.webkitExitFullscreen) try { vid.webkitExitFullscreen(); } catch (_) {}
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

  // Se solicita pantalla completa durante el gesto del usuario
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
      container,
      url,
      title: `${title.nombre} · ${file.label}`,
      autoplay: true,
      playsInline: true,
      theme: '#e50914',
      lang: 'es',
      volume: 0.85,
      autoSize: false,
      autoMini: false,
      mutex: true,
      hotkey: true,
      playbackRate: true,
      aspectRatio: true,
      fullscreen: true,
      fullscreenWeb: true,
      pip: true,
      setting: true,
      screenshot: false,
      lock: true,
      fastForward: true,
      autoOrientation: true,
      autoPlayback: false,
      airplay: true,
      gesture: true,
      backdrop: true,
      moreVideoAttr: {
        'playsinline': true,
        'webkit-playsinline': true,
        'x5-video-player-type': 'h5',
      },
    });

    const video = art.template.$video;
    let lastSaved = 0;

    // Sincronizar barra superior con los controles de Artplayer
    art.on('control', show => {
      if (topOverlay) {
        if (show) topOverlay.classList.remove('is-hidden');
        else topOverlay.classList.add('is-hidden');
      }
    });

    // En iOS / Safari: si soporta webkitEnterFullscreen, añadir botón explícito para abrir la interfaz nativa
    if (video.webkitSupportsFullscreen) {
      art.controls.add({
        name: 'iosNativeFs',
        position: 'right',
        index: 68,
        html: '<span class="art-ios-btn" title="Pantalla completa nativa de iOS (para pistas de audio y subtítulos)">iOS</span>',
        tooltip: 'Pantalla completa iOS (Audios/Subs)',
        click() {
          try { video.webkitEnterFullscreen(); } catch (err) { console.warn(err); }
        }
      });
    }

    // Comprobar y exponer pistas de audio y subtítulos si WebKit las ofrece
    const checkTracks = () => {
      if (video.audioTracks && video.audioTracks.length > 1) {
        try {
          if (!art.setting.find('audioTracks')) {
            art.setting.add({
              name: 'audioTracks',
              width: 220,
              html: 'Pista de audio',
              tooltip: 'Audio',
              selector: Array.from(video.audioTracks).map((track, i) => ({
                default: track.enabled,
                html: track.label || track.language || `Audio ${i + 1}`,
                value: i,
              })),
              onSelect(item) {
                const idx = Number(item.value);
                Array.from(video.audioTracks).forEach((t, i) => {
                  t.enabled = (i === idx);
                });
                return item.html;
              },
            });
          }
        } catch (_) {}
      }

      if (video.textTracks && video.textTracks.length > 0) {
        try {
          if (!art.setting.find('nativeSubtitles')) {
            const tracks = Array.from(video.textTracks).filter(t => t.kind === 'subtitles' || t.kind === 'captions' || !t.kind);
            if (tracks.length > 0) {
              art.setting.add({
                name: 'nativeSubtitles',
                width: 220,
                html: 'Subtítulos',
                tooltip: 'Subtítulos',
                selector: [
                  { default: tracks.every(t => t.mode !== 'showing'), html: 'Desactivados', value: -1 },
                  ...tracks.map((track, i) => ({
                    default: track.mode === 'showing',
                    html: track.label || track.language || `Subtítulo ${i + 1}`,
                    value: i,
                  }))
                ],
                onSelect(item) {
                  const idx = Number(item.value);
                  tracks.forEach((t, i) => {
                    t.mode = (i === idx) ? 'showing' : 'disabled';
                  });
                  return item.html;
                },
              });
            }
          }
        } catch (_) {}
      }
    };

    art.on('ready', () => {
      if (loading) loading.style.display = 'none';
      if (resumeAt > 0 && resumeAt < video.duration - 5) video.currentTime = resumeAt;
      art.play().catch(() => {});
      checkTracks();
      if (!document.fullscreenElement && !document.webkitFullscreenElement) {
        goFullscreen();
      }
    });

    art.on('video:loadedmetadata', () => {
      checkTracks();
      if (!document.fullscreenElement && !document.webkitFullscreenElement) {
        goFullscreen();
      }
    });

    art.on('video:timeupdate', () => {
      if (Date.now() - lastSaved > 5000) {
        lastSaved = Date.now();
        saveCurrent();
      }
    });

    art.on('video:ended', () => {
      if (video.duration) saveProgress(profile.id, file.key, video.duration, video.duration, true);
    });

    art.on('video:error', () => {
      if (loading) loading.style.display = 'flex';
      if (status) status.textContent = 'El navegador no puede reproducir este formato (códec no soportado).';
    });

    art.on('hotkey', (event) => {
      if (event.key === 'f' || event.key === 'F') {
        art.fullscreen = !art.fullscreen;
      }
    });
  } catch (e) {
    if (cancelled) return;
    console.error(e);
    if (status) status.textContent = 'Error al cargar el vídeo: ' + (e?.message || e);
  }
}
