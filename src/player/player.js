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

/**
 * Configura doble toque (móvil) y doble clic (escritorio) en izquierda/derecha
 * para atrasar o adelantar los segundos configurados en el perfil.
 */
function setupDoubleTapSkip({ container, video, skipSeconds = 10 }) {
  if (!container || !video) return () => {};

  const feedback = document.createElement('div');
  feedback.className = 'player-skip-feedback';
  container.appendChild(feedback);

  let feedbackTimer = null;
  const showSkipBadge = (side, secs) => {
    if (feedbackTimer) clearTimeout(feedbackTimer);
    feedback.className = `player-skip-feedback show-${side}`;
    feedback.innerHTML = side === 'left'
      ? `<div class="skip-pill"><span class="skip-icon">⏪</span> -${secs}s</div>`
      : `<div class="skip-pill">+${secs}s <span class="skip-icon">⏩</span></div>`;
    feedbackTimer = setTimeout(() => {
      feedback.className = 'player-skip-feedback';
      feedback.innerHTML = '';
    }, 650);
  };

  const performSkip = (side) => {
    const delta = side === 'left' ? -skipSeconds : skipSeconds;
    const target = Math.max(0, Math.min(video.duration || Infinity, (video.currentTime || 0) + delta));
    video.currentTime = target;
    showSkipBadge(side, skipSeconds);
  };

  const onDblClick = (e) => {
    if (e.target.closest('.art-controls, .art-bottom, .player-top-overlay, button, input, select')) return;
    const rect = container.getBoundingClientRect();
    if (!rect.width) return;
    const x = (e.clientX - rect.left) / rect.width;
    if (x <= 0.38) {
      e.preventDefault();
      e.stopPropagation();
      performSkip('left');
    } else if (x >= 0.62) {
      e.preventDefault();
      e.stopPropagation();
      performSkip('right');
    }
  };

  let lastTapTime = 0;
  let lastTapX = 0;

  const onTouchEnd = (e) => {
    if (e.target.closest('.art-controls, .art-bottom, .player-top-overlay, button, input, select')) return;
    const touch = e.changedTouches?.[0];
    if (!touch) return;
    const rect = container.getBoundingClientRect();
    if (!rect.width) return;
    const x = (touch.clientX - rect.left) / rect.width;
    const now = Date.now();

    if (now - lastTapTime < 320 && Math.abs(touch.clientX - lastTapX) < 60) {
      if (x <= 0.38) {
        e.preventDefault();
        e.stopPropagation();
        performSkip('left');
      } else if (x >= 0.62) {
        e.preventDefault();
        e.stopPropagation();
        performSkip('right');
      }
      lastTapTime = 0;
    } else {
      lastTapTime = now;
      lastTapX = touch.clientX;
    }
  };

  container.addEventListener('dblclick', onDblClick, true);
  container.addEventListener('touchend', onTouchEnd, { passive: false, capture: true });

  return () => {
    container.removeEventListener('dblclick', onDblClick, true);
    container.removeEventListener('touchend', onTouchEnd, { capture: true });
    feedback.remove();
  };
}

export async function playFile({ client, peerOf, file, title, profile, resumeAt = 0, onClose, mount }) {
  const localPref = typeof localStorage !== 'undefined' && profile?.id
    ? localStorage.getItem(`tgvideo_player_${profile.id}`)
    : null;
  const playerType = profile?.player || localPref || 'artplayer';

  const localSkip = typeof localStorage !== 'undefined' && profile?.id
    ? localStorage.getItem(`tgvideo_skip_${profile.id}`)
    : null;
  const skipSeconds = Number(profile?.skip_seconds || localSkip || 10);

  if (playerType === 'native') {
    return playNative({ client, peerOf, file, title, profile, resumeAt, skipSeconds, onClose, mount });
  }
  return playArtplayer({ client, peerOf, file, title, profile, resumeAt, skipSeconds, onClose, mount });
}

// -------------------------------------------------------------
// REPRODUCTOR NATIVO (HTML5) - Recomendado para iPhone / AirPlay
// -------------------------------------------------------------
async function playNative({ client, peerOf, file, title, profile, resumeAt, skipSeconds, onClose, mount }) {
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
        <p id="pl-status">Conectando con Telegram…</p>
      </div>
      <video class="native-video" playsinline webkit-playsinline controls autoplay preload="auto"></video>
    </div>`;

  const playerEl = mount.querySelector('.player');
  const video = mount.querySelector('video');
  const loading = mount.querySelector('#pl-loading');
  const status = mount.querySelector('#pl-status');
  const topOverlay = mount.querySelector('#pl-top');

  let cancelled = false;
  let stream = null;
  let url = null;
  let hideTimer = null;

  const showTop = () => {
    topOverlay?.classList.remove('is-hidden');
    clearTimeout(hideTimer);
    if (!video.paused) {
      hideTimer = setTimeout(() => topOverlay?.classList.add('is-hidden'), 3500);
    }
  };

  playerEl.addEventListener('mousemove', showTop);
  playerEl.addEventListener('click', showTop);
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

  const cleanupSkip = setupDoubleTapSkip({ container: playerEl, video, skipSeconds });

  const close = () => {
    if (cancelled) return;
    cancelled = true;
    cleanupSkip();
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

  window.addEventListener('keydown', function onKey(e) {
    if (cancelled) { window.removeEventListener('keydown', onKey); return; }
    if (['Escape', 'Backspace', 'GoBack'].includes(e.key)) {
      e.preventDefault(); e.stopPropagation(); close();
    }
  });

  try {
    const peer = await peerOf(file.channel.id);
    const [msg] = await client.getMessages(peer, { ids: [file.messageId] });
    if (cancelled) return;
    if (!msg?.media?.document) throw new Error('Vídeo no encontrado en el canal.');

    if (streamingAvailable()) {
      status.textContent = 'Abriendo túnel de streaming…';
      stream = await openStream(client, peer, msg.media.document);
      if (cancelled) { stream.close(); return; }
      url = stream.url;
    } else {
      status.textContent = 'Descargando desde Telegram…';
      const buffer = await client.downloadMedia(msg, {
        progressCallback: (done, total) => {
          if (cancelled) return;
          if (total) status.textContent = `Descargando: ${Math.round((done / total) * 100)}%`;
        },
      });
      if (cancelled) return;
      url = URL.createObjectURL(new Blob([buffer], { type: file.mime || 'video/mp4' }));
    }

    video.src = url;

    let resumed = false;
    const applyResume = () => {
      if (resumed) return;
      if (resumeAt > 0 && video.duration && resumeAt < video.duration - 10) {
        video.currentTime = resumeAt;
      }
      resumed = true;
    };

    video.addEventListener('loadedmetadata', () => {
      applyResume();
      if (video.webkitSupportsFullscreen && !document.fullscreenElement) {
        try { video.webkitEnterFullscreen(); } catch (_) {}
      }
    });

    video.addEventListener('canplay', () => {
      loading.style.display = 'none';
      video.play().catch(() => {});
    });

    let lastSaved = 0;
    video.addEventListener('timeupdate', () => {
      const now = Date.now();
      if (now - lastSaved > 5000 && video.duration) {
        lastSaved = now;
        saveProgress(profile.id, file.key, video.currentTime, video.duration);
      }
    });

    video.addEventListener('ended', () => {
      if (video.duration) saveProgress(profile.id, file.key, video.duration, video.duration);
    });

    video.addEventListener('error', () => {
      loading.style.display = 'flex';
      status.textContent = 'Error al reproducir el archivo. Prueba con ArtPlayer en Ajustes.';
    });

  } catch (error) {
    if (cancelled) return;
    status.textContent = error.message || 'Error al conectar con Telegram';
  }
}

// -------------------------------------------------------------
// REPRODUCTOR ARTPLAYER - Avanzado, moderno y con gestos
// -------------------------------------------------------------
async function playArtplayer({ client, peerOf, file, title, profile, resumeAt = 0, skipSeconds, onClose, mount }) {
  mount.innerHTML = `
    <div class="player player-art">
      <div class="player-top-overlay" id="pl-top">
        <div class="player-top-left">
          <button class="btn-ghost" data-focusable id="pl-back">← Volver</button>
          <div class="player-title">${escapeHtml(title.nombre)} · ${escapeHtml(file.label)}</div>
          <span class="player-badge">ArtPlayer</span>
        </div>
      </div>
      <div class="player-loading" id="pl-loading">
        <div class="loader"></div>
        <p id="pl-status">Conectando con Telegram…</p>
      </div>
      <div class="artplayer-host" id="artplayer-container"></div>
    </div>`;

  const playerEl = mount.querySelector('.player');
  const container = mount.querySelector('#artplayer-container');
  const loading = mount.querySelector('#pl-loading');
  const status = mount.querySelector('#pl-status');
  const topOverlay = mount.querySelector('#pl-top');

  let cancelled = false;
  let stream = null;
  let url = null;
  let art = null;
  let cleanupSkip = null;

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
  };

  goFullscreen();

  const close = () => {
    if (cancelled) return;
    cancelled = true;
    if (cleanupSkip) cleanupSkip();
    exitFullscreen();
    if (art) {
      try {
        if (art.duration) saveProgress(profile.id, file.key, art.currentTime, art.duration);
        art.destroy(false);
      } catch (_) {}
    }
    if (stream) stream.close();
    else if (url) URL.revokeObjectURL(url);
    onClose?.();
  };

  mount.querySelector('#pl-back').onclick = close;

  window.addEventListener('keydown', function onKey(e) {
    if (cancelled) { window.removeEventListener('keydown', onKey); return; }
    if (['Escape', 'Backspace', 'GoBack'].includes(e.key)) {
      e.preventDefault(); e.stopPropagation(); close();
    }
  });

  try {
    const peer = await peerOf(file.channel.id);
    const [msg] = await client.getMessages(peer, { ids: [file.messageId] });
    if (cancelled) return;
    if (!msg?.media?.document) throw new Error('Vídeo no encontrado en el canal.');

    if (streamingAvailable()) {
      status.textContent = 'Abriendo túnel de streaming…';
      stream = await openStream(client, peer, msg.media.document);
      if (cancelled) { stream.close(); return; }
      url = stream.url;
    } else {
      status.textContent = 'Descargando desde Telegram…';
      const buffer = await client.downloadMedia(msg, {
        progressCallback: (done, total) => {
          if (cancelled) return;
          if (total) status.textContent = `Descargando: ${Math.round((done / total) * 100)}%`;
        },
      });
      if (cancelled) return;
      url = URL.createObjectURL(new Blob([buffer], { type: file.mime || 'video/mp4' }));
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

    cleanupSkip = setupDoubleTapSkip({ container: art.template.$player, video, skipSeconds });

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
      loading.style.display = 'none';
      if (resumeAt > 0) {
        art.currentTime = resumeAt;
      }
      checkTracks();
      if (video.webkitSupportsFullscreen && !document.fullscreenElement) {
        try { video.webkitEnterFullscreen(); } catch (_) {}
      }
    });

    art.on('video:loadedmetadata', checkTracks);
    art.on('video:canplay', checkTracks);

    art.on('video:timeupdate', () => {
      const now = Date.now();
      if (now - lastSaved > 5000 && art.duration) {
        lastSaved = now;
        saveProgress(profile.id, file.key, art.currentTime, art.duration);
      }
    });

    art.on('video:ended', () => {
      if (art.duration) saveProgress(profile.id, file.key, art.duration, art.duration);
    });

    art.on('error', (err) => {
      console.warn('[artplayer error]', err);
      loading.style.display = 'flex';
      status.textContent = 'Error al reproducir. Puedes cambiar al reproductor Nativo en Ajustes.';
    });

  } catch (error) {
    if (cancelled) return;
    status.textContent = error.message || 'Error al conectar con Telegram';
  }
}
