// Reproductor TGVideo: Estilo Stremio con OSD inferior, controles TV D-Pad, pistas y soporte de motor
import Artplayer from 'artplayer';
import { saveProgress, loadProgress } from './progress.js';
import { streamingAvailable, openStream } from './stream.js';
import { extractTitleAndYear } from '../metadata/tmdb.js';
import { prettyEpisodeName } from '../library/parse.js';
import { registerPlayerController, unregisterPlayerController } from '../ui/dpad.js';

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}[char]));

/**
 * Formatea un título limpio sin duplicaciones de nombre o año.
 */
export function formatPlayerTitle(title, file) {
  if (!title) return file?.label || 'Reproduciendo';

  const rawName = title.metadata?.name || title.nombre || '';
  const parsed = extractTitleAndYear(rawName);
  const cleanTitle = parsed.title || rawName;
  const year = title.metadata?.date?.slice(0, 4) || parsed.year || '';
  const yearSuffix = year ? ` (${year})` : '';

  if (title.tipo === 'serie') {
    const epNum = (file?.season || file?.episode)
      ? `T${file.season || 1}·E${String(file.episode || 1).padStart(2, '0')}`
      : '';
    const epName = file?.metadata?.name || file?.label || 'Episodio';
    return `${cleanTitle} · ${epNum ? epNum + ' - ' : ''}${epName}`;
  }

  if (title.isSaga) {
    return file?.metadata?.name || file?.sagaName || file?.label || cleanTitle;
  }

  // Película estándar
  if (!file?.label) return `${cleanTitle}${yearSuffix}`;

  const cleanFileLabel = file.label
    .replace(/\b(19\d\d|20\d\d)\b/g, '')
    .replace(/[\[\(\]\)]/g, ' ')
    .trim();

  const normTitle = cleanTitle.toLowerCase().replace(/[^a-z0-9]/g, '');
  const normLabel = cleanFileLabel.toLowerCase().replace(/[^a-z0-9]/g, '');

  if (normLabel === normTitle || normLabel.length === 0) {
    return `${cleanTitle}${yearSuffix}`;
  }

  const diffLabel = cleanFileLabel.replace(new RegExp(cleanTitle, 'gi'), '').trim();
  if (diffLabel && diffLabel.length > 2) {
    return `${cleanTitle}${yearSuffix} · ${diffLabel}`;
  }

  return `${cleanTitle}${yearSuffix}`;
}

function formatTime(secs) {
  if (!secs || isNaN(secs) || secs < 0) return '0:00';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function showToast(container, text) {
  let toast = container.querySelector('#pl-osd-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'pl-osd-toast';
    toast.className = 'player-osd-toast';
    container.appendChild(toast);
  }
  toast.textContent = text;
  toast.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('show'), 2400);
}

function cycleAudio(video, container) {
  const tracks = (video.audioTracks && video.audioTracks.length > 0)
    ? Array.from(video.audioTracks)
    : [];
  if (tracks.length === 0) {
    showToast(container, 'Pista de audio: Predeterminada');
    return;
  }
  if (tracks.length === 1) {
    const label = tracks[0].label || tracks[0].language || 'Principal';
    showToast(container, `Audio único: ${label}`);
    return;
  }
  let cur = tracks.findIndex(t => t.enabled);
  if (cur === -1) cur = 0;
  const next = (cur + 1) % tracks.length;
  tracks.forEach((t, i) => { t.enabled = (i === next); });
  const label = tracks[next].label || tracks[next].language || `Pista ${next + 1}`;
  showToast(container, `Audio (${next + 1}/${tracks.length}): ${label}`);
}

function cycleSubtitles(video, container) {
  const tracks = (video.textTracks && video.textTracks.length > 0)
    ? Array.from(video.textTracks).filter(t => t.kind === 'subtitles' || t.kind === 'captions' || !t.kind)
    : [];
  if (tracks.length === 0) {
    showToast(container, 'No hay subtítulos en este archivo');
    return;
  }
  let cur = tracks.findIndex(t => t.mode === 'showing');
  let next = cur + 1;
  if (next >= tracks.length) next = -1;

  tracks.forEach((t, i) => {
    t.mode = (i === next) ? 'showing' : 'disabled';
  });

  if (next === -1) {
    showToast(container, 'Subtítulos: Desactivados');
  } else {
    const label = tracks[next].label || tracks[next].language || `Pista ${next + 1}`;
    showToast(container, `Subtítulos (${next + 1}/${tracks.length}): ${label}`);
  }
}

function tryOpenVlc(url, container) {
  if (!url) {
    showToast(container, 'No hay enlace de streaming disponible para VLC');
    return;
  }
  try {
    const intentUrl = `intent:${url}#Intent;package=org.videolan.vlc;type=video/*;scheme=http;end`;
    window.location.href = intentUrl;
    showToast(container, 'Enviando a VLC…');
  } catch (_) {
    showToast(container, 'Telegram requiere streaming interno. Para VLC externo se necesita proxy HTTP.');
  }
}

function setupDoubleTapSkip({ container, video, skipSeconds = 10 }) {
  if (!container || !video) return () => {};

  const onDblClick = (e) => {
    if (e.target.closest('.player-tv-osd, button, input')) return;
    const rect = container.getBoundingClientRect();
    if (!rect.width) return;
    const x = (e.clientX - rect.left) / rect.width;
    if (x <= 0.38) {
      e.preventDefault(); e.stopPropagation();
      video.currentTime = Math.max(0, (video.currentTime || 0) - skipSeconds);
      showToast(container, `⏪ -${skipSeconds}s`);
    } else if (x >= 0.62) {
      e.preventDefault(); e.stopPropagation();
      video.currentTime = Math.min(video.duration || Infinity, (video.currentTime || 0) + skipSeconds);
      showToast(container, `+${skipSeconds}s ⏩`);
    }
  };

  let lastTapTime = 0;
  let lastTapX = 0;

  const onTouchEnd = (e) => {
    if (e.target.closest('.player-tv-osd, button, input')) return;
    const touch = e.changedTouches?.[0];
    if (!touch) return;
    const rect = container.getBoundingClientRect();
    if (!rect.width) return;
    const x = (touch.clientX - rect.left) / rect.width;
    const now = Date.now();

    if (now - lastTapTime < 320 && Math.abs(touch.clientX - lastTapX) < 60) {
      if (x <= 0.38) {
        e.preventDefault(); e.stopPropagation();
        video.currentTime = Math.max(0, (video.currentTime || 0) - skipSeconds);
        showToast(container, `⏪ -${skipSeconds}s`);
      } else if (x >= 0.62) {
        e.preventDefault(); e.stopPropagation();
        video.currentTime = Math.min(video.duration || Infinity, (video.currentTime || 0) + skipSeconds);
        showToast(container, `+${skipSeconds}s ⏩`);
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
  };
}

export async function playFile({ client, peerOf, file, title, profile, resumeAt = 0, onClose, mount, sync }) {
  const localPref = typeof localStorage !== 'undefined' && profile?.id
    ? localStorage.getItem(`tgvideo_player_${profile.id}`)
    : null;
  const playerType = profile?.player || localPref || 'artplayer';

  const localSkip = typeof localStorage !== 'undefined' && profile?.id
    ? localStorage.getItem(`tgvideo_skip_${profile.id}`)
    : null;
  const skipSeconds = Number(profile?.skip_seconds || localSkip || 10);

  if (playerType === 'native') {
    return playNative({ client, peerOf, file, title, profile, resumeAt, skipSeconds, onClose, mount, sync });
  }
  return playArtplayer({ client, peerOf, file, title, profile, resumeAt, skipSeconds, onClose, mount, sync });
}

// -------------------------------------------------------------
// REPRODUCTOR NATIVO (HTML5 / WebView) - Con OSD Stremio
// -------------------------------------------------------------
async function playNative({ client, peerOf, file, title, profile, resumeAt, skipSeconds, onClose, mount, sync }) {
  const displayTitle = formatPlayerTitle(title, file);

  mount.innerHTML = `
    <div class="player player-native">
      <div class="player-tv-osd" id="pl-osd">
        <div class="player-osd-top">
          <button class="player-osd-back-btn" id="pl-btn-back" data-focusable title="Volver">←</button>
          <div class="player-osd-title">${escapeHtml(displayTitle)}</div>
          <button class="player-osd-badge" id="pl-badge-toggle" title="Cambiar a ArtPlayer" data-focusable>Nativo ⇄</button>
        </div>

        <div class="player-osd-bottom">
          <div class="player-timeline-row">
            <span class="player-osd-time" id="pl-time-cur">0:00</span>
            <div class="player-scrubber-track" id="pl-scrubber" tabindex="0" data-focusable role="slider" aria-label="Línea de tiempo">
              <div class="player-scrubber-fill" id="pl-scrubber-fill">
                <div class="player-scrubber-thumb"></div>
              </div>
            </div>
            <span class="player-osd-time" id="pl-time-dur">0:00</span>
          </div>

          <div class="player-controls-row">
            <button class="player-ctrl-btn" id="pl-btn-rw" data-focusable title="Atrasar 10s">
              <svg viewBox="0 0 24 24"><path d="M11 18V6l-8.5 6 8.5 6zm.5-6l8.5 6V6l-8.5 6z"/></svg>
            </button>
            <button class="player-ctrl-btn player-ctrl-btn-primary" id="pl-btn-playpause" data-focusable title="Reproducir/Pausar">
              <svg id="pl-icon-play" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
              <svg id="pl-icon-pause" viewBox="0 0 24 24" style="display:none;"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
            </button>
            <button class="player-ctrl-btn" id="pl-btn-ff" data-focusable title="Adelantar 10s">
              <svg viewBox="0 0 24 24"><path d="M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z"/></svg>
            </button>
            <button class="player-ctrl-btn" id="pl-btn-audio" data-focusable title="Pistas de Audio">
              <svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>
            </button>
            <button class="player-ctrl-btn" id="pl-btn-subs" data-focusable title="Subtítulos">
              <svg viewBox="0 0 24 24"><path d="M19 4H5a2 2 0 00-2 2v12a2 2 0 002 2h14a2 2 0 002-2V6a2 2 0 00-2-2zm-8 7H9.5v-.5h-2v3h2V13H11v1c0 .55-.45 1-1 1H7c-.55 0-1-.45-1-1v-4c0-.55.45-1 1-1h3c.55 0 1 .45 1 1v1zm7 0h-1.5v-.5h-2v3h2V13H18v1c0 .55-.45 1-1 1h-3c-.55 0-1-.45-1-1v-4c0-.55.45-1 1-1h3c.55 0 1 .45 1 1v1z"/></svg>
            </button>
            <button class="player-ctrl-btn" id="pl-btn-vlc" data-focusable title="Abrir en VLC">
              <svg viewBox="0 0 24 24"><path d="M12 2L9.5 9h5L12 2zm-4 8L6 16h12l-2-6H8zm-3 7L3 21h18l-2-4H5z"/></svg>
            </button>
          </div>
        </div>
      </div>

      <div class="player-osd-toast" id="pl-osd-toast"></div>
      <div class="player-codec-notice" id="pl-codec-notice" style="display:none;">
        <span>Safari no puede mostrar este formato. En iPhone requiere MP4 con H.264 y AAC.</span>
      </div>
      <div class="player-loading" id="pl-loading">
        <div class="loader"></div>
        <p id="pl-status">Conectando con Telegram…</p>
      </div>
      <video class="native-video" playsinline webkit-playsinline autoplay preload="auto"></video>
    </div>`;

  const playerEl = mount.querySelector('.player');
  const video = mount.querySelector('video');
  const loading = mount.querySelector('#pl-loading');
  const status = mount.querySelector('#pl-status');
  const osd = mount.querySelector('#pl-osd');
  const codecNotice = mount.querySelector('#pl-codec-notice');
  const timeCur = mount.querySelector('#pl-time-cur');
  const timeDur = mount.querySelector('#pl-time-dur');
  const scrubber = mount.querySelector('#pl-scrubber');
  const scrubberFill = mount.querySelector('#pl-scrubber-fill');
  const iconPlay = mount.querySelector('#pl-icon-play');
  const iconPause = mount.querySelector('#pl-icon-pause');

  let cancelled = false;
  let stream = null;
  let url = null;
  let osdTimer = null;

  const updatePlayIcons = () => {
    if (video.paused) {
      if (iconPlay) iconPlay.style.display = 'block';
      if (iconPause) iconPause.style.display = 'none';
    } else {
      if (iconPlay) iconPlay.style.display = 'none';
      if (iconPause) iconPause.style.display = 'block';
    }
  };

  const showOsd = () => {
    osd.classList.remove('is-hidden');
    clearTimeout(osdTimer);
    if (!video.paused) {
      osdTimer = setTimeout(() => {
        osd.classList.add('is-hidden');
        if (osd.contains(document.activeElement)) document.activeElement.blur();
      }, 3500);
    }
  };

  const hideOsd = () => {
    clearTimeout(osdTimer);
    osd.classList.add('is-hidden');
    if (osd.contains(document.activeElement)) document.activeElement.blur();
  };

  playerEl.addEventListener('mousemove', showOsd);
  playerEl.addEventListener('click', (e) => {
    if (!e.target.closest('.player-osd-bottom, .player-osd-top, button')) {
      if (osd.classList.contains('is-hidden')) showOsd();
      else hideOsd();
    }
  });

  video.addEventListener('play', () => {
    updatePlayIcons();
    clearTimeout(osdTimer);
    osdTimer = setTimeout(() => {
      osd.classList.add('is-hidden');
      if (osd.contains(document.activeElement)) document.activeElement.blur();
    }, 2800);
  });

  video.addEventListener('pause', () => {
    updatePlayIcons();
    clearTimeout(osdTimer);
    osd.classList.remove('is-hidden');
    if (sync && profile?.id && video.duration) {
      const progress = saveProgress(profile.id, file.key, video.currentTime, video.duration);
      sync.schedulePush({ profile, progress });
    }
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

  goFullscreen();

  const cleanupSkip = setupDoubleTapSkip({ container: playerEl, video, skipSeconds });

  const close = () => {
    if (cancelled) return;
    cancelled = true;
    unregisterPlayerController();
    cleanupSkip();
    clearTimeout(osdTimer);
    exitFullscreen();
    if (video.duration) {
      saveProgress(profile.id, file.key, video.currentTime, video.duration);
      if (sync && profile?.id) {
        const progress = saveProgress(profile.id, file.key, video.currentTime, video.duration);
        sync.schedulePush({ profile, progress });
      }
    }
    video.pause();
    video.removeAttribute('src');
    video.load();
    if (stream) stream.close();
    else if (url) URL.revokeObjectURL(url);
    onClose?.();
  };

  // Botón Volver
  mount.querySelector('#pl-btn-back').onclick = close;

  // Botón Alternar motor Nativo / ArtPlayer
  mount.querySelector('#pl-badge-toggle')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const curTime = video.currentTime || resumeAt || 0;
    if (cancelled) return;
    cancelled = true;
    unregisterPlayerController();
    cleanupSkip();
    clearTimeout(osdTimer);
    exitFullscreen();
    if (video.duration) {
      saveProgress(profile.id, file.key, video.currentTime, video.duration);
    }
    video.pause();
    video.removeAttribute('src');
    video.load();
    if (stream) stream.close();
    else if (url) URL.revokeObjectURL(url);
    if (profile?.id) {
      localStorage.setItem(`tgvideo_player_${profile.id}`, 'artplayer');
      profile.player = 'artplayer';
    }
    playFile({ client, peerOf, file, title, profile, resumeAt: curTime, onClose, mount, sync });
  });

  mount.querySelector('#pl-btn-playpause').onclick = () => {
    if (video.paused) { video.play(); showToast(playerEl, '▶ Reproduciendo'); }
    else { video.pause(); showToast(playerEl, '⏸ Pausa'); }
    showOsd();
  };

  mount.querySelector('#pl-btn-rw').onclick = () => {
    video.currentTime = Math.max(0, (video.currentTime || 0) - skipSeconds);
    showToast(playerEl, `⏪ -${skipSeconds}s`);
    showOsd();
  };

  mount.querySelector('#pl-btn-ff').onclick = () => {
    video.currentTime = Math.min(video.duration || Infinity, (video.currentTime || 0) + skipSeconds);
    showToast(playerEl, `+${skipSeconds}s ⏩`);
    showOsd();
  };

  mount.querySelector('#pl-btn-audio').onclick = () => {
    cycleAudio(video, playerEl);
    showOsd();
  };

  mount.querySelector('#pl-btn-subs').onclick = () => {
    cycleSubtitles(video, playerEl);
    showOsd();
  };

  mount.querySelector('#pl-btn-vlc').onclick = () => {
    tryOpenVlc(url, playerEl);
    showOsd();
  };

  scrubber.onclick = (e) => {
    const rect = scrubber.getBoundingClientRect();
    if (rect.width && video.duration) {
      const pos = (e.clientX - rect.left) / rect.width;
      video.currentTime = pos * video.duration;
      showOsd();
    }
  };

  // Controlador TV para D-Pad / Mando Fire TV
  const tvController = {
    close: () => close(),
    onLeft: () => {
      const isScrubber = document.activeElement === scrubber;
      const isBtn = document.activeElement?.classList.contains('player-ctrl-btn');

      if (isBtn) {
        const btns = [...mount.querySelectorAll('.player-controls-row .player-ctrl-btn')];
        const idx = btns.indexOf(document.activeElement);
        if (idx > 0) {
          btns[idx - 1].focus();
          showOsd();
          return;
        }
      }

      // Si tiene el foco en la línea de tiempo o si el OSD está oculto, buscar atrás
      video.currentTime = Math.max(0, (video.currentTime || 0) - skipSeconds);
      showToast(playerEl, `⏪ -${skipSeconds}s (${formatTime(video.currentTime)})`);
      showOsd();
    },
    onRight: () => {
      const isScrubber = document.activeElement === scrubber;
      const isBtn = document.activeElement?.classList.contains('player-ctrl-btn');

      if (isBtn) {
        const btns = [...mount.querySelectorAll('.player-controls-row .player-ctrl-btn')];
        const idx = btns.indexOf(document.activeElement);
        if (idx !== -1 && idx < btns.length - 1) {
          btns[idx + 1].focus();
          showOsd();
          return;
        }
      }

      // Si tiene el foco en la barra de tiempo o si el OSD está oculto, buscar adelante
      video.currentTime = Math.min(video.duration || Infinity, (video.currentTime || 0) + skipSeconds);
      showToast(playerEl, `⏩ +${skipSeconds}s (${formatTime(video.currentTime)})`);
      showOsd();
    },
    onUp: () => {
      if (osd.classList.contains('is-hidden')) {
        showOsd();
        mount.querySelector('#pl-btn-playpause')?.focus();
        return;
      }

      const cur = document.activeElement;
      if (cur?.classList.contains('player-ctrl-btn')) {
        scrubber.focus();
      } else if (cur === scrubber) {
        mount.querySelector('#pl-btn-back')?.focus();
      } else {
        mount.querySelector('#pl-btn-playpause')?.focus();
      }
      showOsd();
    },
    onDown: () => {
      if (osd.classList.contains('is-hidden')) {
        showOsd();
        mount.querySelector('#pl-btn-playpause')?.focus();
        return;
      }

      const cur = document.activeElement;
      if (cur?.id === 'pl-btn-back' || cur?.id === 'pl-badge-toggle') {
        scrubber.focus();
      } else if (cur === scrubber) {
        mount.querySelector('#pl-btn-playpause')?.focus();
      } else {
        hideOsd();
      }
    },
    onSelect: () => {
      if (osd.classList.contains('is-hidden')) {
        if (video.paused) { video.play(); showToast(playerEl, '▶ Reproduciendo'); }
        else { video.pause(); showToast(playerEl, '⏸ Pausa'); }
        showOsd();
        return;
      }

      if (document.activeElement === scrubber) {
        if (video.paused) video.play(); else video.pause();
        showOsd();
        return;
      }

      if (osd.contains(document.activeElement)) {
        document.activeElement.click();
        showOsd();
      } else {
        if (video.paused) { video.play(); showToast(playerEl, '▶ Reproduciendo'); }
        else { video.pause(); showToast(playerEl, '⏸ Pausa'); }
        showOsd();
      }
    },
  };

  registerPlayerController(tvController);

  try {
    const targetChannel = file?.channel || title?.channel;
    if (!targetChannel?.id || !targetChannel?.hash) throw new Error('Canal no encontrado para este archivo.');
    const peer = await peerOf(targetChannel);
    const [msg] = await client.getMessages(peer, { ids: [file.messageId] });
    if (cancelled) return;
    if (!msg?.media?.document) throw new Error('Vídeo no encontrado en el canal.');

    const doc = msg.media.document;
    const size = Number(doc?.size?.toString?.() || doc?.size || file.size || 0);
    const mime = doc?.mimeType || file.mimeType || file.mime || 'video/mp4';
    if (size > 0 && await streamingAvailable()) {
      status.textContent = 'Abriendo túnel de streaming…';
      stream = openStream({ client, media: msg.media, size, mime, name: file.label || 'video' });
      if (cancelled) { stream.close(); return; }
      url = stream.url;
    } else {
      status.textContent = 'Descargando desde Telegram…';
      const buffer = await client.downloadMedia(msg.media, {
        progressCallback: (done, total) => {
          if (cancelled) return;
          const fullSize = Number(total) || size || 1;
          status.textContent = `Descargando: ${Math.round((Number(done) / fullSize) * 100)}%`;
        },
      });
      if (cancelled) return;
      url = URL.createObjectURL(new Blob([buffer], { type: mime }));
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
      timeDur.textContent = formatTime(video.duration);
      if (video.webkitSupportsFullscreen && !document.fullscreenElement) {
        try { video.webkitEnterFullscreen(); } catch (_) {}
      }
    });

    video.addEventListener('canplay', () => {
      loading.style.display = 'none';
      video.play().catch(() => {});
    });

    let lastSaved = 0;
    let audioOnlyChecked = false;

    video.addEventListener('timeupdate', () => {
      timeCur.textContent = formatTime(video.currentTime);
      if (video.duration) {
        scrubberFill.style.width = `${Math.min(100, (video.currentTime / video.duration) * 100)}%`;
      }

      const now = Date.now();
      if (now - lastSaved > 8000 && video.duration) {
        lastSaved = now;
        saveProgress(profile.id, file.key, video.currentTime, video.duration);
        if (sync && profile?.id) {
          sync.schedulePush({ profile, progress: loadProgress(profile.id) });
        }
      }

      if (!audioOnlyChecked && video.currentTime > 2.2 && !video.paused) {
        audioOnlyChecked = true;
        if (video.videoWidth === 0 && codecNotice) {
          codecNotice.style.display = 'flex';
          showOsd();
        }
      }
    });

    video.addEventListener('ended', () => {
      if (video.duration) {
        saveProgress(profile.id, file.key, video.duration, video.duration);
        if (sync && profile?.id) {
          sync.pushProfile({ profile, progress: loadProgress(profile.id) }).catch(() => {});
        }
      }
    });

    video.addEventListener('error', () => {
      loading.style.display = 'flex';
      status.textContent = 'Error al reproducir el archivo. Prueba el otro reproductor o verifica los códecs.';
      if (codecNotice) codecNotice.style.display = 'flex';
    });

  } catch (error) {
    if (cancelled) return;
    status.textContent = error.message || 'Error al conectar con Telegram';
  }
}

// -------------------------------------------------------------
// REPRODUCTOR ARTPLAYER - Con OSD Stremio unificado
// -------------------------------------------------------------
async function playArtplayer({ client, peerOf, file, title, profile, resumeAt = 0, skipSeconds, onClose, mount, sync }) {
  const displayTitle = formatPlayerTitle(title, file);

  mount.innerHTML = `
    <div class="player player-art">
      <div class="player-tv-osd" id="pl-osd">
        <div class="player-osd-top">
          <button class="player-osd-back-btn" id="pl-btn-back" data-focusable title="Volver">←</button>
          <div class="player-osd-title">${escapeHtml(displayTitle)}</div>
          <button class="player-osd-badge" id="pl-badge-toggle" title="Cambiar a Nativo" data-focusable>ArtPlayer ⇄</button>
        </div>

        <div class="player-osd-bottom">
          <div class="player-timeline-row">
            <span class="player-osd-time" id="pl-time-cur">0:00</span>
            <div class="player-scrubber-track" id="pl-scrubber" tabindex="0" data-focusable role="slider" aria-label="Línea de tiempo">
              <div class="player-scrubber-fill" id="pl-scrubber-fill">
                <div class="player-scrubber-thumb"></div>
              </div>
            </div>
            <span class="player-osd-time" id="pl-time-dur">0:00</span>
          </div>

          <div class="player-controls-row">
            <button class="player-ctrl-btn" id="pl-btn-rw" data-focusable title="Atrasar 10s">
              <svg viewBox="0 0 24 24"><path d="M11 18V6l-8.5 6 8.5 6zm.5-6l8.5 6V6l-8.5 6z"/></svg>
            </button>
            <button class="player-ctrl-btn player-ctrl-btn-primary" id="pl-btn-playpause" data-focusable title="Reproducir/Pausar">
              <svg id="pl-icon-play" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
              <svg id="pl-icon-pause" viewBox="0 0 24 24" style="display:none;"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
            </button>
            <button class="player-ctrl-btn" id="pl-btn-ff" data-focusable title="Adelantar 10s">
              <svg viewBox="0 0 24 24"><path d="M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z"/></svg>
            </button>
            <button class="player-ctrl-btn" id="pl-btn-audio" data-focusable title="Pistas de Audio">
              <svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>
            </button>
            <button class="player-ctrl-btn" id="pl-btn-subs" data-focusable title="Subtítulos">
              <svg viewBox="0 0 24 24"><path d="M19 4H5a2 2 0 00-2 2v12a2 2 0 002 2h14a2 2 0 002-2V6a2 2 0 00-2-2zm-8 7H9.5v-.5h-2v3h2V13H11v1c0 .55-.45 1-1 1H7c-.55 0-1-.45-1-1v-4c0-.55.45-1 1-1h3c.55 0 1 .45 1 1v1zm7 0h-1.5v-.5h-2v3h2V13H18v1c0 .55-.45 1-1 1h-3c-.55 0-1-.45-1-1v-4c0-.55.45-1 1-1h3c.55 0 1 .45 1 1v1z"/></svg>
            </button>
            <button class="player-ctrl-btn" id="pl-btn-vlc" data-focusable title="Abrir en VLC">
              <svg viewBox="0 0 24 24"><path d="M12 2L9.5 9h5L12 2zm-4 8L6 16h12l-2-6H8zm-3 7L3 21h18l-2-4H5z"/></svg>
            </button>
          </div>
        </div>
      </div>

      <div class="player-osd-toast" id="pl-osd-toast"></div>
      <div class="player-codec-notice" id="pl-codec-notice" style="display:none;">
        <span>Safari no puede mostrar este formato. En iPhone requiere MP4 con H.264 y AAC.</span>
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
  const osd = mount.querySelector('#pl-osd');
  const codecNotice = mount.querySelector('#pl-codec-notice');
  const timeCur = mount.querySelector('#pl-time-cur');
  const timeDur = mount.querySelector('#pl-time-dur');
  const scrubber = mount.querySelector('#pl-scrubber');
  const scrubberFill = mount.querySelector('#pl-scrubber-fill');
  const iconPlay = mount.querySelector('#pl-icon-play');
  const iconPause = mount.querySelector('#pl-icon-pause');

  let cancelled = false;
  let stream = null;
  let url = null;
  let art = null;
  let cleanupSkip = null;
  let osdTimer = null;

  const updatePlayIcons = () => {
    if (art?.template?.$video?.paused) {
      if (iconPlay) iconPlay.style.display = 'block';
      if (iconPause) iconPause.style.display = 'none';
    } else {
      if (iconPlay) iconPlay.style.display = 'none';
      if (iconPause) iconPause.style.display = 'block';
    }
  };

  const showOsd = () => {
    osd.classList.remove('is-hidden');
    clearTimeout(osdTimer);
    if (art && !art.template.$video.paused) {
      osdTimer = setTimeout(() => {
        osd.classList.add('is-hidden');
        if (osd.contains(document.activeElement)) document.activeElement.blur();
      }, 3500);
    }
  };

  const hideOsd = () => {
    clearTimeout(osdTimer);
    osd.classList.add('is-hidden');
    if (osd.contains(document.activeElement)) document.activeElement.blur();
  };

  playerEl.addEventListener('mousemove', showOsd);
  playerEl.addEventListener('click', (e) => {
    if (!e.target.closest('.player-osd-bottom, .player-osd-top, button')) {
      if (osd.classList.contains('is-hidden')) showOsd();
      else hideOsd();
    }
  });

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
    unregisterPlayerController();
    if (cleanupSkip) cleanupSkip();
    clearTimeout(osdTimer);
    exitFullscreen();
    if (art) {
      try {
        if (art.duration) {
          saveProgress(profile.id, file.key, art.currentTime, art.duration);
          if (sync && profile?.id) {
            sync.pushProfile({ profile, progress: loadProgress(profile.id) }).catch(() => {});
          }
        }
        art.destroy(false);
      } catch (_) {}
    }
    if (stream) stream.close();
    else if (url) URL.revokeObjectURL(url);
    onClose?.();
  };

  // Botón Volver
  mount.querySelector('#pl-btn-back').onclick = close;

  // Botón Alternar motor Nativo / ArtPlayer
  mount.querySelector('#pl-badge-toggle')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const curTime = art?.currentTime || resumeAt || 0;
    if (cancelled) return;
    cancelled = true;
    unregisterPlayerController();
    if (cleanupSkip) cleanupSkip();
    clearTimeout(osdTimer);
    exitFullscreen();
    if (art) {
      try {
        if (art.duration) {
          saveProgress(profile.id, file.key, art.currentTime, art.duration);
        }
        art.destroy(false);
      } catch (_) {}
    }
    if (stream) stream.close();
    else if (url) URL.revokeObjectURL(url);
    if (profile?.id) {
      localStorage.setItem(`tgvideo_player_${profile.id}`, 'native');
      profile.player = 'native';
    }
    playFile({ client, peerOf, file, title, profile, resumeAt: curTime, onClose, mount, sync });
  });

  mount.querySelector('#pl-btn-playpause').onclick = () => {
    if (art) {
      if (art.template.$video.paused) { art.play(); showToast(playerEl, '▶ Reproduciendo'); }
      else { art.pause(); showToast(playerEl, '⏸ Pausa'); }
      showOsd();
    }
  };

  mount.querySelector('#pl-btn-rw').onclick = () => {
    if (art) {
      art.currentTime = Math.max(0, art.currentTime - skipSeconds);
      showToast(playerEl, `⏪ -${skipSeconds}s`);
      showOsd();
    }
  };

  mount.querySelector('#pl-btn-ff').onclick = () => {
    if (art) {
      art.currentTime = Math.min(art.duration || Infinity, art.currentTime + skipSeconds);
      showToast(playerEl, `+${skipSeconds}s ⏩`);
      showOsd();
    }
  };

  mount.querySelector('#pl-btn-audio').onclick = () => {
    if (art?.template?.$video) {
      cycleAudio(art.template.$video, playerEl);
      showOsd();
    }
  };

  mount.querySelector('#pl-btn-subs').onclick = () => {
    if (art?.template?.$video) {
      cycleSubtitles(art.template.$video, playerEl);
      showOsd();
    }
  };

  mount.querySelector('#pl-btn-vlc').onclick = () => {
    tryOpenVlc(url, playerEl);
    showOsd();
  };

  scrubber.onclick = (e) => {
    const rect = scrubber.getBoundingClientRect();
    if (rect.width && art?.duration) {
      const pos = (e.clientX - rect.left) / rect.width;
      art.currentTime = pos * art.duration;
      showOsd();
    }
  };

  // Controlador TV para D-Pad / Mando Fire TV
  const tvController = {
    close: () => close(),
    onLeft: () => {
      const isBtn = document.activeElement?.classList.contains('player-ctrl-btn');
      if (isBtn) {
        const btns = [...mount.querySelectorAll('.player-controls-row .player-ctrl-btn')];
        const idx = btns.indexOf(document.activeElement);
        if (idx > 0) {
          btns[idx - 1].focus();
          showOsd();
          return;
        }
      }
      if (art) {
        art.currentTime = Math.max(0, art.currentTime - skipSeconds);
        showToast(playerEl, `⏪ -${skipSeconds}s (${formatTime(art.currentTime)})`);
        showOsd();
      }
    },
    onRight: () => {
      const isBtn = document.activeElement?.classList.contains('player-ctrl-btn');
      if (isBtn) {
        const btns = [...mount.querySelectorAll('.player-controls-row .player-ctrl-btn')];
        const idx = btns.indexOf(document.activeElement);
        if (idx !== -1 && idx < btns.length - 1) {
          btns[idx + 1].focus();
          showOsd();
          return;
        }
      }
      if (art) {
        art.currentTime = Math.min(art.duration || Infinity, art.currentTime + skipSeconds);
        showToast(playerEl, `⏩ +${skipSeconds}s (${formatTime(art.currentTime)})`);
        showOsd();
      }
    },
    onUp: () => {
      if (osd.classList.contains('is-hidden')) {
        showOsd();
        mount.querySelector('#pl-btn-playpause')?.focus();
        return;
      }

      const cur = document.activeElement;
      if (cur?.classList.contains('player-ctrl-btn')) {
        scrubber.focus();
      } else if (cur === scrubber) {
        mount.querySelector('#pl-btn-back')?.focus();
      } else {
        mount.querySelector('#pl-btn-playpause')?.focus();
      }
      showOsd();
    },
    onDown: () => {
      if (osd.classList.contains('is-hidden')) {
        showOsd();
        mount.querySelector('#pl-btn-playpause')?.focus();
        return;
      }

      const cur = document.activeElement;
      if (cur?.id === 'pl-btn-back' || cur?.id === 'pl-badge-toggle') {
        scrubber.focus();
      } else if (cur === scrubber) {
        mount.querySelector('#pl-btn-playpause')?.focus();
      } else {
        hideOsd();
      }
    },
    onSelect: () => {
      if (osd.classList.contains('is-hidden')) {
        if (art) {
          if (art.template.$video.paused) { art.play(); showToast(playerEl, '▶ Reproduciendo'); }
          else { art.pause(); showToast(playerEl, '⏸ Pausa'); }
          showOsd();
        }
        return;
      }

      if (document.activeElement === scrubber) {
        if (art) {
          if (art.template.$video.paused) art.play(); else art.pause();
          showOsd();
        }
        return;
      }

      if (osd.contains(document.activeElement)) {
        document.activeElement.click();
        showOsd();
      } else if (art) {
        if (art.template.$video.paused) { art.play(); showToast(playerEl, '▶ Reproduciendo'); }
        else { art.pause(); showToast(playerEl, '⏸ Pausa'); }
        showOsd();
      }
    },
  };

  registerPlayerController(tvController);

  try {
    const targetChannel = file?.channel || title?.channel;
    if (!targetChannel?.id || !targetChannel?.hash) throw new Error('Canal no encontrado para este archivo.');
    const peer = await peerOf(targetChannel);
    const [msg] = await client.getMessages(peer, { ids: [file.messageId] });
    if (cancelled) return;
    if (!msg?.media?.document) throw new Error('Vídeo no encontrado en el canal.');

    const doc = msg.media.document;
    const size = Number(doc?.size?.toString?.() || doc?.size || file.size || 0);
    const mime = doc?.mimeType || file.mimeType || file.mime || 'video/mp4';
    if (size > 0 && await streamingAvailable()) {
      status.textContent = 'Abriendo túnel de streaming…';
      stream = openStream({ client, media: msg.media, size, mime, name: file.label || 'video' });
      if (cancelled) { stream.close(); return; }
      url = stream.url;
    } else {
      status.textContent = 'Descargando desde Telegram…';
      const buffer = await client.downloadMedia(msg.media, {
        progressCallback: (done, total) => {
          if (cancelled) return;
          const fullSize = Number(total) || size || 1;
          status.textContent = `Descargando: ${Math.round((Number(done) / fullSize) * 100)}%`;
        },
      });
      if (cancelled) return;
      url = URL.createObjectURL(new Blob([buffer], { type: mime }));
    }

    if (cancelled) return;

    art = new Artplayer({
      container,
      url,
      title: displayTitle,
      autoplay: true,
      playsInline: true,
      theme: '#e50914',
      lang: 'es',
      volume: 0.85,
      autoSize: false,
      autoMini: false,
      mutex: true,
      hotkey: false, // Controlado por el OSD TV nativo
      playbackRate: true,
      aspectRatio: true,
      fullscreen: false,
      fullscreenWeb: false,
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
    let audioOnlyChecked = false;

    cleanupSkip = setupDoubleTapSkip({ container: art.template.$player, video, skipSeconds });

    art.on('ready', () => {
      loading.style.display = 'none';
      if (resumeAt > 0) {
        art.currentTime = resumeAt;
      }
      if (video.duration) {
        timeDur.textContent = formatTime(video.duration);
      }
    });

    art.on('video:loadedmetadata', () => {
      timeDur.textContent = formatTime(video.duration);
    });

    art.on('video:play', () => {
      updatePlayIcons();
      clearTimeout(osdTimer);
      osdTimer = setTimeout(() => {
        osd.classList.add('is-hidden');
        if (osd.contains(document.activeElement)) document.activeElement.blur();
      }, 2800);
    });

    art.on('video:pause', () => {
      updatePlayIcons();
      clearTimeout(osdTimer);
      osd.classList.remove('is-hidden');
      if (sync && profile?.id && art?.duration) {
        const progress = saveProgress(profile.id, file.key, art.currentTime, art.duration);
        sync.schedulePush({ profile, progress });
      }
    });

    art.on('video:timeupdate', () => {
      timeCur.textContent = formatTime(art.currentTime);
      if (art.duration) {
        scrubberFill.style.width = `${Math.min(100, (art.currentTime / art.duration) * 100)}%`;
      }

      const now = Date.now();
      if (now - lastSaved > 8000 && art.duration) {
        lastSaved = now;
        saveProgress(profile.id, file.key, art.currentTime, art.duration);
        if (sync && profile?.id) {
          sync.schedulePush({ profile, progress: loadProgress(profile.id) });
        }
      }

      if (!audioOnlyChecked && video.currentTime > 2.2 && !video.paused) {
        audioOnlyChecked = true;
        if (video.videoWidth === 0 && codecNotice) {
          codecNotice.style.display = 'flex';
          showOsd();
        }
      }
    });

    art.on('video:ended', () => {
      if (art.duration) {
        saveProgress(profile.id, file.key, art.duration, art.duration);
        if (sync && profile?.id) {
          sync.pushProfile({ profile, progress: loadProgress(profile.id) }).catch(() => {});
        }
      }
    });

    art.on('video:error', () => {
      loading.style.display = 'flex';
      status.textContent = 'Error al reproducir el archivo. Prueba el otro reproductor o verifica los códecs.';
      if (codecNotice) codecNotice.style.display = 'flex';
    });

  } catch (error) {
    if (cancelled) return;
    status.textContent = error.message || 'Error al conectar con Telegram';
  }
}
